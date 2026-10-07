"use client";

import { domIdFor, emptyLine, lineField, type FieldId, type ScenarioDraft } from "@/lib/draft";
import { formatPct, formatWholeMoney, seatRange, tierLabel } from "@/lib/format";
import type { Catalog, Issue } from "@/lib/types";

import styles from "./builder.module.css";

interface Props {
  scenario: ScenarioDraft;
  scenarioIndex: number;
  catalog: Catalog;
  /** Issues already filtered to the ones the rep should see now. */
  visibleIssues: Map<FieldId, Issue[]>;
  onChange: (next: ScenarioDraft) => void;
  onTouch: (field: FieldId) => void;
}

export function ScenarioForm({ scenario, scenarioIndex, catalog, visibleIssues, onChange, onTouch }: Props) {
  const id = (field: FieldId) => domIdFor(field, scenarioIndex);
  const errorsFor = (field: FieldId) => visibleIssues.get(field) ?? [];
  const set = (patch: Partial<ScenarioDraft>) => onChange({ ...scenario, ...patch });

  const updateLine = (key: string, patch: Partial<ScenarioDraft["lines"][number]>) =>
    set({ lines: scenario.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) });

  // Guidance only: which tier the typed seat count falls into, using rule *data* served by the API.
  // The tier shown on the quote sheet always comes from /api/quotes/calculate.
  const seats = Number(scenario.seats);
  const rules = catalog.discount_rules;
  const guideTier = Number.isInteger(seats) && seats > 0 ? rules.find((r) => seats >= r.min_seats && seats <= r.max_seats) : undefined;

  const usedSkus = new Set(scenario.lines.map((line) => line.sku).filter(Boolean));
  const knownSkus = new Set(catalog.products.map((p) => p.sku));

  return (
    <div className={styles.form}>
      {/* ---- Seats ---------------------------------------------------------- */}
      <section className={styles.section} aria-labelledby={id("seats") + "-h"}>
        <SectionHead index="01" title="Seats" id={id("seats") + "-h"} />
        <div className={styles.seatsRow}>
          <div className={styles.seatsInput}>
            <label htmlFor={id("seats")} className={styles.label}>
              Number of seats
            </label>
            <input
              id={id("seats")}
              className="input"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              placeholder="e.g. 25"
              value={scenario.seats}
              onChange={(e) => set({ seats: e.target.value })}
              onBlur={() => onTouch("seats")}
              aria-invalid={errorsFor("seats").length > 0}
              aria-describedby={`${id("seats")}-err`}
            />
          </div>
          <ol className={styles.tierRuler} aria-label="Pricing tiers">
            {rules.map((rule, i) => {
              const active = guideTier?.code === rule.code;
              return (
                <li key={rule.code} className={styles.tierStep} data-active={active} aria-current={active || undefined}>
                  <span className={styles.tierName}>{tierLabel(rule.code)}</span>
                  <span className={styles.tierMeta}>{seatRange(rule, i === rules.length - 1)}</span>
                  <span className={styles.tierMeta}>up to {formatPct(rule.max_discount_pct)}</span>
                </li>
              );
            })}
          </ol>
        </div>
        <FieldErrors id={`${id("seats")}-err`} issues={errorsFor("seats")} />
      </section>

      {/* ---- Products ------------------------------------------------------- */}
      <section className={styles.section} aria-labelledby={id("line_items") + "-h"}>
        <SectionHead index="02" title="Products" id={id("line_items") + "-h"} />

        {scenario.lines.length > 0 && (
          <div className={styles.lineHeader} aria-hidden>
            <span>Product</span>
            <span>Qty</span>
            <span />
          </div>
        )}

        <ul className={styles.lines} id={id("line_items")}>
          {scenario.lines.map((line, index) => {
            const skuField = lineField(line.key, "sku");
            const qtyField = lineField(line.key, "quantity");
            const skuErrors = errorsFor(skuField);
            const qtyErrors = errorsFor(qtyField);
            const unknown = line.sku !== "" && !knownSkus.has(line.sku);
            const product = catalog.products.find((p) => p.sku === line.sku);
            return (
              <li key={line.key} className={styles.line}>
                <div className={styles.lineControls}>
                  <div>
                    <label htmlFor={id(skuField)} className="visually-hidden">
                      Product for line {index + 1}
                    </label>
                    <select
                      id={id(skuField)}
                      className="input"
                      value={line.sku}
                      onChange={(e) => {
                        updateLine(line.key, { sku: e.target.value });
                        onTouch(skuField);
                      }}
                      aria-invalid={skuErrors.length > 0}
                      aria-describedby={`${id(skuField)}-err`}
                    >
                      <option value="" disabled>
                        Choose a product…
                      </option>
                      {catalog.products.map((p) => (
                        <option key={p.sku} value={p.sku} disabled={p.sku !== line.sku && usedSkus.has(p.sku)}>
                          {p.name} — {formatWholeMoney(p.unit_price)}
                          {p.sku !== line.sku && usedSkus.has(p.sku) ? " (already added)" : ""}
                        </option>
                      ))}
                      {unknown && <option value={line.sku}>{line.sku} (not in catalog)</option>}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={id(qtyField)} className="visually-hidden">
                      Quantity for line {index + 1}
                    </label>
                    <input
                      id={id(qtyField)}
                      className="input"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={line.quantity}
                      onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                      onBlur={() => onTouch(qtyField)}
                      aria-invalid={qtyErrors.length > 0}
                      aria-describedby={`${id(qtyField)}-err`}
                    />
                  </div>
                  <button
                    type="button"
                    className={`btn btn-quiet ${styles.remove}`}
                    onClick={() => set({ lines: scenario.lines.filter((l) => l.key !== line.key) })}
                    aria-label={`Remove line ${index + 1}${product ? ` (${product.name})` : ""}`}
                  >
                    Remove
                  </button>
                </div>
                {product && <p className={styles.lineSku}>{product.sku}</p>}
                <FieldErrors id={`${id(skuField)}-err`} issues={skuErrors} />
                <FieldErrors id={`${id(qtyField)}-err`} issues={qtyErrors} />
              </li>
            );
          })}
        </ul>

        {scenario.lines.length === 0 && (
          <p className={styles.emptyLines}>No products yet. A quote needs at least one line.</p>
        )}

        <button
          type="button"
          className={`btn ${styles.addLine}`}
          onClick={() => set({ lines: [...scenario.lines, emptyLine()] })}
          disabled={usedSkus.size >= catalog.products.length && scenario.lines.every((l) => l.sku !== "")}
        >
          <span aria-hidden>+</span> Add product
        </button>
        <FieldErrors id={`${id("line_items")}-err`} issues={errorsFor("line_items")} />
      </section>

      {/* ---- Terms ---------------------------------------------------------- */}
      <section className={styles.section} aria-labelledby={id("discount_pct") + "-h"}>
        <SectionHead index="03" title="Discount & terms" id={id("discount_pct") + "-h"} />
        <DiscountControl
          inputId={id("discount_pct")}
          value={scenario.discountPct}
          tierMax={guideTier?.max_discount_pct}
          catalog={catalog}
          annual={scenario.annualCommitment}
          invalid={errorsFor("discount_pct").length > 0}
          onChange={(discountPct) => set({ discountPct })}
          onBlur={() => onTouch("discount_pct")}
        />
        <FieldErrors id={`${id("discount_pct")}-err`} issues={errorsFor("discount_pct")} />

        <label className={styles.toggle} htmlFor={id("annual_commitment")}>
          <input
            id={id("annual_commitment")}
            type="checkbox"
            role="switch"
            checked={scenario.annualCommitment}
            onChange={(e) => set({ annualCommitment: e.target.checked })}
          />
          <span className={styles.toggleTrack} aria-hidden />
          <span>
            <span className={styles.toggleLabel}>Annual commitment</span>
            <span className={styles.toggleHint}>
              Doesn&rsquo;t change the price. Discounts above{" "}
              {formatPct(catalog.approval_rules.annual_commitment_discount_above_pct)} then need approval.
            </span>
          </span>
        </label>
      </section>
    </div>
  );
}

