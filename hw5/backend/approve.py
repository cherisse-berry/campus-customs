"""Human approval for the Campus Customs agents' requests.

  python approve.py --list     show requests waiting for a decision
  python approve.py            decide them one by one (a person must type the answers)

Agents can only ask. A payment is recorded in the database only here, after a
person approves it and types their name. It goes through the MCP server's
record_payment tool, which exists only in the approver role. It re-checks the
shop's payment rules: the payment can't exceed the cash available or make the
balance negative.

Paying the same bill twice: right before asking, each payment is checked again
live against the database (not just when the agents ran). The person sees what
is still owed, any warnings (a bill already paid in full, more than is owed, a
partial payment) and any other pending requests for the same bill. A payment
with warnings needs the person to type PAY ANYWAY, and record_payment refuses
it unless those exact warnings were confirmed, so if the bill changed in the
meantime nothing is paid.

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
                f"    Reason: {r['reason']}"
                + "".join(f"\n    WARNING: {w}" for w in r.get("warnings", [])))
    facts = "\n".join(f"      - {f}" for f in r.get("facts_for_decision", []))
    options = "\n".join(
        f"      - {o['discount_percent']}% off: ${o['unit_price']:,.2f} each, total ${o['total_price']:,.2f}, "
        f"profit ${o['total_profit']:,.2f}" + (" (BELOW COST)" if o["below_cost"] else "")
        for o in r.get("options_evaluated", []))
    rec = r.get("recommended_discount_percent")
    recommendation = (f"    Agents' recommendation for this request: {rec}% off. {r.get('recommendation_reason') or ''}"
                      if rec is not None else
                      f"    Agents' recommendation: no discount. {r.get('recommendation_reason') or ''}"
                      if r.get("recommendation_reason") else "    No recommendation from the agents.")
    return (f"[{e['approval_id']}] Ticket {e['ticket_id']}: DISCOUNT request from {r['customer']} for "
            f"{r['qty']} x {r['sku']} size {r['size']}.\n"
            f"    List price ${r['list_price']:,.2f}, unit cost ${r['unit_cost']:,.2f}, "
            f"total at list price ${r['total_at_list_price']:,.2f}, in stock {r['qty_in_stock']}.\n"
            f"    Break-even discount {r['break_even_discount_percent']}% (zero profit; a limit, "
            f"not a target). There is no discount policy; you decide.\n{facts}"
            + (f"\n    Options evaluated:\n{options}" if options else "") + f"\n{recommendation}")


CONFIRM_WORDS = "PAY ANYWAY"


async def check_now(request: dict[str, Any]) -> dict[str, Any]:
    """Check the payment against the database as it is right now."""
    async with Client(mcp_transport("agent")) as client:
        return (await client.call_tool("check_payment", {
            "kind": request["kind"], "ref_id": request["ref_id"], "amount": request["amount"],
            "account": request["account"]})).data


def same_bill_pending(audit: AuditTrail, e: dict[str, Any]) -> list[dict[str, Any]]:
    r = e["request"]
    return [o for o in pending(audit) if o["approval_type"] == "payment" and o["approval_id"] != e["approval_id"]
            and (o["request"]["kind"], o["request"]["ref_id"]) == (r["kind"], r["ref_id"])]


def describe_now(check: dict[str, Any], others: list[dict[str, Any]]) -> str:
    owed = check.get("still_owed", check.get("still_owed_for_next_due"))
    lines = [f"    Checked just now: ${owed:,.2f} still owed (of ${check['amount_on_file']:,.2f} on file); "
             f"cash ${check['cash_available']:,.2f}, after this payment ${check['cash_after_payment']:,.2f}."]
    lines += [f"    !! WARNING: {w}" for w in check["warnings"]]
    lines += [f"    !! NOT ALLOWED: {p}" for p in check["problems"]]
    lines += [f"    !! ALSO PENDING for this bill: [{o['approval_id']}] ticket {o['ticket_id']}, "
              f"${o['request']['amount']:,.2f}. Approving both would pay it twice." for o in others]
    return "\n".join(lines)


async def record_payment(request: dict[str, Any], approved_by: str,
                         confirmed_warnings: list[str] | None = None) -> dict[str, Any]:
    async with Client(mcp_transport("approver")) as client:
        result = await client.call_tool("record_payment", {
            "kind": request["kind"], "ref_id": request["ref_id"], "amount": request["amount"],
            "account": request["account"], "approved_by": approved_by,
            "confirmed_warnings": confirmed_warnings or []}, raise_on_error=False)
    if result.is_error:
        return {"recorded": False, "error": result.content[0].text}
    return result.data


def ask(prompt: str) -> str:
    return input(prompt).strip()


async def decide(audit: AuditTrail, e: dict[str, Any]) -> None:
    base = {"run_id": e["run_id"], "ticket_id": e["ticket_id"], "agent": "human"}
    print("\n" + describe(e))
    check: dict[str, Any] | None = None
    if e["approval_type"] == "payment":
        check = await check_now(e["request"])
        others = same_bill_pending(audit, e)
        print(describe_now(check, others))
        if not check["allowed"]:
            print("This payment can't be approved now (shop payment rules). Reject or skip it.")
    answer = ask("Approve? [y = approve / n = reject / s = skip]: ").lower()
    if answer not in {"y", "n"}:
        print("Skipped.")
        return
    if answer == "y" and check is not None:
        if not check["allowed"]:
            print("Not allowed; nothing recorded.")
            return
        if check["warnings"] or same_bill_pending(audit, e):
            typed = ask(f"This payment has warnings. Type {CONFIRM_WORDS} to pay it anyway, or press Enter to stop: ")
            if typed != CONFIRM_WORDS:
                print("Not confirmed; nothing paid. The request is still pending.")
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
        result = await record_payment(e["request"], name, check["warnings"])
        if result.get("recorded"):
            audit.record("approval_decision", approval_id=e["approval_id"], approval_type="payment",
                         approved=True, decided_by=name, warnings_confirmed=check["warnings"], **base)
            audit.record("payment_recorded", payment=result, **base)
            print(f"Payment {result['payment_id']} recorded. Balance now ${result['balance_after']:,.2f}.")
        else:
            # Not decided: the request stays pending so the person can review it again.
            audit.record("payment_refused", approval_id=e["approval_id"], decided_by=name,
                         error=result["error"], request=e["request"], **base)
            print(f"Not recorded: {result['error']} The request is still pending.")
        return

    discount = ask("Discount you are approving, in percent (your decision, whatever the agents recommended): ")
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
