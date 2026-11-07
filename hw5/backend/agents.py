"""The Campus Customs agent team: Boss, Inventory, Accounting, Facilities and Customer Service.

- Every agent uses one model, gpt-6-luna, through Portkey (see create_portkey_model).
- All shop information comes from the Campus Customs MCP server, which reads the
  working database. Each agent can only see the MCP tools its job needs
  (TOOLS_BY_AGENT). No agent can record a payment: that tool only exists when a
  person runs approve.py.
- Agents talk to each other with the `delegate` tool. Delegation is limited in
  depth and count, can't loop back to an agent already working on the request,
  and shares one usage budget per ticket.
- Every tool call, delegation, answer, decision, approval request, draft message
  and error is added to output/audit_trail.json.
- Agent output is checked in code before it's accepted (check_output): payments
  and discount facts are re-checked against the MCP server, drafts can only go
  to a customer requester and can't mention a discount amount.
"""

from __future__ import annotations

import os
import re
from dataclasses import replace
from typing import Any

from fastmcp import Client
from fastmcp.client.transports import StdioTransport
from openai import AsyncOpenAI
from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.mcp import MCPToolset
from pydantic_ai.models import Model
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.settings import ModelSettings
from pydantic_ai.toolsets import WrapperToolset
from pydantic_ai.toolsets.abstract import ToolsetTool
from pydantic_ai.usage import UsageLimits

import config
from audit import AuditTrail, new_run_id
from models import (
    AGENT_NAMES,
    SPECIALISTS,
    AgentName,
    AgentReport,
    ShopDeps,
    TicketResolution,
)

