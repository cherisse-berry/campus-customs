"""A scripted backend for testing the dashboard. No AI calls, no real money.

It runs the real FastAPI app (main.py) and the real MCP server, but:
- on temporary copies of the database and audit trail (the real files are never touched), and
- with a scripted stand-in for the model instead of gpt-6-luna. The scripted agents
  follow the expected plans from output/desk_tickets.html, with short pauses so the
  dashboard's live updates can be seen. Ticket 102 is scripted to fail part-way,
  to check that a failed run is never shown as resolved.

Run from hw5/backend:  .venv/bin/python tests/scripted_server.py   (serves http://localhost:8000)
"""

from __future__ import annotations

import asyncio
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(HERE))

TMP = Path(tempfile.mkdtemp(prefix="cc-scripted-"))
REAL_DATA = BACKEND.parent / "data"
(TMP / "original").mkdir()
shutil.copyfile(REAL_DATA / "campus_customs.db", TMP / "original" / "campus_customs.db")
shutil.copyfile(REAL_DATA / "campus_customs_new.db", TMP / "scripted_working.db")
os.chmod(TMP / "scripted_working.db", 0o644)
os.environ["CAMPUS_CUSTOMS_DB"] = str(TMP / "scripted_working.db")
os.environ["CAMPUS_AUDIT_TRAIL"] = str(TMP / "audit_trail.json")
os.environ.pop("PORTKEY_API_KEY", None)

import uvicorn  # noqa: E402
from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart  # noqa: E402
from pydantic_ai.models.function import AgentInfo, FunctionModel  # noqa: E402

import config  # noqa: E402
import main  # noqa: E402
from audit import AuditTrail  # noqa: E402
from models import AGENT_NAMES  # noqa: E402

config.ORIGINAL_DB = TMP / "original" / "campus_customs.db"
config.WORKING_DB = TMP / "scripted_working.db"
main.app.state.audit = AuditTrail(TMP / "audit_trail.json")

PAUSE = float(os.environ.get("SCRIPTED_PAUSE", "0.45"))


def report(agent, summary, findings=(), **extra):
    return {"agent": agent, "summary": summary, "findings": [{"fact": f, "sources": [s]} for f, s in findings], **extra}


PAY_501 = {"kind": "invoice", "ref_id": 501, "payee": "Bulldog Print Co", "amount": 840, "due_date": "2026-08-28",
           "reason": "Overdue by 3 days, and it blocks the vendor from shipping the tee restock.",
           "cash_available": 0, "cash_after_payment": 0}

