import type { Ticket } from '../api'
import type { TicketStateInfo } from '../status'
import { StatusPill, TICKET_TYPES } from './common'

export function TicketList({ tickets, states, selected, onSelect }: {
  tickets: Ticket[]; states: Record<number, TicketStateInfo>; selected: number | null; onSelect: (id: number) => void
}) {
  return (
    <section className="panel" aria-labelledby="tickets-h">
      <div className="panel-head"><h2 id="tickets-h">Tickets</h2><span className="muted">{tickets.filter((t) => t.status === 'open').length} open</span></div>
      <div className="tickets">
        {tickets.map((t) => {
          const st = states[t.id]
          return (
            <button key={t.id} className="stub" aria-pressed={selected === t.id} onClick={() => onSelect(t.id)} data-testid={`ticket-${t.id}`}>
              <div className="stub-top">
                <span className="stub-no">#{t.id}</span>
                {st && <StatusPill state={st.state} label={st.label} />}
              </div>
              <span className="stub-type">{TICKET_TYPES[t.type] ?? t.type}</span>
              <span className="stub-subject">{t.subject}</span>
              <span className="stub-from">from {t.requester}</span>
              <div className="stub-foot">
                <span>{t.sku ? `${t.qty} × ${t.sku} ${t.size}` : 'Lease 1'}</span>
                {t.pending_approvals > 0 && <span>{t.pending_approvals} awaiting approval</span>}
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
