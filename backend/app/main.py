"""FastAPI application: HTTP wiring only. Business rules live in ``pricing.py``."""

from __future__ import annotations

import logging
import os
import secrets
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import pricing
from .catalog import Catalog, load_catalog
from .models import (
    AdminSessionIn,
    ApprovalRulesOut,
    CalculationOut,
    CatalogOut,
    DiscountRuleOut,
    ErrorOut,
    IssueOut,
    ProductOut,
    QuoteDraftIn,
    QuoteOut,
    QuoteStatus,
    QuoteSummaryOut,
    QuoteWarningOut,
    StatusChangeIn,
    StatusEventOut,
    TransitionOut,
)
from .store import QuoteStore, Record, StorageError
from .workflow import Role, allowed_next, can_act, required_role

log = logging.getLogger("deal_desk")

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CATALOG_PATH = REPO_ROOT / "data" / "catalog.json"
DEFAULT_QUOTES_PATH = REPO_ROOT / "backend" / "var" / "quotes.json"
DEFAULT_ADMIN_PASSCODE = "approver"


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str, issues: list[pricing.Issue] | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.issues = issues or []


def _error_response(status_code: int, code: str, message: str, issues: list[IssueOut]) -> JSONResponse:
    body = ErrorOut.model_validate({"error": {"code": code, "message": message, "issues": issues}})
    return JSONResponse(status_code=status_code, content=body.model_dump(mode="json"))


def _validation_error(issues: list[pricing.Issue]) -> ApiError:
    noun = "problem" if len(issues) == 1 else "problems"
    return ApiError(422, "validation_failed", f"The quote has {len(issues)} {noun} to fix.", issues)


# Friendly wording for schema-level (type) errors, keyed by the field name.
_TYPE_ERROR_MESSAGES = {
    "seats": "Seats must be a whole number.",
    "quantity": "Quantity must be a whole number.",
    "discount_pct": "Discount must be a number.",
    "annual_commitment": "Annual commitment must be true or false.",
    "customer_name": "Customer name must be text.",
    "sku": "Product SKU must be text.",
    "status": "Status must be one of draft, submitted, approved or rejected.",
}


def _schema_issue(error: dict[str, Any]) -> IssueOut:
    loc = [part for part in error["loc"] if part != "body"]
    if error["type"] == "extra_forbidden":
        return IssueOut(loc=loc, code="unknown_field", message=f"Unknown field “{loc[-1]}”.")
    field = next((part for part in reversed(loc) if isinstance(part, str)), "")
    message = _TYPE_ERROR_MESSAGES.get(field, error.get("msg", "Invalid value."))
    return IssueOut(loc=loc, code="invalid_type", message=message)


