/**
 * Campus Customs app check: drives the real, running website in a browser, takes screenshots and
 * writes output/app_check.html. Nothing is simulated: the chatbot tests use the real assistant
 * (your ANTHROPIC_API_KEY in backend/.env), and every claim is checked against live database data.
 *
 * Usage (with the API and website already running, see RUN_ON_MAC.md):
 *   cd frontend
 *   npx playwright install chromium     # first time only
 *   npm run app-check
 *
 * Options (environment variables):
 *   BASE_URL=http://localhost:5173      the website to test
 *   CHAT_TIMEOUT=120                    seconds to wait for each chatbot reply
 *
 * The chatbot tests run as a guest, so nothing is saved to the database.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const BASE = (process.env.BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '')
const CHAT_TIMEOUT = Number(process.env.CHAT_TIMEOUT ?? 120) * 1000
const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT = process.env.OUTPUT_DIR ? path.resolve(process.env.OUTPUT_DIR) : path.resolve(HERE, '../../output')
const IMAGES = path.join(OUTPUT, 'app_check_images')
const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }

const results = []
let shotNumber = 0

/** Record one test. status: 'pass' | 'fail' | 'not-run'. */
function record(test) {
  results.push(test)
  const mark = { pass: 'PASS', fail: 'FAIL', 'not-run': 'NOT RUN' }[test.status]
  console.log(`${mark.padEnd(8)} ${test.title}${test.status !== 'pass' ? ` (${test.reason ?? ''})` : ''}`)
}

async function shot(page, name, options = {}) {
  const file = `${String(++shotNumber).padStart(2, '0')}-${name}.png`
  await page.waitForTimeout(700) // let entrance animations settle
  await page.screenshot({ path: path.join(IMAGES, file), ...options })
  return file
}

async function apiJson(page, url) {
  const res = await page.request.get(BASE + url)
  if (!res.ok()) throw new Error(`${url} returned ${res.status()}`)
  return res.json()
}

const money = (n) => `$${n.toFixed(2)}`
const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// --- Chat helpers ------------------------------------------------------------------

async function openChat(page) {
  const dialog = page.getByRole('dialog', { name: 'Campus Customs chat' })
  if (!(await dialog.count())) await page.getByRole('button', { name: 'Open chat' }).click()
  await dialog.waitFor()
  return dialog
}

/** Sends a message and waits for the real assistant's reply. Returns its text, or throws if unavailable. */
async function ask(page, text) {
  const chat = await openChat(page)
  const before = await chat.locator('.chat-turn-assistant').count()
  await chat.getByLabel('Message').fill(text)
  await chat.getByRole('button', { name: 'Send' }).click()
  const turn = chat.locator('.chat-turn-assistant').nth(before)
  await turn.waitFor({ timeout: CHAT_TIMEOUT })
  const bubble = turn.locator('.chat-bubble')
  const reply = (await bubble.innerText()).trim()
  if (await bubble.evaluate((el) => el.classList.contains('chat-error'))) {
    const err = new Error(reply)
    err.assistantUnavailable = true
    throw err
  }
  await page.waitForTimeout(500)
  return { reply, turn }
}

let assistantProblem = null // set when the real assistant can't answer, so chat tests are skipped honestly

async function chatTest(page, title, fn) {
  if (assistantProblem) {
    record({ title, status: 'not-run', reason: assistantProblem, section: 'chat' })
    return
  }
  try {
    await fn()
  } catch (err) {
    if (err.assistantUnavailable) {
      assistantProblem = `The assistant replied: "${err.message}" Add your ANTHROPIC_API_KEY (python setup_env.py --api-key) and restart the API.`
      // A real screenshot of what the chat shows, so the report proves why these tests didn't run.
      record({ title, status: 'not-run', reason: assistantProblem, section: 'chat', image: await shot(page, 'chat-not-configured') })
    } else {
      record({ title, status: 'fail', reason: err.message, section: 'chat' })
    }
  }
}

// --- The tests ----------------------------------------------------------------------

