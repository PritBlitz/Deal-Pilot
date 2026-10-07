# Take-home C: Deal Desk Quote Simulator

## What this is

A sales team needs a small internal tool to prepare customer quotes before sending them for approval.

Today, reps calculate quantities, discounts, and approval requirements manually. Build a **Deal Desk Quote Simulator** that lets a rep create a quote, see the calculation, understand whether approval is required, and save/load the quote.

This is intentionally **not** an analytics/explorer exercise. The core of the task is business logic, typed state, form design, API boundaries, validation, and making a calculation trustworthy.

You are given `data/catalog.json`.

## Timebox

Budget around **6–8 hours of focused work**, spread over up to 4 days.

Finish the MUST BUILD section well before spending time on polish.

## Stack

### Frontend
- Next.js App Router
- React
- TypeScript

### Backend
- Python
- FastAPI preferred; Flask/Django REST acceptable

### Data
- JSON file supplied with the assessment
- No database required
- Persist created quotes to a simple JSON file on the backend, or keep them in memory if you clearly document the limitation

The browser must communicate with the Python backend over HTTP. Do not hide the backend inside Next.js API routes.

## Business rules

A quote contains:
- customer name
- number of seats
- one or more product line items
- discount percentage
- optional annual commitment

For each line:
`line_total = quantity × unit_price`

Before discount:
`subtotal = sum(line_total)`

After discount:
`discount_amount = subtotal × discount_pct / 100`

`total = subtotal - discount_amount`

### Discount limits

The maximum discount depends on seats:

| Tier | Seats | Maximum discount |
| --- | ---: | ---: |
| STARTER | 1–9 | 10% |
| GROWTH | 10–49 | 20% |
| ENTERPRISE | 50+ | 30% |

### Approval

A quote requires approval when:
- discount is above 15%, OR
- total is greater than $25,000, OR
- annual commitment is selected AND discount is above 10%

The API is the source of truth for these calculations. Do not trust totals calculated only in the browser.

## MUST BUILD

### 1. Quote builder

Create a page where a rep can:

- enter customer name
- enter seat count
- add/remove product lines
- select a product
- enter quantity
- enter discount
- toggle annual commitment

Show a live quote preview containing:
- selected products
- subtotal
- discount amount
- final total
- applicable pricing tier
- whether approval is required
- reason(s) for approval

Handle:
- no line items
- zero/negative quantities
- invalid seat counts
- discount above the allowed tier maximum
- unknown product SKUs

Make validation errors understandable.

### 2. Backend

Implement:

`GET /api/catalog`

Returns products and pricing rules.

`POST /api/quotes/calculate`

Accepts a quote draft and returns the authoritative calculation.

Example response shape:

```json
{
  "tier": "GROWTH",
  "subtotal": 12000,
  "discount_amount": 1800,
  "total": 10200,
  "approval_required": true,
  "approval_reasons": ["discount_above_15_percent"]
}
```

`POST /api/quotes`

Validates and saves a quote.

`GET /api/quotes/{id}`

Returns a saved quote with its calculated result.

`GET /api/quotes`

Returns saved quotes with enough information to choose one to open.

You decide the exact request/response schemas. Document them.

### 3. Quote review

Create a review page for a saved quote.

A reviewer should be able to understand in a few seconds:
- who the quote is for
- what was purchased
- pricing
- discount
- approval status
- why approval is required, if applicable

Add an action to change the quote status between:

`draft → submitted → approved`

and

`draft → submitted → rejected`

Do not allow obviously invalid transitions. Document your choice.

### 4. Tests

Write meaningful tests.

At minimum:
- 4 backend tests for business rules
- 1 API validation/error test
- 1 frontend test, OR explain in `DECISIONS.md` what you would test and why

At least one test should cover a boundary value such as 9 vs 10 seats or 49 vs 50 seats.

## SHOULD BUILD

If the core is solid:

### A. Quote comparison

Allow the rep to create a second scenario from the same customer and compare:

- total
- discount
- products
- approval requirement

Example:
"50 seats at 10%" vs "50 seats at 20%"

### B. Explain the calculation

Add an "Explain pricing" action that shows a deterministic, human-readable explanation such as:

> 50 seats → Enterprise tier → maximum discount 30%.  
> Subtotal $20,000 → 20% discount ($4,000) → final $16,000.  
> Approval required because discount is above 15%.

This explanation may be generated entirely by your code. No external LLM/API is required.

### C. Draft recovery

Persist an unsaved draft locally so a browser refresh does not erase the form.

## STRETCH

Optional only:
- Add an approval history/audit trail.
- Add optimistic status updates with rollback.
- Add Docker Compose for frontend and backend.
- Replace JSON persistence with PostgreSQL and explain the migration.

## Things you have to decide

Put these decisions in `DECISIONS.md`.

1. What happens if the same product is added twice?
2. Is a 0% discount represented as `0` or omitted?
3. How do you handle money/rounding? Explain why.
4. Does an annual commitment change pricing, or only approval logic?
5. What happens if a product disappears from the catalog after a saved quote was created?
6. Where should business rules live so the frontend and backend cannot disagree?
7. Which status transitions are allowed?

There is no single correct answer. We score the quality of the reasoning and whether the implementation is consistent with it.

## AI tools

Use them.

ChatGPT, Claude, Cursor, Copilot, etc. are allowed.

You own every line you submit. During the follow-up interview we may ask you to:
- explain the calculation path
- change a business rule
- identify a rounding bug
- explain a TypeScript type
- modify an API response
- debug a failed request

Do not submit code you cannot explain.

## Submission

Push the project to a public GitHub repository.

Repository must contain:

- `README.md` — setup/run/test instructions
- `DECISIONS.md` — decisions above, what you noticed, what you would do with another day
- `.env.example` — all environment variables used
- meaningful commit history

A reviewer should be able to clone the repository and see the working application within 10 minutes.

## What we care about

We are not scoring visual polish.

We care about:
- TypeScript quality
- Python quality
- correctness of business logic
- API design
- frontend/backend integration
- validation and error handling
- tests
- product usability
- engineering judgment

A smaller, reliable implementation beats a large, fragile one.
