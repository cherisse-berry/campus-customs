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
    assert client.default_headers["x-portkey-api-key"] == "test-key-not-real"
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
    assert any("does not match" in x for x in events(audit, "output_rejected")[0]["problems"])
    req = events(audit, "approval_requested")[0]
    assert req["approval_type"] == "payment" and req["request"]["amount"] == 2400


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


async def test_discount_request_has_no_amount_and_facts_come_from_records(temp_db, audit):
    req = {"ticket_id": 103, "customer": "Yale AI Club", "sku": "CC-HOOD-NAVY", "size": "M", "qty": 20,
           "list_price": 1, "unit_cost": 1, "total_at_list_price": 1, "qty_in_stock": 99,
           "break_even_discount_percent": 1, "facts_for_decision": ["Only 8 in M."]}
    script = Script({"boss": [("final", {**resolution(103, discount_approvals=[req]),
                                         "status": "needs_human_approval"})]})
    async with Team(FunctionModel(script), audit) as team:
        _, out = await team.handle_ticket(103)
    d = out.discount_approvals[0]
    assert (d.list_price, d.unit_cost, d.total_at_list_price, d.qty_in_stock, d.break_even_discount_percent) == \
        (58.0, 22.0, 1160.0, 8, 62.07)
    assert "discount_percent" not in d.model_dump()


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

async def test_approved_payment_is_recorded_and_rules_rechecked(temp_db):
    import sqlite3
    ok = await approve.record_payment({"kind": "invoice", "ref_id": 501, "amount": 840, "account": "checking"},
                                      "Test Person")
    assert ok["recorded"] and ok["balance_after"] == 2560.0 and ok["approved_by"] == "Test Person"
    again = await approve.record_payment({"kind": "invoice", "ref_id": 501, "amount": 840,
                                          "account": "checking"}, "Test Person")
    assert not again["recorded"] and "already paid" in again["error"]
    with sqlite3.connect(temp_db) as conn:
        conn.execute("UPDATE cash_accounts SET balance = 1000")
    short = await approve.record_payment({"kind": "rent", "ref_id": 1, "amount": 2400,
                                          "account": "checking"}, "Test Person")
    assert not short["recorded"] and "balance would go negative" in short["error"]
    with sqlite3.connect(temp_db) as conn:
        assert conn.execute("SELECT kind, ref_id, amount, approved_by FROM payments").fetchall() == \
            [("invoice", 501, 840.0, "Test Person")]
        assert conn.execute("SELECT status FROM invoices WHERE id = 501").fetchone() == ("paid",)
