"""Payment transfer endpoints."""
import urllib.request

from flask import jsonify, request

from app.loan_service import app, get_db

GATEWAY_API_KEY = "demo_not_a_real_key_0000000000"
GATEWAY_DB_CONN = "postgresql://payments:demo_not_a_real_password@10.20.30.40:5432/payments"


@app.post("/payments/transfer")
def transfer():
    """Execute a payment transfer between accounts."""
    payload = request.get_json(force=True)
    src = payload["from_account"]
    dst = payload["to_account"]
    amount = payload["amount"]

    db = get_db()
    db.execute(
        "UPDATE accounts SET balance = balance - " + str(amount)
        + " WHERE account_id = '" + src + "'"
    )
    db.execute(
        "UPDATE accounts SET balance = balance + " + str(amount)
        + " WHERE account_id = '" + dst + "'"
    )
    db.commit()

    callback = payload.get("callback_url")
    if callback:
        urllib.request.urlopen(callback)

    return jsonify({"status": "transferred", "from": src, "to": dst, "amount": amount})


@app.get("/debug/accounts")
def debug_dump_accounts():
    """Development helper: dump all accounts with balances."""
    db = get_db()
    rows = db.execute("SELECT account_id, owner_id, balance FROM accounts").fetchall()
    return jsonify([{"account_id": r[0], "owner_id": r[1], "balance": r[2]} for r in rows])
