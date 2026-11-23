"""Lightweight HMAC session auth + webhook token validation."""

from __future__ import annotations

import hashlib
import hmac
import time
from typing import Optional

from fastapi import Depends, HTTPException, Request, status

from app.config import Settings, get_settings

SESSION_COOKIE_NAME = "osrs_terminal_session"


def _sign(payload: str, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def create_session_token(settings: Settings) -> str:
    expires_at = int(time.time()) + settings.session_ttl_hours * 3600
    payload = f"v2:{expires_at}"
    sig = _sign(payload, settings.session_secret)
    return f"{payload}:{sig}"


def verify_session_token(token: Optional[str], settings: Settings) -> bool:
    if not token:
        return False
    parts = token.split(":")
    if len(parts) != 3:
        return False
    version, expires_str, sig = parts
    if version != "v2":
        return False
    try:
        expires_at = int(expires_str)
    except ValueError:
        return False
    if expires_at < int(time.time()):
        return False
    expected = _sign(f"{version}:{expires_str}", settings.session_secret)
    return hmac.compare_digest(sig, expected)


def verify_password(password: str, settings: Settings) -> bool:
    if not settings.app_password:
        return True
    return hmac.compare_digest(password, settings.app_password)


async def require_auth(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> None:
    """Protect API endpoints when APP_PASSWORD is configured."""
    if not settings.app_password:
        return  # Passwordless local dev mode

    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()

    if not verify_session_token(token, settings):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )


def verify_dink_token(token: Optional[str], settings: Settings) -> bool:
    if not settings.dink_webhook_token:
        return True
    if not token:
        return False
    return hmac.compare_digest(token, settings.dink_webhook_token)
