import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LocateFixed, ZoomIn, ZoomOut } from 'lucide-react'
import { useEMR } from '../state/EMRContext'
import { buildTimeline } from '../api/emrApi'
import { EPOCH, addDays, dayIndex, daysBetween, parseISO, todayISO } from '../data/rng'
import type { TLEvent, TLKind } from '../types'
import { Btn, PanelTitle } from './ui'

const ROWS: { kind: TLKind; label: string; color: string }[] = [
  { kind: '외래', label: '외래', color: '#3d9beb' },
  { kind: '입원', label: '입원', color: '#f5a623' },
  { kind: '수술', label: '수술/시술', color: '#e8453c' },
  { kind: '검사', label: '검사', color: '#4cc36b' },
  { kind: '영상', label: '영상', color: '#a077e0' },
  { kind: '처방', label: '처방', color: '#36c5c5' },
]
const ROW_H = 24
const TOP = 4
const RULER_H = 36
const LABEL_W = 66
const PAD = 10
const END = new Date(2027, 11, 31)
const TOTAL_DAYS = daysBetween(EPOCH, END) + 1
const rowsBottom = TOP + ROWS.length * ROW_H
const SVG_H = rowsBottom + RULER_H
const todayIdx = dayIndex(todayISO)

function Marker({ ev, x, y, color, selected }: { ev: TLEvent; x: number; y: number; color: string; selected: boolean }) {
  const stroke = selected ? '#ffffff' : '#0d1626'
  const sw = selected ? 2 : 1
  const fill = ev.future ? '#202a3a' : color
  const dash = ev.future ? '2 2' : undefined
  switch (ev.kind) {
    case '외래': return <circle cx={x} cy={y} r={5} fill={fill} stroke={ev.future ? color : stroke} strokeWidth={sw} strokeDasharray={dash} />
    case '입원': return <circle cx={x} cy={y} r={5.5} fill={fill} stroke={stroke} strokeWidth={sw} />
    case '수술': return <polygon points={`${x},${y - 6} ${x + 6},${y + 5} ${x - 6},${y + 5}`} fill={fill} stroke={stroke} strokeWidth={sw} />
    case '검사': return <polygon points={`${x},${y - 6} ${x + 5.5},${y} ${x},${y + 6} ${x - 5.5},${y}`} fill={fill} stroke={stroke} strokeWidth={sw} />
    case '영상': return <rect x={x - 4.5} y={y - 4.5} width={9} height={9} fill={fill} stroke={stroke} strokeWidth={sw} />
    default: return <rect x={x - 4} y={y - 2.5} width={8} height={5} rx={2} fill={fill} stroke={stroke} strokeWidth={sw} />
  }
}

