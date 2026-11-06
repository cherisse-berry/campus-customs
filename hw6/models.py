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


class ReviewResult(BaseModel):
    """A finished review: the agent's report plus the evidence behind it."""

    file: str
    report: VendorReport
    checks: list[CheckResult]
    hidden_passages_removed: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Run-time dependencies handed to the agent's tools
# ---------------------------------------------------------------------------


@dataclass
class VendorDeskDeps:
    """What the tools can see during one review. Nothing here lets the agent pay or send anything."""

    handbook: Handbook
    document: VendorDocument
    fields: QuoteFields
    tool_log: list[str] = field(default_factory=list)
