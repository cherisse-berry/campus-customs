# Campus Customs Harness — Homework 5

This file explains the Campus Customs back-office database: what each table holds, how the tables connect, and what the agents need from it. It also explains the three open tickets and how each one connects to the data.

File paths in this document are relative to the `hw5` folder.

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

## `payments`: money paid out (empty)

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
| Vendors with unpaid invoices cannot ship additional products. | `get_vendor_status` reports `can_ship_additional_products: false` for any vendor with an unpaid invoice. Bulldog Print Co is in that position because of invoice 501. |
| Revenue is only received when customers pick up their orders. | Available cash is only the `cash_accounts` balance. No tool counts expected sales, and the agents are told never to. |
| Discounts require human approval, and there is no established discount policy. | Agents may evaluate discount levels for a specific request and recommend one, but only inside a discount approval request for a person. The figures for every option are re-checked with `price_bulk_order`, and a recommendation must be one of the evaluated options and give a reason. Agents are told not to state any general discount rule. Customer drafts that mention a percentage, "$X off" or a price other than the list price are sent back. Only a person sets a discount, in `approve.py`. |
| Agents can draft customer messages but cannot send them or contact vendors directly. | There is no tool for sending anything. Every draft has `sent: false` (it can't be set to true). Drafts are only accepted when addressed to the requester of a customer ticket, never to a vendor or the landlord. |
| Use `desk.date_today` as the shop's date. | Every date calculation in the MCP server uses `desk.date_today` (August 31, 2026). Payments are recorded with that date. |
| All five agents must use gpt-6-luna through Portkey with PORTKEY_API_KEY. | One function creates the model: `gpt-6-luna` at `https://api.portkey.ai/v1`, authenticated with `PORTKEY_API_KEY`. The team refuses any other model name. |
| Keep the API key private and out of GitHub. | The key is read from `hw5/.env`, which `.gitignore` keeps out of GitHub. `hw5/.env.example` has an empty placeholder. The key is only sent to Portkey, never passed to the MCP server and never written to the audit trail. |

### The five agents

| Agent | Responsibilities | MCP tools it can use | Tables behind those tools |
|---|---|---|---|
| **Boss** | Reads the ticket and delegates work to the right teammates. Combines their answers, checks they agree (for example, payments fit in the cash), and returns one plan for the staff: findings, decisions, approval requests, customer drafts and follow-ups. It approves nothing. | `list_open_tickets`, `get_ticket` | `tickets`, `invoices`, `vendors`, `leases`, `payments`, `desk` |
| **Inventory** | Reports stock by size, shortfalls and shelf locations. For restocking, names vendors whose listed specialty fits and says whether they're allowed to ship. Only estimates arrival from `lead_days` if the vendor can ship. | `get_ticket`, `check_stock`, `get_vendor_status` | `tickets`, `inventory`, `pricing`, `vendors`, `invoices`, `desk` |
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

### Limits on AI usage

The limits are set in `backend/config.py` and apply to each ticket, shared by every agent working on it:

| Limit | Value |
|---|---|
| Model calls | 30 |
| Tool calls (MCP tools and delegations) | 40 |
| Total tokens (input + output) | 150,000 |
| Longest single model response | 2,000 tokens |
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

**Verified** (`backend/tests/test_agents.py`, 27 tests, and `mcp_server/test_tools.py`, all passing):

| Area | What was checked |
|---|---|
| MCP look-ups | The Problem 3 tools return values that match direct SQL queries of the working database (`test_tools.py`). The new tools return the expected values for tickets 101–103. |
| Paying twice | Two pending requests for the same bill are flagged. After the first is paid, the second shows "already paid in full" (checked live) and isn't paid unless the person types `PAY ANYWAY`. More than is owed is flagged before paying. `record_payment` refuses warnings the approver didn't confirm. A refused payment stays pending. These were tested with scripted answers in place of a person typing. |
| Payment rules | A payment over the cash available is refused and nothing changes. Partial and extra payments and already-paid bills are allowed with warnings. An invoice is marked paid only when fully covered. Rent moves `next_due` on a month per full month paid, and the date arithmetic handles month ends. A vendor can't ship until its invoices are fully paid. `record_payment` doesn't exist for agents, and needs an approver's name. |
| Agent wiring | Each agent sees only its own MCP tools. Delegation works and is recorded. Delegating to yourself, looping back, going too deep or exceeding the count is refused. A runaway run stops at the usage limit and is recorded. |
| Output checks | Payment requests are re-checked against the records (including cash for all requests together), and warnings are attached, including when the same bill appears twice in one plan. Discount options and facts are replaced with the records' values. A recommendation must be an evaluated option with a reason. Customer drafts can't mention a discount, quote another price, or go to a vendor, the landlord or anyone but the customer requester. |
| Audit trail | New entries are added and earlier ones kept. The file stays valid JSON, and a damaged file is never overwritten. |
| Model setup | The model object is `gpt-6-luna`, at Portkey's address, with the key in the Portkey header. Any other model name is refused. A missing key gives a clear error. The key isn't passed to the MCP server. No request was sent to Portkey. |
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
4. **Limits:** whether the usage limits (30 model calls, 40 tool calls, 150,000 tokens per ticket; 2,000 tokens per response) suit real runs, and what a ticket actually costs.
5. **End-to-end scripts:** `run.py` with the real model, and `approve.py` typed by a real person at a terminal. Its decision steps were tested with scripted answers, not by a person.
6. **Other setups:** Windows (the MCP server path in `.mcp.json` and `config.py`), and two runs writing to the audit trail at the same time from separate processes.

## MCP server tools after Problem 5

The MCP server grew from three tools to eight read-only tools plus one approver-only write tool. All of them use the working copy only.

| Tool | What it does | Tables it uses | Ticket(s) | Used by |
|---|---|---|---|---|
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
