"""FAISS + 한국어 임베딩(jhgan/ko-sbert-nli) 벡터스토어 Retriever 5종 + 검색 기반 답변 생성.

사전 준비: (생성 단계만) export OPENAI_API_KEY=sk-...
실행: .venv/bin/python src/5_retriever.py ["검색 질문"]
 - 검색 단계는 키 없이 동작(임베딩은 로컬 CPU). 키가 없으면 마지막 생성 단계는 건너뛴다.
"""
import glob
import logging
import os
import sys
import unicodedata
import warnings

warnings.filterwarnings("ignore")
logging.disable(logging.CRITICAL)  # pypdf/fontTools 등 경고 억제

from langchain_community.document_loaders import PyMuPDFLoader
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_community.vectorstores.utils import DistanceStrategy
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_text_splitters import RecursiveCharacterTextSplitter

query = sys.argv[1] if len(sys.argv) > 1 else "HFrEF 환자에서 베타차단제의 역할은?"


def find_pdf(keyword: str) -> str:
    # 파일명이 NFD로 저장돼 있어 한글 경로를 그대로 쓰면 못 찾는다 -> NFC로 정규화해 비교
    for f in glob.glob("*.pdf"):
        if keyword in unicodedata.normalize("NFC", f):
            return f
    raise FileNotFoundError(keyword)


def show(title, docs, idx=0):
    d = docs[idx]
    print(f"\n### {title}: {len(docs)}개 | page_index={d.metadata['page']}")
    print(d.page_content[:300].replace("\n", " "))


# ---------- 사전 준비 1: 문서 로드 -> 텍스트 분할 ----------
data = PyMuPDFLoader(find_pdf("심부전학회")).load()
text_splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
    chunk_size=1000,
    chunk_overlap=200,
    encoding_name="cl100k_base",
)
documents = [d for d in text_splitter.split_documents(data) if d.page_content.strip()]
print(f"pages: {len(data)} -> documents: {len(documents)}")

# ---------- 사전 준비 2: 임베딩 -> FAISS 저장 ----------
embeddings_model = HuggingFaceEmbeddings(
    model_name="jhgan/ko-sbert-nli",
    model_kwargs={"device": "cpu"},
    encode_kwargs={"normalize_embeddings": True},
)
vectorstore = FAISS.from_documents(
    documents,
    embedding=embeddings_model,
    distance_strategy=DistanceStrategy.COSINE,
)
print(f"query: {query}")

# ---------- 단일 문서 검색 ----------
retriever = vectorstore.as_retriever(search_kwargs={"k": 1})
show("similarity k=1", retriever.invoke(query))

# ---------- MMR (1): lambda_mult 기본값(0.5) ----------
retriever = vectorstore.as_retriever(search_type="mmr", search_kwargs={"k": 5, "fetch_k": 50})
show("MMR k=5, fetch_k=50", retriever.invoke(query))

# ---------- MMR (2): lambda_mult 작을수록 다양하게 ----------
retriever = vectorstore.as_retriever(search_type="mmr", search_kwargs={"k": 5, "lambda_mult": 0.15})
show("MMR k=5, lambda_mult=0.15 (마지막 문서)", retriever.invoke(query), idx=-1)

# ---------- 유사도 점수 임계값 ----------
retriever = vectorstore.as_retriever(
    search_type="similarity_score_threshold",
    search_kwargs={"score_threshold": 0.3},
)
show("score_threshold=0.3", retriever.invoke(query))

# ---------- 메타데이터 필터링 ----------
retriever = vectorstore.as_retriever(search_kwargs={"filter": {"format": documents[0].metadata["format"]}})
show(f"filter format={documents[0].metadata['format']}", retriever.invoke(query))

# ---------- Generation: 검색(MMR) -> 프롬프트 -> ChatOpenAI ----------
if not os.environ.get("OPENAI_API_KEY"):
    sys.exit("\nOPENAI_API_KEY 가 없어 답변 생성 단계는 건너뜁니다.")

from langchain_openai import ChatOpenAI

retriever = vectorstore.as_retriever(search_type="mmr", search_kwargs={"k": 5, "lambda_mult": 0.15})
docs = retriever.invoke(query)

template = """Answer the question based only on the following context:
{context}

Question: {question}
"""
prompt = ChatPromptTemplate.from_template(template)
llm = ChatOpenAI(model="gpt-4o-mini", temperature=0, max_tokens=500)


def format_docs(docs):
    return "\n\n".join([d.page_content for d in docs])


chain = prompt | llm | StrOutputParser()
response = chain.invoke({"context": format_docs(docs), "question": query})
print("\n### Generation")
print("근거 page_index:", [d.metadata["page"] for d in docs])
print(response)
