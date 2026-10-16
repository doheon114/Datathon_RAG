"""PyPDFLoader로 PDF 전체 텍스트를 추출해 txt 파일로 저장한다.

실행: .venv/bin/python src/1_pdf_to_txt.py
"""
import glob
import logging
import unicodedata

from langchain_community.document_loaders import PyPDFLoader

logging.disable(logging.CRITICAL)  # pypdf의 fontTools 경고 억제

OUT_PATH = "heart_failure_2022.txt"


def find_pdf(*keywords: str) -> str:
    """파일명에 keywords 중 하나가 들어간 PDF (대소문자 무시)."""
    # 파일명이 NFD로 저장돼 있어 한글 경로를 그대로 쓰면 못 찾는다 -> NFC로 정규화해 비교
    for f in glob.glob("*.pdf"):
        if any(k.lower() in unicodedata.normalize("NFC", f).lower() for k in keywords):
            return f
    raise FileNotFoundError(" / ".join(keywords))


pdf_filepath = find_pdf("심부전학회", "kshf")
loader = PyPDFLoader(pdf_filepath)
pages = loader.load()

with open(OUT_PATH, "w", encoding="utf-8") as fh:
    for i, page in enumerate(pages):
        fh.write(f"===== index {i} / label {page.metadata['page_label']} =====\n")
        fh.write(page.page_content)
        fh.write("\n\n")

print(f"{pdf_filepath} -> {OUT_PATH}")
print(f"pages: {len(pages)}, chars: {sum(len(p.page_content) for p in pages)}")
