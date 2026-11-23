"""Blazing-fast in-memory market state and vectorized OSRS flipping metrics engine."""

from __future__ import annotations

import logging
import math
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

import numpy as np

from app.engine.tax import (
    GE_MEGA_RARE_CAP_THRESHOLD,
    calculate_ge_tax,
)

logger = logging.getLogger(__name__)

NATURE_RUNE_ID = 561
DEFAULT_NATURE_RUNE_PRICE = 100


@dataclass(slots=True)
class ItemMetrics:
    """Precomputed real-time flipping metrics for a single OSRS item."""

    id: int
    name: str
    icon: str
    members: bool
    buy_limit: int
    highalch: int
    lowalch: int
    is_tax_exempt: bool
    is_mega_rare_capped: bool

    # Live quotes
    high: Optional[int]
    high_time: Optional[int]
    low: Optional[int]
    low_time: Optional[int]
    high_age_sec: Optional[int]
    low_age_sec: Optional[int]
    mid_price: Optional[int]

    # Actionable pricing & exact 2% post-tax economics
    suggested_buy: Optional[int]
    suggested_sell: Optional[int]
    raw_margin: int
    tax: int
    net_margin: int
    net_roi_pct: float
    max_profit_per_limit: int

    # Rolling volumes & order-flow imbalance
    vol_5m_high: int
    vol_5m_low: int
    vol_5m: int
    vol_1h_high: int
    vol_1h_low: int
    vol_1h: int
    vol_24h_high: int
    vol_24h_low: int
    vol_24h: int
    avg_high_1h: Optional[int]
    avg_low_1h: Optional[int]
    ofi_5m: float
    ofi_1h: float
    ofi_24h: float

    # Trend, volatility, mean-reversion & seasonality
    vwap_24h: Optional[float]
    vwap_7d: Optional[float]
    std_24h: float
    std_7d: float
    candles_1h_count: int
    volatility_24h_pct: float
    zscore_24h: float
    zscore_7d: float
    price_change_1h_pct: float
    price_change_24h_pct: float
    volume_spike_ratio: float
    seasonality_bias_pct: float

    # Dump sniper transparency & bounce quality
    dump_timeframe: str
    dump_baseline_vwap: Optional[int]
    dump_drop_pct: float
    dump_bounce_outlook: str  # HIGH | MEDIUM | LOW | NONE
    dump_bounce_reason: str
    dump_conservative_target: Optional[int]
    dump_full_target: Optional[int]

    # Liquidity, safety & alch floor
    est_fill_minutes_limit: float
    est_gp_per_hour_limit: int
    flip_sharpe: float
    alch_profit: int
    alch_floor_pct: Optional[float]
    safety_score: int
    manipulation_flags: list[str] = field(default_factory=list)

    # Strategy composite scores (0-100)
    fast_flip_score: float = 0.0
    overnight_score: float = 0.0
    dump_sniper_score: float = 0.0
    alch_floor_score: float = 0.0
    overall_score: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "icon": self.icon,
            "members": self.members,
            "buy_limit": self.buy_limit,
            "highalch": self.highalch,
            "lowalch": self.lowalch,
            "is_tax_exempt": self.is_tax_exempt,
            "is_mega_rare_capped": self.is_mega_rare_capped,
            "high": self.high,
            "high_time": self.high_time,
            "low": self.low,
            "low_time": self.low_time,
            "high_age_sec": self.high_age_sec,
            "low_age_sec": self.low_age_sec,
            "mid_price": self.mid_price,
            "suggested_buy": self.suggested_buy,
            "suggested_sell": self.suggested_sell,
            "raw_margin": self.raw_margin,
            "tax": self.tax,
            "net_margin": self.net_margin,
            "net_roi_pct": round(self.net_roi_pct, 2),
            "max_profit_per_limit": self.max_profit_per_limit,
            "vol_5m_high": self.vol_5m_high,
            "vol_5m_low": self.vol_5m_low,
            "vol_5m": self.vol_5m,
            "vol_1h_high": self.vol_1h_high,
            "vol_1h_low": self.vol_1h_low,
            "vol_1h": self.vol_1h,
            "vol_24h_high": self.vol_24h_high,
            "vol_24h_low": self.vol_24h_low,
            "vol_24h": self.vol_24h,
            "avg_high_1h": self.avg_high_1h,
            "avg_low_1h": self.avg_low_1h,
            "ofi_5m": round(self.ofi_5m, 3),
            "ofi_1h": round(self.ofi_1h, 3),
            "ofi_24h": round(self.ofi_24h, 3),
            "vwap_24h": round(self.vwap_24h, 1) if self.vwap_24h is not None else None,
            "vwap_7d": round(self.vwap_7d, 1) if self.vwap_7d is not None else None,
            "std_24h": round(self.std_24h, 1),
            "std_7d": round(self.std_7d, 1),
            "candles_1h_count": self.candles_1h_count,
            "volatility_24h_pct": round(self.volatility_24h_pct, 2),
            "zscore_24h": round(self.zscore_24h, 2),
            "zscore_7d": round(self.zscore_7d, 2),
            "price_change_1h_pct": round(self.price_change_1h_pct, 2),
            "price_change_24h_pct": round(self.price_change_24h_pct, 2),
            "volume_spike_ratio": round(self.volume_spike_ratio, 2),
            "seasonality_bias_pct": round(self.seasonality_bias_pct, 2),
            "dump_timeframe": self.dump_timeframe,
            "dump_baseline_vwap": self.dump_baseline_vwap,
            "dump_drop_pct": round(self.dump_drop_pct, 2),
            "dump_bounce_outlook": self.dump_bounce_outlook,
            "dump_bounce_reason": self.dump_bounce_reason,
            "dump_conservative_target": self.dump_conservative_target,
            "dump_full_target": self.dump_full_target,
            "est_fill_minutes_limit": round(self.est_fill_minutes_limit, 1),
            "est_gp_per_hour_limit": self.est_gp_per_hour_limit,
            "flip_sharpe": round(self.flip_sharpe, 2),
            "alch_profit": self.alch_profit,
            "alch_floor_pct": round(self.alch_floor_pct, 2) if self.alch_floor_pct is not None else None,
            "safety_score": self.safety_score,
            "manipulation_flags": self.manipulation_flags,
            "fast_flip_score": round(self.fast_flip_score, 1),
            "overnight_score": round(self.overnight_score, 1),
            "dump_sniper_score": round(self.dump_sniper_score, 1),
            "alch_floor_score": round(self.alch_floor_score, 1),
            "overall_score": round(self.overall_score, 1),
        }


