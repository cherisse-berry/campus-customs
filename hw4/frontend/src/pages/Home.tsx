import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { fetchCategories, fetchProducts, useAsync } from '../api'
import { openChat } from '../chatEvents'
import ProductCard from '../components/ProductCard'
import RecentlyViewed from '../components/RecentlyViewed'
import { ProductGridSkeleton } from '../components/Skeleton'
import { ErrorMessage } from '../components/Status'
import type { Product } from '../types'

const FEATURED_IDS = [
  'champion-reverse-weave-hoodie-1',
  'district-vit-crewneck-vintage-bulldog',
  '2025-yale-vs-harvard-t-shirt',
  'brooks-brothers-bomber-jacket-yale',
]

// Products pictured in the hero collage (all with light backgrounds, so they sit well together).
const HERO_IDS = ['champion-reverse-weave-hoodie-1', 'district-vit-crewneck-vintage-bulldog', '2025-yale-vs-harvard-t-shirt']

// One photo to represent each category tile.
const CATEGORY_IMAGES: Record<string, string> = {
  't-shirts': 'yale-bowl-t-shirt',
  'quarter-zips': 'branford-1-4-zip',
  hoodies: 'champion-reverse-weave-hoodie-1',
  'fleece-jackets': 'saybrook-sweater-fleece-jacket',
  crewnecks: 'district-vit-crewneck-vintage-bulldog',
  'long-sleeves': 'ua-mens-tech-l-s-2-0',
}

const FAMILY = ['Mom', 'Dad', 'Grandma', 'Grandpa', 'Aunt', 'Uncle', 'Cousin']

const SAMPLE_QUESTIONS = [
  'What hoodies do you have?',
  'Anything with a bulldog on it?',
  'I need a gift for my dad',
  'Do you have a navy crewneck in XL?',
]

function pick(products: Product[], ids: string[]) {
  return ids.map((id) => products.find((p) => p.product_id === id)).filter((p) => p !== undefined)
}

export default function Home() {
  const products = useAsync(() => fetchProducts(), 'all')
  const categories = useAsync(fetchCategories, 'categories')

  const all = products.status === 'ready' ? products.data : []
  const featured = pick(all, FEATURED_IDS)
  const heroProducts = pick(all, HERO_IDS)
  const image = (id: string) => all.find((p) => p.product_id === id)?.image_url

  return (
    <>
      <section className="hero">
        <div className="hero-pattern" aria-hidden="true" />
        <div className="container hero-inner">
          <div className="hero-copy">
            <p className="eyebrow">Yale apparel · New Haven</p>
            <h1>
              Wear your <em>Bulldog</em> pride.
            </h1>
            <p className="hero-lead">
              Hoodies, crewnecks, tees and quarter-zips for students, alumni and the whole Yale family.
            </p>
            <div className="hero-actions">
              <Link to="/products" className="btn btn-light btn-large">
                Shop all products <span aria-hidden="true">→</span>
              </Link>
              <button className="btn btn-outline-light btn-large" onClick={() => openChat()}>
                Ask our assistant
              </button>
            </div>
            <dl className="hero-stats">
              <div>
                <dt>Styles</dt>
                <dd>{all.length || 102}</dd>
              </div>
              <div>
                <dt>Sizes</dt>
                <dd>XS–XXL</dd>
              </div>
              <div>
                <dt>Stock</dt>
                <dd>Live</dd>
              </div>
            </dl>
          </div>

          <div className="hero-collage" aria-hidden="true">
            {heroProducts.map((p, i) => (
              <div key={p.product_id} className={`hero-tile hero-tile-${i + 1}`}>
                <img src={p.image_url} alt="" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section container">
        <div className="section-head">
          <div>
            <p className="eyebrow eyebrow-accent">Browse</p>
            <h2>Shop by category</h2>
          </div>
          <Link to="/products" className="link-arrow">View all →</Link>
        </div>
        {categories.status === 'loading' && <div className="category-grid category-grid-loading" aria-hidden="true" />}
        {categories.status === 'error' && <ErrorMessage message="We couldn't load categories." />}
        {categories.status === 'ready' && (
          <div className="category-grid">
            {categories.data.map((c, i) => (
              <Link
                key={c.slug}
                to={`/products?category=${c.slug}`}
                className="category-tile"
                style={{ '--i': i } as CSSProperties}
              >
                <span className="category-thumb">
                  {image(CATEGORY_IMAGES[c.slug]) && <img src={image(CATEGORY_IMAGES[c.slug])} alt="" loading="lazy" />}
                </span>
                <span className="category-name">{c.name}</span>
                <span className="category-count">{c.count} styles</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="section container">
        <div className="section-head">
          <div>
            <p className="eyebrow eyebrow-accent">Staff picks</p>
            <h2>Featured</h2>
          </div>
          <Link to="/products" className="link-arrow">Shop the collection →</Link>
        </div>
        {products.status === 'loading' && <ProductGridSkeleton count={4} />}
        {products.status === 'error' && <ErrorMessage message="We couldn't load products." />}
        {products.status === 'ready' && (
          <div className="product-grid">
            {featured.map((p, i) => (
              <ProductCard key={p.product_id} product={p} index={i} />
            ))}
          </div>
        )}
      </section>

      <section className="assistant-band">
        <div className="container assistant-band-inner">
          <div className="assistant-band-copy">
            <p className="eyebrow">Not sure where to start?</p>
            <h2>Ask our shopping assistant</h2>
            <p>
              It knows every product, price and size in stock, finds similar styles when something's sold out, and
              shows what it finds right on the page.
            </p>
          </div>
          <div className="assistant-band-questions" role="group" aria-label="Try asking">
            {SAMPLE_QUESTIONS.map((q) => (
              <button key={q} className="question-chip" onClick={() => openChat(q)}>
                <span aria-hidden="true">“</span>
                {q}
                <span aria-hidden="true">”</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="container">
        <RecentlyViewed />
      </div>

      <section className="banner">
        <div className="container banner-inner">
          <div>
            <p className="eyebrow">For everyone who cheers for Yale</p>
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
