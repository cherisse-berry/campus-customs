"""Data types shared by the Campus Customs agents.

The agents return these structured types instead of free text, so their output
can be checked in code (for example, a draft message can never be marked as
sent, and a discount approval request has no field for a discount amount).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal

from pydantic import BaseModel, Field

if TYPE_CHECKING:
    from pydantic_ai.usage import UsageLimits

    from audit import AuditTrail
    from agents import Team

AgentName = Literal["boss", "inventory", "accounting", "facilities", "customer_service"]
AGENT_NAMES: tuple[AgentName, ...] = ("boss", "inventory", "accounting", "facilities", "customer_service")
SPECIALISTS: tuple[AgentName, ...] = ("inventory", "accounting", "facilities", "customer_service")


# ---------------------------------------------------------------- run context

@dataclass
class ShopDeps:
    """Context shared by every agent working on one ticket.

    `ticket` and `vendor_names` are looked up by code (not by an agent) before
    the run starts, so the output checks can rely on them.
    """

    team: Team
    audit: AuditTrail
    run_id: str
    ticket: dict[str, Any]
    vendor_names: set[str]
    usage_limits: UsageLimits
    agent: AgentName = "boss"
    depth: int = 0
    chain: tuple[AgentName, ...] = ("boss",)
    delegations: dict[str, int] = field(default_factory=lambda: {"count": 0})

    @property
    def ticket_id(self) -> int:
        return int(self.ticket["ticket"]["id"])

    @property
    def requester(self) -> str:
        return str(self.ticket["ticket"]["requester"])

    @property
    def requester_is_customer(self) -> bool:
        return bool(self.ticket["requester_is_customer"])


# ---------------------------------------------------------------- outputs

class Finding(BaseModel):
    """A fact an agent found, and the tool(s) it came from."""

    fact: str = Field(description="One fact, stated plainly, exactly as the tools reported it.")
    sources: list[str] = Field(description="The MCP tool(s) or teammate(s) the fact came from.")


class PaymentApprovalRequest(BaseModel):
    """A payment that needs a person's approval before it can be recorded."""

    kind: Literal["invoice", "rent"]
    ref_id: int = Field(description="The invoice number (kind 'invoice') or lease number (kind 'rent').")
    payee: str
    amount: float = Field(gt=0, description="The amount on file for this invoice or lease.")
    account: str = "checking"
    due_date: str
    reason: str = Field(description="Why this should be paid, and why now, based on the records.")
    cash_available: float = Field(description="Cash available before this payment, from check_payment.")
    cash_after_payment: float = Field(ge=0, description="Cash left after this payment, from check_payment.")
    warnings: list[str] = Field([], description="Filled in from check_payment (for example a partial or "
                                "extra payment), so the approver sees them. Not set by agents.")


class DiscountOption(BaseModel):
    """One discount level the agents evaluated with price_bulk_order.

    The figures are replaced with price_bulk_order's results before the
    output is accepted, so they always match the records.
    """

    discount_percent: float = Field(ge=0, lt=100)
    unit_price: float = 0
    total_price: float = 0
    total_profit: float = 0
    below_cost: bool = False


class DiscountApprovalRequest(BaseModel):
    """A customer's discount request, passed to a person to decide.

    The agents may evaluate several discount levels and recommend one for this
    request, with their reasons. The shop has no discount policy, so the
    recommendation isn't a policy, nothing is offered to the customer, and the
    final decision is a person's (in approve.py).
    """

    ticket_id: int
    customer: str
    sku: str
    size: str
    qty: int = Field(gt=0)
    list_price: float
    unit_cost: float
    total_at_list_price: float
    qty_in_stock: int
    break_even_discount_percent: float = Field(
        description="The discount at which the price equals unit cost (zero profit). A limit, not a recommendation.")
    facts_for_decision: list[str] = Field(description="Facts the person deciding should know, from the tools.")
    options_evaluated: list[DiscountOption] = Field(
        [], description="Discount levels evaluated with price_bulk_order, including 0 (list price).")
    recommended_discount_percent: float | None = Field(
        None, description="The agents' recommendation for this request only: one of options_evaluated, "
                          "or None to recommend no discount or no recommendation. A person decides.")
    recommendation_reason: str | None = Field(
        None, description="Why, based on facts from the tools. Required when recommending.")


class DraftMessage(BaseModel):
    """A draft message to a customer. Drafts are never sent by the agents."""

    ticket_id: int
    to: str = Field(description="The customer: the ticket's requester, exactly as written in the ticket.")
    subject: str
    body: str
    sent: Literal[False] = Field(False, description="Always false: agents cannot send messages.")


class HumanFollowUp(BaseModel):
    """Something only a person can do (for example, contact a vendor or send a reviewed message)."""

    action: str
    reason: str


class AgentReport(BaseModel):
    """What a specialist agent (Inventory, Accounting, Facilities, Customer Service) returns."""

    agent: AgentName
    summary: str
    findings: list[Finding] = []
    decisions: list[str] = Field([], description="Decisions or recommendations, each with its reason.")
    payment_approvals: list[PaymentApprovalRequest] = []
    discount_approvals: list[DiscountApprovalRequest] = []
    draft_messages: list[DraftMessage] = []
    human_follow_ups: list[HumanFollowUp] = []
    unknowns: list[str] = Field([], description="Things the tools couldn't tell you.")


class TicketResolution(BaseModel):
    """What the Boss returns for one ticket: the plan handed to the shop's staff."""

    ticket_id: int
    status: Literal["needs_human_approval", "ready_for_review"]
    summary: str
    agents_consulted: list[AgentName] = []
    findings: list[Finding] = []
    decisions: list[str] = []
    payment_approvals: list[PaymentApprovalRequest] = []
    discount_approvals: list[DiscountApprovalRequest] = []
    draft_messages: list[DraftMessage] = []
    human_follow_ups: list[HumanFollowUp] = []
    unknowns: list[str] = []


# ---------------------------------------------------------------- API request bodies (main.py)

class RunRequest(BaseModel):
    """Optional body for POST /api/tickets/{ticket_id}/run."""

    requested_by: str | None = Field(None, description="Who started the run, for the audit trail.")


class ApprovalDecisionRequest(BaseModel):
    """Body for POST /api/approvals/{approval_id}."""

    decision: Literal["approve", "reject"]
    decided_by: str = Field(description="The person deciding. Recorded as the approver.")
    confirmed_warnings: list[str] = Field(
        [], description="For a payment: every warning the person saw and confirms, exactly as "
                        "GET /api/approvals returned them. Required whenever there are warnings.")
    discount_percent: float | None = Field(
        None, ge=0, lt=100, description="For a discount approval: the discount the person chose.")
    note: str = ""


class ResetRequest(BaseModel):
    """Body for POST /api/reset."""

    confirm: Literal["RESET"] = Field(description='Must be "RESET".')
    requested_by: str = Field(min_length=1, description="Who reset the database, for the audit trail.")
