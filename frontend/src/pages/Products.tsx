import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fetchCategories, fetchProducts, useAsync } from '../api'
import ProductCard from '../components/ProductCard'
import { ErrorMessage, Loading } from '../components/Status'
import type { SortOrder } from '../types'

export default function Products() {
  const [params, setParams] = useSearchParams()
  const category = params.get('category') ?? ''
  const q = params.get('q') ?? ''
  const sort = (params.get('sort') as SortOrder | null) ?? 'name'

  const [search, setSearch] = useState(q)
  useEffect(() => {
    setSearch(q)
  }, [q])

  const categories = useAsync(fetchCategories, 'categories')
  const products = useAsync(() => fetchProducts({ category, q, sort }), `${category}|${q}|${sort}`)

  function update(changes: Record<string, string>) {
    // Build on the latest URL so quick successive filter changes aren't lost.
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(changes)) {
        if (v) next.set(k, v)
        else next.delete(k)
      }
      return next
    })
  }

  const title =
    categories.status === 'ready' && category
      ? categories.data.find((c) => c.slug === category)?.name ?? 'Products'
      : 'All Products'

  return (
    <div className="container section">
      <div className="page-head">
        <h1>{title}</h1>
        <p className="muted">Browse Yale hoodies, crewnecks, tees, quarter-zips and more.</p>
      </div>

      <div className="toolbar">
        <form
          className="search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            update({ q: search.trim() })
          }}
        >
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search e.g. bulldog, hockey, navy"
            aria-label="Search products"
          />
          <button type="submit" className="btn">Search</button>
        </form>
        <label className="sort">
          Sort by
          <select value={sort} onChange={(e) => update({ sort: e.target.value === 'name' ? '' : e.target.value })}>
            <option value="name">Name</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
          </select>
        </label>
      </div>

      {categories.status === 'ready' && (
        <div className="chips" role="group" aria-label="Filter by category">
          <button className={`chip ${!category ? 'chip-active' : ''}`} onClick={() => update({ category: '' })}>
            All
          </button>
          {categories.data.map((c) => (
            <button
              key={c.slug}
              className={`chip ${category === c.slug ? 'chip-active' : ''}`}
              onClick={() => update({ category: c.slug })}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {products.status === 'loading' && <Loading label="Loading products…" />}
      {products.status === 'error' && <ErrorMessage message="We couldn't load products." />}
      {products.status === 'ready' && (
        <>
          <p className="result-count">
            {products.data.length} {products.data.length === 1 ? 'product' : 'products'}
            {q && <> matching “{q}”</>}
          </p>
          {products.data.length === 0 ? (
            <div className="empty">
              <p>No products match your search.</p>
              <button className="btn" onClick={() => update({ q: '', category: '' })}>Clear filters</button>
            </div>
          ) : (
            <div className="product-grid">
              {products.data.map((p) => (
                <ProductCard key={p.product_id} product={p} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
