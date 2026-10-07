"""HTTP-level tests: request validation, error envelope, persistence and status workflow."""

import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

CATALOG_PATH = Path(__file__).resolve().parents[2] / "data" / "catalog.json"

VALID = {
    "customer_name": "Northwind",
    "seats": 50,
    "line_items": [{"sku": "AGENT-CORE", "quantity": 100}, {"sku": "AGENT-ANALYTICS", "quantity": 100}],
    "discount_pct": 20,
    "annual_commitment": False,
}


ADMIN = {"Authorization": "Bearer test-passcode"}


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(CATALOG_PATH, tmp_path / "quotes.json", admin_passcode="test-passcode"))


def test_catalog_exposes_products_and_rules(client: TestClient):
    body = client.get("/api/catalog").json()
    assert [p["sku"] for p in body["products"]] == ["AGENT-CORE", "AGENT-ANALYTICS", "AGENT-AUTOMATE", "ONBOARDING"]
    assert body["discount_rules"][1] == {"code": "GROWTH", "min_seats": 10, "max_seats": 49, "max_discount_pct": 20.0}
    assert body["approval_rules"] == {
        "discount_above_pct": 15.0,
        "total_above": 25000.0,
        "annual_commitment_discount_above_pct": 10.0,
    }


def test_calculate_returns_authoritative_numbers(client: TestClient):
    res = client.post("/api/quotes/calculate", json={**VALID, "customer_name": ""})
    assert res.status_code == 200
    body = res.json()
    assert {k: body[k] for k in ("tier", "subtotal", "discount_amount", "total", "approval_required")} == {
        "tier": "ENTERPRISE",
        "subtotal": 20000.0,
        "discount_amount": 4000.0,
        "total": 16000.0,
        "approval_required": True,
    }
    assert body["approval_reasons"] == ["discount_above_15_percent"]


def test_business_validation_errors_use_one_envelope_with_field_paths(client: TestClient):
    res = client.post(
        "/api/quotes/calculate",
        json={**VALID, "seats": 9, "discount_pct": 25, "line_items": [{"sku": "GHOST", "quantity": 0}]},
    )
    assert res.status_code == 422
    error = res.json()["error"]
    assert error["code"] == "validation_failed"
    assert [(i["loc"], i["code"]) for i in error["issues"]] == [
        (["line_items", 0, "sku"], "unknown_sku"),
        (["line_items", 0, "quantity"], "quantity_not_positive"),
        (["discount_pct"], "discount_above_tier_max"),
    ]


def test_schema_errors_use_the_same_envelope(client: TestClient):
    res = client.post("/api/quotes/calculate", json={**VALID, "seats": "lots", "discount": 5})
    assert res.status_code == 422
    issues = res.json()["error"]["issues"]
    assert {(tuple(i["loc"]), i["code"]) for i in issues} == {(("seats",), "invalid_type"), (("discount",), "unknown_field")}
    assert any(i["message"] == "Seats must be a whole number." for i in issues)


def test_save_requires_customer_name(client: TestClient):
    res = client.post("/api/quotes", json={**VALID, "customer_name": "  "})
    assert res.status_code == 422
    assert res.json()["error"]["issues"][0]["code"] == "customer_name_required"


def test_save_list_and_fetch_round_trip(client: TestClient):
    created = client.post("/api/quotes", json=VALID)
    assert created.status_code == 201
    quote = created.json()
    assert quote["id"] == "Q-0001" and quote["status"] == "draft"
    assert quote["allowed_transitions"] == [{"status": "submitted", "role": "rep"}]

    listed = client.get("/api/quotes").json()
    assert listed[0]["id"] == "Q-0001" and listed[0]["total"] == 16000.0 and listed[0]["product_count"] == 2
    assert listed[0]["approval_reasons"] == ["discount_above_15_percent"]

    fetched = client.get("/api/quotes/Q-0001").json()
    assert fetched["calculation"] == quote["calculation"]


def test_unknown_quote_is_404(client: TestClient):
    res = client.get("/api/quotes/Q-9999")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "quote_not_found"