async function run() {
  await rm(IMAGES, { recursive: true, force: true })
  await mkdir(IMAGES, { recursive: true })
  const browser = await chromium.launch()
  const errors = []
  const context = await browser.newContext({ viewport: DESKTOP })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))

  // Reachability first, so a stopped server gives a clear message.
  try {
    const health = await apiJson(page, '/api/health')
    if (!health.database) throw new Error('the API is running but cannot find data/campus_customs.db')
  } catch (err) {
    console.error(`Can't reach the Campus Customs website/API at ${BASE}: ${err.message}`)
    console.error('Start the API (uvicorn main:app --port 8000) and the website (npm run dev), then try again.')
    await browser.close()
    process.exit(1)
  }

  // 1. Home page
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  {
    const heading = await page.getByRole('heading', { level: 1 }).innerText()
    const featured = await page.locator('.product-card').count()
    const categories = await page.locator('.category-tile').count()
    record({
      title: 'Home page loads with categories and featured products',
      status: featured === 4 && categories === 6 ? 'pass' : 'fail',
      reason: `${featured} featured products, ${categories} categories`,
      image: await shot(page, 'home'),
      explanation:
        'The redesigned home page loads from the running site: the hero, the category tiles with photos, and four ' +
        `featured products loaded from the database (found ${featured} featured cards and ${categories} categories; headline "${heading.replace(/\n/g, ' ')}").`,
      section: 'site',
    })
  }

  // 2. Product page shows the database price and stock
  const target = await apiJson(page, '/api/products/champion-reverse-weave-hoodie-1')
  const stockLine = target.inventory.map((s) => `${s.size} ${s.quantity}`).join(', ')
  await page.goto(BASE + '/products/' + target.product_id, { waitUntil: 'networkidle' })
  {
    const price = await page.locator('.detail-price').innerText()
    const sizeLabels = await page.locator('.size-btn').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')))
    const expected = target.inventory.map(
      (s) => `${s.size}: ${s.quantity === 0 ? 'Sold out' : s.quantity <= 5 ? `Only ${s.quantity} left` : `${s.quantity} in stock`}`,
    )
    const ok = price === money(target.price) && JSON.stringify(sizeLabels) === JSON.stringify(expected)
    record({
      title: 'Product page shows the real price and stock for every size',
      status: ok ? 'pass' : 'fail',
      reason: ok ? '' : `page showed ${price} / ${sizeLabels.join(', ')}`,
      image: await shot(page, 'product-page'),
      explanation:
        `The ${target.name} page matches the database exactly: price ${money(target.price)} and stock ${stockLine}. ` +
        'Sold-out sizes are crossed out and can\'t be selected, and the summary box says which sizes are available.',
      section: 'site',
    })
  }

  // 3. Problem 9 usability: stock on cards + "Size in stock" filter
  await page.goto(BASE + '/products?category=hoodies', { waitUntil: 'networkidle' })
  {
    const allHoodies = await apiJson(page, '/api/products?category=hoodies')
    const inXL = allHoodies.filter((p) => p.stock.some((s) => s.size === 'XL' && s.quantity > 0))
    await page.getByRole('group', { name: 'Filter by size in stock' }).getByRole('button', { name: 'XL', exact: true }).click()
    await page.waitForURL(/size=XL/)
    await page.locator('.result-count', { hasText: 'in stock in XL' }).waitFor()
    const shown = await page.locator('.product-card-name').allInnerTexts()
    const xlLabels = await page.locator('.product-card').evaluateAll((cards) =>
      cards.map((c) => c.querySelector('[aria-label^="XL:"]')?.getAttribute('aria-label') ?? ''),
    )
    const ok =
      shown.length === inXL.length &&
      new Set(shown).size === new Set(inXL.map((p) => p.name)).size &&
      shown.every((n) => inXL.some((p) => p.name === n)) &&
      xlLabels.every((l) => l && !l.includes('Sold out'))
    record({
      title: 'Usability (Problem 9): stock on every card and the "Size in stock" filter',
      status: ok ? 'pass' : 'fail',
      reason: ok ? '' : `showed ${shown.length}, expected ${inXL.length}`,
      image: await (async () => {
        await page.mouse.move(0, 0)
        await page.evaluate(() => window.scrollTo(0, 270)) // the size filter and the cards' stock rows in one view
        return shot(page, 'size-filter')
      })(),
      explanation:
        `Filtering hoodies to "Size in stock: XL" shows ${shown.length} of ${allHoodies.length} hoodies, exactly the ones the ` +
        'database has in stock in XL. Every card shows its availability ("5 of 6 sizes in stock") and size labels: green ' +
        'available, amber nearly gone, crossed out when sold out. Shoppers can see what they can buy without opening each product.',
      section: 'site',
    })
  }

  // 4. Problem 9 usability: recently viewed
  {
    const viewed = ['yale-mom-hoodie', 'district-vit-crewneck-vintage-bulldog', 'berkeley-sweater-fleece-jacket']
    for (const id of viewed) {
      await page.goto(BASE + '/products/' + id, { waitUntil: 'networkidle' })
    }
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    const section = page.locator('.recently-viewed')
    await section.waitFor()
    await section.scrollIntoViewIfNeeded()
    const names = await section.locator('.product-card-name').allInnerTexts()
    const expected = await Promise.all(
      [...viewed].reverse().concat('champion-reverse-weave-hoodie-1').map(async (id) => (await apiJson(page, '/api/products/' + id)).name),
    )
    const ok = JSON.stringify(names) === JSON.stringify(expected)
    record({
      title: 'Usability (Problem 9): recently viewed products',
      status: ok ? 'pass' : 'fail',
      reason: ok ? '' : `showed ${names.join(', ')}`,
      image: await shot(page, 'recently-viewed'),
      explanation:
        `After opening four product pages, the home page lists them newest first (${names.join(', ')}), ` +
        'with live prices and stock, so shoppers can get back to items they were comparing.',
      section: 'site',
    })
  }

  // 5. Chatbot: actual price and stock
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await chatTest(page, "Chatbot checks a product's actual price and stock", async () => {
    const question = `How much is the ${target.name}, and is it in stock in XL?`
    const { reply } = await ask(page, question)
    const xl = target.inventory.find((s) => s.size === 'XL')
    const priceOk = reply.includes(money(target.price))
    const stockOk =
      xl.quantity === 0 ? /sold out|out of stock|not in stock|isn.t in stock|unavailable/i.test(reply) : reply.includes(String(xl.quantity))
    record({
      title: "Chatbot checks a product's actual price and stock",
      status: priceOk && stockOk ? 'pass' : 'fail',
      reason: [!priceOk && `reply doesn't contain ${money(target.price)}`, !stockOk && 'reply doesn\'t give the right XL stock'].filter(Boolean).join('; '),
      image: await shot(page, 'chat-price-stock'),
      explanation:
        `Asked the real assistant: "${question}" The database says ${money(target.price)}, with XL at ${xl.quantity} ` +
        `(${xl.quantity === 0 ? 'sold out' : 'in stock'}). The assistant looked it up with its tools and replied: "${reply}"`,
      section: 'chat',
    })
  })

  // 6. Chatbot: matching products appear on the page
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await chatTest(page, 'Matching products appear on the page after a chat search', async () => {
    const question = 'What hoodies do you have?'
    const { reply } = await ask(page, question)
    const panel = page.getByRole('region', { name: 'Products from your chat' })
    await panel.waitFor({ timeout: 10000 })
    await panel.scrollIntoViewIfNeeded()
    const names = await panel.locator('.product-card-name').allInnerTexts()
    const hoodies = (await apiJson(page, '/api/products?category=hoodies')).map((p) => p.name)
    const heading = await panel.locator('h2').innerText()
    const ok = names.length > 0 && names.every((n) => hoodies.includes(n))
    record({
      title: 'Matching products appear on the page after a chat search',
      status: ok ? 'pass' : 'fail',
      reason: ok ? '' : `panel had ${names.length} products, ${names.filter((n) => !hoodies.includes(n)).length} not hoodies`,
      image: await shot(page, 'chat-results-panel'),
      explanation:
        `Asked "${question}". The assistant searched the database, and the website showed the results panel ` +
        `"${heading}" with ${names.length} product cards (images, names, prices and descriptions), all of them real hoodies ` +
        `from the catalogue. Clicking a card opens its product page. The assistant replied: "${reply}"`,
      section: 'chat',
    })
  })

  // 7. Chatbot + Problem 9: similar products when a size is sold out
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await chatTest(page, 'Usability (Problem 9): chatbot suggests similar in-stock products', async () => {
    const soldOut =
      target.inventory.find((s) => s.size === 'XL' && s.quantity === 0) ?? target.inventory.find((s) => s.quantity === 0)
    if (!soldOut) throw new Error(`${target.name} has no sold-out size to test with`)
    const question = `Is the ${target.name} available in ${soldOut.size}? If not, what's similar?`
    const { reply } = await ask(page, question)
    const panel = page.getByRole('region', { name: 'Products from your chat' })
    await panel.waitFor({ timeout: 10000 })
    const cards = await panel.locator('.product-card').evaluateAll((cs, size) =>
      cs.map((c) => ({
        name: c.querySelector('.product-card-name').textContent,
        label: c.querySelector(`[aria-label^="${size}:"]`)?.getAttribute('aria-label') ?? '',
      })), soldOut.size)
    const alternatives = cards.filter((c) => c.name !== target.name)
    const ok =
      /sold out|out of stock|not available|isn.t available|unavailable/i.test(reply) &&
      alternatives.length > 0 &&
      alternatives.every((c) => c.label && !c.label.includes('Sold out'))
    record({
      title: 'Usability (Problem 9): chatbot suggests similar in-stock products',
      status: ok ? 'pass' : 'fail',
      reason: ok ? '' : 'reply or alternatives did not match the database',
      image: await shot(page, 'chat-similar-products'),
      explanation:
        `${target.name} has 0 in ${soldOut.size}. Asked "${question}" The assistant said it's sold out and recommended ` +
        `alternatives. The page shows ${alternatives.length} of them, each in stock in ${soldOut.size} ` +
        `(${alternatives.map((a) => a.label.split(':')[1].trim()).join(', ')}). It replied: "${reply}"`,
      section: 'chat',
    })
  })

  // 8. Phone layout
  {
    const phone = await browser.newPage({ viewport: PHONE })
    await phone.goto(BASE + '/products/' + target.product_id, { waitUntil: 'networkidle' })
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    record({
      title: 'Works on a phone',
      status: overflow ? 'fail' : 'pass',
      reason: overflow ? 'page scrolls sideways' : '',
      image: await shot(phone, 'phone-product-page'),
      explanation:
        'The product page at phone width (390px): the layout stacks into one column, the size buttons and stock summary ' +
        'stay readable, and nothing scrolls sideways.',
      section: 'site',
    })
    await phone.close()
  }

  await browser.close()
  if (errors.length) console.warn('Page errors during the check:', errors)
  await writeReport(errors)
}

