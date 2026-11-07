"""Tests for the Campus Customs API (main.py).

No real payments and no AI calls:
- The API runs against a temporary copy of the working database and a temporary
  audit trail. A check confirms both real database files are unchanged afterwards.
- The agent run uses the scripted stand-in model from test_agents.py, not gpt-6-luna.

Run from hw5/backend:  .venv/bin/python -m pytest
"""

from __future__ import annotations

import hashlib
import shutil
import sqlite3
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic_ai.models.function import FunctionModel

import config
import main
from agents import AgentsNotConfigured
from audit import AuditTrail
from test_agents import Script, payment, pay_request, report, resolution

REAL_WORKING = config.HW5 / "data" / "campus_customs_new.db"
REAL_ORIGINAL = config.HW5 / "data" / "campus_customs.db"


def fingerprint(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture(scope="module", autouse=True)
def real_databases_unchanged():
    before = {p: fingerprint(p) for p in (REAL_WORKING, REAL_ORIGINAL)}
    yield
    assert {p: fingerprint(p) for p in (REAL_WORKING, REAL_ORIGINAL)} == before


@pytest.fixture
def env(tmp_path, monkeypatch):
    """A temporary original, working copy and audit trail; the API's state reset for each test."""
    original = tmp_path / "original" / "campus_customs.db"
    original.parent.mkdir()
    shutil.copyfile(REAL_ORIGINAL, original)
    working = tmp_path / "campus_customs_test_working.db"
    shutil.copyfile(REAL_WORKING, working)
    working.chmod(0o644)
    monkeypatch.setenv("CAMPUS_CUSTOMS_DB", str(working))
    monkeypatch.delenv("PORTKEY_API_KEY", raising=False)
    monkeypatch.setattr(config, "ORIGINAL_DB", original)
    monkeypatch.setattr(config, "WORKING_DB", working)
    trail = AuditTrail(tmp_path / "audit_trail.json")
    state = main.app.state
    saved = {k: getattr(state, k) for k in ("audit", "runs", "busy", "model_factory")}
    state.audit, state.runs, state.busy, state.model_factory = trail, {}, None, main.create_portkey_model
    yield {"working": working, "original": original, "audit": trail}
    for k, v in saved.items():
        setattr(state, k, v)


@pytest.fixture
def client(env):
    with TestClient(main.app) as c:
        yield c


def rows(db: Path, sql: str):
    with sqlite3.connect(db) as conn:
        return conn.execute(sql).fetchall()


def add_request(trail: AuditTrail, approval_id: str, ticket_id: int, kind: str, ref_id: int, amount: float):
    e = pay_request(approval_id, ticket_id, kind, ref_id, amount)
    return trail.record(**{k: v for k, v in e.items() if k != "event"}, event="approval_requested")


# ---------------------------------------------------------------- read-only routes

def test_health(client):
    r = client.get("/api/health").json()
    assert r["status"] == "ok" and r["model"] == "gpt-6-luna"
    assert r["portkey_key_configured"] is False and r["working_database_present"] is True


def test_tickets_and_status(client):
    r = client.get("/api/tickets").json()
    assert r["today"] == "2026-08-31"
    assert [(t["id"], t["type"], t["status"], t["agent_status"], t["requester_is_customer"]) for t in r["tickets"]] == [
        (101, "customer_order", "open", "not_run", True),
        (102, "rent_notice", "open", "not_run", False),
        (103, "price_override", "open", "not_run", True)]


def test_one_ticket(client):
    r = client.get("/api/tickets/101").json()
    assert r["ticket"]["requester"] == "Tauhid Zaman"
    assert r["linked"]["invoice"]["still_owed"] == 840.0 and r["runs"] == [] and r["pending_approvals"] == []
    assert client.get("/api/tickets/999").status_code == 404


def test_cash(client):
    r = client.get("/api/cash").json()
    assert r["checking_balance"] == 3400.0 and r["as_of"] == "2026-08-31"
    assert r["total_due"] == 3240.0 and r["cash_left_if_all_paid"] == 160.0
    assert [(p["kind"], p["id"], p["amount"]) for p in r["payments_due"]] == [("invoice", 501, 840.0), ("rent", 1, 2400.0)]


# ---------------------------------------------------------------- running the agents

def test_run_needs_the_portkey_key(client, env):
    r = client.post("/api/tickets/101/run")
    assert r.status_code == 503 and "PORTKEY_API_KEY" in r.json()["detail"]
    assert env["audit"].entries() == [] and main.app.state.busy is None
    assert client.post("/api/tickets/999/run").status_code == 404


def test_only_one_run_or_reset_at_a_time(client, monkeypatch):
    main.app.state.busy = "run:run_other"
    assert client.post("/api/tickets/101/run").status_code == 409
    assert client.post("/api/reset", json={"confirm": "RESET", "requested_by": "Pat"}).status_code == 409
    main.app.state.busy = None


def wait_for(client, run_id, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] != "running":
            return run
        time.sleep(0.2)
    raise AssertionError("run didn't finish")


def test_scripted_run_and_activity(client, env, monkeypatch):
    script = Script({
        "boss": [
            ("call", "get_ticket", {"ticket_id": 101}),
            ("call", "delegate", {"to": "inventory", "task": "Ticket 101: stock of CC-TEE-WHITE size S?"}),
            ("final", {**resolution(101, payment_approvals=[payment("invoice", 501, 840)],
                                    draft_messages=[{"ticket_id": 101, "to": "Tauhid Zaman", "subject": "Your tee",
                                                     "body": "Size S is out of stock right now."}]),
                       "status": "needs_human_approval"}),
        ],
        "inventory": [("call", "check_stock", {"sku": "CC-TEE-WHITE", "size": "S"}),
                      ("final", report("inventory"))],
    })
    main.app.state.model_factory = lambda: FunctionModel(script)

    started = client.post("/api/tickets/101/run", json={"requested_by": "Pat"})
    assert started.status_code == 202
    run_id = started.json()["run_id"]
    run = wait_for(client, run_id)
    assert run["status"] == "finished" and run["outcome"] == "needs_human_approval"
    assert run["resolution"]["payment_approvals"][0]["ref_id"] == 501
    assert main.app.state.busy is None

    act = client.get("/api/activity", params={"run_id": run_id}).json()
    names = [e["event"] for e in act["events"]]
    assert names[0] == "run_started" and names[-1] == "run_finished"
    tools = client.get("/api/activity", params={"run_id": run_id, "category": "tools"}).json()["events"]
    assert [(e["agent"], e["summary"]) for e in tools if e["event"] == "tool_call"] == [
        ("boss", "boss called get_ticket(ticket_id=101)"),
        ("inventory", "inventory called check_stock(sku='CC-TEE-WHITE', size='S')")]
    delegations = client.get("/api/activity", params={"run_id": run_id, "category": "delegations"}).json()["events"]
    assert [e["event"] for e in delegations] == ["delegation", "delegation_result"]
    assert delegations[0]["summary"].startswith("boss asked inventory: Ticket 101")
    messages = client.get("/api/activity", params={"run_id": run_id, "category": "messages"}).json()["events"]
    assert any(e["event"] == "draft_message" and "(not sent)" in e["summary"] for e in messages)

    # Polling: `next` returns only what's new.
    later = client.get("/api/activity", params={"since": act["next"]}).json()
    assert later["events"] == [] and later["next"] == act["next"]
    assert client.get("/api/activity", params={"category": "nope"}).status_code == 422

    t = next(t for t in client.get("/api/tickets").json()["tickets"] if t["id"] == 101)
    assert t["agent_status"] == "needs_human_approval" and t["pending_approvals"] == 1 and t["latest_run_id"] == run_id
    # The run only made a request: nothing was paid.
    assert rows(env["working"], "SELECT COUNT(*) FROM payments") == [(0,)]


# ---------------------------------------------------------------- approvals (temporary database only)

def test_payment_approval_safeguards(client, env):
    add_request(env["audit"], "apr_a", 101, "invoice", 501, 840)
    add_request(env["audit"], "apr_b", 102, "invoice", 501, 840)

    pending = client.get("/api/approvals").json()["pending"]
    first = next(p for p in pending if p["approval_id"] == "apr_a")
    assert first["review"]["still_owed"] == 840.0 and first["review"]["can_approve"] is True
    dup = first["review"]["warnings"]
    assert len(dup) == 1 and "Approving both would pay it twice" in dup[0]

    # No name, or warnings not confirmed: nothing is paid.
    assert client.post("/api/approvals/apr_a", json={"decision": "approve", "decided_by": " "}).status_code == 422
    r = client.post("/api/approvals/apr_a", json={"decision": "approve", "decided_by": "Pat"})
    assert r.status_code == 409 and r.json()["error"] == "confirmation_required" and r.json()["unconfirmed"] == dup
    assert rows(env["working"], "SELECT COUNT(*) FROM payments") == [(0,)]

    # Confirmed: recorded (in the temporary copy).
    r = client.post("/api/approvals/apr_a", json={"decision": "approve", "decided_by": "Pat", "confirmed_warnings": dup})
    assert r.status_code == 200 and r.json()["payment"]["balance_after"] == 2560.0
    assert client.get("/api/cash").json()["checking_balance"] == 2560.0

    # The second request for the same bill is now flagged as already paid, live.
    second = client.get("/api/approvals/apr_b").json()
    assert "already paid in full" in second["review"]["warnings"][0]
    r = client.post("/api/approvals/apr_b", json={"decision": "approve", "decided_by": "Pat",
                                                    "confirmed_warnings": dup})  # stale confirmation
    assert r.status_code == 409 and r.json()["error"] == "confirmation_required"
    assert rows(env["working"], "SELECT COUNT(*) FROM payments") == [(1,)]
    assert client.post("/api/approvals/apr_b", json={"decision": "reject", "decided_by": "Pat",
                                                     "note": "duplicate"}).status_code == 200
    assert client.get("/api/approvals").json()["pending"] == []
    assert client.post("/api/approvals/apr_b", json={"decision": "reject", "decided_by": "Pat"}).status_code == 409
    assert client.post("/api/approvals/apr_zzz", json={"decision": "reject", "decided_by": "Pat"}).status_code == 404


def test_payment_over_available_cash_is_not_allowed(client, env):
    with sqlite3.connect(env["working"]) as conn:
        conn.execute("UPDATE cash_accounts SET balance = 1000")
    add_request(env["audit"], "apr_rent", 102, "rent", 1, 2400)
    review = client.get("/api/approvals/apr_rent").json()["review"]
    assert review["can_approve"] is False and "balance would go negative" in review["problems"][0]
    r = client.post("/api/approvals/apr_rent", json={"decision": "approve", "decided_by": "Pat"})
    assert r.status_code == 409 and r.json()["error"] == "not_allowed"
    assert rows(env["working"], "SELECT balance FROM cash_accounts") == [(1000.0,)]


def test_discount_decision_is_recorded_only(client, env):
    env["audit"].record("approval_requested", approval_id="apr_d", approval_type="discount", run_id="run_x",
                        ticket_id=103, request={"customer": "Yale AI Club", "sku": "CC-HOOD-NAVY", "size": "M",
                                                "qty": 20})
    assert client.post("/api/approvals/apr_d", json={"decision": "approve", "decided_by": "Pat"}).status_code == 422
    r = client.post("/api/approvals/apr_d", json={"decision": "approve", "decided_by": "Pat", "discount_percent": 5})
    assert r.status_code == 200 and r.json()["decision"]["discount_percent"] == 5
    assert rows(env["working"], "SELECT list_price FROM pricing WHERE sku = 'CC-HOOD-NAVY'") == [(58.0,)]


# ---------------------------------------------------------------- reset

def test_reset_restores_only_the_working_copy_and_keeps_the_audit_trail(client, env):
    add_request(env["audit"], "apr_old", 101, "invoice", 501, 840)
    with sqlite3.connect(env["working"]) as conn:
        conn.execute("UPDATE cash_accounts SET balance = 1")
    before_entries = env["audit"].entries()
    original_before = fingerprint(env["original"])

    assert client.post("/api/reset", json={"confirm": "yes", "requested_by": "Pat"}).status_code == 422
    r = client.post("/api/reset", json={"confirm": "RESET", "requested_by": "Pat"})
    assert r.status_code == 200
    body = r.json()
    assert body["changed"] is True and body["expired_approvals"] == ["apr_old"]
    assert fingerprint(env["working"]) == fingerprint(env["original"]) == original_before
    assert client.get("/api/cash").json()["checking_balance"] == 3400.0

    after = env["audit"].entries()
    assert after[:len(before_entries)] == before_entries and after[-1]["event"] == "database_reset"
    assert client.get("/api/approvals").json()["pending"] == []
    assert [e["approval_id"] for e in client.get("/api/approvals", params={"status": "expired"}).json()["expired"]] == ["apr_old"]


def test_reset_refuses_a_wrong_original(client, env):
    env["original"].chmod(0o644)
    with sqlite3.connect(env["original"]) as conn:
        conn.execute("UPDATE cash_accounts SET balance = 99")
    working_before = fingerprint(env["working"])
    r = client.post("/api/reset", json={"confirm": "RESET", "requested_by": "Pat"})
    assert r.status_code == 409 and "doesn't match" in r.json()["detail"]
    assert fingerprint(env["working"]) == working_before and env["audit"].entries() == []


# ---------------------------------------------------------------- purchase approvals

def add_purchase(trail: AuditTrail, approval_id: str = "apr_buy"):
    request = {"ticket_id": 103, "sku": "CC-HOOD-NAVY", "size": "M", "qty": 12, "vendor_id": 1,
               "reason": "20 wanted, 8 in stock.", "product_name": "Basic Hoodie Big Yale", "qty_in_stock": 8,
               "vendor_name": "Bulldog Print Co", "vendor_specialty": "apparel reprint", "lead_days": 5,
               "vendor_can_ship": False, "unpaid_invoices": [501], "estimated_unit_cost": 22.0,
               "estimated_cost": 264.0, "warnings": []}
    return trail.record("approval_requested", approval_id=approval_id, approval_type="purchase",
                        run_id="run_test", ticket_id=103, request=request)


def snapshot(db: Path):
    return (rows(db, "SELECT * FROM cash_accounts"), rows(db, "SELECT * FROM payments"),
            rows(db, "SELECT * FROM inventory"), rows(db, "SELECT * FROM invoices"))


def test_purchase_approval_records_the_decision_only(client, env):
    add_purchase(env["audit"])
    before = snapshot(env["working"])

    review = client.get("/api/approvals/apr_buy").json()["review"]
    assert (review["qty_in_stock"], review["estimated_cost"], review["vendor_can_ship"]) == (8, 264.0, False)
    vendor_warning = review["warnings"]
    assert vendor_warning == ["Bulldog Print Co can't ship until its unpaid invoice(s) 501 ($840.00) are paid: "
                              "vendors with unpaid invoices cannot ship additional products."]
    assert "No order is placed" in review["approval_effect"]

    r = client.post("/api/approvals/apr_buy", json={"decision": "approve", "decided_by": "Pat"})
    assert r.status_code == 409 and r.json()["unconfirmed"] == vendor_warning
    r = client.post("/api/approvals/apr_buy", json={"decision": "approve", "decided_by": "Pat",
                                                     "confirmed_warnings": vendor_warning, "note": "after 501 is paid"})
    assert r.status_code == 200
    d = r.json()["decision"]
    assert (d["approved"], d["order_placed"], d["vendor_contacted"], d["money_moved"]) == (True, False, False, False)
    assert "No order was placed" in r.json()["note"]

    # Nothing in the database changed: no order, no payment, no stock or cash change.
    assert snapshot(env["working"]) == before
    assert client.get("/api/cash").json()["checking_balance"] == 3400.0
    assert client.get("/api/approvals").json()["pending"] == []
    decided = client.get("/api/approvals", params={"status": "decided"}).json()["decided"]
    assert decided[0]["decision"]["approval_type"] == "purchase"
    acts = client.get("/api/activity", params={"category": "approvals"}).json()["events"]
    assert acts[0]["summary"] == "Waiting for a person: buy 12 x CC-HOOD-NAVY M from Bulldog Print Co"


def test_purchase_can_be_rejected(client, env):
    add_purchase(env["audit"])
    r = client.post("/api/approvals/apr_buy", json={"decision": "reject", "decided_by": "Pat", "note": "not now"})
    assert r.status_code == 200 and r.json()["decision"]["approved"] is False


def test_purchase_warning_clears_once_the_vendor_is_paid(client, env):
    add_purchase(env["audit"])
    add_request(env["audit"], "apr_pay", 101, "invoice", 501, 840)
    client.post("/api/approvals/apr_pay", json={"decision": "approve", "decided_by": "Pat"})  # temp copy only
    review = client.get("/api/approvals/apr_buy").json()["review"]
    assert review["vendor_can_ship"] is True and review["warnings"] == []
    r = client.post("/api/approvals/apr_buy", json={"decision": "approve", "decided_by": "Pat"})
    assert r.status_code == 200


async def _decide_cli(trail, entry):
    import approve
    await approve.decide(trail, entry)


def test_purchase_approval_from_the_command_line(env, monkeypatch, capfd):
    import asyncio

    import approve
    e = add_purchase(env["audit"])
    queue = ["y", ""]                    # approve, then don't type APPROVE ANYWAY
    monkeypatch.setattr(approve, "ask", lambda prompt: queue.pop(0))
    asyncio.run(_decide_cli(env["audit"], e))
    out = capfd.readouterr().out
    assert "WARNING: Bulldog Print Co can't ship until" in out and "nothing recorded" in out
    queue[:] = ["y", "APPROVE ANYWAY", "Pat", ""]
    asyncio.run(_decide_cli(env["audit"], e))
    assert "No order was placed" in capfd.readouterr().out
    assert [d["decision"]["decided_by"] for d in __import__("approvals").classify(env["audit"])["decided"]] == ["Pat"]
