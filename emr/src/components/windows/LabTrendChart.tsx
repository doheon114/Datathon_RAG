import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { LabResult } from '../../types'

const flagColor = (f: string) => (f === 'N' ? '#61c86a' : f === 'L' || f === 'LL' ? '#5ab0ff' : '#f05468')
const short = (d: string) => d.slice(2).replace(/-/g, '.')

interface DotProps { cx?: number; cy?: number; payload?: { flag: string; date: string } }

/** 검사 항목 하나의 시계열 추이. 참고치 구간을 띠로 표시하고 이상값은 빨강/파랑 점으로 구분한다. */
export default function LabTrendChart({ series, selectedDate }: { series: LabResult[]; selectedDate?: string | null }) {
  if (!series.length) return <div className="flex h-full items-center justify-center text-[11px] text-emr-sub">표시할 검사 결과가 없습니다.</div>
  const s = [...series].sort((a, b) => (a.datetime < b.datetime ? -1 : 1))
  const data = s.map((r) => ({ label: short(r.date), date: r.date, value: r.value, flag: r.flag }))
  const lo = s[0].refLow, hi = s[0].refHigh
  const vals = s.map((r) => r.value)
  const yMin = Math.min(...vals, lo ?? Infinity), yMax = Math.max(...vals, hi ?? -Infinity)
  const pad = (yMax - yMin || 1) * 0.15
  const dec = Math.abs(yMax) < 10 ? 2 : 0
  const selLabel = selectedDate ? short(selectedDate) : null

  const Dot = ({ cx, cy, payload }: DotProps) => {
    if (cx === undefined || cy === undefined || !payload) return <g />
    const sel = payload.date === selectedDate
    return <circle cx={cx} cy={cy} r={sel ? 5 : 3.5} fill={flagColor(payload.flag)} stroke={sel ? '#fff' : '#0d1626'} strokeWidth={sel ? 2 : 1} />
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 14, bottom: 2, left: 0 }}>
        <CartesianGrid stroke="#3c4962" strokeDasharray="2 3" />
        <XAxis dataKey="label" tick={{ fontSize: 9.5, fill: '#a8b6c8' }} tickLine={{ stroke: '#4a5870' }} axisLine={{ stroke: '#4a5870' }} interval="preserveStartEnd" minTickGap={18} />
        <YAxis tick={{ fontSize: 9.5, fill: '#a8b6c8' }} tickLine={{ stroke: '#4a5870' }} axisLine={{ stroke: '#4a5870' }} width={44}
          domain={[Math.max(0, +(yMin - pad).toFixed(dec)), +(yMax + pad).toFixed(dec)]} tickFormatter={(v: number) => (dec ? v.toFixed(1) : Math.round(v).toLocaleString('en-US'))} />
        {(lo !== undefined || hi !== undefined) && <ReferenceArea y1={lo ?? Math.max(0, yMin - pad)} y2={hi ?? yMax + pad} fill="#61c86a" fillOpacity={0.1} stroke="none" />}
        {hi !== undefined && <ReferenceLine y={hi} stroke="#f05468" strokeDasharray="4 3" strokeOpacity={0.8} />}
        {lo !== undefined && <ReferenceLine y={lo} stroke="#5ab0ff" strokeDasharray="4 3" strokeOpacity={0.8} />}
        {selLabel && data.some((d) => d.label === selLabel) && <ReferenceLine x={selLabel} stroke="#f5e04a" strokeDasharray="3 2" />}
        <Tooltip isAnimationActive={false} contentStyle={{ background: '#0f1828', border: '1px solid #00bcd4', borderRadius: 0, fontSize: 11, padding: '3px 6px' }} labelStyle={{ color: '#7fe6f5' }}
          formatter={(v: number, _n, item) => [`${v.toLocaleString('en-US')} ${s[0].unit}${item && (item.payload as { flag: string }).flag !== 'N' ? ` (${(item.payload as { flag: string }).flag})` : ''}`, s[0].name]} />
        <Line type="monotone" dataKey="value" stroke="#7fb8f0" strokeWidth={1.5} dot={<Dot />} activeDot={{ r: 5 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
