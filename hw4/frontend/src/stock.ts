import type { SizeStock } from './types'

/** 1-5 units counts as "only a few left" (same rule as the chatbot). */
export const LOW_STOCK = 5
export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const

export type StockLevel = 'ok' | 'low' | 'out'

export function stockLevel(quantity: number): StockLevel {
  if (quantity <= 0) return 'out'
  return quantity <= LOW_STOCK ? 'low' : 'ok'
}

export function stockLabel(quantity: number): string {
  if (quantity <= 0) return 'Sold out'
  if (quantity <= LOW_STOCK) return `Only ${quantity} left`
  return `${quantity} in stock`
}

/** A one-line summary for a product: overall level plus a short label. */
export function availability(stock: SizeStock[]): { level: StockLevel; label: string } {
  const inStock = stock.filter((s) => s.quantity > 0)
  if (stock.length === 0 || inStock.length === 0) return { level: 'out', label: 'Sold out' }
  // Nearly-gone sizes are marked on the size labels themselves, so the summary stays short.
  if (inStock.length === stock.length) return { level: 'ok', label: 'All sizes in stock' }
  return { level: 'low', label: `${inStock.length} of ${stock.length} sizes in stock` }
}
