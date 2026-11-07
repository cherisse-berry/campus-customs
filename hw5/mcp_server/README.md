# Campus Customs MCP Server

This folder holds an MCP server built with [FastMCP](https://gofastmcp.com). MCP (Model Context Protocol) is a standard way to give AI agents tools. It's the only way the Campus Customs agents (Problem 5) get shop information. It reads the working database: tickets, stock, prices, vendors, bills, rent and the bank balance.

| File | What it is |
|---|---|
| `server.py` | The server and its tools |
| `requirements.txt` | The Python package it needs (`fastmcp`, version 4) |
| `test_tools.py` | Checks the look-up tools against the working database (see [Testing it](#testing-it)) |

## The tools

The server started with three tools in Problem 3 and grew to nine in Problem 5, so the agents can handle the three open tickets. Problem 7 added `list_tickets` for the backend API.

| Tool | What it does | Tables | Ticket |
|---|---|---|---|
| `list_tickets()` | Lists every ticket with its status (added in Problem 7 for the API) | `tickets`, `desk` | All |
| `list_open_tickets()` | Lists the open tickets with the shop's date | `tickets`, `desk` | All |
| `get_ticket(ticket_id)` | One ticket with the invoice (and vendor) or lease it links to, and whether the requester is a customer | `tickets`, `invoices`, `vendors`, `leases`, `payments`, `desk` | All |
| `check_stock(sku, size=None)` | Stock in each size, the shelf and the list price. With a size, says whether it's in stock and which other sizes are. | `inventory`, `pricing` | **101**, 103 |
| `get_vendor_status(vendor_id=None)` | Each vendor's specialty, lead time and unpaid invoices, and whether it can ship additional products. A vendor with an unpaid invoice can't. | `vendors`, `invoices`, `desk` | **101**, 103 |
| `get_lease(lease_id)` | The lease: landlord, rent, next due date, days left, what's paid toward and still owed for that date, and the rent payments recorded | `leases`, `payments`, `desk` | **102** |
| `get_payments_due()` | Unpaid invoices and unpaid rent with days left (negative means overdue), the cash available and what's left if everything is paid | `invoices`, `vendors`, `leases`, `payments`, `cash_accounts`, `desk` | **102**, 101 |
| `check_payment(kind, ref_id, amount, account="checking")` | Checks a payment against the payment rules without paying. It blocks only an amount over the available cash (the balance can't go negative) or $0 or less. It warns, without blocking, about a partial payment, an amount above what's still owed, or a bill already paid in full. | `invoices`, `vendors`, `leases`, `payments`, `cash_accounts`, `desk` | **102**, 101 |
| `price_bulk_order(sku, size, qty, discount_percent=0)` | Price, cost, totals and profit for a bulk order at a given discount, the break-even discount (where profit reaches zero) and whether stock covers it. The agents call it at several levels to compare discounts. | `pricing`, `inventory` | **103** |
| `record_payment(kind, ref_id, amount, approved_by, account="checking", confirmed_warnings=[])` | **Approver role only.** Records a payment a person approved, after re-checking the rules. If the payment has warnings (for example the bill is already paid), it's only recorded when the approver confirmed exactly those warnings. | writes `payments`, `cash_accounts`, `invoices` | 101, 102 |

`hw5/output/harness.md` explains each tool in more detail, including which agents use it and why it's needed.

In Problem 5, `price_bulk_order`'s `max_discount_percent_without_loss` was renamed to `break_even_discount_percent`. The shop has no discount policy, and the new name makes clear the figure is where profit reaches zero, not a discount to offer. Problem 4's `mcp_smoke.json` and `mcp_tests.md` keep the old name because they record what the tool returned at the time.

## Two roles: agent and approver

The server starts in one of two roles, set by the `CAMPUS_MCP_ROLE` environment variable:

| Role | Who uses it | Tools |
|---|---|---|
| `agent` (the default) | The five agents, the backend API, Claude Code (`.mcp.json`) and the tests | The nine look-up tools. `record_payment` doesn't exist. |
| `approver` | Only the approval step (`backend/approvals.py`, used by `approve.py` and `POST /api/approvals/{id}`), after a person approves a payment | The nine look-up tools plus `record_payment` |

This is how the rule "all payments require human approval" is enforced: an agent can't call a tool that doesn't exist for it.

## Safety rules built in

- **It only uses the working copy.** The server opens `hw5/data/campus_customs_new.db` and refuses to open the original, `campus_customs.db`. The tests point it at a temporary copy with `CAMPUS_CUSTOMS_DB`. Even then it refuses any file named `campus_customs.db`.
- **Look-ups are read-only.** The eight look-up tools open the database in read-only mode and are marked read-only for MCP clients. Only `record_payment` opens it for writing.
- **Payments follow the shop's rules.** `record_payment` needs the approver's name, and the payment must not exceed the cash or make the balance negative. It re-checks this inside one database transaction, and if it fails, nothing changes. Anything unusual (a partial payment, more than is owed, a bill already paid) is a warning. Warnings are worked out again at that moment, and the payment is refused unless the approver confirmed exactly those warnings. That way a bill paid twice by accident, or paid in the meantime, can't go through unseen.
- **What a recorded payment changes.** It adds a `payments` row (`paid_at` = the shop's date) and lowers the cash balance. An invoice is marked paid once its payments cover the amount on file. For rent, `leases.next_due` moves on one month for each full month's rent the lease's payments cover.
- **Vendor rule.** `get_vendor_status` reports that a vendor with an unpaid invoice can't ship additional products.
- **No discount decisions.** `price_bulk_order` only calculates and reports `discount_policy: null`. Any discount is marked as needing a person's approval.
- **Only database facts.** Amounts come from the records, not from emails or tickets. "Today" is the shop's own date from the `desk` table (August 31, 2026), not the real calendar. Revenue from orders isn't counted as cash, since it's only received when the customer picks up the order.
- **Nothing is sent.** No tool sends a message or contacts anyone.
- **Clear errors.** Bad input gets a message explaining what's wrong, for example an unknown SKU, ticket, vendor or lease, a size the product doesn't come in, or a quantity or discount out of range. For an unknown ID, it lists the valid ones.

## Setting it up

1. Set up the database first. See [Setting up the database](../README.md#setting-up-the-database) in `hw5/README.md`. The server needs `hw5/data/campus_customs_new.db`.
2. Install the requirements (Python 3.10 or newer):

   ```bash
   cd hw5/mcp_server
   python3 -m venv .venv
   source .venv/bin/activate        # On Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```

## Connecting it to Claude Code

The connection settings are saved in **`.mcp.json`** at the repository root, which Claude Code reads automatically:

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

To use it:

1. Complete [Setting it up](#setting-it-up) above. The `.venv` folder must be at `hw5/mcp_server/.venv`.
2. Start Claude Code from the **repository root** (the paths in `.mcp.json` are relative to it).
3. When Claude Code asks whether to approve the `campus-customs` server from `.mcp.json`, approve it.
4. Run `/mcp` inside Claude Code, or `claude mcp list` in a terminal, to check that it's connected. The tools appear as `mcp__campus-customs__<tool>`, for example `mcp__campus-customs__check_stock`. Claude Code gets the agent role, so it can't record payments.

On Windows, the virtual environment's Python is at `hw5\mcp_server\.venv\Scripts\python.exe`. Change `command` in `.mcp.json` to that path.

## Testing it

To check every tool result against the working database, run this from the repository root:

```bash
hw5/mcp_server/.venv/bin/python hw5/mcp_server/test_tools.py
```

It starts the server from `.mcp.json` just as Claude Code does (agent role) and calls the Problem 3 tools over MCP. It also checks that all eight look-up tools are listed and `record_payment` isn't. It compares the results with direct database queries, checks that bad input is refused and confirms neither database file changes. It prints PASS or FAIL for each check. The Problem 4 test results, including the questions asked through Claude Code, are in `hw5/output/mcp_smoke.json` (JSON) and `hw5/output/mcp_tests.md` (plain language).

## Running it by hand

Claude Code starts the server itself, so you don't normally need to. To start it by hand:

```bash
python server.py
```

It uses the standard input/output (stdio) connection that MCP clients such as Claude Desktop and Claude Code expect.

## Used by the agents

The Problem 5 agents in `hw5/backend/` start this server themselves, in the agent role, with the Python in `mcp_server/.venv`. They don't use `.mcp.json`. Each agent only sees the tools its job needs (see `TOOLS_BY_AGENT` in `backend/agents.py`). The new tools, including `record_payment` and its rules, are tested on a temporary copy of the database by `backend/tests/test_agents.py`.
