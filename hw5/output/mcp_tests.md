# MCP Server Tests — Problem 4

This file records how the Campus Customs MCP server was connected to the coding assistant (Claude Code), and the tests run on each of its three tools. For each test it shows what was asked, which tool was used, what the tool returned and how the result was checked against the working database.

Tests were run on November 7, 2026. The database's own "today" is August 31, 2026, so all due dates and "days left" use that date.

## The connection

The connection settings are saved in **`.mcp.json`** at the root of the repository. This is the standard project-level file Claude Code reads. It was created with:

```bash
claude mcp add --scope project campus-customs -- hw5/mcp_server/.venv/bin/python hw5/mcp_server/server.py
```

```json
{
  "mcpServers": {
    "campus-customs": {
      "type": "stdio",
      "command": "hw5/mcp_server/.venv/bin/python",
      "args": ["hw5/mcp_server/server.py"],
      "env": {}
    }
  }
}
```

What it means:

- **`campus-customs`** is the server's name in Claude Code. Its tools appear as `mcp__campus-customs__check_stock`, `mcp__campus-customs__get_payments_due` and `mcp__campus-customs__price_bulk_order`.
- **`stdio`** means Claude Code starts the server itself and talks to it through standard input and output. There's no network port or web address.
- **`command`** is the Python inside the server's virtual environment, where FastMCP is installed. The paths are relative, so Claude Code must be started from the repository root.

The first time Claude Code is opened in this project, it asks whether to approve the `campus-customs` server. This is a Claude Code safety feature for servers defined in a project file, and it shouldn't be switched off. `claude mcp list` shows the server as "Pending approval" until it's approved.

For the tests, the same `.mcp.json` was loaded explicitly in separate, non-interactive Claude Code runs (`claude -p ... --mcp-config .mcp.json --strict-mcp-config`). These runs could only use the campus-customs tools: file reading, the shell and web access were turned off, so every answer had to come through the MCP server. Each run reported the server as **connected**.

## Summary

| Test | What was asked | Tool used | Result |
|---|---|---|---|
| 1 | Is the white tee in stock in size S? (Ticket 101) | `check_stock` | Pass |
| 2 | Check the landlord's rent email against our records (Ticket 102) | `get_payments_due` | Pass |
| 3 | Price 20 hoodies in size M at 10% off (Ticket 103) | `price_bulk_order`, then `check_stock` | Pass |
| 4 | Is the Crest Mug in stock? (connection re-check) | `check_stock` | Pass |
| 5 | Automated check of every value against the database | All three, over MCP | 31 of 31 checks passed |

Both database files had the same SHA-256 fingerprint (`23686a90…f360a`) before and after all tests, so nothing was changed.

---

## Test 1: Ticket 101 — tee in size S

**What was asked:**

> Ticket 101: a customer wants a Classic Bulldog Tee, SKU CC-TEE-WHITE, in size S. Using the campus-customs tools, is size S in stock? If not, which sizes are, and where is it shelved?

**Tool used:** `check_stock` with `{"sku": "CC-TEE-WHITE", "size": "S"}`

**What the tool returned:**

```json
{
  "sku": "CC-TEE-WHITE", "name": "Classic Bulldog Tee", "location": "Aisle B",
  "list_price": 28, "total_qty": 10,
  "sizes": [
    {"size": "S",  "qty": 0, "in_stock": false},
    {"size": "M",  "qty": 5, "in_stock": true},
    {"size": "L",  "qty": 3, "in_stock": true},
    {"size": "XL", "qty": 2, "in_stock": true}
  ],
  "requested_size": {"size": "S", "qty": 0, "in_stock": false},
  "other_sizes_in_stock": ["M", "L", "XL"]
}
```

**Claude Code's answer:**

> No, we're out of size S for the Classic Bulldog Tee (CC-TEE-WHITE). There are 0 in stock.
>
> These sizes are in stock:
> - **M**: 5
> - **L**: 3
> - **XL**: 2
>
> It's shelved in **Aisle B**, and the list price is $28.

**Does it match the database?** Yes.

| Value | Tool | `campus_customs_new.db` |
|---|---|---|
| Size S | 0 | `inventory`: CC-TEE-WHITE, S, qty 0 |
| M / L / XL | 5 / 3 / 2 | `inventory`: 5 / 3 / 2 |
| Shelf | Aisle B | `inventory.location`: Aisle B |
| Price | $28 | `pricing.list_price`: 28.0 |

---

## Test 2: Ticket 102 — rent email

**What was asked:**

> Ticket 102: our landlord emailed that the shop rent is due in 2 days. Using the campus-customs tools, check this against our records: who is the landlord, how much is owed and when? What other bills are unpaid, and how much cash would be left after paying everything?

**Tool used:** `get_payments_due` (no inputs)

**What the tool returned:**

