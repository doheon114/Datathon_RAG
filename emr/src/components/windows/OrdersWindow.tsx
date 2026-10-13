import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, ChevronDown, ChevronRight, Plus, Search } from 'lucide-react'
import { useEMR } from '../../state/EMRContext'
import { useGuideline } from '../../state/GuidelineContext'
import type { Order, OrderCategory, OrderStatus, Visit } from '../../types'
import { TODAY, addDays, iso } from '../../data/rng'
import EMRToolbar from '../EMRToolbar'
import { CatTag, Empty, Segment, VisitTag } from '../ui'

const PERIODS = ['1주', '2주', '1달', '3달', '6달', '1년', '3년', '전체'] as const
type Period = (typeof PERIODS)[number]
const PDAYS: Record<Period, number> = { '1주': 7, '2주': 14, '1달': 30, '3달': 90, '6달': 182, '1년': 365, '3년': 1095, 전체: 0 }
const CATS: OrderCategory[] = ['약물', '혈액검사', '영상검사', '생리검사', '주사', '처치', '수술']
const STATUS_COLOR: Record<OrderStatus, string> = { 처방: '#7d8aa0', 접수: '#d98a12', 시행: '#2f86d6', 보고대기: '#c2527a', 결과확인: '#3aa656', 취소: '#555f70' }
const VISITS: Visit[] = ['외래', '입원', '응급', '퇴원']
const fmt = (d: string) => d.replace(/-/g, '.')

