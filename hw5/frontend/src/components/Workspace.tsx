import type { CSSProperties } from 'react'
import { AGENTS } from '../agents'
import type { ActivityEvent, Run, TicketDetail } from '../api'
import { activeAgent, contributions, money, runOutcome, type TicketStateInfo } from '../status'
import { ActivityFeed } from './ActivityFeed'
import { Avatar, StatusPill, TICKET_TYPES } from './common'

function days(n: number) {
  if (n < 0) return `${-n} day${n === -1 ? '' : 's'} overdue`
  if (n === 0) return 'due today'
  return `due in ${n} day${n === 1 ? '' : 's'}`
}

function TicketHeader({ detail, state, run, busy, canRun, runError, onRun }: {
  detail: TicketDetail; state: TicketStateInfo | undefined; run: Run | null; busy: boolean
  canRun: boolean; runError: string | null; onRun: () => void
}) {
  const t = detail.ticket
  const inv = detail.linked.invoice
  const lease = detail.linked.lease
  return (
    <section className="panel ticket-head" aria-labelledby="ticket-h">
      <div className="ticket-head-top">
        <div>
          <div className="stub-type">#{t.id} · {TICKET_TYPES[t.type] ?? t.type}</div>
          <h2 id="ticket-h">{t.subject}</h2>
          <p className="notes">{t.requester}: “{t.notes}”</p>
        </div>
        {state && <div title={state.detail}><StatusPill state={state.state} label={state.label} /></div>}
      </div>
      <div className="facts">
        {t.sku && <div className="fact"><small>Wants</small><b>{t.qty} × {t.sku}</b> size {t.size}</div>}
        <div className="fact"><small>Requester</small><b>{t.requester}</b> {detail.requester_is_customer ? '(customer)' : '(not a customer)'}</div>
        {inv && <div className={`fact${inv.days_until_due < 0 ? ' warn' : ''}`}><small>Invoice {inv.id} · {inv.vendor}</small><b>{money(inv.still_owed)}</b> owed, {days(inv.days_until_due)}</div>}
        {lease && <div className="fact"><small>Lease {lease.id} · {lease.landlord}</small><b>{money(lease.still_owed_for_next_due)}</b> rent, {days(lease.days_until_due)}</div>}
      </div>
      <div className="run-row">
        <button className="btn primary" onClick={onRun} disabled={busy} data-testid="run-agents">
          {busy ? 'Agents working…' : run ? 'Run the agents again' : 'Run the agents'}
        </button>
        {state && <span className="hint">{state.detail}</span>}
        {!canRun && !busy && <span className="hint">The backend reports no Portkey key, so a run will be refused until it’s added to <code>hw5/.env</code>.</span>}
      </div>
      {runError && <div className="error-text" role="alert">{runError}</div>}
    </section>
  )
}

