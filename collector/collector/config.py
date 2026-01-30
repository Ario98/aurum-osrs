"""Configuration management for the collector service."""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    """Collector configuration from environment variables."""

    # Database settings
    db_host: str
    db_port: int
    db_name: str
    db_user: str
    db_password: str

    # API settings
    api_base_url: str
    user_agent: str

    # Collection settings
    rate_limit_seconds: float
    backfill_start_date: str  # Format: YYYY-MM-DD
    collector_mode: str  # "backfill" or "continuous"

    # Logging
    log_level: str

    @classmethod
    def from_env(cls) -> "Config":
        """Create configuration from environment variables."""
        return cls(
            db_host=os.getenv("DB_HOST", "database"),
            db_port=int(os.getenv("DB_PORT", "5432")),
            db_name=os.getenv("DB_NAME", "osrs_trading"),
            db_user=os.getenv("DB_USER", "osrs_user"),
            db_password=os.getenv("DB_PASSWORD", "changeme"),
            api_base_url=os.getenv("API_BASE_URL", "https://prices.runescape.wiki/api/v1/osrs"),
            user_agent=os.getenv(
                "USER_AGENT",
                "osrs_trading_dashboard - private trading dashboard - @ario0446 on Discord",
            ),
            rate_limit_seconds=float(os.getenv("RATE_LIMIT_SECONDS", "1.0")),
            backfill_start_date=os.getenv("BACKFILL_START_DATE", "2022-01-01"),
            collector_mode=os.getenv("COLLECTOR_MODE", "backfill"),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
        )

    @property
    def database_url(self) -> str:
        """Generate PostgreSQL connection URL."""
        return f"postgresql://{self.db_user}:{self.db_password}@{self.db_host}:{self.db_port}/{self.db_name}"
