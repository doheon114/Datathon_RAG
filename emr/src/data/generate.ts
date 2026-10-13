// 프로필로부터 진료이력·기록·오더·검사결과·영상을 서로 연결된 상태로 생성한다. (시드 고정, 날짜는 오늘 기준)
import type {
  Encounter, EncounterType, ImagingReport, LabFlag, LabResult, Note, NoteKind, NoteSection, Order, OrderCategory, OrderStatus,
  Patient, PatientBundle, PlanItem, Visit, Vital,
} from '../types'
import { PROFILES, Q, USER, type Admission, type Drug, type Profile } from './profiles'
import { TODAY, addDays, between, daysBetween, iso, mulberry32, parseISO, pick, randInt, timeOf, type Rng } from './rng'

interface LabDef { unit: string; low?: number; high?: number; ref: string; dec: number }

export const LAB_DEFS: Record<string, LabDef> = {
  'NT-proBNP': { unit: 'pg/mL', high: 125, ref: '< 125', dec: 0 },
  Creatinine: { unit: 'mg/dL', low: 0.6, high: 1.2, ref: '0.6 - 1.2', dec: 2 },
  eGFR: { unit: 'mL/min/1.73㎡', low: 60, ref: '≥ 60', dec: 0 },
  Potassium: { unit: 'mmol/L', low: 3.5, high: 5.1, ref: '3.5 - 5.1', dec: 1 },
  Sodium: { unit: 'mmol/L', low: 135, high: 145, ref: '135 - 145', dec: 0 },
  Hemoglobin: { unit: 'g/dL', low: 12, high: 16, ref: '12.0 - 16.0', dec: 1 },
  HbA1c: { unit: '%', high: 5.6, ref: '< 5.7', dec: 1 },
  'Glucose (FBS)': { unit: 'mg/dL', low: 70, high: 100, ref: '70 - 100', dec: 0 },
  'LDL-C': { unit: 'mg/dL', high: 130, ref: '< 130', dec: 0 },
  ALT: { unit: 'U/L', high: 40, ref: '0 - 40', dec: 0 },
  TSH: { unit: 'mIU/L', low: 0.4, high: 4.0, ref: '0.4 - 4.0', dec: 2 },
  CRP: { unit: 'mg/dL', high: 0.5, ref: '< 0.5', dec: 2 },
  WBC: { unit: '10³/μL', low: 4, high: 10, ref: '4.0 - 10.0', dec: 1 },
  'Troponin I': { unit: 'ng/mL', high: 0.04, ref: '< 0.04', dec: 3 },
  Ferritin: { unit: 'ng/mL', low: 13, high: 150, ref: '13 - 150', dec: 0 },
  'IgE (total)': { unit: 'IU/mL', high: 100, ref: '< 100', dec: 0 },
  'Uric acid': { unit: 'mg/dL', low: 3.5, high: 7.2, ref: '3.5 - 7.2', dec: 1 },
}

const flagOf = (v: number, lo?: number, hi?: number): LabFlag => {
  if (hi !== undefined && v > hi) return v >= hi * 2 ? 'HH' : 'H'
  if (lo !== undefined && v < lo) return v <= lo * 0.6 ? 'LL' : 'L'
  return 'N'
}

const labQuery = (name: string, v: number, unit: string, flag: LabFlag): string | undefined => {
  if (flag === 'N') return undefined
  switch (name) {
    case 'NT-proBNP': return `NT-proBNP ${Math.round(v).toLocaleString('en-US')} ${unit} 상승은 심부전 진단과 예후 평가에서 어떻게 해석하나요?`
    case 'Potassium': return flag === 'H' || flag === 'HH' ? '미네랄로코르티코이드 수용체 길항제(MRA) 사용 중 칼륨이 상승하면 지침은 어떻게 권고하나요?' : undefined
    case 'Creatinine': case 'eGFR': return Q.ckd
    case 'Hemoglobin': return Q.iron
    case 'Sodium': return flag === 'L' || flag === 'LL' ? '심부전 환자의 저나트륨혈증과 이뇨제 조절에 대한 권고는?' : undefined
    case 'HbA1c': return Q.dm
    default: return undefined
  }
}

