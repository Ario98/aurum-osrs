"""Market status, Action-First Trade Calls, 4,100-item Scanner & lazy /timeseries charts."""

from __future__ import annotations

import time
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.auth import require_auth
from app.engine.strategies import generate_overnight_flips, generate_trade_calls
from app.routers.system import compute_quick_health

router = APIRouter(prefix="/api/market", tags=["market"], dependencies=[Depends(require_auth)])


@router.get("/status")
async def market_status(request: Request) -> dict[str, Any]:
    state = request.app.state.market_state
    wiki = request.app.state.wiki_client
    db = request.app.state.db
    health_status, health_issues = compute_quick_health(state, wiki, db.db_path)
    return {
        "ready": state.bootstrap_fast_done,
        "enrichment_done": state.bootstrap_bg_done,
        "bootstrap": state.bootstrap_progress,
        "items_tracked": len(state.metrics),
        "last_latest_update": state.last_latest_update,
        "last_recompute_ms": round(state.last_recompute_ms, 2),
        "nature_rune_price": state.nature_rune_price,
        "total_wiki_requests": wiki.total_requests,
        "health_status": health_status,
        "health_issues": health_issues,
    }


@router.get("/trade-calls")
async def get_trade_calls(
    request: Request,
    cash_stack: Optional[int] = Query(default=None, ge=10_000),
    free_slots: Optional[int] = Query(default=None, ge=1, le=8),
    mode: str = Query(default="auto_mix", pattern="^(auto_mix|fast_flip|overnight|dump_sniper|alch_floor)$"),
    members: Optional[bool] = Query(default=None),
    min_safety: int = Query(default=45, ge=0, le=100),
    count: int = Query(default=12, ge=1, le=30),
    ml_boost: bool = Query(default=True),
) -> dict[str, Any]:
    state = request.app.state.market_state
    repo = request.app.state.repo
    settings = request.app.state.settings
    ml = getattr(request.app.state, "ml_predictor", None)
    saved = await repo.get_all_settings()

    eff_cash = cash_stack if cash_stack is not None else int(saved.get("cash_stack", settings.default_cash_stack))
    eff_members = members if members is not None else bool(saved.get("members", settings.default_members))

    active_slots = await repo.get_active_slots()
    used_slot_count = len(active_slots)
    eff_free_slots = free_slots if free_slots is not None else max(1, int(saved.get("ge_slots", settings.default_ge_slots)) - used_slot_count)
    exclude_ids = {int(s["item_id"]) for s in active_slots}

    limits = await repo.get_active_buy_limits()
    buy_limit_used = {int(l["item_id"]): int(l["quantity_bought"]) for l in limits}

    ml_loaded = bool(ml and ml.loaded)
    ml_validated = bool(ml and ml.validated)
    eff_ml_boost = bool(ml_boost and ml_validated)

    calls = generate_trade_calls(
        state=state,
        cash_stack=eff_cash,
        free_slots=eff_free_slots,
        mode=mode,
        members=eff_members,
        exclude_item_ids=exclude_ids,
        buy_limit_used=buy_limit_used,
        min_safety=min_safety,
        count=count,
        ml_predictions=(ml.predictions if ml_loaded else None),
        ml_boost_active=eff_ml_boost,
    )
    total_est_profit = sum(c["est_net_profit"] for c in calls[:eff_free_slots])
    total_est_gp_hr = sum(c["est_gp_per_hour"] for c in calls[:eff_free_slots])
    total_capital = sum(c["capital_required"] for c in calls[:eff_free_slots])

    return {
        "cash_stack": eff_cash,
        "free_slots": eff_free_slots,
        "active_slots_count": used_slot_count,
        "mode": mode,
        "members": eff_members,
        "ml_meta": {
            "loaded": ml_loaded,
            "validated": ml_validated,
            "boost_active": eff_ml_boost,
        },
        "summary": {
            "allocated_capital": total_capital,
            "est_batch_profit": total_est_profit,
            "est_combined_gp_per_hour": total_est_gp_hr,
        },
        "calls": calls,
    }


@router.get("/overnight")
async def get_overnight_flips(
    request: Request,
    cash_stack: Optional[int] = Query(default=None, ge=10_000),
    slots: int = Query(default=8, ge=1, le=8),
    style: str = Query(default="balanced", pattern="^(balanced|safe|high_margin)$"),
    members: Optional[bool] = Query(default=None),
    count: int = Query(default=16, ge=1, le=40),
    ml_boost: bool = Query(default=True),
) -> dict[str, Any]:
    state = request.app.state.market_state
    repo = request.app.state.repo
    settings = request.app.state.settings
    ml = getattr(request.app.state, "ml_predictor", None)
    saved = await repo.get_all_settings()

    eff_cash = cash_stack if cash_stack is not None else int(saved.get("cash_stack", settings.default_cash_stack))
    eff_members = members if members is not None else bool(saved.get("members", settings.default_members))

    active_slots = await repo.get_active_slots()
    exclude_ids = {int(s["item_id"]) for s in active_slots}
    limits = await repo.get_active_buy_limits()
    buy_limit_used = {int(l["item_id"]): int(l["quantity_bought"]) for l in limits}

    ml_loaded = bool(ml and ml.loaded)
    ml_validated = bool(ml and ml.validated)
    eff_ml_boost = bool(ml_boost and ml_validated)

    flips = generate_overnight_flips(
        state=state,
        cash_stack=eff_cash,
        slots=slots,
        style=style,
        members=eff_members,
        exclude_item_ids=exclude_ids,
        buy_limit_used=buy_limit_used,
        count=count,
        ml_predictions=(ml.predictions if ml_loaded else None),
        ml_boost_active=eff_ml_boost,
    )
    planned = flips[:slots]
    total_capital = sum(f["capital_required"] for f in planned)
    total_profit = sum(f["est_net_profit"] for f in planned)
    avg_roi = (total_profit / total_capital * 100.0) if total_capital > 0 else 0.0

    return {
        "cash_stack": eff_cash,
        "slots": slots,
        "style": style,
        "members": eff_members,
        "ml_meta": {
            "loaded": ml_loaded,
            "validated": ml_validated,
            "boost_active": eff_ml_boost,
        },
        "summary": {
            "allocated_capital": total_capital,
            "est_overnight_profit": total_profit,
            "avg_roi_pct": round(avg_roi, 2),
            "picks_count": len(flips),
        },
        "flips": flips,
    }