export default function ClinicalTimeline() {
  const { bundle, selectedEncounterId, selectEncounter, selectedEncounter } = useEMR()
  const events = useMemo(() => buildTimeline(bundle), [bundle])
  const [ppd, setPpd] = useState(2.2)
  const [tip, setTip] = useState<{ x: number; y: number; ev: TLEvent } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const pendingScroll = useRef<number | null>(null)
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null)
  const [viewW, setViewW] = useState(1200)

  const xOf = useCallback((d: string | number) => PAD + (typeof d === 'number' ? d : dayIndex(d)) * ppd, [ppd])
  const width = PAD * 2 + TOTAL_DAYS * ppd

  useLayoutEffect(() => {
    if (pendingScroll.current !== null && scroller.current) { scroller.current.scrollLeft = pendingScroll.current; pendingScroll.current = null }
  }, [ppd])

  const inited = useRef(false)
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const apply = () => {
      setViewW(el.clientWidth)
      // 처음에는 약 3.3년(1,200일)이 한 화면에 보이도록 맞추고 Today 를 오른쪽 3/4 지점에 둔다
      if (!inited.current && el.clientWidth > 300) {
        inited.current = true
        const next = (el.clientWidth - 2 * PAD) / 1200
        pendingScroll.current = Math.max(0, PAD + (todayIdx - 1200 * 0.74) * next)
        setPpd(next)
      }
    }
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    apply()
    return () => ro.disconnect()
  }, [])

  const centerOnToday = useCallback(() => {
    const el = scroller.current
    if (el) el.scrollLeft = Math.max(0, xOf(todayIdx) - el.clientWidth * 0.62)
  }, [xOf])

  // 환자가 바뀌면 Today 근처로 이동
  useEffect(() => { centerOnToday() }, [bundle.patient.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // 선택한 진료가 화면 밖이면 가운데로 이동
  useEffect(() => {
    const el = scroller.current
    if (!el || !selectedEncounter) return
    const x = xOf(selectedEncounter.date)
    if (x < el.scrollLeft + 20 || x > el.scrollLeft + el.clientWidth - 20) el.scrollLeft = Math.max(0, x - el.clientWidth / 2)
  }, [selectedEncounterId]) // eslint-disable-line react-hooks/exhaustive-deps

  const zoom = useCallback((factor: number, anchorX?: number) => {
    const el = scroller.current
    if (!el) return
    const ax = anchorX ?? el.clientWidth / 2
    const next = Math.min(10, Math.max(0.35, ppd * factor))
    const dayAtAnchor = (el.scrollLeft + ax - PAD) / ppd
    pendingScroll.current = Math.max(0, PAD + dayAtAnchor * next - ax)
    setPpd(next)
  }, [ppd])

  const fit = (days: number) => {
    const el = scroller.current
    if (!el) return
    const next = Math.min(10, Math.max(0.35, (el.clientWidth - 2 * PAD) / days))
    pendingScroll.current = days >= TOTAL_DAYS ? 0 : Math.max(0, PAD + (todayIdx - days * 0.62) * next)
    setPpd(next)
  }

  // Ctrl+휠 확대/축소 (passive:false 가 필요해 네이티브 리스너로 등록)
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const h = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left)
    }
    el.addEventListener('wheel', h, { passive: false })
    return () => el.removeEventListener('wheel', h)
  }, [zoom])

  // 마우스 드래그로 가로 이동
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = drag.current
      if (!d || !scroller.current) return
      if (Math.abs(e.clientX - d.x) > 3) d.moved = true
      scroller.current.scrollLeft = d.left - (e.clientX - d.x)
    }
    const up = () => { drag.current = null; if (scroller.current) scroller.current.style.cursor = 'grab' }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [])

  const months = useMemo(() => {
    const out: { idx: number; y: number; m: number }[] = []
    for (let y = 2022; y <= 2027; y++) for (let m = 0; m < 12; m++) out.push({ idx: dayIndex(`${y}-${String(m + 1).padStart(2, '0')}-01`), y, m })
    return out
  }, [])

  const rowOf = (k: TLKind) => ROWS.findIndex((r) => r.kind === k)
  const showDays = ppd >= 3
  const everyDay = ppd >= 9

  const onMove = (e: React.MouseEvent, ev: TLEvent) => {
    const r = wrap.current!.getBoundingClientRect()
    setTip({ x: Math.min(e.clientX - r.left + 12, r.width - 300), y: Math.min(e.clientY - r.top + 12, r.height - 90), ev })
  }

  const selDate = selectedEncounter?.date
  const selEnd = selectedEncounter?.endDate ?? selectedEncounter?.date

  return (
    <div ref={wrap} className="relative flex h-[236px] shrink-0 flex-col border-b border-black bg-emr-dark">
      <PanelTitle
        right={
          <div className="flex items-center gap-1 text-[10px] font-normal">
            <span className="mr-2 flex items-center gap-2">
              {ROWS.map((r) => <span key={r.kind} className="flex items-center gap-0.5"><i className="inline-block h-[8px] w-[8px]" style={{ background: r.color, borderRadius: r.kind === '외래' || r.kind === '입원' ? 8 : 0, transform: r.kind === '검사' ? 'rotate(45deg) scale(0.9)' : undefined }} />{r.label}</span>)}
            </span>
            <Btn sm onClick={() => fit(TOTAL_DAYS)}>전체</Btn>
            <Btn sm onClick={() => fit(1095)}>3년</Btn>
            <Btn sm onClick={() => fit(365)}>1년</Btn>
            <Btn sm onClick={() => fit(182)}>6개월</Btn>
            <Btn sm ico onClick={() => zoom(1 / 1.35)} title="축소"><ZoomOut size={11} /></Btn>
            <Btn sm ico onClick={() => zoom(1.35)} title="확대"><ZoomIn size={11} /></Btn>
            <Btn sm onClick={centerOnToday} title="오늘로 이동"><LocateFixed size={11} /> Today</Btn>
          </div>
        }
      >
        진료 타임라인 <span className="ml-3 font-normal text-[10.5px] text-[#d9f4fa]">
          {selectedEncounter ? `선택 진료: ${selectedEncounter.date.replace(/-/g, '.')}${selectedEncounter.endDate ? ` ~ ${selectedEncounter.endDate.replace(/-/g, '.')}` : ''} · ${selectedEncounter.type} · ${selectedEncounter.dept} ${selectedEncounter.doctor}` : '선택된 진료 없음'}
        </span>
      </PanelTitle>
      <div className="flex min-h-0 flex-1">
        {/* 행 라벨 */}
        <div className="shrink-0 border-r border-black bg-[#1f2b42]" style={{ width: LABEL_W }}>
          {ROWS.map((r, i) => (
            <div key={r.kind} className="flex items-center gap-1 border-b border-[#101a2b] px-1.5 text-[10.5px] text-emr-sub" style={{ height: ROW_H, marginTop: i === 0 ? TOP : 0, background: i % 2 ? '#222f47' : '#1d293f' }}>
              <i className="inline-block h-[7px] w-[7px]" style={{ background: r.color, borderRadius: r.kind === '외래' || r.kind === '입원' ? 7 : 0 }} />{r.label}
            </div>
          ))}
          <div className="px-1.5 pt-1.5 text-[10px] text-[#7d8aa0]">{bundle.patient.name}<br />{events.filter((e) => !e.future).length}건</div>
        </div>
        <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden" style={{ cursor: 'grab' }}
          onMouseDown={(e) => { drag.current = { x: e.clientX, left: scroller.current!.scrollLeft, moved: false }; scroller.current!.style.cursor = 'grabbing' }}>
          <svg width={width} height={SVG_H} className="block select-none" onMouseLeave={() => setTip(null)}>
            {/* 행 배경 */}
            {ROWS.map((r, i) => <rect key={r.kind} x={0} y={TOP + i * ROW_H} width={width} height={ROW_H} fill={i % 2 ? '#222f47' : '#1d293f'} />)}
            {/* 월/연 가이드라인 */}
            {months.map((mo) => <line key={mo.idx} x1={xOf(mo.idx)} x2={xOf(mo.idx)} y1={TOP} y2={rowsBottom + (mo.m === 0 ? RULER_H : 8)} className={mo.m === 0 ? 'tl-grid-y' : 'tl-grid-m'} />)}
            {/* 선택 진료 강조 */}
            {selDate && <rect x={xOf(selDate) - 3} y={TOP} width={Math.max(6, xOf(selEnd!) - xOf(selDate) + 6)} height={rowsBottom - TOP} fill="#f5e04a" opacity={0.16} />}
            {selDate && <line x1={xOf(selDate)} x2={xOf(selDate)} y1={TOP} y2={rowsBottom} stroke="#f5e04a" strokeWidth={1} strokeDasharray="3 2" />}
            {/* 입원 막대 */}
            {events.filter((e) => e.kind === '입원').map((e) => {
              const x1 = xOf(e.date), x2 = xOf(e.endDate ?? todayISO)
              const y = TOP + rowOf('입원') * ROW_H + ROW_H / 2
              return <rect key={`b-${e.id}`} x={x1} y={y - 4} width={Math.max(4, x2 - x1)} height={8} fill="#f5a623" opacity={0.5} stroke="#f5a623" strokeWidth={1} />
            })}
            {/* 이벤트 */}
            {events.map((e) => {
              const r = ROWS[rowOf(e.kind)]
              const x = xOf(e.date), y = TOP + rowOf(e.kind) * ROW_H + ROW_H / 2
              return (
                <g key={e.id} style={{ cursor: 'pointer' }} onMouseMove={(ev) => onMove(ev, e)} onMouseLeave={() => setTip(null)}
                  onClick={() => { if (!drag.current?.moved) selectEncounter(e.encounterId) }}>
                  <circle cx={x} cy={y} r={9} fill="transparent" />
                  <Marker ev={e} x={x} y={y} color={r.color} selected={e.encounterId === selectedEncounterId} />
                  {ppd >= 5 && e.kind !== '처방' && e.kind !== '검사' && <text x={x + 8} y={y + 3.5} className="tl-label" style={{ pointerEvents: 'none' }}>{e.label.length > 18 ? e.label.slice(0, 18) + '…' : e.label}</text>}
                </g>
              )
            })}
            {/* Today */}
            <line x1={xOf(todayIdx)} x2={xOf(todayIdx)} y1={0} y2={SVG_H - 2} stroke="#f05468" strokeWidth={1.5} />
            <rect x={xOf(todayIdx) - 29} y={rowsBottom + 1} width={58} height={13} fill="#f05468" />
            <text x={xOf(todayIdx)} y={rowsBottom + 11} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="#fff">TODAY {todayISO.slice(5).replace('-', '/')}</text>
            {/* 눈금자 */}
            <rect x={0} y={rowsBottom} width={width} height={RULER_H} fill="#17213a" opacity={0.0} />
            <line x1={0} x2={width} y1={rowsBottom} y2={rowsBottom} stroke="#5d6f92" />
            {months.map((mo, i) => {
              const nx = i + 1 < months.length ? months[i + 1].idx : TOTAL_DAYS
              const w = (nx - mo.idx) * ppd
              return (
                <g key={`l-${mo.idx}`}>
                  {w >= 22 && <text x={xOf(mo.idx) + w / 2} y={rowsBottom + 13} textAnchor="middle" className="tl-label">{mo.m + 1}월</text>}
                  {mo.m === 0 && <text x={xOf(mo.idx) + 4} y={rowsBottom + 30} fontSize={11} fontWeight={700} fill="#7fe6f5">{mo.y}</text>}
                </g>
              )
            })}
            {showDays && months.map((mo, i) => {
              const nx = i + 1 < months.length ? months[i + 1].idx : TOTAL_DAYS
              const out: React.ReactNode[] = []
              for (let d = mo.idx; d < nx; d++) {
                const dd = d - mo.idx + 1
                if (!everyDay && dd !== 1 && dd % 7 !== 1) continue
                out.push(<text key={d} x={xOf(d)} y={rowsBottom + 24} fontSize={8.5} fill="#7d8aa0">{dd}</text>)
              }
              return <g key={`d-${mo.idx}`}>{out}</g>
            })}
          </svg>
        </div>
      </div>
      {tip && (
        <div className="tip" style={{ left: tip.x, top: tip.y }}>
          <div className="mb-0.5 font-bold text-[#7fe6f5]">{tip.ev.kind} · {tip.ev.date.replace(/-/g, '.')}{tip.ev.endDate ? ` ~ ${tip.ev.endDate.replace(/-/g, '.')}` : ''}</div>
          <div className="font-semibold">{tip.ev.label}</div>
          <div className="text-[#cdd8e8]">{tip.ev.detail}</div>
          <div className="mt-0.5 text-[10px] text-[#8ea0bb]">클릭: 해당 날짜의 기록·오더·결과 표시</div>
        </div>
      )}
      <div className="hidden">{addDays(parseISO(todayISO), 0).toDateString()}{viewW}</div>
    </div>
  )
}
