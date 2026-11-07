import './Thermometer.css'

interface Props {
  usd: number
  budget: number
  label?: string
  accent?: string
  size?: 'sm' | 'lg'
  blown?: boolean
}

export function fmtUsd(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.01) return `$${usd.toFixed(5)}`
  if (usd < 1) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

/** Dollar thermometer: fills as spend / budget (the unit is dollars, not degrees). */
export function Thermometer({ usd, budget, label, accent = '#e63946', size = 'sm', blown = false }: Props) {
  const frac = budget > 0 ? Math.min(usd / budget, 1) : 0
  // Keep any nonzero spend visible as at least a sliver.
  const pct = usd > 0 ? Math.max(frac * 100, 3) : 0
  const ticks = size === 'lg' ? [0.25, 0.5, 0.75, 1] : [0.5]
  return (
    <div
      className={`thermo ${size}${blown ? ' blown' : ''}${frac >= 0.8 ? ' hot' : ''}`}
      style={{ ['--accent' as string]: accent }}
      title={`${label ?? 'Spend'}: ${fmtUsd(usd)} of $${budget.toFixed(2)} budget`}
    >
      <div className="thermo-tube">
        <div className="thermo-fill" style={{ height: `${pct}%` }} />
        {ticks.map((t) => (
          <span key={t} className="thermo-tick" style={{ bottom: `${t * 100}%` }}>
            {size === 'lg' && <em>${(budget * t).toFixed(2)}</em>}
          </span>
        ))}
      </div>
      <div className="thermo-bulb" />
      <div className="thermo-readout">
        {size === 'lg' && label && <strong>{label}</strong>}
        <span>{fmtUsd(usd)}</span>
      </div>
    </div>
  )
}
