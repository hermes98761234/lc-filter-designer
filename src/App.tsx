import { useCallback, useEffect, useMemo, useState } from 'react'
import { defaultSweep, design, DesignError, orderFromSpecs, type Design, type Params } from './lib/design'
import { nearest } from './lib/eseries'
import { toCsv, toSpice } from './lib/export'
import { formatSI, FREQ_MULT } from './lib/format'
import { analyze, linSpace, logSpace, mapValues, type Loss, type Response } from './lib/ladder'
import { layoutSchematic } from './lib/schematic'
import { loadState, saveState, type AppState } from './lib/state'
import { N, tr, type T } from './i18n'
import Chart, { type Series } from './components/Chart'
import Controls from './components/Controls'
import PartsTable from './components/PartsTable'
import Schematic from './components/Schematic'

const FAMILY_NAME = {
  butterworth: N('Butterworth'),
  chebyshev: N('Chebyshev I'),
  bessel: N('Bessel'),
  elliptic: N('Elliptic (Cauer)'),
}
const BAND_NAME = { lp: N('Lowpass'), hp: N('Highpass'), bp: N('Bandpass'), bs: N('Bandstop') }
const POINTS = 561

function niceTicks(min: number, max: number, count: number): number[] {
  const raw = (max - min) / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const out: number[] = []
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) out.push(Number(v.toPrecision(12)))
  return out
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

type Computed = { ok: true; d: Design; order: number | null } | { ok: false; error: unknown; order: number | null }

function compute(p: Params): Computed {
  let order: number | null = null
  try {
    if (p.orderMode === 'spec') order = orderFromSpecs(p)
  } catch {
    order = null
  }
  try {
    return { ok: true, d: design(p), order }
  } catch (error) {
    return { ok: false, error, order }
  }
}

const dbFmt = (v: number) => `${v.toFixed(1)} dB`

