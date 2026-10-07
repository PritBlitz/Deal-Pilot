import { describe, expect, it } from "vitest";

import { emptyScenario, fieldForLoc, isPristine, initialBuilderState, lineField, toRequest } from "@/lib/draft";

describe("toRequest", () => {
  it("sends what the rep typed without inventing values", () => {
    const scenario = {
      seats: "",
      discountPct: "",
      annualCommitment: true,
      lines: [
        { key: "a", sku: "AGENT-CORE", quantity: "12" },
        { key: "b", sku: "", quantity: "" },
      ],
    };

    expect(toRequest("Acme", scenario)).toEqual({
      customer_name: "Acme",
      seats: null, // not entered → null, so the API says "Enter the number of seats"
      line_items: [
        { sku: "AGENT-CORE", quantity: 12 },
        { sku: "", quantity: null },
      ],
      discount_pct: 0, // empty discount box is an explicit 0
      annual_commitment: true,
    });
  });

  it("passes fractional and non-numeric values through for the API to reject", () => {
    const request = toRequest("", { ...emptyScenario(), seats: "9.5", discountPct: "abc" });
    expect(request.seats).toBe(9.5);
    expect(request.discount_pct).toBe("abc");
  });
});

describe("fieldForLoc", () => {
  const lines = [
    { key: "first", sku: "AGENT-CORE", quantity: "1" },
    { key: "second", sku: "GHOST", quantity: "0" },
  ];

  it("maps API paths to the input the rep sees, by line identity rather than index", () => {
    expect(fieldForLoc(["line_items", 1, "sku"], lines)).toBe(lineField("second", "sku"));
    expect(fieldForLoc(["line_items", 0, "quantity"], lines)).toBe(lineField("first", "quantity"));
    expect(fieldForLoc(["discount_pct"], lines)).toBe("discount_pct");
    expect(fieldForLoc(["line_items"], lines)).toBe("line_items");
  });

  it("falls back to a form-level error for unknown paths", () => {
    expect(fieldForLoc(["mystery"], lines)).toBe("form");
    expect(fieldForLoc(["line_items", 9, "sku"], lines)).toBe("line_items");
  });
});

describe("isPristine", () => {
  it("treats an untouched form as nothing worth recovering", () => {
    expect(isPristine(initialBuilderState())).toBe(true);
    expect(isPristine({ ...initialBuilderState(), customerName: "Acme" })).toBe(false);
  });
});
