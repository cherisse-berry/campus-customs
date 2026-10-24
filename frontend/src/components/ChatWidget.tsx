import { useEffect, useRef, useState, type FormEvent } from 'react'
import Markdown from 'react-markdown'
import { Link } from 'react-router-dom'
import { formatPrice } from '../api'
import { useAuth } from '../authContext'
import { fetchChatHistory, sendChatMessage, type ChatMessage, type ChatProduct } from '../chatApi'

const greeting: ChatMessage = {
  role: 'assistant',
  content: "Hi! I'm the Campus Customs assistant. Ask me about products, sizes, stock or gift ideas.",
}

const suggestions = ['What hoodies do you have?', 'Gift ideas for a Yale dad', 'Anything with a bulldog?']

function ProductCards({ products }: { products: ChatProduct[] }) {
  return (
    <div className="chat-products">
      {products.map((p) => (
        <Link key={p.product_id} to={`/products/${p.product_id}`} className="chat-product">
          <img src={p.image_url} alt="" loading="lazy" />
          <span className="chat-product-name">{p.name}</span>
          <span className="chat-product-price">{formatPrice(p.price)}</span>
        </Link>
      ))}
    </div>
  )
}

export default function ChatWidget() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([greeting])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const userId = user?.id

  // A logged-in customer sees their saved conversation; logging in or out starts fresh.
  useEffect(() => {
    if (userId === undefined) {
      setMessages([greeting])
      return
    }
    let cancelled = false
    fetchChatHistory().then((saved) => !cancelled && setMessages([greeting, ...saved]))
    return () => {
      cancelled = true
    }
  }, [userId])

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [messages, open, sending])

  async function send(text: string) {
    text = text.trim()
    if (!text || sending) return
    const earlier = messages.slice(1) // the greeting isn't part of the conversation
    setMessages((m) => [...m, { role: 'user', content: text }])
    setDraft('')
    setSending(true)
    try {
      const { reply, products } = await sendChatMessage(text, earlier)
      setMessages((m) => [...m, { role: 'assistant', content: reply, products }])
    } catch (err) {
      const content = err instanceof Error ? err.message : 'Sorry, something went wrong. Please try again.'
      setMessages((m) => [...m, { role: 'assistant', content, error: true }])
    } finally {
      setSending(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    send(draft)
  }

  return (
    <div className="chat">
      {open && (
        <section className="chat-panel" role="dialog" aria-label="Campus Customs chat">
          <header className="chat-header">
            <div>
              <p className="chat-title">Campus Customs Assistant</p>
              <p className="chat-subtitle">AI assistant · answers may contain mistakes</p>
            </div>
            <button className="chat-close" aria-label="Close chat" onClick={() => setOpen(false)}>
              ×
            </button>
          </header>
          <div className="chat-messages" aria-live="polite">
            {messages.map((m, i) => (
              <div key={i} className={`chat-turn chat-turn-${m.role}`}>
                <div className={`chat-bubble chat-${m.role} ${m.error ? 'chat-error' : ''}`}>
                  {m.role === 'assistant' && !m.error ? <Markdown>{m.content}</Markdown> : m.content}
                </div>
                {m.products && m.products.length > 0 && <ProductCards products={m.products} />}
              </div>
            ))}
            {messages.length === 1 && !sending && (
              <div className="chat-suggestions">
                {suggestions.map((s) => (
                  <button key={s} className="chip" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            {sending && (
              <div className="chat-bubble chat-assistant chat-typing" aria-label="Assistant is typing">
                <span />
                <span />
                <span />
              </div>
            )}
            <div ref={endRef} />
          </div>
          <form className="chat-form" onSubmit={onSubmit}>
            <input
              id="chat-message"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about products, sizes or stock…"
              aria-label="Message"
              maxLength={1000}
              autoComplete="off"
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
