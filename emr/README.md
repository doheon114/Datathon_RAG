# 익명대학교병원 EMR (가상 데이터) + 임상지침 AI

React + TypeScript + Vite + Tailwind + react-rnd + Recharts + Lucide.
환자·진료·오더·검사 데이터는 모두 가상이며 `src/data` 에서 시드 고정으로 생성한다.

## 실행
- 개발: `npm run dev` (5180, `/api` 는 RAG 서버 8800 으로 프록시)
- 배포: `npm run build` → `dist/` 를 `../src/9_notebook_web.py` 가 `/emr` 로 서빙 (같은 서버의 `/api` 사용)

## 구조
- `src/api/emrApi.ts` 데이터 접근 계층(지금은 mock). 백엔드 연결 시 이 파일만 바꾼다.
- `src/api/guidelineApi.ts` 임상지침 AI(RAG) 클라이언트: 질문 스트리밍, 원문 위치, 쪽 이미지.
- `src/state/EMRContext.tsx` 환자·선택 진료일자·창 상태. `GuidelineContext.tsx` AI 대화·뷰어.
- `src/components/` EMRLayout, TopHeader, Sidebar, PatientInfoPanel, PatientList, ClinicalTimeline,
  WorkspaceManager, DraggableWindow, EMRToolbar, windows/(진료기록·오더·검사결과·LabTrendChart·임상지침 AI·PDF 뷰어)

## 지침 AI가 대체한 UX
진료기록 Plan 의 「지침근거」, Problem List 「지침 질의」, 오더조회 약물 「지침」, 검사결과 이상값 「해석」,
PACS 소견 「지침」, 진료기록 검색의 「지침 AI」 모드 — 직접 지침을 찾아보던 절차. 인용 [n] 을 누르면 원문 PDF 가
열리고 답변의 근거 문장만 형광펜으로 표시된다. 답변은 「진료기록에 삽입」 으로 Plan 아래에 근거와 함께 기록된다.

## 심부전 환자 (합성 데이터셋 기반 시연 번들 2명)
- 원본: `../data/*.parquet` (MEDS). KCD-8 `I509` 진단 환자 102명을 `../data/hf_patients.csv` 로 추리고,
  `../data/build_hf_emr.py` 가 EMR 번들(JSON)로 변환해 `public/hf/` 에 둔다 (`index.json` + `HFxxx.json`).
- 환자 목록의 기본 탭이 「심부전 2」(HF017, HF023; `public/hf/`)이고, 「시연 10」 탭에 가상 환자가 남아 있다.
- 기록은 데이터에서 계산한 자동 요약(활력·검사·섭취/배설), 날짜는 비식별화로 이동돼 있어 환자별 상대 일자로 재배치했다.
- 처치 코드 11종은 모든 환자에게 같은 시각에 중복 기록된 인공물이라 오더에서 제외, 약품은 이름 사전이 없어 코드로 표시한다.
- 갱신: `cd ../data && python build_hf_emr.py && cd ../emr && npm run build`
