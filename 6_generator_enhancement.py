"""Generator Enhancement: Reranker + LongContextReorder + (선택) 컨텍스트 압축 + 강화 프롬프트, 로컬 LLM.

비교: baseline(유사도 top-5 + 기본 프롬프트) vs enhanced(k=20 -> rerank top-5 -> LongContextReorder + 출처 인용 프롬프트)

사전 준비: 4_vectorstore.py 로 ./db/chromadb 생성, export OPENAI_API_KEY=sk-... (쿼리 임베딩에만 사용, LLM 은 로컬)
실행: CUDA_VISIBLE_DEVICES=1 .venv/bin/python 6_generator_enhancement.py ["질문"] [--compress] [--model Qwen/Qwen3-8B]
"""
import logging
import os
import sys
import time
import warnings
from typing import Any

warnings.filterwarnings("ignore")
logging.disable(logging.CRITICAL)

import torch
from langchain_classic.retrievers import ContextualCompressionRetriever
from langchain_classic.retrievers.document_compressors import CrossEncoderReranker, LLMChainExtractor
from langchain_community.cross_encoders import HuggingFaceCrossEncoder
from langchain_community.document_transformers import LongContextReorder
from langchain_community.vectorstores import Chroma
from langchain_core.language_models.chat_models import SimpleChatModel
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import OpenAIEmbeddings
from transformers import AutoModelForCausalLM, AutoTokenizer

if not os.environ.get("OPENAI_API_KEY"):
    sys.exit("OPENAI_API_KEY 환경변수가 없습니다 (Chroma 쿼리 임베딩용). export OPENAI_API_KEY=sk-... 후 다시 실행하세요.")

argv = sys.argv[1:]
MODEL_ID = argv[argv.index("--model") + 1] if "--model" in argv else "Qwen/Qwen3-14B"
COMPRESS = "--compress" in argv
positional = [a for i, a in enumerate(argv) if not a.startswith("--") and (i == 0 or argv[i - 1] != "--model")]
query = positional[0] if positional else "HFrEF 환자에서 베타차단제의 역할은?"
RERANKER_ID = "BAAI/bge-reranker-v2-m3"  # 다국어(한국어) 지원 cross-encoder
SOURCE_NAME = "2022 심부전 진료지침"


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
        # Qwen3 는 thinking 을 끈다 (다른 모델 템플릿은 이 인자를 무시)
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


print(f"[load] LLM {MODEL_ID} / reranker {RERANKER_ID}")
tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
model = AutoModelForCausalLM.from_pretrained(MODEL_ID, dtype=torch.bfloat16, device_map="cuda").eval()
llm = LocalChat(model=model, tokenizer=tokenizer)

# ---------- 벡터스토어 / Retriever ----------
embeddings = OpenAIEmbeddings(model="text-embedding-3-small")
vectorstore = Chroma(collection_name="heart_failure", embedding_function=embeddings, persist_directory="./db/chromadb")

# 검색은 넉넉하게(recall) -> Reranker 로 상위 5개만(precision)
base_retriever = vectorstore.as_retriever(search_kwargs={"k": 20})
cross_encoder = HuggingFaceCrossEncoder(model_name=RERANKER_ID, model_kwargs={"device": "cuda"})
reranker = CrossEncoderReranker(model=cross_encoder, top_n=5)
compression_retriever = ContextualCompressionRetriever(base_compressor=reranker, base_retriever=base_retriever)

# Lost in the Middle: 관련성 높은 문서를 컨텍스트의 처음/끝에 배치 ([1,2,3,4,5] -> [1,3,5,4,2])
reordering = LongContextReorder()


def retrieve_and_reorder(q: str):
    docs = compression_retriever.invoke(q)  # 관련성 내림차순 top-5
    return reordering.transform_documents(docs)


# ---------- 프롬프트 ----------
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


def run(title, prompt, docs, formatter):
    t0 = time.time()
    chain = prompt | llm | StrOutputParser()
    answer = chain.invoke({"context": formatter(docs), "question": query})
    ctx_chars = len(formatter(docs))
    print(f"\n{'=' * 20} {title} {'=' * 20}")
    print(f"문서 순서(PDF p.): {[d.metadata.get('page', -1) + 1 for d in docs]} | 컨텍스트 {ctx_chars}자 | {time.time() - t0:.1f}s")
    print(answer)


print(f"\nquery: {query}")

# baseline: 유사도 top-5, 기본 프롬프트
run("BASELINE (similarity top-5 + 기본 프롬프트)", BASIC_PROMPT, vectorstore.similarity_search(query, k=5), format_docs)

# enhanced: rerank + reorder + (선택) 압축 + 강화 프롬프트
enhanced_docs = retrieve_and_reorder(query)
if COMPRESS:
    # 쿼리와 관련된 부분만 추출 (문서마다 LLM 호출)
    compressor = LLMChainExtractor.from_llm(llm)
    enhanced_docs = compressor.compress_documents(documents=enhanced_docs, query=query)
run("ENHANCED (rerank + reorder" + (" + compress" if COMPRESS else "") + " + 강화 프롬프트)",
    ENHANCED_RAG_PROMPT, enhanced_docs, format_docs_with_metadata)
