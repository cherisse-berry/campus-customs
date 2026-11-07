"""Human approval of the agents' payment and discount requests.

Shared by the command-line script (approve.py) and the API (main.py), so both
apply exactly the same safeguards:

- Payments are checked again live against the database (through the MCP
  server) right before a decision, not only when the agents made the request.
- The approver sees what's still owed, the cash before and after, and every
  warning: a bill already paid in full, more than is owed, a partial payment,
  or another pending request for the same bill (paying both would pay twice).
- A payment with warnings is only recorded if the approver confirms exactly
  those warnings. record_payment (approver role only) re-checks the shop's
  payment rules and the warnings inside one transaction.
- A payment that isn't recorded stays pending, so it can be reviewed again.
- Purchases are reviewed the same way: the facts and warnings (for example a
  vendor that can't ship until its unpaid invoice is paid) are checked again
  live, and every warning must be confirmed. Approving a purchase only records
  the decision in the audit trail: no order is placed, no vendor is contacted,
  no money moves and the database doesn't change.
- Requests made before the last database reset are expired: they referred to
  the database as it was before the reset. They stay in the audit trail.
"""

from __future__ import annotations

from typing import Any

from fastmcp import Client

from agents import mcp_transport, purchase_review
from audit import AuditTrail

PAY_ANYWAY = "PAY ANYWAY"


class ApprovalError(Exception):
    """A decision that can't be made. `code` says why; `details` has what the approver needs to see."""

    def __init__(self, code: str, message: str, **details: Any):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details


# ---------------------------------------------------------------- what's waiting

def last_reset_index(entries: list[dict[str, Any]]) -> int:
    resets = [i for i, e in enumerate(entries) if e["event"] == "database_reset"]
    return resets[-1] if resets else -1


def classify(audit: AuditTrail) -> dict[str, list[dict[str, Any]]]:
    """Every approval request, sorted into pending, decided and expired."""
    entries = audit.entries()
    decisions = {e["approval_id"]: e for e in entries if e["event"] == "approval_decision"}
    reset_at = last_reset_index(entries)
    out: dict[str, list[dict[str, Any]]] = {"pending": [], "decided": [], "expired": []}
    for i, e in enumerate(entries):
        if e["event"] != "approval_requested":
            continue
        if e["approval_id"] in decisions:
            out["decided"].append({**e, "decision": decisions[e["approval_id"]]})
        elif i < reset_at:
            out["expired"].append(e)
        else:
            out["pending"].append(e)
    return out


def pending(audit: AuditTrail) -> list[dict[str, Any]]:
    return classify(audit)["pending"]


def find_pending(audit: AuditTrail, approval_id: str) -> dict[str, Any]:
    groups = classify(audit)
    for name, items in groups.items():
        for e in items:
            if e["approval_id"] == approval_id:
                if name == "pending":
                    return e
                raise ApprovalError("not_pending", f"Request {approval_id} is {name}, not pending.")
    raise ApprovalError("not_found", f"There is no approval request {approval_id}.")


def same_bill_pending(audit: AuditTrail, e: dict[str, Any]) -> list[dict[str, Any]]:
    r = e["request"]
    return [o for o in pending(audit) if o["approval_type"] == "payment" and o["approval_id"] != e["approval_id"]
            and (o["request"]["kind"], o["request"]["ref_id"]) == (r["kind"], r["ref_id"])]


# ---------------------------------------------------------------- payments

def _args(request: dict[str, Any]) -> dict[str, Any]:
    return {"kind": request["kind"], "ref_id": request["ref_id"], "amount": request["amount"],
            "account": request["account"]}


async def check_now(request: dict[str, Any]) -> dict[str, Any]:
    """Check the payment against the database as it is right now (read-only)."""
    async with Client(mcp_transport("agent")) as client:
        return (await client.call_tool("check_payment", _args(request))).data


def duplicate_warnings(others: list[dict[str, Any]]) -> list[str]:
    return [f"Another request for the same bill is also pending ({o['approval_id']}, ticket {o['ticket_id']}, "
            f"${o['request']['amount']:,.2f}). Approving both would pay it twice." for o in others]


async def review_payment(audit: AuditTrail, e: dict[str, Any]) -> dict[str, Any]:
    """Everything the approver must see before deciding a payment, checked live."""
    check = await check_now(e["request"])
    others = same_bill_pending(audit, e)
    warnings = check["warnings"] + duplicate_warnings(others)
    return {
        "check": check,
        "still_owed": check.get("still_owed", check.get("still_owed_for_next_due")),
        "warnings": warnings,
        "problems": check["problems"],
        "also_pending": [o["approval_id"] for o in others],
        "can_approve": check["allowed"],
        "needs_confirmation": bool(warnings),
    }


