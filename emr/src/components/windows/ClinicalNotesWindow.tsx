import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Building2, CalendarDays, ChevronDown, ChevronRight, Download, Eye, EyeOff, FileClock, FilePenLine, FileSearch, FileText, ImageIcon, ListChecks, MapPin, Minus, Pencil, Plus, RefreshCw, Search, Settings } from 'lucide-react'
import { useEMR } from '../../state/EMRContext'
import { useGuideline } from '../../state/GuidelineContext'
import type { Note } from '../../types'
import { TODAY, addDays, iso } from '../../data/rng'
import NoteDocument, { KIND_COLOR, noteToText, recordHeadText } from './NoteDocument'

const TABS = ['전체', '외래', '입원', '타과', '수술', '간호', '과별'] as const
type Tab = (typeof TABS)[number]
const RADIOS = ['전체', '초진', '내기록', '다학제'] as const
type Radio = (typeof RADIOS)[number]
const PERIODS = ['1주', '2주', '1달', '6달', '1년', '3년', '전체'] as const
type Period = (typeof PERIODS)[number]
const PDAYS: Record<Period, number> = { '1주': 7, '2주': 14, '1달': 30, '6달': 182, '1년': 365, '3년': 1095, 전체: 0 }
const PAGE = 10
const HOME_HOSPITAL = '익명대학교병원'

/** 세로 탭 분류: 한 기록이 어느 탭에 속하는지 */
function inTab(n: Note, tab: Tab, userDept: string, deptSel: string): boolean {
  switch (tab) {
    case '외래': return n.visit === '외래' && n.kind !== '간호' && n.kind !== '수술'
    case '입원': return n.visit === '입원' && (n.kind === '입원' || n.kind === '경과' || n.kind === '퇴원') // 입원기록·경과·퇴원요약을 하나로
    case '타과': return n.kind !== '간호' && n.dept !== userDept
    case '수술': return n.kind === '수술'
    case '간호': return n.kind === '간호'
    case '과별': return !deptSel || n.dept === deptSel
    default: return true
  }
}

