import { Fragment, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { BookOpen } from 'lucide-react'
import type { Marks, Passage } from '../../api/guidelineApi'
import { parseTable } from '../../api/guidelineApi'

/** **굵게** 와 [n] 인용 칩을 렌더링한다. */
export interface CiteHandlers { onCite?: (n: number) => void; onEnter?: (n: number, el: HTMLElement) => void; onLeave?: () => void }

function Inline({ text, onCite, onEnter, onLeave }: { text: string } & CiteHandlers) {
  const out: ReactNode[] = []
  const re = /\*\*(.+?)\*\*|\[(\d+)\]/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1] !== undefined) out.push(<strong key={k++}>{m[1]}</strong>)
    else { const n = +m[2]; out.push(<button key={k++} type="button" className="cite-chip" style={onCite ? undefined : { cursor: 'default', opacity: 0.8 }}
        onMouseEnter={(e) => onEnter?.(n, e.currentTarget)} onMouseLeave={() => onLeave?.()} onClick={() => onCite?.(n)}>{n}</button>) }
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return <>{out}</>
}

/** AI 답변: 본문은 줄바꿈 유지, '|' 로 시작하는 연속 줄은 표로 그린다. */
export function AnswerView({ text, streaming, onCite, onEnter, onLeave }: { text: string; streaming?: boolean } & CiteHandlers) {
  const blocks: ReactNode[] = []
  let buf: string[] = []
  let tbl: string[] = []
  const flushText = () => { if (buf.length) { blocks.push(<span key={`t${blocks.length}`}><Inline text={buf.join('\n')} onCite={onCite} onEnter={onEnter} onLeave={onLeave} /></span>); buf = [] } }
  const flushTable = () => {
    if (!tbl.length) return
    const rows = tbl.map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())).filter((r) => !r.every((c) => /^:?-{3,}:?$/.test(c)))
    const [head, ...body] = rows
    blocks.push(
      <div key={`b${blocks.length}`} className="tbl-wrap my-1" style={{ whiteSpace: 'normal' }}>
        <table className="tbl-md" style={{ minWidth: 0 }}>
          <thead><tr>{head.map((c, i) => <th key={i}><Inline text={c} onCite={onCite} onEnter={onEnter} onLeave={onLeave} /></th>)}</tr></thead>
          <tbody>{body.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}><Inline text={c} onCite={onCite} onEnter={onEnter} onLeave={onLeave} /></td>)}</tr>)}</tbody>
        </table>
      </div>,
    )
    tbl = []
  }
  for (const ln of text.split('\n')) {
    if (/^\s*\|/.test(ln)) { flushText(); tbl.push(ln) } else { flushTable(); buf.push(ln) }
  }
  flushText(); flushTable()
  return <div className="ai-ans selectable">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}{streaming && <span className="caret" />}</div>
}

/** 인용 번호에 마우스를 올렸을 때만 뜨는 근거 팝업: 답변이 실제로 근거로 삼은 문장(표는 행)만 보여 준다. */
export function CitePopover({ p, marks, rect, ready }: { p: Passage; marks?: Marks; rect: DOMRect; ready: boolean }) {
  const W = 440
  const vw = window.innerWidth, vh = window.innerHeight
  const left = Math.max(8, Math.min(rect.left - 20, vw - W - 8))
  const below = rect.bottom + 8
  const placeAbove = below + 240 > vh && rect.top > 260
  const style: React.CSSProperties = placeAbove ? { left, bottom: vh - rect.top + 8, width: W } : { left, top: below, width: W }
  let body: ReactNode
  if (p.kind === 'table') {
    const { caption, rows } = parseTable(p.text)
    const hit = new Set(marks?.units ?? [])
    const [head, ...rest] = rows
    const pick = ready && hit.size ? rest.map((r, i) => ({ r, i: i + 1 })).filter((x) => hit.has(x.i)) : rest.slice(0, 3).map((r, i) => ({ r, i: i + 1 }))
    body = rows.length ? (
      <div>
        {caption && <div className="mb-1 font-bold">{caption}</div>}
        <div className="tbl-wrap"><table className="tbl-md" style={{ minWidth: 0 }}>
          <thead><tr className={hit.has(0) && ready ? 'hit' : ''}>{head.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
          <tbody>{pick.map((x) => <tr key={x.i} className="hit">{x.r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
        </table></div>
      </div>
    ) : <div className="whitespace-pre-wrap">{p.text.slice(0, 300)}</div>
  } else if (ready && marks?.spans?.length) {
    body = <div className="flex flex-col gap-1.5">{[...marks.spans].sort((x, y) => x[0] - y[0]).map(([a, b], i) => <div key={i}><mark className="key">{p.text.slice(a, b)}</mark></div>)}</div>
  } else {
    body = <div className="whitespace-pre-wrap">{p.text.slice(0, 320)}{p.text.length > 320 ? '…' : ''}</div>
  }
  return createPortal(
    <div className="cite-pop" style={style} role="tooltip">
      <div className="mb-1 flex flex-wrap items-center gap-x-2 text-[10.5px] text-emr-sub">
        <span className="cite-chip" style={{ cursor: 'default' }}>{p.n}</span>
        <b className="text-emr-text">{p.source_name}</b>
        <span>p.{p.page}</span>
        {p.kind === 'table' && <span className="tag" style={{ background: '#8a5ccc', minWidth: 22 }}>표</span>}
      </div>
      <div className="selectable text-[11.5px] leading-[1.65]">{body}</div>
      <div className="mt-1.5 flex items-center gap-1 border-t border-[#00bcd455] pt-1 text-[10.5px] text-[#7fe6f5]"><BookOpen size={10} /> {ready ? '클릭하면 원문 PDF에서 이 문장이 열립니다' : '답변이 끝나면 클릭해 원문 PDF를 열 수 있습니다'}</div>
    </div>,
    document.querySelector('.emr-root') ?? document.body,
  )
}
