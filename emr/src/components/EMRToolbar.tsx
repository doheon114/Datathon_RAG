import type { ReactNode } from 'react'
import { Btn } from './ui'

export interface ToolItem {
  label: string
  icon?: ReactNode
  active?: boolean
  onClick?: () => void
  title?: string
  sep?: boolean
  right?: boolean
}

/** 창 상단 툴바: 베벨 버튼 줄. sep 항목은 구분선. */
export default function EMRToolbar({ items, children }: { items: ToolItem[]; children?: ReactNode }) {
  return (
    <div className="toolbar">
      {items.map((it, k) => it.sep
        ? <span key={k} className="toolbar-sep" />
        : <Btn key={it.label + k} active={it.active} onClick={it.onClick} title={it.title}>{it.icon}{it.label}</Btn>)}
      {children}
    </div>
  )
}
