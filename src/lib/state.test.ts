import { describe, expect, it } from 'vitest'
import { bandDefaults, DEFAULT_STATE, sanitize } from './state'
import { design } from './design'

describe('state', () => {
  it('falls back to defaults for garbage', () => {
    expect(sanitize(null)).toEqual(DEFAULT_STATE)
    expect(sanitize({ lang: 'xx', p: { n: 'a', family: 'foo' }, series: 5 })).toEqual(DEFAULT_STATE)
  })
  it('keeps valid values', () => {
    const s = sanitize({ lang: 'uk', theme: 'dark', series: 'E24', p: { family: 'elliptic', n: 7, f1: 1e3 } })
    expect(s.lang).toBe('uk')
    expect(s.series).toBe('E24')
    expect(s.p.family).toBe('elliptic')
    expect(s.p.n).toBe(7)
    expect(s.p.f1).toBe(1e3)
  })
  it('band defaults produce designs that satisfy the spec checks', () => {
    for (const band of ['lp', 'hp', 'bp', 'bs'] as const) {
      const f = bandDefaults(band, 10e6)
      for (const family of ['butterworth', 'chebyshev', 'elliptic'] as const) {
        const d = design({ ...DEFAULT_STATE.p, ...f, band, family, orderMode: 'spec', ripple: 1, atten: 30 })
        expect(d.n).toBeGreaterThan(0)
      }
    }
  })
})
