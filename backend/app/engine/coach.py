"""Proactive Offer Coach — monitors open GE slots and advises Hold / Relist / Bailout."""

from __future__ import annotations

import time
from typing import Any

from app.engine.state import MarketState
from app.engine.tax import calculate_ge_tax


def evaluate_slot(slot: dict[str, Any], state: MarketState) -> dict[str, Any]:
    """Attach live market context & Proactive Offer Coach advice to an active GE slot."""
    item_id = int(slot["item_id"])
    status = slot["status"]
    buy_price = int(slot["buy_price"])
    target_sell = int(slot["target_sell_price"])
    qty = int(slot["quantity"])
    m = state.metrics.get(item_id)

    now = int(time.time())
    elapsed_min = max(0.0, (now - int(slot["opened_at"])) / 60.0)

    coach_action = "HOLD"
    coach_severity = "ok"  # ok | warning | danger | success
    coach_message = "Offer is competitively positioned."
    recommended_price: int | None = None

    live_high = m.high if m else None
    live_low = m.low if m else None
    est_tax = calculate_ge_tax(target_sell, item_name=slot["item_name"], exempt=bool(m and m.is_tax_exempt))
    expected_profit = (target_sell - buy_price - est_tax) * qty
    live_exit_profit = None

    if m and live_high and live_low:
        live_exit_tax = calculate_ge_tax(live_low, item_name=m.name, exempt=m.is_tax_exempt)
        live_exit_profit = (live_low - buy_price - live_exit_tax) * qty

        if status == "BUYING":
            # Check if our buy offer was outbid or if the item is crashing
            if m.ofi_5m < -0.65 and m.price_change_1h_pct < -2.5:
                coach_action = "LOWER_BID"
                coach_severity = "warning"
                recommended_price = max(1, live_low - max(1, int(live_low * 0.005)))
                coach_message = f"Heavy selling pressure (OFI {m.ofi_5m:+.2f}) — lower bid to {recommended_price:,} gp or cancel."
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
            else:
                coach_message = f"Top of bid book ({buy_price:,} vs live low {live_low:,}). Waiting to fill."

        elif status == "BOUGHT":
            rec_sell = (live_high - 1) if (live_high - live_low >= 4) else live_high
            coach_action = "LIST_SELL"
            coach_severity = "success"
            recommended_price = rec_sell
            coach_message = f"Bought! List sell offer now at {rec_sell:,} gp."

        elif status == "SELLING":
            # Check for crash/dump bailout first
            drop_from_buy_pct = ((live_high - buy_price) / buy_price) * 100.0 if buy_price > 0 else 0.0
            if (drop_from_buy_pct <= -3.5) or (m.ofi_5m < -0.7 and m.zscore_24h < -1.8 and live_high < target_sell):
                coach_action = "BAILOUT_WARNING"
                coach_severity = "danger"
                recommended_price = max(live_low, live_high - 1)
                coach_message = (
                    f"Dump detected ({drop_from_buy_pct:+.1f}% vs buy, OFI {m.ofi_5m:+.2f}) — "
                    f"consider bailing at {recommended_price:,} gp to protect capital."
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
