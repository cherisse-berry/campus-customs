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
import sys
from typing import Any

from approvals import (
    PAY_ANYWAY,
    ApprovalError,
    approve_discount,
    approve_payment,
    check_now,  # noqa: F401  (used by the tests)
    pending,
    record_payment,  # noqa: F401  (used by the tests)
    reject,
    review_payment,
    same_bill_pending,  # noqa: F401
)
from audit import AuditTrail

CONFIRM_WORDS = PAY_ANYWAY


def describe(e: dict[str, Any]) -> str:
    r = e["request"]
    if e["approval_type"] == "payment":
        return (f"[{e['approval_id']}] Ticket {e['ticket_id']}: PAY {r['payee']} ${r['amount']:,.2f} "
                f"({r['kind']} {r['ref_id']}, due {r['due_date']}) from {r['account']}.\n"
                f"    Reason: {r['reason']}")
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


def describe_review(review: dict[str, Any]) -> str:
    check = review["check"]
    lines = [f"    Checked just now: ${review['still_owed']:,.2f} still owed (of ${check['amount_on_file']:,.2f} "
             f"on file); cash ${check['cash_available']:,.2f}, after this payment ${check['cash_after_payment']:,.2f}."]
    lines += [f"    !! WARNING: {w}" for w in check["warnings"]]
    lines += [f"    !! NOT ALLOWED: {p}" for p in review["problems"]]
    lines += [f"    !! ALSO PENDING for this bill: [{a}]. Approving both would pay it twice."
              for a in review["also_pending"]]
    return "\n".join(lines)


def ask(prompt: str) -> str:
    return input(prompt).strip()


def ask_name() -> str:
    name = ""
    while not name:
        name = ask("Your name (recorded as the approver): ")
    return name


async def decide(audit: AuditTrail, e: dict[str, Any]) -> None:
    print("\n" + describe(e))
    review = None
    if e["approval_type"] == "payment":
        review = await review_payment(audit, e)
        print(describe_review(review))
        if not review["can_approve"]:
            print("This payment can't be approved now (shop payment rules). Reject or skip it.")
    answer = ask("Approve? [y = approve / n = reject / s = skip]: ").lower()
    if answer not in {"y", "n"}:
        print("Skipped.")
        return
    try:
        if answer == "n":
            name = ask_name()
            reject(audit, e, name, ask("Reason (optional): "))
            print("Rejected and recorded.")
            return
        if review is not None:
            if not review["can_approve"]:
                print("Not allowed; nothing recorded.")
                return
            if review["needs_confirmation"]:
                typed = ask(f"This payment has warnings. Type {CONFIRM_WORDS} to pay it anyway, "
                            "or press Enter to stop: ")
                if typed != CONFIRM_WORDS:
                    print("Not confirmed; nothing paid. The request is still pending.")
                    return
            name = ask_name()
            result = await approve_payment(audit, e, name, review["warnings"])
            print(f"Payment {result['payment_id']} recorded. Balance now ${result['balance_after']:,.2f}.")
            return
        name = ask_name()
        discount = ask("Discount you are approving, in percent (your decision, whatever the agents recommended): ")
        try:
            pct = float(discount)
        except ValueError:
            print("Not a number; nothing recorded.")
            return
        approve_discount(audit, e, name, pct, ask("Note (optional): "))
        print("Discount decision recorded. Nothing has been sent to the customer.")
    except ApprovalError as err:
        print(f"Not recorded: {err.message}")


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
