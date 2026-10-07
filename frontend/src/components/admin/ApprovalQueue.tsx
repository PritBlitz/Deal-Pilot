"use client";

import Link from "next/link";

import { Notice, StatusBadge } from "@/components/ui";
import { signOutApprover } from "@/lib/admin";
import { api } from "@/lib/api";
import { formatCount, formatDate, formatDateTime, formatMoney, formatPct, REASON_LABEL, tierLabel } from "@/lib/format";
import { useLoad } from "@/lib/hooks";
import type { QuoteSummary } from "@/lib/types";

import styles from "./admin.module.css";

export function ApprovalQueue() {
  const [quotes, reload] = useLoad<QuoteSummary[]>((signal) => api.listQuotes(signal), []);

  const all = quotes.status === "ready" ? quotes.data : [];
  // First in, first out: the quote that has waited longest is at the top.
  const waiting = all
    .filter((q) => q.status === "submitted")
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  const decided = all
    .filter((q) => q.status === "approved" || q.status === "rejected")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 8);
  const flagged = waiting.filter((q) => q.approval_required).length;

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p className="eyebrow">Deal desk · signed in as approver</p>
          <h1 className={`display ${styles.title}`}>Approvals</h1>
        </div>
        <button type="button" className="btn btn-quiet" onClick={signOutApprover}>
          Sign out
        </button>
      </header>

      {quotes.status === "error" && (
        <Notice
          tone="error"
          title="Couldn't load the queue"
          action={
            <button type="button" className="btn" onClick={reload}>
              Try again
            </button>
          }
        >
          {quotes.error.message}
        </Notice>
      )}
      {quotes.status === "loading" && <p className="muted">Loading the queue…</p>}

      {quotes.status === "ready" && (
        <>
          <dl className={styles.stats}>
            <div>
              <dt>Awaiting decision</dt>
              <dd className="display">{formatCount(waiting.length)}</dd>
            </div>
            <div>
              <dt>Outside policy</dt>
              <dd className="display" data-tone={flagged > 0 ? "amber" : undefined}>
                {formatCount(flagged)}
              </dd>
            </div>
            <div>
              <dt>Waiting longest</dt>
              <dd className={styles.statText}>{waiting[0] ? `since ${formatDateTime(waiting[0].updated_at)}` : "—"}</dd>
            </div>
          </dl>

          <section aria-labelledby="queue-h" className={styles.queue}>
            <h2 id="queue-h" className={styles.h2}>
              Queue
            </h2>
            {waiting.length === 0 ? (
              <div className={styles.empty}>
                <p className={`display ${styles.emptyTitle}`}>Nothing is waiting.</p>
                <p className="muted">
                  Quotes appear here when a rep submits them. Decided quotes are listed below.
                </p>
              </div>
            ) : (
              <ol className={styles.rows}>
                {waiting.map((q) => (
                  <li key={q.id} className={styles.row}>
                    <div className={styles.rowWho}>
                      <span className={`num ${styles.rowId}`}>{q.id}</span>
                      <Link href={`/admin/quotes/${q.id}`} className={`display ${styles.rowName}`}>
                        {q.customer_name}
                      </Link>
                      <span className={styles.rowMeta}>
                        <span className="num">{formatCount(q.seats)}</span> seats · {tierLabel(q.tier)} ·{" "}
                        {q.product_count} {q.product_count === 1 ? "product" : "products"} · submitted{" "}
                        {formatDate(q.updated_at)}
                      </span>
                    </div>
                    <div className={styles.rowWhy}>
                      {q.approval_required ? (
                        <ul className={styles.reasonList}>
                          {q.approval_reasons.map((r) => (
                            <li key={r}>{REASON_LABEL[r]}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className={styles.inPolicy}>Within policy</span>
                      )}
                    </div>
                    <div className={styles.rowMoney}>
                      <span className={`display ${styles.rowTotal}`}>{formatMoney(q.total)}</span>
                      <span className="num muted">{formatPct(q.discount_pct)} discount</span>
                    </div>
                    <Link href={`/admin/quotes/${q.id}`} className="btn btn-primary">
                      Review
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {decided.length > 0 && (
            <section aria-labelledby="decided-h" className={styles.decided}>
              <h2 id="decided-h" className="eyebrow">
                Recently decided
              </h2>
              <table className={styles.decidedTable}>
                <tbody>
                  {decided.map((q) => (
                    <tr key={q.id}>
                      <td className="num muted">{q.id}</td>
                      <td>
                        <Link href={`/admin/quotes/${q.id}`}>{q.customer_name}</Link>
                      </td>
                      <td className={`num ${styles.right}`}>{formatMoney(q.total)}</td>
                      <td>
                        <StatusBadge status={q.status} />
                      </td>
                      <td className={`num muted ${styles.right}`}>{formatDate(q.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </main>
  );
}
