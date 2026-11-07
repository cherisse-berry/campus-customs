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

The MCP server in `mcp_server/server.py` gives the agents three tools for looking things up in the database. It's built with FastMCP. In Problem 4 it was connected to Claude Code (see [Connection to Claude Code](#connection-to-claude-code-problem-4) below). See `mcp_server/README.md` for setup.

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
- the largest discount that still avoids a loss
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
| Largest discount without a loss | 62.07% (the cost is $22.00) |
| In stock in M | 8, so **12 short** |
| Needs a person's approval | Yes |

**Why it's needed:** The database has no discount rules, so an agent shouldn't decide on a discount by itself. This tool gives the person deciding the facts: what each discount would bring in, the point where the shop would lose money, and the fact that only 8 of the 20 hoodies are in stock. All of that has to be settled before anyone agrees to the deal.

### Connection to Claude Code (Problem 4)

The server is connected to Claude Code through `.mcp.json` at the repository root, under the name `campus-customs`. Claude Code starts the server itself with the Python in `mcp_server/.venv`. All three tools were tested through Claude Code using the three tickets, and their results matched the working database. The tests are documented in `output/mcp_tests.md`, and `mcp_server/test_tools.py` repeats the check automatically.

### What the tools don't do yet

- **No ticket lookup.** An agent can't yet read the `tickets` table through the server, so the ticket details (SKU, size, quantity) have to be given to the tools.
- **No changes.** Recording a payment, updating ticket status or changing stock aren't possible yet. Those tools would write to the working copy and should require a person's approval (the `payments.approved_by` field already expects a name).
