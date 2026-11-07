import { useEffect, useState } from 'react'
import { ApiError, api, type Approval, type DecidedApproval } from '../api'
import { money } from '../status'

function useApproverName(): [string, (v: string) => void] {
  const [name, setName] = useState(() => {
    try { return localStorage.getItem('cc-approver') ?? '' } catch { return '' }
  })
  const save = (v: string) => {
    setName(v)
    try { localStorage.setItem('cc-approver', v) } catch { /* storage unavailable */ }
  }
  return [name, save]
}

function Warnings({ warnings, checked, onToggle }: { warnings: string[]; checked: Set<string>; onToggle: (w: string) => void }) {
  if (!warnings.length) return null
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {warnings.map((w) => (
        <label key={w} className="warning">
          <input type="checkbox" checked={checked.has(w)} onChange={() => onToggle(w)} aria-label={`I've read this warning: ${w}`} />
          <span><b>Warning.</b> {w}</span>
        </label>
      ))}
      <span className="effect">Tick each warning to confirm you've read it before approving.</span>
    </div>
  )
}

function dueText(days: number) {
  return days < 0 ? `${-days} days overdue` : days === 0 ? 'due today' : `due in ${days} days`
}

function ApprovalCard({ a, approver, highlight, onDone }: {
  a: Approval; approver: string; highlight: boolean; onDone: (message: string) => void
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [percent, setPercent] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const warnings = a.review?.warnings ?? []
  useEffect(() => { setChecked(new Set()) }, [warnings.join('|')])
  const toggle = (w: string) => setChecked((s) => { const n = new Set(s); if (n.has(w)) n.delete(w); else n.add(w); return n })
  const allChecked = warnings.every((w) => checked.has(w))
  const blocked = a.approval_type === 'payment' && a.review ? !a.review.can_approve : false
  const pct = Number(percent)
  const percentOk = a.approval_type !== 'discount' || (percent.trim() !== '' && pct >= 0 && pct < 100)
  const canApprove = !!approver.trim() && allChecked && !blocked && percentOk && !saving

  async function submit(decision: 'approve' | 'reject') {
    setSaving(true); setError(null)
    try {
      const res = await api.decide(a.approval_id, {
        decision, decided_by: approver.trim(), confirmed_warnings: [...checked], note,
        ...(a.approval_type === 'discount' && decision === 'approve' ? { discount_percent: pct } : {}),
      })
      if (decision === 'reject') onDone(`Request ${a.approval_id} rejected and recorded.`)
      else if (a.approval_type === 'payment') {
        const p = res.payment as { amount: number; payee: string; balance_after: number }
        onDone(`Paid ${money(p.amount)} to ${p.payee}. Checking balance is now ${money(p.balance_after)}.`)
      } else if (a.approval_type === 'purchase') onDone('Purchase approval recorded. No order was placed, no vendor was contacted and no money moved.')
      else onDone(`Discount of ${pct}% recorded. Nothing was sent to the customer.`)
    } catch (e) {
      const body = e instanceof ApiError ? e.body : {}
      const extra = Array.isArray(body.unconfirmed) ? ` Unconfirmed: ${(body.unconfirmed as string[]).join(' ')}` : ''
      setError((e instanceof Error ? e.message : String(e)) + extra)
      onDone('')
    } finally { setSaving(false) }
  }

  return (
    <article className={`approval${highlight ? ' highlight' : ''}`} data-testid={`approval-${a.approval_type}`} aria-label={`${a.approval_type} request ${a.approval_id}`}>
      <div className="approval-head">
        <span className={`kind ${a.approval_type}`}>{a.approval_type}</span>
        <span className="muted">Ticket #{a.ticket_id} · <span className="mono">{a.approval_id}</span></span>
      </div>
      <div className="approval-body">
        {a.approval_type === 'payment' && (() => {
          const r = a.request, v = a.review
          return (
            <>
              <div>
                <div className="amount">{money(r.amount)}</div>
                <div className="approval-title">Pay {r.payee}</div>
                <div className="muted" style={{ fontSize: 13 }}>{r.kind === 'invoice' ? `Invoice ${r.ref_id}` : `Rent, lease ${r.ref_id}`} · due {r.due_date}{v ? ` (${dueText(v.check.days_until_due)})` : ''}</div>
              </div>
              <div className="reason"><b>Reason:</b> {r.reason}</div>
              {v && (
                <dl className="kv" aria-label="Checked just now">
                  <dt>Still owed</dt><dd>{money(v.still_owed)} of {money(v.check.amount_on_file)}</dd>
                  <dt>Checking now</dt><dd>{money(v.check.cash_available)}</dd>
                  <dt>After paying</dt><dd><b>{money(v.check.cash_after_payment)}</b></dd>
                </dl>
              )}
              {v?.problems.map((p) => <div key={p} className="problem"><b>Not allowed.</b> {p}</div>)}
            </>
          )
        })()}
        {a.approval_type === 'purchase' && (() => {
          const r = a.request, v = a.review ?? a.request
          return (
            <>
              <div>
                <div className="amount">{r.qty} × {r.size}</div>
                <div className="approval-title">Buy {r.qty} {v.product_name || r.sku} ({r.sku}, size {r.size})</div>
                <div className="muted" style={{ fontSize: 13 }}>from {v.vendor_name} · {v.vendor_specialty} · {v.lead_days}-day lead time</div>
              </div>
              <div className="reason"><b>Reason:</b> {r.reason}</div>
              <dl className="kv">
                <dt>In stock now</dt><dd>{v.qty_in_stock}</dd>
                <dt>Estimated cost</dt><dd>{money(v.estimated_cost)} <span className="muted">({money(v.estimated_unit_cost)} each, the shop's unit cost)</span></dd>
                <dt>Vendor can ship</dt><dd>{v.vendor_can_ship ? 'Yes' : 'No'}</dd>
              </dl>
              <span className="effect">{a.review?.approval_effect ?? 'Approving records the decision only. No order is placed, no vendor is contacted and no money moves.'}</span>
            </>
          )
        })()}
        {a.approval_type === 'discount' && (() => {
          const r = a.request
          return (
            <>
              <div>
                <div className="approval-title">Discount request from {r.customer}</div>
                <div className="muted" style={{ fontSize: 13 }}>{r.qty} × {r.sku} size {r.size} · list {money(r.list_price)}, cost {money(r.unit_cost)} · {r.qty_in_stock} in stock</div>
              </div>
              {!!r.options_evaluated?.length && (
                <table className="options">
                  <thead><tr><th>Discount</th><th>Each</th><th>Total</th><th>Profit</th></tr></thead>
                  <tbody>{r.options_evaluated.map((o) => (
                    <tr key={o.discount_percent} className={o.discount_percent === r.recommended_discount_percent ? 'recommended' : ''}>
                      <td>{o.discount_percent}%{o.discount_percent === r.recommended_discount_percent ? ' (recommended)' : ''}</td>
                      <td>{money(o.unit_price)}</td><td>{money(o.total_price)}</td><td>{money(o.total_profit)}{o.below_cost ? ' below cost' : ''}</td>
                    </tr>))}</tbody>
                </table>
              )}
              {r.recommendation_reason && <div className="reason"><b>Agents' reasoning:</b> {r.recommendation_reason}</div>}
              <span className="effect">There's no discount policy, so you decide. Break-even is {r.break_even_discount_percent}% (zero profit). Nothing is sent to the customer.</span>
              <label className="field">Discount you approve (%)
                <input inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="e.g. 0" />
              </label>
            </>
          )
        })()}

        <Warnings warnings={warnings} checked={checked} onToggle={toggle} />
        <label className="field">Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <div className="approval-actions">
          <button className="btn approve" disabled={!canApprove} onClick={() => submit('approve')} data-testid="approve">
            {a.approval_type === 'payment' ? `Approve payment of ${money(a.request.amount)}` : 'Approve'}
          </button>
          <button className="btn reject" disabled={!approver.trim() || saving} onClick={() => submit('reject')}>Reject</button>
        </div>
        {!approver.trim() && <span className="effect">Enter your name above to decide.</span>}
        {error && <div className="error-text" role="alert">{error}</div>}
      </div>
    </article>
  )
}

export function ApprovalsPanel({ pending, decided, expired, selectedTicket, onDecided }: {
  pending: Approval[]; decided: DecidedApproval[]; expired: Approval[]; selectedTicket: number | null
  onDecided: (message: string) => void
}) {
  const [approver, setApprover] = useApproverName()
  const sorted = [...pending].sort((x, y) => Number(y.ticket_id === selectedTicket) - Number(x.ticket_id === selectedTicket))
  return (
    <section className="panel" aria-labelledby="approvals-h">
      <div className="panel-head"><h2 id="approvals-h">Approvals</h2><span className="muted">{pending.length} waiting</span></div>
      <label className="who"><span className="section-label" style={{ margin: 0 }}>Your name (recorded as the approver)</span>
        <input value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="e.g. Pat Rivera" data-testid="approver-name" />
      </label>
      <div className="approvals">
        {sorted.length === 0 && <div className="empty" style={{ padding: 12 }}>Nothing waiting. Requests appear here when the agents ask for a payment, purchase or discount.</div>}
        {sorted.map((a) => <ApprovalCard key={a.approval_id} a={a} approver={approver} highlight={a.ticket_id === selectedTicket} onDone={onDecided} />)}
      </div>
      {(decided.length > 0 || expired.length > 0) && (
        <div className="history">
          <p className="section-label">Decided</p>
          <ul>
            {decided.slice(-6).reverse().map((d) => (
              <li key={d.approval_id}><span>#{d.ticket_id} {d.approval_type}{d.approval_type === 'payment' ? ` ${money(d.request.amount)}` : ''}</span>
                <span className={d.decision.approved ? '' : 'muted'}>{d.decision.approved ? 'Approved' : 'Rejected'} by {d.decision.decided_by}</span></li>
            ))}
            {expired.length > 0 && <li><span>{expired.length} expired by a database reset</span><span className="muted">not approvable</span></li>}
          </ul>
        </div>
      )}
    </section>
  )
}
