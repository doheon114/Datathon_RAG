"""RAG/*.pdf 전부를 정제 -> 큰 청크로 분할 -> Chroma 'notebook' 컬렉션에 저장한다 (자료 기반 답변용 인덱스).

개선점 (기존 4_vectorstore.py 대비)
 - PDF 줄바꿈 때문에 단어가 끊긴 텍스트("사망 률", "경\\n우에")를 이어 붙여 읽기 좋게 정제, 쪽 머리글 제거
 - 청크를 한글 900자 / 영문 2400자로 키워서 근거가 문장 중간에서 잘리지 않게 함 (기존 약 270자)
 - 참고문헌 청크 제외, 자료(source)별 메타데이터, 쪽 전체 텍스트(pages.json) 저장
 - 표: PyMuPDF find_tables 로 감지해 마크다운 표(+캡션)로 변환, 쪼개지 않고 독립 청크(kind=table)로 저장.
   너무 긴 표는 행 단위로 나누되 머리글 행을 반복. 본문 텍스트에서는 표 영역을 제외해 중복을 막는다.

사전 준비: export OPENAI_API_KEY=sk-...
실행: .venv/bin/python src/8_build_index.py   (컬렉션이 있으면 지우고 다시 만든다)
"""
import glob
import json
import logging
import os
import re
import sys
import unicodedata
import warnings

warnings.filterwarnings("ignore")
logging.disable(logging.CRITICAL)

import chromadb
import pymupdf
from langchain_community.vectorstores import Chroma
from langchain_core.documents import Document
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

if not os.environ.get("OPENAI_API_KEY"):
    sys.exit("OPENAI_API_KEY 환경변수가 없습니다. export OPENAI_API_KEY=sk-... 후 다시 실행하세요.")

DB_DIR, COLLECTION, PAGES_JSON = "./db/chromadb", "notebook", "./db/pages.json"
CHUNK = {"ko": (900, 150), "en": (2400, 300)}  # (chunk_size, overlap) 글자 수 기준

BULLET = re.compile(r"^([•·▪●○■□※◦]|\(?\d{1,2}[\.\)]\s|[①-⑳]|\([가-힣a-z0-9]\)|[-–]\s)")
HANGUL = re.compile(r"[가-힣]")
JOURNAL_CITE = re.compile(r"(19|20)\d{2}\s*;\s*\d+")  # 참고문헌의 "2005;46:2183" 패턴
EN_HEADER = re.compile(
    r"^\s*(Circulation\. 2022;145.*|[A-Z][a-z]+ \d{1,2}, 20\d\d|e\d{3,4}|CLINICAL STATEMENTS|AND GUIDELINES|Heidenreich et al"
    r"|2022 AHA/ACC/HFSA Heart Failure Guideline|Downloaded from .*)\s*$"
)
KO_HEADER = re.compile(r"^\s*(\d+\s*\|\s*심부전 진료지침|.*\s\|\s*\d+|Chapter|Part [IVX]+ .*)\s*$")


def source_info(fname: str):
    n = unicodedata.normalize("NFC", fname)
    if "심부전학회" in n:
        return "ksh2022", "대한심부전학회 2022 심부전 진료지침", "ko"
    if "ESC" in n:
        return "esc2026", "2026 ESC Heart Failure Guidelines", "en"
    if "AHA" in n or "heidenreich" in n.lower():
        return "aha2022", "2022 AHA/ACC/HFSA Heart Failure Guideline", "en"
    slug = re.sub(r"\W+", "_", n.rsplit(".", 1)[0])[:30]
    return slug, n.rsplit(".", 1)[0], "ko" if HANGUL.search(n) else "en"


