"""Offline tests for the Campus Customs agents.

No AI model is called and no Portkey key is needed: a scripted stand-in model
(PydanticAI's FunctionModel) plays each agent's part so the team's wiring,
rules, audit trail and limits can be checked. The MCP server is real, but runs
against a temporary copy of the database, so the working copy is never changed.

Run from hw5/backend:  .venv/bin/python -m pytest
"""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path
from typing import Any

import pytest
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.models.openai import OpenAIChatModel

import agents as agents_module
import approve
import config
from agents import TOOLS_BY_AGENT, AgentsNotConfigured, Team, create_portkey_model
from audit import AuditTrail, AuditTrailError
from models import AGENT_NAMES

pytestmark = pytest.mark.anyio
WORKING_DB = config.HW5 / "data" / "campus_customs_new.db"
ORIGINAL_DB = config.HW5 / "data" / "campus_customs.db"


@pytest.fixture
def anyio_backend():
    return "asyncio"


def fingerprint(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture(scope="session", autouse=True)
def real_databases_unchanged():
    """Every test runs on a temporary copy; the real files must be identical afterwards."""
    before = {p: fingerprint(p) for p in (WORKING_DB, ORIGINAL_DB)}
    yield
    assert {p: fingerprint(p) for p in (WORKING_DB, ORIGINAL_DB)} == before


@pytest.fixture
def temp_db(tmp_path, monkeypatch) -> Path:
    db = tmp_path / "campus_customs_test.db"
    shutil.copyfile(WORKING_DB, db)
    db.chmod(0o644)
    monkeypatch.setenv("CAMPUS_CUSTOMS_DB", str(db))
    return db


@pytest.fixture
def audit(tmp_path) -> AuditTrail:
    return AuditTrail(tmp_path / "audit_trail.json")


# ---------------------------------------------------------------- scripted model

class Script:
    """A stand-in model. For each agent, a list of steps played in order.

    A step is ("call", tool_name, args) or ("final", output_dict).
    """

    def __init__(self, steps: dict[str, list[tuple]]):
        self.steps = steps
        self.seen_retries: list[str] = []

    @staticmethod
    def agent_of(info: AgentInfo) -> str:
        text = info.instructions or ""
        for name in AGENT_NAMES:
            if f"You are the **{name}** agent" in text:
                return name
        raise AssertionError("unknown agent")

    def __call__(self, messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        agent = self.agent_of(info)
        for m in messages:
            for p in getattr(m, "parts", []):
                if "retry" in p.part_kind or getattr(p, "outcome", None) == "retried":
                    self.seen_retries.append(str(p))
        index = sum(isinstance(m, ModelResponse) for m in messages)
        steps = self.steps[agent]
        kind, *rest = steps[min(index, len(steps) - 1)]
        if kind == "call":
            tool, args = rest
            return ModelResponse(parts=[ToolCallPart(tool, args)])
        (output,) = rest
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, output)])


def draft(to: str, body: str, ticket_id: int = 101) -> dict[str, Any]:
    return {"ticket_id": ticket_id, "to": to, "subject": "Your order", "body": body}


def report(agent: str, **extra) -> dict[str, Any]:
    return {"agent": agent, "summary": "done", **extra}


def resolution(ticket_id: int, **extra) -> dict[str, Any]:
    return {"ticket_id": ticket_id, "status": "ready_for_review", "summary": "done", **extra}


def events(audit: AuditTrail, name: str) -> list[dict[str, Any]]:
    return [e for e in audit.entries() if e["event"] == name]


# ---------------------------------------------------------------- model and Portkey

def test_every_agent_uses_gpt_6_luna_through_portkey(monkeypatch, temp_db, audit):
    monkeypatch.setenv("PORTKEY_API_KEY", "test-key-not-real")
    model = create_portkey_model()
    assert model.model_name == "gpt-6-luna"
    client = model.client
    assert str(client.base_url).rstrip("/") == "https://api.portkey.ai/v1"
    assert client.api_key == "test-key-not-real"                 # sent as Authorization: Bearer
    assert "x-portkey-api-key" not in client.default_headers    # only one header carries the key
    team = Team(model, audit)
    assert {name: a.model for name, a in team.agents.items()} == {n: model for n in AGENT_NAMES}


def test_missing_portkey_key_is_a_clear_error(monkeypatch):
    monkeypatch.delenv("PORTKEY_API_KEY", raising=False)
    with pytest.raises(AgentsNotConfigured, match="PORTKEY_API_KEY"):
        create_portkey_model()


