import type {
  Calculation,
  Catalog,
  ErrorBody,
  Issue,
  Quote,
  QuoteDraftRequest,
  QuoteStatus,
  QuoteSummary,
} from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

/**
 * Every failed request becomes an `ApiError`:
 * - `kind: "http"` — the API answered with its error envelope (validation, 404, 409…)
 * - `kind: "network"` — the API could not be reached at all
 */
export class ApiError extends Error {
  constructor(
    readonly kind: "http" | "network",
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: Issue[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isValidation(): boolean {
    return this.kind === "http" && this.code === "validation_failed";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
      cache: "no-store",
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(
      "network",
      0,
      "network_error",
      `Can't reach the pricing API at ${API_URL}. Is the backend running?`,
    );
  }

  if (response.status === 204) return undefined as T;
  if (response.ok) return (await response.json()) as T;

  const body = (await response.json().catch(() => null)) as { error?: ErrorBody } | null;
  const error = body?.error;
  throw new ApiError(
    "http",
    response.status,
    error?.code ?? "http_error",
    error?.message ?? `The API responded with ${response.status} ${response.statusText}.`,
    error?.issues ?? [],
  );
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  catalog: (signal?: AbortSignal) => request<Catalog>("/api/catalog", { signal }),

  calculate: (draft: QuoteDraftRequest, signal?: AbortSignal) =>
    request<Calculation>("/api/quotes/calculate", { method: "POST", body: json(draft), signal }),

  createQuote: (draft: QuoteDraftRequest) =>
    request<Quote>("/api/quotes", { method: "POST", body: json(draft) }),

  listQuotes: (signal?: AbortSignal, status?: QuoteStatus) =>
    request<QuoteSummary[]>(`/api/quotes${status ? `?status=${status}` : ""}`, { signal }),

  getQuote: (id: string, signal?: AbortSignal) =>
    request<Quote>(`/api/quotes/${encodeURIComponent(id)}`, { signal }),

  /** `passcode` is required for approver moves (approve/reject); reps omit it. */
  changeStatus: (id: string, status: QuoteStatus, note?: string, passcode?: string) =>
    request<Quote>(`/api/quotes/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      body: json({ status, note: note?.trim() || null }),
      headers: passcode ? { Authorization: `Bearer ${passcode}` } : undefined,
    }),

  /** Resolves if the approver passcode is right; rejects with ApiError(401) otherwise. */
  adminSignIn: (passcode: string) =>
    request<void>("/api/admin/session", { method: "POST", body: json({ passcode }) }),
};