def clean_text(raw: str, lang: str, strip_headers: bool = True) -> str:
    """PDF 줄바꿈 정리. 한글: 줄 끝 공백 없이 끊긴 줄은 단어 중간 줄바꿈이라 붙이고, 공백 있으면 띄어쓰기."""
    raw = raw.replace("\x00", "").replace("\x08", "").replace("­", "")
    lines = raw.split("\n")
    hdr = KO_HEADER if lang == "ko" else EN_HEADER  # 쪽 머리글/바닥글 제거 (첫 3~8줄, 마지막 2~4줄)
    head, tail = (3, 2) if lang == "ko" else (8, 4)
    if strip_headers:
        lines = [ln for i, ln in enumerate(lines) if not ((i < head or i >= len(lines) - tail) and hdr.match(ln))]
    out, prev_raw = "", ""
    for ln in lines:
        s = ln.strip()
        if not s:
            out = out.rstrip() + "\n\n" if out and not out.endswith("\n\n") else out
            prev_raw = ""
            continue
        if not out or out.endswith("\n\n"):
            out += s
        elif BULLET.match(s):
            out = out.rstrip() + "\n" + s
        elif lang == "ko" and not prev_raw.endswith((" ", "\t")) and HANGUL.match(out[-1]) and HANGUL.match(s[0]):
            out += s  # 단어 중간 줄바꿈
        elif out.endswith("-") and s[0].islower():
            # 하이픈 뒤 공백이 있으면 복합어("all- \ncause" -> all-cause), 없으면 단어 분철("pa-\ntients" -> patients)
            out = out + s if prev_raw.endswith("- ") else out[:-1] + s
        else:
            out = out.rstrip() + " " + s
        prev_raw = ln
    out = re.sub(r"[ \t]{2,}", " ", out)
    return re.sub(r"\n{3,}", "\n\n", out).strip()


TABLE_CAPTION = re.compile(r"^\s*(표|Table)\s*\d+")
TABLE_LIMIT = {"ko": 1800, "en": 4000}  # 표 청크 최대 글자 수 (넘으면 행 단위 분할)


def clean_cell(cell, lang: str) -> str:
    if not cell:
        return ""
    return re.sub(r"\s+", " ", clean_text(cell, lang, strip_headers=False)).replace("|", "/").strip()


def table_rows(raw_rows, lang: str):
    """셀 정제 -> 빈 행/열 제거 -> 품질 검사. 통과하면 (머리글 행, 본문 행들), 아니면 None."""
    rows = [[clean_cell(c, lang) for c in r] for r in raw_rows]
    rows = [r for r in rows if any(r)]
    if len(rows) < 2:
        return None
    keep = [j for j in range(max(len(r) for r in rows)) if any(j < len(r) and r[j] for r in rows)]
    rows = [[r[j] if j < len(r) else "" for j in keep] for r in rows]
    cells = [c for r in rows for c in r]
    if len(keep) < 2 or sum(map(len, cells)) < 40 or sum(1 for c in cells if c) / len(cells) < 0.5:
        return None
    return rows[0], rows[1:]


def table_chunks(caption: str, header, body, lang: str):
    """마크다운 표 청크 목록. 한도를 넘으면 행 단위로 나누고 머리글을 반복한다."""
    head = "| " + " | ".join(header) + " |\n| " + " | ".join("---" for _ in header) + " |\n"
    prefix = f"**{caption}**\n\n" if caption else ""
    chunks, cur = [], []
    for row in body:
        line = "| " + " | ".join(row) + " |\n"
        if cur and len(prefix) + len(head) + sum(map(len, cur)) + len(line) > TABLE_LIMIT[lang]:
            chunks.append(prefix + head + "".join(cur).rstrip())
            cur = []
        cur.append(line)
    if cur:
        chunks.append(prefix + head + "".join(cur).rstrip())
    return chunks


def table_raw_rows(page, t):
    """셀 영역을 get_text(clip=...)로 읽는다. Table.extract() 는 한국어 표에서 소수점·구두점을 떼어내(2.5 -> 25) 쓰지 않는다."""
    try:
        return [[page.get_text("text", clip=pymupdf.Rect(bbox)) if bbox else "" for bbox in r.cells] for r in t.rows]
    except Exception:
        return t.extract()


