# Datathon_RAG

심부전 진료지침 3종(PDF)만을 근거로 답하는 **NotebookLM식 RAG**와, 이를 병원 EMR 화면에 붙인 **임상지침 AI 데모**입니다.
답변의 주장에는 인용 `[n]`이 붙고, 누르면 원문 PDF의 해당 쪽에서 근거 문장만 형광펜으로 표시됩니다. 자료에 근거가 없으면 답변을 거절합니다.

## 근거 자료 (PDF 3종 — 저장소에 포함하지 않음)

아래 링크에서 가이드라인 3종을 받아 저장소 루트(이 README와 같은 폴더)에 두세요.

| 우선순위 | 자료 | 다운로드 |
|---|---|---|
| 1 | 2026 ESC Guidelines for the management of heart failure (Eur Heart J, 2026) | https://doi.org/10.1093/eurheartj/ehag100 (ESC 안내: https://www.escardio.org/guidelines/clinical-practice-guidelines/all-esc-practice-guidelines/heart-failure/) |
| 2 | 대한심부전학회 2022 심부전 진료지침 전면 개정판 | https://www.kshf.or.kr/uploaded/board/ksnotice/_48a0e6e928eeac0985de3bb89c43ba5b1.pdf (공지: https://www.kshf.or.kr/news/news_01.php?boardid=ksnotice&mode=view&idx=55) |
| 3 | 2022 AHA/ACC/HFSA Guideline for the Management of Heart Failure (Circulation 2022;145:e895–e1032) | https://doi.org/10.1161/CIR.0000000000001063 (PDF: https://www.ahajournals.org/doi/pdf/10.1161/CIR.0000000000001063) |

권장 파일명(루트에 `*.pdf`로만 있으면 `8_build_index.py`가 전부 읽습니다. `1`~`7` 튜토리얼은 파일명에 `심부전학회` 또는 `kshf`가 들어간 PDF를 찾고, `8_build_index.py`는 파일명의 `kshf`·`심부전학회` / `ESC` / `AHA`·`HFSA`로 자료를 구분합니다):
- `(대한심부전학회) 2022 심부전 진료지침 전면 개정판_수정본.pdf`
- `2026 ESC Guidelines for the management of heart failure.pdf`
- `heidenreich-et-al-2022-aha-acc-hfsa-guideline-for-the-management-of-heart-failure.pdf`

인용 우선순위는 ESC > 대한심부전학회 > AHA 입니다.

## 구성

| 파일 | 역할 |
|---|---|
| `src/1`~`7_*.py` | 단계별 튜토리얼(PDF→텍스트→분할→임베딩→벡터스토어→검색→생성→간단 웹) |
| `src/embedding_model.py` | 로컬 임베딩 모델 로더 (기본 `BAAI/bge-m3`, 환경변수 `EMBEDDING_MODEL` 로 변경). 인덱스 생성과 질의가 같은 모델을 쓰도록 공유 |
| `src/8_build_index.py` | 본 인덱스 생성: 정제 · 큰 청크 · 표 마크다운 · Chroma `notebook` 컬렉션 · `db/pages.json` |
| `src/9_notebook_web.py` | FastAPI 서버: 의미검색 + BM25 → RRF → `bge-reranker-v2-m3` → 로컬 Qwen3.8-27B(4-bit) 스트리밍 답변 |
| `src/evidence.py`, `src/pdf_view.py` | 답변 주장별 근거 문장/표 행 선택, 쪽 이미지·형광펜 좌표 |
| `web/notebook.html` | NotebookLM식 화면 (`/`) |
| `emr/` | React + TypeScript + Vite 병원 EMR 데모 (`/emr/`), 자세한 내용은 `emr/README.md` |
| `emr/public/hf/` | EMR 「심부전」 탭에 나오는 시연 환자 2명(HF017, HF023)의 번들 JSON. 합성 데이터셋 기반이며 아래 「데이터에 관하여」 참고 |

## 실행

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt                 # CUDA 빌드 torch 는 환경에 맞게 따로 설치

python src/8_build_index.py                     # PDF → db/ 인덱스 (최초 1회). 임베딩은 로컬 BAAI/bge-m3 (API 키 불필요, 첫 실행 때 약 2.2GB 다운로드)

cd emr && npm install && npm run build && cd ..  # EMR 화면 빌드 (서버가 /emr 로 서빙)

export EMR_PASSWORD='원하는 비밀번호'           # 없으면 실행마다 임시 비밀번호를 콘솔에 출력
CUDA_VISIBLE_DEVICES=0 python src/9_notebook_web.py --port 8800
```

- 모든 명령은 프로젝트 루트에서 실행합니다(경로는 루트 기준).
- 노트북 화면 `http://localhost:8800/`, EMR 화면 `http://localhost:8800/emr/`
- 외부 API 를 전혀 쓰지 않습니다. 임베딩(`BAAI/bge-m3`) · reranker · LLM 이 모두 로컬에서 돌고, 환자 정보와 질문이 서버 밖으로 나가지 않습니다. 임베딩 모델을 바꾸면(`EMBEDDING_MODEL`) `8_build_index.py` 로 인덱스를 다시 만들어야 합니다.
- Qwen3.8-27B(4-bit, 약 18GB) + reranker + 임베딩 모델(약 1.2GB) 을 올릴 GPU(약 24GB 이상)가 필요합니다. `--bf16` 으로 양자화를 끄거나 `--model` 로 다른 모델을 지정할 수 있고, `--public` 은 외부 노출용(요청 제한·대기열 적용)입니다. 답변 한 건에 수십 초 걸립니다.

## 데이터에 관하여

- EMR의 「시연 10」 탭 환자는 `emr/src/data`에서 시드 고정으로 만든 가상 인물입니다.
- 「심부전」 탭의 환자 2명(`emr/public/hf/HF017.json`, `HF023.json`)은 합성(비식별) 데이터셋에서 가져온 시연용 번들입니다. 투약·검사·활력징후·섭취/배설은 데이터셋의 기록이고, 체액상태·체중 추이·키·NT-proBNP·흉부 X선과 furosemide 시나리오(HF017: 울혈 + 주사 투여, HF023: 울혈 + 미투여)는 시연용 합성/설정이며 기록에 「시연용 합성」으로 표시했습니다. 원본 데이터셋 파일과 전처리 코드는 포함하지 않았습니다.
- 인덱스(`db/`), 청크·임베딩, PDF 추출 텍스트도 PDF 저작물에서 파생되므로 올리지 않았습니다. `8_build_index.py`로 직접 만드세요.
- 이 프로젝트는 연구·시연용이며 실제 진료 판단을 대체하지 않습니다.
