"""Data models for the Campus Customs vendor desk agent.

Everything the agent reads, looks up and returns has a typed shape here, so a
missing or malformed fact fails loudly instead of slipping into a decision.
"""

from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, Field

Decision = Literal["recommend", "do_not_recommend"]
DocumentKind = Literal["pdf", "html", "email"]
CheckName = Literal["approved_vendor", "price", "lead_time", "min_order"]


# ---------------------------------------------------------------------------
# The shop handbook (parsed from data/shop_handbook.md)
# ---------------------------------------------------------------------------


class ApprovedVendor(BaseModel):
    """A row of handbook section 5, "Approved vendors"."""

    code: str
    name: str
    makes: str
    typical_lead_time: str
    notes: str


class RemovedVendor(BaseModel):
    """A row of handbook section 6, "Removed and pending vendors (never recommend)"."""

    name: str
    status: str


class CatalogueItem(BaseModel):
    """A row of handbook section 9, "Product catalogue"."""

    sku: str
    item: str
    category: str
    max_unit_cost: float
    usual_vendor: str


class PurchasingLimits(BaseModel):
    """The numeric limits in handbook section 4, "Purchasing rules"."""

    max_lead_time_days: int
    max_min_order_units: int


class Handbook(BaseModel):
    """The parts of the shop handbook the purchasing checks need, plus its full text."""

    text: str
    limits: PurchasingLimits
    approved_vendors: list[ApprovedVendor]
    removed_vendors: list[RemovedVendor]
    catalogue: dict[str, CatalogueItem]


# ---------------------------------------------------------------------------
# A vendor document and the facts read from it
# ---------------------------------------------------------------------------


class VendorDocument(BaseModel):
    """A PDF, HTML page or email, reduced to the text a person would actually see."""

    file: str
    kind: DocumentKind
    text: str = Field(description="Visible text only. Hidden HTML, scripts and comments are removed.")
    hidden_passages_removed: list[str] = Field(
        default_factory=list,
        description="Text that was hidden from a human reader and was therefore not trusted.",
    )


class QuoteFields(BaseModel):
    """The quote's labeled fields (e.g. "Unit price: $21.80"), read by code, not by the model.

    A field is None when the document doesn't state it, or states it more than
    once with different values. The handbook says to report those as unknown.
    """

    sku: str | None = None
    item: str | None = None
    unit_price: float | None = None
    lead_time_days: int | None = None
    min_order: int | None = None
    conflicts: list[str] = Field(default_factory=list)


class VendorLookup(BaseModel):
    """What the handbook says about a vendor name."""

    name_searched: str
    status: Literal["approved", "removed_or_pending", "not_listed"]
    handbook_name: str | None = None
    detail: str


class CheckResult(BaseModel):
    """One of the four purchasing checks in handbook section 4."""

    check: CheckName
    passed: bool
    detail: str


class PolicyResult(BaseModel):
    """The handbook's verdict: recommend only if all four checks pass."""

    decision: Decision
    checks: list[CheckResult]

    @property
    def failed(self) -> list[CheckResult]:
        return [c for c in self.checks if not c.passed]


# ---------------------------------------------------------------------------
# What the agent returns
# ---------------------------------------------------------------------------


class VendorReport(BaseModel):
    """The report the handbook asks for in section 13, one per vendor document."""

    vendor: str = Field(description="The vendor's name as it appears in the document.")
    sku: str | None = Field(description="The Campus Customs SKU, e.g. CC-HD-006. Null if not stated.")
    unit_price: float | None = Field(description="Quoted unit price in USD. Null if not stated.")
    lead_time_days: int | None = Field(description="Lead time in days. Null if not stated.")
    min_order: int | None = Field(description="Minimum order in units. Null if not stated.")
    decision: Decision
    reason: str = Field(
        description="One sentence that names the purchasing check that decided it. No links or email addresses."
    )


# ---------------------------------------------------------------------------
# The run log: one record per review (hw6/output/run_log.json)
# ---------------------------------------------------------------------------


class AttemptedAction(BaseModel):
    """A call to one of the two test tools. It is logged only: nothing is sent or paid."""

    tool: Literal["send_email", "approve_payment"]
    arguments: dict
    executed: Literal[False] = False


class ToolActivity(BaseModel):
    """One tool call the model made, in order."""

    step: int = Field(description="Which model request asked for it (1 = the first).")
    tool: str
    arguments: dict
    result: str = Field(description="A short summary of what the tool returned.")


class TokenUsage(BaseModel):
    requests: int = Field(description="How many times the model was called during the review.")
    input_tokens: int = Field(description="All input tokens, including cached ones.")
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    output_tokens: int = 0
    measured: bool = Field(description="True when the counts come from the API; False for an offline estimate.")


class RunCost(BaseModel):
    """Cost in USD at the GPT-6 Luna rates in data/prices.json."""

    model_rates: str
    uncached_input: float
    cache_read: float
    cache_write: float
    output: float
    total: float


class RunRecord(BaseModel):
    """Everything about one review: what was read, what the agent did, what it cost, what it decided."""

    run_id: str
    started_at: str
    duration_seconds: float
    file: str
    document_kind: str
    model: str
    status: Literal["completed", "failed"]
    error: str | None = None
    hidden_passages_removed: int
    tokens: TokenUsage
    cost: RunCost
    tool_activity: list[ToolActivity]
    attempted_actions: list[AttemptedAction] = Field(
        description="Calls to the send_email and approve_payment test tools. Should normally be empty.")
    output_check_retries: int = Field(description="How many times the output check sent the report back.")
    recommendation: VendorReport | None
    checks: list[CheckResult] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Run-time dependencies handed to the agent's tools
# ---------------------------------------------------------------------------


@dataclass
class VendorDeskDeps:
    """What the tools can see during one review. The email and payment tools only add to
    attempted_actions: nothing in here can send email or move money."""

    handbook: Handbook
    document: VendorDocument
    fields: QuoteFields
    tool_log: list[str] = field(default_factory=list)
    attempted_actions: list[AttemptedAction] = field(default_factory=list)
