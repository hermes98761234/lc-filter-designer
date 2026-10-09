import { partRows } from '../lib/export'
import type { Series } from '../lib/eseries'
import { formatSI } from '../lib/format'
import type { Ladder } from '../lib/ladder'
import type { T } from '../i18n'

const fmtErr = (e: number) => `${e > 0 ? '+' : ''}${e.toFixed(1)}%`

export default function PartsTable({ ladder, series, t }: { ladder: Ladder; series: Series; t: T }) {
  const rows = partRows(ladder)
  return (
    <div className="table-wrap">
      <table className="data parts">
        <thead>
          <tr>
            <th>{t('Part')}</th>
            <th>{t('Type')}</th>
            <th>{t('Position')}</th>
            <th className="num">{t('Exact')}</th>
            <th className={`num${series === 'E12' ? ' sel' : ''}`}>E12</th>
            <th className="num">{t('Error')}</th>
            <th className={`num${series === 'E24' ? ' sel' : ''}`}>E24</th>
            <th className="num">{t('Error')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const u = r.type === 'L' ? 'H' : 'F'
            return (
              <tr key={r.ref}>
                <td>
                  <b>{r.ref}</b>
                </td>
                <td>{r.type === 'L' ? t('Inductor') : t('Capacitor')}</td>
                <td>{r.pos === 'series' ? t('Series') : t('Shunt')}</td>
                <td className={`num${series === 'exact' ? ' sel' : ''}`}>{formatSI(r.exact, u)}</td>
                <td className={`num${series === 'E12' ? ' sel' : ''}`}>{formatSI(r.e12, u, 3)}</td>
                <td className="num muted">{fmtErr(r.errE12)}</td>
                <td className={`num${series === 'E24' ? ' sel' : ''}`}>{formatSI(r.e24, u, 3)}</td>
                <td className="num muted">{fmtErr(r.errE24)}</td>
              </tr>
            )
          })}
          <tr>
            <td>
              <b>Rs</b>
            </td>
            <td>{t('Resistor')}</td>
            <td>{t('Source')}</td>
            <td className="num">{formatSI(ladder.rs, 'Ω')}</td>
            <td colSpan={4} />
          </tr>
          <tr>
            <td>
              <b>RL</b>
            </td>
            <td>{t('Resistor')}</td>
            <td>{t('Load')}</td>
            <td className="num">{formatSI(ladder.rl, 'Ω')}</td>
            <td colSpan={4} />
          </tr>
        </tbody>
      </table>
    </div>
  )
}
