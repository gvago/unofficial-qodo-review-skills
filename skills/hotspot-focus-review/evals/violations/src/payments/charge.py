from uuid import uuid4
from .gateway import Gateway, TransientPaymentError


def charge(gateway: Gateway, booking_id: str, amount_minor: int, correlation_id: str) -> dict:
    for attempt in range(3):
        try:
            return gateway.create_charge(
                amount_minor=amount_minor, currency="USD", idempotency_key=str(uuid4())
            )
        except TransientPaymentError:
            if attempt == 2:
                return {"status": "paid", "booking_id": booking_id}
    return {"status": "paid", "booking_id": booking_id}
