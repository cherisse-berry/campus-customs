"""Campus Customs API: the dashboard's way to reach the agents and the shop database.

Start it from hw5/backend:

    uvicorn main:app --reload --port 8000

It's then at http://localhost:8000 (interactive docs at http://localhost:8000/docs).

All shop information comes through the Campus Customs MCP server, which reads the
working database (data/campus_customs_new.db). Payments are recorded only through
the MCP server's approver-only record_payment tool, with the same safeguards as
approve.py (see approvals.py). Every action is added to output/audit_trail.json;
nothing in it is ever overwritten.

Routes
  GET  /api/health                     is the API up, and is it set up?
  GET  /api/tickets                    the tickets, their status and the agents' status
  GET  /api/tickets/{ticket_id}        one ticket with its linked records, runs and pending approvals
  POST /api/tickets/{ticket_id}/run    start the agent team on a ticket (runs in the background)
  GET  /api/runs                       every agent run
  GET  /api/runs/{run_id}              one run: status, outcome, usage and the Boss's plan
  GET  /api/activity                   agent activity to poll: messages, delegations, tools, decisions
  GET  /api/approvals                  approval requests; pending payments are checked live
  GET  /api/approvals/{approval_id}    one request, checked live
  POST /api/approvals/{approval_id}    approve or reject a payment or discount request
  GET  /api/cash                       the checking balance and what's due
  POST /api/reset                      reset the working database from the original
"""

from __future__ import annotations

import asyncio
import hashlib
import importlib.util
import os
import shutil
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastmcp import Client
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.models import Model

import config
from agents import AgentsNotConfigured, Team, create_portkey_model, mcp_transport
from approvals import (
    ApprovalError,
    approve_discount,
    approve_payment,
    classify,
    find_pending,
    reject,
    review_payment,
)
from audit import AuditTrail, new_run_id
from models import ApprovalDecisionRequest, ResetRequest, RunRequest

