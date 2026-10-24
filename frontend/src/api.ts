import { useEffect, useState } from 'react'
import type { Category, Product, ProductDetail, SortOrder } from './types'

export class NotFoundError extends Error {}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (res.status === 404) throw new NotFoundError('Not found')
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json() as Promise<T>
}

export interface ProductQuery {
  category?: string
  q?: string
  sort?: SortOrder
}

export function fetchProducts(query: ProductQuery = {}): Promise<Product[]> {
  const params = new URLSearchParams()
  if (query.category) params.set('category', query.category)
  if (query.q) params.set('q', query.q)
  if (query.sort && query.sort !== 'name') params.set('sort', query.sort)
  const qs = params.toString()
  return getJson(`/api/products${qs ? `?${qs}` : ''}`)
}

export function fetchProduct(id: string): Promise<ProductDetail> {
  return getJson(`/api/products/${encodeURIComponent(id)}`)
}

export function fetchCategories(): Promise<Category[]> {
  return getJson('/api/categories')
}

export function formatPrice(price: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(price)
}

type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'ready'; data: T }

/** Runs `load` whenever `key` changes and tracks loading / error / data. */
export function useAsync<T>(load: () => Promise<T>, key: string): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    load()
      .then((data) => !cancelled && setState({ status: 'ready', data }))
      .catch((error: Error) => !cancelled && setState({ status: 'error', error }))
    return () => {
      cancelled = true
    }
    // `key` captures everything `load` depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return state
}
