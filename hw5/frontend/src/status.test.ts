import { describe, expect, it } from 'vitest'
import type { ActivityEvent, Approval, DecidedApproval, Run, Ticket } from './api'
import { activeAgent, contributions, runOutcome, ticketState } from './status'

const ticket = (agent_status: string, latest_run_id: string | null = 'run_1'): Ticket => ({
  id: 101, type: 'customer_order', requester: 'Tauhid Zaman', subject: 'Bulldog tee', sku: 'CC-TEE-WHITE', size: 'S',
  qty: 1, status: 'open', created_at: '', requester_is_customer: true, agent_status, latest_run_id, pending_approvals: 0,
})
const req = (run_id: string) => ({ approval_id: 'apr_' + run_id, run_id, ticket_id: 101, timestamp: '', approval_type: 'payment' }) as unknown as Approval
const none = { pending: [], decided: [], expired: [] }

describe('ticketState', () => {
  it('never marks a failed or stopped run as resolved', () => {
    expect(ticketState(ticket('error'), none).state).toBe('failed')
    expect(ticketState(ticket('stopped_by_usage_limit'), none).state).toBe('failed')
    expect(ticketState(ticket('stopped'), none).state).toBe('failed')
    expect(ticketState(ticket('something_new'), none).state).toBe('failed')
  })
  it('needs action while requests from the latest run are pending or expired', () => {
    expect(ticketState(ticket('needs_human_approval'), { ...none, pending: [req('run_1')] }).state).toBe('needs_action')
    expect(ticketState(ticket('needs_human_approval'), { ...none, expired: [req('run_1')] }).state).toBe('needs_action')
  })
  it('ignores requests from older runs', () => {
    expect(ticketState(ticket('needs_human_approval'), { ...none, pending: [req('run_0')] }).state).toBe('resolved')
  })
  it('is resolved when nothing is left for a person', () => {
    expect(ticketState(ticket('ready_for_review'), none).state).toBe('resolved')
    const decided = { ...req('run_1'), decision: { approved: true, decided_by: 'Pat', timestamp: '' } } as DecidedApproval
    expect(ticketState(ticket('needs_human_approval'), { ...none, decided: [decided] }).state).toBe('resolved')
  })
  it('handles not run and running', () => {
    expect(ticketState(ticket('not_run', null), none).state).toBe('not_run')
    expect(ticketState(ticket('running'), none).state).toBe('running')
  })
})

describe('runOutcome', () => {
  const run = (over: Partial<Run>): Run => ({ run_id: 'run_1', ticket_id: 101, status: 'finished', started_at: '', ...over })
  it('marks errors and usage-limit stops as not resolved', () => {
    expect(runOutcome(run({ status: 'error', error: 'boom' }), 0)).toMatchObject({ tone: 'bad', title: 'Run failed — not resolved' })
    expect(runOutcome(run({ status: 'stopped' }), 0).title).toContain('not resolved')
  })
  it('needs action while approvals are pending', () => {
    expect(runOutcome(run({ outcome: 'needs_human_approval' }), 2).tone).toBe('warn')
    expect(runOutcome(run({ outcome: 'needs_human_approval' }), 0).title).toBe('Resolved')
    expect(runOutcome(run({ outcome: 'ready_for_review' }), 0).title).toBe('Resolved')
  })
})

describe('contributions', () => {
  const ev = (over: Partial<ActivityEvent>): ActivityEvent =>
    ({ position: 0, categories: [], summary: '', id: '', timestamp: '', run_id: 'run_1', ticket_id: 101, agent: 'boss', event: '', ...over }) as ActivityEvent
  const events = [
    ev({ event: 'run_started' }),
    ev({ event: 'tool_call', tool: 'get_ticket' }),
    ev({ event: 'delegation', to: 'inventory', task: 'Check stock' }),
    ev({ event: 'tool_call', agent: 'inventory', tool: 'check_stock' }),
    ev({ event: 'tool_call', agent: 'inventory', tool: 'check_stock' }),
    ev({ event: 'delegation_result', agent: 'inventory', reply_to: 'boss',
         report: { agent: 'inventory', summary: '0 in S', findings: [{ fact: '0 in size S', sources: ['check_stock'] }], decisions: [], unknowns: [] } }),
    ev({ event: 'output_rejected', agent: 'boss', problems: ['x'] }),
  ]
  it('summarises what each agent did', () => {
    const [boss, inventory, accounting] = contributions(events)
    expect(boss).toMatchObject({ involved: true, delegatedTo: ['inventory'], answersSentBack: 1 })
    expect(inventory).toMatchObject({ involved: true, askedBy: ['boss'], tasks: ['Check stock'], summary: '0 in S', findings: ['0 in size S'] })
    expect(inventory.tools).toEqual([{ name: 'check_stock', count: 2 }])
    expect(accounting.involved).toBe(false)
  })
  it('finds who is working now', () => {
    expect(activeAgent(events)).toBe('boss')
    expect(activeAgent(events.slice(0, 3))).toBe('inventory')
    expect(activeAgent([...events, ev({ event: 'run_finished' })])).toBe(null)
  })
})