def test_other_models_are_refused(monkeypatch, audit):
    monkeypatch.setenv("PORTKEY_API_KEY", "x")
    other = OpenAIChatModel("gpt-other", provider=create_portkey_model()._provider)
    with pytest.raises(ValueError, match="gpt-6-luna"):
        Team(other, audit)


def test_portkey_key_is_not_passed_to_the_mcp_server(monkeypatch):
    monkeypatch.setenv("PORTKEY_API_KEY", "secret")
    assert "PORTKEY_API_KEY" not in agents_module.mcp_transport().env


# ---------------------------------------------------------------- MCP tool permissions

async def test_each_agent_sees_only_its_tools(temp_db, audit):
    from pydantic_ai import RunContext
    from pydantic_ai.usage import RunUsage

    async with Team(FunctionModel(lambda m, i: ModelResponse(parts=[TextPart("")])), audit) as team:
        for name, agent in team.agents.items():
            toolset = agent.toolsets[-1]
            ctx = RunContext(deps=None, model=team.model, usage=RunUsage())
            tools = set((await toolset.get_tools(ctx)).keys())
            assert tools == set(TOOLS_BY_AGENT[name])
            assert "record_payment" not in tools


async def test_record_payment_exists_only_for_the_approver(temp_db):
    from fastmcp import Client

    async with Client(agents_module.mcp_transport("agent")) as c:
        assert "record_payment" not in {t.name for t in await c.list_tools()}
    async with Client(agents_module.mcp_transport("approver")) as c:
        assert "record_payment" in {t.name for t in await c.list_tools()}


# ---------------------------------------------------------------- a full scripted ticket

async def test_ticket_101_delegation_tools_and_audit(temp_db, audit):
    script = Script({
        "boss": [
            ("call", "get_ticket", {"ticket_id": 101}),
            ("call", "delegate", {"to": "inventory", "task": "Ticket 101: stock of CC-TEE-WHITE size S?"}),
            ("call", "delegate", {"to": "customer_service", "task": "Ticket 101: draft a reply, S is out of stock."}),
            ("final", resolution(101, agents_consulted=["inventory", "customer_service"],
                                 decisions=["Offer sizes in stock; restock waits on invoice 501."],
                                 draft_messages=[draft("Tauhid Zaman", "Size S is out of stock. The tee is $28.00.")])),
        ],
        "inventory": [
            ("call", "check_stock", {"sku": "CC-TEE-WHITE", "size": "S"}),
            ("call", "get_vendor_status", {"vendor_id": 1}),
            ("final", report("inventory", findings=[{"fact": "0 in size S", "sources": ["check_stock"]}])),
        ],
        "customer_service": [
            ("final", report("customer_service",
                             draft_messages=[draft("Tauhid Zaman", "Size S is out of stock right now.")])),
        ],
    })
    async with Team(FunctionModel(script), audit) as team:
        run_id, out = await team.handle_ticket(101)

    assert out.ticket_id == 101
    assert out.draft_messages[0].sent is False
    entries = [e for e in audit.entries() if e["run_id"] == run_id]
    names = [e["event"] for e in entries]
    assert names[0] == "run_started" and names[-1] == "run_finished"
    calls = [(e["agent"], e["tool"]) for e in entries if e["event"] == "tool_call"]
    assert calls == [("boss", "get_ticket"), ("inventory", "check_stock"), ("inventory", "get_vendor_status")]
    vendor = next(e for e in entries if e["event"] == "tool_result" and e["tool"] == "get_vendor_status")
    assert vendor["result"]["vendors"][0]["can_ship_additional_products"] is False
    delegations = [(e["agent"], e["to"]) for e in entries if e["event"] == "delegation"]
    assert delegations == [("boss", "inventory"), ("boss", "customer_service")]
    assert [e["agent"] for e in entries if e["event"] == "delegation_result"] == ["inventory", "customer_service"]
    assert events(audit, "draft_message")[0]["sent"] is False
    assert events(audit, "decision")[0]["decision"].startswith("Offer sizes")
    finished = entries[-1]
    assert finished["delegations"] == 2 and finished["usage"]["requests"] >= 4


async def test_audit_trail_is_appended_not_overwritten(temp_db, audit):
    audit.record("earlier_activity", note="must survive")
    script = Script({"boss": [("final", resolution(102))]})
    async with Team(FunctionModel(script), audit) as team:
        await team.handle_ticket(102)
        await team.handle_ticket(102)
    entries = audit.entries()
    assert entries[0]["event"] == "earlier_activity" and entries[0]["note"] == "must survive"
    assert len(events(audit, "run_started")) == 2


