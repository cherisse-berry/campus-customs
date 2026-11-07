import type { CSSProperties } from 'react'
import { agentMeta } from '../agents'
import type { TicketState } from '../status'

export function Avatar({ agent, size }: { agent: string | null | undefined; size?: 'lg' }) {
  const meta = agentMeta(agent)
  const style = { '--c': meta?.color ?? 'var(--human)' } as CSSProperties
  return (
    <span className={`avatar${size ? ' ' + size : ''}`} style={style} aria-hidden="true" title={meta?.label ?? 'Person'}>
      {meta?.mark ?? 'P'}
    </span>
  )
}

export function StatusPill({ state, label }: { state: TicketState; label: string }) {
  return <span className={`pill ${state}`}>{label}</span>
}

export function agentStyle(agent: string | null | undefined): CSSProperties {
  return { '--c': agentMeta(agent)?.color ?? 'var(--human)' } as CSSProperties
}

export const TICKET_TYPES: Record<string, string> = {
  customer_order: 'Customer order',
  rent_notice: 'Rent notice',
  price_override: 'Discount request',
}

export function clock(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function shopDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}
