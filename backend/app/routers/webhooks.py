"""RuneLite Dink Plugin GRAND_EXCHANGE Webhook Receiver (auto-syncs 8 slots, limits & P&L)."""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, Request, status

from app.auth import verify_dink_token
from app.engine.tax import calculate_net_flip

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


async def _parse_dink_payload(request: Request) -> dict[str, Any]:
    """Dink sends application/json, multipart/form-data, or form-encoded `payload_json`."""
    content_type = request.headers.get("content-type", "").lower()
    if "multipart/form-data" in content_type or "application/x-www-form-urlencoded" in content_type:
        form = await request.form()
        raw = form.get("payload_json")
        if not raw:
            raise HTTPException(status_code=400, detail="Missing payload_json in form body")
        return json.loads(str(raw))
    try:
        return await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON payload: {exc}") from exc


@router.post("/dink")
async def receive_dink_webhook(
    request: Request,
    token: Optional[str] = Query(default=None),
) -> dict[str, Any]:
    """Receive RuneLite Dink GRAND_EXCHANGE notifications and auto-update slots/journal/limits."""
    settings = request.app.state.settings
    header_token = request.headers.get("X-Webhook-Token")
    if not verify_dink_token(token or header_token, settings):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid webhook token")

    payload = await _parse_dink_payload(request)
    event_type = str(payload.get("type", "")).upper()
    if event_type != "GRAND_EXCHANGE":
        return {"ok": True, "ignored": True, "reason": f"Non-GE event: {event_type}"}

    extra = payload.get("extra") or {}
    item = extra.get("item") or {}
    slot_num = int(extra.get("slot") or 0)
    ge_status = str(extra.get("status", "")).upper()
    item_id = int(item.get("id") or 0)
    item_name = str(item.get("name") or "")
    quantity = int(item.get("quantity") or 0)
    price_each = int(item.get("priceEach") or 0)

    if not (1 <= slot_num <= 8) or item_id <= 0 or quantity <= 0:
        return {"ok": True, "ignored": True, "reason": "Incomplete GE payload"}

    repo = request.app.state.repo
    state = request.app.state.market_state
    alerts = request.app.state.alerts
    ws_hub = request.app.state.ws_hub

    meta = state.items.get(item_id, {})
    m = state.metrics.get(item_id)
    if not item_name:
        item_name = meta.get("name") or f"Item #{item_id}"

    existing = await repo.get_slot(slot_num)
    # Smart slot-matching: if user clicked Start Flip / Start Night into a different slot number,
    # find that matching item slot so Dink seamlessly adopts its flip_mode, target_sell, & opened_at
    # without leaving duplicate slots behind!
    matched_other: Optional[dict[str, Any]] = None
    if not existing or int(existing["item_id"]) != item_id:
        for s in await repo.get_active_slots():
            if int(s["item_id"]) == item_id:
                matched_other = s
                break

    prior = existing if (existing and int(existing["item_id"]) == item_id) else matched_other
    inherited_mode = (prior.get("flip_mode") or "active") if prior else "active"
    inherited_opened = int(prior["opened_at"]) if prior else None

    default_sell = (
        max(m.high - 1, m.p75_7d or m.high)
        if (inherited_mode == "overnight" and m and m.high)
        else (m.suggested_sell if m and m.suggested_sell else int(price_each * 1.03))
    )
    suggested_sell = int(prior["target_sell_price"]) if prior else default_sell
    buy_limit = int(meta.get("buy_limit") or 0)

    if ge_status in ("BUYING", "BUY"):
        if matched_other and int(matched_other["slot_number"]) != slot_num:
            await repo.delete_slot(int(matched_other["slot_number"]))
        await repo.upsert_slot(
            slot_number=slot_num,
            item_id=item_id,
            item_name=item_name,
            status="BUYING",
            quantity=quantity,
            buy_price=price_each,
            target_sell_price=suggested_sell,
            source="dink",
            opened_at=inherited_opened,
            flip_mode=inherited_mode,
        )
    elif ge_status == "BOUGHT":
        if matched_other and int(matched_other["slot_number"]) != slot_num:
            await repo.delete_slot(int(matched_other["slot_number"]))
        await repo.upsert_slot(
            slot_number=slot_num,
            item_id=item_id,
            item_name=item_name,
            status="BOUGHT",
            quantity=quantity,
            filled_quantity=quantity,
            buy_price=price_each,
            target_sell_price=suggested_sell,
            source="dink",
            opened_at=inherited_opened,
            flip_mode=inherited_mode,
        )
        await repo.record_buy_limit_usage(item_id, item_name, quantity, buy_limit)
        await alerts.emit(
            alert_type="DINK_BOUGHT",
            dedupe_key=f"bought_{slot_num}_{item_id}_{int(time.time()) // 15}",
            title=f"Slot {slot_num} Bought: {quantity:,}x {item_name}",
            message=f"Filled @ {price_each:,} gp. Suggested sell price: **{suggested_sell:,} gp**.",
            severity="info",
            item_id=item_id,
            item_name=item_name,
            cooldown_sec=5,
            send_to_discord=False,
        )
    elif ge_status in ("SELLING", "SELL"):
        if matched_other and int(matched_other["slot_number"]) != slot_num:
            await repo.delete_slot(int(matched_other["slot_number"]))
        buy_p = int(prior["buy_price"]) if prior else (m.low or price_each if m else price_each)
        await repo.upsert_slot(
            slot_number=slot_num,
            item_id=item_id,
            item_name=item_name,
            status="SELLING",
            quantity=quantity,
            filled_quantity=quantity,
            buy_price=buy_p,
            target_sell_price=price_each,
            source="dink",
            opened_at=inherited_opened,
            flip_mode=inherited_mode,
        )
    elif ge_status == "SOLD":
        matched_slot = prior
        if matched_slot:
            buy_p = int(matched_slot["buy_price"])
            opened_at = int(matched_slot["opened_at"])
            tax_unit, net_profit, roi_pct = calculate_net_flip(
                buy_price=buy_p,
                sell_price=price_each,
                quantity=quantity,
                item_name=item_name,
                exempt=bool(m and m.is_tax_exempt),
            )
            await repo.record_completed_flip(
                item_id=item_id,
                item_name=item_name,
                quantity=quantity,
                buy_price=buy_p,
                sell_price=price_each,
                tax_paid=tax_unit * quantity,
                net_profit=net_profit,
                roi_pct=round(roi_pct, 2),
                opened_at=opened_at,
                source="dink",
            )
            await repo.delete_slot(int(matched_slot["slot_number"]))
            if int(matched_slot["slot_number"]) != slot_num:
                await repo.delete_slot(slot_num)

            sign = "+" if net_profit >= 0 else ""
            await alerts.emit(
                alert_type="DINK_SOLD",
                dedupe_key=f"sold_{slot_num}_{item_id}_{int(time.time()) // 15}",
                title=f"Flip Completed: {quantity:,}x {item_name} ({sign}{net_profit:,} gp)",
                message=f"Bought @ {buy_p:,} -> Sold @ {price_each:,} gp (after 2% tax: {tax_unit * quantity:,} gp).",
                severity="success" if net_profit >= 0 else "warning",
                item_id=item_id,
                item_name=item_name,
                cooldown_sec=5,
                send_to_discord=False,
            )
        else:
            await repo.delete_slot(slot_num)
            await alerts.emit(
                alert_type="DINK_SOLD_UNTRACKED",
                dedupe_key=f"sold_untracked_{slot_num}_{item_id}_{int(time.time()) // 15}",
                title=f"Dink Sold: {quantity:,}x {item_name} @ {price_each:,} gp",
                message="Completed sale received from RuneLite Dink (no prior tracked buy price).",
                severity="info",
                item_id=item_id,
                item_name=item_name,
                cooldown_sec=5,
                send_to_discord=False,
            )
    elif ge_status in ("CANCELLED_BUY", "CANCELLED_SELL", "EMPTY"):
        await repo.delete_slot(slot_num)
        if matched_other and int(matched_other["slot_number"]) != slot_num:
            await repo.delete_slot(int(matched_other["slot_number"]))

    await ws_hub.broadcast({"type": "slots_updated", "source": "dink"})
    logger.info("Processed Dink GE event: slot=%d status=%s item=%s qty=%d price=%d", slot_num, ge_status, item_name, quantity, price_each)
    return {"ok": True, "slot": slot_num, "status": ge_status, "item_id": item_id}