def extract_page(page, lang: str):
    """쪽 -> (표 영역을 뺀 본문 원문, [(캡션, 머리글, 본문 행)])."""
    try:
        found = page.find_tables().tables
    except Exception:
        found = []
    blocks = [b for b in page.get_text("blocks") if b[6] == 0]
    tables, consumed = [], set()
    for t in found:
        parsed = table_rows(table_raw_rows(page, t), lang)
        if not parsed:
            continue
        rect = pymupdf.Rect(t.bbox)
        # 캡션: 표 바로 위(70pt 이내)에서 "표 N"/"Table N" 으로 시작하는 블록
        caption, best = "", 70
        for i, b in enumerate(blocks):
            if TABLE_CAPTION.match(b[4]) and 0 <= rect.y0 - b[3] + 5 < best:
                caption, best = re.sub(r"\s+", " ", clean_text(b[4], lang, strip_headers=False)), rect.y0 - b[3] + 5
                consumed.add(i)
        tables.append((rect, caption, *parsed))

    def in_table(b):
        r = pymupdf.Rect(b[:4])
        area = r.get_area() or 1
        return any((r & t[0]).get_area() / area > 0.5 for t in tables)

    raw = "".join(b[4] for i, b in enumerate(blocks) if i not in consumed and not in_table(b))
    return raw, [(c, h, body) for _, c, h, body in tables]


def main():
    docs, pages_out = [], {}
    for f in sorted(glob.glob("*.pdf")):
        sid, name, lang = source_info(f)
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=CHUNK[lang][0], chunk_overlap=CHUNK[lang][1], length_function=len
        )
        pdf = pymupdf.open(f)
        pages_out[sid] = {"name": name, "lang": lang, "file": f, "pages": {}}
        n_ref = 0
        n_tab = 0
        for pno, page in enumerate(pdf, 1):
            raw, tables = extract_page(page, lang)
            text = clean_text(raw, lang)
            table_md = []
            for caption, header, body in tables:
                for chunk in table_chunks(caption, header, body, lang):
                    n_tab += 1
                    table_md.append(chunk)
                    docs.append(Document(page_content=chunk, metadata={
                        "source": sid, "source_name": name, "page": pno, "lang": lang, "kind": "table", "caption": caption}))
            full = "\n\n".join([text, *table_md]).strip()  # 쪽 전체 보기용: 본문 + 표(마크다운)
            if len(full) < 40:
                continue
            pages_out[sid]["pages"][str(pno)] = full
            for chunk in splitter.split_text(text) if len(text) >= 40 else []:
                if len(chunk.strip()) < 40:
                    continue
                if len(JOURNAL_CITE.findall(chunk)) >= 3:  # 참고문헌 목록 제외
                    n_ref += 1
                    continue
                docs.append(Document(page_content=chunk, metadata={
                    "source": sid, "source_name": name, "page": pno, "lang": lang, "kind": "text", "caption": ""}))
        print(f"{name}: {len(pdf)}쪽, 표 청크 {n_tab}개, 참고문헌 청크 {n_ref}개 제외")

    print(f"총 청크: {len(docs)} (평균 {sum(len(d.page_content) for d in docs) // len(docs)}자)")
    with open(PAGES_JSON, "w", encoding="utf-8") as fh:
        json.dump(pages_out, fh, ensure_ascii=False)

    client = chromadb.PersistentClient(path=DB_DIR)
    if COLLECTION in [c.name for c in client.list_collections()]:
        client.delete_collection(COLLECTION)
    Chroma.from_documents(
        docs,
        OpenAIEmbeddings(model="text-embedding-3-small"),
        collection_name=COLLECTION,
        persist_directory=DB_DIR,
        collection_metadata={"hnsw:space": "cosine"},
    )
    print(f"저장 완료: {DB_DIR} / {COLLECTION} ({len(docs)}개), 쪽 텍스트: {PAGES_JSON}")


if __name__ == "__main__":
    main()