@router.get("/scanner")
async def market_scanner(
    request: Request,
    q: str = Query(default=""),
    preset: str = Query(
        default="all",
        pattern="^(all|fast_flip|overnight|dump_sniper|alch_floor|tax_exempt|mega_rares)$",
    ),
    members: Optional[bool] = Query(default=None),
    min_price: Optional[int] = Query(default=None, ge=0),
    max_price: Optional[int] = Query(default=None, ge=0),
    min_vol_24h: int = Query(default=0, ge=0),
    min_roi: Optional[float] = Query(default=None),
    min_safety: int = Query(default=0, ge=0, le=100),
    hide_stale: bool = Query(default=True),
    sort_by: str = Query(default="overall_score"),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    limit: int = Query(default=250, ge=1, le=5000),
) -> dict[str, Any]:
    state = request.app.state.market_state
    query_lower = q.strip().lower()

    filtered = []
    for m in state.metrics.values():
        if query_lower and query_lower not in m.name.lower() and query_lower != str(m.id):
            continue
        if members is False and m.members:
            continue
        if hide_stale and not query_lower:
            if m.high is None or m.low is None:
                continue
            if "STALE_QUOTE" in m.manipulation_flags and preset not in ("all", "mega_rares", "tax_exempt"):
                continue
        if min_price is not None and (m.low or 0) < min_price:
            continue
        if max_price is not None and (m.low or 0) > max_price:
            continue
        if m.vol_24h < min_vol_24h:
            continue
        if min_roi is not None and m.net_roi_pct < min_roi:
            continue
        if m.safety_score < min_safety:
            continue

        if preset == "fast_flip" and m.fast_flip_score < 20:
            continue
        elif preset == "overnight" and m.overnight_score < 20:
            continue
        elif preset == "dump_sniper" and m.dump_sniper_score < 20:
            continue
        elif preset == "alch_floor" and m.alch_floor_score < 15:
            continue
        elif preset == "tax_exempt" and not m.is_tax_exempt:
            continue
        elif preset == "mega_rares" and not m.is_mega_rare_capped:
            continue

        filtered.append(m)

    valid_sort_fields = {
        "overall_score",
        "fast_flip_score",
        "overnight_score",
        "dump_sniper_score",
        "alch_floor_score",
        "net_margin",
        "net_roi_pct",
        "max_profit_per_limit",
        "est_gp_per_hour_limit",
        "vol_1h",
        "vol_24h",
        "high",
        "low",
        "safety_score",
        "flip_sharpe",
        "zscore_7d",
        "ofi_1h",
        "name",
    }
    sort_field = sort_by if sort_by in valid_sort_fields else "overall_score"
    reverse = sort_dir == "desc"

    def _sort_key(item: Any) -> Any:
        val = getattr(item, sort_field, 0)
        if val is None:
            return "" if sort_field == "name" else -1e18
        return val

    filtered.sort(key=_sort_key, reverse=reverse)
    return {
        "total_matched": len(filtered),
        "recompute_ms": round(state.last_recompute_ms, 2),
        "items": [m.to_dict() for m in filtered[:limit]],
    }


@router.get("/items/{item_id}")
async def get_item_detail(item_id: int, request: Request) -> dict[str, Any]:
    state = request.app.state.market_state
    ml = getattr(request.app.state, "ml_predictor", None)
    m = state.metrics.get(item_id)
    if not m:
        raise HTTPException(status_code=404, detail="Item not found")
    meta = state.items.get(item_id, {})
    pred = ml.predictions.get(item_id) if (ml and ml.loaded) else None
    return {
        **m.to_dict(),
        "examine": meta.get("examine", ""),
        "value": meta.get("value"),
        "nature_rune_price": state.nature_rune_price,
        "ml": pred.to_dict() if pred is not None else None,
    }


@router.get("/items/{item_id}/chart")
async def get_item_chart(
    item_id: int,
    request: Request,
    timestep: str = Query(default="5m", pattern="^(5m|1h|6h|24h)$"),
) -> dict[str, Any]:
    """Fetch chart candles lazily via Wiki /timeseries (with local TTL cache) for instant 30h/15d/90d/1y zoom."""
    state = request.app.state.market_state
    wiki = request.app.state.wiki_client
    settings = request.app.state.settings

    if item_id not in state.items:
        raise HTTPException(status_code=404, detail="Item not found")

    cache_key = (item_id, timestep)
    cached = state.timeseries_cache.get(cache_key)
    now = time.time()
    ttl = 120 if timestep == "5m" else settings.timeseries_cache_ttl_seconds

    if cached and (now - cached[0]) < ttl:
        points = cached[1]
        source = "cache"
    else:
        points = await wiki.fetch_timeseries(item_id=item_id, timestep=timestep)
        state.timeseries_cache[cache_key] = (now, points)
        source = "wiki_timeseries"

    return {
        "item_id": item_id,
        "timestep": timestep,
        "source": source,
        "points": points,
    }
