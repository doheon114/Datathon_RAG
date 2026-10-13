import { useEffect, useRef } from 'react'
import { Bot, ClipboardList, FlaskConical, Pill, LayoutGrid } from 'lucide-react'
import { useEMR } from '../state/EMRContext'
import type { WinId } from '../types'
import DraggableWindow from './DraggableWindow'
import ClinicalNotesWindow from './windows/ClinicalNotesWindow'
import OrdersWindow from './windows/OrdersWindow'
import LabResultsWindow from './windows/LabResultsWindow'
import GuidelineAIWindow from './windows/GuidelineAIWindow'

const META: Record<WinId, { title: string; icon: React.ReactNode }> = {
  notes: { title: '진료기록조회', icon: <ClipboardList size={12} /> },
  orders: { title: '오더조회', icon: <Pill size={12} /> },
  labs: { title: '검사결과조회', icon: <FlaskConical size={12} /> },
  ai: { title: '임상지침 AI — 근거 기반 질의응답', icon: <Bot size={12} /> },
}

/** MDI 작업영역: 창 배치·포커스·작업표시줄을 관리한다. */
export default function WorkspaceManager() {
  const { windows, setWorkspace, toggleMinimize, openWindow, focusWindow, resetLayout, bundle, selectedEncounter } = useEMR()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setWorkspace(el.clientWidth, el.clientHeight))
    ro.observe(el)
    setWorkspace(el.clientWidth, el.clientHeight)
    return () => ro.disconnect()
  }, [setWorkspace])

  const ids = Object.keys(META) as WinId[]
  const visible = ids.filter((i) => windows[i].open && !windows[i].minimized)
  const topId = visible.reduce<WinId | null>((best, i) => (best === null || windows[i].z > windows[best].z ? i : best), null)

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-emr-bg">
      <div ref={ref} className="relative min-h-0 flex-1 overflow-hidden" style={{ backgroundImage: 'linear-gradient(#1b2538 1px, transparent 1px), linear-gradient(90deg, #1b2538 1px, transparent 1px)', backgroundSize: '24px 24px', backgroundColor: '#18212f' }}>
        <DraggableWindow id="notes" title={META.notes.title} icon={META.notes.icon} active={topId === 'notes'} minW={380}><ClinicalNotesWindow /></DraggableWindow>
        <DraggableWindow id="orders" title={META.orders.title} icon={META.orders.icon} active={topId === 'orders'} minW={380}><OrdersWindow /></DraggableWindow>
        <DraggableWindow id="labs" title={META.labs.title} icon={META.labs.icon} active={topId === 'labs'} minW={380}><LabResultsWindow /></DraggableWindow>
        <DraggableWindow id="ai" title={META.ai.title} icon={META.ai.icon} active={topId === 'ai'} minW={360}><GuidelineAIWindow /></DraggableWindow>
        {!visible.length && <div className="absolute inset-0 flex items-center justify-center text-emr-sub">열려 있는 창이 없습니다. 아래 작업표시줄이나 상단 「창」 메뉴에서 창을 여세요.</div>}
      </div>
      {/* 작업표시줄 */}
      <div className="hdr-navy flex h-[24px] shrink-0 items-center gap-1 border-t border-black px-1">
        <button type="button" className="btn btn-sm" onClick={resetLayout} title="창 배치 초기화"><LayoutGrid size={10} /> 창 정렬</button>
        <span className="mx-1 h-[16px] w-px bg-black/60" />
        {ids.map((id) => {
          const w = windows[id]
          return (
            <button key={id} type="button" data-active={w.open && !w.minimized && topId === id ? 'true' : undefined}
              className={`btn btn-sm ${w.open ? '' : 'opacity-50'}`} style={{ minWidth: 104, justifyContent: 'flex-start' }}
              onClick={() => { if (!w.open) openWindow(id); else if (w.minimized) toggleMinimize(id); else if (topId === id) toggleMinimize(id); else focusWindow(id) }}>
              {META[id].icon}{META[id].title.split(' — ')[0]}{w.minimized ? ' (최소화)' : ''}
            </button>
          )
        })}
        <div className="flex-1" />
        <span className="pr-2 text-[10.5px] text-emr-sub">
          {bundle.patient.name} · {selectedEncounter ? `${selectedEncounter.date.replace(/-/g, '.')} ${selectedEncounter.type}` : '진료 미선택'}
        </span>
      </div>
    </div>
  )
}
