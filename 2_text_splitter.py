"""PDF를 RecursiveCharacterTextSplitter로 청크 분할한다 (source/page 메타데이터 유지).

실행: .venv/bin/python 2_text_splitter.py
"""
import glob
import logging
import statistics
import unicodedata

from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter

logging.disable(logging.CRITICAL)  # pypdf의 fontTools 경고 억제


def find_pdf(keyword: str) -> str:
    # 파일명이 NFD로 저장돼 있어 한글 경로를 그대로 쓰면 못 찾는다 -> NFC로 정규화해 비교
    for f in glob.glob("*.pdf"):
        if keyword in unicodedata.normalize("NFC", f):
            return f
    raise FileNotFoundError(keyword)


pdf_filepath = find_pdf("심부전학회")
pages = PyPDFLoader(pdf_filepath).load()

text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=100,
    length_function=len,
)

# 단일 페이지 분할 (인쇄 72쪽 = 인덱스 95)
texts = text_splitter.split_text(pages[95].page_content)
print("page 72 chunks:", len(texts), [len(t) for t in texts])
print(texts[0])

# 전체 문서 분할
docs = text_splitter.split_documents(pages)
lens = [len(d.page_content) for d in docs]
print(f"\nALL chunks: {len(docs)} | min/median/max: {min(lens)} / {statistics.median(lens)} / {max(lens)}")
print(docs[0].metadata)
