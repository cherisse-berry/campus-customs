# Campus Customs Harness — Homework 5

This is the reference for the whole Campus Customs system: the database, the MCP server and its tools, the five agents, the backend API, the dashboard and the safety rules that tie them together. The sections were written problem by problem, so each says which problem it comes from.

File paths in this document are relative to the `hw5` folder.

## How the pieces fit together

```
  Person (browser)
       │
       ▼
  Dashboard  frontend/  ── React + Vite + TypeScript, http://localhost:5173
       │  HTTP (JSON)
       ▼
  Backend API  backend/main.py  ── FastAPI, http://localhost:8000
       │                    │
       │ runs               │ approvals, cash, tickets
       ▼                    │
  Agent team  backend/agents.py  ── Boss, Inventory, Accounting, Facilities, Customer Service
       │  model calls: gpt-6-luna through Portkey (api.portkey.ai)
       │  shop information: MCP tool calls
       ▼                    ▼
  MCP server  mcp_server/server.py  ── FastMCP; "agent" role (look-ups) or "approver" role (+ record_payment)
       │
       ▼
  Working database  data/campus_customs_new.db   (the original data/campus_customs.db is only read, by setup and reset)

  Everything that happens is added to output/audit_trail.json (never overwritten).
```

- **One way in to the data:** the agents, the API and Claude Code all get shop information only through the MCP server. Payments can only be written through its approver-only `record_payment` tool, which a person triggers.
- **One set of approval rules:** payments, purchases and discounts are approved through `backend/approvals.py`, used by both the dashboard (through the API) and the command-line `approve.py`.

## Contents

