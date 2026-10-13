import { useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardPaste, Copy, Send, Trash2 } from 'lucide-react'
import { useEMR } from '../../state/EMRContext'
import { useGuideline, type Turn } from '../../state/GuidelineContext'
import { buildPatientContext } from '../../api/patientContext'
import { Btn } from '../ui'
import { AnswerView, CitePopover } from './Evidence'

// 예시 질문은 환자 맥락을 붙여 바로 보내는 이 한 개뿐이다
const EXAMPLE = '임상요약을 보았을때, 이 환자에게 furosemide의 처치 유무, 이러한 처치가 적절했나'
const HOVER_MS = 300

interface Hover { turnId: number; n: number; rect: DOMRect }

function TurnView({ t, onEnter, onLeave }: { t: Turn; onEnter: (turnId: number, n: number, el: HTMLElement) => void; onLeave: () => void }) {
  const { openViewer, insertTurn } = useGuideline()
  const { toast } = useEMR()
  const passages = t.passages ?? []
  const cited = passages.filter((p) => t.cited.includes(p.n))
  // 인용 번호를 누르면 원문 PDF 뷰어로 이동 (답변이 끝나 결정적 문장이 정해진 뒤에만)
  const openFor = (n: number) => { const p = passages.find((x) => x.n === n); if (p) openViewer({ passage: p, marks: t.marks[String(n)] }) }
  const streaming = t.status === 'stream' && t.partial.length > 0
  return (
    <div className="mb-3 border-b border-[#3c4962] pb-3">
      <div className="mb-1 flex items-start gap-1.5">
        <span className="mt-[1px] bg-emr-blue px-1 text-[10px] font-bold text-white">Q</span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-white">{t.query}</div>
          <div className="text-[10px] text-[#7fe6f5]">{t.origin}{t.context && <span className="text-emr-sub" title={t.context}> · 환자 맥락 {t.context.length.toLocaleString()}자{t.recordSize ? ` + 기록 ${t.recordSize}줄 검색` : ''} 포함</span>}</div>
        </div>
      </div>
      <div className="ml-[22px]">
        {t.status === 'error' && <div className="text-emr-bad">{t.error}</div>}
        {t.status === 'wait' && <div className="flex items-center gap-2 text-emr-sub"><span className="spin" /> 대기 중…</div>}
        {t.status === 'stream' && !t.partial && <div className="flex items-center gap-2 text-emr-sub"><span className="spin" /> {t.passages ? '답변 작성 중…' : '지침에서 근거를 찾는 중…'}</div>}
        {(streaming || t.status === 'done') && (
          t.refused && t.status === 'done'
            ? <div className="border border-[#8a5a00] bg-[#33290f] p-1.5 text-[#e6b55a]">제공된 자료에서 해당 내용을 찾을 수 없습니다. <span className="text-[10.5px]">(자료에 근거가 없어 답변하지 않습니다)</span>{t.hint && <div className="mt-1 border-t border-[#8a5a0066] pt-1 text-[11px] text-[#ffd59a]">{t.hint}</div>}</div>
            : <AnswerView text={t.status === 'done' ? t.answer ?? '' : t.partial} streaming={streaming}
                onCite={t.status === 'done' ? openFor : undefined} onEnter={(n, el) => onEnter(t.id, n, el)} onLeave={onLeave} />
        )}
        {t.status === 'done' && !!t.recordHits?.length && (
          <details className="mt-1 text-[10.5px] text-emr-sub">
            <summary className="cursor-pointer text-[#7fe6f5]">참조한 환자 기록 {t.recordHits.length}건</summary>
            <ul className="mt-0.5 space-y-0.5 border border-[#4a5870] bg-[#1c2a3d] p-1.5 leading-[1.5] text-emr-text">{t.recordHits.map((h, i) => <li key={i}>{h}</li>)}</ul>
          </details>
        )}
        {t.status === 'done' && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10.5px] text-emr-sub">
            <span>{t.refused ? '근거 없음' : `${cited.length}개 문단 인용`} · {t.seconds}초</span>
            {!t.refused && (
              <Btn sm blue={!t.insertedNoteId} disabled={!!t.insertedNoteId} onClick={() => insertTurn(t.id)} title="진료기록의 지침 근거 항목으로 삽입">
                <ClipboardPaste size={10} /> {t.insertedNoteId ? '삽입됨' : '진료기록에 삽입'}
              </Btn>
            )}
            {!t.refused && <Btn sm onClick={() => { void navigator.clipboard?.writeText(t.answer ?? ''); toast('답변을 복사했습니다.') }}><Copy size={10} /> 복사</Btn>}
          </div>
        )}
      </div>
    </div>
  )
}

