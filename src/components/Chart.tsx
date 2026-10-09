import { useId, useState } from 'react'
import { xTicks } from '../lib/ticks'

export interface Series {
  label: string
  color: string
  dash?: string
  ys: number[]
}

interface Props {
  xs: number[]
  series: Series[]
  log: boolean
  yMin: number
  yMax: number
  yTicks: number[]
  /** Formats a y tick label. */
  yFmt: (v: number) => string
  xFmt: (v: number) => string
  /** Hover text for the sample index. */
  readout: (i: number) => string
  title: string
  height?: number
}

const W = 860
const M = { l: 58, r: 28, t: 12, b: 30 }

export default function Chart({ xs, series, log, yMin, yMax, yTicks, yFmt, xFmt, readout, title, height = 300 }: Props) {
  const clip = useId()
  const [hover, setHover] = useState<number | null>(null)
  const x0 = xs[0]
  const x1 = xs[xs.length - 1]
  const px = (x: number) => M.l + ((log ? Math.log(x / x0) / Math.log(x1 / x0) : (x - x0) / (x1 - x0)) * (W - M.l - M.r))
  const py = (y: number) => M.t + ((yMax - y) / (yMax - yMin)) * (height - M.t - M.b)
  const path = (ys: number[]) => ys.map((y, i) => `${i ? 'L' : 'M'}${px(xs[i]).toFixed(1)},${py(Math.max(yMin - 5, Math.min(yMax + 5, y))).toFixed(1)}`).join('')
  const ticks = xTicks(x0, x1, log)
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const gx = ((e.clientX - r.left) / r.width) * W
    const t = (gx - M.l) / (W - M.l - M.r)
    if (t < 0 || t > 1) return setHover(null)
    let best = 0
    let bd = Infinity
    xs.forEach((v, i) => {
      const d = Math.abs(px(v) - gx)
      if (d < bd) {
        bd = d
        best = i
      }
    })
    setHover(best)
  }
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={title} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <defs>
          <clipPath id={clip}>
            <rect x={M.l} y={M.t} width={W - M.l - M.r} height={height - M.t - M.b} />
          </clipPath>
        </defs>
        <rect x={M.l} y={M.t} width={W - M.l - M.r} height={height - M.t - M.b} className="plot-bg" />
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={py(v)} y2={py(v)} className={v === 0 ? 'grid strong' : 'grid'} />
            <text x={M.l - 6} y={py(v) + 4} textAnchor="end" className="tick">
              {yFmt(v)}
            </text>
          </g>
        ))}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={px(v)} x2={px(v)} y1={M.t} y2={height - M.b} className="grid" />
            <text x={px(v)} y={height - M.b + 16} textAnchor="middle" className="tick">
              {xFmt(v)}
            </text>
          </g>
        ))}
        <g clipPath={`url(#${clip})`}>
          {series.map((s) => (
            <path key={s.label} d={path(s.ys)} fill="none" stroke={s.color} strokeWidth={1.8} strokeDasharray={s.dash} />
          ))}
          {hover !== null && <line x1={px(xs[hover])} x2={px(xs[hover])} y1={M.t} y2={height - M.b} className="cursor" />}
        </g>
        <rect x={M.l} y={M.t} width={W - M.l - M.r} height={height - M.t - M.b} fill="none" className="frame" />
      </svg>
      <div className="legend">
        {series.map((s) => (
          <span key={s.label}>
            <svg width="26" height="8" aria-hidden="true">
              <line x1="0" x2="26" y1="4" y2="4" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} />
            </svg>{' '}
            {s.label}
          </span>
        ))}
        <span className="readout">{hover !== null ? readout(hover) : ' '}</span>
      </div>
    </div>
  )
}
