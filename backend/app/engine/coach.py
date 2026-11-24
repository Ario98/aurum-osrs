"""Proactive Offer Coach — Overnight-aware monitor for open GE slots (Hold / Relist / Bailout)."""

from __future__ import annotations

import time
from typing import Any

from app.engine.state import MarketState
from app.engine.tax import calculate_ge_tax


def evaluate_slot(slot: dict[str, Any], state: MarketState) -> dict[str, Any]:
    """Attach live market context & Proactive Offer Coach advice (respecting active vs overnight mode)."""
    item_id = int(slot["item_id"])
    status = slot["status"]
    buy_price = int(slot["buy_price"])
    target_sell = int(slot["target_sell_price"])
    qty = int(slot["quantity"])
    flip_mode = slot.get("flip_mode") or "active"
    is_overnight = flip_mode == "overnight"
    m = state.metrics.get(item_id)

    now = int(time.time())
    elapsed_min = max(0.0, (now - int(slot["opened_at"])) / 60.0)

    coach_action = "HOLD"
    coach_severity = "ok"  # ok | warning | danger | success
    coach_message = "Overnight offer resting calmly." if is_overnight else "Offer is competitively positioned."
    recommended_price: int | None = None

    live_high = m.high if m else None
    live_low = m.low if m else None
    est_tax = calculate_ge_tax(target_sell, item_name=slot["item_name"], exempt=bool(m and m.is_tax_exempt))
    expected_profit = (target_sell - buy_price - est_tax) * qty
    live_exit_profit = None

    if m and live_high and live_low:
        live_exit_tax = calculate_ge_tax(live_low, item_name=m.name, exempt=m.is_tax_exempt)
        live_exit_profit = (live_low - buy_price - live_exit_tax) * qty

        if is_overnight:
            # ------------------------------------------------------------------
            # OVERNIGHT MODE: Quiet during normal swings, anchored to fresh 48h regime
            # ------------------------------------------------------------------
            ref_p25 = m.p25_48h or m.p25_7d or live_low
            ref_p75 = m.p75_48h or m.p75_7d or live_high

            if status == "BUYING":
                gap_above_bid_pct = ((live_low - buy_price) / buy_price) * 100.0 if buy_price > 0 else 0.0
                new_bid = max(int(live_low * 0.988), min(live_low, ref_p25))
                if gap_above_bid_pct > 2.5 and new_bid > buy_price:
                    coach_action = "RELIST_BUY"
                    coach_severity = "warning"
                    recommended_price = new_bid
                    coach_message = (
                        f"Market is +{gap_above_bid_pct:.1f}% above your overnight bid "
                        f"({live_low:,} gp vs {buy_price:,}). Raise bid to {new_bid:,} gp so it fills tonight."
                    )
                elif m.trend_7d_pct < -5.5:
                    coach_action = "CANCEL"
                    coach_severity = "danger"
                    coach_message = (
                        f"Item broke into a 7d downtrend ({m.trend_7d_pct:.1f}%). "
                        "Cancel overnight buy to avoid waking up to a loss."
                    )
                else:
                    coach_message = (
                        f"Overnight bid resting calmly ({buy_price:,} vs live low {live_low:,}). "
                        "Waiting for normal dip to fill."
                    )

            elif status == "BOUGHT":
                rec_sell = min(int(live_high * 1.025), max(live_high - 1, ref_p75))
                coach_action = "LIST_SELL"
                coach_severity = "success"
                recommended_price = rec_sell
                coach_message = f"Overnight buy filled! List sell target at {rec_sell:,} gp (48h peak {ref_p75:,})."

            elif status == "SELLING":
                drop_from_buy_pct = ((live_high - buy_price) / buy_price) * 100.0 if buy_price > 0 else 0.0
                broke_7d_floor = bool(m.min_7d and live_low < int(m.min_7d * 0.97))
                realistic_cap = min(int(live_high * 1.025), max(live_high, ref_p75))
                realistic_sell = max(live_high - 1, min(realistic_cap, ref_p75))
                sell_gap_pct = ((target_sell - realistic_cap) / realistic_cap) * 100.0 if realistic_cap > 0 else 0.0
                if drop_from_buy_pct <= -6.0 or (broke_7d_floor and m.ofi_1h < -0.5):
                    rec_bail = max(live_low, live_high - 1)
                    coach_action = "BAILOUT_WARNING"
                    coach_severity = "danger"
                    recommended_price = rec_bail if target_sell > rec_bail else None
                    coach_message = (
                        f"Overnight breakdown ({drop_from_buy_pct:+.1f}% vs buy, broke 7d floor). "
                        + (
                            f"Consider bailing at {rec_bail:,} gp."
                            if target_sell > rec_bail
                            else f"Sell already positioned at {target_sell:,} gp for exit."
                        )
                    )
                elif live_high >= target_sell:
                    coach_action = "HOLD"
                    coach_severity = "success"
                    coach_message = f"Live high hit {live_high:,} gp — your overnight sell ({target_sell:,}) should fill soon!"
                elif target_sell > realistic_sell and (sell_gap_pct >= 1.5 or target_sell >= realistic_cap + 2):
                    rec_tax = calculate_ge_tax(realistic_sell, item_name=m.name, exempt=m.is_tax_exempt)
                    rec_net = (realistic_sell - buy_price - rec_tax) * qty
                    coach_action = "RELIST_SELL"
                    coach_severity = "warning"
                    recommended_price = realistic_sell
                    coach_message = (
                        f"Sell target ({target_sell:,}) is above recent 48h peak ({ref_p75:,} gp, live high {live_high:,}). "
                        f"Lower to {realistic_sell:,} gp ({rec_net:+,} gp net) to cash out cleanly."
                    )
                else:
                    coach_message = (
                        f"Overnight sell resting in 48h band ({target_sell:,} vs live high {live_high:,}). Hold patiently."
                    )
        else:
            # ------------------------------------------------------------------
            # ACTIVE FAST-FLIP MODE: Tight bid/ask competitiveness & fast crash guard
            # ------------------------------------------------------------------
            if status == "BUYING":
                rec_lower = max(1, live_low - max(1, int(live_low * 0.005)))
                if m.ofi_5m < -0.65 and m.price_change_1h_pct < -2.5:
                    if buy_price > rec_lower:
                        coach_action = "LOWER_BID"
                        coach_severity = "warning"
                        recommended_price = rec_lower
                        coach_message = f"Heavy selling pressure (OFI {m.ofi_5m:+.2f}) — lower bid to {recommended_price:,} gp or cancel."
                    else:
                        coach_action = "HOLD"
                        coach_severity = "ok"
                        coach_message = (
                            f"Bid defensively lowered to {buy_price:,} gp (below live low {live_low:,} during "
                            f"OFI {m.ofi_5m:+.2f} sell-off). Waiting safely or cancel."
                        )
                elif live_low > buy_price:
                    new_buy = live_low + 1
                    new_tax = calculate_ge_tax(live_high - 1, item_name=m.name, exempt=m.is_tax_exempt)
                    new_margin = (live_high - 1) - new_buy - new_tax
                    if new_margin > 0:
                        coach_action = "RELIST_BUY"
                        coach_severity = "warning"
                        recommended_price = new_buy
                        coach_message = f"Outbid! Live low is {live_low:,} gp — raise buy to {new_buy:,} gp (+{new_margin:,} gp/ea net)."
                    else:
                        coach_action = "CANCEL"
                        coach_severity = "danger"
                        coach_message = f"Margin collapsed after 2% tax (live {live_low:,} -> {live_high:,}). Cancel buy offer."
                elif buy_price == live_low and (live_high - live_low) < 4:
                    coach_action = "CANCEL"
                    coach_severity = "warning"
                    coach_message = (
                        f"Queue-locked spread ({live_low:,}->{live_high:,} gp) — tied behind bulk FIFO orders. "
                        "Cancel and pick an item with a >=4 gp spread for fast fills."
                    )
                elif buy_price == live_low and (live_high - live_low) >= 4 and elapsed_min >= 5.0:
                    new_buy = live_low + 1
                    new_tax = calculate_ge_tax(live_high - 1, item_name=m.name, exempt=m.is_tax_exempt)
                    new_margin = (live_high - 1) - new_buy - new_tax
                    if new_margin > 0:
                        coach_action = "RELIST_BUY"
                        coach_severity = "warning"
                        recommended_price = new_buy
                        coach_message = (
                            f"Tied at live low ({live_low:,} gp) for {int(elapsed_min)}m — bump +1 gp to "
                            f"{new_buy:,} gp to jump to front of the queue (+{new_margin:,} gp/ea net)."
                        )
                    else:
                        coach_message = f"Resting at live low ({buy_price:,} gp). Waiting to fill."
                else:
                    coach_message = f"Front of bid book ({buy_price:,} vs live low {live_low:,}). Waiting to fill."

            elif status == "BOUGHT":
                rec_sell = (live_high - 1) if (live_high - live_low >= 4) else live_high
                coach_action = "LIST_SELL"
                coach_severity = "success"
                recommended_price = rec_sell
                coach_message = f"Bought! List sell offer now at {rec_sell:,} gp."

            elif status == "SELLING":
                drop_from_buy_pct = ((live_high - buy_price) / buy_price) * 100.0 if buy_price > 0 else 0.0
                if (drop_from_buy_pct <= -3.5) or (m.ofi_5m < -0.7 and m.zscore_24h < -1.8 and live_high < target_sell):
                    rec_bail = max(live_low, live_high - 1)
                    coach_action = "BAILOUT_WARNING"
                    coach_severity = "danger"
                    recommended_price = rec_bail if target_sell > rec_bail else None
                    coach_message = (
                        f"Dump detected ({drop_from_buy_pct:+.1f}% vs buy, OFI {m.ofi_5m:+.2f}) — "
                        + (
                            f"consider bailing at {rec_bail:,} gp to protect capital."
                            if target_sell > rec_bail
                            else f"already priced at {target_sell:,} gp to exit."
                        )
                    )
                elif live_high < target_sell:
                    new_sell = live_high - 1
                    new_tax = calculate_ge_tax(new_sell, item_name=m.name, exempt=m.is_tax_exempt)
                    new_net = new_sell - buy_price - new_tax
                    coach_action = "RELIST_SELL"
                    coach_severity = "warning" if new_net >= 0 else "danger"
                    recommended_price = new_sell
                    if new_net >= 0:
                        coach_message = f"Undercut! Live high dropped to {live_high:,} — relist at {new_sell:,} gp (still +{new_net * qty:,} gp net)."
                    else:
                        coach_message = f"Undercut below breakeven ({live_high:,} gp). Relist at {new_sell:,} gp ({new_net * qty:,} gp) or hold for rebound."
                elif live_high > target_sell * 1.015:
                    coach_action = "HOLD"
                    coach_severity = "success"
                    coach_message = f"Price surged to {live_high:,} gp — your sell at {target_sell:,} should fill imminently!"
                else:
                    coach_message = f"Competitive sell ({target_sell:,} vs live high {live_high:,})."

    return {
        **slot,
        "flip_mode": flip_mode,
        "icon": m.icon if m else "",
        "elapsed_minutes": round(elapsed_min, 1),
        "live_high": live_high,
        "live_low": live_low,
        "ofi_5m": round(m.ofi_5m, 2) if m else 0.0,
        "expected_tax": est_tax * qty,
        "expected_net_profit": expected_profit,
        "live_exit_profit": live_exit_profit,
        "coach_action": coach_action,
        "coach_severity": coach_severity,
        "coach_message": coach_message,
        "recommended_price": recommended_price,
    }
