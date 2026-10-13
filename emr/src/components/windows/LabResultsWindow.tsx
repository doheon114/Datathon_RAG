import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, ArrowDown, ArrowUp, Search } from 'lucide-react'
import { useEMR } from '../../state/EMRContext'
import { useGuideline } from '../../state/GuidelineContext'
import type { LabFlag, LabResult } from '../../types'
import { TODAY, addDays, iso } from '../../data/rng'
import EMRToolbar from '../EMRToolbar'
import { Empty, Segment } from '../ui'
import LabTrendChart from './LabTrendChart'

const PERIODS = ['1주', '2주', '1달', '6달', '1년', '3년', '전체'] as const
type Period = (typeof PERIODS)[number]
const PDAYS: Record<Period, number> = { '1주': 7, '2주': 14, '1달': 30, '6달': 182, '1년': 365, '3년': 1095, 전체: 0 }
type Scope = 'all' | 'dept' | 'mine' | 'pacs'
const fmt = (d: string) => d.replace(/-/g, '.')

const flagText: Record<LabFlag, string> = { N: '정상', H: '상승', HH: '매우 상승', L: '감소', LL: '매우 감소' }

export function FlagCell({ f }: { f: LabFlag }) {
  if (f === 'N') return <span className="val-n">정상</span>
  const up = f === 'H' || f === 'HH'
  return <span className={up ? 'val-h' : 'val-l'}>{up ? <ArrowUp size={10} className="inline" /> : <ArrowDown size={10} className="inline" />} {flagText[f]}</span>
}

