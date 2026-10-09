/** Preferred-value (E-series) rounding. */
export type Series = 'exact' | 'E12' | 'E24'

export const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2]
export const E24 = [
  1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1,
]

/** Nearest preferred value (by ratio) in the given series. */
export function nearest(value: number, series: Series): number {
  if (series === 'exact' || !(value > 0)) return value
  const base = series === 'E12' ? E12 : E24
  const dec = Math.floor(Math.log10(value))
  let best = value
  let bestErr = Infinity
  for (let e = dec - 1; e <= dec + 1; e++) {
    for (const b of base) {
      const c = b * Math.pow(10, e)
      const err = Math.abs(Math.log(c / value))
      if (err < bestErr) {
        bestErr = err
        best = c
      }
    }
  }
  // Remove binary noise (3.3 * 10^-9 etc.).
  return Number(best.toPrecision(3))
}
