# Campus Customs MCP Server

This folder holds an MCP server built with [FastMCP](https://gofastmcp.com). MCP (Model Context Protocol) is a standard way to give AI agents tools. Agents connected to this server can look up information in the Campus Customs database: stock, prices, bills, rent and the bank balance.

| File | What it is |
|---|---|
| `server.py` | The server and its three tools |
| `requirements.txt` | The Python package it needs (`fastmcp`, version 4) |
| `test_tools.py` | Checks every tool result against the working database (see [Testing it](#testing-it)) |

## The three tools

Each tool answers the questions behind one of the three open tickets from Problem 2.

| Tool | What it does | Ticket it helps with |
|---|---|---|
| `check_stock(sku, size=None)` | Shows how many of a product are in stock in each size, where it's shelved and its price. If you give a size, it says whether that size is in stock and which other sizes are. | **101**: a customer wants a white tee in size S |
| `get_payments_due()` | Lists unpaid vendor bills and upcoming rent: who's owed, how much, when it's due and how many days are left (negative means overdue). It also shows the cash available and what would be left after paying everything. | **102**: the landlord's rent email. It also covers the overdue reprint bill linked to **101**. |
| `price_bulk_order(sku, size, qty, discount_percent=0)` | Works out the price, total and profit for a bulk order at a given discount. It flags a price below cost, gives the largest discount that avoids a loss and says whether stock covers the order. | **103**: a club wants 20 hoodies in size M at a discount |

`hw5/output/harness.md` explains each tool in more detail: the tables it reads, example results and why the agents need it.

## Safety rules built in

- **It only uses the working copy.** The server opens `hw5/data/campus_customs_new.db` and refuses to open the original, `campus_customs.db`.
- **It's read-only.** The database is opened in read-only mode, so these tools can't change anything even by mistake. Each tool is also marked read-only for MCP clients.
- **It never makes decisions about money.** No tool pays a bill, changes a price or changes stock. `price_bulk_order` only calculates; it marks any discount as needing a person's approval.
- **It only reports what's in the database.** Amounts come from the records, not from emails or tickets. "Today" is the shop's own date from the `desk` table (August 31, 2026), not the real calendar.
- **It gives clear errors.** An unknown SKU, a size the product doesn't come in, a quantity below 1 or a discount outside 0–99.99% gets a message explaining what's wrong (for an unknown SKU, it lists the valid ones).

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
4. Run `/mcp` inside Claude Code, or `claude mcp list` in a terminal, to check that it's connected. The tools appear as `mcp__campus-customs__check_stock`, `mcp__campus-customs__get_payments_due` and `mcp__campus-customs__price_bulk_order`.

On Windows, the virtual environment's Python is at `hw5\mcp_server\.venv\Scripts\python.exe`. Change `command` in `.mcp.json` to that path.

## Testing it

To check every tool result against the working database, run this from the repository root:

```bash
hw5/mcp_server/.venv/bin/python hw5/mcp_server/test_tools.py
```

It starts the server from `.mcp.json` just as Claude Code does and calls each tool over MCP. It compares the results with direct database queries, checks that bad input is refused and confirms neither database file changes. It prints PASS or FAIL for each check. The Problem 4 test results, including the questions asked through Claude Code, are in `hw5/output/mcp_tests.md`.

## Running it by hand

Claude Code starts the server itself, so you don't normally need to. To start it by hand:

```bash
python server.py
```

It uses the standard input/output (stdio) connection that MCP clients such as Claude Desktop and Claude Code expect.
