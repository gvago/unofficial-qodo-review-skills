import logging
from time import sleep
from .gateway import Gateway, TransientPaymentError

logger = logging.getLogger(__name__)


def charge(gateway: Gateway, booking_id: str, amount_minor: int, correlation_id: str) -> dict:
    for attempt in range(3):
        try:
            return gateway.create_charge(
                amount_minor=amount_minor, currency="USD", idempotency_key=booking_id
            )
        except TransientPaymentError:
            if attempt == 2:
                logger.exception("payment_failed", extra={"correlation_id": correlation_id})
                raise
            sleep(0.1 * 2 ** attempt)
    raise RuntimeError("unreachable")
