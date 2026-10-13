"""NotebookLM 스타일 '자료 기반 답변' 웹앱 (FastAPI + 스트리밍).

 - 선택한 자료(PDF)에서만 검색하고, 발췌문 번호 [n] 인용이 달린 답변만 만든다. 근거가 없으면 답을 거절한다.
 - 검색: 의미 검색(Chroma) + 키워드(BM25) -> RRF 결합 -> Cross-encoder Reranker -> 상위 6개 발췌문 (전문 표시)
 - 자료 우선순위: ESC 2026 > 대한심부전학회(KSHF) 2022 > AHA/ACC/HFSA 2022. 자료별로 후보를 따로 뽑아 순위에 반영하고,
   발췌문 번호는 우선순위(자료 순서) → 관련도 순으로 매긴다. 프롬프트도 같은 우선순위로 인용하도록 지시한다.
 - 거절: Reranker 최고 점수가 REFUSE_BELOW 미만이면 LLM 을 호출하지 않고 "자료에서 찾을 수 없음"으로 응답
 - 생성: 로컬 LLM(Qwen3-14B, thinking 끔) 토큰 스트리밍
 - 형광펜: 답변의 각 주장과 가장 잘 맞는 발췌문 문장(표는 행)만 골라(evidence.py) 근거 패널·원문 뷰어에 표시

사전 준비: 8_build_index.py 로 ./db/chromadb 의 'notebook' 컬렉션과 ./db/pages.json 생성, export OPENAI_API_KEY=sk-... (질의 임베딩 전용)
실행: CUDA_VISIBLE_DEVICES=1 .venv/bin/python src/9_notebook_web.py [--port 8800] [--model Qwen/Qwen3-14B] [--public]
 - --public: 외부 공개용 보호 (질문 IP당 10분에 12회, 대기열 6개, 원문 쪽 조회 500회 제한)
 - --no-viewer: 원문 PDF 뷰어(/api/pdfpage, /api/locate) 끄기
 - emr/dist 가 있으면 병원 EMR 시연 화면을 /emr 로 함께 서빙한다 (emr/ 에서 npm run build)
   EMR 로그인: 비밀번호는 환경변수 EMR_PASSWORD (없으면 실행할 때마다 임시 비밀번호를 만들어 콘솔에 출력). 로그인 세션 쿠키가 없으면 /emr/hf/ (환자 데이터) 는 401.
"""
import hashlib
import hmac
import json
import logging
import os
import queue
import re
import secrets
import sys
import threading
import time
import warnings
from collections import defaultdict, deque

warnings.filterwarnings("ignore")
logging.disable(logging.CRITICAL)

import numpy as np
import torch
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from langchain_community.vectorstores import Chroma
from langchain_openai import OpenAIEmbeddings
from evidence import select_evidence, split_units
from pdf_view import PdfStore
from pydantic import BaseModel, Field
from rank_bm25 import BM25Okapi
from sentence_transformers import CrossEncoder
from transformers import (AutoModelForCausalLM, AutoTokenizer, StoppingCriteria, StoppingCriteriaList,
                          TextIteratorStreamer)

if not os.environ.get("OPENAI_API_KEY"):
    sys.exit("OPENAI_API_KEY 환경변수가 없습니다 (Chroma 질의 임베딩용). export OPENAI_API_KEY=sk-... 후 다시 실행하세요.")

argv = sys.argv[1:]
PORT = int(argv[argv.index("--port") + 1]) if "--port" in argv else 8800
MODEL_ID = argv[argv.index("--model") + 1] if "--model" in argv else "Qwen/Qwen3-14B"
PUBLIC = "--public" in argv
VIEWER = "--no-viewer" not in argv
VIEW_LIMIT = 500  # --public: IP당 600초에 쪽 이미지/위치 조회 횟수 (스크롤하면 쪽마다 1회)
RERANKER_ID = "BAAI/bge-reranker-v2-m3"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 프로젝트 루트(src/ 의 상위)
POOL, TOP_K = 30, 6  # 후보 수(의미/키워드 각각), 최종 발췌문 수
# 자료 우선순위(작을수록 우선) 와 재순위 점수(logit)에 더하는 가산점. 관련도가 비슷하면 우선순위 높은 자료가 앞선다.
SOURCE_PRIORITY = {"esc2026": 1, "ksh2022": 2, "aha2022": 3}
SOURCE_BONUS = {"esc2026": 1.5, "ksh2022": 0.75, "aha2022": 0.0}
SOURCE_QUOTA = {"esc2026": 2, "ksh2022": 2, "aha2022": 1}  # 자료별 우선 배정 자리 수 (TOP_K 안에서)
QUOTA_MIN_PROB = 0.3  # 이 관련도(0~1) 이상일 때만 우선 배정
PER_SOURCE = 10  # 자료마다 의미/키워드 후보를 따로 뽑아 언어(한국어 질문 → 한국어 자료) 편향으로 다른 자료가 밀리지 않게 한다
REFUSE_BELOW = 0.10  # Reranker 최고 점수가 이보다 낮으면 자료에 근거 없음으로 간주
MAX_NEW_TOKENS = 900
RATE_LIMIT, RATE_WINDOW, MAX_QUEUE = 12, 600, 6  # --public: IP당 600초에 12회, 대기 6개 초과 시 거절
REFUSAL = "제공된 자료에서 해당 내용을 찾을 수 없습니다."
# 환자 정보 없이 "이 환자 …" 를 물으면 자료 부족이 아니라 환자 정보 부족이므로, 거절과 함께 이유를 알려 준다
PATIENT_WORDS = re.compile(r"(이|해당|본|그|저)\s*환자|환자(에게|에서|는|가|의)\s|이\s*(경우|케이스|증례)")
THIS_PATIENT = re.compile(r"(이|해당|본|그|저|우리)\s*환자|이\s*(경우|케이스|증례)")  # 이 환자를 가리키는 말만 (일반 "어떤 환자에게"는 제외)
NO_PATIENT_HINT = ("환자 정보가 함께 전달되지 않아 '이 환자'에 대한 판단은 할 수 없습니다. 환자 임상 요약을 질문에 포함해 다시 물어보거나, "
                   "일반적인 지침 내용으로 질문해 주세요 (예: '급성 심부전에서 이뇨제는 언제 사용하나요?').")


# 약 이름은 지침에 계열명(한국어/영어)으로 적혀 있어 그대로 검색하면 잘 안 잡힌다 → 계열 용어를 질의에 덧붙인다
TERM_EXPANSIONS = [
    (r"furosemide|lasix|푸로세미드|라식스", "고리이뇨제 loop diuretic 이뇨제 furosemide"),
    (r"torasemide|torsemide|bumetanide|토라세미드|부메타나이드", "고리이뇨제 loop diuretic torasemide bumetanide"),
    (r"thiazide|hydrochlorothiazide|hctz|indapamide|metolazone|티아지드", "티아지드계 이뇨제 thiazide metolazone 이뇨제 저항"),
    (r"spironolactone|eplerenone|finerenone|\bMRA\b|스피로노락톤", "미네랄로코르티코이드 수용체 길항제 MRA spironolactone eplerenone 칼륨"),
    (r"sacubitril|entresto|\bARNI\b|사쿠비트릴", "ARNI sacubitril/valsartan 안지오텐신 수용체-네프릴리신 억제제"),
    (r"\bACEI?\b|enalapril|ramipril|captopril|lisinopril|\bARB\b|losartan|valsartan|candesartan", "안지오텐신전환효소억제제 ACE inhibitor 안지오텐신수용체차단제 ARB"),
    (r"carvedilol|bisoprolol|metoprolol|nebivolol|beta.?blocker|베타차단제", "베타차단제 beta-blocker carvedilol bisoprolol metoprolol"),
    (r"dapagliflozin|empagliflozin|sglt2|canagliflozin", "SGLT2 억제제 SGLT2 inhibitor dapagliflozin empagliflozin"),
    (r"digoxin|디곡신", "디곡신 digoxin 심박수 조절"),
    (r"ivabradine|이바브라딘", "ivabradine 이바브라딘 심박수"),
    (r"amiodarone|아미오다론", "amiodarone 항부정맥 심방세동"),
    (r"apixaban|rivaroxaban|edoxaban|dabigatran|warfarin|\bNOAC\b|\bDOAC\b", "경구 항응고제 NOAC 심방세동 anticoagulant"),
    (r"dobutamine|dopamine|milrinone|norepinephrine|inotrope|강심제", "inotrope vasopressor 강심제 심원성 쇼크"),
]


