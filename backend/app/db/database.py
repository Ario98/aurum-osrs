"""Async SQLite (WAL mode) database manager with serialized writes and retention cleanup."""

from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import Optional

import aiosqlite

logger = logging.getLogger(__name__)

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    examine TEXT DEFAULT '',
    members INTEGER NOT NULL DEFAULT 1,
    lowalch INTEGER,
    highalch INTEGER,
    buy_limit INTEGER,
    value INTEGER,
    icon TEXT DEFAULT '',
    is_tax_exempt INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);

CREATE TABLE IF NOT EXISTS latest_prices (
    item_id INTEGER PRIMARY KEY,
    high INTEGER,
    high_time INTEGER,
    low INTEGER,
    low_time INTEGER,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS candles_5m (
    item_id INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    avg_high INTEGER,
    avg_low INTEGER,
    high_vol INTEGER NOT NULL DEFAULT 0,
    low_vol INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (item_id, ts)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_candles_5m_ts ON candles_5m(ts);

CREATE TABLE IF NOT EXISTS candles_1h (
    item_id INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    avg_high INTEGER,
    avg_low INTEGER,
    high_vol INTEGER NOT NULL DEFAULT 0,
    low_vol INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (item_id, ts)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_candles_1h_ts ON candles_1h(ts);

CREATE TABLE IF NOT EXISTS candles_24h (
    item_id INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    avg_high INTEGER,
    avg_low INTEGER,
    high_vol INTEGER NOT NULL DEFAULT 0,
    low_vol INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (item_id, ts)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_candles_24h_ts ON candles_24h(ts);

CREATE TABLE IF NOT EXISTS active_slots (
    slot_number INTEGER PRIMARY KEY CHECK (slot_number BETWEEN 1 AND 8),
    item_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('BUYING', 'BOUGHT', 'SELLING')),
    quantity INTEGER NOT NULL,
    filled_quantity INTEGER NOT NULL DEFAULT 0,
    buy_price INTEGER NOT NULL,
    target_sell_price INTEGER NOT NULL,
    opened_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    notes TEXT DEFAULT '',
    flip_mode TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS flip_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    buy_price INTEGER NOT NULL,
    sell_price INTEGER NOT NULL,
    tax_paid INTEGER NOT NULL,
    net_profit INTEGER NOT NULL,
    roi_pct REAL NOT NULL,
    opened_at INTEGER NOT NULL,
    closed_at INTEGER NOT NULL,
    duration_sec INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual'
);
CREATE INDEX IF NOT EXISTS idx_flip_history_closed ON flip_history(closed_at DESC);

CREATE TABLE IF NOT EXISTS buy_limits (
    item_id INTEGER PRIMARY KEY,
    item_name TEXT NOT NULL,
    quantity_bought INTEGER NOT NULL DEFAULT 0,
    buy_limit INTEGER NOT NULL DEFAULT 0,
    window_start INTEGER NOT NULL,
    window_reset_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_type TEXT NOT NULL,
    item_id INTEGER,
    item_name TEXT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info',
    metadata_json TEXT DEFAULT '{}',
    discord_sent INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alert_log_created ON alert_log(created_at DESC);

CREATE TABLE IF NOT EXISTS meta_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlist (
    item_id INTEGER PRIMARY KEY,
    item_name TEXT NOT NULL,
    buy_below INTEGER,
    sell_above INTEGER,
    min_net_margin INTEGER,
    discord_notify INTEGER NOT NULL DEFAULT 1,
    notes TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
"""


class Database:
    """Async SQLite connection pool/wrapper configured for high-throughput WAL workloads."""

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self._conn: Optional[aiosqlite.Connection] = None
        self._write_lock = asyncio.Lock()

    async def connect(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = await aiosqlite.connect(str(self.db_path))
        self._conn.row_factory = aiosqlite.Row
        await self._conn.execute("PRAGMA journal_mode=WAL;")
        await self._conn.execute("PRAGMA synchronous=NORMAL;")
        await self._conn.execute("PRAGMA cache_size=-64000;")  # 64 MB page cache
        await self._conn.execute("PRAGMA temp_store=MEMORY;")
        await self._conn.execute("PRAGMA busy_timeout=10000;")
        await self._conn.execute("PRAGMA foreign_keys=ON;")
        await self._conn.executescript(SCHEMA_SQL)
        # Safe additive migration for existing SQLite databases
        async with self._conn.execute("PRAGMA table_info(active_slots)") as cur:
            cols = {row[1] for row in await cur.fetchall()}
        if "flip_mode" not in cols:
            await self._conn.execute(
                "ALTER TABLE active_slots ADD COLUMN flip_mode TEXT NOT NULL DEFAULT 'active'"
            )
        await self._conn.commit()
        logger.info("Connected to SQLite WAL database at %s", self.db_path)

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None
            logger.info("Closed SQLite database")

    @property
    def conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("Database not connected")
        return self._conn

    @property
    def write_lock(self) -> asyncio.Lock:
        return self._write_lock

    async def prune_old_candles(self, retention_5m_days: int = 14, retention_1h_days: int = 90) -> dict[str, int]:
        """Keep database compact forever by pruning expired 5m/1h buckets."""
        now = int(time.time())
        cutoff_5m = now - retention_5m_days * 86400
        cutoff_1h = now - retention_1h_days * 86400
        cutoff_alerts = now - 30 * 86400

        async with self._write_lock:
            cur1 = await self.conn.execute("DELETE FROM candles_5m WHERE ts < ?", (cutoff_5m,))
            cur2 = await self.conn.execute("DELETE FROM candles_1h WHERE ts < ?", (cutoff_1h,))
            cur3 = await self.conn.execute("DELETE FROM alert_log WHERE created_at < ?", (cutoff_alerts,))
            await self.conn.commit()
            deleted = {
                "candles_5m": cur1.rowcount or 0,
                "candles_1h": cur2.rowcount or 0,
                "alert_log": cur3.rowcount or 0,
            }
        if any(deleted.values()):
            logger.info("Pruned expired rows: %s", deleted)
        return deleted
