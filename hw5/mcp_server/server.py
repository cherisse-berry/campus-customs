"""Campus Customs MCP server.

Gives the Campus Customs agents access to the shop database. All shop
information the agents use comes through these tools.

Look-up tools (read-only, available to every client):

  list_open_tickets   the open tickets
  get_ticket          one ticket, with the invoice or lease it links to
  check_stock         stock by size, shelf and list price (Ticket 101)
  get_vendor_status   vendors, their unpaid invoices, and whether they may ship
  get_lease           the shop's lease and whether the next rent is paid (Ticket 102)
  get_payments_due    unpaid invoices, upcoming rent and the cash available (Ticket 102)
  check_payment       checks a proposed payment against the shop's payment rules
  price_bulk_order    price, cost and stock facts for a bulk order (Ticket 103)

Write tool (only when the server is started in the approver role):

  record_payment      records a human-approved payment in the database

The approver role is used only by the human approval script
(backend/approve.py), which sets CAMPUS_MCP_ROLE=approver. Agents and Claude
Code start the server without it, so record_payment doesn't exist for them.

The server only ever opens the working copy, data/campus_customs_new.db. The
original, data/campus_customs.db, is never opened. Look-ups open the database
read-only; only record_payment opens it for writing.
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import closing
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Literal

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError

HW5 = Path(__file__).resolve().parent.parent
ORIGINAL_DB_PATH = HW5 / "data" / "campus_customs.db"
# CAMPUS_CUSTOMS_DB lets the tests point the server at a temporary copy.
DB_PATH = Path(os.environ.get("CAMPUS_CUSTOMS_DB") or HW5 / "data" / "campus_customs_new.db")

ROLE = os.environ.get("CAMPUS_MCP_ROLE", "agent").strip().lower()
if ROLE not in {"agent", "approver"}:
    raise SystemExit(f"CAMPUS_MCP_ROLE must be 'agent' or 'approver', not {ROLE!r}.")

# Ticket types whose requester is a customer of the shop.
CUSTOMER_TICKET_TYPES = ("customer_order", "price_override")
PAYMENT_KINDS = ("invoice", "rent")
SIZE_ORDER = {s: i for i, s in enumerate(["XS", "S", "M", "L", "XL", "XXL", "OS"])}

READ_ONLY = {"readOnlyHint": True, "destructiveHint": False,
             "idempotentHint": True, "openWorldHint": False}
WRITES = {"readOnlyHint": False, "destructiveHint": False,
          "idempotentHint": False, "openWorldHint": False}

mcp = FastMCP(
    name="Campus Customs",
    instructions=(
        "Access to the Campus Customs shop database: tickets, stock, prices, vendors, "
        "bills, rent and the bank balance. 'Today' is the shop's date in desk.date_today, "
        "not the real calendar. Look-up tools never change anything. Payments need a "
        "person's approval and can only be recorded by the human approval process."
    ),
)


# ---------------------------------------------------------------- helpers

def _check_db_path() -> None:
    if DB_PATH.name == ORIGINAL_DB_PATH.name or DB_PATH.resolve() == ORIGINAL_DB_PATH.resolve():
        raise ToolError("Refusing to open the original database. Only the working copy may be used.")
    if not DB_PATH.is_file():
        raise ToolError(
            f"The working database {DB_PATH.name} was not found. Set it up first: "
            "from the hw5 folder run 'python3 setup_db.py path/to/data_2.zip'."
        )


def connect() -> sqlite3.Connection:
    """Open the working copy read-only."""
    _check_db_path()
    conn = sqlite3.connect(DB_PATH.as_uri() + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def connect_for_writing() -> sqlite3.Connection:
    """Open the working copy for writing. Used only by record_payment."""
    _check_db_path()
    conn = sqlite3.connect(DB_PATH.as_uri() + "?mode=rw", uri=True, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def shop_today(conn: sqlite3.Connection) -> date:
    row = conn.execute("SELECT date_today FROM desk LIMIT 1").fetchone()
    if row is None:
        raise ToolError("The desk table has no date for today.")
    return date.fromisoformat(row["date_today"])


def money(x: float) -> float:
    return round(float(x), 2)


def size_sorted(sizes: list[str]) -> list[str]:
    return sorted(sizes, key=lambda s: SIZE_ORDER.get(s, 99))


def require_sku(conn: sqlite3.Connection, sku: str) -> str:
    sku = sku.strip().upper()
    skus = [r["sku"] for r in conn.execute("SELECT DISTINCT sku FROM inventory ORDER BY sku")]
    if sku not in skus:
        raise ToolError(f"Unknown SKU '{sku}'. Known SKUs: {', '.join(skus)}.")
    return sku


def require_size(conn: sqlite3.Connection, sku: str, size: str) -> str:
    size = size.strip().upper()
    sizes = [r["size"] for r in conn.execute("SELECT size FROM inventory WHERE sku = ?", (sku,))]
    if size not in sizes:
        raise ToolError(f"{sku} does not come in size '{size}'. Sizes: {', '.join(size_sorted(sizes))}.")
    return size


def cents(x: float) -> int:
    return int(round(float(x) * 100))


def payments_for(conn: sqlite3.Connection, kind: str, ref_id: int) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM payments WHERE kind = ? AND ref_id = ? ORDER BY id", (kind, ref_id)).fetchall()


def invoice_balance(conn: sqlite3.Connection, invoice: sqlite3.Row) -> dict[str, Any]:
    """What has been paid toward an invoice and what is still owed, from the payments table."""
    paid = sum(cents(p["amount"]) for p in payments_for(conn, "invoice", invoice["id"]))
    owed = 0 if invoice["status"] == "paid" else max(cents(invoice["amount"]) - paid, 0)
    return {"amount_on_file": money(invoice["amount"]), "paid_so_far": paid / 100, "still_owed": owed / 100}


def rent_balance(conn: sqlite3.Connection, lease: sqlite3.Row) -> dict[str, Any]:
    """What has been paid toward the lease's next due date and what is still owed for it.

    Every rent payment for the lease is credited in order. Each time the
    credit reaches a full month's rent, record_payment moves next_due on by a
    month, so whatever is left over counts toward the current next_due.
    """
    rent = cents(lease["monthly_rent"])
    paid_total = sum(cents(p["amount"]) for p in payments_for(conn, "rent", lease["id"]))
    toward_next = paid_total % rent if rent else 0
    return {"amount_on_file": money(lease["monthly_rent"]), "paid_toward_next_due": toward_next / 100,
            "still_owed_for_next_due": (rent - toward_next) / 100}


def add_months(d: date, months: int) -> date:
    """The same day `months` later, or the last day of that month if it's shorter."""
    month_index = d.month - 1 + months
    year, month = d.year + month_index // 12, month_index % 12 + 1
    next_month = date(year + (month == 12), month % 12 + 1, 1)
    return date(year, month, min(d.day, (next_month - timedelta(days=1)).day))


