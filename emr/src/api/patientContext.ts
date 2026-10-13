// 지침 AI 질문에 붙이는 환자 맥락. 이름·번호 같은 식별 정보는 넣지 않는다.
import type { LabResult, PatientBundle } from '../types'
import { buildPatientRecord } from './patientRecord'

/** 서버 상한(6000자)보다 작게 둔다. 넘으면 우선순위가 낮은 섹션부터 줄인다. */
export const CONTEXT_MAX = 4500

export interface PatientCtx {
  /** 한 줄 임상 요약. 서버가 근거 검색 질의에도 쓴다. */
  summary: string
  /** 프롬프트에 그대로 들어가는 전체 맥락 */
  text: string
  /** 환자 기록 전체(한 줄 = 한 사실). 서버가 질문과 관련된 줄만 검색해 쓴다 */
  record: string[]
}

interface Section { title: string; lines: string[] }

const SEVERITY: Record<string, number> = { HH: 0, LL: 0, H: 1, L: 1, N: 2 }
const ARROW: Record<string, string> = { HH: '↑↑', H: '↑', L: '↓', LL: '↓↓', N: '' }
/** 심부전 진료에서 정상이어도 알아야 하는 검사 */
const KEY_LAB = /BNP|troponin|CK-?MB|creatinine|eGFR|BUN|sodium|potassium|magnesium|^Hb$|hemoglobin|ferritin|TSAT|iron|HbA1c|glucose|lactate|albumin|AST|ALT|bilirubin|INR|uric|LDL|CRP/i
/** 섭취·배설량 기록은 약이나 시술이 아니라 I/O 기록이다 */
const IO_RECORD = /\((섭취|배설)\)/
const HISTORY_TITLE = /과거력|가족력|현병력|입원 사유|주소|동반 진단|진단 \(KCD/
/** 투여 조건(울혈·체액과다 등)을 판단하는 핵심 소견이라 병력과 따로, 눈에 띄는 섹션으로 둔다 */
const EXAM_TITLE = /신체진찰|체액상태/

const num = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100))
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)
const uniq = <T,>(xs: T[]) => [...new Set(xs)]
const mmdd = (d: string) => d.slice(5)

function labText(l: LabResult, trend: string) {
  const ref = l.refText && l.refText !== '-' ? ` (참고 ${l.refText})` : ''
  return `${l.name} ${num(l.value)}${l.unit ? ` ${l.unit}` : ''}${ref}${ARROW[l.flag] ? ` ${ARROW[l.flag]}${l.flag}` : ''}${trend}`
}

