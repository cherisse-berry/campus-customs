import { useEffect, useRef, useState, type FormEvent } from 'react'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Produces the assistant's reply. This is a placeholder until the AI agent
 * is connected; swap it for a call to the backend chat endpoint later.
 */
export type ReplyFn = (history: ChatMessage[]) => Promise<string>

const placeholderReply: ReplyFn = async () =>
  "Thanks for your message! The Campus Customs assistant isn't connected yet. In the meantime, browse the Shop page to see every style."

const greeting: ChatMessage = {
  role: 'assistant',
  content: "Hi! I'm the Campus Customs assistant. Ask me about products, sizes or stock.",
}

export default function ChatWidget({ getReply = placeholderReply }: { getReply?: ReplyFn }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([greeting])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [messages, open])

  async function send(e: FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || sending) return
    const history: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(history)
    setDraft('')
    setSending(true)
    try {
      const reply = await getReply(history)
      setMessages((m) => [...m, { role: 'assistant', content: reply }])
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }])
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="chat">
      {open && (
        <section className="chat-panel" role="dialog" aria-label="Campus Customs chat">
          <header className="chat-header">
            <div>
              <p className="chat-title">Campus Customs Assistant</p>
              <p className="chat-subtitle">AI assistant · coming soon</p>
            </div>
            <button className="chat-close" aria-label="Close chat" onClick={() => setOpen(false)}>
              ×
            </button>
          </header>
          <div className="chat-messages" aria-live="polite">
            {messages.map((m, i) => (
              <div key={i} className={`chat-bubble chat-${m.role}`}>
                {m.content}
              </div>
            ))}
            {sending && <div className="chat-bubble chat-assistant chat-typing">Typing…</div>}
            <div ref={endRef} />
          </div>
          <form className="chat-form" onSubmit={send}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type a message…"
              aria-label="Message"
            />
            <button type="submit" className="btn" disabled={!draft.trim() || sending}>
              Send
            </button>
          </form>
        </section>
      )}
      <button
        className="chat-launcher"
        aria-label={open ? 'Close chat' : 'Open chat'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
            <path
              d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6A.5.5 0 0 1 5 19.2V16a2.5 2.5 0 0 1-1-2V5.5z"
              fill="currentColor"
            />
          </svg>
        )}
      </button>
    </div>
  )
}
