import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, type ActivityEvent, type Approval, type Approvals, type Cash, type DecidedApproval, type Health, type Run, type Ticket, type TicketDetail } from './api'
import { ticketState } from './status'
import { ApprovalsPanel } from './components/Approvals'
import { CashPanel } from './components/CashPanel'
import { TicketList } from './components/TicketList'
import { TopBar } from './components/TopBar'
import { Workspace } from './components/Workspace'

const POLL_MS = 1000
const BACKGROUND_MS = 10000

export default function App() {
  const [online, setOnline] = useState(true)
  const [health, setHealth] = useState<Health | null>(null)
  const [today, setToday] = useState<string | null>(null)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [approvals, setApprovals] = useState<Required<Approvals>>({ pending: [], decided: [], expired: [] })
  const [cash, setCash] = useState<Cash | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [detail, setDetail] = useState<TicketDetail | null>(null)
  const [run, setRun] = useState<Run | null>(null)
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [runError, setRunError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const cursor = useRef(0)
  const runIdRef = useRef<string | null>(null)

  const refreshBasics = useCallback(async () => {
    try {
      const [h, t, c] = await Promise.all([api.health(), api.tickets(), api.cash()])
      setHealth(h); setTickets(t.tickets); setToday(t.today); setCash(c); setOnline(true)
      setSelected((s) => s ?? t.tickets[0]?.id ?? null)
      return t.tickets
    } catch {
      setOnline(false)
      return null
    }
  }, [])

  const refreshApprovals = useCallback(async () => {
    try {
      const a = await api.approvals()
      setApprovals({ pending: a.pending ?? [], decided: (a.decided ?? []) as DecidedApproval[], expired: (a.expired ?? []) as Approval[] })
    } catch { /* shown by the connection indicator */ }
  }, [])

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshBasics(), refreshApprovals()])
  }, [refreshBasics, refreshApprovals])

  // Load a run's full activity (from the start).
  const loadRun = useCallback(async (runId: string | null) => {
    runIdRef.current = runId
    cursor.current = 0
    setEvents([]); setRun(null)
    if (!runId) return
    try {
      const [r, a] = await Promise.all([api.getRun(runId), api.activity(runId, 0)])
      if (runIdRef.current !== runId) return
      setRun(r); setEvents(a.events); cursor.current = a.next
    } catch { /* ignore: the ticket may have no runs yet */ }
  }, [])

  useEffect(() => {
    refreshAll()
    const t = setInterval(refreshBasics, BACKGROUND_MS)
    return () => clearInterval(t)
  }, [refreshAll, refreshBasics])

  // When the selected ticket changes, load its details and latest run.
  const selectedTicket = tickets.find((t) => t.id === selected) ?? null
  const latestRunId = selectedTicket?.latest_run_id ?? null
  useEffect(() => {
    if (selected == null) return
    setRunError(null)
    api.ticket(selected).then(setDetail).catch(() => setDetail(null))
  }, [selected])
  useEffect(() => {
    if (runIdRef.current !== latestRunId || latestRunId == null) loadRun(latestRunId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, latestRunId])

  // While a run is going, poll its activity and status.
  useEffect(() => {
    if (run?.status !== 'running') return
    const runId = run.run_id
    const t = setInterval(async () => {
      try {
        const a = await api.activity(runId, cursor.current)
        if (runIdRef.current !== runId) return
        if (a.events.length) setEvents((ev) => [...ev, ...a.events])
        cursor.current = a.next
        const r = await api.getRun(runId)
        if (runIdRef.current !== runId) return
        if (r.status !== 'running') {
          const rest = await api.activity(runId, cursor.current)
          if (rest.events.length) setEvents((ev) => [...ev, ...rest.events])
          cursor.current = rest.next
          setRun(r)
          await refreshAll()
          if (selected != null) api.ticket(selected).then(setDetail).catch(() => {})
        }
      } catch { setOnline(false) }
    }, POLL_MS)
    return () => clearInterval(t)
  }, [run?.status, run?.run_id, refreshAll, selected])

  async function startRun() {
    if (selected == null) return
    setRunError(null)
    try {
      const started = await api.run(selected)
      runIdRef.current = started.run_id
      cursor.current = 0
      setEvents([])
      setRun({ run_id: started.run_id, ticket_id: selected, status: 'running', started_at: new Date().toISOString() })
      setTickets((ts) => ts.map((t) => (t.id === selected ? { ...t, agent_status: 'running', latest_run_id: started.run_id } : t)))
    } catch (e) {
      setRunError(e instanceof ApiError ? e.message : 'Could not reach the backend.')
    }
  }

  async function onDecided(message: string) {
    if (message) setToast(message)
    await refreshAll()
    if (selected != null) api.ticket(selected).then(setDetail).catch(() => {})
  }
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(t)
  }, [toast])

  const states = useMemo(() => Object.fromEntries(tickets.map((t) => [t.id, ticketState(t, approvals)])), [tickets, approvals])
  const pendingForRun = run ? approvals.pending.filter((a) => a.run_id === run.run_id).length : 0
  const busy = run?.status === 'running' || (health?.busy ?? null) !== null

  return (
    <>
      <TopBar health={health} online={online} today={today} balance={cash?.checking_balance ?? null} />
      {!online && <div className="banner bad" role="alert">Can't reach the backend. Start it from <code>hw5/backend</code> with <code>uvicorn main:app --reload --port 8000</code>.</div>}
      {online && health && !health.working_database_present && <div className="banner warn">The working database is missing. Run <code>python3 setup_db.py path/to/data_2.zip</code> in <code>hw5</code>.</div>}
      <main className="layout">
        <TicketList tickets={tickets} states={states} selected={selected} onSelect={setSelected} />
        <Workspace detail={detail} state={selected != null ? states[selected] : undefined} run={run} events={events} busy={busy}
                   canRun={!!health?.portkey_key_configured} runError={runError} pendingForRun={pendingForRun} onRun={startRun} />
        <aside className="side">
          <ApprovalsPanel pending={approvals.pending} decided={approvals.decided} expired={approvals.expired} selectedTicket={selected} onDecided={onDecided} />
          <CashPanel cash={cash} />
        </aside>
      </main>
      {toast && <div className="toast" role="status" data-testid="toast">{toast}</div>}
    </>
  )
}
