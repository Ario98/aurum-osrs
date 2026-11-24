"""Personal Watchlist & Custom Price/Margin Alert Targets API."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth import require_auth

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"], dependencies=[Depends(require_auth)])


class WatchlistUpsertRequest(BaseModel):
    item_id: int
    item_name: Optional[str] = None
    buy_below: Optional[int] = Field(default=None, ge=1)
    sell_above: Optional[int] = Field(default=None, ge=1)
    min_net_margin: Optional[int] = Field(default=None, ge=1)
    discord_notify: bool = True
    notes: str = ""


def _enrich_watch_item(entry: dict[str, Any], state: Any) -> dict[str, Any]:
    item_id = int(entry["item_id"])
    m = state.metrics.get(item_id)
    triggered: list[str] = []
    if m:
        if entry.get("buy_below") and m.low and m.low <= int(entry["buy_below"]):
            triggered.append("BUY_BELOW")
        if entry.get("sell_above") and m.high and m.high >= int(entry["sell_above"]):
            triggered.append("SELL_ABOVE")
        if entry.get("min_net_margin") and m.net_margin >= int(entry["min_net_margin"]):
            triggered.append("MIN_MARGIN")

    return {
        **entry,
        "icon": m.icon if m else "",
        "high": m.high if m else None,
        "low": m.low if m else None,
        "high_age_sec": m.high_age_sec if m else None,
        "low_age_sec": m.low_age_sec if m else None,
        "net_margin": m.net_margin if m else 0,
        "net_roi_pct": round(m.net_roi_pct, 2) if m else 0.0,
        "vol_1h": m.vol_1h if m else 0,
        "vol_24h": m.vol_24h if m else 0,
        "price_change_1h_pct": round(m.price_change_1h_pct, 2) if m else 0.0,
        "price_change_24h_pct": round(m.price_change_24h_pct, 2) if m else 0.0,
        "trend_7d_pct": round(m.trend_7d_pct, 2) if m else 0.0,
        "ofi_5m": round(m.ofi_5m, 2) if m else 0.0,
        "ofi_1h": round(m.ofi_1h, 2) if m else 0.0,
        "zscore_7d": round(m.zscore_7d, 2) if m else 0.0,
        "safety_score": m.safety_score if m else 0,
        "is_tax_exempt": m.is_tax_exempt if m else False,
        "triggered": triggered,
    }


@router.get("")
async def list_watchlist(request: Request) -> dict[str, Any]:
    repo = request.app.state.repo
    state = request.app.state.market_state
    raw = await repo.get_watchlist()
    return {"items": [_enrich_watch_item(e, state) for e in raw]}


@router.post("")
async def upsert_watchlist(body: WatchlistUpsertRequest, request: Request) -> dict[str, Any]:
    repo = request.app.state.repo
    state = request.app.state.market_state
    meta = state.items.get(body.item_id)
    if not meta and not body.item_name:
        raise HTTPException(status_code=404, detail="Item not found")
    name = body.item_name or (meta.get("name") if meta else f"Item #{body.item_id}")

    saved = await repo.upsert_watchlist_item(
        item_id=body.item_id,
        item_name=name,
        buy_below=body.buy_below,
        sell_above=body.sell_above,
        min_net_margin=body.min_net_margin,
        discord_notify=body.discord_notify,
        notes=body.notes,
    )
    return _enrich_watch_item(saved, state)


@router.delete("/{item_id}")
async def remove_watchlist(item_id: int, request: Request) -> dict[str, Any]:
    repo = request.app.state.repo
    deleted = await repo.delete_watchlist_item(item_id)
    return {"deleted": deleted, "item_id": item_id}