def unpaid_invoices(conn: sqlite3.Connection, vendor_id: int | None = None) -> list[sqlite3.Row]:
    sql = """SELECT i.*, v.name AS vendor FROM invoices i JOIN vendors v ON v.id = i.vendor_id
             WHERE i.status != 'paid'"""
    params: tuple = ()
    if vendor_id is not None:
        sql += " AND i.vendor_id = ?"
        params = (vendor_id,)
    return conn.execute(sql + " ORDER BY i.due_date", params).fetchall()


def cash_balance(conn: sqlite3.Connection, account: str) -> float:
    row = conn.execute("SELECT balance FROM cash_accounts WHERE name = ?", (account,)).fetchone()
    if row is None:
        names = [r["name"] for r in conn.execute("SELECT name FROM cash_accounts")]
        raise ToolError(f"Unknown cash account '{account}'. Accounts: {', '.join(names)}.")
    return float(row["balance"])


def evaluate_payment(conn: sqlite3.Connection, kind: str, ref_id: int, amount: float,
                     account: str) -> dict[str, Any]:
    """Check a proposed payment against the shop's payment rules. Changes nothing.

    `problems` are the shop's rules (the amount can't exceed the available cash
    or make the balance negative) plus basic validity (a positive amount); any
    problem blocks the payment. `warnings` are facts the approver should see,
    such as a payment that differs from what the records say is still owed or
    a bill already paid in full. They don't block the payment: the person
    approving decides.
    """
    kind = kind.strip().lower()
    if kind not in PAYMENT_KINDS:
        raise ToolError(f"kind must be one of: {', '.join(PAYMENT_KINDS)}.")
    today = shop_today(conn)
    problems: list[str] = []
    warnings: list[str] = []
    amt = money(amount)

    if kind == "invoice":
        rec = conn.execute(
            """SELECT i.*, v.name AS vendor FROM invoices i JOIN vendors v ON v.id = i.vendor_id
               WHERE i.id = ?""", (ref_id,)).fetchone()
        if rec is None:
            raise ToolError(f"There is no invoice {ref_id}.")
        payee, due, description = rec["vendor"], rec["due_date"], rec["description"]
        balance = invoice_balance(conn, rec)
        owed = balance["still_owed"]
        if owed == 0:
            warnings.append(f"Invoice {ref_id} is already paid in full; this would be an extra payment.")
        elif amt > owed:
            warnings.append(f"${amt:,.2f} is more than the ${owed:,.2f} still owed on invoice {ref_id}.")
        elif amt < owed:
            warnings.append(f"Partial payment: ${owed - amt:,.2f} of invoice {ref_id} would still be owed.")
    else:
        rec = conn.execute("SELECT * FROM leases WHERE id = ?", (ref_id,)).fetchone()
        if rec is None:
            raise ToolError(f"There is no lease {ref_id}.")
        payee, due = rec["landlord"], rec["next_due"]
        description = f"Monthly rent for {rec['space_name']}"
        balance = rent_balance(conn, rec)
        owed = balance["still_owed_for_next_due"]
        if amt < owed:
            warnings.append(f"Partial rent: ${owed - amt:,.2f} of the rent due {due} would still be owed.")
        elif amt > owed:
            warnings.append(f"${amt:,.2f} is more than the ${owed:,.2f} still owed for the rent due {due}; "
                            "the rest would count toward later rent.")

    cash = cash_balance(conn, account)
    if amount <= 0:
        problems.append("The amount must be more than $0.")
    if amount > cash:
        problems.append(f"The amount ${amt:,.2f} is more than the ${cash:,.2f} available "
                        f"in '{account}'; the balance would go negative.")

    return {
        "today": today.isoformat(),
        "kind": kind,
        "ref_id": ref_id,
        "payee": payee,
        "description": description,
        "due_date": due,
        "days_until_due": (date.fromisoformat(due) - today).days,
        "amount": amt,
        **balance,
        "account": account,
        "cash_available": money(cash),
        "cash_after_payment": money(cash - amount),
        "allowed": not problems,
        "problems": problems,
        "warnings": warnings,
        "requires_human_approval": True,
    }


