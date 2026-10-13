import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Highlighter, Minus, Plus, Target, X } from 'lucide-react'
import { locate, pageImageUrl, pageSizes, type LocateResult } from '../../api/guidelineApi'
import { useGuideline, type ViewerTarget } from '../../state/GuidelineContext'

const PAD = 16

function PdfPage({ source, page, ratio, root, hl, rects, dims }: { source: string; page: number; ratio: string; root: HTMLElement | null; hl: boolean; rects?: number[][]; dims?: { w: number; h: number } }) {
  const ref = useRef<HTMLDivElement>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || !root || seen) return
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect() } }, { root, rootMargin: '1600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [root, seen])
  return (
    <div ref={ref} className="pdf-page" data-p={page} style={{ aspectRatio: ratio }}>
      {seen && <img src={pageImageUrl(source, page)} alt={`p.${page}`} decoding="async" />}
      {hl && dims && rects?.map(([x0, y0, x1, y1], i) => (
        <div key={i} className="pdf-hl" style={{ left: `${(x0 / dims.w) * 100}%`, top: `${(y0 / dims.h) * 100}%`, width: `${((x1 - x0) / dims.w) * 100}%`, height: `${((y1 - y0) / dims.h) * 100}%` }} />
      ))}
    </div>
  )
}

function Viewer({ target, onClose }: { target: ViewerTarget; onClose: () => void }) {
  const [info, setInfo] = useState<LocateResult | null>(null)
  const [sizes, setSizes] = useState<number[][]>([])
  const [err, setErr] = useState('')
  const [zoom, setZoom] = useState(1)
  const [hl, setHl] = useState(true)
  const [cur, setCur] = useState(1)
  const body = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const starts = useRef<number[]>([])
  const [bodyEl, setBodyEl] = useState<HTMLElement | null>(null)
  const expected = !!target.marks?.units?.length

  useEffect(() => {
    let alive = true
    locate(target.passage.id, target.marks?.units)
      .then(async (i) => { const s = await pageSizes(i.source); if (alive) { setInfo(i); setSizes(s) } })
      .catch((e) => alive && setErr(String(e.message || e)))
    return () => { alive = false }
  }, [target])

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const boxWidth = useCallback(() => Math.round(Math.min((body.current?.clientWidth ?? 900) - 2 * PAD, 900) * zoom), [zoom])
  const measure = useCallback(() => { starts.current = [...(box.current?.children ?? [])].map((c) => (c as HTMLElement).offsetTop) }, [])

  const scrollToCited = useCallback((smooth: boolean) => {
    if (!info || !body.current || !box.current) return
    const el = box.current.children[info.page - 1] as HTMLElement | undefined
    if (!el) return
    const top = el.offsetTop + (info.focus != null ? (info.focus / info.h) * el.offsetHeight - 90 : -10)
    body.current.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' })
  }, [info])

  useLayoutEffect(() => {
    if (!box.current || !info || !sizes.length) return
    box.current.style.width = `${boxWidth()}px`
    measure()
  }, [info, sizes, zoom, boxWidth, measure])

  useEffect(() => { setBodyEl(body.current) }, [info, sizes])
  useLayoutEffect(() => { if (info && sizes.length) scrollToCited(false) }, [info, sizes, scrollToCited])

  const updateCur = useCallback(() => {
    const b = body.current
    if (!b || !starts.current.length) return
    const mid = b.scrollTop + b.clientHeight / 3 - PAD
    let lo = 0, hi = starts.current.length - 1
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts.current[m] <= mid) lo = m; else hi = m - 1 }
    setCur(lo + 1)
  }, [])

  const changeZoom = (z: number) => {
    const b = body.current, bx = box.current
    if (!b || !bx) return
    const before = bx.offsetWidth
    const next = Math.max(0.5, Math.min(1.6, z))
    setZoom(next)
    requestAnimationFrame(() => { b.scrollTop *= bx.offsetWidth / before; measure(); updateCur() })
  }

  return (
    <div className="fixed inset-0 z-[9500] flex items-center justify-center bg-black/60" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="win-frame" style={{ width: 'min(1040px, 96vw)', height: '94vh' }}>
        <div className="title-blue flex h-[24px] shrink-0 items-center gap-2 px-2 text-[12px] font-bold">
          <span className="min-w-0 flex-1 truncate">원문 PDF — {info?.name ?? target.passage.source_name}</span>
          <span className="font-mono text-[11px] font-normal">{info ? `p.${cur} / ${info.total}${cur === info.page ? (expected ? ' · 인용된 쪽' : ' · 발췌문 쪽') : ''}` : ''}</span>
          <button type="button" className="btn btn-sm" data-active={hl ? 'true' : undefined} onClick={() => setHl((v) => !v)}><Highlighter size={11} /> 형광펜</button>
          <button type="button" className="btn btn-sm" onClick={() => scrollToCited(true)}><Target size={11} /> 인용 위치로</button>
          <button type="button" className="btn btn-sm btn-ico" onClick={() => changeZoom(zoom - 0.2)} aria-label="축소"><Minus size={11} /></button>
          <button type="button" className="btn btn-sm btn-ico" onClick={() => changeZoom(zoom + 0.2)} aria-label="확대"><Plus size={11} /></button>
          <button type="button" className="win-ctl close" onClick={onClose} aria-label="닫기"><X size={11} /></button>
        </div>
        {info && !info.rects.length && <div className="bg-[#33290f] px-2 py-[2px] text-[11px] text-[#e6b55a]">{expected ? '정확한 문장 위치를 찾지 못해 해당 쪽만 표시합니다.' : '답변에 인용되지 않은 발췌문입니다 (형광펜 없음).'}</div>}
        <div ref={body} className="min-h-0 flex-1 overflow-auto bg-[#0d0f12] p-4" onScroll={updateCur}>
          {err && <div className="p-4 text-emr-bad">{err}</div>}
          {!err && !info && <div className="flex items-center gap-2 p-4 text-emr-sub"><span className="spin" /> 원문을 불러오는 중…</div>}
          {info && sizes.length > 0 && (
            <div ref={box} className="relative mx-auto">
              {sizes.map(([w, h], i) => (
                <PdfPage key={i} source={info.source} page={i + 1} ratio={`${w} / ${h}`} root={bodyEl} hl={hl && i + 1 === info.page}
                  rects={i + 1 === info.page ? info.rects : undefined} dims={i + 1 === info.page ? { w: info.w, h: info.h } : undefined} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function PdfViewerModal() {
  const { viewer, closeViewer } = useGuideline()
  if (!viewer) return null
  return <Viewer key={`${viewer.passage.id}:${viewer.marks?.units?.join(',') ?? ''}`} target={viewer} onClose={closeViewer} />
}
