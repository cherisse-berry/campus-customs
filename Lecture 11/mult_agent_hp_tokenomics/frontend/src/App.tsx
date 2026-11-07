import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { fetchHealth, fetchRoster, streamChat } from './api'
import { BOOK_PROPS, Labubu } from './components/Labubu'
import { playSpellComplete, playZap, unlockSpellAudio } from './spellSound'
import type { ZapKind } from './spellSound'
import type { AgentStatus, ChatResult, Delegation, ProgressEvent, SpecialistMeta } from './types'
import './App.css'

const SAMPLE =
  'For each Horcrux, when and how is it found or destroyed across the books?'

const BOSS_ACCENT = '#ff4da6'

type EdgeState = 'idle' | 'sending' | 'working' | 'returning' | 'done' | 'error'
type NodeKey = 'boss' | number
interface EdgeGeom {
  d: string
}
interface Bolt {
  id: number
  dir: 'out' | 'back'
}
interface Usage {
  total?: { requests: number; input_tokens: number; output_tokens: number }
}

function latestDelegation(delegations: Delegation[], bookNumber: number): Delegation | null {
  for (let i = delegations.length - 1; i >= 0; i -= 1) {
    if (delegations[i].book_number === bookNumber) return delegations[i]
  }
  return null
}

/** Which dashboard node an event belongs to. */
function nodeOf(ev: ProgressEvent): NodeKey {
  const n = Number(ev.data?.book_number)
  if (ev.type === 'agent_step' && Number.isFinite(n) && n >= 1 && n <= 7) return n
  return 'boss'
}

function zapFor(ev: ProgressEvent): ZapKind | null {
  if (ev.type === 'specialist_started') return 'send'
  if (ev.type === 'specialist_done') return 'return'
  if (ev.type === 'boss_thinking') return 'think'
  if (ev.type === 'agent_step') return ev.data.kind === 'retrieval' ? 'search' : 'step'
  return null
}

function activityOf(ev: ProgressEvent): string | null {
  const d = ev.data
  if (ev.type !== 'agent_step') return null
  switch (d.kind) {
    case 'retrieval':
      return d.follow_up ? 'searching again…' : 'reading the book…'
    case 'model_request':
      return 'consulting the model…'
    case 'model_response':
      return Array.isArray(d.tool_calls) && d.tool_calls.length ? 'casting tool calls…' : 'writing reply…'
    case 'end':
      return 'finished'
    default:
      return null
  }
}

function fmtTokens(u: unknown): string {
  const x = u as { input_tokens?: number; output_tokens?: number } | undefined
  if (!x || (!x.input_tokens && !x.output_tokens)) return ''
  return ` · ${x.input_tokens ?? 0} in / ${x.output_tokens ?? 0} out tok`
}

/** Untangle LLM-jammed GFM tables so remark-gfm can parse them. */
function normalizeAnswerMarkdown(text: string): string {
  let s = text.replace(/\r\n/g, '\n').trim()
  // Separator row on its own line: "... | |---|---|---| | next"
  s = s.replace(/\s*(\|(?:\s*:?-{3,}:?\s*\|)+)\s*/g, '\n$1\n')
  // Split jammed data rows: "...last cell | | Next row..."
  s = s.replace(/\|\s*\|(?=\s*[^|\s\-:])/g, '|\n|')
  // Blank line before a table that follows prose
  s = s.replace(/([^\n|])\n?(\|[^\n]+\|\n\|(?:\s*:?-{3,}:?\s*\|)+)/g, '$1\n\n$2')
  return s.replace(/\n{3,}/g, '\n\n')
}