SCRIPTS = {
    101: {
        "boss": [
            ("call", "get_ticket", {"ticket_id": 101}),
            ("call", "delegate", {"to": "inventory", "task": "Ticket 101: is CC-TEE-WHITE in stock in size S? If not, which sizes are, and can it be restocked?"}),
            ("call", "delegate", {"to": "accounting", "task": "Ticket 101: invoice 501 ($840, Bulldog Print Co) is overdue and blocks the restock. Check the payment against cash and other bills."}),
            ("call", "delegate", {"to": "customer_service", "task": "Ticket 101: draft a reply to Tauhid Zaman. S is out of stock; M, L and XL are in stock; the restock depends on an unapproved payment."}),
            ("final", {"ticket_id": 101, "status": "needs_human_approval",
                       "summary": "Size S is out of stock and the reprint is blocked by unpaid invoice 501. Paying it ($840) leaves $2,560; the customer is offered M, L or XL meanwhile.",
                       "agents_consulted": ["inventory", "accounting", "customer_service"],
                       "decisions": ["Request approval to pay invoice 501 ($840): overdue, and it unblocks the reprint.",
                                     "Offer the customer the sizes in stock; promise no restock date."],
                       "payment_approvals": [PAY_501],
                       "draft_messages": [{"ticket_id": 101, "to": "Tauhid Zaman", "subject": "Your Classic Bulldog Tee",
                                           "body": "Hi Tauhid, size S is out of stock right now. We have M, L and XL at $28.00. We'll follow up as soon as S is back. — Campus Customs"}],
                       "human_follow_ups": [{"action": "Once invoice 501 is paid, contact Bulldog Print Co about the reprint.", "reason": "Agents can't contact vendors."}]}),
        ],
        "inventory": [("call", "check_stock", {"sku": "CC-TEE-WHITE", "size": "S"}),
                      ("call", "get_vendor_status", {"vendor_id": 1}),
                      ("final", report("inventory", "0 in size S; M 5, L 3, XL 2. Bulldog Print Co can't ship while invoice 501 is unpaid; the reprint is already on order.",
                                       [("0 in size S", "check_stock"), ("Bulldog Print Co can't ship additional products", "get_vendor_status")]))],
        "accounting": [("call", "get_payments_due", {}),
                       ("call", "check_payment", {"kind": "invoice", "ref_id": 501, "amount": 840}),
                       ("final", report("accounting", "Invoice 501 ($840) is allowed and leaves $2,560. With rent ($2,400) too, $160 would be left.",
                                        [("Invoice 501 is 3 days overdue", "get_payments_due")]))],
        "customer_service": [("call", "check_stock", {"sku": "CC-TEE-WHITE", "size": "S"}),
                             ("final", report("customer_service", "Drafted a reply offering M, L or XL, with no restock date."))],
    },
    103: {
        "boss": [
            ("call", "get_ticket", {"ticket_id": 103}),
            ("call", "delegate", {"to": "inventory", "task": "Ticket 103: stock of CC-HOOD-NAVY across sizes, the shortfall for 20 in M, and restock options."}),
            ("call", "delegate", {"to": "accounting", "task": "Ticket 103: evaluate a few discount levels for 20 x CC-HOOD-NAVY in M and recommend one or none. Only 8 are in stock."}),
            ("final", {"ticket_id": 103, "status": "needs_human_approval",
                       "summary": "Only 8 of the 20 hoodies in M are in stock. A purchase of 12 is requested, but Bulldog Print Co can't ship until invoice 501 is paid. Discount options are ready for a person to decide.",
                       "agents_consulted": ["inventory", "accounting"],
                       "decisions": ["Request a purchase of the 12 missing hoodies for a person to approve.",
                                     "Leave the discount to a person; the agents recommend 5% for this request only."],
                       "purchase_approvals": [{"ticket_id": 103, "sku": "CC-HOOD-NAVY", "size": "M", "qty": 12, "vendor_id": 1,
                                               "reason": "20 wanted, 8 in stock: 12 short."}],
                       "discount_approvals": [{"ticket_id": 103, "customer": "Yale AI Club", "sku": "CC-HOOD-NAVY", "size": "M", "qty": 20,
                                               "list_price": 0, "unit_cost": 0, "total_at_list_price": 0, "qty_in_stock": 0,
                                               "break_even_discount_percent": 0, "facts_for_decision": ["Only 8 of 20 in stock."],
                                               "options_evaluated": [{"discount_percent": 0}, {"discount_percent": 5}, {"discount_percent": 10}],
                                               "recommended_discount_percent": 5,
                                               "recommendation_reason": "Keeps $662 of the $720 profit while the order can't yet be filled in full."}],
                       "human_follow_ups": [{"action": "Decide the discount and review the purchase.", "reason": "Both need a person."}]}),
        ],
        "inventory": [("call", "check_stock", {"sku": "CC-HOOD-NAVY", "size": "M"}),
                      ("call", "get_vendor_status", {"vendor_id": 1}),
                      ("final", report("inventory", "8 in M (12 short). Bulldog Print Co can't ship while invoice 501 is unpaid.",
                                       [("8 in size M", "check_stock")]))],
        "accounting": [("call", "price_bulk_order", {"sku": "CC-HOOD-NAVY", "size": "M", "qty": 20, "discount_percent": 0}),
                       ("call", "price_bulk_order", {"sku": "CC-HOOD-NAVY", "size": "M", "qty": 20, "discount_percent": 5}),
                       ("final", report("accounting", "List price: $1,160 total, $720 profit. 5% off: $1,102, $662 profit. Break-even is 62.07%."))],
    },
    102: {
        "boss": [("call", "get_ticket", {"ticket_id": 102}),
                 ("call", "delegate", {"to": "facilities", "task": "Ticket 102: check the landlord's rent notice against lease 1."}),
                 ("fail", "Scripted failure: the model stopped responding.")],
        "facilities": [("call", "get_lease", {"lease_id": 1}),
                       ("final", report("facilities", "The notice matches lease 1: Elm City Properties, $2,400 due Sep 2."))],
    },
}


def agent_and_ticket(info: AgentInfo) -> tuple[str, int]:
    text = info.instructions or ""
    agent = next(n for n in AGENT_NAMES if f"You are the **{n}** agent" in text)
    ticket = int(re.search(r"Ticket \*\*(\d+)\*\*", text).group(1))
    return agent, ticket


async def scripted(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    await asyncio.sleep(PAUSE)
    agent, ticket = agent_and_ticket(info)
    steps = SCRIPTS[ticket][agent]
    index = sum(isinstance(m, ModelResponse) for m in messages)
    kind, *rest = steps[min(index, len(steps) - 1)]
    if kind == "fail":
        raise RuntimeError(rest[0])
    if kind == "call":
        tool, args = rest
        return ModelResponse(parts=[ToolCallPart(tool, args)])
    return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, rest[0])])


main.app.state.model_factory = lambda: FunctionModel(scripted, model_name="scripted-test-model")

if __name__ == "__main__":
    print(f"Scripted backend (no AI, temporary data in {TMP}) on http://localhost:8000", flush=True)
    uvicorn.run(main.app, host="localhost", port=int(os.environ.get("PORT", "8000")), log_level="warning")
