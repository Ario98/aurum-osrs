"""Active 8-slot GE tracker, Proactive Offer Coach feed, 4h Buy Limits & Flip Journal."""

from __future__ import annotations

import time
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.auth import require_auth
from app.engine.coach import evaluate_slot
from app.engine.tax import calculate_net_flip

router = APIRouter(prefix="/api", tags=["slots"], dependencies=[Depends(require_auth)])


class SlotCreateRequest(BaseModel):
    slot_number: Optional[int] = Field(default=None, ge=1, le=8)
    item_id: int
    item_name: Optional[str] = None
    status: str = Field(default="BUYING", pattern="^(BUYING|BOUGHT|SELLING)$")
    quantity: int = Field(ge=1)
    buy_price: int = Field(ge=1)
    target_sell_price: int = Field(ge=1)
    flip_mode: str = Field(default="active", pattern="^(active|overnight)$")
    notes: str = ""


class SlotUpdateRequest(BaseModel):
    status: Optional[str] = Field(default=None, pattern="^(BUYING|BOUGHT|SELLING)$")
    quantity: Optional[int] = Field(default=None, ge=1)
    filled_quantity: Optional[int] = Field(default=None, ge=0)
    buy_price: Optional[int] = Field(default=None, ge=1)
    target_sell_price: Optional[int] = Field(default=None, ge=1)
    flip_mode: Optional[str] = Field(default=None, pattern="^(active|overnight)$")
    notes: Optional[str] = None


class CompleteFlipRequest(BaseModel):
    sell_price: Optional[int] = Field(default=None, ge=1)
    quantity: Optional[int] = Field(default=None, ge=1)


@router.get("/slots")
async def list_slots(request: Request) -> dict[str, Any]:
    repo = request.app.state.repo
    state = request.app.state.market_state
    raw_slots = await repo.get_active_slots()
    evaluated = [evaluate_slot(s, state) for s in raw_slots]
    return {
        "used_slots": len(evaluated),
        "free_slots": max(0, 8 - len(evaluated)),
        "slots": evaluated,
    }


@router.post("/slots")
async def create_or_assign_slot(body: SlotCreateRequest, request: Request) -> dict[str, Any]:
    repo = request.app.state.repo
    state = request.app.state.market_state

    existing = await repo.get_active_slots()
    used_nums = {int(s["slot_number"]) for s in existing}
    slot_num = body.slot_number
    if slot_num is None:
        free = [n for n in range(1, 9) if n not in used_nums]
        if not free:
            raise HTTPException(status_code=400, detail="All 8 GE slots are currently occupied")
        slot_num = free[0]

    meta = state.items.get(body.item_id, {})
    item_name = body.item_name or meta.get("name") or f"Item #{body.item_id}"

    slot = await repo.upsert_slot(
        slot_number=slot_num,
        item_id=body.item_id,
        item_name=item_name,
        status=body.status,
        quantity=body.quantity,
        buy_price=body.buy_price,
        target_sell_price=body.target_sell_price,
        filled_quantity=body.quantity if body.status in ("BOUGHT", "SELLING") else 0,
        source="manual",
        notes=body.notes,
        flip_mode=body.flip_mode,
    )

    if body.status in ("BOUGHT", "SELLING"):
        buy_limit = int(meta.get("buy_limit") or 0)
        await repo.record_buy_limit_usage(body.item_id, item_name, body.quantity, buy_limit)

    evaluated = evaluate_slot(slot, state)
    await request.app.state.ws_hub.broadcast({"type": "slots_updated"})
    return evaluated


@router.patch("/slots/{slot_number}")
async def update_slot(slot_number: int, body: SlotUpdateRequest, request: Request) -> dict[str, Any]:
    repo = request.app.state.repo
    state = request.app.state.market_state
    existing = await repo.get_slot(slot_number)
    if not existing:
        raise HTTPException(status_code=404, detail=f"Slot {slot_number} is empty")

    new_status = body.status or existing["status"]
    new_qty = body.quantity or int(existing["quantity"])
    new_buy = body.buy_price or int(existing["buy_price"])
    new_sell = body.target_sell_price or int(existing["target_sell_price"])
    new_filled = (
        body.filled_quantity
        if body.filled_quantity is not None
        else (new_qty if new_status in ("BOUGHT", "SELLING") else int(existing["filled_quantity"]))
    )
    new_notes = body.notes if body.notes is not None else existing.get("notes", "")
    new_mode = body.flip_mode or existing.get("flip_mode", "active")

    # Record buy limit usage when transitioning BUYING -> BOUGHT/SELLING
    if existing["status"] == "BUYING" and new_status in ("BOUGHT", "SELLING"):
        meta = state.items.get(int(existing["item_id"]), {})
        await repo.record_buy_limit_usage(
            int(existing["item_id"]),
            existing["item_name"],
            new_qty,
            int(meta.get("buy_limit") or 0),
        )

    updated = await repo.upsert_slot(
        slot_number=slot_number,
        item_id=int(existing["item_id"]),
        item_name=existing["item_name"],
        status=new_status,
        quantity=new_qty,
        filled_quantity=new_filled,
        buy_price=new_buy,
        target_sell_price=new_sell,
        source=existing.get("source", "manual"),
        notes=new_notes,
        opened_at=int(existing["opened_at"]),
        flip_mode=new_mode,
    )
    await request.app.state.ws_hub.broadcast({"type": "slots_updated"})
    return evaluate_slot(updated, state)