| Part | Sections |
|---|---|
| **The data** (Problem 2) | [Database files](#the-database-files), [today's date](#what-today-is), [tables and how they connect](#overview), one section per table, [the three open tickets](#the-three-open-tickets), [what the database doesn't say](#things-the-database-doesnt-tell-us) |
| **MCP server** (Problems 3, 5, 7) | [The first three tools](#mcp-server-tools-problem-3), [Claude Code connection](#connection-to-claude-code-problem-4), [all tools after Problem 5](#mcp-server-tools-after-problem-5) |
| **Agents** (Problem 5) | [The agent team](#the-agent-team-problem-5): rules, the five agents and their tools and tables, delegation, outputs, code checks, human approval, usage limits, audit trail, [what's been verified](#what-has-been-verified-and-what-still-needs-testing) |
| **Backend API** (Problem 7) | [Routes](#the-backend-api-problem-7), [approving payments](#approving-a-payment) and [purchases](#approving-a-purchase), [reset](#resetting-the-database) |
| **Dashboard** (Problem 8) | [The dashboard](#the-dashboard-problem-8) (the design is in `output/design.md`) |
| **Safety rules** | [All the safety rules in one place](#safety-rules-all-in-one-place) |
| **Running it** | [Setting everything up](#setting-everything-up), [Problem 9 status](#problem-9-resolving-the-tickets) |

## The database files

| File | Purpose |
|---|---|
| `data/campus_customs.db` | The **original** database, exactly as delivered. It is set to read-only, so it can't be changed by accident. |
| `data/campus_customs_new.db` | The **working copy**. This is the file we read and change while building the agents. |

Both files were identical when copied (same SHA-256 fingerprint: `23686a90…f360a`). If the working copy gets into a bad state, `python3 setup_db.py --reset` replaces it with a fresh copy of the original.

The database files aren't in the GitHub repository: the `.gitignore` keeps them out, the same rule as Homework 4. To create them, follow [Setting up the database](../README.md#setting-up-the-database) in `hw5/README.md`. In short, from the `hw5` folder run `python3 setup_db.py path/to/data_2.zip`.

For Problem 2 the database was only read, never changed.

## What "today" is

The database has its own date: **Monday, August 31, 2026** (stored in the `desk` table). Every due date and "how many days left" calculation below uses that date, not the real calendar. The agents should do the same.

## Overview

The database has 9 tables. Most hold only one to four rows, so this is a small snapshot of one day at the shop.

| Table | Rows | What it holds |
|---|---|---|
| `desk` | 1 | Today's date for the shop, plus an empty notes field |
| `cash_accounts` | 1 | How much money the shop has in the bank |
| `inventory` | 10 | How many of each product are in stock, by size, and where they are shelved |
| `pricing` | 4 | What each product costs the shop and what it sells for |
| `vendors` | 3 | Suppliers the shop buys from, and how long they take to deliver |
| `invoices` | 1 | Bills the shop owes to vendors |
| `leases` | 1 | The shop's rental space and its rent |
| `payments` | 0 | A record of money paid out. It's empty: nothing has been paid yet. |
| `tickets` | 3 | Requests waiting for someone to handle them (the "to-do list") |

### How the tables connect

```
                         ┌──────────────┐
                         │   tickets    │  (the to-do list)
                         └──┬───┬───┬───┘
          sku + size ───────┘   │   └─────── lease_id
                │           invoice_id            │
                ▼               ▼                 ▼
 ┌───────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
 │ inventory │  │ pricing  │  │ invoices │  │  leases  │
 │ sku+size  │  │   sku    │  │ vendor_id│  └──────────┘
 └───────────┘  └──────────┘  └────┬─────┘
       ▲             ▲             ▼
       └──── sku ────┘        ┌──────────┐
                              │ vendors  │
                              └──────────┘

 payments.ref_id ──► an invoice id or a lease id (depending on payments.kind)
 payments.account ─► cash_accounts.name
```

In plain terms:

- **Tickets are the starting point.** Each ticket points to the records it's about: a product (`sku` and `size`), a bill (`invoice_id`) or the rent (`lease_id`).
- **Products are identified by SKU**, a short product code such as `CC-TEE-WHITE`. The same SKU links `inventory` (how many we have), `pricing` (what it costs and sells for) and `tickets` (who wants it).
- **Each invoice belongs to one vendor** through `vendor_id`.
- **Payments will link back** to whatever they pay (an invoice or the lease) and to the bank account the money came from.

Two things to know about these links:

1. Only three links are formal "foreign keys" written into the database: `invoices.vendor_id → vendors.id`, `tickets.invoice_id → invoices.id` and `tickets.lease_id → leases.id`. The SKU links and the payment links are only matching values, so the database won't stop a wrong SKU or account name being saved. The agents' code has to check these itself.
2. SQLite doesn't enforce foreign keys unless the connection turns them on (`PRAGMA foreign_keys = ON`). They are off by default, so even the three formal links aren't checked automatically.

---

## `desk`: today's date

| Field | Type | Why it matters |
|---|---|---|
| `date_today` | TEXT, required | The shop's "today": `2026-08-31`. Agents should use it to decide what's overdue and what's due soon, so their answers match the data instead of the real calendar. |
| `notes` | TEXT, optional | A place for notes for the day. It's empty now. |

## `cash_accounts`: the bank balance

| Field | Type | Why it matters |
|---|---|---|
| `name` | TEXT, primary key | The account name. There is one: `checking`. Payments name the account the money comes from. |
| `balance` | REAL, required | **$3,400.00.** This is the money available. Before an agent pays anything, it needs to check that the balance covers it, and check what's left for other bills. |
| `date` | TEXT, required | The date the balance was recorded (`2026-08-31`, today). It tells us the number is current. |

## `inventory`: stock on the shelves

There is one row per product per size. The primary key is the pair (`sku`, `size`), so each product-and-size combination appears only once.

| Field | Type | Why it matters |
|---|---|---|
| `sku` | TEXT, required | The product code. It links to `pricing` and to tickets. |
| `name` | TEXT, required | The product's display name (for example "Classic Bulldog Tee"). It's the only place the name is stored, so agents talking to customers should take the name from here. |
| `size` | TEXT, required | S, M, L or XL for clothing, and `OS` ("one size") for the cap and mug. |
| `qty` | INTEGER, required | How many are in stock. An agent checks this before promising an order. **0 means sold out.** |
| `location` | TEXT, required | Where it's shelved (Aisle A to D). This is useful for staff picking an order. |

Current stock:

| SKU | Product | S | M | L | XL | OS | Total | Shelf |
|---|---|---|---|---|---|---|---|---|
| `CC-HOOD-NAVY` | Basic Hoodie Big Yale | 4 | 8 | 14 | 6 | | 32 | Aisle A |
| `CC-TEE-WHITE` | Classic Bulldog Tee | **0** | 5 | 3 | 2 | | 10 | Aisle B |
| `CC-HAT-BLUE` | Yale Cap | | | | | 40 | 40 | Aisle C |
| `CC-MUG-CREST` | Crest Mug | | | | | **0** | 0 | Aisle D |

Two items are sold out: the tee in size S and the mug.

## `pricing`: cost and selling price

There is one row per product (not per size), so every size sells for the same price.

| Field | Type | Why it matters |
|---|---|---|
| `sku` | TEXT, primary key | The product code. It links to `inventory`. |
| `unit_cost` | REAL, required | What the shop pays for one item. A price should never go below this, or the shop loses money on every sale. |
| `list_price` | REAL, required | The normal selling price. This is the starting point for any discount request. |

| SKU | Cost | Price | Profit per item | Profit margin |
|---|---|---|---|---|
| `CC-HOOD-NAVY` | $22.00 | $58.00 | $36.00 | 62% |
| `CC-TEE-WHITE` | $8.00 | $28.00 | $20.00 | 71% |
| `CC-HAT-BLUE` | $6.00 | $22.00 | $16.00 | 73% |
| `CC-MUG-CREST` | $3.50 | $14.00 | $10.50 | 75% |

The database has no discount rules (no maximum discount and no bulk-pricing table). Any discount policy has to come from the shop owner, not from the data.

## `vendors`: suppliers

| Field | Type | Why it matters |
|---|---|---|
| `id` | INTEGER, primary key | The vendor's number. Invoices use it to say who the bill is from. |
| `name` | TEXT, required | The vendor's name. |
| `specialty` | TEXT, required | What they supply. This helps an agent choose who to reorder from. |
| `lead_days` | INTEGER, required | How many days they take to deliver. This tells an agent how soon a restock could arrive. |

| ID | Vendor | Supplies | Lead time |
|---|---|---|---|
| 1 | Bulldog Print Co | Apparel reprints | 5 days |
| 2 | Elm City Gifts | Mugs and small goods | 3 days |
| 3 | QuickShip CT | Local courier | 1 day |

There are no contact details (email, phone) in the database.

## `invoices`: bills from vendors

| Field | Type | Why it matters |
|---|---|---|
| `id` | INTEGER, primary key | The invoice number. Tickets and payments point to it. |
| `vendor_id` | INTEGER, required, links to `vendors.id` | Who sent the bill. |
| `amount` | REAL, required | How much is owed. |
| `due_date` | TEXT, required | When it must be paid. Comparing it with today shows whether it's overdue. |
| `status` | TEXT, required | `open` means not paid yet. After payment it should be updated (for example to `paid`). |
| `description` | TEXT, optional | What the bill is for. |

The one invoice:

| # | Vendor | Amount | Due | Status | For |
|---|---|---|---|---|---|
| 501 | Bulldog Print Co | $840.00 | Aug 28, 2026 | open | Rush reprint CC-TEE-WHITE S |

**This bill is 3 days overdue** (it was due August 28 and today is August 31). It's for a rush reprint of the exact item that is sold out: the white tee in size S. The invoice doesn't say how many tees the reprint is for.

## `leases`: the shop's rent

| Field | Type | Why it matters |
|---|---|---|
| `id` | INTEGER, primary key | The lease number. Tickets and payments point to it. |
| `space_name` | TEXT, required | The rented space: "Chapel Street shop". |
| `landlord` | TEXT, required | Who the rent is paid to: "Elm City Properties". An agent can use this to check that a rent request really comes from the landlord on file. |
| `monthly_rent` | REAL, required | **$2,400.00.** This is the amount that should be paid, whatever a message says. |
| `next_due` | TEXT, required | **September 2, 2026**, 2 days from today. |
| `notes` | TEXT, optional | Empty. |

## `payments`: money paid out (empty as delivered)

Nothing has been paid yet. This table is where payments get recorded once they are made, so it serves as the shop's payment log.

| Field | Type | Why it matters |
|---|---|---|
| `id` | INTEGER, primary key | The payment number. |
| `kind` | TEXT, required | What kind of payment it is (for example invoice or rent). It tells you what `ref_id` points to. |
| `ref_id` | INTEGER, optional | The invoice ID or lease ID being paid. This isn't a formal link, so the agent must check that the ID exists. |
| `amount` | REAL, required | How much was paid. |
| `account` | TEXT, required | Which bank account it came from (should match a `cash_accounts.name`, such as `checking`). |
| `paid_at` | TEXT, required | When it was paid. |
| `approved_by` | TEXT, required | **Who approved it.** The database won't save a payment without a name here. This means every payment needs an approver on record, which is a natural place to require a human sign-off before an agent moves money. |

## `tickets`: the to-do list

Each ticket is a request someone sent in. Only the fields that matter for that type of request are filled in; the rest are empty.

| Field | Type | Why it matters |
|---|---|---|
| `id` | INTEGER, primary key | The ticket number. |
| `type` | TEXT, required | The kind of request: `customer_order`, `rent_notice` or `price_override`. This decides which agent or process should handle it. |
| `requester` | TEXT, required | Who sent it. |
| `subject` | TEXT, required | A short title. |
| `sku`, `size`, `qty` | optional | The product, size and quantity involved, for order and pricing tickets. |
| `lease_id` | INTEGER, optional, links to `leases.id` | The lease involved, for rent tickets. |
| `invoice_id` | INTEGER, optional, links to `invoices.id` | A related bill. |
| `status` | TEXT, required | `open` for all three. It should change when the ticket is handled. |
| `notes` | TEXT, optional | The details of the request, in the requester's words. |
| `created_at` | TEXT, required | When the ticket came in, with the time zone (`-04:00` is US Eastern daylight time). |

---

## The three open tickets

All three tickets came in today, August 31, 2026.

### Ticket 101: a customer order the shop can't fill yet

| | |
|---|---|
| Type | `customer_order` |
| From | Tauhid Zaman, 9:15 AM |
| Wants | 1 × Classic Bulldog Tee (`CC-TEE-WHITE`), size S |
| Linked to | Invoice 501 |
| Notes | "Needs a tee in size S." |

How it connects to the data:

- **Inventory:** there are **0** white tees in size S, so the order can't be filled from stock. Sizes M (5), L (3) and XL (2) are available if the customer would accept a different size.
- **Invoice 501:** the ticket is linked to the $840 rush reprint of this exact tee and size from Bulldog Print Co. That reprint is how the shop plans to restock size S.
- **The catch:** the invoice is **3 days overdue and still unpaid**. If the vendor is waiting for payment, the restock may be held up, and Bulldog Print Co takes 5 days to deliver after that.
- **Pricing:** the tee sells for $28.00.

What it means for the agents: the order depends on the bill. An agent can't promise the customer a date without knowing whether invoice 501 gets paid. The honest answer to the customer today is "out of stock in S", offer another size, and say a restock is on order. Paying the invoice is a money decision (see Ticket 102).

### Ticket 102: the rent is due in 2 days

| | |
|---|---|
| Type | `rent_notice` |
| From | Elm City Properties, 11:05 AM |
| About | Lease 1 |
| Notes | "Email: shop rent due in 2 days." |

How it connects to the data:

- **Lease 1:** the Chapel Street shop, landlord Elm City Properties, **$2,400** due **September 2**. The ticket matches the lease: the sender is the landlord on file, and "2 days" matches the due date.
- **The ticket gives no amount.** The amount to pay should come from the lease record ($2,400), not from the email.
- **Cash:** the checking account has $3,400.

What it means for the agents: this request arrived by email, and emails asking for money are a common scam. An agent should check it against the lease (right landlord, right amount, right date) before acting, and use the amount on file. Payments need an `approved_by` name, so a person should sign off.

**The money doesn't stretch far.** Paying both bills uses almost everything:

| | Amount |
|---|---|
| Checking balance | $3,400.00 |
| Rent (lease 1, due Sep 2) | − $2,400.00 |
| Overdue reprint (invoice 501, due Aug 28) | − $840.00 |
| **Left over** | **$160.00** |

Both can be paid, but it leaves only $160. The database doesn't say whether more money is coming in.

### Ticket 103: a bulk discount request

| | |
|---|---|
| Type | `price_override` |
| From | Yale AI Club, 4:55 PM |
| Wants | 20 × Basic Hoodie Big Yale (`CC-HOOD-NAVY`), size M |
| Notes | "Student org wants 20 hoodies, size M, asking for a bulk discount." |

How it connects to the data:

- **Inventory:** there are only **8** navy hoodies in size M. The shop can't supply 20 in M from stock. It has 32 hoodies across all sizes (S 4, M 8, L 14, XL 6).
- **Pricing:** the list price is $58.00 and the cost is $22.00.

| 20 hoodies | Total | Profit |
|---|---|---|
| At full price ($58) | $1,160.00 | $720.00 |
| At cost ($22) — the lowest possible price | $440.00 | $0.00 |

Any discount takes the price per hoodie somewhere between $58 and $22. For example, 10% off is $52.20 each ($1,044 total), and 20% off is $46.40 each ($928 total).

- **No discount rules exist in the database**, so how much discount to give is the owner's decision.
- **Restocking:** apparel reprints come from Bulldog Print Co (5-day lead time), the vendor whose bill is already overdue.

What it means for the agents: "price override" means changing a price, so an agent shouldn't grant it on its own. It can lay out the facts (only 8 in M, cost floor $22, what each discount would bring in) for a person to decide. It should also point out the stock problem before anyone agrees to a deal.

### How the three tickets connect to each other

The tickets look separate, but they share the same limited resources:

- **Cash ($3,400)** has to cover the rent (Ticket 102) and the overdue reprint bill (linked to Ticket 101).
- **The overdue bill** (invoice 501) is what's needed to restock the tee for Ticket 101. The same vendor would supply the extra hoodies for Ticket 103.
- **Stock** is short for both product requests: 0 tees in S, and 8 hoodies in M when 20 are wanted.

So the order the shop handles things in matters. Paying rent on time protects the shop's space. Paying the overdue reprint unblocks the customer's order and keeps the main apparel vendor happy. The discount request is the least urgent, and it can't be fully filled from stock anyway.

---

## What the agents need from this database

| Agent task | Tables it reads | Tables it might change | Checks it needs |
|---|---|---|---|
| Answer a customer order | `tickets`, `inventory`, `pricing` | `tickets` (status), `inventory` (qty) | Is the size in stock? Never promise stock that isn't there. |
| Pay a bill or the rent | `tickets`, `invoices`, `leases`, `vendors`, `cash_accounts`, `desk` | `payments`, `cash_accounts`, `invoices`, `leases`, `tickets` | Does the request match the record on file? Is there enough cash? Has a person approved it? |
| Respond to a discount request | `tickets`, `pricing`, `inventory` | `tickets` | Never price below cost. Leave the final price to a person. |
| Plan a restock | `inventory`, `vendors`, `invoices` | — | Which vendor supplies it, and how long it takes? |

## Things the database doesn't tell us

- **No customer records.** Ticket 101 has only the customer's name; there's no email, phone or order history.
- **No discount policy.** There's no rule for how much discount is allowed.
- **No reprint quantity.** Invoice 501 doesn't say how many tees the $840 buys or when they'll arrive.
- **No incoming money.** There's no record of expected sales or deposits, only the current balance.
- **No vendor contact details.**
- **No product details** beyond name, size, stock, shelf, cost and price (no descriptions, colors or images).

---

## MCP server tools (Problem 3)

The MCP server in `mcp_server/server.py` started with three tools for looking things up in the database (this section). Problem 5 added more; see [MCP server tools after Problem 5](#mcp-server-tools-after-problem-5). It's built with FastMCP. In Problem 4 it was connected to Claude Code (see [Connection to Claude Code](#connection-to-claude-code-problem-4) below). See `mcp_server/README.md` for setup.

### Ground rules for all three tools

- **Working copy only.** The tools read `data/campus_customs_new.db`. The server refuses to open the original, `data/campus_customs.db`.
- **Read-only.** The database is opened in read-only mode, so the tools can't change any data. None of them pays a bill, changes a price or changes stock. Those actions need a person's approval and will come later.
- **Database facts only.** Every number comes from the database or is calculated from it. "Today" is the shop's date in `desk` (August 31, 2026), and amounts owed come from the records, not from emails or tickets.

### Summary

| Tool | Tables it reads | Ticket |
|---|---|---|
| `check_stock` | `inventory`, `pricing` | 101 (also useful for 103) |
| `get_payments_due` | `desk`, `cash_accounts`, `invoices`, `vendors`, `leases` | 102 (also covers invoice 501 behind 101) |
| `price_bulk_order` | `pricing`, `inventory` | 103 |

### `check_stock(sku, size=None)`

**What it does:** It shows how many of a product are in stock in each size, where the product is shelved and its list price. If you give a size, it also says whether that size is in stock and lists the other sizes that are.

**Tables it uses:** `inventory` (name, size, quantity, shelf) and `pricing` (list price).

**Ticket:** **101.** Tauhid Zaman wants a Classic Bulldog Tee (`CC-TEE-WHITE`) in size S. Calling `check_stock("CC-TEE-WHITE", "S")` returns:

| Result | Value |
|---|---|
| Size S | 0, not in stock |
| Other sizes in stock | M (5), L (3), XL (2) |
| Shelf | Aisle B |
| Price | $28.00 |

**Why it's needed:** An agent must never promise a customer something that isn't on the shelf. This tool gives the honest answer (size S is sold out) and suggests alternatives the agent could offer. It also shows the stock problem in Ticket 103: `check_stock("CC-HOOD-NAVY", "M")` shows only 8 hoodies in M.

### `get_payments_due()`

**What it does:** It lists every unpaid vendor bill and the next rent payment. For each one it shows who's owed, how much, the due date and the number of days left (negative means overdue). It also shows the cash in the bank and how much would be left after paying everything. It takes no inputs.

**Tables it uses:** `desk` (today's date), `cash_accounts` (balance), `invoices` and `vendors` (open bills and who sent them) and `leases` (rent).

**Ticket:** **102.** The landlord emailed that rent is due in 2 days, without giving an amount. The tool returns:

| Payee | For | Amount | Due | Days left |
|---|---|---|---|---|
| Bulldog Print Co | Invoice 501: rush reprint of CC-TEE-WHITE S | $840.00 | Aug 28 | **−3 (overdue)** |
| Elm City Properties | Rent, Chapel Street shop (lease 1) | $2,400.00 | Sep 2 | 2 |

Cash is $3,400.00, the total due is $3,240.00, and **$160.00** would be left after paying both.

**Why it's needed:** Emails asking for money are a common scam. This tool lets an agent check the request against the records: the landlord on file is Elm City Properties, the rent on file is $2,400 and the due date is 2 days away, so the email matches. It also shows that paying the rent leaves very little cash, and that invoice 501 (the restock behind Ticket 101) is still unpaid and overdue. A person can then decide what to pay, and in what order, with all the facts in one place.

### `price_bulk_order(sku, size, qty, discount_percent=0)`

**What it does:** It works out what a bulk order would cost the customer and earn the shop at a given discount. It reports:
- the price per item and the total
- the profit
- whether the price is below cost
- the break-even discount (`break_even_discount_percent`): the discount at which the price equals the shop's cost. This field was called `max_discount_percent_without_loss` in Problems 3 and 4 and was renamed in Problem 5 so it can't be mistaken for a discount policy.
- how many are in stock in that size, and how many short the order would be

It only calculates. It marks any discount as needing a person's approval and never changes a price.

**Tables it uses:** `pricing` (cost and list price) and `inventory` (stock in that size).

**Ticket:** **103.** Yale AI Club wants 20 Basic Hoodie Big Yale (`CC-HOOD-NAVY`) in size M at a bulk discount. For example, `price_bulk_order("CC-HOOD-NAVY", "M", 20, 10)` returns:

| Result | Value |
|---|---|
| Price per hoodie at 10% off | $52.20 (list $58.00) |
| Total | $1,044.00 (vs. $1,160.00 at list price) |
| Profit | $604.00 |
| Below cost? | No |
| Break-even discount (zero profit; a limit, not a recommendation) | 62.07% (the cost is $22.00) |
| In stock in M | 8, so **12 short** |
| Needs a person's approval | Yes |

**Why it's needed:** The database has no discount rules, so an agent shouldn't decide on a discount by itself. This tool gives the person deciding the facts: what each discount would bring in, the point where the shop would lose money, and the fact that only 8 of the 20 hoodies are in stock. All of that has to be settled before anyone agrees to the deal.

### Connection to Claude Code (Problem 4)

The server is connected to Claude Code through `.mcp.json` at the repository root, under the name `campus-customs`. Claude Code starts the server itself with the Python in `mcp_server/.venv`. All three tools were tested through Claude Code using the three tickets, and their results matched the working database. The results are saved in `output/mcp_smoke.json` and explained in `output/mcp_tests.md`, and `mcp_server/test_tools.py` repeats the check automatically.

---

## The agent team (Problem 5)

Problem 5 adds five AI agents that work the open tickets together: **Boss, Inventory, Accounting, Facilities and Customer Service**. They're built with PydanticAI in `backend/`. They get all shop information from the MCP server, which reads the working database (`data/campus_customs_new.db`), and they follow the shop's rules below.

| File | What it is |
|---|---|
| `backend/agents.py` | The five agents, the model connection, delegation between agents, audit logging and the code checks on agent output |
| `backend/models.py` | The data types the agents return (reports, approval requests, draft messages) and the shared run context |
| `backend/prompts/` | The instructions: `shop_rules.md` (shared by every agent) plus one file per agent |
| `backend/config.py` | Settings: the model, Portkey, file paths and the usage limits |
| `backend/audit.py` | The audit trail, `output/audit_trail.json` |
| `backend/run.py` | Runs the team on one ticket or all open tickets |
| `backend/approve.py` | Where a person approves or rejects payment and discount requests |
| `backend/tests/test_agents.py` | Offline tests (no AI calls) of the wiring, rules, audit trail and limits |

### The shop's rules

These are the rules as the shop gave them. They're in `backend/prompts/shop_rules.md`, which every agent receives, and the table shows where the code enforces each one so it doesn't depend on the agents following instructions.

| Rule | How it's enforced |
|---|---|
| All payments require human approval and must be recorded in the database. | No agent can record a payment: `record_payment` only exists when the MCP server is started in the approver role, which only `approve.py` does. A person must approve and type their name. The payment is then written to `payments` with `approved_by` set to that name. |
| Payments cannot exceed available cash or result in a negative balance. | `check_payment` and `record_payment` refuse a payment larger than the cash balance. `record_payment` re-checks inside a database transaction and only takes money out if the balance stays at $0 or more. The output check also refuses payment requests that together exceed the cash. |
| Vendors with unpaid invoices cannot ship additional products. | `get_vendor_status` reports `can_ship_additional_products: false` for any vendor with an unpaid invoice. Bulldog Print Co is in that position because of invoice 501. A purchase request from such a vendor carries a warning that it can't ship until the invoice is paid, and the approver must confirm it. |
| Revenue is only received when customers pick up their orders. | Available cash is only the `cash_accounts` balance. No tool counts expected sales, and the agents are told never to. |
| Discounts require human approval, and there is no established discount policy. | Agents may evaluate discount levels for a specific request and recommend one, but only inside a discount approval request for a person. The figures for every option are re-checked with `price_bulk_order`, and a recommendation must be one of the evaluated options and give a reason. Agents are told not to state any general discount rule. Customer drafts that mention a percentage, "$X off" or a price other than the list price are sent back. Only a person sets a discount, in `approve.py`. |
| Agents can draft customer messages but cannot send them or contact vendors directly. | There is no tool for sending anything. Every draft has `sent: false` (it can't be set to true). Drafts are only accepted when addressed to the requester of a customer ticket, never to a vendor or the landlord. |
| Use `desk.date_today` as the shop's date. | Every date calculation in the MCP server uses `desk.date_today` (August 31, 2026). Payments are recorded with that date. |
| All five agents must use gpt-6-luna through Portkey with PORTKEY_API_KEY. | One function creates the model: `gpt-6-luna` at `https://api.portkey.ai/v1`, authenticated with `PORTKEY_API_KEY`. The team refuses any other model name. |
| *(how the model is reached)* | gpt-6-luna is a reasoning model, and Portkey's chat-completions endpoint doesn't allow function tools while it reasons. Every agent needs tools (MCP tools, `delegate`, and the structured-output tool PydanticAI uses for typed results), so the agents use the **Responses endpoint** (`/v1/responses`) with **low** reasoning effort by default. `OPENAI_ENDPOINT=chat` in `hw5/.env` switches to chat completions with reasoning off (`reasoning_effort: none`). `OPENAI_REASONING_EFFORT` changes the effort. Found in Problem 9: the first connection check passed the plain reply but failed the tool call and structured output on chat completions. |
| Keep the API key private and out of GitHub. | The key is read from `hw5/.env`, which `.gitignore` keeps out of GitHub. `hw5/.env.example` has an empty placeholder. The key is only sent to Portkey, never passed to the MCP server and never written to the audit trail. |

### The five agents

| Agent | Responsibilities | MCP tools it can use | Tables behind those tools |
|---|---|---|---|
| **Boss** | Reads the ticket and delegates work to the right teammates. Combines their answers, checks they agree (for example, payments fit in the cash), and returns one plan for the staff: findings, decisions, approval requests, customer drafts and follow-ups. It approves nothing. | `list_open_tickets`, `get_ticket` | `tickets`, `invoices`, `vendors`, `leases`, `payments`, `desk` |
| **Inventory** | Reports stock by size, shortfalls and shelf locations. For restocking, names vendors whose listed specialty fits and says whether they're allowed to ship. Only estimates arrival from `lead_days` if the vendor can ship. Can prepare a purchase request for a ticket's shortfall for a person to approve. | `get_ticket`, `check_stock`, `get_vendor_status` | `tickets`, `inventory`, `pricing`, `vendors`, `invoices`, `desk` |
| **Accounting** | Handles bills, rent, cash and pricing facts. Checks every payment with `check_payment` before requesting approval, and makes sure requests together fit in the cash. For discount requests, evaluates a few discount levels with `price_bulk_order` and may recommend one for that request, with reasons, for a person to decide. | `get_ticket`, `get_payments_due`, `check_payment`, `price_bulk_order`, `get_vendor_status` | `tickets`, `invoices`, `vendors`, `leases`, `payments`, `cash_accounts`, `pricing`, `inventory`, `desk` |
| **Facilities** | Handles the lease and rent. Checks a rent notice against the lease on file: landlord, due date, amount, and how much is still owed for that date. Reports mismatches for a person to verify. | `get_ticket`, `get_lease`, `get_payments_due` | `tickets`, `leases`, `payments`, `invoices`, `vendors`, `cash_accounts`, `desk` |
| **Customer Service** | Writes short, honest drafts to the customer who raised the ticket. It never sends them, never offers a discount and never promises a date that isn't confirmed. | `get_ticket`, `check_stock` | `tickets`, `inventory`, `pricing`, `invoices`, `vendors`, `leases`, `desk` |

Each agent's instructions are its own prompt file (`backend/prompts/<agent>.md`) plus the shared `shop_rules.md`. A short "This run" section is added automatically with the agent's name, the shop's date, the ticket and who it can still delegate to.

### How the agents communicate

- Every agent has a `delegate(to, task)` tool for asking a teammate to do a specific task. The teammate runs with its own instructions and tools and returns a structured report (`AgentReport`). The Boss usually delegates, but specialists can too (for example, Facilities can ask Accounting to check a rent payment).
- **Limits on delegation:**
  - An agent can't delegate to itself, or to an agent already working on the same request, so there are no loops.
  - Delegation goes at most two levels deep (Boss → specialist → specialist).
  - A ticket can use at most 8 delegations.
- All agents working on one ticket share one usage budget (see [Limits on AI usage](#limits-on-ai-usage)).

### What the agents produce

The Boss returns a `TicketResolution` (`backend/models.py`):

| Field | Meaning |
|---|---|
| `status` | `needs_human_approval` if anything needs approving, otherwise `ready_for_review` |
| `summary`, `findings`, `decisions` | What was found (with the tools each fact came from) and what the team decided or recommends, with reasons |
| `payment_approvals` | Payments for a person to approve: kind, invoice or lease number, payee, amount, due date, reason, cash before and after, and any warnings from `check_payment` |
| `discount_approvals` | Discount requests for a person to decide: the facts, the discount levels evaluated (price, total and profit for each), and the agents' recommendation for that request with its reason. A person makes the decision. |
| `purchase_approvals` | Requests to buy more stock for a ticket (added in Problem 7). Each gives the item and exactly the ticket's shortfall, plus facts filled in from the records: stock, vendor, lead time, whether the vendor can ship, unpaid invoices, an estimated cost and warnings. A person approves or rejects; approval doesn't place an order. |
| `draft_messages` | Customer drafts, always `sent: false` |
| `human_follow_ups` | Things only a person can do, such as contacting a vendor |
| `unknowns` | What the tools couldn't tell the agents |

### Checks in code before an answer is accepted

Before any agent's answer is accepted, `check_output` in `backend/agents.py` checks it. If something is wrong, the answer goes back to the agent with the problems listed (up to 2 times), and each rejection is recorded in the audit trail.

- **Payment requests:** each one is re-run through `check_payment` on the MCP server, and it must be allowed: the invoice or lease exists, and the amount is more than $0 and fits in the cash. The payee, due date, cash figures and warnings (for example a partial payment) are replaced with the values from the records. All requests together must fit in the available cash.
- **Discount requests:** list price, unit cost, total, stock, break-even and the figures for every evaluated option are replaced with the values from `price_bulk_order`. A recommendation must be one of the evaluated options and must give a reason.
- **Customer drafts:**
  - They must be addressed to the ticket's requester, and only on a customer ticket (`customer_order` or `price_override`).
  - They can't be addressed to a vendor.
  - They can't mention a percentage, "$X off", a discounted price, or any dollar amount other than the item's list price or list-price total.
- **The Boss's result:** it must be for the right ticket, and its status must be `needs_human_approval` if anything needs approval.

### Human approval

`python approve.py --list` shows the requests waiting for a decision. `python approve.py` lets a person decide them at a terminal; it refuses to run without a person typing.

- **Payments:** right before asking, `approve.py` checks the payment again **against the database as it is now**, not just as it was when the agents ran. The person sees:
  - how much is still owed and the cash before and after
  - any warnings: a bill already paid in full, an amount above what's still owed, or a partial payment
  - any other pending request for the same bill ("approving both would pay it twice")

  If there's any warning, typing `y` isn't enough: the person must also type `PAY ANYWAY`, or nothing is paid and the request stays pending. Then they type their name. `record_payment` re-checks the shop's payment rules (cash available, balance not negative). It works the warnings out again and refuses the payment unless the person confirmed exactly those warnings. So if the bill was paid by someone else in the meantime, nothing is paid and the request has to be reviewed again. A refused payment stays pending. Once a payment is accepted, it's recorded in one transaction:
  - it adds a `payments` row with `approved_by` set to the person's name and `paid_at` set to the shop's date
  - it lowers the `cash_accounts` balance
  - for an invoice, it sets the status to `paid` once the payments recorded for it cover the amount on file
  - for rent, it moves `leases.next_due` on one month for each full month's rent covered

  If a rule fails, nothing changes and the refusal is recorded.
- **Discounts:** the person sees the options the agents evaluated and their recommendation, then types the discount they choose, which can differ from the recommendation. That decision is recorded in the audit trail. Nothing is sent to the customer, and no price in the database changes.
- **Purchases:** the person sees the request checked live (stock, vendor, lead time, estimated cost) and any warnings. For example, *"Bulldog Print Co can't ship until its unpaid invoice(s) 501 ($840.00) are paid"*. They must confirm each warning (by typing `APPROVE ANYWAY` in `approve.py`). Approving only records the decision in the audit trail, with `order_placed`, `vendor_contacted` and `money_moved` all false. No order is placed, no vendor is contacted, no money moves and nothing in the database changes. A person places the order themselves, outside the system.

### Limits on AI usage

The limits are set in `backend/config.py` and apply to each ticket, shared by every agent working on it:

| Limit | Value |
|---|---|
| Model calls | 30 |
| Tool calls (MCP tools and delegations) | 40 |
| Total tokens (input + output) | 150,000 |
| Longest single model response | 4,000 tokens, including reasoning tokens (raised from 2,000 when the agents moved to the Responses endpoint with reasoning on) |
| Delegation depth / delegations per ticket | 2 / 8 |
| Model call timeout | 120 seconds, 1 retry |

If a limit is reached, the run stops. The stop is recorded in the audit trail (`usage_limit_exceeded`), and `run.py` moves on to the next ticket. Each finished run records the model calls, tool calls and tokens it used.

### The audit trail: `output/audit_trail.json`

Every action is added as one entry:

| Event | Recorded when |
|---|---|
| `run_started` / `run_finished` | A ticket run starts and ends (with the model, the limits, the outcome and the usage) |
| `tool_call` / `tool_result` / `tool_error` | An agent calls an MCP tool: which agent, which tool, the arguments and the result |
| `delegation` / `delegation_result` | One agent gives another a task, and the report it gets back |
| `output_rejected` | A code check sends an agent's answer back, with the problems |
| `resolution`, `decision`, `human_follow_up` | The Boss's final plan and each decision and follow-up in it |
| `approval_requested` | A payment or discount request waiting for a person (with an `approval_id`) |
| `draft_message` | A customer draft (always `sent: false`) |
| `approval_decision`, `payment_recorded`, `payment_refused` | A person's decision in `approve.py` and what happened |
| `usage_limit_exceeded`, `run_error` | A run stopped by a limit or an error |

Each entry has a timestamp (UTC), the shop's date, the run ID, the ticket, the agent and the event. The file is a JSON array with one entry per line. New entries only replace the closing `]`, so earlier activity is never rewritten or deleted. If the file is damaged, nothing is written to it, so it's never overwritten. `python audit.py` shows recent entries.

### What has been verified, and what still needs testing

The agents have **not yet been run with the real model**. This session had no Portkey key, and its network blocked `api.portkey.ai`. Everything below was tested without AI calls. The model's part was played by a scripted stand-in (PydanticAI's `FunctionModel`), with the real MCP server running on a temporary copy of the database.

**Verified** (`backend/tests/test_agents.py`, 31 tests, `backend/tests/test_api.py`, 16 tests, and `mcp_server/test_tools.py`, all passing):

| Area | What was checked |
|---|---|
| MCP look-ups | The Problem 3 tools return values that match direct SQL queries of the working database (`test_tools.py`). The new tools return the expected values for tickets 101–103. |
| Paying twice | Two pending requests for the same bill are flagged. After the first is paid, the second shows "already paid in full" (checked live) and isn't paid unless the person types `PAY ANYWAY`. More than is owed is flagged before paying. `record_payment` refuses warnings the approver didn't confirm. A refused payment stays pending. These were tested with scripted answers in place of a person typing. |
| Payment rules | A payment over the cash available is refused and nothing changes. Partial and extra payments and already-paid bills are allowed with warnings. An invoice is marked paid only when fully covered. Rent moves `next_due` on a month per full month paid, and the date arithmetic handles month ends. A vendor can't ship until its invoices are fully paid. `record_payment` doesn't exist for agents, and needs an approver's name. |
| Agent wiring | Each agent sees only its own MCP tools. Delegation works and is recorded. Delegating to yourself, looping back, going too deep or exceeding the count is refused. A runaway run stops at the usage limit and is recorded. |
| Output checks | Payment requests are re-checked against the records (including cash for all requests together), and warnings are attached, including when the same bill appears twice in one plan. Discount options and facts are replaced with the records' values. A recommendation must be an evaluated option with a reason. Customer drafts can't mention a discount, quote another price, or go to a vendor, the landlord or anyone but the customer requester. |
| Audit trail | New entries are added and earlier ones kept. The file stays valid JSON, and a damaged file is never overwritten. |
| Model setup | The model object is `gpt-6-luna`, at Portkey's address, with the key sent once, in the `Authorization: Bearer` header. Any other model name is refused. A missing key gives a clear error. The key isn't passed to the MCP server. No request was sent to Portkey. |
| Databases | Both real database files are unchanged after every test run. |

**Still needs testing with the real model and a Portkey key:**

1. **Connection:** that Portkey accepts the key and routes the model name `gpt-6-luna` exactly as written. Depending on how the Portkey account is set up, it may expect a provider prefix or a config, which hasn't been checked.
2. **Tools and structured output:** that gpt-6-luna supports tool calling and the structured output the agents return, through Portkey's OpenAI-compatible API.
3. **Agent behavior:** whether the agents actually follow their instructions on the three tickets. For example:
   - whether the Boss delegates sensibly
   - whether Accounting evaluates discount levels and makes a sensible, well-reasoned recommendation
   - whether drafts are accurate and helpful
   - how often the output checks have to send answers back

   The code checks catch rule-breaking output, but not poor judgment.
4. **Limits:** whether the usage limits (30 model calls, 40 tool calls, 150,000 tokens per ticket; 4,000 tokens per response) suit real runs, and what a ticket actually costs.
5. **End-to-end scripts:** `run.py` with the real model, and `approve.py` typed by a real person at a terminal. Its decision steps were tested with scripted answers, not by a person.
6. **Other setups:** Windows (the MCP server path in `.mcp.json` and `config.py`), and two runs writing to the audit trail at the same time from separate processes.

## MCP server tools after Problem 5

The MCP server grew from three tools to eight read-only tools plus one approver-only write tool. Problem 7 added a ninth read-only tool, `list_tickets`, for the API. All of them use the working copy only.

| Tool | What it does | Tables it uses | Ticket(s) | Used by |
|---|---|---|---|---|
| `list_tickets()` | Lists every ticket with its status (added in Problem 7 for the API) | `tickets`, `desk` | All | The API (`GET /api/tickets`); no agent |
| `list_open_tickets()` | Lists open tickets, oldest first, with the shop's date | `tickets`, `desk` | All | Boss |
| `get_ticket(ticket_id)` | One ticket with its linked invoice (and vendor) or lease, and whether the requester is a customer | `tickets`, `invoices`, `vendors`, `leases`, `payments`, `desk` | All | All five agents |
| `check_stock(sku, size=None)` | Stock by size, shelf and list price | `inventory`, `pricing` | 101, 103 | Inventory, Customer Service |
| `get_vendor_status(vendor_id=None)` | Vendors, specialty, lead time, unpaid invoices and `can_ship_additional_products` | `vendors`, `invoices`, `desk` | 101, 103 | Inventory, Accounting |
| `get_lease(lease_id)` | The lease: landlord, rent, next due date, days left, how much is paid toward and still owed for that date, and the rent payments recorded | `leases`, `payments`, `desk` | 102 | Facilities |
| `get_payments_due()` | Unpaid invoices and unpaid rent, cash available and cash left if all are paid | `invoices`, `vendors`, `leases`, `payments`, `cash_accounts`, `desk` | 101, 102 | Accounting, Facilities |
| `check_payment(kind, ref_id, amount, account="checking")` | Checks a payment against the payment rules without paying: blocks only an amount over the cash (or $0 or less), and warns about anything unusual such as a partial payment | `invoices`, `vendors`, `leases`, `payments`, `cash_accounts`, `desk` | 101, 102 | Accounting |
| `price_bulk_order(sku, size, qty, discount_percent=0)` | Price, cost, totals, profit, break-even discount and stock for a bulk order | `pricing`, `inventory` | 103 | Accounting |
| `record_payment(kind, ref_id, amount, approved_by, account="checking")` | **Approver role only.** Records a person-approved payment after re-checking every rule | Writes `payments`, `cash_accounts`, `invoices`; reads `leases`, `vendors`, `desk` | 101, 102 | No agent: only `approve.py` |

### Why the new tools were needed

- **`list_open_tickets` and `get_ticket`:** in Problem 3 the agents couldn't read tickets, so the details had to be typed in. Now the Boss reads the ticket and the records it links to directly. `requester_is_customer` tells the agents whether a customer message may be drafted.
- **`get_vendor_status`:** applies the vendor rule. For Ticket 101 it shows that Bulldog Print Co has unpaid invoice 501 ($840, 3 days overdue), so it can't ship more products, including a restock of the white tee in S or the 12 extra hoodies for Ticket 103, until that's paid.
- **`get_lease`:** for Ticket 102, it confirms the rent notice against the lease (Elm City Properties, $2,400, due September 2, 2 days away, not yet paid).
- **`check_payment`:** lets Accounting check a payment against the payment rules before asking for approval. For example, rent of $2,400 is allowed and would leave $1,000. $2,000 is allowed with a warning that $400 would still be owed. $5,000 is refused because it's more than the $3,400 in cash.
- **`record_payment`:** the rules say payments must be recorded in the database, and only a person may approve them. This tool is the only way to write a payment, and only the human approval script can reach it.

### Notes

- **Payment kinds:** payments are recorded with `kind` set to `invoice` (with `ref_id` = the invoice number) or `rent` (with `ref_id` = the lease number). The database didn't define these values (the `payments` table was empty), so they were chosen for this project.
- **What's still owed:** this comes from the records, not from a separate rule.
  - **Invoices:** what's owed is the invoice amount minus the payments recorded for it. The invoice is marked `paid` once those payments cover it.
  - **Rent:** all rent payments for the lease are added up. Each time they cover a full `monthly_rent`, `leases.next_due` moves on one month (same day, or the month's last day if it's shorter). Anything left over counts toward the new due date.
  - **No period column needed:** the `payments` table has no column for which month a payment covers. Counting this way avoids needing one, and avoids the 31-day window used in the first version of Problem 5.
- **Only the shop's rules block a payment:** a payment is refused only if it's more than the available cash or would make the balance negative (or is $0 or less, or names an invoice, lease or account that doesn't exist).
  - Partial payments, payments above what's owed, and payments on a bill already paid in full are allowed, with a warning the approver sees.
  - The first version of Problem 5 also refused payments that didn't exactly match the amount on file, and payments on bills already paid. Those weren't shop rules, so they were changed to warnings. The person approving decides.
  - Agents are still told to base amounts on what the records say is owed, never on an email or ticket.
- **Which tickets are customer tickets:** `customer_order` and `price_override` tickets count as customer tickets, because their requesters are buying from the shop. `rent_notice` doesn't, because the landlord isn't a customer.
- **Testing the server:** `mcp_server/test_tools.py` (Problem 4) was updated for the new tool list. It still passes against the working database. The new tools, including `record_payment`, are tested on a temporary copy of the database in `backend/tests/test_agents.py`.

---

## The backend API (Problem 7)

`backend/main.py` is a FastAPI app that lets the dashboard reach the agents and the shop database. Start it from `hw5/backend`:

```bash
uvicorn main:app --reload --port 8000
```

It's then at `http://localhost:8000`, with interactive docs at `http://localhost:8000/docs`. The dashboard's development server (`http://localhost:5173`) is allowed to call it. Other addresses can be set with `CORS_ORIGINS`.

### Ground rules

- **Shop information comes from the MCP server.** Tickets, stock, bills, rent and cash are read through the Campus Customs MCP server (agent role), which reads the working database. Payments are recorded only through the MCP server's approver-only `record_payment` tool. The API never reads or writes shop data in the database directly. The only exception is the reset route, which copies the database file (see below).
- **Same safeguards as `approve.py`.** Approvals use the shared `backend/approvals.py`, so the command-line script and the API apply exactly the same checks.
- **Everything is recorded.** Every run, tool call, delegation, approval decision, payment and reset is added to `output/audit_trail.json`. Nothing in it is overwritten.
- **One thing at a time.** Only one agent run or reset can happen at a time. This keeps AI costs and the database under control; a second request gets `409`.

### Routes

| Method and path | Purpose | Where the data comes from |
|---|---|---|
| `GET /api/health` | Is the API up? Shows the model (`gpt-6-luna`), whether `PORTKEY_API_KEY` is set (never its value), whether the working database exists, and whether a run or reset is in progress. | Settings |
| `GET /api/tickets` | The three tickets with their status, whether the requester is a customer, the agents' status for each (`not_run`, `running`, `needs_human_approval`, `ready_for_review`, `stopped_by_usage_limit`, `error`), the latest run and how many approvals are waiting | MCP `list_tickets` + audit trail |
| `GET /api/tickets/{ticket_id}` | One ticket with its linked invoice or lease (including what's still owed), its runs and its pending approvals | MCP `get_ticket` + audit trail |
| `POST /api/tickets/{ticket_id}/run` | Starts the agent team on a ticket in the background and returns `202` with a `run_id` right away. Returns `503` if `PORTKEY_API_KEY` isn't set, `404` for an unknown ticket, and `409` if a run or reset is already in progress. | Agents (through the MCP server) |
| `GET /api/runs` | Every agent run (optionally `?ticket_id=`), newest first | Audit trail |
| `GET /api/runs/{run_id}` | One run: `running`, `finished`, `stopped` or `error`; its outcome, usage (model calls, tool calls, tokens), number of delegations and the Boss's final plan | Audit trail |
| `GET /api/activity` | Agent activity for the dashboard to poll. Each event has `categories` and a one-line `summary`, for example `inventory called check_stock(sku='CC-TEE-WHITE', size='S')`. See the details below. | Audit trail |
| `GET /api/approvals` | Approval requests (`?status=pending` by default, or `decided`, `expired`, `all`; optional `?ticket_id=`). Each pending payment includes a live `review`: what's still owed, cash before and after, `warnings`, `problems`, `also_pending` and whether it `can_approve`. | Audit trail + MCP `check_payment` |
| `GET /api/approvals/{approval_id}` | One pending request, with the live review | Audit trail + MCP `check_payment` |
| `POST /api/approvals/{approval_id}` | Approve or reject a payment, purchase or discount request. See the details below. | MCP `record_payment` (approver role) for payments |
| `GET /api/cash` | The current checking balance (and as-of date), the bills and rent still owed, and the cash left if everything is paid. Order revenue isn't counted until pickup. | MCP `get_payments_due` |
| `POST /api/reset` | Resets the **working** database for a fresh run by copying the original over it. See the details below. | Database files |

### Activity

`GET /api/activity` filters:
- `?run_id=`
- `?ticket_id=`
- `?category=`, one of:
  - `messages`: delegation tasks, replies and customer drafts
  - `delegations`
  - `tools`: tool calls, results and errors
  - `decisions`
  - `approvals`
  - `runs`
  - `system`
- `?limit=`

It returns `next`. To refresh, the dashboard calls again with `?since=<next>` and gets only what's new. `running` says whether a run is still going.

### Approving a payment

The approval route (`POST /api/approvals/{approval_id}`) follows the safeguards from Problem 5. The body is:

```json
{"decision": "approve", "decided_by": "Pat", "confirmed_warnings": [...], "discount_percent": null, "note": ""}
```

1. **Live check:** the payment is checked again against the database as it is now.
2. **Shop rules:** if it would exceed the available cash or make the balance negative, the response is `409 not_allowed` and nothing is paid.
3. **Warnings:** the warnings include a bill already paid in full, more than is still owed, a partial payment, or another pending request for the same bill ("Approving both would pay it twice"). The person must confirm every one, by sending them back exactly in `confirmed_warnings`. Otherwise the response is `409 confirmation_required`, with the unconfirmed warnings listed, and nothing is paid.
4. **Recording:** `record_payment` re-checks the rules and the warnings inside one database transaction. If the bill changed in the meantime, it refuses (`409 refused`) and the request stays pending.
5. **Name required:** a name in `decided_by` is required (`422` without one).

For a **discount**, the person sends the `discount_percent` they chose. It's recorded in the audit trail only: nothing is sent to the customer and no price changes. `"decision": "reject"` closes any request. A request that isn't pending gets `409`, and an unknown ID gets `404`.

### Approving a purchase

A purchase request asks to buy stock a ticket needs. For Ticket 103, that's the 12 hoodies in M missing from the 20 wanted.
- **Review:** `GET /api/approvals` shows each pending purchase with a live `review`: stock on hand, vendor, specialty and lead time, whether the vendor can ship, its unpaid invoices, an estimated cost (quantity × the shop's `unit_cost`; the database has no vendor price list), the `warnings` and `approval_effect`.
- **Warnings:** if the vendor has an unpaid invoice, the warning says it can't ship until the invoice is paid. Approving needs the same body as a payment, with every warning in `confirmed_warnings`, or the response is `409 confirmation_required`. A purchase linked to an invoice for the same item also gets a warning that it may already be on order (for example Ticket 101 and the reprint in invoice 501).
- **Effect:** approval only adds an `approval_decision` entry to the audit trail, with `order_placed`, `vendor_contacted` and `money_moved` all false. No order is placed, no vendor is contacted, no money moves and nothing in the database changes. `"decision": "reject"` closes the request. If the vendor's invoice is paid later, the warning disappears from the live review.

### Where purchase requests come from

Only Inventory prepares them, and the code checks every one before it's accepted:
- it must be for the ticket's own item (SKU and size)
- its quantity must be exactly the ticket's shortfall (quantity wanted minus quantity in stock)
- the vendor must exist
- the facts and warnings are filled in from the MCP server (`check_stock`, `get_vendor_status`, `price_bulk_order`)

A ticket without a product, like the rent notice, can't have one. No new MCP tool or database table was needed, and there are no other purchasing rules: no reorder levels, no automatic ordering and no vendor contact.

### Resetting the database

`POST /api/reset` needs the body `{"confirm": "RESET", "requested_by": "Pat"}`. It:
1. checks that the original (`data/campus_customs.db`) matches the database delivered in `data_2.zip`, and refuses otherwise without changing anything
2. copies it to a temporary file and checks the copy
3. puts the copy in place of the working database (`data/campus_customs_new.db`)

The original is only read, never written. The audit trail is kept, and a `database_reset` entry is added with the fingerprints before and after. Approval requests still pending from before the reset are marked **expired**: they referred to the old database, so they can no longer be approved. They're still listed with `?status=expired`. A reset is refused while an agent run is in progress.

### Testing

`backend/tests/test_api.py` has 16 tests (47 in the backend suite in total). They:
- run the API against a temporary copy of the working database and a temporary audit trail, and confirm both real database files are unchanged afterwards
- cover every route
- run the agent team on Ticket 101 with the scripted stand-in model (no AI calls), checking the run status and the activity in each category, and that polling with `since` returns only new events
- run through every payment safeguard (duplicate warning, confirmation required, already paid, cash limit) and the discount and reject paths
- cover purchase approval: the vendor warning must be confirmed, approval leaves the database unchanged, rejection works, the warning clears once the vendor's invoice is paid (in the temporary copy), and the command-line path works
- cover reset, including refusing an original that doesn't match

The real server was also started with `uvicorn main:app --reload --port 8000` from `hw5/backend`. The read-only routes were called against the working database. `POST /api/tickets/101/run` correctly answered `503` because no Portkey key is set. No payment, reset or agent run was made against the working database, and the real audit trail is still empty.

---

## The dashboard (Problem 8)

`frontend/` is a React + Vite + TypeScript dashboard that uses the backend routes above. It doesn't read the database or call the MCP server itself. Start the backend, then run `npm run dev` in `frontend/` and open `http://localhost:5173`. The layout and design are explained in `output/design.md`.

| Dashboard part | Backend routes it uses |
|---|---|
| Header: shop date, model, connection, checking balance | `GET /api/health`, `GET /api/tickets`, `GET /api/cash` |
| Ticket stubs and status pills | `GET /api/tickets`, `GET /api/approvals?status=all` |
| Ticket header | `GET /api/tickets/{id}` |
| Run the agents | `POST /api/tickets/{id}/run` |
| Live activity, team strip, run summary | `GET /api/runs/{run_id}` and `GET /api/activity?run_id=…&since=…` (every second while a run is going) |
| Approvals panel | `GET /api/approvals?status=all` and `POST /api/approvals/{id}` |
| Cash panel | `GET /api/cash` (refreshed after every decision and run, and every 10 seconds) |

**Ticket status:**
- **Resolved:** the latest run finished, and either needed no approval or had every request decided.
- **Needs action:** a request from the latest run is pending, or expired in a reset.
- **Failed** or **Stopped:** the run errored or hit a usage limit. These are never shown as resolved.

**Testing:**
- **Unit tests:** `npm test` (9 tests) covers the status logic.
- **Build:** `npm run build` type-checks and builds.
- **End-to-end:** `npm run e2e` makes 32 checks in Chromium. It uses `backend/tests/scripted_server.py`, which is the real backend and MCP server on temporary copies of the data, with scripted agents instead of gpt-6-luna (no AI calls, no real money).

The dashboard was also opened against the real backend and working database. It showed the tickets and the $3,400.00 balance, and correctly reported that a run needs `PORTKEY_API_KEY`. Nothing was changed.

---

## Safety rules (all in one place)

These are every safeguard in the system, and where each is enforced. Most are enforced in code, so they don't depend on the agents following their instructions. The agents' instructions (`backend/prompts/shop_rules.md`) repeat them so the agents plan within them in the first place.

### The shop's rules

| Rule (as given by the shop) | Enforced by |
|---|---|
| All payments require human approval and must be recorded in the database. | **MCP server:** `record_payment` exists only in the approver role, which agents, the API's look-ups and Claude Code never use. It needs the approver's name and writes a `payments` row. **Approvals:** only `approvals.py` starts the approver role, after a person approves in the dashboard or `approve.py`. |
| Payments cannot exceed available cash or result in a negative balance. | **MCP server:** `check_payment` and `record_payment` refuse an amount over the cash. `record_payment` re-checks inside one database transaction and only lowers the balance if it stays at $0 or more. **Agent output check:** all the payment requests in a plan together must fit in the cash. |
| Vendors with unpaid invoices cannot ship additional products. | **MCP server:** `get_vendor_status` sets `can_ship_additional_products: false` while any invoice is unpaid (fully paid only when payments cover it). **Purchases:** a purchase request from such a vendor carries a warning the approver must confirm. |
| Revenue is only received when customers pick up their orders. | **MCP server and API:** available cash is only the `cash_accounts` balance. No tool or route counts expected sales. |
| Discounts require human approval; there is no discount policy, so don't invent one. | **Data types:** agents can recommend a discount for one request, but only inside a discount approval request. **Agent output check:** the options' figures are re-checked, the recommendation must be one of them with a reason, and customer drafts can't mention a discount or discounted price. **Approvals:** only a person sets a discount. Nothing changes in the database and nothing is sent. |
| Agents can draft customer messages but cannot send them or contact vendors. | **No sending tool exists anywhere.** Drafts have `sent: false`, which can't be changed. **Agent output check:** drafts are only accepted when addressed to the requester of a customer ticket, never to a vendor or the landlord. Purchase approval doesn't contact a vendor either. |
| Use `desk.date_today` as the shop's date. | **MCP server:** every date calculation uses it, and payments are recorded with it. |
| All five agents use gpt-6-luna through Portkey with `PORTKEY_API_KEY`; keep the key private and out of GitHub. | **Agents:** one function builds the model, and the team refuses any other model name. **Key:** it's read from `hw5/.env` (ignored by Git) or provided by the cloud environment's network secret for `api.portkey.ai`. It's sent only to Portkey, never passed to the MCP server, written to the audit trail or shown by the API (`/api/health` only says whether it's set). |

### Safeguards added along the way

| Safeguard | Where |
|---|---|
| **Paying a bill twice.** Each payment is checked again live when a person reviews it. A bill already paid, more than is owed, a partial payment and another pending request for the same bill are all warnings. The person must confirm each one (tick each box in the dashboard, or type `PAY ANYWAY` in `approve.py`), and `record_payment` refuses unless exactly those warnings were confirmed. A refused payment stays pending. | `approvals.py`, `record_payment`, dashboard |
| **Facts in requests come from the records.** Payee, amounts, cash, stock, costs and vendor status in approval requests are replaced with the MCP server's values before an agent's answer is accepted. | `check_output` in `agents.py` |
| **Purchases only for what a ticket needs.** A purchase request must be for the ticket's own item and exactly its shortfall. Approving it records the decision only: no order, no vendor contact, no money. | `check_output`, `approvals.py` |
| **Agents only see the tools their job needs.** No agent can see `record_payment`. | `TOOLS_BY_AGENT` in `agents.py` |
| **Limits on AI usage.** Per ticket: 30 model calls, 40 tool calls, 150,000 tokens; 4,000 tokens per response (including reasoning); delegation at most 2 levels deep and 8 times; one run or reset at a time. | `config.py`, `agents.py`, `main.py` |
| **Only the working copy changes.** The original database is only read (by setup and reset). The MCP server refuses to open it. Reset checks the original's fingerprint first, and only replaces the working copy. Requests pending from before a reset expire. | `mcp_server/server.py`, `setup_db.py`, `POST /api/reset` |
| **Nothing is overwritten in the audit trail.** New entries replace only the closing `]`. A damaged file is never written to. | `audit.py` |
| **Honest status.** A run that errors or hits a usage limit is never shown as resolved. | `frontend/src/status.ts` |

## Setting everything up

In this order (each README has the details):

1. **Database:** `python3 setup_db.py path/to/data_2.zip` (in `hw5`). This creates the original and the working copy. See `README.md`.
2. **MCP server environment:** create `mcp_server/.venv` and `pip install -r requirements.txt`. See `mcp_server/README.md`.
3. **Backend environment:** create `backend/.venv` and `pip install -r requirements.txt`. See `backend/README.md`.
4. **Portkey key:** either copy `.env.example` to `.env` and set `PORTKEY_API_KEY` (on your own computer), or add a network secret for `api.portkey.ai` (header `Authorization`, Bearer) to the cloud environment.
5. **Check the model:** `python check_portkey.py` (in `backend`). It makes three tiny calls (a plain reply, a tool call and structured output) without touching the database or the agents. Don't continue until all three pass.
6. **Backend:** `uvicorn main:app --reload --port 8000` (in `backend`).
7. **Dashboard:** `npm install` once, then `npm run dev` (in `frontend`), and open `http://localhost:5173`.

## Problem 9: Resolving the tickets

All three tickets were run with the real agents on **gpt-6-luna** through Portkey, from the dashboard on the user's Mac, on 2026-11-07 (commit `44a51f8`). Everything below comes from `output/audit_trail.json` (94 entries from those runs) and from the working database on the Mac, read by `backend/build_results.py`. The detailed results are in `output/desk_tickets.html` (Actual sections and Cash tab), `output/resolved_tickets.json` and `output/resolved_board.html`.

### Connection

`backend/check_portkey.py` (a plain reply, a tool call and structured output) first failed the tool-call and structured-output checks. The cause was that gpt-6-luna doesn't allow function tools on the chat-completions endpoint while it reasons. After the agents moved to the Responses endpoint with low reasoning effort, all three checks passed on the Mac.

### Results

| | Ticket 101 — white tee | Ticket 102 — rent | Ticket 103 — hoodies and discount |
|---|---|---|---|
| Run | `run_ef7b73a0f445` | `run_3e67de5ec54a` | `run_332782f5368f` |
| Boss contacted first | Inventory (as planned) | Facilities (as planned) | **Accounting** (plan: Inventory) |
| Delegations | Boss → Inventory, Accounting, Customer Service | Boss → Facilities, Accounting | Boss → Accounting, Inventory, Customer Service |
| Agents not involved | Facilities (as planned) | Inventory, Customer Service (as planned) | Facilities (as planned) |
| Usage | 11 model calls, 11 tool calls, 41,451 tokens | 7 model calls, 7 tool calls, 26,109 tokens | 9 model calls, 13 tool calls, 35,442 tokens |
| Requests | Pay invoice 501 ($840); buy 1 × CC-TEE-WHITE S | Pay rent, lease 1 ($2,400) | Discount (agents recommend 5%); buy 12 × CC-HOOD-NAVY M |
| Human decisions | None yet: **2 pending** | Rent **approved by Cherisse Berry** | None yet: **2 pending** |
| Status | **Needs action** | **Resolved** | **Needs action** |

**What each agent contributed:**
- **Ticket 101:**
  - Inventory found 0 in size S and that Bulldog Print Co can't ship while invoice 501 is unpaid, and it prepared a 1-unit purchase request.
  - Accounting confirmed paying invoice 501 is allowed (leaving $2,560 then).
  - Customer Service drafted a short holding reply to Tauhid Zaman (not sent).
- **Ticket 102:**
  - Facilities confirmed the notice matches lease 1 (landlord, due date). It noted the notice gives no amount, so the $2,400 on file applies.
  - Accounting checked the payment (allowed, no warnings, $1,000 left).
- **Ticket 103:**
  - Accounting evaluated 0%, 5%, 10% and 15% with `price_bulk_order` and recommended **5% for this request only** ($1,102 total, $662 profit, well below the 62.07% break-even). A person decides.
  - Inventory found 8 in M (12 short) and the vendor block, and prepared the 12-unit purchase request.
  - Customer Service drafted a reply saying the discount request is under review (not sent, no discount mentioned).

**Compared with the Problem 6 plan:**
- **Ticket 102:** matched completely.
- **Ticket 103:** the Boss asked Accounting before Inventory.
- **Ticket 101:** Inventory requested a purchase of the tee, although invoice 501 is already the rush reprint of that exact item. The plan expected no new purchase. The code attached a warning that invoice 501 "may already cover this item", for the person deciding.
- **Customer Service:** in Tickets 101 and 103 it used `get_ticket` but not `check_stock`. So the Ticket 101 draft doesn't offer the M, L and XL sizes that are in stock.
- **Extra `get_ticket` calls:** several agents also called `get_ticket` themselves, beyond the planned tools.
- **No failures:** no answer was sent back by a rule check, and no tool failed.

### Cash

| | Change | Balance |
|---|---|---|
| Start | | **$3,400.00** |
| Ticket 102: rent to Elm City Properties (lease 1), approved by Cherisse Berry | −$2,400.00 | $1,000.00 |
| Tickets 101 and 103 | No money moved (all requests pending; a purchase or discount approval never moves money) | $1,000.00 |
| **Final, from the working database** | | **$1,000.00** |

- **The final balance matches the database:** starting balance minus recorded payments equals the working database's balance. Payment 1 is recorded on lease 1, and the lease's next due date moved to 2026-10-02.
- **Still owed:** invoice 501 ($840, overdue) and October's rent ($2,400, due 2026-10-02).
- **Starting balance:** **no database reset was recorded** before these runs, so the reset didn't record the starting balance. The $3,400 is the final balance plus recorded payments. It also matches the cash the agents themselves saw through `get_payments_due` and `check_payment` during Ticket 101 (11:52 UTC), before any payment.

### Safety rules in the real runs

- **Payments:** the only payment was made by a person (approved by Cherisse Berry) through `record_payment` in the approver role. No agent called `record_payment`.
- **Cash:** the payment fitted in the cash, and the balance never went below $1,000.
- **Vendor rule:** Bulldog Print Co's block was reported in both purchase requests.
- **Discounts:** the discount was recommended for one request only and left to a person, and neither draft mentions it.
- **Drafts:** both were addressed to the customer requesters and are unsent. No message was sent to anyone.
- **Revenue:** none was counted. The hoodie order didn't add to cash.
- **Date:** every date came from `desk.date_today` (2026-08-31).
- **Key:** no Portkey key appears in the audit trail or the output files (checked by `build_results.py` on the Mac, and by a pattern scan).

### Approval is not execution

A person's decision and the action that follows are separate things, and the reports keep them apart:

| Request type | What approval does | What actually happens |
|---|---|---|
| Payment | Records the decision **and** records the payment through `record_payment`, in one transaction | Money moves: the `payments` row is written and the balance goes down |
| Purchase | Records the decision in the audit trail only (`order_placed: false`, `vendor_contacted: false`, `money_moved: false`) | **Nothing is executed.** No order, no vendor contact, no money. A person would order outside the system. |
| Discount | Records the discount the person chose | Nothing is sent to the customer and no price changes |

**Decisions can't be reversed or amended.** Once a request is decided, the approval process treats it as closed: a second decision is refused, and there's no route or command to revoke or change one. The audit trail can only be added to, never edited.

**How an approved purchase is reported:** `build_results.py` shows it as **"Approved, not executed"**, with a status of **on hold** when the database shows it can't be carried out. The two reasons it checks:
- **The vendor can't ship** while its invoice is unpaid.
- **The cash isn't enough:** the estimated cost is more than the cash now, or more than the cash left after paying that vendor's unpaid invoice, which the vendor rule requires first.

For the 12 hoodies, that would read: Bulldog Print Co can't ship until invoice 501 ($840) is paid, and paying it would leave $160, less than the $264 estimate. The approval itself is never changed.

**The 12-hoodie purchase in the records:** as of the latest pushed results (commit `ddfd304`, built 14:04 UTC), the audit trail records **no decision** on it (`apr_3456414c3059`): it's **pending**. The Ticket 103 screenshot also shows it waiting. If it was approved on the Mac after that push, the approval appears only once the Mac's audit trail is pushed. The report will then show it as approved, not executed and on hold.

### Submission status

Done: all nine problems' files are in place (see `README.md`).
- **Runs and results:** the real runs, the human rent approval, the audit trail, the Actual and Cash sections, the Reflection, `resolved_tickets.json` and `resolved_board.html` are complete. The money is verified against the database.
- **Screenshots:** six real dashboard and page screenshots are in `output/resolved_screenshots/` and shown on the board.

Still open, for the user to decide or do:
1. **Pending requests:** in the pushed records, four requests are undecided: invoice 501 ($840), the 1-tee purchase, the 12-hoodie purchase and the discount. Tickets 101 and 103 show **Needs action** until each is approved or rejected, and Problem 9 asks to run the tickets "until each is resolved". These are the user's decisions.
2. **Homework 5 isn't on `main`:** it's only on the branch `claude/friendly-ritchie-om2axn`, so it needs merging (a pull request into `main`).
3. **The missing reset:** the database reset isn't recorded. The starting balance is backed up by the agents' own tool results and disclosed in the Cash tab. Resetting now would undo the approved rent payment.
4. **Optional:** making the model configurable through `OPENAI_MODEL` (the professor's semester rule) is waiting for a decision.
