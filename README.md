# Deal Desk Quote Simulator

An internal tool for sales reps to build a customer quote, see it priced live, understand whether it needs approval and why, save it, and move it through review.

- **Backend:** Python 3.12+ · FastAPI · Pydantic. All business rules live here.
- **Frontend:** Next.js 16 (App Router) · React 19 · TypeScript. CSS Modules, no UI kit.
- **Storage:** quotes are saved to a JSON file (`backend/var/quotes.json`). No database.

The original brief is in [docs/ASSIGNMENT.md](docs/ASSIGNMENT.md). Design and business decisions are in [DECISIONS.md](DECISIONS.md).

---

## Run it (about 5 minutes)

Prerequisites: **Python 3.12+** and **Node 20.9+**.

**1. Backend** (terminal 1)

```bash
cd backend
python -m venv .venv

# Activate the virtual environment (run the script directly, not with `python`):
#   macOS/Linux:          source .venv/bin/activate
#   Windows PowerShell:   .venv\Scripts\Activate.ps1
#   Windows cmd:          .venv\Scripts\activate.bat
#   Windows Git Bash:     source .venv/Scripts/activate
# Your prompt should now start with (.venv).

pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

> **PowerShell says "running scripts is disabled"?** Run
> `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` (this terminal only), then activate again.

The API is now at http://localhost:8000. Interactive docs are at http://localhost:8000/docs.

**2. Frontend** (terminal 2)

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000**.

**Two roles.** Anyone can build, save and submit quotes (the *rep*). Approving or rejecting needs the approver
passcode: open **Approvals** and sign in with **`approver`** (set `DEAL_DESK_ADMIN_PASSCODE` to change it).

No configuration is needed for the default ports. If you change a port, see [.env.example](.env.example). For example, if the frontend runs on `:3001`, start the backend with `DEAL_DESK_CORS_ORIGINS=http://localhost:3001`.

## Tests

```bash
# backend: business rules (with boundary values), API validation, workflow, catalog drift
cd backend && python -m pytest

# frontend: draft → request mapping, issue → field mapping, quote sheet rendering
cd frontend && npm test

# frontend static checks
cd frontend && npm run lint && npm run typecheck
```

## What's in the app

| Page | Who | What it does |
| --- | --- | --- |
| `/` | everyone | **Overview.** What the tool is, how a quote moves, the pricing and approval rules (live from the API), a live-priced worked example, and current counts. |
| `/quotes` | rep | Every saved quote. Filter by status; each row shows total, tier and approval at a glance. |
| `/quotes/new` | rep | **Quote builder.** Customer, seats, product lines, discount and annual commitment. The quote sheet on the right is priced by the API as you type. It also offers **Compare another scenario** (A/B side by side), **Explain pricing**, and **draft recovery** (survives a refresh). |
| `/quotes/:id` | rep | **Quote page.** Who, how much, approval verdict and reasons, line items, catalog-change warnings and history. A rep can **submit** a draft; a submitted quote shows as "with an approver". |
| `/admin` | approver | **Approvals.** Passcode sign-in, then the queue of submitted quotes (oldest first, reasons up front) and recently decided ones. |
| `/admin/quotes/:id` | approver | **Decision page.** The same review layout with **Approve** / **Reject** and an optional note. Changes show at once and roll back if the API refuses. |

---

## API

Base URL `http://localhost:8000`. All bodies are JSON. Money and percentages are JSON numbers, already rounded by the server (see DECISIONS.md, §3).

### Errors

