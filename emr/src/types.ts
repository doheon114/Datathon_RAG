// EMR 데이터 모델. 백엔드 연결 시 이 타입에 맞춰 api/emrApi.ts 만 교체하면 된다.

export type Sex = 'M' | 'F'
export type Visit = '외래' | '입원' | '응급' | '퇴원'

export interface Problem {
  code: string
  name: string
  since: string
  active: boolean
  /** 지침 AI 질의 문장 (문제목록에서 바로 지침 근거를 찾는 용도) */
  guidelineQuery?: string
}

export interface Medication {
  name: string
  dose: string
  sig: string
  since: string
}

/** preprocessed_data/features.csv 에서 가져온 전처리 요약 (furosemide 투여 심부전 환자 2명) */
export interface CohortFeatures {
  source: string
  stayId: string
  t0: string
  sections: { title: string; rows: { k: string; v: string; note: string }[] }[]
  notes: string[]
}

export interface Patient {
  id: string
  mrn: string
  name: string
  sex: Sex
  ageLabel: string
  ageYears: number
  birth: string
  heightCm: number
  weightKg: number
  bloodType: string
  infection: string[]
  allergy: string[]
  dept: string
  attending: string
  status: '외래' | '입원'
  ward?: string
  queue: { time: string; state: '대기' | '진료중' | '수납' | '완료' | '입원' | '퇴원' | '사망' }
  problems: Problem[]
  meds: Medication[]
  /** 비식별 임상 요약 (AI 질의 맥락). 이름·번호는 포함하지 않는다. */
  profile: string
  /** hf: 심부전 코호트 데이터셋(MEDS, 비식별) / demo: 시연용 가상 환자 */
  group?: 'hf' | 'demo'
  outcome?: string
  admitDate?: string
  counts?: { notes: number; orders: number; labs: number }
  cohortFeatures?: CohortFeatures
}

export type EncounterType = '외래' | '입원' | '수술' | '응급'

export interface Encounter {
  id: string
  patientId: string
  date: string
  endDate?: string
  type: EncounterType
  dept: string
  doctor: string
  title: string
  summary: string
  future?: boolean
}

export interface PlanItem {
  text: string
  /** 지침 AI 질의 문장. 있으면 '지침근거' 버튼이 붙는다. */
  query?: string
}

export interface NoteSection {
  title: string
  body: string
}

export type NoteKind = '초진' | '경과' | '입원' | '퇴원' | '회신' | '수술' | '간호'

export interface GuidelineInsert {
  id: string
  query: string
  answer: string
  evidence: { n: number; sourceName: string; page: number; text: string }[]
  at: string
}

export interface Note {
  id: string
  patientId: string
  encounterId: string
  date: string
  time: string
  kind: NoteKind
  visit: '외래' | '입원'
  dept: string
  author: string
  own: boolean
  /** 기록이 작성된 병원 (타병원 진료의뢰 회신 등은 다른 값) */
  hospital: string
  title: string
  sections: NoteSection[]
  plan: PlanItem[]
  inserts: GuidelineInsert[]
}

export type OrderCategory = '약물' | '혈액검사' | '영상검사' | '생리검사' | '주사' | '처치' | '수술'
export type OrderStatus = '처방' | '접수' | '시행' | '보고대기' | '결과확인' | '취소'

export interface Order {
  id: string
  patientId: string
  encounterId: string
  date: string
  visit: Visit
  dept: string
  doctor: string
  category: OrderCategory
  name: string
  detail: string
  status: OrderStatus
  execDate: string
  mine: boolean
  guidelineQuery?: string
}

export type LabFlag = 'N' | 'H' | 'L' | 'HH' | 'LL'

export interface LabResult {
  id: string
  patientId: string
  encounterId: string
  date: string
  datetime: string
  name: string
  unit: string
  refLow?: number
  refHigh?: number
  refText: string
  value: number
  flag: LabFlag
  dept: string
  mine: boolean
  guidelineQuery?: string
}

export interface Vital {
  encounterId: string
  date: string
  sbp: number
  dbp: number
  hr: number
  bt: number
  spo2: number
  weightKg: number
}

export interface ImagingReport {
  id: string
  patientId: string
  encounterId: string
  date: string
  study: string
  report: string
  dept: string
  guidelineQuery?: string
}

export interface PatientBundle {
  patient: Patient
  encounters: Encounter[]
  notes: Note[]
  orders: Order[]
  labs: LabResult[]
  vitals: Vital[]
  imaging: ImagingReport[]
}

export type TLKind = '외래' | '입원' | '수술' | '검사' | '영상' | '처방'

export interface TLEvent {
  id: string
  kind: TLKind
  date: string
  endDate?: string
  label: string
  detail: string
  encounterId: string
  future?: boolean
}

export type WinId = 'notes' | 'orders' | 'labs' | 'ai'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface WinState {
  open: boolean
  minimized: boolean
  maximized: boolean
  rect: Rect
  z: number
}
