"""Check the three MCP tools against the working database.

Starts the server exactly as Claude Code does (from the project's .mcp.json),
calls each tool over MCP, and compares every result with a direct SQL query of
data/campus_customs_new.db. It also checks that bad input gives an error and
that neither database file is changed.

Run from the repository root, after setting up the database and the server's
virtual environment (see hw5/mcp_server/README.md):

  hw5/mcp_server/.venv/bin/python hw5/mcp_server/test_tools.py
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import sqlite3
import sys
from datetime import date
from pathlib import Path

from fastmcp import Client

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "hw5" / "data"
WORKING = DATA / "campus_customs_new.db"
ORIGINAL = DATA / "campus_customs.db"
CONFIG = ROOT / ".mcp.json"
SERVER = "campus-customs"

failures: list[str] = []


def check(label: str, actual, expected) -> None:
    ok = actual == expected
    print(f"  {'PASS' if ok else 'FAIL'}  {label}: {actual!r}" + ("" if ok else f" (expected {expected!r})"))
    if not ok:
        failures.append(label)


def sql(query: str, *params):
    with sqlite3.connect(WORKING.as_uri() + "?mode=ro", uri=True) as conn:
        conn.row_factory = sqlite3.Row
        return conn.execute(query, params).fetchall()


def fingerprint(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


async def main() -> None:
    before = {p.name: fingerprint(p) for p in (ORIGINAL, WORKING)}
    config = json.loads(CONFIG.read_text())
    # Launch the server from the repository root, as Claude Code does.
    config["mcpServers"][SERVER]["cwd"] = str(ROOT)

    async with Client(config) as client:
        tools = sorted(t.name for t in await client.list_tools())
        print("Tools listed by the server")
        check("tool names", tools, ["check_payment", "check_stock", "get_lease", "get_payments_due",
                                    "get_ticket", "get_vendor_status", "list_open_tickets", "list_tickets",
                                    "price_bulk_order"])
        check("record_payment hidden from agents", "record_payment" in tools, False)

        # ---- Ticket 101: check_stock
        print("\nTicket 101: check_stock(sku='CC-TEE-WHITE', size='S')")
        r = (await client.call_tool("check_stock", {"sku": "CC-TEE-WHITE", "size": "S"})).data
        rows = {x["size"]: x for x in sql("SELECT size, qty, location, name FROM inventory WHERE sku='CC-TEE-WHITE'")}
        price = sql("SELECT list_price FROM pricing WHERE sku='CC-TEE-WHITE'")[0]["list_price"]
        check("name", r["name"], rows["S"]["name"])
        check("shelf", r["location"], rows["S"]["location"])
        check("list price", r["list_price"], price)
        check("qty by size", {s["size"]: s["qty"] for s in r["sizes"]}, {k: v["qty"] for k, v in rows.items()})
        check("size S in stock", r["requested_size"]["in_stock"], rows["S"]["qty"] > 0)
        check("other sizes in stock", sorted(r["other_sizes_in_stock"]),
              sorted(k for k, v in rows.items() if k != "S" and v["qty"] > 0))

        # ---- Ticket 102: get_payments_due
        print("\nTicket 102: get_payments_due()")
        r = (await client.call_tool("get_payments_due", {})).data
        today = date.fromisoformat(sql("SELECT date_today FROM desk")[0]["date_today"])
        cash = sum(a["balance"] for a in sql("SELECT balance FROM cash_accounts"))
        lease = sql("SELECT * FROM leases WHERE id=1")[0]
        inv = sql("SELECT i.*, v.name AS vendor FROM invoices i JOIN vendors v ON v.id=i.vendor_id WHERE i.id=501")[0]
        items = {(x["kind"], x["id"]): x for x in r["payments_due"]}
        rent, bill = items[("rent", 1)], items[("invoice", 501)]
        check("today", r["today"], today.isoformat())
        check("cash", r["total_cash"], cash)
        check("landlord", rent["payee"], lease["landlord"])
        check("rent amount", rent["amount"], lease["monthly_rent"])
        check("rent due", rent["due_date"], lease["next_due"])
        check("rent days left", rent["days_until_due"], (date.fromisoformat(lease["next_due"]) - today).days)
        check("invoice 501 vendor", bill["payee"], inv["vendor"])
        check("invoice 501 amount", bill["amount"], inv["amount"])
        check("invoice 501 status", bill["status"], inv["status"])
        check("invoice 501 days left", bill["days_until_due"], (date.fromisoformat(inv["due_date"]) - today).days)
        open_total = sum(x["amount"] for x in sql("SELECT amount FROM invoices WHERE status='open'"))
        rent_total = sum(x["monthly_rent"] for x in sql("SELECT monthly_rent FROM leases"))
        check("total due", r["total_due"], open_total + rent_total)
        check("cash left if all paid", r["cash_left_if_all_paid"], cash - open_total - rent_total)

        # ---- Ticket 103: price_bulk_order
        print("\nTicket 103: price_bulk_order(sku='CC-HOOD-NAVY', size='M', qty=20, discount_percent=10)")
        r = (await client.call_tool("price_bulk_order",
                                    {"sku": "CC-HOOD-NAVY", "size": "M", "qty": 20, "discount_percent": 10})).data
        p = sql("SELECT unit_cost, list_price FROM pricing WHERE sku='CC-HOOD-NAVY'")[0]
        qty_m = sql("SELECT qty FROM inventory WHERE sku='CC-HOOD-NAVY' AND size='M'")[0]["qty"]
        unit = round(p["list_price"] * 0.9, 2)
        check("list price", r["list_price"], p["list_price"])
        check("unit cost", r["unit_cost"], p["unit_cost"])
        check("price each at 10% off", r["unit_price"], unit)
        check("total for 20", r["total_price"], round(unit * 20, 2))
        check("profit for 20", r["total_profit"], round((unit - p["unit_cost"]) * 20, 2))
        check("break-even discount %", r["break_even_discount_percent"],
              round((1 - p["unit_cost"] / p["list_price"]) * 100, 2))
        check("in stock in M", r["qty_in_stock"], qty_m)
        check("shortfall", r["shortfall"], 20 - qty_m)
        check("needs approval", r["needs_human_approval"], True)

        # ---- Bad input is refused with a clear error
        print("\nBad input")
        r = await client.call_tool("check_stock", {"sku": "NOT-A-SKU"}, raise_on_error=False)
        check("unknown SKU is an error", r.is_error, True)
        r = await client.call_tool("price_bulk_order",
                                   {"sku": "CC-HOOD-NAVY", "size": "M", "qty": 20, "discount_percent": 100},
                                   raise_on_error=False)
        check("100% discount is an error", r.is_error, True)

    print("\nDatabase files")
    after = {p.name: fingerprint(p) for p in (ORIGINAL, WORKING)}
    check("both files unchanged", after == before, True)

    print(f"\n{'All checks passed.' if not failures else f'{len(failures)} check(s) failed: ' + ', '.join(failures)}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    asyncio.run(main())
