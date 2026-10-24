import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useChatResults } from '../chatResults'
import ProductCard from './ProductCard'

/**
 * Products the shopping assistant found, shown at the top of the page.
 * On a product's own page it shrinks to a bar, so the details stay in view.
 */
export default function ChatResultsPanel() {
  const { current, revealToken, clear } = useChatResults()
  const { pathname } = useLocation()
  const onProductPage = /^\/products\/[^/]+$/.test(pathname)
  const [expanded, setExpanded] = useState(!onProductPage)
  const ref = useRef<HTMLElement>(null)

  // Expanded on most pages; collapsed when opening a product from the results.
  useEffect(() => {
    setExpanded(!onProductPage)
  }, [onProductPage])

  // New results or a "show me" from the chat: expand and scroll into view.
  useEffect(() => {
    if (revealToken === 0) return
    setExpanded(true)
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    requestAnimationFrame(() =>
      ref.current?.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }),
    )
  }, [revealToken])

  if (!current || current.results.length === 0) return null
  const { question, results, more } = current
  const total = more?.total ?? results.length
  const count = `${total} ${total === 1 ? 'product' : 'products'}`

  return (
    <section ref={ref} className="chat-results" aria-label="Products from your chat">
      <div className="container">
        <div className="chat-results-head">
          <div className="chat-results-title">
            <p className="eyebrow">From your chat</p>
            <h2>
              {count} for “{question}”
            </h2>
          </div>
          <div className="chat-results-actions">
            <button
              className="btn btn-small btn-secondary"
              aria-expanded={expanded}
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? 'Hide' : 'Show products'}
            </button>
            <button className="chat-results-close" aria-label="Close chat results" onClick={clear}>
              ×
            </button>
          </div>
        </div>
        {expanded && (
          <>
            {more && (
              <p className="chat-results-more">
                Showing {results.length} of {more.total}.{' '}
                <Link to={more.link} className="link-arrow">
                  See all {more.total} in the shop →
                </Link>
              </p>
            )}
            <div className="product-grid chat-results-grid">
              {results.map((p, i) => (
                <ProductCard key={p.product_id} product={p} index={i} />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
