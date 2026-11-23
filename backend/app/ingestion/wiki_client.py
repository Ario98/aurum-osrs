"""Single async rate-limited OSRS Wiki Real-Time Prices API client."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Optional

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)


class WikiApiClient:
    """Thread-safe/asyncio-safe HTTP client for prices.runescape.wiki."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self._client: Optional[httpx.AsyncClient] = None
        self._rate_lock = asyncio.Lock()
        self._last_request_monotonic: float = 0.0
        self._min_interval_sec: float = settings.wiki_min_request_interval_ms / 1000.0
        self._consecutive_errors: int = 0
        self._total_requests: int = 0
        self._total_errors: int = 0
        self._last_error: Optional[str] = None
        self._last_error_ts: Optional[int] = None

    async def start(self) -> None:
        self._client = httpx.AsyncClient(
            base_url=self.settings.wiki_api_base_url,
            headers={
                "User-Agent": self.settings.wiki_user_agent,
                "Accept": "application/json",
                "Accept-Encoding": "gzip, deflate",
            },
            timeout=httpx.Timeout(self.settings.wiki_timeout_seconds),
            follow_redirects=True,
        )

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    @property
    def total_requests(self) -> int:
        return self._total_requests

    @property
    def total_errors(self) -> int:
        return self._total_errors

    @property
    def consecutive_errors(self) -> int:
        return self._consecutive_errors

    @property
    def last_error(self) -> Optional[str]:
        return self._last_error

    @property
    def last_error_ts(self) -> Optional[int]:
        return self._last_error_ts

    async def _get_json(self, path: str, params: Optional[dict[str, Any]] = None) -> Any:
        if self._client is None:
            raise RuntimeError("WikiApiClient not started")

        max_attempts = 3
        for attempt in range(1, max_attempts + 1):
            async with self._rate_lock:
                now = time.monotonic()
                wait = self._min_interval_sec - (now - self._last_request_monotonic)
                if wait > 0:
                    await asyncio.sleep(wait)
                self._last_request_monotonic = time.monotonic()

            try:
                self._total_requests += 1
                resp = await self._client.get(path, params=params)
                if resp.status_code == 429 or resp.status_code >= 500:
                    self._consecutive_errors += 1
                    self._total_errors += 1
                    self._last_error = f"HTTP {resp.status_code} on {path}"
                    self._last_error_ts = int(time.time())
                    backoff = min(10.0, (2 ** attempt) * 0.75)
                    logger.warning(
                        "Wiki API %s returned %s (attempt %d/%d). Backing off %.1fs",
                        path,
                        resp.status_code,
                        attempt,
                        max_attempts,
                        backoff,
                    )
                    await asyncio.sleep(backoff)
                    continue

                resp.raise_for_status()
                self._consecutive_errors = 0
                return resp.json()

            except httpx.HTTPError as exc:
                self._consecutive_errors += 1
                self._total_errors += 1
                self._last_error = f"{type(exc).__name__} on {path}: {exc}"
                self._last_error_ts = int(time.time())
                if attempt == max_attempts:
                    logger.error("Wiki API %s failed after %d attempts: %s", path, max_attempts, exc)
                    raise
                await asyncio.sleep(1.0 * attempt)

        raise RuntimeError(f"Wiki API {path} exhausted retries")

    async def fetch_mapping(self) -> list[dict[str, Any]]:
        data = await self._get_json("/mapping")
        return data if isinstance(data, list) else []

    async def fetch_latest(self) -> dict[int, dict[str, Any]]:
        payload = await self._get_json("/latest")
        raw = payload.get("data", {}) if isinstance(payload, dict) else {}
        return {int(k): v for k, v in raw.items()}

    async def fetch_5m(self, timestamp: Optional[int] = None) -> tuple[Optional[int], dict[int, dict[str, Any]]]:
        params = {"timestamp": timestamp} if timestamp is not None else None
        payload = await self._get_json("/5m", params=params)
        if not isinstance(payload, dict) or "timestamp" not in payload:
            return None, {}
        ts = int(payload["timestamp"])
        raw = payload.get("data", {})
        return ts, {int(k): v for k, v in raw.items()}

    async def fetch_1h(self, timestamp: Optional[int] = None) -> tuple[Optional[int], dict[int, dict[str, Any]]]:
        params = {"timestamp": timestamp} if timestamp is not None else None
        payload = await self._get_json("/1h", params=params)
        if not isinstance(payload, dict) or "timestamp" not in payload:
            return None, {}
        ts = int(payload["timestamp"])
        raw = payload.get("data", {})
        return ts, {int(k): v for k, v in raw.items()}

    async def fetch_timeseries(self, item_id: int, timestep: str = "1h") -> list[dict[str, Any]]:
        if timestep not in ("5m", "1h", "6h", "24h"):
            raise ValueError(f"Unsupported timestep: {timestep}")
        payload = await self._get_json("/timeseries", params={"id": item_id, "timestep": timestep})
        raw = payload.get("data", []) if isinstance(payload, dict) else []
        return raw if isinstance(raw, list) else []
