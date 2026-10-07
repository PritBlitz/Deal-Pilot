# Decisions

## The seven questions

### 1. What happens if the same product is added twice?

**It's rejected, not merged.** The API returns `duplicate_sku` on the second line ("Agent Core is already on line 1. Change that line's quantity instead."). The UI tries to prevent it in the first place: a product already used on another line is disabled in the dropdown and labelled "(already added)".

Why not merge silently? Two lines of the same SKU usually mean a mistake, such as a rep who meant to pick a different product. Merging would hide that and change the line count without telling anyone. Merging also has no good answer if the two lines ever carry different terms. Rejecting with a clear message is both predictable and easy to explain.

### 2. Is a 0% discount represented as `0` or omitted?

**`0`, explicitly, everywhere the system writes it.** Responses and stored quotes always contain `"discount_pct": 0`. The frontend always sends it, and an empty discount box is sent as `0`.

On input, the API accepts an omitted `discount_pct` and treats it as `0`. That is the only safe default, because no discount can never break a policy. Every other field must be valid or present, and a misspelled key (`"discount": 20`) is rejected as an unknown field, so the lenient default can't silently price a quote at 0% by accident.

### 3. How do you handle money and rounding? Why?

- **Backend:** all arithmetic uses Python `Decimal`. The catalog is parsed as `Decimal(str(x))`, so no float ever touches a price.
- `line_total = quantity × unit_price` and `subtotal` are **exact**: integer × catalog price, so nothing to round.
- `discount_amount = subtotal × pct / 100` is the **only** value that can have fractional cents. It is rounded **once**, to the cent, **half-up** (`ROUND_HALF_UP`). Half-up is what customers and finance expect on an invoice. Banker's rounding (Python's default) would surprise them.
- `total = subtotal − discount_amount` is computed **from the rounded discount**, so `subtotal − discount = total` always holds exactly on the document. Rounding the total separately could leave the three lines a cent apart.
- **Approval thresholds compare the rounded values**, the numbers the customer actually sees. A total of exactly `$25,000.00` does not need approval; `$25,000.01` does (tested).
- `discount_pct` may have at most 2 decimal places (`discount_too_precise` otherwise). This blocks float noise such as `15.000000000000002`.
- **Wire format:** JSON numbers, matching the example in the brief. Every value is already a whole number of cents, and such values round-trip exactly through an IEEE double for any realistic amount. The JSON file stores the same numbers and reads them back with `Decimal(str(x))`. A test checks that the saved and re-read calculation is identical.
- **Frontend:** displays these numbers and never does arithmetic on them. The one exception is the "B is $X more than A" sentence in the comparison, which is done in integer cents and is display-only.

### 4. Does an annual commitment change pricing, or only approval logic?

**Only approval.** The brief defines no price effect, and inventing one (e.g. an extra 5% off) would be a business rule nobody asked for. With an annual commitment, any discount above 10% needs approval. The UI says this next to the toggle ("Doesn't change the price…"). The discount scale also draws the 10% threshold when the toggle is on. A test asserts that the same quote with and without commitment has the same total.

### 5. What happens if a product disappears from the catalog after a quote was saved?

**A saved quote is a snapshot.** When a quote is saved, its full calculation is stored with it: each line's name, SKU, unit price, line total, the tier and the verdict. Reading a quote never re-prices it. That's what was quoted to the customer, and a reviewer must approve what the customer saw.

When the live catalog no longer matches, `GET /api/quotes/{id}` adds `warnings`:

- `product_removed`: "Agent Analytics (AGENT-ANALYTICS) is no longer in the catalog. This quote keeps its saved price of $80."
- `price_changed`: "Agent Core now lists at $130; this quote keeps its saved price of $120."

The review page shows these above the line items, so the reviewer can decide whether to reject. Approval is not blocked automatically. Whether a retired product can still be sold is a business call, not something code should guess. Starting a new quote from an old one goes through validation again, so a removed SKU is flagged there ("not in catalog") before it can be saved again. Covered by `test_saved_quote_keeps_its_prices_when_catalog_changes`.

### 6. Where should business rules live so the frontend and backend cannot disagree?

**In one place: `backend/app/pricing.py`.** It is pure Python with no I/O and no framework types. Tier lookup, validation, arithmetic, approval reasons, and the "Explain pricing" text are all there.

The frontend never decides anything:

