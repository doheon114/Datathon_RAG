import { useEMR } from '../state/EMRContext'
import TopHeader from './TopHeader'
import Sidebar from './Sidebar'
import PatientInfoPanel from './PatientInfoPanel'
import ClinicalTimeline from './ClinicalTimeline'
import WorkspaceManager from './WorkspaceManager'
import Dialogs from './dialogs/Dialogs'
import LoginScreen from './LoginScreen'
import PdfViewerModal from './windows/PdfViewerModal'

export default function EMRLayout() {
  const { toasts, bundle, selectedEncounter, ready, authed } = useEMR()

  if (authed === null) {
    return (
      <div className="emr-root flex h-screen w-screen items-center justify-center bg-[#141c2b]">
        <div className="flex items-center gap-2 text-emr-sub"><span className="spin" /> 접속 확인 중…</div>
      </div>
    )
  }
  if (!authed) return <LoginScreen />

  if (!ready) {
    return (
      <div className="emr-root flex h-screen w-screen items-center justify-center bg-[#141c2b]">
        <div className="flex items-center gap-2 text-emr-sub"><span className="spin" /> 환자 목록을 불러오는 중…</div>
      </div>
    )
  }

  return (
    <div className="emr-root flex h-screen w-screen min-w-[1280px] min-h-[720px] flex-col">
      <TopHeader />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <PatientInfoPanel />
        <div className="flex min-w-0 flex-1 flex-col">
          <ClinicalTimeline />
          <WorkspaceManager />
        </div>
      </div>
      <div className="hdr-navy flex h-[20px] shrink-0 items-center gap-4 border-t border-black px-2 text-[10.5px] text-emr-sub">
        <span>{bundle.patient.group === 'hf' ? '심부전 코호트(MEDS, 비식별) — 날짜는 상대 일자로 재배치, 체액상태·furosemide 투약·체중·NT-proBNP·흉부X선은 시연용 합성값' : '가상 데이터 시연 — 실제 환자정보가 아닙니다'}</span>
        <span>환자 <b className="text-white">{bundle.patient.name}</b> ({bundle.patient.mrn})</span>
        <span>선택 진료 <b className="text-white">{selectedEncounter ? `${selectedEncounter.date.replace(/-/g, '.')} ${selectedEncounter.type} · ${selectedEncounter.dept}` : '-'}</b></span>
        <span className="ml-auto">진료기록 {bundle.notes.length} · 오더 {bundle.orders.length} · 검사 {bundle.labs.length}</span>
      </div>
      <Dialogs />
      <PdfViewerModal />
      <div className="pointer-events-none fixed bottom-8 right-4 z-[9800] flex flex-col gap-1">
        {toasts.map((t) => <div key={t.id} className={`border px-3 py-1.5 text-[12px] text-white shadow-lg ${t.kind === 'warn' ? 'border-[#8a5a00] bg-[#7a5200]' : 'border-[#003e73] bg-[#0a5fa8]'}`}>{t.msg}</div>)}
      </div>
    </div>
  )
}