function summarize(ev: ProgressEvent): string {
  const d = ev.data
  const short = (s: unknown, n = 90) => {
    const t = String(s ?? '')
    return t.length > n ? `${t.slice(0, n)}…` : t
  }
  switch (ev.type) {
    case 'boss_thinking':
      return `received question · model ${d.model}`
    case 'specialist_started':
      return `⚡ delegates to Book ${d.book_number}: “${short(d.question)}”`
    case 'specialist_done':
      return `⚡ Book ${d.book_number} reports back · ${d.status} · ${d.passages_used ?? 0} passages${fmtTokens(d.usage)}`
    case 'final':
      return `final answer${fmtTokens((d.usage as Usage | undefined)?.total)}`
    case 'error':
      return `error: ${short(d.error ?? d.answer, 140)}`
    case 'agent_step': {
      const step = `step ${d.step ?? '·'}`
      if (d.kind === 'retrieval') {
        const chunks = Array.isArray(d.chunks) ? d.chunks.length : 0
        return `${d.follow_up ? 'follow-up search' : 'retrieval'} · ${chunks} chunks · ${Number(d.evidence_chars ?? 0).toLocaleString()} chars${d.follow_up ? ` · “${short(d.query, 50)}”` : ''}`
      }
      if (d.kind === 'user_prompt') return `${step} · prompt in`
      if (d.kind === 'model_request') {
        const returns = Array.isArray(d.tool_returns) ? d.tool_returns.length : 0
        return `${step} · → model${returns ? ` with ${returns} tool result${returns > 1 ? 's' : ''}` : ''}`
      }
      if (d.kind === 'model_response') {
        const calls = Array.isArray(d.tool_calls) ? (d.tool_calls as { tool: string }[]) : []
        const what = calls.length
          ? `called ${calls.map((c) => c.tool).join(', ')}`
          : `text “${short(d.text, 60)}”`
        return `${step} · ← model ${what}${fmtTokens(d.usage)}`
      }
      if (d.kind === 'end') return `${step} · loop ended`
      return `${step} · ${String(d.kind)}`
    }
    default:
      return ev.type
  }
}

/** Event data for the expandable JSON view, minus the giant final payload bits. */
function detailJson(ev: ProgressEvent): string {
  const rest: Record<string, unknown> = { ...ev.data }
  if (ev.type === 'final' || ev.type === 'error') {
    delete rest.trace
    if (Array.isArray(rest.delegations)) rest.delegations = `${rest.delegations.length} delegations`
  }
  return JSON.stringify(rest, null, 2)
}

