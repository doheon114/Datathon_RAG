// 가상 환자 10명의 임상 프로필. 모든 인물·번호는 허구이며 실제 환자정보가 아니다.
import type { PlanItem, Problem, Patient } from '../types'

export const USER = { name: '정의사', title: '교수', dept: '심장내과', lastLogin: '', ip: '10.20.30.41', host: 'WS-CD-07' }

export interface LabTrack {
  name: string
  from: number
  to: number
  noise: number
  /** 입원 시 값 배수 */
  admitMul?: number
  /** 참고치 덮어쓰기 [low, high] */
  ref?: [number | undefined, number | undefined]
  every?: number
}

export interface Drug {
  name: string
  dose: string
  sig: string
  /** 처방 시작(며칠 전) */
  sinceDaysAgo: number
  days: number
  category?: '약물' | '주사'
}

export interface Admission {
  daysAgo: number
  los: number | null
  reason: string
  kind: 'HF' | 'pneu' | 'other'
  dept: string
  doctor: string
}

export interface ImagingSpec {
  study: string
  category: '영상검사' | '생리검사'
  /** 며칠 전 (여러 번) */
  daysAgo: number[]
  report: string
}

export interface Profile {
  seed: number
  id: string
  patient: Omit<Patient, 'problems' | 'meds' | 'id'> & { problems: Problem[]; meds: Patient['meds'] }
  firstDaysAgo: number
  gap: [number, number]
  /** 외래 중 n번째마다 다른 과 진료 */
  otherVisit?: { every: number; dept: string; doctor: string }
  visitDept: string
  visitDoctor: string
  admissions: Admission[]
  surgeries: { daysAgo: number; name: string; dept: string; doctor: string }[]
  futureVisits: number[]
  labs: LabTrack[]
  drugs: Drug[]
  /** 외래마다 임의로 처방하는 약 (소아 등) */
  episodic?: Drug[]
  imaging: ImagingSpec[]
  vitals: { sbp: [number, number]; dbp: [number, number]; hr: [number, number]; weight: [number, number]; bt?: number }
  ef?: [number, number]
  /** 초진 기록 */
  first: { cc: string; hpi: string; pmh: string; exam: string; assess: string[]; plan: PlanItem[]; birth?: string; vaccine?: string; growth?: string }
  /** 경과기록 */
  subj: string[]
  assess: string[]
  planPool: PlanItem[]
}

const q = {
  bb: 'HFrEF 환자에서 베타차단제의 역할은?',
  sglt: 'SGLT2 억제제는 어떤 환자에게 권고되나요?',
  nt: 'NT-proBNP는 심부전 진단과 추적에서 어떻게 활용하나요?',
  icd: 'HFrEF 환자에서 ICD 일차 예방 권고는?',
  mra: '미네랄로코르티코이드 수용체 길항제(MRA) 사용 시 칼륨과 신기능 모니터링 권고는?',
  arni: 'ARNI(사쿠비트릴/발사르탄)는 HFrEF 환자에서 어떻게 권고되나요?',
  af: '비판막성 심방세동 환자의 경구 항응고제 사용 기준은?',
  apix: '아픽사반 용량 감량 기준은?',
  dm: '당뇨병이 동반된 심부전 환자에서 SGLT2 억제제 권고는?',
  hfpef: '박출률 보존 심부전(HFpEF) 환자의 약물치료 권고는?',
  hfmref: '박출률 경도 감소 심부전(HFmrEF) 환자의 약물치료 권고는?',
  diur: '심부전 환자에서 이뇨제 사용 권고는?',
  iron: '심부전 환자의 철결핍과 빈혈 치료 권고는?',
  osa: '수면무호흡과 심부전의 관계는?',
  ckd: '신기능이 저하된 심부전 환자의 약물 사용 시 주의사항은?',
  rehab: '심부전 환자의 심장재활과 운동 권고는?',
  vacc: '심부전 환자의 예방접종 권고는?',
}
export const Q = q

const none = [] as string[]