export default function LabResultsWindow() {
  const { bundle, user, selectedEncounterId, selectedDate, selectEncounter } = useEMR()
  const { ask } = useGuideline()
  const [scope, setScope] = useState<Scope>('all')
  const [period, setPeriod] = useState<Period>('전체')
  const [text, setText] = useState('')
  const [test, setTest] = useState<string>('')
  const [imgId, setImgId] = useState<string>('')
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => { setScope('all'); setPeriod('전체'); setText('') }, [bundle.patient.id])

  // 환자가 바뀌면 대표 검사를 선택한다 (NT-proBNP 우선, 없으면 이상값이 가장 많은 항목)
  useEffect(() => {
    const names = [...new Set(bundle.labs.map((l) => l.name))]
    const abn = names.map((n) => ({ n, c: bundle.labs.filter((l) => l.name === n && l.flag !== 'N').length })).sort((a, b) => b.c - a.c)
    setTest(names.includes('NT-proBNP') ? 'NT-proBNP' : abn[0]?.n ?? '')
    setImgId('')
  }, [bundle.patient.id, bundle.labs])

  const cutoff = period === '전체' ? '' : iso(addDays(TODAY, -PDAYS[period]))

  const rows = useMemo(() => bundle.labs.filter((l) => {
    if (cutoff && l.date < cutoff) return false
    if (scope === 'dept' && l.dept !== user.dept) return false
    if (scope === 'mine' && !l.mine) return false
    if (text && !l.name.toLowerCase().includes(text.toLowerCase())) return false
    return true
  }).sort((a, b) => (a.datetime < b.datetime ? 1 : a.datetime > b.datetime ? -1 : a.name.localeCompare(b.name))), [bundle.labs, cutoff, scope, text, user.dept])

  const imgs = useMemo(() => bundle.imaging.filter((m) => (!cutoff || m.date >= cutoff) && (!text || m.study.toLowerCase().includes(text.toLowerCase()))).sort((a, b) => (a.date < b.date ? 1 : -1)), [bundle.imaging, cutoff, text])
  const img = imgs.find((m) => m.id === imgId) ?? imgs.find((m) => m.encounterId === selectedEncounterId) ?? imgs[0]

  const series: LabResult[] = useMemo(() => bundle.labs.filter((l) => l.name === test && (!cutoff || l.date >= cutoff)), [bundle.labs, test, cutoff])
  const latest = [...series].sort((a, b) => (a.datetime < b.datetime ? 1 : -1))[0]
  const queryTarget = series.filter((l) => l.guidelineQuery).sort((a, b) => (a.datetime < b.datetime ? 1 : -1))[0]

  useEffect(() => { setTimeout(() => wrap.current?.querySelector('tr.hl-date')?.scrollIntoView({ block: 'nearest' }), 30) }, [selectedEncounterId, scope])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EMRToolbar items={[
        { label: '전체결과', active: scope === 'all', onClick: () => setScope('all') },
        { label: '내진료과', active: scope === 'dept', onClick: () => setScope('dept'), title: `${user.dept} 오더 결과만` },
        { label: '내오더', active: scope === 'mine', onClick: () => setScope('mine'), title: `${user.name} 오더 결과만` },
        { label: 'PACS', active: scope === 'pacs', onClick: () => setScope('pacs'), title: '영상·생리검사 판독 결과' },
        { label: '병원', onClick: () => { setScope('all'); setPeriod('전체'); setText('') }, title: '전체 병원 기준으로 초기화' },
      ]} />
      <div className="flex flex-wrap items-center gap-1 border-b border-black/60 bg-[#2b3750] px-1 py-[3px]">
        <Segment items={PERIODS} value={period} onChange={setPeriod} />
        <div className="relative ml-auto min-w-[110px] flex-1">
          <Search size={10} className="absolute left-1 top-[5px] text-emr-sub" />
          <input className="inp w-full pl-4" placeholder={scope === 'pacs' ? '검사명 검색' : '검사명 검색 (예: NT-proBNP)'} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
      </div>

      <div ref={wrap} className="scroll-sticky min-h-[70px] flex-[55] overflow-auto bg-emr-panel">
        {scope !== 'pacs' ? (
          <table className="etable" style={{ tableLayout: 'fixed', minWidth: 450 }}>
            <colgroup><col style={{ width: 92 }} /><col style={{ width: 98 }} /><col style={{ width: 74 }} /><col style={{ width: 58 }} /><col style={{ width: 88 }} /><col /></colgroup>
            <thead><tr><th>검사일시</th><th>검사명</th><th>참고치</th><th>결과값</th><th>단위</th><th>이상 여부</th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className={`${l.name === test ? 'sel' : ''} ${l.date === selectedDate && l.name !== test ? 'bg-[#2c3f60] hl-date' : ''}`} style={{ cursor: 'pointer' }}
                  onClick={() => { setTest(l.name); selectEncounter(l.encounterId) }}>
                  <td>{fmt(l.datetime).slice(2, 16)}</td>
                  <td title={l.name}><b>{l.name}</b></td>
                  <td>{l.refText}</td>
                  <td className={`num ${l.flag === 'N' ? 'val-n' : l.flag === 'H' || l.flag === 'HH' ? 'val-h' : 'val-l'}`}>{l.name === 'NT-proBNP' ? l.value.toLocaleString('en-US') : l.value}</td>
                  <td>{l.unit}</td>
                  <td>
                    <span className="flex items-center gap-1"><FlagCell f={l.flag} />
                      {l.guidelineQuery && <button type="button" className="tag-ai shrink-0" title={l.guidelineQuery} onClick={(e) => { e.stopPropagation(); ask(l.guidelineQuery!, `검사결과 › ${l.name} ${l.value}`) }}><Bot size={10} />해석</button>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="etable" style={{ tableLayout: 'fixed', minWidth: 470 }}>
            <colgroup><col style={{ width: 82 }} /><col style={{ width: 150 }} /><col style={{ width: 78 }} /><col /></colgroup>
            <thead><tr><th>검사일</th><th>검사명</th><th>진료과</th><th>판독 소견</th></tr></thead>
            <tbody>
              {imgs.map((m) => (
                <tr key={m.id} className={m.id === img?.id ? 'sel' : ''} style={{ cursor: 'pointer' }} onClick={() => { setImgId(m.id); selectEncounter(m.encounterId) }}>
                  <td>{fmt(m.date)}</td><td><b>{m.study}</b></td><td>{m.dept}</td>
                  <td title={m.report}><span className="flex items-center gap-1"><span className="truncate">{m.report}</span>
                    {m.guidelineQuery && <button type="button" className="tag-ai shrink-0" title={m.guidelineQuery} onClick={(e) => { e.stopPropagation(); ask(m.guidelineQuery!, `PACS › ${m.study}`) }}><Bot size={10} />지침</button>}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {scope !== 'pacs' && !rows.length && <Empty>조건에 맞는 검사 결과가 없습니다.</Empty>}
        {scope === 'pacs' && !imgs.length && <Empty>영상·생리검사 결과가 없습니다.</Empty>}
      </div>

      {/* 추이 그래프 (같은 패널 안) */}
      <div className="flex min-h-[110px] flex-[45] flex-col border-t border-black bg-[#27324a]">
        {scope !== 'pacs' ? (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0 border-b border-black/60 bg-[#2b3750] px-2 py-[2px] text-[11px]">
              <b className="text-[#7fe6f5]">{test || '-'}</b>
              {latest && <span>최근 <b className={latest.flag === 'N' ? 'val-n' : latest.flag.startsWith('H') ? 'val-h' : 'val-l'}>{test === 'NT-proBNP' ? latest.value.toLocaleString('en-US') : latest.value}</b> {latest.unit} <span className="text-emr-sub">(참고치 {latest.refText})</span></span>}
              <span className="text-emr-sub">{series.length}회 측정</span>
              {queryTarget && <button type="button" className="tag-ai ml-auto" onClick={() => ask(queryTarget.guidelineQuery!, `검사결과 › ${test} 추이`)}><Bot size={10} /> 지침으로 해석</button>}
            </div>
            <div className="min-h-0 flex-1 px-1 pt-1"><LabTrendChart series={series} selectedDate={selectedDate} /></div>
          </>
        ) : (
          <div className="selectable min-h-0 flex-1 overflow-auto p-2 text-[12px]">
            {img ? (<><div className="sect-title">{img.study} · {fmt(img.date)} · {img.dept}</div><div className="whitespace-pre-wrap leading-[1.6]">{img.report}</div>
              {img.guidelineQuery && <button type="button" className="tag-ai mt-2" onClick={() => ask(img.guidelineQuery!, `PACS › ${img.study}`)}><Bot size={10} /> 이 소견과 관련된 지침 근거</button>}</>) : <Empty>판독 결과를 선택하세요.</Empty>}
          </div>
        )}
      </div>
    </div>
  )
}
