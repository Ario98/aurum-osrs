"""Deterministic Arbitrage API router (Item Sets, Potion Decanting, High Alchemy)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request

from app.auth import require_auth
from app.engine.arbitrage import (
    scan_herb_and_zahur,
    scan_high_alch,
    scan_item_sets,
    scan_potion_decanting,
    scan_processing_and_enchanting,
)

router = APIRouter(prefix="/api/arbitrage", tags=["arbitrage"], dependencies=[Depends(require_auth)])


@router.get("/summary")
async def arbitrage_summary(
    request: Request,
    members: bool = Query(default=True),
) -> dict[str, Any]:
    state = request.app.state.market_state
    return {
        "nature_rune_price": state.nature_rune_price,
        "sets": scan_item_sets(state, members=members, min_profit=5_000),
        "decanting": scan_potion_decanting(state, members=members, min_profit_per_4dose=5, limit=30),
        "herbs_zahur": scan_herb_and_zahur(state, members=members),
        "processing": scan_processing_and_enchanting(state, members=members),
        "high_alch": scan_high_alch(state, members=members, min_profit=50, limit=30),
    }
