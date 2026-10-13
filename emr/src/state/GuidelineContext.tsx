import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { askGuideline, getInfo, type GuidelineInfo, type Marks, type Passage } from '../api/guidelineApi'
import type { GuidelineInsert } from '../types'
import type { PatientCtx } from '../api/patientContext'
import { useEMR } from './EMRContext'

export interface Turn {
  id: number
  query: string
  /** 질문이 시작된 EMR 위치 (예: 오더조회 › Apixaban) */
  origin: string
  /** 질문과 함께 보낸 환자 맥락 */
  context?: string
  /** 환자 기록 전체 줄 수 (RAG 검색 대상) */
  recordSize?: number
  /** 서버가 환자 기록에서 찾아 답변에 쓴 줄 */
  recordHits?: string[]
  status: 'wait' | 'stream' | 'done' | 'error'
  partial: string
  answer: string | null
  passages: Passage[] | null
  cited: number[]
  marks: Record<string, Marks>
  refused: boolean
  hint?: string
  seconds: number
  error?: string
  insertedNoteId?: string
}

export interface ViewerTarget { passage: Passage; marks?: Marks }

interface GuidelineValue {
  info: GuidelineInfo | null
  infoError: string | null
  sources: string[]
  setSources: (ids: string[]) => void
  turns: Turn[]
  busy: boolean
  ask: (query: string, origin?: string, ctx?: PatientCtx) => number
  insertTurn: (turnId: number) => void
  clear: () => void
  viewer: ViewerTarget | null
  openViewer: (t: ViewerTarget) => void
  closeViewer: () => void
}

const Ctx = createContext<GuidelineValue | null>(null)
export const useGuideline = () => {
  const v = useContext(Ctx)
  if (!v) throw new Error('GuidelineProvider 밖에서 useGuideline 를 호출했습니다.')
  return v
}

export function GuidelineProvider({ children }: { children: ReactNode }) {
  const { openWindow, insertGuideline, toast, patientId } = useEMR()
  const [info, setInfo] = useState<GuidelineInfo | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [sources, setSources] = useState<string[]>([])
  const [turns, setTurns] = useState<Turn[]>([])
  const [viewer, setViewer] = useState<ViewerTarget | null>(null)
  const idRef = useRef(1)
  const turnsRef = useRef<Turn[]>([])
  turnsRef.current = turns
  const queue = useRef<Promise<void>>(Promise.resolve())
  // 환자가 바뀌면 대화를 초기화한다: 진행 중인 질문은 끊고, 대기 중인 질문은 보내지 않는다
  const generation = useRef(0)
  const abortRef = useRef(new AbortController())
  useEffect(() => {
    generation.current++
    abortRef.current.abort()
    abortRef.current = new AbortController()
    setTurns([])
    setViewer(null)
  }, [patientId])
  const [busyCount, setBusyCount] = useState(0)

  useEffect(() => {
    let alive = true
    const load = () => getInfo().then((i) => { if (alive) { setInfo(i); setInfoError(null); setSources((s) => (s.length ? s : i.sources.map((x) => x.id))) } })
      .catch((e) => { if (alive) setInfoError(String(e.message || e)) })
    load()
    const t = setInterval(load, 30000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const update = useCallback((id: number, fn: (t: Turn) => Turn) => setTurns((s) => s.map((t) => (t.id === id ? fn(t) : t))), [])

  const ask = useCallback((query: string, origin = '직접 질문', ctx?: PatientCtx) => {
    const id = idRef.current++
    const turn: Turn = { id, query, origin, context: ctx?.text, recordSize: ctx?.record.length, status: 'wait', partial: '', answer: null, passages: null, cited: [], marks: {}, refused: false, seconds: 0 }
    setTurns((s) => [...s, turn])
    openWindow('ai')
    setBusyCount((c) => c + 1)
    const gen = generation.current
    const signal = abortRef.current.signal
    // 서버는 한 번에 하나만 처리하므로 질문을 순서대로 보낸다
    queue.current = queue.current.then(() => new Promise<void>((resolve) => {
      if (gen !== generation.current) { resolve(); return }  // 환자가 바뀐 뒤라 보내지 않는다
      update(id, (t) => ({ ...t, status: 'stream' }))
      void askGuideline(query, sources, {
        onPassages: (passages, refused) => update(id, (t) => ({ ...t, passages, refused })),
        onRecord: (hits) => update(id, (t) => ({ ...t, recordHits: hits })),
        onToken: (tok) => update(id, (t) => ({ ...t, partial: t.partial + tok })),
        onDone: (d) => { update(id, (t) => ({ ...t, status: 'done', answer: d.answer, passages: d.passages ?? t.passages, cited: d.cited, marks: d.marks, refused: d.refused, seconds: d.seconds, hint: d.hint })); resolve() },
        onError: (msg) => { update(id, (t) => ({ ...t, status: 'error', error: msg })); resolve() },
      }, signal, ctx).finally(resolve)
    })).finally(() => setBusyCount((c) => c - 1))
    return id
  }, [openWindow, sources, update])

  const insertTurn = useCallback((turnId: number) => {
    const t = turnsRef.current.find((x) => x.id === turnId)
    if (!t || t.answer === null || t.refused) return
    const ev = (t.passages ?? []).filter((p) => t.cited.includes(p.n)).map((p) => {
      const m = t.marks[String(p.n)]
      let text = p.text
      if (m && m.kind === 'text' && m.spans?.length) text = m.spans.map(([a, b]) => p.text.slice(a, b)).join(' … ')
      else if (m && m.kind === 'table') {
        const rows = p.text.split('\n').filter((l) => l.startsWith('|') && !/^\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(l))
        text = m.units.map((u) => rows[u]).filter(Boolean).join('\n')
      }
      return { n: p.n, sourceName: p.source_name, page: p.page, text: text.length > 360 ? text.slice(0, 360) + '…' : text }
    })
    const ins: GuidelineInsert = { id: `ins-${turnId}`, query: t.query, answer: t.answer, evidence: ev, at: new Date().toISOString().slice(0, 16).replace('T', ' ') }
    const noteId = insertGuideline(ins)
    if (noteId) { update(turnId, (x) => ({ ...x, insertedNoteId: noteId })); toast('지침 근거를 진료기록에 삽입했습니다.') }
    else toast('삽입할 진료기록이 없습니다.', 'warn')
  }, [insertGuideline, toast, update])

  const value: GuidelineValue = {
    info, infoError, sources, setSources, turns, busy: busyCount > 0, ask, insertTurn, clear: () => setTurns([]),
    viewer, openViewer: setViewer, closeViewer: () => setViewer(null),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
