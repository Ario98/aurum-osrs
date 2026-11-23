"""Clean async repository layer over SQLite WAL (designed to be DB-swappable)."""

from __future__ import annotations

import json
import time
from typing import Any, Optional

from app.db.database import Database
from app.engine.tax import is_tax_exempt_name


class Repository:
    """Data access methods for market data, active slots, flip journal, alerts, and settings."""

    def __init__(self, db: Database):
        self.db = db

    # ------------------------------------------------------------------
    # Meta & Settings
    # ------------------------------------------------------------------
    async def get_meta(self, key: str) -> Optional[str]:
        async with self.db.conn.execute("SELECT value FROM meta_state WHERE key = ?", (key,)) as cur:
            row = await cur.fetchone()
            return str(row["value"]) if row else None

    async def set_meta(self, key: str, value: str) -> None:
        now = int(time.time())
        async with self.db.write_lock:
            await self.db.conn.execute(
                """
                INSERT INTO meta_state (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                """,
                (key, value, now),
            )
            await self.db.conn.commit()

    async def get_all_settings(self) -> dict[str, Any]:
        async with self.db.conn.execute("SELECT key, value FROM user_settings") as cur:
            rows = await cur.fetchall()
        result: dict[str, Any] = {}
        for row in rows:
            try:
                result[row["key"]] = json.loads(row["value"])
            except json.JSONDecodeError:
                result[row["key"]] = row["value"]
        return result

    async def save_settings(self, updates: dict[str, Any]) -> None:
        now = int(time.time())
        records = [(k, json.dumps(v), now) for k, v in updates.items()]
        async with self.db.write_lock:
            await self.db.conn.executemany(
                """
                INSERT INTO user_settings (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                """,
                records,
            )
            await self.db.conn.commit()

    # ------------------------------------------------------------------
    # Items & Latest Prices
    # ------------------------------------------------------------------
    async def upsert_items(self, items: list[dict[str, Any]]) -> int:
        now = int(time.time())
        records = [
            (
                int(item["id"]),
                item.get("name", ""),
                item.get("examine", ""),
                1 if item.get("members", True) else 0,
                item.get("lowalch"),
                item.get("highalch"),
                item.get("limit"),
                item.get("value"),
                item.get("icon", ""),
                1 if is_tax_exempt_name(item.get("name")) else 0,
                now,
            )
            for item in items
            if "id" in item
        ]
        async with self.db.write_lock:
            await self.db.conn.executemany(
                """
                INSERT INTO items (id, name, examine, members, lowalch, highalch, buy_limit, value, icon, is_tax_exempt, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    examine = excluded.examine,
                    members = excluded.members,
                    lowalch = excluded.lowalch,
                    highalch = excluded.highalch,
                    buy_limit = excluded.buy_limit,
                    value = excluded.value,
                    icon = excluded.icon,
                    is_tax_exempt = excluded.is_tax_exempt,
                    updated_at = excluded.updated_at
                """,
                records,
            )
            await self.db.conn.commit()
        return len(records)

    async def get_all_items(self) -> list[dict[str, Any]]:
        async with self.db.conn.execute("SELECT * FROM items") as cur:
            rows = await cur.fetchall()
        return [dict(r) for r in rows]

    async def upsert_latest_prices(self, prices: dict[int, dict[str, Any]]) -> int:
        now = int(time.time())
        records = [
            (
                item_id,
                data.get("high"),
                data.get("highTime"),
                data.get("low"),
                data.get("lowTime"),
                now,
            )
            for item_id, data in prices.items()
        ]
        async with self.db.write_lock:
            await self.db.conn.executemany(
                """
                INSERT INTO latest_prices (item_id, high, high_time, low, low_time, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(item_id) DO UPDATE SET
                    high = excluded.high,
                    high_time = excluded.high_time,
                    low = excluded.low,
                    low_time = excluded.low_time,
                    updated_at = excluded.updated_at
                """,
                records,
            )
            await self.db.conn.commit()
        return len(records)

    async def get_all_latest_prices(self) -> dict[int, dict[str, Any]]:
        async with self.db.conn.execute("SELECT * FROM latest_prices") as cur:
            rows = await cur.fetchall()
        return {
            int(r["item_id"]): {
                "high": r["high"],
                "highTime": r["high_time"],
                "low": r["low"],
                "lowTime": r["low_time"],
            }
            for r in rows
        }

    # ------------------------------------------------------------------
    # Candles (5m, 1h, 24h)
    # ------------------------------------------------------------------
    async def upsert_candles(
        self,
        table: str,
        ts: int,
        prices: dict[int, dict[str, Any]],
    ) -> int:
        if table not in ("candles_5m", "candles_1h", "candles_24h"):
            raise ValueError(f"Invalid candle table: {table}")
        records = [
            (
                item_id,
                ts,
                data.get("avgHighPrice"),
                data.get("avgLowPrice"),
                int(data.get("highPriceVolume") or 0),
                int(data.get("lowPriceVolume") or 0),
            )
            for item_id, data in prices.items()
        ]
        if not records:
            return 0
        async with self.db.write_lock:
            await self.db.conn.executemany(
                f"""
                INSERT INTO {table} (item_id, ts, avg_high, avg_low, high_vol, low_vol)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(item_id, ts) DO UPDATE SET
                    avg_high = excluded.avg_high,
                    avg_low = excluded.avg_low,
                    high_vol = excluded.high_vol,
                    low_vol = excluded.low_vol
                """,
                records,
            )
            await self.db.conn.commit()
        return len(records)

    async def get_existing_bucket_timestamps(self, table: str, since_ts: int) -> set[int]:
        if table not in ("candles_5m", "candles_1h", "candles_24h"):
            raise ValueError(f"Invalid candle table: {table}")
        async with self.db.conn.execute(
            f"SELECT DISTINCT ts FROM {table} WHERE ts >= ?",
            (since_ts,),
        ) as cur:
            rows = await cur.fetchall()
        return {int(r["ts"]) for r in rows}

    async def get_recent_candles(self, table: str, since_ts: int) -> list[tuple[int, int, Optional[int], Optional[int], int, int]]:
        if table not in ("candles_5m", "candles_1h", "candles_24h"):
            raise ValueError(f"Invalid candle table: {table}")
        async with self.db.conn.execute(
            f"""
            SELECT item_id, ts, avg_high, avg_low, high_vol, low_vol
            FROM {table}
            WHERE ts >= ?
            ORDER BY ts ASC
            """,
            (since_ts,),
        ) as cur:
            rows = await cur.fetchall()
        return [
            (int(r[0]), int(r[1]), r[2], r[3], int(r[4]), int(r[5]))
            for r in rows
        ]

    async def get_item_candles(self, table: str, item_id: int, since_ts: int) -> list[dict[str, Any]]:
        if table not in ("candles_5m", "candles_1h", "candles_24h"):
            raise ValueError(f"Invalid candle table: {table}")
        async with self.db.conn.execute(
            f"""
            SELECT ts, avg_high, avg_low, high_vol, low_vol
            FROM {table}
            WHERE item_id = ? AND ts >= ?
            ORDER BY ts ASC
            """,
            (item_id, since_ts),
        ) as cur:
            rows = await cur.fetchall()
        return [
            {
                "timestamp": int(r["ts"]),
                "avgHighPrice": r["avg_high"],
                "avgLowPrice": r["avg_low"],
                "highPriceVolume": int(r["high_vol"]),
                "lowPriceVolume": int(r["low_vol"]),
            }
            for r in rows
        ]

    # ------------------------------------------------------------------
    # Active GE Slots & Flip Journal & 4-Hour Buy Limits
    # ------------------------------------------------------------------
    async def get_active_slots(self) -> list[dict[str, Any]]:
        async with self.db.conn.execute(
            "SELECT * FROM active_slots ORDER BY slot_number ASC"
        ) as cur:
            rows = await cur.fetchall()
        return [dict(r) for r in rows]

    async def get_slot(self, slot_number: int) -> Optional[dict[str, Any]]:
        async with self.db.conn.execute(
            "SELECT * FROM active_slots WHERE slot_number = ?", (slot_number,)
        ) as cur:
            row = await cur.fetchone()
        return dict(row) if row else None

    async def upsert_slot(
        self,
        slot_number: int,
        item_id: int,
        item_name: str,
        status: str,
        quantity: int,
        buy_price: int,
        target_sell_price: int,
        filled_quantity: int = 0,
        source: str = "manual",
        notes: str = "",
        opened_at: Optional[int] = None,
        flip_mode: str = "active",
    ) -> dict[str, Any]:
        now = int(time.time())
        open_ts = opened_at or now
        mode_val = "overnight" if flip_mode == "overnight" else "active"
        async with self.db.write_lock:
            await self.db.conn.execute(
                """
                INSERT INTO active_slots (
                    slot_number, item_id, item_name, status, quantity, filled_quantity,
                    buy_price, target_sell_price, opened_at, updated_at, source, notes, flip_mode
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(slot_number) DO UPDATE SET
                    item_id = excluded.item_id,
                    item_name = excluded.item_name,
                    status = excluded.status,
                    quantity = excluded.quantity,
                    filled_quantity = excluded.filled_quantity,
                    buy_price = excluded.buy_price,
                    target_sell_price = excluded.target_sell_price,
                    updated_at = excluded.updated_at,
                    source = excluded.source,
                    notes = excluded.notes,
                    flip_mode = excluded.flip_mode
                """,
                (
                    slot_number,
                    item_id,
                    item_name,
                    status,
                    quantity,
                    filled_quantity,
                    buy_price,
                    target_sell_price,
                    open_ts,
                    now,
                    source,
                    notes,
                    mode_val,
                ),
            )
            await self.db.conn.commit()
        slot = await self.get_slot(slot_number)
        assert slot is not None
        return slot

    async def delete_slot(self, slot_number: int) -> bool:
        async with self.db.write_lock:
            cur = await self.db.conn.execute(
                "DELETE FROM active_slots WHERE slot_number = ?", (slot_number,)
            )
            await self.db.conn.commit()
            return (cur.rowcount or 0) > 0

    async def record_completed_flip(
        self,
        item_id: int,
        item_name: str,
        quantity: int,
        buy_price: int,
        sell_price: int,
        tax_paid: int,
        net_profit: int,
        roi_pct: float,
        opened_at: int,
        closed_at: Optional[int] = None,
        source: str = "manual",
    ) -> int:
        close_ts = closed_at or int(time.time())
        duration_sec = max(1, close_ts - opened_at)
        async with self.db.write_lock:
            cur = await self.db.conn.execute(
                """
                INSERT INTO flip_history (
                    item_id, item_name, quantity, buy_price, sell_price,
                    tax_paid, net_profit, roi_pct, opened_at, closed_at, duration_sec, source
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item_id,
                    item_name,
                    quantity,
                    buy_price,
                    sell_price,
                    tax_paid,
                    net_profit,
                    roi_pct,
                    opened_at,
                    close_ts,
                    duration_sec,
                    source,
                ),
            )
            await self.db.conn.commit()
            return int(cur.lastrowid or 0)

    async def get_flip_history(self, limit: int = 100) -> list[dict[str, Any]]:
        async with self.db.conn.execute(
            "SELECT * FROM flip_history ORDER BY closed_at DESC LIMIT ?", (limit,)
        ) as cur:
            rows = await cur.fetchall()
        return [dict(r) for r in rows]

    async def get_flip_summary(self) -> dict[str, Any]:
        now = int(time.time())
        day_ago = now - 86400
        week_ago = now - 7 * 86400
        async with self.db.conn.execute(
            """
            SELECT
                COUNT(*) AS total_flips,
                COALESCE(SUM(net_profit), 0) AS total_profit,
                COALESCE(SUM(tax_paid), 0) AS total_tax_paid,
                COALESCE(SUM(CASE WHEN closed_at >= ? THEN net_profit ELSE 0 END), 0) AS profit_24h,
                COALESCE(SUM(CASE WHEN closed_at >= ? THEN net_profit ELSE 0 END), 0) AS profit_7d,
                COALESCE(SUM(CASE WHEN net_profit > 0 THEN 1 ELSE 0 END), 0) AS winning_flips,
                COALESCE(AVG(roi_pct), 0) AS avg_roi_pct,
                COALESCE(SUM(duration_sec), 0) AS total_duration_sec
            FROM flip_history
            """,
            (day_ago, week_ago),
        ) as cur:
            row = await cur.fetchone()
        if not row:
            return {
                "total_flips": 0,
                "total_profit": 0,
                "total_tax_paid": 0,
                "profit_24h": 0,
                "profit_7d": 0,
                "win_rate_pct": 0.0,
                "avg_roi_pct": 0.0,
                "realized_gp_per_hour": 0,
            }
        total_flips = int(row["total_flips"])
        total_profit = int(row["total_profit"])
        total_dur = int(row["total_duration_sec"])
        win_rate = (int(row["winning_flips"]) / total_flips * 100.0) if total_flips > 0 else 0.0
        gp_hr = int(total_profit / (total_dur / 3600.0)) if total_dur >= 60 else total_profit
        return {
            "total_flips": total_flips,
            "total_profit": total_profit,
            "total_tax_paid": int(row["total_tax_paid"]),
            "profit_24h": int(row["profit_24h"]),
            "profit_7d": int(row["profit_7d"]),
            "win_rate_pct": round(win_rate, 1),
            "avg_roi_pct": round(float(row["avg_roi_pct"]), 2),
            "realized_gp_per_hour": gp_hr,
        }

    async def record_buy_limit_usage(self, item_id: int, item_name: str, qty: int, buy_limit: int) -> None:
        """Track OSRS 4-hour GE buy-limit window per item."""
        now = int(time.time())
        async with self.db.write_lock:
            async with self.db.conn.execute(
                "SELECT quantity_bought, window_start, window_reset_at FROM buy_limits WHERE item_id = ?",
                (item_id,),
            ) as cur:
                existing = await cur.fetchone()

            if existing and int(existing["window_reset_at"]) > now:
                new_qty = int(existing["quantity_bought"]) + qty
                window_start = int(existing["window_start"])
                window_reset = int(existing["window_reset_at"])
            else:
                new_qty = qty
                window_start = now
                window_reset = now + 4 * 3600  # 4-hour OSRS buy limit timer

            await self.db.conn.execute(
                """
                INSERT INTO buy_limits (item_id, item_name, quantity_bought, buy_limit, window_start, window_reset_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(item_id) DO UPDATE SET
                    item_name = excluded.item_name,
                    quantity_bought = excluded.quantity_bought,
                    buy_limit = excluded.buy_limit,
                    window_start = excluded.window_start,
                    window_reset_at = excluded.window_reset_at
                """,
                (item_id, item_name, new_qty, buy_limit, window_start, window_reset),
            )
            await self.db.conn.commit()

    async def get_active_buy_limits(self) -> list[dict[str, Any]]:
        now = int(time.time())
        async with self.db.conn.execute(
            "SELECT * FROM buy_limits WHERE window_reset_at > ? ORDER BY window_reset_at ASC",
            (now,),
        ) as cur:
            rows = await cur.fetchall()
        results = []
        for r in rows:
            d = dict(r)
            d["seconds_remaining"] = max(0, int(d["window_reset_at"]) - now)
            d["remaining_qty"] = max(0, int(d["buy_limit"]) - int(d["quantity_bought"])) if d["buy_limit"] > 0 else None
            results.append(d)
        return results

    # ------------------------------------------------------------------
    # Alerts
    # ------------------------------------------------------------------
    async def log_alert(
        self,
        alert_type: str,
        title: str,
        message: str,
        severity: str = "info",
        item_id: Optional[int] = None,
        item_name: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
        discord_sent: bool = False,
    ) -> dict[str, Any]:
        now = int(time.time())
        meta_str = json.dumps(metadata or {})
        async with self.db.write_lock:
            cur = await self.db.conn.execute(
                """
                INSERT INTO alert_log (
                    alert_type, item_id, item_name, title, message, severity,
                    metadata_json, discord_sent, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    alert_type,
                    item_id,
                    item_name,
                    title,
                    message,
                    severity,
                    meta_str,
                    1 if discord_sent else 0,
                    now,
                ),
            )
            await self.db.conn.commit()
            alert_id = int(cur.lastrowid or 0)
        return {
            "id": alert_id,
            "alert_type": alert_type,
            "item_id": item_id,
            "item_name": item_name,
            "title": title,
            "message": message,
            "severity": severity,
            "metadata": metadata or {},
            "discord_sent": discord_sent,
            "created_at": now,
        }

    async def get_recent_alerts(self, limit: int = 50) -> list[dict[str, Any]]:
        async with self.db.conn.execute(
            "SELECT * FROM alert_log ORDER BY created_at DESC LIMIT ?", (limit,)
        ) as cur:
            rows = await cur.fetchall()
        results = []
        for r in rows:
            d = dict(r)
            try:
                d["metadata"] = json.loads(d.pop("metadata_json", "{}") or "{}")
            except json.JSONDecodeError:
                d["metadata"] = {}
            d["discord_sent"] = bool(d["discord_sent"])
            results.append(d)
        return results

    # ------------------------------------------------------------------
    # Daily 24h Rollup & 30-Day Seasonality Queries
    # ------------------------------------------------------------------
    async def rollup_candles_24h(self) -> int:
        """Roll up completed UTC days from candles_1h into permanent candles_24h."""
        today_start = (int(time.time()) // 86400) * 86400
        async with self.db.write_lock:
            cur = await self.db.conn.execute(
                """
                INSERT INTO candles_24h (item_id, ts, avg_high, avg_low, high_vol, low_vol)
                SELECT
                    item_id,
                    (ts / 86400) * 86400 AS day_ts,
                    CAST(ROUND(AVG(avg_high)) AS INTEGER) AS avg_high,
                    CAST(ROUND(AVG(avg_low)) AS INTEGER) AS avg_low,
                    SUM(high_vol) AS high_vol,
                    SUM(low_vol) AS low_vol
                FROM candles_1h
                WHERE ts < ?
                GROUP BY item_id, day_ts
                ON CONFLICT(item_id, ts) DO UPDATE SET
                    avg_high = excluded.avg_high,
                    avg_low = excluded.avg_low,
                    high_vol = excluded.high_vol,
                    low_vol = excluded.low_vol
                """,
                (today_start,),
            )
            await self.db.conn.commit()
            return cur.rowcount or 0

    async def compute_30d_hour_seasonality(self) -> dict[int, dict[int, float]]:
        """Compute multi-week hour-of-day price bias (%) per item directly in SQLite."""
        since_ts = int(time.time()) - 30 * 86400
        async with self.db.conn.execute(
            """
            SELECT
                item_id,
                (ts / 3600) % 24 AS hr,
                AVG(COALESCE((avg_high + avg_low) / 2.0, avg_high, avg_low)) AS avg_mid,
                COUNT(*) AS cnt
            FROM candles_1h
            WHERE ts >= ? AND (avg_high IS NOT NULL OR avg_low IS NOT NULL)
            GROUP BY item_id, hr
            HAVING cnt >= 3
            """,
            (since_ts,),
        ) as cur:
            rows = await cur.fetchall()

        per_item: dict[int, dict[int, float]] = {}
        for r in rows:
            if r[2] is None or float(r[2]) <= 0:
                continue
            per_item.setdefault(int(r[0]), {})[int(r[1])] = float(r[2])

        biases: dict[int, dict[int, float]] = {}
        for item_id, hr_map in per_item.items():
            if len(hr_map) < 6:
                continue
            overall = sum(hr_map.values()) / len(hr_map)
            if overall <= 0:
                continue
            biases[item_id] = {
                hr: ((val - overall) / overall) * 100.0 for hr, val in hr_map.items()
            }
        return biases

    # ------------------------------------------------------------------
    # Personal Watchlist & Custom Price/Margin Alerts
    # ------------------------------------------------------------------
    async def get_watchlist(self) -> list[dict[str, Any]]:
        async with self.db.conn.execute(
            "SELECT * FROM watchlist ORDER BY updated_at DESC"
        ) as cur:
            rows = await cur.fetchall()
        results = []
        for r in rows:
            d = dict(r)
            d["discord_notify"] = bool(d["discord_notify"])
            results.append(d)
        return results

    async def upsert_watchlist_item(
        self,
        item_id: int,
        item_name: str,
        buy_below: Optional[int] = None,
        sell_above: Optional[int] = None,
        min_net_margin: Optional[int] = None,
        discord_notify: bool = True,
        notes: str = "",
    ) -> dict[str, Any]:
        now = int(time.time())
        async with self.db.write_lock:
            await self.db.conn.execute(
                """
                INSERT INTO watchlist (
                    item_id, item_name, buy_below, sell_above, min_net_margin,
                    discord_notify, notes, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(item_id) DO UPDATE SET
                    item_name = excluded.item_name,
                    buy_below = excluded.buy_below,
                    sell_above = excluded.sell_above,
                    min_net_margin = excluded.min_net_margin,
                    discord_notify = excluded.discord_notify,
                    notes = excluded.notes,
                    updated_at = excluded.updated_at
                """,
                (
                    item_id,
                    item_name,
                    buy_below,
                    sell_above,
                    min_net_margin,
                    1 if discord_notify else 0,
                    notes,
                    now,
                    now,
                ),
            )
            await self.db.conn.commit()
        async with self.db.conn.execute("SELECT * FROM watchlist WHERE item_id = ?", (item_id,)) as cur:
            row = await cur.fetchone()
        assert row is not None
        d = dict(row)
        d["discord_notify"] = bool(d["discord_notify"])
        return d

    async def delete_watchlist_item(self, item_id: int) -> bool:
        async with self.db.write_lock:
            cur = await self.db.conn.execute("DELETE FROM watchlist WHERE item_id = ?", (item_id,))
            await self.db.conn.commit()
            return (cur.rowcount or 0) > 0
