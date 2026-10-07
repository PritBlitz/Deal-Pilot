"""Business-rule tests against the real catalog shipped with the assessment."""

from decimal import Decimal
from pathlib import Path

import pytest

from app.catalog import load_catalog
from app.pricing import (
    ApprovalReason,
    LineInput,
    QuoteInput,
    QuoteInvalid,
    calculate,
    validate_quote,
)

CATALOG = load_catalog(Path(__file__).resolve().parents[2] / "data" / "catalog.json")


def quote(
    *,
    seats: int | None = 10,
    lines: list[tuple[str, int | None]] | None = None,
    discount: str = "0",
    annual: bool = False,
    customer: str = "Acme",
) -> QuoteInput:
    return QuoteInput(
        customer_name=customer,
        seats=seats,
        line_items=tuple(LineInput(sku, qty) for sku, qty in (lines if lines is not None else [("AGENT-CORE", 10)])),
        discount_pct=Decimal(discount),
        annual_commitment=annual,
    )


def codes(q: QuoteInput, *, require_customer: bool = True) -> list[str]:
    return [issue.code for issue in validate_quote(q, CATALOG, require_customer=require_customer)]


# -- arithmetic ---------------------------------------------------------------


def test_matches_readme_example():
    # 50 seats, $20,000 subtotal, 20% → $16,000, approval because discount > 15%.
    calc = calculate(quote(seats=50, lines=[("AGENT-CORE", 100), ("AGENT-ANALYTICS", 100)], discount="20"), CATALOG)
    assert calc.tier == "ENTERPRISE"
    assert calc.subtotal == Decimal("20000")
    assert calc.discount_amount == Decimal("4000")
    assert calc.total == Decimal("16000")
    assert calc.approval_reasons == (ApprovalReason.DISCOUNT_ABOVE_15_PERCENT,)
    assert calc.explanation == (
        "50 seats → Enterprise tier → maximum discount 30%.",
        "Subtotal $20,000 → 20% discount ($4,000) → final $16,000.",
        "Approval required because discount is above 15%.",
    )


def test_discount_amount_rounds_half_up_to_the_cent_and_totals_reconcile():
    # $150 × 3 = $450 at 0.11% = $0.495 → $0.50 (half-up), not $0.49 (banker's rounding / truncation).
    calc = calculate(quote(seats=10, lines=[("AGENT-AUTOMATE", 3)], discount="0.11"), CATALOG)
    assert calc.discount_amount == Decimal("0.50")
    assert calc.total == Decimal("449.50")
    assert calc.subtotal - calc.discount_amount == calc.total


# -- tiers (boundaries) -------------------------------------------------------


@pytest.mark.parametrize(
    ("seats", "tier", "max_pct"),
    [(1, "STARTER", 10), (9, "STARTER", 10), (10, "GROWTH", 20), (49, "GROWTH", 20), (50, "ENTERPRISE", 30)],
)
def test_tier_boundaries(seats, tier, max_pct):
    calc = calculate(quote(seats=seats), CATALOG)
    assert (calc.tier, calc.max_discount_pct) == (tier, Decimal(max_pct))


def test_discount_cap_follows_tier_at_9_vs_10_seats():
    assert codes(quote(seats=9, discount="15")) == ["discount_above_tier_max"]
    assert codes(quote(seats=10, discount="15")) == []
    # Exactly the maximum is allowed.
    assert codes(quote(seats=9, discount="10")) == []


# -- approval (boundaries) ----------------------------------------------------


def test_discount_of_exactly_15_does_not_need_approval_but_15_01_does():
    assert calculate(quote(seats=10, discount="15"), CATALOG).approval_required is False
    assert calculate(quote(seats=10, discount="15.01"), CATALOG).approval_reasons == (
        ApprovalReason.DISCOUNT_ABOVE_15_PERCENT,
    )


def test_total_of_exactly_25000_does_not_need_approval_but_one_cent_more_does():
    # 10 × Implementation ($2,500) = $25,000.
    at_limit = calculate(quote(seats=10, lines=[("ONBOARDING", 10)]), CATALOG)
    assert at_limit.total == Decimal("25000") and at_limit.approval_required is False

    over = calculate(quote(seats=10, lines=[("ONBOARDING", 10), ("AGENT-ANALYTICS", 1)]), CATALOG)
    assert over.approval_reasons == (ApprovalReason.TOTAL_ABOVE_25000,)


def test_total_threshold_uses_the_discounted_total():
    # $30,000 subtotal, 20% off → $24,000: discount triggers approval, total does not.
    calc = calculate(quote(seats=50, lines=[("AGENT-CORE", 250)], discount="20"), CATALOG)
    assert calc.total == Decimal("24000")
    assert calc.approval_reasons == (ApprovalReason.DISCOUNT_ABOVE_15_PERCENT,)


def test_annual_commitment_only_matters_above_10_percent():
    assert calculate(quote(discount="10", annual=True), CATALOG).approval_required is False
    calc = calculate(quote(discount="12", annual=True), CATALOG)
    assert calc.approval_reasons == (ApprovalReason.ANNUAL_COMMITMENT_DISCOUNT_ABOVE_10_PERCENT,)
    # Without the commitment the same 12% is fine.
    assert calculate(quote(discount="12", annual=False), CATALOG).approval_required is False


def test_annual_commitment_does_not_change_price():
    with_commit = calculate(quote(discount="5", annual=True), CATALOG)
    without = calculate(quote(discount="5", annual=False), CATALOG)
    assert with_commit.total == without.total


def test_all_reasons_reported_together():
    calc = calculate(quote(seats=50, lines=[("ONBOARDING", 20)], discount="16", annual=True), CATALOG)
    assert set(calc.approval_reasons) == set(ApprovalReason)


# -- validation ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("q", "expected"),
    [
        (quote(lines=[]), ["no_line_items"]),
        (quote(lines=[("AGENT-CORE", 0)]), ["quantity_not_positive"]),
        (quote(lines=[("AGENT-CORE", -3)]), ["quantity_not_positive"]),
        (quote(lines=[("AGENT-CORE", None)]), ["quantity_required"]),
        (quote(lines=[("NOPE", 1)]), ["unknown_sku"]),
        (quote(lines=[("AGENT-CORE", 1), ("AGENT-CORE", 2)]), ["duplicate_sku"]),
        (quote(seats=0), ["seats_not_positive"]),
        (quote(seats=None), ["seats_required"]),
        (quote(seats=100_000), ["seats_out_of_range"]),
        (quote(discount="-1"), ["discount_negative"]),
        (quote(discount="10.123"), ["discount_too_precise"]),
        (quote(customer="   "), ["customer_name_required"]),
    ],
)
def test_validation_codes(q, expected):
    assert codes(q) == expected


def test_all_problems_are_reported_at_once_with_field_locations():
    issues = validate_quote(
        quote(seats=5, lines=[("AGENT-CORE", 0), ("BOGUS", 1)], discount="25", customer=""),
        CATALOG,
        require_customer=True,
    )
    assert [(i.loc, i.code) for i in issues] == [
        (("customer_name",), "customer_name_required"),
        (("line_items", 0, "quantity"), "quantity_not_positive"),
        (("line_items", 1, "sku"), "unknown_sku"),
        (("discount_pct",), "discount_above_tier_max"),
    ]
    assert issues[-1].message == "Starter tier (1–9 seats) allows at most 10% discount."


def test_preview_does_not_require_customer_name_but_calculate_rejects_invalid_quotes():
    assert codes(quote(customer=""), require_customer=False) == []
    with pytest.raises(QuoteInvalid):
        calculate(quote(seats=0), CATALOG)
