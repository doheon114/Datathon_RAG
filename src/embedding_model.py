"""로컬 임베딩 모델 (OpenAI API 키 불필요). HuggingFace 에서 내려받아 CPU/GPU 에서 직접 계산한다.

 - 기본 모델: BAAI/bge-m3 (한국어·영어 다국어, 1024차원, reranker 와 같은 BGE 계열). 처음 실행할 때 약 2.2GB 를 내려받는다.
 - 인덱스를 만든 모델(8_build_index.py)과 질의 모델(9_notebook_web.py)은 반드시 같아야 한다. 모델을 바꾸면 인덱스를 다시 만든다.
 - 환경변수 EMBEDDING_MODEL 로 다른 sentence-transformers 모델을 지정할 수 있다 (예: intfloat/multilingual-e5-large).
"""
import os

import torch
from langchain_huggingface import HuggingFaceEmbeddings

EMBEDDING_ID = os.environ.get("EMBEDDING_MODEL", "BAAI/bge-m3")


def load_embeddings(device: str | None = None, batch_size: int = 16) -> HuggingFaceEmbeddings:
    """정규화(코사인용)된 임베딩 모델을 돌려준다. device 를 주지 않으면 CUDA 가 있을 때 GPU, 없으면 CPU."""
    device = device or ("cuda" if torch.cuda.is_available() else "cpu")
    return HuggingFaceEmbeddings(
        model_name=EMBEDDING_ID,
        model_kwargs={"device": device},
        encode_kwargs={"normalize_embeddings": True, "batch_size": batch_size},
    )
