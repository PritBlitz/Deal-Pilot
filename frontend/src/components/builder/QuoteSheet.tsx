"use client";

import { useState } from "react";

import { ApprovalVerdict, Notice } from "@/components/ui";
import type { CalculationState } from "@/lib/hooks";
import { formatCount, formatMoney, formatPct, formatWholeMoney, tierLabel } from "@/lib/format";
import type { Issue } from "@/lib/types";

import styles from "./sheet.module.css";

interface Props {
  customerName: string;
  scenarioLabel?: string;
  calc: CalculationState & { retry: () => void };
  /** Moves focus to the input an issue refers to. */
  onFocusIssue: (issue: Issue) => void;
  footer: React.ReactNode;
}

export function QuoteSheet({ customerName, scenarioLabel, calc, onFocusIssue, footer }: Props) {
  const [explain, setExplain] = useState(false);
  const { status, result } = calc;
  const showNumbers = result !== null && (status === "ok" || status === "pending");

  return (
    <article className={styles.sheet} aria-label="Quote preview" aria-busy={status === "pending"}>
      <header className={styles.head}>
        <div className={styles.headRow}>
          <span className="eyebrow">Quote preview{scenarioLabel ? ` · ${scenarioLabel}` : ""}</span>
          <LiveIndicator status={status} />
        </div>
        <h2 className={`display ${styles.customer}`} data-empty={!customerName.trim()}>
          {customerName.trim() || "Customer name"}
        </h2>
        {showNumbers && (
          <p className={styles.meta}>
            <span className={styles.tierTag}>{tierLabel(result.tier)}</span>
            <span className="num">{formatCount(result.seats)} seats</span>
            <span aria-hidden>·</span>
            <span>max discount {formatPct(result.max_discount_pct)}</span>
            {result.annual_commitment && (
              <>
                <span aria-hidden>·</span>
                <span>annual commitment</span>
              </>
            )}
          </p>
        )}
      </header>

      {status === "error" && calc.error && (
        <div className={styles.pad}>
          <Notice
            tone="error"
            title="Pricing is unavailable"
            action={
              <button type="button" className="btn" onClick={calc.retry}>
                Try again
              </button>
            }
          >
            {calc.error.message}
          </Notice>
        </div>
      )}

      {status === "invalid" && (
        <div className={styles.todo}>
          <p className={styles.todoTitle}>To price this quote</p>
          <ol className={styles.todoList}>
            {calc.issues.map((issue) => (
              <li key={issue.code + issue.loc.join(".")}>
                <button type="button" onClick={() => onFocusIssue(issue)}>
                  {issue.message}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {status === "pending" && result === null && (
        <div className={styles.placeholder}>
          <span className={styles.pulse} aria-hidden />
          Pricing…
        </div>
      )}

      {showNumbers && (
        <div className={styles.body} data-stale={status === "pending"}>
          <table className={styles.lines}>
            <caption className="visually-hidden">Line items</caption>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col" className={styles.right}>
                  Qty × price
                </th>
                <th scope="col" className={styles.right}>
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {result.lines.map((line) => (
                <tr key={line.sku}>
                  <th scope="row">
                    {line.name}
                    <span className={styles.sku}>{line.sku}</span>
                  </th>
                  <td className={`num ${styles.right} ${styles.qty}`}>
                    {formatCount(line.quantity)} × {formatWholeMoney(line.unit_price)}
                  </td>
                  <td className={`num ${styles.right}`}>{formatMoney(line.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className={styles.totals}>
            <div>
              <dt>Subtotal</dt>
              <dd className="num">{formatMoney(result.subtotal)}</dd>
            </div>
            <div>
              <dt>Discount {formatPct(result.discount_pct)}</dt>
              <dd className="num">−{formatMoney(result.discount_amount)}</dd>
            </div>
            <div className={styles.grand}>
              <dt>Total</dt>
              <dd className="display" data-testid="quote-total">
                {formatMoney(result.total)}
              </dd>
            </div>
          </dl>

          <div className={styles.pad}>
            <ApprovalVerdict required={result.approval_required} reasons={result.approval_reasons} />
          </div>

          <div className={styles.explain}>
            <button
              type="button"
              className={styles.explainToggle}
              aria-expanded={explain}
              onClick={() => setExplain((v) => !v)}
            >
              {explain ? "Hide explanation" : "Explain pricing"}
            </button>
            {explain && (
              <ol className={styles.explanation}>
                {result.explanation.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}

      <footer className={styles.foot}>{footer}</footer>
    </article>
  );
}

function LiveIndicator({ status }: { status: CalculationState["status"] }) {
  const label = { pending: "Updating", ok: "Priced by API", invalid: "Needs input", error: "Offline" }[status];
  return (
    <span className={styles.live} data-status={status} aria-live="polite">
      <span className={styles.liveDot} aria-hidden />
      {label}
    </span>
  );
}