# Which events belong to which activity category (an event can be in more than one).
CATEGORIES: dict[str, set[str]] = {
    "messages": {"delegation", "delegation_result", "draft_message"},
    "delegations": {"delegation", "delegation_result"},
    "tools": {"tool_call", "tool_result", "tool_error"},
    "decisions": {"resolution", "decision", "approval_requested", "human_follow_up", "output_rejected"},
    "approvals": {"approval_requested", "approval_decision", "payment_recorded", "payment_refused"},
    "runs": {"run_started", "run_finished", "run_error", "usage_limit_exceeded"},
    "system": {"database_reset"},
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _fingerprint(path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _expected_original_sha256() -> str:
    """The fingerprint of the database delivered in data_2.zip, from setup_db.py."""
    spec = importlib.util.spec_from_file_location("setup_db", config.SETUP_DB_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.EXPECTED_SHA256


# ---------------------------------------------------------------- app and shared state

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.mcp = Client(mcp_transport("agent"))
    async with app.state.mcp:
        yield
    for task in list(app.state.tasks):
        task.cancel()


app = FastAPI(
    title="Campus Customs API",
    description="Tickets, agent runs and activity, human approvals, cash and database reset. "
                "All shop information comes through the Campus Customs MCP server.",
    version="1.0",
    lifespan=lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])

app.state.audit = AuditTrail()
app.state.model_factory: Callable[[], Model] = create_portkey_model
app.state.runs: dict[str, dict[str, Any]] = {}   # runs started by this API process
app.state.busy: str | None = None                # "run:<run_id>" or "reset" while one is in progress
app.state.tasks: set[asyncio.Task] = set()
app.state.mcp_lock = asyncio.Lock()


def audit() -> AuditTrail:
    return app.state.audit


@app.exception_handler(ApprovalError)
async def approval_error(request: Request, err: ApprovalError) -> JSONResponse:
    status = {"not_found": 404, "name_required": 422, "invalid": 422}.get(err.code, 409)
    return JSONResponse(status_code=status, content={"error": err.code, "detail": err.message, **err.details})


async def mcp(tool: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
    """Call a read-only MCP tool. Errors from the tool become 404 (not found) or 400."""
    async with app.state.mcp_lock:
        result = await app.state.mcp.call_tool(tool, args or {}, raise_on_error=False)
    if result.is_error:
        text = result.content[0].text if result.content else "MCP tool error"
        status = 404 if text.startswith(("There is no", "Unknown")) else 400
        raise HTTPException(status_code=status, detail=text)
    return result.data


# ---------------------------------------------------------------- runs, from the audit trail

def _run_summaries(entries: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    runs: dict[str, dict[str, Any]] = {}
    for e in entries:
        rid = e.get("run_id")
        if not rid or not rid.startswith("run_"):
            continue
        if e["event"] == "run_started":
            runs[rid] = {"run_id": rid, "ticket_id": e["ticket_id"], "status": "running",
                         "started_at": e["timestamp"], "model": e.get("model"), "limits": e.get("limits")}
        elif rid in runs:
            r = runs[rid]
            if e["event"] == "run_finished":
                r.update(status="finished", outcome=e.get("outcome"), finished_at=e["timestamp"],
                         usage=e.get("usage"), delegations=e.get("delegations"))
                if e.get("outcome") in {"error", "stopped_by_usage_limit"}:
                    r["status"] = "stopped" if e["outcome"] == "stopped_by_usage_limit" else "error"
            elif e["event"] in {"run_error", "usage_limit_exceeded"}:
                r["error"] = e.get("error")
            elif e["event"] == "resolution":
                r["resolution"] = e.get("resolution")
    # Runs this process started that haven't written run_started yet, or failed before it.
    for rid, live in app.state.runs.items():
        if rid not in runs:
            runs[rid] = {"run_id": rid, "ticket_id": live["ticket_id"], "status": live["status"],
                         "started_at": live["started_at"], "error": live.get("error")}
        elif live["status"] == "running":
            runs[rid]["status"] = "running"
    return runs


def _latest_run(runs: dict[str, dict[str, Any]], ticket_id: int) -> dict[str, Any] | None:
    mine = [r for r in runs.values() if r["ticket_id"] == ticket_id]
    return max(mine, key=lambda r: r["started_at"]) if mine else None


def _agent_status(run: dict[str, Any] | None) -> str:
    if run is None:
        return "not_run"
    if run["status"] == "running":
        return "running"
    return run.get("outcome") or run["status"]


# ---------------------------------------------------------------- general

@app.get("/", include_in_schema=False)
async def index() -> dict[str, Any]:
    return {"name": "Campus Customs API", "docs": "/docs", "health": "/api/health"}


@app.get("/api/health", summary="Is the API up, and is it set up?")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "model": config.MODEL_NAME,
        "portkey_key_configured": bool(os.environ.get(config.PORTKEY_API_KEY_VAR, "").strip()),
        "working_database_present": config.WORKING_DB.is_file(),
        "audit_trail": str(audit().path),
        "busy": app.state.busy,
    }


# ---------------------------------------------------------------- tickets

@app.get("/api/tickets", summary="The tickets, their status and the agents' status")
async def list_tickets() -> dict[str, Any]:
    data = await mcp("list_tickets")
    entries = audit().entries()
    runs = _run_summaries(entries)
    waiting = classify(audit())["pending"]
    tickets = []
    for t in data["tickets"]:
        latest = _latest_run(runs, t["id"])
        tickets.append({**t, "agent_status": _agent_status(latest),
                        "latest_run_id": latest["run_id"] if latest else None,
                        "pending_approvals": sum(1 for a in waiting if a["ticket_id"] == t["id"])})
    return {"today": data["today"], "tickets": tickets}


@app.get("/api/tickets/{ticket_id}", summary="One ticket with its linked records, runs and pending approvals")
async def get_ticket(ticket_id: int) -> dict[str, Any]:
    data = await mcp("get_ticket", {"ticket_id": ticket_id})
    runs = [r for r in _run_summaries(audit().entries()).values() if r["ticket_id"] == ticket_id]
    runs.sort(key=lambda r: r["started_at"], reverse=True)
    waiting = [a for a in classify(audit())["pending"] if a["ticket_id"] == ticket_id]
    return {**data, "agent_status": _agent_status(runs[0] if runs else None),
            "runs": runs, "pending_approvals": waiting}


@app.post("/api/tickets/{ticket_id}/run", status_code=202,
          summary="Start the agent team on a ticket (runs in the background)")
async def run_ticket(ticket_id: int, body: RunRequest | None = None) -> dict[str, Any]:
    await mcp("get_ticket", {"ticket_id": ticket_id})  # 404 if there's no such ticket
    if app.state.busy:
        raise HTTPException(409, f"Busy ({app.state.busy}). One run or reset at a time, to keep AI costs "
                                 "and the database under control.")
    try:
        model = app.state.model_factory()
    except AgentsNotConfigured as e:
        raise HTTPException(503, str(e)) from e

    run_id = new_run_id()
    app.state.busy = f"run:{run_id}"
    app.state.runs[run_id] = {"ticket_id": ticket_id, "status": "running", "started_at": _now(),
                              "requested_by": body.requested_by if body else None}
    task = asyncio.create_task(_run_team(model, run_id, ticket_id))
    app.state.tasks.add(task)
    task.add_done_callback(app.state.tasks.discard)
    return {"run_id": run_id, "ticket_id": ticket_id, "status": "running",
            "run_url": f"/api/runs/{run_id}", "activity_url": f"/api/activity?run_id={run_id}"}


async def _run_team(model: Model, run_id: str, ticket_id: int) -> None:
    live = app.state.runs[run_id]
    try:
        async with Team(model, audit()) as team:
            _, out = await team.handle_ticket(ticket_id, run_id=run_id)
        live.update(status="finished", outcome=out.status)
    except UsageLimitExceeded as e:
        live.update(status="stopped", error=str(e))
    except Exception as e:  # recorded by handle_ticket if the run had started; otherwise here
        live.update(status="error", error=f"{type(e).__name__}: {e}")
        if not any(x.get("run_id") == run_id and x["event"] == "run_error" for x in audit().entries()):
            audit().record("run_error", run_id=run_id, ticket_id=ticket_id, agent="boss",
                           error_type=type(e).__name__, error=str(e))
    finally:
        app.state.busy = None


# ---------------------------------------------------------------- runs and activity

@app.get("/api/runs", summary="Every agent run")
async def list_runs(ticket_id: int | None = None) -> dict[str, Any]:
    runs = list(_run_summaries(audit().entries()).values())
    if ticket_id is not None:
        runs = [r for r in runs if r["ticket_id"] == ticket_id]
    runs.sort(key=lambda r: r["started_at"], reverse=True)
    return {"runs": runs}


@app.get("/api/runs/{run_id}", summary="One run: status, outcome, usage and the Boss's plan")
async def get_run(run_id: str) -> dict[str, Any]:
    run = _run_summaries(audit().entries()).get(run_id)
    if run is None:
        raise HTTPException(404, f"There is no run {run_id}.")
    return run


def _summary(e: dict[str, Any]) -> str:
    ev, agent = e["event"], e.get("agent") or "-"
    if ev == "tool_call":
        args = ", ".join(f"{k}={v!r}" for k, v in (e.get("arguments") or {}).items())
        return f"{agent} called {e['tool']}({args})"
    if ev == "tool_result":
        return f"{agent} got the result of {e['tool']}"
    if ev == "tool_error":
        return f"{agent}: {e['tool']} failed: {e.get('error')}"
    if ev == "delegation":
        return f"{agent} asked {e['to']}: {e.get('task')}"
    if ev == "delegation_result":
        return f"{agent} replied to {e.get('reply_to')}: {(e.get('report') or {}).get('summary', '')}"
    if ev == "draft_message":
        m = e.get("message") or {}
        return f"Draft to {m.get('to')} (not sent): {m.get('subject')}"
    if ev == "output_rejected":
        return f"{agent}'s answer was sent back: " + "; ".join(e.get("problems", []))
    if ev == "decision":
        return f"Decision: {e.get('decision')}"
    if ev == "approval_requested":
        r = e.get("request") or {}
        what = (f"pay {r.get('payee')} ${r.get('amount', 0):,.2f}" if e.get("approval_type") == "payment"
                else f"discount for {r.get('customer')}")
        return f"Waiting for a person: {what}"
    if ev == "approval_decision":
        return f"{e.get('decided_by')} {'approved' if e.get('approved') else 'rejected'} {e.get('approval_id')}"
    if ev == "payment_recorded":
        p = e.get("payment") or {}
        return f"Payment {p.get('payment_id')} recorded: ${p.get('amount', 0):,.2f} to {p.get('payee')}"
    if ev == "payment_refused":
        return f"Payment not recorded: {e.get('error')}"
    if ev == "run_started":
        return f"Run started on ticket {e.get('ticket_id')}"
    if ev == "run_finished":
        return f"Run finished: {e.get('outcome')}"
    if ev == "database_reset":
        return f"Working database reset by {e.get('requested_by')}"
    return ev.replace("_", " ")


@app.get("/api/activity", summary="Agent activity to poll: messages, delegations, tools, decisions")
async def activity(
    ticket_id: int | None = None,
    run_id: str | None = None,
    category: str | None = Query(None, description=f"One of: {', '.join(CATEGORIES)}"),
    since: int = Query(0, ge=0, description="Return entries after this position (use `next` from the last call)."),
    limit: int = Query(200, ge=1, le=1000),
) -> dict[str, Any]:
    if category is not None and category not in CATEGORIES:
        raise HTTPException(422, f"category must be one of: {', '.join(CATEGORIES)}")
    entries = audit().entries()
    events = []
    for position, e in enumerate(entries[since:], start=since):
        if ticket_id is not None and e.get("ticket_id") != ticket_id:
            continue
        if run_id is not None and e.get("run_id") != run_id:
            continue
        cats = [c for c, names in CATEGORIES.items() if e["event"] in names]
        if category is not None and category not in cats:
            continue
        events.append({"position": position, "categories": cats, "summary": _summary(e), **e})
        if len(events) >= limit:
            break
    next_position = events[-1]["position"] + 1 if len(events) >= limit else len(entries)
    running = run_id is not None and app.state.runs.get(run_id, {}).get("status") == "running"
    return {"events": events, "next": next_position, "running": running or app.state.busy is not None}


# ---------------------------------------------------------------- approvals

async def _with_review(e: dict[str, Any]) -> dict[str, Any]:
    if e["approval_type"] != "payment":
        return e
    return {**e, "review": await review_payment(audit(), e)}


@app.get("/api/approvals", summary="Approval requests; pending payments are checked live")
async def list_approvals(status: str = Query("pending", pattern="^(pending|decided|expired|all)$"),
                         ticket_id: int | None = None) -> dict[str, Any]:
    groups = classify(audit())
    names = list(groups) if status == "all" else [status]
    out: dict[str, list[dict[str, Any]]] = {}
    for name in names:
        items = [e for e in groups[name] if ticket_id is None or e["ticket_id"] == ticket_id]
        out[name] = [await _with_review(e) for e in items] if name == "pending" else items
    return out


@app.get("/api/approvals/{approval_id}", summary="One pending request, checked live")
async def get_approval(approval_id: str) -> dict[str, Any]:
    return await _with_review(find_pending(audit(), approval_id))


@app.post("/api/approvals/{approval_id}", summary="Approve or reject a payment or discount request")
async def decide(approval_id: str, body: ApprovalDecisionRequest) -> dict[str, Any]:
    if app.state.busy == "reset":
        raise HTTPException(409, "The database is being reset. Try again in a moment.")
    e = find_pending(audit(), approval_id)
    if body.decision == "reject":
        return {"decision": reject(audit(), e, body.decided_by, body.note)}
    if e["approval_type"] == "payment":
        payment = await approve_payment(audit(), e, body.decided_by, body.confirmed_warnings)
        return {"payment": payment}
    if body.discount_percent is None:
        raise ApprovalError("invalid", "discount_percent is required to approve a discount (the person decides it).")
    return {"decision": approve_discount(audit(), e, body.decided_by, body.discount_percent, body.note),
            "note": "Recorded only. Nothing was sent to the customer and no price changed."}


# ---------------------------------------------------------------- cash

@app.get("/api/cash", summary="The checking balance and what's due")
async def cash() -> dict[str, Any]:
    data = await mcp("get_payments_due")
    checking = next((a for a in data["cash_accounts"] if a["name"] == "checking"), None)
    return {
        "today": data["today"],
        "checking_balance": checking["balance"] if checking else None,
        "as_of": checking["as_of"] if checking else None,
        "accounts": data["cash_accounts"],
        "payments_due": data["payments_due"],
        "total_due": data["total_due"],
        "cash_left_if_all_paid": data["cash_left_if_all_paid"],
        "note": "Revenue from customer orders is only received when the customer picks up the order.",
    }


# ---------------------------------------------------------------- reset

@app.post("/api/reset", summary="Reset the working database from the original")
async def reset(body: ResetRequest) -> dict[str, Any]:
    """Copy the original database over the working copy, for a fresh run.

    The original is only read, and must match the database delivered in data_2.zip.
    The audit trail is kept; requests still pending from before the reset expire.
    """
    if app.state.busy:
        raise HTTPException(409, f"Busy ({app.state.busy}). Wait for it to finish before resetting.")
    original, working = config.ORIGINAL_DB, config.WORKING_DB
    if working.resolve() == original.resolve():
        raise HTTPException(500, "The working database path points at the original; refusing to reset.")
    if not original.is_file():
        raise HTTPException(409, f"The original database {original.name} is missing. Run setup_db.py first.")
    expected = _expected_original_sha256()
    if _fingerprint(original) != expected:
        raise HTTPException(409, f"{original.name} doesn't match the database delivered in data_2.zip; "
                                 "nothing was changed.")
    app.state.busy = "reset"
    try:
        before = _fingerprint(working) if working.is_file() else None
        expiring = [e["approval_id"] for e in classify(audit())["pending"]]
        temp = working.with_name(working.name + ".resetting")
        shutil.copyfile(original, temp)
        if _fingerprint(temp) != expected:
            temp.unlink()
            raise HTTPException(500, "The copy didn't match the original; nothing was changed.")
        os.chmod(temp, 0o644)
        os.replace(temp, working)
        entry = audit().record("database_reset", agent="human", requested_by=body.requested_by,
                               working_database=working.name, sha256_before=before,
                               sha256_after=_fingerprint(working), expired_approvals=expiring)
    finally:
        app.state.busy = None
    return {"reset": True, "working_database": working.name, "sha256": entry["sha256_after"],
            "changed": before != entry["sha256_after"], "expired_approvals": expiring,
            "audit_entry": entry["id"]}