def _ofi(high_vol: int, low_vol: int) -> float:
    total = high_vol + low_vol
    if total <= 0:
        return 0.0
    return (high_vol - low_vol) / total


def _clamp(val: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, val))


class MarketState:
    """In-memory state holding all ~4,100 items, recent candles, and precomputed metrics."""

    def __init__(self) -> None:
        self.items: dict[int, dict[str, Any]] = {}
        self.name_to_id: dict[str, int] = {}
        self.latest: dict[int, dict[str, Any]] = {}

        # Rolling in-memory candle windows: item_id -> {ts: (avg_high, avg_low, high_vol, low_vol)}
        self.candles_5m: dict[int, dict[int, tuple[Optional[int], Optional[int], int, int]]] = defaultdict(dict)
        self.candles_1h: dict[int, dict[int, tuple[Optional[int], Optional[int], int, int]]] = defaultdict(dict)

        # Computed snapshots
        self.metrics: dict[int, ItemMetrics] = {}
        self.nature_rune_price: int = DEFAULT_NATURE_RUNE_PRICE
        self.last_latest_update: int = 0
        self.last_recompute_ms: float = 0.0
        self.bootstrap_fast_done: bool = False
        self.bootstrap_bg_done: bool = False
        self.bootstrap_progress: dict[str, Any] = {
            "stage": "initializing",
            "fast_done": False,
            "bg_done": False,
            "buckets_5m_loaded": 0,
            "buckets_1h_loaded": 0,
        }

        # On-demand /timeseries cache: (item_id, timestep) -> (fetched_at, data)
        self.timeseries_cache: dict[tuple[int, str], tuple[float, list[dict[str, Any]]]] = {}

    def load_items(self, items: list[dict[str, Any]]) -> None:
        self.items.clear()
        self.name_to_id.clear()
        for item in items:
            item_id = int(item["id"])
            self.items[item_id] = item
            name = (item.get("name") or "").strip().lower()
            if name:
                self.name_to_id[name] = item_id

    def update_latest(self, prices: dict[int, dict[str, Any]]) -> None:
        self.latest.update(prices)
        self.last_latest_update = int(time.time())
        nat = self.latest.get(NATURE_RUNE_ID)
        if nat and (nat.get("high") or nat.get("low")):
            self.nature_rune_price = int(nat.get("high") or nat.get("low") or DEFAULT_NATURE_RUNE_PRICE)

    def ingest_candle_rows(
        self,
        resolution: str,
        rows: list[tuple[int, int, Optional[int], Optional[int], int, int]],
    ) -> None:
        target = self.candles_5m if resolution == "5m" else self.candles_1h
        for item_id, ts, avg_h, avg_l, h_vol, l_vol in rows:
            target[item_id][ts] = (avg_h, avg_l, h_vol, l_vol)
        self._prune_memory_windows()

    def ingest_candle_bucket(self, resolution: str, ts: int, prices: dict[int, dict[str, Any]]) -> None:
        target = self.candles_5m if resolution == "5m" else self.candles_1h
        for item_id, data in prices.items():
            target[item_id][ts] = (
                data.get("avgHighPrice"),
                data.get("avgLowPrice"),
                int(data.get("highPriceVolume") or 0),
                int(data.get("lowPriceVolume") or 0),
            )
        self._prune_memory_windows()

    def _prune_memory_windows(self) -> None:
        now = int(time.time())
        cutoff_5m = now - 6 * 3600       # Keep 6h of 5m buckets in RAM
        cutoff_1h = now - 8 * 86400      # Keep 8d of 1h buckets in RAM

        for bucket_map in self.candles_5m.values():
            stale = [ts for ts in bucket_map if ts < cutoff_5m]
            for ts in stale:
                del bucket_map[ts]

        for bucket_map in self.candles_1h.values():
            stale = [ts for ts in bucket_map if ts < cutoff_1h]
            for ts in stale:
                del bucket_map[ts]

    def recompute_all_metrics(self) -> float:
        """Recompute all flipping metrics across ~4,100 items in-memory."""
        t0 = time.perf_counter()
        now = int(time.time())
        now_dt = datetime.fromtimestamp(now, tz=timezone.utc)
        current_hour_of_day = now_dt.hour
        cutoff_24h = now - 24 * 3600
        cutoff_1h = now - 3600
        cutoff_5m = now - 15 * 60  # Latest available 5m bucket (handles ~5-10m publish lag)

        new_metrics: dict[int, ItemMetrics] = {}

        for item_id, meta in self.items.items():
            quote = self.latest.get(item_id) or {}
            high = quote.get("high")
            low = quote.get("low")
            high_time = quote.get("highTime")
            low_time = quote.get("lowTime")

            high_age = max(0, now - int(high_time)) if high_time else None
            low_age = max(0, now - int(low_time)) if low_time else None
            mid_price = int((high + low) // 2) if (high and low) else (high or low)

            name = meta.get("name", f"Item {item_id}")
            is_tax_exempt = bool(meta.get("is_tax_exempt"))
            buy_limit = int(meta.get("buy_limit") or 0)
            highalch = int(meta.get("highalch") or 0)
            lowalch = int(meta.get("lowalch") or 0)
            members = bool(meta.get("members", True))
            icon = meta.get("icon", "")

            # --- 5m candle stats ---
            c5 = self.candles_5m.get(item_id)
            vol_5m_h = 0
            vol_5m_l = 0
            if c5:
                latest_5m_ts = max(c5.keys())
                if latest_5m_ts >= cutoff_5m:
                    _, _, vol_5m_h, vol_5m_l = c5[latest_5m_ts]
            vol_5m = vol_5m_h + vol_5m_l
            ofi_5m = _ofi(vol_5m_h, vol_5m_l)

            # --- 1h / 24h / 7d candle stats ---
            c1 = self.candles_1h.get(item_id)
            vol_1h_h = 0
            vol_1h_l = 0
            avg_high_1h: Optional[int] = None
            avg_low_1h: Optional[int] = None
            vol_24h_h = 0
            vol_24h_l = 0

            prices_24h: list[float] = []
            vols_24h: list[int] = []
            prices_7d: list[float] = []
            vols_7d: list[int] = []
            same_hour_prices: list[float] = []
            oldest_24h_price: Optional[float] = None
            prev_1h_price: Optional[float] = None

            if c1:
                sorted_ts = sorted(c1.keys())
                latest_1h_ts = sorted_ts[-1]
                if latest_1h_ts >= cutoff_1h - 3600:
                    ah, al, vh, vl = c1[latest_1h_ts]
                    avg_high_1h, avg_low_1h, vol_1h_h, vol_1h_l = ah, al, vh, vl
                if len(sorted_ts) >= 2:
                    pah, pal, _, _ = c1[sorted_ts[-2]]
                    if pah and pal:
                        prev_1h_price = (pah + pal) / 2.0
                    elif pah or pal:
                        prev_1h_price = float(pah or pal)

                for ts in sorted_ts:
                    ah, al, vh, vl = c1[ts]
                    tot_v = vh + vl
                    bucket_mid: Optional[float] = None
                    if ah and al:
                        bucket_mid = (ah + al) / 2.0
                    elif ah or al:
                        bucket_mid = float(ah or al)

                    if bucket_mid is not None:
                        prices_7d.append(bucket_mid)
                        vols_7d.append(max(tot_v, 1))
                        bucket_hour = (ts // 3600) % 24
                        if bucket_hour == current_hour_of_day:
                            same_hour_prices.append(bucket_mid)

                    if ts >= cutoff_24h:
                        vol_24h_h += vh
                        vol_24h_l += vl
                        if bucket_mid is not None:
                            if oldest_24h_price is None:
                                oldest_24h_price = bucket_mid
                            prices_24h.append(bucket_mid)
                            vols_24h.append(max(tot_v, 1))

            vol_1h = vol_1h_h + vol_1h_l
            vol_24h = vol_24h_h + vol_24h_l
            # If latest 1h bucket hasn't closed/populated yet, estimate 1h flow from 24h average
            eff_vol_1h_h = vol_1h_h if vol_1h_h > 0 else max(0, vol_24h_h // 24)
            eff_vol_1h_l = vol_1h_l if vol_1h_l > 0 else max(0, vol_24h_l // 24)
            eff_vol_1h = eff_vol_1h_h + eff_vol_1h_l

            ofi_1h = _ofi(eff_vol_1h_h, eff_vol_1h_l)
            ofi_24h = _ofi(vol_24h_h, vol_24h_l)

            # VWAP, Volatility & Z-Scores (calculated across hourly 1h candles)
            vwap_24h: Optional[float] = None
            std_24h = 0.0
            volatility_24h_pct = 0.0
            zscore_24h = 0.0
            if prices_24h:
                arr24 = np.array(prices_24h, dtype=np.float64)
                w24 = np.array(vols_24h, dtype=np.float64)
                vwap_24h = float(np.average(arr24, weights=w24))
                std_24h = float(np.std(arr24))
                if vwap_24h > 0:
                    volatility_24h_pct = (std_24h / vwap_24h) * 100.0
                if mid_price and std_24h > 0:
                    zscore_24h = (mid_price - vwap_24h) / std_24h

            vwap_7d: Optional[float] = None
            std_7d = 0.0
            zscore_7d = 0.0
            if prices_7d:
                arr7 = np.array(prices_7d, dtype=np.float64)
                w7 = np.array(vols_7d, dtype=np.float64)
                vwap_7d = float(np.average(arr7, weights=w7))
                std_7d = float(np.std(arr7))
                if mid_price and std_7d > 0:
                    zscore_7d = (mid_price - vwap_7d) / std_7d
            else:
                vwap_7d = vwap_24h
                std_7d = std_24h
                zscore_7d = zscore_24h
            candles_1h_count = len(prices_7d)

            # Hour-of-day seasonality bias (% deviation of this hour vs 7d VWAP)
            seasonality_bias_pct = 0.0
            if same_hour_prices and vwap_7d and vwap_7d > 0 and len(prices_7d) >= 36:
                seasonality_bias_pct = ((float(np.mean(same_hour_prices)) - vwap_7d) / vwap_7d) * 100.0

            # Price changes
            price_change_1h_pct = 0.0
            if mid_price and prev_1h_price and prev_1h_price > 0:
                price_change_1h_pct = ((mid_price - prev_1h_price) / prev_1h_price) * 100.0

            price_change_24h_pct = 0.0
            if mid_price and oldest_24h_price and oldest_24h_price > 0:
                price_change_24h_pct = ((mid_price - oldest_24h_price) / oldest_24h_price) * 100.0

            # Volume spike ratio (current 5m vs 24h average 5m)
            avg_5m_vol = vol_24h / 288.0 if vol_24h > 0 else 0.0
            volume_spike_ratio = (vol_5m / avg_5m_vol) if avg_5m_vol >= 1.0 else (1.0 if vol_5m > 0 else 0.0)

            # --- Actionable Buy/Sell prices & exact 2% GE tax ---
            suggested_buy: Optional[int] = None
            suggested_sell: Optional[int] = None
            raw_margin = 0
            tax = 0
            net_margin = 0
            net_roi_pct = 0.0
            is_mega_rare_capped = False

            if high and low and high > 0 and low > 0:
                raw_margin = high - low
                # Dynamic +/- 1 GP undercut when spread permits, slightly conservative under negative OFI
                if raw_margin >= 4:
                    suggested_buy = low + 1
                    suggested_sell = high - 1
                else:
                    suggested_buy = low
                    suggested_sell = high

                # If order flow is heavily negative (dumping), don't aggressively overbid
                if ofi_5m < -0.5 and raw_margin >= 10:
                    suggested_buy = low

                tax = calculate_ge_tax(suggested_sell, item_name=name, exempt=is_tax_exempt)
                net_margin = suggested_sell - suggested_buy - tax
                net_roi_pct = (net_margin / suggested_buy) * 100.0 if suggested_buy > 0 else 0.0
                is_mega_rare_capped = suggested_sell >= GE_MEGA_RARE_CAP_THRESHOLD and not is_tax_exempt

            eff_limit = buy_limit if buy_limit > 0 else 1
            max_profit_per_limit = net_margin * eff_limit if net_margin > 0 else 0

            # --- Estimated fill time & GP/hr (for 1 limit) ---
            capture_rate = 0.25  # Conservative 25% share of order flow
            if eff_vol_1h_h > 0 and eff_vol_1h_l > 0 and eff_limit > 0:
                buy_hrs = eff_limit / (eff_vol_1h_l * capture_rate)
                sell_hrs = eff_limit / (eff_vol_1h_h * capture_rate)
                est_cycle_hrs = max(buy_hrs + sell_hrs, 0.06)  # Min ~3.6 min realistic cycle
                est_fill_min = min(est_cycle_hrs * 60.0, 1440.0)
            else:
                est_cycle_hrs = 24.0
                est_fill_min = 1440.0

            est_gp_per_hour_limit = (
                int(max_profit_per_limit / max(est_cycle_hrs, 0.08))
                if max_profit_per_limit > 0 and est_fill_min < 1440.0
                else 0
            )

            # Flip Sharpe (margin vs price volatility)
            flip_sharpe = (net_roi_pct / max(volatility_24h_pct, 0.35)) if net_roi_pct > 0 else 0.0

            # High-Alch floor
            alch_profit = (highalch - low - self.nature_rune_price) if (highalch > 0 and low and low > 0) else -999_999_999
            alch_floor_pct: Optional[float] = None
            if highalch > 0 and low and low > 0:
                alch_floor_val = highalch - self.nature_rune_price
                if alch_floor_val > 0:
                    alch_floor_pct = ((low - alch_floor_val) / low) * 100.0

            # --- Anti-Trap & Manipulation Guard ---
            flags: list[str] = []
            max_age = max(high_age or 999999, low_age or 999999)
            if max_age > 1800:
                flags.append("STALE_QUOTE")
            if high and low and low > high:
                flags.append("INVERTED_SPREAD")
            if vol_24h < 20 or eff_vol_1h_h == 0 or eff_vol_1h_l == 0:
                flags.append("LOW_LIQUIDITY")
            if vwap_24h and vwap_24h > 0 and high and low:
                # Flag wildly anomalous single-trade quote vs 24h VWAP
                if abs(high - vwap_24h) / vwap_24h > 0.25 or abs(low - vwap_24h) / vwap_24h > 0.25:
                    flags.append("OUTLIER_SPREAD")
            if ofi_5m < -0.65 and price_change_1h_pct < -3.0:
                flags.append("FALLING_KNIFE")
            if net_roi_pct > 35.0 and vol_24h < 200:
                flags.append("THIN_MANIPULATION_RISK")

            # --- Safety Score (0-100) ---
            safety = 100
            if max_age > 300:
                safety -= min(30, int((max_age - 300) / 120))
            if vol_24h < 100:
                safety -= 25
            elif vol_24h < 500:
                safety -= 10
            if abs(ofi_1h) > 0.55:
                safety -= 15
            if volatility_24h_pct > 6.0:
                safety -= min(25, int((volatility_24h_pct - 6.0) * 2.5))
            if "OUTLIER_SPREAD" in flags:
                safety -= 25
            if "INVERTED_SPREAD" in flags or "LOW_LIQUIDITY" in flags:
                safety -= 30
            if "THIN_MANIPULATION_RISK" in flags:
                safety -= 30
            if alch_floor_pct is not None and alch_floor_pct <= 3.0:
                safety += 12  # Hard High-Alch floor bonus
            safety_score = int(_clamp(safety, 0, 100))

            # --- Composite Strategy Scores (0-100) ---
            fast_flip_score = 0.0
            if net_margin > 0 and "INVERTED_SPREAD" not in flags and "LOW_LIQUIDITY" not in flags and max_age <= 1800:
                roi_pts = _clamp(net_roi_pct * 8.0, 0, 28)
                gph_pts = _clamp(math.log10(max(est_gp_per_hour_limit, 1)) * 5.0 - 15.0, 0, 30)
                liq_pts = _clamp(math.log10(max(eff_vol_1h, 1)) * 6.0, 0, 20)
                bal_pts = (1.0 - abs(ofi_1h)) * 12.0
                fresh_pts = _clamp(10.0 - (max_age / 180.0), 0, 10)
                fast_flip_score = _clamp(
                    (roi_pts + gph_pts + liq_pts + bal_pts + fresh_pts) * (safety_score / 100.0),
                    0.0,
                    100.0,
                )

            overnight_score = 0.0
            if net_margin > 0 and max_profit_per_limit >= 25_000 and vol_24h >= 30 and max_age <= 7200:
                profit_pts = _clamp(math.log10(max(max_profit_per_limit, 1)) * 8.0 - 25.0, 0, 38)
                sharpe_pts = _clamp(flip_sharpe * 10.0, 0, 27)
                roi_pts = _clamp(net_roi_pct * 4.5, 0, 20)
                seasonal_pts = _clamp(-seasonality_bias_pct * 3.0, 0, 10)  # Bonus if historically cheap right now
                cap_bonus = 5.0 if (is_mega_rare_capped or is_tax_exempt) else 0.0
                overnight_score = _clamp(
                    (profit_pts + sharpe_pts + roi_pts + seasonal_pts + cap_bonus) * (0.4 + 0.6 * safety_score / 100.0),
                    0.0,
                    100.0,
                )

            dump_sniper_score = 0.0
            dump_timeframe = "24h"
            dump_baseline_vwap: Optional[int] = int(round(vwap_24h)) if vwap_24h else None
            dump_drop_pct = 0.0
            dump_bounce_outlook = "NONE"
            dump_bounce_reason = "Trading within normal hourly range."
            dump_conservative_target: Optional[int] = None
            dump_full_target: Optional[int] = None

            # Use 24h hourly Z-score primarily for sudden panic shocks; compare against 7d trend to avoid bleeding downtrends
            if zscore_24h <= zscore_7d or candles_1h_count < 36:
                ref_z = zscore_24h
                dump_timeframe = "24h"
                base_vwap = vwap_24h
            else:
                ref_z = zscore_7d
                dump_timeframe = "7d"
                base_vwap = vwap_7d

            if base_vwap and base_vwap > 0 and low:
                dump_baseline_vwap = int(round(base_vwap))
                dump_drop_pct = ((low - base_vwap) / base_vwap) * 100.0

                # Realistic targets:
                # Conservative = 99% of min(24h VWAP, 7d VWAP) -> fast bounce back to today's normal level
                # Full = 98.5% of 7d VWAP -> full weekly mean reversion
                anchor_conservative = min(vwap_24h or base_vwap, vwap_7d or base_vwap)
                dump_conservative_target = max(suggested_sell or 0, int(round(anchor_conservative * 0.99)))
                dump_full_target = max(dump_conservative_target, int(round((vwap_7d or base_vwap) * 0.985)))

                # Distinguish sudden panic dump (high bounce odds) from multi-day bleed (low bounce odds)
                trend_7d_drift_pct = (
                    ((vwap_24h - vwap_7d) / vwap_7d) * 100.0
                    if (vwap_24h and vwap_7d and vwap_7d > 0)
                    else 0.0
                )
                is_sudden_shock = zscore_24h <= -1.6 and trend_7d_drift_pct > -4.5
                is_downtrend_bleed = trend_7d_drift_pct <= -5.0 and zscore_24h > -1.4

                if ref_z <= -1.6 and vol_24h >= 150 and (low_age or 99999) <= 900:
                    rebound_tax = calculate_ge_tax(
                        dump_conservative_target, item_name=name, exempt=is_tax_exempt
                    )
                    rebound_net = dump_conservative_target - low - rebound_tax
                    if rebound_net > 0:
                        if is_sudden_shock and (volume_spike_ratio >= 1.5 or zscore_24h <= -2.2):
                            dump_bounce_outlook = "HIGH"
                            dump_bounce_reason = (
                                f"Sudden drop ({dump_drop_pct:.1f}% vs 24h hourly VWAP) while 7d trend is stable "
                                f"({trend_7d_drift_pct:+.1f}%). Strong mean-reversion bounce setup."
                            )
                            trend_mult = 1.0
                        elif is_downtrend_bleed:
                            dump_bounce_outlook = "LOW"
                            dump_bounce_reason = (
                                f"Multi-day downtrend (24h avg is {trend_7d_drift_pct:.1f}% below 7d avg). "
                                "Could keep bleeding — wait for buy volume before entering."
                            )
                            trend_mult = 0.55
                        else:
                            dump_bounce_outlook = "MEDIUM"
                            dump_bounce_reason = (
                                f"Trading {abs(ref_z):.1f}σ below {dump_timeframe} hourly VWAP "
                                f"({dump_drop_pct:.1f}%). Watch for instant-buy volume to confirm bounce."
                            )
                            trend_mult = 0.85

                        z_pts = _clamp((-ref_z - 1.5) * 22.0, 0, 45)
                        spike_pts = _clamp(volume_spike_ratio * 8.0, 0, 25)
                        rebound_roi = (rebound_net / low) * 100.0
                        roi_pts = _clamp(rebound_roi * 5.0, 0, 20)
                        liq_pts = _clamp(math.log10(max(vol_24h, 1)) * 2.5, 0, 10)
                        dump_sniper_score = _clamp(
                            (z_pts + spike_pts + roi_pts + liq_pts) * trend_mult, 0.0, 100.0
                        )

            alch_floor_score = 0.0
            if (
                alch_floor_pct is not None
                and alch_floor_pct <= 4.0
                and net_margin > 0
                and vol_24h >= 100
                and max_age <= 3600
            ):
                floor_pts = _clamp((4.0 - alch_floor_pct) * 10.0, 0, 40)
                gph_pts = _clamp(math.log10(max(est_gp_per_hour_limit, 1)) * 6.0 - 15.0, 0, 35)
                roi_pts = _clamp(net_roi_pct * 8.0, 0, 25)
                alch_floor_score = _clamp(floor_pts + gph_pts + roi_pts, 0.0, 100.0)

            overall_score = max(fast_flip_score, overnight_score * 0.92, dump_sniper_score * 0.95, alch_floor_score * 0.9)

            new_metrics[item_id] = ItemMetrics(
                id=item_id,
                name=name,
                icon=icon,
                members=members,
                buy_limit=buy_limit,
                highalch=highalch,
                lowalch=lowalch,
                is_tax_exempt=is_tax_exempt,
                is_mega_rare_capped=is_mega_rare_capped,
                high=high,
                high_time=high_time,
                low=low,
                low_time=low_time,
                high_age_sec=high_age,
                low_age_sec=low_age,
                mid_price=mid_price,
                suggested_buy=suggested_buy,
                suggested_sell=suggested_sell,
                raw_margin=raw_margin,
                tax=tax,
                net_margin=net_margin,
                net_roi_pct=net_roi_pct,
                max_profit_per_limit=max_profit_per_limit,
                vol_5m_high=vol_5m_h,
                vol_5m_low=vol_5m_l,
                vol_5m=vol_5m,
                vol_1h_high=eff_vol_1h_h,
                vol_1h_low=eff_vol_1h_l,
                vol_1h=eff_vol_1h,
                vol_24h_high=vol_24h_h,
                vol_24h_low=vol_24h_l,
                vol_24h=vol_24h,
                avg_high_1h=avg_high_1h,
                avg_low_1h=avg_low_1h,
                ofi_5m=ofi_5m,
                ofi_1h=ofi_1h,
                ofi_24h=ofi_24h,
                vwap_24h=vwap_24h,
                vwap_7d=vwap_7d,
                std_24h=std_24h,
                std_7d=std_7d,
                candles_1h_count=candles_1h_count,
                volatility_24h_pct=volatility_24h_pct,
                zscore_24h=zscore_24h,
                zscore_7d=zscore_7d,
                price_change_1h_pct=price_change_1h_pct,
                price_change_24h_pct=price_change_24h_pct,
                volume_spike_ratio=volume_spike_ratio,
                seasonality_bias_pct=seasonality_bias_pct,
                dump_timeframe=dump_timeframe,
                dump_baseline_vwap=dump_baseline_vwap,
                dump_drop_pct=dump_drop_pct,
                dump_bounce_outlook=dump_bounce_outlook,
                dump_bounce_reason=dump_bounce_reason,
                dump_conservative_target=dump_conservative_target,
                dump_full_target=dump_full_target,
                est_fill_minutes_limit=est_fill_min,
                est_gp_per_hour_limit=est_gp_per_hour_limit,
                flip_sharpe=flip_sharpe,
                alch_profit=alch_profit,
                alch_floor_pct=alch_floor_pct,
                safety_score=safety_score,
                manipulation_flags=flags,
                fast_flip_score=fast_flip_score,
                overnight_score=overnight_score,
                dump_sniper_score=dump_sniper_score,
                alch_floor_score=alch_floor_score,
                overall_score=overall_score,
            )

        self.metrics = new_metrics
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        self.last_recompute_ms = elapsed_ms
        return elapsed_ms
