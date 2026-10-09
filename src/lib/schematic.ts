/** Ladder schematic layout: pure geometry, rendered to SVG by the UI. */
import { isLeaf, type Ladder, type Node } from './ladder'

export type Prim =
  | { k: 'line'; pts: [number, number][] }
  | { k: 'dot'; x: number; y: number }
  | { k: 'circle'; x: number; y: number; r: number }
  | { k: 'text'; x: number; y: number; anchor: 'start' | 'middle' | 'end'; ref: string; val: string }

export interface Schematic {
  width: number
  height: number
  prims: Prim[]
}

type Map = (x: number, y: number) => [number, number]
interface Box {
  w: number
  h: number
  /** Axis (the wire line through the box) as a distance from the top. */
  yc: number
  draw: (m: Map, ox: number, oy: number, out: Prim[]) => void
}

const SYM = 28
const PAD = 12

export type ValueFormat = (type: 'L' | 'C', ref: string, v: number) => string

function coil(m: Map, x0: number, y: number, out: Prim[]) {
  const pts: [number, number][] = []
  const bumps = 4
  const len = SYM / bumps
  for (let b = 0; b < bumps; b++) {
    for (let i = 0; i <= 8; i++) {
      const a = (Math.PI * i) / 8
      pts.push(m(x0 + b * len + len / 2 - (Math.cos(a) * len) / 2, y - Math.sin(a) * 8))
    }
  }
  out.push({ k: 'line', pts })
}

function layout(n: Node, shunt: boolean, fmt: ValueFormat): Box {
  if (isLeaf(n)) {
    const w = shunt ? 56 : 76
    const h = shunt ? 88 : 46
    const yc = shunt ? 44 : 30
    return {
      w,
      h,
      yc,
      draw: (m, ox, oy, out) => {
        const y = oy + yc
        const cxm = ox + w / 2
        const a = cxm - SYM / 2
        const b = cxm + SYM / 2
        if (n.t === 'L') {
          out.push({ k: 'line', pts: [m(ox, y), m(a, y)] })
          coil(m, a, y, out)
          out.push({ k: 'line', pts: [m(b, y), m(ox + w, y)] })
        } else {
          out.push({ k: 'line', pts: [m(ox, y), m(cxm - 3, y)] })
          out.push({ k: 'line', pts: [m(cxm - 3, y - 10), m(cxm - 3, y + 10)] })
          out.push({ k: 'line', pts: [m(cxm + 3, y - 10), m(cxm + 3, y + 10)] })
          out.push({ k: 'line', pts: [m(cxm + 3, y), m(ox + w, y)] })
        }
        const val = fmt(n.t, n.ref, n.v)
        if (shunt) {
          const [gx, gy] = m(cxm, y)
          out.push({ k: 'text', x: gx + 14, y: gy - 2, anchor: 'start', ref: n.ref, val })
        } else {
          const [gx, gy] = m(cxm, y - 14)
          out.push({ k: 'text', x: gx, y: gy, anchor: 'middle', ref: n.ref, val })
        }
      },
    }
  }
  const kids = n.k.map((c) => layout(c, shunt, fmt))
  if (n.t === 'S') {
    const yc = Math.max(...kids.map((k) => k.yc))
    const below = Math.max(...kids.map((k) => k.h - k.yc))
    const w = kids.reduce((s, k) => s + k.w, 0)
    return {
      w,
      h: yc + below,
      yc,
      draw: (m, ox, oy, out) => {
        let x = ox
        for (const k of kids) {
          k.draw(m, x, oy + yc - k.yc, out)
          x += k.w
        }
      },
    }
  }
  // Parallel: stacked, joined by bars at both ends.
  const tops: number[] = []
  let t = 0
  for (const k of kids) {
    tops.push(t)
    t += k.h
  }
  const inner = Math.max(...kids.map((k) => k.w))
  const w = inner + 2 * PAD
  const yc = kids[0].yc
  return {
    w,
    h: t,
    yc,
    draw: (m, ox, oy, out) => {
      const axes = kids.map((k, i) => oy + tops[i] + k.yc)
      out.push({ k: 'line', pts: [m(ox, axes[0]), m(ox + PAD, axes[0])] })
      out.push({ k: 'line', pts: [m(ox + w - PAD, axes[0]), m(ox + w, axes[0])] })
      out.push({ k: 'line', pts: [m(ox + PAD, axes[0]), m(ox + PAD, axes[axes.length - 1])] })
      out.push({ k: 'line', pts: [m(ox + w - PAD, axes[0]), m(ox + w - PAD, axes[axes.length - 1])] })
      kids.forEach((k, i) => {
        const kx = ox + PAD + (inner - k.w) / 2
        if (kx > ox + PAD) {
          out.push({ k: 'line', pts: [m(ox + PAD, axes[i]), m(kx, axes[i])] })
          out.push({ k: 'line', pts: [m(kx + k.w, axes[i]), m(ox + w - PAD, axes[i])] })
        }
        k.draw(m, kx, oy + tops[i], out)
        if (i > 0) {
          const [lx, ly] = m(ox + PAD, axes[i])
          const [rx, ry] = m(ox + w - PAD, axes[i])
          out.push({ k: 'dot', x: lx, y: ly })
          out.push({ k: 'dot', x: rx, y: ry })
        }
      })
    },
  }
}

