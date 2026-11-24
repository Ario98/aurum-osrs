"""User settings, alerts feed, Discord test trigger, and simple password auth routes."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field

from app.auth import (
    SESSION_COOKIE_NAME,
    create_session_token,
    require_auth,
    verify_password,
    verify_session_token,
)

router = APIRouter(prefix="/api", tags=["settings"])


class LoginRequest(BaseModel):
    password: str


class SettingsUpdateRequest(BaseModel):
    cash_stack: Optional[int] = Field(default=None, ge=10_000, le=50_000_000_000)
    ge_slots: Optional[int] = Field(default=None, ge=1, le=8)
    members: Optional[bool] = None
    default_mode: Optional[str] = Field(
        default=None,
        pattern="^(auto_mix|fast_flip|overnight|dump_sniper|alch_floor)$",
    )
    discord_webhook_url: Optional[str] = None
    alerts_enabled: Optional[bool] = None
    sound_enabled: Optional[bool] = None
    discord_dump_alerts: Optional[bool] = None
    discord_arb_alerts: Optional[bool] = None
    alert_min_dump_score: Optional[float] = Field(default=None, ge=30, le=99)
    alert_min_arb_profit: Optional[int] = Field(default=None, ge=1_000)


class TestDiscordRequest(BaseModel):
    webhook_url: Optional[str] = None


# ------------------------------------------------------------------
# Auth endpoints (open so login UI can check status & sign in)
# ------------------------------------------------------------------
@router.get("/auth/status")
async def auth_status(request: Request) -> dict[str, Any]:
    settings = request.app.state.settings
    auth_required = bool(settings.app_password)
    if not auth_required:
        return {"auth_required": False, "authenticated": True}
    token = request.cookies.get(SESSION_COOKIE_NAME)
    return {
        "auth_required": True,
        "authenticated": verify_session_token(token, settings),
    }


@router.post("/auth/login")
async def login(body: LoginRequest, request: Request, response: Response) -> dict[str, Any]:
    settings = request.app.state.settings
    if not verify_password(body.password, settings):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password")
    token = create_session_token(settings)
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=settings.session_ttl_hours * 3600,
    )
    return {"authenticated": True}


@router.post("/auth/logout")
async def logout(response: Response) -> dict[str, Any]:
    response.delete_cookie(SESSION_COOKIE_NAME)
    return {"authenticated": False}


# ------------------------------------------------------------------
# Settings & Alerts (protected)
# ------------------------------------------------------------------
@router.get("/settings", dependencies=[Depends(require_auth)])
async def get_settings_endpoint(request: Request) -> dict[str, Any]:
    repo = request.app.state.repo
    cfg = request.app.state.settings
    saved = await repo.get_all_settings()
    return {
        "cash_stack": int(saved.get("cash_stack", cfg.default_cash_stack)),
        "ge_slots": int(saved.get("ge_slots", cfg.default_ge_slots)),
        "members": bool(saved.get("members", cfg.default_members)),
        "default_mode": saved.get("default_mode", "auto_mix"),
        "discord_webhook_url": saved.get("discord_webhook_url", cfg.discord_webhook_url or ""),
        "alerts_enabled": bool(saved.get("alerts_enabled", True)),
        "sound_enabled": bool(saved.get("sound_enabled", True)),
        "discord_dump_alerts": bool(saved.get("discord_dump_alerts", True)),
        "discord_arb_alerts": bool(saved.get("discord_arb_alerts", True)),
        "alert_min_dump_score": float(saved.get("alert_min_dump_score", 72)),
        "alert_min_arb_profit": int(saved.get("alert_min_arb_profit", 75_000)),
        "wiki_user_agent": cfg.wiki_user_agent,
    }


@router.put("/settings", dependencies=[Depends(require_auth)])
async def update_settings_endpoint(body: SettingsUpdateRequest, request: Request) -> dict[str, Any]:
    repo = request.app.state.repo
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if updates:
        await repo.save_settings(updates)
    return await get_settings_endpoint(request)


@router.get("/alerts", dependencies=[Depends(require_auth)])
async def get_alerts(
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    repo = request.app.state.repo
    return {"alerts": await repo.get_recent_alerts(limit=limit)}


@router.post("/alerts/test-discord", dependencies=[Depends(require_auth)])
async def test_discord_alert(body: TestDiscordRequest, request: Request) -> dict[str, Any]:
    alerts = request.app.state.alerts
    ok = await alerts.send_discord(
        title="Aurum — Discord Alerts Connected!",
        message="Discord alerts are live. You will receive Dump Snipes, Instant Arbitrage, and Watchlist price triggers here.",
        severity="success",
        webhook_url=body.webhook_url or None,
    )
    if not ok:
        raise HTTPException(
            status_code=400,
            detail="Discord webhook test failed. Verify the webhook URL starts with https://discord.com/api/webhooks/...",
        )
    return {"ok": True}
