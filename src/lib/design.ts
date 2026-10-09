/** Top-level filter design: specs -> order -> prototype -> real ladder. */
import {
  besselCutoff3dB,
  besselLadder,
  besselPoly,
  butterworthG,
  butterworthUnequal,
  chebyshevG,
  ellipticDesign,
  ellipticLadder,
  ellipticMinOrder,
  ellipticSelectivity,
  ladderFromG,
  type EllipticDesign,
  type Family,
  type Prototype,
  type Topology,
} from './prototypes'
import { transformLadder, type Band, type Ladder, type Transform } from './ladder'
import type { ProtoLadder } from './synth'

/** Marks a message for translation. */
const N = (s: string) => s

/** Error whose message is an English string to translate; {0}, {1} take `args`. */
export class DesignError extends Error {
  args: (string | number)[]
  constructor(msg: string, args: (string | number)[] = []) {
    super(msg)
    this.args = args
  }
}

export interface Params {
  family: Family
  band: Band
  topology: Topology
  /** Source impedance, ohm. */
  z0: number
  /** Load impedance, ohm; equal to z0 unless Butterworth. */
  loadOhm: number
  /** Edge frequencies in Hz: cutoff for lowpass/highpass; lower and upper edge for bandpass/bandstop. */
  f1: number
  f2: number
  orderMode: 'manual' | 'spec'
  n: number
  /** Passband ripple (Chebyshev, elliptic) or passband attenuation (spec mode, Butterworth/Bessel), dB. */
  ripple: number
  /** Stopband attenuation, dB. */
  atten: number
  /** Stopband frequency (lowpass/highpass) or lower stopband edge (bandpass/bandstop), Hz. */
  fs1: number
  /** Upper stopband edge (bandpass/bandstop), Hz. */
  fs2: number
}

export interface Note {
  /** English message, translated in the UI; {0}, {1} are placeholders. */
  msg: string
  args: (string | number)[]
}

export interface Design {
  params: Params
  n: number
  proto: Prototype
  ladder: Ladder
  transform: Transform
  topology: Topology
  /** Prototype edge frequency in Hz (lowpass/highpass) or centre frequency (bandpass/bandstop). */
  fRef: number
  /** Band centre (bandpass/bandstop), Hz. */
  f0?: number
  /** Bandwidth at the prototype edge (bandpass/bandstop), Hz. */
  bwHz?: number
  /** Elliptic design details. */
  elliptic?: EllipticDesign
  notes: Note[]
}

export const MAX_ORDER: Record<Family, number> = { butterworth: 20, chebyshev: 20, bessel: 10, elliptic: 9 }

const a10 = (db: number) => Math.pow(10, db / 10) - 1

/** Bessel attenuation (dB) of the delay-normalised doubly terminated response at w. */
function besselAtten(n: number, w: number): number {
  const E = besselPoly(n)
  let re = 0
  let im = 0
  E.forEach((c, k) => {
    re += c * Math.pow(w, k) * Math.cos((k * Math.PI) / 2)
    im += c * Math.pow(w, k) * Math.sin((k * Math.PI) / 2)
  })
  return 10 * Math.log10((re * re + im * im) / (E[0] * E[0]))
}

