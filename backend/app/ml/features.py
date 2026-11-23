"""Shared leak-free feature extraction for both historical training and live inference."""

from __future__ import annotations

import math
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from app.engine.tax import GE_MEGA_RARE_CAP_THRESHOLD, GE_TAX_CAP, GE_TAX_MIN_PRICE, GE_TAX_RATE

FEATURE_NAMES: list[str] = [
    "spread_pct",
    "net_margin_pct",
    "log_price",
    "log_vol_1h",
    "log_vol_24h",
    "log_gp_vol_24h",
    "ofi_1h",
    "ofi_24h",
    "vol_surge_ratio",
    "ret_1h_pct",
    "ret_4h_pct",
    "ret_12h_pct",
    "ret_24h_pct",
    "zscore_24h",
    "zscore_7d",
    "volatility_24h_pct",
    "pos_in_7d_band",
    "hour_sin",
    "hour_cos",
    "dow_sin",
    "dow_cos",
]


def _vectorized_ge_tax(prices: np.ndarray, is_exempt: bool) -> np.ndarray:
    """Exact May 2025+ OSRS 2% GE tax (5M cap at 250M+, 0 under 50 gp, 0 for exempt)."""
    if is_exempt:
        return np.zeros_like(prices, dtype=np.float64)
    tax = np.floor(prices * GE_TAX_RATE)
    tax = np.where(prices < GE_TAX_MIN_PRICE, 0.0, tax)
    tax = np.where(prices >= GE_MEGA_RARE_CAP_THRESHOLD, float(GE_TAX_CAP), tax)
    return tax


def _rolling_sum(arr: np.ndarray, window: int) -> np.ndarray:
    n = len(arr)
    csum = np.empty(n + 1, dtype=np.float64)
    csum[0] = 0.0
    np.cumsum(arr, out=csum[1:])
    idx = np.arange(n)
    starts = np.maximum(0, idx - window + 1)
    return csum[idx + 1] - csum[starts]


def _rolling_mean_std(arr: np.ndarray, window: int) -> tuple[np.ndarray, np.ndarray]:
    n = len(arr)
    idx = np.arange(n)
    starts = np.maximum(0, idx - window + 1)
    counts = (idx - starts + 1).astype(np.float64)

    s1 = _rolling_sum(arr, window)
    s2 = _rolling_sum(arr * arr, window)
    mean = s1 / counts
    var = np.maximum(0.0, (s2 / counts) - mean * mean)
    return mean, np.sqrt(var)


