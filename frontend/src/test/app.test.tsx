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

const testUser = { id: 1, name: 'Test User', first_name: 'Test', last_name: 'User', email: 'test@campuscustoms.yale.edu' }

function mockApi() {
  let loggedIn = false
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    if (url === '/api/auth/me') return loggedIn ? json(testUser) : json({ detail: 'Not logged in.' }, 401)
    if (url === '/api/auth/login') {
      if (body.email !== testUser.email || body.password !== 'password')
        return json({ detail: 'Incorrect email or password.' }, 401)
      loggedIn = true
      return json(testUser)
    }
    if (url === '/api/auth/register') {
      if (body.email === testUser.email)
        return json({ detail: 'An account with this email already exists. Try logging in.' }, 409)
      loggedIn = true
      return json({ id: 4, name: `${body.first_name} ${body.last_name}`, ...body, password: undefined }, 201)
    }
    if (url === '/api/auth/logout') {
      loggedIn = false
      return new Response(null, { status: 204 })
    }
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

  async function fillSignup(email: string, password: string, confirm = password) {
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('First name'), 'Ada')
    await user.type(screen.getByLabelText('Last name'), 'Lovelace')
    await user.type(screen.getByLabelText('Email'), email)
    await user.type(screen.getByLabelText('Password'), password)
    await user.type(screen.getByLabelText('Confirm password'), confirm)
    await user.click(screen.getByRole('button', { name: 'Create account' }))
  }

  const posts = (fetchMock: ReturnType<typeof mockApi>) =>
    fetchMock.mock.calls.filter((c) => c[1]?.method === 'POST').map((c) => String(c[0]))

  it('create account checks the form before sending it', async () => {
    const fetchMock = mockApi()
    renderAt('/create-account')
    await fillSignup('ada@yale.edu', 'short')
    expect(screen.getByRole('alert')).toHaveTextContent('at least 8 characters')
    expect(posts(fetchMock)).toEqual([])
  })

  it('creating an account logs the customer in', async () => {
    const fetchMock = mockApi()
    renderAt('/create-account')
    await fillSignup('ada@yale.edu', 'analytical-engine')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(await within(nav).findByText('Hi, Ada')).toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'Log In' })).not.toBeInTheDocument()
    expect(posts(fetchMock)).toEqual(['/api/auth/register'])
    const sent = JSON.parse(String(fetchMock.mock.calls.find((c) => c[0] === '/api/auth/register')![1]!.body))
    expect(sent).toEqual({ first_name: 'Ada', last_name: 'Lovelace', email: 'ada@yale.edu', password: 'analytical-engine' })
  })

  it('shows the server error when the email is already registered', async () => {
    mockApi()
    renderAt('/create-account')
    await fillSignup(testUser.email, 'password123')
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
  })

  it('logs in, then logs out', async () => {
    mockApi()
    renderAt('/login')
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Email'), testUser.email)
    await user.type(screen.getByLabelText('Password'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.')

    await user.clear(screen.getByLabelText('Password'))
    await user.type(screen.getByLabelText('Password'), 'password')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(await within(nav).findByText('Hi, Test')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Wear your Bulldog pride.' })).toBeInTheDocument()

    await user.click(within(nav).getByRole('button', { name: 'Log Out' }))
    expect(await within(nav).findByRole('link', { name: 'Log In' })).toBeInTheDocument()
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
