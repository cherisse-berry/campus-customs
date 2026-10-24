// Serverless data source for the static preview build (`npm run build:preview`).
// Mirrors the FastAPI endpoints using a JSON snapshot exported from the database.
import type { Category, Product, ProductDetail } from './types'
import type { ProductQuery } from './api'

interface Catalog {
  categories: { slug: string; name: string }[]
  products: ProductDetail[]
}

let catalog: Promise<Catalog> | null = null

function load(): Promise<Catalog> {
  catalog ??= fetch('data/catalog.json').then((r) => {
    if (!r.ok) throw new Error(`Request failed (${r.status})`)
    return r.json() as Promise<Catalog>
  })
  return catalog
}

export async function staticProducts({ category, q, sort }: ProductQuery): Promise<Product[]> {
  let items = (await load()).products
  if (category) items = items.filter((p) => p.category === category)
  if (q) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
    items = items.filter((p) => {
      const haystack = [p.name, p.description, p.garment_type, ...p.colors, ...p.search_tags].join(' ').toLowerCase()
      return terms.every((t) => haystack.includes(t))
    })
  }
  items = [...items]
  if (sort === 'price-asc') items.sort((a, b) => a.price - b.price || a.name.localeCompare(b.name))
  else if (sort === 'price-desc') items.sort((a, b) => b.price - a.price || a.name.localeCompare(b.name))
  return items
}

export async function staticProduct(id: string): Promise<ProductDetail | undefined> {
  return (await load()).products.find((p) => p.product_id === id)
}

export async function staticCategories(): Promise<Category[]> {
  const { categories, products } = await load()
  return categories.map((c) => ({ ...c, count: products.filter((p) => p.category === c.slug).length }))
}