function TeamStrip({ events, running }: { events: ActivityEvent[]; running: boolean }) {
  const contrib = contributions(events)
  const speaking = running ? activeAgent(events) : null
  return (
    <section className="panel" aria-label="Agent team">
      <div className="team">
        {AGENTS.map((a, i) => {
          const c = contrib[i]
          const state = speaking === a.name ? 'Working' : c.involved ? (running ? 'Involved' : 'Contributed') : events.length ? 'Not involved' : 'Standing by'
          return (
            <div key={a.name} className={`member${speaking === a.name ? ' speaking' : ''}${!c.involved && events.length ? ' idle' : ''}`}
                 style={{ '--c': a.color } as CSSProperties} data-testid={`member-${a.name}`}>
              <Avatar agent={a.name} size="lg" />
              <span className="name">{a.label}</span>
              <span className="role">{a.role}</span>
              <span className="state">{state}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function RunSummary({ run, events, pendingForRun }: { run: Run; events: ActivityEvent[]; pendingForRun: number }) {
  const outcome = runOutcome(run, pendingForRun)
  const contrib = contributions(events)
  const plan = run.resolution
  return (
    <section className="panel" aria-labelledby="summary-h">
      <div className="panel-head"><h2 id="summary-h">Run summary</h2><span className="muted mono" style={{ fontSize: 12 }}>{run.run_id}</span></div>
      <div className="panel-body">
        <div className={`outcome ${outcome.tone}`} data-testid="run-outcome">
          <h3>{outcome.title}</h3>
          <span>{outcome.text}</span>
          {run.usage && (
            <span className="usage">
              {run.usage.requests} model calls · {run.usage.tool_calls} tool calls · {(run.usage.input_tokens + run.usage.output_tokens).toLocaleString()} tokens · {run.delegations ?? 0} delegations
            </span>
          )}
        </div>
      </div>
      {run.status !== 'running' && (
        <>
          <p className="section-label" style={{ padding: '0 16px' }}>What each agent contributed</p>
          <div className="contribs">
            {contrib.map((c) => {
              const meta = AGENTS.find((a) => a.name === c.agent)!
              return (
                <article key={c.agent} className={`contrib${c.involved ? '' : ' not-involved'}`} style={{ '--c': meta.color } as CSSProperties} data-testid={`contrib-${c.agent}`}>
                  <div className="contrib-head"><Avatar agent={c.agent} /><b>{meta.label}</b></div>
                  {!c.involved ? <p className="muted">Not involved in this ticket.</p> : (
                    <>
                      {c.askedBy.length > 0 && <p className="muted">Asked by {c.askedBy.map((a) => AGENTS.find((m) => m.name === a)?.label).join(', ')}</p>}
                      {c.summary && <p>{c.summary}</p>}
                      {c.delegatedTo.length > 0 && <p className="muted">Delegated to {c.delegatedTo.map((a) => AGENTS.find((m) => m.name === a)?.label).join(', ')}</p>}
                      {c.tools.length > 0 && <div className="chips">{c.tools.map((t) => <span key={t.name} className="chip">{t.name}{t.count > 1 ? ` ×${t.count}` : ''}</span>)}</div>}
                      {c.answersSentBack > 0 && <p className="muted">{c.answersSentBack} answer{c.answersSentBack > 1 ? 's' : ''} sent back by rule checks</p>}
                      {c.toolErrors > 0 && <p className="error-text">{c.toolErrors} tool error{c.toolErrors > 1 ? 's' : ''}</p>}
                    </>
                  )}
                </article>
              )
            })}
          </div>
          {plan && (
            <div className="plan">
              <p className="section-label">The Boss’s plan</p>
              <p style={{ margin: 0 }}>{plan.summary}</p>
              {plan.decisions.length > 0 && <div><b>Decisions</b><ul>{plan.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul></div>}
              {plan.human_follow_ups.length > 0 && <div><b>For a person to do</b><ul>{plan.human_follow_ups.map((f, i) => <li key={i}>{f.action} <span className="muted">— {f.reason}</span></li>)}</ul></div>}
              {plan.draft_messages.map((m, i) => (
                <div key={i} className="draft">
                  <div className="draft-head"><span>To <b>{m.to}</b>: {m.subject}</span><span className="not-sent">Draft · not sent</span></div>
                  <pre>{m.body}</pre>
                </div>
              ))}
              {plan.unknowns.length > 0 && <div><b>Unknown</b><ul>{plan.unknowns.map((u, i) => <li key={i}>{u}</li>)}</ul></div>}
            </div>
          )}
        </>
      )}
    </section>
  )
}

export function Workspace(props: {
  detail: TicketDetail | null; state: TicketStateInfo | undefined; run: Run | null; events: ActivityEvent[]
  busy: boolean; canRun: boolean; runError: string | null; pendingForRun: number; onRun: () => void
}) {
  const { detail, run, events } = props
  if (!detail) return <section className="panel empty">Choose a ticket to see its details.</section>
  const running = run?.status === 'running'
  return (
    <div className="workspace">
      <TicketHeader detail={detail} state={props.state} run={run} busy={props.busy} canRun={props.canRun} runError={props.runError} onRun={props.onRun} />
      <TeamStrip events={events} running={running} />
      {run && <RunSummary run={run} events={events} pendingForRun={props.pendingForRun} />}
      <ActivityFeed events={events} running={running} />
    </div>
  )
}
