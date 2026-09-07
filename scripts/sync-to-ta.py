#!/usr/bin/env python3
"""Sync stock holdings from investment-controller to TradingAgents-AShare tracking board.

Usage:
    python3 scripts/sync-to-ta.py

Reads portfolio/current_holdings.json and updates the TA SQLite database.
"""
import json
import os
import sqlite3
import sys
from pathlib import Path
from uuid import uuid4
from datetime import datetime, timezone

ROOT_DIR = Path(__file__).resolve().parent.parent
HOLDINGS_PATH = Path(os.environ.get("HOLDINGS_FILE", ROOT_DIR / "portfolio" / "current_holdings.json"))
TA_DB_PATH = Path(os.environ.get("TA_DB_PATH", Path.home() / "TradingAgents-AShare" / "tradingagents.db"))
TA_USER_ID = os.environ.get("TA_USER_ID")
TA_SOURCE = os.environ.get("TA_SOURCE", "investment_controller")


def sync():
    if not TA_USER_ID:
        print("❌ TA_USER_ID is required.")
        sys.exit(1)
    if not HOLDINGS_PATH.exists():
        print(f"❌ Holdings file not found: {HOLDINGS_PATH}")
        sys.exit(1)
    if not TA_DB_PATH.exists():
        print(f"❌ TA database not found: {TA_DB_PATH}")
        sys.exit(1)

    with open(HOLDINGS_PATH) as f:
        holdings = json.load(f)

    stocks = holdings.get("holdings", {}).get("stocks", holdings.get("stocks", []))
    if not stocks:
        print("⚠️  No stocks in holdings file, nothing to sync.")
        return

    now = datetime.now(timezone.utc).isoformat()
    conn = sqlite3.connect(str(TA_DB_PATH))

    # Clear only this integration's previous rows.
    deleted = conn.execute(
        "DELETE FROM imported_portfolio_positions WHERE user_id=? AND source=?",
        (TA_USER_ID, TA_SOURCE),
    ).rowcount

    # Insert new
    inserted = 0
    for stock in stocks:
        code = stock.get("code") or stock.get("stock_code")
        name = stock.get("name") or stock.get("stock_name")
        shares = stock.get("shares")
        cost_price = stock.get("cost_price")
        if not code or not name or shares is None:
            print(f"⚠️  Skipping incomplete stock row: {stock}")
            continue
        suffix = ".SH" if code.startswith("6") else ".SZ"
        symbol = code + suffix
        conn.execute(
            """INSERT INTO imported_portfolio_positions
            (id, user_id, source, symbol, security_name, current_position, average_cost,
             trade_points_json, trade_points_count, last_imported_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 0, ?, ?, ?)""",
            (uuid4().hex, TA_USER_ID, TA_SOURCE, symbol, name,
             shares, cost_price, now, now, now),
        )
        print(f"  ✅ {symbol} {name} {shares}股")
        inserted += 1

    conn.commit()
    conn.close()

    print(f"\n🎯 Sync complete: {inserted} stocks synced to TA tracking board.")
    print(f"   (removed {deleted} old records)")


if __name__ == "__main__":
    sync()