def create_app(
    catalog_path: Path | None = None,
    quotes_path: Path | None = None,
    admin_passcode: str | None = None,
) -> FastAPI:
    catalog = load_catalog(catalog_path or Path(os.getenv("DEAL_DESK_CATALOG_PATH", DEFAULT_CATALOG_PATH)))
    store = QuoteStore(quotes_path or Path(os.getenv("DEAL_DESK_QUOTES_PATH", DEFAULT_QUOTES_PATH)))
    passcode = admin_passcode or os.getenv("DEAL_DESK_ADMIN_PASSCODE", DEFAULT_ADMIN_PASSCODE)

    def is_passcode(candidate: str) -> bool:
        return secrets.compare_digest(candidate.encode(), passcode.encode())

    def current_role(authorization: Annotated[str | None, Header()] = None) -> Role:
        """No credentials → rep. ``Authorization: Bearer <passcode>`` → admin. Anything else → 401.

        This is a shared-passcode gate for a demo, not real authentication: see DECISIONS.md.
        """
        if authorization is None:
            return "rep"
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() == "bearer" and is_passcode(token.strip()):
            return "admin"
        raise ApiError(401, "invalid_admin_passcode", "The approver passcode is wrong or has changed. Sign in again.")

    app = FastAPI(title="Deal Desk API", version="1.0.0")
    origins = os.getenv("DEAL_DESK_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[origin.strip() for origin in origins.split(",") if origin.strip()],
        allow_methods=["GET", "POST", "PATCH"],
        allow_headers=["Content-Type", "Authorization"],
    )

    @app.exception_handler(ApiError)
    async def handle_api_error(_: Request, exc: ApiError) -> JSONResponse:
        issues = [IssueOut(loc=list(i.loc), code=i.code, message=i.message) for i in exc.issues]
        return _error_response(exc.status_code, exc.code, exc.message, issues)

    @app.exception_handler(StorageError)
    async def handle_storage_error(_: Request, exc: StorageError) -> JSONResponse:
        log.error("Quote storage failure: %s", exc)
        return _error_response(503, "storage_unavailable", str(exc), [])

    @app.exception_handler(Exception)
    async def handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
        # Full traceback goes to the server log; the client gets the same JSON envelope as every other error.
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return _error_response(
            500, "internal_error", f"Unexpected server error ({type(exc).__name__}). Details are in the server log.", []
        )

    @app.exception_handler(RequestValidationError)
    async def handle_schema_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        issues = [_schema_issue(error) for error in exc.errors()]
        noun = "problem" if len(issues) == 1 else "problems"
        return _error_response(422, "validation_failed", f"The request has {len(issues)} {noun} to fix.", issues)

    # -- health ---------------------------------------------------------------

    @app.get("/api/health", responses={503: {"model": ErrorOut}})
    def health() -> dict[str, Any]:
        """Checks the catalog loaded and quote storage is readable. Useful right after a deploy."""
        return {
            "status": "ok",
            "catalog_products": len(catalog.products),
            "quotes_path": str(store.path),
            "saved_quotes": len(store.list()),  # raises StorageError → 503 with the reason
        }

    # -- catalog --------------------------------------------------------------

    @app.get("/api/catalog", response_model=CatalogOut)
    def get_catalog() -> CatalogOut:
        return CatalogOut(
            currency=catalog.currency,
            products=[ProductOut(sku=p.sku, name=p.name, unit_price=p.unit_price) for p in catalog.products.values()],
            discount_rules=[
                DiscountRuleOut(
                    code=r.code, min_seats=r.min_seats, max_seats=r.max_seats, max_discount_pct=r.max_discount_pct
                )
                for r in catalog.discount_rules
            ],
            approval_rules=ApprovalRulesOut(
                discount_above_pct=pricing.APPROVAL_DISCOUNT_ABOVE_PCT,
                total_above=pricing.APPROVAL_TOTAL_ABOVE,
                annual_commitment_discount_above_pct=pricing.APPROVAL_ANNUAL_DISCOUNT_ABOVE_PCT,
            ),
        )

    # -- approver session -----------------------------------------------------

    @app.post("/api/admin/session", status_code=204, responses={401: {"model": ErrorOut}})
    def admin_sign_in(body: AdminSessionIn) -> Response:
        """Checks an approver passcode. The client then sends it as ``Authorization: Bearer …``."""
        if not is_passcode(body.passcode):
            raise ApiError(401, "invalid_admin_passcode", "That passcode isn't right.")
        return Response(status_code=204)

    # -- quotes ---------------------------------------------------------------

    def price(draft: QuoteDraftIn, *, require_customer: bool) -> pricing.Calculation:
        try:
            return pricing.calculate(draft.to_domain(), catalog, require_customer=require_customer)
        except pricing.QuoteInvalid as exc:
            raise _validation_error(exc.issues) from exc

    @app.post(
        "/api/quotes/calculate",
        response_model=CalculationOut,
        responses={422: {"model": ErrorOut}},
    )
    def calculate_quote(draft: QuoteDraftIn) -> CalculationOut:
        return CalculationOut.from_domain(price(draft, require_customer=False))

    @app.post(
        "/api/quotes",
        response_model=QuoteOut,
        status_code=201,
        responses={422: {"model": ErrorOut}},
    )
    def create_quote(draft: QuoteDraftIn) -> QuoteOut:
        calculation = CalculationOut.from_domain(price(draft, require_customer=True))
        now = datetime.now(UTC)

        def build(quote_id: str) -> Record:
            return {
                "id": quote_id,
                "status": "draft",
                "customer_name": draft.customer_name.strip(),
                "created_at": now.isoformat(),
                "updated_at": now.isoformat(),
                "calculation": calculation.model_dump(mode="json"),
                "history": [StatusEventOut(from_status=None, to_status="draft", at=now).model_dump(mode="json")],
            }

        return _quote_out(store.create(build), catalog)

    @app.get("/api/quotes", response_model=list[QuoteSummaryOut])
    def list_quotes(status: Annotated[QuoteStatus | None, Query()] = None) -> list[QuoteSummaryOut]:
        """Newest first. ``?status=submitted`` gives the approval queue."""
        records = sorted(store.list(), key=lambda r: r["created_at"], reverse=True)
        return [_summary_out(r) for r in records if status is None or r["status"] == status]

    @app.get("/api/quotes/{quote_id}", response_model=QuoteOut, responses={404: {"model": ErrorOut}})
    def get_quote(quote_id: str) -> QuoteOut:
        record = store.get(quote_id)
        if record is None:
            raise _not_found(quote_id)
        return _quote_out(record, catalog)

    @app.patch(
        "/api/quotes/{quote_id}/status",
        response_model=QuoteOut,
        responses={
            401: {"model": ErrorOut},
            403: {"model": ErrorOut},
            404: {"model": ErrorOut},
            409: {"model": ErrorOut},
            422: {"model": ErrorOut},
        },
    )
    # The dependency is a default value (not Annotated) because current_role is local to create_app,
    # and string annotations can't see locals.
    def change_status(quote_id: str, change: StatusChangeIn, actor: Role = Depends(current_role)) -> QuoteOut:
        def apply(record: Record) -> Record:
            current = record["status"]
            needed = required_role(current, change.status)
            if needed is None:
                allowed = [target for target, _ in allowed_next(current)]
                hint = f"Allowed next: {', '.join(allowed)}." if allowed else f"“{current}” is a final status."
                raise ApiError(
                    409,
                    "invalid_transition",
                    f"Cannot move a quote from “{current}” to “{change.status}”. {hint}",
                )
            if not can_act(actor, needed):
                raise ApiError(
                    403,
                    "approver_required",
                    f"Only an approver can move a quote to “{change.status}”. Sign in on the Approvals page.",
                )
            now = datetime.now(UTC)
            event = StatusEventOut(
                from_status=current, to_status=change.status, at=now, note=change.note, actor=actor
            )
            return {
                **record,
                "status": change.status,
                "updated_at": now.isoformat(),
                "history": [*record["history"], event.model_dump(mode="json")],
            }

        updated = store.update(quote_id, apply)
        if updated is None:
            raise _not_found(quote_id)
        return _quote_out(updated, catalog)

    return app


