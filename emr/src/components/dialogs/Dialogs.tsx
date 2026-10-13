import { useMemo, useState } from 'react'
import { Bot } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useEMR } from '../../state/EMRContext'
import { useGuideline } from '../../state/GuidelineContext'
import type { NoteKind, Order, OrderCategory, Visit } from '../../types'
import { TODAY, iso, todayISO } from '../../data/rng'
import { bmi, bsa } from '../PatientInfoPanel'
import PatientList from '../PatientList'
import { Btn, CatTag, Modal } from '../ui'
import NoteDocument, { recordHeadText } from '../windows/NoteDocument'
import type { PlanItem } from '../../types'

const fmt = (d: string) => d.replace(/-/g, '.')

function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <table className="w-full border-collapse text-[12px]">
      <tbody>{rows.map(([k, v]) => (
        <tr key={k} className="border-b border-[#4a5870]"><td className="w-[96px] border-r border-[#4a5870] bg-[#2b3750] px-2 py-[3px] text-emr-sub">{k}</td><td className="px-2 py-[3px]">{v}</td></tr>
      ))}</tbody>
    </table>
  )
}

const FUNC_TEXT: Record<string, string> = {
  접수: '외래 접수를 처리합니다.', 예약: '다음 외래 예약을 등록합니다.', 입원: '입원 오더를 작성하고 병상을 배정합니다.', 퇴원: '퇴원 처방 및 퇴원 요약 작성을 시작합니다.',
  진단서: '진단서 발급 신청서를 작성합니다.', 소견서: '소견서 발급 신청서를 작성합니다.', 협진: '타과 협진을 의뢰합니다.', 동의서: '전자 동의서를 출력합니다.',
  처방전: '외래 처방전을 출력합니다.', 영상: 'PACS 영상 뷰어를 연결합니다.', 병리: '병리 검사 결과를 조회합니다.', 수술: '수술/시술 예약 및 동의 절차를 시작합니다.',
}