const drugQuery = (name: string): string | undefined => {
  if (/carvedilol|bisoprolol|metoprolol|nebivolol/i.test(name)) return Q.bb
  if (/dapagliflozin|empagliflozin/i.test(name)) return Q.sglt
  if (/apixaban/i.test(name)) return Q.apix
  if (/rivaroxaban|edoxaban|dabigatran/i.test(name)) return `${name.split(' ')[0]} 허가용량과 주의사항은?`
  if (/spironolactone|eplerenone/i.test(name)) return Q.mra
  if (/sacubitril|valsartan|enalapril|ramipril/i.test(name)) return Q.arni
  if (/furosemide|torsemide|bumetanide/i.test(name)) return Q.diur
  return undefined
}

const imagingQuery = (study: string): string | undefined => {
  if (/Echocardiography/i.test(study)) return '박출률(LVEF)에 따른 심부전 분류(HFrEF, HFmrEF, HFpEF)는 어떻게 정의하나요?'
  return undefined
}

const HOSP = '익명대학교병원'
const commas = (n: number) => Math.round(n).toLocaleString('en-US')
const fixed = (v: number, dec: number) => Number(v.toFixed(dec))

interface RawEnc {
  date: Date
  endDate?: Date
  type: EncounterType
  dept: string
  doctor: string
  title: string
  summary: string
  future?: boolean
  admission?: Admission
  surgery?: string
  other?: boolean
}

