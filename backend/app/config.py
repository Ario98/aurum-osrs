"""Application configuration via environment variables."""

from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings loaded from environment / .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Server
    app_name: str = "Aurum — OSRS GE Terminal"
    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "INFO"
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    # Storage (SQLite WAL)
    database_path: str = "./data/osrs_terminal.db"

    # OSRS Wiki Real-Time Prices API
    wiki_api_base_url: str = "https://prices.runescape.wiki/api/v1/osrs"
    wiki_user_agent: str = "aurum-osrs/2.0 - replace-with-your-contact"
    wiki_min_request_interval_ms: int = 350  # Polite ~2.8 req/s max during bootstrap
    wiki_timeout_seconds: float = 20.0

    # Polling & tiered bootstrap windows
    latest_poll_seconds: int = 10
    bootstrap_1h_fast_hours: int = 24       # Blocking fast bootstrap (~24 calls)
    bootstrap_5m_fast_hours: int = 2        # Blocking fast bootstrap (~24 calls)
    bootstrap_1h_background_days: int = 30  # Non-blocking 30-day hourly history (~4-5 min) for seasonality & Phase 5 ML
    retention_5m_days: int = 14
    retention_1h_days: int = 90
    timeseries_cache_ttl_seconds: int = 300

    # Auth & Webhooks
    # Leave app_password empty for passwordless local dev; set a strong password on Hetzner VPS.
    app_password: str = ""
    session_secret: str = "dev-only-change-me-in-production"
    session_ttl_hours: int = 168  # 7 days

    # Optional Discord Webhook default (also editable live in UI settings)
    discord_webhook_url: Optional[str] = None

    # Future SaaS billing toggle (False = all Pro features silently unlocked with zero paywall UI)
    billing_enforced: bool = False

    # Default user bankroll settings
    default_cash_stack: int = 25_000_000
    default_ge_slots: int = 8
    default_members: bool = True

    @property
    def db_file(self) -> Path:
        return Path(self.database_path).resolve()

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
