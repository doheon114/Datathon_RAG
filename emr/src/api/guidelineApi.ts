// 임상지침 AI(RAG) 서버 클라이언트. 같은 서버(/api)를 쓰며, 개발 중에는 Vite 프록시가 8800 으로 넘긴다.
import type { PatientCtx } from './patientContext'

export interface GuidelineSource {
  id: string
  name: string
  lang: string
  pages: number
  chunks: number
  tables: number
  /** 인용 우선순위 (1이 가장 높음): ESC > KSHF > AHA */
  priority: number
}

export interface GuidelineInfo {
  llm: string
  reranker: string
  public: boolean
  viewer: boolean
  sources: GuidelineSource[]
}

export interface Passage {
  n: number
  id: number
  text: string
  score: number
  source: string
  source_name: string
  page: number
  kind: 'text' | 'table'
}

export interface Marks {
  kind: 'text' | 'table'
  units: number[]
  spans?: [number, number][]
}

export interface DoneEvent {
  answer: string
  cited: number[]
  marks: Record<string, Marks>
  refused: boolean
  seconds: number
  /** 거절 사유 안내 (예: 환자 정보가 전달되지 않음) */
  hint?: string
}

export interface AskHandlers {
  onPassages: (passages: Passage[], refused: boolean) => void
  onToken: (t: string) => void
  /** 서버가 환자 기록에서 질문과 관련해 찾아낸 줄 */
  onRecord?: (hits: string[]) => void
  onDone: (d: DoneEvent) => void
  onError: (msg: string) => void
}

const BASE = '/api'

export async function getInfo(): Promise<GuidelineInfo> {
  const r = await fetch(`${BASE}/info`)
  if (!r.ok) throw new Error(`지침 서버 응답 오류 (${r.status})`)
  return r.json()
}

async function errorText(r: Response): Promise<string> {
  let msg = (await r.text()).slice(0, 200)
  try {
    const j = JSON.parse(msg)
    if (typeof j.detail === 'string') msg = j.detail
  } catch { /* 본문이 JSON 이 아님 */ }
  return msg || `오류 (${r.status})`
}

/** 질문을 보내고 NDJSON 스트림(passages → token… → done)을 처리한다. */
export async function askGuideline(query: string, sources: string[], h: AskHandlers, signal?: AbortSignal, ctx?: PatientCtx): Promise<void> {
  try {
    const res = await fetch(`${BASE}/ask`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ query: query.slice(0, 2000), sources, summary: ctx?.summary.slice(0, 300) ?? '', context: ctx?.text ?? '', record: ctx?.record ?? [] }),
    })
    if (!res.ok) { h.onError(await errorText(res)); return }
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        const ev = JSON.parse(line)
        if (ev.type === 'passages') h.onPassages(ev.passages, ev.refused)
        else if (ev.type === 'record') h.onRecord?.(ev.hits ?? [])
        else if (ev.type === 'token') h.onToken(ev.t)
        else if (ev.type === 'done') h.onDone({ answer: ev.answer, cited: ev.cited, marks: ev.marks ?? {}, refused: ev.refused, seconds: ev.seconds, hint: ev.hint || undefined })
        else if (ev.type === 'error') h.onError(ev.message)
      }
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') h.onError(String((e as Error).message || e))
  }
}

export interface LocateResult {
  source: string
  name: string
  page: number
  total: number
  kind: string
  w: number
  h: number
  rects: number[][]
  focus: number | null
  precise: boolean
}

export async function locate(id: number, units?: number[]): Promise<LocateResult> {
  const q = units && units.length ? `&units=${units.join(',')}` : ''
  const r = await fetch(`${BASE}/locate?id=${id}${q}`)
  if (!r.ok) throw new Error(await errorText(r))
  return r.json()
}

export async function pageSizes(source: string): Promise<number[][]> {
  const r = await fetch(`${BASE}/pagesizes?source=${encodeURIComponent(source)}`)
  if (!r.ok) throw new Error(await errorText(r))
  return (await r.json()).sizes
}

export const pageImageUrl = (source: string, page: number) => `${BASE}/pdfpage?source=${encodeURIComponent(source)}&page=${page}`

// ---- 응답 텍스트 도우미 ----
export function splitUnits(text: string): string[] {
  return text.split('\n')
}

/** 마크다운 표 청크 -> {캡션, 행들}. 서버의 단위 번호와 같게 0=머리글 행, 1.. 본문 행 */
export function parseTable(text: string): { caption: string; rows: string[][] } {
  const lines = text.split('\n').filter((l) => l.trim())
  let caption = ''
  if (lines[0]?.startsWith('**')) caption = lines.shift()!.replace(/^\*\*|\*\*$/g, '')
  const rows = lines
    .filter((l) => l.startsWith('|') && !/^\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(l))
    .map((l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
  return { caption, rows }
}
