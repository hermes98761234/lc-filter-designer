import { describe, expect, it } from 'vitest'
import { defaultSweep, design, orderFromSpecs, selectivityRatio, DesignError, type Params } from './design'
import { analyze, listParts, logSpace, mapValues, transformLadder } from './ladder'
import { nearest } from './eseries'
import { partRows, toCsv, toSpice } from './export'
import { formatSI, spiceNum } from './format'
import { butterworthLadder, besselCutoff3dB } from './prototypes'

const base: Params = {
  family: 'butterworth',
  band: 'lp',
  topology: 'pi',
  z0: 50,
  loadOhm: 50,
  f1: 10e6,
  f2: 20e6,
  orderMode: 'manual',
  n: 5,
  ripple: 0.5,
  atten: 60,
  fs1: 30e6,
  fs2: 40e6,
}
const P = (o: Partial<Params>): Params => ({ ...base, ...o })
const resp = (d: ReturnType<typeof design>, f: number[]) => analyze(d.ladder, f)
const cheb = (n: number, x: number) => (Math.abs(x) <= 1 ? Math.cos(n * Math.acos(x)) : Math.cosh(n * Math.acosh(Math.abs(x))))

describe('lowpass responses from the ABCD analysis', () => {
  it('Butterworth: |S21|^2 = 1/(1+(f/fc)^2n) for Pi and T', () => {
    for (const topology of ['pi', 'T'] as const) {
      for (const n of [3, 4, 7]) {
        const d = design(P({ topology, n }))
        const f = [1e6, 5e6, 10e6, 15e6, 30e6]
        const r = resp(d, f)
        f.forEach((fi, i) => expect(r.s21[i]).toBeCloseTo(-10 * Math.log10(1 + Math.pow(fi / 10e6, 2 * n)), 6))
      }
    }
  })
  it('Butterworth n=3, 50 ohm, 10 MHz has textbook values', () => {
    const d = design(P({ n: 3, topology: 'pi' }))
    const w = 2 * Math.PI * 10e6
    const parts = listParts(d.ladder)
    expect(parts[0].value).toBeCloseTo(1 / (50 * w), 18)
    expect(parts[1].value).toBeCloseTo((2 * 50) / w, 12)
  })
  it('Chebyshev: |S21|^2 = 1/(1+eps^2 Tn^2) for odd and even order, Pi and T', () => {
    const eps2 = Math.pow(10, 0.5 / 10) - 1
    for (const topology of ['pi', 'T'] as const) {
      for (const n of [3, 4, 5, 6]) {
        const d = design(P({ family: 'chebyshev', topology, n, ripple: 0.5 }))
        const f = [0.5e6, 3e6, 8e6, 10e6, 14e6, 25e6]
        const r = resp(d, f)
        f.forEach((fi, i) => expect(r.s21[i], `n=${n} ${topology} f=${fi}`).toBeCloseTo(-10 * Math.log10(1 + eps2 * cheb(n, fi / 10e6) ** 2), 6))
      }
    }
  })
  it('even Chebyshev needs a different load, with reciprocal values for Pi and T', () => {
    const a = design(P({ family: 'chebyshev', n: 4, topology: 'pi' }))
    const b = design(P({ family: 'chebyshev', n: 4, topology: 'T' }))
    expect(a.ladder.rl * b.ladder.rl).toBeCloseTo(2500, 6)
    expect(a.notes.length).toBe(1)
  })
  it('Butterworth with an unequal load keeps the maximally flat shape', () => {
    for (const load of [100, 25]) {
      const d = design(P({ n: 4, loadOhm: load }))
      const r = Math.max(load / 50, 50 / load)
      const t0 = (4 * r) / (1 + r) ** 2
      const f = [1e6, 7e6, 10e6, 20e6]
      const x = resp(d, f)
      f.forEach((fi, i) => expect(x.s21[i]).toBeCloseTo(10 * Math.log10(t0 / (1 + Math.pow(fi / 10e6, 8))), 6))
      expect(d.ladder.rl).toBeCloseTo(load, 6)
      expect(d.topology).toBe(load > 50 ? 'T' : 'pi')
    }
  })
  it('Bessel: group delay at low frequency is the cutoff-scaled unit delay', () => {
    for (const n of [3, 5]) {
      const d = design(P({ family: 'bessel', n, f1: 1e6 }))
      const r = analyze(d.ladder, [1e3])
      expect(r.gd[0]).toBeCloseTo(besselCutoff3dB(n) / (2 * Math.PI * 1e6), 10)
      // 3 dB point is at the cutoff.
      expect(analyze(d.ladder, [1e6]).s21[0]).toBeCloseTo(-3.0103, 3)
    }
  })
  it('Butterworth is 3.01 dB down at the cutoff and Chebyshev has its ripple edge there', () => {
    expect(analyze(design(P({ n: 6 })).ladder, [10e6]).s21[0]).toBeCloseTo(-3.0103, 3)
    expect(analyze(design(P({ family: 'chebyshev', n: 5, ripple: 1 })).ladder, [10e6]).s21[0]).toBeCloseTo(-1, 6)
  })
})

