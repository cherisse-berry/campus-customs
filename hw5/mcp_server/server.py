"""Campus Customs MCP server.

Gives AI agents read-only access to the Campus Customs database through three
tools, one for each open ticket from Problem 2:

  check_stock        Ticket 101 (customer order for a tee in size S)
  get_payments_due   Ticket 102 (rent notice), and the overdue invoice behind Ticket 101
  price_bulk_order   Ticket 103 (bulk hoodie discount request)

The server only ever opens the working copy, data/campus_customs_new.db, and it
opens it read-only. The original, data/campus_customs.db, is never touched.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from datetime import date
from pathlib import Path
from typing import Any

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError

HW5 = Path(__file__).resolve().parent.parent
DB_PATH = HW5 / "data" / "campus_customs_new.db"
ORIGINAL_DB_PATH = HW5 / "data" / "campus_customs.db"

READ_ONLY = {"readOnlyHint": True, "destructiveHint": False,
             "idempotentHint": True, "openWorldHint": False}

mcp = FastMCP(
    name="Campus Customs",
    instructions=(
        "Read-only access to the Campus Customs shop database: stock, prices, "
        "bills, rent and the bank balance. Dates are relative to the shop's own "
        "'today' stored in the database, not the real calendar. These tools only "
        "look things up; they never pay, change prices or change stock."
    ),
)


# ---------------------------------------------------------------- helpers

def connect() -> sqlite3.Connection:
    """Open the working copy read-only. Never opens the original."""
    if DB_PATH.resolve() == ORIGINAL_DB_PATH.resolve():
        raise RuntimeError("Refusing to open the original database.")
    if not DB_PATH.is_file():
        raise ToolError(
            f"The working database {DB_PATH.name} was not found. "
            "Set it up first: from the hw5 folder run "
            "'python3 setup_db.py path/to/data_2.zip'."
        )
    conn = sqlite3.connect(DB_PATH.as_uri() + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def shop_today(conn: sqlite3.Connection) -> date:
    row = conn.execute("SELECT date_today FROM desk LIMIT 1").fetchone()
    if row is None:
        raise ToolError("The desk table has no date for today.")
    return date.fromisoformat(row["date_today"])


def money(x: float) -> float:
    return round(float(x), 2)


def known_skus(conn: sqlite3.Connection) -> list[str]:
    return [r["sku"] for r in conn.execute("SELECT DISTINCT sku FROM inventory ORDER BY sku")]


def require_sku(conn: sqlite3.Connection, sku: str) -> str:
    sku = sku.strip().upper()
    skus = known_skus(conn)
    if sku not in skus:
        raise ToolError(f"Unknown SKU '{sku}'. Known SKUs: {', '.join(skus)}.")
    return sku


# ---------------------------------------------------------------- tools

@mcp.tool(annotations=READ_ONLY)
def check_stock(sku: str, size: str | None = None) -> dict[str, Any]:
    """Look up how many of a product are in stock, size by size, and where it is shelved.

    Use this before promising a customer an item (Ticket 101: a Classic Bulldog
    Tee, CC-TEE-WHITE, in size S). If `size` is given, the result says whether
    that size is in stock and lists the other sizes that are.

    Args:
        sku: Product code, for example "CC-TEE-WHITE".
        size: Optional size to check, for example "S", "M", "L", "XL" or "OS" (one size).
    """
    with closing(connect()) as conn:
        sku = require_sku(conn, sku)
        rows = conn.execute(
            "SELECT name, size, qty, location FROM inventory WHERE sku = ?", (sku,)
        ).fetchall()
        price = conn.execute(
            "SELECT list_price FROM pricing WHERE sku = ?", (sku,)
        ).fetchone()

    size_order = {s: i for i, s in enumerate(["XS", "S", "M", "L", "XL", "XXL", "OS"])}
    rows = sorted(rows, key=lambda r: size_order.get(r["size"], 99))
    sizes = [{"size": r["size"], "qty": r["qty"], "in_stock": r["qty"] > 0} for r in rows]

    result: dict[str, Any] = {
        "sku": sku,
        "name": rows[0]["name"],
        "location": rows[0]["location"],
        "list_price": money(price["list_price"]) if price else None,
        "total_qty": sum(r["qty"] for r in rows),
        "sizes": sizes,
    }

    if size is not None:
        size = size.strip().upper()
        match = next((s for s in sizes if s["size"] == size), None)
        if match is None:
            raise ToolError(
                f"{sku} does not come in size '{size}'. "
                f"Sizes: {', '.join(s['size'] for s in sizes)}."
            )
        result["requested_size"] = match
        result["other_sizes_in_stock"] = [
            s["size"] for s in sizes if s["in_stock"] and s["size"] != size
        ]
    return result


@mcp.tool(annotations=READ_ONLY)
def get_payments_due() -> dict[str, Any]:
    """List the shop's unpaid bills and upcoming rent, with the cash available to pay them.

    Use this to check a rent or bill request against the records on file
    (Ticket 102: the landlord's email that rent is due in 2 days) and to see
    whether the overdue reprint invoice linked to Ticket 101 has been paid.

    Each item shows who is owed, how much, the due date and how many days are
    left (a negative number means overdue). Amounts come from the database,
    not from any email or ticket. This tool does not pay anything.
    """
    with closing(connect()) as conn:
        today = shop_today(conn)
        accounts = conn.execute(
            "SELECT name, balance, date FROM cash_accounts ORDER BY name"
        ).fetchall()
        invoices = conn.execute(
            """SELECT i.id, i.amount, i.due_date, i.status, i.description,
                      v.name AS vendor, v.id AS vendor_id
                 FROM invoices i JOIN vendors v ON v.id = i.vendor_id
                WHERE i.status = 'open'"""
        ).fetchall()
        leases = conn.execute(
            "SELECT id, space_name, landlord, monthly_rent, next_due FROM leases"
        ).fetchall()

    def days_left(due: str) -> int:
        return (date.fromisoformat(due) - today).days

    items: list[dict[str, Any]] = []
    for i in invoices:
        d = days_left(i["due_date"])
        items.append({
            "kind": "invoice",
            "id": i["id"],
            "payee": i["vendor"],
            "vendor_id": i["vendor_id"],
            "description": i["description"],
            "amount": money(i["amount"]),
            "due_date": i["due_date"],
            "days_until_due": d,
            "overdue": d < 0,
            "status": i["status"],
        })
    for lease in leases:
        d = days_left(lease["next_due"])
        items.append({
            "kind": "rent",
            "id": lease["id"],
            "payee": lease["landlord"],
            "description": f"Monthly rent for {lease['space_name']}",
            "amount": money(lease["monthly_rent"]),
            "due_date": lease["next_due"],
            "days_until_due": d,
            "overdue": d < 0,
        })
    items.sort(key=lambda x: x["due_date"])

    cash = money(sum(a["balance"] for a in accounts))
    total_due = money(sum(x["amount"] for x in items))
    return {
        "today": today.isoformat(),
        "cash_accounts": [
            {"name": a["name"], "balance": money(a["balance"]), "as_of": a["date"]}
            for a in accounts
        ],
        "total_cash": cash,
        "payments_due": items,
        "total_due": total_due,
        "cash_left_if_all_paid": money(cash - total_due),
        "enough_cash_for_all": cash >= total_due,
    }


@mcp.tool(annotations=READ_ONLY)
def price_bulk_order(sku: str, size: str, qty: int, discount_percent: float = 0) -> dict[str, Any]:
    """Work out what a bulk order would cost and earn at a given discount, and whether it can be filled from stock.

    Use this for discount requests (Ticket 103: Yale AI Club wants 20
    Basic Hoodie Big Yale, CC-HOOD-NAVY, in size M at a bulk discount).
    It reports the price per item and total at that discount, the profit, the
    lowest possible price (the shop's cost), the largest discount that still
    avoids a loss, and how many are in stock in that size.

    This tool only calculates. It does not approve a discount or change any
    price; that decision belongs to a person.

    Args:
        sku: Product code, for example "CC-HOOD-NAVY".
        size: Size wanted, for example "M".
        qty: Number of items wanted (at least 1).
        discount_percent: Discount to price, from 0 up to (not including) 100. 10 means 10% off.
    """
    if qty < 1:
        raise ToolError("qty must be at least 1.")
    if not 0 <= discount_percent < 100:
        raise ToolError("discount_percent must be from 0 up to (not including) 100.")

    with closing(connect()) as conn:
        sku = require_sku(conn, sku)
        size = size.strip().upper()
        price = conn.execute(
            "SELECT unit_cost, list_price FROM pricing WHERE sku = ?", (sku,)
        ).fetchone()
        stock = conn.execute(
            "SELECT name, qty FROM inventory WHERE sku = ? AND size = ?", (sku, size)
        ).fetchone()
        if stock is None:
            sizes = [r["size"] for r in conn.execute(
                "SELECT size FROM inventory WHERE sku = ?", (sku,))]
            raise ToolError(f"{sku} does not come in size '{size}'. Sizes: {', '.join(sizes)}.")
    if price is None:
        raise ToolError(f"No price is on file for {sku}.")

    cost = float(price["unit_cost"])
    list_price = float(price["list_price"])
    unit_price = list_price * (1 - discount_percent / 100)
    in_stock = int(stock["qty"])

    return {
        "sku": sku,
        "name": stock["name"],
        "size": size,
        "qty_requested": qty,
        "list_price": money(list_price),
        "unit_cost": money(cost),
        "discount_percent": discount_percent,
        "unit_price": money(unit_price),
        "total_at_list_price": money(list_price * qty),
        "total_price": money(unit_price * qty),
        "total_cost": money(cost * qty),
        "total_profit": money((unit_price - cost) * qty),
        "below_cost": unit_price < cost,
        "max_discount_percent_without_loss": money((1 - cost / list_price) * 100),
        "qty_in_stock": in_stock,
        "can_fill_from_stock": in_stock >= qty,
        "shortfall": max(qty - in_stock, 0),
        "needs_human_approval": discount_percent > 0,
    }


if __name__ == "__main__":
    mcp.run()
