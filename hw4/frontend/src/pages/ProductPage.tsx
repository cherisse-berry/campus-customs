import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { NotFoundError, fetchProduct, formatPrice, useAsync } from '../api'
import RecentlyViewed from '../components/RecentlyViewed'
import { ErrorMessage, Loading } from '../components/Status'
import { addRecentlyViewed } from '../recentlyViewed'
import { openChat } from '../chatEvents'
import { LOW_STOCK, availability, stockLabel, stockLevel } from '../stock'
import type { SizeStock } from '../types'

// Approximate swatch colors for the color names used in the catalogue.
const SWATCHES: [string, string][] = [
  ['navy', '#1d2a4d'], ['charcoal', '#3f4248'], ['heather', '#9aa0a8'], ['gray', '#8e939b'], ['grey', '#8e939b'],
  ['white', '#ffffff'], ['black', '#111111'], ['red', '#b3262e'], ['green', '#2f6b45'], ['blue', '#2b5aa8'],
  ['pink', '#e8a1b8'], ['purple', '#5b3c88'], ['orange', '#d9692b'], ['yellow', '#e9c341'], ['gold', '#c6a052'],
  ['cream', '#efe7d4'], ['oatmeal', '#d9cdb5'], ['maroon', '#6b1f2b'], ['tan', '#c9a67a'], ['brown', '#6b4a2f'],
]

function swatch(color: string): string | undefined {
  const name = color.toLowerCase()
  return SWATCHES.find(([word]) => name.includes(word))?.[1]
}

/** "In stock in XS, S and L · Sold out in M" */
function sizeSummary(stock: SizeStock[]): string {
  const list = (sizes: string[]) =>
    sizes.length > 1 ? `${sizes.slice(0, -1).join(', ')} and ${sizes[sizes.length - 1]}` : sizes[0]
  const inStock = stock.filter((s) => s.quantity > 0).map((s) => s.size)
  const out = stock.filter((s) => s.quantity <= 0).map((s) => s.size)
  if (inStock.length === 0) return 'Sold out in every size'
  if (out.length === 0) return 'In stock in every size'
  return `In stock in ${list(inStock)} · Sold out in ${list(out)}`
}

export default function ProductPage() {
  const { productId = '' } = useParams()
  const product = useAsync(() => fetchProduct(productId), productId)
  const [selected, setSelected] = useState<string | null>(null)
  const loadedId = product.status === 'ready' ? product.data.product_id : null

  // Remember this product for "Recently viewed", and reset the size when moving between products.
  useEffect(() => {
    if (loadedId) addRecentlyViewed(loadedId)
    setSelected(null)
  }, [loadedId])

  if (product.status === 'loading') return <div className="container section"><Loading /></div>
  if (product.status === 'error') {
    return (
      <div className="container section">
        {product.error instanceof NotFoundError ? (
          <div className="empty">
            <h1>Product not found</h1>
            <p>We couldn't find that item.</p>
            <Link to="/products" className="btn">Back to shop</Link>
          </div>
        ) : (
          <ErrorMessage message="We couldn't load this product." />
        )}
      </div>
    )
  }

  const p = product.data
  const chosen = p.inventory.find((s) => s.size === selected)
  const summary = availability(p.inventory)
  const nearlyGone = p.inventory.filter((s) => stockLevel(s.quantity) === 'low')

  return (
    <div className="container section">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Home</Link> / <Link to="/products">Shop</Link> / <span>{p.name}</span>
      </nav>

      <div className="detail">
        <div className="detail-image">
          <img src={p.image_url} alt={p.name} />
        </div>

        <div className="detail-info">
          <p className="product-card-type">{p.garment_type}</p>
          <h1 className="detail-name">{p.name}</h1>
          <p className="detail-price">{formatPrice(p.price)}</p>
          <p className="detail-desc">{p.description}</p>

          <p className="detail-label">Colors</p>
          <ul className="color-list">
            {p.colors.map((c) => (
              <li key={c}>
                {swatch(c) && <span className="swatch" style={{ background: swatch(c) }} aria-hidden="true" />}
                {c}
              </li>
            ))}
          </ul>

          <div className={`availability availability-${summary.level}`} role="status">
            <span className="availability-dot" aria-hidden="true" />
            <div>
              <p className="availability-title">{sizeSummary(p.inventory)}</p>
              {nearlyGone.length > 0 && (
                <p className="availability-note">
                  Nearly gone: {nearlyGone.map((s) => `${s.size} (${s.quantity} left)`).join(', ')}
                </p>
              )}
            </div>
          </div>

          <p className="detail-label">
            Size {chosen && <span className="muted">· {chosen.size}: {stockLabel(chosen.quantity)}</span>}
          </p>
          <div className="size-grid" role="group" aria-label="Choose a size">
            {p.inventory.map((s) => (
              <button
                key={s.size}
                className={`size-btn size-${stockLevel(s.quantity)} ${selected === s.size ? 'size-selected' : ''}`}
                disabled={s.quantity === 0}
                aria-pressed={selected === s.size}
                aria-label={`${s.size}: ${stockLabel(s.quantity)}`}
                onClick={() => setSelected(s.size)}
              >
                <span className="size-name">{s.size}</span>
                <span className="size-stock">
                  {s.quantity <= 0 ? 'Sold out' : s.quantity <= LOW_STOCK ? `${s.quantity} left` : 'In stock'}
                </span>
              </button>
            ))}
          </div>

          <button className="btn btn-secondary btn-block ask-about" onClick={() => openChat()}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6A.5.5 0 0 1 5 19.2V16a2.5 2.5 0 0 1-1-2V5.5z"
                fill="currentColor"
              />
            </svg>
            Ask about sizing, colors or similar styles
          </button>

          <table className="stock-table">
            <caption>Current stock</caption>
            <thead>
              <tr>
                <th scope="col">Size</th>
                <th scope="col">Availability</th>
              </tr>
            </thead>
            <tbody>
              {p.inventory.map((s) => (
                <tr key={s.size}>
                  <td>{s.size}</td>
                  <td>
                    <span
                      className={`stock-pill stock-${stockLevel(s.quantity)}`}
                    >
                      {stockLabel(s.quantity)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td>{p.total_stock} available</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <RecentlyViewed excludeId={p.product_id} />
    </div>
  )
}
