import { Link } from 'react-router-dom'
import { formatPrice } from '../api'
import type { Product } from '../types'

/** The fields a card needs; both catalogue products and chat results have them. */
export type CardProduct = Pick<Product, 'product_id' | 'name' | 'garment_type' | 'description' | 'image_url' | 'price'> & {
  sold_out?: boolean
}

export default function ProductCard({ product }: { product: CardProduct }) {
  return (
    <Link to={`/products/${product.product_id}`} className="product-card">
      <div className="product-card-image">
        <img src={product.image_url} alt={product.name} loading="lazy" />
        {product.sold_out && <span className="product-card-badge">Sold out</span>}
      </div>
      <div className="product-card-body">
        <p className="product-card-type">{product.garment_type}</p>
        <h3 className="product-card-name">{product.name}</h3>
        <p className="product-card-desc">{product.description}</p>
        <p className="product-card-price">{formatPrice(product.price)}</p>
      </div>
    </Link>
  )
}