# ---------------------------------------------------------------- tickets

@mcp.tool(annotations=READ_ONLY)
def list_open_tickets() -> dict[str, Any]:
    """List the tickets that are still open, oldest first, with the shop's date for today."""
    with closing(connect()) as conn:
        today = shop_today(conn)
        rows = conn.execute(
            """SELECT id, type, requester, subject, created_at FROM tickets
               WHERE status = 'open' ORDER BY created_at""").fetchall()
    return {"today": today.isoformat(), "open_tickets": [dict(r) for r in rows]}


@mcp.tool(annotations=READ_ONLY)
def get_ticket(ticket_id: int) -> dict[str, Any]:
    """Get one ticket with everything it links to: the invoice (and its vendor) or the lease.

    Also says whether the requester is a customer (customer_order and
    price_override tickets), which decides whether a customer message may be drafted.

    Args:
        ticket_id: The ticket number, for example 101.
    """
    with closing(connect()) as conn:
        today = shop_today(conn)
        t = conn.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,)).fetchone()
        if t is None:
            ids = [str(r["id"]) for r in conn.execute("SELECT id FROM tickets ORDER BY id")]
            raise ToolError(f"There is no ticket {ticket_id}. Tickets: {', '.join(ids)}.")
        ticket = dict(t)
        linked: dict[str, Any] = {}
        if t["invoice_id"] is not None:
            i = conn.execute(
                """SELECT i.*, v.name AS vendor FROM invoices i JOIN vendors v ON v.id = i.vendor_id
                   WHERE i.id = ?""", (t["invoice_id"],)).fetchone()
            if i is not None:
                linked["invoice"] = {
                    "id": i["id"], "vendor_id": i["vendor_id"], "vendor": i["vendor"],
                    "amount": money(i["amount"]), "due_date": i["due_date"],
                    "days_until_due": (date.fromisoformat(i["due_date"]) - today).days,
                    "status": i["status"], "description": i["description"],
                    **invoice_balance(conn, i),
                }
        if t["lease_id"] is not None:
            lease = conn.execute("SELECT * FROM leases WHERE id = ?", (t["lease_id"],)).fetchone()
            if lease is not None:
                linked["lease"] = {
                    "id": lease["id"], "space_name": lease["space_name"], "landlord": lease["landlord"],
                    "monthly_rent": money(lease["monthly_rent"]), "next_due": lease["next_due"],
                    "days_until_due": (date.fromisoformat(lease["next_due"]) - today).days,
                    **rent_balance(conn, lease),
                }
    return {
        "today": today.isoformat(),
        "ticket": ticket,
        "requester_is_customer": ticket["type"] in CUSTOMER_TICKET_TYPES,
        "linked": linked,
    }


