import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { X } from 'lucide-react'
import type { OrderCategory } from '../types'

export function Btn({ active, blue, sm, ico, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; blue?: boolean; sm?: boolean; ico?: boolean }) {
  return <button type="button" data-active={active ? 'true' : undefined} className={`btn ${blue ? 'btn-blue' : ''} ${sm ? 'btn-sm' : ''} ${ico ? 'btn-ico' : ''} ${className}`} {...rest} />
}

/** 기간·분류 필터 (한 줄 버튼 묶음) */
export function Segment<T extends string>({ items, value, onChange }: { items: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex">
      {items.map((it) => <Btn key={it} sm active={value === it} onClick={() => onChange(it)} style={{ marginLeft: -1 }}>{it}</Btn>)}
    </div>
  )
}

export const CAT_COLOR: Record<OrderCategory, string> = {
  약물: '#2f86d6', 혈액검사: '#3aa656', 영상검사: '#8a5ccc', 생리검사: '#1fa6a6', 주사: '#d98a12', 처치: '#7d8aa0', 수술: '#d23a30',
}

export function CatTag({ cat }: { cat: OrderCategory }) {
  return <span className="tag" style={{ background: CAT_COLOR[cat] }}>{cat}</span>
}

export const VISIT_COLOR: Record<string, string> = { 외래: '#2f86d6', 입원: '#d98a12', 응급: '#d23a30', 퇴원: '#7d8aa0' }
export function VisitTag({ v }: { v: string }) {
  return <span className="tag" style={{ background: VISIT_COLOR[v] ?? '#7d8aa0', minWidth: 28 }}>{v}</span>
}

export function PanelTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="hdr-teal flex h-[20px] items-center justify-between px-2 text-[11.5px] font-bold">
      <span className="truncate">{children}</span>
      {right}
    </div>
  )
}

/** 시스템 팝업 (파란 타이틀바) */
export function Modal({ title, onClose, width = 520, children, footer }: { title: string; onClose: () => void; width?: number; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/50" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="win-frame" style={{ width, maxWidth: '96vw', maxHeight: '88vh' }}>
        <div className="title-blue flex h-[22px] shrink-0 items-center justify-between px-2 text-[12px] font-bold">
          <span>{title}</span>
          <button type="button" className="win-ctl close" onClick={onClose} aria-label="닫기"><X size={11} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2 selectable">{children}</div>
        {footer && <div className="flex justify-end gap-1 border-t border-black/40 bg-[#2a3650] p-1.5">{footer}</div>}
      </div>
    </div>
  )
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="p-4 text-center text-[11px] text-emr-sub">{children}</div>