```json
{
  "today": "2026-08-31",
  "cash_accounts": [{"name": "checking", "balance": 3400, "as_of": "2026-08-31"}],
  "total_cash": 3400,
  "payments_due": [
    {"kind": "invoice", "id": 501, "payee": "Bulldog Print Co", "vendor_id": 1,
     "description": "Rush reprint CC-TEE-WHITE S", "amount": 840,
     "due_date": "2026-08-28", "days_until_due": -3, "overdue": true, "status": "open"},
    {"kind": "rent", "id": 1, "payee": "Elm City Properties",
     "description": "Monthly rent for Chapel Street shop", "amount": 2400,
     "due_date": "2026-09-02", "days_until_due": 2, "overdue": false}
  ],
  "total_due": 3240,
  "cash_left_if_all_paid": 160,
  "enough_cash_for_all": true
}
```

**Claude Code's answer:**

> Your records back up the landlord's email: rent is due in 2 days. Dates come from the shop database, where "today" is **2026-08-31**, not the real calendar date.
>
> **Rent (Ticket 102)**
> - **Landlord:** Elm City Properties
> - **What it's for:** Monthly rent for the Chapel Street shop
> - **Amount owed:** $2,400
> - **Due:** 2026-09-02, which is 2 days away
>
> I haven't seen the email itself, so I couldn't compare its amount or sender with the records. Before paying, check that it came from Elm City Properties, that it asks for $2,400, and that the payment details match the ones you already have for them.
>
> **Other unpaid bills**
> - **Invoice #501, Bulldog Print Co:** $840 for the rush reprint of CC-TEE-WHITE S. It was due 2026-08-28, so it is **3 days overdue** and still open. This is the reprint linked to Ticket 101.
>
> **Cash position**
>
> | | Amount |
> |---|---|
> | Checking balance | $3,400 |
> | Rent | −$2,400 |
> | Bulldog Print invoice | −$840 |
> | **Left after paying both** | **$160** |
>
> You have enough to pay both, but only $160 would be left. Because the Bulldog invoice is already overdue, it's probably worth paying first. These tools can only look things up, so nothing has been paid.

**Does it match the database?** Yes.

| Value | Tool | `campus_customs_new.db` |
|---|---|---|
| Today | 2026-08-31 | `desk.date_today` |
| Cash | $3,400 | `cash_accounts`: checking, 3400.0 |
| Landlord | Elm City Properties | `leases.landlord` |
| Rent | $2,400, due 2026-09-02 (2 days) | `leases`: 2400.0, next_due 2026-09-02 |
| Invoice 501 | Bulldog Print Co, $840, due 2026-08-28 (3 days overdue), open | `invoices` 501 + `vendors` 1 |
| Left after both | $160 | 3400 − 2400 − 840 = 160 |

The answer also handled the email safely: it used the amount on file, said it hadn't seen the email itself and recommended checking the sender and amount before paying.

---

## Test 3: Ticket 103 — bulk hoodie discount

**What was asked:**

> Ticket 103: Yale AI Club wants 20 hoodies, SKU CC-HOOD-NAVY, size M, and asks for a bulk discount. Using the campus-customs tools, what would 20 cost at a 10% discount, what profit would we make, and can we fill the order from stock?

**Tools used:**

1. `price_bulk_order` with `{"sku": "CC-HOOD-NAVY", "size": "M", "qty": 20, "discount_percent": 10}`
2. `check_stock` with `{"sku": "CC-HOOD-NAVY", "size": "M"}`. Claude Code chose to call this as well, to see the other sizes.

**What the tools returned:**

```json
{
  "sku": "CC-HOOD-NAVY", "name": "Basic Hoodie Big Yale", "size": "M", "qty_requested": 20,
  "list_price": 58, "unit_cost": 22, "discount_percent": 10, "unit_price": 52.2,
  "total_at_list_price": 1160, "total_price": 1044, "total_cost": 440, "total_profit": 604,
  "below_cost": false, "max_discount_percent_without_loss": 62.07,
  "qty_in_stock": 8, "can_fill_from_stock": false, "shortfall": 12,
  "needs_human_approval": true
}
```

```json
{
  "sku": "CC-HOOD-NAVY", "name": "Basic Hoodie Big Yale", "location": "Aisle A",
  "list_price": 58, "total_qty": 32,
  "sizes": [
    {"size": "S", "qty": 4, "in_stock": true},  {"size": "M", "qty": 8, "in_stock": true},
    {"size": "L", "qty": 14, "in_stock": true}, {"size": "XL", "qty": 6, "in_stock": true}
  ],
  "requested_size": {"size": "M", "qty": 8, "in_stock": true},
  "other_sizes_in_stock": ["S", "L", "XL"]
}
```

**Claude Code's answer:**

