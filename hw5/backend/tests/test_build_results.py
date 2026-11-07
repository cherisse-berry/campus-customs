"""Tests for build_results.py, on temporary copies only.

The runs here use scripted agents (as in test_agents.py) to produce an audit trail;
the real output/ folder, audit trail and databases are never touched.
"""

from __future__ import annotations

import json
import shutil

import pytest
from pydantic_ai.models.function import FunctionModel

import approvals
import build_results
import config
from agents import Team
from test_agents import Script, payment, report, resolution
from test_api import REAL_ORIGINAL, REAL_WORKING, fingerprint  # noqa: F401

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="module", autouse=True)
def real_files_unchanged():
    files = [REAL_WORKING, REAL_ORIGINAL, config.HW5 / "output" / "desk_tickets.html", config.HW5 / "output" / "audit_trail.json"]
    before = {p: fingerprint(p) for p in files}
    yield
    assert {p: fingerprint(p) for p in files} == before


@pytest.fixture
def setup(tmp_path, monkeypatch):
    db = tmp_path / "working_copy.db"
    shutil.copyfile(REAL_WORKING, db)
    db.chmod(0o644)
    monkeypatch.setenv("CAMPUS_CUSTOMS_DB", str(db))
    out = tmp_path / "output"
    out.mkdir()
    shutil.copyfile(config.HW5 / "output" / "desk_tickets.html", out / "desk_tickets.html")
    trail = build_results.AuditTrail(out / "audit_trail.json")
    trail.record("earlier_activity", note="kept")
    trail.record("database_reset", agent="human", requested_by="Pat", starting_checking_balance=3400.0)
    return {"db": db, "out": out, "audit": trail}


SCRIPTS = {
    101: Script({"boss": [("call", "get_ticket", {"ticket_id": 101}),
                          ("call", "delegate", {"to": "inventory", "task": "Ticket 101: stock of CC-TEE-WHITE S?"}),
                          ("final", {**resolution(101, payment_approvals=[payment("invoice", 501, 840)]),
                                     "status": "needs_human_approval"})],
                 "inventory": [("call", "check_stock", {"sku": "CC-TEE-WHITE", "size": "S"}),
                               ("final", report("inventory", summary="0 in S"))]}),
    102: Script({"boss": [("call", "get_ticket", {"ticket_id": 102}),
                          ("call", "delegate", {"to": "facilities", "task": "Ticket 102: check lease 1."}),
                          ("final", {**resolution(102, payment_approvals=[payment("rent", 1, 2400)]),
                                     "status": "needs_human_approval"})],
                 "facilities": [("call", "get_lease", {"lease_id": 1}), ("final", report("facilities", summary="Matches lease 1"))]}),
    103: Script({"boss": [("call", "get_ticket", {"ticket_id": 103}),
                          ("final", {**resolution(103, purchase_approvals=[{"ticket_id": 103, "sku": "CC-HOOD-NAVY", "size": "M",
                                                                            "qty": 12, "vendor_id": 1, "reason": "12 short"}]),
                                     "status": "needs_human_approval"})]}),
}


async def run_all(trail):
    for tid, script in SCRIPTS.items():
        async with Team(FunctionModel(script), trail) as team:
            await team.handle_ticket(tid)


async def test_builds_every_file_from_the_audit_trail_and_database(setup):
    trail, out = setup["audit"], setup["out"]
    await run_all(trail)
    rent = next(a for a in approvals.pending(trail) if a["request"]["kind"] == "rent")
    await approvals.approve_payment(trail, rent, "Pat", [])          # one human approval, like the real run
    (out / "resolved_screenshots").mkdir()
    (out / "resolved_screenshots" / "ticket-102-summary.png").write_bytes(b"\x89PNG")

    desk_before = (out / "desk_tickets.html").read_text()
    data = build_results.build(trail.entries(), await build_results.read_database(),
                               build_results.find_screenshots(out / "resolved_screenshots"))
    t = {x["ticket_id"]: x for x in data["tickets"]}

    assert t[102]["status"] == "resolved" and t[102]["human_approvals"][0]["status"] == "approved"
    assert t[102]["human_approvals"][0]["decision"]["decided_by"] == "Pat"
    assert t[101]["status"] == "needs_action" and t[103]["status"] == "needs_action"
    assert any("pending" in s for s in t[101]["still_needs_action"])
    assert t[101]["boss_contacted_first"] == "inventory" and t[101]["compared_with_expected"]["boss_contacted_first"]["matches"]
    assert t[102]["agent_contributions"]["facilities"]["mcp_tools"] == {"get_lease": 1}
    assert t[102]["screenshots"] == ["ticket-102-summary.png"]

    cash = data["cash"]
    assert (cash["starting_balance"], cash["total_moved"], cash["final_balance"]) == (3400.0, 2400.0, 1000.0)
    assert cash["starting_balance_source"] == "recorded at reset"
    assert [c["payee"] for c in cash["changes"]] == ["Elm City Properties"]
    assert all(v for v in cash["verification"].values() if isinstance(v, bool))
    assert {n["type"] for n in cash["no_money_moved_for"]} == {"payment", "purchase"}

    page = build_results.fill_desk(desk_before, data)
    # Expected plans are untouched; Actual and Cash are filled in.
    for marker in ("Who the Boss contacts first, and why", "How the work is delegated", "MCP tools we expect them to use"):
        assert page.count(marker) == desk_before.count(marker) == 3
    assert "Not run yet." not in page and "Blank for now." in page            # Reflection stays blank
    assert "Resolved — every request decided" in page and "Needs action" in page
    assert build_results.fill_desk(page, data) == page                        # rebuilding is stable
    board = build_results.board_page(page, data)
    assert 'src="resolved_screenshots/ticket-102-summary.png"' in board
    assert "No dashboard screenshot was provided" in board                     # 101 and 103 had none


async def test_the_money_check_fails_if_the_numbers_disagree(setup):
    import sqlite3
    trail = setup["audit"]
    await run_all(trail)
    with sqlite3.connect(setup["db"]) as conn:
        conn.execute("UPDATE cash_accounts SET balance = 999")      # money moved outside the system
    data = build_results.build(trail.entries(), await build_results.read_database(), {})
    assert data["cash"]["verification"]["ending_balance_matches_database"] is False


def test_the_secret_check_finds_a_leaked_key(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("PORTKEY_API_KEY", "pk-test-secret-123456")
    clean, leaky = tmp_path / "a.json", tmp_path / "b.json"
    clean.write_text("{}")
    leaky.write_text('{"oops": "pk-test-secret-123456"}')
    assert build_results.secret_check([clean]) is True
    assert build_results.secret_check([clean, leaky]) is False
    assert "pk-test-secret" not in capsys.readouterr().out      # it never prints the key
