from pricing import line_total


def test_line_total_basic():
    assert line_total(2.5, 4) == 10.0
