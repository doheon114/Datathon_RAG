// EMR 데이터 접근 계층. 지금은 로컬 mock 데이터를 돌려주지만, 시그니처를 유지한 채 fetch 로 바꾸면 실제 백엔드에 연결된다.
import type { Patient, PatientBundle, TLEvent } from '../types'
import { ALL_BUNDLES } from '../data/generate'
import { USER } from '../data/profiles'

export const currentUser = USER

const BASE = import.meta.env.BASE_URL // 예: /emr/
const loaded = new Map<string, PatientBundle>()

/** 시연용 가상 환자 10명 (로컬 생성) */
export const peekPatients = (): Patient[] => Object.values(ALL_BUNDLES).map((b) => ({ ...b.patient, group: 'demo' as const }))

/** 심부전 코호트 환자 목록 (MEDS 데이터셋을 변환한 정적 JSON: public/hf/index.json) */
export async function loadCohort(): Promise<Patient[]> {
  const r = await fetch(`${BASE}hf/index.json`)
  if (!r.ok) throw new Error(`코호트 목록을 불러오지 못했습니다 (${r.status})`)
  return (await r.json()).patients as Patient[]
}

/** 환자 한 명의 전체 번들. 코호트는 hf/HFxxx.json 을 필요할 때만 가져온다. */
export async function loadBundle(id: string): Promise<PatientBundle> {
  if (ALL_BUNDLES[id]) return ALL_BUNDLES[id]
  const hit = loaded.get(id)
  if (hit) return hit
  const r = await fetch(`${BASE}hf/${id}.json`)
  if (!r.ok) throw new Error(`환자 기록을 불러오지 못했습니다 (${r.status})`)
  const b = (await r.json()) as PatientBundle
  loaded.set(id, b)
  return b
}

/** 동기 접근: 이미 불러온 번들만 돌려준다 */
export const peekBundle = (id: string): PatientBundle | undefined => ALL_BUNDLES[id] ?? loaded.get(id)

export const placeholderBundle = (p: Patient): PatientBundle => ({ patient: p, encounters: [], notes: [], orders: [], labs: [], vitals: [], imaging: [] })

/** 진료이력·검사·영상·처방을 타임라인 이벤트로 변환 */
export function buildTimeline(b: PatientBundle): TLEvent[] {
  const ev: TLEvent[] = []
  for (const e of b.encounters) {
    const kind = e.type === '입원' ? '입원' : e.type === '수술' ? '수술' : '외래'
    ev.push({
      id: `enc-${e.id}`, kind, date: e.date, endDate: e.endDate, label: e.title, encounterId: e.id, future: e.future,
      detail: `${e.dept} · ${e.doctor}${e.future ? ' · 예약' : ''}\n${e.summary}`,
    })
  }
  const labGroups = new Map<string, typeof b.labs>()
  for (const l of b.labs) {
    const k = `${l.encounterId}|${l.date}`
    labGroups.set(k, [...(labGroups.get(k) ?? []), l])
  }
  for (const [k, ls] of labGroups) {
    const abn = ls.filter((l) => l.flag !== 'N')
    ev.push({
      id: `lab-${k}`, kind: '검사', date: ls[0].date, encounterId: ls[0].encounterId,
      label: `혈액검사 ${ls.length}항목${abn.length ? ` (이상 ${abn.length})` : ''}`,
      detail: ls.slice(0, 6).map((l) => `${l.name} ${l.value} ${l.unit}${l.flag !== 'N' ? ` [${l.flag}]` : ''}`).join('\n') + (ls.length > 6 ? `\n… 외 ${ls.length - 6}항목` : ''),
    })
  }
  for (const m of b.imaging) {
    ev.push({ id: `img-${m.id}`, kind: '영상', date: m.date, encounterId: m.encounterId, label: m.study, detail: m.report.split('. ').slice(0, 2).join('. ') })
  }
  const rxGroups = new Map<string, typeof b.orders>()
  for (const o of b.orders.filter((x) => x.category === '약물' || x.category === '주사')) {
    const k = `${o.encounterId}|${o.date}`
    rxGroups.set(k, [...(rxGroups.get(k) ?? []), o])
  }
  for (const [k, os] of rxGroups) {
    ev.push({ id: `rx-${k}`, kind: '처방', date: os[0].date, encounterId: os[0].encounterId, label: `처방 ${os.length}건`, detail: os.slice(0, 6).map((o) => `${o.name} ${o.detail.split(' · ')[0]}`).join('\n') })
  }
  return ev
}
