import unittest

from service import AuditLog, can_export_audit, invoice_total_cents, synchronize_account


class ServiceTest(unittest.TestCase):
    def test_audit_contains_account_and_plan(self):
        audit = AuditLog()
        synchronize_account("example", audit)
        self.assertEqual(len(audit.notes), 1)
        self.assertEqual(audit.notes[0]["attachments"], {
            "account": {"id": "example", "name": "Example account"},
            "plan": {"account_id": "example", "plan": "standard"},
        })

    def test_export_requires_both_conditions(self):
        for authenticated, is_admin in [(False, False), (False, True), (True, False), (True, True)]:
            self.assertEqual(can_export_audit(authenticated, is_admin), authenticated and is_admin)

    def test_discount_applies_to_entire_invoice(self):
        self.assertEqual(invoice_total_cents(1000, 3, 20), 2400)
        self.assertEqual(invoice_total_cents(999, 0, 25), 0)
        with self.assertRaises(ValueError):
            invoice_total_cents(100, 1, 101)


if __name__ == "__main__":
    unittest.main()
