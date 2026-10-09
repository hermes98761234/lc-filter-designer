/** Engineering-notation formatting. */
const PREFIX: [number, string][] = [
  [1e12, 'T'],
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p'],
  [1e-15, 'f'],
]

/** Splits a value into a scaled mantissa and SI prefix. */
export function siParts(v: number): { m: number; prefix: string } {
  if (v === 0 || !isFinite(v)) return { m: v, prefix: '' }
  const a = Math.abs(v)
  for (const [f, p] of PREFIX) if (a >= f * 0.9995) return { m: v / f, prefix: p }
  return { m: v / 1e-15, prefix: 'f' }
}

export function trimNum(m: number, digits: number): string {
  return String(Number(m.toPrecision(digits)))
}

/** 4.7e-9 -> "4.7 n" with the unit appended: formatSI(4.7e-9, 'H') = "4.7 nH". */
export function formatSI(v: number, unit: string, digits = 4): string {
  const { m, prefix } = siParts(v)
  return `${trimNum(m, digits)} ${prefix}${unit}`
}

/** Plain value for netlists: 4.7e-9 -> "4.7n" (SPICE: M is milli, so use MEG for mega). */
export function spiceNum(v: number, digits = 6): string {
  const map: Record<string, string> = { T: 'T', G: 'G', M: 'MEG', k: 'k', '': '', m: 'm', µ: 'u', n: 'n', p: 'p', f: 'f' }
  const { m, prefix } = siParts(v)
  return `${trimNum(m, digits)}${map[prefix]}`
}

export const FREQ_UNITS = ['Hz', 'kHz', 'MHz', 'GHz'] as const
export type FreqUnit = (typeof FREQ_UNITS)[number]
export const FREQ_MULT: Record<FreqUnit, number> = { Hz: 1, kHz: 1e3, MHz: 1e6, GHz: 1e9 }