def _not_found(quote_id: str) -> ApiError:
    return ApiError(404, "quote_not_found", f"No quote with id “{quote_id}”.")


def _quote_out(record: Record, catalog: Catalog) -> QuoteOut:
    calculation = CalculationOut.model_validate(record["calculation"])
    return QuoteOut(
        id=record["id"],
        status=record["status"],
        customer_name=record["customer_name"],
        created_at=record["created_at"],
        updated_at=record["updated_at"],
        calculation=calculation,
        history=[StatusEventOut.model_validate(e) for e in record["history"]],
        allowed_transitions=[TransitionOut(status=t, role=r) for t, r in allowed_next(record["status"])],
        warnings=_catalog_drift(calculation, catalog),
    )


def _summary_out(record: Record) -> QuoteSummaryOut:
    calc = CalculationOut.model_validate(record["calculation"])
    return QuoteSummaryOut(
        id=record["id"],
        status=record["status"],
        customer_name=record["customer_name"],
        created_at=record["created_at"],
        updated_at=record["updated_at"],
        seats=calc.seats,
        tier=calc.tier,
        product_count=len(calc.lines),
        discount_pct=calc.discount_pct,
        total=calc.total,
        approval_required=calc.approval_required,
        approval_reasons=calc.approval_reasons,
    )


def _catalog_drift(calculation: CalculationOut, catalog: Catalog) -> list[QuoteWarningOut]:
    """Saved quotes keep the prices they were saved with; flag where the live catalog now differs."""
    warnings = []
    for line in calculation.lines:
        product = catalog.product(line.sku)
        if product is None:
            warnings.append(
                QuoteWarningOut(
                    code="product_removed",
                    sku=line.sku,
                    message=f"{line.name} ({line.sku}) is no longer in the catalog. "
                    f"This quote keeps its saved price of {pricing.format_money(line.unit_price)}.",
                )
            )
        elif product.unit_price != line.unit_price:
            warnings.append(
                QuoteWarningOut(
                    code="price_changed",
                    sku=line.sku,
                    message=f"{line.name} now lists at {pricing.format_money(product.unit_price)}; "
                    f"this quote keeps its saved price of {pricing.format_money(line.unit_price)}.",
                )
            )
    return warnings


app = create_app()
