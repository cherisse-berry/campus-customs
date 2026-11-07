import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { getExploits, getPages, resetChat, sendChat, type ChatResult, type Exploit } from './api.ts'
import Exploits from './Exploits.tsx'
import FrogLabubu from './labubu/FrogLabubu.tsx'
import './App.css'

type Msg =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; meta: ChatResult }
  | { role: 'error'; text: string }

const STARTERS = ['Describe this document.', 'Summarize it in one sentence.', 'What are the key points?']

const newSessionId = () => Math.random().toString(36).slice(2, 10)

const prettyPage = (name: string) =>
  name
    .replace(/\.(html|pdf)$/, '')
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')

export default function App() {
  const [pages, setPages] = useState<string[]>([])
  const [models, setModels] = useState<string[]>([])
  const [page, setPage] = useState('')
  const [model, setModel] = useState('')
  const [sessionId, setSessionId] = useState(newSessionId)
  const [messages, setMessages] = useState<Msg[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [tab, setTab] = useState<'document' | 'exploits'>('document')
  const [exploits, setExploits] = useState<Exploit[]>([])
  const [chatOpen, setChatOpen] = useState(true)
  const endRef = useRef<HTMLDivElement>(null)

  const labelFor = (p: string) => exploits.find((e) => e.page === p)?.label ?? prettyPage(p)

  useEffect(() => {
    Promise.all([getPages(), getExploits().catch(() => [] as Exploit[])])
      .then(([info, catalog]) => {
        // Catalog order first, then any extra documents.
        const order = catalog.map((e) => e.page).filter((p) => info.pages.includes(p))
        const ordered = [...order, ...info.pages.filter((p) => !order.includes(p))]
        setExploits(catalog)
        setPages(ordered)
        setModels(info.models)
        setPage(ordered[0] ?? '')
        setModel(info.default_model)
      })
      .catch((e) => setLoadError(`Can't reach the backend on port 8012 — is it running? (${e.message})`))
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy, chatOpen])

  function startOver() {
    void resetChat(sessionId)
    setSessionId(newSessionId())
    setMessages([])
  }

  function changePage(p: string) {
    setPage(p)
    startOver()
  }

  function changeModel(m: string) {
    setModel(m)
    startOver()
  }

  function tryPage(p: string) {
    if (p !== page) changePage(p)
    setTab('document')
    setChatOpen(true)
  }

  async function send(text: string) {
    const message = text.trim()
    if (!message || busy || !page) return
    setDraft('')
    setMessages((m) => [...m, { role: 'user', text: message }])
    setBusy(true)
    try {
      const meta = await sendChat({ session_id: sessionId, page, model, message })
      setMessages((m) => [...m, { role: 'assistant', text: meta.reply, meta }])
    } catch (e) {
      setMessages((m) => [...m, { role: 'error', text: (e as Error).message }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="shell">
      <nav className="topnav">
        <div className="brand">
          <FrogLabubu className="brand-labubu" mood={busy ? 'happy' : 'classic'} />
          <div>
            <h1>Froggy Labubu</h1>
            <p className="tagline">Reads webpages and PDFs · Scraper Trap lab</p>
          </div>
        </div>
        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'document'}
            className={tab === 'document' ? 'on' : ''}
            onClick={() => setTab('document')}
          >
            Document
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'exploits'}
            className={tab === 'exploits' ? 'on' : ''}
            onClick={() => setTab('exploits')}
          >
            Exploits
          </button>
        </div>
      </nav>

      {tab === 'exploits' ? (
        <Exploits exploits={exploits} onTry={tryPage} />
      ) : (
        <main className="doc-view">
          <div className="doc-toolbar">
            <label>
              <span>Document</span>
              <select value={page} onChange={(e) => changePage(e.target.value)} disabled={busy}>
                {pages.map((p) => (
                  <option key={p} value={p}>
                    {labelFor(p)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Model</span>
              <select value={model} onChange={(e) => changeModel(e.target.value)} disabled={busy}>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            {page && (
              <a className="open-link" href={`/pages/${page}`} target="_blank" rel="noreferrer">
                Open in new tab ↗
              </a>
            )}
          </div>

          {loadError ? (
            <div className="banner bad">{loadError}</div>
          ) : (
            page && <iframe key={page} className="doc-frame" src={`/pages/${page}`} title={labelFor(page)} />
          )}
        </main>
      )}

      {tab === 'document' &&
        (chatOpen ? (
          <section className="chat-widget" aria-label="Chat with Froggy">
            <header className="chat-head">
              <FrogLabubu className="chat-head-labubu" sticker={false} mood={busy ? 'happy' : 'classic'} />
              <div className="chat-head-text">
                <strong>Froggy</strong>
                <small>
                  {model} · {page ? labelFor(page) : 'no document'}
                </small>
              </div>
              <button type="button" className="icon-btn" onClick={startOver} disabled={busy} title="New chat">
                ↺
              </button>
              <button type="button" className="icon-btn" onClick={() => setChatOpen(false)} title="Minimize chat">
                –
              </button>
            </header>

            <div className="messages">
              {messages.length === 0 && (
                <div className="empty">
                  <FrogLabubu className="empty-labubu" mood="cheeky" />
                  <p>Ribbit! I'll tell you what this document says.</p>
                  <div className="starters">
                    {STARTERS.map((s) => (
                      <button key={s} type="button" onClick={() => send(s)} disabled={!page || busy}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className="row user">
                    <div className="msg user">{m.text}</div>
                  </div>
                ) : m.role === 'error' ? (
                  <div key={i} className="banner bad">
                    {m.text}
                  </div>
                ) : (
                  <div key={i} className="row bot">
                    <FrogLabubu className="avatar" sticker={false} />
                    <div className="bot-col">
                      <div className="msg bot">
                        <ReactMarkdown>{m.text}</ReactMarkdown>
                      </div>
                      {m.meta.outbox.length > 0 && (
                        <div className="outbox">
                          <strong>Outbox — Froggy tried to fetch:</strong>
                          <ul>
                            {m.meta.outbox.map((u) => (
                              <li key={u}>{u}</li>
                            ))}
                          </ul>
                          <small>Recorded only. No request was sent.</small>
                        </div>
                      )}
                      <details className="glass">
                        <summary>
                          Glass box · {m.meta.reasoning_tokens} reasoning tokens
                          {m.meta.tools.length > 0 && ` · ${m.meta.tools.join(', ')}`}
                        </summary>
                        {m.meta.reasoning.length ? (
                          <ol>
                            {m.meta.reasoning.map((r, j) => (
                              <li key={j}>
                                <ReactMarkdown>{r}</ReactMarkdown>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p>No reasoning summary came back this turn.</p>
                        )}
                      </details>
                    </div>
                  </div>
                ),
              )}

              {busy && (
                <div className="row bot">
                  <FrogLabubu className="avatar bouncing" sticker={false} mood="happy" />
                  <div className="msg bot thinking">
                    <span className="dot" />
                    <span className="dot" />
                    <span className="dot" />
                    <em>Froggy is reading…</em>
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>

            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault()
                void send(draft)
              }}
            >
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send(draft)
                  }
                }}
                placeholder={page ? 'Ask Froggy about this document…' : 'Pick a document first'}
                rows={2}
                disabled={busy || !page}
              />
              <button type="submit" disabled={busy || !draft.trim() || !page}>
                Send
              </button>
            </form>
          </section>
        ) : (
          <button type="button" className="chat-launcher" onClick={() => setChatOpen(true)} title="Chat with Froggy">
            <FrogLabubu className="launcher-labubu" sticker={false} mood="cheeky" />
            {messages.length > 0 && <span className="launcher-badge">{messages.length}</span>}
          </button>
        ))}
    </div>
  )
}