# ---------------------------------------------------------------- shop rules enforced in code

async def test_discount_amount_in_a_customer_draft_is_rejected(temp_db, audit):
    bad = draft("Yale AI Club", "We can offer 10% off, so $52.20 each.", 103)
    good = draft("Yale AI Club", "Your discount request is being reviewed. List price is $58.00 each.", 103)
    script = Script({"boss": [("final", resolution(103, draft_messages=[bad])),
                              ("final", resolution(103, draft_messages=[good]))]})
    async with Team(FunctionModel(script), audit) as team:
        _, out = await team.handle_ticket(103)
    assert out.draft_messages[0].body == good["body"]
    problems = events(audit, "output_rejected")[0]["problems"]
    assert any("discount amount" in p for p in problems)
    assert any("$52.20" in p for p in problems)


async def test_drafts_only_to_customers_never_vendors_or_landlord(temp_db, audit):
    script = Script({"boss": [
        ("final", resolution(102, draft_messages=[draft("Elm City Properties", "Rent noted.", 102)])),
        ("final", resolution(102)),
    ]})
    async with Team(FunctionModel(script), audit) as team:
        _, out = await team.handle_ticket(102)
    assert out.draft_messages == []
    assert "not a customer" in events(audit, "output_rejected")[0]["problems"][0]

    script = Script({"boss": [
        ("final", resolution(101, draft_messages=[draft("Bulldog Print Co", "Please ship the reprint.")])),
        ("final", resolution(101)),
    ]})
    async with Team(FunctionModel(script), audit) as team:
        await team.handle_ticket(101)
    problems = events(audit, "output_rejected")[-1]["problems"]
    assert any("requester" in p for p in problems) and any("can't contact vendors" in p for p in problems)


def payment(kind: str, ref_id: int, amount: float) -> dict[str, Any]:
    return {"kind": kind, "ref_id": ref_id, "payee": "?", "amount": amount, "due_date": "?",
            "reason": "due", "cash_available": 0, "cash_after_payment": 0}


async def test_payment_requests_are_checked_against_the_records(temp_db, audit):
    wrong = payment("rent", 1, 5000)
    right = payment("rent", 1, 2400)
    script = Script({"boss": [
        ("final", {**resolution(102, payment_approvals=[wrong]), "status": "needs_human_approval"}),
        ("final", {**resolution(102, payment_approvals=[right]), "status": "needs_human_approval"}),
    ]})
    async with Team(FunctionModel(script), audit) as team:
        _, out = await team.handle_ticket(102)
    p = out.payment_approvals[0]
    # Payee, due date and cash figures come from the records, not from the agent.
    assert (p.payee, p.due_date, p.cash_available, p.cash_after_payment) == \
        ("Elm City Properties", "2026-09-02", 3400.0, 1000.0)
    assert any("balance would go negative" in x for x in events(audit, "output_rejected")[0]["problems"])
    assert p.warnings == []
    req = events(audit, "approval_requested")[0]
    assert req["approval_type"] == "payment" and req["request"]["amount"] == 2400


async def test_partial_payment_is_allowed_with_a_warning_for_the_approver(temp_db, audit):
    partial = payment("rent", 1, 2000)
    script = Script({"boss": [
        ("final", {**resolution(102, payment_approvals=[partial]), "status": "needs_human_approval"}),
    ]})
    async with Team(FunctionModel(script), audit) as team:
        _, out = await team.handle_ticket(102)
    assert not events(audit, "output_rejected")
    assert out.payment_approvals[0].warnings == ["Partial rent: $400.00 of the rent due 2026-09-02 would still be owed."]
    assert events(audit, "approval_requested")[0]["request"]["warnings"]


async def test_payments_together_cannot_exceed_cash(temp_db, audit):
    import sqlite3
    with sqlite3.connect(temp_db) as conn:
        conn.execute("UPDATE cash_accounts SET balance = 3000")
    both = [payment("invoice", 501, 840), payment("rent", 1, 2400)]
    script = Script({"boss": [
        ("final", {**resolution(102, payment_approvals=both), "status": "needs_human_approval"}),
        ("final", resolution(102)),
    ]})
    async with Team(FunctionModel(script), audit) as team:
        await team.handle_ticket(102)
    assert any("more than the $3,000.00 available" in p for p in events(audit, "output_rejected")[0]["problems"])


