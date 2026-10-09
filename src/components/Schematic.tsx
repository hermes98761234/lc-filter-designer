import { Fragment } from 'react'
import type { Schematic as Sch } from '../lib/schematic'

export default function Schematic({ sch, label }: { sch: Sch; label: string }) {
  return (
    <div className="schematic">
      <svg viewBox={`0 0 ${sch.width} ${sch.height}`} style={{ width: '100%', maxWidth: sch.width, minWidth: Math.min(sch.width, 760) }} role="img" aria-label={label}>
        {sch.prims.map((p, i) => {
          switch (p.k) {
            case 'line':
              return <polyline key={i} points={p.pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} className="wire" />
            case 'dot':
              return <circle key={i} cx={p.x} cy={p.y} r={2.6} className="dot" />
            case 'circle':
              return <circle key={i} cx={p.x} cy={p.y} r={p.r} className="wire" fill="none" />
            case 'text':
              return (
                <text key={i} x={p.x} y={p.y} textAnchor={p.anchor} className="sch-text">
                  <tspan className="sch-ref">{p.ref}</tspan>
                  {p.val && <Fragment> {p.val}</Fragment>}
                </text>
              )
          }
        })}
      </svg>
    </div>
  )
}
