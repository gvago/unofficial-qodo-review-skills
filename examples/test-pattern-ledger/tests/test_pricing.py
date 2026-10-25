import time
from unittest.mock import Mock

import pytest

from pricing import (
    MAX_QTY,
    PricingError,
    apply_discount,
    from_json,
    line_total,
    to_json,
)


def test_line_total_basic():
    assert line_total(2.5, 4) == 10.0


@pytest.mark.parametrize(
    "qty, ok",
    [(0, False), (1, True), (MAX_QTY, True), (MAX_QTY + 1, False)],
    ids=["below-min", "min", "max", "above-max"],
)
def test_line_total_qty_limits(qty, ok):
    if ok:
        assert line_total(1.0, qty) == float(qty)
    else:
        with pytest.raises(PricingError, match="qty out of range"):
            line_total(1.0, qty)


def test_line_total_rejects_negative_qty():
    with pytest.raises(PricingError, match=r"qty out of range: -3"):
        line_total(9.99, -3)


def test_apply_discount_uses_gateway():
    gateway = Mock()
    gateway.lookup.return_value = 10
    assert apply_discount(200.0, "SAVE10", gateway) == 180.0
    gateway.lookup.assert_called_once_with("SAVE10")


def test_order_json_round_trip():
    order = {"id": 7, "lines": [{"sku": "A", "qty": 2}]}
    assert from_json(to_json(order)) == order


def test_to_json_is_stable():
    order = {"b": 1, "a": 2}
    first = to_json(order)
    second = to_json(order)
    assert first == second


def test_discount_smoke():
    gateway = Mock()
    gateway.lookup.return_value = 5
    result = apply_discount(100.0, "X", gateway)
    assert result is not None


def test_line_total_bad_input():
    with pytest.raises(Exception):
        line_total(1.0, 1000)


def test_pricing_is_fast():
    start = time.time()
    line_total(1.0, 1)
    time.sleep(0.01)
    assert time.time() - start < 1
