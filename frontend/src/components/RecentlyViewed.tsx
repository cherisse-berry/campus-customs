import { fetchProducts, useAsync } from '../api'
import { clearRecentlyViewed, useRecentlyViewed } from '../recentlyViewed'
import ProductCard from './ProductCard'

/** The products this browser viewed most recently, with live prices and stock. */
export default function RecentlyViewed({ excludeId, max = 4 }: { excludeId?: string; max?: number }) {
  const ids = useRecentlyViewed().filter((id) => id !== excludeId).slice(0, max)
  // One request for the whole catalogue (it includes stock), then pick the viewed ones in order.
  const products = useAsync(() => fetchProducts(), ids.length ? 'recently-viewed' : 'recently-viewed-none')

  if (ids.length === 0 || products.status !== 'ready') return null
  const byId = new Map(products.data.map((p) => [p.product_id, p]))
  const viewed = ids.map((id) => byId.get(id)).filter((p) => p !== undefined)
  if (viewed.length === 0) return null

  return (
    <section className="section recently-viewed" aria-labelledby="recently-viewed-title">
      <div className="section-head">
        <h2 id="recently-viewed-title">Recently viewed</h2>
        <button className="link-button" onClick={clearRecentlyViewed}>
          Clear
        </button>
      </div>
      <div className="product-grid">
        {viewed.map((p) => (
          <ProductCard key={p.product_id} product={p} />
        ))}
      </div>
    </section>
  )
}
