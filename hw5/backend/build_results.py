"""Build the Problem 9 submission files from the real runs. Run it on the computer that ran the agents.

  python build_results.py            (from hw5/backend, with the virtual environment active)

It reads only:
  - the real audit trail (output/audit_trail.json): the reset, every run, tool call,
    delegation, request, approval and payment, and
  - the working database, read-only, through the MCP server (agent role): the current
    checking balance, what's still owed and the payments recorded on the lease and invoices.

It writes:
  - output/resolved_tickets.json   each ticket's status, outcome, agent contributions and human approvals
  - output/desk_tickets.html       fills in the Actual sections and the Cash tab (Expected plans untouched)
  - output/resolved_board.html     the board, with your dashboard screenshots from output/resolved_screenshots/

It never approves, pays, resets or changes anything, and it never calls the AI model. It also checks
that your PORTKEY_API_KEY doesn't appear in any of the files you'll commit. Running it again rebuilds the
same files from the same data.
"""

from __future__ import annotations

import argparse
import asyncio
import html
import json
import os
import re
import sys
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastmcp import Client

import config
from agents import mcp_transport
from audit import AuditTrail
from models import AGENT_NAMES

AGENT_LABELS = {"boss": "Boss", "inventory": "Inventory", "accounting": "Accounting",
                "facilities": "Facilities", "customer_service": "Customer Service"}
AGENT_COLORS = {"boss": "#2b4c8c", "inventory": "#0e7c74", "accounting": "#6d4bb3",
                "facilities": "#9a5b2e", "customer_service": "#c03a6b"}

# The Expected plans from Problem 6 (output/desk_tickets.html), used for the comparison.
EXPECTED: dict[int, dict[str, Any]] = {
    101: {"first": "inventory",
          "involved": {"boss", "inventory", "accounting", "customer_service"},
          "tools": {"boss": {"get_ticket"}, "inventory": {"check_stock", "get_vendor_status"},
                    "accounting": {"get_payments_due", "check_payment"}, "customer_service": {"get_ticket", "check_stock"}},
          "requests": ["payment: invoice 501 ($840.00)"]},
    102: {"first": "facilities",
          "involved": {"boss", "facilities", "accounting"},
          "tools": {"boss": {"get_ticket"}, "facilities": {"get_lease"}, "accounting": {"get_payments_due", "check_payment"}},
          "requests": ["payment: rent for lease 1 ($2,400.00)"]},
    103: {"first": "inventory",
          "involved": {"boss", "inventory", "accounting", "customer_service"},
          "tools": {"boss": {"get_ticket"}, "inventory": {"check_stock", "get_vendor_status"},
                    "accounting": {"price_bulk_order"}, "customer_service": {"get_ticket", "check_stock"}},
          "requests": ["purchase: 12 x CC-HOOD-NAVY M", "discount: for a person to decide"]},
}

e = html.escape


def money(x: float | None) -> str:
    return "—" if x is None else f"${x:,.2f}"


# ---------------------------------------------------------------- reading the audit trail

