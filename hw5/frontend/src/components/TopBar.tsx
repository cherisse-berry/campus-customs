import { useEffect, useRef, useState } from 'react'
import { API_URL, type Health } from '../api'
import { money } from '../status'
import { shopDate } from './common'

export function TopBar({ health, online, today, balance }: {
  health: Health | null; online: boolean; today: string | null; balance: number | null
}) {
  const previous = useRef<number | null>(null)
  const [delta, setDelta] = useState<number | null>(null)
  useEffect(() => {
    if (balance != null && previous.current != null && balance !== previous.current) {
      setDelta(balance - previous.current)
      const t = setTimeout(() => setDelta(null), 4000)
      previous.current = balance
      return () => clearTimeout(t)
    }
    previous.current = balance
  }, [balance])

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">CC</div>
        <div>
          <h1>Campus Customs Desk</h1>
          <p>Back-office agents for the Chapel Street shop</p>
        </div>
      </div>
      <div className="topbar-meta">
        <div className="meta-item"><small>Shop date</small><span>{shopDate(today)}</span></div>
        <div className="meta-item"><small>Model</small><span className="mono">{health?.model ?? '—'}</span></div>
        <div className="meta-item">
          <small>Backend</small>
          <span className="conn" title={API_URL}><span className={`dot${online ? '' : ' off'}`} />{online ? 'Connected' : 'Offline'}</span>
        </div>
        <div className={`ledger${delta != null ? ' changed' : ''}`} aria-live="polite" data-testid="checking-balance">
          <small>Checking balance</small>
          <strong>{money(balance)}</strong>
          {delta != null && <span className="delta">{delta < 0 ? '−' : '+'}{money(Math.abs(delta))}</span>}
        </div>
      </div>
    </header>
  )
}
