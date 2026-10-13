// 시드 난수와 날짜 도우미. 같은 날 열면 항상 같은 가상 데이터가 나오도록 한다.

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Rng = () => number

export const randInt = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
export const pick = <T,>(r: Rng, arr: T[]): T => arr[Math.floor(r() * arr.length)]
export const between = (r: Rng, lo: number, hi: number) => lo + r() * (hi - lo)

const two = (n: number) => String(n).padStart(2, '0')

export const TODAY: Date = (() => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
})()

export const iso = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
export const parseISO = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
export const addDays = (d: Date, n: number) => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
export const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000)
export const todayISO = iso(TODAY)

/** 타임라인 기준일 (2022-01-01) 로부터의 일수 */
export const EPOCH = new Date(2022, 0, 1)
export const dayIndex = (s: string) => daysBetween(EPOCH, parseISO(s))
export const fmtDot = (s: string) => s.replace(/-/g, '.')
export const hhmm = (h: number, m: number) => `${two(h)}:${two(m)}`
export const timeOf = (r: Rng) => hhmm(randInt(r, 8, 16), pick(r, [0, 10, 20, 30, 40, 50]))
