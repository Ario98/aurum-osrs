"""System & Data Health observability endpoints + safe maintenance actions."""

from __future__ import annotations

import os
import shutil
import time
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, Query, Request

from app.auth import require_auth

router = APIRouter(prefix="/api/system", tags=["system"], dependencies=[Depends(require_auth)])

# 30s in-process cache for expensive SQLite table-scan counts so 15s UI polling costs ~0 CPU
_DB_STATS_CACHE: dict[str, Any] = {"ts": 0.0, "data": None}
DB_STATS_CACHE_TTL_SEC = 30.0


def invalidate_db_stats_cache() -> None:
    _DB_STATS_CACHE["ts"] = 0.0
    _DB_STATS_CACHE["data"] = None


def _read_process_rss_mb() -> Optional[float]:
    """Read resident memory (MB) on Linux via /proc/self/status (zero deps)."""
    try:
        proc_status = Path("/proc/self/status")
        if proc_status.exists():
            for line in proc_status.read_text(encoding="utf-8", errors="ignore").splitlines():
                if line.startswith("VmRSS:"):
                    parts = line.split()
                    if len(parts) >= 2:
                        return round(int(parts[1]) / 1024.0, 1)
    except Exception:
        pass
    try:
        import resource  # type: ignore[import-not-found]

        rss_kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return round(rss_kb / 1024.0, 1)
    except Exception:
        return None


def _read_system_ram_mb() -> tuple[Optional[float], Optional[float]]:
    """Read (used_mb, total_mb) on Linux via /proc/meminfo."""
    try:
        meminfo = Path("/proc/meminfo")
        if not meminfo.exists():
            return None, None
        vals: dict[str, int] = {}
        for line in meminfo.read_text(encoding="utf-8", errors="ignore").splitlines():
            if ":" in line:
                k, rest = line.split(":", 1)
                parts = rest.strip().split()
                if parts and parts[0].isdigit():
                    vals[k] = int(parts[0])
        total_kb = vals.get("MemTotal")
        avail_kb = vals.get("MemAvailable", vals.get("MemFree"))
        if total_kb and avail_kb is not None:
            used_kb = max(0, total_kb - avail_kb)
            return round(used_kb / 1024.0, 1), round(total_kb / 1024.0, 1)
    except Exception:
        pass
    return None, None


def _read_load_avg_1m() -> Optional[float]:
    try:
        if hasattr(os, "getloadavg"):
            return round(os.getloadavg()[0], 2)
    except Exception:
        pass
    return None


def _read_disk_gb(path: Path) -> tuple[Optional[float], Optional[float]]:
    try:
        target = path if path.exists() else path.parent
        usage = shutil.disk_usage(str(target))
        free_gb = round(usage.free / (1024**3), 2)
        total_gb = round(usage.total / (1024**3), 2)
        return free_gb, total_gb
    except Exception:
        return None, None


def _scan_latest_backup(db_path: Path) -> dict[str, Any]:
    """Look for daily SQLite backups in sibling/parent backups/ directories."""
    candidates = [
        db_path.parent.parent / "backups",
        db_path.parent / "backups",
    ]
    files: list[Path] = []
    for folder in candidates:
        if folder.is_dir():
            for p in folder.iterdir():
                if p.is_file() and any(ext in p.name for ext in (".db", ".sqlite", ".gz", ".bak")):
                    files.append(p)
    if not files:
        return {
            "found": False,
            "filename": None,
            "timestamp": None,
            "age_hours": None,
            "size_mb": None,
            "count": 0,
        }
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    newest = files[0]
    st = newest.stat()
    age_hours = round(max(0.0, (time.time() - st.st_mtime) / 3600.0), 1)
    return {
        "found": True,
        "filename": newest.name,
        "timestamp": int(st.st_mtime),
        "age_hours": age_hours,
        "size_mb": round(st.st_size / (1024 * 1024), 2),
        "count": len(files),
    }


