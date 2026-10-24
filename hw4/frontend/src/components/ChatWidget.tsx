import { useEffect, useRef, useState, type FormEvent } from 'react'
import Markdown from 'react-markdown'
import { Link, useLocation } from 'react-router-dom'
import { fetchProduct, formatPrice, useAsync } from '../api'
import { useAuth } from '../authContext'
import { fetchChatHistory, sendChatMessage, type ChatMessage, type ChatProduct } from '../chatApi'
import { useChatResults } from '../chatResults'
import { onOpenChat } from '../chatEvents'

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

function lastIndexOf<T>(items: T[], test: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (test(items[i])) return i
  return -1
}

/** Wide screens show the results beside the open chat; on phones the chat covers the page. */
const isWideScreen = () => window.matchMedia?.('(min-width: 700px)').matches ?? true

/** The product page the customer is on, from the URL (/products/:id). */
function useViewedProductId(): string | null {
  const match = useLocation().pathname.match(/^\/products\/([^/]+)$/)
  return match ? decodeURIComponent(match[1]) : null
}

export default function ChatWidget() {
  const { user } = useAuth()
  const viewingId = useViewedProductId()
  const viewedProduct = useAsync(
    () => (viewingId ? fetchProduct(viewingId) : Promise.resolve(null)),
    `viewing:${viewingId ?? ''}`,
  )
  const viewing =
    viewedProduct.status === 'ready' && viewedProduct.data
      ? { product_id: viewedProduct.data.product_id, name: viewedProduct.data.name }
      : null
  const { show, reveal, clear } = useChatResults()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([greeting])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const sendRef = useRef<(text: string) => void>(() => {})
  const userId = user?.id

  // A logged-in customer sees their saved conversation; logging in or out starts fresh.
  useEffect(() => {
    clear()
    if (userId === undefined) {
      setMessages([greeting])
      return
    }
    let cancelled = false
    fetchChatHistory().then((saved) => {
      if (cancelled) return
      setMessages([greeting, ...saved])
      // Put the last set of products the assistant found back on the page.
      const last = lastIndexOf(saved, (m) => m.role === 'assistant' && (m.results?.length ?? 0) > 0)
      if (last >= 0) {
        const asked = lastIndexOf(saved.slice(0, last), (m) => m.role === 'user')
        show(asked >= 0 ? saved[asked].content : 'your chat', saved[last].results!, false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [userId, show, clear])

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [messages, open, sending])

  // Lets the page make room for the open chat (see .chat-open in index.css).
  useEffect(() => {
    document.body.classList.toggle('chat-open', open)
    if (open) inputRef.current?.focus({ preventScroll: true })
    return () => document.body.classList.remove('chat-open')
  }, [open])

  // Other parts of the page can open the chat, optionally asking a question right away.
  useEffect(
    () =>
      onOpenChat((message) => {
        setOpen(true)
        if (message) sendRef.current(message)
      }),
    [],
  )

  async function send(text: string) {
    text = text.trim()
    if (!text || sending) return
    const earlier = messages.slice(1) // the greeting isn't part of the conversation
    setMessages((m) => [...m, { role: 'user', content: text, viewing }])
    setDraft('')
    setSending(true)
    try {
      const { reply, products = [], results = [], more_results, suggestions = [] } = await sendChatMessage(text, earlier, viewing?.product_id ?? null)
      setMessages((m) => [...m, { role: 'assistant', content: reply, products, results, suggestions }])
      if (results.length > 0) show(text, results, isWideScreen(), more_results)
    } catch (err) {
      const content = err instanceof Error ? err.message : 'Sorry, something went wrong. Please try again.'
      setMessages((m) => [...m, { role: 'assistant', content, error: true }])
    } finally {
      setSending(false)
    }
  }

  sendRef.current = send

  const lastWithResults = lastIndexOf(messages, (m) => m.role === 'assistant' && (m.results?.length ?? 0) > 0)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    send(draft)
  }

  return (
    <div className="chat">
      {open && (
        <section className="chat-panel" role="dialog" aria-label="Campus Customs chat">
          <header className="chat-header">
            <span className="chat-avatar" aria-hidden="true">
              CC
            </span>
            <div className="chat-heading">
              <p className="chat-title">Campus Customs Assistant</p>
              <p className="chat-subtitle">
                {user
                  ? `Signed in as ${user.name} · this chat is saved`
                  : 'Guest · log in to save this chat'}
              </p>
            </div>
            <button className="chat-close" aria-label="Close chat" onClick={() => setOpen(false)}>
              ×
            </button>
          </header>
          <div className="chat-messages" aria-live="polite">
            {messages.map((m, i) => (
              <div key={i} className={`chat-turn chat-turn-${m.role}`}>
                {m.viewing && <span className="chat-about">About: {m.viewing.name}</span>}
                <div className={`chat-bubble chat-${m.role} ${m.error ? 'chat-error' : ''}`}>
                  {m.role === 'assistant' && !m.error ? <Markdown>{m.content}</Markdown> : m.content}
                </div>
                {m.products && m.products.length > 0 && <ProductCards products={m.products} />}
                {i === messages.length - 1 && !sending && m.suggestions && m.suggestions.length > 0 && (
                  <div className="chat-quick-replies" role="group" aria-label="Suggested answers">
                    {m.suggestions.map((s) => (
                      <button key={s} className="chip" onClick={() => send(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                )}
                {i === lastWithResults && (
                  <button
                    className="chat-see-results"
                    onClick={() => {
                      if (!isWideScreen()) setOpen(false)
                      reveal()
                    }}
                  >
                    See {m.results!.length} {m.results!.length === 1 ? 'product' : 'products'} on the page
                  </button>
                )}
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
          {viewing && (
            <p className="chat-context" aria-live="polite">
              Asking about: <strong>{viewing.name}</strong>
            </p>
          )}
          <form className="chat-form" onSubmit={onSubmit}>
            <input
              ref={inputRef}
              id="chat-message"
              aria-describedby="chat-disclaimer"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={viewing ? 'Ask about this product…' : 'Ask about products, sizes or stock…'}
              aria-label="Message"
              maxLength={1000}
              autoComplete="off"
            />
            <button type="submit" className="chat-send" aria-label="Send" disabled={!draft.trim() || sending}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="M4 12h14M12 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </form>
          <p className="chat-disclaimer" id="chat-disclaimer">
            AI assistant · answers can contain mistakes. Please don't share card numbers or passwords.
          </p>
        </section>
      )}
      <button
        className={`chat-launcher ${open ? 'chat-launcher-open' : ''}`}
        aria-label={open ? 'Close chat' : 'Open chat'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        ) : (
          <>
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path
                d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6A.5.5 0 0 1 5 19.2V16a2.5 2.5 0 0 1-1-2V5.5z"
                fill="currentColor"
              />
            </svg>
            <span className="chat-launcher-label" aria-hidden="true">
              Ask our assistant
            </span>
          </>
        )}
      </button>
    </div>
  )
}
