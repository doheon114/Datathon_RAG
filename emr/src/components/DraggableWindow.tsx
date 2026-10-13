import type { ReactNode } from 'react'
import { Rnd } from 'react-rnd'
import { Maximize2, Minimize2, Minus, X } from 'lucide-react'
import { useEMR } from '../state/EMRContext'
import type { WinId } from '../types'

interface Props {
  id: WinId
  title: string
  icon?: ReactNode
  active: boolean
  children: ReactNode
  minW?: number
  minH?: number
}

/** 제목바 드래그 이동 · 크기 조절 · 최소화/최대화/닫기 · 더블클릭 최대화/복원 · 포커스 시 앞으로 */
export default function DraggableWindow({ id, title, icon, active, children, minW = 300, minH = 160 }: Props) {
  const { windows, workspace, setRect, focusWindow, toggleMaximize, toggleMinimize, closeWindow } = useEMR()
  const w = windows[id]
  if (!w.open || w.minimized) return null
  const r = w.maximized ? { x: 0, y: 0, w: workspace.w, h: workspace.h } : w.rect

  return (
    <Rnd
      bounds="parent"
      size={{ width: r.w, height: r.h }}
      position={{ x: r.x, y: r.y }}
      minWidth={minW}
      minHeight={minH}
      dragHandleClassName="win-drag"
      cancel=".win-ctl"
      disableDragging={w.maximized}
      enableResizing={!w.maximized}
      style={{ zIndex: w.z }}
      onMouseDown={() => focusWindow(id)}
      onDragStart={() => focusWindow(id)}
      onDragStop={(_e, d) => setRect(id, { ...w.rect, x: d.x, y: d.y })}
      onResizeStart={() => focusWindow(id)}
      onResizeStop={(_e, _dir, ref, _delta, pos) => setRect(id, { x: pos.x, y: pos.y, w: ref.offsetWidth, h: ref.offsetHeight })}
    >
      <div className="win-frame h-full w-full">
        <div className={`win-drag title-blue flex h-[22px] shrink-0 cursor-default items-center justify-between px-1.5 text-[12px] font-bold ${active ? '' : 'inactive'}`} onDoubleClick={() => toggleMaximize(id)}>
          <span className="flex min-w-0 items-center gap-1.5 truncate">{icon}{title}</span>
          <span className="flex shrink-0 gap-[3px]">
            <button type="button" className="win-ctl" title="최소화" onClick={() => toggleMinimize(id)}><Minus size={11} /></button>
            <button type="button" className="win-ctl" title={w.maximized ? '이전 크기' : '최대화'} onClick={() => toggleMaximize(id)}>{w.maximized ? <Minimize2 size={10} /> : <Maximize2 size={10} />}</button>
            <button type="button" className="win-ctl close" title="닫기" onClick={() => closeWindow(id)}><X size={11} /></button>
          </span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </Rnd>
  )
}
