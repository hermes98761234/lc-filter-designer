/** Elliptic integrals and Jacobi functions for real arguments, via the nome and theta series. */

export function agm(a: number, b: number): number {
  for (let i = 0; i < 60 && Math.abs(a - b) > 1e-16 * a; i++) [a, b] = [(a + b) / 2, Math.sqrt(a * b)]
  return a
}
/** Complete elliptic integral of the first kind K(k), modulus k in [0, 1). */
export const ellipK = (k: number): number => Math.PI / (2 * agm(1, Math.sqrt(1 - k * k)))
/** K'(k) = K(sqrt(1 - k^2)). */
export const ellipKp = (k: number): number => Math.PI / (2 * agm(1, k))
/** Nome q = exp(-pi K'/K). */
export const nome = (k: number): number => Math.exp((-Math.PI * ellipKp(k)) / ellipK(k))

function theta2(q: number, z = 0): number {
  let s = 0
  for (let n = 0; n < 200; n++) {
    const t = Math.pow(q, (n + 0.5) * (n + 0.5))
    if (t < 1e-18) break
    s += t * Math.cos((2 * n + 1) * z)
  }
  return 2 * s
}
function theta3(q: number, z = 0): number {
  let s = 0
  for (let n = 1; n < 200; n++) {
    const t = Math.pow(q, n * n)
    if (t < 1e-18) break
    s += t * Math.cos(2 * n * z)
  }
  return 1 + 2 * s
}

/** Modulus k such that nome(k) = q. */
export function kFromNome(q: number): number {
  const r = theta2(q) / theta3(q)
  return r * r
}

/** cd(u, k) = sn(u + K, k) for real u, modulus k. */
export function cd(u: number, k: number): number {
  const q = nome(k)
  const K = ellipK(k)
  const z = (Math.PI * u) / (2 * K)
  return theta2(q, z) / (Math.sqrt(k) * theta3(q, z))
}
