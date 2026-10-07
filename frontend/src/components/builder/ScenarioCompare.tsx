"use client";

import { formatCount, formatMoney, formatPct, REASON_LABEL, tierLabel } from "@/lib/format";
import type { CalculationState } from "@/lib/hooks";
import type { Calculation } from "@/lib/types";

import styles from "./builder.module.css";

interface Column {
  label: string;
  calc: CalculationState;
}

/** Side-by-side view of two scenarios. Every figure comes from the API, nothing is recomputed here. */
export function ScenarioCompare({ columns, active, onSelect }: { columns: Column[]; active: number; onSelect: (i: number) => void }) {
  const results = columns.map((c) => (c.calc.status === "ok" ? c.calc.result : null));
  const [a, b] = results;
  // Display-only difference, done in integer cents so float noise can't appear (e.g. 0.30000000000000004).
  const delta = a && b ? (Math.round(b.total * 100) - Math.round(a.total * 100)) / 100 : null;

  const rows: { label: string; render: (r: Calculation) => React.ReactNode; differs?: boolean }[] = [
    {
      label: "Seats",
      render: (r) => (
        <>
          {formatCount(r.seats)} · {tierLabel(r.tier)}
        </>
      ),
      differs: a && b ? a.seats !== b.seats : false,
    },
    {
      label: "Products",
      render: (r) => (
        <ul className={styles.cmpProducts}>
          {r.lines.map((l) => (
            <li key={l.sku}>
              {l.name} <span className="num muted">×{formatCount(l.quantity)}</span>
            </li>
          ))}
        </ul>
      ),
      differs:
        a && b
          ? JSON.stringify(a.lines.map((l) => [l.sku, l.quantity])) !== JSON.stringify(b.lines.map((l) => [l.sku, l.quantity]))
          : false,
    },
    {
      label: "Discount",
      render: (r) => (
        <span className="num">
          {formatPct(r.discount_pct)} <span className="muted">(−{formatMoney(r.discount_amount)})</span>
        </span>
      ),
      differs: a && b ? a.discount_pct !== b.discount_pct : false,
    },
    {
      label: "Total",
      render: (r) => <span className={`display ${styles.cmpTotal}`}>{formatMoney(r.total)}</span>,
      differs: a && b ? a.total !== b.total : false,
    },
    {
      label: "Approval",
      render: (r) =>
        r.approval_required ? (
          <span className={styles.cmpNeeds}>
            Needs approval
            <span className={styles.cmpReasons}>{r.approval_reasons.map((x) => REASON_LABEL[x]).join("; ")}</span>
          </span>
        ) : (
          <span className={styles.cmpClear}>Within policy</span>
        ),
      differs: a && b ? a.approval_required !== b.approval_required : false,
    },
  ];

  return (
    <section className={styles.compare} aria-label="Scenario comparison">
      <table className={styles.cmpTable}>
        <thead>
          <tr>
            <td />
            {columns.map((col, i) => (
              <th key={col.label} scope="col">
                <button type="button" className={styles.cmpHead} aria-pressed={active === i} onClick={() => onSelect(i)}>
                  {col.label}
                  {active === i && <span className="eyebrow">editing</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} data-differs={row.differs || undefined}>
              <th scope="row" className="eyebrow">
                {row.label}
              </th>
              {columns.map((col, i) => {
                const result = results[i];
                return (
                  <td key={col.label}>
                    {result ? (
                      row.render(result)
                    ) : (
                      <span className="muted">{col.calc.status === "pending" ? "Pricing…" : "Needs input"}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {delta !== null && delta !== 0 && (
        <p className={styles.cmpDelta}>
          {columns[1].label} is{" "}
          <strong className="num">{formatMoney(Math.abs(delta))}</strong> {delta > 0 ? "more" : "less"} than{" "}
          {columns[0].label}.
        </p>
      )}
    </section>
  );
}
