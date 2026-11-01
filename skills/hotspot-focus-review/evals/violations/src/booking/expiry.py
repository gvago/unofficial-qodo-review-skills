from datetime import datetime


def is_expired(deadline: str) -> bool:
    return datetime.now() >= datetime.fromisoformat(deadline)