export const PROFILES: Profile[] = [
  // 1. 김가상 — 기본 선택 환자 (심장내과 외래, HFmrEF + AF + DM)
  {
    seed: 101,
    id: 'P001',
    patient: {
      mrn: 'T0001001', name: '김가상', sex: 'M', ageLabel: '58세', ageYears: 58, birth: '1968-03-14', heightCm: 172, weightKg: 78.4,
      bloodType: 'A+', infection: none, allergy: ['Penicillin (발진)'], dept: '심장내과', attending: '정의사', status: '외래',
      queue: { time: '10:20', state: '진료중' },
      problems: [
        { code: 'I50.9', name: 'Heart failure, HFmrEF (LVEF 41-47%)', since: '2022-10-04', active: true, guidelineQuery: q.hfmref },
        { code: 'I48.1', name: 'Atrial fibrillation, nonvalvular (CHA2DS2-VASc 4)', since: '2022-10-04', active: true, guidelineQuery: q.af },
        { code: 'E11.9', name: 'Type 2 diabetes mellitus', since: '2018-05-21', active: true, guidelineQuery: q.dm },
        { code: 'I10', name: 'Essential hypertension', since: '2015-02-10', active: true },
        { code: 'E78.5', name: 'Dyslipidemia', since: '2018-05-21', active: true },
      ],
      meds: [
        { name: 'Apixaban', dose: '5 mg', sig: '1T bid', since: '2022-10-04' },
        { name: 'Dapagliflozin', dose: '10 mg', sig: '1T qd', since: '2023-02-10' },
        { name: 'Carvedilol', dose: '12.5 mg', sig: '1T bid', since: '2022-10-04' },
        { name: 'Losartan', dose: '50 mg', sig: '1T qd', since: '2015-02-10' },
        { name: 'Metformin', dose: '500 mg', sig: '1T bid', since: '2018-05-21' },
        { name: 'Atorvastatin', dose: '20 mg', sig: '1T qd', since: '2018-05-21' },
      ],
      profile: '58세 남성, HFmrEF(LVEF 41-47%), 비판막성 심방세동(CHA2DS2-VASc 4), 제2형 당뇨병, 고혈압',
    },
    firstDaysAgo: 1450, gap: [70, 115], visitDept: '심장내과', visitDoctor: '정의사',
    otherVisit: { every: 3, dept: '순환기내과', doctor: '최심장' },
    admissions: [{ daysAgo: 880, los: 6, reason: '급성 심부전 악화', kind: 'HF', dept: '순환기내과', doctor: '최심장' }],
    surgeries: [{ daysAgo: 420, name: 'Electrical cardioversion (전기적 심율동전환술)', dept: '순환기내과', doctor: '최심장' }],
    futureVisits: [34, 125],
    labs: [
      { name: 'NT-proBNP', from: 2400, to: 640, noise: 0.18, admitMul: 2.2 },
      { name: 'Creatinine', from: 0.98, to: 1.14, noise: 0.06 },
      { name: 'eGFR', from: 84, to: 68, noise: 0.05 },
      { name: 'Potassium', from: 4.4, to: 4.7, noise: 0.07 },
      { name: 'Sodium', from: 139, to: 140, noise: 0.01 },
      { name: 'Hemoglobin', from: 13.7, to: 13.1, noise: 0.03, ref: [13.0, 17.0] },
      { name: 'HbA1c', from: 8.6, to: 6.9, noise: 0.05, every: 2 },
      { name: 'Glucose (FBS)', from: 172, to: 118, noise: 0.08 },
      { name: 'LDL-C', from: 132, to: 71, noise: 0.08, every: 2 },
      { name: 'ALT', from: 36, to: 27, noise: 0.15, every: 2 },
    ],
    drugs: [
      { name: 'Apixaban 5mg tab', dose: '5 mg', sig: '1T bid', sinceDaysAgo: 1450, days: 90 },
      { name: 'Carvedilol 12.5mg tab', dose: '12.5 mg', sig: '1T bid', sinceDaysAgo: 1450, days: 90 },
      { name: 'Losartan 50mg tab', dose: '50 mg', sig: '1T qd', sinceDaysAgo: 1450, days: 90 },
      { name: 'Metformin 500mg tab', dose: '500 mg', sig: '1T bid', sinceDaysAgo: 1450, days: 90 },
      { name: 'Atorvastatin 20mg tab', dose: '20 mg', sig: '1T qd', sinceDaysAgo: 1450, days: 90 },
      { name: 'Dapagliflozin 10mg tab', dose: '10 mg', sig: '1T qd', sinceDaysAgo: 1340, days: 90 },
    ],
    imaging: [
      { study: 'Echocardiography (TTE)', category: '생리검사', daysAgo: [1440, 1120, 700, 330, 40], report: 'LVEF {ef}% (biplane Simpson). LV global hypokinesia, LVEDD 56 mm. Mild functional MR. LA volume index 44 mL/m² (enlarged). No significant pericardial effusion.' },
      { study: 'ECG 12-lead', category: '생리검사', daysAgo: [1450, 880, 420, 130], report: 'Atrial fibrillation with controlled ventricular response, mean HR 82 bpm. Nonspecific ST-T change.' },
      { study: 'Chest PA', category: '영상검사', daysAgo: [1445, 885, 340], report: 'Mild cardiomegaly (CTR 0.55). No active lung lesion. Costophrenic angles clear.' },
    ],
    vitals: { sbp: [118, 152], dbp: [70, 94], hr: [62, 98], weight: [75.8, 80.2] },
    ef: [41, 47],
    first: {
      cc: '운동 시 호흡곤란, 양하지 부종',
      hpi: '58세 남자 환자로 내원 1개월 전부터 계단 보행 시 호흡곤란(NYHA II-III)과 야간 기침, 양하지 부종 호소. 두근거림이 간헐적으로 있었음. HTN(2015~), T2DM(2018~)으로 약물 치료 중이었으나 최근 3개월 혈압 및 혈당 조절 불량. 흡연력 20 pack-year (2019 금연).',
      pmh: 'HTN (2015), T2DM (2018), Dyslipidemia (2018). Op/Adm: 없음. FHx: 부친 MI (62세).',
      exam: 'BP 148/92 mmHg, HR 98 /min irregularly irregular, BT 36.5℃, SpO2 96% (RA). JVP ↑, S1 variable, bibasilar crackles, pitting edema +1 both legs. 복부 압통 없음.',
      assess: ['#1 Heart failure, new onset — LVEF 41% by TTE (HFmrEF)', '#2 Atrial fibrillation, nonvalvular, CHA2DS2-VASc 4', '#3 HTN, uncontrolled', '#4 T2DM, HbA1c 8.6%'],
      plan: [
        { text: 'NT-proBNP, 심전도, 흉부 X선, TTE 시행. 심부전 초기 평가 결과 확인 후 순환기내과 협진.', query: q.nt },
        { text: 'HFmrEF: 베타차단제(carvedilol) 시작, ACEi/ARB 지속, SGLT2 억제제 추가 검토.', query: q.hfmref },
        { text: 'AF: CHA2DS2-VASc 4점 → 경구 항응고제(apixaban 5 mg bid) 시작. 감량 기준 해당 없음 확인.', query: q.af },
        { text: 'T2DM: 메트포르민 유지, SGLT2 억제제 병용 시 혈당·신기능 추적.', query: q.dm },
      ],
    },
    subj: ['호흡곤란 호전, 야간 기침 소실. 하지 부종 경미.', '활동 시 약간의 숨참 있으나 일상 생활 가능. 두근거림 간헐적.', '체중 증가나 부종 호소 없음. 약물 순응도 양호.', '최근 감기 후 일시적 숨참 악화 호소, 현재는 호전.', '어지러움 없음. 가정혈압 120/70 mmHg 내외.'],
    assess: ['HFmrEF, NYHA II, 안정', 'AF, rate control 양호, 항응고 유지', 'T2DM, 조절 개선 중', 'HTN, 조절 양호'],
    planPool: [
      { text: '베타차단제(carvedilol) 용량 유지, 서맥/저혈압 시 감량.', query: q.bb },
      { text: 'SGLT2 억제제(dapagliflozin 10 mg) 지속. 요로·생식기 감염 및 탈수 교육.', query: q.sglt },
      { text: '아픽사반 5 mg bid 지속. 연령/체중/크레아티닌 감량 기준 재확인.', query: q.apix },
      { text: 'NT-proBNP 추적, 6개월 내 TTE 재평가 예정.', query: q.nt },
      { text: '염분 제한(<2 g Na) 및 매일 체중 측정 교육, 체중 2 kg/3일 증가 시 내원.' },
      { text: '심장재활/규칙적 유산소 운동 권고.', query: q.rehab },
      { text: 'HbA1c, 지질, 신기능 3개월 추적. 안과 진료 의뢰.' },
    ],
  },

  // 2. 이샘플 — 소아청소년과 19개월
  {
    seed: 202,
    id: 'P002',
    patient: {
      mrn: 'T0001002', name: '이샘플', sex: 'M', ageLabel: '19개월', ageYears: 1, birth: '', heightCm: 82.5, weightKg: 11.2,
      bloodType: 'O+', infection: none, allergy: ['계란 흰자 (두드러기)'], dept: '소아청소년과', attending: '박소아', status: '외래',
      queue: { time: '09:40', state: '대기' },
      problems: [
        { code: 'H66.9', name: 'Recurrent acute otitis media', since: '2026-01-12', active: true },
        { code: 'J06.9', name: 'Acute upper respiratory infection', since: '2026-08-03', active: false },
        { code: 'L20.9', name: 'Atopic dermatitis, mild', since: '2025-12-20', active: true },
        { code: 'Z00.1', name: '건강검진 및 예방접종', since: '2025-03-01', active: true },
      ],
      meds: [
        { name: 'Cetirizine syrup', dose: '2.5 mg', sig: 'qd (필요시)', since: '2026-08-03' },
        { name: 'Hydrocortisone 1% oint', dose: '적량', sig: 'bid 도포', since: '2025-12-20' },
      ],
      profile: '19개월 남아, 재발성 급성 중이염, 경증 아토피 피부염',
    },
    firstDaysAgo: 545, gap: [28, 55], visitDept: '소아청소년과', visitDoctor: '박소아',
    admissions: [{ daysAgo: 150, los: 4, reason: '급성 세기관지염', kind: 'other', dept: '소아청소년과', doctor: '박소아' }],
    surgeries: [],
    futureVisits: [21, 90],
    labs: [
      { name: 'WBC', from: 11.2, to: 9.4, noise: 0.25, admitMul: 1.5, ref: [6.0, 14.0] },
      { name: 'CRP', from: 1.8, to: 0.3, noise: 0.5, admitMul: 3.0 },
      { name: 'Hemoglobin', from: 11.2, to: 11.9, noise: 0.04, ref: [10.5, 13.5] },
    ],
    drugs: [],
    episodic: [
      { name: 'Amoxicillin/Clavulanate syrup', dose: '45 mg/kg/일', sig: 'bid × 7일', sinceDaysAgo: 0, days: 7 },
      { name: 'Acetaminophen syrup', dose: '10 mg/kg', sig: '발열 시 q6h prn', sinceDaysAgo: 0, days: 5 },
      { name: 'Cetirizine syrup', dose: '2.5 mg', sig: 'qd × 7일', sinceDaysAgo: 0, days: 7 },
      { name: 'Hydrocortisone 1% oint', dose: '적량', sig: 'bid 도포 × 14일', sinceDaysAgo: 0, days: 14 },
      { name: 'Ambroxol syrup', dose: '1.2 mg/kg', sig: 'tid × 5일', sinceDaysAgo: 0, days: 5 },
    ],
    imaging: [
      { study: 'Chest PA', category: '영상검사', daysAgo: [150, 148], report: 'Bilateral peribronchial thickening with perihilar infiltration, compatible with bronchiolitis. No lobar consolidation.' },
    ],
    vitals: { sbp: [84, 98], dbp: [48, 62], hr: [100, 132], weight: [4.3, 11.2], bt: 37.0 },
    first: {
      cc: '1개월 영아 건강검진 및 예방접종',
      hpi: '재태 39+2주 NSVD 출생. 출생 시 체중 3.2 kg, Apgar 9/10. 모유수유 및 분유 혼합, 황달 광선치료 없이 자연 소실. 수유 양호, 체중 증가 양호.',
      pmh: '특이 병력 없음. 가족력: 모 알레르기 비염.',
      exam: 'BT 36.8℃, HR 138 /min, RR 40 /min. 대천문 평탄, 심음 정상, 폐음 깨끗, 복부 부드러움, 고관절 이상 없음.',
      assess: ['#1 Well baby, 1-month check-up', '#2 Neonatal jaundice, resolved'],
      plan: [{ text: 'BCG, HepB 2차 접종 확인. 다음 방문 시 2개월 예방접종(DTaP, IPV, Hib, PCV).' }, { text: '비타민 D 400 IU/일 보충 지속, 수면 및 수유 교육.' }],
      birth: '재태 39+2주, 3.2 kg, NSVD, Apgar 9/10. 신생아 집중치료 병력 없음.',
      vaccine: 'BCG(생후 2주), HepB 1차(출생 시) 완료. HepB 2차 예정.',
      growth: '체중 4.3 kg (50-75 percentile), 신장 54 cm (50 percentile), 두위 37 cm. 사회적 미소 시작.',
    },
    subj: ['콧물, 기침 3일, 열은 38도 이하. 수유 양호.', '귀를 만지며 보채고 야간 발열 호소.', '건강검진 및 예방접종 위해 내원, 특이 증상 없음.', '피부 가려움으로 긁음, 볼과 팔 접히는 부위 건조.', '기침 호전, 식욕 회복 중. 어린이집 등원 중.'],
    assess: ['URI, mild', 'Acute otitis media, 우측', 'Atopic dermatitis, mild', '성장 및 발달 정상'],
    planPool: [
      { text: '충분한 수분 섭취와 해열제 교육. 48-72시간 내 호전 없으면 재내원.' },
      { text: '중이염: 항생제 7일 처방, 치료 종료 후 고막 소견 재확인.' },
      { text: '보습제 도포 교육, 자극 피하기. 중등도 이상 악화 시 국소 스테로이드.' },
      { text: '예방접종 일정 확인 및 해당 차수 접종 시행.' },
      { text: '성장곡선 추적, 이유식 및 철분 섭취 상담.' },
    ],
  },

  // 3. 박테스트 — 내과 입원 (확장성 심근병증, HFrEF)
  {
    seed: 303,
    id: 'P003',
    patient: {
      mrn: 'T0001003', name: '박테스트', sex: 'F', ageLabel: '42세', ageYears: 42, birth: '1984-07-02', heightCm: 160, weightKg: 58.1,
      bloodType: 'B+', infection: ['HBsAg (+)'], allergy: none, dept: '내과', attending: '오내과', status: '입원', ward: '71병동 12호',
      queue: { time: '입원 5일째', state: '입원' },
      problems: [
        { code: 'I42.0', name: 'Dilated cardiomyopathy', since: '2023-11-08', active: true },
        { code: 'I50.2', name: 'Heart failure, HFrEF (LVEF 25%)', since: '2023-11-08', active: true, guidelineQuery: q.arni },
        { code: 'Z95.810', name: 'ICD in situ (primary prevention)', since: '2026-05-14', active: true, guidelineQuery: q.icd },
        { code: 'B18.1', name: 'Chronic hepatitis B, inactive carrier', since: '2019-01-15', active: true },
      ],
      meds: [
        { name: 'Sacubitril/Valsartan', dose: '49/51 mg', sig: '1T bid', since: '2024-01-10' },
        { name: 'Bisoprolol', dose: '2.5 mg', sig: '1T qd', since: '2023-11-20' },
        { name: 'Spironolactone', dose: '25 mg', sig: '1T qd', since: '2023-12-05' },
        { name: 'Dapagliflozin', dose: '10 mg', sig: '1T qd', since: '2024-02-01' },
        { name: 'Furosemide', dose: '40 mg', sig: 'IV bid (입원)', since: '2026-10-08' },
      ],
      profile: '42세 여성, 확장성 심근병증 HFrEF(LVEF 25%), ICD 삽입 상태, 급성 악화로 입원 중',
    },
    firstDaysAgo: 1060, gap: [55, 95], visitDept: '내과', visitDoctor: '오내과',
    admissions: [
      { daysAgo: 1058, los: 8, reason: '새로 진단된 심부전 (확장성 심근병증)', kind: 'HF', dept: '내과', doctor: '오내과' },
      { daysAgo: 520, los: 7, reason: '급성 심부전 악화', kind: 'HF', dept: '내과', doctor: '오내과' },
      { daysAgo: 4, los: null, reason: '급성 심부전 악화 (체액 과다)', kind: 'HF', dept: '내과', doctor: '오내과' },
    ],
    surgeries: [{ daysAgo: 150, name: 'ICD implantation (이식형 제세동기 삽입술)', dept: '순환기내과', doctor: '최심장' }],
    futureVisits: [30, 100],
    labs: [
      { name: 'NT-proBNP', from: 5200, to: 2300, noise: 0.2, admitMul: 2.0 },
      { name: 'Creatinine', from: 0.78, to: 1.08, noise: 0.07, admitMul: 1.25 },
      { name: 'eGFR', from: 99, to: 71, noise: 0.05 },
      { name: 'Potassium', from: 4.1, to: 4.9, noise: 0.07 },
      { name: 'Sodium', from: 139, to: 134, noise: 0.012, admitMul: 0.97 },
      { name: 'Hemoglobin', from: 12.6, to: 12.1, noise: 0.03, ref: [12.0, 16.0] },
      { name: 'Troponin I', from: 0.09, to: 0.04, noise: 0.3 },
    ],
    drugs: [
      { name: 'Sacubitril/Valsartan 49/51mg tab', dose: '49/51 mg', sig: '1T bid', sinceDaysAgo: 1000, days: 60 },
      { name: 'Bisoprolol 2.5mg tab', dose: '2.5 mg', sig: '1T qd', sinceDaysAgo: 1040, days: 60 },
      { name: 'Spironolactone 25mg tab', dose: '25 mg', sig: '1T qd', sinceDaysAgo: 1020, days: 60 },
      { name: 'Dapagliflozin 10mg tab', dose: '10 mg', sig: '1T qd', sinceDaysAgo: 960, days: 60 },
      { name: 'Furosemide 20mg tab', dose: '20 mg', sig: '1T qd', sinceDaysAgo: 1058, days: 60 },
    ],
    imaging: [
      { study: 'Echocardiography (TTE)', category: '생리검사', daysAgo: [1056, 700, 515, 260, 160, 3], report: 'Dilated LV (LVEDD 68 mm) with severe global hypokinesia. LVEF {ef}% (biplane Simpson). Moderate functional MR. RV function mildly reduced. LA enlarged.' },
      { study: 'Chest PA', category: '영상검사', daysAgo: [1058, 520, 4], report: 'Cardiomegaly (CTR 0.62) with pulmonary venous congestion and small bilateral pleural effusion.' },
      { study: 'ECG 12-lead', category: '생리검사', daysAgo: [1058, 520, 150, 4], report: 'Sinus rhythm, LBBB (QRS 142 ms). LVH by voltage criteria.' },
      { study: 'Cardiac MRI', category: '영상검사', daysAgo: [1040], report: 'Dilated LV, LVEF 24%. Mid-wall late gadolinium enhancement in basal septum, suggestive of non-ischemic cardiomyopathy.' },
    ],
    vitals: { sbp: [92, 118], dbp: [58, 76], hr: [64, 96], weight: [54.8, 62.4] },
    ef: [25, 27],
    first: {
      cc: '호흡곤란, 전신 부종 (입원)',
      hpi: '42세 여자 환자로 2주 전부터 안정 시에도 호흡곤란, 기좌호흡, 하지 부종 및 체중 5 kg 증가로 응급실 경유 입원. 감기 증상 후 증상 악화. 흉통 없음.',
      pmh: 'Chronic HBV carrier (2019). 심혈관계 위험인자 없음. 음주력 없음. FHx 불분명.',
      exam: 'BP 98/64, HR 112, RR 24, SpO2 93% (RA). JVP 12 cmH2O, S3 gallop, bibasilar crackles, hepatomegaly, pitting edema 2+.',
      assess: ['#1 Acute decompensated heart failure — new onset, LVEF 25% (HFrEF)', '#2 Dilated cardiomyopathy, etiology work-up 진행', '#3 Chronic HBV, inactive'],
      plan: [
        { text: '입원 후 정맥 이뇨제(furosemide), 수분·염분 제한, 매일 체중 및 I/O 기록.', query: q.diur },
        { text: 'GDMT 순차 시작: 베타차단제, ARNI/ACEi, MRA, SGLT2 억제제. 혈압·K·Cr 모니터링.', query: q.arni },
        { text: 'NT-proBNP, troponin 추적. 심장 MRI로 원인 평가.', query: q.nt },
      ],
    },
    subj: ['호흡곤란은 호전되었으나 야간 기좌호흡 약간 남아 있음.', '체중 감소 중, 부종 감소. 어지러움 호소 없음.', '활동 시 숨참 NYHA II. 약물 순응도 양호.', '입원 후 소변량 증가, 하지 부종 호전.'],
    assess: ['HFrEF (LVEF 25%), 체액 상태 호전 중', 'DCM, GDMT 용량 적정 중', '신기능 및 전해질 안정'],
    planPool: [
      { text: 'ARNI(sacubitril/valsartan) 용량 유지. 혈압, 칼륨, 크레아티닌 추적 후 목표 용량으로 증량.', query: q.arni },
      { text: '베타차단제(bisoprolol) 저용량에서 서서히 증량. 서맥/저혈압 확인.', query: q.bb },
      { text: 'MRA(spironolactone) 유지, K > 5.5 mmol/L 시 중단 고려.', query: q.mra },
      { text: 'SGLT2 억제제(dapagliflozin) 유지.', query: q.sglt },
      { text: 'ICD 일차예방 적응증 평가: GDMT 3개월 이상 후에도 LVEF ≤35%.', query: q.icd },
      { text: '이뇨제는 증상과 체중에 맞춰 감량하며 경구 전환.', query: q.diur },
      { text: '수면무호흡 선별 검사 고려.', query: q.osa },
    ],
  },

  // 4. 최더미 — 순환기내과 외래, HFpEF + AF + CKD
  {
    seed: 404,
    id: 'P004',
    patient: {
      mrn: 'T0001004', name: '최더미', sex: 'F', ageLabel: '71세', ageYears: 71, birth: '1955-11-23', heightCm: 156, weightKg: 62.7,
      bloodType: 'O+', infection: none, allergy: ['NSAIDs (신기능 악화 병력)'], dept: '순환기내과', attending: '최심장', status: '외래',
      queue: { time: '10:50', state: '대기' },
      problems: [
        { code: 'I50.3', name: 'Heart failure, HFpEF (LVEF 58%)', since: '2023-02-18', active: true, guidelineQuery: q.hfpef },
        { code: 'I48.2', name: 'Persistent atrial fibrillation', since: '2023-02-18', active: true, guidelineQuery: q.af },
        { code: 'N18.31', name: 'Chronic kidney disease, stage 3a-3b', since: '2021-06-01', active: true, guidelineQuery: q.ckd },
        { code: 'D50.9', name: 'Iron deficiency anemia', since: '2024-03-12', active: true, guidelineQuery: q.iron },
      ],
      meds: [
        { name: 'Rivaroxaban', dose: '15 mg', sig: '1T qd (식후)', since: '2023-02-18' },
        { name: 'Dapagliflozin', dose: '10 mg', sig: '1T qd', since: '2023-06-01' },
        { name: 'Furosemide', dose: '20 mg', sig: '1T qd', since: '2023-02-18' },
        { name: 'Bisoprolol', dose: '2.5 mg', sig: '1T qd', since: '2023-02-18' },
      ],
      profile: '71세 여성, HFpEF(LVEF 58%), 지속성 심방세동, 만성 콩팥병 3기, 철결핍성 빈혈',
    },
    firstDaysAgo: 1330, gap: [75, 120], visitDept: '순환기내과', visitDoctor: '최심장',
    admissions: [{ daysAgo: 640, los: 5, reason: '급성 심부전 (체액 과다)', kind: 'HF', dept: '순환기내과', doctor: '최심장' }],
    surgeries: [],
    futureVisits: [45, 140],
    labs: [
      { name: 'NT-proBNP', from: 1850, to: 980, noise: 0.18, admitMul: 2.0 },
      { name: 'Creatinine', from: 1.15, to: 1.36, noise: 0.06 },
      { name: 'eGFR', from: 50, to: 41, noise: 0.05 },
      { name: 'Potassium', from: 4.6, to: 4.9, noise: 0.06 },
      { name: 'Sodium', from: 138, to: 139, noise: 0.01 },
      { name: 'Hemoglobin', from: 11.1, to: 11.8, noise: 0.04, ref: [12.0, 16.0] },
    ],
    drugs: [
      { name: 'Rivaroxaban 15mg tab', dose: '15 mg', sig: '1T qd', sinceDaysAgo: 1330, days: 90 },
      { name: 'Furosemide 20mg tab', dose: '20 mg', sig: '1T qd', sinceDaysAgo: 1330, days: 90 },
      { name: 'Bisoprolol 2.5mg tab', dose: '2.5 mg', sig: '1T qd', sinceDaysAgo: 1330, days: 90 },
      { name: 'Dapagliflozin 10mg tab', dose: '10 mg', sig: '1T qd', sinceDaysAgo: 1200, days: 90 },
    ],
    imaging: [
      { study: 'Echocardiography (TTE)', category: '생리검사', daysAgo: [1325, 900, 640, 300, 30], report: 'LVEF {ef}% with concentric LV hypertrophy, grade II diastolic dysfunction (E/e\' 15). LA volume index 52 mL/m². RVSP 38 mmHg.' },
      { study: 'ECG 12-lead', category: '생리검사', daysAgo: [1330, 640, 200], report: 'Atrial fibrillation, ventricular rate 76 bpm. LVH with strain pattern.' },
    ],
    vitals: { sbp: [112, 146], dbp: [62, 84], hr: [58, 88], weight: [60.2, 65.4] },
    ef: [58, 56],
    first: {
      cc: '숨참, 하지 부종',
      hpi: '71세 여자 환자로 수개월간 서서히 진행하는 활동 시 호흡곤란과 하지 부종, 두근거림. 만성 콩팥병 3기로 외부 병원에서 추적 중 심방세동 및 심부전 의심되어 의뢰.',
      pmh: 'CKD 3 (2021), HTN (2005), 갑상선 질환 없음. NSAIDs 사용 후 신기능 악화 병력.',
      exam: 'BP 138/78, HR 92 irregular, SpO2 95%. JVP 8 cmH2O, 폐 하부 수포음, 양하지 pitting edema 1+.',
      assess: ['#1 HFpEF (LVEF 58%), NYHA II-III', '#2 Persistent AF, CHA2DS2-VASc 5', '#3 CKD stage 3, eGFR 50'],
      plan: [
        { text: 'HFpEF: SGLT2 억제제 시작 검토, 이뇨제로 체액 조절.', query: q.hfpef },
        { text: 'AF: 신기능에 맞춰 rivaroxaban 15 mg qd 시작(CrCl 15-49).', query: q.af },
        { text: 'NT-proBNP, 신기능, 전해질 3개월 추적.', query: q.nt },
      ],
    },
    subj: ['숨참 호전, 부종 경미. 체중 변화 없음.', '새벽에 기침과 약간의 숨참. 이뇨제 복용 후 호전.', '피로감 호소, 현기증은 없음.', '두근거림 간헐적. 혈압 가정 측정 130/76.'],
    assess: ['HFpEF, 체액 상태 안정', 'Persistent AF, rate control 양호', 'CKD 3b, 신기능 안정', '철결핍성 빈혈, 보충 중'],
    planPool: [
      { text: 'SGLT2 억제제 지속, 탈수와 신기능 추적.', query: q.sglt },
      { text: '리바록사반 용량(15 mg) 신기능에 맞게 유지. CrCl 변화 시 재조정.', query: q.af },
      { text: '이뇨제 최소 유효 용량 유지, 체중 기록.', query: q.diur },
      { text: '철결핍 확인 후 IV iron 고려.', query: q.iron },
      { text: 'NT-proBNP 추적 및 TTE 재평가.', query: q.nt },
      { text: 'NSAIDs 회피 교육.' },
    ],
  },

  // 5. 정샘플 — 허혈성 심근병증 HFrEF
  {
    seed: 505,
    id: 'P005',
    patient: {
      mrn: 'T0001005', name: '정샘플', sex: 'M', ageLabel: '64세', ageYears: 64, birth: '1962-05-30', heightCm: 168, weightKg: 71.5,
      bloodType: 'AB+', infection: none, allergy: none, dept: '순환기내과', attending: '최심장', status: '외래',
      queue: { time: '11:10', state: '대기' },
      problems: [
        { code: 'I25.5', name: 'Ischemic cardiomyopathy, HFrEF (LVEF 30%)', since: '2022-03-10', active: true, guidelineQuery: q.icd },
        { code: 'I21.0', name: 'Old MI (anterior), s/p PCI (LAD)', since: '2021-11-20', active: true },
        { code: 'E78.5', name: 'Dyslipidemia', since: '2021-11-20', active: true },
      ],
      meds: [
        { name: 'Sacubitril/Valsartan', dose: '97/103 mg', sig: '1T bid', since: '2022-07-04' },
        { name: 'Carvedilol', dose: '25 mg', sig: '1T bid', since: '2022-03-10' },
        { name: 'Spironolactone', dose: '25 mg', sig: '1T qd', since: '2022-04-20' },
        { name: 'Empagliflozin', dose: '10 mg', sig: '1T qd', since: '2022-09-01' },
        { name: 'Aspirin', dose: '100 mg', sig: '1T qd', since: '2021-11-20' },
        { name: 'Atorvastatin', dose: '40 mg', sig: '1T qd', since: '2021-11-20' },
      ],
      profile: '64세 남성, 허혈성 심근병증 HFrEF(LVEF 30%), 구 심근경색 및 PCI, ICD 적응증 평가 중',
    },
    firstDaysAgo: 1380, gap: [80, 125], visitDept: '순환기내과', visitDoctor: '최심장',
    admissions: [{ daysAgo: 700, los: 5, reason: '심부전 악화', kind: 'HF', dept: '순환기내과', doctor: '최심장' }],
    surgeries: [],
    futureVisits: [40, 130],
    labs: [
      { name: 'NT-proBNP', from: 3100, to: 1450, noise: 0.2, admitMul: 1.8 },
      { name: 'Creatinine', from: 0.96, to: 1.08, noise: 0.06 },
      { name: 'eGFR', from: 82, to: 72, noise: 0.05 },
      { name: 'Potassium', from: 4.3, to: 4.8, noise: 0.07 },
      { name: 'Sodium', from: 138, to: 139, noise: 0.01 },
      { name: 'Hemoglobin', from: 13.4, to: 14.0, noise: 0.03, ref: [13.0, 17.0] },
      { name: 'LDL-C', from: 98, to: 55, noise: 0.08, every: 2 },
    ],
    drugs: [
      { name: 'Sacubitril/Valsartan 97/103mg tab', dose: '97/103 mg', sig: '1T bid', sinceDaysAgo: 1240, days: 90 },
      { name: 'Carvedilol 25mg tab', dose: '25 mg', sig: '1T bid', sinceDaysAgo: 1380, days: 90 },
      { name: 'Spironolactone 25mg tab', dose: '25 mg', sig: '1T qd', sinceDaysAgo: 1340, days: 90 },
      { name: 'Empagliflozin 10mg tab', dose: '10 mg', sig: '1T qd', sinceDaysAgo: 1180, days: 90 },
      { name: 'Aspirin 100mg tab', dose: '100 mg', sig: '1T qd', sinceDaysAgo: 1380, days: 90 },
      { name: 'Atorvastatin 40mg tab', dose: '40 mg', sig: '1T qd', sinceDaysAgo: 1380, days: 90 },
    ],
    imaging: [
      { study: 'Echocardiography (TTE)', category: '생리검사', daysAgo: [1375, 1000, 700, 330, 60], report: 'LVEF {ef}% with anteroseptal and apical akinesia. LVEDD 62 mm, no LV thrombus. Mild MR. RVSP 32 mmHg.' },
      { study: 'ECG 12-lead', category: '생리검사', daysAgo: [1380, 700, 200], report: 'Sinus rhythm, old anterior MI (QS in V1-V3). QRS 108 ms.' },
      { study: 'Coronary CT angiography', category: '영상검사', daysAgo: [1000], report: 'LAD stent patent with mild in-stent narrowing (<30%). RCA mild non-obstructive plaque.' },
    ],
    vitals: { sbp: [104, 132], dbp: [62, 80], hr: [58, 80], weight: [69.2, 73.8] },
    ef: [30, 34],
    first: {
      cc: '활동 시 숨참, 심근경색 후 추적',
      hpi: '64세 남자 환자로 2021-11 급성 전벽 심근경색으로 LAD stent 삽입 후 활동 시 호흡곤란이 지속되어 심부전 전문 외래 의뢰.',
      pmh: 'AMI s/p PCI (2021-11), Dyslipidemia. 흡연 30 pack-year (금연), 음주 소량.',
      exam: 'BP 118/72, HR 72, SpO2 97%. JVP 정상, S3 없음, 폐음 깨끗, 하지 부종 없음.',
      assess: ['#1 Ischemic cardiomyopathy, HFrEF LVEF 30%, NYHA II', '#2 Old MI s/p PCI'],
      plan: [
        { text: 'GDMT 4제 순차 시작: ARNI, 베타차단제, MRA, SGLT2 억제제.', query: q.arni },
        { text: 'GDMT 3개월 후 LVEF 재평가, ≤35% 지속 시 ICD 일차예방 고려.', query: q.icd },
        { text: 'NT-proBNP 추적.', query: q.nt },
      ],
    },
    subj: ['안정 시 증상 없음. 빠르게 걸을 때 숨참.', '어지러움 약간, 가정혈압 100/62 내외.', '기침이나 부종 없음. 운동 가능 범위 증가.', '활동 시 가슴 답답함 없음.'],
    assess: ['HFrEF LVEF 30-34%, NYHA II, 안정', 'GDMT 용량 적정 완료 단계', '혈압 낮은 편(100-110), 증상 동반 없음'],
    planPool: [
      { text: '베타차단제 목표 용량 유지, 서맥 및 저혈압 모니터링.', query: q.bb },
      { text: 'ARNI 최대 용량 유지, 저혈압 시 용량 조절.', query: q.arni },
      { text: 'MRA 유지, K와 Cr 4주 간격 확인.', query: q.mra },
      { text: 'ICD 일차예방 적응증 상담. LVEF ≤35%, GDMT 3개월 이상.', query: q.icd },
      { text: 'SGLT2 억제제 지속.', query: q.sglt },
      { text: '심장재활 프로그램 등록 권유.', query: q.rehab },
    ],
  },

  // 6. 한시연 — 내분비내과 DM
  {
    seed: 606,
    id: 'P006',
    patient: {
      mrn: 'T0001006', name: '한시연', sex: 'M', ageLabel: '49세', ageYears: 49, birth: '1977-09-09', heightCm: 175, weightKg: 92.6,
      bloodType: 'A-', infection: none, allergy: none, dept: '내분비내과', attending: '한내분', status: '외래',
      queue: { time: '11:30', state: '대기' },
      problems: [
        { code: 'E11.65', name: 'Type 2 diabetes mellitus with hyperglycemia', since: '2020-04-02', active: true, guidelineQuery: q.dm },
        { code: 'E66.9', name: 'Obesity (BMI 30.2)', since: '2020-04-02', active: true },
        { code: 'E78.5', name: 'Dyslipidemia', since: '2020-04-02', active: true },
        { code: 'K76.0', name: 'Fatty liver', since: '2022-02-14', active: true },
      ],
      meds: [
        { name: 'Metformin', dose: '1000 mg', sig: '1T bid', since: '2020-04-02' },
        { name: 'Empagliflozin', dose: '25 mg', sig: '1T qd', since: '2022-10-10' },
        { name: 'Dulaglutide', dose: '1.5 mg', sig: 'SC 주 1회', since: '2023-06-01' },
        { name: 'Rosuvastatin', dose: '10 mg', sig: '1T qd', since: '2020-04-02' },
      ],
      profile: '49세 남성, 제2형 당뇨병, 비만, 이상지질혈증',
    },
    firstDaysAgo: 1400, gap: [80, 120], visitDept: '내분비내과', visitDoctor: '한내분',
    admissions: [], surgeries: [], futureVisits: [50, 140],
    labs: [
      { name: 'HbA1c', from: 9.8, to: 6.8, noise: 0.05 },
      { name: 'Glucose (FBS)', from: 214, to: 124, noise: 0.08 },
      { name: 'LDL-C', from: 148, to: 74, noise: 0.08 },
      { name: 'ALT', from: 68, to: 41, noise: 0.15 },
      { name: 'Creatinine', from: 0.92, to: 0.98, noise: 0.05 },
      { name: 'eGFR', from: 96, to: 90, noise: 0.04 },
    ],
    drugs: [
      { name: 'Metformin 500mg tab', dose: '1000 mg', sig: '2T bid', sinceDaysAgo: 1400, days: 90 },
      { name: 'Empagliflozin 25mg tab', dose: '25 mg', sig: '1T qd', sinceDaysAgo: 1000, days: 90 },
      { name: 'Rosuvastatin 10mg tab', dose: '10 mg', sig: '1T qd', sinceDaysAgo: 1400, days: 90 },
      { name: 'Dulaglutide 1.5mg pen', dose: '1.5 mg', sig: 'SC 주 1회', sinceDaysAgo: 800, days: 84, category: '주사' },
    ],
    imaging: [{ study: 'Abdominal US', category: '영상검사', daysAgo: [1390, 700], report: 'Fatty liver, mild-to-moderate. Gallbladder and pancreas unremarkable.' }],
    vitals: { sbp: [122, 142], dbp: [74, 90], hr: [68, 88], weight: [88.0, 96.4] },
    first: {
      cc: '다음, 다뇨, 체중 변화',
      hpi: '49세 남자로 건강검진에서 공복혈당 210 mg/dL, HbA1c 9.8%로 확인되어 내원. 3개월간 다음, 다뇨, 피로감 호소.',
      pmh: '고지혈증. FHx: 부모 T2DM.',
      exam: 'BP 134/84, HR 78, BMI 31.4, 발 감각 정상, 안저 검사 의뢰.',
      assess: ['#1 T2DM, newly diagnosed (HbA1c 9.8%)', '#2 Obesity', '#3 Dyslipidemia'],
      plan: [{ text: '메트포르민 시작, 생활습관 교정(식이·운동) 교육.' }, { text: '합병증 평가: 안저, 소변 알부민, 신경병증 검사.' }],
    },
    subj: ['특별한 증상 없음. 식이 조절 중.', '체중 감소 4 kg, 저혈당 증상 없음.', '야식 빈도 감소. 운동 주 3회.'],
    assess: ['T2DM, 조절 개선', 'Dyslipidemia, 목표 도달', 'Fatty liver, 추적'],
    planPool: [
      { text: 'SGLT2 억제제 지속, 요로 감염 및 탈수 교육.', query: q.sglt },
      { text: 'HbA1c 3개월 추적, 목표 <7%.' },
      { text: '스타틴 지속, LDL-C 목표 확인.' },
      { text: '체중 감량 목표 5-10%, 영양 상담.' },
    ],
  },

  // 7. 오모의 — 심장내과 여성 (갑상선, 빈혈)
  {
    seed: 707,
    id: 'P007',
    patient: {
      mrn: 'T0001007', name: '오모의', sex: 'F', ageLabel: '36세', ageYears: 36, birth: '1990-01-18', heightCm: 162, weightKg: 54.0,
      bloodType: 'B+', infection: none, allergy: ['Sulfa (발진)'], dept: '심장내과', attending: '정의사', status: '외래',
      queue: { time: '13:00', state: '대기' },
      problems: [
        { code: 'E03.9', name: 'Hypothyroidism', since: '2023-04-11', active: true },
        { code: 'D50.9', name: 'Iron deficiency anemia', since: '2023-04-11', active: true },
      ],
      meds: [
        { name: 'Levothyroxine', dose: '75 μg', sig: '1T qd (공복)', since: '2023-04-11' },
        { name: 'Ferrous sulfate', dose: '256 mg', sig: '1T qd', since: '2023-04-11' },
      ],
      profile: '36세 여성, 갑상선기능저하증, 철결핍성 빈혈',
    },
    firstDaysAgo: 1280, gap: [90, 130], visitDept: '심장내과', visitDoctor: '정의사',
    admissions: [], surgeries: [], futureVisits: [60, 150],
    labs: [
      { name: 'TSH', from: 14.2, to: 2.6, noise: 0.12 },
      { name: 'Hemoglobin', from: 9.6, to: 12.6, noise: 0.03, ref: [12.0, 16.0] },
      { name: 'Ferritin', from: 6, to: 38, noise: 0.15 },
      { name: 'ALT', from: 18, to: 16, noise: 0.15 },
    ],
    drugs: [
      { name: 'Levothyroxine 75μg tab', dose: '75 μg', sig: '1T qd (공복)', sinceDaysAgo: 1280, days: 90 },
      { name: 'Ferrous sulfate 256mg tab', dose: '256 mg', sig: '1T qd', sinceDaysAgo: 1280, days: 90 },
    ],
    imaging: [{ study: 'Thyroid US', category: '영상검사', daysAgo: [1275], report: 'Diffusely heterogeneous echotexture, compatible with chronic thyroiditis. No discrete nodule.' }],
    vitals: { sbp: [100, 120], dbp: [60, 78], hr: [60, 84], weight: [52.0, 56.4] },
    first: {
      cc: '피로감, 추위 민감, 어지러움',
      hpi: '36세 여자로 6개월간 피로, 추위 민감성, 체중 증가, 변비, 월경과다 호소.',
      pmh: '특이 병력 없음. FHx: 모 갑상선 질환.',
      exam: 'BP 104/64, HR 62, 결막 창백, 갑상선 미세 비대(무통), 반사 지연.',
      assess: ['#1 Primary hypothyroidism, Hashimoto 의심', '#2 Iron deficiency anemia'],
      plan: [{ text: 'Levothyroxine 시작, 6-8주 후 TSH 재측정.' }, { text: '철분 보충, 월경과다 원인 평가 위해 산부인과 의뢰.' }],
    },
    subj: ['피로감 호전, 어지러움 감소.', '변비 호전, 체중 안정.', '월경량 감소, 철분제 복용 시 속쓰림 약간.'],
    assess: ['갑상선기능저하증, 호전', '빈혈, 호전 중'],
    planPool: [{ text: 'TSH 3개월 추적, 용량 조절.' }, { text: '철분제 지속, Hb 및 ferritin 확인.' }, { text: '철분 복용 방법(공복, 비타민 C) 교육.' }],
  },

  // 8. 윤더미 — 내과 입원 (폐렴 + HFpEF + CKD)
  {
    seed: 808,
    id: 'P008',
    patient: {
      mrn: 'T0001008', name: '윤더미', sex: 'M', ageLabel: '77세', ageYears: 77, birth: '1949-12-02', heightCm: 165, weightKg: 60.3,
      bloodType: 'O+', infection: ['MRSA 보균 (비강)'], allergy: ['Iodine contrast (두드러기)'], dept: '내과', attending: '오내과', status: '입원', ward: '72병동 3호',
      queue: { time: '입원 2일째', state: '입원' },
      problems: [
        { code: 'J18.9', name: 'Pneumonia, community-acquired', since: '2026-10-10', active: true },
        { code: 'I50.3', name: 'Heart failure, HFpEF', since: '2024-01-22', active: true, guidelineQuery: q.hfpef },
        { code: 'N18.4', name: 'Chronic kidney disease, stage 4', since: '2022-08-30', active: true, guidelineQuery: q.ckd },
        { code: 'I10', name: 'Essential hypertension', since: '2005-01-01', active: true },
      ],
      meds: [
        { name: 'Piperacillin/Tazobactam', dose: '4.5 g', sig: 'IV q8h', since: '2026-10-10' },
        { name: 'Furosemide', dose: '20 mg', sig: 'IV qd', since: '2026-10-10' },
        { name: 'Amlodipine', dose: '5 mg', sig: '1T qd', since: '2005-01-01' },
      ],
      profile: '77세 남성, 폐렴으로 입원 중, HFpEF, 만성 콩팥병 4기',
    },
    firstDaysAgo: 1220, gap: [85, 130], visitDept: '내과', visitDoctor: '오내과',
    admissions: [
      { daysAgo: 520, los: 6, reason: '급성 신우신염', kind: 'other', dept: '내과', doctor: '오내과' },
      { daysAgo: 2, los: null, reason: '지역사회획득 폐렴', kind: 'pneu', dept: '내과', doctor: '오내과' },
    ],
    surgeries: [], futureVisits: [40, 120],
    labs: [
      { name: 'CRP', from: 0.8, to: 11.5, noise: 0.25, admitMul: 1.4 },
      { name: 'WBC', from: 7.4, to: 14.2, noise: 0.15, admitMul: 1.3 },
      { name: 'Creatinine', from: 2.1, to: 2.6, noise: 0.06 },
      { name: 'eGFR', from: 31, to: 24, noise: 0.05 },
      { name: 'NT-proBNP', from: 2100, to: 3400, noise: 0.2, admitMul: 1.6 },
      { name: 'Potassium', from: 4.8, to: 5.3, noise: 0.06 },
      { name: 'Sodium', from: 138, to: 134, noise: 0.012 },
    ],
    drugs: [
      { name: 'Amlodipine 5mg tab', dose: '5 mg', sig: '1T qd', sinceDaysAgo: 1220, days: 90 },
      { name: 'Furosemide 20mg tab', dose: '20 mg', sig: '1T qd', sinceDaysAgo: 1000, days: 90 },
      { name: 'Calcium carbonate 500mg tab', dose: '500 mg', sig: '1T tid', sinceDaysAgo: 900, days: 90 },
    ],
    imaging: [
      { study: 'Chest PA', category: '영상검사', daysAgo: [520, 2], report: 'RLL consolidation with air bronchograms and small right pleural effusion. Mild cardiomegaly.' },
      { study: 'Echocardiography (TTE)', category: '생리검사', daysAgo: [900, 3], report: 'LVEF {ef}% with LV hypertrophy and grade II diastolic dysfunction. RVSP 44 mmHg.' },
    ],
    vitals: { sbp: [118, 156], dbp: [64, 88], hr: [66, 104], weight: [58.0, 62.4], bt: 37.4 },
    ef: [56, 54],
    first: {
      cc: '발열, 기침, 호흡곤란 (입원)',
      hpi: '77세 남자 환자로 5일 전부터 발열과 화농성 객담, 호흡곤란 악화. 만성 콩팥병 4기, HFpEF 병력.',
      pmh: 'CKD 4, HFpEF, HTN. 흡연 40 pack-year (금연).',
      exam: 'BT 38.4℃, BP 132/74, HR 104, RR 26, SpO2 92% (RA). 우하엽 수포음, 하지 부종 1+.',
      assess: ['#1 CAP, severe (CURB-65 3점)', '#2 HFpEF, 체액 과다 동반', '#3 CKD 4'],
      plan: [
        { text: '광범위 항생제 정맥 투여, 객담 및 혈액 배양, 산소 치료.' },
        { text: '신기능에 맞춘 약물 용량 조정, 조영제 금기.', query: q.ckd },
        { text: '이뇨제 조절하며 체액 균형 관찰.', query: q.diur },
      ],
    },
    subj: ['열 호전, 기침 감소.', '호흡곤란 호전, 산소 요구량 감소.', '식욕 저하, 소변량 감소 호소.'],
    assess: ['CAP, 호전', 'HFpEF, 체액 균형 확인', 'CKD 4, 신기능 모니터링'],
    planPool: [
      { text: '항생제 반응 평가 후 경구 전환 고려.' },
      { text: '체중, I/O 기록, 이뇨제 용량 조정.', query: q.diur },
      { text: '신기능 및 칼륨 매일 확인.', query: q.ckd },
      { text: '퇴원 후 호흡 재활 및 예방접종 상담.', query: q.vacc },
    ],
  },

  // 9. 서샘플 — 소아 천식
  {
    seed: 909,
    id: 'P009',
    patient: {
      mrn: 'T0001009', name: '서샘플', sex: 'F', ageLabel: '8세', ageYears: 8, birth: '2018-06-21', heightCm: 128, weightKg: 26.8,
      bloodType: 'A+', infection: none, allergy: ['집먼지진드기', '고양이 털'], dept: '소아청소년과', attending: '박소아', status: '외래',
      queue: { time: '14:10', state: '대기' },
      problems: [
        { code: 'J45.2', name: 'Mild intermittent asthma', since: '2023-03-10', active: true },
        { code: 'J30.9', name: 'Allergic rhinitis', since: '2022-09-02', active: true },
      ],
      meds: [{ name: 'Montelukast', dose: '5 mg', sig: '1T qd (취침 전)', since: '2023-03-10' }, { name: 'Salbutamol MDI', dose: '100 μg', sig: '필요시 2 puff', since: '2023-03-10' }],
      profile: '8세 여아, 경증 간헐성 천식, 알레르기 비염',
    },
    firstDaysAgo: 1300, gap: [70, 110], visitDept: '소아청소년과', visitDoctor: '박소아',
    admissions: [{ daysAgo: 800, los: 3, reason: '천식 급성 악화', kind: 'other', dept: '소아청소년과', doctor: '박소아' }],
    surgeries: [], futureVisits: [45, 120],
    labs: [
      { name: 'WBC', from: 9.8, to: 7.6, noise: 0.15, ref: [4.5, 13.5] },
      { name: 'CRP', from: 0.9, to: 0.1, noise: 0.5 },
      { name: 'IgE (total)', from: 420, to: 310, noise: 0.1 },
      { name: 'Hemoglobin', from: 12.4, to: 13.2, noise: 0.03, ref: [11.5, 15.5] },
    ],
    drugs: [
      { name: 'Montelukast 5mg chew tab', dose: '5 mg', sig: '1T qd', sinceDaysAgo: 1100, days: 90 },
      { name: 'Salbutamol MDI 100μg', dose: '100 μg', sig: '필요시 2 puff', sinceDaysAgo: 1100, days: 90 },
    ],
    episodic: [{ name: 'Prednisolone tab', dose: '1 mg/kg', sig: 'qd × 3일', sinceDaysAgo: 0, days: 3 }, { name: 'Budesonide nebule', dose: '0.5 mg', sig: 'bid 흡입 × 5일', sinceDaysAgo: 0, days: 5 }],
    imaging: [{ study: 'Chest PA', category: '영상검사', daysAgo: [800], report: 'Mild peribronchial thickening. No focal consolidation or pneumothorax.' }],
    vitals: { sbp: [90, 108], dbp: [54, 68], hr: [72, 104], weight: [20.6, 27.0] },
    first: {
      cc: '반복되는 기침과 쌕쌕거림',
      hpi: '8세 아동 이전부터 감기 후 기침이 길게 지속되고 야간 및 운동 시 쌕쌕거림이 반복.',
      pmh: '아토피 피부염(영아기). FHx: 부 천식.',
      exam: 'BT 36.7, HR 96, RR 22, 청진상 호기 시 천명음 경미, 인후 정상.',
      assess: ['#1 Asthma, 경증 간헐성', '#2 Allergic rhinitis'],
      plan: [{ text: 'Montelukast 시작, 속효성 기관지확장제 필요시 사용 교육.' }, { text: '알레르기 항원 회피 및 폐기능 검사 계획.' }],
      birth: '재태 40주, 3.4 kg, NSVD.',
      vaccine: '국가 예방접종 일정 완료, 인플루엔자 매년 접종.',
      growth: '신장 128 cm (50-75 percentile), 체중 26.8 kg (50 percentile). 발달 정상.',
    },
    subj: ['야간 기침 감소, 운동 시 쌕쌕거림 가끔.', '감기 후 기침 악화, 속효성 흡입 사용.', '증상 없음, 학교 체육 활동 정상.'],
    assess: ['천식, 조절 양호', '알레르기 비염, 조절 중'],
    planPool: [{ text: '흡입기 사용법 재교육, 증상 일지 작성.' }, { text: '집먼지진드기 회피 환경 관리 교육.' }, { text: '3개월 후 폐기능 및 증상 조절 재평가.' }],
  },

  // 10. 문시험 — 신장내과 CKD
  {
    seed: 1010,
    id: 'P010',
    patient: {
      mrn: 'T0001010', name: '문시험', sex: 'M', ageLabel: '53세', ageYears: 53, birth: '1973-02-27', heightCm: 170, weightKg: 82.0,
      bloodType: 'B+', infection: ['HCV Ab (-)'], allergy: none, dept: '신장내과', attending: '장신장', status: '외래',
      queue: { time: '14:40', state: '대기' },
      problems: [
        { code: 'N18.32', name: 'Chronic kidney disease, stage 3b', since: '2021-05-17', active: true, guidelineQuery: q.ckd },
        { code: 'I12.9', name: 'Hypertensive CKD', since: '2021-05-17', active: true },
        { code: 'M10.9', name: 'Gout', since: '2022-02-03', active: true },
      ],
      meds: [
        { name: 'Valsartan', dose: '160 mg', sig: '1T qd', since: '2021-05-17' },
        { name: 'Amlodipine', dose: '5 mg', sig: '1T qd', since: '2021-05-17' },
        { name: 'Febuxostat', dose: '40 mg', sig: '1T qd', since: '2022-02-03' },
      ],
      profile: '53세 남성, 만성 콩팥병 3b기, 고혈압성 신질환, 통풍',
    },
    firstDaysAgo: 1360, gap: [80, 120], visitDept: '신장내과', visitDoctor: '장신장',
    admissions: [], surgeries: [], futureVisits: [55, 130],
    labs: [
      { name: 'Creatinine', from: 1.7, to: 1.9, noise: 0.05 },
      { name: 'eGFR', from: 44, to: 39, noise: 0.05 },
      { name: 'Potassium', from: 4.9, to: 5.2, noise: 0.06 },
      { name: 'Hemoglobin', from: 12.4, to: 12.0, noise: 0.03, ref: [13.0, 17.0] },
      { name: 'Uric acid', from: 9.2, to: 6.1, noise: 0.08 },
      { name: 'Sodium', from: 140, to: 139, noise: 0.01 },
    ],
    drugs: [
      { name: 'Valsartan 160mg tab', dose: '160 mg', sig: '1T qd', sinceDaysAgo: 1360, days: 90 },
      { name: 'Amlodipine 5mg tab', dose: '5 mg', sig: '1T qd', sinceDaysAgo: 1360, days: 90 },
      { name: 'Febuxostat 40mg tab', dose: '40 mg', sig: '1T qd', sinceDaysAgo: 1200, days: 90 },
    ],
    imaging: [{ study: 'Renal US', category: '영상검사', daysAgo: [1355, 640], report: 'Both kidneys mildly decreased in size with increased cortical echogenicity. No hydronephrosis.' }],
    vitals: { sbp: [126, 152], dbp: [76, 94], hr: [64, 84], weight: [80.0, 84.6] },
    first: {
      cc: '건강검진 신기능 이상',
      hpi: '53세 남자로 건강검진에서 크레아티닌 1.7 mg/dL, 단백뇨 확인되어 의뢰. 고혈압 10년 이상.',
      pmh: 'HTN (2011). 통풍 발작 1회 (2022).',
      exam: 'BP 148/92, HR 74, 부종 없음, 신장 타진 압통 없음.',
      assess: ['#1 CKD 3b, 고혈압성 신질환 의심', '#2 Gout'],
      plan: [{ text: 'ARB 시작 및 혈압 목표 <130/80. 단백뇨 정량.' }, { text: '요산 저하제 지속, 식이 교육.' }],
    },
    subj: ['특별한 증상 없음. 혈압 가정 측정 130대.', '관절통 없음. 부종 없음.', '소변 거품 감소.'],
    assess: ['CKD 3b, 안정', '혈압 조절 양호', '통풍 발작 없음'],
    planPool: [{ text: 'ARB 유지, 칼륨과 크레아티닌 추적.', query: q.ckd }, { text: '단백뇨 및 신기능 3개월 추적.' }, { text: '저염 식이 및 NSAIDs 회피 교육.' }],
  },
]