@router.post("/slots/{slot_number}/complete")
async def complete_slot(
    slot_number: int,
    body: CompleteFlipRequest,
    request: Request,
) -> dict[str, Any]:
    repo = request.app.state.repo
    state = request.app.state.market_state
    existing = await repo.get_slot(slot_number)
    if not existing:
        raise HTTPException(status_code=404, detail=f"Slot {slot_number} is empty")

    qty = body.quantity or int(existing["quantity"])
    buy_price = int(existing["buy_price"])
    sell_price = body.sell_price or int(existing["target_sell_price"])
    item_id = int(existing["item_id"])
    item_name = existing["item_name"]
    m = state.metrics.get(item_id)

    tax_unit, net_profit, roi_pct = calculate_net_flip(
        buy_price=buy_price,
        sell_price=sell_price,
        quantity=qty,
        item_name=item_name,
        exempt=bool(m and m.is_tax_exempt),
    )

    flip_id = await repo.record_completed_flip(
        item_id=item_id,
        item_name=item_name,
        quantity=qty,
        buy_price=buy_price,
        sell_price=sell_price,
        tax_paid=tax_unit * qty,
        net_profit=net_profit,
        roi_pct=round(roi_pct, 2),
        opened_at=int(existing["opened_at"]),
        closed_at=int(time.time()),
        source=existing.get("source", "manual"),
    )
    await repo.delete_slot(slot_number)
    await request.app.state.ws_hub.broadcast({"type": "slots_updated"})

    return {
        "flip_id": flip_id,
        "item_id": item_id,
        "item_name": item_name,
        "quantity": qty,
        "buy_price": buy_price,
        "sell_price": sell_price,
        "tax_paid": tax_unit * qty,
        "net_profit": net_profit,
        "roi_pct": round(roi_pct, 2),
    }


@router.delete("/slots/{slot_number}")
async def clear_slot(slot_number: int, request: Request) -> dict[str, Any]:
    repo = request.app.state.repo
    deleted = await repo.delete_slot(slot_number)
    await request.app.state.ws_hub.broadcast({"type": "slots_updated"})
    return {"deleted": deleted, "slot_number": slot_number}


@router.get("/journal")
async def get_journal(
    request: Request,
    limit: int = Query(default=100, ge=1, le=500),
) -> dict[str, Any]:
    repo = request.app.state.repo
    summary = await repo.get_flip_summary()
    history = await repo.get_flip_history(limit=limit)
    buy_limits = await repo.get_active_buy_limits()
    analytics = await repo.get_journal_analytics()
    return {
        "summary": summary,
        "history": history,
        "buy_limits": buy_limits,
        "analytics": analytics,
    }


@router.get("/journal/export.csv")
async def export_journal_csv(request: Request) -> Any:
    import csv
    import io
    from datetime import datetime, timezone
    from fastapi.responses import Response

    repo = request.app.state.repo
    rows = await repo.get_flip_history(limit=5000)

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "closed_at_utc",
            "item_id",
            "item_name",
            "quantity",
            "buy_price",
            "sell_price",
            "tax_paid",
            "net_profit",
            "roi_pct",
            "duration_sec",
            "source",
        ]
    )
    for r in rows:
        dt_str = datetime.fromtimestamp(int(r["closed_at"]), tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        writer.writerow(
            [
                dt_str,
                r["item_id"],
                r["item_name"],
                r["quantity"],
                r["buy_price"],
                r["sell_price"],
                r["tax_paid"],
                r["net_profit"],
                r["roi_pct"],
                r["duration_sec"],
                r["source"],
            ]
        )

    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="osrs_flip_journal.csv"'},
    )


@router.get("/buy-limits")
async def get_buy_limits(request: Request) -> dict[str, Any]:
    repo = request.app.state.repo
    return {"buy_limits": await repo.get_active_buy_limits()}