def discount_request(**extra) -> dict[str, Any]:
    return {"ticket_id": 103, "customer": "Yale AI Club", "sku": "CC-HOOD-NAVY", "size": "M", "qty": 20,
            "list_price": 1, "unit_cost": 1, "total_at_list_price": 1, "qty_in_stock": 99,
            "break_even_discount_percent": 1, "facts_for_decision": ["Only 8 in M."], **extra}


async def test_discount_options_and_recommendation_use_the_records(temp_db, audit):
    options = [{"discount_percent": p} for p in (0, 5, 10)]
    req = discount_request(options_evaluated=options, recommended_discount_percent=5,
                           recommendation_reason="Keeps most of the profit; only 8 of 20 in stock.")
    script = Script({"boss": [("final", {**resolution(103, discount_approvals=[req]),
                                         "status": "needs_human_approval"})]})
    async with Team(FunctionModel(script), audit) as team:
        _, out = await team.handle_ticket(103)
    d = out.discount_approvals[0]
    assert (d.list_price, d.unit_cost, d.total_at_list_price, d.qty_in_stock, d.break_even_discount_percent) == \
        (58.0, 22.0, 1160.0, 8, 62.07)
    assert [(o.discount_percent, o.unit_price, o.total_price, o.total_profit) for o in d.options_evaluated] == \
        [(0, 58.0, 1160.0, 720.0), (5, 55.1, 1102.0, 662.0), (10, 52.2, 1044.0, 604.0)]
    assert d.recommended_discount_percent == 5
    # The request goes to a person; the customer draft rules still forbid mentioning it.
    assert events(audit, "approval_requested")[0]["approval_type"] == "discount"


async def test_recommendation_must_be_an_evaluated_option_with_a_reason(temp_db, audit):
    bad = discount_request(options_evaluated=[{"discount_percent": 0}, {"discount_percent": 10}],
                           recommended_discount_percent=15)
    good = discount_request(options_evaluated=[{"discount_percent": 0}, {"discount_percent": 10}],
                            recommended_discount_percent=10, recommendation_reason="Profit stays at $604.")
    script = Script({"boss": [
        ("final", {**resolution(103, discount_approvals=[bad]), "status": "needs_human_approval"}),
        ("final", {**resolution(103, discount_approvals=[good]), "status": "needs_human_approval"}),
    ]})
    async with Team(FunctionModel(script), audit) as team:
        _, out = await team.handle_ticket(103)
    problems = events(audit, "output_rejected")[0]["problems"]
    assert any("must be one of the options you evaluated" in p for p in problems)
    assert any("recommendation_reason" in p for p in problems)
    assert out.discount_approvals[0].recommended_discount_percent == 10


# ---------------------------------------------------------------- delegation guards and usage limits

async def test_delegation_guards(temp_db, audit, monkeypatch):
    monkeypatch.setattr(config, "MAX_DELEGATIONS", 2)
    script = Script({
        "boss": [
            ("call", "delegate", {"to": "boss", "task": "x"}),                 # self
            ("call", "delegate", {"to": "facilities", "task": "Ticket 102"}),
            ("call", "delegate", {"to": "inventory", "task": "Ticket 102"}),   # uses the last one
            ("call", "delegate", {"to": "accounting", "task": "Ticket 102"}),  # over the limit
            ("final", resolution(102)),
        ],
        "facilities": [
            ("call", "delegate", {"to": "facilities", "task": "x"}),           # self
            ("call", "delegate", {"to": "boss", "task": "x"}),                 # already in the chain
            ("final", report("facilities")),
        ],
        "inventory": [("final", report("inventory"))],
    })
    async with Team(FunctionModel(script), audit) as team:
        await team.handle_ticket(102)
    retries = " | ".join(script.seen_retries)
    assert "can't delegate to yourself" in retries
    assert "already working on this request" in retries
    assert "used all its delegations" in retries
    assert len(events(audit, "delegation")) == 2


async def test_delegation_depth_is_limited(temp_db, audit, monkeypatch):
    monkeypatch.setattr(config, "MAX_DELEGATION_DEPTH", 1)
    script = Script({
        "boss": [("call", "delegate", {"to": "facilities", "task": "Ticket 102"}), ("final", resolution(102))],
        "facilities": [("call", "delegate", {"to": "accounting", "task": "x"}), ("final", report("facilities"))],
    })
    async with Team(FunctionModel(script), audit) as team:
        await team.handle_ticket(102)
    assert any("delegation limit" in r for r in script.seen_retries)


