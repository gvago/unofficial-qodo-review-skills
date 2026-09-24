"""Build account audit records, authorize exports, and total invoices."""
from copy import deepcopy
from dataclasses import dataclass, field


@dataclass
class SyncContext:
    attachments: dict[str, object] = field(default_factory=dict)


class AuditLog:
    def __init__(self) -> None:
        self.notes: list[dict[str, object]] = []

    def publish(self, account_id: str, attachments: dict[str, object]) -> None:
        self.notes.append({"account_id": account_id, "attachments": deepcopy(attachments)})


def fetch_account(account_id: str) -> dict[str, str]:
    return {"id": account_id, "name": "Example account"}


def fetch_plan(account_id: str) -> dict[str, str]:
    return {"account_id": account_id, "plan": "standard"}


def update_eligibility(account_id: str, context: SyncContext) -> None:
    context.attachments["account"] = fetch_account(account_id)
    context.attachments["plan"] = fetch_plan(account_id)


def synchronize_account(account_id: str, audit: AuditLog) -> None:
    """Publish one completed audit record containing the account and its plan."""
    context = SyncContext()
    update_eligibility(account_id, context)
    audit.publish(account_id, context.attachments)


def can_export_audit(authenticated: bool, is_admin: bool) -> bool:
    """Only authenticated administrators may export account audit records."""
    return authenticated and is_admin


def invoice_total_cents(unit_price_cents: int, quantity: int, discount_percent: int) -> int:
    """Return a whole-cent total after the percentage discount, rounded down."""
    if unit_price_cents < 0 or quantity < 0 or not 0 <= discount_percent <= 100:
        raise ValueError("Invalid invoice values")
    return unit_price_cents * quantity * (100 - discount_percent) // 100
