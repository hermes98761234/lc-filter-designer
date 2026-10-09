/** Real polynomials (ascending coefficients) and minimal complex helpers. */
export type Poly = number[]
export interface Cx {
  re: number
  im: number
}

export const cx = (re: number, im = 0): Cx => ({ re, im })
export const cadd = (a: Cx, b: Cx): Cx => ({ re: a.re + b.re, im: a.im + b.im })
export const csub = (a: Cx, b: Cx): Cx => ({ re: a.re - b.re, im: a.im - b.im })
export const cmul = (a: Cx, b: Cx): Cx => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re })
export const cscale = (a: Cx, k: number): Cx => ({ re: a.re * k, im: a.im * k })
export const cabs = (a: Cx): number => Math.hypot(a.re, a.im)
export const carg = (a: Cx): number => Math.atan2(a.im, a.re)
export const cconj = (a: Cx): Cx => ({ re: a.re, im: -a.im })
export function cdiv(a: Cx, b: Cx): Cx {
  const d = b.re * b.re + b.im * b.im
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }
}
export function csqrt(a: Cx): Cx {
  const m = cabs(a)
  const re = Math.sqrt((m + a.re) / 2)
  const im = Math.sqrt(Math.max(0, (m - a.re) / 2))
  return { re, im: a.im < 0 ? -im : im }
}

/** Drops trailing coefficients smaller than `rel` times the largest one. */
export function trim(p: Poly, rel = 1e-9): Poly {
  const m = Math.max(0, ...p.map(Math.abs))
  let n = p.length
  while (n > 1 && Math.abs(p[n - 1]) <= rel * m) n--
  return p.slice(0, Math.max(n, 1))
}
export const degree = (p: Poly): number => trim(p).length - 1
export const lead = (p: Poly): number => trim(p)[trim(p).length - 1]

export function padd(a: Poly, b: Poly): Poly {
  const n = Math.max(a.length, b.length)
  return Array.from({ length: n }, (_, i) => (a[i] ?? 0) + (b[i] ?? 0))
}
export const pscale = (a: Poly, k: number): Poly => a.map((c) => c * k)
export const psub = (a: Poly, b: Poly): Poly => padd(a, pscale(b, -1))
export function pmul(a: Poly, b: Poly): Poly {
  const r = new Array<number>(a.length + b.length - 1).fill(0)
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) r[i + j] += a[i] * b[j]
  return r
}
/** Multiplies by s^k. */
export const pshift = (a: Poly, k = 1): Poly => [...new Array<number>(k).fill(0), ...a]
/** p(-s). */
export const pneg = (a: Poly): Poly => a.map((c, i) => (i % 2 ? -c : c))

export function peval(p: Poly, x: number): number {
  let r = 0
  for (let i = p.length - 1; i >= 0; i--) r = r * x + p[i]
  return r
}
export function pevalC(p: Poly, z: Cx): Cx {
  let r = cx(0)
  for (let i = p.length - 1; i >= 0; i--) r = cadd(cmul(r, z), cx(p[i]))
  return r
}
export const pderiv = (p: Poly): Poly => p.slice(1).map((c, i) => c * (i + 1))

/** Polynomial long division. Returns quotient and remainder. */
export function pdivmod(a: Poly, b: Poly): [Poly, Poly] {
  const bt = trim(b, 0)
  const r = a.slice()
  const db = bt.length - 1
  if (r.length - 1 < db) return [[0], r]
  const q = new Array<number>(r.length - db).fill(0)
  for (let i = r.length - 1; i >= db; i--) {
    const c = r[i] / bt[db]
    q[i - db] = c
    for (let j = 0; j <= db; j++) r[i - db + j] -= c * bt[j]
    r[i] = 0
  }
  return [q, r.slice(0, Math.max(db, 1))]
}

/** All complex roots (Durand-Kerner, Newton-polished). */
export function polyRoots(pIn: Poly): Cx[] {
  const p = trim(pIn, 0)
  const n = p.length - 1
  if (n < 1) return []
  const a = p.map((c) => c / p[n])
  const bound = 1 + Math.max(...a.slice(0, n).map(Math.abs))
  const r0 = Math.min(bound, Math.max(0.1, Math.pow(Math.abs(a[0]) || 1, 1 / n)))
  let z: Cx[] = Array.from({ length: n }, (_, k) => {
    const ang = (2 * Math.PI * k) / n + 0.4
    return cx(r0 * Math.cos(ang), r0 * Math.sin(ang))
  })
  for (let it = 0; it < 1000; it++) {
    let delta = 0
    z = z.map((zi, i) => {
      let den = cx(1)
      for (let j = 0; j < n; j++) if (j !== i) den = cmul(den, csub(zi, z[j]))
      if (cabs(den) < 1e-300) den = cx(1e-300)
      const step = cdiv(pevalC(a, zi), den)
      delta = Math.max(delta, cabs(step) / (1 + cabs(zi)))
      return csub(zi, step)
    })
    if (delta < 1e-14) break
  }
  const da = pderiv(a)
  return z.map((zi) => {
    let w = zi
    for (let k = 0; k < 4; k++) {
      const d = pevalC(da, w)
      if (cabs(d) < 1e-300) break
      const nw = csub(w, cdiv(pevalC(a, w), d))
      if (cabs(pevalC(a, nw)) > cabs(pevalC(a, w))) break
      w = nw
    }
    return w
  })
}

/** Real polynomial from complex roots that come in conjugate pairs. */
export function fromRoots(roots: Cx[], leadCoef = 1): Poly {
  let p: Cx[] = [cx(leadCoef)]
  for (const r of roots) {
    const next: Cx[] = new Array(p.length + 1).fill(null).map(() => cx(0))
    for (let i = 0; i < p.length; i++) {
      next[i + 1] = cadd(next[i + 1], p[i])
      next[i] = csub(next[i], cmul(p[i], r))
    }
    p = next
  }
  return p.map((c) => c.re)
}
