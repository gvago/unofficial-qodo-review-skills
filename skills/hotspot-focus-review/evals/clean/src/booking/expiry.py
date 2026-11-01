from datetime import datetime, timezone


def is_expired(deadline: str) -> bool:
    instant = datetime.fromisoformat(deadline)
    if instant.tzinfo is None or instant.utcoffset() is None:
        raise ValueError("deadline must include a UTC offset")
    return datetime.now(timezone.utc) >= instant
