"""Human approval for the Campus Customs agents' requests.

  python approve.py --list     show requests waiting for a decision
  python approve.py            decide them one by one (a person must type the answers)

Agents can only ask. A payment is recorded in the database only here, after a
person approves it and types their name. It goes through the MCP server's
record_payment tool, which exists only in the approver role and re-checks every
payment rule (amount on file, not already paid, cash available, balance not negative).

A discount decision is recorded in the audit trail with the discount the person
chose; nothing is sent to the customer. Every decision is added to the audit trail.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from typing import Any

from fastmcp import Client

from agents import mcp_transport
from audit import AuditTrail


def pending(audit: AuditTrail) -> list[dict[str, Any]]:
    entries = audit.entries()
    decided = {e["approval_id"] for e in entries if e["event"] == "approval_decision"}
    return [e for e in entries if e["event"] == "approval_requested" and e["approval_id"] not in decided]


def describe(e: dict[str, Any]) -> str:
    r = e["request"]
    if e["approval_type"] == "payment":
        return (f"[{e['approval_id']}] Ticket {e['ticket_id']}: PAY {r['payee']} ${r['amount']:,.2f} "
                f"({r['kind']} {r['ref_id']}, due {r['due_date']}) from {r['account']}.\n"
                f"    Reason: {r['reason']}")
    facts = "\n".join(f"      - {f}" for f in r.get("facts_for_decision", []))
    return (f"[{e['approval_id']}] Ticket {e['ticket_id']}: DISCOUNT request from {r['customer']} for "
            f"{r['qty']} x {r['sku']} size {r['size']}.\n"
            f"    List price ${r['list_price']:,.2f}, unit cost ${r['unit_cost']:,.2f}, "
            f"total at list price ${r['total_at_list_price']:,.2f}, in stock {r['qty_in_stock']}.\n"
            f"    Break-even discount {r['break_even_discount_percent']}% (zero profit; a limit, "
            f"not a recommendation). There is no discount policy.\n{facts}")


async def record_payment(request: dict[str, Any], approved_by: str) -> dict[str, Any]:
    async with Client(mcp_transport("approver")) as client:
        result = await client.call_tool("record_payment", {
            "kind": request["kind"], "ref_id": request["ref_id"], "amount": request["amount"],
            "account": request["account"], "approved_by": approved_by}, raise_on_error=False)
    if result.is_error:
        return {"recorded": False, "error": result.content[0].text}
    return result.data


def ask(prompt: str) -> str:
    return input(prompt).strip()


async def decide(audit: AuditTrail, e: dict[str, Any]) -> None:
    base = {"run_id": e["run_id"], "ticket_id": e["ticket_id"], "agent": "human"}
    print("\n" + describe(e))
    answer = ask("Approve? [y = approve / n = reject / s = skip]: ").lower()
    if answer not in {"y", "n"}:
        print("Skipped.")
        return
    name = ""
    while not name:
        name = ask("Your name (recorded as the approver): ")
    if answer == "n":
        note = ask("Reason (optional): ")
        audit.record("approval_decision", approval_id=e["approval_id"], approval_type=e["approval_type"],
                     approved=False, decided_by=name, note=note, **base)
        print("Rejected and recorded.")
        return

    if e["approval_type"] == "payment":
        result = await record_payment(e["request"], name)
        audit.record("approval_decision", approval_id=e["approval_id"], approval_type="payment",
                     approved=True, decided_by=name, **base)
        if result.get("recorded"):
            audit.record("payment_recorded", payment=result, **base)
            print(f"Payment {result['payment_id']} recorded. Balance now ${result['balance_after']:,.2f}.")
        else:
            audit.record("payment_refused", error=result["error"], request=e["request"], **base)
            print(f"Not recorded: {result['error']}")
        return

    discount = ask("Discount you are approving, in percent (you decide; the shop has no policy): ")
    try:
        pct = float(discount)
    except ValueError:
        print("Not a number; nothing recorded.")
        return
    note = ask("Note (optional): ")
    audit.record("approval_decision", approval_id=e["approval_id"], approval_type="discount",
                 approved=True, decided_by=name, discount_percent=pct, note=note, **base)
    print("Discount decision recorded. Nothing has been sent to the customer.")


async def main() -> int:
    parser = argparse.ArgumentParser(description="Approve or reject the agents' requests.")
    parser.add_argument("--list", action="store_true", help="only list pending requests")
    args = parser.parse_args()
    audit = AuditTrail()
    waiting = pending(audit)
    if not waiting:
        print("Nothing is waiting for approval.")
        return 0
    if args.list:
        for e in waiting:
            print(describe(e))
        return 0
    if not sys.stdin.isatty():
        print("Approvals must be typed by a person at a terminal.", file=sys.stderr)
        return 2
    for e in waiting:
        await decide(audit, e)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
