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

권장 파일명(루트에 `*.pdf`로만 있으면 `8_build_index.py`가 전부 읽습니다. `1_pdf_to_txt.py`는 파일명에 `심부전학회`가 들어간 PDF를 찾습니다):
- `(대한심부전학회) 2022 심부전 진료지침 전면 개정판_수정본.pdf`
- `2026 ESC Guidelines for the management of heart failure.pdf`
- `heidenreich-et-al-2022-aha-acc-hfsa-guideline-for-the-management-of-heart-failure.pdf`

인용 우선순위는 ESC > 대한심부전학회 > AHA 입니다.

## 구성

| 파일 | 역할 |
|---|---|
| `1`~`7_*.py` | 단계별 튜토리얼(PDF→텍스트→분할→임베딩→벡터스토어→검색→생성→간단 웹) |
| `8_build_index.py` | 본 인덱스 생성: 정제 · 큰 청크 · 표 마크다운 · Chroma `notebook` 컬렉션 · `db/pages.json` |
| `9_notebook_web.py` | FastAPI 서버: 의미검색 + BM25 → RRF → `bge-reranker-v2-m3` → 로컬 Qwen3-14B 스트리밍 답변 |
| `evidence.py`, `pdf_view.py` | 답변 주장별 근거 문장/표 행 선택, 쪽 이미지·형광펜 좌표 |
| `web/notebook.html` | NotebookLM식 화면 (`/`) |
| `emr/` | React + TypeScript + Vite 병원 EMR 데모 (`/emr/`), 자세한 내용은 `emr/README.md` |
| `data/` | (선택) MEDS 심부전 코호트를 EMR 번들로 바꾸는 스크립트. **데이터 자체는 포함하지 않음** |

## 실행

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt                 # CUDA 빌드 torch 는 환경에 맞게 따로 설치

export OPENAI_API_KEY=sk-...                    # 임베딩(text-embedding-3-small)에만 사용. 파일에 저장 금지
python 8_build_index.py                         # PDF → db/ 인덱스 (최초 1회)

cd emr && npm install && npm run build && cd ..  # EMR 화면 빌드 (서버가 /emr 로 서빙)

export EMR_PASSWORD='원하는 비밀번호'           # 없으면 실행마다 임시 비밀번호를 콘솔에 출력
CUDA_VISIBLE_DEVICES=0 python 9_notebook_web.py --port 8800
```

- 노트북 화면 `http://localhost:8800/`, EMR 화면 `http://localhost:8800/emr/`
- 14B 모델 + reranker 를 올릴 GPU(약 30GB 이상)가 필요합니다. `--model` 로 다른 모델 지정, `--public` 은 외부 노출용(요청 제한·대기열 적용).

## 데이터에 관하여

- **저장소에는 환자 데이터가 없습니다.** EMR의 「시연 10」 탭 환자는 `emr/src/data`에서 시드 고정으로 만든 가상 인물입니다.
- 「심부전 102」 탭은 별도로 준비한 MEDS 형식 코호트(`data/*.parquet`)를 `data/build_hf_emr.py`로 변환해 `emr/public/hf/`에 두어야 나타나며, 이 저장소에는 포함하지 않았습니다. 없으면 해당 탭만 비어 있습니다.
- 인덱스(`db/`), 청크·임베딩, PDF 추출 텍스트도 PDF 저작물에서 파생되므로 올리지 않았습니다. `8_build_index.py`로 직접 만드세요.
- 이 프로젝트는 연구·시연용이며 실제 진료 판단을 대체하지 않습니다.