def expand_terms(text: str) -> str:
    add = [exp for pat, exp in TERM_EXPANSIONS if re.search(pat, text, re.I)]
    return " ".join(add)


def hint_for(query: str, context: str) -> str:
    return NO_PATIENT_HINT if not context.strip() and PATIENT_WORDS.search(query) else ""

SYSTEM_PROMPT = f"""당신은 사용자가 제공한 자료(소스)만을 근거로 답하는 리서치 어시스턴트입니다. 자료는 [번호]가 붙은 발췌문입니다.

규칙
1. 오직 발췌문에 적힌 내용만 사용합니다. 배경지식, 추측, 일반 상식으로 보충하지 않습니다.
2. 모든 사실 문장 끝에 근거가 된 발췌문 번호를 [1] 형식으로 붙입니다. 여러 개면 [1][3]처럼 이어 씁니다. 번호는 반드시 대괄호로 씁니다(예: …권고한다. [1]). 1, ¹, (1) 형태는 쓰지 않습니다. 번호가 없는 지침 문장은 쓰지 않습니다.
3. 발췌문에 질문의 답이 없거나 불충분하면 아는 내용을 덧붙이지 말고 "{REFUSAL}"라고만 답합니다. 일부만 답할 수 있으면 확인되는 부분만 답하고, 나머지는 자료에 없다고 밝힙니다.
4. 자료 우선순위는 ① 2026 ESC → ② 대한심부전학회(KSHF) 2022 → ③ 2022 AHA/ACC/HFSA 입니다(발췌문 번호도 이 순서로 매겨져 있습니다). 같은 주제가 여러 자료에 있으면 우선순위가 높은 자료의 내용을 중심으로 쓰고 그 번호를 먼저 인용합니다. 낮은 우선순위 자료는 보완 정보이거나 내용이 다를 때만 덧붙이고, 다를 때는 우선순위가 높은 자료를 기준으로 쓰되 차이를 자료명과 함께 짧게 밝힙니다.
5. 권고 등급(Class, Level of Evidence)과 수치·용량·약어는 발췌문 그대로 정확히 옮깁니다. 영어 자료는 한국어로 옮겨 설명하되 약어와 고유명사는 원문을 유지합니다.
6. 발췌문이 표(| 로 구분된 마크다운)이면 같은 행의 항목끼리만 연결해 읽습니다. 열 제목(예: Class, Level, 용량)과 값이 어긋나지 않게 옮깁니다.
7. 질문과 같은 언어(한국어)로 간결하게, 필요하면 글머리 기호로 정리하고, 사용자가 표를 요청한 경우에만 마크다운 표를 씁니다(표의 각 행 끝에도 근거 번호 [n]을 붙입니다). 서론이나 맺음말 없이 답만 씁니다."""

