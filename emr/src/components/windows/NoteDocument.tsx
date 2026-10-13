import { Bot, Copy, Expand, Pencil, Trash2 } from 'lucide-react'
import type { Note } from '../../types'
import { useEMR } from '../../state/EMRContext'
import { useGuideline } from '../../state/GuidelineContext'

export const KIND_COLOR: Record<Note['kind'], string> = { 초진: '#1d6fd6', 경과: '#3a6fb0', 입원: '#d98a12', 퇴원: '#6f7f98', 회신: '#8a5ccc', 수술: '#d23a30', 간호: '#2a9d8f' }
export const fmtDash = (d: string) => d
export const fmtDot = (d: string) => d.replace(/-/g, '.')

/** 목록 머리글에 쓰는 기록 종류 이름 (예: 외래초진, 외래경과, 입원기록, 퇴원요약, 수술기록, 간호기록, 타과회신) */
export function recordLabel(n: Note): string {
  switch (n.kind) {
    case '초진': return `${n.visit}초진`
    case '경과': return `${n.visit}경과`
    case '입원': return '입원기록'
    case '퇴원': return '퇴원요약'
    case '수술': return '수술기록'
    case '간호': return '간호기록'
    default: return '진료회신'
  }
}

export const recordHeadText = (n: Note) => `${recordLabel(n)} ${n.dept}(${n.author}) ${n.date}`

export function noteToText(n: Note): string {
  return `${recordHeadText(n)} [${n.hospital}]\n${n.title}\n\n` + n.sections.map((s) => `${s.title}\n${s.body}`).join('\n\n')
}

/** 기록 본문: 파란 섹션 제목 + 흰 본문. Plan 항목에는 지침근거 버튼이 붙는다. */
export function NoteBody({ note }: { note: Note }) {
  const { ask } = useGuideline()
  return (
    <>
      {note.sections.map((s) => (
        <div key={s.title}>
          <div className="rec-sec-h">{s.title}</div>
          {s.title.startsWith('Plan') && note.plan.length ? (
            <ol className="m-0 list-none p-0">
              {note.plan.map((it, k) => (
                <li key={k} className="flex items-start gap-1.5 py-[1px] leading-[1.6]">
                  <span className="w-[16px] shrink-0 text-right text-[#9bbcf0]">{k + 1}.</span>
                  <span className="min-w-0 flex-1">{it.text}</span>
                  {it.query && <button type="button" className="tag-ai shrink-0" title={`지침 근거 질의: ${it.query}`} onClick={() => ask(it.query!, `진료기록 › ${recordLabel(note)} Plan ${k + 1}`)}><Bot size={10} /> 지침근거</button>}
                </li>
              ))}
            </ol>
          ) : <div className="rec-sec-b">{s.body}</div>}
        </div>
      ))}
      {note.inserts.map((ins) => (
        <div key={ins.id} className="rec-ai">
          <div className="flex items-center gap-1 font-bold text-[#7fe6f5]"><Bot size={12} /> 지침 근거 (AI 삽입 · {ins.at})</div>
          <div className="mb-1 text-[0.92em] text-[#9bbcf0]">질의: {ins.query}</div>
          <div className="whitespace-pre-wrap leading-[1.55]">{ins.answer}</div>
          <div className="mt-1.5 border-t border-[#00bcd455] pt-1">
            {ins.evidence.map((e) => <div key={e.n} className="text-[0.92em] text-[#cdd8e8]"><b className="text-[#7fe6f5]">[{e.n}]</b> {e.sourceName}, p.{e.page} — “{e.text}”</div>)}
          </div>
        </div>
      ))}
    </>
  )
}

/** 펼친 기록 하나: 이탤릭 파란 제목 + 복사/수정/삭제/전체보기 + 본문 */
export default function NoteDocument({ note, hideFull }: { note: Note; hideFull?: boolean }) {
  const { openDialog, toast } = useEMR()
  return (
    <div className="rec-doc selectable">
      <div className="rec-doc-top">
        <div className="rec-title">{recordLabel(note)} {note.dept}({note.author}) ({note.date})<span className="ml-2 text-[0.8em] not-italic text-[#9bbcf0]">{note.time}</span></div>
        <div className="rec-acts">
          <button type="button" className="rec-act copy" onClick={() => { void navigator.clipboard?.writeText(noteToText(note)); toast('기록 내용을 복사했습니다.') }}><Copy size={11} /> 복사</button>
          <button type="button" className="rec-act edit" disabled={!note.own} title={note.own ? '' : '다른 작성자의 기록은 수정할 수 없습니다'} onClick={() => openDialog('editnote', note.id)}><Pencil size={11} /> 수정</button>
          <button type="button" className="rec-act del" disabled={!note.own} title={note.own ? '' : '다른 작성자의 기록은 삭제할 수 없습니다'} onClick={() => openDialog('delnote', note.id)}><Trash2 size={11} /> 삭제</button>
          {!hideFull && <button type="button" className="rec-act full" onClick={() => openDialog('noteview', note.id)}><Expand size={11} /> 전체보기</button>}
        </div>
      </div>
      <div className="mt-1 font-semibold text-white">{note.title}</div>
      <NoteBody note={note} />
    </div>
  )
}
