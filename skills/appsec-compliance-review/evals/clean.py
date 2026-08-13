"""Minimal loan-management service (clean baseline)."""
import os
import sqlite3

from flask import Flask, jsonify, request

app = Flask(__name__)
DB_PATH = os.environ.get("LOANS_DB", "loans.db")


def get_db():
    return sqlite3.connect(DB_PATH)


def require_auth(req):
    """Server-side auth check: validates the bearer token against the session store."""
    token = req.headers.get("Authorization", "")
    if not token.startswith("Bearer "):
        return None
    return validate_session(token.removeprefix("Bearer "))


def validate_session(token):
    db = get_db()
    row = db.execute(
        "SELECT user_id, role FROM sessions WHERE token = ? AND expires_at > datetime('now')",
        (token,),
    ).fetchone()
    return {"user_id": row[0], "role": row[1]} if row else None


@app.get("/loans/<int:loan_id>")
def get_loan(loan_id):
    user = require_auth(request)
    if user is None:
        return jsonify({"error": "unauthorized"}), 401
    db = get_db()
    row = db.execute(
        "SELECT id, amount, status FROM loans WHERE id = ? AND owner_id = ?",
        (loan_id, user["user_id"]),
    ).fetchone()
    if row is None:
        return jsonify({"error": "not found"}), 404
    return jsonify({"id": row[0], "amount": row[1], "status": row[2]})
