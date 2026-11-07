import type { CSSProperties } from 'react'
import { agentMeta } from '../agents'
import type { ActivityEvent } from '../api'
import { agentStyle, Avatar, clock } from './common'

function args(a: Record<string, unknown> | undefined): string {
  return Object.entries(a ?? {}).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')
}

function Who({ agent }: { agent: string | null }) {
  return <span className="ev-who">{agentMeta(agent)?.label ?? (agent === 'human' ? 'Person' : 'System')}</span>
}

function Row({ e, kind = '', minor = false, children }: { e: ActivityEvent; kind?: string; minor?: boolean; children: React.ReactNode }) {
  return (
    <li className={`ev ${kind}${minor ? ' minor' : ''}`} style={agentStyle(e.agent)} data-event={e.event}>
      <Avatar agent={e.agent} />
      <div className="ev-body">{children}</div>
    </li>
  )
}

function EventItem({ e }: { e: ActivityEvent }) {
  const time = <span className="ev-time">{clock(e.timestamp)}</span>
  switch (e.event) {
    case 'delegation': {
      const to = agentMeta(e.to)
      return (
        <Row e={e}>
          <div className="ev-line">
            <span className="handoff" style={{ '--c2': to?.color } as CSSProperties}>
              <Who agent={e.agent} /><span className="arrow" aria-label="asks">{'→'}</span><span className="to">{to?.label ?? e.to}</span>
            </span>
            <span className="muted" style={{ fontSize: 12.5 }}>delegates</span>{time}
          </div>
          <div className="bubble">{e.task}</div>
        </Row>
      )
    }
    case 'delegation_result': {
      const to = agentMeta(e.reply_to)
      return (
        <Row e={e}>
          <div className="ev-line">
            <span className="handoff" style={{ '--c2': to?.color } as CSSProperties}>
              <Who agent={e.agent} /><span className="arrow" aria-label="replies to">{'↩'}</span><span className="to">{to?.label ?? e.reply_to}</span>
            </span>
            <span className="muted" style={{ fontSize: 12.5 }}>reports back</span>{time}
          </div>
          <div className="bubble reply">
            {e.report?.summary}
            {!!e.report?.findings?.length && (
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{e.report.findings.map((f, i) => <li key={i}>{f.fact}</li>)}</ul>
            )}
          </div>
        </Row>
      )
    }
    case 'tool_call':
      return (
        <Row e={e} minor>
          <div className="ev-line"><Who agent={e.agent} /><span className="tool">{'⚙'} {e.tool}({args(e.arguments)})</span>{time}</div>
        </Row>
      )
    case 'tool_result':
      return (
        <Row e={e} minor>
          <details className="result">
            <summary>{e.tool} returned</summary>
            <pre>{JSON.stringify(e.result, null, 2)}</pre>
          </details>
        </Row>
      )
    case 'tool_error':
      return <Row e={e} kind="error" minor><div className="ev-text">{e.tool} failed: {e.error}</div></Row>
    case 'output_rejected':
      return (
        <Row e={e} kind="alert">
          <div className="ev-line"><Who agent={e.agent} /><span className="muted" style={{ fontSize: 12.5 }}>answer sent back by a rule check</span>{time}</div>
          <div className="bubble"><ul style={{ margin: 0, paddingLeft: 18 }}>{e.problems?.map((p, i) => <li key={i}>{p}</li>)}</ul></div>
        </Row>
      )
    case 'draft_message':
      return (
        <Row e={{ ...e, agent: 'customer_service' }}>
          <div className="ev-line"><span className="ev-who">Draft to {e.message?.to}</span><span className="not-sent">not sent</span>{time}</div>
          <div className="bubble"><b>{e.message?.subject}</b><br />{e.message?.body}</div>
        </Row>
      )
    case 'decision':
      return <Row e={e}><div className="ev-line"><Who agent={e.agent} /><span className="ev-text">Decision: {e.decision}</span>{time}</div></Row>
    case 'approval_requested':
      return <Row e={e} kind="alert"><div className="ev-line"><Who agent={e.agent} />{time}</div><div className="bubble">{e.summary}</div></Row>
    case 'human_follow_up':
      return <Row e={e}><div className="ev-line"><Who agent={e.agent} /><span className="ev-text">For a person: {e.follow_up?.action}</span>{time}</div></Row>
    case 'resolution':
      return (
        <Row e={e}>
          <div className="ev-line"><Who agent={e.agent} /><span className="muted" style={{ fontSize: 12.5 }}>final plan</span>{time}</div>
          <div className="bubble reply">{e.resolution?.summary}</div>
        </Row>
      )
    case 'payment_recorded':
      return <Row e={e}><div className="ev-line"><Who agent="human" /><span className="ev-text">{e.summary}</span>{time}</div></Row>
    case 'run_started':
    case 'run_finished':
    case 'run_error':
    case 'usage_limit_exceeded': {
      const bad = e.event !== 'run_started' && (e.event !== 'run_finished' || e.outcome === 'error' || e.outcome === 'stopped_by_usage_limit')
      const usage = e.usage ? ` · ${e.usage.requests} model calls, ${e.usage.tool_calls} tool calls, ${(e.usage.input_tokens + e.usage.output_tokens).toLocaleString()} tokens` : ''
      return (
        <Row e={{ ...e, agent: null }} kind={bad ? 'system error' : 'system'} minor>
          <div className="ev-line"><span className="ev-text">{e.event === 'run_error' ? `Run error: ${e.error}` : e.summary}{usage}</span>{time}</div>
        </Row>
      )
    }
    default:
      return <Row e={e} minor><div className="ev-line"><span className="ev-text">{e.summary}</span>{time}</div></Row>
  }
}

export function ActivityFeed({ events, running }: { events: ActivityEvent[]; running: boolean }) {
  return (
    <section className="panel" aria-labelledby="activity-h">
      <div className="panel-head">
        <h2 id="activity-h">Live activity</h2>
        {running ? <span className="live"><span className="pill running" style={{ padding: 0, background: 'none' }} /> Updating</span>
          : <span className="muted" style={{ fontSize: 13 }}>{events.length} events</span>}
      </div>
      {events.length === 0
        ? <div className="empty">No activity yet. Run the agents to watch them work on this ticket.</div>
        : <ol className="timeline" aria-live="polite" data-testid="timeline">{events.map((e) => <EventItem key={e.id} e={e} />)}</ol>}
    </section>
  )
}

