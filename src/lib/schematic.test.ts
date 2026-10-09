import { describe, expect, it } from 'vitest'
import { design, type Params } from './design'
import { layoutSchematic } from './schematic'
import { formatSI } from './format'

const p: Params = {
  family: 'elliptic', band: 'bp', topology: 'pi', z0: 50, loadOhm: 50, f1: 9e6, f2: 11e6, orderMode: 'manual', n: 5,
  ripple: 0.5, atten: 40, fs1: 7e6, fs2: 14e6,
}

describe('schematic', () => {
  it('draws every component label exactly once', () => {
    for (const band of ['lp', 'hp', 'bp', 'bs'] as const) {
      for (const topology of ['pi', 'T'] as const) {
        const d = design({ ...p, band, topology, f1: band === 'lp' || band === 'hp' ? 10e6 : 9e6 })
        const s = layoutSchematic(d.ladder, (t, _r, v) => formatSI(v, t === 'L' ? 'H' : 'F'), (v) => formatSI(v, 'Ω'))
        const labels = s.prims.filter((x) => x.k === 'text').map((x) => (x.k === 'text' ? x.ref : ''))
        const parts = d.ladder.branches.length
        expect(parts).toBeGreaterThan(0)
        expect(new Set(labels).size).toBe(labels.length)
        expect(labels).toContain('Rs')
        expect(labels).toContain('RL')
        expect(labels.filter((l) => /^[LC]\d+$/.test(l)).length).toBeGreaterThanOrEqual(parts)
        for (const q of s.prims) {
          if (q.k === 'line') for (const [x, y] of q.pts) {
            expect(x).toBeGreaterThanOrEqual(-1)
            expect(x).toBeLessThanOrEqual(s.width)
            expect(y).toBeGreaterThanOrEqual(-1)
            expect(y).toBeLessThanOrEqual(s.height)
          }
        }
      }
    }
  })
})
