/** Persisted app state. */
import type { Params } from './design'
import type { Series } from './eseries'
import type { FreqUnit } from './format'
import type { Band } from './ladder'

export type Lang = 'en' | 'uk'
export type Theme = 'auto' | 'light' | 'dark'

export interface AppState {
  lang: Lang
  theme: Theme
  p: Params
  fUnit: FreqUnit
  /** Which component values are realised in the plot, schematic and exports. */
  series: Series
  useQ: boolean
  ql: number
  qc: number
  xscale: 'auto' | 'log' | 'linear'
  /** Plot range override in Hz (0 = automatic). */
  plotMin: number
  plotMax: number
}

export const KEY = 'lc-filter-designer:v1'

export const DEFAULT_PARAMS: Params = {
  family: 'butterworth',
  band: 'lp',
  topology: 'pi',
  z0: 50,
  loadOhm: 50,
  f1: 10e6,
  f2: 14e6,
  orderMode: 'manual',
  n: 5,
  ripple: 0.5,
  atten: 50,
  fs1: 20e6,
  fs2: 40e6,
}

export const DEFAULT_STATE: AppState = {
  lang: 'en',
  theme: 'auto',
  p: DEFAULT_PARAMS,
  fUnit: 'MHz',
  series: 'exact',
  useQ: false,
  ql: 60,
  qc: 200,
  xscale: 'auto',
  plotMin: 0,
  plotMax: 0,
}

/** Sensible frequency fields when the band type changes, around a reference frequency. */
export function bandDefaults(band: Band, f: number): Pick<Params, 'f1' | 'f2' | 'fs1' | 'fs2'> {
  switch (band) {
    case 'lp':
      return { f1: f, f2: f * 1.4, fs1: f * 2, fs2: f * 4 }
    case 'hp':
      return { f1: f, f2: f * 1.4, fs1: f / 2, fs2: f * 4 }
    case 'bp':
      return { f1: f * 0.9, f2: f * 1.1, fs1: f * 0.7, fs2: f * 1.4 }
    case 'bs':
      return { f1: f * 0.8, f2: f * 1.25, fs1: f * 0.94, fs2: f * 1.06 }
  }
}

const isOneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d)
const num = (v: unknown, d: number, min = -Infinity): number => (typeof v === 'number' && isFinite(v) && v >= min ? v : d)

/** Merges untrusted stored data into the defaults. */
export function sanitize(raw: unknown): AppState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const q = (r.p && typeof r.p === 'object' ? r.p : {}) as Record<string, unknown>
  const d = DEFAULT_PARAMS
  const p: Params = {
    family: isOneOf(q.family, ['butterworth', 'chebyshev', 'bessel', 'elliptic'], d.family),
    band: isOneOf(q.band, ['lp', 'hp', 'bp', 'bs'], d.band),
    topology: isOneOf(q.topology, ['pi', 'T'], d.topology),
    z0: num(q.z0, d.z0, 1e-6),
    loadOhm: num(q.loadOhm, d.loadOhm, 1e-6),
    f1: num(q.f1, d.f1, 1e-3),
    f2: num(q.f2, d.f2, 1e-3),
    orderMode: isOneOf(q.orderMode, ['manual', 'spec'], d.orderMode),
    n: Math.round(num(q.n, d.n, 1)),
    ripple: num(q.ripple, d.ripple, 1e-6),
    atten: num(q.atten, d.atten, 1e-6),
    fs1: num(q.fs1, d.fs1, 1e-3),
    fs2: num(q.fs2, d.fs2, 1e-3),
  }
  const s = DEFAULT_STATE
  return {
    lang: isOneOf(r.lang, ['en', 'uk'], s.lang),
    theme: isOneOf(r.theme, ['auto', 'light', 'dark'], s.theme),
    p,
    fUnit: isOneOf(r.fUnit, ['Hz', 'kHz', 'MHz', 'GHz'], s.fUnit),
    series: isOneOf(r.series, ['exact', 'E12', 'E24'], s.series),
    useQ: r.useQ === true,
    ql: num(r.ql, s.ql, 0),
    qc: num(r.qc, s.qc, 0),
    xscale: isOneOf(r.xscale, ['auto', 'log', 'linear'], s.xscale),
    plotMin: num(r.plotMin, 0, 0),
    plotMax: num(r.plotMax, 0, 0),
  }
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY)
    const st = sanitize(raw ? JSON.parse(raw) : null)
    if (!raw && typeof navigator !== 'undefined' && /^uk\b/i.test(navigator.language)) st.lang = 'uk'
    return st
  } catch {
    return DEFAULT_STATE
  }
}

export function saveState(s: AppState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // Storage may be unavailable (private mode); settings just won't persist.
  }
}
