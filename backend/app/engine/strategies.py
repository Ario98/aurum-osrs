"""Action-First Trade Call generator & cash-stack slot allocator."""

from __future__ import annotations

from typing import Any, Optional

from app.engine.state import ItemMetrics, MarketState
from app.engine.tax import calculate_ge_tax


def _format_fill_time(minutes: float) -> str:
    if minutes < 60:
        return f"~{max(1, round(minutes))}m"
    hours = minutes / 60.0
    if hours < 24:
        return f"~{hours:.1f}h"
    return "24h+"


def generate_trade_calls(
    state: MarketState,
    cash_stack: int = 25_000_000,
    free_slots: int = 8,
    mode: str = "auto_mix",
    members: bool = True,
    exclude_item_ids: Optional[set[int]] = None,
    buy_limit_used: Optional[dict[int, int]] = None,
    min_safety: int = 45,
    count: int = 8,
) -> list[dict[str, Any]]:
    """Build exact, actionable Trade Calls sized to the player's bankroll & free GE slots."""
    exclude = exclude_item_ids or set()
    limit_used = buy_limit_used or {}
    slots_to_plan = max(1, min(free_slots, 8))
    max_results = max(count, slots_to_plan)

    # Diversification budget per slot (never put >40% of bankroll into 1 slot when >=3 slots free)
    if slots_to_plan == 1:
        per_slot_cap = cash_stack
    elif slots_to_plan == 2:
        per_slot_cap = int(cash_stack * 0.55)
    else:
        per_slot_cap = int(cash_stack / max(slots_to_plan * 0.72, 1.0))
        per_slot_cap = min(per_slot_cap, int(cash_stack * 0.38))

    candidates: list[tuple[float, str, ItemMetrics, int, int, int, int, float, int, str]] = []

    for m in state.metrics.values():
        if m.id in exclude:
            continue
        if not members and m.members:
            continue
        if not m.suggested_buy or not m.suggested_sell:
            continue
        if m.suggested_buy > per_slot_cap:
            continue

        # Respect remaining 4h buy limit
        eff_limit = m.buy_limit if m.buy_limit > 0 else 10_000
        remaining_limit = max(0, eff_limit - limit_used.get(m.id, 0))
        if remaining_limit <= 0:
            continue

        # Determine strategy fit & actionable pricing
        strategy_tag = mode
        score = 0.0
        buy_price = m.suggested_buy
        sell_price = m.suggested_sell
        reason_parts: list[str] = []

        if mode == "fast_flip":
            if m.safety_score < min_safety or m.fast_flip_score < 20:
                continue
            score = m.fast_flip_score
            reason_parts.append("Fast high-volume spread")
        elif mode == "overnight":
            if m.safety_score < max(35, min_safety - 10) or m.overnight_score < 20:
                continue
            score = m.overnight_score
            reason_parts.append("High margin per 4h limit")
        elif mode == "dump_sniper":
            if m.dump_sniper_score < 25 or not m.vwap_7d or not m.low or m.vol_1h < 2:
                continue
            strategy_tag = "dump_sniper"
            buy_price = m.low
            sell_price = max(m.suggested_sell, int(m.vwap_7d * 0.985))
            score = m.dump_sniper_score
            reason_parts.append(f"Panic dump ({min(m.zscore_24h, m.zscore_7d):.1f}σ below VWAP)")
        elif mode == "alch_floor":
            if m.alch_floor_score < 20:
                continue
            score = m.alch_floor_score
            reason_parts.append(f"Protected near High Alch floor ({m.alch_floor_pct:+.1f}%)")
        else:
            # auto_mix: pick strongest valid edge for this item
            if m.dump_sniper_score >= 65 and m.vwap_7d and m.low and m.vol_1h >= 5:
                strategy_tag = "dump_sniper"
                buy_price = m.low
                sell_price = max(m.suggested_sell, int(m.vwap_7d * 0.985))
                score = m.dump_sniper_score * 1.02
                reason_parts.append(f"Dump snipe ({min(m.zscore_24h, m.zscore_7d):.1f}σ below VWAP)")
            elif m.fast_flip_score >= m.overnight_score and m.fast_flip_score >= 25 and m.safety_score >= min_safety:
                strategy_tag = "fast_flip"
                score = m.fast_flip_score
                reason_parts.append("Fast high-volume flip")
            elif m.alch_floor_score >= 45 and m.safety_score >= min_safety:
                strategy_tag = "alch_floor"
                score = m.alch_floor_score
                reason_parts.append("Safe High-Alch floor")
            elif m.overnight_score >= 30 and m.safety_score >= max(40, min_safety - 5):
                strategy_tag = "overnight"
                score = m.overnight_score
                reason_parts.append("Big-margin swing")
            else:
                continue

        # Budget-aware sizing
        affordable_qty = per_slot_cap // buy_price
        # Don't ask the player to buy more than ~45% of 1h volume for fast flips so fills stay snappy
        if strategy_tag == "fast_flip" and m.vol_1h > 0:
            flow_cap = max(1, int(min(m.vol_1h_low, m.vol_1h_high) * 0.45))
            qty = min(remaining_limit, affordable_qty, flow_cap)
        else:
            qty = min(remaining_limit, affordable_qty)

        if qty <= 0:
            continue

        tax_unit = calculate_ge_tax(sell_price, item_name=m.name, exempt=m.is_tax_exempt)
        net_unit = sell_price - buy_price - tax_unit
        if net_unit <= 0:
            continue

        est_net_profit = net_unit * qty
        capital_needed = buy_price * qty

        # Minimum worthwhile profit scaled to bank size
        min_profit = max(1_500, int(cash_stack * 0.0004))
        if est_net_profit < min_profit:
            continue

        # Personalized fill time for THIS exact quantity
        capture = 0.25
        if m.vol_1h_low > 0 and m.vol_1h_high > 0:
            buy_hrs = qty / (m.vol_1h_low * capture)
            sell_hrs = qty / (m.vol_1h_high * capture)
            cycle_hrs = max(buy_hrs + sell_hrs, 0.05)
        else:
            cycle_hrs = 6.0 if strategy_tag != "fast_flip" else 2.0

        est_fill_min = min(cycle_hrs * 60.0, 720.0)
        est_gp_hr = int(est_net_profit / max(cycle_hrs, 0.08))

        # Personalize ranking by real GP/hr for the player's actual cash stack!
        roi_pct = (net_unit / buy_price) * 100.0
        personalized_rank = score * 0.55 + min(45.0, (est_gp_hr / max(cash_stack * 0.02, 50_000)) * 20.0)
        if m.is_tax_exempt:
            reason_parts.append("0% GE tax")
        elif m.is_mega_rare_capped:
            reason_parts.append("5M tax cap edge")
        if abs(m.ofi_1h) <= 0.25:
            reason_parts.append("Balanced flow")
        elif m.ofi_1h > 0.35:
            reason_parts.append("Strong buy pressure")
        if m.seasonality_bias_pct <= -1.2:
            reason_parts.append("Historically cheap hour")

        reason_parts.append(f"{roi_pct:.1f}% net ROI · fills {_format_fill_time(est_fill_min)}")

        candidates.append(
            (
                personalized_rank,
                strategy_tag,
                m,
                qty,
                buy_price,
                sell_price,
                est_net_profit,
                est_fill_min,
                est_gp_hr,
                " · ".join(reason_parts),
            )
        )

    candidates.sort(key=lambda x: x[0], reverse=True)

    # Allocate greedily within remaining cash_stack while keeping top alternatives visible
    results: list[dict[str, Any]] = []
    remaining_cash = cash_stack

    for rank, tag, m, qty, buy_p, sell_p, profit, fill_min, gp_hr, reason in candidates:
        if len(results) >= max_results:
            break

        # If we're filling the first `slots_to_plan` slots, size down if remaining_cash is tighter
        if len(results) < slots_to_plan and buy_p * qty > remaining_cash:
            adjusted_qty = remaining_cash // buy_p
            if adjusted_qty <= 0:
                continue
            qty = adjusted_qty
            tax_u = calculate_ge_tax(sell_p, item_name=m.name, exempt=m.is_tax_exempt)
            profit = (sell_p - buy_p - tax_u) * qty
            if profit <= 0:
                continue

        capital_required = buy_p * qty
        if len(results) < slots_to_plan:
            remaining_cash = max(0, remaining_cash - capital_required)

        tax_unit = calculate_ge_tax(sell_p, item_name=m.name, exempt=m.is_tax_exempt)
        roi_pct = ((sell_p - buy_p - tax_unit) / buy_p) * 100.0

        results.append(
            {
                "item_id": m.id,
                "item_name": m.name,
                "icon": m.icon,
                "members": m.members,
                "strategy": tag,
                "action": "BUY_AND_FLIP",
                "buy_price": buy_p,
                "sell_price": sell_p,
                "quantity": qty,
                "buy_limit": m.buy_limit,
                "capital_required": capital_required,
                "tax_per_unit": tax_unit,
                "total_tax": tax_unit * qty,
                "net_margin_unit": sell_p - buy_p - tax_unit,
                "est_net_profit": profit,
                "net_roi_pct": round(roi_pct, 2),
                "est_fill_minutes": round(fill_min, 1),
                "est_fill_label": _format_fill_time(fill_min),
                "est_gp_per_hour": gp_hr,
                "safety_score": m.safety_score,
                "confidence_score": round(min(99.0, rank), 1),
                "is_tax_exempt": m.is_tax_exempt,
                "is_mega_rare_capped": m.is_mega_rare_capped,
                "ofi_1h": round(m.ofi_1h, 2),
                "zscore_7d": round(m.zscore_7d, 2),
                "vol_1h": m.vol_1h,
                "vol_24h": m.vol_24h,
                "high_age_sec": m.high_age_sec,
                "low_age_sec": m.low_age_sec,
                "reason": reason,
                "manipulation_flags": m.manipulation_flags,
            }
        )

    return results