# ---------------------------------------------------------------- stock

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
        price = conn.execute("SELECT list_price FROM pricing WHERE sku = ?", (sku,)).fetchone()
        if size is not None:
            size = require_size(conn, sku, size)

    rows = sorted(rows, key=lambda r: SIZE_ORDER.get(r["size"], 99))
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
        match = next(s for s in sizes if s["size"] == size)
        result["requested_size"] = match
        result["other_sizes_in_stock"] = [s["size"] for s in sizes if s["in_stock"] and s["size"] != size]
    return result


# ---------------------------------------------------------------- vendors

@mcp.tool(annotations=READ_ONLY)
def get_vendor_status(vendor_id: int | None = None) -> dict[str, Any]:
    """Show vendors, what they supply, their lead time and any unpaid invoices.

    Shop rule: a vendor with an unpaid invoice cannot ship additional products.
    `can_ship_additional_products` applies that rule. This tool does not contact
    any vendor.

    Args:
        vendor_id: Optional vendor number. Leave empty to list all vendors.
    """
    with closing(connect()) as conn:
        today = shop_today(conn)
        if vendor_id is None:
            vendors = conn.execute("SELECT * FROM vendors ORDER BY id").fetchall()
        else:
            vendors = conn.execute("SELECT * FROM vendors WHERE id = ?", (vendor_id,)).fetchall()
            if not vendors:
                ids = [str(r["id"]) for r in conn.execute("SELECT id FROM vendors ORDER BY id")]
                raise ToolError(f"There is no vendor {vendor_id}. Vendors: {', '.join(ids)}.")
        result = []
        for v in vendors:
            unpaid = unpaid_invoices(conn, v["id"])
            result.append({
                "id": v["id"],
                "name": v["name"],
                "specialty": v["specialty"],
                "lead_days": v["lead_days"],
                "unpaid_invoices": [{
                    "id": i["id"], "amount": money(i["amount"]), "due_date": i["due_date"],
                    "days_until_due": (date.fromisoformat(i["due_date"]) - today).days,
                    "status": i["status"], "description": i["description"],
                    **invoice_balance(conn, i),
                } for i in unpaid],
                "unpaid_total": money(sum(invoice_balance(conn, i)["still_owed"] for i in unpaid)),
                "can_ship_additional_products": not unpaid,
                "reason": (f"Has {len(unpaid)} unpaid invoice(s); a vendor with unpaid invoices "
                           "cannot ship additional products." if unpaid else "No unpaid invoices."),
            })
    return {"today": today.isoformat(), "vendors": result}