# 환자 정보가 함께 올 때만 덧붙이는 규칙 (없을 때의 동작은 그대로 둔다)
CONTEXT_RULES = """
0. [최우선] 사용자 메시지의 "## 사용자 요청"이 가장 중요한 지시입니다. 환자 정보와 자료 발췌문은 그 요청에 답하기 위한 참고 자료일 뿐입니다. 요청에 들어 있는 모든 질문·지시를 빠짐없이, 사용자가 쓴 순서와 표현에 맞춰 답하고, 요청하지 않은 내용(묻지 않은 퇴원 후 추적, 다른 약물의 권고 등)은 쓰지 않습니다. 사용자가 범위를 제한하면("~만", "간단히") 그 범위를 넘지 않습니다.
8. 환자 정보가 함께 올 때:
   - 환자 정보는 근거 자료가 아니라 사용자가 알려 준 사실입니다. 환자 정보의 사실에는 번호를 붙이지 않습니다. 환자 정보는 "환자 정보"(요약)와 "환자 기록에서 찾은 내용"(질문과 관련해 전체 진료기록에서 검색한 원문)으로 오며, 구체적인 날짜·수치·투약 내용은 후자를 우선 확인합니다.
   - 환자 정보의 [섹션 이름]이나 기록 태그를 대괄호로 인용하지 않습니다. 대괄호 번호는 지침 발췌문 번호([1] 등)에만 씁니다.
   - 환자 기록 자체를 묻는 질문(수치, 추이, 날짜, 투약 여부, 진단 등)은 환자 정보만 사용해 질문에 직접 답하고, 날짜·수치는 기록에 있는 그대로 인용합니다. 지침 판단을 요구하지 않았으면 지침 내용을 섞지 않습니다. 환자 정보에서 찾을 수 없으면 "환자 기록에서 찾을 수 없습니다"라고 씁니다.
   - 환자 정보에 없는 사실을 만들거나 추정하지 않습니다. 지침이 요구하는 조건(예: 울혈 징후, 칼륨 수치)이 환자 정보에 없으면 "(환자 정보에 없음)"이라고 쓰고, 그 조건이 충족됐다고 가정하지 않습니다. "~한 기록이 없다/복용하지 않았다"도 환자 정보에 그렇게 명시된 경우에만 씁니다. 약의 투여 기록이 없으면 "환자 정보에 투여 기록 없음"이라고만 씁니다. 환자 정보에 있는 사실에는 이 표기를 쓰지 않습니다.
   - 치료·검사·약이 적절한지 묻는 요청이면 아래 틀로만 답합니다(소제목 없음, 틀 밖의 문장 없음, 결론 앞에 지침 설명 금지).
     결론: (한 문장. "적절합니다" / "주의가 필요합니다" / "적절하지 않습니다" / "환자 정보만으로는 판단하기 어렵습니다" 중 하나로 시작)
     - 지침: (발췌문의 권고·용량·시기·주의·금기만. 문장 끝에 [n] 필수. 환자 정보는 쓰지 않음)
     - 이 환자: ("이 환자는 …"으로 시작. 지침의 조건을 환자 정보의 사실과 하나씩 대조. [n] 쓰지 않음)
     투여 유무까지 함께 묻는 요청("처치 유무, 이러한 처치가 적절했나")이면 "결론:" 첫 문장에 먼저 투여 여부("투여 기록 있음(시작일·용량)" 또는 "투여 기록 없음")를 밝힌 뒤, 투여했으면 시기·용량의 적절성을, 투여하지 않았으면 투여가 필요한 상황이었는지를 판단해 한 문장으로 잇습니다.
     시기와 용량을 묻는 요청이면 "지침:"에는 권고 시기·용량을, "이 환자:"에는 환자 정보의 투여 시작일(입원일 대비)·용량·기간·체액 상태를 적어 각각 비교합니다. 판단에 필요한 조건이 환자 정보에 없으면 결론을 "환자 정보만으로는 판단하기 어렵습니다"로 쓰고 무엇이 없는지 적습니다. 질문과 직접 관련 없는 권고는 쓰지 않습니다.
   - 약 투여의 적절성은 다음 순서로 정해, 결론 문장에 판단 어휘를 반드시 씁니다(투여 여부만 쓰고 끝내지 않음).
     ① 지침이 그 약을 쓰라고 하는 조건(예: 울혈·체액과다 소견)을 환자 정보의 [신체진찰·체액상태]·검사·영상에서 확인: 있음 / 없음으로 명시됨(예: 정상체액, 울혈 징후 없음) / 기록 없음. 심부전 같은 진단명만으로는 조건이 충족된 것으로 보지 않습니다.
     ② 환자 정보의 약물 목록에서 그 약의 투여 여부 확인(약품명이 확인되지 않는 투약 기록이 있으면 그 점을 한 마디 덧붙임).
     ③ 결론: 조건 있음+투여함 → 시기·용량을 지침과 비교해 "적절합니다" 또는 "주의가 필요합니다". 조건 있음+투여 기록 없음 → "적절하지 않습니다(필요했으나 투여 기록 없음)". 조건 없음으로 명시됨+투여함 → "주의가 필요합니다(투여 조건인 소견이 없는데 투여됨)"이며 "적절합니다"라고 쓰지 않습니다. 조건 없음+투여 안 함 → "적절합니다(투여 조건 없음, 투여 기록 없음)". 조건이 기록에 없음 → "환자 정보만으로는 판단하기 어렵습니다".
     예시(약 X, 투여 조건 = 소견 Y):
       · Y 있음 + X 투여함 → "결론: 적절합니다(Y가 있고 X가 투여됨, 용량·시기도 지침 범위)"
       · Y 있음 + X 투여 기록 없음 → "결론: 적절하지 않습니다(Y가 있으나 X 투여 기록 없음)"
       · Y 없음(정상으로 명시) + X 투여함 → "결론: 주의가 필요합니다(Y가 없는데 X가 투여됨)"
       · Y 없음(정상으로 명시) + X 투여 기록 없음 → "결론: 적절합니다(Y가 없어 X가 필요하지 않았고 투여 기록도 없음)". 이때 "필요했으나"라고 쓰지 않습니다.
     "이 환자:" 줄이 "조건 없음"이라고 쓰면 결론도 그와 일치해야 합니다. "결론:" 줄에는 [n]을 쓰지 않습니다.
   - 환자 정보의 진단명·기록은 그대로 인정합니다. 검사 수치 하나만 보고 진단명을 부정하거나("~이 아니다") 정상이라고 단정하지 않고, 수치는 있는 그대로 인용합니다.
   - 사용자가 "~만", "하나만", "간단히"라고 범위를 제한하면 두세 문장 이내(결론 + 핵심 근거 한두 개)로 끝냅니다. 이때는 "지침:"·"이 환자:" 구분 없이 쓰되, 지침 내용에만 [n]을 붙입니다.
   - 경과·상태를 요약해 달라는 요청이면: 환자 정보만 사용해 시간 순으로 정리합니다(진단과 입원 경위, 활력징후·검사 추이, 시술·약물, 현재 상태). 번호를 붙이지 않고 지침 내용을 섞지 않습니다.
   - 한 요청에 둘 이상이 있으면 요청 단위로 굵은 소제목(2~5단어, 질문을 그대로 옮기지 않음)을 달아 사용자가 쓴 순서대로 답합니다. 소제목 아래에는 위의 해당 틀을 그대로 씁니다.
   - 발췌문에 질문과 관련된 지침 내용이 없으면 그 부분에는 "제공된 자료에서 해당 내용을 찾을 수 없습니다."라고만 쓰고, 나머지 요청은 환자 정보만으로 답합니다.
   - 발췌문에 근거가 없는 환자별 처방·용량 지시는 만들지 않습니다."""

# ---------- 자료 / 인덱스 로드 ----------
with open(os.path.join(ROOT, "db", "pages.json"), encoding="utf-8") as fh:
    PAGES = json.load(fh)  # {source_id: {name, lang, pages: {"72": text}}}
SOURCE_NAMES = {sid: v["name"] for sid, v in PAGES.items()}

embeddings = OpenAIEmbeddings(model="text-embedding-3-small")
vectorstore = Chroma(collection_name="notebook", embedding_function=embeddings, persist_directory=os.path.join(ROOT, "db", "chromadb"))
_all = vectorstore._collection.get(include=["documents", "metadatas"])
DOC_TEXT, DOC_META = _all["documents"], _all["metadatas"]
N_CHUNKS = len(DOC_TEXT)
TEXT2IDX = {t: i for i, t in enumerate(DOC_TEXT)}
pdfs = PdfStore({sid: os.path.join(ROOT, v["file"]) for sid, v in PAGES.items() if v.get("file")})
SRC_CHUNKS, SRC_TABLES = defaultdict(int), defaultdict(int)
for m in DOC_META:
    SRC_CHUNKS[m["source"]] += 1
    SRC_TABLES[m["source"]] += m.get("kind") == "table"


def tokenize(text: str):
    """BM25 용 토큰: 영문/숫자 단어(약어 포함) + 한글 2-gram."""
    text = text.lower()
    toks = re.findall(r"[a-z0-9][a-z0-9\-/\.]*[a-z0-9]|[a-z0-9]", text)
    for w in re.findall(r"[가-힣]+", text):
        toks += [w[i:i + 2] for i in range(len(w) - 1)] if len(w) > 1 else [w]
    return toks


bm25 = BM25Okapi([tokenize(t) for t in DOC_TEXT])
DOC_SRC = np.array([m["source"] for m in DOC_META])

print(f"[load] LLM {MODEL_ID} / reranker {RERANKER_ID} / {N_CHUNKS} chunks / sources {list(SOURCE_NAMES)}", flush=True)
reranker = CrossEncoder(RERANKER_ID, device="cuda", max_length=1024)
tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
model = AutoModelForCausalLM.from_pretrained(MODEL_ID, dtype=torch.bfloat16, device_map="cuda").eval()


