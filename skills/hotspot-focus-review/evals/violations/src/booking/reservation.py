from datetime import datetime


def reserve(store, booking_id: str, price: str, quantity: int) -> dict:
    booking = {
        "id": booking_id,
        "created_at": datetime.now().isoformat(),
        "total": float(price) * quantity,
        "currency": "USD",
    }
    store.save(booking)
    return booking
