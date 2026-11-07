// End-to-end test of the dashboard against the scripted backend (no AI calls, no real money).
//
// Starts hw5/backend/tests/scripted_server.py on http://localhost:8000 (the real FastAPI app and
// MCP server on temporary copies of the data, with scripted agents) and `npm run dev` on
// http://localhost:5173, then drives the dashboard in Chromium.
//
//   npm run e2e                 (screenshots go to $SCREENSHOT_DIR, default: frontend/e2e-screenshots)

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const here = path.dirname(fileURLToPath(import.meta.url))
const frontend = path.resolve(here, '..')
const backend = path.resolve(frontend, '../backend')
const shots = process.env.SCREENSHOT_DIR ?? path.join(frontend, 'e2e-screenshots')
mkdirSync(shots, { recursive: true })

const procs = []
function start(cmd, args, cwd, env = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  p.stdout.on('data', (d) => process.env.E2E_VERBOSE && process.stdout.write(`[${cmd}] ${d}`))
  p.stderr.on('data', (d) => process.env.E2E_VERBOSE && process.stderr.write(`[${cmd}] ${d}`))
  procs.push(p)
  return p
}
async function waitFor(url, ms = 30000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

let failures = 0
function check(label, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ` (${extra})` : ''}`)
  if (!ok) failures++
}

try {
  start(path.join(backend, '.venv/bin/python'), ['tests/scripted_server.py'], backend)
  start('npm', ['run', 'dev'], frontend)
  await waitFor('http://localhost:8000/api/health')
  await waitFor('http://localhost:5173/')

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const consoleErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  page.on('pageerror', (e) => consoleErrors.push(e.message))
  await page.goto('http://localhost:5173/')

  // --- Tickets, status and cash
  await page.getByTestId('ticket-103').waitFor()
  const stubs = await page.locator('.stub').count()
  check('shows all three tickets', stubs === 3, `${stubs}`)
  check('tickets start as "Not run"', (await page.locator('.stub .pill.not_run').count()) === 3)
  check('checking balance is $3,400.00', (await page.getByTestId('checking-balance').innerText()).includes('$3,400.00'))
  check('backend shows as connected', (await page.locator('.conn').innerText()).includes('Connected'))
  await page.screenshot({ path: path.join(shots, '1-start.png') })

  // --- Ticket 103: live run, purchase + discount
  await page.getByTestId('ticket-103').click()
  check('ticket 103 requester shown as a customer', (await page.locator('.ticket-head').innerText()).includes('Yale AI Club (customer)'))
  await page.getByTestId('run-agents').click()
  await page.locator('.member.speaking').first().waitFor({ timeout: 10000 })
  check('an agent is highlighted as working during the run', true)
  check('ticket shows "Agents working"', (await page.getByTestId('ticket-103').innerText()).includes('Agents working'))
  await page.locator('[data-event="delegation"]').first().waitFor({ timeout: 10000 })
  await page.screenshot({ path: path.join(shots, '2-running-103.png') })
  await page.getByTestId('run-outcome').filter({ hasText: 'Needs action' }).waitFor({ timeout: 60000 })
  check('ticket 103 run ends as "Needs action"', true)
  const timeline = await page.getByTestId('timeline').innerText()
  check('timeline shows the Boss delegating to Inventory', /Boss\s*→\s*Inventory/.test(timeline))
  check('timeline shows MCP tool calls', timeline.includes('check_stock(') && timeline.includes('price_bulk_order('))
  check('timeline shows replies between agents', timeline.includes('reports back'))
  check('summary shows Inventory’s contribution', (await page.getByTestId('contrib-inventory').innerText()).includes('8 in M'))
  check('summary marks Facilities as not involved', (await page.getByTestId('contrib-facilities').innerText()).includes('Not involved'))

  const purchase = page.getByTestId('approval-purchase')
  const ptext = await purchase.innerText()
  check('purchase card shows quantity, cost and reason', ptext.includes('Buy 12') && ptext.includes('$264.00') && ptext.includes('12 short'))
  check('purchase card warns the vendor can’t ship', ptext.includes("can't ship until its unpaid invoice(s) 501"))
  await page.screenshot({ path: path.join(shots, '3-finished-103.png'), fullPage: true })
  const approveBtn = purchase.getByTestId('approve')
  check('Approve is disabled before a name and confirmation', await approveBtn.isDisabled())
  await page.getByTestId('approver-name').fill('Pat Rivera')
  check('Approve stays disabled until the warning is ticked', await approveBtn.isDisabled())
  await purchase.locator('.warning input').check()
  check('Approve is enabled once the warning is confirmed', await approveBtn.isEnabled())
  await approveBtn.click()
  await page.getByTestId('toast').filter({ hasText: 'No order was placed' }).waitFor()
  check('purchase approval recorded without placing an order', true)
  check('balance unchanged by a purchase approval', (await page.getByTestId('checking-balance').innerText()).includes('$3,400.00'))

  const discount = page.getByTestId('approval-discount')
  check('discount card shows the options and recommendation', (await discount.innerText()).includes('5% (recommended)'))
  await discount.locator('input[inputmode="decimal"]').fill('5')
  await discount.getByTestId('approve').click()
  await page.getByTestId('toast').filter({ hasText: 'Discount of 5% recorded' }).waitFor()
  await page.getByTestId('ticket-103').locator('.pill.resolved').waitFor({ timeout: 15000 })
  check('ticket 103 is "Resolved" once every request is decided', true)

  // --- Ticket 101: payment, balance updates
  await page.getByTestId('ticket-101').click()
  await page.getByTestId('run-agents').click()
  await page.getByTestId('run-outcome').filter({ hasText: 'Needs action' }).waitFor({ timeout: 60000 })
  const payment = page.getByTestId('approval-payment')
  const paytext = await payment.innerText()
  check('payment card shows amount, payee and reason', paytext.includes('$840.00') && paytext.includes('Pay Bulldog Print Co') && paytext.includes('Overdue by 3 days'))
  check('payment card shows the live cash check', paytext.includes('$2,560.00'))
  check('draft is shown as not sent', (await page.locator('.draft').innerText()).toLowerCase().includes('not sent'))
  await page.screenshot({ path: path.join(shots, '4-payment-101.png'), fullPage: true })
  await payment.getByTestId('approve').click()
  await page.getByTestId('toast').filter({ hasText: 'Checking balance is now $2,560.00' }).waitFor()
  await page.getByTestId('checking-balance').filter({ hasText: '$2,560.00' }).waitFor({ timeout: 5000 })
  check('checking balance updates to $2,560.00 after the payment', true)
  check('cash panel updates too', (await page.getByTestId('cash-balance').innerText()).includes('$2,560.00'))
  await page.getByTestId('ticket-101').locator('.pill.resolved').waitFor({ timeout: 15000 })
  check('ticket 101 is "Resolved" after the payment is decided', true)

  // --- Ticket 102: a failed run is not resolved
  await page.getByTestId('ticket-102').click()
  await page.getByTestId('run-agents').click()
  await page.getByTestId('run-outcome').filter({ hasText: 'Run failed' }).waitFor({ timeout: 60000 })
  const outcome = await page.getByTestId('run-outcome').innerText()
  check('failed run says "not resolved"', outcome.includes('not resolved') && outcome.includes('Scripted failure'))
  const pill102 = await page.getByTestId('ticket-102').locator('.pill').innerText()
  check('failed ticket shows "Failed", not "Resolved"', pill102 === 'Failed', pill102)
  await page.screenshot({ path: path.join(shots, '5-failed-102.png'), fullPage: true })

  // --- Phone width
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await phone.goto('http://localhost:5173/')
  await phone.getByTestId('ticket-101').waitFor()
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  check('no sideways scrolling at phone width', !overflow)
  await phone.screenshot({ path: path.join(shots, '6-phone.png') })

  const dark = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' })
  await dark.goto('http://localhost:5173/')
  await dark.getByTestId('ticket-103').click()
  await dark.getByTestId('run-outcome').waitFor()
  await dark.screenshot({ path: path.join(shots, '7-dark.png') })

  check('no browser console errors', consoleErrors.length === 0, consoleErrors.join(' | '))
  await browser.close()
} catch (e) {
  console.error(e)
  failures++
} finally {
  for (const p of procs) p.kill('SIGTERM')
}
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll dashboard checks passed.')
process.exit(failures ? 1 : 0)
