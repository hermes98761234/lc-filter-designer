/** Lowpass prototypes (cutoff 1 rad/s, source resistance 1): Butterworth, Chebyshev I, Bessel, elliptic. */
import { cd, ellipK, ellipKp, kFromNome, nome } from './elliptic'
import { fromRoots, pmul, pneg, polyRoots, padd, pscale, csqrt, cx, type Poly } from './poly'
import { dualLadder, synthesize, type ProtoElement, type ProtoLadder } from './synth'

export type Family = 'butterworth' | 'chebyshev' | 'bessel' | 'elliptic'
export type Topology = 'pi' | 'T'

export interface Prototype extends ProtoLadder {
  family: Family
  n: number
  topology: Topology
  /** Finite transmission zeros (rad/s, lowpass prototype). */
  zeros: number[]
  /** Passband ripple in dB (Chebyshev, elliptic). */
  ripple?: number
  /** Minimum stopband attenuation in dB (elliptic). */
  stopAtten?: number
  /** Stopband edge / passband edge (elliptic). */
  selectivity?: number
}

/** Butterworth g1..gn followed by the load g(n+1) = 1. */
export function butterworthG(n: number): number[] {
  return [...Array.from({ length: n }, (_, i) => 2 * Math.sin(((2 * (i + 1) - 1) * Math.PI) / (2 * n))), 1]
}

/** Chebyshev (type I) g1..gn followed by the load g(n+1). */
export function chebyshevG(n: number, rippleDb: number): number[] {
  const beta = Math.log(1 / Math.tanh((rippleDb * Math.LN10) / 40))
  const gamma = Math.sinh(beta / (2 * n))
  const a = (k: number) => Math.sin(((2 * k - 1) * Math.PI) / (2 * n))
  const b = (k: number) => gamma * gamma + Math.sin((k * Math.PI) / n) ** 2
  const g: number[] = [(2 * a(1)) / gamma]
  for (let k = 2; k <= n; k++) g.push((4 * a(k - 1) * a(k)) / (b(k - 1) * g[k - 2]))
  g.push(n % 2 === 1 ? 1 : 1 / Math.tanh(beta / 4) ** 2)
  return g
}

/** Ladder from alternating g values. `gLoad` is g(n+1) in the standard (shunt-C-first) convention. */
export function ladderFromG(g: number[], topology: Topology): ProtoLadder {
  const n = g.length - 1
  const elements: ProtoElement[] = []
  for (let k = 0; k < n; k++) {
    const shunt = (k % 2 === 0) === (topology === 'pi')
    elements.push(shunt ? { pos: 'shunt', kind: 'C', c: g[k] } : { pos: 'series', kind: 'L', l: g[k] })
  }
  // For even n, the shunt-first (Pi) ladder ends in a series inductor and needs the load 1/g(n+1).
  const gl = g[n]
  return { elements, rl: topology === 'pi' ? 1 / gl : gl }
}

/** Reverse Bessel polynomial theta_n(s), ascending, with theta_n(0) = (2n-1)!!. */
export function besselPoly(n: number): Poly {
  const fact = (m: number): number => (m <= 1 ? 1 : m * fact(m - 1))
  return Array.from({ length: n + 1 }, (_, k) => fact(2 * n - k) / (Math.pow(2, n - k) * fact(k) * fact(n - k)))
}

/** LHP roots (s domain) of a polynomial in x = s^2: s = -sqrt(x). */
function lhpFromX(px: Poly, leadCoef = 1): Poly {
  const roots = polyRoots(px).map((x) => {
    const r = csqrt(x)
    return cx(-r.re, -r.im)
  })
  return fromRoots(roots, leadCoef)
}

/** Ladder for the Bessel (maximally flat delay) lowpass, order n, normalised to unit group delay at DC. */
export function besselDelayLadder(n: number, topology: Topology): ProtoLadder {
  const E = besselPoly(n)
  const t0 = E[0]
  // theta(s) theta(-s) - theta0^2, as a polynomial in x = s^2.
  const full = padd(pmul(E, pneg(E)), [-t0 * t0])
  const px = full.filter((_, i) => i % 2 === 0)
  // Factor out the double root at s = 0 (a single root x = 0).
  const F = pmul([0, 1], lhpFromX(px.slice(1)))
  return synthesize(E, F, [], topology)
}

