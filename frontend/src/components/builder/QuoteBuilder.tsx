"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Notice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import {
  clearDraft,
  cloneScenario,
  domIdFor,
  fieldForLoc,
  fromQuote,
  initialBuilderState,
  isPristine,
  issuesByField,
  loadDraft,
  saveDraft,
  toRequest,
  type BuilderState,
  type FieldId,
  type ScenarioDraft,
} from "@/lib/draft";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useCalculation, useCatalog } from "@/lib/hooks";
import type { Issue } from "@/lib/types";

import styles from "./builder.module.css";
import { QuoteSheet } from "./QuoteSheet";
import { ScenarioCompare } from "./ScenarioCompare";
import { ScenarioForm } from "./ScenarioForm";

const SCENARIO_LABELS = ["Scenario A", "Scenario B"];

type Banner =
  | { kind: "restored"; savedAt: string }
  | { kind: "prefilled"; from: string }
  | { kind: "prefillFailed"; from: string; message: string }
  | null;

export function QuoteBuilder() {
  const router = useRouter();
  const fromId = useSearchParams().get("from");
  const catalog = useCatalog();

  // This component only renders in the browser (see NewQuoteClient), so the
  // recovered draft can be read synchronously here without a hydration mismatch.
  const [initial] = useState(() => {
    const draft = fromId ? null : loadDraft();
    return draft && !isPristine(draft.state)
      ? { state: draft.state, banner: { kind: "restored", savedAt: draft.savedAt } as Banner }
      : { state: initialBuilderState(), banner: null };
  });
  const [state, setState] = useState<BuilderState>(initial.state);
  // When starting from a saved quote, hold off pricing/persisting until it has loaded.
  const [hydrated, setHydrated] = useState(!fromId);
  const [banner, setBanner] = useState<Banner>(initial.banner);
  const [touched, setTouched] = useState<Set<FieldId>>(() => new Set());
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveIssues, setSaveIssues] = useState<Issue[]>([]);
  const [saveError, setSaveError] = useState<ApiError | null>(null);

  // -- "Start a new quote from Q-…": load the saved quote into the form ---------------------
  useEffect(() => {
    if (!fromId) return;
    let cancelled = false;
    api
      .getQuote(fromId)
      .then((quote) => {
        if (cancelled) return;
        setState(fromQuote(quote));
        setBanner({ kind: "prefilled", from: quote.id });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const message = cause instanceof Error ? cause.message : "Unknown error.";
        setBanner({ kind: "prefillFailed", from: fromId, message });
      })
      .finally(() => !cancelled && setHydrated(true));
    return () => {
      cancelled = true;
    };
  }, [fromId]);

  // -- Draft recovery: persist every change once the initial state is in place ----------------
  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => (isPristine(state) ? clearDraft() : saveDraft(state)), 300);
    return () => window.clearTimeout(timer);
  }, [state, hydrated]);

  // -- Live pricing for each scenario ---------------------------------------------------------
  const [scenarioA, scenarioB] = state.scenarios;
  const calcA = useCalculation(toRequest(state.customerName, scenarioA), hydrated);
  const calcB = useCalculation(toRequest(state.customerName, scenarioB ?? scenarioA), hydrated && !!scenarioB);
  const calcs = scenarioB ? [calcA, calcB] : [calcA];
  const activeCalc = calcs[state.active];
  const activeScenario = state.scenarios[state.active];

  // -- Which issues to show inline --------------------------------------------------------------
  // Live issues come from /calculate; save adds the ones only checked on save (customer name).
  // A field's error appears once the rep has left that field, or after they try to save.
  const allIssues = [...(activeCalc.status === "invalid" ? activeCalc.issues : []), ...saveIssues];
  const issuesForFields = issuesByField(allIssues, activeScenario.lines);
  const visibleIssues = saveAttempted
    ? issuesForFields
    : new Map([...issuesForFields].filter(([field]) => touched.has(field)));

  const touch = (field: FieldId) => setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));

  const update = (next: Partial<BuilderState>) => {
    setState((prev) => ({ ...prev, ...next }));
    setSaveIssues([]);
    setSaveError(null);
  };

  const updateScenario = (index: number, scenario: ScenarioDraft) =>
    update({ scenarios: state.scenarios.map((s, i) => (i === index ? scenario : s)) });

  const focusIssue = (issue: Issue) => {
    const field = fieldForLoc(issue.loc, activeScenario.lines);
    touch(field);
    const target = field === "customer_name" ? "customer-name" : domIdFor(field, state.active);
    document.getElementById(target)?.focus();
  };

  // -- Save -------------------------------------------------------------------------------------
  async function save() {
    setSaveAttempted(true);
    setSaving(true);
    setSaveError(null);
    try {
      const quote = await api.createQuote(toRequest(state.customerName, activeScenario));
      clearDraft();
      router.push(`/quotes/${quote.id}`);
    } catch (cause) {
      const error = cause instanceof ApiError ? cause : new ApiError("network", 0, "unexpected", String(cause));
      if (error.isValidation) {
        // Keep only the problems /calculate doesn't already report, to avoid listing them twice.
        const live = new Set(allIssues.map((i) => i.code + i.loc.join(".")));
        setSaveIssues(error.issues.filter((i) => !live.has(i.code + i.loc.join("."))));
        const first = error.issues[0];
        if (first) focusIssue(first);
      } else {
        setSaveError(error);
      }
      setSaving(false);
    }
  }

  // -- Render -----------------------------------------------------------------------------------
  if (catalog.status === "loading") {
    return <p className={styles.loading}>Loading catalog…</p>;
  }
  if (catalog.status === "error") {
    return (
      <div className={styles.loading}>
        <Notice tone="error" title="Couldn't load the product catalog">
          {catalog.error.message}
        </Notice>
      </div>
    );
  }

  const comparing = state.scenarios.length > 1;
  const customerErrors = visibleIssues.get("customer_name") ?? [];
  const issueCount = activeCalc.status === "invalid" ? activeCalc.issues.length : 0;

  return (
    <div className={styles.builder}>
      <header className={styles.head}>
        <p className="eyebrow">New quote</p>
        <label htmlFor="customer-name" className="visually-hidden">
          Customer name
        </label>
        <input
          id="customer-name"
          className={`display ${styles.customerInput}`}
          placeholder="Customer name"
          autoComplete="off"
          value={state.customerName}
          onChange={(e) => update({ customerName: e.target.value })}
          onBlur={() => touch("customer_name")}
          aria-invalid={customerErrors.length > 0}
          aria-describedby="customer-name-err"
        />
        <div id="customer-name-err" aria-live="polite">
          {customerErrors.map((issue) => (
            <p key={issue.code} className="field-error">
              {issue.message}
            </p>
          ))}
        </div>

        {banner && (
          <div className={styles.banner}>
            <Notice
              tone={banner.kind === "prefillFailed" ? "error" : "info"}
              title={
                banner.kind === "restored"
                  ? `Restored your unsaved draft from ${formatDateTime(banner.savedAt)}.`
                  : banner.kind === "prefilled"
                    ? `Started from ${banner.from}. Saving creates a new quote; ${banner.from} is unchanged.`
                    : `Couldn't load ${banner.from} to start from.`
              }
              action={
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    clearDraft();
                    setState(initialBuilderState());
                    setTouched(new Set());
                    setSaveAttempted(false);
                    setBanner(null);
                    setHydrated(true);
                    if (fromId) router.replace("/quotes/new");
                  }}
                >
                  Start fresh
                </button>
              }
            >
              {banner.kind === "prefillFailed" ? banner.message : null}
            </Notice>
          </div>
        )}
      </header>

      <div className={styles.scenarioBar} role="tablist" aria-label="Scenarios">
        {state.scenarios.map((_, i) => {
          const calc = calcs[i];
          return (
            <button
              key={SCENARIO_LABELS[i]}
              type="button"
              role="tab"
              aria-selected={state.active === i}
              className={styles.scenarioTab}
              onClick={() => update({ active: i })}
            >
              <span>{comparing ? SCENARIO_LABELS[i] : "Scenario"}</span>
              <span className="num">
                {calc.status === "ok" && calc.result ? formatMoney(calc.result.total) : "—"}
              </span>
            </button>
          );
        })}
        <div className={styles.scenarioActions}>
          {comparing ? (
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => update({ scenarios: [state.scenarios[0]], active: 0 })}
            >
              Remove scenario B
            </button>
          ) : (
            <button
              type="button"
              className="btn"
              onClick={() => update({ scenarios: [scenarioA, cloneScenario(scenarioA)], active: 1 })}
            >
              Compare another scenario
            </button>
          )}
        </div>
      </div>

      {comparing && (
        <ScenarioCompare
          columns={state.scenarios.map((_, i) => ({ label: SCENARIO_LABELS[i], calc: calcs[i] }))}
          active={state.active}
          onSelect={(i) => update({ active: i })}
        />
      )}

      <div className={styles.grid}>
        <div role="tabpanel" aria-label={SCENARIO_LABELS[state.active]}>
          <ScenarioForm
            key={state.active}
            scenario={activeScenario}
            scenarioIndex={state.active}
            catalog={catalog.data}
            visibleIssues={visibleIssues}
            onChange={(next) => updateScenario(state.active, next)}
            onTouch={touch}
          />
        </div>

        <aside className={styles.sheetColumn}>
          <QuoteSheet
            customerName={state.customerName}
            scenarioLabel={comparing ? SCENARIO_LABELS[state.active] : undefined}
            calc={activeCalc}
            onFocusIssue={focusIssue}
            footer={
              <div className={styles.saveRow}>
                {saveError && (
                  <Notice tone="error" title="The quote wasn't saved">
                    {saveError.message}
                  </Notice>
                )}
                <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
                  {saving ? "Saving…" : comparing ? `Save ${SCENARIO_LABELS[state.active]} as quote` : "Save quote"}
                </button>
                <p className={styles.saveHint}>
                  {issueCount > 0
                    ? `${issueCount} ${issueCount === 1 ? "thing" : "things"} to fix before this can be saved.`
                    : "Saved quotes start as drafts and can then be submitted for review."}
                </p>
              </div>
            }
          />
        </aside>
      </div>
    </div>
  );
}