export default function OrdersWindow() {
  const { bundle, user, selectedEncounterId, selectedDate, selectEncounter, openDialog } = useEMR()
  const { ask } = useGuideline()
  const [period, setPeriod] = useState<Period | ''>('전체')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [text, setText] = useState('')
  const [cat, setCat] = useState<OrderCategory | ''>('')
  const [visits, setVisits] = useState<Visit[]>([])
  const [reportOnly, setReportOnly] = useState(false)
  const [myDept, setMyDept] = useState(false)
  const [mine, setMine] = useState(false)
  const [byDept, setByDept] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => { setVisits([]); setReportOnly(false); setMyDept(false); setMine(false); setCat(''); setText(''); setPeriod('전체'); setFrom(''); setTo(''); setOpen(new Set()) }, [bundle.patient.id])

  const applyPeriod = (p: Period) => {
    setPeriod(p)
    if (p === '전체') { setFrom(''); setTo('') } else { setFrom(iso(addDays(TODAY, -PDAYS[p]))); setTo(iso(TODAY)) }
  }

  const rows = useMemo(() => bundle.orders.filter((o) => {
    if (from && o.date < from) return false
    if (to && o.date > to) return false
    if (cat && o.category !== cat) return false
    if (visits.length && !visits.includes(o.visit)) return false
    if (reportOnly && o.status !== '보고대기') return false
    if (myDept && o.dept !== user.dept) return false
    if (mine && !o.mine) return false
    if (text && !`${o.name} ${o.detail} ${o.category}`.toLowerCase().includes(text.toLowerCase())) return false
    return true
  }), [bundle.orders, from, to, cat, visits, reportOnly, myDept, mine, text, user.dept])

  const groups = useMemo(() => {
    const m = new Map<string, Order[]>()
    for (const o of rows) { const k = byDept ? o.dept : `${o.date}|${o.encounterId}|${o.visit === '퇴원' ? '퇴원' : ''}`; m.set(k, [...(m.get(k) ?? []), o]) }
    const arr = [...m.entries()].map(([key, os]) => ({ key, os }))
    arr.sort((a, b) => (byDept ? a.key.localeCompare(b.key) : a.key < b.key ? 1 : -1))
    return arr
  }, [rows, byDept])

  // 선택한 진료의 처방 그룹을 펼치고 화면에 보이게 한다 (타임라인/기록 선택과 동기화)
  useEffect(() => {
    if (!selectedEncounterId || byDept) return
    const keys = groups.filter((g) => g.os[0].encounterId === selectedEncounterId).map((g) => g.key)
    if (keys.length) {
      setOpen((s) => new Set([...s, ...keys]))
      setTimeout(() => wrap.current?.querySelector('tr.grp.sel')?.scrollIntoView({ block: 'nearest' }), 30)
    }
  }, [selectedEncounterId, byDept, groups.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleVisit = (v: Visit) => setVisits((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]))
  const resetAll = () => { setVisits([]); setReportOnly(false); setMyDept(false); setMine(false); setCat(''); setText(''); applyPeriod('전체') }
  const hospital = !visits.length && !reportOnly && !myDept && !mine && !cat

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EMRToolbar items={[
        { label: '보고오더', active: reportOnly, onClick: () => setReportOnly((v) => !v), title: '보고 대기 중인 오더만' },
        { label: '발생과', active: byDept, onClick: () => setByDept((v) => !v), title: '오더 발생 진료과별로 묶기' },
        { label: '내진료과', active: myDept, onClick: () => setMyDept((v) => !v), title: `${user.dept} 오더만` },
        { label: '내오더', active: mine, onClick: () => setMine((v) => !v), title: `${user.name} 오더만` },
        { sep: true, label: '' },
        { label: '항목추가', icon: <Plus size={11} />, onClick: () => openDialog('neworder') },
        { sep: true, label: '' },
        ...VISITS.map((v) => ({ label: v, active: visits.includes(v), onClick: () => toggleVisit(v) })),
        { sep: true, label: '' },
        { label: '병원', active: hospital, onClick: resetAll, title: '전체 병원 기준으로 필터 초기화' },
      ]}>
        <select className="inp" value={cat} onChange={(e) => setCat(e.target.value as OrderCategory | '')} title="처방종류"><option value="">처방종류: 전체</option>{CATS.map((c) => <option key={c}>{c}</option>)}</select>
      </EMRToolbar>
      <div className="flex flex-wrap items-center gap-1 border-b border-black/60 bg-[#2b3750] px-1 py-[3px]">
        <Segment items={PERIODS} value={(period || '') as Period} onChange={applyPeriod} />
        <input type="date" className="inp w-[104px]" value={from} onChange={(e) => { setFrom(e.target.value); setPeriod('') }} />
        <span className="text-emr-sub">~</span>
        <input type="date" className="inp w-[104px]" value={to} onChange={(e) => { setTo(e.target.value); setPeriod('') }} />
        <div className="relative ml-auto min-w-[110px] flex-1">
          <Search size={10} className="absolute left-1 top-[5px] text-emr-sub" />
          <input className="inp w-full pl-4" placeholder="약물·검사 오더 검색" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
      </div>
      <div ref={wrap} className="scroll-sticky min-h-0 flex-1 overflow-auto bg-emr-panel">
        <table className="etable" style={{ tableLayout: 'fixed', minWidth: 690 }}>
          <colgroup><col style={{ width: 82 }} /><col style={{ width: 40 }} /><col style={{ width: 76 }} /><col style={{ width: 54 }} /><col style={{ width: 170 }} /><col /><col style={{ width: 56 }} /><col style={{ width: 76 }} /></colgroup>
          <thead><tr><th>진료일자</th><th>구분</th><th>진료과</th><th>담당의</th><th>처방명</th><th>처방내용</th><th>상태</th><th>시행일</th></tr></thead>
          <tbody>
            {groups.map((g) => {
              const first = g.os[0]
              const isOpen = open.has(g.key)
              const isSel = !byDept && first.encounterId === selectedEncounterId
              const counts = CATS.map((c) => ({ c, n: g.os.filter((o) => o.category === c).length })).filter((x) => x.n)
              return (
                <GroupRows key={g.key}>
                  <tr className={`grp ${isSel ? 'sel' : ''}`} onClick={() => {
                    setOpen((s) => { const n = new Set(s); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n })
                    if (!byDept) selectEncounter(first.encounterId)
                  }}>
                    <td>{isOpen ? <ChevronDown size={11} className="mr-0.5 inline" /> : <ChevronRight size={11} className="mr-0.5 inline" />}{byDept ? <b>{first.dept}</b> : fmt(first.date)}</td>
                    <td>{byDept ? '' : <VisitTag v={first.visit} />}</td>
                    <td>{byDept ? `${g.os.length}건` : first.dept}</td>
                    <td>{byDept ? '' : first.doctor}</td>
                    <td colSpan={4}>
                      <span className="flex items-center gap-1">{counts.map(({ c, n }) => <span key={c} className="flex items-center gap-0.5"><CatTag cat={c} /><span className="text-emr-sub">{n}</span></span>)}</span>
                    </td>
                  </tr>
                  {isOpen && g.os.map((o) => (
                    <tr key={o.id} className={`child ${o.date === selectedDate ? 'bg-[#2c3f60]' : ''}`}>
                      <td className="pl-4 text-emr-sub">{byDept ? fmt(o.date) : '└'}</td>
                      <td><VisitTag v={o.visit} /></td>
                      <td>{o.dept}</td>
                      <td>{o.doctor}</td>
                      <td title={o.name}><span className="inline-flex max-w-full items-center gap-1 align-middle"><CatTag cat={o.category} /><span className="truncate">{o.name}</span></span></td>
                      <td title={o.detail}>
                        <span className="flex items-center gap-1">
                          <span className="truncate">{o.detail}</span>
                          {o.guidelineQuery && <button type="button" className="tag-ai shrink-0" title={o.guidelineQuery} onClick={() => ask(o.guidelineQuery!, `오더조회 › ${o.name}`)}><Bot size={10} />지침</button>}
                        </span>
                      </td>
                      <td><span className="tag" style={{ background: STATUS_COLOR[o.status], minWidth: 40 }}>{o.status}</span></td>
                      <td>{fmt(o.execDate)}</td>
                    </tr>
                  ))}
                </GroupRows>
              )
            })}
          </tbody>
        </table>
        {!groups.length && <Empty>조건에 맞는 오더가 없습니다.</Empty>}
      </div>
      <div className="flex items-center justify-between border-t border-black/60 bg-[#2b3750] px-2 py-[2px] text-[10.5px] text-emr-sub">
        <span>조회 {rows.length}건 / 전체 {bundle.orders.length}건 · {byDept ? '진료과별' : '일자별'} 보기</span>
        <span>선택 진료일자: <b className="text-white">{selectedDate ? fmt(selectedDate) : '-'}</b></span>
      </div>
    </div>
  )
}

const GroupRows = ({ children }: { children: React.ReactNode }) => <>{children}</>
