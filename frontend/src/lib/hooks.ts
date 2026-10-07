"use client";

import { useCallback, useEffect, useState } from "react";

import { api, ApiError } from "./api";
import type { Calculation, Catalog, Issue, QuoteDraftRequest } from "./types";

export type Loadable<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; error: ApiError };

function toApiError(cause: unknown): ApiError {
  return cause instanceof ApiError
    ? cause
    : new ApiError("network", 0, "unexpected", cause instanceof Error ? cause.message : "Something went wrong.");
}

const isAbort = (cause: unknown) => cause instanceof DOMException && cause.name === "AbortError";

/** Fetch something once (and again on `reload`). */
export function useLoad<T>(load: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[]) {
  const [state, setState] = useState<Loadable<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal)
      .then((data) => setState({ status: "ready", data }))
      .catch((cause) => {
        if (!isAbort(cause)) setState({ status: "error", error: toApiError(cause) });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callers pass explicit deps
  }, [...deps, nonce]);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    setNonce((n) => n + 1);
  }, []);

  return [state, reload, setState] as const;
}

export const useCatalog = () => useLoad<Catalog>((signal) => api.catalog(signal), [])[0];

export interface CalculationState {
  /** `pending` while a request is debouncing or in flight. */
  status: "pending" | "ok" | "invalid" | "error";
  /** Most recent *valid* calculation. Kept while the draft is invalid so the sheet doesn't flash empty. */
  result: Calculation | null;
  issues: Issue[];
  error: ApiError | null;
}

interface InternalState extends CalculationState {
  /** The draft (serialised) that `status`/`issues` describe. */
  forKey: string | null;
}

const DEBOUNCE_MS = 250;

/**
 * Ask the API to price `draft` whenever it changes (debounced). Older requests
 * are aborted, so a slow response can never overwrite a newer one.
 */
export function useCalculation(draft: QuoteDraftRequest, enabled = true) {
  const key = JSON.stringify(draft);
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<InternalState>({
    status: "pending",
    result: null,
    issues: [],
    error: null,
    forKey: null,
  });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api
        .calculate(JSON.parse(key) as QuoteDraftRequest, controller.signal)
        .then((result) => setState({ status: "ok", result, issues: [], error: null, forKey: key }))
        .catch((cause) => {
          if (isAbort(cause)) return;
          const error = toApiError(cause);
          setState((s) =>
            error.isValidation
              ? { status: "invalid", result: s.result, issues: error.issues, error: null, forKey: key }
              : { status: "error", result: s.result, issues: [], error, forKey: key },
          );
        });
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key, nonce, enabled]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  // Anything computed for an older draft is reported as pending, never as current.
  const current: CalculationState =
    state.forKey === key
      ? { status: state.status, result: state.result, issues: state.issues, error: state.error }
      : { status: "pending", result: state.result, issues: state.issues, error: null };
  return { ...current, retry };
}