def compute_quick_health(state: Any, wiki: Any, db_path: Path) -> tuple[str, list[str]]:
    """Fast O(1) health evaluation used by both /api/market/status and /api/system/health."""
    now = int(time.time())
    issues: list[str] = []

    if state.bootstrap_fast_done and state.last_latest_update > 0:
        latest_age = now - state.last_latest_update
        if latest_age > 90:
            issues.append(f"/latest quotes stale ({latest_age}s ago)")

    if wiki.consecutive_errors >= 3:
        issues.append(f"Wiki API errors ({wiki.consecutive_errors} consecutive)")

    free_gb, _ = _read_disk_gb(db_path)
    if free_gb is not None and free_gb < 2.0:
        issues.append(f"Low VPS disk space ({free_gb} GB free)")

    backup = _scan_latest_backup(db_path)
    if backup["found"] and backup["age_hours"] is not None and backup["age_hours"] > 48.0:
        issues.append(f"SQLite backup stale ({backup['age_hours']}h ago)")

    status = "degraded" if issues else "healthy"
    return status, issues


@router.get("/health")
async def get_system_health(
    request: Request,
    fresh: bool = Query(default=False),
) -> dict[str, Any]:
    state = request.app.state.market_state
    wiki = request.app.state.wiki_client
    repo = request.app.state.repo
    db = request.app.state.db
    collector = request.app.state.collector
    alerts = request.app.state.alerts
    ws_hub = request.app.state.ws_hub
    settings = request.app.state.settings

    now = int(time.time())
    now_mono = time.monotonic()

    if (
        not fresh
        and _DB_STATS_CACHE["data"] is not None
        and (now_mono - _DB_STATS_CACHE["ts"]) < DB_STATS_CACHE_TTL_SEC
    ):
        db_stats = _DB_STATS_CACHE["data"]
        db_stats_cached = True
    else:
        db_stats = await repo.get_system_db_stats(lookback_days=settings.bootstrap_1h_background_days)
        _DB_STATS_CACHE["ts"] = now_mono
        _DB_STATS_CACHE["data"] = db_stats
        db_stats_cached = False

    db_path: Path = db.db_path
    wal_path = Path(f"{db_path}-wal")
    db_size_bytes = db_path.stat().st_size if db_path.exists() else 0
    wal_size_bytes = wal_path.stat().st_size if wal_path.exists() else 0

    # Phase 5 ML readiness checklist & composite score (0-100)
    cov_30d = float(db_stats["coverage_30d_pct"])
    c24_buckets = int(db_stats["candles_24h"]["buckets"])
    seas_items = len(state._seasonality_30d)
    c1_rows = int(db_stats["candles_1h"]["rows"])

    ml_checks = [
        {
            "label": "30-day hourly candle history (>=95% coverage)",
            "ok": cov_30d >= 95.0,
            "detail": f"{db_stats['present_1h_30d']}/{db_stats['expected_1h_30d']} buckets ({cov_30d}%)",
        },
        {
            "label": "Permanent daily candles_24h rollups (>=25 days)",
            "ok": c24_buckets >= 25,
            "detail": f"{c24_buckets} daily buckets ({db_stats['candles_24h']['rows']:,} rows)",
        },
        {
            "label": "30-day hour-of-day seasonality computed",
            "ok": seas_items >= 1000,
            "detail": f"{seas_items:,} active items",
        },
        {
            "label": "1.5M+ hourly training samples in SQLite",
            "ok": c1_rows >= 1_500_000,
            "detail": f"{c1_rows:,} item-hour rows",
        },
    ]
    ml_score = int(
        round(
            min(100.0, cov_30d) * 0.45
            + min(1.0, c24_buckets / 28.0) * 20.0
            + min(1.0, seas_items / 1500.0) * 15.0
            + min(1.0, c1_rows / 1_500_000.0) * 20.0
        )
    )
    ml_ready = all(c["ok"] for c in ml_checks)

    overall_status, issues = compute_quick_health(state, wiki, db_path)
    used_ram, total_ram = _read_system_ram_mb()
    free_gb, total_gb = _read_disk_gb(db_path)
    backup = _scan_latest_backup(db_path)

    saved_settings = await repo.get_all_settings()
    discord_url = saved_settings.get("discord_webhook_url") or settings.discord_webhook_url
    discord_configured = bool(isinstance(discord_url, str) and discord_url.strip().startswith("https://"))

    return {
        "overall_status": overall_status,
        "issues": issues,
        "generated_at": now,
        "db_stats_cached": db_stats_cached,
        "dataset": {
            "candles_5m": db_stats["candles_5m"],
            "candles_1h": db_stats["candles_1h"],
            "candles_24h": db_stats["candles_24h"],
            "expected_1h_30d": db_stats["expected_1h_30d"],
            "present_1h_30d": db_stats["present_1h_30d"],
            "missing_1h_30d": db_stats["missing_1h_30d"],
            "coverage_30d_pct": cov_30d,
            "seasonality_30d_items": seas_items,
            "db_size_mb": round(db_size_bytes / (1024 * 1024), 2),
            "wal_size_mb": round(wal_size_bytes / (1024 * 1024), 2),
            "ml_readiness": {
                "score": ml_score,
                "ready": ml_ready,
                "checks": ml_checks,
            },
        },
        "engine": {
            "ready": state.bootstrap_fast_done,
            "enrichment_done": state.bootstrap_bg_done,
            "items_tracked": len(state.metrics),
            "last_latest_update": state.last_latest_update,
            "last_latest_age_sec": max(0, now - state.last_latest_update) if state.last_latest_update else None,
            "last_5m_ts": collector._last_5m_ts or db_stats["candles_5m"]["newest_ts"],
            "last_1h_ts": collector._last_1h_ts or db_stats["candles_1h"]["newest_ts"],
            "last_recompute_ms": round(state.last_recompute_ms, 2),
            "last_candle_agg_ms": round(state.last_candle_agg_ms, 1),
            "recompute_history": list(state.recompute_history),
            "wiki_total_requests": wiki.total_requests,
            "wiki_total_errors": wiki.total_errors,
            "wiki_consecutive_errors": wiki.consecutive_errors,
            "wiki_last_error": wiki.last_error,
            "wiki_last_error_ts": wiki.last_error_ts,
            "ws_clients": len(ws_hub._clients),
            "backfill": {
                "active": collector.bg_active,
                "fetched": collector.bg_fetched,
                "total": collector.bg_total_missing,
                "stage": state.bootstrap_progress.get("stage", "ready"),
            },
        },
        "vps": {
            "uptime_sec": max(0, now - state.started_at),
            "process_rss_mb": _read_process_rss_mb(),
            "system_ram_used_mb": used_ram,
            "system_ram_total_mb": total_ram,
            "load_avg_1m": _read_load_avg_1m(),
            "cpu_count": os.cpu_count() or 1,
            "disk_free_gb": free_gb,
            "disk_total_gb": total_gb,
            "backup": backup,
        },
        "integrations": {
            "dink_configured": bool(settings.dink_webhook_token),
            "last_dink_ts": db_stats["last_dink_ts"],
            "dink_events_total": db_stats["dink_events_total"],
            "discord_configured": discord_configured,
            "last_discord_sent_ts": alerts.last_discord_sent_ts,
            "last_discord_ok": alerts.last_discord_ok,
            "last_discord_error": alerts.last_discord_error,
            "discord_sent_count": alerts.discord_sent_count,
            "discord_fail_count": alerts.discord_fail_count,
            "alerts_24h_total": db_stats["alerts_24h_total"],
            "alerts_24h_by_type": db_stats["alerts_24h_by_type"],
            "watchlist_count": db_stats["watchlist_count"],
            "active_slots_count": db_stats["active_slots_count"],
            "journal_flips_count": db_stats["journal_flips_count"],
        },
    }


@router.post("/actions/rollup")
async def action_refresh_rollup(request: Request) -> dict[str, Any]:
    """Safe idempotent action: refresh daily candles_24h rollups + 30d seasonality."""
    collector = request.app.state.collector
    result = await collector.run_rollup_and_seasonality()
    invalidate_db_stats_cache()
    return {"ok": True, **result}


@router.post("/actions/fill-gaps")
async def action_fill_gaps(request: Request) -> dict[str, Any]:
    """Safe idempotent action: detect & fill missing 5m / 30d 1h candle gaps."""
    collector = request.app.state.collector
    result = await collector.fill_missing_candle_gaps()
    invalidate_db_stats_cache()
    return {"ok": True, **result}


@router.post("/actions/checkpoint")
async def action_wal_checkpoint(request: Request) -> dict[str, Any]:
    """Safe idempotent action: flush SQLite WAL log into main DB file."""
    repo = request.app.state.repo
    result = await repo.run_wal_checkpoint()
    invalidate_db_stats_cache()
    return {"ok": True, **result}
