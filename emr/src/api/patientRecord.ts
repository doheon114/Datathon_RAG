// 환자 기록 전체를 "한 줄 = 한 사실" 문장 목록으로 만든다. 서버가 이 줄들을 검색(RAG)해 질문과 관련된 것만 답변에 쓴다.
// 이름·번호 같은 식별 정보는 넣지 않는다.
import type { PatientBundle } from '../types'

const MAX_LINE = 700
const NOTE_CHUNK = 450
const IO_RECORD = /\((섭취|배설)\)/

const num = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100))
const mmdd = (d: string) => d.slice(5)
const uniq = <T,>(xs: T[]) => [...new Set(xs)]

/** 긴 문단은 줄 단위로 모아 NOTE_CHUNK 자 안팎으로 자른다 */
function chunks(body: string): string[] {
  const out: string[] = []
  let cur = ''
  for (const ln of body.split('\n').map((x) => x.trim()).filter(Boolean)) {
    if (cur && cur.length + ln.length > NOTE_CHUNK) { out.push(cur); cur = '' }
    cur = cur ? `${cur} / ${ln}` : ln
  }
  if (cur) out.push(cur)
  return out
}

export function buildPatientRecord(b: PatientBundle): string[] {
  const p = b.patient
  const out: string[] = []
  const push = (s: string) => { const t = s.replace(/\s+/g, ' ').trim(); if (t) out.push(t.length > MAX_LINE ? `${t.slice(0, MAX_LINE)}…` : t) }

  // 기본·진단
  push(`[기본] ${p.ageLabel} ${p.sex === 'M' ? '남성' : '여성'}, ${p.dept} (${p.status})${p.heightCm > 0 && p.weightKg > 0 ? `, 키 ${p.heightCm}cm 체중 ${p.weightKg}kg` : ''}. 알레르기: ${p.allergy.length ? p.allergy.join(', ') : '기록 없음'}${p.infection.length ? `. 감염: ${p.infection.join(', ')}` : ''}`)
  for (const x of p.problems) push(`[진단] ${x.code} ${x.name} (${x.since}~${x.active ? ' 진행' : ' 종결'})`)
  for (const e of [...b.encounters].filter((x) => !x.future).sort((a, c) => a.date.localeCompare(c.date))) {
    push(`[진료] ${e.date}${e.endDate ? `~${e.endDate}` : ''} ${e.type} ${e.dept} ${e.title}${e.summary ? ` — ${e.summary}` : ''}`)
  }

  // 검사: 항목별 시계열 한 줄 (추이를 묻는 질문에 한 번에 답할 수 있게)
  const byTest = new Map<string, typeof b.labs>()
  for (const l of [...b.labs].sort((a, c) => a.datetime.localeCompare(c.datetime))) byTest.set(l.name, [...(byTest.get(l.name) ?? []), l])
  for (const [name, ls] of byTest) {
    const last = ls[ls.length - 1]
    const pts = ls.slice(-24).map((l) => `${l.datetime.slice(5, 16)} ${num(l.value)}${l.flag !== 'N' ? ` ${l.flag}` : ''}`)
    push(`[검사] ${name}${last.unit ? ` (${last.unit})` : ''}${last.refText && last.refText !== '-' ? ` 참고 ${last.refText}` : ''}: ${pts.join(' → ')}`)
  }

  // 활력징후·체중
  for (const v of [...b.vitals].sort((a, c) => a.date.localeCompare(c.date))) {
    push(`[활력징후] ${v.date} BP ${v.sbp}/${v.dbp}, HR ${v.hr}, BT ${v.bt}℃, SpO2 ${v.spo2}%${v.weightKg > 0 ? `, 체중 ${v.weightKg}kg` : ''}`)
  }

  // 오더: 약물·주사는 약마다 투여 기간을 한 줄로, 섭취·배설은 이름마다 일자별 합계 한 줄로, 나머지는 한 줄씩
  const orders = [...b.orders].filter((o) => o.status !== '취소').sort((a, c) => a.date.localeCompare(c.date))
  const drugs = new Map<string, { detail: string; dates: string[] }>()
  const io = new Map<string, string[]>()
  for (const o of orders) {
    if (o.category === '혈액검사' || o.name.startsWith('약품코드')) continue
    if (IO_RECORD.test(o.name)) {
      const sum = /합계\s*([\d,]+)\s*cc/.exec(o.detail)?.[1]
      io.set(o.name, [...(io.get(o.name) ?? []), `${mmdd(o.date)} ${sum ?? '-'}cc`])
    } else if (o.category === '약물' || o.category === '주사') {
      const cur = drugs.get(o.name) ?? { detail: o.detail.split(' · ')[0], dates: [] }
      cur.dates.push(o.date)
      drugs.set(o.name, cur)
    } else push(`[오더] ${o.date} ${o.category} ${o.name}${o.detail ? ` — ${o.detail}` : ''}`)
  }
  for (const [name, d] of drugs) {
    const ds = uniq(d.dates)
    push(`[투약] ${name} ${d.detail} — ${ds[0]}${ds.length > 1 ? `~${ds[ds.length - 1]}` : ''} (${ds.length}일 투여)`)
  }
  const unnamed = uniq(orders.filter((o) => o.name.startsWith('약품코드')).map((o) => o.name)).length
  if (unnamed) push(`[투약] 약품명이 확인되지 않는 투약 기록 ${unnamed}종`)
  for (const [name, pts] of io) push(`[섭취·배설] ${name}: ${pts.join(', ')}`)

  // 영상
  for (const m of [...b.imaging].sort((a, c) => a.date.localeCompare(c.date))) push(`[영상] ${m.date} ${m.study}: ${m.report}`)

  // 진료기록(간호기록 포함): 섹션별로, 긴 것은 나눠서
  for (const n of [...b.notes].sort((a, c) => (a.date + a.time).localeCompare(c.date + c.time))) {
    for (const s of n.sections) for (const piece of chunks(s.body)) push(`[기록 ${n.date} ${n.kind} · ${n.title} · ${s.title}] ${piece}`)
  }
  return out
}