- The quote sheet, the tier, every money figure, the approval verdict and its reasons all come from `POST /api/quotes/calculate`. The builder calls it 250 ms after typing stops, cancels outdated requests, and ignores any response for a draft that has since changed.
- Validation messages come from the API, carrying a `loc` path that the UI maps back to the input (`["line_items", 2, "quantity"]` → that row's quantity box). The frontend doesn't repeat any rule; it only decides *when* to show an error: after a field is touched, or after a save attempt.
- The UI does use rule **data** from `GET /api/catalog` for *guidance*: the seat-tier ruler highlights the tier as you type, and the discount scale draws the tier cap and approval thresholds. That's data from the API, not a second copy of hard-coded rules. It never controls what is shown as the price or the verdict.

A shared rules package (e.g. JSON-schema or generated code used by both sides) would let the UI validate offline, but it doubles the surface to test and keep in sync. For an internal tool that always needs the API anyway, one authority is the better trade.

### 7. Which status transitions are allowed?

```
draft ──(rep)──► submitted ──(approver)──► approved
                     │
                     └───────(approver)──► rejected
```

| From | Allowed to | Who may do it |
| --- | --- | --- |
| `draft` | `submitted` | rep (or approver) |
| `submitted` | `approved`, `rejected` | approver only |
| `approved` | *(final)* | – |
| `rejected` | *(final)* | – |

- No skipping review: `draft → approved` is refused (409), even for an approver. That's the point of a desk.
- **Separation of duties.** A rep must not approve their own quote, so approve/reject require the approver role, and **the API enforces it**: a request without credentials gets `403 approver_required`. Hiding the buttons in the rep UI is only a convenience. The roles live in `workflow.py` next to the transitions (`TRANSITIONS[(from, to)] = role`), so changing who can do what is a one-line edit.
- Reps and approvers get **separate routes**: `/quotes/...` for reps and `/admin/...` for approvers (a sign-in gate, the queue, and the decision page). Both reuse one review component in two modes, so they can't drift apart.
- Every quote goes through submission, even one within policy. The verdict tells the reviewer *how much* scrutiny it needs, not whether it gets reviewed at all. Auto-approving within-policy quotes is an easy rule to add later in `workflow.py` if the team wants it.
- `approved` and `rejected` are final, so the record honestly shows what was decided. To revise a rejected quote, the rep uses **"Start a new quote from this one"**, which pre-fills the builder and saves as a new quote. Nothing is overwritten.
- Each transition is appended to `history` with a timestamp, the acting role and an optional note (audit trail). The transition check and the write happen under the same store lock, so two reviewers can't both decide.

---

## Other decisions worth knowing

- **One error format.** Pydantic type errors and business-rule issues are converted to the same `{error: {code, message, issues[{loc, code, message}]}}` shape, with plain-language messages ("Seats must be a whole number.", not "int_parsing"). All issues are reported at once, so the rep fixes everything in one pass.
- **Schema fields are optional, rules are strict.** `seats`, `quantity` and friends are `Optional` in the Pydantic model so a half-finished draft reaches the business validator and gets a specific message ("Enter the number of seats.") instead of a generic "field required".
- **Preview vs save.** `/calculate` doesn't require a customer name; `POST /api/quotes` does. Otherwise identical validation.
- **Seat count and quantities are independent.** The brief doesn't link them (Implementation is clearly not per-seat), so neither does the code.
- **The top tier's `max_seats: 99999`** is treated as a real limit (100,000 seats → `seats_out_of_range`) because the data says so, and it is shown as "50+ seats" in the UI.
- **Quote ids** are sequential (`Q-0001`) and easy to read aloud in a review meeting.
- **Draft recovery** stores the form (both scenarios) in `localStorage` under a versioned key, checks its shape on load, and ignores it if it's corrupt. It is cleared on successful save and skipped when the form is empty.
- **Approver access is a shared passcode** (`DEAL_DESK_ADMIN_PASSCODE`, default `approver`), checked by the API on every decision with a constant-time comparison. A wrong passcode is a `401`, not a silent downgrade to rep. The browser holds it **in memory only** and the `/admin` layout signs out when you leave, so every visit to Approvals (and every refresh) asks for the passcode again. Moving between the queue and a quote inside `/admin` does not re-prompt. I chose this deliberately as the smallest honest version of "only approvers decide". Real deployments need per-user accounts (SSO) so history can name *who* approved; that's first on the list below.
- **Optimistic status changes:** the review page shows the new status at once and rolls back with the server's message if the API refuses it (e.g. another reviewer got there first).

## Design

The quote is presented as a **document**: warm paper background, a brighter "sheet" for the quote itself, serif display type for names and totals (Instrument Serif), monospaced tabular figures so money columns line up (IBM Plex Mono), and a neutral grotesque for UI (Schibsted Grotesk). Colour is used only for meaning: amber means needs approval (attention, not failure), green means within policy, red means something to fix. There are no decorative gradients, icons-as-decoration or card grids. The discount scale and seat-tier ruler show the *consequence* of an input before the rep commits to it.

## Frontend tests

`npm test` runs two suites (Vitest + Testing Library):

- `draft.test.ts`: the form → API request mapping (empty means `null`, empty discount means `0`, invalid input passes through untouched for the API to explain) and the API-issue → input mapping by line identity rather than array index.
- `QuoteSheet.test.tsx`: the sheet shows API figures, tier, approval reasons and the explanation, and it **hides stale numbers** behind a clickable fix-list when the draft is invalid. Showing an old total next to an invalid draft would be the most damaging UI bug here.

With more time I'd add a Playwright test of the full flow against the real API. I ran that flow by hand with a scripted browser while building this; it isn't committed.

## What I noticed

- The brief's example response doesn't match its own rule: `subtotal 12000`, `discount_amount 1800` means a discount of exactly 15%, yet it shows `approval_required: true` with `discount_above_15_percent`. The rule says *above* 15%, so this API returns `approval_required: false` for that quote. I followed the written rule and read the example as showing the response *shape* only (covered by `test_discount_of_exactly_15_does_not_need_approval_but_15_01_does`).
- The example response in the brief has no line breakdown. I added `lines` and `max_discount_pct` so the UI never has to compute or look anything up.
- The approval rule "discount above 15%" can't trigger for Starter (max 10%), and "annual and above 10%" can't trigger for Starter either. Both are only reachable from Growth upward. That is consistent, just worth knowing when testing.
- `total > $25,000` is checked **after** discount, so a discount can move a quote under the threshold. That is intentional and covered by a test.

## With another day

1. **Postgres** (`quotes`, `quote_lines`, `status_events` tables; `NUMERIC(12,2)` for money). Move to it behind the same `QuoteStore` interface; the existing JSON file can be imported once by a small script.
2. **Real accounts (SSO)** instead of the shared approver passcode, so history records *who* approved, not just the role, and reps only see their own quotes.
3. **Edit a draft in place** (`PUT /api/quotes/{id}` while `draft`) instead of only "new quote from this one".
4. A Playwright end-to-end test in CI, plus Docker Compose for one-command start.
5. An OpenAPI → TypeScript type generator, so `lib/types.ts` can't drift from `models.py`.