export default function Dialogs() {
  const { dialog, closeDialog, bundle, selectedEncounter, selectedDate, user, toast, addNote, updateNote, deleteNote, addOrder, selectPatient, selectedEncounterId, settings, setSettings, logout, openWindow } = useEMR()
  const { ask } = useGuideline()
  const p = bundle.patient
  const encId = selectedEncounterId ?? bundle.encounters[0]?.id ?? ''
  const day = selectedDate ?? todayISO

  // 입력 상태 (기록작성 / 오더추가 / 메모)
  const [nTitle, setNTitle] = useState('')
  const [nKind, setNKind] = useState<NoteKind>('경과')
  const [nBody, setNBody] = useState('')
  const [eTitle, setETitle] = useState('')
  const [eBodies, setEBodies] = useState<string[]>([])
  const [eFor, setEFor] = useState('')
  const [oName, setOName] = useState('')
  const [oCat, setOCat] = useState<OrderCategory>('약물')
  const [oDetail, setODetail] = useState('')
  const [memo, setMemo] = useState(() => { try { return localStorage.getItem('emr.memo') ?? '' } catch { return '' } })

  const dayOrders = useMemo(() => bundle.orders.filter((o) => o.date === day), [bundle.orders, day])
  const dayLabs = useMemo(() => bundle.labs.filter((l) => l.date === day), [bundle.labs, day])
  const dayVital = bundle.vitals.find((v) => v.date === day)
  const trend = useMemo(() => [...bundle.vitals].sort((a, b) => (a.date < b.date ? -1 : 1)).map((v) => ({ d: v.date.slice(2).replace(/-/g, '.'), SBP: v.sbp || null, DBP: v.dbp || null, HR: v.hr || null, BW: v.weightKg || null })), [bundle.vitals])

  if (!dialog) return null
  const close = closeDialog

  switch (dialog.type) {
    case 'func':
      return (
        <Modal title={`${String(dialog.data)} — ${p.name} (${p.mrn})`} onClose={close} width={420}
          footer={<><Btn onClick={close}>취소</Btn><Btn blue onClick={() => { toast(`${String(dialog.data)} 처리를 완료했습니다. (시연)`); close() }}>확인</Btn></>}>
          <div className="mb-2 text-[12px]">{FUNC_TEXT[String(dialog.data)] ?? '요청한 업무를 처리합니다.'}</div>
          <KV rows={[['환자', `${p.name} / ${p.sex} / ${p.ageLabel}`], ['진료과', p.dept], ['담당의', p.attending], ['기준일', fmt(day)]]} />
        </Modal>
      )

    case 'logout':
      return (
        <Modal title="로그아웃" onClose={close} width={360} footer={<><Btn onClick={close}>취소</Btn><Btn blue onClick={() => { close(); void logout() }}>로그아웃</Btn></>}>
          <div className="py-2 text-[12px]">{user.name} {user.title}님, 시스템에서 로그아웃하시겠습니까?<br /><span className="text-emr-sub">작성 중인 내용은 저장되지 않습니다. (시연)</span></div>
        </Modal>
      )

    case 'summary':
      return (
        <Modal title={`환자 요약 — ${p.name}`} onClose={close} width={640}>
          <KV rows={[['환자', `${p.name} (${p.mrn}) · ${p.sex === 'M' ? '남' : '여'} ${p.ageLabel} · ${p.dept} ${p.attending}`], ['체격', Number.isFinite(bmi(p)) ? `${p.heightCm} cm / ${p.weightKg} kg · BMI ${bmi(p).toFixed(1)} · BSA ${bsa(p).toFixed(2)} ㎡` : '기록 없음'], ['알레르기', p.allergy.join(', ') || '없음'], ['감염', p.infection.join(', ') || '없음']]} />
          <div className="sect-title mt-3">문제목록</div>
          <table className="etable"><tbody>{p.problems.map((x) => (
            <tr key={x.code}><td style={{ width: 60 }}>{x.code}</td><td title={x.name}>{x.name}</td><td style={{ width: 70 }}>{fmt(x.since)}</td>
              <td style={{ width: 62 }}>{x.guidelineQuery && <button type="button" className="tag-ai" onClick={() => { ask(x.guidelineQuery!, `환자요약 › ${x.name}`); close() }}><Bot size={10} />지침</button>}</td></tr>
          ))}</tbody></table>
          <div className="sect-title mt-3">현재 복용 약물</div>
          <table className="etable"><tbody>{p.meds.map((m) => <tr key={m.name}><td>{m.name}</td><td style={{ width: 80 }}>{m.dose}</td><td style={{ width: 110 }}>{m.sig}</td><td style={{ width: 76 }}>{fmt(m.since)}</td></tr>)}</tbody></table>
          <div className="sect-title mt-3">최근 검사</div>
          <table className="etable"><tbody>{[...new Set(bundle.labs.map((l) => l.name))].slice(0, 8).map((n) => {
            const l = [...bundle.labs].filter((x) => x.name === n).sort((a, b) => (a.datetime < b.datetime ? 1 : -1))[0]
            return <tr key={n}><td>{n}</td><td className={`num ${l.flag === 'N' ? 'val-n' : l.flag.startsWith('H') ? 'val-h' : 'val-l'}`}>{l.value}</td><td>{l.unit}</td><td>{fmt(l.date)}</td></tr>
          })}</tbody></table>
        </Modal>
      )

    case 'patients':
      return (
        <Modal title="환자 목록" onClose={close} width={620}>
          <div className="flex h-[360px] flex-col"><PatientList onPick={close} /></div>
          <div className="mt-1 text-[10.5px] text-emr-sub">행을 선택하면 해당 환자로 전환됩니다. 모든 환자는 가상 데이터입니다.</div>
        </Modal>
      )

    case 'cohort': {
      const cf = p.cohortFeatures
      if (!cf) return null
      return (
        <Modal title={`전처리 요약 (features.csv) — ${p.name}`} onClose={close} width={760} footer={<Btn onClick={close}>닫기</Btn>}>
          <div className="mb-2 text-[12px]">furosemide 투여 시점 <b className="text-white">t0 = {cf.t0}</b> <span className="text-emr-sub">· stay {cf.stayId}</span></div>
          {cf.sections.map((s) => (
            <div key={s.title} className="mb-2">
              <div className="mb-[2px] text-[11.5px] font-bold text-emr-sub">{s.title}</div>
              <table className="w-full border-collapse text-[12px]">
                <tbody>{s.rows.map((r) => (
                  <tr key={r.k} className="border-b border-[#4a5870]">
                    <td className="w-[150px] border-r border-[#4a5870] bg-[#2b3750] px-2 py-[2px] text-emr-sub">{r.k}</td>
                    <td className="w-[210px] px-2 py-[2px]" style={r.v === '미측정' || r.v === '기록 없음' ? { color: '#8a97ad' } : undefined}>{r.v}</td>
                    <td className="px-2 py-[2px] text-[11px] text-emr-sub">{r.note}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ))}
          <ul className="mt-1 list-disc pl-4 text-[11px] text-emr-sub">{cf.notes.map((n) => <li key={n}>{n}</li>)}<li>{cf.source}</li></ul>
        </Modal>
      )
    }

    case 'memo':
      return (
        <Modal title={`메모 — ${p.name}`} onClose={close} width={460} footer={<><Btn onClick={close}>닫기</Btn><Btn blue onClick={() => { try { localStorage.setItem('emr.memo', memo) } catch { /* 저장 불가 */ } toast('메모를 저장했습니다.'); close() }}>저장</Btn></>}>
          <textarea className="inp h-[180px] w-full" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="개인 메모 (이 브라우저에만 저장됩니다)" />
        </Modal>
      )

    case 'cvr': {
      const age = p.ageYears
      const factors = [
        { k: '고혈압', on: p.problems.some((x) => /hypertens/i.test(x.name)) }, { k: '당뇨병', on: p.problems.some((x) => /diabetes/i.test(x.name)) },
        { k: '이상지질혈증', on: p.problems.some((x) => /lipid/i.test(x.name)) }, { k: '심부전', on: p.problems.some((x) => /heart failure|cardiomyopathy/i.test(x.name)) },
        { k: '심방세동', on: p.problems.some((x) => /fibrillation/i.test(x.name)) }, { k: '만성 콩팥병', on: p.problems.some((x) => /kidney/i.test(x.name)) },
        { k: '비만 (BMI ≥ 25)', on: Number.isFinite(bmi(p)) && bmi(p) >= 25 }, { k: '고령 (≥ 65세)', on: age >= 65 },
      ]
      const n = factors.filter((f) => f.on).length
      const level = n >= 4 ? ['매우 높음', '#f05468'] : n >= 2 ? ['높음', '#f5a623'] : n >= 1 ? ['중등도', '#d9c94a'] : ['낮음', '#61c86a']
      return (
        <Modal title={`CVR (심혈관 위험요인) — ${p.name}`} onClose={close} width={440}>
          <div className="mb-2 text-[12px]">위험요인 {n}개 해당 → <b style={{ color: level[1] }}>{level[0]}</b> <span className="text-emr-sub">(문제목록 기반 단순 집계, 진료용 점수가 아님)</span></div>
          <table className="etable"><tbody>{factors.map((f) => <tr key={f.k}><td>{f.k}</td><td style={{ width: 60, color: f.on ? '#f05468' : '#61c86a', fontWeight: 700 }}>{f.on ? '해당' : '-'}</td></tr>)}</tbody></table>
        </Modal>
      )
    }

    case 'setting':
      return (
        <Modal title="설정" onClose={close} width={380} footer={<Btn blue onClick={close}>확인</Btn>}>
          <div className="space-y-3 py-1 text-[12px]">
            <div className="flex items-center gap-2"><span className="w-[90px] text-emr-sub">글자 크기</span>{[11, 12, 13].map((s) => <Btn key={s} active={settings.fontSize === s} onClick={() => setSettings({ fontSize: s })}>{s}px</Btn>)}</div>
            <div className="flex items-center gap-2"><span className="w-[90px] text-emr-sub">표 행 높이</span><Btn active={!settings.compact} onClick={() => setSettings({ compact: false })}>보통</Btn><Btn active={settings.compact} onClick={() => setSettings({ compact: true })}>촘촘하게</Btn></div>
            <div className="text-[11px] text-emr-sub">설정은 이 브라우저에 저장됩니다.</div>
          </div>
        </Modal>
      )

    case 'visit':
      return (
        <Modal title={`수진 정보 — ${p.name}`} onClose={close} width={460}>
          {selectedEncounter ? <KV rows={[['진료일', `${fmt(selectedEncounter.date)}${selectedEncounter.endDate ? ` ~ ${fmt(selectedEncounter.endDate)}` : ''}`], ['진료구분', selectedEncounter.type + (selectedEncounter.future ? ' (예약)' : '')], ['진료과', selectedEncounter.dept], ['진료의', selectedEncounter.doctor], ['진료명', selectedEncounter.title], ['요약', selectedEncounter.summary], ['보험', '건강보험 (본인부담 20%)'], ['수납', selectedEncounter.future ? '미수납 (예약)' : '수납 완료']]} /> : <div>선택된 진료가 없습니다.</div>}
        </Modal>
      )

    case 'data':
      return (
        <Modal title={`진료 데이터 — ${fmt(day)}`} onClose={close} width={560}>
          <div className="sect-title">활력징후 / 계측</div>
          {dayVital ? <KV rows={[['혈압', dayVital.sbp ? `${dayVital.sbp}/${dayVital.dbp} mmHg` : '-'], ['맥박', dayVital.hr ? `${dayVital.hr} /min` : '-'], ['체온', dayVital.bt ? `${dayVital.bt} ℃` : '-'], ['SpO2', dayVital.spo2 ? `${dayVital.spo2} %` : '-'], ['체중', dayVital.weightKg ? `${dayVital.weightKg} kg` : '-']]} /> : <div className="text-emr-sub">해당 일자의 활력징후가 없습니다.</div>}
          <div className="sect-title mt-3">검사 결과 ({dayLabs.length})</div>
          <table className="etable"><tbody>{dayLabs.map((l) => <tr key={l.id}><td>{l.name}</td><td className={`num ${l.flag === 'N' ? 'val-n' : l.flag.startsWith('H') ? 'val-h' : 'val-l'}`}>{l.value}</td><td>{l.unit}</td><td>{l.refText}</td></tr>)}</tbody></table>
          <div className="sect-title mt-3">오더 ({dayOrders.length})</div>
          <table className="etable"><tbody>{dayOrders.slice(0, 12).map((o) => <tr key={o.id}><td style={{ width: 64 }}><CatTag cat={o.category} /></td><td>{o.name}</td><td>{o.detail}</td></tr>)}</tbody></table>
        </Modal>
      )

    case 'images': {
      const imgs = bundle.imaging.filter((m) => m.date === day)
      return (
        <Modal title={`이미지 / 영상 — ${fmt(day)}`} onClose={close} width={560}>
          {imgs.length ? imgs.map((m) => (
            <div key={m.id} className="mb-2 flex gap-2 border border-[#4a5870] p-1.5">
              <svg width="92" height="92" viewBox="0 0 92 92" className="shrink-0 border border-black bg-black">
                <defs><radialGradient id={`g${m.id}`}><stop offset="0%" stopColor="#8fa0b8" stopOpacity="0.9" /><stop offset="100%" stopColor="#0b1018" /></radialGradient></defs>
                <rect width="92" height="92" fill={`url(#g${m.id})`} /><ellipse cx="46" cy="46" rx="26" ry="34" fill="none" stroke="#c7d3e6" strokeOpacity="0.5" /><line x1="46" y1="8" x2="46" y2="84" stroke="#c7d3e6" strokeOpacity="0.4" />
              </svg>
              <div className="min-w-0 text-[11.5px]"><b className="text-[#7fe6f5]">{m.study}</b> · {m.dept}<div className="mt-1 text-[#cdd8e8]">{m.report}</div></div>
            </div>
          )) : <div className="text-emr-sub">선택한 일자의 영상 검사가 없습니다. (이미지는 PACS 연동 전 시연용 미리보기입니다)</div>}
        </Modal>
      )
    }

    case 'history': {
      const n = bundle.notes.find((x) => x.id === dialog.data)
      return (
        <Modal title="기록 이력 조회" onClose={close} width={520}>
          {n ? (<>
            <div className="mb-1 font-bold">{n.title}</div>
            <table className="etable"><thead><tr><th>일시</th><th>구분</th><th>사용자</th><th>내용</th></tr></thead><tbody>
              <tr><td>{fmt(n.date)} {n.time}</td><td>작성</td><td>{n.author}</td><td>최초 작성</td></tr>
              <tr><td>{fmt(n.date)} {n.time.replace(/\d\d$/, '59')}</td><td>서명</td><td>{n.author}</td><td>전자서명 완료</td></tr>
              {n.inserts.map((i) => <tr key={i.id}><td>{i.at}</td><td>수정</td><td>{user.name}</td><td>임상지침 AI 근거 삽입</td></tr>)}
              <tr><td>{todayISO.replace(/-/g, '.')} 09:05</td><td>열람</td><td>{user.name}</td><td>조회</td></tr>
            </tbody></table></>) : <div>선택된 기록이 없습니다.</div>}
        </Modal>
      )
    }

    case 'vitals':
      return (
        <Modal title={`임상관찰 추이 — ${p.name}`} onClose={close} width={640}>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 6, right: 12, bottom: 2, left: 0 }}>
                <CartesianGrid stroke="#3c4962" strokeDasharray="2 3" />
                <XAxis dataKey="d" tick={{ fontSize: 9.5, fill: '#a8b6c8' }} interval="preserveStartEnd" minTickGap={20} />
                <YAxis tick={{ fontSize: 9.5, fill: '#a8b6c8' }} width={34} />
                <Tooltip isAnimationActive={false} contentStyle={{ background: '#0f1828', border: '1px solid #00bcd4', borderRadius: 0, fontSize: 11 }} />
                <Line dataKey="SBP" stroke="#f05468" dot={{ r: 2 }} isAnimationActive={false} /><Line dataKey="DBP" stroke="#f5a623" dot={{ r: 2 }} isAnimationActive={false} /><Line dataKey="HR" stroke="#4cc36b" dot={{ r: 2 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <table className="etable mt-2"><thead><tr><th>일자</th><th>혈압</th><th>맥박</th><th>체온</th><th>SpO2</th><th>체중</th></tr></thead><tbody>
            {[...bundle.vitals].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12).map((v, i) => <tr key={i}><td>{fmt(v.date)}</td><td>{v.sbp ? `${v.sbp}/${v.dbp}` : '-'}</td><td>{v.hr || '-'}</td><td>{v.bt || '-'}</td><td>{v.spo2 ? `${v.spo2}%` : '-'}</td><td>{v.weightKg ? `${v.weightKg} kg` : '-'}</td></tr>)}
          </tbody></table>
        </Modal>
      )

    case 'problems':
      return (
        <Modal title={`Problem List — ${p.name}`} onClose={close} width={600}>
          <table className="etable"><thead><tr><th style={{ width: 64 }}>코드</th><th>진단</th><th style={{ width: 74 }}>발생일</th><th style={{ width: 46 }}>상태</th><th style={{ width: 92 }}>지침 근거</th></tr></thead><tbody>
            {p.problems.map((x) => (
              <tr key={x.code}><td>{x.code}</td><td title={x.name}>{x.name}</td><td>{fmt(x.since)}</td><td>{x.active ? '활성' : '종료'}</td>
                <td>{x.guidelineQuery ? <button type="button" className="tag-ai" onClick={() => { ask(x.guidelineQuery!, `Problem List › ${x.name}`); close() }}><Bot size={10} /> 지침 질의</button> : <span className="text-[#7d8aa0]">-</span>}</td></tr>
            ))}
          </tbody></table>
          <div className="mt-2 text-[11px] text-emr-sub">「지침 질의」는 해당 진단과 관련된 진료지침 근거를 임상지침 AI 창에서 찾아 줍니다. (직접 지침을 찾아보던 절차를 대체)</div>
        </Modal>
      )

    case 'noteview': {
      const n = bundle.notes.find((x) => x.id === dialog.data)
      return (
        <Modal title={n ? `진료기록 전체보기 — ${recordHeadText(n)}` : '진료기록'} onClose={close} width={760}>
          <div className="rec-body -m-2 p-1" style={{ ['--rec-fs' as string]: '13px' }}>{n ? <NoteDocument note={n} hideFull /> : <div>기록을 찾을 수 없습니다.</div>}</div>
        </Modal>
      )
    }

    case 'delnote': {
      const n = bundle.notes.find((x) => x.id === dialog.data)
      return (
        <Modal title="진료기록 삭제" onClose={close} width={420} footer={<><Btn onClick={close}>취소</Btn><Btn blue onClick={() => { if (n) deleteNote(n.id); toast('진료기록을 삭제했습니다.'); close() }}>삭제</Btn></>}>
          <div className="py-2 text-[12px]">{n ? <><b>{recordHeadText(n)}</b><br />{n.title}<br /><br /></> : null}이 진료기록을 삭제하시겠습니까?<br /><span className="text-emr-sub">(시연 화면: 새로고침하면 원래 데이터로 돌아옵니다)</span></div>
        </Modal>
      )
    }

    case 'editnote': {
      const n = bundle.notes.find((x) => x.id === dialog.data)
      if (!n) return null
      if (eFor !== n.id) { queueMicrotask(() => { setEFor(n.id); setETitle(n.title); setEBodies(n.sections.map((x) => x.body)) }); return null }
      return (
        <Modal title={`진료기록 수정 — ${recordHeadText(n)}`} onClose={() => { setEFor(''); close() }} width={620}
          footer={<><Btn onClick={() => { setEFor(''); close() }}>취소</Btn><Btn blue onClick={() => {
            const sections = n.sections.map((sec, i) => ({ ...sec, body: eBodies[i] ?? sec.body }))
            // Plan 본문을 고치면 항목(지침근거 버튼 포함)도 다시 만든다. 문구가 같은 항목은 질의를 유지한다.
            const planSec = sections.find((sec) => sec.title.startsWith('Plan'))
            let plan: PlanItem[] = n.plan
            if (planSec) plan = planSec.body.split('\n').map((l) => l.replace(/^\s*\d+\.\s*/, '').trim()).filter(Boolean).map((t) => ({ text: t, query: n.plan.find((x) => x.text === t)?.query }))
            updateNote(n.id, { title: eTitle, sections, plan }); setEFor(''); toast('진료기록을 수정했습니다.'); close()
          }}>저장</Btn></>}>
          <div className="space-y-2">
            <input className="inp w-full" value={eTitle} onChange={(e) => setETitle(e.target.value)} />
            {n.sections.map((sec, i) => (
              <div key={sec.title}><div className="sect-title">{sec.title}</div>
                <textarea className="inp w-full" rows={Math.min(8, Math.max(2, (eBodies[i] ?? '').split('\n').length + 1))} value={eBodies[i] ?? ''} onChange={(e) => setEBodies((arr) => arr.map((b, k) => (k === i ? e.target.value : b)))} /></div>
            ))}
          </div>
        </Modal>
      )
    }

    case 'newnote':
      return (
        <Modal title={`기록작성 — ${p.name}`} onClose={close} width={560}
          footer={<><Btn onClick={close}>취소</Btn><Btn blue disabled={!nTitle.trim() || !nBody.trim()} onClick={() => {
            const d = selectedEncounter ?? bundle.encounters[0]
            addNote({ id: `${encId}-U${Date.now()}`, patientId: p.id, encounterId: d.id, date: iso(TODAY), time: new Date().toTimeString().slice(0, 5), kind: nKind, visit: d.type === '입원' ? '입원' : '외래', dept: user.dept, author: user.name, own: true, hospital: '익명대학교병원', title: nTitle, sections: [{ title: '기록', body: nBody }], plan: [], inserts: [] })
            toast('진료기록을 저장했습니다.'); setNTitle(''); setNBody(''); close()
          }}>저장</Btn></>}>
          <div className="space-y-1.5">
            <div className="flex gap-1"><select className="inp" value={nKind} onChange={(e) => setNKind(e.target.value as NoteKind)}>{(['초진', '경과', '입원', '퇴원', '회신', '수술', '간호'] as NoteKind[]).map((k) => <option key={k}>{k}</option>)}</select>
              <input className="inp flex-1" placeholder="제목" value={nTitle} onChange={(e) => setNTitle(e.target.value)} /></div>
            <textarea className="inp h-[200px] w-full" placeholder="내용 (S/O/A/P)" value={nBody} onChange={(e) => setNBody(e.target.value)} />
            <div className="text-[11px] text-emr-sub">저장 대상 진료: {selectedEncounter ? `${fmt(selectedEncounter.date)} ${selectedEncounter.title}` : '-'}</div>
          </div>
        </Modal>
      )

    case 'neworder':
      return (
        <Modal title={`오더 항목추가 — ${p.name}`} onClose={close} width={480}
          footer={<><Btn onClick={close}>취소</Btn><Btn blue disabled={!oName.trim()} onClick={() => {
            const e = selectedEncounter ?? bundle.encounters[0]
            const o: Order = { id: `${e.id}-OX${Date.now()}`, patientId: p.id, encounterId: e.id, date: e.date, visit: (e.type === '입원' ? '입원' : '외래') as Visit, dept: user.dept, doctor: user.name, category: oCat, name: oName, detail: oDetail || '-', status: '처방', execDate: e.date, mine: true }
            addOrder(o); toast('오더를 추가했습니다.'); setOName(''); setODetail(''); close(); openWindow('orders')
          }}>추가</Btn></>}>
          <div className="space-y-1.5">
            <div className="flex gap-1"><select className="inp" value={oCat} onChange={(e) => setOCat(e.target.value as OrderCategory)}>{(['약물', '혈액검사', '영상검사', '생리검사', '주사', '처치', '수술'] as OrderCategory[]).map((c) => <option key={c}>{c}</option>)}</select>
              <input className="inp flex-1" placeholder="처방명 (예: Carvedilol 12.5mg tab)" value={oName} onChange={(e) => setOName(e.target.value)} /></div>
            <input className="inp w-full" placeholder="처방 내용 (예: 1T bid · 28일 · PO)" value={oDetail} onChange={(e) => setODetail(e.target.value)} />
            <div className="text-[11px] text-emr-sub">대상 진료: {selectedEncounter ? `${fmt(selectedEncounter.date)} ${selectedEncounter.title}` : '-'}</div>
          </div>
        </Modal>
      )
  }
  void selectPatient
  return null
}