export default function App() {
  const [bossName, setBossName] = useState('Headmaster Labubledore')
  const [specialists, setSpecialists] = useState<SpecialistMeta[]>([])
  const [message, setMessage] = useState(SAMPLE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [healthOk, setHealthOk] = useState<boolean | null>(null)
  const [keySet, setKeySet] = useState<boolean | null>(null)
  const [bossStatus, setBossStatus] = useState<AgentStatus>('idle')
  const [bookStatus, setBookStatus] = useState<Record<number, AgentStatus>>({})
  const [delegations, setDelegations] = useState<Delegation[]>([])
  const [answer, setAnswer] = useState('')
  const [usage, setUsage] = useState<Usage | null>(null)
  const [events, setEvents] = useState<ProgressEvent[]>([])
  const [opsOpen, setOpsOpen] = useState(true)
  const [pinnedBook, setPinnedBook] = useState<number | null>(null)
  const [edgeState, setEdgeState] = useState<Record<number, EdgeState>>({})
  const [bolts, setBolts] = useState<Record<number, Bolt>>({})
  const [zaps, setZaps] = useState<Record<string, number>>({})
  const [activity, setActivity] = useState<Record<string, string>>({})
  const [geom, setGeom] = useState<{ w: number; h: number; edges: Record<number, EdgeGeom> }>({
    w: 0,
    h: 0,
    edges: {},
  })
  const castRef = useRef<HTMLElement>(null)
  const boltSeq = useRef(0)
  const queueEnd = useRef<HTMLLIElement>(null)
  /** Keep the viewport glued in place when the Final answer panel inserts above Live ops. */
  const scrollLockRef = useRef<{ y: number; height: number } | null>(null)

  useEffect(() => {
    fetchRoster()
      .then((r) => {
        setBossName(r.boss)
        setSpecialists(r.specialists)
      })
      .catch(() => {
        setSpecialists(
          [1, 2, 3, 4, 5, 6, 7].map((n) => ({
            book_number: n,
            title: `Book ${n}`,
            short: `Book ${n}`,
            specialty: '',
            accent: '#888',
            house_hint: '',
          })),
        )
      })
    fetchHealth()
      .then((h) => {
        setHealthOk(!!h.ok)
        setKeySet(!!h.portkey_key_set)
        if (h.boss) setBossName(h.boss)
      })
      .catch(() => setHealthOk(false))
  }, [])

  // Measure boss → book anchor points so the SVG edges line up with the Labubus.
  const measure = useCallback(() => {
    const cast = castRef.current
    if (!cast) return
    const box = cast.getBoundingClientRect()
    const boss = cast.querySelector('[data-node="boss"] .labubu-stage')
    if (!boss) return
    const b = boss.getBoundingClientRect()
    const x1 = b.left + b.width / 2 - box.left
    const y1 = b.bottom - box.top - 8
    const edges: Record<number, EdgeGeom> = {}
    cast.querySelectorAll<HTMLElement>('[data-node^="book-"]').forEach((el) => {
      const n = Number(el.dataset.node?.slice(5))
      const stage = el.querySelector('.labubu-stage') || el
      const r = stage.getBoundingClientRect()
      const x2 = r.left + r.width / 2 - box.left
      const y2 = r.top - box.top + 10
      const my = (y1 + y2) / 2
      edges[n] = { d: `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}` }
    })
    setGeom({ w: box.width, h: box.height, edges })
  }, [])

  useLayoutEffect(() => {
    measure()
    const cast = castRef.current
    if (!cast) return
    const ro = new ResizeObserver(measure)
    ro.observe(cast)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure, specialists])

  // Keep the agent-loop list pinned to the latest event without scrolling the page.
  useEffect(() => {
    const end = queueEnd.current
    const scroller = end?.closest('.log') as HTMLElement | null
    if (!scroller) return
    scroller.scrollTop = scroller.scrollHeight
  }, [events.length])

  // When Final answer mounts above Live ops, compensate so the view does not jump down.
  useLayoutEffect(() => {
    const lock = scrollLockRef.current
    if (!lock || busy || !(answer || error)) return
    const delta = document.documentElement.scrollHeight - lock.height
    if (delta !== 0) window.scrollTo(0, lock.y + delta)
    scrollLockRef.current = null
  }, [busy, answer, error])

  const rosterReady = useMemo(() => specialists.length > 0, [specialists])
  const accentOf = useCallback(
    (key: NodeKey) =>
      key === 'boss' ? BOSS_ACCENT : specialists.find((s) => s.book_number === key)?.accent || '#888',
    [specialists],
  )

  function flash(key: NodeKey) {
    setZaps((z) => ({ ...z, [String(key)]: (z[String(key)] || 0) + 1 }))
  }

  function fireBolt(n: number, dir: Bolt['dir']) {
    boltSeq.current += 1
    setBolts((b) => ({ ...b, [n]: { id: boltSeq.current, dir } }))
  }

  function handleEvent(ev: ProgressEvent) {
    const d = ev.data || {}
    setEvents((E) => [...E, ev])
    const zap = zapFor(ev)
    if (zap) playZap(zap)

    const key = nodeOf(ev)
    flash(key)
    const act = activityOf(ev)
    if (act) setActivity((a) => ({ ...a, [String(key)]: act }))

    if (ev.type === 'boss_thinking') {
      setBossStatus('thinking')
      setActivity((a) => ({ ...a, boss: 'pondering…' }))
    }
    if (ev.type === 'specialist_started') {
      const n = Number(d.book_number)
      flash(n)
      fireBolt(n, 'out')
      setEdgeState((s) => ({ ...s, [n]: 'sending' }))
      window.setTimeout(() => setEdgeState((s) => (s[n] === 'sending' ? { ...s, [n]: 'working' } : s)), 650)
      setBookStatus((s) => ({ ...s, [n]: 'thinking' }))
      setActivity((a) => ({ ...a, boss: `delegating to Book ${n}…`, [String(n)]: 'got a question…' }))
      setDelegations((prev) => [
        ...prev,
        {
          agent: String(d.agent || `Book ${n}`),
          book_number: n,
          book_title: String(d.book_title || ''),
          question: String(d.question || ''),
          reply: '',
          status: 'running',
        },
      ])
    }
    if (ev.type === 'specialist_done') {
      const n = Number(d.book_number)
      const st = d.status === 'error' ? 'error' : 'done'
      flash(n)
      fireBolt(n, 'back')
      setEdgeState((s) => ({ ...s, [n]: 'returning' }))
      window.setTimeout(
        () => setEdgeState((s) => (s[n] === 'returning' ? { ...s, [n]: st } : s)),
        700,
      )
      setBookStatus((s) => ({ ...s, [n]: st as AgentStatus }))
      setActivity((a) => ({ ...a, [String(n)]: st === 'done' ? 'reported back' : 'had trouble' }))
      setDelegations((prev) => {
        const idx = typeof d.index === 'number' ? d.index : prev.findIndex((x) => x.book_number === n && !x.reply)
        if (idx < 0 || idx >= prev.length) return prev
        const copy = [...prev]
        copy[idx] = { ...copy[idx], reply: String(d.reply || ''), status: (d.status as Delegation['status']) || 'done' }
        return copy
      })
    }
    if (ev.type === 'final' || ev.type === 'error') {
      setBossStatus(ev.type === 'error' ? 'error' : 'done')
      setActivity((a) => ({ ...a, boss: ev.type === 'error' ? 'spell fizzled' : 'answer ready' }))
      setUsage((d.usage as Usage) || null)
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!message.trim() || busy) return
    // Clear previous run immediately so the old answer / ops don't linger.
    setError(null)
    setAnswer('')
    setUsage(null)
    setDelegations([])
    setEvents([])
    setBossStatus('thinking')
    setBookStatus({})
    setEdgeState({})
    setBolts({})
    setActivity({})
    setPinnedBook(null)
    setOpsOpen(true)
    setBusy(true)
    await unlockSpellAudio()

    try {
      const result: ChatResult = await streamChat(message.trim(), handleEvent)
      scrollLockRef.current = {
        y: window.scrollY,
        height: document.documentElement.scrollHeight,
      }
      setAnswer(result.answer)
      setDelegations(result.delegations)
      const doneMap: Record<number, AgentStatus> = {}
      for (const d of result.delegations) {
        doneMap[d.book_number] = d.status === 'error' ? 'error' : 'done'
      }
      setBookStatus(doneMap)
      void playSpellComplete()
    } catch (err) {
      scrollLockRef.current = {
        y: window.scrollY,
        height: document.documentElement.scrollHeight,
      }
      setError(err instanceof Error ? err.message : String(err))
      setBossStatus('error')
    } finally {
      setBusy(false)
    }
  }

  const totals = usage?.total

  return (
    <div className="app">
      <header className="hero">
        <p className="eyebrow">MGT 409 · Lecture 10 demo</p>
        <h1>{bossName}</h1>
        <p className="tagline">
          Chat with the Headmaster Labubu. He dispatches one specialist Labubu per Harry Potter book —
          with live thinking lights and a structured delegation report.
        </p>
        <div className="status-row">
          <span className={healthOk ? 'pill ok' : 'pill bad'}>
            API {healthOk === null ? '…' : healthOk ? 'up' : 'down'}
          </span>
          <span className={keySet ? 'pill ok' : 'pill warn'}>
            Portkey {keySet === null ? '…' : keySet ? 'key set' : 'key missing'}
          </span>
        </div>
      </header>

      <section className="cast" aria-label="Agent cast" ref={castRef}>
        <svg className="edges" width={geom.w} height={geom.h} aria-hidden>
          <defs>
            <filter id="edge-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {Object.entries(geom.edges).map(([k, g]) => {
            const n = Number(k)
            const state = edgeState[n] || 'idle'
            const accent = accentOf(n)
            const bolt = bolts[n]
            return (
              <g key={n} className={`edge ${state}`} style={{ ['--accent' as string]: accent }}>
                <path className="edge-base" d={g.d} />
                <path className="edge-glow" d={g.d} filter="url(#edge-glow)" />
                {bolt && (
                  <path
                    key={bolt.id}
                    className={`edge-bolt ${bolt.dir}`}
                    d={g.d}
                    pathLength={100}
                    filter="url(#edge-glow)"
                  />
                )}
              </g>
            )
          })}
        </svg>

        <div className="node" data-node="boss">
          <Labubu
            variant="boss"
            label={bossName}
            sublabel="Boss · click books for ask/reply"
            accent={BOSS_ACCENT}
            status={bossStatus}
            badge="★"
          />
          {zaps.boss ? <span key={zaps.boss} className="node-zap" style={{ ['--accent' as string]: BOSS_ACCENT }} /> : null}
          {activity.boss && <span className="node-activity">{activity.boss}</span>}
        </div>
        <div className="cast-books">
          {rosterReady &&
            specialists.map((b) => {
              const del = latestDelegation(delegations, b.book_number)
              const z = zaps[String(b.book_number)]
              const act = activity[String(b.book_number)]
              return (
                <div className="node" data-node={`book-${b.book_number}`} key={b.book_number}>
                  <Labubu
                    label={`Book ${b.book_number}`}
                    sublabel={b.short || b.title}
                    accent={b.accent}
                    status={bookStatus[b.book_number] || 'idle'}
                    badge={String(b.book_number)}
                    propEmoji={BOOK_PROPS[b.book_number]}
                    delegation={del}
                    tooltipOpen={pinnedBook === b.book_number}
                    onSelect={() => {
                      if (!del) return
                      setPinnedBook((cur) => (cur === b.book_number ? null : b.book_number))
                    }}
                  />
                  {z ? <span key={z} className="node-zap" style={{ ['--accent' as string]: b.accent }} /> : null}
                  {act && <span className="node-activity">{act}</span>}
                </div>
              )
            })}
        </div>
      </section>

      <main className="workspace">
        <form className="chat" onSubmit={onSubmit}>
          <label htmlFor="q">Ask the Headmaster</label>
          <textarea
            id="q"
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
            disabled={busy}
            placeholder="Ask a cross-book question…"
          />
          <div className="chat-actions">
            <button type="submit" disabled={busy || !message.trim()}>
              {busy ? 'Consulting the castle…' : 'Send to Labubledore'}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => setMessage(SAMPLE)}
            >
              Load Horcrux sample
            </button>
          </div>
        </form>

        {!busy && (error || answer) && (
          <section className="answer panel answer-pop" aria-live="polite">
            <h2>Final answer</h2>
            {error && <p className="error">{error}</p>}
            {!error && answer && (
              <div className="answer-body markdown" key={answer.slice(0, 48)}>
                <Markdown remarkPlugins={[remarkGfm]}>{normalizeAnswerMarkdown(answer)}</Markdown>
              </div>
            )}
            {totals && (
              <p className="usage-line">
                {totals.requests} model calls · {totals.input_tokens.toLocaleString()} input +{' '}
                {totals.output_tokens.toLocaleString()} output tokens
              </p>
            )}
          </section>
        )}

        <section className="panel ops-card">
          <button
            type="button"
            className="ops-toggle"
            aria-expanded={opsOpen}
            onClick={() => setOpsOpen((o) => !o)}
          >
            <span>
              Live ops
              <span className="ops-count">
                {events.length ? `${delegations.length} calls · ${events.length} events` : 'idle'}
              </span>
            </span>
            <span className="ops-chevron" aria-hidden>
              {opsOpen ? '▾' : '▸'}
            </span>
          </button>

          {opsOpen && (
            <div className="ops-body">
              <div className="ops-section">
                <h3>Agent loop queue</h3>
                <ul className="log queue">
                  {events.length === 0 && <li className="muted">Waiting for a question…</li>}
                  {events.map((ev, i) => {
                    const key = nodeOf(ev)
                    const who = key === 'boss' ? 'Boss' : `Book ${key}`
                    return (
                      <li key={`${ev.data?.seq ?? i}`} className={`q-${ev.type}`}>
                        <details>
                          <summary>
                            <span className="q-seq">#{String(ev.data?.seq ?? i + 1)}</span>
                            <span className="q-t">+{(Number(ev.data?.t_ms ?? 0) / 1000).toFixed(1)}s</span>
                            <span className="q-who" style={{ color: accentOf(key) }}>
                              {who}
                            </span>
                            <span className="q-type">{ev.type}</span>
                            <span className="q-sum">{summarize(ev)}</span>
                          </summary>
                          <pre>{detailJson(ev)}</pre>
                        </details>
                      </li>
                    )
                  })}
                  <li ref={queueEnd} className="q-end" aria-hidden />
                </ul>
              </div>
              <div className="ops-section">
                <h3>Delegations</h3>
                {delegations.length === 0 && <p className="muted">No specialists called yet.</p>}
                {delegations.map((d, i) => (
                  <article key={`${d.book_number}-${i}`} className={`delegation ${d.status}`}>
                    <header>
                      <strong>{d.agent}</strong>
                      <span>{d.status}</span>
                    </header>
                    <p>
                      <em>Asked:</em> {d.question}
                    </p>
                    {d.reply && (
                      <p>
                        <em>Replied:</em> {d.reply}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
