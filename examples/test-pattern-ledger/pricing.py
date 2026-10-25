"""Pricing helpers."""
import json

MAX_QTY = 100


class PricingError(ValueError):
    pass


def line_total(unit_price: float, qty: int) -> float:
    if qty < 1 or qty > MAX_QTY:
        raise PricingError(f"qty out of range: {qty}")
    return round(unit_price * qty, 2)


def apply_discount(total: float, code: str, gateway) -> float:
    pct = gateway.lookup(code)
    return round(total * (1 - pct / 100), 2)


def to_json(order: dict) -> str:
    return json.dumps(order, sort_keys=True)


def from_json(raw: str) -> dict:
    return json.loads(raw)