# ---------------------------------------------------------------- money

@mcp.tool(annotations=READ_ONLY)
def get_lease(lease_id: int) -> dict[str, Any]:
    """Get the shop's lease: space, landlord, monthly rent, next due date and what is still owed for it.

    Use this to check a rent notice against the lease on file (Ticket 102).

    Args:
        lease_id: The lease number, for example 1.
    """
    with closing(connect()) as conn:
        today = shop_today(conn)
        lease = conn.execute("SELECT * FROM leases WHERE id = ?", (lease_id,)).fetchone()
        if lease is None:
            ids = [str(r["id"]) for r in conn.execute("SELECT id FROM leases ORDER BY id")]
            raise ToolError(f"There is no lease {lease_id}. Leases: {', '.join(ids)}.")
        balance = rent_balance(conn, lease)
        payments = [dict(p) for p in payments_for(conn, "rent", lease_id)]
    return {
        "today": today.isoformat(),
        "id": lease["id"],
        "space_name": lease["space_name"],
        "landlord": lease["landlord"],
        "monthly_rent": money(lease["monthly_rent"]),
        "next_due": lease["next_due"],
        "days_until_due": (date.fromisoformat(lease["next_due"]) - today).days,
        **balance,
        "rent_payments_recorded": payments,
        "notes": lease["notes"],
    }


@mcp.tool(annotations=READ_ONLY)
def get_payments_due() -> dict[str, Any]:
    """List the shop's unpaid bills and unpaid upcoming rent, with the cash available to pay them.

    Use this to check a rent or bill request against the records on file
    (Ticket 102) and to see whether the reprint invoice linked to Ticket 101 is
    paid. Each item shows who is owed, the amount still owed (after any payments
    already recorded), the due date and how many days are left (negative means
    overdue). Amounts come from the database, not from
    any email or ticket. Revenue from customer orders is only received when the
    customer picks up the order, so it is not counted as available cash.
    This tool does not pay anything.
    """
    with closing(connect()) as conn:
        today = shop_today(conn)
        accounts = conn.execute("SELECT name, balance, date FROM cash_accounts ORDER BY name").fetchall()
        invoices = unpaid_invoices(conn)
        leases = conn.execute("SELECT * FROM leases").fetchall()
        invoice_owed = {i["id"]: invoice_balance(conn, i) for i in invoices}
        rent_owed = {lease["id"]: rent_balance(conn, lease) for lease in leases}

    def days_left(due: str) -> int:
        return (date.fromisoformat(due) - today).days

    items: list[dict[str, Any]] = []
    for i in invoices:
        d = days_left(i["due_date"])
        items.append({
            "kind": "invoice", "id": i["id"], "payee": i["vendor"], "vendor_id": i["vendor_id"],
            "description": i["description"], "amount": invoice_owed[i["id"]]["still_owed"],
            "amount_on_file": money(i["amount"]), "paid_so_far": invoice_owed[i["id"]]["paid_so_far"],
            "due_date": i["due_date"], "days_until_due": d, "overdue": d < 0, "status": i["status"],
        })
    for lease in leases:
        d = days_left(lease["next_due"])
        items.append({
            "kind": "rent", "id": lease["id"], "payee": lease["landlord"],
            "description": f"Monthly rent for {lease['space_name']}",
            "amount": rent_owed[lease["id"]]["still_owed_for_next_due"],
            "amount_on_file": money(lease["monthly_rent"]),
            "paid_so_far": rent_owed[lease["id"]]["paid_toward_next_due"],
            "due_date": lease["next_due"], "days_until_due": d, "overdue": d < 0,
        })
    items.sort(key=lambda x: x["due_date"])

    cash = money(sum(a["balance"] for a in accounts))
    total_due = money(sum(x["amount"] for x in items))
    return {
        "today": today.isoformat(),
        "cash_accounts": [{"name": a["name"], "balance": money(a["balance"]), "as_of": a["date"]}
                          for a in accounts],
        "total_cash": cash,
        "payments_due": items,
        "total_due": total_due,
        "cash_left_if_all_paid": money(cash - total_due),
        "enough_cash_for_all": cash >= total_due,
    }


