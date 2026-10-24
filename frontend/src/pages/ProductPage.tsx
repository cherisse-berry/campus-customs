import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { NotFoundError, fetchProduct, formatPrice, useAsync } from '../api'
import { ErrorMessage, Loading } from '../components/Status'
import type { SizeStock } from '../types'

const LOW_STOCK = 5

function stockLabel({ quantity }: SizeStock): string {
  if (quantity === 0) return 'Sold out'
  if (quantity <= LOW_STOCK) return `Only ${quantity} left`
  return `${quantity} in stock`
}

export default function ProductPage() {
  const { productId = '' } = useParams()
  const product = useAsync(() => fetchProduct(productId), productId)
  const [selected, setSelected] = useState<string | null>(null)

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
              <li key={c}>{c}</li>
            ))}
          </ul>

          <p className="detail-label">
            Size {chosen && <span className="muted">· {chosen.size}: {stockLabel(chosen)}</span>}
          </p>
          <div className="size-grid" role="group" aria-label="Choose a size">
            {p.inventory.map((s) => (
              <button
                key={s.size}
                className={`size-btn ${selected === s.size ? 'size-selected' : ''}`}
                disabled={s.quantity === 0}
                aria-pressed={selected === s.size}
                onClick={() => setSelected(s.size)}
              >
                {s.size}
              </button>
            ))}
          </div>

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
                      className={`stock-pill ${
                        s.quantity === 0 ? 'stock-out' : s.quantity <= LOW_STOCK ? 'stock-low' : 'stock-ok'
                      }`}
                    >
                      {stockLabel(s)}
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
    </div>
  )
}