> At a 10% discount, 20 hoodies would cost the club **$1,044** and we'd make **$604** profit. We can't fill it from stock, though: we only have **8 in size M**, so we're **12 short**.
>
> | | |
> |---|---|
> | List price | $58 each, so $1,160 for 20 |
> | Price at 10% off | **$52.20 each, so $1,044 for 20** |
> | Our cost | $22 each, so $440 for 20 |
> | **Profit** | **$604** |
> | Highest discount before we lose money | about 62% |
>
> **Stock:** The Basic Hoodie Big Yale is in Aisle A. We have 4 in S, 8 in M, 14 in L and 6 in XL.
>
> **Options for the order:**
> - Restock size M.
> - Ask the club whether some members would take size L, which has 14 in stock.
> - Send the 8 M's now and the other 12 later.
>
> The tools only work out numbers. They don't approve discounts or change prices, and the system flagged this one as needing a person to approve it. A 10% discount still leaves a good margin, but whether to offer it is up to you or whoever approves pricing.

**Does it match the database?** Yes.

| Value | Tool | `campus_customs_new.db` |
|---|---|---|
| List price / cost | $58 / $22 | `pricing`: 58.0 / 22.0 |
| Price at 10% off | $52.20 | 58 × 0.9 = 52.20 |
| Total / profit for 20 | $1,044 / $604 | 52.20 × 20 = 1,044; (52.20 − 22) × 20 = 604 |
| Break-even discount | 62.07% | (58 − 22) ÷ 58 = 62.07% |
| In stock in M | 8 (12 short) | `inventory`: CC-HOOD-NAVY, M, qty 8 |
| All sizes | S 4, M 8, L 14, XL 6 | `inventory`: 4 / 8 / 14 / 6 |

The answer left the discount decision to a person, as the tool requires.

---

## Test 4: Connection re-check

After the tests above, the server was changed to stop printing FastMCP's startup banner (a display change only). One more question confirmed Claude Code still connects and gets correct answers.

**What was asked:**

> Call the campus-customs check_stock tool for SKU CC-MUG-CREST and tell me the quantity in stock in one sentence.

**Tool used:** `check_stock` with `{"sku": "CC-MUG-CREST"}`

**Claude Code's answer:**

> There are 0 Crest Mugs (CC-MUG-CREST) in stock, so the item is sold out in its one size; it's normally shelved in Aisle D.

**Does it match the database?** Yes: `inventory` has CC-MUG-CREST, size OS, qty 0, Aisle D.

---

## Test 5: Automated check against the database

`hw5/mcp_server/test_tools.py` repeats the ticket tests without an AI in the loop. It starts the server from the same `.mcp.json` settings Claude Code uses and calls each tool over MCP. It then compares every value with a direct SQL query of `campus_customs_new.db`. It also checks that bad input is refused and that neither database file changes.

```bash
hw5/mcp_server/.venv/bin/python hw5/mcp_server/test_tools.py
```

Result:

```
Tools listed by the server
  PASS  tool names: ['check_stock', 'get_payments_due', 'price_bulk_order']

Ticket 101: check_stock(sku='CC-TEE-WHITE', size='S')
  PASS  name: 'Classic Bulldog Tee'
  PASS  shelf: 'Aisle B'
  PASS  list price: 28.0
  PASS  qty by size: {'S': 0, 'M': 5, 'L': 3, 'XL': 2}
  PASS  size S in stock: False
  PASS  other sizes in stock: ['L', 'M', 'XL']

Ticket 102: get_payments_due()
  PASS  today: '2026-08-31'
  PASS  cash: 3400.0
  PASS  landlord: 'Elm City Properties'
  PASS  rent amount: 2400.0
  PASS  rent due: '2026-09-02'
  PASS  rent days left: 2
  PASS  invoice 501 vendor: 'Bulldog Print Co'
  PASS  invoice 501 amount: 840.0
  PASS  invoice 501 status: 'open'
  PASS  invoice 501 days left: -3
  PASS  total due: 3240.0
  PASS  cash left if all paid: 160.0

Ticket 103: price_bulk_order(sku='CC-HOOD-NAVY', size='M', qty=20, discount_percent=10)
  PASS  list price: 58.0
  PASS  unit cost: 22.0
  PASS  price each at 10% off: 52.2
  PASS  total for 20: 1044.0
  PASS  profit for 20: 604.0
  PASS  break-even discount %: 62.07
  PASS  in stock in M: 8
  PASS  shortfall: 12
  PASS  needs approval: True

Bad input
  PASS  unknown SKU is an error: True
  PASS  100% discount is an error: True

Database files
  PASS  both files unchanged: True

All checks passed.
```

For the unknown-SKU test, the server's error message was: *Unknown SKU 'NOT-A-SKU'. Known SKUs: CC-HAT-BLUE, CC-HOOD-NAVY, CC-MUG-CREST, CC-TEE-WHITE.*
