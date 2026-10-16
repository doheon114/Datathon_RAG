"""PDF를 토큰 기준으로 분할해 Chroma 벡터 저장소(./db/chromadb)에 저장하고 유사도 검색한다.

사전 준비: 없음 (API 키 불필요. 임베딩은 로컬 모델 BAAI/bge-m3)
실행: .venv/bin/python src/4_vectorstore.py ["검색 질문"] [--rebuild]
 - 저장소가 이미 있으면 임베딩을 다시 만들지 않고 불러온다. --rebuild 는 삭제 후 재생성.
 - 예전 OpenAI 임베딩(1536차원)으로 만든 저장소는 차원이 달라 못 쓰므로 --rebuild 로 다시 만든다.
"""
import glob
import logging
import os
import shutil
import sys
import unicodedata

from langchain_community.document_loaders import PyPDFLoader
from langchain_community.vectorstores import Chroma
from langchain_text_splitters import RecursiveCharacterTextSplitter

from embedding_model import EMBEDDING_ID, load_embeddings

logging.disable(logging.CRITICAL)  # pypdf의 fontTools 경고 억제

DB_DIR = "./db/chromadb"
COLLECTION = "heart_failure"
args = [a for a in sys.argv[1:] if not a.startswith("--")]
query = args[0] if args else "심부전 환자에서 사용하는 약물 치료"

embeddings_model = load_embeddings()
print(f"[embedding] {EMBEDDING_ID}")


def find_pdf(*keywords: str) -> str:
    """파일명에 keywords 중 하나가 들어간 PDF (대소문자 무시)."""
    # 파일명이 NFD로 저장돼 있어 한글 경로를 그대로 쓰면 못 찾는다 -> NFC로 정규화해 비교
    for f in glob.glob("*.pdf"):
        if any(k.lower() in unicodedata.normalize("NFC", f).lower() for k in keywords):
            return f
    raise FileNotFoundError(" / ".join(keywords))


if "--rebuild" in sys.argv and os.path.exists(DB_DIR):
    shutil.rmtree(DB_DIR)

if os.path.exists(DB_DIR):
    db = Chroma(
        collection_name=COLLECTION,
        embedding_function=embeddings_model,
        persist_directory=DB_DIR,
    )
    print(f"기존 저장소 로드: {DB_DIR} ({db._collection.count()}개)")
else:
    # 1. 데이터 로드 + 2. 토큰 기준 분할 (페이지 메타데이터 유지)
    pages = PyPDFLoader(find_pdf("심부전학회", "kshf")).load()
    text_splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
        chunk_size=250,
        chunk_overlap=50,
        encoding_name="cl100k_base",
    )
    docs = text_splitter.split_documents(pages)
    docs = [d for d in docs if d.page_content.strip()]
    print(f"chunks: {len(docs)}")

    # 3~4. 임베딩 + Chroma 저장 (코사인 유사도)
    db = Chroma.from_documents(
        docs,
        embeddings_model,
        collection_name=COLLECTION,
        persist_directory=DB_DIR,
        collection_metadata={"hnsw:space": "cosine"},  # l2 is the default
    )
    print(f"저장 완료: {DB_DIR} ({db._collection.count()}개)")

# 5. 유사도 기반 검색
print(f"\nquery: {query}")
docs = db.similarity_search(query)
print(docs[0].page_content, "\n")

for rank, (d, dist) in enumerate(db.similarity_search_with_score(query, k=3), 1):
    # cosine 거리 -> 유사도 = 1 - 거리
    print(f"[{rank}] sim={1 - dist:.4f} page_index={d.metadata['page']} page_label={d.metadata['page_label']}")
    print(d.page_content[:200].replace("\n", " "), "\n")
