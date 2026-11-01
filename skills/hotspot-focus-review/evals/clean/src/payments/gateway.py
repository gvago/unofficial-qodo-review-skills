from typing import Protocol


class TransientPaymentError(Exception):
    pass


class Gateway(Protocol):
    def create_charge(self, *, amount_minor: int, currency: str, idempotency_key: str) -> dict:
        ...