# ---------- 검색: 의미 + 키워드 -> RRF -> Rerank ----------
def retrieve(query: str, ids: list[str], extra: tuple = (), alt: tuple = ()):
    """자료별 후보(의미 + 키워드)를 따로 뽑아 RRF 로 합치고 Reranker 로 점수를 매긴 뒤,
    우선순위 가산점을 반영해 상위 TOP_K 를 고른다. 반환은 (우선순위 → 관련도) 순서이고 score 는 가산점 없는 관련도(0~1)다."""
    col = vectorstore._collection
    fused, info = defaultdict(float), {}
    # 질의 여러 개(핵심 질문 + 검색어)로 후보를 모으되, 재순위 점수는 핵심 질문(query) 하나로 매긴다
    for q in [query, *[e for e in extra if e and e != query]]:
        qv = embeddings.embed_query(q)
        bm = bm25.get_scores(tokenize(q))
        for sid in ids:
            res = col.query(query_embeddings=[qv], n_results=PER_SOURCE, where={"source": sid}, include=["documents", "metadatas"])
            for rank, (doc, meta) in enumerate(zip(res["documents"][0], res["metadatas"][0])):
                fused[doc] += 1 / (60 + rank)
                info[doc] = meta
            idx = np.where(DOC_SRC == sid)[0]
            top = idx[np.argsort(-bm[idx])[:PER_SOURCE]]
            for rank, i in enumerate(i for i in top if bm[i] > 0):
                fused[DOC_TEXT[i]] += 1 / (60 + rank)
                info[DOC_TEXT[i]] = DOC_META[i]
    cands = sorted(fused, key=fused.get, reverse=True)
    if not cands:
        return []
    def rerank(q: str):
        return np.asarray(reranker.predict([(q, t) for t in cands], batch_size=8, show_progress_bar=False, activation_fn=torch.nn.Identity()), dtype=float)
    # 질문과 자료의 언어가 다르면 점수가 크게 깎인다(한국어 질문 vs 영어 ESC/AHA). 다른 언어로 옮긴 질문(alt)으로도 매겨 높은 쪽을 쓴다.
    logit = rerank(query)
    for a in alt:
        logit = np.maximum(logit, rerank(a))
    prob = 1 / (1 + np.exp(-logit))
    adj = logit + np.array([SOURCE_BONUS.get(info[t]["source"], 0.0) for t in cands])
    # 우선순위 자료부터 자리를 먼저 배정한다(관련도 하한 이상일 때만). 남은 자리는 가산점 반영 점수순으로 채운다.
    ranked = [int(i) for i in np.argsort(-adj)]
    chosen: list[int] = []
    for sid in sorted(ids, key=lambda x: SOURCE_PRIORITY.get(x, 9)):
        chosen += [i for i in ranked if info[cands[i]]["source"] == sid and prob[i] >= QUOTA_MIN_PROB][:SOURCE_QUOTA.get(sid, 1)]
    chosen += [i for i in ranked if i not in chosen][:max(0, TOP_K - len(chosen))]
    chosen = sorted(chosen[:TOP_K], key=lambda i: (SOURCE_PRIORITY.get(info[cands[i]]["source"], 9), -adj[i]))
    best_raw = float(prob.max())
    out = [{"id": TEXT2IDX[cands[i]], "text": cands[i], "score": float(prob[i]), "source": info[cands[i]]["source"],
            "source_name": info[cands[i]]["source_name"], "page": info[cands[i]]["page"], "kind": info[cands[i]].get("kind", "text"),
            "priority": SOURCE_PRIORITY.get(info[cands[i]]["source"], 9)} for i in chosen]
    for o in out:
        o["best_raw"] = best_raw  # 거절 판단용: 가산점이 아니라 원래 관련도의 최고값
    return out


RECORD_CANDS = 500   # BM25 로 줄여 둘 후보 수 (그 이하면 전부 재순위)
RECORD_TOP, RECORD_EXTRA, RECORD_EXTRA_MIN, RECORD_CHARS = 8, 10, 0.2, 4500


def retrieve_record(query: str, extra: tuple, record: list[str]) -> list[str]:
    """환자 기록 줄들 중 질문과 관련된 것을 고른다. 로컬 BM25 + 로컬 reranker 만 쓴다(환자 기록을 외부 API 로 보내지 않는다).
    상위 RECORD_TOP 줄은 무조건, 이어서 관련도(0~1)가 RECORD_EXTRA_MIN 이상인 줄을 RECORD_EXTRA 줄까지 더하고 기록 순서로 돌려준다."""
    if not record:
        return []
    q = query[:400]
    idx = list(range(len(record)))
    if len(idx) > RECORD_CANDS:
        bm = BM25Okapi([tokenize(t) for t in record]).get_scores(tokenize(" ".join([q, *extra])))
        idx = [int(i) for i in np.argsort(-bm)[:RECORD_CANDS]]
    logit = np.asarray(reranker.predict([(q, record[i]) for i in idx], batch_size=32, show_progress_bar=False, activation_fn=torch.nn.Identity()), dtype=float)
    prob = 1 / (1 + np.exp(-logit))
    order = np.argsort(-logit)
    chosen = [int(k) for k in order[:RECORD_TOP]] + [int(k) for k in order[RECORD_TOP:RECORD_TOP + RECORD_EXTRA] if prob[k] >= RECORD_EXTRA_MIN]
    out, used = [], 0
    for k in sorted(chosen, key=lambda k: idx[k]):
        if used + len(record[idx[k]]) > RECORD_CHARS:
            continue
        out.append(record[idx[k]])
        used += len(record[idx[k]])
    return out


HANGUL = re.compile(r"[가-힣]")


