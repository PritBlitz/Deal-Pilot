"""Loads the product catalog and seat-tier rules from the supplied JSON file.

The catalog is read once at startup and treated as read-only. Prices are parsed
into ``Decimal`` immediately so no float ever touches money arithmetic.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path


@dataclass(frozen=True)
class Product:
    sku: str
    name: str
    unit_price: Decimal


@dataclass(frozen=True)
class DiscountRule:
    code: str
    min_seats: int
    max_seats: int
    max_discount_pct: Decimal

    def covers(self, seats: int) -> bool:
        return self.min_seats <= seats <= self.max_seats


@dataclass(frozen=True)
class Catalog:
    currency: str
    products: dict[str, Product]
    discount_rules: tuple[DiscountRule, ...]

    def product(self, sku: str) -> Product | None:
        return self.products.get(sku)

    def tier_for(self, seats: int) -> DiscountRule | None:
        """Return the rule whose seat range contains ``seats``, or None if no rule does."""
        return next((rule for rule in self.discount_rules if rule.covers(seats)), None)

    @property
    def max_seats(self) -> int:
        return max(rule.max_seats for rule in self.discount_rules)


def _decimal(value: object) -> Decimal:
    # str() first so a JSON float such as 0.1 becomes Decimal("0.1"), not its binary expansion.
    return Decimal(str(value))


def load_catalog(path: Path) -> Catalog:
    raw = json.loads(path.read_text(encoding="utf-8"))

    products = {
        item["sku"]: Product(sku=item["sku"], name=item["name"], unit_price=_decimal(item["unit_price"]))
        for item in raw["products"]
    }
    rules = tuple(
        sorted(
            (
                DiscountRule(
                    code=item["code"],
                    min_seats=int(item["min_seats"]),
                    max_seats=int(item["max_seats"]),
                    max_discount_pct=_decimal(item["max_discount_pct"]),
                )
                for item in raw["discount_rules"]
            ),
            key=lambda rule: rule.min_seats,
        )
    )
    return Catalog(currency=raw["currency"], products=products, discount_rules=rules)