function besselEdgeFor(n: number, apDb: number): number {
  let lo = 0
  let hi = 200
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (besselAtten(n, mid) < apDb) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Ratio (stopband / passband) of the equivalent lowpass prototype frequencies. */
export function selectivityRatio(p: Params): number {
  const { band, f1, f2, fs1, fs2 } = p
  const bad = (m: string) => {
    throw new DesignError(m)
  }
  if (band === 'lp') {
    if (!(fs1 > f1)) bad(N('The stopband frequency must be above the passband edge.'))
    return fs1 / f1
  }
  if (band === 'hp') {
    if (!(fs1 < f1)) bad(N('The stopband frequency must be below the passband edge.'))
    return f1 / fs1
  }
  const f0sq = f1 * f2
  if (band === 'bp') {
    if (!(fs1 < f1 && fs2 > f2)) bad(N('The stopband edges must lie outside the passband edges.'))
    const fa = Math.max(fs1, f0sq / fs2)
    return (f0sq / fa - fa) / (f2 - f1)
  }
  if (!(f1 < fs1 && fs1 < fs2 && fs2 < f2)) bad(N('The stopband edges must lie between the band edges.'))
  // The wider of the two symmetric intervals is the harder one to satisfy.
  const fa = Math.min(fs1, f0sq / fs2)
  return (f2 - f1) / (f0sq / fa - fa)
}

/** Order required by the specs, or throws if beyond the supported maximum. */
export function orderFromSpecs(p: Params): number {
  const ratio = selectivityRatio(p)
  const ap = p.ripple
  const as = p.atten
  if (!(as > ap)) throw new DesignError(N('The stopband attenuation must exceed the passband ripple or attenuation.'))
  let n: number
  switch (p.family) {
    case 'butterworth':
      n = Math.ceil(Math.log(a10(as) / a10(ap)) / (2 * Math.log(ratio)) - 1e-9)
      break
    case 'chebyshev':
      n = Math.ceil(Math.acosh(Math.sqrt(a10(as) / a10(ap))) / Math.acosh(ratio) - 1e-9)
      break
    case 'elliptic': {
      n = Math.max(3, ellipticMinOrder(ap, as, ratio))
      if (n % 2 === 0) n++
      break
    }
    case 'bessel': {
      n = 0
      for (let k = 1; k <= MAX_ORDER.bessel; k++) {
        const wp = besselEdgeFor(k, ap)
        if (besselAtten(k, wp * ratio) >= as) {
          n = k
          break
        }
      }
      if (n === 0) n = MAX_ORDER.bessel + 1
      break
    }
  }
  n = Math.max(1, n)
  if (n > MAX_ORDER[p.family]) throw new DesignError(N('The specs need order {0}, above the supported maximum {1}.'), [n, MAX_ORDER[p.family]])
  return n
}

export function buildPrototype(p: Params, n: number, notes: Note[]): { proto: Prototype; topology: Topology; ell?: EllipticDesign } {
  let topology = p.topology
  const equal = Math.abs(p.loadOhm / p.z0 - 1) < 1e-6 || !(p.loadOhm > 0)
  let ladder: ProtoLadder
  let ell: EllipticDesign | undefined
  let zeros: number[] = []
  const extra: Partial<Prototype> = {}
  switch (p.family) {
    case 'butterworth': {
      if (!equal && n >= 1) {
        const r = p.loadOhm / p.z0
        topology = r > 1 ? 'T' : 'pi'
        if (topology !== p.topology) notes.push({ msg: N('Unequal terminations: the {0} topology is used.'), args: [topology === 'T' ? 'T' : 'Pi'] })
        ladder = butterworthUnequal(n, r)
      } else ladder = ladderFromG(butterworthG(n), topology)
      break
    }
    case 'chebyshev':
      ladder = ladderFromG(chebyshevG(n, p.ripple), topology)
      extra.ripple = p.ripple
      break
    case 'bessel':
      ladder = besselLadder(n, topology)
      break
    case 'elliptic': {
      let m = n
      if (m % 2 === 0) {
        m++
        notes.push({ msg: N('Elliptic filters are built for odd orders: order {0} is used.'), args: [m] })
      }
      m = Math.max(3, m)
      const ratioFromAtten = ellipticSelectivity(m, p.ripple, p.atten)
      let k = ratioFromAtten
      if (p.orderMode === 'spec') k = 1 / selectivityRatio(p)
      ell = ellipticDesign(m, p.ripple, k)
      try {
        ladder = ellipticLadder(ell, topology)
      } catch {
        throw new DesignError(N('The elliptic ladder cannot be synthesised for these specs. Relax the ripple or attenuation.'))
      }
      if (Math.abs(ladder.rl - 1) > 1e-3) throw new DesignError(N('The elliptic ladder cannot be synthesised for these specs. Relax the ripple or attenuation.'))
      zeros = ell.stopZeros
      extra.ripple = p.ripple
      extra.stopAtten = ell.stopAtten
      extra.selectivity = ell.xi
      n = m
      break
    }
  }
  if (!equal && p.family !== 'butterworth') notes.push({ msg: N('Unequal terminations are only supported for Butterworth; equal impedances are used.'), args: [] })
  return { proto: { ...ladder, family: p.family, n, topology, zeros, ...extra }, topology, ell }
}

export function design(p: Params): Design {
  const notes: Note[] = []
  if (!(p.z0 > 0)) throw new DesignError(N('Impedance must be positive.'))
  if (!(p.f1 > 0)) throw new DesignError(N('Frequencies must be positive.'))
  const isBand = p.band === 'bp' || p.band === 'bs'
  if (isBand && !(p.f2 > p.f1)) throw new DesignError(N('The upper band edge must be above the lower one.'))
  let n = p.orderMode === 'spec' ? orderFromSpecs(p) : Math.round(p.n)
  if (!(n >= 1) || n > MAX_ORDER[p.family]) throw new DesignError(N('The order must be between 1 and {0}.'), [MAX_ORDER[p.family]])
  if (p.family === 'elliptic' && p.orderMode === 'manual' && !(p.atten > p.ripple)) throw new DesignError(N('The stopband attenuation must exceed the passband ripple or attenuation.'))
  const { proto, topology, ell } = buildPrototype(p, n, notes)
  n = proto.n
  // Prototype frequency at the passband spec edge.
  let omegaP = 1
  if (p.orderMode === 'spec') {
    if (p.family === 'butterworth') omegaP = Math.pow(a10(p.ripple), 1 / (2 * n))
    else if (p.family === 'bessel') omegaP = besselEdgeFor(n, p.ripple) / besselCutoff3dB(n)
  }
  const f0 = Math.sqrt(p.f1 * p.f2)
  let tr: Transform
  let fRef: number
  let bwHz: number | undefined
  if (p.band === 'lp' || p.band === 'hp') {
    fRef = p.band === 'lp' ? p.f1 / omegaP : p.f1 * omegaP
    tr = { band: p.band, z0: p.z0, wc: 2 * Math.PI * fRef }
  } else {
    bwHz = p.band === 'bp' ? (p.f2 - p.f1) / omegaP : (p.f2 - p.f1) * omegaP
    fRef = f0
    tr = { band: p.band, z0: p.z0, w0: 2 * Math.PI * f0, bw: 2 * Math.PI * bwHz }
  }
  const ladder = transformLadder(proto, tr)
  if (n >= 2 && p.family === 'chebyshev' && n % 2 === 0) {
    notes.push({ msg: N('Even-order Chebyshev needs a load of {0} ohm (not equal to the source).'), args: [Number(ladder.rl.toPrecision(5))] })
  }
  return { params: p, n, proto, ladder, transform: tr, topology, fRef, f0: isBand ? f0 : undefined, bwHz, elliptic: ell, notes }
}

/** Default frequency sweep for plotting. */
export function defaultSweep(d: Design): { fmin: number; fmax: number; log: boolean } {
  if (d.f0 !== undefined && d.bwHz !== undefined) {
    const r = Math.min(10, Math.max(1.15, 1 + (3 * d.bwHz) / d.f0))
    // Keep a symmetric, narrow-band view readable.
    const spread = d.proto.family === 'elliptic' ? r * 1.15 : r
    return { fmin: d.f0 / spread, fmax: d.f0 * spread, log: spread > 2.2 }
  }
  return { fmin: d.fRef / 10, fmax: d.fRef * 10, log: true }
}