describe('elliptic', () => {
  it('meets ripple and attenuation, Pi and T', () => {
    for (const topology of ['pi', 'T'] as const) {
      for (const n of [3, 5, 7]) {
        const d = design(P({ family: 'elliptic', topology, n, ripple: 0.25, atten: 50 }))
        const pass = analyze(d.ladder, logSpace(1e5, 10e6, 400))
        expect(Math.min(...pass.s21)).toBeGreaterThan(-0.25 - 1e-5)
        expect(Math.min(...pass.s21)).toBeLessThan(-0.2499)
        const fs = 10e6 * d.elliptic!.xi
        const stop = analyze(d.ladder, logSpace(fs * 1.0001, 200e6, 400))
        expect(Math.max(...stop.s21)).toBeLessThan(-50 + 1e-4)
        expect(Math.max(...stop.s21)).toBeGreaterThan(-50 - 1e-2)
        // Transmission zeros are real nulls.
        for (const z of d.proto.zeros) expect(analyze(d.ladder, [10e6 * z]).s21[0]).toBeLessThan(-150)
      }
    }
  })
  it('uses an odd order and says so', () => {
    const d = design(P({ family: 'elliptic', n: 4, ripple: 0.5, atten: 40 }))
    expect(d.n).toBe(5)
    expect(d.notes.length).toBe(1)
  })
})

describe('band transforms', () => {
  it('highpass: 3 dB at the cutoff and mirrored Butterworth slope', () => {
    const d = design(P({ band: 'hp', n: 5 }))
    const f = [2e6, 5e6, 10e6, 20e6, 100e6]
    const r = resp(d, f)
    f.forEach((fi, i) => expect(r.s21[i]).toBeCloseTo(-10 * Math.log10(1 + Math.pow(10e6 / fi, 10)), 6))
  })
  it('bandpass: 3 dB at both edges, 0 dB at the geometric centre', () => {
    for (const topology of ['pi', 'T'] as const) {
      const d = design(P({ band: 'bp', topology, n: 4, f1: 9e6, f2: 11e6 }))
      const r = analyze(d.ladder, [9e6, Math.sqrt(99e12), 11e6])
      expect(r.s21[0]).toBeCloseTo(-3.0103, 3)
      expect(r.s21[1]).toBeCloseTo(0, 6)
      expect(r.s21[2]).toBeCloseTo(-3.0103, 3)
    }
  })
  it('bandstop: 3 dB at both edges, deep notch at the centre', () => {
    const d = design(P({ band: 'bs', n: 3, f1: 9e6, f2: 11e6 }))
    const r = analyze(d.ladder, [9e6, 11e6, Math.sqrt(99e12), 1e5])
    expect(r.s21[0]).toBeCloseTo(-3.0103, 3)
    expect(r.s21[1]).toBeCloseTo(-3.0103, 3)
    expect(r.s21[2]).toBeLessThan(-100)
    expect(r.s21[3]).toBeCloseTo(0, 3)
  })
  it('elliptic bandpass keeps its notches', () => {
    const d = design(P({ family: 'elliptic', band: 'bp', n: 5, ripple: 0.5, atten: 40, f1: 9e6, f2: 11e6 }))
    const r = analyze(d.ladder, [9.02e6, 10e6, 10.98e6])
    expect(Math.min(...r.s21)).toBeGreaterThan(-0.5 - 1e-4)
    expect(d.ladder.branches.length).toBe(5)
    const edges = analyze(d.ladder, [9e6, 11e6])
    expect(edges.s21[0]).toBeCloseTo(-0.5, 4)
    expect(edges.s21[1]).toBeCloseTo(-0.5, 4)
  })
  it('component values follow the textbook transforms (lowpass, 50 ohm)', () => {
    const l = transformLadder(butterworthLadder(3, 'pi'), { band: 'lp', z0: 50, wc: 2 * Math.PI * 1e6 })
    const p = listParts(l)
    expect(p.map((x) => x.type)).toEqual(['C', 'L', 'C'])
    expect(p[1].value).toBeCloseTo(100 / (2 * Math.PI * 1e6), 12)
  })
})