export function buildPatientContext(b: PatientBundle): PatientCtx {
  const p = b.patient
  const sections: Section[] = []

  // 1. 기본 정보
  const basic = [`${p.ageLabel} ${p.sex === 'M' ? '남성' : '여성'}, ${p.dept} (${p.status})`]
  if (p.heightCm > 0 && p.weightKg > 0) basic.push(`키 ${p.heightCm}cm, 체중 ${p.weightKg}kg`)
  basic.push(`알레르기: ${p.allergy.length ? p.allergy.join(', ') : '기록 없음'}`)
  if (p.infection.length) basic.push(`감염 정보: ${p.infection.join(', ')}`)
  sections.push({ title: '기본 정보', lines: basic })

  // 2. 진단 / 문제목록
  sections.push({
    title: '진단·문제목록',
    lines: p.problems.map((x) => `${x.code} ${x.name} (${x.since}~${x.active ? ' 진행' : ' 종결'})`),
  })

  // 2-1. 신체진찰·체액상태 (최근 기록 우선, 같은 내용은 한 번만)
  const exam: string[] = []
  for (const n of [...b.notes].sort((a, c) => (c.date + c.time).localeCompare(a.date + a.time))) {
    for (const s of n.sections) {
      if (!EXAM_TITLE.test(s.title)) continue
      for (const ln of s.body.split('\n').map((x) => x.trim()).filter(Boolean)) if (!exam.includes(ln)) exam.push(ln)
    }
  }
  sections.push({ title: '신체진찰·체액상태', lines: exam.slice(0, 4) })

  // 3. 과거력·현병력 등 기록의 병력 섹션 (같은 내용은 한 번만, 최근 기록 우선)
  const hist: string[] = []
  const seen = new Set<string>()
  for (const n of [...b.notes].sort((a, c) => (c.date + c.time).localeCompare(a.date + a.time))) {
    for (const s of n.sections) {
      if (!HISTORY_TITLE.test(s.title)) continue
      const body = s.body.replace(/\s+/g, ' ').trim()
      const key = `${s.title}|${body}`
      if (!body || seen.has(key)) continue
      seen.add(key)
      hist.push(`${s.title.replace(/\s*\(.*\)$/, '')}: ${clip(body, 400)}`)
    }
  }
  sections.push({ title: '병력 (진료기록)', lines: hist.slice(0, 6) })

  // 4. 복용·처방 약물 + 투여 시기. 약품명이 코드뿐인 항목은 정보가 없으므로 개수만 적는다.
  const named = (n: string) => !n.startsWith('약품코드') && !IO_RECORD.test(n)
  // 같은 약이 다른 표기(복용약 목록·오더)로 올라오므로 약 이름(+주사 여부)으로 묶는다
  const drugKey = (t: string) => `${t.split(/\s+/)[0].toLowerCase()}${/\binj\b|\bIV\b/i.test(t) ? '/iv' : ''}`
  const drugs = new Map<string, { text: string; dates: string[]; since?: string }>()
  for (const m of p.meds.filter((x) => named(x.name))) {
    const text = `${m.name} ${m.dose} ${m.sig}`.replace(/\s+-/g, '').trim()
    drugs.set(drugKey(text), { text, dates: [], since: m.since })
  }
  for (const o of [...b.orders].filter((x) => (x.category === '약물' || x.category === '주사') && x.status !== '취소' && named(x.name)).sort((a, c) => a.date.localeCompare(c.date))) {
    const text = `${o.name} ${o.detail.split(' · ')[0]}`.trim()
    const k = drugKey(text)
    const cur = drugs.get(k) ?? { text, dates: [] }
    cur.dates.push(o.date)
    drugs.set(k, cur)
  }
  const span = (x: { dates: string[]; since?: string }) => {
    const ds = uniq(x.dates)
    if (ds.length) return ` (투여 ${mmdd(ds[0])}${ds.length > 1 ? `~${mmdd(ds[ds.length - 1])}` : ''}, ${ds.length}일)`
    return x.since ? ` (시작 ${mmdd(x.since)})` : ''
  }
  const medLines = [...drugs.values()].map((x) => `${x.text}${span(x)}`).slice(0, 20)
  const unnamed = p.meds.filter((m) => m.name.startsWith('약품코드')).length
  if (unnamed > 0) medLines.push(`약품명이 확인되지 않는 투약 기록 ${unnamed}종`)
  sections.push({ title: '복용·처방 약물', lines: medLines })

  // 5. 검사: 항목별 최신값 + 추이. 이상값 먼저, 이어서 주요 검사의 정상값
  const byTest = new Map<string, LabResult[]>()
  for (const l of [...b.labs].sort((a, c) => a.datetime.localeCompare(c.datetime))) byTest.set(l.name, [...(byTest.get(l.name) ?? []), l])
  const trendOf = (ls: LabResult[]) => (ls.length > 1 ? `, 추이 ${num(ls[0].value)}→${num(ls[ls.length - 1].value)} (${mmdd(ls[0].date)}→${mmdd(ls[ls.length - 1].date)}, ${ls.length}회)` : '')
  const latest = [...byTest.values()].map((ls) => ({ l: ls[ls.length - 1], t: trendOf(ls) }))
  const abnormal = latest.filter((x) => x.l.flag !== 'N').sort((a, c) => SEVERITY[a.l.flag] - SEVERITY[c.l.flag] || c.l.datetime.localeCompare(a.l.datetime))
  sections.push({ title: '이상 검사결과 (항목별 최근값)', lines: abnormal.map((x) => labText(x.l, x.t)) })
  const normalKey = latest.filter((x) => x.l.flag === 'N' && KEY_LAB.test(x.l.name))
  sections.push({ title: '주요 검사 정상값', lines: normalKey.map((x) => labText(x.l, x.t)) })

  // 6. 활력징후
  sections.push({
    title: '활력징후',
    lines: [...b.vitals].sort((a, c) => c.date.localeCompare(a.date)).slice(0, 4)
      .map((v) => `${v.date} BP ${v.sbp}/${v.dbp}, HR ${v.hr}, BT ${v.bt}℃, SpO2 ${v.spo2}%${v.weightKg > 0 ? `, 체중 ${v.weightKg}kg` : ''}`),
  })

  // 6-1. 경과 기록: 임상경과 요약 요청에 쓰이는 시간순 요지 (간호기록 제외, 최근 6건)
  sections.push({
    title: '경과 기록 (시간순, 최근)',
    lines: [...b.notes].filter((n) => n.kind !== '간호').sort((a, c) => (a.date + a.time).localeCompare(c.date + c.time)).slice(-6)
      .map((n) => `${n.date} ${n.kind}: ${clip(n.title, 60)} — ${clip(n.sections.map((x) => x.body).join(' ').replace(/\s+/g, ' '), 170)}`),
  })

  // 7. 영상·시술·진료이력
  sections.push({ title: '영상 판독', lines: [...b.imaging].sort((a, c) => c.date.localeCompare(a.date)).slice(0, 4).map((m) => `${m.date} ${m.study}: ${clip(m.report.replace(/\s+/g, ' '), 220)}`) })
  sections.push({ title: '시술·수술', lines: uniq(b.orders.filter((o) => (o.category === '수술' || o.category === '처치') && !IO_RECORD.test(o.name)).sort((a, c) => c.date.localeCompare(a.date)).map((o) => `${o.date} ${o.name}`)).slice(0, 8) })
  sections.push({ title: '진료 이력', lines: [...b.encounters].filter((e) => !e.future).sort((a, c) => c.date.localeCompare(a.date)).slice(0, 5).map((e) => `${e.date} ${e.type} ${e.title}${e.summary ? ` — ${clip(e.summary, 120)}` : ''}`) })

  // 우선순위 순서대로 채우고 상한을 넘는 줄은 건너뛴다
  const out: string[] = []
  let used = 0
  for (const s of sections) {
    if (!s.lines.length) continue
    const head = `[${s.title}]`
    if (used + head.length + 1 > CONTEXT_MAX) break
    out.push(head)
    used += head.length + 1
    let omitted = 0
    for (const ln of s.lines) {
      if (used + ln.length + 3 > CONTEXT_MAX) { omitted++; continue }
      out.push(`- ${ln}`)
      used += ln.length + 3
    }
    if (omitted) { const note = `- … 외 ${omitted}건 생략`; out.push(note); used += note.length + 1 }
  }
  return { summary: p.profile, text: out.join('\n'), record: buildPatientRecord(b) }
}
