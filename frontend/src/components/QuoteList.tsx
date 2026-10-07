"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { StatusBadge, Notice } from "@/components/ui";
import { api } from "@/lib/api";
import { formatCount, formatDate, formatMoney, formatPct, STATUS_LABEL, tierLabel } from "@/lib/format";
import { useLoad } from "@/lib/hooks";
import type { QuoteStatus, QuoteSummary } from "@/lib/types";

import styles from "./QuoteList.module.css";

const FILTERS: ("all" | QuoteStatus)[] = ["all", "draft", "submitted", "approved", "rejected"];

export function QuoteList() {
  const router = useRouter();
  const [quotes, reload] = useLoad<QuoteSummary[]>((signal) => api.listQuotes(signal), []);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");

  const all = quotes.status === "ready" ? quotes.data : [];
  const shown = filter === "all" ? all : all.filter((q) => q.status === filter);
  const awaiting = all.filter((q) => q.status === "submitted").length;

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p className="eyebrow">Deal desk · every saved quote</p>
          <h1 className={`display ${styles.title}`}>Quotes</h1>
        </div>
        {quotes.status === "ready" && all.length > 0 && (
          <p className={styles.summary}>
            <span className="num">{formatCount(all.length)}</span> saved
            {awaiting > 0 && (
              <>
                {" · "}
                <button type="button" className={styles.inlineLink} onClick={() => setFilter("submitted")}>
                  <span className="num">{awaiting}</span> awaiting review
                </button>
              </>
            )}
          </p>
        )}
      </header>

      {quotes.status === "error" && (
        <Notice
          tone="error"
          title="Couldn't load quotes"
          action={
            <button type="button" className="btn" onClick={reload}>
              Try again
            </button>
          }
        >
          {quotes.error.message}
        </Notice>
      )}

      {quotes.status === "loading" && <p className={styles.loading}>Loading quotes…</p>}

      {quotes.status === "ready" && all.length === 0 && (
        <section className={styles.empty}>
          <p className={`display ${styles.emptyTitle}`}>No quotes yet.</p>
          <p className="muted">
            Build a quote, see it priced live by the pricing API, then save it as a draft for review.
          </p>
          <Link href="/quotes/new" className="btn btn-primary">
            Create the first quote
          </Link>
        </section>
      )}

      {quotes.status === "ready" && all.length > 0 && (
        <>
          <div className={styles.filters} role="group" aria-label="Filter by status">
            {FILTERS.map((f) => {
              const count = f === "all" ? all.length : all.filter((q) => q.status === f).length;
              return (
                <button
                  key={f}
                  type="button"
                  className={styles.filter}
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                >
                  {f === "all" ? "All" : STATUS_LABEL[f]}
                  <span className="num">{count}</span>
                </button>
              );
            })}
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Quote</th>
                  <th scope="col">Customer</th>
                  <th scope="col" className={styles.hideSm}>
                    Seats
                  </th>
                  <th scope="col" className={`${styles.right} ${styles.hideSm}`}>
                    Discount
                  </th>
                  <th scope="col" className={styles.right}>
                    Total
                  </th>
                  <th scope="col" className={styles.hideMd}>
                    Approval
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col" className={`${styles.right} ${styles.hideMd}`}>
                    Created
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((q) => (
                  <tr key={q.id} onClick={() => router.push(`/quotes/${q.id}`)}>
                    <td className="num">
                      <Link href={`/quotes/${q.id}`} className={styles.idLink}>
                        {q.id}
                      </Link>
                    </td>
                    <td className={styles.customer}>
                      {q.customer_name}
                      <span className={styles.subtle}>
                        {q.product_count} {q.product_count === 1 ? "product" : "products"}
                      </span>
                    </td>
                    <td className={styles.hideSm}>
                      <span className="num">{formatCount(q.seats)}</span>{" "}
                      <span className={styles.subtle}>{tierLabel(q.tier)}</span>
                    </td>
                    <td className={`num ${styles.right} ${styles.hideSm}`}>{formatPct(q.discount_pct)}</td>
                    <td className={`num ${styles.right} ${styles.total}`}>{formatMoney(q.total)}</td>
                    <td className={styles.hideMd}>
                      {q.approval_required ? (
                        <span className={styles.needs}>Needs approval</span>
                      ) : (
                        <span className={styles.clear}>Within policy</span>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={q.status} />
                    </td>
                    <td className={`num ${styles.right} ${styles.hideMd} ${styles.subtleCell}`}>
                      {formatDate(q.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <p className={styles.noMatch}>No {STATUS_LABEL[filter as QuoteStatus].toLowerCase()} quotes.</p>}
          </div>
        </>
      )}
    </main>
  );
}
