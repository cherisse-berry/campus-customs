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

export default function ProductCard({ product }: { product: CardProduct }) {
  const stock = product.stock && product.stock.length > 0 ? product.stock : null
  const summary = stock ? availability(stock) : null
  const soldOut = product.sold_out || summary?.level === 'out'
  return (
    <Link to={`/products/${product.product_id}`} className="product-card">
      <div className="product-card-image">
        <img src={product.image_url} alt={product.name} loading="lazy" />
        {soldOut && <span className="product-card-badge">Sold out</span>}
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
