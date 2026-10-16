"""로컬 임베딩 모델(BAAI/bge-m3)로 (1) 튜토리얼 예제 임베딩/코사인 유사도, (2) PDF 청크 임베딩 + 유사도 검색.

사전 준비: 없음 (API 키 불필요. 처음 실행 시 임베딩 모델을 HuggingFace 에서 내려받는다)
실행: .venv/bin/python src/3_embedding.py ["검색 질문"]
산출물: chunk_embeddings.npy (청크 x 1024), chunks.json (청크 텍스트 + page 메타데이터)
"""
import glob
import json
import logging
import sys
import unicodedata

import numpy as np
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter

from embedding_model import EMBEDDING_ID, load_embeddings

logging.disable(logging.CRITICAL)  # pypdf의 fontTools 경고 억제

embeddings_model = load_embeddings()  # BAAI/bge-m3, 1024차원 (정규화됨)
print(f"[embedding] {EMBEDDING_ID}")


def cos_sim(A, B):
    return np.dot(A, B) / (np.linalg.norm(A) * np.linalg.norm(B))


def find_pdf(*keywords: str) -> str:
    """파일명에 keywords 중 하나가 들어간 PDF (대소문자 무시)."""
    # 파일명이 NFD로 저장돼 있어 한글 경로를 그대로 쓰면 못 찾는다 -> NFC로 정규화해 비교
    for f in glob.glob("*.pdf"):
        if any(k.lower() in unicodedata.normalize("NFC", f).lower() for k in keywords):
            return f
    raise FileNotFoundError(" / ".join(keywords))


# ---------- 1. 튜토리얼 예제: 문장 5개 + 질의 코사인 유사도 ----------
sentences = ["안녕하세요!", "어! 오랜만이에요", "이름이 어떻게 되세요?", "날씨가 추워요", "Hello LLM!"]
embeddings = embeddings_model.embed_documents(sentences)
print("demo:", len(embeddings), len(embeddings[0]))
print(embeddings[0][:20])

embedded_query = embeddings_model.embed_query("첫인사를 하고 이름을 물어봤나요?")
print(embedded_query[:5])
for s, e in zip(sentences, embeddings):
    print(f"{cos_sim(e, embedded_query):.4f}  {s}")

# ---------- 2. PDF 청크 임베딩 ----------
pdf_filepath = find_pdf("심부전학회", "kshf")
pages = PyPDFLoader(pdf_filepath).load()
text_splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=100, length_function=len)
docs = text_splitter.split_documents(pages)
print(f"\nchunks: {len(docs)}")

chunk_vecs = np.array(embeddings_model.embed_documents([d.page_content for d in docs]), dtype=np.float32)
np.save("chunk_embeddings.npy", chunk_vecs)
with open("chunks.json", "w", encoding="utf-8") as fh:
    json.dump(
        [{"text": d.page_content, "page": d.metadata["page"], "page_label": d.metadata["page_label"]} for d in docs],
        fh,
        ensure_ascii=False,
    )
print("embeddings:", chunk_vecs.shape, "-> chunk_embeddings.npy, chunks.json")

# ---------- 3. 유사도 검색 (top-3) ----------
query = sys.argv[1] if len(sys.argv) > 1 else "심부전 환자에서 사용하는 약물 치료"
q = np.array(embeddings_model.embed_query(query), dtype=np.float32)
sims = (chunk_vecs @ q) / (np.linalg.norm(chunk_vecs, axis=1) * np.linalg.norm(q))
print(f"\nquery: {query}")
for rank, i in enumerate(np.argsort(-sims)[:3], 1):
    print(f"[{rank}] sim={sims[i]:.4f} page_index={docs[i].metadata['page']}")
    print(docs[i].page_content[:200].replace("\n", " "), "\n")
