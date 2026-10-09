/** Nice x ticks: 1-2-5 per decade on a log axis, round steps on a linear one. */
export function xTicks(a: number, b: number, log: boolean): number[] {
  const out: number[] = []
  if (log) {
    for (let e = Math.floor(Math.log10(a)); e <= Math.ceil(Math.log10(b)); e++) {
      for (const m of [1, 2, 5]) {
        const v = m * Math.pow(10, e)
        if (v >= a * 0.999 && v <= b * 1.001) out.push(v)
      }
    }
    return out
  }
  const raw = (b - a) / 8
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  for (let v = Math.ceil(a / step - 1e-9) * step; v <= b * (1 + 1e-9); v += step) out.push(Number(v.toPrecision(12)))
  return out
}

