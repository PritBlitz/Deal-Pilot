"use client";

import Link from "next/link";

import { api } from "@/lib/api";
import {
  formatCount,
  formatMoney,
  formatPct,
  formatWholeMoney,
  REASON_LABEL,
  seatRange,
  tierLabel,
} from "@/lib/format";
import { useCatalog, useLoad } from "@/lib/hooks";
import type { Calculation, QuoteDraftRequest, QuoteSummary } from "@/lib/types";

import styles from "./landing.module.css";

/** The worked example from the brief: 50 seats, $20,000 subtotal, 20% off. Priced live by the API. */
const EXAMPLE: QuoteDraftRequest = {
  customer_name: "Acme Robotics",
  seats: 50,
  line_items: [
    { sku: "AGENT-CORE", quantity: 100 },
    { sku: "AGENT-ANALYTICS", quantity: 100 },
  ],
  discount_pct: 20,
  annual_commitment: false,
};

const STEPS = [
  {
    role: "Rep",
    title: "Build",
    body: "Pick the customer, seat count and products, then set a discount. The form shows the tier cap and approval thresholds as you type.",
  },
  {
    role: "API",
    title: "Price",
    body: "Every change is priced by the Python API, which owns the rules. Totals are exact to the cent, and the reasons for approval are spelled out.",
  },
  {
    role: "Rep",
    title: "Submit",
    body: "Save the quote as a draft, compare a second scenario if needed, then submit it to the deal desk.",
  },
  {
    role: "Approver",
    title: "Decide",
    body: "An approver sees who, how much and why in seconds, then approves or rejects with a note. Every step is logged.",
  },
];