def runs_after_reset(entries: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    resets = [i for i, x in enumerate(entries) if x["event"] == "database_reset"]
    if not resets:
        return None, entries
    return entries[resets[-1]], entries[resets[-1] + 1:]


def summarise_runs(events: list[dict[str, Any]]) -> "OrderedDict[str, dict[str, Any]]":
    runs: OrderedDict[str, dict[str, Any]] = OrderedDict()
    for x in events:
        rid = x.get("run_id")
        if not rid or not str(rid).startswith("run_"):
            continue
        if x["event"] == "run_started":
            runs[rid] = {"run_id": rid, "ticket_id": x["ticket_id"], "model": x.get("model"), "started_at": x["timestamp"],
                         "status": "running", "outcome": None, "events": []}
        if rid in runs:
            r = runs[rid]
            r["events"].append(x)
            if x["event"] == "run_finished":
                r.update(finished_at=x["timestamp"], outcome=x.get("outcome"), usage=x.get("usage"),
                         delegations=x.get("delegations"))
                r["status"] = {"error": "error", "stopped_by_usage_limit": "stopped"}.get(x.get("outcome"), "finished")
            elif x["event"] in {"run_error", "usage_limit_exceeded"}:
                r["error"] = x.get("error")
            elif x["event"] == "resolution":
                r["resolution"] = x.get("resolution")
    return runs


def contributions(run_events: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    c = {a: {"involved": False, "asked_by": [], "tasks": [], "delegated_to": [], "tools": {}, "tool_errors": 0,
             "answers_sent_back": 0, "summary": None, "findings": []} for a in AGENT_NAMES}
    for x in run_events:
        a = x.get("agent")
        if x["event"] == "run_started":
            c["boss"]["involved"] = True
        elif x["event"] == "tool_call" and a in c:
            c[a]["involved"] = True
            c[a]["tools"][x["tool"]] = c[a]["tools"].get(x["tool"], 0) + 1
        elif x["event"] == "tool_error" and a in c:
            c[a]["tool_errors"] += 1
        elif x["event"] == "delegation" and a in c and x.get("to") in c:
            c[a]["involved"] = True
            if x["to"] not in c[a]["delegated_to"]:
                c[a]["delegated_to"].append(x["to"])
            t = c[x["to"]]
            t["involved"] = True
            if a not in t["asked_by"]:
                t["asked_by"].append(a)
            t["tasks"].append(x.get("task"))
        elif x["event"] == "delegation_result" and a in c:
            rep = x.get("report") or {}
            c[a]["involved"] = True
            c[a]["summary"] = rep.get("summary")
            c[a]["findings"] += [f.get("fact") for f in rep.get("findings", [])]
        elif x["event"] == "output_rejected" and a in c:
            c[a]["answers_sent_back"] += 1
        elif x["event"] == "resolution":
            res = x.get("resolution") or {}
            c["boss"]["summary"] = res.get("summary")
            c["boss"]["findings"] += [f.get("fact") for f in res.get("findings", [])]
    return c


def approvals_for(events: list[dict[str, Any]], run_ids: set[str]) -> list[dict[str, Any]]:
    decisions = {x["approval_id"]: x for x in events if x["event"] == "approval_decision"}
    recorded = {}
    refused: dict[str, list[str]] = {}
    for x in events:
        if x["event"] == "payment_recorded":
            # A payment entry follows its approval_decision entry for the same request.
            prior = [d for d in events[: events.index(x)] if d["event"] == "approval_decision"
                     and d.get("approval_type") == "payment" and d.get("run_id") == x.get("run_id")]
            if prior:
                recorded[prior[-1]["approval_id"]] = x["payment"]
        elif x["event"] == "payment_refused" and x.get("approval_id"):
            refused.setdefault(x["approval_id"], []).append(x.get("error"))
    out = []
    for x in events:
        if x["event"] != "approval_requested" or x.get("run_id") not in run_ids:
            continue
        d = decisions.get(x["approval_id"])
        r = x.get("request") or {}
        item = {"approval_id": x["approval_id"], "type": x["approval_type"], "run_id": x["run_id"],
                "requested_at": x["timestamp"], "request": r,
                "status": "pending" if d is None else ("approved" if d.get("approved") else "rejected")}
        if d:
            item["decision"] = {k: d.get(k) for k in ("decided_by", "timestamp", "note", "warnings_confirmed",
                                                      "discount_percent", "order_placed", "vendor_contacted", "money_moved")
                                if d.get(k) is not None}
        if x["approval_id"] in recorded:
            item["payment_recorded"] = recorded[x["approval_id"]]
        if x["approval_id"] in refused:
            item["refused_attempts"] = refused[x["approval_id"]]
        out.append(item)
    return out


def describe_request(a: dict[str, Any]) -> str:
    r = a["request"]
    if a["type"] == "payment":
        what = f"invoice {r.get('ref_id')}" if r.get("kind") == "invoice" else f"rent, lease {r.get('ref_id')}"
        return f"Pay {r.get('payee')} {money(r.get('amount'))} ({what})"
    if a["type"] == "purchase":
        return f"Buy {r.get('qty')} × {r.get('sku')} {r.get('size')} from {r.get('vendor_name')} (est. {money(r.get('estimated_cost'))})"
    rec = r.get("recommended_discount_percent")
    return f"Discount for {r.get('customer')} on {r.get('qty')} × {r.get('sku')} {r.get('size')}" + \
        (f" (agents recommended {rec}%)" if rec is not None else "")


def ticket_state(run: dict[str, Any] | None, approvals: list[dict[str, Any]]) -> tuple[str, str]:
    """Same rules as the dashboard (frontend/src/status.ts)."""
    if run is None:
        return "not_run", "Not run"
    if run["status"] == "running":
        return "running", "Running (unfinished)"
    if run["status"] == "error":
        return "failed", "Failed — not resolved"
    if run["status"] == "stopped":
        return "failed", "Stopped by a usage limit — not resolved"
    mine = [a for a in approvals if a["run_id"] == run["run_id"]]
    pending = [a for a in mine if a["status"] == "pending"]
    if run["outcome"] == "needs_human_approval":
        if pending:
            return "needs_action", f"Needs action — {len(pending)} request{'s' if len(pending) != 1 else ''} pending"
        return "resolved", "Resolved — every request decided"
    if run["outcome"] == "ready_for_review":
        return "resolved", "Resolved — nothing needed approval"
    return "failed", f"Not resolved ({run['outcome']})"


# ---------------------------------------------------------------- the database, through the MCP server

async def read_database() -> dict[str, Any]:
    async with Client(mcp_transport("agent")) as c:
        call = lambda tool, args={}: c.call_tool(tool, args)  # noqa: E731
        cash = (await call("get_payments_due")).data
        tickets = (await call("list_tickets")).data
        lease = (await call("get_lease", {"lease_id": 1})).data
        linked = {}
        for t in tickets["tickets"]:
            linked[t["id"]] = (await call("get_ticket", {"ticket_id": t["id"]})).data["linked"]
    return {"cash": cash, "tickets": tickets, "lease": lease, "linked": linked}


# ---------------------------------------------------------------- building everything

def build(entries: list[dict[str, Any]], db: dict[str, Any], screenshots: dict[int, list[str]]) -> dict[str, Any]:
    reset, events = runs_after_reset(entries)
    runs = summarise_runs(events)
    tickets_db = {t["id"]: t for t in db["tickets"]["tickets"]}
    checking = next(a for a in db["cash"]["cash_accounts"] if a["name"] == "checking")

    payments = [x for x in events if x["event"] == "payment_recorded"]
    start = reset.get("starting_checking_balance") if reset else None
    start_source = "recorded at reset" if start is not None else None
    moved = round(sum(p["payment"]["amount"] for p in payments), 2)
    if start is None:
        start = round(checking["balance"] + moved, 2)
        start_source = "worked out from the final balance plus recorded payments (the reset didn't record it)"

    result_tickets = []
    for tid in (101, 102, 103):
        t_runs = [r for r in runs.values() if r["ticket_id"] == tid]
        latest = t_runs[-1] if t_runs else None
        run_ids = {r["run_id"] for r in t_runs}
        approvals = approvals_for(events, run_ids)
        state, label = ticket_state(latest, approvals)
        contrib = contributions(latest["events"]) if latest else {}
        res = (latest or {}).get("resolution") or {}
        first = next((x["to"] for x in (latest or {}).get("events", []) if x["event"] == "delegation" and x.get("agent") == "boss"), None)
        exp = EXPECTED[tid]
        involved = {a for a, c in contrib.items() if c["involved"]}
        tools_used = {a: set(c["tools"]) for a, c in contrib.items() if c["tools"]}
        still = [f"{a['type'].capitalize()} request pending: {describe_request(a)}" for a in approvals
                 if a["status"] == "pending" and a["run_id"] == (latest or {}).get("run_id")]
        if latest and latest["status"] in {"error", "stopped"}:
            still.insert(0, f"The run didn't finish ({latest['status']}): {latest.get('error') or latest['outcome']}. Run it again.")
        still += [f"For a person: {f.get('action')}" for f in res.get("human_follow_ups", [])]
        still += [f"Review and send the draft to {m.get('to')} (not sent by the agents)" for m in res.get("draft_messages", [])]
        result_tickets.append({
            "ticket_id": tid,
            "subject": tickets_db[tid]["subject"], "type": tickets_db[tid]["type"], "requester": tickets_db[tid]["requester"],
            "database_status": tickets_db[tid]["status"],
            "status": state, "status_label": label,
            "runs": [{"run_id": r["run_id"], "status": r["status"], "outcome": r["outcome"], "started_at": r["started_at"],
                      "finished_at": r.get("finished_at"), "error": r.get("error")} for r in t_runs],
            "latest_run": None if not latest else {
                "run_id": latest["run_id"], "model": latest.get("model"), "status": latest["status"], "outcome": latest["outcome"],
                "usage": latest.get("usage"), "delegations": latest.get("delegations"), "error": latest.get("error")},
            "boss_contacted_first": first,
            "delegations": [{"from": x["agent"], "to": x["to"], "task": x.get("task")}
                            for x in (latest or {}).get("events", []) if x["event"] == "delegation"],
            "agent_contributions": {a: {"involved": c["involved"], "asked_by": c["asked_by"], "tasks": c["tasks"],
                                        "delegated_to": c["delegated_to"], "mcp_tools": c["tools"],
                                        "answers_sent_back_by_rule_checks": c["answers_sent_back"],
                                        "tool_errors": c["tool_errors"], "summary": c["summary"],
                                        "findings": c["findings"]} for a, c in contrib.items()},
            "outcome": {"summary": res.get("summary"), "decisions": res.get("decisions", []),
                        "draft_messages": res.get("draft_messages", []), "human_follow_ups": res.get("human_follow_ups", []),
                        "unknowns": res.get("unknowns", [])},
            "human_approvals": approvals,
            "still_needs_action": still,
            "compared_with_expected": {
                "boss_contacted_first": {"expected": exp["first"], "actual": first, "matches": first == exp["first"]},
                "agents_involved": {"expected": sorted(exp["involved"]), "actual": sorted(involved),
                                    "matches": involved == exp["involved"]},
                "mcp_tools": {a: {"expected": sorted(exp["tools"].get(a, set())), "actual": sorted(tools_used.get(a, set()))}
                              for a in AGENT_NAMES if exp["tools"].get(a) or tools_used.get(a)},
                "expected_requests": exp["requests"],
                "actual_requests": [describe_request(a) for a in approvals if a["run_id"] == (latest or {}).get("run_id")],
            },
            "screenshots": screenshots.get(tid, []),
        })

    # Cash: only money that actually moved (payments recorded after the reset).
    changes = []
    running = start
    for p in payments:
        pay = p["payment"]
        req = next((a for t in result_tickets for a in t["human_approvals"] if a.get("payment_recorded") == pay), None)
        running = round(running - pay["amount"], 2)
        changes.append({"ticket_id": p.get("ticket_id"), "payment_id": pay.get("payment_id"), "payee": pay.get("payee"),
                        "kind": pay.get("kind"), "ref_id": pay.get("ref_id"), "amount": pay["amount"],
                        "approved_by": pay.get("approved_by"), "paid_at": pay.get("paid_at"),
                        "why": (req or {}).get("request", {}).get("reason"), "balance_after": pay.get("balance_after"),
                        "balance_after_matches_running_total": pay.get("balance_after") == running})
    expected_final = round(start - moved, 2)
    rent_ids = {x["id"] for x in db["lease"].get("rent_payments_recorded", [])}
    checks = {
        "final_balance_in_database": checking["balance"],
        "starting_balance_minus_recorded_payments": expected_final,
        "ending_balance_matches_database": abs(expected_final - checking["balance"]) < 0.005,
        "each_balance_after_matches": all(c["balance_after_matches_running_total"] for c in changes),
        "rent_payments_in_database_match_audit": {c["payment_id"] for c in changes if c["kind"] == "rent"} <= rent_ids,
        "no_agent_called_record_payment": not any(x["event"] == "tool_call" and x.get("tool") == "record_payment" for x in events),
        "all_drafts_unsent": all(m.get("sent") is False for x in events if x["event"] == "draft_message" for m in [x.get("message", {})]),
        "every_payment_has_a_named_approver": all(c["approved_by"] for c in changes),
    }
    non_money = [{"ticket_id": t["ticket_id"], "type": a["type"], "status": a["status"], "what": describe_request(a)}
                 for t in result_tickets for a in t["human_approvals"] if a["type"] != "payment" or a["status"] != "approved"]
    cash = {"shop_date": db["cash"]["today"], "starting_balance": start, "starting_balance_source": start_source,
            "changes": changes, "total_moved": moved, "final_balance": checking["balance"], "as_of": checking["as_of"],
            "still_owed": db["cash"]["payments_due"], "no_money_moved_for": non_money, "verification": checks}
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {"audit_trail": "output/audit_trail.json", "database": "data/campus_customs_new.db (read through the MCP server)",
                   "reset": None if not reset else {"audit_entry": reset["id"], "timestamp": reset["timestamp"],
                                                    "requested_by": reset.get("requested_by"),
                                                    "starting_checking_balance": reset.get("starting_checking_balance")},
                   "model": sorted({r.get("model") for r in runs.values() if r.get("model")})},
        "tickets": result_tickets,
        "cash": cash,
    }


# ---------------------------------------------------------------- HTML

STYLE = """
<style id="actual-styles">
  .actual-filled { display: grid; gap: 12px; margin-top: 10px; }
  .actual-filled .outcome { border-radius: 10px; padding: 12px 14px; border: 1px solid var(--border); background: var(--surface); }
  .actual-filled .outcome.ok { border-color: var(--ok); background: var(--ok-soft); }
  .actual-filled .outcome.warn { border-color: var(--warn); background: var(--warn-soft); }
  .actual-filled .outcome.bad { border-color: var(--stop); background: var(--stop-soft); }
  .actual-filled .outcome b { font-size: 1.05rem; }
  .actual-filled .cmp { font-size: .82rem; font-weight: 700; padding: 1px 7px; border-radius: 999px; margin-left: 6px; }
  .actual-filled .cmp.same { color: var(--ok); background: var(--ok-soft); }
  .actual-filled .cmp.diff { color: var(--warn); background: var(--warn-soft); }
  .actual-filled .agentdot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; }
  .actual-filled .shot { max-width: 100%; border: 1px solid var(--border); border-radius: 8px; margin-top: 6px; }
</style>
"""


def agent_name(a: str | None) -> str:
    return AGENT_LABELS.get(a or "", a or "—")


def cmp_badge(ok: bool) -> str:
    return '<span class="cmp same">matches plan</span>' if ok else '<span class="cmp diff">differs from plan</span>'


def actual_section(t: dict[str, Any], shot_prefix: str, shots: bool = True) -> str:
    run = t["latest_run"]
    tone = {"resolved": "ok", "needs_action": "warn"}.get(t["status"], "bad")
    if not run:
        return '<div class="actual-filled"><div class="outcome bad"><b>Not run.</b></div></div>'
    u = run.get("usage") or {}
    usage = (f"{u.get('requests')} model calls · {u.get('tool_calls')} tool calls · "
             f"{(u.get('input_tokens') or 0) + (u.get('output_tokens') or 0):,} tokens · {run.get('delegations')} "
             f"delegation{'' if run.get('delegations') == 1 else 's'}") if u else ""
    c = t["compared_with_expected"]
    parts = [f'<div class="outcome {tone}"><b>{e(t["status_label"])}</b><br>'
             f'<span>Run <code>{e(run["run_id"])}</code> on <code>{e(str(run.get("model")))}</code>'
             f'{" · " + e(usage) if usage else ""}</span>'
             + (f'<br><span>Error: {e(str(run.get("error")))}</span>' if run.get("error") else "")
             + (f'<br><span>Earlier attempts: {len(t["runs"]) - 1}</span>' if len(t["runs"]) > 1 else "") + '</div>']
    parts.append(f'<h3>Who the Boss contacted first {cmp_badge(c["boss_contacted_first"]["matches"])}</h3>'
                 f'<div class="card first"><p>Actual: <b>{e(agent_name(t["boss_contacted_first"]))}</b>. '
                 f'Expected: {e(agent_name(c["boss_contacted_first"]["expected"]))}.</p></div>')
    flow = "".join(f'<li><div class="route">{e(agent_name(d["from"]))} <span class="arrow">→</span> {e(agent_name(d["to"]))}</div>'
                   f'<div>{e(d["task"] or "")}</div></li>' for d in t["delegations"])
    parts.append(f'<h3>How the work was delegated</h3><ol class="flow">{flow or "<li>No delegations.</li>"}</ol>')
    agents_html = ""
    for a in AGENT_NAMES:
        ac = t["agent_contributions"].get(a, {})
        if ac.get("involved"):
            tools = ", ".join(f"<code>{e(k)}</code>{' ×' + str(v) if v > 1 else ''}" for k, v in ac["mcp_tools"].items())
            extra = []
            if ac["asked_by"]:
                extra.append("Asked by " + ", ".join(agent_name(x) for x in ac["asked_by"]))
            if ac["answers_sent_back_by_rule_checks"]:
                extra.append(f"{ac['answers_sent_back_by_rule_checks']} answer(s) sent back by rule checks")
            agents_html += (f'<div class="agent in"><span class="tag">Involved</span><strong>'
                            f'<span class="agentdot" style="background:{AGENT_COLORS[a]}"></span>{e(agent_name(a))}</strong>'
                            f'<p>{e(ac["summary"] or "")}</p><p>{tools or "No MCP tools."}</p>'
                            + "".join(f"<p>{e(x)}</p>" for x in extra) + '</div>')
        else:
            agents_html += (f'<div class="agent out"><span class="tag">Not involved</span><strong>{e(agent_name(a))}</strong></div>')
    parts.append(f'<h3>Agents involved {cmp_badge(c["agents_involved"]["matches"])}</h3><div class="agents">{agents_html}</div>')
    rows = "".join(
        f'<tr><td>{e(agent_name(a))}</td><td>{", ".join(f"<code>{e(x)}</code>" for x in v["actual"]) or "—"}</td>'
        f'<td>{", ".join(f"<code>{e(x)}</code>" for x in v["expected"]) or "—"}</td>'
        f'<td>{cmp_badge(set(v["actual"]) == set(v["expected"]))}</td></tr>'
        for a, v in c["mcp_tools"].items())
    parts.append('<h3>MCP tools used</h3><div class="table-wrap"><table><thead><tr><th>Agent</th><th>Actual</th>'
                 f'<th>Expected</th><th></th></tr></thead><tbody>{rows}</tbody></table></div>')
    o = t["outcome"]
    plan = f'<p>{e(o["summary"] or "")}</p>'
    if o["decisions"]:
        plan += "<p><b>Decisions</b></p><ul class=\"tight\">" + "".join(f"<li>{e(d)}</li>" for d in o["decisions"]) + "</ul>"
    for m in o["draft_messages"]:
        plan += f'<p><b>Draft to {e(m.get("to", ""))} (not sent):</b> {e(m.get("subject", ""))}<br>{e(m.get("body", ""))}</p>'
    parts.append(f'<h3>The Boss\'s plan</h3><div class="card">{plan}</div>')
    arows = ""
    for a in t["human_approvals"]:
        d = a.get("decision") or {}
        who = f'{a["status"]} by {d.get("decided_by")}' if d else "pending"
        detail = ""
        if a.get("payment_recorded"):
            detail = f'Payment {a["payment_recorded"].get("payment_id")} recorded; balance after {money(a["payment_recorded"].get("balance_after"))}'
        elif a["type"] == "discount" and d.get("discount_percent") is not None:
            detail = f'{d["discount_percent"]}% decided (recorded only)'
        elif a["type"] == "purchase" and d:
            detail = "Decision recorded only; no order placed, no money moved"
        warns = a["request"].get("warnings") or []
        arows += (f'<tr><td>{e(a["type"])}</td><td>{e(describe_request(a))}<br><span class="lede">{e(a["request"].get("reason") or "")}</span>'
                  + "".join(f'<br><span class="lede">⚠ {e(w)}</span>' for w in warns)
                  + f'</td><td><b>{e(who)}</b><br>{e(detail)}</td></tr>')
    parts.append('<h3>Requests and human approvals</h3><div class="table-wrap"><table><thead><tr><th>Type</th><th>Request</th>'
                 f'<th>Decision</th></tr></thead><tbody>{arows or "<tr><td colspan=3>No requests.</td></tr>"}</tbody></table></div>'
                 f'<p class="lede">Expected requests: {e("; ".join(c["expected_requests"]))}.</p>')
    still = "".join(f"<li>{e(s)}</li>" for s in t["still_needs_action"])
    parts.append(f'<h3>Still needs action</h3><ul class="tight">{still or "<li>Nothing.</li>"}</ul>')
    if shots and t["screenshots"]:
        parts.append("<h3>Dashboard screenshots</h3>" + "".join(
            f'<img class="shot" src="{e(shot_prefix + s)}" alt="Dashboard screenshot for ticket {t["ticket_id"]}">' for s in t["screenshots"]))
    return f'<div class="actual-filled" id="t{t["ticket_id"]}-actual">' + "".join(parts) + "</div>"


def cash_section(cash: dict[str, Any]) -> str:
    v = cash["verification"]
    rows = f'<tr><td>Start</td><td>Working database reset ({e(cash["starting_balance_source"])})</td><td></td><td><b>{money(cash["starting_balance"])}</b></td></tr>'
    for c in cash["changes"]:
        rows += (f'<tr><td>Ticket {c["ticket_id"]}</td><td>Paid {e(c["payee"] or "")} ({"invoice " if c["kind"] == "invoice" else "rent, lease "}{c["ref_id"]}), '
                 f'approved by {e(c["approved_by"] or "")}. {e(c["why"] or "")}</td><td>−{money(c["amount"])}</td><td>{money(c["balance_after"])}</td></tr>')
    rows += f'<tr><td>Final</td><td>Checking balance in the working database, as of {e(cash["as_of"])}</td><td></td><td><b>{money(cash["final_balance"])}</b></td></tr>'
    none = "".join(f'<li>Ticket {n["ticket_id"]} {e(n["type"])} ({e(n["status"])}): {e(n["what"])}. No money moved.</li>'
                   for n in cash["no_money_moved_for"])
    rent_paid = any(c["kind"] == "rent" for c in cash["changes"])
    owed = "".join(f'<li>{e(p["payee"])}: {money(p["amount"])} ({e(p["description"])}, due {e(p["due_date"])})'
                   + (" — the next month's rent; the rent paid above moved the lease's due date forward"
                      if p["kind"] == "rent" and rent_paid else "") + '</li>' for p in cash["still_owed"])
    ok = lambda b: "✅" if b else "❌"  # noqa: E731
    checks = (f'<li>{ok(v["ending_balance_matches_database"])} Start {money(cash["starting_balance"])} − payments {money(cash["total_moved"])} '
              f'= {money(v["starting_balance_minus_recorded_payments"])}; database says {money(v["final_balance_in_database"])}</li>'
              f'<li>{ok(v["each_balance_after_matches"])} Each payment\'s recorded balance matches the running total</li>'
              f'<li>{ok(v["rent_payments_in_database_match_audit"])} Rent payments in the audit trail are recorded on the lease in the database</li>'
              f'<li>{ok(v["every_payment_has_a_named_approver"])} Every payment has a named human approver</li>'
              f'<li>{ok(v["no_agent_called_record_payment"])} No agent called <code>record_payment</code></li>'
              f'<li>{ok(v["all_drafts_unsent"])} Every customer draft is unsent</li>')
    return (f'<div class="actual-filled" id="cash-content"><p class="lede">Shop date {e(cash["shop_date"])}. Only money that actually '
            f'moved is counted: payments recorded after the reset.</p><div class="table-wrap"><table><thead><tr><th></th><th>What happened</th>'
            f'<th>Change</th><th>Balance</th></tr></thead><tbody>{rows}</tbody></table></div>'
            f'<h3>Requests that didn\'t move money</h3><ul class="tight">{none or "<li>None.</li>"}</ul>'
            f'<h3>Still owed (from the database)</h3><ul class="tight">{owed or "<li>Nothing.</li>"}</ul>'
            f'<h3>Checks</h3><ul class="tight">{checks}</ul></div>')


def fill_desk(page: str, data: dict[str, Any]) -> str:
    if 'id="actual-styles"' not in page:
        page = page.replace("</head>", STYLE + "</head>", 1)
    for t in data["tickets"]:
        tid = t["ticket_id"]
        new = f'<!-- actual:{tid} -->{actual_section(t, "")}<!-- /actual:{tid} -->'
        page, n = re.subn(rf'<!-- actual:{tid} -->.*?<!-- /actual:{tid} -->', lambda m: new, page, flags=re.S)
        if not n:
            page, n = re.subn(rf'<div class="actual-box" id="t{tid}-actual"[^>]*>.*?</div>', lambda m: new, page, flags=re.S)
        if not n:
            raise SystemExit(f"Couldn't find the Actual section for ticket {tid} in desk_tickets.html.")
    new = f'<!-- actual:cash -->{cash_section(data["cash"])}<!-- /actual:cash -->'
    page, n = re.subn(r'<!-- actual:cash -->.*?<!-- /actual:cash -->', lambda m: new, page, flags=re.S)
    if not n:
        page, n = re.subn(r'<div class="actual-box blank-tab" id="cash-content"[^>]*>.*?</div>', lambda m: new, page, flags=re.S)
    if not n:
        raise SystemExit("Couldn't find the Cash tab in desk_tickets.html.")
    return page


def board_page(desk: str, data: dict[str, Any]) -> str:
    """resolved_board.html: same look as desk_tickets.html, one panel per ticket, plus cash."""
    head = desk.split("<body>")[0].replace("<title>Campus Customs Desk Tickets</title>", "<title>Campus Customs Resolved Board</title>")
    cards = ""
    for t in data["tickets"]:
        tone = {"resolved": "ok", "needs_action": "warn"}.get(t["status"], "bad")
        shots = "".join(f'<img class="shot" src="resolved_screenshots/{e(s)}" alt="Ticket {t["ticket_id"]} dashboard screenshot">'
                        for s in t["screenshots"]) or '<p class="lede">No dashboard screenshot was provided for this ticket.</p>'
        cards += (f'<section class="card"><h2>Ticket {t["ticket_id"]} — {e(t["subject"])}</h2>'
                  f'<p class="lede">{e(t["requester"])} · {e(t["type"])}</p>'
                  f'<div class="actual-filled"><div class="outcome {tone}"><b>{e(t["status_label"])}</b></div></div>'
                  f'{actual_section(t, "resolved_screenshots/", shots=False)}'
                  f'<h3>Dashboard screenshots</h3>{shots}</section>')
    cash = data["cash"]
    summary = (f'<div class="facts"><div class="fact"><b>{money(cash["starting_balance"])}</b><span>Starting balance</span></div>'
               f'<div class="fact"><b>−{money(cash["total_moved"])}</b><span>Money that moved</span></div>'
               f'<div class="fact"><b>{money(cash["final_balance"])}</b><span>Final balance (database)</span></div>'
               + "".join(f'<div class="fact {"warn" if t["status"] == "needs_action" else ("stop" if t["status"] == "failed" else "")}">'
                         f'<b>#{t["ticket_id"]}</b><span>{e(t["status_label"])}</span></div>' for t in data["tickets"]) + '</div>')
    return (head + '<body><div class="wrap"><header><h1>Campus Customs Resolved Board</h1>'
            f'<p>Problem 9: the real runs of the three tickets on <code>{e(", ".join(data["source"]["model"]) or "—")}</code>, '
            f'from the audit trail and the working database. Built {e(data["generated_at"])}.</p></header>'
            f'{summary}{cards}<section class="card"><h2>Cash</h2>{cash_section(cash)}</section>'
            '<footer>Built by <code>backend/build_results.py</code> from <code>output/audit_trail.json</code> and the working '
            'database. Screenshots are from the dashboard during the real runs.</footer></div></body></html>\n')


def find_screenshots(folder: Path) -> dict[int, list[str]]:
    out: dict[int, list[str]] = {}
    if folder.is_dir():
        for p in sorted(folder.iterdir()):
            m = re.match(r"ticket[-_ ]?(10[123])", p.name, re.I)
            if m and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
                out.setdefault(int(m.group(1)), []).append(p.name)
    return out


def secret_check(files: list[Path]) -> bool:
    key = os.environ.get(config.PORTKEY_API_KEY_VAR, "").strip()
    if len(key) < 8:
        print("NOTE  No PORTKEY_API_KEY is loaded, so the key check was skipped.")
        return True
    leaked = [f for f in files if f.is_file() and key in f.read_text(encoding="utf-8", errors="ignore")]
    for f in leaked:
        print(f"FAIL  Your Portkey key appears in {f}. Don't commit it.")
    return not leaked


async def main() -> int:
    parser = argparse.ArgumentParser(description="Build the Problem 9 files from the real runs.")
    parser.add_argument("--output-dir", type=Path, default=config.HW5 / "output")
    parser.add_argument("--audit", type=Path, default=config.AUDIT_TRAIL)
    args = parser.parse_args()
    out = args.output_dir
    entries = AuditTrail(args.audit).entries()
    if not any(x["event"] == "run_started" for x in entries):
        print("The audit trail has no agent runs, so there's nothing to build.")
        return 1
    db = await read_database()
    data = build(entries, db, find_screenshots(out / "resolved_screenshots"))

    (out / "resolved_tickets.json").write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    desk_path = out / "desk_tickets.html"
    desk = fill_desk(desk_path.read_text(encoding="utf-8"), data)
    desk_path.write_text(desk, encoding="utf-8")
    (out / "resolved_board.html").write_text(board_page(desk, data), encoding="utf-8")

    print(f"Built from {len(entries)} audit entries.")
    for t in data["tickets"]:
        print(f"  Ticket {t['ticket_id']}: {t['status_label']} · screenshots: {len(t['screenshots'])}")
    c = data["cash"]
    print(f"  Cash: start {money(c['starting_balance'])} ({c['starting_balance_source']}), moved {money(c['total_moved'])}, "
          f"final {money(c['final_balance'])}")
    ok = True
    for name, passed in c["verification"].items():
        if isinstance(passed, bool):
            print(f"{'PASS' if passed else 'FAIL'}  {name}")
            ok &= passed
    ok &= secret_check([args.audit, out / "resolved_tickets.json", desk_path, out / "resolved_board.html"])
    print("\nAll checks passed. Commit and push the files listed in the instructions." if ok
          else "\nSome checks failed. Don't commit yet; send the output above.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