function resistor(m: Map, x: number, y: number, len: number, out: Prim[]) {
  const a = x + (len - 30) / 2
  const pts: [number, number][] = [m(x, y), m(a, y)]
  for (let i = 0; i < 6; i++) pts.push(m(a + 2.5 + i * 5, y + (i % 2 ? 7 : -7)))
  pts.push(m(a + 30, y), m(x + len, y))
  out.push({ k: 'line', pts })
}

export function layoutSchematic(l: Ladder, fmt: ValueFormat, fmtR: (v: number) => string): Schematic {
  const prims: Prim[] = []
  const RAIL = 70
  const boxes = l.branches.map((b) => layout(b.node, b.pos === 'shunt', fmt))
  let gnd = RAIL + 60
  l.branches.forEach((b, i) => {
    if (b.pos === 'shunt') gnd = Math.max(gnd, RAIL + boxes[i].w + 24)
    else gnd = Math.max(gnd, RAIL + boxes[i].h - boxes[i].yc + 30)
  })
  // Source: voltage source, then Rs along the rail.
  const srcX = 34
  prims.push({ k: 'line', pts: [[srcX, RAIL], [srcX, (RAIL + gnd) / 2 - 14]] })
  prims.push({ k: 'circle', x: srcX, y: (RAIL + gnd) / 2, r: 14 })
  prims.push({ k: 'line', pts: [[srcX, (RAIL + gnd) / 2 + 14], [srcX, gnd]] })
  prims.push({ k: 'text', x: srcX + 20, y: (RAIL + gnd) / 2 + 4, anchor: 'start', ref: 'Vs', val: '' })
  let x = srcX
  const idm: Map = (px, py) => [px, py]
  resistor(idm, x, RAIL, 90, prims)
  prims.push({ k: 'text', x: x + 45, y: RAIL - 16, anchor: 'middle', ref: 'Rs', val: fmtR(l.rs) })
  x += 90
  l.branches.forEach((b, i) => {
    const bx = boxes[i]
    if (b.pos === 'series') {
      bx.draw(idm, x, RAIL - bx.yc, prims)
      x += bx.w
    } else {
      const cxm = x + bx.h / 2 + 4
      prims.push({ k: 'line', pts: [[x, RAIL], [cxm, RAIL]] })
      prims.push({ k: 'dot', x: cxm, y: RAIL })
      const m: Map = (px, py) => [cxm + (py - bx.yc), RAIL + px]
      bx.draw(m, 0, 0, prims)
      prims.push({ k: 'line', pts: [[cxm, RAIL + bx.w], [cxm, gnd]] })
      prims.push({ k: 'dot', x: cxm, y: gnd })
      prims.push({ k: 'line', pts: [[cxm, RAIL], [x + bx.h + 44, RAIL]] })
      x += bx.h + 44
    }
  })
  // Load.
  const loadX = x + 40
  prims.push({ k: 'line', pts: [[x, RAIL], [loadX, RAIL]] })
  prims.push({ k: 'dot', x: loadX, y: RAIL })
  const vm: Map = (px, py) => [loadX + (py - 0), RAIL + px]
  const rlLen = gnd - RAIL
  resistor(vm, 0, 0, rlLen, prims)
  prims.push({ k: 'text', x: loadX + 14, y: RAIL + rlLen / 2 - 2, anchor: 'start', ref: 'RL', val: fmtR(l.rl) })
  prims.push({ k: 'dot', x: loadX, y: gnd })
  // Ground rail and symbol.
  prims.push({ k: 'line', pts: [[srcX, gnd], [loadX, gnd]] })
  const gx = (srcX + loadX) / 2
  prims.push({ k: 'line', pts: [[gx, gnd], [gx, gnd + 8]] })
  prims.push({ k: 'line', pts: [[gx - 12, gnd + 8], [gx + 12, gnd + 8]] })
  prims.push({ k: 'line', pts: [[gx - 8, gnd + 13], [gx + 8, gnd + 13]] })
  prims.push({ k: 'line', pts: [[gx - 4, gnd + 18], [gx + 4, gnd + 18]] })
  return { width: loadX + 120, height: gnd + 30, prims }
}
