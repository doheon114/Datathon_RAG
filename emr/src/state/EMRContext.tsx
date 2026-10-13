import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Encounter, GuidelineInsert, Note, Order, Patient, PatientBundle, Rect, WinId, WinState } from '../types'
import { currentUser, loadBundle, loadCohort, peekBundle, peekPatients, placeholderBundle } from '../api/emrApi'
import { todayISO } from '../data/rng'

export type DialogType = 'summary' | 'memo' | 'cvr' | 'setting' | 'func' | 'logout' | 'vitals' | 'images' | 'visit' | 'history' | 'problems' | 'newnote' | 'neworder' | 'patients' | 'data' | 'editnote' | 'delnote' | 'noteview' | 'notesettings' | 'cohort'
export interface DialogState { type: DialogType; data?: unknown }
export interface Toast { id: number; msg: string; kind: 'info' | 'warn' }
export interface Settings { fontSize: number; compact: boolean }

interface EMRValue {
  patients: Patient[]
  /** 코호트 목록 로딩이 끝났는지 */
  ready: boolean
  /** 선택한 환자의 상세 기록을 불러오는 중인지 */
  bundleLoading: boolean
  patientId: string
  bundle: PatientBundle
  user: typeof currentUser
  selectedEncounterId: string | null
  selectedDate: string | null
  selectedEncounter: Encounter | null
  selectedNoteId: string | null
  windows: Record<WinId, WinState>
  workspace: { w: number; h: number }
  dialog: DialogState | null
  toasts: Toast[]
  settings: Settings
  /** null: 세션 확인 중, false: 로그인 필요, true: 로그인됨 */
  authed: boolean | null
  login: (password: string) => Promise<string | null>
  logout: () => Promise<void>
  selectPatient: (id: string) => void
  selectEncounter: (id: string | null) => void
  selectNote: (id: string | null) => void
  openWindow: (id: WinId) => void
  closeWindow: (id: WinId) => void
  toggleMinimize: (id: WinId) => void
  toggleMaximize: (id: WinId) => void
  focusWindow: (id: WinId) => void
  setRect: (id: WinId, r: Rect) => void
  setWorkspace: (w: number, h: number) => void
  resetLayout: () => void
  addNote: (n: Note) => void
  updateNote: (id: string, patch: Partial<Note>) => void
  deleteNote: (id: string) => void
  addOrder: (o: Order) => void
  insertGuideline: (ins: GuidelineInsert) => string
  openDialog: (type: DialogType, data?: unknown) => void
  closeDialog: () => void
  toast: (msg: string, kind?: Toast['kind']) => void
  setSettings: (s: Partial<Settings>) => void
}

const Ctx = createContext<EMRValue | null>(null)
export const useEMR = () => {
  const v = useContext(Ctx)
  if (!v) throw new Error('EMRProvider 밖에서 useEMR 를 호출했습니다.')
  return v
}

export function defaultLayout(w: number, h: number): Record<WinId, Rect> {
  const gap = 4
  const notesW = Math.round(w * 0.37)
  const midW = Math.round(w * 0.31)
  const ordH = Math.round(h * 0.5) - gap / 2
  return {
    notes: { x: 0, y: 0, w: notesW, h },
    orders: { x: notesW + gap, y: 0, w: midW, h: ordH },
    labs: { x: notesW + gap, y: ordH + gap, w: midW, h: h - ordH - gap },
    ai: { x: notesW + midW + gap * 2, y: 0, w: w - notesW - midW - gap * 2, h },
  }
}

const emptyWin = (r: Rect, z: number, open = true): WinState => ({ open, minimized: false, maximized: false, rect: r, z })
const WIN_IDS: WinId[] = ['notes', 'orders', 'labs', 'ai']

const latestEncounter = (b: PatientBundle): Encounter | null => {
  const past = b.encounters.filter((e) => !e.future && e.date <= todayISO)
  // 코호트 환자는 입원 진료를 기본 선택한다 (응급실·시술보다 입원이 전체 기록을 담고 있다)
  if (b.patient.group === 'hf') { const adm = past.filter((e) => e.type === '입원'); if (adm.length) return adm[adm.length - 1] }
  return past.length ? past[past.length - 1] : b.encounters[0] ?? null
}

