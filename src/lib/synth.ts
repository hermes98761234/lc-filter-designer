/**
 * Generic doubly terminated LC ladder synthesis from the reflection function S11 = F/E.
 *
 * The T-type (series-first) network is synthesised from Zin = (E + F) / (E - F), with the source
 * resistance normalised to 1. Finite transmission zeros are realised by partial removal of a series
 * inductor followed by removal of a shunt series-LC branch (Cauer zero extraction). The Pi network is
 * the exact dual.
 */
import {
  cdiv,
  degree,
  lead,
  padd,
  pdivmod,
  pevalC,
  pscale,
  pshift,
  psub,

  trim,
  cx,
  type Poly,
} from './poly'

export interface ProtoElement {
  pos: 'series' | 'shunt'
  /** L: inductor, C: capacitor, LCpar: parallel L and C (series branch), LCser: series L and C (shunt branch). */
  kind: 'L' | 'C' | 'LCpar' | 'LCser'
  l?: number
  c?: number
}

export interface ProtoLadder {
  elements: ProtoElement[]
  /** Load resistance, with the source resistance normalised to 1. */
  rl: number
}

function synthT(Zn: Poly, Zd: Poly, zeros: number[]): ProtoLadder {
  let N = trim(Zn)
  let D = trim(Zd)
  let mode: 'Z' | 'Y' = 'Z'
  let zi = 0
  const els: ProtoElement[] = []
  for (let guard = 0; guard < 200; guard++) {
    const dn = N.length - 1
    const dd = D.length - 1
    if (dn === 0 && dd === 0) return { elements: els, rl: mode === 'Z' ? N[0] / D[0] : D[0] / N[0] }
    if (dn !== dd + 1) throw new Error('synthesis: unexpected degrees')
    if (mode === 'Z' && zi < zeros.length) {
      const W = zeros[zi++]
      const zjw = cdiv(pevalC(N, cx(0, W)), pevalC(D, cx(0, W)))
      const L = zjw.im / W
      if (!(L > 0)) throw new Error('synthesis: negative inductor')
      const Np = psub(N, pscale(pshift(D), L))
      const [Q, r1] = pdivmod(Np, [W * W, 0, 1])
      if (Math.max(...r1.map(Math.abs)) > 1e-4 * Math.max(1, ...Np.map(Math.abs))) throw new Error('synthesis: zero not extracted')
      const ratio = cdiv(pevalC(D, cx(0, W)), pevalC(Q, cx(0, W)))
      const a = ratio.im / W
      if (!(a > 0)) throw new Error('synthesis: negative resonator')
      const [Dn, r2] = pdivmod(psub(D, pscale(pshift(Q), a)), [W * W, 0, 1])
      if (Math.max(...r2.map(Math.abs)) > 1e-4 * Math.max(1, ...D.map(Math.abs))) throw new Error('synthesis: pole not removed')
      els.push({ pos: 'series', kind: 'L', l: L })
      els.push({ pos: 'shunt', kind: 'LCser', l: 1 / a, c: a / (W * W) })
      N = trim(Q)
      D = trim(Dn)
      continue
    }
    const v = lead(N) / lead(D)
    if (!(v > 0)) throw new Error('synthesis: negative element')
    els.push(mode === 'Z' ? { pos: 'series', kind: 'L', l: v } : { pos: 'shunt', kind: 'C', c: v })
    const Nr = trim(psub(N, pscale(pshift(D), v)))
    // The remainder immittance Nr/D is inverted and the next element is of the opposite kind.
    N = D
    D = Nr
    mode = mode === 'Z' ? 'Y' : 'Z'
    if (D.length === 0) throw new Error('synthesis: empty')
  }
  throw new Error('synthesis: did not terminate')
}

/** Dual of a series-first ladder: series L <-> shunt C, series-LC shunt branch <-> parallel-LC series branch. */
export function dualLadder(t: ProtoLadder): ProtoLadder {
  const els = t.elements.map((e): ProtoElement => {
    if (e.kind === 'L') return { pos: 'shunt', kind: 'C', c: e.l }
    if (e.kind === 'C') return { pos: 'series', kind: 'L', l: e.c }
    if (e.kind === 'LCser') return { pos: 'series', kind: 'LCpar', l: e.c, c: e.l }
    return { pos: 'shunt', kind: 'LCser', l: e.c, c: e.l }
  })
  return { elements: els, rl: 1 / t.rl }
}

function permutations(a: number[]): number[][] {
  if (a.length <= 1) return [a]
  return a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((r) => [x, ...r]))
}

/**
 * Synthesises a ladder from E and F (S11 = F/E, source resistance 1). `zeros` are the finite
 * transmission zero frequencies. Both extraction orders are tried; the one with all-positive
 * elements wins.
 */
export function synthesize(E: Poly, F: Poly, zeros: number[], topology: 'pi' | 'T'): ProtoLadder {
  const n = degree(E)
  const sigma = lead(F) / E[n] > 0 ? 1 : -1
  const num = padd(E, pscale(F, sigma))
  const den = psub(E, pscale(F, sigma))
  const asc = zeros.slice().sort((a, b) => a - b)
  // Ascending and descending first (the usual Cauer orders), then every other permutation.
  const orders = asc.length > 1 ? [asc, asc.slice().reverse(), ...permutations(asc)] : [asc]
  let err: unknown
  for (const z of orders) {
    try {
      const t = synthT(num, den, z)
      return topology === 'T' ? t : dualLadder(t)
    } catch (e) {
      err = e
    }
  }
  throw err
}