async def record_payment(request: dict[str, Any], approved_by: str,
                         confirmed_warnings: list[str] | None = None) -> dict[str, Any]:
    """Call record_payment on the MCP server in the approver role. Returns {"recorded": False, "error": ...} on refusal."""
    async with Client(mcp_transport("approver")) as client:
        result = await client.call_tool("record_payment", {
            **_args(request), "approved_by": approved_by,
            "confirmed_warnings": confirmed_warnings or []}, raise_on_error=False)
    if result.is_error:
        return {"recorded": False, "error": result.content[0].text}
    return result.data


async def approve_payment(audit: AuditTrail, e: dict[str, Any], approved_by: str,
                          confirmed_warnings: list[str]) -> dict[str, Any]:
    """Approve and record a payment, if the rules allow it and every current warning is confirmed."""
    approved_by = approved_by.strip()
    if not approved_by:
        raise ApprovalError("name_required", "The approver's name is required.")
    review = await review_payment(audit, e)
    base = {"run_id": e["run_id"], "ticket_id": e["ticket_id"], "agent": "human"}
    if not review["can_approve"]:
        raise ApprovalError("not_allowed", "This payment breaks the shop's payment rules and can't be approved.",
                            review=review)
    unconfirmed = [w for w in review["warnings"] if w not in confirmed_warnings]
    if unconfirmed:
        raise ApprovalError("confirmation_required",
                            "This payment has warnings. Confirm each one to pay it anyway; nothing was paid.",
                            unconfirmed=unconfirmed, review=review)
    result = await record_payment(e["request"], approved_by, review["check"]["warnings"])
    if not result.get("recorded"):
        audit.record("payment_refused", approval_id=e["approval_id"], decided_by=approved_by,
                     error=result["error"], request=e["request"], **base)
        raise ApprovalError("refused", result["error"] + " The request is still pending.", review=review)
    audit.record("approval_decision", approval_id=e["approval_id"], approval_type="payment", approved=True,
                 decided_by=approved_by, warnings_confirmed=review["warnings"], **base)
    audit.record("payment_recorded", payment=result, **base)
    return result


# ---------------------------------------------------------------- purchases

async def review_purchase(e: dict[str, Any]) -> dict[str, Any]:
    """Everything the approver must see before deciding a purchase, checked live (read-only)."""
    r = e["request"]
    async with Client(mcp_transport("agent")) as client:
        async def lookup(tool: str, args: dict[str, Any]) -> dict[str, Any]:
            return (await client.call_tool(tool, args)).data
        ticket = await lookup("get_ticket", {"ticket_id": e["ticket_id"]})
        facts = await purchase_review(lookup, ticket, r["sku"], r["size"], r["qty"], r["vendor_id"])
    return {**facts, "warnings": facts["warnings"], "needs_confirmation": bool(facts["warnings"]),
            "can_approve": True,
            "approval_effect": "Records the decision only. No order is placed, no vendor is contacted "
                               "and no money moves."}


async def approve_purchase(audit: AuditTrail, e: dict[str, Any], approved_by: str, confirmed_warnings: list[str],
                           note: str = "") -> dict[str, Any]:
    """Record a person's approval of a purchase request, once every current warning is confirmed."""
    approved_by = approved_by.strip()
    if not approved_by:
        raise ApprovalError("name_required", "The approver's name is required.")
    review = await review_purchase(e)
    unconfirmed = [w for w in review["warnings"] if w not in confirmed_warnings]
    if unconfirmed:
        raise ApprovalError("confirmation_required",
                            "This purchase has warnings. Confirm each one to approve it anyway; nothing was recorded.",
                            unconfirmed=unconfirmed, review=review)
    return audit.record("approval_decision", approval_id=e["approval_id"], approval_type="purchase", approved=True,
                        decided_by=approved_by, warnings_confirmed=review["warnings"], note=note,
                        order_placed=False, vendor_contacted=False, money_moved=False,
                        run_id=e["run_id"], ticket_id=e["ticket_id"], agent="human")


# ---------------------------------------------------------------- discounts and rejections

def approve_discount(audit: AuditTrail, e: dict[str, Any], decided_by: str, discount_percent: float,
                     note: str = "") -> dict[str, Any]:
    """Record a person's discount decision. Nothing is sent and no price changes."""
    decided_by = decided_by.strip()
    if not decided_by:
        raise ApprovalError("name_required", "The approver's name is required.")
    if not 0 <= discount_percent < 100:
        raise ApprovalError("invalid", "discount_percent must be from 0 up to (not including) 100.")
    return audit.record("approval_decision", approval_id=e["approval_id"], approval_type="discount",
                        approved=True, decided_by=decided_by, discount_percent=discount_percent, note=note,
                        run_id=e["run_id"], ticket_id=e["ticket_id"], agent="human")


def reject(audit: AuditTrail, e: dict[str, Any], decided_by: str, note: str = "") -> dict[str, Any]:
    decided_by = decided_by.strip()
    if not decided_by:
        raise ApprovalError("name_required", "The approver's name is required.")
    return audit.record("approval_decision", approval_id=e["approval_id"], approval_type=e["approval_type"],
                        approved=False, decided_by=decided_by, note=note,
                        run_id=e["run_id"], ticket_id=e["ticket_id"], agent="human")