describe('order from specs', () => {
  const spec = (family: Params['family'], extra: Partial<Params> = {}) => P({ family, orderMode: 'spec', f1: 10e6, fs1: 20e6, ripple: 1, atten: 40, ...extra })
  it('Butterworth', () => {
    const n = Math.ceil(Math.log10((1e4 - 1) / (Math.pow(10, 0.1) - 1)) / (2 * Math.log10(2)))
    expect(orderFromSpecs(spec('butterworth'))).toBe(n)
  })
  it('Chebyshev is smaller than Butterworth and meets the spec', () => {
    const p = spec('chebyshev')
    const n = orderFromSpecs(p)
    expect(n).toBeLessThan(orderFromSpecs(spec('butterworth')))
    const d = design(p)
    expect(analyze(d.ladder, [20e6]).s21[0]).toBeLessThan(-40)
    expect(analyze(d.ladder, [10e6]).s21[0]).toBeCloseTo(-1, 6)
  })
  it('Butterworth hits Ap exactly at the passband edge', () => {
    const d = design(spec('butterworth'))
    expect(analyze(d.ladder, [10e6]).s21[0]).toBeCloseTo(-1, 6)
    expect(analyze(d.ladder, [20e6]).s21[0]).toBeLessThan(-40)
  })
  it('elliptic is the smallest and exceeds the attenuation', () => {
    const p = spec('elliptic')
    const d = design(p)
    expect(d.n).toBeLessThanOrEqual(orderFromSpecs(spec('chebyshev')))
    expect(design(spec('elliptic', { atten: 60, fs1: 12e6 })).n).toBeLessThan(orderFromSpecs(spec('chebyshev', { atten: 60, fs1: 12e6 })))
    expect(analyze(d.ladder, [20e6]).s21[0]).toBeLessThan(-40 + 1e-6)
    expect(Math.min(...analyze(d.ladder, logSpace(1e6, 10e6, 200)).s21)).toBeGreaterThan(-1 - 1e-6)
  })
  it('Bessel meets the spec', () => {
    const p = spec('bessel', { ripple: 3, atten: 20, fs1: 40e6 })
    const d = design(p)
    expect(analyze(d.ladder, [10e6]).s21[0]).toBeCloseTo(-3, 4)
    expect(analyze(d.ladder, [40e6]).s21[0]).toBeLessThan(-20)
  })
  it('highpass and band specs', () => {
    const hp = design(spec('butterworth', { band: 'hp', f1: 10e6, fs1: 5e6 }))
    expect(analyze(hp.ladder, [5e6]).s21[0]).toBeLessThan(-40)
    expect(analyze(hp.ladder, [10e6]).s21[0]).toBeCloseTo(-1, 6)
    const bp = design(spec('chebyshev', { band: 'bp', f1: 9e6, f2: 11e6, fs1: 7e6, fs2: 14e6 }))
    expect(analyze(bp.ladder, [7e6, 14e6]).s21.every((v) => v < -40)).toBe(true)
    const bs = design(spec('chebyshev', { band: 'bs', f1: 8e6, f2: 12e6, fs1: 9.5e6, fs2: 10.5e6 }))
    expect(analyze(bs.ladder, [9.5e6, 10.5e6]).s21.every((v) => v < -40 + 1e-6)).toBe(true)
    expect(analyze(bs.ladder, [8e6, 12e6]).s21.every((v) => v > -1 - 1e-6)).toBe(true)
  })
  it('rejects bad specs', () => {
    expect(() => selectivityRatio(spec('butterworth', { fs1: 5e6 }))).toThrow(DesignError)
    expect(() => orderFromSpecs(spec('butterworth', { atten: 0.5 }))).toThrow(DesignError)
    expect(() => orderFromSpecs(spec('butterworth', { fs1: 10.001e6, atten: 100 }))).toThrow(DesignError)
  })
})