async def test_usage_limit_stops_a_runaway_run(temp_db, audit, monkeypatch):
    monkeypatch.setattr(config, "REQUEST_LIMIT", 3)
    script = Script({"boss": [("call", "get_ticket", {"ticket_id": 101})]})  # never stops on its own
    async with Team(FunctionModel(script), audit) as team:
        with pytest.raises(UsageLimitExceeded):
            await team.handle_ticket(101)
    assert events(audit, "usage_limit_exceeded")
    assert events(audit, "run_finished")[-1]["outcome"] == "stopped_by_usage_limit"


# ---------------------------------------------------------------- audit file safety

def test_audit_refuses_to_overwrite_a_damaged_file(tmp_path):
    path = tmp_path / "audit_trail.json"
    path.write_text("not json", encoding="utf-8")
    with pytest.raises(AuditTrailError):
        AuditTrail(path).record("x")
    assert path.read_text(encoding="utf-8") == "not json"


def test_audit_file_stays_valid_json(tmp_path):
    trail = AuditTrail(tmp_path / "a.json")
    for i in range(3):
        trail.record("e", n=i)
    data = json.loads((tmp_path / "a.json").read_text(encoding="utf-8"))
    assert [e["n"] for e in data] == [0, 1, 2]


# ---------------------------------------------------------------- human approval

async def test_approved_payments_follow_the_payment_rules(temp_db):
    import sqlite3

    async def pay(kind, ref_id, amount):
        req = {"kind": kind, "ref_id": ref_id, "amount": amount, "account": "checking"}
        try:
            warnings = (await approve.check_now(req))["warnings"]  # what the approver is shown
        except Exception:
            warnings = []
        return await approve.record_payment(req, "Test Person", warnings)

    def db(sql):
        with sqlite3.connect(temp_db) as conn:
            return conn.execute(sql).fetchall()

    # Partial invoice payment: recorded with a warning; the invoice stays open until fully paid.
    part = await pay("invoice", 501, 500)
    assert part["recorded"] and part["invoice_status"] == "open" and part["still_owed"] == 340.0
    assert part["warnings"] == ["Partial payment: $340.00 of invoice 501 would still be owed."]
    rest = await pay("invoice", 501, 340)
    assert rest["invoice_status"] == "paid" and rest["still_owed"] == 0 and rest["warnings"] == []
    # Paying again is not blocked (a person approved it), but the approver is warned.
    again = await pay("invoice", 501, 10)
    assert again["recorded"] and "already paid in full" in again["warnings"][0]

    # Full rent moves the lease on a month; a partial payment counts toward the new due date.
    rent = await pay("rent", 1, 2400)
    assert rent["months_of_rent_covered"] == 1 and rent["next_due"] == "2026-10-02"
    assert rent["still_owed_for_next_due"] == 2400.0
    partial = await pay("rent", 1, 100)
    assert partial["next_due"] == "2026-10-02" and partial["still_owed_for_next_due"] == 2300.0
    assert partial["balance_after"] == 3400 - 850 - 2400 - 100

    # The shop's rule: no payment beyond the cash available / no negative balance.
    short = await pay("rent", 1, 2300)
    assert not short["recorded"] and "balance would go negative" in short["error"]
    assert db("SELECT balance FROM cash_accounts") == [(50.0,)]
    assert db("SELECT next_due FROM leases") == [("2026-10-02",)]
    assert db("SELECT kind, ref_id, amount, approved_by FROM payments") == [
        ("invoice", 501, 500.0, "Test Person"), ("invoice", 501, 340.0, "Test Person"),
        ("invoice", 501, 10.0, "Test Person"), ("rent", 1, 2400.0, "Test Person"),
        ("rent", 1, 100.0, "Test Person")]


async def test_vendor_can_ship_only_once_its_invoices_are_fully_paid(temp_db):
    from fastmcp import Client

    async def can_ship():
        async with Client(agents_module.mcp_transport("agent")) as c:
            return (await c.call_tool("get_vendor_status", {"vendor_id": 1})).data["vendors"][0]
    assert (await can_ship())["can_ship_additional_products"] is False
    req = {"kind": "invoice", "ref_id": 501, "amount": 800, "account": "checking"}
    await approve.record_payment(req, "T", (await approve.check_now(req))["warnings"])
    v = await can_ship()
    assert v["can_ship_additional_products"] is False and v["unpaid_total"] == 40.0
    await approve.record_payment({"kind": "invoice", "ref_id": 501, "amount": 40, "account": "checking"}, "T")
    assert (await can_ship())["can_ship_additional_products"] is True


