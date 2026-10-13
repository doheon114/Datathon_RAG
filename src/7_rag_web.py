"""RAG 데모 웹사이트 (FastAPI). Baseline vs Enhanced(rerank + reorder + 출처 인용) 답변을 나란히 비교한다.

사전 준비: 4_vectorstore.py 로 ./db/chromadb 생성, export OPENAI_API_KEY=sk-... (쿼리 임베딩에만 사용, LLM 은 로컬)
실행: CUDA_VISIBLE_DEVICES=1 .venv/bin/python src/7_rag_web.py [--port 8800] [--model Qwen/Qwen3-14B] [--public]
 - --public: 외부 공개용 보호 (IP당 10분에 12회 제한, 대기열 6개 제한, 원문 PDF 다운로드 /pdf 비활성화)
접속: http://<서버>:8800
"""
import glob
import logging
import os
import sys
import threading
import time
from collections import defaultdict, deque
import unicodedata
import warnings
from typing import Any

warnings.filterwarnings("ignore")
logging.disable(logging.CRITICAL)

import torch
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from langchain_classic.retrievers import ContextualCompressionRetriever
from langchain_classic.retrievers.document_compressors import CrossEncoderReranker, LLMChainExtractor
from langchain_community.cross_encoders import HuggingFaceCrossEncoder
from langchain_community.document_transformers import LongContextReorder
from langchain_community.vectorstores import Chroma
from langchain_core.language_models.chat_models import SimpleChatModel
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import OpenAIEmbeddings
from pydantic import BaseModel, Field
from transformers import AutoModelForCausalLM, AutoTokenizer

if not os.environ.get("OPENAI_API_KEY"):
    sys.exit("OPENAI_API_KEY 환경변수가 없습니다 (Chroma 쿼리 임베딩용). export OPENAI_API_KEY=sk-... 후 다시 실행하세요.")

argv = sys.argv[1:]
PORT = int(argv[argv.index("--port") + 1]) if "--port" in argv else 8800
MODEL_ID = argv[argv.index("--model") + 1] if "--model" in argv else "Qwen/Qwen3-14B"
PUBLIC = "--public" in argv
RATE_LIMIT, RATE_WINDOW, MAX_QUEUE = 12, 600, 6  # --public: IP당 600초에 12회, 대기 6개 초과 시 거절
RERANKER_ID = "BAAI/bge-reranker-v2-m3"
SOURCE_NAME = "2022 심부전 진료지침"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 프로젝트 루트(src/ 의 상위)


def find_pdf(keyword: str) -> str:
    # 파일명이 NFD로 저장돼 있어 한글 경로를 그대로 쓰면 못 찾는다 -> NFC로 정규화해 비교
    for f in glob.glob(os.path.join(ROOT, "*.pdf")):
        if keyword in unicodedata.normalize("NFC", f):
            return f
    raise FileNotFoundError(keyword)


