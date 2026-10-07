"""Business rules for quotes. This module is the single source of truth.

Everything here is pure: plain inputs in, plain results out, no I/O and no
framework types. The API layer converts requests into ``QuoteInput`` and the
results back into response models.

Money rules (see DECISIONS.md):
* All arithmetic uses ``Decimal``.
* Line totals and the subtotal are exact (integer quantity × catalog price).
* The discount amount is the only value that can have fractional cents, so it is
  rounded once, to the cent, half-up. ``total`` is derived from that rounded
  amount, so ``subtotal - discount_amount == total`` always holds exactly.
* Approval thresholds are compared against the rounded values that the customer sees.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from decimal import ROUND_HALF_UP, Decimal
from enum import StrEnum

from .catalog import Catalog, DiscountRule

CENT = Decimal("0.01")
HUNDRED = Decimal(100)

APPROVAL_DISCOUNT_ABOVE_PCT = Decimal(15)
APPROVAL_TOTAL_ABOVE = Decimal(25_000)
APPROVAL_ANNUAL_DISCOUNT_ABOVE_PCT = Decimal(10)

MAX_CUSTOMER_NAME_LENGTH = 120
MAX_QUANTITY = 100_000
DISCOUNT_DECIMAL_PLACES = 2


class ApprovalReason(StrEnum):
    DISCOUNT_ABOVE_15_PERCENT = "discount_above_15_percent"
    TOTAL_ABOVE_25000 = "total_above_25000"
    ANNUAL_COMMITMENT_DISCOUNT_ABOVE_10_PERCENT = "annual_commitment_discount_above_10_percent"


# ---------------------------------------------------------------------------
# Inputs and outputs
# ---------------------------------------------------------------------------

Loc = tuple[str | int, ...]


@dataclass(frozen=True)
class LineInput:
    sku: str
    quantity: int | None


@dataclass(frozen=True)
class QuoteInput:
    customer_name: str
    seats: int | None
    line_items: tuple[LineInput, ...]
    discount_pct: Decimal
    annual_commitment: bool


@dataclass(frozen=True)
class Issue:
    """A single, user-facing validation problem. ``loc`` points at the offending field."""

    loc: Loc
    code: str
    message: str


@dataclass(frozen=True)
class PricedLine:
    sku: str
    name: str
    unit_price: Decimal
    quantity: int
    line_total: Decimal


@dataclass(frozen=True)
class Calculation:
    seats: int
    tier: str
    max_discount_pct: Decimal
    lines: tuple[PricedLine, ...]
    subtotal: Decimal
    discount_pct: Decimal
    discount_amount: Decimal
    total: Decimal
    annual_commitment: bool
    approval_required: bool
    approval_reasons: tuple[ApprovalReason, ...]
    explanation: tuple[str, ...]


class QuoteInvalid(Exception):
    def __init__(self, issues: list[Issue]):
        super().__init__(f"{len(issues)} validation issue(s)")
        self.issues = issues


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def validate_quote(quote: QuoteInput, catalog: Catalog, *, require_customer: bool) -> list[Issue]:
    """Collect every problem at once so the rep can fix them in one pass.

    ``require_customer`` is False for live previews (pricing does not depend on
    the name) and True when saving.
    """
    issues: list[Issue] = []

    if require_customer:
        name = quote.customer_name.strip()
        if not name:
            issues.append(Issue(("customer_name",), "customer_name_required", "Enter the customer's name."))
        elif len(name) > MAX_CUSTOMER_NAME_LENGTH:
            issues.append(
                Issue(
                    ("customer_name",),
                    "customer_name_too_long",
                    f"Customer name must be {MAX_CUSTOMER_NAME_LENGTH} characters or fewer.",
                )
            )

    tier = _validate_seats(quote.seats, catalog, issues)
    _validate_lines(quote.line_items, catalog, issues)
    _validate_discount(quote.discount_pct, tier, catalog, issues)
    return issues


def _validate_seats(seats: int | None, catalog: Catalog, issues: list[Issue]) -> DiscountRule | None:
    if seats is None:
        issues.append(Issue(("seats",), "seats_required", "Enter the number of seats."))
        return None
    if seats < 1:
        issues.append(Issue(("seats",), "seats_not_positive", "Seats must be at least 1."))
        return None
    tier = catalog.tier_for(seats)
    if tier is None:
        issues.append(
            Issue(
                ("seats",),
                "seats_out_of_range",
                f"{seats:,} seats is outside every pricing tier (maximum {catalog.max_seats:,}).",
            )
        )
    return tier


def _validate_lines(lines: tuple[LineInput, ...], catalog: Catalog, issues: list[Issue]) -> None:
    if not lines:
        issues.append(Issue(("line_items",), "no_line_items", "Add at least one product."))
        return

    seen: dict[str, int] = {}
    for index, line in enumerate(lines):
        sku = line.sku.strip()
        if not sku:
            issues.append(Issue(("line_items", index, "sku"), "sku_required", "Choose a product."))
        elif catalog.product(sku) is None:
            issues.append(
                Issue(("line_items", index, "sku"), "unknown_sku", f"“{sku}” is not a product in the catalog.")
            )
        elif sku in seen:
            product = catalog.product(sku)
            assert product is not None
            issues.append(
                Issue(
                    ("line_items", index, "sku"),
                    "duplicate_sku",
                    f"{product.name} is already on line {seen[sku] + 1}. Change that line's quantity instead.",
                )
            )
        else:
            seen[sku] = index

        if line.quantity is None:
            issues.append(Issue(("line_items", index, "quantity"), "quantity_required", "Enter a quantity."))
        elif line.quantity < 1:
            issues.append(
                Issue(("line_items", index, "quantity"), "quantity_not_positive", "Quantity must be at least 1.")
            )
        elif line.quantity > MAX_QUANTITY:
            issues.append(
                Issue(
                    ("line_items", index, "quantity"),
                    "quantity_too_large",
                    f"Quantity must be {MAX_QUANTITY:,} or fewer.",
                )
            )


def _validate_discount(
    discount_pct: Decimal, tier: DiscountRule | None, catalog: Catalog, issues: list[Issue]
) -> None:
    if not discount_pct.is_finite():
        issues.append(Issue(("discount_pct",), "discount_invalid", "Discount must be a number."))
        return
    if discount_pct < 0:
        issues.append(Issue(("discount_pct",), "discount_negative", "Discount cannot be negative."))
        return
    exponent = discount_pct.as_tuple().exponent
    assert isinstance(exponent, int)  # finite Decimals always have an int exponent
    if -exponent > DISCOUNT_DECIMAL_PLACES:
        issues.append(
            Issue(
                ("discount_pct",),
                "discount_too_precise",
                f"Discount can have at most {DISCOUNT_DECIMAL_PLACES} decimal places.",
            )
        )
        return
    if tier is not None and discount_pct > tier.max_discount_pct:
        issues.append(
            Issue(
                ("discount_pct",),
                "discount_above_tier_max",
                f"{tier_label(tier.code)} tier ({_seat_range(tier, catalog)}) allows at most "
                f"{format_pct(tier.max_discount_pct)} discount.",
            )
        )


# ---------------------------------------------------------------------------
# Calculation
# ---------------------------------------------------------------------------


def calculate(quote: QuoteInput, catalog: Catalog, *, require_customer: bool = False) -> Calculation:
    """Validate then price a quote. Raises ``QuoteInvalid`` with every issue found."""
    issues = validate_quote(quote, catalog, require_customer=require_customer)
    if issues:
        raise QuoteInvalid(issues)

    # Validation guarantees these are present and well-formed.
    assert quote.seats is not None
    tier = catalog.tier_for(quote.seats)
    assert tier is not None

    lines = []
    for line in quote.line_items:
        product = catalog.product(line.sku.strip())
        assert product is not None and line.quantity is not None
        lines.append(
            PricedLine(
                sku=product.sku,
                name=product.name,
                unit_price=product.unit_price,
                quantity=line.quantity,
                line_total=product.unit_price * line.quantity,
            )
        )

    subtotal = sum((line.line_total for line in lines), Decimal(0))
    discount_amount = (subtotal * quote.discount_pct / HUNDRED).quantize(CENT, rounding=ROUND_HALF_UP)
    total = subtotal - discount_amount
    reasons = approval_reasons(quote.discount_pct, total, quote.annual_commitment)

    calc = Calculation(
        seats=quote.seats,
        tier=tier.code,
        max_discount_pct=tier.max_discount_pct,
        lines=tuple(lines),
        subtotal=subtotal.quantize(CENT),
        discount_pct=quote.discount_pct,
        discount_amount=discount_amount,
        total=total.quantize(CENT),
        annual_commitment=quote.annual_commitment,
        approval_required=bool(reasons),
        approval_reasons=reasons,
        explanation=(),
    )
    return _with_explanation(calc)


def approval_reasons(discount_pct: Decimal, total: Decimal, annual_commitment: bool) -> tuple[ApprovalReason, ...]:
    reasons: list[ApprovalReason] = []
    if discount_pct > APPROVAL_DISCOUNT_ABOVE_PCT:
        reasons.append(ApprovalReason.DISCOUNT_ABOVE_15_PERCENT)
    if total > APPROVAL_TOTAL_ABOVE:
        reasons.append(ApprovalReason.TOTAL_ABOVE_25000)
    if annual_commitment and discount_pct > APPROVAL_ANNUAL_DISCOUNT_ABOVE_PCT:
        reasons.append(ApprovalReason.ANNUAL_COMMITMENT_DISCOUNT_ABOVE_10_PERCENT)
    return tuple(reasons)


# ---------------------------------------------------------------------------
# Explanation ("Explain pricing")
# ---------------------------------------------------------------------------

_REASON_TEXT = {
    ApprovalReason.DISCOUNT_ABOVE_15_PERCENT: f"discount is above {APPROVAL_DISCOUNT_ABOVE_PCT}%",
    ApprovalReason.TOTAL_ABOVE_25000: f"total is above ${APPROVAL_TOTAL_ABOVE:,}",
    ApprovalReason.ANNUAL_COMMITMENT_DISCOUNT_ABOVE_10_PERCENT: (
        f"annual commitment is selected and discount is above {APPROVAL_ANNUAL_DISCOUNT_ABOVE_PCT}%"
    ),
}


def approval_reason_text(reason: ApprovalReason) -> str:
    return _REASON_TEXT[reason]


def _with_explanation(calc: Calculation) -> Calculation:
    seat_word = "seat" if calc.seats == 1 else "seats"
    lines = [
        f"{calc.seats:,} {seat_word} → {tier_label(calc.tier)} tier → maximum discount {format_pct(calc.max_discount_pct)}.",
    ]
    if calc.discount_pct == 0:
        lines.append(f"Subtotal {format_money(calc.subtotal)} → no discount → final {format_money(calc.total)}.")
    else:
        lines.append(
            f"Subtotal {format_money(calc.subtotal)} → {format_pct(calc.discount_pct)} discount "
            f"({format_money(calc.discount_amount)}) → final {format_money(calc.total)}."
        )
    if calc.approval_required:
        lines.append(f"Approval required because {_join([approval_reason_text(r) for r in calc.approval_reasons])}.")
    else:
        lines.append(
            f"No approval needed: discount is at most {APPROVAL_DISCOUNT_ABOVE_PCT}%, "
            f"total is at most ${APPROVAL_TOTAL_ABOVE:,}"
            + (f", and the annual-commitment discount is at most {APPROVAL_ANNUAL_DISCOUNT_ABOVE_PCT}%." if calc.annual_commitment else ".")
        )
    return replace(calc, explanation=tuple(lines))


# ---------------------------------------------------------------------------
# Formatting helpers (deterministic, locale-independent)
# ---------------------------------------------------------------------------


def tier_label(code: str) -> str:
    return code.capitalize()


def format_money(amount: Decimal) -> str:
    if amount == amount.to_integral_value():
        return f"${amount:,.0f}"
    return f"${amount:,.2f}"


def format_pct(pct: Decimal) -> str:
    text = f"{pct.normalize():f}"
    return f"{text}%"


def _seat_range(rule: DiscountRule, catalog: Catalog) -> str:
    # The top tier's max_seats is a sentinel (99999) rather than a real limit, so show it as open-ended.
    if rule.max_seats == catalog.max_seats:
        return f"{rule.min_seats}+ seats"
    return f"{rule.min_seats}–{rule.max_seats} seats"


def _join(parts: list[str]) -> str:
    if len(parts) <= 1:
        return "".join(parts)
    return ", ".join(parts[:-1]) + " and " + parts[-1]
