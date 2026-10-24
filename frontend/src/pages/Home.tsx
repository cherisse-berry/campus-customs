import { Link } from 'react-router-dom'
import { fetchCategories, fetchProducts, useAsync } from '../api'
import ProductCard from '../components/ProductCard'
import { ErrorMessage, Loading } from '../components/Status'

const FEATURED_IDS = [
  'champion-reverse-weave-hoodie-1',
  'district-vit-crewneck-vintage-bulldog',
  '2025-yale-vs-harvard-t-shirt',
  'brooks-brothers-bomber-jacket-yale',
]

const FAMILY = ['Mom', 'Dad', 'Grandma', 'Grandpa', 'Aunt', 'Uncle', 'Cousin']

export default function Home() {
  const products = useAsync(() => fetchProducts(), 'all')
  const categories = useAsync(fetchCategories, 'categories')

  const featured =
    products.status === 'ready'
      ? FEATURED_IDS.map((id) => products.data.find((p) => p.product_id === id)).filter((p) => p !== undefined)
      : []

  return (
    <>
      <section className="hero">
        <div className="container hero-inner">
          <p className="eyebrow">Yale apparel · New Haven</p>
          <h1>Wear your Bulldog pride.</h1>
          <p className="hero-lead">
            Hoodies, crewnecks, tees and quarter-zips for students, alumni and the whole Yale family.
          </p>
          <div className="hero-actions">
            <Link to="/products" className="btn btn-light">Shop all products</Link>
            <Link to="/about" className="btn btn-outline-light">Our story</Link>
          </div>
        </div>
      </section>

      <section className="section container">
        <div className="section-head">
          <h2>Shop by category</h2>
          <Link to="/products" className="link-arrow">View all →</Link>
        </div>
        {categories.status === 'loading' && <Loading />}
        {categories.status === 'error' && <ErrorMessage message="We couldn't load categories." />}
        {categories.status === 'ready' && (
          <div className="category-grid">
            {categories.data.map((c) => (
              <Link key={c.slug} to={`/products?category=${c.slug}`} className="category-tile">
                <span className="category-name">{c.name}</span>
                <span className="category-count">{c.count} styles</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="section container">
        <div className="section-head">
          <h2>Featured</h2>
          <Link to="/products" className="link-arrow">Shop the collection →</Link>
        </div>
        {products.status === 'loading' && <Loading />}
        {products.status === 'error' && <ErrorMessage message="We couldn't load products." />}
        {products.status === 'ready' && (
          <div className="product-grid">
            {featured.map((p) => (
              <ProductCard key={p.product_id} product={p} />
            ))}
          </div>
        )}
      </section>

      <section className="banner">
        <div className="container banner-inner">
          <div>
            <h2>Gifts for the whole Yale family</h2>
            <p>Find a style for everyone who cheers for Yale.</p>
          </div>
          <div className="family-links">
            {FAMILY.map((f) => (
              <Link key={f} to={`/products?q=${f.toLowerCase()}`} className="btn btn-outline-light btn-small">
                Yale {f}
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
