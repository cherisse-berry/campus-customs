import { Link } from 'react-router-dom'
import { formatPrice } from '../api'
import type { Product } from '../types'

export default function ProductCard({ product }: { product: Product }) {
  return (
    <Link to={`/products/${product.product_id}`} className="product-card">
      <div className="product-card-image">
        <img src={product.image_url} alt={product.name} loading="lazy" />
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