def test_add_months_keeps_the_day_or_uses_month_end():
    import subprocess
    import sys

    code = ("import sys; sys.path.insert(0, sys.argv[1]); from datetime import date; from server import add_months; "
            "print(add_months(date(2026, 9, 2), 1), add_months(date(2026, 12, 15), 1), "
            "add_months(date(2027, 1, 31), 1), add_months(date(2028, 1, 31), 1))")
    out = subprocess.run([str(config.MCP_PYTHON), "-c", code, str(config.MCP_SERVER_SCRIPT.parent)],
                         capture_output=True, text=True, check=True).stdout.split()
    assert out == ["2026-10-02", "2027-01-15", "2027-02-28", "2028-02-29"]


# ---------------------------------------------------------------- paying the same bill twice

def pay_request(approval_id: str, ticket_id: int, kind: str, ref_id: int, amount: float) -> dict[str, Any]:
    return {"event": "approval_requested", "approval_id": approval_id, "approval_type": "payment",
            "run_id": "run_test", "ticket_id": ticket_id,
            "request": {"kind": kind, "ref_id": ref_id, "payee": "Bulldog Print Co", "amount": amount,
                        "account": "checking", "due_date": "2026-08-28", "reason": "overdue",
                        "cash_available": 3400, "cash_after_payment": 2560, "warnings": []}}


def answers(monkeypatch, *replies):
    queue = list(replies)
    monkeypatch.setattr(approve, "ask", lambda prompt: queue.pop(0))


def paid_rows(db):
    import sqlite3
    with sqlite3.connect(db) as conn:
        return conn.execute("SELECT kind, ref_id, amount FROM payments").fetchall()


async def test_second_request_for_the_same_bill_is_flagged_and_needs_confirmation(
        temp_db, audit, monkeypatch, capfd):
    first = audit.record(**{k: v for k, v in pay_request("apr_1", 101, "invoice", 501, 840).items()
                            if k != "event"}, event="approval_requested")
    second = audit.record(**{k: v for k, v in pay_request("apr_2", 102, "invoice", 501, 840).items()
                             if k != "event"}, event="approval_requested")

    # First request: the other pending request for the same bill is shown, so confirmation is needed.
    answers(monkeypatch, "y", "PAY ANYWAY", "Pat")
    await approve.decide(audit, first)
    out = capfd.readouterr().out
    assert "ALSO PENDING for this bill: [apr_2]" in out and "pay it twice" in out
    assert paid_rows(temp_db) == [("invoice", 501, 840.0)]

    # Second request: checked live, so the person sees it's already paid, even though the
    # agents saw no warning when they made the request. "y" alone doesn't pay it.
    answers(monkeypatch, "y", "")
    await approve.decide(audit, second)
    out = capfd.readouterr().out
    assert "WARNING: Invoice 501 is already paid in full" in out
    assert "Not confirmed; nothing paid" in out
    assert paid_rows(temp_db) == [("invoice", 501, 840.0)]
    assert [p["approval_id"] for p in approve.pending(audit)] == ["apr_2"]   # still waiting

    # The person can still reject it, which closes it.
    answers(monkeypatch, "n", "Pat", "duplicate")
    await approve.decide(audit, second)
    assert approve.pending(audit) == [] and paid_rows(temp_db) == [("invoice", 501, 840.0)]


async def test_more_than_owed_is_flagged_before_paying(temp_db, audit, monkeypatch, capfd):
    e = audit.record(**{k: v for k, v in pay_request("apr_3", 101, "invoice", 501, 900).items()
                        if k != "event"}, event="approval_requested")
    answers(monkeypatch, "y", "no")
    await approve.decide(audit, e)
    out = capfd.readouterr().out
    assert "Checked just now: $840.00 still owed" in out
    assert "WARNING: $900.00 is more than the $840.00 still owed on invoice 501." in out
    assert paid_rows(temp_db) == []


async def test_record_payment_refuses_warnings_the_approver_did_not_confirm(temp_db):
    req = {"kind": "invoice", "ref_id": 501, "amount": 840, "account": "checking"}
    assert (await approve.record_payment(req, "Pat", []))["recorded"]
    # The bill is now paid. Paying again without confirming that warning is refused...
    again = await approve.record_payment(req, "Pat", [])
    assert not again["recorded"] and "hasn't confirmed" in again["error"] and "already paid in full" in again["error"]
    # ...and so is a stale confirmation for a different warning.
    stale = await approve.record_payment(req, "Pat", ["Partial payment: $0.00 of invoice 501 would still be owed."])
    assert not stale["recorded"]
    assert paid_rows(temp_db) == [("invoice", 501, 840.0)]


