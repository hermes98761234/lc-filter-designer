import type { Params } from '../lib/design'
import { MAX_ORDER } from '../lib/design'
import { FREQ_MULT, FREQ_UNITS, type FreqUnit } from '../lib/format'
import { bandDefaults, type AppState } from '../lib/state'
import { N, type T } from '../i18n'
import NumberField from './NumberField'

interface Props {
  state: AppState
  t: T
  /** Order chosen by the designer (shown in spec mode). */
  order: number | null
  onState: (patch: Partial<AppState>) => void
  onParams: (patch: Partial<Params>) => void
}

const FAMILIES = [
  { v: 'butterworth', label: N('Butterworth') },
  { v: 'chebyshev', label: N('Chebyshev I') },
  { v: 'bessel', label: N('Bessel') },
  { v: 'elliptic', label: N('Elliptic (Cauer)') },
] as const
const BANDS = [
  { v: 'lp', label: N('Lowpass') },
  { v: 'hp', label: N('Highpass') },
  { v: 'bp', label: N('Bandpass') },
  { v: 'bs', label: N('Bandstop') },
] as const

export default function Controls({ state, t, order, onState, onParams }: Props) {
  const { p, fUnit } = state
  const mult = FREQ_MULT[fUnit]
  const isBand = p.band === 'bp' || p.band === 'bs'
  const spec = p.orderMode === 'spec'
  const rippleFam = p.family === 'chebyshev' || p.family === 'elliptic'
  const hz = (label: string, key: 'f1' | 'f2' | 'fs1' | 'fs2') => (
    <NumberField label={label} value={p[key] / mult} suffix={fUnit} onChange={(v) => onParams({ [key]: v * mult })} />
  )
  const setBand = (band: Params['band']) => {
    const ref = isBand ? Math.sqrt(p.f1 * p.f2) : p.f1
    onParams({ band, ...bandDefaults(band, ref) })
  }

  return (
    <div className="panel">
      <div className="section">
        <h3>{t('Filter')}</h3>
        <div className="grid2">
          <div className="field">
            <label>{t('Approximation')}</label>
            <select value={p.family} onChange={(e) => onParams({ family: e.target.value as Params['family'], n: Math.min(p.n, MAX_ORDER[e.target.value as Params['family']]) })}>
              {FAMILIES.map((f) => (
                <option key={f.v} value={f.v}>
                  {t(f.label)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{t('Response')}</label>
            <select value={p.band} onChange={(e) => setBand(e.target.value as Params['band'])}>
              {BANDS.map((f) => (
                <option key={f.v} value={f.v}>
                  {t(f.label)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{t('Ladder')}</label>
            <select value={p.topology} onChange={(e) => onParams({ topology: e.target.value as Params['topology'] })}>
              <option value="pi">{t('Pi (shunt first)')}</option>
              <option value="T">{t('T (series first)')}</option>
            </select>
          </div>
          <div className="field">
            <label>{t('Frequency unit')}</label>
            <select value={fUnit} onChange={(e) => onState({ fUnit: e.target.value as FreqUnit })}>
              {FREQ_UNITS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </div>
          <NumberField label={t('Source impedance')} value={p.z0} suffix="Ω" onChange={(v) => onParams({ z0: v, loadOhm: Math.abs(p.loadOhm / p.z0 - 1) < 1e-6 ? v : p.loadOhm })} />
          <NumberField
            label={t('Load impedance')}
            value={p.family === 'butterworth' ? p.loadOhm : p.z0}
            suffix="Ω"
            disabled={p.family !== 'butterworth'}
            hint={p.family === 'butterworth' ? undefined : t('Only Butterworth supports a load different from the source. Even-order Chebyshev sets its own load.')}
            onChange={(v) => onParams({ loadOhm: v })}
          />
        </div>
        {p.family === 'butterworth' && Math.abs(p.loadOhm / p.z0 - 1) > 1e-6 && (
          <p className="hint">{t('With unequal terminations the ladder starts with the series element when the load is higher, and with the shunt element when it is lower.')}</p>
        )}
      </div>

      <div className="section">
        <h3>{t('Order')}</h3>
        <div className="row seg">
          <button className={!spec ? 'on' : ''} onClick={() => onParams({ orderMode: 'manual' })}>
            {t('Manual')}
          </button>
          <button className={spec ? 'on' : ''} onClick={() => onParams({ orderMode: 'spec' })}>
            {t('From specs')}
          </button>
        </div>
        <div className="grid2">
          {!spec && <NumberField label={t('Order n')} value={p.n} min={1} max={MAX_ORDER[p.family]} onChange={(v) => onParams({ n: Math.round(v) })} />}
          {spec && (
            <div className="field">
              <label>{t('Order needed')}</label>
              <div className="static">{order ?? '–'}</div>
            </div>
          )}
          {(rippleFam || spec) && (
            <NumberField
              label={rippleFam ? t('Passband ripple') : t('Passband attenuation')}
              value={p.ripple}
              suffix="dB"
              onChange={(v) => onParams({ ripple: v })}
            />
          )}
          {(spec || p.family === 'elliptic') && <NumberField label={t('Stopband attenuation')} value={p.atten} suffix="dB" onChange={(v) => onParams({ atten: v })} />}
        </div>
        {p.family === 'elliptic' && <p className="hint">{t('Elliptic ladders use odd orders (3 to 9).')}</p>}
      </div>

      <div className="section">
        <h3>{t('Frequencies')}</h3>
        <div className="grid2">
          {!isBand && hz(spec || rippleFam ? t('Passband edge') : t('Cutoff (-3 dB)'), 'f1')}
          {isBand && hz(spec || rippleFam ? t('Lower passband edge') : t('Lower edge (-3 dB)'), 'f1')}
          {isBand && hz(spec || rippleFam ? t('Upper passband edge') : t('Upper edge (-3 dB)'), 'f2')}
          {spec && !isBand && hz(t('Stopband frequency'), 'fs1')}
          {spec && isBand && hz(t('Lower stopband edge'), 'fs1')}
          {spec && isBand && hz(t('Upper stopband edge'), 'fs2')}
        </div>
        {p.band === 'bs' && spec && <p className="hint">{t('For a bandstop, the band edges are the passband limits and the stopband edges lie between them.')}</p>}
      </div>

      <div className="section">
        <h3>{t('Realisation')}</h3>
        <div className="grid2">
          <div className="field">
            <label>{t('Component values')}</label>
            <select value={state.series} onChange={(e) => onState({ series: e.target.value as AppState['series'] })}>
              <option value="exact">{t('Exact')}</option>
              <option value="E12">E12</option>
              <option value="E24">E24</option>
            </select>
          </div>
          <div className="field">
            <label>{t('Component losses')}</label>
            <label className="check">
              <input type="checkbox" checked={state.useQ} onChange={(e) => onState({ useQ: e.target.checked })} /> {t('Include Q')}
            </label>
          </div>
          {state.useQ && <NumberField label={t('Inductor Q')} value={state.ql} onChange={(v) => onState({ ql: v })} />}
          {state.useQ && <NumberField label={t('Capacitor Q')} value={state.qc} onChange={(v) => onState({ qc: v })} />}
        </div>
        {state.useQ && <p className="hint">{t('Q is applied as a series resistance, fixed at the cutoff (centre) frequency.')}</p>}
      </div>
    </div>
  )
}
