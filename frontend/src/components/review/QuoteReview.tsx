"use client";

import Link from "next/link";
import { useState } from "react";

import { ApprovalVerdict, Notice, StatusBadge } from "@/components/ui";
import { signOutApprover, useApproverPasscode } from "@/lib/admin";
import { api, ApiError } from "@/lib/api";
import {
  formatCount,
  formatDate,
  formatDateTime,
  formatMoney,
  formatPct,
  formatWholeMoney,
  STATUS_LABEL,
  tierLabel,
} from "@/lib/format";
import { useLoad } from "@/lib/hooks";
import type { Quote, QuoteStatus } from "@/lib/types";

import styles from "./review.module.css";

const ACTION_LABEL: Record<QuoteStatus, string> = {
  draft: "Move back to draft",
  submitted: "Submit for approval",
  approved: "Approve",
  rejected: "Reject",
};

/**
 * - `rep`: the seller's view. Can submit a draft; approve/reject are not offered.
 * - `admin`: the approver's view (behind AdminGate). Decides on submitted quotes.
 * The API enforces the same split, so hiding buttons is a convenience, not the guard.
 */
export function QuoteReview({ id, mode = "rep" }: { id: string; mode?: "rep" | "admin" }) {
  const [state, reload, setState] = useLoad<Quote>((signal) => api.getQuote(id, signal), [id]);
  const passcode = useApproverPasscode();
  const isAdmin = mode === "admin";
  const home = isAdmin ? { href: "/admin", label: "Approvals" } : { href: "/quotes", label: "All quotes" };
  const [explain, setExplain] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<QuoteStatus | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (state.status === "loading") {
    return <p className={styles.loading}>Loading {id}…</p>;
  }

  if (state.status === "error") {
    const notFound = state.error.status === 404;
    return (
      <main className={styles.page}>
        <Notice
          tone="error"
          title={notFound ? `Quote ${id} doesn't exist` : `Couldn't load ${id}`}
          action={
            notFound ? (
              <Link href={home.href} className="btn">
                {home.label}
              </Link>
            ) : (
              <button type="button" className="btn" onClick={reload}>
                Try again
              </button>
            )
          }
        >
          {state.error.message}
        </Notice>
      </main>
    );
  }

  const quote = state.data;
  const calc = quote.calculation;

  /** Optimistic: show the new status at once, roll back if the API refuses. */
  async function transition(target: QuoteStatus) {
    const previous = quote;
    setPending(target);
    setActionError(null);
    setState({
      status: "ready",
      data: {
        ...quote,
        status: target,
        allowed_transitions: [],
        history: [
          ...quote.history,
          {
            from_status: quote.status,
            to_status: target,
            at: new Date().toISOString(),
            note: note.trim() || null,
            actor: isAdmin ? "admin" : "rep",
          },
        ],
      },
    });
    try {
      const updated = await api.changeStatus(quote.id, target, note, isAdmin ? (passcode ?? undefined) : undefined);
      setState({ status: "ready", data: updated });
      setNote("");
    } catch (cause) {
      setState({ status: "ready", data: previous });
      if (cause instanceof ApiError && cause.status === 401) signOutApprover();
      setActionError(
        cause instanceof ApiError ? cause.message : "Something went wrong; the status was not changed.",
      );
    } finally {
      setPending(null);
    }
  }

  const final = quote.status === "approved" || quote.status === "rejected";
  // Approvers can make any move; reps only the ones meant for them.
  const actions = quote.allowed_transitions.filter((t) => isAdmin || t.role === "rep").map((t) => t.status);
  const waitingOnApprover = !isAdmin && quote.status === "submitted";

  return (
    <main className={styles.page}>
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <Link href={home.href}>{home.label}</Link>
        <span aria-hidden>/</span>
        <span className="num">{quote.id}</span>
      </nav>

      {/* ---- Who, how much, verdict: the first three seconds ------------------ */}
      <header className={styles.hero}>
        <div className={styles.heroMain}>
          <div className={styles.heroMeta}>
            <StatusBadge status={quote.status} />
            <span className="eyebrow">Created {formatDate(quote.created_at)}</span>
          </div>
          <h1 className={`display ${styles.customer}`}>{quote.customer_name}</h1>
          <p className={styles.facts}>
            <span className={styles.tierTag}>{tierLabel(calc.tier)}</span>
            <span>
              <span className="num">{formatCount(calc.seats)}</span> seats
            </span>
            <span aria-hidden>·</span>
            <span>
              {calc.lines.length} {calc.lines.length === 1 ? "product" : "products"}
            </span>
            <span aria-hidden>·</span>
            <span>{calc.annual_commitment ? "Annual commitment" : "No annual commitment"}</span>
          </p>
        </div>
        <div className={styles.heroTotal}>
          <p className="eyebrow">Total</p>
          <p className={`display ${styles.total}`}>{formatMoney(calc.total)}</p>
          <p className={styles.totalSub}>
            {calc.discount_pct > 0 ? (
              <>
                <span className="num">{formatPct(calc.discount_pct)}</span> off{" "}
                <span className="num">{formatMoney(calc.subtotal)}</span>
              </>
            ) : (
              "No discount"
            )}
          </p>
          {final && (
            <span className={styles.stamp} data-status={quote.status} aria-hidden>
              {STATUS_LABEL[quote.status]}
            </span>
          )}
        </div>
      </header>

      <div className={styles.grid}>
        <div className={styles.main}>
          <ApprovalVerdict
            required={calc.approval_required}
            reasons={calc.approval_reasons}
            size="large"
            title={
              calc.approval_required && final
                ? `Approval was required, and it was ${quote.status}`
                : undefined
            }
          />

          {quote.warnings.length > 0 && (
            <Notice tone="warning" title="The catalog has changed since this quote was saved">
              <ul className={styles.warnings}>
                {quote.warnings.map((w) => (
                  <li key={w.sku + w.code}>{w.message}</li>
                ))}
              </ul>
            </Notice>
          )}

          <section aria-labelledby="items-h">
            <h2 id="items-h" className={styles.h2}>
              What&rsquo;s included
            </h2>
            <table className={styles.items}>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col" className={styles.right}>
                    Qty
                  </th>
                  <th scope="col" className={styles.right}>
                    Unit price
                  </th>
                  <th scope="col" className={styles.right}>
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {calc.lines.map((line) => (
                  <tr key={line.sku}>
                    <th scope="row">
                      {line.name}
                      <span className={styles.sku}>{line.sku}</span>
                    </th>
                    <td className={`num ${styles.right}`}>{formatCount(line.quantity)}</td>
                    <td className={`num ${styles.right}`}>{formatWholeMoney(line.unit_price)}</td>
                    <td className={`num ${styles.right}`}>{formatMoney(line.line_total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={3}>
                    Subtotal
                  </th>
                  <td className={`num ${styles.right}`}>{formatMoney(calc.subtotal)}</td>
                </tr>
                <tr>
                  <th scope="row" colSpan={3}>
                    Discount {formatPct(calc.discount_pct)}{" "}
                    <span className={styles.cap}>
                      of {formatPct(calc.max_discount_pct)} allowed for {tierLabel(calc.tier)}
                    </span>
                  </th>
                  <td className={`num ${styles.right}`}>−{formatMoney(calc.discount_amount)}</td>
                </tr>
                <tr className={styles.grand}>
                  <th scope="row" colSpan={3}>
                    Total
                  </th>
                  <td className={`num ${styles.right}`}>{formatMoney(calc.total)}</td>
                </tr>
              </tfoot>
            </table>

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
                  {calc.explanation.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        </div>

        {/* ---- Decision panel ------------------------------------------------- */}
        <aside className={styles.side} aria-labelledby="decision-h">
          <section className={styles.panel}>
            <h2 id="decision-h" className={styles.panelTitle}>
              {quote.status === "draft" && "Ready to submit?"}
              {quote.status === "submitted" && (isAdmin ? "Your decision" : "With an approver")}
              {final && `${STATUS_LABEL[quote.status]}. This is final.`}
            </h2>

            {waitingOnApprover && (
              <>
                <p className={styles.panelHint}>
                  Submitted for review. An approver will approve or reject it from the Approvals queue.
                  You&rsquo;ll see the decision here.
                </p>
                <Link href={`/admin/quotes/${encodeURIComponent(quote.id)}`} className="btn">
                  I&rsquo;m an approver: open in Approvals
                </Link>
              </>
            )}

            {actions.length > 0 && (
              <>
                {quote.status === "submitted" && (
                  <>
                    <label htmlFor="decision-note" className={styles.noteLabel}>
                      Note <span className="muted">(optional, saved to history)</span>
                    </label>
                    <textarea
                      id="decision-note"
                      className={`input ${styles.note}`}
                      rows={3}
                      maxLength={500}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="e.g. Approved by VP Sales, multi-year deal"
                    />
                  </>
                )}
                <div className={styles.actions}>
                  {actions.map((target) => (
                    <button
                      key={target}
                      type="button"
                      disabled={pending !== null}
                      onClick={() => transition(target)}
                      className={`btn ${
                        target === "approved" ? "btn-approve" : target === "rejected" ? "btn-reject" : "btn-primary"
                      }`}
                    >
                      {ACTION_LABEL[target]}
                    </button>
                  ))}
                </div>
                {quote.status === "draft" && (
                  <p className={styles.panelHint}>
                    {calc.approval_required
                      ? "This quote needs approval. Submitting sends it to the Approvals queue."
                      : "Within policy. An approver will still confirm it before it goes out."}
                  </p>
                )}
              </>
            )}

            {pending && <p className={styles.panelHint}>Saving…</p>}
            {actionError && (
              <div className={styles.actionError}>
                <Notice tone="error" title="Status not changed">
                  {actionError}
                </Notice>
              </div>
            )}

            {final && !isAdmin && (
              <Link href={`/quotes/new?from=${encodeURIComponent(quote.id)}`} className="btn">
                Start a new quote from this one
              </Link>
            )}
          </section>

          <section className={styles.history} aria-labelledby="history-h">
            <h2 id="history-h" className="eyebrow">
              History
            </h2>
            <ol>
              {[...quote.history].reverse().map((event, i) => (
                <li key={`${event.at}-${i}`}>
                  <span className={styles.historyWhat}>
                    {event.from_status === null ? "Created as draft" : `Moved to ${STATUS_LABEL[event.to_status].toLowerCase()}`}
                  </span>
                  <time className={styles.historyWhen} dateTime={event.at}>
                    {formatDateTime(event.at)} · {event.actor === "admin" ? "approver" : "rep"}
                  </time>
                  {event.note && <q className={styles.historyNote}>{event.note}</q>}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </main>
  );
}
