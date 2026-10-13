import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { useEMR } from '../state/EMRContext'
import { Btn } from './ui'

const STATE_COLOR: Record<string, string> = { 대기: '#d98a12', 진료중: '#2f86d6', 수납: '#1fa6a6', 완료: '#7d8aa0', 입원: '#d23a30', 퇴원: '#3aa656', 사망: '#555f70' }

export function StateTag({ s }: { s: string }) {
  return <span className="tag" style={{ background: STATE_COLOR[s] ?? '#7d8aa0', minWidth: 32 }}>{s}</span>
}

export default function PatientList({ compact = false, onPick }: { compact?: boolean; onPick?: () => void }) {
  const { patients, patientId, selectPatient } = useEMR()
  const hf = useMemo(() => patients.filter((p) => p.group === 'hf'), [patients])
  const demo = useMemo(() => patients.filter((p) => p.group !== 'hf'), [patients])
  const current = patients.find((p) => p.id === patientId)
  const [tab, setTab] = useState<'hf' | 'demo'>(current?.group === 'hf' || hf.length ? 'hf' : 'demo')
  const [q, setQ] = useState('')
  const base = tab === 'hf' ? hf : demo
  const rows = useMemo(() => base.filter((p) => !q || `${p.name}${p.mrn}${p.dept}${p.ward ?? ''}${p.queue.state}`.includes(q)), [base, q])
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 p-1">
        <Btn sm active={tab === 'hf'} onClick={() => setTab('hf')} title="MEDS 데이터셋에서 심부전(KCD-8 I50.9)으로 진단된 환자">심부전 {hf.length}</Btn>
        <Btn sm active={tab === 'demo'} onClick={() => setTab('demo')} title="시연용 가상 환자">시연 {demo.length}</Btn>
        <div className="relative ml-auto flex-1">
          <Search size={10} className="absolute left-1 top-[5px] text-emr-sub" />
          <input className="inp w-full pl-4" placeholder="환자명/번호/병동" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto border-t border-black/50">
        <table className="etable">
          <thead><tr><th style={{ width: 54 }}>{tab === 'hf' ? '입원일' : '시간'}</th><th>환자명</th><th style={{ width: 62 }}>성/나이</th>{!compact && <th style={{ width: 60 }}>{tab === 'hf' ? '병동' : '진료과'}</th>}<th style={{ width: 40 }}>상태</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className={p.id === patientId ? 'sel' : ''} onClick={() => { selectPatient(p.id); onPick?.() }} style={{ cursor: 'pointer' }}>
                <td>{p.queue.time.length > 5 ? '' : p.queue.time}</td>
                <td><b>{p.name}</b></td>
                <td>{p.sex}/{p.ageLabel.replace('세', '').replace('연령 미상', '?')}</td>
                {!compact && <td title={p.dept}>{tab === 'hf' ? p.ward : p.dept.replace('내과', '내').replace('소아청소년과', '소청')}</td>}
                <td><StateTag s={p.queue.state} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="p-3 text-center text-emr-sub">해당 환자가 없습니다.</div>}
      </div>
    </div>
  )
}
