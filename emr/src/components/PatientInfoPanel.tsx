import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEMR } from '../state/EMRContext'
import { PanelTitle } from './ui'
import PatientList from './PatientList'
import type { Patient } from '../types'

const FUNCS: { label: string; color: string }[] = [
  { label: '접수', color: '#2f86d6' }, { label: '예약', color: '#1fa6a6' }, { label: '입원', color: '#d98a12' }, { label: '퇴원', color: '#7d8aa0' },
  { label: '진단서', color: '#3aa656' }, { label: '소견서', color: '#3aa656' }, { label: '협진', color: '#8a5ccc' }, { label: '동의서', color: '#8a5ccc' },
  { label: '처방전', color: '#2f86d6' }, { label: '영상', color: '#8a5ccc' }, { label: '병리', color: '#c2527a' }, { label: '수술', color: '#d23a30' },
]

export const hasBody = (p: Patient) => p.heightCm > 0 && p.weightKg > 0
export const bmi = (p: Patient) => (hasBody(p) ? p.weightKg / Math.pow(p.heightCm / 100, 2) : NaN)
export const bsa = (p: Patient) => (hasBody(p) ? Math.sqrt((p.heightCm * p.weightKg) / 3600) : NaN)

export default function PatientInfoPanel() {
  const { bundle, openDialog } = useEMR()
  const p = bundle.patient
  const rows: [string, ReactNode][] = [
    ['환자번호', <b key="m" className="text-white">{p.mrn}</b>],
    ['성별/나이', `${p.sex === 'M' ? '남' : '여'} / ${p.ageLabel}`],
    ['생년월일', p.birth ? p.birth.replace(/-/g, '.') : '- (비식별)'],
    ['키/체중', hasBody(p) ? `${p.heightCm} cm / ${p.weightKg} kg` : '- (기록 없음)'],
    ['BMI / BSA', hasBody(p) ? `${bmi(p).toFixed(1)} / ${bsa(p).toFixed(2)} ㎡` : '-'],
    ['혈액형', `${p.bloodType}`],
    ['진료과', p.dept],
    ['담당의', p.attending],
    ['구분', <span key="s" className="tag" style={{ background: p.status === '입원' ? '#d23a30' : '#2f86d6' }}>{p.status}{p.ward ? ` · ${p.ward}` : ''}</span>],
    ...(p.group === 'hf' ? ([['입원일', p.admitDate ? p.admitDate.replace(/-/g, '.') : '-'], ['퇴원 형태', <b key="o" className={p.outcome === '사망' ? 'text-emr-bad' : 'text-white'}>{p.outcome ?? '-'}</b>], ['자료', 'MEDS 심부전 코호트(비식별)']] as [string, React.ReactNode][]) : []),
  ]
  return (
    <div className="flex w-[232px] shrink-0 flex-col border-r border-black bg-emr-panel">
      <PanelTitle>환자정보</PanelTitle>
      <div className="border-b border-black/60 bg-gradient-to-b from-[#3d4c67] to-[#344158] px-2 py-1.5">
        <div className="flex items-center gap-2">
          <span className={`flex h-[34px] w-[34px] items-center justify-center border border-black/60 text-[15px] font-extrabold text-white ${p.sex === 'M' ? 'bg-gradient-to-b from-[#3d9bea] to-[#17609f]' : 'bg-gradient-to-b from-[#e0709a] to-[#a63a62]'}`}>{p.sex === 'M' ? '♂' : '♀'}</span>
          <div className="min-w-0">
            <div className="truncate text-[16px] font-extrabold leading-tight text-white">{p.name}</div>
            <div className="truncate text-[10.5px] text-emr-sub">{p.dept}{p.attending !== '-' ? ` · ${p.attending} 선생님` : ''}</div>
          </div>
        </div>
      </div>
      <table className="w-full border-collapse text-[11px]">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-[#4a5870]">
              <td className="w-[62px] border-r border-[#4a5870] bg-[#2b3750] px-1.5 py-[2px] text-emr-sub">{k}</td>
              <td className="px-1.5 py-[2px]">{v}</td>
            </tr>
          ))}
          <tr className="border-b border-[#4a5870]">
            <td className="border-r border-[#4a5870] bg-[#2b3750] px-1.5 py-[2px] text-emr-sub">감염정보</td>
            <td className="px-1.5 py-[2px]">{p.infection.length ? p.infection.map((i) => <span key={i} className="mr-1 inline-block border border-[#7a1010] bg-[#b02a2a] px-1 text-[10px] font-bold text-white">{i}</span>) : <span className="text-emr-sub">없음</span>}</td>
          </tr>
          <tr className="border-b border-[#4a5870]">
            <td className="border-r border-[#4a5870] bg-[#2b3750] px-1.5 py-[2px] text-emr-sub">알레르기</td>
            <td className="px-1.5 py-[2px]">{p.allergy.length ? p.allergy.map((i) => <span key={i} className="mr-1 inline-flex items-center gap-0.5 border border-[#8a5a00] bg-[#c27d00] px-1 text-[10px] font-bold text-white"><AlertTriangle size={9} />{i}</span>) : <span className="text-emr-sub">없음</span>}</td>
          </tr>
        </tbody>
      </table>
      <div className="grid grid-cols-4 gap-[3px] border-b border-black/60 bg-[#2b3750] p-1.5">
        {FUNCS.map((f) => <button key={f.label} type="button" className="btn btn-fn" style={{ background: `linear-gradient(180deg, ${f.color}, ${f.color}bb)` }} onClick={() => openDialog('func', f.label)}>{f.label}</button>)}
      </div>
      <PanelTitle right={<span className="text-[10px] font-normal">{bundleCount()}</span>}>환자 목록 · 진료상태</PanelTitle>
      <PatientList compact />
    </div>
  )
  function bundleCount() { return '' }
}