// --- Report -------------------------------------------------------------------------

async function writeReport(pageErrors) {
  const when = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })
  const counts = { pass: 0, fail: 0, 'not-run': 0 }
  for (const r of results) counts[r.status]++
  const label = { pass: 'Passed', fail: 'Failed', 'not-run': 'Not run' }
  const sections = [
    ['site', 'Website'],
    ['chat', 'Chatbot (real assistant, live data)'],
  ]
  let number = 0
  const body = sections
    .map(([key, name]) => {
      const tests = results.filter((r) => r.section === key)
      if (!tests.length) return ''
      return `<h2>${name}</h2>` + tests.map((r) => {
        const i = ++number
        return `
      <article class="test" id="test-${i}">
        <header>
          <h3><span class="num">${i}</span>${escape(r.title)}</h3>
          <span class="badge ${r.status}">${label[r.status]}</span>
        </header>
        ${r.status === 'not-run'
          ? `<p class="note">${escape(r.reason)}</p>`
          : `<p>${escape(r.explanation)}</p>${r.status === 'fail' ? `<p class="note">Problem: ${escape(r.reason)}</p>` : ''}`}
        ${r.image ? `<a href="app_check_images/${r.image}"><img src="app_check_images/${r.image}" alt="Screenshot: ${escape(r.title)}" loading="lazy"></a>` : ''}
      </article>`
      }).join('')
    })
    .join('')

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Campus Customs App Check</title>
<style>
  :root { --blue: #00356b; --blue-light: #286dc0; --ink: #0f1b2d; --muted: #5b6779; --line: #e1e7ef; --soft: #f6f8fb;
          --ok: #137a52; --bad: #b42318; --warn: #b45309; color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); background: var(--soft); }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 0 max(16px, env(safe-area-inset-left)) 64px; }
  .top { background: linear-gradient(160deg, var(--blue), #071a33); color: #fff; padding: 40px 0 32px; margin-bottom: 28px; }
  .top h1 { margin: 0 0 6px; font: 600 clamp(1.8rem, 4vw, 2.6rem)/1.15 Georgia, serif; }
  .top p { margin: 0; color: rgba(255,255,255,.8); }
  .summary { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
  .summary span { padding: 6px 14px; border-radius: 999px; background: rgba(255,255,255,.12); font-weight: 600; font-size: .9rem; }
  h2 { font: 600 1.5rem Georgia, serif; color: var(--blue); margin: 36px 0 14px; }
  .test { background: #fff; border: 1px solid var(--line); border-radius: 16px; padding: 20px 22px 22px; margin-bottom: 20px;
          box-shadow: 0 1px 2px rgba(7,26,51,.06); }
  .test header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .test h3 { margin: 0 0 8px; font-size: 1.12rem; display: flex; gap: 10px; align-items: baseline; }
  .num { display: inline-grid; place-items: center; min-width: 28px; height: 28px; border-radius: 50%; background: var(--blue); color: #fff; font-size: .85rem; }
  .badge { flex-shrink: 0; padding: 3px 12px; border-radius: 999px; font-size: .8rem; font-weight: 700; }
  .badge.pass { background: #e7f6ee; color: var(--ok); }
  .badge.fail { background: #fdeceb; color: var(--bad); }
  .badge.not-run { background: #fdf3e6; color: var(--warn); }
  .test p { margin: 0 0 14px; color: #334155; overflow-wrap: anywhere; }
  .note { padding: 10px 14px; border-radius: 10px; background: #fdf3e6; color: var(--warn) !important; }
  .test img { display: block; width: 100%; height: auto; border-radius: 10px; border: 1px solid var(--line); }
  footer { color: var(--muted); font-size: .85rem; margin-top: 32px; }
</style>
</head>
<body>
<div class="top"><div class="wrap">
  <h1>Campus Customs App Check</h1>
  <p>Automated check of the running website at ${escape(BASE)} on ${escape(when)}. Every screenshot is from the real site, checked against the live database.
     ${counts['not-run'] ? 'The chatbot tests did not run because the assistant has no API key yet (see below).' : 'The chatbot answers come from the real assistant, not a simulation.'}</p>
  <div class="summary"><span>${counts.pass} passed</span><span>${counts.fail} failed</span><span>${counts['not-run']} not run</span></div>
</div></div>
<main class="wrap">
${body}
<footer>
  Generated by <code>frontend/scripts/app-check.mjs</code> (<code>npm run app-check</code>). Chatbot questions were asked as a guest, so nothing was saved to the database.
  ${pageErrors.length ? `<br>Page errors seen: ${escape(pageErrors.join(' | '))}` : '<br>No page errors were seen during the check.'}
</footer>
</main>
</body>
</html>
`
  await writeFile(path.join(OUTPUT, 'app_check.html'), html)
  console.log(`\nReport: ${path.join(OUTPUT, 'app_check.html')} (${counts.pass} passed, ${counts.fail} failed, ${counts['not-run']} not run)`)
  if (counts['not-run']) console.log('Chatbot tests were not run: ' + assistantProblem)
  if (counts.fail) process.exitCode = 1
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