export default function ClinicalNotesWindow() {
  const { bundle, user, selectedNoteId, selectNote, selectEncounter, selectedEncounterId, openDialog, toast } = useEMR()
  const { ask } = useGuideline()
  const [tab, setTab] = useState<Tab>('전체')
  const [radio, setRadio] = useState<Radio>('전체')
  const [group, setGroup] = useState<'종류별' | '과별'>('종류별')
  const [allDepts, setAllDepts] = useState(true)
  const [external, setExternal] = useState(true)
  const [period, setPeriod] = useState<Period>('전체')
  const [calendar, setCalendar] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [deptSel, setDeptSel] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchMode, setSearchMode] = useState<'기록' | '지침 AI'>('기록')
  const [text, setText] = useState('')
  const [visible, setVisible] = useState(PAGE)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [zoom, setZoom] = useState(100)
  const [pending, setPending] = useState(false)
  const stream = useRef<HTMLDivElement>(null)

  // 환자가 바뀌면 필터를 초기화하고 가장 최근 기록을 펼친다
  const latest = useMemo(() => [...bundle.notes].sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1))[0], [bundle.notes])
  useEffect(() => {
    setTab('전체'); setRadio('전체'); setGroup('종류별'); setAllDepts(true); setExternal(true); setPeriod('전체'); setCalendar(false); setFrom(''); setTo('')
    setDeptSel(''); setSearchOpen(false); setText(''); setVisible(PAGE); setExpanded(new Set(latest ? [latest.id] : []))
  }, [bundle.patient.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const cutoff = from || (period === '전체' ? '' : iso(addDays(TODAY, -PDAYS[period])))
  const depts = useMemo(() => [...new Set(bundle.notes.map((n) => n.dept))].sort(), [bundle.notes])
  const externalCount = bundle.notes.filter((n) => n.hospital !== HOME_HOSPITAL).length

  // 탭을 제외한 조건(진료과 범위·병원·기간·검색·라디오)을 먼저 적용한 기준 집합
  const base = useMemo(() => {
    const q = searchMode === '기록' ? text.trim().toLowerCase() : ''
    return bundle.notes.filter((n) => {
      if (!allDepts && n.dept !== user.dept && n.kind !== '간호') return false
      if (!external && n.hospital !== HOME_HOSPITAL) return false
      if (cutoff && n.date < cutoff) return false
      if (to && n.date > to) return false
      if (radio === '초진' && n.kind !== '초진') return false
      if (radio === '내기록' && !n.own) return false
      if (radio === '다학제' && n.kind !== '회신') return false
      if (q && !(n.title + n.dept + n.author + n.sections.map((s) => s.body).join(' ')).toLowerCase().includes(q)) return false
      return true
    }).sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1))
  }, [bundle.notes, allDepts, external, cutoff, to, radio, text, searchMode, user.dept])

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t, base.filter((n) => inTab(n, t, user.dept, '')).length])) as Record<Tab, number>, [base, user.dept])
  const list = useMemo(() => base.filter((n) => inTab(n, tab, user.dept, deptSel)), [base, tab, user.dept, deptSel])
  const shown = list.slice(0, visible)

  // 타임라인·AI 등에서 기록이 선택되면 그 진료의 기록을 펼치고 화면에 보이게 한다
  useEffect(() => {
    if (!selectedNoteId) return
    const idx = list.findIndex((n) => n.id === selectedNoteId)
    if (idx < 0) {
      if (bundle.notes.some((n) => n.id === selectedNoteId)) { setTab('전체'); setRadio('전체'); setText(''); setCalendar(false); setFrom(''); setTo(''); setPeriod('전체'); setAllDepts(true); setExternal(true) }
      return
    }
    if (idx >= visible) setVisible(idx + 1)
    setExpanded((s) => { const nx = new Set(s); for (const n of bundle.notes) if (n.encounterId === selectedEncounterId) nx.add(n.id); nx.add(selectedNoteId); return nx })
    setTimeout(() => stream.current?.querySelector(`[data-rec="${selectedNoteId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60)
  }, [selectedNoteId, selectedEncounterId]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (n: Note) => {
    setExpanded((s) => { const nx = new Set(s); nx.has(n.id) ? nx.delete(n.id) : nx.add(n.id); return nx })
    if (n.encounterId !== selectedEncounterId) selectEncounter(n.encounterId)
    selectNote(n.id)
  }

  const allOpen = shown.length > 0 && shown.every((n) => expanded.has(n.id))
  const download = () => {
    const blob = new Blob([list.map(noteToText).join('\n\n----------------------------------------\n\n')], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${bundle.patient.mrn}_진료기록_${iso(TODAY)}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
    toast(`진료기록 ${list.length}건을 내려받았습니다.`)
  }
  const submitSearch = () => { if (searchMode === '지침 AI' && text.trim()) { ask(text.trim(), '진료기록 › 검색'); setText('') } }
  const refresh = () => { setPending(true); setTimeout(() => { setPending(false); toast('진료기록을 새로 불러왔습니다.') }, 450) }
  const activeProblems = bundle.patient.problems.filter((p) => p.active).length

  const tb = (icon: React.ReactNode, label: string, onClick: () => void, opts: { badge?: number; blue?: boolean; active?: boolean } = {}) => (
    <button key={label} type="button" className="rec-tbtn" data-active={opts.active ? 'true' : undefined} onClick={onClick} title={label}>
      {icon}<span>{label}</span>
      {opts.badge !== undefined && <span className={`rec-badge ${opts.blue ? 'blue' : ''}`}>{opts.badge}</span>}
    </button>
  )

  let lastGroup = ''
  return (
    <div className="rec-body flex min-h-0 flex-1 flex-col" style={{ ['--rec-fs' as string]: `${(12 * zoom) / 100}px` }}>
      {/* 큰 아이콘 툴바 */}
      <div className="rec-toolbar">
        <div className="rec-mini">
          <button type="button" title="기록작성" onClick={() => openDialog('newnote')}><Pencil size={11} /></button>
          <button type="button" title={allOpen ? '모두 접기' : '모두 펼치기'} onClick={() => setExpanded(allOpen ? new Set() : new Set(shown.map((n) => n.id)))}>{allOpen ? <EyeOff size={11} /> : <Eye size={11} />}</button>
          <button type="button" title="진료기록 내려받기(.txt)" onClick={download}><Download size={11} /></button>
          <button type="button" title="설정" onClick={() => openDialog('setting')}><Settings size={11} /></button>
        </div>
        {tb(<FileText size={19} />, '데이터', () => openDialog('data'))}
        {tb(<ImageIcon size={19} />, '이미지', () => openDialog('images'))}
        {tb(<Search size={19} />, '검색', () => setSearchOpen((o) => !o), { active: searchOpen })}
        {tb(<FileClock size={19} />, '이력조회', () => openDialog('history', selectedNoteId ?? latest?.id))}
        {tb(<FileSearch size={19} />, '임상관찰', () => openDialog('vitals'))}
        {tb(<ListChecks size={19} />, 'Problem List', () => openDialog('problems'), { badge: activeProblems })}
        {tb(<Building2 size={19} className="text-[#6fb4ff]" />, '병원', () => setExternal((v) => !v), { badge: externalCount, blue: true, active: !external })}
        <div className="flex-1" />
        {tb(<FilePenLine size={19} />, '기록작성', () => openDialog('newnote'))}
        <div className="rec-zoom">
          {[100, 150, 200].map((z, i) => <button key={z} type="button" data-active={zoom === z ? 'true' : undefined} onClick={() => setZoom(z)} title={`글자 ${z}%`}>x{i + 1}</button>)}
        </div>
      </div>

      {/* 수진 · 기간 · 전체과 */}
      <div className="rec-row2">
        <button type="button" className="rec-pill" onClick={() => openDialog('visit')}>수진 <MapPin size={11} /></button>
        <div className="rec-period">
          {PERIODS.map((p) => <button key={p} type="button" className={period === p && !from ? 'on' : ''} onClick={() => { setPeriod(p); setFrom(''); setTo('') }}>{period === p && !from && <MapPin size={13} />}{p}</button>)}
        </div>
        <label className="ml-1 flex cursor-pointer items-center gap-1 text-[12px] font-bold text-white">
          <span className="rec-check">{allDepts ? '✓' : ''}</span>
          <input type="checkbox" className="hidden" checked={allDepts} onChange={(e) => setAllDepts(e.target.checked)} />전체과
        </label>
        <button type="button" className="rec-red" title="새로 불러오기" onClick={refresh}><RefreshCw size={12} className={pending ? 'animate-spin' : ''} /></button>
        <button type="button" className="rec-blue" title="조회 기간 직접 지정" onClick={() => setCalendar((c) => !c)}><CalendarDays size={13} /></button>
        {calendar && (
          <span className="flex items-center gap-1">
            <input type="date" className="inp" value={from} onChange={(e) => setFrom(e.target.value)} />~<input type="date" className="inp" value={to} onChange={(e) => setTo(e.target.value)} />
          </span>
        )}
      </div>
      {searchOpen && (
        <div className="flex items-center gap-1 border-b border-[#07122a] bg-[#0f2247] p-1">
          <button type="button" className="rec-pill" style={searchMode === '기록' ? { background: 'linear-gradient(180deg,#2b78d8,#1d5fc0)' } : undefined} onClick={() => setSearchMode('기록')}>기록 검색</button>
          <button type="button" className="rec-pill" style={searchMode === '지침 AI' ? { background: 'linear-gradient(180deg,#0e8aa6,#0a6479)' } : undefined} onClick={() => setSearchMode('지침 AI')}><Bot size={11} /> 지침 AI</button>
          <input className="inp min-w-0 flex-1" value={text} autoFocus placeholder={searchMode === '기록' ? '제목·내용·작성자에서 찾기' : '임상 지침에 질문 (예: HFrEF 환자에서 베타차단제의 역할은?)'}
            onChange={(e) => { setText(e.target.value); setVisible(PAGE) }} onKeyDown={(e) => { if (e.key === 'Enter') submitSearch() }} />
          {searchMode === '지침 AI' && <button type="button" className="rec-pill" onClick={submitSearch}>지침 질문</button>}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* 세로 탭 + 건수 */}
        <div className="rec-rail">
          {TABS.map((t) => (
            <button key={t} type="button" className={`rec-tab ${tab === t ? 'on' : ''}`} onClick={() => { setTab(t); setVisible(PAGE) }} title={`${t} ${counts[t]}건`}>
              <span className="l">{t}</span><span className="n">{counts[t]}</span>
            </button>
          ))}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* 라디오 필터 */}
          <div className="rec-filter">
            {RADIOS.map((r) => <label key={r} onClick={() => { setRadio(r); setVisible(PAGE) }}><span className={`rec-radio ${radio === r ? 'on' : ''}`} />{r}</label>)}
            <span className="ml-auto flex items-center gap-3">
              {tab === '과별' && <select className="inp" value={deptSel} onChange={(e) => setDeptSel(e.target.value)}><option value="">전체 과</option>{depts.map((d) => <option key={d}>{d}</option>)}</select>}
              {(['종류별', '과별'] as const).map((g) => <label key={g} onClick={() => setGroup(g)}><span className={`rec-radio ${group === g ? 'on' : ''}`} />{g}</label>)}
            </span>
          </div>

          {/* 기록 스트림 */}
          <div ref={stream} className="min-h-0 flex-1 overflow-auto rec-stream">
            {shown.map((n) => {
              const open = expanded.has(n.id)
              const sel = n.id === (selectedNoteId ?? latest?.id)
              const gk = group === '과별' ? n.dept : ''
              const header = gk && gk !== lastGroup ? <div className="rec-group">{gk}</div> : null
              if (gk) lastGroup = gk
              return (
                <div key={n.id} data-rec={n.id}>
                  {header}
                  <div className="rec-card" style={n.encounterId === selectedEncounterId ? { boxShadow: '0 0 0 1px #ffd54a, 0 1px 3px rgba(0,0,0,0.5)' } : undefined}>
                    <div className={`rec-head ${sel ? 'sel' : ''}`} onClick={() => toggle(n)} title="클릭: 펼치기/접기">
                      {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      <span className="k" style={{ background: KIND_COLOR[n.kind] }}>{n.kind}</span>
                      <span className="truncate">{recordHeadText(n)}</span>
                      {n.inserts.length > 0 && <span className="text-[#bff3ff]">[지침 {n.inserts.length}]</span>}
                      <span className={`hosp ${n.hospital !== HOME_HOSPITAL ? 'ext' : ''}`}>[{n.hospital}]</span>
                    </div>
                    {open && <NoteDocument note={n} />}
                  </div>
                </div>
              )
            })}
            {!shown.length && <div className="p-6 text-center text-[12px] text-[#9bbcf0]">조건에 맞는 진료기록이 없습니다.</div>}
            <button type="button" className="rec-next" disabled={visible >= list.length} onClick={() => setVisible((v) => v + PAGE)}>
              <Search size={12} /> {visible >= list.length ? `마지막 기록입니다 (${list.length}건)` : `다음기록 (${shown.length}/${list.length})`}
            </button>
          </div>

          {/* 하단 배율 */}
          <div className="rec-foot">
            <select value={zoom} onChange={(e) => setZoom(+e.target.value)}>{[70, 85, 100, 125, 150, 175, 200].map((z) => <option key={z} value={z}>{z}%</option>)}</select>
            <button type="button" title="축소" onClick={() => setZoom((z) => Math.max(70, z - 10))}><Minus size={11} /></button>
            <input type="range" min={70} max={200} step={5} value={zoom} onChange={(e) => setZoom(+e.target.value)} />
            <button type="button" title="확대" onClick={() => setZoom((z) => Math.min(200, z + 10))}><Plus size={11} /></button>
            <button type="button" title="배율 초기화" onClick={() => setZoom(100)}><RefreshCw size={11} /></button>
            <span className="ml-auto text-[#9bbcf0]">{list.length}건 · {PERIODS.includes(period) ? period : ''}{from ? ` ${from}~${to || '현재'}` : ''}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
