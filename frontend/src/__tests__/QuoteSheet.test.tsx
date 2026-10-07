import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuoteSheet } from "@/components/builder/QuoteSheet";
import type { CalculationState } from "@/lib/hooks";
import type { Calculation } from "@/lib/types";

afterEach(cleanup);

const calculation: Calculation = {
  seats: 50,
  tier: "ENTERPRISE",
  max_discount_pct: 30,
  lines: [
    { sku: "AGENT-CORE", name: "Agent Core", unit_price: 120, quantity: 100, line_total: 12000 },
    { sku: "AGENT-ANALYTICS", name: "Agent Analytics", unit_price: 80, quantity: 100, line_total: 8000 },
  ],
  subtotal: 20000,
  discount_pct: 20,
  discount_amount: 4000,
  total: 16000,
  annual_commitment: false,
  approval_required: true,
  approval_reasons: ["discount_above_15_percent"],
  explanation: [
    "50 seats → Enterprise tier → maximum discount 30%.",
    "Subtotal $20,000 → 20% discount ($4,000) → final $16,000.",
    "Approval required because discount is above 15%.",
  ],
};

function renderSheet(calc: Partial<CalculationState>, onFocusIssue = vi.fn()) {
  render(
    <QuoteSheet
      customerName="Northwind"
      calc={{ status: "ok", result: null, issues: [], error: null, retry: vi.fn(), ...calc }}
      onFocusIssue={onFocusIssue}
      footer={null}
    />,
  );
  return { onFocusIssue };
}

describe("QuoteSheet", () => {
  it("shows the API's figures, tier and why approval is needed", async () => {
    renderSheet({ status: "ok", result: calculation });

    expect(screen.getByTestId("quote-total").textContent).toBe("$16,000.00");
    expect(screen.getByText("−$4,000.00")).toBeTruthy();
    expect(screen.getByText("Enterprise")).toBeTruthy();
    expect(screen.getByText("Needs approval")).toBeTruthy();
    expect(screen.getByText("Discount is above 15%")).toBeTruthy();

    // The deterministic explanation is one click away.
    await userEvent.click(screen.getByRole("button", { name: "Explain pricing" }));
    expect(screen.getByText("Subtotal $20,000 → 20% discount ($4,000) → final $16,000.")).toBeTruthy();
  });

  it("replaces stale numbers with a fix-list when the draft is invalid", async () => {
    const issue = {
      loc: ["discount_pct"],
      code: "discount_above_tier_max",
      message: "Starter tier (1–9 seats) allows at most 10% discount.",
    };
    const { onFocusIssue } = renderSheet({ status: "invalid", result: calculation, issues: [issue] });

    expect(screen.queryByTestId("quote-total")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: issue.message }));
    expect(onFocusIssue).toHaveBeenCalledWith(issue);
  });
});