@mcp.tool(annotations=READ_ONLY)
def check_payment(kind: Literal["invoice", "rent"], ref_id: int, amount: float,
                  account: str = "checking") -> dict[str, Any]:
    """Check a proposed payment against the shop's payment rules, without paying anything.

    Blocking problems (`allowed` is false) come from the shop's rules: the amount
    can't exceed the available cash or make the balance negative (and must be
    more than $0). `warnings` show the approver anything unusual, such as an
    amount that differs from what the records say is still owed, or a bill
    already paid in full; they don't block the payment. Every payment needs a
    person's approval before it can be recorded, whatever this check says.

    Args:
        kind: "invoice" for a vendor invoice or "rent" for a lease.
        ref_id: The invoice number (for example 501) or lease number (for example 1).
        amount: The amount to pay, in dollars.
        account: The cash account to pay from (default "checking").
    """
    with closing(connect()) as conn:
        return evaluate_payment(conn, kind, ref_id, amount, account)


# ---------------------------------------------------------------- pricing

@mcp.tool(annotations=READ_ONLY)
def price_bulk_order(sku: str, size: str, qty: int, discount_percent: float = 0) -> dict[str, Any]:
    """Work out what a bulk order would cost and earn at a given discount, and whether stock covers it.

    Use this for discount requests (Ticket 103: Yale AI Club wants 20
    Basic Hoodie Big Yale, CC-HOOD-NAVY, in size M at a bulk discount).
    The shop has no discount policy. This tool only calculates: it does not
    suggest, approve or apply a discount, and any discount needs a person's approval.
    `break_even_discount_percent` is the discount at which the price equals the
    shop's unit cost (zero profit). It is a fact, not a recommendation.

    Args:
        sku: Product code, for example "CC-HOOD-NAVY".
        size: Size wanted, for example "M".
        qty: Number of items wanted (at least 1).
        discount_percent: Discount to calculate, from 0 up to (not including) 100. 0 means list price.
    """
    if qty < 1:
        raise ToolError("qty must be at least 1.")
    if not 0 <= discount_percent < 100:
        raise ToolError("discount_percent must be from 0 up to (not including) 100.")

    with closing(connect()) as conn:
        sku = require_sku(conn, sku)
        size = require_size(conn, sku, size)
        price = conn.execute("SELECT unit_cost, list_price FROM pricing WHERE sku = ?", (sku,)).fetchone()
        stock = conn.execute("SELECT name, qty FROM inventory WHERE sku = ? AND size = ?",
                             (sku, size)).fetchone()
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
        "break_even_discount_percent": money((1 - cost / list_price) * 100),
        "discount_policy": None,
        "qty_in_stock": in_stock,
        "can_fill_from_stock": in_stock >= qty,
        "shortfall": max(qty - in_stock, 0),
        "needs_human_approval": discount_percent > 0,
    }


# ---------------------------------------------------------------- approver-only