export default function GuidelineAIWindow() {
  const { bundle } = useEMR()
  const { info, infoError, sources, setSources, turns, busy, ask, clear } = useGuideline()
  const [text, setText] = useState('')
  const [withCtx, setWithCtx] = useState(true)
  const [showCtx, setShowCtx] = useState(false)
  const [hover, setHover] = useState<Hover | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  // 환자를 바꾸거나 기록이 불러와지면 다시 만든다
  const ctx = useMemo(() => buildPatientContext(bundle), [bundle])

  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [turns])

  // 인용 번호에 0.3초 이상 마우스를 올려 둘 때만 근거 팝업을 연다
  const startHover = (turnId: number, n: number, el: HTMLElement) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setHover({ turnId, n, rect: el.getBoundingClientRect() }), HOVER_MS)
  }
  const endHover = () => { window.clearTimeout(timer.current); setHover(null) }
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const hoverTurn = hover ? turns.find((t) => t.id === hover.turnId) : undefined
  const hoverPassage = hoverTurn?.passages?.find((p) => p.n === hover!.n)

  const send = () => {
    const q = text.trim()
    if (!q) return
    ask(q, withCtx ? '직접 질문 (환자 맥락 포함)' : '직접 질문', withCtx ? ctx : undefined)
    setText('')
    stick.current = true
  }

  const toggleSource = (id: string) => setSources(sources.includes(id) ? (sources.length > 1 ? sources.filter((s) => s !== id) : sources) : [...sources, id])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#243049]">
      <div className="toolbar items-center">
        {info?.sources.map((s) => <Btn key={s.id} sm active={sources.includes(s.id)} onClick={() => toggleSource(s.id)} title={`${s.name} — 인용 우선순위 ${s.priority}, ${s.pages}쪽, 발췌 ${s.chunks}개(표 ${s.tables})`}>{['', '①', '②', '③'][s.priority] ?? ''} {s.name.replace('대한심부전학회 ', '').replace('Heart Failure ', 'HF ').replace('Guidelines', 'GL').replace('Guideline', 'GL')}</Btn>)}
        {!info && <span className="px-1 text-[11px] text-emr-sub">{infoError ? `지침 서버에 연결할 수 없습니다 (${infoError})` : '지침 서버 확인 중…'}</span>}
        <span className="flex-1" />
        <Btn sm onClick={clear} title="대화 지우기"><Trash2 size={10} /></Btn>
      </div>
      <div className="border-b border-black/60 bg-[#1c2a3d] px-2 py-[2px] text-[10.5px] text-emr-sub">
        선택한 자료에서 찾은 근거로만 답하며 인용 우선순위는 ESC → KSHF → AHA 입니다. 답변의 <span className="cite-chip" style={{ cursor: 'default' }}>1</span> 인용 번호에 마우스를 잠시 올리면 근거 문장이 보이고, 클릭하면 원문 PDF가 열립니다.
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-auto p-2 text-[12px]"
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; if (hover) endHover() }}>
        {!turns.length && (
          <div>
            <div className="mb-1 text-[11px] text-emr-sub">예시 질문 <span className="text-[#7d8aa0]">(클릭하면 환자 임상 요약과 함께 바로 질문합니다)</span></div>
            <div className="flex flex-col gap-1"><button type="button" className="btn h-auto justify-start whitespace-normal py-[3px] text-left" onClick={() => { setWithCtx(true); ask(EXAMPLE, '예시 질문 (환자 맥락 포함)', ctx); stick.current = true }}>{EXAMPLE}</button></div>
            <div className="mt-3 border border-[#4a5870] bg-[#1c2a3d] p-1.5 text-[10.5px] leading-[1.55] text-emr-sub">
              <b className="text-emr-text">EMR 곳곳의 「지침」「해석」「지침근거」 버튼</b>이 이 창으로 질문을 보냅니다.<br />
              진료기록 Plan · 오더조회 약물 · 검사결과 이상값 · Problem List — 직접 찾아보던 지침 확인을 대체합니다.
            </div>
          </div>
        )}
        {turns.map((t) => <TurnView key={t.id} t={t} onEnter={startHover} onLeave={endHover} />)}
      </div>

      <div className="border-t border-black bg-[#2b3750] p-1.5">
        <div className="flex gap-1">
          <textarea className="inp min-h-[38px] flex-1 resize-none" rows={2} maxLength={2000} value={text} placeholder="지침에 질문 (Enter 전송, Shift+Enter 줄바꿈)"
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }} />
          <Btn blue className="h-auto w-[54px] flex-col justify-center" onClick={send} disabled={!text.trim()}><Send size={13} />질문</Btn>
        </div>
        <label className="mt-1 flex cursor-pointer items-center gap-1 text-[10.5px] text-emr-sub">
          <input type="checkbox" checked={withCtx} onChange={(e) => setWithCtx(e.target.checked)} />
          환자 임상 요약을 질문에 포함 <span className="text-[#7d8aa0]">(요약 {ctx.text.length.toLocaleString()}자 + 전체 진료기록 {ctx.record.length}줄에서 질문과 관련된 내용을 검색)</span>
          <button type="button" className="ml-1 text-[#7fe6f5] underline" onClick={(e) => { e.preventDefault(); setShowCtx((v) => !v) }}>{showCtx ? '숨기기' : '포함 내용 보기'}</button>
        </label>
        {showCtx && <pre className="mt-1 max-h-[180px] overflow-auto whitespace-pre-wrap border border-[#4a5870] bg-[#1c2a3d] p-1.5 text-[10.5px] leading-[1.5] text-emr-text">{ctx.text}</pre>}
        {busy && <div className="mt-0.5 flex items-center gap-1 text-[10.5px] text-emr-sub"><span className="spin" /> 처리 중…</div>}
      </div>

      {hover && hoverPassage && <CitePopover p={hoverPassage} marks={hoverTurn?.marks[String(hover.n)]} rect={hover.rect} ready={hoverTurn?.status === 'done'} />}
    </div>
  )
}