# ---------- 로컬 LLM (HF transformers) 을 LangChain ChatModel 로 감싸기 ----------
class LocalChat(SimpleChatModel):
    model: Any = None
    tokenizer: Any = None
    max_new_tokens: int = 700

    @property
    def _llm_type(self) -> str:
        return "local-hf-chat"

    def _call(self, messages, stop=None, run_manager=None, **kwargs) -> str:
        role = {"human": "user", "system": "system", "ai": "assistant"}
        chat = [{"role": role[m.type], "content": m.content} for m in messages]
        text = self.tokenizer.apply_chat_template(
            chat, tokenize=False, add_generation_prompt=True, enable_thinking=False
        )
        inputs = self.tokenizer(text, return_tensors="pt").to(self.model.device)
        with torch.no_grad():
            out = self.model.generate(
                **inputs, max_new_tokens=self.max_new_tokens, do_sample=False,
                temperature=None, top_p=None, top_k=None,
            )
        return self.tokenizer.decode(out[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True).strip()


print(f"[load] LLM {MODEL_ID} / reranker {RERANKER_ID}", flush=True)
tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
model = AutoModelForCausalLM.from_pretrained(MODEL_ID, dtype=torch.bfloat16, device_map="cuda").eval()
llm = LocalChat(model=model, tokenizer=tokenizer)

embeddings = OpenAIEmbeddings(model="text-embedding-3-small")
vectorstore = Chroma(collection_name="heart_failure", embedding_function=embeddings, persist_directory="./db/chromadb")
N_CHUNKS = vectorstore._collection.count()

base_retriever = vectorstore.as_retriever(search_kwargs={"k": 20})
cross_encoder = HuggingFaceCrossEncoder(model_name=RERANKER_ID, model_kwargs={"device": "cuda"})
reranker = CrossEncoderReranker(model=cross_encoder, top_n=5)
compression_retriever = ContextualCompressionRetriever(base_compressor=reranker, base_retriever=base_retriever)
reordering = LongContextReorder()
compressor = LLMChainExtractor.from_llm(llm)

BASIC_PROMPT = ChatPromptTemplate.from_template("""다음 컨텍스트를 참고하여 질문에 답변하세요.

## 컨텍스트
{context}

## 질문
{question}

## 답변
""")

ENHANCED_RAG_PROMPT = ChatPromptTemplate.from_template("""당신은 주어진 컨텍스트를 기반으로 정확한 정보를 제공하는 AI 어시스턴트입니다.

## 검색된 문서 (가장 관련 높은 문서가 처음과 끝에 배치됨)
{context}

## 응답 규칙
1. **정확성**: 컨텍스트에 명시된 정보만 사용하세요.
2. **출처 인용**: 답변에 사용한 정보의 출처를 [출처: 문서명, PDF p.쪽번호] 형식으로 표시하세요.
3. **불확실성 표현**: 정보가 불완전하면 "~로 추정됩니다" 등으로 표현하세요.
4. **없는 정보**: 컨텍스트에 없는 정보는 "제공된 문서에서 해당 정보를 찾을 수 없습니다"라고 명시하세요.

## 사용자 질문
{question}

위 규칙을 따라 답변하세요:
""")


def format_docs(docs):
    return "\n\n".join(d.page_content for d in docs)


def format_docs_with_metadata(docs):
    # page_label 은 이 PDF 에서 인쇄 번호와 달라 쓰지 않고, PDF 뷰어 기준 쪽번호(page+1)를 쓴다
    return "\n---\n".join(
        f"[문서 {i}]\n출처: {SOURCE_NAME}, PDF p.{d.metadata.get('page', -1) + 1}\n내용: {d.page_content}\n"
        for i, d in enumerate(docs, 1)
    )


# ---------- API ----------
app = FastAPI(title="Heart Failure Guideline RAG")
gpu_lock = threading.Lock()  # LLM/reranker 는 한 번에 한 요청만
state_lock = threading.Lock()
hits = defaultdict(deque)
queued = 0


def client_ip(request: Request) -> str:
    # 터널(cloudflared)은 127.0.0.1 로 접속하므로 이 경우에만 CF-Connecting-IP 를 신뢰한다
    host = request.client.host if request.client else "?"
    if host in ("127.0.0.1", "::1"):
        return request.headers.get("cf-connecting-ip", host)
    return host


def check_rate_limit(ip: str):
    now = time.time()
    with state_lock:
        q = hits[ip]
        while q and now - q[0] > RATE_WINDOW:
            q.popleft()
        if len(q) >= RATE_LIMIT:
            raise HTTPException(429, f"요청이 너무 많습니다. {int(RATE_WINDOW - (now - q[0])) + 1}초 후 다시 시도해 주세요.")
        q.append(now)


class AskRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    mode: str = Field(pattern="^(baseline|enhanced)$")
    compress: bool = False


@app.get("/", response_class=HTMLResponse)
def index():
    with open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8") as fh:
        return fh.read()


@app.get("/pdf")
def pdf():
    if PUBLIC:
        raise HTTPException(404, "공개 모드에서는 원문 PDF를 제공하지 않습니다.")
    return FileResponse(find_pdf("심부전학회"), media_type="application/pdf")


@app.get("/api/info")
def info():
    return {"llm": MODEL_ID, "reranker": RERANKER_ID, "chunks": N_CHUNKS, "gpu": torch.cuda.get_device_name(0), "pdf": not PUBLIC}


@app.post("/api/ask")
def ask(req: AskRequest, request: Request):
    global queued
    q = req.query.strip()
    if not q:
        raise HTTPException(400, "질문이 비어 있습니다.")
    if PUBLIC:
        check_rate_limit(client_ip(request))
        with state_lock:
            if queued >= MAX_QUEUE:
                raise HTTPException(503, "대기열이 가득 찼습니다. 잠시 후 다시 시도해 주세요.")
            queued += 1
    try:
        return _answer(req, q)
    finally:
        if PUBLIC:
            with state_lock:
                queued -= 1


def _answer(req: AskRequest, q: str):
    with gpu_lock:
        t0 = time.time()
        if req.mode == "baseline":
            docs = vectorstore.similarity_search(q, k=5)
            prompt, formatter = BASIC_PROMPT, format_docs
        else:
            docs = reordering.transform_documents(compression_retriever.invoke(q))
            if req.compress:
                docs = compressor.compress_documents(documents=docs, query=q)
            prompt, formatter = ENHANCED_RAG_PROMPT, format_docs_with_metadata
        context = formatter(docs)
        answer = (prompt | llm | StrOutputParser()).invoke({"context": context, "question": q})
        elapsed = time.time() - t0
    return {
        "mode": req.mode,
        "answer": answer,
        "seconds": round(elapsed, 1),
        "context_chars": len(context),
        "docs": [{"position": i, "page": d.metadata.get("page", -1) + 1, "text": d.page_content} for i, d in enumerate(docs, 1)],
    }


if __name__ == "__main__":
    print(f"[serve] http://0.0.0.0:{PORT}", flush=True)
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")