function schedule(p: Profile, r: Rng): RawEnc[] {
  const list: RawEnc[] = []
  const ranges = p.admissions.map((a) => ({ s: addDays(TODAY, -a.daysAgo), e: a.los == null ? TODAY : addDays(TODAY, -a.daysAgo + a.los) }))
  const inside = (d: Date) => ranges.some((x) => d >= addDays(x.s, -4) && d <= addDays(x.e, 4))

  let off = -p.firstDaysAgo
  let i = 0
  while (off <= -3) {
    const d = addDays(TODAY, off)
    if (i === 0 || !inside(d)) {
      const other = !!p.otherVisit && i > 0 && i % p.otherVisit.every === p.otherVisit.every - 1
      list.push({
        date: d, type: '외래', dept: other ? p.otherVisit!.dept : p.visitDept, doctor: other ? p.otherVisit!.doctor : p.visitDoctor,
        title: i === 0 ? `${p.visitDept} 초진` : other ? `${p.otherVisit!.dept} 협진 외래` : `${p.visitDept} 외래 추적`,
        summary: i === 0 ? p.first.assess[0].replace(/^#\d+\s*/, '') : pick(r, p.assess), other,
      })
      i++
    }
    off += randInt(r, p.gap[0], p.gap[1])
  }
  for (const a of p.admissions) {
    list.push({
      date: addDays(TODAY, -a.daysAgo), endDate: a.los == null ? undefined : addDays(TODAY, -a.daysAgo + a.los), type: '입원', dept: a.dept, doctor: a.doctor,
      title: `${a.dept} 입원 — ${a.reason}`, summary: a.los == null ? '입원 중' : `입원 ${a.los}일`, admission: a,
    })
  }
  for (const s of p.surgeries) {
    list.push({ date: addDays(TODAY, -s.daysAgo), type: '수술', dept: s.dept, doctor: s.doctor, title: s.name, summary: '시행 완료', surgery: s.name })
  }
  for (const f of p.futureVisits) {
    list.push({ date: addDays(TODAY, f), type: '외래', dept: p.visitDept, doctor: p.visitDoctor, title: `${p.visitDept} 외래 예약`, summary: '예약', future: true })
  }
  // 10~20개로 맞춘다 (초진·입원·수술·예약은 유지)
  const removable = () => list.map((e, k) => ({ e, k })).filter(({ e }) => e.type === '외래' && !e.future && e.title.indexOf('초진') < 0)
  while (list.length > 20) {
    const c = removable()
    list.splice(c[Math.floor(r() * (c.length - 1))].k, 1)
  }
  list.sort((a, b) => a.date.getTime() - b.date.getTime())
  while (list.length < 10) {
    let gi = 1, gap = 0
    for (let k = 1; k < list.length; k++) {
      const g = daysBetween(list[k - 1].date, list[k].date)
      if (g > gap) { gap = g; gi = k }
    }
    list.splice(gi, 0, { date: addDays(list[gi - 1].date, Math.floor(gap / 2)), type: '외래', dept: p.visitDept, doctor: p.visitDoctor, title: `${p.visitDept} 외래 추적`, summary: pick(r, p.assess) })
  }
  return list
}

const kindFor = (e: RawEnc, first: boolean): NoteKind => (e.other ? '회신' : first ? '초진' : '경과')

export function buildBundle(p: Profile): PatientBundle {
  const r = mulberry32(p.seed)
  const base = p.patient
  const ageMonths = base.ageLabel.endsWith('개월') ? parseInt(base.ageLabel, 10) : 0
  const patient: Patient = {
    ...base, id: p.id,
    birth: base.birth || iso(addDays(TODAY, -Math.round(ageMonths * 30.4))),
    problems: base.problems, meds: base.meds,
  }

  const raw = schedule(p, r)
  const encounters: Encounter[] = raw.map((e, k) => ({
    id: `${p.id}-E${String(k + 1).padStart(2, '0')}`, patientId: p.id, date: iso(e.date), endDate: e.endDate ? iso(e.endDate) : undefined,
    type: e.type, dept: e.dept, doctor: e.doctor, title: e.title, summary: e.summary, future: e.future,
  }))

  const notes: Note[] = []
  const orders: Order[] = []
  const labs: LabResult[] = []
  const vitals: Vital[] = []
  const imaging: ImagingReport[] = []

  let labCount = 0
  let firstOutpatientDone = false
  const dayRange = daysBetween(addDays(TODAY, -p.firstDaysAgo), TODAY)
  const frac = (d: Date) => Math.min(1, Math.max(0, daysBetween(addDays(TODAY, -p.firstDaysAgo), d) / dayRange))

  const mkOrder = (e: Encounter, o: Partial<Order> & Pick<Order, 'category' | 'name' | 'detail'>, visit: Visit, seq: number): void => {
    const recent = daysBetween(parseISO(e.date), TODAY) <= 2
    const status: OrderStatus = o.status ?? (o.category === '약물' || o.category === '주사' || o.category === '처치' ? '시행' : recent ? '보고대기' : '결과확인')
    orders.push({
      id: `${e.id}-O${String(seq).padStart(2, '0')}`, patientId: p.id, encounterId: e.id, date: e.date, visit, dept: e.dept, doctor: e.doctor,
      status, execDate: o.execDate ?? e.date, mine: e.doctor === USER.name, guidelineQuery: o.guidelineQuery, ...o,
    } as Order)
  }

  const labPanel = (e: Encounter, d: Date, mult: number, inpatient: boolean, startSeq: number) => {
    labCount++
    let seq = startSeq
    const hh = randInt(r, 7, 9), mm = randInt(r, 0, 5) * 10
    for (const t of p.labs) {
      if (t.every && labCount % t.every !== 0 && !inpatient) continue
      const def = LAB_DEFS[t.name]
      const f = frac(d)
      let v = t.from * Math.pow(Math.max(t.to, 1e-6) / Math.max(t.from, 1e-6), f)
      v *= 1 + t.noise * (r() * 2 - 1)
      if (inpatient && t.admitMul) v *= 1 + (t.admitMul - 1) * mult
      const val = fixed(v, def.dec)
      const lo = t.ref ? t.ref[0] : def.low
      const hi = t.ref ? t.ref[1] : def.high
      const refText = t.ref ? `${t.ref[0] ?? ''}${t.ref[0] !== undefined && t.ref[1] !== undefined ? ' - ' : t.ref[1] !== undefined ? '< ' : '≥ '}${t.ref[1] ?? ''}` : def.ref
      const flag = flagOf(val, lo, hi)
      const datetime = `${iso(d)} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
      labs.push({
        id: `${e.id}-L${String(seq).padStart(2, '0')}`, patientId: p.id, encounterId: e.id, date: iso(d), datetime, name: t.name, unit: def.unit,
        refLow: lo, refHigh: hi, refText, value: val, flag, dept: e.dept, mine: e.doctor === USER.name, guidelineQuery: labQuery(t.name, val, def.unit, flag),
      })
      const recent = daysBetween(d, TODAY) <= 1
      orders.push({
        id: `${e.id}-OL${String(seq).padStart(2, '0')}`, patientId: p.id, encounterId: e.id, date: iso(d), visit: inpatient ? '입원' : '외래', dept: e.dept, doctor: e.doctor,
        category: '혈액검사', name: `${t.name}`, detail: `Serum/Whole blood · 정규 채혈 ${datetime.slice(11)}`, status: recent ? '보고대기' : '결과확인', execDate: iso(d),
        mine: e.doctor === USER.name, guidelineQuery: labQuery(t.name, val, def.unit, flag),
      })
      seq++
    }
    return seq
  }

  const vit = (e: Encounter, d: Date, adm = false): Vital => {
    const f = frac(d)
    const w = p.vitals.weight[0] + (p.vitals.weight[1] - p.vitals.weight[0]) * f + (r() * 2 - 1) * (p.patient.ageYears < 12 ? 0.05 : 0.9)
    const v: Vital = {
      encounterId: e.id, date: e.date,
      sbp: randInt(r, p.vitals.sbp[0], p.vitals.sbp[1]) - (adm ? 4 : 0), dbp: randInt(r, p.vitals.dbp[0], p.vitals.dbp[1]),
      hr: randInt(r, p.vitals.hr[0], p.vitals.hr[1]) + (adm ? 8 : 0), bt: fixed((p.vitals.bt ?? 36.5) + (r() - 0.5) * 0.8, 1),
      spo2: adm ? randInt(r, 91, 95) : randInt(r, 95, 99), weightKg: fixed(w, p.patient.ageYears < 12 ? 1 : 1),
    }
    vitals.push(v)
    return v
  }

  const efAt = (d: Date) => (p.ef ? Math.round(p.ef[0] + (p.ef[1] - p.ef[0]) * frac(d) + (r() * 2 - 1) * 2) : 0)

  // 영상 검사 배정: 가장 가까운 비예약 진료에 연결
  const pastEnc = encounters.filter((e) => !e.future)
  const imgAssign = new Map<string, { spec: (typeof p.imaging)[number]; d: Date }[]>()
  for (const spec of p.imaging) {
    for (const dago of spec.daysAgo) {
      const target = addDays(TODAY, -dago)
      let best = pastEnc[0], bd = Infinity
      for (const e of pastEnc) {
        const dd = Math.abs(daysBetween(parseISO(e.date), target))
        if (dd < bd) { bd = dd; best = e }
      }
      const arr = imgAssign.get(best.id) ?? []
      arr.push({ spec, d: parseISO(best.date) })
      imgAssign.set(best.id, arr)
    }
  }

  const inpatientRx = (a: Admission): { name: string; detail: string; category: OrderCategory }[] =>
    a.kind === 'HF' ? [
      { name: 'Furosemide inj 20mg', detail: '1A IV bid', category: '주사' },
      { name: '0.9% NaCl 500mL', detail: 'KVO IV', category: '주사' },
      { name: '산소 치료 (O2 therapy)', detail: 'nasal prong 2-3 L/min, SpO2 ≥ 94%', category: '처치' },
      { name: '체중 및 섭취/배설량(I/O) 측정', detail: '매일 06시', category: '처치' },
    ] : a.kind === 'pneu' ? [
      { name: 'Piperacillin/Tazobactam inj 4.5g', detail: '1V IV q8h (신기능 보정)', category: '주사' },
      { name: 'Acetaminophen 650mg tab', detail: '1T tid prn 발열', category: '약물' },
      { name: '산소 치료 (O2 therapy)', detail: 'nasal prong 2 L/min', category: '처치' },
      { name: 'Blood culture × 2 set', detail: '항생제 투여 전', category: '혈액검사' },
    ] : [
      { name: 'Hartmann 1000mL', detail: 'IV 80 mL/hr', category: '주사' },
      { name: 'Ceftriaxone inj 1g', detail: '1V IV q24h', category: '주사' },
      { name: 'Acetaminophen 650mg tab', detail: '1T tid prn', category: '약물' },
    ]

  const pickPlan = (n: number): PlanItem[] => {
    const pool = [...p.planPool]
    const out: PlanItem[] = []
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0])
    return out
  }

  const labSummary = (eid: string): string => {
    const ls = labs.filter((l) => l.encounterId === eid).slice(0, 4)
    return ls.length ? ' ' + ls.map((l) => `${l.name} ${l.name === 'NT-proBNP' ? commas(l.value) : l.value} ${l.unit}${l.flag !== 'N' ? ` (${l.flag})` : ''}`).join(', ') + '.' : ''
  }

  const planBody = (items: PlanItem[]) => items.map((it, k) => `${k + 1}. ${it.text}`).join('\n')
  const hasEF = (eid: string) => imaging.find((m) => m.encounterId === eid && /Echocardiography/.test(m.study))

  encounters.forEach((e, k) => {
    const d = parseISO(e.date)
    const rawE = raw[k]
    let seq = 1

    if (e.future) return

    // ---- 영상검사 ----
    for (const a of imgAssign.get(e.id) ?? []) {
      const ef = efAt(d)
      const report = a.spec.report.replace('{ef}', String(ef))
      const guidelineQuery = imagingQuery(a.spec.study)
      imaging.push({ id: `${e.id}-I${String(imaging.length + 1).padStart(3, '0')}`, patientId: p.id, encounterId: e.id, date: e.date, study: a.spec.study, report, dept: e.dept, guidelineQuery })
      mkOrder(e, { category: a.spec.category, name: a.spec.study, detail: `${a.spec.category === '생리검사' ? '검사실' : '영상의학과'} 시행 · 판독 완료`, guidelineQuery }, e.type === '입원' ? '입원' : '외래', 90 + (imaging.length % 9))
    }

    if (e.type === '외래') {
      const first = !firstOutpatientDone && !rawE.other
      if (!rawE.other) firstOutpatientDone = true
      const v = vit(e, d)
      const doLab = p.labs.length > 0 && (k === 0 || r() < (p.episodic ? 0.5 : 0.78))
      if (doLab) seq = labPanel(e, d, 0, false, 1)
      // 처방
      const rx: Drug[] = p.episodic && p.episodic.length ? [pick(r, p.episodic), ...(r() < 0.5 ? [pick(r, p.episodic)] : [])] : p.drugs.filter((dr) => dr.sinceDaysAgo >= daysBetween(d, TODAY))
      const seen = new Set<string>()
      let ok = 1
      for (const dr of rx) {
        if (seen.has(dr.name) || rawE.other) continue
        seen.add(dr.name)
        mkOrder(e, { category: dr.category ?? '약물', name: dr.name, detail: `${dr.sig} · ${dr.days}일 · ${dr.category === '주사' ? 'SC' : 'PO'}`, guidelineQuery: drugQuery(dr.name) }, '외래', ok++)
      }
      if (p.episodic && r() < 0.35) mkOrder(e, { category: '처치', name: '신체계측 (키/체중/두위)', detail: '성장곡선 기록' }, '외래', ok++)

      const section = (title: string, body: string): NoteSection => ({ title, body })
      let sections: NoteSection[]
      let plan: PlanItem[]
      const ef = hasEF(e.id)
      const dig = (t: string) => `${t}`
      if (first) {
        const f = p.first
        sections = [section('주소 (Chief Complaint)', f.cc), section('현병력 (Present Illness)', f.hpi), section('과거력 (Past History)', f.pmh)]
        if (f.birth) sections.push(section('출생력', f.birth))
        if (f.vaccine) sections.push(section('예방접종', f.vaccine))
        if (f.growth) sections.push(section('성장발달', f.growth))
        sections.push(section('신체검사 (Physical Examination)', f.exam), section('Assessment', f.assess.join('\n')), section('Plan', planBody(f.plan)))
        plan = f.plan
      } else if (rawE.other) {
        plan = pickPlan(2)
        sections = [
          section('협진 회신', `${p.patient.dept} 의뢰 환자. ${p.patient.profile}.`),
          section('Objective', `BP ${v.sbp}/${v.dbp} mmHg, HR ${v.hr}/min, SpO2 ${v.spo2}%, BW ${v.weightKg} kg.${labSummary(e.id)}${ef ? ` ${ef.study}: ${ef.report.split('.')[0]}.` : ''}`),
          section('Assessment', pick(r, p.assess) + '\n' + pick(r, p.assess)),
          section('Plan', planBody(plan)),
        ]
      } else {
        plan = pickPlan(3)
        sections = [
          section('Subjective', pick(r, p.subj)),
          section('Objective', `BP ${v.sbp}/${v.dbp} mmHg, HR ${v.hr}/min, BT ${v.bt}℃, SpO2 ${v.spo2}%, BW ${v.weightKg} kg.${labSummary(e.id)}${ef ? ` ${ef.study}: ${ef.report.split('.')[0]}.` : ''}`),
          section('Assessment', [...new Set([pick(r, p.assess), pick(r, p.assess)])].join('\n')),
          section('Plan', planBody(plan)),
        ]
      }
      void dig
      notes.push({
        id: `${e.id}-N01`, patientId: p.id, encounterId: e.id, date: e.date, time: timeOf(r), kind: kindFor(rawE, first), visit: '외래', dept: e.dept, author: e.doctor,
        own: e.doctor === USER.name, hospital: HOSP, title: first ? `초진 기록 — ${p.first.cc}` : rawE.other ? `${e.dept} 협진 회신` : `외래 경과기록 — ${pick(r, p.assess)}`, sections, plan, inserts: [],
      })
    } else if (e.type === '입원' && rawE.admission) {
      const a = rawE.admission
      const len = a.los ?? daysBetween(d, TODAY)
      const v0 = vit(e, d, true)
      // 입원일 ER 오더 → 입원 오더
      const doctor = e.doctor
      seq = labPanel(e, d, 1, true, 1)
      let oseq = 1
      for (const o of inpatientRx(a)) mkOrder(e, { ...o, guidelineQuery: drugQuery(o.name) }, oseq <= 2 ? '응급' : '입원', oseq++)
      for (const dr of p.drugs.filter((x) => x.sinceDaysAgo >= daysBetween(d, TODAY)).slice(0, 4)) {
        mkOrder(e, { category: '약물', name: dr.name, detail: `${dr.sig} · 병동 투약 · PO`, guidelineQuery: drugQuery(dr.name) }, '입원', oseq++)
      }
      const ptPlan = a.kind === 'HF'
        ? [p.planPool.find((x) => x.query === Q.diur) ?? { text: '정맥 이뇨제로 체액 제거, 체중·I/O 관찰.', query: Q.diur }, { text: 'NT-proBNP, 신기능, 전해질 매일 추적.', query: Q.nt }, { text: '악화 유발 요인(감염, 약물 불순응, 부정맥) 확인 후 GDMT 재조정.' }]
        : [{ text: '원인 치료와 지지 요법, 활력징후 모니터링.' }, { text: '배양 결과에 따른 항생제 조정.' }]
      notes.push({
        id: `${e.id}-N01`, patientId: p.id, encounterId: e.id, date: e.date, time: timeOf(r), kind: '입원', visit: '입원', dept: e.dept, author: doctor, own: doctor === USER.name, hospital: HOSP,
        title: `입원 기록 — ${a.reason}`,
        sections: [
          { title: '입원 사유', body: a.reason },
          { title: '현병력 (Present Illness)', body: `${p.patient.profile}. ${a.reason}로 응급실 경유 입원.` },
          { title: '입원 시 소견', body: `BP ${v0.sbp}/${v0.dbp} mmHg, HR ${v0.hr}/min, BT ${v0.bt}℃, SpO2 ${v0.spo2}% (RA), BW ${v0.weightKg} kg.${labSummary(e.id)}` },
          { title: 'Assessment', body: a.reason },
          { title: 'Plan', body: planBody(ptPlan) },
        ],
        plan: ptPlan, inserts: [],
      })
      if (len > 3) {
        const mid = addDays(d, Math.floor(len / 2))
        const progPlan = pickPlan(2)
        notes.push({
          id: `${e.id}-N02`, patientId: p.id, encounterId: e.id, date: iso(mid), time: timeOf(r), kind: '경과', visit: '입원', dept: e.dept, author: doctor, own: doctor === USER.name, hospital: HOSP,
          title: '입원 경과기록', sections: [
            { title: 'Subjective', body: pick(r, p.subj) },
            { title: 'Objective', body: `체중 ${fixed(v0.weightKg - 1.2, 1)} kg (입원 시 대비 감소), V/S 안정.` },
            { title: 'Assessment', body: pick(r, p.assess) },
            { title: 'Plan', body: planBody(progPlan) },
          ], plan: progPlan, inserts: [],
        })
      }
      if (a.los != null) {
        const end = addDays(d, a.los)
        const dcPlan: PlanItem[] = p.planPool.filter((x) => x.query).slice(0, 2)
        notes.push({
          id: `${e.id}-N03`, patientId: p.id, encounterId: e.id, date: iso(end), time: '11:30', kind: '퇴원', visit: '입원', dept: e.dept, author: doctor, own: doctor === USER.name, hospital: HOSP,
          title: `퇴원 요약 — ${a.reason}`, sections: [
            { title: '입원 경과', body: `${a.reason}로 입원하여 치료 후 증상 호전. 입원 ${a.los}일.` },
            { title: '퇴원 시 처방', body: p.drugs.filter((x) => x.sinceDaysAgo >= daysBetween(end, TODAY)).map((x) => `${x.name} ${x.sig}`).join('\n') || '-' },
            { title: 'Plan (추적 계획)', body: planBody(dcPlan.length ? dcPlan : [{ text: '1-2주 내 외래 추적.' }]) },
          ], plan: dcPlan, inserts: [],
        })
        // 퇴원 처방
        for (const dr of p.drugs.filter((x) => x.sinceDaysAgo >= daysBetween(end, TODAY)).slice(0, 4)) {
          orders.push({
            id: `${e.id}-OD${orders.length}`, patientId: p.id, encounterId: e.id, date: iso(end), visit: '퇴원', dept: e.dept, doctor, category: '약물', name: dr.name, detail: `${dr.sig} · 14일 · PO`,
            status: '시행', execDate: iso(end), mine: doctor === USER.name, guidelineQuery: drugQuery(dr.name),
          })
        }
        labPanel({ ...e, date: iso(end) } as Encounter, end, 0.3, true, seq)
      }
      vit({ ...e, date: iso(addDays(d, Math.max(1, Math.floor(len / 2)))) }, addDays(d, Math.max(1, Math.floor(len / 2))))
    } else if (e.type === '수술') {
      const v = vit(e, d)
      mkOrder(e, { category: '수술', name: e.title, detail: `시술실 · 국소/진정 마취 · ${e.dept}` }, '입원', 1)
      mkOrder(e, { category: '처치', name: '수술 전 금식 및 항응고제 조절', detail: '시술 전 8시간 NPO', status: '시행' }, '입원', 2)
      const sp: PlanItem[] = [{ text: '시술 후 12-24시간 활력징후 및 삽입 부위 관찰.' }, { text: p.id === 'P003' ? 'ICD 설정 확인 및 1개월 후 기기 점검.' : '시술 후 1주 외래 추적.', query: p.id === 'P003' ? Q.icd : undefined }]
      notes.push({
        id: `${e.id}-N01`, patientId: p.id, encounterId: e.id, date: e.date, time: '14:20', kind: '수술', visit: '입원', dept: e.dept, author: e.doctor, own: e.doctor === USER.name, hospital: HOSP,
        title: `시술/수술 기록 — ${e.title}`, sections: [
          { title: 'Operation / Procedure', body: e.title },
          { title: 'Pre-op Diagnosis', body: p.patient.problems[0].name },
          { title: 'Findings & Procedure', body: `술 전 V/S: BP ${v.sbp}/${v.dbp}, HR ${v.hr}. 무균 소독 후 계획대로 시행, 특이 합병증 없이 종료.` },
          { title: 'Plan', body: planBody(sp) },
        ], plan: sp, inserts: [],
      })
    }
  })

  // ---- 간호기록: 입원은 거의 매일, 외래는 일부 내원 ----
  const nurses = ['홍간호사', '이간호사', '박간호사']
  encounters.forEach((e, k) => {
    if (e.future) return
    const d = parseISO(e.date)
    const v = vitals.find((x) => x.encounterId === e.id && x.date === e.date)
    if (e.type === '입원') {
      const len = e.endDate ? daysBetween(d, parseISO(e.endDate)) : daysBetween(d, TODAY)
      for (let day = 0; day <= Math.min(len, 4); day++) {
        const nd = addDays(d, day)
        const nv = day === 0 ? v : undefined
        notes.push({
          id: `${e.id}-NR${day}`, patientId: p.id, encounterId: e.id, date: iso(nd), time: day === 0 ? '09:10' : pick(r, ['07:30', '14:20', '22:10']), kind: '간호', visit: '입원', dept: '간호부', author: nurses[(k + day) % 3], own: false, hospital: HOSP,
          title: day === 0 ? '입원 간호 정보조사' : `병동 간호기록 (${day}일차)`,
          sections: [
            { title: '간호 사정', body: day === 0 ? `의식 명료, 보행 가능. 낙상 위험도 ${randInt(r, 3, 9)}점, 욕창 위험도 ${randInt(r, 14, 21)}점. 알레르기: ${p.patient.allergy.join(', ') || '없음'}.` : `의식 명료, 호흡곤란 ${pick(r, ['호전', '유지', '경미'])}. 식사 ${pick(r, ['전량', '2/3', '1/2'])} 섭취.` },
            { title: '활력징후 / 섭취·배설', body: `${nv ? `BP ${nv.sbp}/${nv.dbp}, HR ${nv.hr}, BT ${nv.bt}℃, SpO2 ${nv.spo2}%. ` : `BP ${randInt(r, 100, 135)}/${randInt(r, 60, 82)}, HR ${randInt(r, 62, 92)}, BT ${fixed(36.2 + r() * 0.8, 1)}℃. `}I/O ${randInt(r, 1100, 1900)} / ${randInt(r, 1200, 2100)} mL.` },
            { title: '간호 중재 및 평가', body: pick(r, ['투약 시행 및 이상반응 관찰, 낙상 예방 교육 시행.', '정맥주사 부위 확인, 체중 및 I/O 측정, 수분·염분 제한 교육.', '활동 시 호흡곤란 관찰, 안정 취하도록 교육, 의사 보고 사항 없음.']) },
          ],
          plan: [], inserts: [],
        })
      }
    } else if (e.type === '외래' && k % 3 === 0) {
      notes.push({
        id: `${e.id}-NR0`, patientId: p.id, encounterId: e.id, date: e.date, time: '09:30', kind: '간호', visit: '외래', dept: '간호부', author: nurses[k % 3], own: false, hospital: HOSP,
        title: '외래 간호기록',
        sections: [
          { title: '내원 시 문진', body: `내원 사유: ${pick(r, p.subj)}` },
          { title: '활력징후', body: v ? `BP ${v.sbp}/${v.dbp} mmHg, HR ${v.hr}/min, BT ${v.bt}℃, SpO2 ${v.spo2}%, 체중 ${v.weightKg} kg.` : '-' },
          { title: '간호 중재', body: '진료 전 활력징후 측정 및 복용 약물 확인, 진료 후 처방 및 다음 예약 안내.' },
        ],
        plan: [], inserts: [],
      })
    }
  })

  // ---- 타병원 진료의뢰 회신 (일부 환자): 첫 진료 전 외부 병·의원에서 보낸 기록 ----
  const external: Record<string, { hospital: string; dept: string; author: string }> = {
    P004: { hospital: '대전중앙의원', dept: '내과', author: '윤개원' },
    P005: { hospital: '세종제일병원', dept: '순환기내과', author: '강전문' },
    P010: { hospital: '유성내과의원', dept: '내과', author: '조개원' },
  }
  const ex = external[p.id]
  if (ex && encounters.length) {
    const e0 = encounters[0]
    notes.push({
      id: `${e0.id}-NX1`, patientId: p.id, encounterId: e0.id, date: iso(addDays(parseISO(e0.date), -9)), time: '16:40', kind: '회신', visit: '외래', dept: ex.dept, author: ex.author, own: false, hospital: ex.hospital,
      title: `진료의뢰서 — ${p.first.cc}`,
      sections: [{ title: '의뢰 사유', body: `${p.patient.profile}. 정밀 검사 및 전문 진료를 의뢰드립니다.` }, { title: '의뢰 전 검사/치료', body: '혈액검사, 흉부 X선 시행. 약물 치료 중 증상 지속.' }],
      plan: [], inserts: [],
    })
  }

  // 가장 최근 외래/검사의 미확정 결과 몇 건은 '보고대기' 로 둔다 (보고오더 필터 시연용)
  orders.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id)))
  return { patient, encounters, notes, orders, labs, vitals, imaging }
}

export const ALL_BUNDLES: Record<string, PatientBundle> = Object.fromEntries(PROFILES.map((p) => [p.id, buildBundle(p)]))
void between
