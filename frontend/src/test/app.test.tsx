import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { Category, ProductDetail } from '../types'

const hoodie: ProductDetail = {
  product_id: 'basic-hoodie-big-yale',
  name: 'Basic Hoodie Big Yale',
  garment_type: 'pullover hoodie',
  category: 'hoodies',
  description: 'Navy pullover hoodie with large white YALE lettering.',
  colors: ['navy blue', 'white'],
  search_tags: ['Yale hoodie'],
  image_url: '/media/products/basic-hoodie-big-yale.jpg',
  price: 68,
  total_stock: 33,
  inventory: [
    { size: 'XS', quantity: 15 },
    { size: 'S', quantity: 5 },
    { size: 'M', quantity: 0 },
    { size: 'L', quantity: 8 },
    { size: 'XL', quantity: 2 },
    { size: 'XXL', quantity: 3 },
  ],
}

const categories: Category[] = [{ slug: 'hoodies', name: 'Hoodies', count: 1 }]

function mockApi() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    if (url.startsWith('/api/categories')) return json(categories)
    if (url === `/api/products/${hoodie.product_id}`) return json(hoodie)
    if (url.startsWith('/api/products/')) return json({ detail: 'Product not found' }, 404)
    if (url.startsWith('/api/products')) return json([hoodie])
    throw new Error(`unexpected fetch ${url}`)
  })
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe('Campus Customs site', () => {
  it('shows the main navigation pages', () => {
    mockApi()
    renderAt('/')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    for (const label of ['Home', 'Shop', 'About Us', 'Log In', 'Create Account']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('lists products with image, price and description', async () => {
    mockApi()
    renderAt('/products')
    const card = await screen.findByRole('link', { name: /Basic Hoodie Big Yale/ })
    expect(within(card).getByRole('img')).toHaveAttribute('src', hoodie.image_url)
    expect(within(card).getByText('$68.00')).toBeInTheDocument()
    expect(within(card).getByText(hoodie.description)).toBeInTheDocument()
    expect(screen.getByText('1 product')).toBeInTheDocument()
  })

  it('sends search and category filters to the API', async () => {
    const fetchMock = mockApi()
    renderAt('/products')
    await userEvent.type(await screen.findByLabelText('Search products'), 'bulldog{enter}')
    await userEvent.click(await screen.findByRole('button', { name: 'Hoodies' }))
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls).toContain('/api/products?category=hoodies&q=bulldog')
  })

  it('product page shows each size with its current stock', async () => {
    mockApi()
    renderAt(`/products/${hoodie.product_id}`)
    expect(await screen.findByRole('heading', { name: hoodie.name })).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Current stock' })
    expect(within(table).getByText('15 in stock')).toBeInTheDocument()
    expect(within(table).getByText('Only 5 left')).toBeInTheDocument()
    expect(within(table).getByText('Sold out')).toBeInTheDocument()
    expect(within(table).getByText('33 available')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'M' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'L' })).toBeEnabled()
  })

  it('shows a not-found message for an unknown product', async () => {
    mockApi()
    renderAt('/products/nope')
    expect(await screen.findByRole('heading', { name: 'Product not found' })).toBeInTheDocument()
  })

  it('create account validates without saving anything', async () => {
    const fetchMock = mockApi()
    renderAt('/create-account')
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('First name'), 'Ada')
    await user.type(screen.getByLabelText('Last name'), 'Lovelace')
    await user.type(screen.getByLabelText('Email'), 'ada@yale.edu')
    await user.type(screen.getByLabelText('Password'), 'short')
    await user.type(screen.getByLabelText('Confirm password'), 'short')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByRole('alert')).toHaveTextContent('at least 8 characters')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('chat window opens in the corner and replies with a placeholder', async () => {
    mockApi()
    renderAt('/about')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open chat' }))
    const chat = screen.getByRole('dialog', { name: 'Campus Customs chat' })
    await user.type(within(chat).getByLabelText('Message'), 'Do you have hoodies?')
    await user.click(within(chat).getByRole('button', { name: 'Send' }))
    expect(within(chat).getByText('Do you have hoodies?')).toBeInTheDocument()
    expect(await within(chat).findByText(/isn't connected yet/)).toBeInTheDocument()
  })
})
