"""Real-time Alert Dispatcher — WebSocket push + Discord Webhook with cooldown deduplication."""

from __future__ import annotations

import logging
import time
from typing import Any, Awaitable, Callable, Optional

import httpx

from app.config import Settings
from app.db.repository import Repository
from app.engine.arbitrage import scan_item_sets, scan_potion_decanting
from app.engine.coach import evaluate_slot
from app.engine.state import MarketState

logger = logging.getLogger(__name__)

SEVERITY_COLORS = {
    "success": 0x10B981,  # Emerald
    "info": 0x3B82F6,     # Blue
    "warning": 0xF59E0B,  # Amber
    "danger": 0xEF4444,   # Red
}


class AlertDispatcher:
    """Evaluates dump snipes, instant arbitrage, and Offer Coach triggers with anti-spam cooldowns."""

    def __init__(
        self,
        settings: Settings,
        repo: Repository,
        broadcast_cb: Callable[[dict[str, Any]], Awaitable[None]],
    ):
        self.settings = settings
        self.repo = repo
        self.broadcast_cb = broadcast_cb
        # (alert_type, key) -> last_sent_epoch
        self._cooldowns: dict[tuple[str, str], float] = {}
        self._http = httpx.AsyncClient(timeout=httpx.Timeout(10.0))

    async def close(self) -> None:
        await self._http.aclose()

    def _can_emit(self, alert_type: str, key: str, cooldown_sec: int) -> bool:
        now = time.time()
        last = self._cooldowns.get((alert_type, key), 0.0)
        if now - last < cooldown_sec:
            return False
        self._cooldowns[(alert_type, key)] = now
        return True

    async def _get_discord_url(self) -> Optional[str]:
        saved = await self.repo.get_all_settings()
        url = saved.get("discord_webhook_url") or self.settings.discord_webhook_url
        if isinstance(url, str) and url.strip().startswith("https://"):
            return url.strip()
        return None

    async def send_discord(
        self,
        title: str,
        message: str,
        severity: str = "info",
        fields: Optional[list[dict[str, Any]]] = None,
        webhook_url: Optional[str] = None,
    ) -> bool:
        url = webhook_url or await self._get_discord_url()
        if not url:
            return False

        embed: dict[str, Any] = {
            "title": title,
            "description": message,
            "color": SEVERITY_COLORS.get(severity, 0x3B82F6),
            "footer": {"text": "OSRS Flip Terminal v2"},
        }
        if fields:
            embed["fields"] = fields

        try:
            resp = await self._http.post(url, json={"embeds": [embed]})
            if resp.status_code in (200, 204):
                return True
            logger.warning("Discord webhook returned %s: %s", resp.status_code, resp.text[:200])
            return False
        except httpx.HTTPError as exc:
            logger.warning("Discord webhook failed: %s", exc)
            return False

    async def emit(
        self,
        alert_type: str,
        dedupe_key: str,
        title: str,
        message: str,
        severity: str = "info",
        item_id: Optional[int] = None,
        item_name: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
        cooldown_sec: int = 900,
        send_to_discord: bool = True,
        discord_fields: Optional[list[dict[str, Any]]] = None,
    ) -> Optional[dict[str, Any]]:
        if not self._can_emit(alert_type, dedupe_key, cooldown_sec):
            return None

        discord_sent = False
        if send_to_discord:
            discord_sent = await self.send_discord(
                title=title,
                message=message,
                severity=severity,
                fields=discord_fields,
            )

        record = await self.repo.log_alert(
            alert_type=alert_type,
            title=title,
            message=message,
            severity=severity,
            item_id=item_id,
            item_name=item_name,
            metadata=metadata,
            discord_sent=discord_sent,
        )
        await self.broadcast_cb({"type": "alert", "alert": record})
        return record

    async def scan_and_dispatch(self, state: MarketState) -> None:
        """Run on every live /latest tick: check Offer Coach, Dump Snipes, and Instant Arbitrage."""
        user_cfg = await self.repo.get_all_settings()
        alerts_enabled = user_cfg.get("alerts_enabled", True)
        if not alerts_enabled:
            return

        members = bool(user_cfg.get("members", self.settings.default_members))
        discord_dumps = bool(user_cfg.get("discord_dump_alerts", True))
        discord_arb = bool(user_cfg.get("discord_arb_alerts", True))
        discord_coach = bool(user_cfg.get("discord_coach_alerts", True))
        min_dump_score = float(user_cfg.get("alert_min_dump_score", 72))
        min_arb_profit = int(user_cfg.get("alert_min_arb_profit", 75_000))

        # 1. Proactive Offer Coach checks on active GE slots
        active_slots = await self.repo.get_active_slots()
        for slot in active_slots:
            evaluated = evaluate_slot(slot, state)
            action = evaluated["coach_action"]
            if action in ("BAILOUT_WARNING", "RELIST_BUY", "RELIST_SELL", "CANCEL"):
                sev = "danger" if action in ("BAILOUT_WARNING", "CANCEL") else "warning"
                cooldown = 300 if sev == "danger" else 600
                await self.emit(
                    alert_type=f"COACH_{action}",
                    dedupe_key=f"slot_{slot['slot_number']}_{slot['item_id']}_{action}",
                    title=f"Slot {slot['slot_number']} Coach: {action.replace('_', ' ').title()} — {slot['item_name']}",
                    message=evaluated["coach_message"],
                    severity=sev,
                    item_id=slot["item_id"],
                    item_name=slot["item_name"],
                    metadata={
                        "slot_number": slot["slot_number"],
                        "recommended_price": evaluated["recommended_price"],
                    },
                    cooldown_sec=cooldown,
                    send_to_discord=discord_coach,
                )

        # 2. High-conviction Dump / Crash Snipes
        top_dumps = [
            m
            for m in state.metrics.values()
            if (members or not m.members)
            and m.dump_sniper_score >= min_dump_score
            and m.vol_24h >= 300
            and m.low
            and m.vwap_7d
        ]
        top_dumps.sort(key=lambda m: m.dump_sniper_score, reverse=True)
        for m in top_dumps[:3]:
            target_sell = int(m.vwap_7d * 0.985) if m.vwap_7d else (m.high or 0)
            await self.emit(
                alert_type="DUMP_SNIPE",
                dedupe_key=str(m.id),
                title=f"Dump Snipe: {m.name} ({min(m.zscore_24h, m.zscore_7d):.1f}σ)",
                message=(
                    f"Trading at **{m.low:,} gp** vs 7d VWAP **{int(m.vwap_7d or 0):,} gp** "
                    f"(vol spike {m.volume_spike_ratio:.1f}x). Target rebound sell ~**{target_sell:,} gp**."
                ),
                severity="success",
                item_id=m.id,
                item_name=m.name,
                metadata={
                    "buy_price": m.low,
                    "target_sell": target_sell,
                    "zscore": round(min(m.zscore_24h, m.zscore_7d), 2),
                    "score": round(m.dump_sniper_score, 1),
                },
                cooldown_sec=1800,
                send_to_discord=discord_dumps,
                discord_fields=[
                    {"name": "Live Low", "value": f"{m.low:,} gp", "inline": True},
                    {"name": "7d VWAP", "value": f"{int(m.vwap_7d or 0):,} gp", "inline": True},
                    {"name": "24h Vol", "value": f"{m.vol_24h:,}", "inline": True},
                ],
            )

        # 3. Instant Deterministic Arbitrage Alerts (Item Sets & Decanting)
        sets = scan_item_sets(state, members=members, min_profit=min_arb_profit)
        for s in sets[:2]:
            if s["is_instant_profitable"] and s["instant_profit"] >= min_arb_profit:
                await self.emit(
                    alert_type="ARBITRAGE_SET",
                    dedupe_key=f"{s['set_id']}_{s['direction']}",
                    title=f"Instant {s['direction']} Set Arb: {s['set_name']}",
                    message=(
                        f"Instant post-tax profit: **+{s['instant_profit']:,} gp** "
                        f"(limit-order profit **+{s['net_profit']:,} gp**, {s['roi_pct']:.1f}% ROI)."
                    ),
                    severity="success",
                    item_id=s["set_id"],
                    item_name=s["set_name"],
                    metadata=s,
                    cooldown_sec=1800,
                    send_to_discord=discord_arb,
                )

        decants = scan_potion_decanting(state, members=members, min_profit_per_4dose=15)
        for d in decants[:1]:
            if d["is_instant_profitable"] and d["profit_per_limit"] >= min_arb_profit:
                await self.emit(
                    alert_type="ARBITRAGE_DECANT",
                    dedupe_key=f"{d['from_item_id']}_{d['to_item_id']}",
                    title=f"Instant Decant Arb: {d['from_item_name']} -> {d['to_item_name']}",
                    message=(
                        f"Instant **+{d['instant_profit_per_4dose']:.0f} gp/4-dose** "
                        f"(**+{d['profit_per_limit']:,} gp** per 4h limit via Bob Barter)."
                    ),
                    severity="success",
                    item_id=d["from_item_id"],
                    item_name=d["from_item_name"],
                    metadata=d,
                    cooldown_sec=1800,
                    send_to_discord=discord_arb,
                )
