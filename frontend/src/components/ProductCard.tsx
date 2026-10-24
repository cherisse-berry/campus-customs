import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { formatPrice } from '../api'
import { availability } from '../stock'
import type { Product, SizeStock } from '../types'
import StockSizes from './StockSizes'

/** The fields a card needs; both catalogue products and chat results have them. */
export type CardProduct = Pick<Product, 'product_id' | 'name' | 'garment_type' | 'description' | 'image_url' | 'price'> & {
  sold_out?: boolean
  stock?: SizeStock[]
}

/** `index` staggers the cards' entrance animation in a grid. */
export default function ProductCard({ product, index = 0 }: { product: CardProduct; index?: number }) {
  const stock = product.stock && product.stock.length > 0 ? product.stock : null
  const summary = stock ? availability(stock) : null
  const soldOut = product.sold_out || summary?.level === 'out'
  return (
    <Link
      to={`/products/${product.product_id}`}
      className="product-card"
      style={{ '--i': Math.min(index, 11) } as CSSProperties}
    >
      <div className="product-card-image">
        <img src={product.image_url} alt={product.name} loading="lazy" />
        {soldOut && <span className="product-card-badge">Sold out</span>}
        <span className="product-card-cta" aria-hidden="true">
          View details →
        </span>
      </div>
      <div className="product-card-body">
        <p className="product-card-type">{product.garment_type}</p>
        <h3 className="product-card-name">{product.name}</h3>
        <p className="product-card-desc">{product.description}</p>
        <div className="product-card-footer">
          <p className="product-card-price">{formatPrice(product.price)}</p>
          {summary && <p className={`product-card-stock stock-text-${summary.level}`}>{summary.label}</p>}
        </div>
        {stock && <StockSizes stock={stock} />}
      </div>
    </Link>
  )
}
