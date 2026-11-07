import type { ActivityEvent, AgentName, Approval, DecidedApproval, Run, Ticket } from './api'

// ---------------------------------------------------------------- ticket state

export type TicketState = 'not_run' | 'running' | 'needs_action' | 'resolved' | 'failed'

export interface TicketStateInfo {
  state: TicketState
  label: string
  detail: string
}

/**
 * What the dashboard shows for a ticket, from its latest run and the approvals for that run.
 *
 * - A run that errored or was stopped by a usage limit is "failed", never resolved.
 * - A finished run that needs approvals is "needs action" while any request is pending,
 *   or if its requests expired in a database reset (they can no longer be approved).
 * - It's "resolved" only when the run finished and nothing is left for a person:
 *   either the plan needed no approval, or every request from that run was decided.
 */
export function ticketState(
  ticket: Ticket,
  approvals: { pending: Approval[]; decided: DecidedApproval[]; expired: Approval[] },
): TicketStateInfo {
  const runId = ticket.latest_run_id
  const s = ticket.agent_status
  if (s === 'not_run' || !runId) return { state: 'not_run', label: 'Not run', detail: 'The agents haven’t worked on this ticket yet.' }
  if (s === 'running') return { state: 'running', label: 'Agents working', detail: 'The agent team is working on this ticket.' }
  if (s === 'error') return { state: 'failed', label: 'Failed', detail: 'The run stopped with an error. The ticket is not resolved.' }
  if (s === 'stopped' || s === 'stopped_by_usage_limit')
    return { state: 'failed', label: 'Stopped', detail: 'The run hit an AI usage limit. The ticket is not resolved.' }

  const forRun = <T extends { run_id: string }>(list: T[]) => list.filter((a) => a.run_id === runId)
  const pending = forRun(approvals.pending).length
  const expired = forRun(approvals.expired).length
  if (s === 'needs_human_approval') {
    if (pending > 0)
      return { state: 'needs_action', label: 'Needs action', detail: `${pending} request${pending === 1 ? '' : 's'} waiting for a person.` }
    if (expired > 0)
      return { state: 'needs_action', label: 'Needs action', detail: 'Its requests expired when the database was reset. Run the agents again.' }
    return { state: 'resolved', label: 'Resolved', detail: 'Every request from the agents’ plan has been decided by a person.' }
  }
  if (s === 'ready_for_review')
    return { state: 'resolved', label: 'Resolved', detail: 'The agents finished and nothing needs approval.' }
  return { state: 'failed', label: 'Unknown', detail: `Unrecognised status “${s}”. Treated as not resolved.` }
}

/** The outcome banner for a finished (or failed) run. */
export function runOutcome(run: Run, pendingForRun: number): { tone: 'ok' | 'warn' | 'bad' | 'busy'; title: string; text: string } {
  if (run.status === 'running') return { tone: 'busy', title: 'Agents working', text: 'Activity appears below as it happens.' }
  if (run.status === 'error') return { tone: 'bad', title: 'Run failed — not resolved', text: run.error ?? 'The run stopped with an error.' }
  if (run.status === 'stopped')
    return { tone: 'bad', title: 'Stopped by a usage limit — not resolved', text: run.error ?? 'The run used up its AI budget.' }
  if (run.outcome === 'needs_human_approval') {
    return pendingForRun > 0
      ? { tone: 'warn', title: 'Needs action', text: `${pendingForRun} request${pendingForRun === 1 ? '' : 's'} waiting for a person in Approvals.` }
      : { tone: 'ok', title: 'Resolved', text: 'Every request from this plan has been decided.' }
  }
  if (run.outcome === 'ready_for_review') return { tone: 'ok', title: 'Resolved', text: 'Nothing needs approval. The plan is ready for review.' }
  return { tone: 'bad', title: 'Not resolved', text: `Run ended with “${run.outcome ?? run.status}”.` }
}

// ---------------------------------------------------------------- what each agent contributed

export interface Contribution {
  agent: AgentName
  involved: boolean
  askedBy: AgentName[]
  tasks: string[]
  delegatedTo: AgentName[]
  tools: { name: string; count: number }[]
  toolErrors: number
  answersSentBack: number
  summary: string | null
  findings: string[]
}

const ORDER: AgentName[] = ['boss', 'inventory', 'accounting', 'facilities', 'customer_service']

export function contributions(events: ActivityEvent[]): Contribution[] {
  const by = new Map<AgentName, Contribution>(
    ORDER.map((a) => [a, { agent: a, involved: false, askedBy: [], tasks: [], delegatedTo: [], tools: [], toolErrors: 0, answersSentBack: 0, summary: null, findings: [] }]),
  )
  const get = (a: unknown) => (typeof a === 'string' ? by.get(a as AgentName) : undefined)
  for (const e of events) {
    const c = get(e.agent)
    switch (e.event) {
      case 'run_started':
        if (c) c.involved = true
        break
      case 'tool_call': {
        if (!c || !e.tool) break
        c.involved = true
        const t = c.tools.find((x) => x.name === e.tool)
        if (t) t.count += 1
        else c.tools.push({ name: e.tool, count: 1 })
        break
      }
      case 'tool_error':
        if (c) c.toolErrors += 1
        break
      case 'delegation': {
        const target = get(e.to)
        if (c && target) {
          c.involved = true
          if (!c.delegatedTo.includes(target.agent)) c.delegatedTo.push(target.agent)
          target.involved = true
          if (!target.askedBy.includes(c.agent)) target.askedBy.push(c.agent)
          if (e.task) target.tasks.push(e.task)
        }
        break
      }
      case 'delegation_result':
        if (c && e.report) {
          c.involved = true
          c.summary = e.report.summary
          c.findings.push(...(e.report.findings ?? []).map((f) => f.fact))
        }
        break
      case 'output_rejected':
        if (c) c.answersSentBack += 1
        break
      case 'resolution':
        if (c && e.resolution) {
          c.summary = e.resolution.summary
          c.findings.push(...e.resolution.findings.map((f) => f.fact))
        }
        break
    }
  }
  return ORDER.map((a) => by.get(a)!)
}

/** The agent currently "speaking": whoever produced the latest agent event while a run is going. */
export function activeAgent(events: ActivityEvent[]): AgentName | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.event === 'run_finished' || e.event === 'run_error') return null
    if (e.event === 'delegation' && e.to) return e.to
    if (e.agent && e.agent !== 'human') return e.agent
  }
  return null
}

export const money = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