/** Frequency (rad/s, delay-normalised) where the doubly terminated Bessel response is 3 dB down. */
export function besselCutoff3dB(n: number): number {
  const E = besselPoly(n)
  const t0 = E[0]
  const mag2 = (w: number) => {
    let re = 0
    let im = 0
    for (let k = 0; k <= n; k++) {
      const ph = (k * Math.PI) / 2
      re += E[k] * Math.pow(w, k) * Math.cos(ph)
      im += E[k] * Math.pow(w, k) * Math.sin(ph)
    }
    return (t0 * t0) / (re * re + im * im)
  }
  let lo = 0
  let hi = 100
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (mag2(mid) > 0.5) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Scales a ladder to a new frequency (element values divide by `w`). */
function scaleProto(p: ProtoLadder, w: number): ProtoLadder {
  return {
    rl: p.rl,
    elements: p.elements.map((e) => ({ ...e, l: e.l === undefined ? undefined : e.l / w, c: e.c === undefined ? undefined : e.c / w })),
  }
}

/** Bessel ladder with the -3 dB point at 1 rad/s, or delay-normalised when `norm = 'delay'`. */
export function besselLadder(n: number, topology: Topology, norm: '3dB' | 'delay' = '3dB'): ProtoLadder {
  const d = besselDelayLadder(n, topology)
  return norm === 'delay' ? d : scaleProto(d, 1 / besselCutoff3dB(n))
}

// ---- Butterworth with unequal terminations ------------------------------------------------------

/** Butterworth ladder for load/source resistance ratio r (r > 1: series-first, r < 1: shunt-first). */
export function butterworthUnequal(n: number, r: number): ProtoLadder {
  const rr = r > 1 ? r : 1 / r
  const t0 = (4 * rr) / ((1 + rr) * (1 + rr))
  // B(s) B(-s) = 1 + (-1)^n s^(2n)  -> in x: 1 + (-x)^n
  const bx: Poly = new Array<number>(n + 1).fill(0)
  bx[0] = 1
  bx[n] = n % 2 ? -1 : 1
  const B = lhpFromX(bx)
  const fx = bx.slice()
  fx[0] -= t0
  const F = lhpFromX(fx)
  const tT = synthesize(B, F, [], 'T')
  return r > 1 ? tT : dualLadder(tT)
}

// ---- Elliptic (Cauer) ---------------------------------------------------------------------------

export interface EllipticDesign {
  n: number
  ripple: number
  /** Selectivity k = passband edge / stopband edge. */
  k: number
  /** Stopband edge / passband edge. */
  xi: number
  stopAtten: number
  /** Reflection-zero (passband) frequencies, those inside (0, 1). */
  passZeros: number[]
  /** Transmission zeros. */
  stopZeros: number[]
}

const ripple2eps = (db: number) => Math.sqrt(Math.pow(10, db / 10) - 1)

/** Selectivity k for order n, ripple (dB) and minimum stopband attenuation (dB). */
export function ellipticSelectivity(n: number, rippleDb: number, atten: number): number {
  const k1 = ripple2eps(rippleDb) / Math.sqrt(Math.pow(10, atten / 10) - 1)
  return kFromNome(Math.pow(nome(k1), 1 / n))
}

/** Minimum stopband attenuation (dB) reached by order n with selectivity k (degree equation). */
export function ellipticAttenuation(n: number, rippleDb: number, k: number): number {
  const k1 = kFromNome(Math.pow(nome(k), n))
  const eps = ripple2eps(rippleDb)
  return 10 * Math.log10(1 + (eps / k1) ** 2)
}

/** Smallest order meeting ripple/attenuation at the given stopband ratio (xi = fs/fp). */
export function ellipticMinOrder(rippleDb: number, atten: number, xi: number): number {
  const k = 1 / xi
  const k1 = ripple2eps(rippleDb) / Math.sqrt(Math.pow(10, atten / 10) - 1)
  const n = (ellipK(k) * ellipKp(k1)) / (ellipKp(k) * ellipK(k1))
  return Math.ceil(n - 1e-9)
}

export function ellipticDesign(n: number, rippleDb: number, k: number): EllipticDesign {
  const m = (n - 1) / 2
  const passZeros: number[] = []
  const K = ellipK(k)
  for (let i = 1; i <= m; i++) passZeros.push(cd(((2 * i - 1) * K) / n, k))
  const stopZeros = passZeros.map((z) => 1 / (k * z))
  return { n, ripple: rippleDb, k, xi: 1 / k, stopAtten: ellipticAttenuation(n, rippleDb, k), passZeros, stopZeros }
}

/** Odd-order elliptic ladder. */
export function ellipticLadder(d: EllipticDesign, topology: Topology): ProtoLadder {
  const eps = ripple2eps(d.ripple)
  // P(s) = prod(s^2 + W^2); Fs(s) = s prod(s^2 + z^2); both as polynomials in s.
  let P: Poly = [1]
  for (const w of d.stopZeros) P = pmul(P, [w * w, 0, 1])
  let Fs: Poly = [0, 1]
  for (const z of d.passZeros) Fs = pmul(Fs, [z * z, 0, 1])
  // Normalise so that the characteristic function is 1 at the passband edge (omega = 1).
  const mag = (p: Poly, w: number) => {
    let re = 0
    let im = 0
    p.forEach((c, i) => {
      re += c * Math.pow(w, i) * Math.cos((i * Math.PI) / 2)
      im += c * Math.pow(w, i) * Math.sin((i * Math.PI) / 2)
    })
    return Math.hypot(re, im)
  }
  const rho = mag(P, 1) / mag(Fs, 1)
  const Fn = pscale(Fs, eps * rho)
  // E(s)E(-s) = P(s)P(-s) + F(s)F(-s). In x = s^2: Px^2 - (eps rho)^2 x prod(x + z^2)^2.
  const FF = pmul(Fn, pneg(Fn)) // F(s) F(-s)
  const sum = padd(pmul(P, pneg(P)), FF)
  const px = sum.filter((_, i) => i % 2 === 0)
  const E = lhpFromX(px, Math.sqrt(Math.abs(px[px.length - 1])))
  return synthesize(E, Fn, d.stopZeros, topology)
}

export function butterworthLadder(n: number, topology: Topology): ProtoLadder {
  return ladderFromG(butterworthG(n), topology)
}