def build_training_dataset(
    db_path: Path,
    lookback_days: int = 30,
    min_item_candles: int = 72,
    min_hourly_gp_vol: float = 40_000.0,
) -> dict[str, Any]:
    """Stream candles_1h from SQLite and build strictly causal features + post-2%-tax targets."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        items_meta: dict[int, dict[str, Any]] = {}
        for r in conn.execute("SELECT id, name, buy_limit, is_tax_exempt, members FROM items"):
            items_meta[int(r["id"])] = {
                "name": str(r["name"]),
                "buy_limit": int(r["buy_limit"] or 0),
                "is_tax_exempt": bool(r["is_tax_exempt"]),
                "members": bool(r["members"]),
            }

        max_ts_row = conn.execute("SELECT MAX(ts) AS mx FROM candles_1h").fetchone()
        if not max_ts_row or max_ts_row["mx"] is None:
            return {"X": np.empty((0, len(FEATURE_NAMES)), dtype=np.float32), "rows": 0, "items": 0}
        max_ts = int(max_ts_row["mx"])
        cutoff_ts = max_ts - lookback_days * 86400

        cur = conn.execute(
            """
            SELECT item_id, ts, avg_high, avg_low, high_vol, low_vol
            FROM candles_1h
            WHERE ts >= ?
            ORDER BY item_id ASC, ts ASC
            """,
            (cutoff_ts,),
        )

        x_chunks: list[np.ndarray] = []
        ts_chunks: list[np.ndarray] = []
        item_chunks: list[np.ndarray] = []
        y4_win_chunks: list[np.ndarray] = []
        y4_roi_chunks: list[np.ndarray] = []
        y12_win_chunks: list[np.ndarray] = []
        y12_roi_chunks: list[np.ndarray] = []
        rule4_chunks: list[np.ndarray] = []
        rule12_chunks: list[np.ndarray] = []

        current_item: int | None = None
        buf_ts: list[int] = []
        buf_h: list[float] = []
        buf_l: list[float] = []
        buf_hv: list[float] = []
        buf_lv: list[float] = []

        def _flush_item(item_id: int) -> None:
            n = len(buf_ts)
            if n < min_item_candles:
                return
            meta = items_meta.get(item_id)
            if not meta:
                return

            ts_arr = np.array(buf_ts, dtype=np.int64)
            h_arr = np.array(buf_h, dtype=np.float64)
            l_arr = np.array(buf_l, dtype=np.float64)
            hv_arr = np.array(buf_hv, dtype=np.float64)
            lv_arr = np.array(buf_lv, dtype=np.float64)

            # Fill missing side from opposite side
            h_valid = np.where(h_arr > 0, h_arr, l_arr)
            l_valid = np.where(l_arr > 0, l_arr, h_arr)
            mid = 0.5 * (h_valid + l_valid)
            vol_1h = hv_arr + lv_arr

            # Quick liquidity filter on median item activity
            if float(np.median(mid * vol_1h)) < min_hourly_gp_vol:
                return

            is_exempt = bool(meta["is_tax_exempt"])
            tax_now = _vectorized_ge_tax(h_valid, is_exempt)

            # Strictly causal features at index t (uses <= t only)
            spread_pct = np.clip((h_valid - l_valid) / np.maximum(l_valid, 1.0) * 100.0, -10.0, 40.0)
            net_margin_pct = np.clip((h_valid - l_valid - tax_now) / np.maximum(l_valid, 1.0) * 100.0, -10.0, 40.0)

            vol_24h = _rolling_sum(vol_1h, 24)
            hv_24h = _rolling_sum(hv_arr, 24)
            lv_24h = _rolling_sum(lv_arr, 24)

            ofi_1h = (hv_arr - lv_arr) / np.maximum(vol_1h, 1.0)
            ofi_24h = (hv_24h - lv_24h) / np.maximum(vol_24h, 1.0)
            vol_surge = np.clip(vol_1h / np.maximum(vol_24h / 24.0, 1.0), 0.0, 20.0)

            def _lag_ret(lag: int) -> np.ndarray:
                out = np.zeros(n, dtype=np.float64)
                if n > lag:
                    prev = np.maximum(mid[:-lag], 1.0)
                    out[lag:] = np.clip((mid[lag:] - prev) / prev * 100.0, -50.0, 100.0)
                return out

            ret_1h = _lag_ret(1)
            ret_4h = _lag_ret(4)
            ret_12h = _lag_ret(12)
            ret_24h = _lag_ret(24)

            mean_24h, std_24h = _rolling_mean_std(mid, 24)
            mean_7d, std_7d = _rolling_mean_std(mid, 168)
            zscore_24h = np.clip((mid - mean_24h) / np.maximum(std_24h, 1.0), -6.0, 6.0)
            zscore_7d = np.clip((mid - mean_7d) / np.maximum(std_7d, 1.0), -6.0, 6.0)
            volatility_24h_pct = np.clip(std_24h / np.maximum(mean_24h, 1.0) * 100.0, 0.0, 50.0)

            # Fast rolling 7d band position proxy (mean ± 0.674 * std approximates p25..p75 in O(n)!)
            p25_proxy = mean_7d - 0.674 * std_7d
            p75_proxy = mean_7d + 0.674 * std_7d
            pos_7d = np.clip((mid - p25_proxy) / np.maximum(p75_proxy - p25_proxy, 1.0), -2.5, 3.5)

            hours = (ts_arr // 3600) % 24
            dows = ((ts_arr // 86400) + 3) % 7  # 1970-01-01 was Thursday (3)
            hour_rad = 2.0 * math.pi * hours / 24.0
            dow_rad = 2.0 * math.pi * dows / 7.0

            # Forward labels (only rows where we have full 12h forward window & >= 24h warmup!)
            # Also verify no huge timestamp gap inside forward 12h window
            valid_end = n - 12
            start_idx = 24
            if valid_end <= start_idx:
                return

            # Compute forward 4h and 12h achievable post-tax net ROI conservatively
            idx_range = np.arange(start_idx, valid_end)
            # Filter out rows where ts jumps by more than 16h over 12 rows (rare missing gap)
            dt_12 = ts_arr[idx_range + 12] - ts_arr[idx_range]
            good_mask = (dt_12 <= 16 * 3600) & (l_arr[idx_range] > 0) & (h_arr[idx_range] > 0) & (vol_1h[idx_range] >= 2)
            idx_range = idx_range[good_mask]
            if len(idx_range) < 12:
                return

            entry_buy = l_valid[idx_range] + 1.0

            # 4h forward: conservative 75th percentile of next 4 hourly avg_high prices
            f4_highs = np.stack([h_valid[idx_range + k] for k in range(1, 5)], axis=1)
            f4_vols = np.stack([hv_arr[idx_range + k] for k in range(1, 5)], axis=1)
            # Require at least some selling liquidity over next 4h
            sell_4h = np.percentile(f4_highs, 75, axis=1) * 0.998
            sell_4h = np.where(np.sum(f4_vols, axis=1) >= 2, sell_4h, l_valid[idx_range])
            tax_4h = _vectorized_ge_tax(sell_4h, is_exempt)
            roi_4h = np.clip((sell_4h - entry_buy - tax_4h) / np.maximum(entry_buy, 1.0) * 100.0, -15.0, 25.0)
            win_4h = (roi_4h >= 0.5).astype(np.int8)

            # 12h overnight forward: 75th percentile of avg_high over hours +2..+12 (conservative morning fill)
            f12_highs = np.stack([h_valid[idx_range + k] for k in range(2, 13)], axis=1)
            f12_vols = np.stack([hv_arr[idx_range + k] for k in range(2, 13)], axis=1)
            sell_12h = np.percentile(f12_highs, 75, axis=1) * 0.998
            sell_12h = np.where(np.sum(f12_vols, axis=1) >= 4, sell_12h, l_valid[idx_range])
            tax_12h = _vectorized_ge_tax(sell_12h, is_exempt)
            roi_12h = np.clip((sell_12h - entry_buy - tax_12h) / np.maximum(entry_buy, 1.0) * 100.0, -20.0, 35.0)
            win_12h = (roi_12h >= 1.2).astype(np.int8)

            # Deterministic rules-only baseline proxy at time t (used for fair ML vs Rules comparison)
            rule_4h = np.clip(net_margin_pct[idx_range] * 6.0, -10.0, 40.0) + np.clip(
                -zscore_24h[idx_range] * 10.0, -15.0, 30.0
            ) + np.clip(np.log1p(vol_1h[idx_range]) * 2.5, 0.0, 25.0)
            rule_12h = np.clip((p75_proxy[idx_range] - entry_buy - _vectorized_ge_tax(p75_proxy[idx_range], is_exempt)) / np.maximum(entry_buy, 1.0) * 100.0, -10.0, 20.0) * 4.0 + np.clip(
                -zscore_7d[idx_range] * 8.0, -10.0, 25.0
            )

            feats = np.column_stack(
                [
                    spread_pct[idx_range],
                    net_margin_pct[idx_range],
                    np.log1p(mid[idx_range]),
                    np.log1p(vol_1h[idx_range]),
                    np.log1p(vol_24h[idx_range]),
                    np.log1p(vol_24h[idx_range] * mid[idx_range]),
                    ofi_1h[idx_range],
                    ofi_24h[idx_range],
                    vol_surge[idx_range],
                    ret_1h[idx_range],
                    ret_4h[idx_range],
                    ret_12h[idx_range],
                    ret_24h[idx_range],
                    zscore_24h[idx_range],
                    zscore_7d[idx_range],
                    volatility_24h_pct[idx_range],
                    pos_7d[idx_range],
                    np.sin(hour_rad[idx_range]),
                    np.cos(hour_rad[idx_range]),
                    np.sin(dow_rad[idx_range]),
                    np.cos(dow_rad[idx_range]),
                ]
            ).astype(np.float32)

            x_chunks.append(feats)
            ts_chunks.append(ts_arr[idx_range])
            item_chunks.append(np.full(len(idx_range), item_id, dtype=np.int32))
            y4_win_chunks.append(win_4h)
            y4_roi_chunks.append(roi_4h.astype(np.float32))
            y12_win_chunks.append(win_12h)
            y12_roi_chunks.append(roi_12h.astype(np.float32))
            rule4_chunks.append(rule_4h.astype(np.float32))
            rule12_chunks.append(rule_12h.astype(np.float32))

        for row in cur:
            iid = int(row["item_id"])
            if current_item is not None and iid != current_item:
                _flush_item(current_item)
                buf_ts.clear()
                buf_h.clear()
                buf_l.clear()
                buf_hv.clear()
                buf_lv.clear()
            current_item = iid
            buf_ts.append(int(row["ts"]))
            buf_h.append(float(row["avg_high"] or 0.0))
            buf_l.append(float(row["avg_low"] or 0.0))
            buf_hv.append(float(row["high_vol"] or 0.0))
            buf_lv.append(float(row["low_vol"] or 0.0))

        if current_item is not None:
            _flush_item(current_item)
    finally:
        conn.close()

    if not x_chunks:
        return {"X": np.empty((0, len(FEATURE_NAMES)), dtype=np.float32), "rows": 0, "items": 0}

    X = np.vstack(x_chunks)
    ts_all = np.concatenate(ts_chunks)
    items_all = np.concatenate(item_chunks)
    return {
        "X": X,
        "ts": ts_all,
        "item_ids": items_all,
        "y4_win": np.concatenate(y4_win_chunks),
        "y4_roi": np.concatenate(y4_roi_chunks),
        "y12_win": np.concatenate(y12_win_chunks),
        "y12_roi": np.concatenate(y12_roi_chunks),
        "rule4": np.concatenate(rule4_chunks),
        "rule12": np.concatenate(rule12_chunks),
        "rows": int(len(X)),
        "items": int(len(x_chunks)),
        "min_ts": int(ts_all.min()),
        "max_ts": int(ts_all.max()),
    }


def extract_live_features(state: Any) -> tuple[list[int], np.ndarray]:
    """Compute exact 21-column live feature matrix across active items in <15ms."""
    now = int(time.time())
    dt_now = datetime.fromtimestamp(now, tz=timezone.utc)
    hour_rad = 2.0 * math.pi * dt_now.hour / 24.0
    dow_rad = 2.0 * math.pi * dt_now.weekday() / 7.0
    h_sin, h_cos = math.sin(hour_rad), math.cos(hour_rad)
    d_sin, d_cos = math.sin(dow_rad), math.cos(dow_rad)

    item_ids: list[int] = []
    rows: list[list[float]] = []

    for item_id, m in state.metrics.items():
        if not m.high or not m.low or m.high <= 0 or m.low <= 0:
            continue
        if m.vol_24h <= 0:
            continue

        mid = float(m.mid_price or ((m.high + m.low) // 2))
        spread_pct = max(-10.0, min(40.0, (m.high - m.low) / max(m.low, 1) * 100.0))
        net_margin_pct = max(-10.0, min(40.0, (m.high - m.low - m.tax) / max(m.low, 1) * 100.0))
        vol_surge = max(0.0, min(20.0, m.vol_1h / max(m.vol_24h / 24.0, 1.0)))

        # Compute 4h and 12h lagged returns from in-memory 1h candles
        c1 = state.candles_1h.get(item_id)
        ret_4h = m.price_change_1h_pct
        ret_12h = m.price_change_24h_pct * 0.5
        if c1:
            t4 = now - 4 * 3600
            t12 = now - 12 * 3600
            p4 = None
            p12 = None
            best4 = 999999
            best12 = 999999
            for ts, (ah, al, _, _) in c1.items():
                p = ah if (ah and not al) else (al if (al and not ah) else ((ah + al) / 2.0 if (ah and al) else None))
                if not p or p <= 0:
                    continue
                d4 = abs(ts - t4)
                if d4 < best4 and d4 <= 7200:
                    best4 = d4
                    p4 = p
                d12 = abs(ts - t12)
                if d12 < best12 and d12 <= 10800:
                    best12 = d12
                    p12 = p
            if p4 and p4 > 0:
                ret_4h = max(-50.0, min(100.0, (mid - p4) / p4 * 100.0))
            if p12 and p12 > 0:
                ret_12h = max(-50.0, min(100.0, (mid - p12) / p12 * 100.0))

        if m.p25_7d and m.p75_7d and m.p75_7d > m.p25_7d:
            pos_7d = max(-2.5, min(3.5, (mid - m.p25_7d) / (m.p75_7d - m.p25_7d)))
        else:
            pos_7d = 0.5

        item_ids.append(item_id)
        rows.append(
            [
                spread_pct,
                net_margin_pct,
                math.log1p(mid),
                math.log1p(max(0, m.vol_1h)),
                math.log1p(max(0, m.vol_24h)),
                math.log1p(max(0.0, m.vol_24h * mid)),
                float(m.ofi_1h),
                float(m.ofi_24h),
                vol_surge,
                max(-50.0, min(100.0, float(m.price_change_1h_pct))),
                ret_4h,
                ret_12h,
                max(-50.0, min(100.0, float(m.price_change_24h_pct))),
                max(-6.0, min(6.0, float(m.zscore_24h))),
                max(-6.0, min(6.0, float(m.zscore_7d))),
                max(0.0, min(50.0, float(m.volatility_24h_pct))),
                pos_7d,
                h_sin,
                h_cos,
                d_sin,
                d_cos,
            ]
        )

    if not rows:
        return [], np.empty((0, len(FEATURE_NAMES)), dtype=np.float32)
    return item_ids, np.array(rows, dtype=np.float32)
