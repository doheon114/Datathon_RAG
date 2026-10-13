import { useEffect, useRef, useState } from 'react'
import { Cross, Settings, LogOut, Activity, Bot } from 'lucide-react'
import { useEMR } from '../state/EMRContext'
import { useGuideline } from '../state/GuidelineContext'
import { todayISO } from '../data/rng'
import type { WinId } from '../types'

const WIN_NAMES: Record<WinId, string> = { notes: '진료기록조회', orders: '오더조회', labs: '검사결과조회', ai: '임상지침 AI' }

interface MenuItem { label: string; onClick?: () => void; checked?: boolean; sep?: boolean }

function Menu({ title, items }: { title: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button type="button" className={`h-[22px] px-2 text-[11.5px] ${open ? 'bg-emr-sel text-white' : 'hover:bg-white/10'}`} onClick={() => setOpen((o) => !o)}>{title}</button>
      {open && (
        <div className="absolute left-0 top-[22px] z-[8000] min-w-[170px] border border-black bg-[#2b3750] py-0.5 shadow-[0_4px_10px_rgba(0,0,0,0.6)]">
          {items.map((it, k) => it.sep ? <div key={k} className="my-0.5 h-px bg-emr-line" /> : (
            <button key={k} type="button" className="flex w-full items-center gap-2 px-2 py-[3px] text-left text-[11.5px] hover:bg-emr-sel" onClick={() => { setOpen(false); it.onClick?.() }}>
              <span className="w-3 text-emr-teal">{it.checked ? '✓' : ''}</span>{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function TopHeader() {
  const { user, windows, openWindow, closeWindow, resetLayout, openDialog, toast, patientId, selectPatient, patients } = useEMR()
  const { info, infoError } = useGuideline()
  const [now, setNow] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t) }, [])
  const hh = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const idx = patients.findIndex((p) => p.id === patientId)

  const winItems: MenuItem[] = [
    ...(Object.keys(WIN_NAMES) as WinId[]).map((id) => ({ label: WIN_NAMES[id], checked: windows[id].open, onClick: () => (windows[id].open ? closeWindow(id) : openWindow(id)) })),
    { label: '', sep: true },
    { label: '창 배치 초기화', onClick: () => { resetLayout(); toast('창 배치를 초기화했습니다.') } },
  ]

  return (
    <div className="hdr-navy flex h-[30px] shrink-0 items-center gap-2 px-2 text-[11.5px]">
      <div className="flex items-center gap-1.5 pr-2">
        <span className="flex h-[20px] w-[20px] items-center justify-center border border-[#7a1010] bg-gradient-to-b from-[#ff6a5e] to-[#c0261b] text-white"><Cross size={14} strokeWidth={3} /></span>
        <div className="leading-[1.05]">
          <div className="text-[12.5px] font-extrabold tracking-tight text-white">익명대학교병원</div>
          <div className="text-[9px] tracking-[0.18em] text-emr-sub">ANONYMOUS UNIV. HOSPITAL · EMR</div>
        </div>
      </div>
      <div className="mx-1 h-[20px] w-px bg-black/60 shadow-[1px_0_0_rgba(255,255,255,0.12)]" />
      <Menu title="파일(F)" items={[{ label: '환자 요약', onClick: () => openDialog('summary') }, { label: '설정', onClick: () => openDialog('setting') }, { label: '', sep: true }, { label: '로그아웃', onClick: () => openDialog('logout') }]} />
      <Menu title="환자(P)" items={[{ label: '환자 목록', onClick: () => openDialog('patients') }, { label: '이전 환자', onClick: () => selectPatient(patients[(idx + patients.length - 1) % patients.length].id) }, { label: '다음 환자', onClick: () => selectPatient(patients[(idx + 1) % patients.length].id) }, { label: '', sep: true }, { label: '메모', onClick: () => openDialog('memo') }, { label: 'CVR', onClick: () => openDialog('cvr') }]} />
      <Menu title="창(W)" items={winItems} />
      <Menu title="도구(T)" items={[{ label: '임상지침 AI 열기', onClick: () => openWindow('ai') }, { label: '오더 항목추가', onClick: () => openDialog('neworder') }, { label: '진료기록 작성', onClick: () => openDialog('newnote') }]} />
      <Menu title="도움말(H)" items={[{ label: '시스템 정보', onClick: () => toast('익명대학교병원 EMR 시연 버전 — 모든 데이터는 가상입니다.') }]} />

      <div className="flex-1" />
      <div className="flex items-center gap-3 text-emr-sub">
        <span>접속자 <b className="text-white">{user.name} {user.title}</b> ({user.dept})</span>
        <span>최근 접속 <b className="text-white">{todayISO.replace(/-/g, '.')} 08:41</b></span>
        <span>IP <b className="text-white">{user.ip}</b> ({user.host})</span>
        <span className="flex items-center gap-1" title="EMR 시스템 상태"><Activity size={12} className="text-emr-ok" /> EMR <b className="text-emr-ok">정상</b></span>
        <span className="flex items-center gap-1" title={infoError ?? (info ? `${info.llm} · ${info.reranker}` : '확인 중')}>
          <Bot size={12} className={info ? 'text-emr-teal' : infoError ? 'text-emr-bad' : 'text-emr-sub'} /> 지침 AI <b className={info ? 'text-emr-teal' : infoError ? 'text-emr-bad' : ''}>{info ? '연결됨' : infoError ? '끊김' : '확인중'}</b>
        </span>
        <span className="rounded-sm border border-black/60 bg-black/30 px-1.5 text-white">{hh}</span>
      </div>
      <div className="flex gap-0.5">
        <button type="button" className="btn" onClick={() => openDialog('setting')}><Settings size={11} /> 설정</button>
        <button type="button" className="btn" onClick={() => openDialog('logout')}><LogOut size={11} /> 로그아웃</button>
      </div>
    </div>
  )
}
