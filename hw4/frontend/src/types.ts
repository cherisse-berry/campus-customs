export interface Product {
  product_id: string
  name: string
  garment_type: string
  category: string
  description: string
  colors: string[]
  search_tags: string[]
  image_url: string
  price: number
  total_stock: number
  /** Quantity per size (on product lists), for availability on cards. */
  stock?: SizeStock[]
}

export interface SizeStock {
  size: string
  quantity: number
}

export interface ProductDetail extends Product {
  inventory: SizeStock[]
}

export interface Category {
  slug: string
  name: string
  count: number
}

export type SortOrder = 'name' | 'price-asc' | 'price-desc'
