import type { ApprovalReason, DiscountRule, QuoteStatus, TierCode } from "./types";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const wholeMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Formats an API-provided amount. Cents are always shown so totals visibly reconcile. */
export const formatMoney = (amount: number) => money.format(amount);

/** For prices and thresholds where cents would only be noise ($120, $25,000). */
export const formatWholeMoney = (amount: number) => wholeMoney.format(amount);

export const formatPct = (pct: number) => `${Number(pct.toFixed(2))}%`;

export const formatCount = (n: number) => n.toLocaleString("en-US");

export const tierLabel = (code: TierCode) => code.charAt(0) + code.slice(1).toLowerCase();

export function seatRange(rule: DiscountRule, isTopTier: boolean): string {
  return isTopTier ? `${rule.min_seats}+ seats` : `${rule.min_seats}–${rule.max_seats} seats`;
}

export const REASON_LABEL: Record<ApprovalReason, string> = {
  discount_above_15_percent: "Discount is above 15%",
  total_above_25000: "Total is above $25,000",
  annual_commitment_discount_above_10_percent: "Annual commitment with a discount above 10%",
};

export const STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const dateOnly = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatDate = (iso: string) => dateOnly.format(new Date(iso));
