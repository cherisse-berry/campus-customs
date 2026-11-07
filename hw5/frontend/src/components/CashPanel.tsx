import type { Cash } from '../api'
import { money } from '../status'

export function CashPanel({ cash }: { cash: Cash | null }) {
  return (
    <section className="panel" aria-labelledby="cash-h">
      <div className="panel-head"><h2 id="cash-h">Cash</h2><span className="muted">as of {cash?.as_of ?? '—'}</span></div>
      <div className="cash-balance">
        <span className="section-label" style={{ margin: 0 }}>Checking</span>
        <strong data-testid="cash-balance">{money(cash?.checking_balance)}</strong>
      </div>
      <p className="section-label" style={{ padding: '0 16px' }}>Still owed</p>
      <ul className="ledger-rows">
        {cash?.payments_due.length === 0 && <li><span className="muted">Nothing owed.</span></li>}
        {cash?.payments_due.map((p) => (
          <li key={`${p.kind}-${p.id}`}>
            <span>{p.payee} {p.overdue ? <span className="tag overdue">Overdue</span> : p.days_until_due <= 7 ? <span className="tag soon">Soon</span> : null}</span>
            <span className="amt">{money(p.amount)}</span>
            <span className="sub">{p.description} · due {p.due_date}</span>
          </li>
        ))}
      </ul>
      {cash && (
        <>
          <div className="cash-total"><span>Left if everything is paid</span><b className="mono">{money(cash.cash_left_if_all_paid)}</b></div>
          <p className="cash-note">{cash.note}</p>
        </>
      )}
    </section>
  )
}
