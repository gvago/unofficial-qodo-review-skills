from datetime import datetime, timezone


def is_expired(deadline: str) -> bool:
    return datetime.now(timezone.utc) >= datetime.fromisoformat(deadline)