def test_status_workflow_allows_only_forward_transitions(client: TestClient):
    client.post("/api/quotes", json=VALID)

    # draft → approved skips review, even for an approver.
    skip = client.patch("/api/quotes/Q-0001/status", json={"status": "approved"}, headers=ADMIN)
    assert skip.status_code == 409 and skip.json()["error"]["code"] == "invalid_transition"

    assert client.patch("/api/quotes/Q-0001/status", json={"status": "submitted"}).status_code == 200
    approved = client.patch(
        "/api/quotes/Q-0001/status", json={"status": "approved", "note": "OK by VP"}, headers=ADMIN
    )
    assert approved.status_code == 200
    body = approved.json()
    assert body["status"] == "approved" and body["allowed_transitions"] == []
    assert [(e["from_status"], e["to_status"], e["actor"]) for e in body["history"]] == [
        (None, "draft", "rep"),
        ("draft", "submitted", "rep"),
        ("submitted", "approved", "admin"),
    ]

    # Terminal: approved → rejected is refused and nothing is written.
    assert client.patch("/api/quotes/Q-0001/status", json={"status": "rejected"}, headers=ADMIN).status_code == 409
    assert client.get("/api/quotes/Q-0001").json()["status"] == "approved"


def test_only_an_approver_can_approve_or_reject(client: TestClient):
    client.post("/api/quotes", json=VALID)
    submitted = client.patch("/api/quotes/Q-0001/status", json={"status": "submitted"}).json()
    assert submitted["allowed_transitions"] == [
        {"status": "approved", "role": "admin"},
        {"status": "rejected", "role": "admin"},
    ]

    # A rep (no credentials) can't decide on their own quote.
    as_rep = client.patch("/api/quotes/Q-0001/status", json={"status": "approved"})
    assert as_rep.status_code == 403 and as_rep.json()["error"]["code"] == "approver_required"

    # A wrong passcode is an authentication failure, not a silent downgrade to rep.
    wrong = client.patch(
        "/api/quotes/Q-0001/status", json={"status": "rejected"}, headers={"Authorization": "Bearer nope"}
    )
    assert wrong.status_code == 401 and wrong.json()["error"]["code"] == "invalid_admin_passcode"
    assert client.get("/api/quotes/Q-0001").json()["status"] == "submitted"

    assert client.patch("/api/quotes/Q-0001/status", json={"status": "rejected"}, headers=ADMIN).status_code == 200


def test_admin_session_checks_the_passcode(client: TestClient):
    assert client.post("/api/admin/session", json={"passcode": "test-passcode"}).status_code == 204
    bad = client.post("/api/admin/session", json={"passcode": "guess"})
    assert bad.status_code == 401 and bad.json()["error"]["code"] == "invalid_admin_passcode"


def test_list_can_be_filtered_to_the_approval_queue(client: TestClient):
    client.post("/api/quotes", json=VALID)
    client.post("/api/quotes", json={**VALID, "customer_name": "Globex"})
    client.patch("/api/quotes/Q-0002/status", json={"status": "submitted"})

    queue = client.get("/api/quotes", params={"status": "submitted"}).json()
    assert [q["id"] for q in queue] == ["Q-0002"]
    assert client.get("/api/quotes", params={"status": "nonsense"}).status_code == 422


def test_saved_quote_keeps_its_prices_when_catalog_changes(tmp_path: Path):
    catalog_copy = tmp_path / "catalog.json"
    shutil.copy(CATALOG_PATH, catalog_copy)
    quotes = tmp_path / "quotes.json"
    TestClient(create_app(catalog_copy, quotes)).post("/api/quotes", json=VALID)

    data = json.loads(catalog_copy.read_text())
    data["products"] = [p for p in data["products"] if p["sku"] != "AGENT-ANALYTICS"]
    next(p for p in data["products"] if p["sku"] == "AGENT-CORE")["unit_price"] = 130
    catalog_copy.write_text(json.dumps(data))

    quote = TestClient(create_app(catalog_copy, quotes)).get("/api/quotes/Q-0001").json()
    assert quote["calculation"]["total"] == 16000.0
    assert {(w["code"], w["sku"]) for w in quote["warnings"]} == {
        ("price_changed", "AGENT-CORE"),
        ("product_removed", "AGENT-ANALYTICS"),
    }


def test_unreadable_storage_is_a_clear_503_not_a_bare_500(tmp_path: Path):
    quotes = tmp_path / "quotes.json"
    quotes.write_text("not json")
    client = TestClient(create_app(CATALOG_PATH, quotes), raise_server_exceptions=False)

    for path in ("/api/quotes", "/api/health"):
        res = client.get(path)
        assert res.status_code == 503
        error = res.json()["error"]
        assert error["code"] == "storage_unavailable" and str(quotes) in error["message"]

    # A path that points at a directory is the classic hosting misconfiguration.
    assert "is a directory" in TestClient(create_app(CATALOG_PATH, tmp_path)).get("/api/quotes").json()["error"]["message"]
