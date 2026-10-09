/** Real (denormalised) ladders: transforms from the lowpass prototype and ABCD-matrix analysis. */
import { cadd, cabs, carg, cdiv, cmul, cx, type Cx } from './poly'
import type { ProtoElement, ProtoLadder } from './synth'

export type Band = 'lp' | 'hp' | 'bp' | 'bs'

export type Leaf = { t: 'L' | 'C'; v: number; ref: string }
export type Group = { t: 'S' | 'P'; k: Node[] }
export type Node = Leaf | Group
export const isLeaf = (n: Node): n is Leaf => n.t === 'L' || n.t === 'C'

export interface Branch {
  pos: 'series' | 'shunt'
  node: Node
}

export interface Ladder {
  branches: Branch[]
  rs: number
  rl: number
}

export interface Transform {
  band: Band
  z0: number
  /** Lowpass/highpass edge (rad/s). */
  wc?: number
  /** Bandpass/bandstop centre and bandwidth (rad/s). */
  w0?: number
  bw?: number
}

const leaf = (t: 'L' | 'C', v: number): Node => ({ t, v, ref: '' })
const ser = (...k: Node[]): Node => ({ t: 'S', k })
const par = (...k: Node[]): Node => ({ t: 'P', k })

/** Replaces a prototype inductor (impedance s*l) by its band transform. */
function xfL(l: number, x: Transform): Node {
  const { z0 } = x
  switch (x.band) {
    case 'lp':
      return leaf('L', (l * z0) / x.wc!)
    case 'hp':
      return leaf('C', 1 / (l * z0 * x.wc!))
    case 'bp':
      return ser(leaf('L', (l * z0) / x.bw!), leaf('C', x.bw! / (l * z0 * x.w0! * x.w0!)))
    case 'bs':
      return par(leaf('L', (l * z0 * x.bw!) / (x.w0! * x.w0!)), leaf('C', 1 / (l * z0 * x.bw!)))
  }
}

/** Replaces a prototype capacitor (admittance s*c) by its band transform. */
function xfC(c: number, x: Transform): Node {
  const { z0 } = x
  switch (x.band) {
    case 'lp':
      return leaf('C', c / (z0 * x.wc!))
    case 'hp':
      return leaf('L', z0 / (c * x.wc!))
    case 'bp':
      return par(leaf('C', c / (z0 * x.bw!)), leaf('L', (z0 * x.bw!) / (c * x.w0! * x.w0!)))
    case 'bs':
      return ser(leaf('L', z0 / (c * x.bw!)), leaf('C', (c * x.bw!) / (z0 * x.w0! * x.w0!)))
  }
}

function flatten(n: Node): Node {
  if (isLeaf(n)) return n
  const kids: Node[] = []
  for (const c of n.k.map(flatten)) {
    if (c.t === n.t) kids.push(...c.k)
    else kids.push(c)
  }
  return kids.length === 1 ? kids[0] : { t: n.t, k: kids }
}

function protoNode(e: ProtoElement, x: Transform): Node {
  switch (e.kind) {
    case 'L':
      return xfL(e.l!, x)
    case 'C':
      return xfC(e.c!, x)
    case 'LCpar':
      return par(xfL(e.l!, x), xfC(e.c!, x))
    case 'LCser':
      return ser(xfL(e.l!, x), xfC(e.c!, x))
  }
}

/** Names components L1, L2, ... and C1, C2, ... in order from the source. */
export function assignRefs(branches: Branch[]): void {
  let nl = 0
  let nc = 0
  const walk = (n: Node) => {
    if (isLeaf(n)) n.ref = n.t === 'L' ? `L${++nl}` : `C${++nc}`
    else n.k.forEach(walk)
  }
  branches.forEach((b) => walk(b.node))
}

export function transformLadder(p: ProtoLadder, x: Transform): Ladder {
  const branches: Branch[] = p.elements.map((e) => ({ pos: e.pos, node: flatten(protoNode(e, x)) }))
  assignRefs(branches)
  return { branches, rs: x.z0, rl: x.z0 * p.rl }
}

export interface Part {
  ref: string
  type: 'L' | 'C'
  value: number
  /** 1-based index of the branch in the ladder. */
  branch: number
  pos: 'series' | 'shunt'
}

export function listParts(l: Ladder): Part[] {
  const out: Part[] = []
  l.branches.forEach((b, i) => {
    const walk = (n: Node) => {
      if (isLeaf(n)) out.push({ ref: n.ref, type: n.t, value: n.v, branch: i + 1, pos: b.pos })
      else n.k.forEach(walk)
    }
    walk(b.node)
  })
  return out
}