Every non-2xx response has the same shape, so the UI can attach each problem to the right input:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "The quote has 2 problems to fix.",
    "issues": [
      { "loc": ["line_items", 0, "quantity"], "code": "quantity_not_positive", "message": "Quantity must be at least 1." },
      { "loc": ["discount_pct"], "code": "discount_above_tier_max", "message": "Starter tier (1–9 seats) allows at most 10% discount." }
    ]
  }
}
```

| Status | `error.code` | When |
| --- | --- | --- |
| 422 | `validation_failed` | Wrong types, unknown fields, or business-rule violations. All issues are reported at once. |
| 401 | `invalid_admin_passcode` | An `Authorization` header was sent with a wrong passcode |
| 403 | `approver_required` | A rep (no credentials) tried to approve or reject |
| 404 | `quote_not_found` | Unknown quote id |
| 409 | `invalid_transition` | Status change not allowed from the current status |

Issue codes: `customer_name_required`, `customer_name_too_long`, `seats_required`, `seats_not_positive`, `seats_out_of_range`, `no_line_items`, `sku_required`, `unknown_sku`, `duplicate_sku`, `quantity_required`, `quantity_not_positive`, `quantity_too_large`, `discount_negative`, `discount_too_precise`, `discount_above_tier_max`, `invalid_type`, `unknown_field`.

### `GET /api/catalog`

Products, seat tiers, and the approval thresholds.

```json
{
  "currency": "USD",
  "products": [{ "sku": "AGENT-CORE", "name": "Agent Core", "unit_price": 120.0 }],
  "discount_rules": [{ "code": "STARTER", "min_seats": 1, "max_seats": 9, "max_discount_pct": 10.0 }],
  "approval_rules": { "discount_above_pct": 15.0, "total_above": 25000.0, "annual_commitment_discount_above_pct": 10.0 }
}
```

### `POST /api/quotes/calculate`

Prices a draft and returns the authoritative result. The customer name is **not** required here, so a preview works before it's filled in.

Request (`QuoteDraft`, also used by `POST /api/quotes`):

```json
{
  "customer_name": "Northwind",
  "seats": 50,
  "line_items": [{ "sku": "AGENT-CORE", "quantity": 100 }, { "sku": "AGENT-ANALYTICS", "quantity": 100 }],
  "discount_pct": 20,
  "annual_commitment": false
}
```

`discount_pct` defaults to `0` and `annual_commitment` to `false` if omitted. Unknown fields are rejected.

Response `200` (`Calculation`):

```json
{
  "seats": 50,
  "tier": "ENTERPRISE",
  "max_discount_pct": 30.0,
  "lines": [
    { "sku": "AGENT-CORE", "name": "Agent Core", "unit_price": 120.0, "quantity": 100, "line_total": 12000.0 },
    { "sku": "AGENT-ANALYTICS", "name": "Agent Analytics", "unit_price": 80.0, "quantity": 100, "line_total": 8000.0 }
  ],
  "subtotal": 20000.0,
  "discount_pct": 20.0,
  "discount_amount": 4000.0,
  "total": 16000.0,
  "annual_commitment": false,
  "approval_required": true,
  "approval_reasons": ["discount_above_15_percent"],
  "explanation": [
    "50 seats → Enterprise tier → maximum discount 30%.",
    "Subtotal $20,000 → 20% discount ($4,000) → final $16,000.",
    "Approval required because discount is above 15%."
  ]
}
```

`approval_reasons` ⊆ `discount_above_15_percent`, `total_above_25000`, `annual_commitment_discount_above_10_percent`.

### `POST /api/quotes` → `201 Quote`

Same body as `/calculate`; `customer_name` is required. The quote is saved as `draft` together with a snapshot of its calculation.

```json
{
  "id": "Q-0001",
  "status": "draft",
  "customer_name": "Northwind",
  "created_at": "2026-10-07T13:15:05Z",
  "updated_at": "2026-10-07T13:15:05Z",
  "calculation": { "...": "Calculation, as above" },
  "history": [{ "from_status": null, "to_status": "draft", "at": "2026-10-07T13:15:05Z", "note": null, "actor": "rep" }],
  "allowed_transitions": [{ "status": "submitted", "role": "rep" }],
  "warnings": []
}
```

`warnings` lists products whose catalog entry has changed or disappeared since the quote was saved (`product_removed`, `price_changed`).

### `GET /api/quotes?status=` → `QuoteSummary[]`

Newest first: `id, status, customer_name, created_at, updated_at, seats, tier, product_count, discount_pct, total, approval_required, approval_reasons`. The optional `status` filter (e.g. `?status=submitted`) returns the approval queue.

### `GET /api/quotes/{id}` → `Quote`

### `PATCH /api/quotes/{id}/status` → `Quote`

```json
{ "status": "submitted", "note": "optional, ≤ 500 chars" }
```

| Move | Who | How |
| --- | --- | --- |
| `draft → submitted` | rep (or approver) | no credentials needed |
| `submitted → approved` | approver | header `Authorization: Bearer <passcode>` |
| `submitted → rejected` | approver | header `Authorization: Bearer <passcode>` |

Any other move returns `409 invalid_transition`. A rep trying an approver move gets `403 approver_required`. Each history event records the `actor` (`rep` or `admin`).

### `POST /api/admin/session` → `204`

```json
{ "passcode": "approver" }
```

Checks an approver passcode (`401 invalid_admin_passcode` if wrong). The UI holds it in memory only while you are inside `/admin` and sends it as the Bearer token on decisions. Leaving Approvals, refreshing or opening a new tab asks for it again.

---

## Project layout

```
backend/
  app/
    pricing.py    ← all business rules (pure functions, Decimal money)
    catalog.py    ← loads data/catalog.json
    models.py     ← HTTP request/response schemas
    workflow.py   ← status state machine + which role may make each move
    store.py      ← JSON-file persistence (atomic writes)
    main.py       ← FastAPI routes + error envelope
  tests/
frontend/src/
  app/            ← routes (/, /quotes, /quotes/new, /quotes/[id], /admin, /admin/quotes/[id])
  components/     ← home/, builder/, review/, admin/, list, shared UI
  lib/            ← api client, wire types, draft model, hooks, formatting
data/catalog.json ← supplied, unmodified
```

## Known limitations

- **JSON-file storage**: one process only (a thread lock serialises writes). Not safe for several API workers. Ids are sequential (`Q-0001`).
- **Approver access is a shared passcode**, not real user accounts. The API enforces it on every decision, but there are no individual identities (history records the *role*, not a person).
- Saved quotes can't be edited. To revise one, use "Start a new quote from this one" (see DECISIONS.md, §7).