describe('E-series and losses', () => {
  it('rounds to preferred values', () => {
    expect(nearest(4.8e-9, 'E12')).toBe(4.7e-9)
    expect(nearest(5.0e-9, 'E24')).toBe(5.1e-9)
    expect(nearest(9.8e-6, 'E12')).toBe(10e-6)
    expect(nearest(0.99e-12, 'E24')).toBe(1e-12)
    expect(nearest(123, 'exact')).toBe(123)
  })
  it('rounded parts change the response and lossy parts add insertion loss', () => {
    const d = design(P({ n: 5, f1: 10e6 }))
    const rounded = mapValues(d.ladder, (_t, v) => nearest(v, 'E12'))
    const f = [8e6]
    const a = analyze(d.ladder, f).s21[0]
    const b = analyze(rounded, f).s21[0]
    expect(Math.abs(a - b)).toBeGreaterThan(1e-4)
    const lossy = analyze(d.ladder, f, { ql: 30, qc: 100, wref: 2 * Math.PI * 10e6 }).s21[0]
    expect(lossy).toBeLessThan(a - 0.5)
    expect(analyze(d.ladder, f, { ql: Infinity, qc: 0, wref: 1 }).s21[0]).toBeCloseTo(a, 12)
  })
})

describe('exports', () => {
  const d = design(P({ family: 'elliptic', n: 3, ripple: 0.5, atten: 40 }))
  it('CSV has one row per part plus the terminations', () => {
    const rows = partRows(d.ladder)
    const lines = toCsv(d.ladder).trim().split('\n')
    expect(lines.length).toBe(1 + rows.length + 2)
    expect(lines[0].startsWith('Ref,Type')).toBe(true)
    expect(rows.length).toBe(4)
  })
  it('SPICE netlist is well formed', () => {
    const net = toSpice(d.ladder, { title: 'test', fmin: 1e5, fmax: 1e8 })
    expect(net).toContain('Vs vs 0 AC 1')
    expect(net).toContain('.ac dec 100 100k 100MEG')
    expect(net.trim().endsWith('.end')).toBe(true)
    expect(net.match(/^C\d+ /gm)?.length).toBe(3)
    expect(net.match(/^L\d+ /gm)?.length).toBe(1)
    const lossy = toSpice(d.ladder, { title: 't', fmin: 1, fmax: 2, loss: { ql: 50, qc: 200, wref: 1e7 } })
    expect(lossy.match(/^Resr/gm)?.length).toBe(4)
  })
  it('formats engineering values', () => {
    expect(formatSI(4.7e-9, 'H')).toBe('4.7 nH')
    expect(formatSI(1.2345e-6, 'H', 3)).toBe('1.23 µH')
    expect(formatSI(100e-12, 'F')).toBe('100 pF')
    expect(spiceNum(2.2e6)).toBe('2.2MEG')
    expect(spiceNum(4.7e-9)).toBe('4.7n')
  })
  it('default sweep brackets the band', () => {
    const s = defaultSweep(design(P({ band: 'bp', n: 3, f1: 9e6, f2: 11e6 })))
    expect(s.fmin).toBeLessThan(9e6)
    expect(s.fmax).toBeGreaterThan(11e6)
  })
})