def record_payment(kind: Literal["invoice", "rent"], ref_id: int, amount: float,
                   approved_by: str, account: str = "checking",
                   confirmed_warnings: list[str] | None = None) -> dict[str, Any]:
    """Record a payment that a person has approved. Approver role only.

    Re-checks the payment rules, then in one transaction: adds a row to
    payments (paid_at = the shop's date) and takes the amount from the cash
    account. For an invoice, it's marked paid once the payments recorded for it
    cover the amount on file. For rent, the lease's next_due moves on one month
    for each full month's rent the payments cover. If a rule fails, nothing is
    changed.

    Warnings (for example a bill already paid in full, or more than is still
    owed) are worked out again at this moment. The payment is only recorded if
    the approver confirmed every one of them (`confirmed_warnings`, exactly as
    check_payment returned them). If anything changed since the approver
    looked, for example the bill was paid in the meantime, nothing is recorded
    and the approver has to review it again.

    Args:
        kind: "invoice" or "rent".
        ref_id: The invoice or lease number.
        amount: The amount approved, in dollars.
        approved_by: The name of the person who approved the payment.
        account: The cash account to pay from (default "checking").
        confirmed_warnings: The warnings the approver saw and confirmed.
    """
    approved_by = approved_by.strip()
    if not approved_by:
        raise ToolError("A payment can't be recorded without the name of the person who approved it.")
    with closing(connect_for_writing()) as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            check = evaluate_payment(conn, kind, ref_id, amount, account)
            if not check["allowed"]:
                raise ToolError("Payment not recorded: " + " ".join(check["problems"]))
            unconfirmed = [w for w in check["warnings"] if w not in (confirmed_warnings or [])]
            if unconfirmed:
                raise ToolError("Payment not recorded: the approver hasn't confirmed these warnings: "
                                + " ".join(unconfirmed) + " Review the payment again.")
            updated = conn.execute(
                "UPDATE cash_accounts SET balance = balance - ?, date = ? WHERE name = ? AND balance >= ?",
                (amount, check["today"], account, amount)).rowcount
            if updated != 1:
                raise ToolError("Payment not recorded: the balance would go negative.")
            cur = conn.execute(
                """INSERT INTO payments (kind, ref_id, amount, account, paid_at, approved_by)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (check["kind"], ref_id, money(amount), account, check["today"], approved_by))
            effect: dict[str, Any] = {}
            if check["kind"] == "invoice":
                inv = conn.execute("SELECT * FROM invoices WHERE id = ?", (ref_id,)).fetchone()
                paid = sum(cents(p["amount"]) for p in payments_for(conn, "invoice", ref_id))
                if inv["status"] != "paid" and paid >= cents(inv["amount"]):
                    conn.execute("UPDATE invoices SET status = 'paid' WHERE id = ?", (ref_id,))
                inv = conn.execute("SELECT * FROM invoices WHERE id = ?", (ref_id,)).fetchone()
                effect = {"invoice_status": inv["status"], **invoice_balance(conn, inv)}
            else:
                lease = conn.execute("SELECT * FROM leases WHERE id = ?", (ref_id,)).fetchone()
                rent = cents(lease["monthly_rent"])
                total = sum(cents(p["amount"]) for p in payments_for(conn, "rent", ref_id))
                months = total // rent - (total - cents(amount)) // rent
                if months:
                    new_due = add_months(date.fromisoformat(lease["next_due"]), months).isoformat()
                    conn.execute("UPDATE leases SET next_due = ? WHERE id = ?", (new_due, ref_id))
                lease = conn.execute("SELECT * FROM leases WHERE id = ?", (ref_id,)).fetchone()
                effect = {"months_of_rent_covered": months, "next_due": lease["next_due"],
                          **rent_balance(conn, lease)}
            balance = cash_balance(conn, account)
            if balance < 0:
                raise ToolError("Payment not recorded: the balance would go negative.")
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise
    return {
        "recorded": True,
        "payment_id": cur.lastrowid,
        "kind": check["kind"],
        "ref_id": ref_id,
        "payee": check["payee"],
        "amount": money(amount),
        "account": account,
        "paid_at": check["today"],
        "approved_by": approved_by,
        "balance_after": money(balance),
        "warnings": check["warnings"],
        **effect,
    }


if ROLE == "approver":
    mcp.tool(record_payment, annotations=WRITES)


if __name__ == "__main__":
    mcp.run(show_banner=False)