/** Copy of the ladder with every component value passed through `f`. */
export function mapValues(l: Ladder, f: (type: 'L' | 'C', v: number, ref: string) => number): Ladder {
  const m = (n: Node): Node => (isLeaf(n) ? { ...n, v: f(n.t, n.v, n.ref) } : { t: n.t, k: n.k.map(m) })
  return { ...l, branches: l.branches.map((b) => ({ ...b, node: m(b.node) })) }
}

export interface Loss {
  /** Inductor Q (0 or Infinity = lossless) at `wref`. */
  ql: number
  /** Capacitor Q at `wref`. */
  qc: number
  /** Reference angular frequency for Q. */
  wref: number
}

/** Series equivalent resistance of one component, from its Q at the reference frequency. */
export function esr(type: 'L' | 'C', v: number, loss: Loss): number {
  const q = type === 'L' ? loss.ql : loss.qc
  if (!(q > 0) || !isFinite(q)) return 0
  return type === 'L' ? (loss.wref * v) / q : 1 / (loss.wref * v * q)
}

const TINY = 1e-18

export function nodeZ(n: Node, w: number, loss?: Loss): Cx {
  if (isLeaf(n)) return n.t === 'L' ? cx(loss ? esr('L', n.v, loss) : 0, w * n.v) : cx(loss ? esr('C', n.v, loss) : 0, -1 / (w * n.v))
  if (n.t === 'S') return n.k.reduce((a, c) => cadd(a, nodeZ(c, w, loss)), cx(0))
  let y = cx(0)
  for (const c of n.k) {
    const z = nodeZ(c, w, loss)
    const m = z.re * z.re + z.im * z.im
    y = cadd(y, m < TINY * TINY ? cx(1 / TINY, 0) : cdiv(cx(1), z))
  }
  return cdiv(cx(1), y.re * y.re + y.im * y.im < TINY * TINY ? cx(TINY) : y)
}

export interface Response {
  freqs: number[]
  /** dB */
  s21: number[]
  s11: number[]
  /** Group delay in seconds. */
  gd: number[]
}

type M = [Cx, Cx, Cx, Cx] // A B C D

function mmul(a: M, b: M): M {
  return [
    cadd(cmul(a[0], b[0]), cmul(a[1], b[2])),
    cadd(cmul(a[0], b[1]), cmul(a[1], b[3])),
    cadd(cmul(a[2], b[0]), cmul(a[3], b[2])),
    cadd(cmul(a[2], b[1]), cmul(a[3], b[3])),
  ]
}

/** Complex S21 and S11 of the terminated ladder at angular frequency w. */
export function sParams(l: Ladder, w: number, loss?: Loss): { s21: Cx; s11: Cx } {
  let m: M = [cx(1), cx(0), cx(0), cx(1)]
  for (const b of l.branches) {
    const z = nodeZ(b.node, w, loss)
    if (b.pos === 'series') m = mmul(m, [cx(1), z, cx(0), cx(1)])
    else {
      const mag = z.re * z.re + z.im * z.im
      const y = mag < TINY * TINY ? cx(1 / TINY) : cdiv(cx(1), z)
      m = mmul(m, [cx(1), cx(0), y, cx(1)])
    }
  }
  const [A, B, C, D] = m
  const { rs, rl } = l
  const zin = cdiv(cadd(cmul(A, cx(rl)), B), cadd(cmul(C, cx(rl)), D))
  const den = cadd(cadd(cmul(A, cx(rl)), B), cadd(cmul(C, cx(rs * rl)), cmul(D, cx(rs))))
  const s21 = cdiv(cx(2 * Math.sqrt(rs * rl)), den)
  const s11 = cdiv(cadd(zin, cx(-rs)), cadd(zin, cx(rs)))
  return { s21, s11 }
}

const db = (a: number) => 20 * Math.log10(Math.max(a, 1e-12))

export function analyze(l: Ladder, freqs: number[], loss?: Loss): Response {
  const s21: number[] = []
  const s11: number[] = []
  const gd: number[] = []
  const d = 1e-4
  for (const f of freqs) {
    const w = 2 * Math.PI * f
    const p = sParams(l, w, loss)
    s21.push(db(cabs(p.s21)))
    s11.push(db(cabs(p.s11)))
    const a = sParams(l, w * (1 + d), loss).s21
    const b = sParams(l, w * (1 - d), loss).s21
    // arg(a / b) is the phase difference without unwrapping problems.
    const dphi = carg(cdiv(a, b))
    gd.push(-dphi / (2 * d * w))
  }
  return { freqs, s21, s11, gd }
}

export function logSpace(a: number, b: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => a * Math.pow(b / a, i / (n - 1)))
}
export function linSpace(a: number, b: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1))
}
