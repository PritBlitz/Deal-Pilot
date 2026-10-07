import type { Issue, IssueLoc, Quote, QuoteDraftRequest } from "./types";

/**
 * Form state for the quote builder.
 *
 * Inputs are kept as the strings the rep typed. Converting to numbers happens
 * only when building the API request, so "12." or "" never get silently
 * coerced into something the rep didn't mean — the API validates and explains.
 */
export interface LineDraft {
  /** Stable React key; survives reordering/removal unlike the array index. */
  key: string;
  sku: string;
  quantity: string;
}

export interface ScenarioDraft {
  seats: string;
  lines: LineDraft[];
  discountPct: string;
  annualCommitment: boolean;
}

export interface BuilderState {
  customerName: string;
  /** One scenario, or two when the rep is comparing. */
  scenarios: ScenarioDraft[];
  active: number;
}

let keySeed = 0;
export const newLineKey = () => `line-${Date.now().toString(36)}-${(keySeed++).toString(36)}`;

export const emptyLine = (): LineDraft => ({ key: newLineKey(), sku: "", quantity: "1" });

export const emptyScenario = (): ScenarioDraft => ({
  seats: "",
  lines: [emptyLine()],
  discountPct: "0",
  annualCommitment: false,
});

export const initialBuilderState = (): BuilderState => ({
  customerName: "",
  scenarios: [emptyScenario()],
  active: 0,
});

export function cloneScenario(scenario: ScenarioDraft): ScenarioDraft {
  return { ...scenario, lines: scenario.lines.map((line) => ({ ...line, key: newLineKey() })) };
}

/** "" → null (not entered); numeric text → number; anything else passes through for the API to reject. */
export function parseNumberField(raw: string): number | string | null {
  const text = raw.trim();
  if (text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : text;
}

export function toRequest(customerName: string, scenario: ScenarioDraft): QuoteDraftRequest {
  return {
    customer_name: customerName,
    seats: parseNumberField(scenario.seats),
    line_items: scenario.lines.map((line) => ({ sku: line.sku, quantity: parseNumberField(line.quantity) })),
    // An empty discount box means "no discount", sent explicitly as 0.
    discount_pct: parseNumberField(scenario.discountPct) ?? 0,
    annual_commitment: scenario.annualCommitment,
  };
}

/** Builder state from a saved quote, for "Start a new quote from this one". */
export function fromQuote(quote: Quote): BuilderState {
  const calc = quote.calculation;
  return {
    customerName: quote.customer_name,
    active: 0,
    scenarios: [
      {
        seats: String(calc.seats),
        lines: calc.lines.map((line) => ({ key: newLineKey(), sku: line.sku, quantity: String(line.quantity) })),
        discountPct: String(calc.discount_pct),
        annualCommitment: calc.annual_commitment,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Mapping API issues onto form fields
// ---------------------------------------------------------------------------

export type FieldId =
  | "customer_name"
  | "seats"
  | "discount_pct"
  | "annual_commitment"
  | "line_items"
  | `line:${string}:sku`
  | `line:${string}:quantity`
  | "form";

export const lineField = (key: string, field: "sku" | "quantity"): FieldId => `line:${key}:${field}`;

/** Translate an API location like `["line_items", 2, "quantity"]` into the field the rep sees. */
export function fieldForLoc(loc: IssueLoc, lines: LineDraft[]): FieldId {
  const [head, index, field] = loc;
  if (head === "line_items") {
    if (typeof index === "number" && (field === "sku" || field === "quantity")) {
      const line = lines[index];
      return line ? lineField(line.key, field) : "line_items";
    }
    return "line_items";
  }
  if (head === "customer_name" || head === "seats" || head === "discount_pct" || head === "annual_commitment") {
    return head;
  }
  return "form";
}

export function issuesByField(issues: Issue[], lines: LineDraft[]): Map<FieldId, Issue[]> {
  const map = new Map<FieldId, Issue[]>();
  for (const issue of issues) {
    const id = fieldForLoc(issue.loc, lines);
    map.set(id, [...(map.get(id) ?? []), issue]);
  }
  return map;
}

/** DOM id for a field, so an issue in the summary can focus the input it refers to. */
export const domIdFor = (field: FieldId, scenarioIndex: number) =>
  `f-${scenarioIndex}-${field.replace(/[^a-z0-9-]/gi, "-")}`;

// ---------------------------------------------------------------------------
// Draft recovery (localStorage)
// ---------------------------------------------------------------------------

const STORAGE_KEY = "deal-desk:draft:v1";

interface StoredDraft {
  savedAt: string;
  state: BuilderState;
}

function isBuilderState(value: unknown): value is BuilderState {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<BuilderState>;
  return (
    typeof v.customerName === "string" &&
    typeof v.active === "number" &&
    Array.isArray(v.scenarios) &&
    v.scenarios.length > 0 &&
    v.scenarios.every(
      (s) =>
        typeof s?.seats === "string" &&
        typeof s.discountPct === "string" &&
        typeof s.annualCommitment === "boolean" &&
        Array.isArray(s.lines) &&
        s.lines.every((l) => typeof l?.key === "string" && typeof l.sku === "string" && typeof l.quantity === "string"),
    )
  );
}

export function loadDraft(): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    if (typeof parsed.savedAt !== "string" || !isBuilderState(parsed.state)) return null;
    const state = parsed.state;
    return { savedAt: parsed.savedAt, state: { ...state, active: Math.min(state.active, state.scenarios.length - 1) } };
  } catch {
    return null; // storage blocked or corrupt: start fresh rather than crash
  }
}

export function saveDraft(state: BuilderState): void {
  try {
    const stored: StoredDraft = { savedAt: new Date().toISOString(), state };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Quota exceeded or storage disabled: recovery is a convenience, not a requirement.
  }
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** True when the form holds nothing worth recovering. */
export function isPristine(state: BuilderState): boolean {
  return (
    state.customerName.trim() === "" &&
    state.scenarios.length === 1 &&
    state.scenarios[0].seats.trim() === "" &&
    state.scenarios[0].lines.every((line) => line.sku === "") &&
    (state.scenarios[0].discountPct.trim() === "" || state.scenarios[0].discountPct.trim() === "0") &&
    !state.scenarios[0].annualCommitment
  );
}