PROMPTS_DIR = config.BACKEND / "prompts"
SHOP_RULES = (PROMPTS_DIR / "shop_rules.md").read_text(encoding="utf-8")
PROMPTS = {name: (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8") for name in AGENT_NAMES}

# Which MCP tools each agent may use. record_payment is never listed: agents can't pay.
TOOLS_BY_AGENT: dict[AgentName, frozenset[str]] = {
    "boss": frozenset({"list_open_tickets", "get_ticket"}),
    "inventory": frozenset({"get_ticket", "check_stock", "get_vendor_status"}),
    "accounting": frozenset({"get_ticket", "get_payments_due", "check_payment",
                             "price_bulk_order", "get_vendor_status"}),
    "facilities": frozenset({"get_ticket", "get_lease", "get_payments_due"}),
    "customer_service": frozenset({"get_ticket", "check_stock"}),
}

# A percentage, the word "percent", "$X off" or "discounted price/rate" in a customer draft.
DISCOUNT_OFFER = re.compile(
    r"\d+(?:\.\d+)?\s?%|\bpercent\b|\$\s?\d[\d,]*(?:\.\d{1,2})?\s*(?:off|discount)\b|"
    r"\bdiscounted (?:price|rate|total)\b",
    re.IGNORECASE,
)
DOLLAR_AMOUNT = re.compile(r"\$\s?(\d[\d,]*(?:\.\d{1,2})?)")


class AgentsNotConfigured(RuntimeError):
    """PORTKEY_API_KEY is missing."""


# ---------------------------------------------------------------- model

def create_portkey_model() -> OpenAIChatModel:
    """gpt-6-luna through Portkey's AI gateway, authenticated with PORTKEY_API_KEY.

    The key is read from the environment (or hw5/.env) and is only ever sent to Portkey.
    """
    key = os.environ.get(config.PORTKEY_API_KEY_VAR, "").strip()
    if not key:
        raise AgentsNotConfigured(
            f"{config.PORTKEY_API_KEY_VAR} is not set. Add it to hw5/.env "
            "(see hw5/.env.example); never commit it.")
    client = AsyncOpenAI(
        base_url=config.PORTKEY_BASE_URL,
        api_key=key,
        default_headers={"x-portkey-api-key": key},
        timeout=config.MODEL_TIMEOUT_SECONDS,
        max_retries=1,
    )
    return OpenAIChatModel(config.MODEL_NAME, provider=OpenAIProvider(openai_client=client))


def usage_limits() -> UsageLimits:
    return UsageLimits(
        request_limit=config.REQUEST_LIMIT,
        tool_calls_limit=config.TOOL_CALLS_LIMIT,
        total_tokens_limit=config.TOTAL_TOKENS_LIMIT,
    )


# ---------------------------------------------------------------- MCP connection

def mcp_transport(role: str = "agent") -> StdioTransport:
    """Start the Campus Customs MCP server. The Portkey key is not passed to it."""
    env = {k: v for k, v in os.environ.items() if k != config.PORTKEY_API_KEY_VAR}
    env["CAMPUS_MCP_ROLE"] = role
    return StdioTransport(command=str(config.MCP_PYTHON), args=[str(config.MCP_SERVER_SCRIPT)],
                          env=env, cwd=str(config.HW5))


class AuditedToolset(WrapperToolset[ShopDeps]):
    """Records every MCP tool call and result in the audit trail, with the agent that made it."""

    async def call_tool(self, name: str, tool_args: dict[str, Any], ctx: RunContext[ShopDeps],
                        tool: ToolsetTool[ShopDeps]) -> Any:
        d = ctx.deps
        d.audit.record("tool_call", run_id=d.run_id, agent=d.agent, ticket_id=d.ticket_id,
                       tool=name, arguments=tool_args)
        try:
            result = await super().call_tool(name, tool_args, ctx, tool)
        except Exception as e:
            d.audit.record("tool_error", run_id=d.run_id, agent=d.agent, ticket_id=d.ticket_id,
                           tool=name, error=str(e))
            raise
        d.audit.record("tool_result", run_id=d.run_id, agent=d.agent, ticket_id=d.ticket_id,
                       tool=name, result=result)
        return result


# ---------------------------------------------------------------- tools and checks shared by all agents

async def delegate(ctx: RunContext[ShopDeps], to: AgentName, task: str) -> str:
    """Ask a teammate to do a specific task, and get their report back.

    Args:
        to: The teammate: "inventory", "accounting", "facilities" or "customer_service".
        task: A complete, self-contained task. Include the ticket number and the exact
            facts they need (SKU, size, quantity, invoice or lease number).
    """
    d = ctx.deps
    if to == d.agent:
        raise ModelRetry("You can't delegate to yourself. Use your own tools.")
    if to in d.chain:
        raise ModelRetry(f"{to} is already working on this request ({' -> '.join(d.chain)}). "
                         "Answer from what you have instead of passing it back.")
    if d.depth >= config.MAX_DELEGATION_DEPTH:
        raise ModelRetry("The delegation limit for this request has been reached. "
                         "Finish with what you have and list anything missing under unknowns.")
    if d.delegations["count"] >= config.MAX_DELEGATIONS:
        raise ModelRetry("This ticket has used all its delegations. Finish with what you have.")
    d.delegations["count"] += 1

    d.audit.record("delegation", run_id=d.run_id, agent=d.agent, ticket_id=d.ticket_id,
                   to=to, task=task, depth=d.depth + 1)
    child = replace(d, agent=to, depth=d.depth + 1, chain=(*d.chain, to))
    result = await d.team.agents[to].run(task, deps=child, usage=ctx.usage, usage_limits=d.usage_limits)
    report: AgentReport = result.output
    d.audit.record("delegation_result", run_id=d.run_id, agent=to, ticket_id=d.ticket_id,
                   reply_to=d.agent, report=report.model_dump())
    return report.model_dump_json()


def run_context(ctx: RunContext[ShopDeps]) -> str:
    d = ctx.deps
    t = d.ticket["ticket"]
    can_delegate = d.depth < config.MAX_DELEGATION_DEPTH
    others = [a for a in SPECIALISTS if a not in d.chain]
    return (
        "## This run\n\n"
        f"- You are the **{d.agent}** agent.\n"
        f"- Shop date (desk.date_today): **{d.ticket['today']}**.\n"
        f"- Ticket **{t['id']}** ({t['type']}) from **{t['requester']}**: \"{t['subject']}\". "
        f"Requester is a customer: {'yes' if d.requester_is_customer else 'no'}.\n"
        f"- Agents working on this request: {' -> '.join(d.chain)}.\n"
        + (f"- You may delegate to: {', '.join(others) or 'nobody'} "
           f"({config.MAX_DELEGATIONS - d.delegations['count']} delegations left for this ticket).\n"
           if can_delegate else "- You can't delegate further; use your own tools.\n")
    )


async def check_output(ctx: RunContext[ShopDeps], output: AgentReport | TicketResolution
                       ) -> AgentReport | TicketResolution:
    """Check an agent's output against the shop rules before accepting it.

    Facts in payment and discount requests are re-checked against the MCP server.
    Problems are sent back to the agent to fix (up to the retry limit).
    """
    d = ctx.deps
    team = d.team
    problems: list[str] = []

    if isinstance(output, AgentReport):
        output.agent = d.agent
    elif output.ticket_id != d.ticket_id:
        problems.append(f"ticket_id must be {d.ticket_id}.")

    # Payments: must pass the shop's payment rules, and together fit in the cash available.
    total = 0.0
    cash = None
    for p in output.payment_approvals:
        check = await team.lookup("check_payment", {"kind": p.kind, "ref_id": p.ref_id,
                                                    "amount": p.amount, "account": p.account})
        if not check["allowed"]:
            problems.append(f"Payment {p.kind} {p.ref_id} is not allowed: " + " ".join(check["problems"]))
            continue
        # Use the records' values, not the agent's.
        p.payee, p.due_date = check["payee"], check["due_date"]
        p.cash_available, p.cash_after_payment = check["cash_available"], check["cash_after_payment"]
        cash = check["cash_available"]
        total += p.amount
    if cash is not None and round(total, 2) > cash:
        problems.append(f"The payment requests add up to ${total:,.2f}, more than the ${cash:,.2f} "
                        "available. Payments can't exceed available cash.")

    # Discounts: facts must match the records; there is no field for an amount.
    for r in output.discount_approvals:
        if r.ticket_id != d.ticket_id:
            problems.append(f"Discount approval ticket_id must be {d.ticket_id}.")
        try:
            facts = await team.lookup("price_bulk_order", {"sku": r.sku, "size": r.size,
                                                           "qty": r.qty, "discount_percent": 0})
        except Exception as e:
            problems.append(f"Discount approval for {r.sku} {r.size}: {e}")
            continue
        r.list_price, r.unit_cost = facts["list_price"], facts["unit_cost"]
        r.total_at_list_price, r.qty_in_stock = facts["total_at_list_price"], facts["qty_in_stock"]
        r.break_even_discount_percent = facts["break_even_discount_percent"]

    # Customer drafts: only to the customer requester, never sent, no discount amounts or invented prices.
    allowed_amounts = await _list_price_amounts(d)
    for m in output.draft_messages:
        if not d.requester_is_customer:
            problems.append(f"Ticket {d.ticket_id}'s requester ({d.requester}) is not a customer. "
                            "Agents may only draft messages to customers. Remove the draft.")
            continue
        if m.to.strip() != d.requester:
            problems.append(f"A draft must be addressed to the ticket's requester, '{d.requester}'.")
        if any(v.lower() in m.to.lower() for v in d.vendor_names):
            problems.append("Agents can't contact vendors. Remove the draft to the vendor.")
        if m.ticket_id != d.ticket_id:
            problems.append(f"Draft ticket_id must be {d.ticket_id}.")
        text = f"{m.subject}\n{m.body}"
        if DISCOUNT_OFFER.search(text):
            problems.append("A customer draft must not mention a discount amount, percentage or "
                            "discounted price. Discounts need a person's approval and there is no "
                            "discount policy. Say the request is being reviewed instead.")
        for amount in DOLLAR_AMOUNT.findall(text):
            if round(float(amount.replace(",", "")), 2) not in allowed_amounts:
                problems.append(f"The draft mentions ${amount}, which isn't a list price or a total "
                                "at list price for this ticket. Don't quote other prices.")

    if isinstance(output, TicketResolution):
        needs_approval = bool(output.payment_approvals or output.discount_approvals)
        if needs_approval and output.status != "needs_human_approval":
            problems.append("status must be 'needs_human_approval' when anything needs approval.")

    if problems:
        d.audit.record("output_rejected", run_id=d.run_id, agent=d.agent, ticket_id=d.ticket_id,
                       problems=problems)
        raise ModelRetry("Please fix these problems and answer again:\n- " + "\n- ".join(problems))
    return output


async def _list_price_amounts(d: ShopDeps) -> set[float]:
    """Dollar amounts a customer draft may mention: the ticket item's list price and list-price total."""
    t = d.ticket["ticket"]
    if not t.get("sku"):
        return set()
    stock = await d.team.lookup("check_stock", {"sku": t["sku"]})
    price = stock["list_price"] or 0
    qty = t.get("qty") or 1
    return {round(price, 2), round(price * qty, 2)}


# ---------------------------------------------------------------- the team

class Team:
    """The five agents, sharing one connection to the Campus Customs MCP server.

    Use as an async context manager:

        async with Team(create_portkey_model(), AuditTrail()) as team:
            run_id, resolution = await team.handle_ticket(101)
    """

    def __init__(self, model: Model, audit: AuditTrail):
        if isinstance(model, OpenAIChatModel) and model.model_name != config.MODEL_NAME:
            raise ValueError(f"All agents must use {config.MODEL_NAME}, not {model.model_name}.")
        self.model = model
        self.audit = audit
        self.toolset = MCPToolset(Client(mcp_transport("agent")), id="campus-customs")
        self._lookup_client = Client(mcp_transport("agent"))
        self.agents: dict[AgentName, Agent[ShopDeps, Any]] = {n: self._build(n) for n in AGENT_NAMES}

    def _build(self, name: AgentName) -> Agent[ShopDeps, Any]:
        allowed = TOOLS_BY_AGENT[name]
        tools = AuditedToolset(self.toolset.filtered(lambda ctx, td: td.name in allowed))
        agent: Agent[ShopDeps, Any] = Agent(
            self.model,
            name=name,
            deps_type=ShopDeps,
            output_type=TicketResolution if name == "boss" else AgentReport,
            instructions=[SHOP_RULES, PROMPTS[name], run_context],
            toolsets=[tools],
            tools=[delegate],
            model_settings=ModelSettings(max_tokens=config.MAX_OUTPUT_TOKENS),
            retries=2,
        )
        agent.output_validator(check_output)
        return agent

    async def __aenter__(self) -> Team:
        await self.toolset.__aenter__()
        await self._lookup_client.__aenter__()
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self._lookup_client.__aexit__(*exc)
        await self.toolset.__aexit__(*exc)

    async def lookup(self, tool: str, args: dict[str, Any]) -> dict[str, Any]:
        """Call a read-only MCP tool from code (not by an agent), for setup and output checks."""
        if tool == "record_payment":
            raise PermissionError("record_payment is only available to approve.py.")
        return (await self._lookup_client.call_tool(tool, args)).data

    async def handle_ticket(self, ticket_id: int) -> tuple[str, TicketResolution]:
        """Run the Boss (and whoever it delegates to) on one ticket."""
        run_id = new_run_id()
        ticket = await self.lookup("get_ticket", {"ticket_id": ticket_id})
        self.audit.shop_date = ticket["today"]
        vendors = await self.lookup("get_vendor_status", {})
        limits = usage_limits()
        deps = ShopDeps(team=self, audit=self.audit, run_id=run_id, ticket=ticket,
                        vendor_names={v["name"] for v in vendors["vendors"]}, usage_limits=limits)

        model_name = getattr(self.model, "model_name", str(self.model))
        self.audit.record("run_started", run_id=run_id, agent="boss", ticket_id=ticket_id,
                          model=model_name, ticket=ticket["ticket"],
                          limits={"requests": config.REQUEST_LIMIT, "tool_calls": config.TOOL_CALLS_LIMIT,
                                  "total_tokens": config.TOTAL_TOKENS_LIMIT,
                                  "max_output_tokens": config.MAX_OUTPUT_TOKENS,
                                  "delegation_depth": config.MAX_DELEGATION_DEPTH,
                                  "delegations": config.MAX_DELEGATIONS})
        try:
            result = await self.agents["boss"].run(
                f"Handle ticket {ticket_id}.", deps=deps, usage_limits=limits)
        except UsageLimitExceeded as e:
            self.audit.record("usage_limit_exceeded", run_id=run_id, agent="boss", ticket_id=ticket_id,
                              error=str(e))
            self.audit.record("run_finished", run_id=run_id, agent="boss", ticket_id=ticket_id,
                              outcome="stopped_by_usage_limit")
            raise
        except Exception as e:
            self.audit.record("run_error", run_id=run_id, agent="boss", ticket_id=ticket_id,
                              error_type=type(e).__name__, error=str(e))
            self.audit.record("run_finished", run_id=run_id, agent="boss", ticket_id=ticket_id,
                              outcome="error")
            raise

        out: TicketResolution = result.output
        self._record_resolution(run_id, ticket_id, out)
        usage = result.usage
        self.audit.record("run_finished", run_id=run_id, agent="boss", ticket_id=ticket_id,
                          outcome=out.status, delegations=deps.delegations["count"],
                          usage={"requests": usage.requests, "tool_calls": usage.tool_calls,
                                 "input_tokens": usage.input_tokens, "output_tokens": usage.output_tokens})
        return run_id, out

    def _record_resolution(self, run_id: str, ticket_id: int, out: TicketResolution) -> None:
        rec = self.audit.record
        rec("resolution", run_id=run_id, agent="boss", ticket_id=ticket_id, resolution=out.model_dump())
        for decision in out.decisions:
            rec("decision", run_id=run_id, agent="boss", ticket_id=ticket_id, decision=decision)
        for p in out.payment_approvals:
            rec("approval_requested", run_id=run_id, agent="boss", ticket_id=ticket_id,
                approval_id="apr_" + new_run_id()[4:], approval_type="payment", request=p.model_dump())
        for r in out.discount_approvals:
            rec("approval_requested", run_id=run_id, agent="boss", ticket_id=ticket_id,
                approval_id="apr_" + new_run_id()[4:], approval_type="discount", request=r.model_dump())
        for m in out.draft_messages:
            rec("draft_message", run_id=run_id, agent="boss", ticket_id=ticket_id,
                message=m.model_dump(), sent=False)
        for f in out.human_follow_ups:
            rec("human_follow_up", run_id=run_id, agent="boss", ticket_id=ticket_id, follow_up=f.model_dump())
