import { useState } from 'react'

interface Props {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  /** Value 0 means "automatic" and is shown blank. */
  blankZero?: boolean
  suffix?: string
  hint?: string
  disabled?: boolean
}

const fmt = (v: number, blankZero?: boolean) => (blankZero && v === 0 ? '' : String(Number(v.toPrecision(10))))

/** Numeric text input that keeps what you type and commits whenever it parses to a valid number. */
export default function NumberField({ label, value, onChange, min = 0, max = Infinity, blankZero, suffix, hint, disabled }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const txt = draft ?? fmt(value, blankZero)
  const parsed = txt.trim() === '' ? (blankZero ? 0 : NaN) : Number(txt.replace(',', '.'))
  const ok = isFinite(parsed) && (blankZero && parsed === 0 ? true : parsed > 0 && parsed >= min && parsed <= max)
  return (
    <div className="field">
      <label>{label}</label>
      <div className="with-suffix">
        <input
          type="text"
          inputMode="decimal"
          value={txt}
          disabled={disabled}
          className={ok ? '' : 'bad'}
          aria-invalid={!ok}
          title={hint}
          onChange={(e) => {
            const s = e.target.value
            setDraft(s)
            const v = s.trim() === '' ? (blankZero ? 0 : NaN) : Number(s.replace(',', '.'))
            if (isFinite(v) && ((blankZero && v === 0) || (v > 0 && v >= min && v <= max))) onChange(v)
          }}
          onBlur={() => setDraft(null)}
        />
        {suffix && <span className="suffix">{suffix}</span>}
      </div>
    </div>
  )
}
