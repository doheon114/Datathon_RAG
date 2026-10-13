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
- 환자 번들(`index.json` + `HFxxx.json`)은 합성(비식별) 데이터셋에서 만든 정적 JSON으로 저장소에 포함돼 있다. 원본 데이터와 변환 스크립트는 포함하지 않는다.
- 환자 목록의 기본 탭이 「심부전 2」(HF017, HF023; `public/hf/`)이고, 「시연 10」 탭에 가상 환자가 남아 있다.
- 기록은 병원 서식(입원기록·경과기록 SOAP, 근무조별 간호기록, 퇴원요약)으로 데이터에서 만들었고 원본에 없는 항목은 「기록 없음」으로 둔다. 날짜는 비식별화로 이동돼 있어 환자별 상대 일자로 재배치했다.
- 처치 코드 11종은 모든 환자에게 같은 시각에 중복 기록된 인공물이라 오더에서 제외하고, 약품은 원본 투약 기록(emar)의 약품명으로 표시한다. 체액상태·체중 추이·키·NT-proBNP·흉부 X선은 「시연용 합성」으로 표시한 합성값이다.
- 번들을 바꾸면 `npm run build` 로 다시 빌드한다 (`public/` 이 `dist/` 로 복사된다).
