import { describe, expect, it } from 'vitest'
import { besselCutoff3dB, besselDelayLadder, besselLadder, butterworthG, butterworthUnequal, chebyshevG, ellipticDesign, ellipticLadder, ellipticMinOrder, ellipticSelectivity, ellipticAttenuation, ladderFromG } from './prototypes'
import { agm, cd, ellipK, ellipKp, kFromNome, nome } from './elliptic'
import { degree, fromRoots, pmul, polyRoots, cx } from './poly'
import { dualLadder } from './synth'

const close = (a: number[], b: number[], tol = 5e-5) => {
  expect(a.length).toBe(b.length)
  a.forEach((v, i) => expect(Math.abs(v - b[i]), `index ${i}: ${v} vs ${b[i]}`).toBeLessThan(tol))
}
const gOf = (els: { l?: number; c?: number }[]) => els.map((e) => e.l ?? e.c!)

describe('Butterworth', () => {
  it('n=3 is 1, 2, 1', () => close(butterworthG(3), [1, 2, 1, 1], 1e-12))
  it('n=5 matches the tables', () => close(butterworthG(5), [0.618034, 1.618034, 2, 1.618034, 0.618034, 1], 1e-6))
  it('generic unequal-termination synthesis reduces to the tables at r -> 1', () => {
    const l = butterworthUnequal(3, 1.0001)
    close(gOf(l.elements), [1, 2, 1], 0.05)
  })
  it('unequal terminations r = 2, n = 3', () => {
    const l = butterworthUnequal(3, 2)
    expect(l.rl).toBeCloseTo(2, 9)
    expect(l.elements[0].kind).toBe('L')
  })
})

describe('Chebyshev', () => {
  it('0.5 dB, n=3: 1.5963, 1.0967, 1.5963', () => close(chebyshevG(3, 0.5), [1.5963, 1.0967, 1.5963, 1], 5e-5))
  it('0.5 dB, n=5', () => close(chebyshevG(5, 0.5), [1.7058, 1.2296, 2.5408, 1.2296, 1.7058, 1], 5e-5))
  it('0.1 dB, n=3', () => close(chebyshevG(3, 0.1), [1.0316, 1.1474, 1.0316, 1], 5e-5))
  it('0.5 dB, n=2 needs a 1.9841 load', () => close(chebyshevG(2, 0.5), [1.4029, 0.7071, 1.9841], 5e-5))
  it('Pi and T have reciprocal loads for even orders', () => {
    const g = chebyshevG(4, 0.5)
    expect(ladderFromG(g, 'pi').rl * ladderFromG(g, 'T').rl).toBeCloseTo(1, 12)
  })
})

describe('Bessel', () => {
  it('delay-normalised n=2', () => close(gOf(besselDelayLadder(2, 'T').elements), [1.5774, 0.4226]))
  it('delay-normalised n=3', () => close(gOf(besselDelayLadder(3, 'T').elements), [1.255, 0.5528, 0.1922]))
  it('delay-normalised n=4', () => close(gOf(besselDelayLadder(4, 'T').elements), [1.0598, 0.5116, 0.3181, 0.1104]))
  it('g values sum to 2 (unit delay between equal terminations)', () => {
    for (const n of [2, 5, 7]) expect(gOf(besselDelayLadder(n, 'pi').elements).reduce((a, b) => a + b, 0)).toBeCloseTo(2, 6)
  })
  it('3 dB normalisation scales by the cutoff', () => {
    const w = besselCutoff3dB(3)
    expect(w).toBeCloseTo(1.7557, 3)
    close(gOf(besselLadder(3, 'T').elements), [1.255 * w, 0.5528 * w, 0.1922 * w], 1e-4)
  })
})

describe('elliptic functions', () => {
  it('K(0) = pi/2 and AGM', () => {
    expect(ellipK(0)).toBeCloseTo(Math.PI / 2, 12)
    expect(agm(1, 2)).toBeCloseTo(1.4567910310469068, 12)
  })
  it('K(1/sqrt2) = 1.8540746773', () => expect(ellipK(Math.SQRT1_2)).toBeCloseTo(1.8540746773013719, 10))
  it('K and K\' are equal at k = 1/sqrt2', () => expect(ellipKp(Math.SQRT1_2)).toBeCloseTo(ellipK(Math.SQRT1_2), 12))
  it('nome round trip', () => {
    for (const k of [0.1, 0.5, 0.9, 0.99]) expect(kFromNome(nome(k))).toBeCloseTo(k, 10)
  })
  it('cd(0) = 1, cd(K) = 0 and cd(u, 0) = cos u', () => {
    expect(cd(0, 0.7)).toBeCloseTo(1, 12)
    expect(cd(ellipK(0.7), 0.7)).toBeCloseTo(0, 12)
    expect(cd(0.8, 1e-4)).toBeCloseTo(Math.cos(0.8), 6)
  })
})

describe('polynomials', () => {
  it('finds roots', () => {
    const p = fromRoots([cx(1), cx(-2), cx(0, 3), cx(0, -3)])
    expect(degree(p)).toBe(4)
    const f = (x: number) => (Math.round(x * 1e6) / 1e6 + 0).toFixed(6)
    const r = polyRoots(p).map((z) => `${f(z.re)},${f(z.im)}`).sort()
    expect(r).toEqual(['-2.000000,0.000000', '0.000000,-3.000000', '0.000000,3.000000', '1.000000,0.000000'])
    expect(pmul([1, 1], [1, -1])).toEqual([1, 0, -1])
  })
})

describe('elliptic ladder', () => {
  it('degree equation: order from specs', () => {
    expect(ellipticMinOrder(0.1, 40, 3.5195104417)).toBe(3)
    expect(ellipticMinOrder(0.1, 40, 3.4)).toBe(4)
    const k = ellipticSelectivity(5, 0.5, 60)
    expect(ellipticAttenuation(5, 0.5, k)).toBeCloseTo(60, 6)
  })
  it('n=3 is symmetric with the expected zero', () => {
    const d = ellipticDesign(3, 0.1, ellipticSelectivity(3, 0.1, 40))
    const l = ellipticLadder(d, 'pi')
    expect(l.rl).toBeCloseTo(1, 8)
    expect(l.elements.map((e) => e.kind)).toEqual(['C', 'LCpar', 'C'])
    expect(l.elements[0].c).toBeCloseTo(l.elements[2].c!, 8)
    // Parallel resonator: 1/sqrt(LC) is the transmission zero.
    const e = l.elements[1]
    expect(1 / Math.sqrt(e.l! * e.c!)).toBeCloseTo(d.stopZeros[0], 8)
    expect(d.stopZeros[0]).toBeCloseTo(4.0429, 3)
  })
  it('all elements are positive and the load is 1 for n = 3..9', () => {
    for (const n of [3, 5, 7, 9]) {
      const d = ellipticDesign(n, 0.2, ellipticSelectivity(n, 0.2, 50))
      for (const t of ['pi', 'T'] as const) {
        const l = ellipticLadder(d, t)
        expect(l.rl, `n=${n}`).toBeCloseTo(1, 4)
        for (const e of l.elements) expect((e.l ?? 1) > 0 && (e.c ?? 1) > 0).toBe(true)
      }
    }
  })
  it('dual of the dual is the original', () => {
    const d = ellipticDesign(5, 0.5, ellipticSelectivity(5, 0.5, 60))
    const a = ellipticLadder(d, 'T')
    const b = dualLadder(dualLadder(a))
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  })
})