async def test_same_bill_twice_in_one_plan_is_flagged(temp_db, audit):
    both = [payment("invoice", 501, 840), payment("invoice", 501, 840)]
    script = Script({"boss": [("final", {**resolution(101, payment_approvals=both),
                                         "status": "needs_human_approval"})]})
    async with Team(FunctionModel(script), audit) as team:
        _, out = await team.handle_ticket(101)
    assert out.payment_approvals[0].warnings == []
    assert "requested more than once in this plan" in out.payment_approvals[1].warnings[0]



# ---------------------------------------------------------------- purchase requests

def purchase(ticket_id: int, sku: str, size: str, qty: int, vendor_id: int = 1) -> dict[str, Any]:
    return {"ticket_id": ticket_id, "sku": sku, "size": size, "qty": qty, "vendor_id": vendor_id,
            "reason": "Order can't be filled from stock."}


async def test_purchase_request_for_ticket_103_shortfall(temp_db, audit):
    script = Script({"boss": [("final", {**resolution(103, purchase_approvals=[purchase(103, "CC-HOOD-NAVY", "M", 12)]),
                                         "status": "needs_human_approval"})]})
    async with Team(FunctionModel(script), audit) as team:
        _, out = await team.handle_ticket(103)
    p = out.purchase_approvals[0]
    assert (p.product_name, p.qty, p.qty_in_stock, p.vendor_name, p.lead_days) == \
        ("Basic Hoodie Big Yale", 12, 8, "Bulldog Print Co", 5)
    assert (p.estimated_unit_cost, p.estimated_cost, p.vendor_can_ship, p.unpaid_invoices) == (22.0, 264.0, False, [501])
    assert p.warnings == ["Bulldog Print Co can't ship until its unpaid invoice(s) 501 ($840.00) are paid: "
                          "vendors with unpaid invoices cannot ship additional products."]
    req = events(audit, "approval_requested")[0]
    assert req["approval_type"] == "purchase" and req["request"]["qty"] == 12


async def test_purchase_quantity_must_be_the_shortfall_for_the_ticket_item(temp_db, audit):
    script = Script({"boss": [
        ("final", {**resolution(103, purchase_approvals=[purchase(103, "CC-HOOD-NAVY", "M", 20),
                                                         purchase(103, "CC-HOOD-NAVY", "L", 5)]),
                   "status": "needs_human_approval"}),
        ("final", {**resolution(103, purchase_approvals=[purchase(103, "cc-hood-navy", "m", 12)]),
                   "status": "needs_human_approval"}),
    ]})
    async with Team(FunctionModel(script), audit) as team:
        _, out = await team.handle_ticket(103)
    problems = events(audit, "output_rejected")[0]["problems"]
    assert any("20 wanted - 8 in stock = 12" in p for p in problems)
    assert any("must be for the ticket's item: CC-HOOD-NAVY size M" in p for p in problems)
    assert out.purchase_approvals[0].qty == 12 and out.purchase_approvals[0].sku == "CC-HOOD-NAVY"


async def test_purchase_for_ticket_101_warns_it_may_already_be_on_order(temp_db, audit):
    script = Script({"boss": [("final", {**resolution(101, purchase_approvals=[purchase(101, "CC-TEE-WHITE", "S", 1)]),
                                         "status": "needs_human_approval"})]})
    async with Team(FunctionModel(script), audit) as team:
        _, out = await team.handle_ticket(101)
    assert any('Invoice 501 linked to this ticket ("Rush reprint CC-TEE-WHITE S") may already cover this item.' == w
               for w in out.purchase_approvals[0].warnings)


async def test_no_purchase_for_a_ticket_without_a_product(temp_db, audit):
    script = Script({"boss": [
        ("final", {**resolution(102, purchase_approvals=[purchase(102, "CC-HOOD-NAVY", "M", 12)]),
                   "status": "needs_human_approval"}),
        ("final", resolution(102)),
    ]})
    async with Team(FunctionModel(script), audit) as team:
        _, out = await team.handle_ticket(102)
    assert out.purchase_approvals == []
    assert "isn't for a product" in events(audit, "output_rejected")[0]["problems"][0]


# ---------------------------------------------------------------- the exact requests sent to Portkey