def to_english(text: str) -> str:
    """한국어 임상 질문을 영어 의학 용어 한 문장으로 옮긴다(영어 지침 재순위용). 실패하면 빈 문자열."""
    try:
        msgs = [{"role": "system", "content": "You translate Korean clinical questions into one concise English sentence using standard medical terminology. Output only the English sentence."},
                {"role": "user", "content": text[:500]}]
        t = tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        inputs = tokenizer(t, return_tensors="pt").to(model.device)
        with torch.no_grad():
            out = model.generate(**inputs, max_new_tokens=80, do_sample=False, temperature=None, top_p=None, top_k=None)
        return tokenizer.decode(out[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True).strip().split("\n")[0][:300]
    except Exception:  # noqa: BLE001
        return ""


JUDGE_USER = """사용자 질문: {query}

## 자료 발췌문
{srcs}

## 환자 정보
{context}{rec}

위를 보고 JSON 한 개로 답하세요.
{{"drug": "질문이 묻는 약 이름", "condition": "자료 발췌문이 이 약을 쓰라고 하는 핵심 조건(증상·소견·수치)", "condition_status": "있음", "given": true, "basis": "판단 근거가 된 환자 정보 문장 하나"}}
- condition_status: 환자 정보에 그 조건이 확인되면 "있음", 정상이거나 해당 없음으로 명시되어 있으면 "없음", 판단할 기록이 없으면 "기록없음". 진단명만으로 조건이 충족된 것으로 보지 않습니다.
- given: 환자 정보의 약물 목록·기록에 그 약이 투여된 내용이 있으면 true, 없으면 false."""


def judge_drug(query: str, passages: list[dict], context: str, record_hits: list[str] | None) -> str:
    """약 투여의 적절성(과거)을 묻는 질문에서 '투여 조건 충족 여부'와 '투여 여부'를 먼저 확인하고, 결론은 코드의 판정표로 정한다.
    (모델이 결론부터 쓰면 정상 소견인데도 '필요했다'고 쓰는 등 사실과 반대로 결론 내는 일이 있다.) 실패하면 빈 문자열."""
    try:
        rec = ("\n" + "\n".join(f"- {x}" for x in record_hits)) if record_hits else ""
        user = JUDGE_USER.format(query=query[:600], srcs="\n\n".join(f"[{n}] {p['text'][:900]}" for n, p in enumerate(passages[:4], 1)), context=context[:4500] or "(요약 없음)", rec=rec)
        msgs = [{"role": "system", "content": "당신은 임상 사실 확인기입니다. JSON 한 개만 출력합니다."}, {"role": "user", "content": user}]
        t = tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        inputs = tokenizer(t, return_tensors="pt").to(model.device)
        with torch.no_grad():
            out = model.generate(**inputs, max_new_tokens=220, do_sample=False, temperature=None, top_p=None, top_k=None)
        j = json.loads(re.search(r"\{.*\}", tokenizer.decode(out[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True), re.S).group(0))
        st, given = str(j.get("condition_status", "")).strip(), bool(j.get("given", False))
        if st not in ("있음", "없음", "기록없음"):
            return ""
        verdict = ("환자 정보만으로는 판단하기 어렵습니다" if st == "기록없음" else
                   ("적절합니다(용량·시기가 지침과 다르면 \"주의가 필요합니다\")" if given else "적절하지 않습니다") if st == "있음" else
                   ("주의가 필요합니다" if given else "적절합니다"))
        drug = str(j.get("drug", "해당 약"))[:40]
        return (f"- 약: {drug}\n- 투여 조건: {str(j.get('condition', ''))[:120]} → 이 환자: {st}\n- {drug} 투여: {'있음' if given else '기록 없음'}"
                f" ({str(j.get('basis', ''))[:140]})\n- 따라서 \"결론:\"은 반드시 \"{verdict}\"로 시작하고, 괄호 안 이유도 위 사실과 일치시킵니다.")
    except Exception:  # noqa: BLE001
        return ""


PRIORITY_NOTE = "\n(인용 우선순위: 발췌문 번호가 작을수록 우선 자료(ESC → KSHF → AHA)입니다. 같은 내용을 여러 발췌문이 말하면 번호가 가장 작은 발췌문의 내용을 쓰고 그 번호를 인용하세요.)"


def build_messages(query: str, passages: list[dict], context: str = "", plan: dict | None = None, record_hits: list[str] | None = None, facts: str = ""):
    srcs = "\n\n-----\n\n".join(
        f"[{n}] 출처: {p['source_name']} (우선순위 {p['priority']}), p.{p['page']}{' (표)' if p['kind'] == 'table' else ''}\n{p['text']}" for n, p in enumerate(passages, 1)
    )
    if not context and not record_hits:  # 환자 정보가 없는 일반 질문: 발췌문 → 질문
        excerpt = f"## 자료 발췌문\n{srcs}\n\n" if passages else ""
        return [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": f"{excerpt}## 질문\n{query}{PRIORITY_NOTE if passages else ''}"}]
    # 환자 정보가 있는 질문: 사용자 요청이 가장 중요하므로 맨 앞과 맨 끝에 두고, 환자 정보·발췌문은 그 사이의 참고 자료로 둔다
    rec = ("\n\n## 환자 기록에서 찾은 내용 (질문과 관련해 전체 진료기록을 검색한 원문, 기록 순서)\n" + "\n".join(f"- {x}" for x in record_hits)) if record_hits else \
        ("\n\n## 환자 기록에서 찾은 내용\n(질문과 관련된 기록을 찾지 못했습니다)" if record_hits is not None else "")
    fct = f"\n\n## 확인된 사실 (검증됨 — 결론은 이에 따릅니다)\n{facts}" if facts else ""
    excerpt = f"## 자료 발췌문 (참고)\n{srcs}" if passages else "## 자료 발췌문 (참고)\n(질문과 관련된 지침 발췌문이 검색되지 않았거나 지침 검색이 필요 없는 요청입니다)"
    return [{"role": "system", "content": SYSTEM_PROMPT + CONTEXT_RULES},
            {"role": "user", "content": f"## 사용자 요청 (가장 중요)\n{query}\n\n## 환자 정보 (참고, 근거 아님)\n{context or '(요약 없음)'}{rec}\n\n{excerpt}{fct}\n\n## 다시 한 번, 사용자 요청\n{query}{PRIORITY_NOTE if passages else ''}\n위 요청에 정확히 답하세요."}]


def normalize_citations(answer: str, n: int):
    """[1, 3] -> [1][3], 존재하지 않는 번호 제거, 인용된 번호 목록 반환."""
    answer = re.sub(r"\[(\d+(?:\s*[,，、]\s*\d+)+)\]",
                    lambda m: "".join(f"[{x.strip()}]" for x in re.split(r"[,，、]", m.group(1))), answer)
    # 모델이 가끔 대괄호 없이 "…한다.1" / 위첨자(¹)로 쓰는 경우를 [n] 으로 바로잡는다
    sup = str.maketrans("¹²³⁴⁵⁶⁷⁸⁹", "123456789")
    answer = re.sub(r"([¹²³⁴⁵⁶⁷⁸⁹]+)", lambda m: f"[{m.group(1).translate(sup)}]", answer)
    answer = re.sub(r"(?<=다\.)([1-9])(?=\s|$)", lambda m: f"[{m.group(1)}]" if int(m.group(1)) <= n else m.group(0), answer)
    answer = re.sub(r"\[(\d+)\]", lambda m: m.group(0) if 1 <= int(m.group(1)) <= n else "", answer)
    return answer.strip(), sorted({int(x) for x in re.findall(r"\[(\d+)\]", answer)})


# 환자 정보를 서술한 문장("이 환자는 …")에는 지침 번호를 붙이지 않는다. 모델이 어겨도 여기서 지운다.
_PAT_LINE = re.compile(r"^\s*(?:[-*•]\s*)?(?:\*\*)?(?:이 환자|결론)\s*[:：]")
_PAT_SENT = re.compile(r"((?:^|(?<=\. ))(?:[-*•]\s*)?(?:이|본) 환자(?:는|가|의|에게|에서|에겐)[^\n]*?\.(?=\s|$))((?:\s*\[\d+\])*)", re.M)


# 모델이 환자 정보의 섹션 이름·기록 태그를 [ ]로 인용처럼 붙이는 경우(예: [기본 정보])도 지운다
_SECTION_TAG = re.compile(r"\s*\[(?:기본 정보|진단·문제목록|신체진찰·체액상태|병력[^\]]*|복용·처방 약물|이상 검사결과[^\]]*|주요 검사 정상값|활력징후|경과 기록[^\]]*|영상 판독|시술·수술|진료 이력|기본|진단|진료|검사|오더|투약|섭취·배설|영상|기록[^\]]*)\]")


def strip_patient_cites(answer: str):
    answer = _SECTION_TAG.sub("", answer)
    out = []
    for line in answer.split("\n"):
        if _PAT_LINE.match(line):
            out.append(re.sub(r"\s*\[\d+\]", "", line))
        else:
            out.append(_PAT_SENT.sub(lambda m: re.sub(r"\s*\[\d+\]", "", m.group(1)), line))
    answer = "\n".join(out)
    return answer, sorted({int(x) for x in re.findall(r"\[(\d+)\]", answer)})


class Cancel(StoppingCriteria):
    def __init__(self):
        self.flag = threading.Event()

    def __call__(self, input_ids, scores, **kwargs):
        return torch.full((input_ids.shape[0],), self.flag.is_set(), dtype=torch.bool, device=input_ids.device)


def event(**kw) -> str:
    return json.dumps(kw, ensure_ascii=False) + "\n"


# ---------- API ----------
app = FastAPI(title="Heart Failure Notebook")
gpu_lock = threading.Lock()  # LLM/reranker 는 한 번에 한 요청만
state_lock = threading.Lock()
hits = defaultdict(deque)
queued = 0


def client_ip(request: Request) -> str:
    # 터널(cloudflared)은 127.0.0.1 로 접속하므로 이 경우에만 CF-Connecting-IP 를 신뢰한다
    host = request.client.host if request.client else "?"
    return request.headers.get("cf-connecting-ip", host) if host in ("127.0.0.1", "::1") else host


def check_rate_limit(ip: str, bucket: str = "ask", limit: int = RATE_LIMIT):
    now = time.time()
    with state_lock:
        q = hits[(bucket, ip)]
        while q and now - q[0] > RATE_WINDOW:
            q.popleft()
        if len(q) >= limit:
            raise HTTPException(429, f"요청이 너무 많습니다. {int(RATE_WINDOW - (now - q[0])) + 1}초 후 다시 시도해 주세요.")
        q.append(now)


class AskRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    sources: list[str] = []
    summary: str = Field(default="", max_length=300)  # 환자 한 줄 요약: 근거 검색 질의 앞에만 붙인다
    context: str = Field(default="", max_length=6000)  # 환자 전체 맥락: 답변 생성 프롬프트에만 넣는다
    record: list[str] = Field(default=[], max_length=1500)  # 환자 기록 전체(한 줄 = 한 사실): 질문과 관련된 줄만 검색해 쓴다


@app.get("/", response_class=HTMLResponse)
def index():
    with open(os.path.join(ROOT, "web", "notebook.html"), encoding="utf-8") as fh:
        return fh.read()


@app.get("/api/info")
def info():
    return {
        "llm": MODEL_ID, "reranker": RERANKER_ID, "public": PUBLIC, "viewer": VIEWER,
        "sources": [{"id": sid, "name": v["name"], "lang": v["lang"], "pages": len(v["pages"]), "chunks": SRC_CHUNKS[sid], "tables": SRC_TABLES[sid],
                     "priority": SOURCE_PRIORITY.get(sid, 9)}
                    for sid, v in sorted(PAGES.items(), key=lambda kv: SOURCE_PRIORITY.get(kv[0], 9))],
    }


def view_guard(request: Request):
    if not VIEWER:
        raise HTTPException(404, "원문 뷰어가 꺼져 있습니다.")
    if PUBLIC:
        check_rate_limit(client_ip(request), "view", VIEW_LIMIT)


@app.get("/api/locate")
def locate(id: int, request: Request, units: str = ""):
    """발췌문 id -> 원문 PDF 쪽 정보. units(쉼표로 구분한 문장/행 번호)를 주면 그 문장/행만 형광펜 영역으로 돌려준다."""
    view_guard(request)
    if not 0 <= id < N_CHUNKS or DOC_META[id]["source"] not in pdfs.files:
        raise HTTPException(404, "원문을 찾을 수 없습니다.")
    if units and not re.fullmatch(r"\d{1,3}(,\d{1,3}){0,15}", units):
        raise HTTPException(400, "units 형식이 올바르지 않습니다.")
    m, kind = DOC_META[id], DOC_META[id].get("kind", "text")
    sel = [int(x) for x in units.split(",")] if units else []
    all_units = split_units(DOC_TEXT[id], kind)
    sel = [i for i in sel if i < len(all_units)]
    res = pdfs.locate(m["source"], m["page"], DOC_TEXT[id], kind,
                      spans=[all_units[i] for i in sel] if kind != "table" else None, rows=sel if kind == "table" else None)
    return {"source": m["source"], "name": m["source_name"], "page": m["page"], "total": pdfs.total_pages(m["source"]),
            "kind": m.get("kind", "text"), **res}


@app.get("/api/pagesizes")
def pagesizes(source: str, request: Request):
    view_guard(request)
    if source not in pdfs.files:
        raise HTTPException(404, "원문을 찾을 수 없습니다.")
    return {"sizes": pdfs.sizes(source)}


@app.get("/api/pdfpage")
def pdfpage(source: str, page: int, request: Request):
    """원문 PDF 한 쪽을 PNG 로 렌더링 (파일 전체는 내려주지 않는다)."""
    view_guard(request)
    if source not in pdfs.files or not 1 <= page <= pdfs.total_pages(source):
        raise HTTPException(404, "해당 쪽이 없습니다.")
    return Response(pdfs.render(source, page), media_type="image/png", headers={"Cache-Control": "public, max-age=3600"})


@app.get("/api/page")
def page(source: str, page: int):
    if PUBLIC:
        raise HTTPException(403, "공개 모드에서는 쪽 전체 보기를 제공하지 않습니다.")
    text = PAGES.get(source, {}).get("pages", {}).get(str(page))
    if text is None:
        raise HTTPException(404, "해당 쪽이 없습니다.")
    return {"source_name": SOURCE_NAMES[source], "page": page, "text": text}


# 요약을 "해 달라"는 요청. "임상요약을 보았을 때…"처럼 이미 있는 요약을 참고하라는 말은 요청이 아니다.
SUMMARY_REQ = re.compile(r"요약\s*(해|좀|부탁|바람|만|도|및|과|와|\+|하고)|요약[\s?.!]*$|경과.{0,4}(정리|알려)")
# 지침 판단·권고를 묻는 표현. 이게 없고 요약 요청뿐이면 지침 검색을 하지 않는다.
GUIDE_CUE = re.compile(r"지침|권고|적절|해야|했어야|줘야|써도|써야|투여|사용|추가|시작|중단|늘려|줄여|가능|금기|용량|기준|되나|될까|돼\??|맞나|좋을|괜찮|어야|아야|줬|줄까|주는|주어|처방|투약|복용")
PLAN_SYSTEM = "당신은 임상 질문 분석기입니다. 사용자의 질문을 읽고 JSON 한 개만 출력합니다. 설명, 코드블록, 다른 글은 쓰지 않습니다."
PLAN_USER = """질문: {query}
환자 한 줄 요약: {summary}

다음 JSON 으로 답하세요.
{{"guideline_question": "...", "guideline_question_en": "...", "search_queries": ["...", "..."], "wants_guideline": true, "about_patient": true, "drug_check": false, "wants_patient_summary": false}}

- guideline_question: 질문에 실제로 들어 있는 약·검사·치료에 대해 진료지침에 물어볼 핵심 질문 한 문장. 환자 이름·번호 없이 일반화하되 질문에 나온 항목만 씁니다(질문에 없는 약·검사를 만들어 넣지 않습니다). 지침을 찾을 필요가 없으면 빈 문자열.
- guideline_question_en: guideline_question 의 영어 번역 한 문장(표준 의학 영어 용어). 지침을 찾을 필요가 없으면 빈 문자열.
- search_queries: 지침 본문에서 찾을 만한 표현 2개(한국어 1개, 영어 의학 용어 1개). 질문에 나온 약 이름은 계열명을 함께 씁니다.
- wants_guideline: 사용자가 진료지침에 근거한 판단·권고를 직접 요구했는가(치료·검사·약이 적절한지, 지침이 무엇을 권고하는지). 환자 경과·상태를 요약해 달라는 요청뿐이면 false 이고 guideline_question 은 빈 문자열, search_queries 는 빈 목록입니다.
- about_patient: 질문이 이 환자의 기록(진단·검사·약·경과·투약 여부 등)에 관한 것이거나 이 환자에게 지침을 적용해 달라는 것인가. 환자와 무관한 일반 지침 질문이면 false.
- drug_check: 이 환자에게 이미 이루어진(또는 이루어지지 않은) 약 투여가 적절했는지/필요했는지/투여됐는지를 과거형으로 묻는가. 앞으로 투여해도 되는지 묻는 것은 false.
- wants_patient_summary: 환자의 임상 경과·상태를 요약해 달라는 요청이 포함되어 있는가. "요약을 보았을 때", "요약을 참고해서"처럼 이미 주어진 요약을 근거로 삼으라는 말은 요약 요청이 아니므로 false 입니다.
질문이 둘 이상이면 각각 판단합니다.

예) 질문 "임상경과만 간단히 요약해줘" → {{"guideline_question": "", "search_queries": [], "wants_guideline": false, "about_patient": true, "wants_patient_summary": true}}
예) 질문 "임상요약을 보았을때, 이 환자에게 스타틴을 쓴 것이 적절했나" → {{"guideline_question": "심부전 환자에서 스타틴 사용의 적절성과 권고", "guideline_question_en": "Appropriateness and recommendation of statin use in patients with heart failure", "search_queries": ["스타틴 사용", "statin therapy"], "wants_guideline": true, "about_patient": true, "drug_check": true, "wants_patient_summary": false}}
예) 질문 "이 환자 크레아티닌이 언제부터 올랐어?" → {{"guideline_question": "", "search_queries": [], "wants_guideline": false, "about_patient": true, "wants_patient_summary": false}}
예) 질문 "SGLT2 억제제는 어떤 환자에게 권고되나요?" → {{"guideline_question": "SGLT2 억제제 권고 대상", "guideline_question_en": "Which patients are recommended SGLT2 inhibitors", "search_queries": ["SGLT2 억제제 권고", "SGLT2 inhibitor indication"], "wants_guideline": true, "about_patient": false, "wants_patient_summary": false}}
예) 질문 "이 환자에게 베타차단제를 시작해도 돼?" → {{"guideline_question": "심부전 환자에서 베타차단제 시작 권고와 주의사항", "guideline_question_en": "Recommendations and cautions for initiating beta-blockers in heart failure", "search_queries": ["베타차단제 시작", "beta-blocker initiation"], "wants_guideline": true, "wants_patient_summary": false}}"""


def plan_query(query: str, summary: str) -> dict:
    """긴 질문·환자 정보가 있는 질문에서 '지침에 물을 핵심 질문'과 '환자 경과 요약 요청'을 분리한다. 실패하면 원문 그대로 쓴다."""
    default = {"question": f"{summary}. {query}" if summary else query, "question_en": "", "queries": [], "wants_guideline": True,
               "wants_summary": bool(SUMMARY_REQ.search(query)), "about_patient": bool(THIS_PATIENT.search(query)) or bool(SUMMARY_REQ.search(query)), "drug_check": False}
    try:
        msgs = [{"role": "system", "content": PLAN_SYSTEM}, {"role": "user", "content": PLAN_USER.format(query=query[:1500], summary=summary[:300] or "-")}]
        text = tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        inputs = tokenizer(text, return_tensors="pt").to(model.device)
        with torch.no_grad():
            out = model.generate(**inputs, max_new_tokens=260, do_sample=False, temperature=None, top_p=None, top_k=None)
        raw = tokenizer.decode(out[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)
        j = json.loads(re.search(r"\{.*\}", raw, re.S).group(0))
        question = str(j.get("guideline_question") or "").strip()
        queries = [str(x).strip() for x in (j.get("search_queries") or []) if str(x).strip()][:2]
        wants_s = bool(j.get("wants_patient_summary", False)) or default["wants_summary"]
        wants_g = bool(j.get("wants_guideline", True))  # 모델이 false 라고 했으면 질문 문장이 있어도 따른다
        if wants_s and not GUIDE_CUE.search(query):  # 요약만 요청했는데 모델이 지침 질문을 지어내는 경우를 막는다
            wants_g = False
        if not wants_g:
            question, queries = "", []
        about = bool(j.get("about_patient", False)) or default["about_patient"] or wants_s
        q_en = str(j.get("guideline_question_en") or "").strip()[:300] if wants_g else ""
        drug_check = bool(j.get("drug_check", False)) and wants_g
        return {"question": question or (default["question"] if wants_g else ""), "drug_check": drug_check, "question_en": q_en, "queries": queries, "wants_guideline": wants_g, "wants_summary": wants_s, "about_patient": about}
    except Exception:  # noqa: BLE001
        return default


def answer_stream(query: str, ids: list[str], summary: str = "", context: str = "", record: list[str] | None = None):
    """작업 스레드가 GPU 락을 소유하고 이벤트를 큐로 넘긴다.
    클라이언트가 중간에 끊어도(제너레이터가 닫히지 않아도) 락은 작업이 끝나는 즉시 풀린다."""
    outbox: queue.Queue = queue.Queue()
    cancel = Cancel()
    record = record or []

    def work():
        global queued
        t0 = time.time()
        try:
            with gpu_lock:
                # 긴 질문·환자 정보가 있으면 먼저 "지침에 물을 질문"과 "경과 요약 요청"을 분리한다 (섞인 채 검색하면 엉뚱한 발췌문이 잡힌다)
                plan = plan_query(query, summary) if (context.strip() or record or len(query) > 120) else {"question": query, "queries": [], "wants_guideline": True, "wants_summary": False, "about_patient": False}
                if plan["question"] != query or plan["wants_summary"] or not plan["wants_guideline"]:
                    outbox.put(event(type="plan", question=plan["question"], queries=plan["queries"], wants_guideline=plan["wants_guideline"], wants_summary=plan["wants_summary"], about_patient=plan["about_patient"]))
                # 환자와 무관한 일반 질문이면 환자 정보를 쓰지 않는다. 환자에 관한 질문이면 요약과 함께 전체 기록에서 관련 줄을 검색한다.
                about = bool(plan["about_patient"]) or plan["wants_summary"] or bool(THIS_PATIENT.search(query))
                use_ctx = context.strip() if about else ""
                rec_hits = None
                if about and record and not (plan["wants_summary"] and not plan["wants_guideline"]):
                    rec_hits = retrieve_record(query, tuple(plan["queries"]), record)
                    outbox.put(event(type="record", hits=rec_hits))
                passages, best = [], 0.0
                if plan["wants_guideline"]:
                    q_focus = plan["question"] or query
                    terms = expand_terms(f"{query} {q_focus}")
                    q_en = plan.get("question_en") or (to_english(q_focus) if HANGUL.search(q_focus) else "")
                    alts = tuple(dict.fromkeys(x for x in (q_en, query[:400]) if x and x != q_focus))  # 영어 질문 + 원문(영어로 물었을 때 한국어 자료용)
                    passages = retrieve(q_focus, ids, tuple(plan["queries"]) + ((terms,) if terms else ()), alts)
                    best = passages[0]["best_raw"] if passages else 0.0
                weak = plan["wants_guideline"] and best < REFUSE_BELOW
                if weak and not plan["wants_summary"]:  # 지침 근거가 없고 요약 요청도 아니면 답하지 않는다
                    shown = sorted(passages, key=lambda x: -x["score"])[:3]
                    outbox.put(event(type="passages", refused=True, best=round(best, 4),
                                     passages=[{"n": n, **p, "score": round(p["score"], 4)} for n, p in enumerate(shown, 1)]))
                    outbox.put(event(type="done", answer=REFUSAL, cited=[], refused=True, hint=hint_for(query, context if (context.strip() or record) else ""), seconds=round(time.time() - t0, 1)))
                    return
                if weak:  # 요약 요청은 환자 정보만으로 답하고 지침 부분은 근거 없음으로 둔다
                    passages = []
                outbox.put(event(type="passages", refused=False, best=round(best, 4),
                                 passages=[{"n": n, **p, "score": round(p["score"], 4)} for n, p in enumerate(passages, 1)]))

                facts = judge_drug(query, passages, use_ctx, rec_hits) if (plan.get("drug_check") and passages and (use_ctx or rec_hits)) else ""
                print(f"[ask] plan={ {k: v for k, v in plan.items() if k != 'queries'} } passages={[(p['source'], p['page'], round(p['score'], 2)) for p in passages]} facts={facts!r}", flush=True)
                text = tokenizer.apply_chat_template(build_messages(query, passages, use_ctx, plan, rec_hits, facts), tokenize=False,
                                                     add_generation_prompt=True, enable_thinking=False)
                inputs = tokenizer(text, return_tensors="pt").to(model.device)
                streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)
                err = []

                def generate():
                    try:
                        model.generate(**inputs, max_new_tokens=MAX_NEW_TOKENS, do_sample=False, temperature=None,
                                       top_p=None, top_k=None, streamer=streamer,
                                       stopping_criteria=StoppingCriteriaList([cancel]))
                    except Exception as e:  # noqa: BLE001
                        err.append(str(e))
                        streamer.end()

                threading.Thread(target=generate, daemon=True).start()
                pieces = []
                for piece in streamer:
                    pieces.append(piece)
                    outbox.put(event(type="token", t=piece))
                if err:
                    outbox.put(event(type="error", message="생성 중 오류가 발생했습니다."))
                    return
                answer, cited = normalize_citations("".join(pieces), len(passages))
                if context.strip():
                    answer, cited = strip_patient_cites(answer)
                if cited:  # 일부라도 근거가 있으면 끝에 덧붙은 거절 문장은 지운다
                    answer = re.sub(rf"\s*{re.escape(REFUSAL)}\s*$", "", answer).rstrip()
                try:  # 결정적 문장 선택 (실패해도 답변은 그대로 보낸다)
                    marks = select_evidence(answer, passages, cited, lambda pairs: reranker.predict(
                        pairs, batch_size=16, show_progress_bar=False, activation_fn=torch.nn.Identity()))
                except Exception:  # noqa: BLE001
                    import traceback
                    traceback.print_exc()  # 형광펜 선택이 실패해도 답변은 그대로 보낸다
                    marks = {}
                is_refusal = REFUSAL in answer and not cited and not plan["wants_summary"] and plan["wants_guideline"]
                outbox.put(event(type="done", answer=answer, cited=cited, marks=marks, refused=is_refusal,
                                 hint=hint_for(query, context if (context.strip() or record) else "") if is_refusal else "", seconds=round(time.time() - t0, 1)))
        except Exception as e:  # noqa: BLE001
            outbox.put(event(type="error", message=f"처리 중 오류가 발생했습니다: {type(e).__name__}"))
        finally:
            outbox.put(None)
            if PUBLIC:
                with state_lock:
                    queued -= 1

    threading.Thread(target=work, daemon=True).start()
    try:
        while (item := outbox.get()) is not None:
            yield item
    finally:
        cancel.flag.set()  # 클라이언트가 끊으면 생성 중단


@app.post("/api/ask")
def ask(req: AskRequest, request: Request):
    global queued
    query = req.query.strip()
    if not query:
        raise HTTPException(400, "질문이 비어 있습니다.")
    ids = [s for s in req.sources if s in SOURCE_NAMES] or list(SOURCE_NAMES)
    if PUBLIC:
        check_rate_limit(client_ip(request))
        with state_lock:
            if queued >= MAX_QUEUE:
                raise HTTPException(503, "대기열이 가득 찼습니다. 잠시 후 다시 시도해 주세요.")
            queued += 1
    return StreamingResponse(answer_stream(query, ids, req.summary.strip(), req.context, [x[:700] for x in req.record if x.strip()][:1500]), media_type="application/x-ndjson")


# ---------- 병원 EMR 로그인 ----------
EMR_PASSWORD = os.environ.get("EMR_PASSWORD") or secrets.token_urlsafe(9)
if not os.environ.get("EMR_PASSWORD"):
    print(f"[EMR] EMR_PASSWORD 환경변수가 없어 이번 실행 한정 임시 비밀번호를 생성했습니다: {EMR_PASSWORD}")
SESSION_KEY = secrets.token_bytes(32)  # 서버를 다시 띄우면 기존 세션은 무효가 된다
SESSION_TTL = 12 * 3600
login_fails = defaultdict(deque)


def _sign(exp: int) -> str:
    return hmac.new(SESSION_KEY, str(exp).encode(), hashlib.sha256).hexdigest()


def make_session() -> str:
    exp = int(time.time()) + SESSION_TTL
    return f"{exp}.{_sign(exp)}"


def session_ok(cookie_header: str) -> bool:
    for part in cookie_header.split(";"):
        k, _, v = part.strip().partition("=")
        if k == "emr_session" and "." in v:
            exp_s, sig = v.split(".", 1)
            if exp_s.isdigit() and int(exp_s) > time.time() and hmac.compare_digest(sig, _sign(int(exp_s))):
                return True
    return False


class EmrGate:
    """순수 ASGI 미들웨어: 로그인 세션이 없으면 환자 데이터(/emr/hf/)를 내주지 않는다. 다른 경로(스트리밍 포함)는 건드리지 않는다."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"].startswith("/emr/hf/"):
            cookie = next((v.decode("latin-1") for k, v in scope["headers"] if k == b"cookie"), "")
            if not session_ok(cookie):
                body = b'{"detail":"login required"}'
                await send({"type": "http.response.start", "status": 401, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
                await send({"type": "http.response.body", "body": body})
                return
        if scope["type"] == "http" and scope["path"].startswith("/emr/hf/"):
            async def send_no_store(message):  # 환자 데이터는 브라우저 캐시에 남기지 않는다(로그아웃 후 재사용 방지)
                if message["type"] == "http.response.start":
                    message = {**message, "headers": [(k, v) for k, v in message.get("headers", []) if k.lower() != b"cache-control"] + [(b"cache-control", b"private, no-store")]}
                await send(message)
            await self.app(scope, receive, send_no_store)
            return
        await self.app(scope, receive, send)


app.add_middleware(EmrGate)


class LoginRequest(BaseModel):
    password: str = Field(max_length=100)


@app.get("/emr/api/session")
def emr_session(request: Request):
    return {"authed": session_ok(request.headers.get("cookie", ""))}


@app.post("/emr/api/login")
def emr_login(req: LoginRequest, request: Request, response: Response):
    ip = client_ip(request)
    now = time.time()
    with state_lock:
        q = login_fails[ip]
        while q and now - q[0] > RATE_WINDOW:
            q.popleft()
        if len(q) >= 8:
            raise HTTPException(429, "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.")
    if not hmac.compare_digest(req.password.encode(), EMR_PASSWORD.encode()):
        with state_lock:
            login_fails[ip].append(now)
        raise HTTPException(401, "비밀번호가 올바르지 않습니다.")
    response.set_cookie("emr_session", make_session(), max_age=SESSION_TTL, httponly=True, samesite="lax", path="/emr",
                        secure=request.headers.get("x-forwarded-proto") == "https")
    return {"ok": True}


@app.post("/emr/api/logout")
def emr_logout(response: Response):
    response.delete_cookie("emr_session", path="/emr")
    return {"ok": True}


# 병원 EMR 시연 화면(React 빌드 산출물): /emr — 같은 서버의 /api 를 사용하므로 공개 터널에서도 그대로 동작한다
EMR_DIST = os.path.join(ROOT, "emr", "dist")
if os.path.isdir(EMR_DIST):
    @app.get("/emr")
    def emr_redirect():
        return RedirectResponse("/emr/")

    app.mount("/emr", StaticFiles(directory=EMR_DIST, html=True), name="emr")


if __name__ == "__main__":
    print(f"[serve] http://0.0.0.0:{PORT}", flush=True)
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")
