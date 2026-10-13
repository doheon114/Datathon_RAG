import { ClipboardList, HeartPulse, LogOut, Menu as MenuIcon, Settings, StickyNote, Users } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useEMR } from '../state/EMRContext'
import type { WinId } from '../types'

const WIN_NAMES: Record<WinId, string> = { notes: '진료기록조회', orders: '오더조회', labs: '검사결과조회', ai: '임상지침 AI' }

function Item({ icon, label, onClick, active }: { icon: ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={`group flex w-full flex-col items-center gap-[3px] border-b border-black/50 py-2.5 text-[10px] leading-none ${active ? 'bg-gradient-to-r from-[#0a78cc] to-[#0069bf] text-white' : 'text-emr-sub hover:bg-white/10 hover:text-white'}`}>
      <span className="flex h-[26px] w-[26px] items-center justify-center border border-black/50 bg-gradient-to-b from-[#4a5a78] to-[#2c384e] text-emr-text group-hover:from-[#5e7192]">{icon}</span>
      {label}
    </button>
  )
}

export default function Sidebar() {
  const { openDialog, windows, openWindow, closeWindow } = useEMR()
  const [menu, setMenu] = useState(false)
  return (
    <div className="relative flex w-[72px] shrink-0 flex-col border-r border-black bg-gradient-to-b from-[#1c2639] to-[#141c2b]">
      <Item icon={<LogOut size={15} />} label="Logout" onClick={() => openDialog('logout')} />
      <Item icon={<MenuIcon size={15} />} label="Menu" active={menu} onClick={() => setMenu((m) => !m)} />
      <Item icon={<Users size={15} />} label="Patient List" onClick={() => openDialog('patients')} />
      <Item icon={<ClipboardList size={15} />} label="Patient Summary" onClick={() => openDialog('summary')} />
      <Item icon={<StickyNote size={15} />} label="Memo" onClick={() => openDialog('memo')} />
      <Item icon={<HeartPulse size={15} />} label="CVR" onClick={() => openDialog('cvr')} />
      <div className="flex-1" />
      <Item icon={<Settings size={15} />} label="Setting" onClick={() => openDialog('setting')} />
      {menu && (
        <div className="absolute left-[72px] top-[44px] z-[8000] w-[150px] border border-black bg-[#2b3750] py-0.5 shadow-[0_4px_10px_rgba(0,0,0,0.6)]" onMouseLeave={() => setMenu(false)}>
          <div className="px-2 py-[3px] text-[10px] font-bold text-emr-teal">작업 창</div>
          {(Object.keys(WIN_NAMES) as WinId[]).map((id) => (
            <button key={id} type="button" className="flex w-full items-center gap-2 px-2 py-[3px] text-left text-[11.5px] hover:bg-emr-sel"
              onClick={() => { windows[id].open ? closeWindow(id) : openWindow(id); setMenu(false) }}>
              <span className="w-3 text-emr-teal">{windows[id].open ? '✓' : ''}</span>{WIN_NAMES[id]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
