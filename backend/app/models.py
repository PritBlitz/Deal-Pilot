"""HTTP request/response schemas.

These are deliberately separate from the domain types in ``pricing.py``: they
describe the wire format, the domain module describes the rules.

Money and percentages are ``Decimal`` in Python and serialised as JSON numbers.
Every money value is already rounded to the cent, and those always round-trip
exactly through an IEEE double (and back via ``Decimal(str(x))``). Clients must
display these numbers, never re-derive them.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer

from .pricing import ApprovalReason, Calculation, LineInput, QuoteInput

Money = Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]
Percent = Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]

QuoteStatus = Literal["draft", "submitted", "approved", "rejected"]
Role = Literal["rep", "admin"]
TierCode = str


class _Strict(BaseModel):
    # Unknown fields are rejected so a typo like "discount" (vs "discount_pct") fails loudly
    # instead of silently pricing a quote at 0%.
    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------------------
# Requests
# ---------------------------------------------------------------------------


class LineItemIn(_Strict):
    sku: str = ""
    quantity: int | None = None


class QuoteDraftIn(_Strict):
    """A quote as the rep is editing it.

    Fields are optional at the schema level so that business validation can
    report *all* problems with friendly messages instead of failing on the first
    missing key. ``discount_pct`` defaults to 0 but is always echoed back explicitly.
    """

    customer_name: str = ""
    seats: int | None = None
    line_items: list[LineItemIn] = Field(default_factory=list)
    discount_pct: Decimal = Decimal(0)
    annual_commitment: bool = False

    def to_domain(self) -> QuoteInput:
        return QuoteInput(
            customer_name=self.customer_name,
            seats=self.seats,
            line_items=tuple(LineInput(sku=item.sku, quantity=item.quantity) for item in self.line_items),
            discount_pct=self.discount_pct,
            annual_commitment=self.annual_commitment,
        )


class StatusChangeIn(_Strict):
    status: QuoteStatus
    note: str | None = Field(default=None, max_length=500)


class AdminSessionIn(_Strict):
    passcode: str


# ---------------------------------------------------------------------------
# Responses
# ---------------------------------------------------------------------------


class ProductOut(BaseModel):
    sku: str
    name: str
    unit_price: Money


class DiscountRuleOut(BaseModel):
    code: TierCode
    min_seats: int
    max_seats: int
    max_discount_pct: Percent


class ApprovalRulesOut(BaseModel):
    discount_above_pct: Percent
    total_above: Money
    annual_commitment_discount_above_pct: Percent


class CatalogOut(BaseModel):
    currency: str
    products: list[ProductOut]
    discount_rules: list[DiscountRuleOut]
    approval_rules: ApprovalRulesOut


class PricedLineOut(BaseModel):
    sku: str
    name: str
    unit_price: Money
    quantity: int
    line_total: Money


class CalculationOut(BaseModel):
    seats: int
    tier: TierCode
    max_discount_pct: Percent
    lines: list[PricedLineOut]
    subtotal: Money
    discount_pct: Percent
    discount_amount: Money
    total: Money
    annual_commitment: bool
    approval_required: bool
    approval_reasons: list[ApprovalReason]
    explanation: list[str]

    @classmethod
    def from_domain(cls, calc: Calculation) -> CalculationOut:
        return cls(
            seats=calc.seats,
            tier=calc.tier,
            max_discount_pct=calc.max_discount_pct,
            lines=[PricedLineOut(**line.__dict__) for line in calc.lines],
            subtotal=calc.subtotal,
            discount_pct=calc.discount_pct,
            discount_amount=calc.discount_amount,
            total=calc.total,
            annual_commitment=calc.annual_commitment,
            approval_required=calc.approval_required,
            approval_reasons=list(calc.approval_reasons),
            explanation=list(calc.explanation),
        )


class StatusEventOut(BaseModel):
    from_status: QuoteStatus | None
    to_status: QuoteStatus
    at: datetime
    note: str | None = None
    # Who made the change. Records saved before roles existed default to "rep".
    actor: Role = "rep"


class TransitionOut(BaseModel):
    """A move the quote can make next, and the role allowed to make it."""

    status: QuoteStatus
    role: Role


class QuoteWarningOut(BaseModel):
    code: Literal["product_removed", "price_changed"]
    sku: str
    message: str


class QuoteOut(BaseModel):
    """A saved quote. ``calculation`` is the snapshot taken when it was saved."""

    id: str
    status: QuoteStatus
    customer_name: str
    created_at: datetime
    updated_at: datetime
    calculation: CalculationOut
    history: list[StatusEventOut]
    allowed_transitions: list[TransitionOut]
    warnings: list[QuoteWarningOut]


class QuoteSummaryOut(BaseModel):
    id: str
    status: QuoteStatus
    customer_name: str
    created_at: datetime
    updated_at: datetime
    seats: int
    tier: TierCode
    product_count: int
    discount_pct: Percent
    total: Money
    approval_required: bool
    approval_reasons: list[ApprovalReason]


class IssueOut(BaseModel):
    loc: list[str | int]
    code: str
    message: str


class ErrorBody(BaseModel):
    code: str
    message: str
    issues: list[IssueOut] = Field(default_factory=list)


class ErrorOut(BaseModel):
    error: ErrorBody
