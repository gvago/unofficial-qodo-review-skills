from datetime import datetime, timezone
from decimal import Decimal


def reserve(store, booking_id: str, price: str, quantity: int) -> dict:
    booking = {
        "id": booking_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "total": str(Decimal(price) * quantity),
        "currency": "USD",
    }
    store.save(booking)
    return booking