function SectionHead({ index, title, id }: { index: string; title: string; id: string }) {
  return (
    <div className={styles.sectionHead}>
      <span className="eyebrow">{index}</span>
      <h2 id={id} className={styles.sectionTitle}>
        {title}
      </h2>
    </div>
  );
}

function FieldErrors({ id, issues }: { id: string; issues: Issue[] }) {
  return (
    <div id={id} aria-live="polite">
      {issues.map((issue) => (
        <p key={issue.code + issue.loc.join(".")} className="field-error">
          {issue.message}
        </p>
      ))}
    </div>
  );
}

interface DiscountProps {
  inputId: string;
  value: string;
  tierMax: number | undefined;
  catalog: Catalog;
  annual: boolean;
  invalid: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
}

/**
 * Number input plus a scale showing where the discount sits relative to the
 * tier cap and the approval thresholds — so the rep sees consequences before typing.
 */
function DiscountControl({ inputId, value, tierMax, catalog, annual, invalid, onChange, onBlur }: DiscountProps) {
  const scaleMax = Math.max(...catalog.discount_rules.map((r) => r.max_discount_pct));
  const approvalAt = catalog.approval_rules.discount_above_pct;
  const annualAt = catalog.approval_rules.annual_commitment_discount_above_pct;
  const numeric = Number(value);
  const current = Number.isFinite(numeric) ? Math.min(Math.max(numeric, 0), scaleMax) : 0;
  const pos = (pct: number) => `${(pct / scaleMax) * 100}%`;

  return (
    <div className={styles.discount}>
      <div className={styles.discountInput}>
        <label htmlFor={inputId} className={styles.label}>
          Discount
        </label>
        <div className={styles.suffixed}>
          <input
            id={inputId}
            className="input"
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step={0.5}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            aria-invalid={invalid}
            aria-describedby={`${inputId}-err ${inputId}-scale`}
          />
          <span aria-hidden>%</span>
        </div>
      </div>

      <div className={styles.scale} id={`${inputId}-scale`}>
        <div className={styles.track}>
          {tierMax !== undefined && <div className={styles.allowed} style={{ width: pos(tierMax) }} />}
          <div className={styles.fill} data-over={tierMax !== undefined && numeric > tierMax} style={{ width: pos(current) }} />
          {tierMax !== undefined && <div className={styles.cap} style={{ left: pos(tierMax) }} aria-hidden />}
          <Tick at={pos(approvalAt)} label={`>${formatPct(approvalAt)} needs approval`} />
          {annual && <Tick at={pos(annualAt)} label={`>${formatPct(annualAt)} annual`} align="end" />}
        </div>
        <div className={styles.scaleLabels}>
          <span>0%</span>
          <span>
            {tierMax !== undefined ? <>Tier cap {formatPct(tierMax)}</> : "Enter seats to see the cap"}
          </span>
          <span>{formatPct(scaleMax)}</span>
        </div>
      </div>
    </div>
  );
}

function Tick({ at, label, align = "start" }: { at: string; label: string; align?: "start" | "end" }) {
  return (
    <div className={styles.tick} data-align={align} style={{ left: at }}>
      <span>{label}</span>
    </div>
  );
}