export function EMRProvider({ children }: { children: ReactNode }) {
  const demoPatients = useMemo(() => peekPatients(), [])
  const [patients, setPatients] = useState<Patient[]>(demoPatients)
  const [ready, setReady] = useState(false)
  const [patientId, setPatientId] = useState(demoPatients[0].id)
  const [bundles, setBundles] = useState<Record<string, PatientBundle>>({})
  const patient = patients.find((p) => p.id === patientId) ?? patients[0]
  const bundle = bundles[patientId] ?? peekBundle(patientId) ?? placeholderBundle(patient)
  const bundleLoading = !bundles[patientId] && !peekBundle(patientId)

  const [selectedEncounterId, setSelectedEncounterId] = useState<string | null>(() => latestEncounter(peekBundle(demoPatients[0].id)!)?.id ?? null)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [workspace, setWs] = useState({ w: 0, h: 0 })
  const zRef = useRef(10)
  const [windows, setWindows] = useState<Record<WinId, WinState>>(() => {
    const d = defaultLayout(1600, 760)
    return { notes: emptyWin(d.notes, 1), orders: emptyWin(d.orders, 2), labs: emptyWin(d.labs, 3), ai: emptyWin(d.ai, 4) }
  })
  const laidOut = useRef(false)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [settings, setSettingsState] = useState<Settings>(() => {
    try { return { fontSize: 12, compact: false, ...JSON.parse(localStorage.getItem('emr.settings') ?? '{}') } } catch { return { fontSize: 12, compact: false } }
  })
  const [authed, setAuthed] = useState<boolean | null>(null)

  // 서버 세션(쿠키)이 있으면 로그인 화면을 건너뛴다
  useEffect(() => {
    let alive = true
    fetch(`${import.meta.env.BASE_URL}api/session`, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((j) => { if (alive) setAuthed(!!j.authed) })
      .catch(() => { if (alive) setAuthed(false) })
    return () => { alive = false }
  }, [])

  /** 성공하면 null, 실패하면 오류 메시지를 돌려준다 */
  const login = useCallback(async (password: string): Promise<string | null> => {
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}api/login`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
      if (r.ok) { setAuthed(true); return null }
      let msg = '로그인에 실패했습니다.'
      try { const j = await r.json(); if (typeof j.detail === 'string') msg = j.detail } catch { /* JSON 아님 */ }
      return msg
    } catch { return '서버에 연결할 수 없습니다.' }
  }, [])

  const logout = useCallback(async () => {
    try { await fetch(`${import.meta.env.BASE_URL}api/logout`, { method: 'POST', credentials: 'same-origin' }) } catch { /* 무시 */ }
    setReady(false)
    setPatients(demoPatients)
    setPatientId(demoPatients[0].id)
    setAuthed(false)
  }, [demoPatients])

  const selectedEncounter = bundle.encounters.find((e) => e.id === selectedEncounterId) ?? null
  const selectedDate = selectedEncounter?.date ?? null

  useEffect(() => { document.documentElement.style.setProperty('--emr-fs', `${settings.fontSize}px`); document.documentElement.dataset.compact = settings.compact ? '1' : '0' }, [settings])

  const getBundle = useCallback((id: string) => bundles[id] ?? peekBundle(id) ?? placeholderBundle(patients.find((p) => p.id === id) ?? patients[0]), [bundles, patients])

  // 시작 시 심부전 코호트 목록을 불러와 환자 목록의 기본값으로 삼는다 (실패하면 시연 환자만 사용)
  useEffect(() => {
    if (!authed) return
    let alive = true
    loadCohort()
      .then((hf) => {
        if (!alive) return
        const all = [...hf, ...demoPatients]
        setPatients(all)
        setPatientId(hf[0].id)
        setSelectedEncounterId(null)
        setReady(true)
      })
      .catch(() => { if (alive) setReady(true) })
    return () => { alive = false }
  }, [demoPatients, authed])

  // 선택한 환자의 상세 기록을 필요할 때 불러온다
  useEffect(() => {
    if (bundles[patientId] || peekBundle(patientId)) return
    let alive = true
    loadBundle(patientId).then((b) => { if (alive) setBundles((s) => ({ ...s, [patientId]: b })) }).catch(() => undefined)
    return () => { alive = false }
  }, [patientId]) // eslint-disable-line react-hooks/exhaustive-deps

  // 상세 기록이 도착하면 기본 진료·기록을 선택한다
  useEffect(() => {
    if (bundleLoading) return
    if (!bundle.encounters.some((e) => e.id === selectedEncounterId)) setSelectedEncounterId(latestEncounter(bundle)?.id ?? null)
  }, [bundleLoading, patientId]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectPatient = useCallback((id: string) => {
    setPatientId(id)
    const b = bundles[id] ?? peekBundle(id)
    setSelectedEncounterId(b ? latestEncounter(b)?.id ?? null : null)
    setSelectedNoteId(null)
  }, [bundles])

  const selectEncounter = useCallback((id: string | null) => {
    setSelectedEncounterId(id)
    const b = getBundle(patientId)
    const n = id ? b.notes.filter((x) => x.encounterId === id) : []
    setSelectedNoteId(n.length ? n[0].id : null)
  }, [getBundle, patientId])

  const bump = (s: Record<WinId, WinState>, id: WinId): Record<WinId, WinState> => {
    zRef.current += 1
    return { ...s, [id]: { ...s[id], z: zRef.current } }
  }
  const focusWindow = useCallback((id: WinId) => setWindows((s) => bump(s, id)), [])
  const openWindow = useCallback((id: WinId) => setWindows((s) => bump({ ...s, [id]: { ...s[id], open: true, minimized: false } }, id)), [])
  const closeWindow = useCallback((id: WinId) => setWindows((s) => ({ ...s, [id]: { ...s[id], open: false, maximized: false } })), [])
  const toggleMinimize = useCallback((id: WinId) => setWindows((s) => bump({ ...s, [id]: { ...s[id], minimized: !s[id].minimized } }, id)), [])
  const toggleMaximize = useCallback((id: WinId) => setWindows((s) => bump({ ...s, [id]: { ...s[id], maximized: !s[id].maximized, minimized: false } }, id)), [])
  const setRect = useCallback((id: WinId, r: Rect) => setWindows((s) => ({ ...s, [id]: { ...s[id], rect: r } })), [])

  const setWorkspace = useCallback((w: number, h: number) => {
    setWs({ w, h })
    if (!laidOut.current && w > 100 && h > 100) {
      laidOut.current = true
      const d = defaultLayout(w, h)
      setWindows((s) => Object.fromEntries(WIN_IDS.map((id) => [id, { ...s[id], rect: d[id] }])) as Record<WinId, WinState>)
    } else if (w > 100 && h > 100) {
      // 작업영역이 줄어들면 창이 영역 밖으로 나가지 않도록 맞춘다
      setWindows((s) => Object.fromEntries(WIN_IDS.map((id) => {
        const r = s[id].rect
        const nw = Math.min(r.w, w), nh = Math.min(r.h, h)
        return [id, { ...s[id], rect: { x: Math.max(0, Math.min(r.x, w - nw)), y: Math.max(0, Math.min(r.y, h - nh)), w: nw, h: nh } }]
      })) as Record<WinId, WinState>)
    }
  }, [])

  const resetLayout = useCallback(() => {
    const d = defaultLayout(workspace.w || 1600, workspace.h || 760)
    setWindows((s) => Object.fromEntries(WIN_IDS.map((id, k) => [id, { open: true, minimized: false, maximized: false, rect: d[id], z: s[id].z - s[id].z + k + 1 }])) as Record<WinId, WinState>)
  }, [workspace])

  const patch = useCallback((id: string, fn: (b: PatientBundle) => PatientBundle) => {
    setBundles((s) => ({ ...s, [id]: fn(s[id] ?? peekBundle(id)) }))
  }, [])

  const addNote = useCallback((n: Note) => { patch(n.patientId, (b) => ({ ...b, notes: [...b.notes, n] })); setSelectedNoteId(n.id) }, [patch])
  const updateNote = useCallback((id: string, patchN: Partial<Note>) => patch(patientId, (b) => ({ ...b, notes: b.notes.map((x) => (x.id === id ? { ...x, ...patchN } : x)) })), [patch, patientId])
  const deleteNote = useCallback((id: string) => { patch(patientId, (b) => ({ ...b, notes: b.notes.filter((x) => x.id !== id) })); setSelectedNoteId((cur) => (cur === id ? null : cur)) }, [patch, patientId])
  const addOrder = useCallback((o: Order) => patch(o.patientId, (b) => ({ ...b, orders: [o, ...b.orders] })), [patch])

  /** AI 지침 근거를 진료기록에 삽입한다. 선택된 기록 → 선택 진료의 기록 → 최근 기록 순으로 대상을 고른다. 대상 기록 id 반환 */
  const insertGuideline = useCallback((ins: GuidelineInsert): string => {
    const b = getBundle(patientId)
    const target = b.notes.find((x) => x.id === selectedNoteId)
      ?? b.notes.find((x) => x.encounterId === selectedEncounterId)
      ?? [...b.notes].sort((a, c) => (a.date + a.time < c.date + c.time ? 1 : -1))[0]
    if (!target) return ''
    patch(patientId, (bb) => ({ ...bb, notes: bb.notes.map((x) => (x.id === target.id ? { ...x, inserts: [...x.inserts, ins] } : x)) }))
    setSelectedNoteId(target.id)
    setSelectedEncounterId(target.encounterId)
    return target.id
  }, [getBundle, patientId, patch, selectedEncounterId, selectedNoteId])

  const toast = useCallback((msg: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, msg, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800)
  }, [])

  const setSettings = useCallback((s: Partial<Settings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...s }
      try { localStorage.setItem('emr.settings', JSON.stringify(next)) } catch { /* 저장 불가 환경 */ }
      return next
    })
  }, [])

  const value: EMRValue = {
    patients, ready, bundleLoading, patientId, bundle, user: currentUser, selectedEncounterId, selectedDate, selectedEncounter, selectedNoteId, windows, workspace, dialog, toasts, settings, authed, login, logout,
    selectPatient, selectEncounter, selectNote: setSelectedNoteId, openWindow, closeWindow, toggleMinimize, toggleMaximize, focusWindow, setRect, setWorkspace, resetLayout,
    addNote, updateNote, deleteNote, addOrder, insertGuideline, openDialog: (type, data) => setDialog({ type, data }), closeDialog: () => setDialog(null), toast, setSettings,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
