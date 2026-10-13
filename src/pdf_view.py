"""원문 PDF 뷰어 지원: 쪽 이미지 렌더링 + 인용된 청크가 쪽 안 어디에 있는지(형광펜 영역) 찾기. (PyMuPDF)

9_notebook_web.py 가 사용한다. 모델/네트워크 없이 단독으로 테스트할 수 있다.
"""
import functools
import re
import threading

import pymupdf

_lock = threading.Lock()  # PyMuPDF 문서 객체는 스레드 안전하지 않다
_STRIP = re.compile(r"[\s\-­‐-―|*#]+")  # 공백, 하이픈, 마크다운 기호
ZOOM = 2.0


def norm(s: str) -> str:
    """정제된 청크 텍스트와 PDF 단어 스트림을 같은 기준으로 비교하기 위한 정규화."""
    return _STRIP.sub("", s).lower()


class PdfStore:
    def __init__(self, files: dict[str, str]):
        self.files = files  # {source_id: pdf 경로}
        self._docs: dict[str, pymupdf.Document] = {}
        self.render = functools.lru_cache(maxsize=96)(self._render)
        self._sizes: dict[str, list] = {}

    def _doc(self, sid: str) -> pymupdf.Document:
        if sid not in self._docs:
            self._docs[sid] = pymupdf.open(self.files[sid])
        return self._docs[sid]

    def total_pages(self, sid: str) -> int:
        with _lock:
            return len(self._doc(sid))

    def sizes(self, sid: str) -> list:
        """모든 쪽의 [너비, 높이] (pt). 연속 스크롤에서 이미지가 로드되기 전에 자리를 잡는 데 쓴다."""
        with _lock:
            if sid not in self._sizes:
                self._sizes[sid] = [[round(p.rect.width, 1), round(p.rect.height, 1)] for p in self._doc(sid)]
            return self._sizes[sid]

    def _render(self, sid: str, page_no: int) -> bytes:
        with _lock:
            page = self._doc(sid)[page_no - 1]
            return page.get_pixmap(matrix=pymupdf.Matrix(ZOOM, ZOOM), alpha=False).tobytes("png")

    def locate(self, sid: str, page_no: int, text: str, kind: str = "text", spans=None, rows=None) -> dict:
        """발췌문이 쪽의 어디인지 찾는다. 좌표는 PDF 좌표(pt).

        spans(본문: 문자 오프셋 쌍)나 rows(표: 행 번호, 0=머리글 행)를 주면 그 문장/행만 rects(형광펜)로 돌려준다.
        주지 않으면 rects 는 비어 있고, focus(스크롤 위치)만 발췌문의 첫 줄 위치로 채운다.
        """
        with _lock:
            page = self._doc(sid)[page_no - 1]
            tabs = _find_tables(page)
            trects = [pymupdf.Rect(t.bbox) for t in tabs]
            out = {"w": page.rect.width, "h": page.rect.height, "rects": [], "focus": None, "precise": False}

            whole = []  # 발췌문 전체 영역: 스크롤 위치 계산용
            if kind == "table":
                tab = _match_table(page, tabs, text)
                whole = [tuple(tab.bbox)] if tab is not None else []
                if rows and tab is not None:
                    out["rects"] = _locate_rows(page, tab, text, rows)
            else:
                whole = _locate_text(page, trects, text, skip_tables=True)
                for a, b in spans or []:
                    out["rects"] += _locate_text(page, trects, text[a:b], skip_tables=True)
            if kind == "table" and not whole:
                whole = _locate_text(page, trects, text, skip_tables=False)

            out["precise"] = bool(out["rects"])
            ys = [r[1] for r in (out["rects"] or whole)]
            out["focus"] = round(min(ys), 1) if ys else None
            out["rects"] = [[round(v, 1) for v in r] for r in out["rects"]]
            return out


def _find_tables(page):
    try:
        return list(page.find_tables().tables)
    except Exception:
        return []


def _match_table(page, tabs, md: str):
    """마크다운 표 청크 -> 셀 내용이 가장 많이 겹치는 표 (50% 미만이면 None)."""
    cells = _md_cells(md)
    best, best_score = None, 0.0
    for t in tabs:
        tx = norm(page.get_text("text", clip=pymupdf.Rect(t.bbox)))
        score = sum(c in tx for c in cells) / len(cells) if cells else 0
        if score > best_score:
            best, best_score = t, score
    return best if best_score >= 0.5 else None


def _md_lines(md: str):
    """표 청크의 '|' 행들 (구분선 제외). 0번 = 머리글 행."""
    return [ln for ln in md.splitlines() if ln.startswith("|") and not re.match(r"^\|(\s*:?-{3,}:?\s*\|)+\s*$", ln)]


def _md_cells(md: str):
    cells = [norm(c)[:14] for ln in _md_lines(md) for c in ln.strip("|").split("|")]
    return [c for c in cells if len(c) >= 3]


def _locate_rows(page, tab, md: str, row_idxs):
    """선택한 마크다운 행 -> 그 행의 셀 내용이 가장 많이 들어 있는 PDF 표 행의 영역."""
    lines, rects = _md_lines(md), []
    for i in row_idxs:
        if i >= len(lines):
            continue
        cells = [c for c in (norm(c)[:14] for c in lines[i].strip("|").split("|")) if len(c) >= 3]
        best, best_score = None, 0.0
        for row in tab.rows:
            tx = norm(page.get_text("text", clip=pymupdf.Rect(row.bbox)))
            score = sum(c in tx for c in cells) / len(cells) if cells else 0
            if score > best_score:
                best, best_score = row, score
        if best is not None and best_score >= 0.6:
            rects.append(tuple(best.bbox))
    return rects


def _locate_text(page, tables, text: str, skip_tables: bool):
    """청크의 처음/끝 일부를 쪽의 단어 스트림에서 찾아 그 사이 단어들을 줄 단위 영역으로 묶는다."""
    words = page.get_text("words")  # x0, y0, x1, y1, word, block, line, word_no
    stream, owner = [], []
    for i, w in enumerate(words):
        t = norm(w[4])
        stream.append(t)
        owner.extend([i] * len(t))
    s_all = "".join(stream)
    needle = norm(text)
    if len(needle) < 8 or not s_all:
        return []
    start = -1
    for k in (30, 20, 12, 8):
        start = s_all.find(needle[:k])
        if start >= 0:
            break
    if start < 0:
        return []
    end = -1
    for k in (30, 20, 12, 8):
        pos = s_all.find(needle[-k:], start)
        if pos >= 0:
            end = pos + k
            break
    if end < 0:
        end = min(len(s_all), start + len(needle))
    idxs = sorted(set(owner[start:end]))
    lines = {}
    for i in idxs:
        x0, y0, x1, y1 = words[i][:4]
        if skip_tables and any(pymupdf.Rect(x0, y0, x1, y1).get_area() and
                               (pymupdf.Rect(x0, y0, x1, y1) & t).get_area() > 0.5 * pymupdf.Rect(x0, y0, x1, y1).get_area()
                               for t in tables):
            continue
        key = (words[i][5], words[i][6])  # (block, line)
        r = lines.setdefault(key, [x0, y0, x1, y1])
        r[0], r[1], r[2], r[3] = min(r[0], x0), min(r[1], y0), max(r[2], x1), max(r[3], y1)
    pad = 1.5
    return [(r[0] - pad, r[1] - pad, r[2] + pad, r[3] + pad) for r in lines.values()]