def capture_portkey_requests():
    """An HTTP client that records each request and answers with an error, so nothing reaches Portkey."""
    import httpx
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(400, json={"error": {"message": "captured by test", "type": "invalid_request_error"}})
    return httpx.AsyncClient(transport=httpx.MockTransport(handler)), seen


async def first_request(monkeypatch, endpoint: str | None, run):
    if endpoint:
        monkeypatch.setenv("OPENAI_ENDPOINT", endpoint)
    else:
        monkeypatch.delenv("OPENAI_ENDPOINT", raising=False)
    monkeypatch.delenv("OPENAI_REASONING_EFFORT", raising=False)
    monkeypatch.setenv("PORTKEY_API_KEY", "test-key-not-real")
    client, seen = capture_portkey_requests()
    model = create_portkey_model(http_client=client)
    with pytest.raises(Exception):
        await run(model)
    req = seen[0]
    return req, json.loads(req.content)


def tool_names(body) -> set[str]:
    return {t.get("name") or t.get("function", {}).get("name") for t in body.get("tools", [])}


async def test_default_uses_the_responses_endpoint_with_tools_and_reasoning(monkeypatch):
    from pydantic import BaseModel
    from pydantic_ai import Agent

    class Out(BaseModel):
        ok: bool

    async def run(model):
        agent = Agent(model, output_type=Out)

        @agent.tool_plain
        def shop_date() -> str:
            return "2026-08-31"
        await agent.run("hi")

    req, body = await first_request(monkeypatch, None, run)
    assert req.url.path == "/v1/responses" and req.url.host == "api.portkey.ai"
    assert req.headers["authorization"] == "Bearer test-key-not-real" and "x-portkey-api-key" not in req.headers
    assert body["model"] == "gpt-6-luna"
    assert body["reasoning"]["effort"] == "low"
    assert "shop_date" in tool_names(body)          # function tool
    assert len(tool_names(body)) >= 2               # plus the structured-output tool


async def test_chat_fallback_turns_reasoning_off(monkeypatch):
    from pydantic_ai import Agent

    async def run(model):
        agent = Agent(model)

        @agent.tool_plain
        def shop_date() -> str:
            return "2026-08-31"
        await agent.run("hi")

    req, body = await first_request(monkeypatch, "chat", run)
    assert req.url.path == "/v1/chat/completions"
    assert body["reasoning_effort"] == "none" and "shop_date" in tool_names(body)


def test_bad_endpoint_setting_is_a_clear_error(monkeypatch):
    monkeypatch.setenv("PORTKEY_API_KEY", "x")
    monkeypatch.setenv("OPENAI_ENDPOINT", "websocket")
    with pytest.raises(AgentsNotConfigured, match="OPENAI_ENDPOINT"):
        create_portkey_model()


async def test_every_agent_request_has_its_mcp_tools_delegate_and_output_on_responses(temp_db, audit, monkeypatch):
    """The real five agents, on the default endpoint: what Portkey would receive from each."""
    async def run_each(model):
        async with Team(model, audit) as team:
            ticket = await team.lookup("get_ticket", {"ticket_id": 101})
            vendors = await team.lookup("get_vendor_status", {})
            from models import ShopDeps
            from agents import usage_limits
            for name, agent in team.agents.items():
                deps = ShopDeps(team=team, audit=audit, run_id="run_capture", ticket=ticket,
                                vendor_names={v["name"] for v in vendors["vendors"]},
                                usage_limits=usage_limits(), agent=name, chain=(name,))
                try:
                    await agent.run("Handle ticket 101.", deps=deps)
                except Exception:
                    pass
        raise RuntimeError("done")

    monkeypatch.delenv("OPENAI_ENDPOINT", raising=False)
    monkeypatch.delenv("OPENAI_REASONING_EFFORT", raising=False)
    monkeypatch.setenv("PORTKEY_API_KEY", "test-key-not-real")
    client, seen = capture_portkey_requests()
    model = create_portkey_model(http_client=client)
    with pytest.raises(RuntimeError):
        await run_each(model)

    bodies = [json.loads(r.content) for r in seen]
    assert len(bodies) == 5 and all(r.url.path == "/v1/responses" for r in seen)
    for name, body in zip(AGENT_NAMES, bodies):
        tools = tool_names(body)
        assert TOOLS_BY_AGENT[name] <= tools, name                      # its MCP tools
        assert "delegate" in tools and "record_payment" not in tools    # delegation, never payments
        assert body["reasoning"]["effort"] == "low" and body["model"] == "gpt-6-luna"
        assert body["max_output_tokens"] == config.MAX_OUTPUT_TOKENS