export default function App() {
  const [state, setState] = useState<AppState>(loadState)
  const [copied, setCopied] = useState(false)
  const { p, lang, theme } = state
  const t: T = useCallback((s, ...a) => tr(lang, s, ...a), [lang])
  const update = (patch: Partial<AppState>) => setState((s) => ({ ...s, ...patch }))
  const updateP = (patch: Partial<Params>) => setState((s) => ({ ...s, p: { ...s.p, ...patch } }))

  useEffect(() => saveState(state), [state])
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'auto') delete root.dataset.theme
    else root.dataset.theme = theme
    root.lang = lang
  }, [theme, lang])

  const res = useMemo(() => compute(p), [p])
  const d = res.ok ? res.d : null

  const view = useMemo(() => {
    if (!d) return null
    const sw = defaultSweep(d)
    let fmin = state.plotMin > 0 ? state.plotMin : sw.fmin
    let fmax = state.plotMax > 0 ? state.plotMax : sw.fmax
    if (!(fmax > fmin)) {
      fmin = sw.fmin
      fmax = sw.fmax
    }
    const log = state.xscale === 'auto' ? sw.log : state.xscale === 'log'
    const freqs = log ? logSpace(fmin, fmax, POINTS) : linSpace(fmin, fmax, POINTS)
    const real = mapValues(d.ladder, (_ty, v) => nearest(v, state.series))
    const loss: Loss | undefined = state.useQ ? { ql: state.ql, qc: state.qc, wref: 2 * Math.PI * d.fRef } : undefined
    const ideal = analyze(d.ladder, freqs)
    const lossy = state.series !== 'exact' || state.useQ ? analyze(real, freqs, loss) : null
    return { fmin, fmax, log, freqs, real, loss, ideal, lossy }
  }, [d, state.plotMin, state.plotMax, state.xscale, state.series, state.useQ, state.ql, state.qc])

  const sch = useMemo(() => {
    if (!view) return null
    return layoutSchematic(
      view.real,
      (ty, _ref, v) => formatSI(v, ty === 'L' ? 'H' : 'F', 3),
      (v) => formatSI(v, 'Ω', 4),
    )
  }, [view])

  const spice = useMemo(() => {
    if (!d || !view) return ''
    const title = `${t(FAMILY_NAME[p.family])} ${t(BAND_NAME[p.band])}, n=${d.n}, ${d.topology === 'T' ? 'T' : 'Pi'}, ${formatSI(d.params.z0, 'Ω')}`
    return toSpice(view.real, { title, fmin: view.fmin, fmax: view.fmax, loss: view.loss })
  }, [d, view, t, p.family, p.band])

  const errorText = !res.ok
    ? res.error instanceof DesignError
      ? t(res.error.message, ...res.error.args)
      : t('Error: {0}', res.error instanceof Error ? res.error.message : String(res.error))
    : null

  const specRows = useMemo(() => {
    if (!d || !view || p.orderMode !== 'spec') return []
    const isBand = p.band === 'bp' || p.band === 'bs'
    const pts: { label: string; f: number; kind: 'pass' | 'stop' }[] = [
      { label: isBand ? t('Lower passband edge') : t('Passband edge'), f: p.f1, kind: 'pass' },
      ...(isBand ? [{ label: t('Upper passband edge'), f: p.f2, kind: 'pass' as const }] : []),
      { label: isBand ? t('Lower stopband edge') : t('Stopband frequency'), f: p.fs1, kind: 'stop' },
      ...(isBand ? [{ label: t('Upper stopband edge'), f: p.fs2, kind: 'stop' as const }] : []),
    ]
    const r = analyze(view.real, pts.map((x) => x.f), view.loss)
    return pts.map((x, i) => {
      const att = -r.s21[i]
      const ok = x.kind === 'pass' ? att <= p.ripple + 0.005 : att >= p.atten - 0.005
      return { ...x, att, ok }
    })
  }, [d, view, p, t])

  const mult = FREQ_MULT[state.fUnit]
  const fFmt = (v: number) => formatSI(v, 'Hz', 4)
  const xFmt = (v: number) => formatSI(v, 'Hz', 3)

  const charts = useMemo(() => {
    if (!view) return null
    const all = [...view.ideal.s21, ...(view.lossy?.s21 ?? [])]
    const lo = Math.min(...all)
    const floor = Math.min(120, Math.max(40, Math.ceil(-Math.max(lo, -120) / 10) * 10))
    const yMin = -floor
    const yTicks = niceTicks(yMin, 0, floor > 80 ? 6 : 8)
    const series: Series[] = [
      { label: t('S21 (ideal)'), color: 'var(--c-s21)', ys: view.ideal.s21 },
      { label: t('S11 (ideal)'), color: 'var(--c-s11)', dash: '5 3', ys: view.ideal.s11 },
    ]
    if (view.lossy) {
      series.push({ label: t('S21 (realised)'), color: 'var(--c-s21b)', ys: view.lossy.s21 })
      series.push({ label: t('S11 (realised)'), color: 'var(--c-s11b)', dash: '5 3', ys: view.lossy.s11 })
    }
    const gdAll = view.ideal.gd.filter((v) => isFinite(v))
    const sorted = gdAll.slice().sort((x, y) => x - y)
    const pct = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))] ?? 0
    // Robust range: nulls at transmission zeros give meaningless delay spikes.
    const gMax = Math.max(pct(0.995), 1e-12)
    const gMin = Math.min(0, pct(0.01))
    const unitIdx = gMax >= 1 ? 0 : gMax >= 1e-3 ? 1 : gMax >= 1e-6 ? 2 : 3
    const [scale, unit] = [[1, 's'], [1e3, 'ms'], [1e6, 'µs'], [1e9, 'ns']][unitIdx] as [number, string]
    const top = gMax * scale * 1.08
    const bottom = gMin * scale * 1.08
    const gTicks = niceTicks(bottom, top, 5)
    const gTop = Math.max(top, gTicks[gTicks.length - 1] ?? top)
    const toScaled = (r: Response) => r.gd.map((v) => v * scale)
    const gSeries: Series[] = [{ label: t('Group delay (ideal)'), color: 'var(--c-s21)', ys: toScaled(view.ideal) }]
    if (view.lossy) gSeries.push({ label: t('Group delay (realised)'), color: 'var(--c-s21b)', ys: toScaled(view.lossy) })
    const rd = (i: number) => {
      const parts = [fFmt(view.freqs[i]), `S21 ${dbFmt(view.ideal.s21[i])}`, `S11 ${dbFmt(view.ideal.s11[i])}`]
      if (view.lossy) parts.push(`${t('realised')}: S21 ${dbFmt(view.lossy.s21[i])}, S11 ${dbFmt(view.lossy.s11[i])}`)
      parts.push(`${t('delay')} ${formatSI(view.ideal.gd[i], 's', 3)}`)
      return parts.join('   ')
    }
    return { yMin, yTicks, series, gSeries, gTicks, gTop, gBottom: Math.min(bottom, gTicks[0] ?? bottom), unit, rd }
  }, [view, t])

  const summary = d && (
    <dl className="facts">
      <div>
        <dt>{t('Approximation')}</dt>
        <dd>{t(FAMILY_NAME[p.family])}</dd>
      </div>
      <div>
        <dt>{t('Response')}</dt>
        <dd>{t(BAND_NAME[p.band])}</dd>
      </div>
      <div>
        <dt>{t('Order n')}</dt>
        <dd>{d.n}</dd>
      </div>
      <div>
        <dt>{t('Ladder')}</dt>
        <dd>{d.topology === 'T' ? t('T (series first)') : t('Pi (shunt first)')}</dd>
      </div>
      <div>
        <dt>{t('Terminations')}</dt>
        <dd>
          {formatSI(d.ladder.rs, 'Ω')} / {formatSI(d.ladder.rl, 'Ω', 4)}
        </dd>
      </div>
      <div>
        <dt>{d.f0 === undefined ? t('Prototype edge') : t('Centre frequency')}</dt>
        <dd>{fFmt(d.fRef)}</dd>
      </div>
      {d.bwHz !== undefined && (
        <div>
          <dt>{t('Bandwidth')}</dt>
          <dd>{fFmt(d.bwHz)}</dd>
        </div>
      )}
      {d.elliptic && (
        <>
          <div>
            <dt>{t('Stopband attenuation')}</dt>
            <dd>{d.elliptic.stopAtten.toFixed(1)} dB</dd>
          </div>
          <div>
            <dt>{t('Stopband / passband edge')}</dt>
            <dd>{d.elliptic.xi.toFixed(3)}</dd>
          </div>
          <div>
            <dt>{t('Transmission zeros (prototype)')}</dt>
            <dd>{d.elliptic.stopZeros.map((z) => z.toFixed(3)).join(', ')}</dd>
          </div>
        </>
      )}
    </dl>
  )

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">{t('LC filter designer')}</span>
        <span className="hint grow">{t('Butterworth, Chebyshev, Bessel and elliptic ladders, with E-series parts, losses and a SPICE netlist.')}</span>
        <label className="inline">
          {t('Language')}
          <select value={lang} onChange={(e) => update({ lang: e.target.value as AppState['lang'] })}>
            <option value="en">English</option>
            <option value="uk">Українська</option>
          </select>
        </label>
        <label className="inline">
          {t('Theme')}
          <select value={theme} onChange={(e) => update({ theme: e.target.value as AppState['theme'] })}>
            <option value="auto">{t('System')}</option>
            <option value="light">{t('Light')}</option>
            <option value="dark">{t('Dark')}</option>
          </select>
        </label>
      </header>
      <div className="body">
        <aside className="side">
          <Controls state={state} t={t} order={res.order} onState={update} onParams={updateP} />
        </aside>
        <main className="main">
          {errorText && <div className="box error" role="alert">{errorText}</div>}
          {d && view && sch && charts && (
            <>
              <section className="box">
                <h3>{t('Design')}</h3>
                {summary}
                {d.notes.map((n, i) => (
                  <p key={i} className="hint note">{t(n.msg, ...n.args)}</p>
                ))}
                {specRows.length > 0 && (
                  <table className="data spec">
                    <tbody>
                      {specRows.map((r) => (
                        <tr key={r.label}>
                          <td>{r.label}</td>
                          <td className="num">{fFmt(r.f)}</td>
                          <td className="num">
                            {r.att.toFixed(2)} dB {r.kind === 'pass' ? '≤' : '≥'} {(r.kind === 'pass' ? p.ripple : p.atten).toFixed(2)} dB
                          </td>
                          <td className={r.ok ? 'ok-text' : 'err-text'}>{r.ok ? t('meets spec') : t('misses spec')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
              <section className="box">
                <h3>{t('Schematic')}</h3>
                <Schematic sch={sch} label={t('Ladder schematic')} />
              </section>
              <section className="box">
                <h3>{t('Response')}</h3>
                <Chart
                  xs={view.freqs}
                  series={charts.series}
                  log={view.log}
                  yMin={charts.yMin}
                  yMax={0}
                  yTicks={charts.yTicks}
                  yFmt={(v) => String(v)}
                  xFmt={xFmt}
                  readout={charts.rd}
                  title={t('S21 and S11 in dB')}
                />
                <p className="axis-label">{t('dB')}</p>
                <Chart
                  xs={view.freqs}
                  series={charts.gSeries}
                  log={view.log}
                  yMin={charts.gBottom}
                  yMax={charts.gTop}
                  yTicks={charts.gTicks}
                  yFmt={(v) => `${Number(v.toPrecision(3))}`}
                  xFmt={xFmt}
                  readout={charts.rd}
                  title={t('Group delay')}
                  height={220}
                />
                <p className="axis-label">{t('Group delay')} ({charts.unit})</p>
                <div className="row plot-range">
                  <label className="inline">
                    {t('Plot from')}
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder={t('auto')}
                      defaultValue={state.plotMin ? String(state.plotMin / mult) : ''}
                      key={`min${state.fUnit}`}
                      onChange={(e) => update({ plotMin: Math.max(0, Number(e.target.value.replace(',', '.')) * mult) || 0 })}
                    />
                  </label>
                  <label className="inline">
                    {t('to')}
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder={t('auto')}
                      defaultValue={state.plotMax ? String(state.plotMax / mult) : ''}
                      key={`max${state.fUnit}`}
                      onChange={(e) => update({ plotMax: Math.max(0, Number(e.target.value.replace(',', '.')) * mult) || 0 })}
                    />
                    {state.fUnit}
                  </label>
                  <label className="inline">
                    {t('Frequency axis')}
                    <select value={state.xscale} onChange={(e) => update({ xscale: e.target.value as AppState['xscale'] })}>
                      <option value="auto">{t('Auto')}</option>
                      <option value="log">{t('Logarithmic')}</option>
                      <option value="linear">{t('Linear')}</option>
                    </select>
                  </label>
                </div>
              </section>
              <section className="box">
                <h3>{t('Components')}</h3>
                <PartsTable ladder={d.ladder} series={state.series} t={t} />
                <p className="hint">{t('Rounding changes the response: pick E12 or E24 under Realisation to see it plotted against the ideal curves.')}</p>
              </section>
              <section className="box">
                <h3>{t('Export')}</h3>
                <div className="row">
                  <button onClick={() => download('lc-filter-components.csv', toCsv(d.ladder), 'text/csv')}>{t('Download component list (CSV)')}</button>
                  <button onClick={() => download('lc-filter.cir', spice, 'text/plain')}>{t('Download SPICE netlist')}</button>
                  <button
                    onClick={() => {
                      void navigator.clipboard?.writeText(spice).then(() => {
                        setCopied(true)
                        setTimeout(() => setCopied(false), 1500)
                      })
                    }}
                  >
                    {copied ? t('Copied') : t('Copy netlist')}
                  </button>
                </div>
                <p className="hint">{t('The netlist uses the component values selected under Realisation, with series resistance for the Q if enabled.')}</p>
                <details>
                  <summary>{t('Show netlist')}</summary>
                  <pre className="netlist">{spice}</pre>
                </details>
              </section>
            </>
          )}
        </main>
      </div>
      <p className="hint foot">
        {t('Everything runs in your browser. Results come from an ABCD-matrix analysis of the actual ladder.')}{' '}
        <a href="https://github.com/hermes98761234/lc-filter-designer">{t('Source on GitHub')}</a>
      </p>
    </div>
  )
}