export function Landing() {
  const catalog = useCatalog();
  const [example] = useLoad<Calculation>((signal) => api.calculate(EXAMPLE, signal), []);
  const [quotes] = useLoad<QuoteSummary[]>((signal) => api.listQuotes(signal), []);

  const counts =
    quotes.status === "ready"
      ? {
          total: quotes.data.length,
          submitted: quotes.data.filter((q) => q.status === "submitted").length,
          approved: quotes.data.filter((q) => q.status === "approved").length,
          rejected: quotes.data.filter((q) => q.status === "rejected").length,
        }
      : null;

  const offline = catalog.status === "error";

  return (
    <main className={styles.page}>
      {/* ---- Hero ------------------------------------------------------------ */}
      <section className={styles.hero}>
        <div className={styles.heroText}>
          <p className={`eyebrow ${styles.rise}`}>Internal tool · Sales &amp; deal desk</p>
          <h1 className={`display ${styles.headline}`}>
            <span className={styles.rise} style={{ animationDelay: "60ms" }}>
              Price it right.
            </span>
            <span className={styles.rise} style={{ animationDelay: "140ms" }}>
              Show your <em>working.</em>
            </span>
          </h1>
          <p className={`${styles.lead} ${styles.rise}`} style={{ animationDelay: "220ms" }}>
            Deal Desk is where sales reps build customer quotes, see them priced by the rules as they type, and send
            anything outside policy to an approver, with the reasons spelled out.
          </p>
          <div className={`${styles.ctas} ${styles.rise}`} style={{ animationDelay: "300ms" }}>
            <Link href="/quotes/new" className={`btn btn-primary ${styles.bigBtn}`}>
              Build a quote
            </Link>
            <Link href="/admin" className={`btn ${styles.bigBtn}`}>
              Open approvals
            </Link>
            <Link href="/quotes" className={styles.textLink}>
              Saved quotes →
            </Link>
          </div>
        </div>

        <figure className={styles.specimen} aria-label="Example quote, priced live by the API">
          <div className={styles.underSheet} aria-hidden />
          <div className={styles.sheet}>
            <div className={styles.sheetHead}>
              <span className="eyebrow">Quote · example</span>
              <span className={styles.live}>
                <span aria-hidden /> {example.status === "ready" ? "Priced live by the API" : "Pricing…"}
              </span>
            </div>
            <p className={`display ${styles.sheetCustomer}`}>{EXAMPLE.customer_name}</p>

            {example.status === "error" && (
              <p className={styles.sheetOffline}>
                Start the backend to see this example priced live. {example.error.message}
              </p>
            )}

            {example.status === "ready" && (
              <>
                <p className={styles.sheetMeta}>
                  <span className={styles.tag}>{tierLabel(example.data.tier)}</span>
                  {formatCount(example.data.seats)} seats · max {formatPct(example.data.max_discount_pct)}
                </p>
                <table className={styles.sheetLines}>
                  <tbody>
                    {example.data.lines.map((l) => (
                      <tr key={l.sku}>
                        <th scope="row">{l.name}</th>
                        <td className="num">
                          {formatCount(l.quantity)} × {formatWholeMoney(l.unit_price)}
                        </td>
                        <td className="num">{formatMoney(l.line_total)}</td>
                      </tr>
                    ))}
                    <tr className={styles.sheetSub}>
                      <th scope="row">Discount {formatPct(example.data.discount_pct)}</th>
                      <td />
                      <td className="num">−{formatMoney(example.data.discount_amount)}</td>
                    </tr>
                  </tbody>
                </table>
                <div className={styles.sheetTotal}>
                  <span>Total</span>
                  <span className="display">{formatMoney(example.data.total)}</span>
                </div>
                <ol className={styles.sheetExplain}>
                  {example.data.explanation.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ol>
                {example.data.approval_required && (
                  <span className={styles.stamp} aria-hidden>
                    Needs approval
                  </span>
                )}
              </>
            )}
          </div>
          <figcaption className={styles.caption}>
            The worked example from the brief, priced by <code>POST /api/quotes/calculate</code> when this page
            loaded.
          </figcaption>
        </figure>
      </section>

      {offline && (
        <p className={styles.offlineBar} role="alert">
          The pricing API isn&rsquo;t reachable, so live sections are empty. Start the backend on port 8000 (see
          README).
        </p>
      )}

      {/* ---- How a quote moves --------------------------------------------- */}
      <section className={styles.section} aria-labelledby="flow-h">
        <header className={styles.sectionHead}>
          <p className="eyebrow">01 · The flow</p>
          <h2 id="flow-h" className={`display ${styles.h2}`}>
            How a quote <em>moves</em>
          </h2>
        </header>
        <ol className={styles.steps}>
          {STEPS.map((step, i) => (
            <li key={step.title} className={styles.step}>
              <span className={`display ${styles.stepNum}`}>{String(i + 1).padStart(2, "0")}</span>
              <span className={styles.stepRole} data-role={step.role}>
                {step.role}
              </span>
              <h3 className={styles.stepTitle}>{step.title}</h3>
              <p className={styles.stepBody}>{step.body}</p>
            </li>
          ))}
        </ol>

        <div className={styles.lifecycle} aria-label="Quote statuses">
          <span className={styles.state}>Draft</span>
          <span className={styles.arrow} data-by="rep submits" aria-hidden />
          <span className={styles.state}>Submitted</span>
          <span className={styles.arrow} data-by="approver decides" aria-hidden />
          <span className={styles.fork}>
            <span className={styles.state} data-tone="green">
              Approved
            </span>
            <span className={styles.state} data-tone="red">
              Rejected
            </span>
          </span>
        </div>
      </section>

      {/* ---- Rules ----------------------------------------------------------- */}
      <section className={styles.section} aria-labelledby="rules-h">
        <header className={styles.sectionHead}>
          <p className="eyebrow">02 · The rules</p>
          <h2 id="rules-h" className={`display ${styles.h2}`}>
            In plain <em>sight</em>
          </h2>
          <p className={styles.sectionLead}>
            Served by <code>GET /api/catalog</code>: the same rules the API enforces on every quote.
          </p>
        </header>

        {catalog.status === "ready" && (
          <div className={styles.rules}>
            <div>
              <h3 className={styles.h3}>Discount caps by seat count</h3>
              <ul className={styles.tiers}>
                {catalog.data.discount_rules.map((rule, i, all) => {
                  const top = Math.max(...all.map((r) => r.max_discount_pct));
                  return (
                    <li key={rule.code}>
                      <span className={styles.tierName}>{tierLabel(rule.code)}</span>
                      <span className="num muted">{seatRange(rule, i === all.length - 1)}</span>
                      <span className={styles.tierBar}>
                        <span style={{ width: `${(rule.max_discount_pct / top) * 100}%` }} />
                      </span>
                      <span className={`display ${styles.tierPct}`}>{formatPct(rule.max_discount_pct)}</span>
                    </li>
                  );
                })}
              </ul>

              <h3 className={styles.h3}>Price list</h3>
              <table className={styles.prices}>
                <tbody>
                  {catalog.data.products.map((p) => (
                    <tr key={p.sku}>
                      <th scope="row">
                        {p.name} <span className="num muted">{p.sku}</span>
                      </th>
                      <td className="num">{formatWholeMoney(p.unit_price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.triggers}>
              <h3 className={styles.h3}>A quote needs approval when</h3>
              <ol>
                <li>
                  <span className={`display ${styles.triggerBig}`}>
                    &gt;{formatPct(catalog.data.approval_rules.discount_above_pct)}
                  </span>
                  <span>{REASON_LABEL.discount_above_15_percent}</span>
                </li>
                <li>
                  <span className={`display ${styles.triggerBig}`}>
                    &gt;{formatWholeMoney(catalog.data.approval_rules.total_above)}
                  </span>
                  <span>{REASON_LABEL.total_above_25000}, after discount</span>
                </li>
                <li>
                  <span className={`display ${styles.triggerBig}`}>
                    &gt;{formatPct(catalog.data.approval_rules.annual_commitment_discount_above_pct)}
                  </span>
                  <span>{REASON_LABEL.annual_commitment_discount_above_10_percent}</span>
                </li>
              </ol>
              <p className={styles.triggerNote}>
                Any one is enough, and every reason that applies is listed on the quote. An annual commitment
                never changes the price.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* ---- Live desk ------------------------------------------------------- */}
      <section className={styles.section} aria-labelledby="desk-h">
        <header className={styles.sectionHead}>
          <p className="eyebrow">03 · Right now</p>
          <h2 id="desk-h" className={`display ${styles.h2}`}>
            At the <em>desk</em>
          </h2>
        </header>
        <dl className={styles.desk}>
          <Stat href="/quotes" label="Quotes saved" value={counts?.total} />
          <Stat href="/admin" label="Awaiting an approver" value={counts?.submitted} tone="amber" />
          <Stat href="/quotes" label="Approved" value={counts?.approved} tone="green" />
          <Stat href="/quotes" label="Rejected" value={counts?.rejected} tone="red" />
        </dl>
      </section>

      {/* ---- Doors ------------------------------------------------------------ */}
      <section className={styles.doors} aria-label="Get started">
        <Link href="/quotes/new" className={styles.door}>
          <span className="eyebrow">For sales reps</span>
          <span className={`display ${styles.doorTitle}`}>
            Build a <em>quote</em> →
          </span>
          <span className={styles.doorBody}>Live pricing, scenario comparison, and your draft survives a refresh.</span>
        </Link>
        <Link href="/admin" className={styles.door} data-dark>
          <span className="eyebrow">For approvers</span>
          <span className={`display ${styles.doorTitle}`}>
            Review the <em>queue</em> →
          </span>
          <span className={styles.doorBody}>Oldest first, reasons up front, one click to approve or reject.</span>
        </Link>
      </section>

      <footer className={styles.footer}>
        <span>Deal Desk · take-home build</span>
        <span className="num">Next.js · FastAPI · Decimal money · JSON storage</span>
      </footer>
    </main>
  );
}

function Stat({
  href,
  label,
  value,
  tone,
}: {
  href: string;
  label: string;
  value: number | undefined;
  tone?: "amber" | "green" | "red";
}) {
  return (
    <Link href={href} className={styles.stat}>
      <dt>{label}</dt>
      <dd className="display" data-tone={tone}>
        {value === undefined ? "–" : formatCount(value)}
      </dd>
    </Link>
  );
}
