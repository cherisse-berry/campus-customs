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

const chatResults = [
  { product_id: hoodie.product_id, name: hoodie.name, garment_type: 'pullover hoodie', price: 68,
    image_url: hoodie.image_url, description: hoodie.description, sold_out: false },
  { product_id: 'yale-dad-hoodie', name: 'Yale Dad Hoodie', garment_type: 'pullover hoodie', price: 68,
    image_url: '/media/products/yale-dad-hoodie.jpg', description: 'Navy hoodie with YALE DAD lettering.', sold_out: true },
]

const savedChat = [
  { role: 'user', content: 'Earlier question', products: [], viewing: { product_id: 'yale-dad-hoodie', name: 'Yale Dad Hoodie' } },
  { role: 'assistant', content: 'Earlier answer', products: [], results: [chatResults[1]] },
]
let productQueries: string[] = []
let chatRequests: {
  message: string
  history: { role: string; content: string; viewing_product_id: string | null }[]
  viewing_product_id: string | null
}[] = []

function mockApi() {
  let loggedIn = false
  chatRequests = []
  productQueries = []
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
    if (url === '/api/chat/history') return json(loggedIn ? savedChat : [])
    if (url === '/api/chat') {
      if (body.message === 'break') return json({ detail: 'The assistant is having trouble right now.' }, 503)
      chatRequests.push(body)
      return json({
        reply: `You asked: **${body.message}**. Try the Basic Hoodie Big Yale.`,
        products: [{ product_id: hoodie.product_id, name: hoodie.name, price: 68, image_url: hoodie.image_url }],
        results: body.message.includes('thanks') ? [] : chatResults,
      })
    }
    if (url === '/api/auth/logout') {
      loggedIn = false
      return new Response(null, { status: 204 })
    }
    if (url.startsWith('/api/categories')) return json(categories)
    if (url === `/api/products/${hoodie.product_id}`) return json(hoodie)
    if (url.startsWith('/api/products/')) return json({ detail: 'Product not found' }, 404)
    if (url.startsWith('/api/products')) {
      productQueries.push(url)
      return json([{ ...hoodie, stock: hoodie.inventory }])
    }
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
    expect(screen.getByRole('button', { name: 'M: Sold out' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'L: 8 in stock' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'XL: Only 2 left' })).toBeEnabled()
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

  it('chat sends messages to the assistant and shows replies with product cards', async () => {
    mockApi()
    renderAt('/about')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open chat' }))
    const chat = screen.getByRole('dialog', { name: 'Campus Customs chat' })
    await user.type(within(chat).getByLabelText('Message'), 'Do you have hoodies?')
    await user.click(within(chat).getByRole('button', { name: 'Send' }))
    expect(within(chat).getByText('Do you have hoodies?', { selector: '.chat-user' })).toBeInTheDocument()
    // Markdown is rendered: the bold part becomes <strong>.
    expect(await within(chat).findByText('Do you have hoodies?', { selector: 'strong' })).toBeInTheDocument()
    const card = within(chat).getByRole('link', { name: /Basic Hoodie Big Yale/ })
    expect(card).toHaveAttribute('href', '/products/basic-hoodie-big-yale')
    expect(chatRequests[0]).toEqual({ message: 'Do you have hoodies?', history: [], viewing_product_id: null })

    // The guest's earlier turns go with the next message (without the greeting).
    await user.type(within(chat).getByLabelText('Message'), 'In XL?')
    await user.click(within(chat).getByRole('button', { name: 'Send' }))
    await within(chat).findByText('In XL?', { selector: 'strong' })
    expect(chatRequests[1].history.map((h) => h.role)).toEqual(['user', 'assistant'])
    expect(chatRequests[1].history[0].content).toBe('Do you have hoodies?')
  })

  it('chat suggestions send a message', async () => {
    mockApi()
    renderAt('/')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open chat' }))
    await user.click(screen.getByRole('button', { name: 'Anything with a bulldog?' }))
    expect(chatRequests[0].message).toBe('Anything with a bulldog?')
  })

  it('chat shows server errors in the conversation', async () => {
    mockApi()
    renderAt('/')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open chat' }))
    const chat = screen.getByRole('dialog', { name: 'Campus Customs chat' })
    await user.type(within(chat).getByLabelText('Message'), 'break')
    await user.click(within(chat).getByRole('button', { name: 'Send' }))
    expect(await within(chat).findByText('The assistant is having trouble right now.')).toBeInTheDocument()
  })

  it('logged-in customers see their saved chat', async () => {
    mockApi()
    renderAt('/login')
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Email'), testUser.email)
    await user.type(screen.getByLabelText('Password'), 'password')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    await screen.findByText('Hi, Test')
    await user.click(screen.getByRole('button', { name: 'Open chat' }))
    const chat = screen.getByRole('dialog', { name: 'Campus Customs chat' })
    expect(await within(chat).findByText('Earlier question')).toBeInTheDocument()
    expect(within(chat).getByText('Earlier answer')).toBeInTheDocument()
  })

  async function askInChat(text: string) {
    const user = userEvent.setup()
    if (!screen.queryByRole('dialog', { name: 'Campus Customs chat' }))
      await user.click(screen.getByRole('button', { name: 'Open chat' }))
    const chat = screen.getByRole('dialog', { name: 'Campus Customs chat' })
    await user.type(within(chat).getByLabelText('Message'), text)
    await user.click(within(chat).getByRole('button', { name: 'Send' }))
    return { user, chat }
  }

  it('shows the products the chatbot found on the page', async () => {
    mockApi()
    renderAt('/about')
    expect(screen.queryByRole('region', { name: 'Products from your chat' })).not.toBeInTheDocument()
    await askInChat('What hoodies do you have?')

    const panel = await screen.findByRole('region', { name: 'Products from your chat' })
    expect(within(panel).getByRole('heading', { name: '2 products for “What hoodies do you have?”' })).toBeInTheDocument()
    const card = within(panel).getByRole('link', { name: /Basic Hoodie Big Yale/ })
    expect(card).toHaveAttribute('href', '/products/basic-hoodie-big-yale')
    expect(within(card).getByRole('img')).toHaveAttribute('src', hoodie.image_url)
    expect(within(card).getByText('$68.00')).toBeInTheDocument()
    expect(within(card).getByText(hoodie.description)).toBeInTheDocument()
    // Sold-out products are marked.
    const dad = within(panel).getByRole('link', { name: /Yale Dad Hoodie/ })
    expect(within(dad).getByText('Sold out')).toBeInTheDocument()
    // The page content is still there below the panel.
    expect(screen.getByRole('heading', { name: 'Bulldog pride, made to wear.' })).toBeInTheDocument()
  })

  it('clicking a found product opens its detail page, with the results collapsed above', async () => {
    mockApi()
    renderAt('/')
    const { user } = await askInChat('hoodies please')
    const panel = await screen.findByRole('region', { name: 'Products from your chat' })
    await user.click(within(panel).getByRole('link', { name: /Basic Hoodie Big Yale/ }))
    expect(await screen.findByRole('table', { name: 'Current stock' })).toBeInTheDocument()

    const collapsed = screen.getByRole('region', { name: 'Products from your chat' })
    expect(within(collapsed).queryByRole('link')).not.toBeInTheDocument()
    await user.click(within(collapsed).getByRole('button', { name: 'Show products' }))
    expect(within(collapsed).getAllByRole('link')).toHaveLength(2)
  })

  it('keeps the last results when the chatbot finds nothing new, and can be closed', async () => {
    mockApi()
    renderAt('/')
    const { user } = await askInChat('hoodies')
    await screen.findByRole('region', { name: 'Products from your chat' })
    await askInChat('thanks!')
    await screen.findByText('thanks!', { selector: 'strong' })
    const panel = screen.getByRole('region', { name: 'Products from your chat' })
    expect(within(panel).getByRole('heading', { name: /for “hoodies”/ })).toBeInTheDocument()

    await user.click(within(panel).getByRole('button', { name: 'Close chat results' }))
    expect(screen.queryByRole('region', { name: 'Products from your chat' })).not.toBeInTheDocument()
  })

  it('says when the chatbot found more products than the page shows', async () => {
    const fetchMock = mockApi()
    const realImpl = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input) === '/api/chat')
        return new Response(JSON.stringify({
          reply: 'I found 27 hoodies.', products: [], results: chatResults,
          more_results: { total: 27, link: '/products?category=hoodies' },
        }))
      return realImpl(input, init)
    })
    renderAt('/')
    await askInChat('all hoodies')
    const panel = await screen.findByRole('region', { name: 'Products from your chat' })
    expect(within(panel).getByRole('heading', { name: '27 products for “all hoodies”' })).toBeInTheDocument()
    expect(within(panel).getByText(/Showing 2 of 27/)).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'See all 27 in the shop →' })).toHaveAttribute(
      'href', '/products?category=hoodies')
  })

  it('the chat links to the products shown on the page', async () => {
    mockApi()
    renderAt('/')
    const { chat } = await askInChat('hoodies')
    expect(await within(chat).findByRole('button', { name: 'See 2 products on the page' })).toBeInTheDocument()
  })

  it("restores a logged-in customer's last results from their saved chat", async () => {
    mockApi()
    renderAt('/login')
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Email'), testUser.email)
    await user.type(screen.getByLabelText('Password'), 'password')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    const panel = await screen.findByRole('region', { name: 'Products from your chat' })
    expect(within(panel).getByRole('heading', { name: '1 product for “Earlier question”' })).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Close chat results' }))
    await user.click(screen.getByRole('button', { name: 'Log Out' }))
  })

  it('tells the assistant which product the customer is viewing', async () => {
    mockApi()
    renderAt(`/products/${hoodie.product_id}`)
    await screen.findByRole('table', { name: 'Current stock' })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open chat' }))
    const chat = screen.getByRole('dialog', { name: 'Campus Customs chat' })
    expect(await within(chat).findByText('Basic Hoodie Big Yale', { selector: '.chat-context strong' })).toBeInTheDocument()
    expect(within(chat).getByLabelText('Message')).toHaveAttribute('placeholder', 'Ask about this product…')

    await user.type(within(chat).getByLabelText('Message'), 'Do you have this in pink?')
    await user.click(within(chat).getByRole('button', { name: 'Send' }))
    await within(chat).findByText('Do you have this in pink?', { selector: 'strong' })
    expect(chatRequests[0].viewing_product_id).toBe('basic-hoodie-big-yale')
    expect(within(chat).getByText('About: Basic Hoodie Big Yale')).toBeInTheDocument()

    // A guest's next message carries the earlier one's product, since nothing is saved on the server.
    await user.type(within(chat).getByLabelText('Message'), 'and in grey?')
    await user.click(within(chat).getByRole('button', { name: 'Send' }))
    await within(chat).findByText('and in grey?', { selector: 'strong' })
    expect(chatRequests[1].history[0]).toEqual({
      role: 'user', content: 'Do you have this in pink?', viewing_product_id: 'basic-hoodie-big-yale' })
  })

  it('sends no product when the customer is not on a product page', async () => {
    mockApi()
    renderAt('/products')
    const { chat } = await askInChat('hi')
    await within(chat).findByText('hi', { selector: 'strong' })
    expect(chatRequests[0].viewing_product_id).toBeNull()
    expect(chat.querySelector('.chat-context')).toBeNull()
  })

  it('tells guests their chat is not saved, and logged-in customers that it is', async () => {
    mockApi()
    renderAt('/login')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open chat' }))
    expect(screen.getByText('Guest · log in to save this chat')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Email'), testUser.email)
    await user.type(screen.getByLabelText('Password'), 'password')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    expect(await screen.findByText('Signed in as Test User · this chat is saved')).toBeInTheDocument()
    // Saved messages show which product they were about.
    expect(await screen.findByText('About: Yale Dad Hoodie')).toBeInTheDocument()
  })

  // --- Problem 9 ---------------------------------------------------------------

  it('product cards show availability for each size', async () => {
    mockApi()
    renderAt('/products')
    const card = await screen.findByRole('link', { name: /Basic Hoodie Big Yale/ })
    expect(within(card).getByText('5 of 6 sizes in stock')).toBeInTheDocument()
    const sizes = within(card).getByRole('list', { name: 'Sizes' })
    expect(within(sizes).getByLabelText('M: Sold out')).toHaveClass('stock-size-out')
    expect(within(sizes).getByLabelText('XL: Only 2 left')).toHaveClass('stock-size-low')
    expect(within(sizes).getByLabelText('XS: 15 in stock')).toHaveClass('stock-size-ok')
  })

  it('the shop can be filtered to products in stock in a size', async () => {
    mockApi()
    renderAt('/products?category=hoodies')
    await screen.findByText('1 product')
    await userEvent.click(within(screen.getByRole('group', { name: 'Filter by size in stock' })).getByRole('button', { name: 'XL' }))
    expect(await screen.findByText(/in stock in XL/)).toBeInTheDocument()
    expect(productQueries).toContain('/api/products?category=hoodies&size=XL')
  })

  it('the product page sums up availability in plain words', async () => {
    mockApi()
    renderAt(`/products/${hoodie.product_id}`)
    const status = await screen.findByText('In stock in XS, S, L, XL and XXL · Sold out in M')
    expect(status.closest('.availability')).toHaveClass('availability-low')
    expect(screen.getByText('Nearly gone: S (5 left), XL (2 left), XXL (3 left)')).toBeInTheDocument()
  })

  it('remembers recently viewed products and shows them on the home page', async () => {
    mockApi()
    const first = renderAt(`/products/${hoodie.product_id}`)
    await screen.findByRole('table', { name: 'Current stock' })
    // On the product's own page it isn't listed as "recently viewed".
    expect(screen.queryByRole('heading', { name: 'Recently viewed' })).not.toBeInTheDocument()
    first.unmount()

    renderAt('/')
    const section = (await screen.findByRole('heading', { name: 'Recently viewed' })).closest('section')!
    const card = within(section).getByRole('link', { name: /Basic Hoodie Big Yale/ })
    expect(card).toHaveAttribute('href', '/products/basic-hoodie-big-yale')
    expect(within(card).getByText('5 of 6 sizes in stock')).toBeInTheDocument() // live stock, not a snapshot

    await userEvent.click(within(section).getByRole('button', { name: 'Clear' }))
    expect(screen.queryByRole('heading', { name: 'Recently viewed' })).not.toBeInTheDocument()
  })

  it('recently viewed keeps the newest first, at most 8, and survives blocked storage', async () => {
    const rv = await import('../recentlyViewed')
    for (let i = 1; i <= 10; i++) rv.addRecentlyViewed(`p${i}`)
    rv.addRecentlyViewed('p5')
    expect(rv.getRecentlyViewed()).toEqual(['p5', 'p10', 'p9', 'p8', 'p7', 'p6', 'p4', 'p3'])

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(rv.getRecentlyViewed()).toEqual([])
    expect(() => rv.addRecentlyViewed('p1')).not.toThrow()
  })

  it('shows tappable answers when the assistant asks a clarifying question', async () => {
    const fetchMock = mockApi()
    const realImpl = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input) === '/api/chat') {
        const body = JSON.parse(String(init!.body))
        chatRequests.push(body)
        const asking = body.message === 'I need a gift'
        return new Response(JSON.stringify({
          reply: asking ? "Lovely! Who's it for?" : `Great, a gift for **${body.message}**.`,
          products: [], results: [],
          suggestions: asking ? ['For myself', 'A gift for my dad'] : [],
        }))
      }
      return realImpl(input, init)
    })
    renderAt('/')
    const { user, chat } = await askInChat('I need a gift')
    const answers = await within(chat).findByRole('group', { name: 'Suggested answers' })
    await user.click(within(answers).getByRole('button', { name: 'A gift for my dad' }))
    expect(await within(chat).findByText('A gift for my dad', { selector: 'strong' })).toBeInTheDocument()
    expect(chatRequests[1].message).toBe('A gift for my dad')
    // The buttons go away once answered.
    expect(within(chat).queryByRole('group', { name: 'Suggested answers' })).not.toBeInTheDocument()
  })
})
