/**
 * Wire types for the Deal Desk API. These mirror `backend/app/models.py`.
 *
 * Money and percentages arrive as JSON numbers that the API has already
 * rounded. The UI only *displays* them — it never adds, multiplies or compares
 * them to make a business decision.
 */

export type TierCode = "STARTER" | "GROWTH" | "ENTERPRISE" | (string & {});

export type QuoteStatus = "draft" | "submitted" | "approved" | "rejected";

/** A rep builds and submits quotes; an admin (approver) approves or rejects them. */
export type Role = "rep" | "admin";

export interface Transition {
  status: QuoteStatus;
  /** The role allowed to make this move. */
  role: Role;
}

export type ApprovalReason =
  | "discount_above_15_percent"
  | "total_above_25000"
  | "annual_commitment_discount_above_10_percent";

export interface Product {
  sku: string;
  name: string;
  unit_price: number;
}

export interface DiscountRule {
  code: TierCode;
  min_seats: number;
  max_seats: number;
  max_discount_pct: number;
}

export interface ApprovalRules {
  discount_above_pct: number;
  total_above: number;
  annual_commitment_discount_above_pct: number;
}

export interface Catalog {
  currency: string;
  products: Product[];
  discount_rules: DiscountRule[];
  approval_rules: ApprovalRules;
}

/** Body for POST /api/quotes/calculate and POST /api/quotes. */
export interface QuoteDraftRequest {
  customer_name: string;
  /** `null` = not entered yet. Non-integers are sent as-is so the API can explain the problem. */
  seats: number | string | null;
  line_items: { sku: string; quantity: number | string | null }[];
  /** Always sent explicitly; 0 means "no discount". */
  discount_pct: number | string;
  annual_commitment: boolean;
}

export interface PricedLine {
  sku: string;
  name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
}

export interface Calculation {
  seats: number;
  tier: TierCode;
  max_discount_pct: number;
  lines: PricedLine[];
  subtotal: number;
  discount_pct: number;
  discount_amount: number;
  total: number;
  annual_commitment: boolean;
  approval_required: boolean;
  approval_reasons: ApprovalReason[];
  explanation: string[];
}

export interface StatusEvent {
  from_status: QuoteStatus | null;
  to_status: QuoteStatus;
  at: string;
  note: string | null;
  actor: Role;
}

export interface QuoteWarning {
  code: "product_removed" | "price_changed";
  sku: string;
  message: string;
}

export interface Quote {
  id: string;
  status: QuoteStatus;
  customer_name: string;
  created_at: string;
  updated_at: string;
  calculation: Calculation;
  history: StatusEvent[];
  allowed_transitions: Transition[];
  warnings: QuoteWarning[];
}

export interface QuoteSummary {
  id: string;
  status: QuoteStatus;
  customer_name: string;
  created_at: string;
  updated_at: string;
  seats: number;
  tier: TierCode;
  product_count: number;
  discount_pct: number;
  total: number;
  approval_required: boolean;
  approval_reasons: ApprovalReason[];
}

/** Path to the offending field, e.g. `["line_items", 0, "quantity"]`. */
export type IssueLoc = (string | number)[];

export interface Issue {
  loc: IssueLoc;
  code: string;
  message: string;
}

export interface ErrorBody {
  code: string;
  message: string;
  issues: Issue[];
}
