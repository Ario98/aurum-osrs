"""Tiered 30-second bootstrapper, smart downtime gap-filler, and live async poller."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Awaitable, Callable, Optional

from app.alerts.dispatcher import AlertDispatcher
from app.config import Settings
from app.db.database import Database
from app.db.repository import Repository
from app.engine.state import MarketState
from app.ingestion.wiki_client import WikiApiClient

logger = logging.getLogger(__name__)


def _floor_bucket(ts: int, step: int) -> int:
    return (ts // step) * step


class CollectorService:
    """Manages fast tiered bootstrapping, non-blocking 7d enrichment, and live market polling."""

    def __init__(
        self,
        settings: Settings,
        db: Database,
        repo: Repository,
        wiki: WikiApiClient,
        state: MarketState,
        alerts: AlertDispatcher,
        broadcast_cb: Callable[[dict[str, Any]], Awaitable[None]],
        ml_predictor: Any = None,
    ):
        self.settings = settings
        self.db = db
        self.repo = repo
        self.wiki = wiki
        self.state = state
        self.alerts = alerts
        self.broadcast_cb = broadcast_cb
        self.ml_predictor = ml_predictor

        self._stop_event = asyncio.Event()
        self._tasks: list[asyncio.Task[Any]] = []
        self._last_5m_ts: int = 0
        self._last_1h_ts: int = 0
        self.bg_active: bool = False
        self.bg_total_missing: int = 0
        self.bg_fetched: int = 0
        self._gap_fill_task: Optional[asyncio.Task[Any]] = None

    async def start(self) -> None:
        """Start fast bootstrap & async polling loops without blocking uvicorn boot."""
        self._stop_event.clear()
        self._tasks.append(asyncio.create_task(self._lifecycle_runner(), name="collector-lifecycle"))

    async def stop(self) -> None:
        self._stop_event.set()
        for task in self._tasks:
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()

    async def _lifecycle_runner(self) -> None:
        try:
            await self._fast_bootstrap()
            # Start live loops + background 7-day 1h enrichment concurrently
            self._tasks.extend(
                [
                    asyncio.create_task(self._background_1h_enrichment(), name="bg-1h-enrichment"),
                    asyncio.create_task(self._latest_loop(), name="poll-latest"),
                    asyncio.create_task(self._candles_loop(), name="poll-candles"),
                    asyncio.create_task(self._maintenance_loop(), name="maintenance"),
                ]
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Collector lifecycle failed during bootstrap")

    async def _fast_bootstrap(self) -> None:
        """Ready-to-trade in ~25-30s on empty DB, ~2-5s on warm restart or short downtime."""
        t0 = time.perf_counter()
        self.state.bootstrap_progress["stage"] = "loading_mapping"

        # 1. Load item mapping (from DB if fresh < 24h, else fetch from Wiki)
        last_map = await self.repo.get_meta("last_mapping_fetch")
        now = int(time.time())
        db_items = await self.repo.get_all_items()
        if not db_items or not last_map or (now - int(last_map)) > 86400:
            logger.info("Fetching /mapping from OSRS Wiki API...")
            mapping = await self.wiki.fetch_mapping()
            if mapping:
                await self.repo.upsert_items(mapping)
                await self.repo.set_meta("last_mapping_fetch", str(now))
                db_items = await self.repo.get_all_items()
        self.state.load_items(db_items)
        logger.info("Loaded %d OSRS items into memory", len(db_items))

        # 2. Fetch live /latest immediately so live prices are available within 1 second!
        self.state.bootstrap_progress["stage"] = "fetching_latest"
        try:
            latest = await self.wiki.fetch_latest()
            if latest:
                self.state.update_latest(latest)
                await self.repo.upsert_latest_prices(latest)
        except Exception as exc:
            logger.warning("Initial /latest failed, loading cached prices from DB: %s", exc)
            cached_latest = await self.repo.get_all_latest_prices()
            self.state.update_latest(cached_latest)

        # Hydrate any existing candles from SQLite into memory immediately
        since_5m_mem = now - 6 * 3600
        since_1h_mem = now - 8 * 86400
        self.state.ingest_candle_rows("5m", await self.repo.get_recent_candles("candles_5m", since_5m_mem))
        self.state.ingest_candle_rows("1h", await self.repo.get_recent_candles("candles_1h", since_1h_mem))
        self.state.recompute_all_metrics()

        # 3. Fast gap-fill: last 24 hours of /1h buckets (only missing ones!)
        self.state.bootstrap_progress["stage"] = "fast_backfill_1h"
        now = int(time.time())
        latest_closed_1h = _floor_bucket(now, 3600) - 3600
        fast_1h_count = self.settings.bootstrap_1h_fast_hours
        target_1h_buckets = [latest_closed_1h - i * 3600 for i in range(fast_1h_count)]
        existing_1h = await self.repo.get_existing_bucket_timestamps("candles_1h", min(target_1h_buckets))
        missing_1h = [ts for ts in target_1h_buckets if ts not in existing_1h]

        logger.info("Fast bootstrap 1h: %d missing of %d buckets", len(missing_1h), fast_1h_count)
        for ts in missing_1h:
            if self._stop_event.is_set():
                return
            try:
                actual_ts, data = await self.wiki.fetch_1h(ts)
                if actual_ts and data:
                    await self.repo.upsert_candles("candles_1h", actual_ts, data)
                    self.state.ingest_candle_bucket("1h", actual_ts, data)
                    self.state.bootstrap_progress["buckets_1h_loaded"] += 1
            except Exception as exc:
                logger.warning("Skipping 1h bucket %d: %s", ts, exc)

        self._last_1h_ts = latest_closed_1h

        # 4. Fast gap-fill: last 2 hours of /5m buckets (only missing ones!)
        self.state.bootstrap_progress["stage"] = "fast_backfill_5m"
        now = int(time.time())
        latest_closed_5m = _floor_bucket(now, 300) - 300
        fast_5m_count = self.settings.bootstrap_5m_fast_hours * 12
        target_5m_buckets = [latest_closed_5m - i * 300 for i in range(fast_5m_count)]
        existing_5m = await self.repo.get_existing_bucket_timestamps("candles_5m", min(target_5m_buckets))
        missing_5m = [ts for ts in target_5m_buckets if ts not in existing_5m]

        logger.info("Fast bootstrap 5m: %d missing of %d buckets", len(missing_5m), fast_5m_count)
        for ts in missing_5m:
            if self._stop_event.is_set():
                return
            try:
                actual_ts, data = await self.wiki.fetch_5m(ts)
                if actual_ts and data:
                    await self.repo.upsert_candles("candles_5m", actual_ts, data)
                    self.state.ingest_candle_bucket("5m", actual_ts, data)
                    self.state.bootstrap_progress["buckets_5m_loaded"] += 1
            except Exception as exc:
                logger.warning("Skipping 5m bucket %d: %s", ts, exc)

        self._last_5m_ts = latest_closed_5m

        # 5. Final recompute -> READY TO TRADE!
        recompute_ms = self.state.recompute_all_metrics()
        if self.ml_predictor is not None and self.ml_predictor.loaded:
            self.ml_predictor.refresh_predictions(self.state)
        elapsed = time.perf_counter() - t0
        self.state.bootstrap_fast_done = True
        self.state.bootstrap_progress.update(
            {
                "stage": "ready",
                "fast_done": True,
                "elapsed_sec": round(elapsed, 1),
            }
        )
        logger.info(
            "FAST BOOTSTRAP COMPLETE in %.1fs! Recomputed %d items in %.2f ms",
            elapsed,
            len(self.state.metrics),
            recompute_ms,
        )
        await self.broadcast_cb({"type": "bootstrap_ready", "progress": self.state.bootstrap_progress})

    async def _background_1h_enrichment(self) -> None:
        """Non-blocking 30-day /1h backfill for 4-week seasonality, 24h rollups & Phase 5 ML."""
        now = int(time.time())
        latest_closed_1h = _floor_bucket(now, 3600) - 3600
        total_hours = self.settings.bootstrap_1h_background_days * 24
        target_buckets = [latest_closed_1h - i * 3600 for i in range(total_hours)]
        existing = await self.repo.get_existing_bucket_timestamps("candles_1h", min(target_buckets))
        missing = [ts for ts in target_buckets if ts not in existing]

        if missing:
            self.bg_active = True
            self.bg_total_missing = len(missing)
            self.bg_fetched = 0
            logger.info(
                "Background enrichment: fetching %d missing 1h buckets (%dd history, non-blocking)...",
                len(missing),
                self.settings.bootstrap_1h_background_days,
            )
            fetched = 0
            cutoff_ram = now - 8 * 86400
            for ts in missing:
                if self._stop_event.is_set():
                    self.bg_active = False
                    return
                try:
                    actual_ts, data = await self.wiki.fetch_1h(ts)
                    if actual_ts and data:
                        await self.repo.upsert_candles("candles_1h", actual_ts, data)
                        if actual_ts >= cutoff_ram:
                            self.state.ingest_candle_bucket("1h", actual_ts, data)
                        fetched += 1
                        self.bg_fetched = fetched
                        self.state.bootstrap_progress["buckets_1h_loaded"] += 1
                        if fetched % 48 == 0:
                            self.state.recompute_all_metrics()
                except Exception as exc:
                    logger.warning("Background 1h bucket %d failed: %s", ts, exc)
            self.bg_active = False
            logger.info("Background 30d 1h backfill fetched +%d buckets", fetched)
        else:
            self.bg_active = False
            self.bg_total_missing = 0
            self.bg_fetched = 0
            logger.info("Background %dd 1h history already complete", self.settings.bootstrap_1h_background_days)

        # Roll up completed UTC days into permanent candles_24h & compute 30d seasonality
        rolled = await self.repo.rollup_candles_24h()
        seasonality = await self.repo.compute_30d_hour_seasonality()
        self.state.set_seasonality_30d(seasonality)
        self.state.recompute_all_metrics()
        if self.ml_predictor is not None:
            if self.ml_predictor.loaded:
                self.ml_predictor.refresh_predictions(self.state)
            await self._maybe_schedule_daily_ml_train()
        self.state.bootstrap_bg_done = True
        self.state.bootstrap_progress["bg_done"] = True
        logger.info(
            "Background enrichment complete: rolled %d daily rows, computed 30d seasonality for %d items",
            rolled,
            len(seasonality),
        )
        await self.broadcast_cb({"type": "enrichment_complete", "progress": self.state.bootstrap_progress})

    async def _latest_loop(self) -> None:
        """Poll /latest every 20s, recompute in <5ms, run Offer Coach & Alerts, push WS tick."""
        interval = max(10, self.settings.latest_poll_seconds)
        while not self._stop_event.is_set():
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=interval)
                break
            except asyncio.TimeoutError:
                pass

            try:
                latest = await self.wiki.fetch_latest()
                if latest:
                    self.state.update_latest(latest)
                    await self.repo.upsert_latest_prices(latest)
                    recompute_ms = self.state.recompute_all_metrics()
                    await self.alerts.scan_and_dispatch(self.state)
                    await self.broadcast_cb(
                        {
                            "type": "market_tick",
                            "timestamp": self.state.last_latest_update,
                            "recompute_ms": round(recompute_ms, 2),
                            "items_count": len(self.state.metrics),
                        }
                    )
            except Exception as exc:
                logger.warning("/latest poll failed: %s", exc)

    async def _candles_loop(self) -> None:
        """Fetch newly closed /5m and /1h buckets cleanly after each boundary."""
        while not self._stop_event.is_set():
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=20)
                break
            except asyncio.TimeoutError:
                pass

            now = int(time.time())

            # Check for new closed 5m bucket (wait 20s past boundary for Wiki aggregation)
            closed_5m = _floor_bucket(now - 20, 300) - 300
            if closed_5m > self._last_5m_ts:
                try:
                    actual_ts, data = await self.wiki.fetch_5m(closed_5m)
                    if actual_ts and data:
                        await self.repo.upsert_candles("candles_5m", actual_ts, data)
                        self.state.ingest_candle_bucket("5m", actual_ts, data)
                        self._last_5m_ts = actual_ts
                        self.state.recompute_all_metrics()
                        if self.ml_predictor is not None and self.ml_predictor.loaded:
                            self.ml_predictor.refresh_predictions(self.state)
                        logger.debug("Ingested 5m candle bucket %d (%d items)", actual_ts, len(data))
                except Exception as exc:
                    logger.warning("5m poll failed for %d: %s", closed_5m, exc)

            # Check for new closed 1h bucket (wait 40s past boundary)
            closed_1h = _floor_bucket(now - 40, 3600) - 3600
            if closed_1h > self._last_1h_ts:
                try:
                    actual_ts, data = await self.wiki.fetch_1h(closed_1h)
                    if actual_ts and data:
                        await self.repo.upsert_candles("candles_1h", actual_ts, data)
                        self.state.ingest_candle_bucket("1h", actual_ts, data)
                        self._last_1h_ts = actual_ts
                        self.state.recompute_all_metrics()
                        if self.ml_predictor is not None and self.ml_predictor.loaded:
                            self.ml_predictor.refresh_predictions(self.state)
                        logger.info("Ingested 1h candle bucket %d (%d items)", actual_ts, len(data))
                except Exception as exc:
                    logger.warning("1h poll failed for %d: %s", closed_1h, exc)

    async def _maintenance_loop(self) -> None:
        """Daily retention cleanup + mapping refresh so DB stays compact (<350 MB forever)."""
        while not self._stop_event.is_set():
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=6 * 3600)
                break
            except asyncio.TimeoutError:
                pass

            try:
                await self.repo.rollup_candles_24h()
                seasonality = await self.repo.compute_30d_hour_seasonality()
                self.state.set_seasonality_30d(seasonality)
                await self.db.prune_old_candles(
                    retention_5m_days=self.settings.retention_5m_days,
                    retention_1h_days=self.settings.retention_1h_days,
                )
                last_map = await self.repo.get_meta("last_mapping_fetch")
                now = int(time.time())
                if not last_map or (now - int(last_map)) > 86400:
                    mapping = await self.wiki.fetch_mapping()
                    if mapping:
                        await self.repo.upsert_items(mapping)
                        await self.repo.set_meta("last_mapping_fetch", str(now))
                        self.state.load_items(await self.repo.get_all_items())
                await self._maybe_schedule_daily_ml_train()
            except Exception as exc:
                logger.warning("Maintenance cycle failed: %s", exc)

    async def _maybe_schedule_daily_ml_train(self) -> None:
        """Auto-retrain LightGBM in isolated subprocess once every 24h when >=14d history exists."""
        if self.ml_predictor is None or self.ml_predictor.training_in_progress:
            return
        now = int(time.time())
        report = self.ml_predictor.report or {}
        last_trained = int(report.get("trained_at") or 0)
        if self.ml_predictor.loaded and last_trained > 0 and (now - last_trained) < 23 * 3600:
            return
        # Require at least 14 days (336 hourly buckets) before auto-training
        stats = await self.repo.get_system_db_stats(lookback_days=self.settings.bootstrap_1h_background_days)
        if int(stats["candles_1h"]["buckets"]) < 336:
            return

        async def _notify(status: dict[str, Any]) -> None:
            await self.broadcast_cb(
                {
                    "type": "ml_trained",
                    "loaded": status.get("loaded", False),
                    "validated": status.get("validated", False),
                }
            )

        self.ml_predictor.start_training(
            db_path=self.db.db_path,
            state=self.state,
            lookback_days=self.settings.bootstrap_1h_background_days,
            on_complete=_notify,
        )

    async def run_rollup_and_seasonality(self) -> dict[str, Any]:
        """On-demand safe action: refresh daily candles_24h rollup + 30d hour seasonality."""
        t0 = time.perf_counter()
        rolled = await self.repo.rollup_candles_24h()
        seasonality = await self.repo.compute_30d_hour_seasonality()
        self.state.set_seasonality_30d(seasonality)
        recompute_ms = self.state.recompute_all_metrics()
        return {
            "rolled_24h_rows": rolled,
            "seasonality_items": len(seasonality),
            "recompute_ms": round(recompute_ms, 2),
            "elapsed_ms": round((time.perf_counter() - t0) * 1000.0, 1),
        }

    async def fill_missing_candle_gaps(self) -> dict[str, Any]:
        """On-demand safe action: detect & fill missing 5m (last 2h) and 1h (last 30d) candle gaps."""
        if self.bg_active or (self._gap_fill_task is not None and not self._gap_fill_task.done()):
            return {
                "status": "already_running",
                "message": "A candle backfill job is already running in the background.",
                "filled_5m": 0,
                "filled_1h": 0,
                "remaining_1h": max(0, self.bg_total_missing - self.bg_fetched),
            }

        now = int(time.time())
        latest_closed_5m = _floor_bucket(now - 20, 300) - 300
        target_5m = [latest_closed_5m - i * 300 for i in range(self.settings.bootstrap_5m_fast_hours * 12)]
        existing_5m = await self.repo.get_existing_bucket_timestamps("candles_5m", min(target_5m))
        missing_5m = [ts for ts in target_5m if ts not in existing_5m]

        latest_closed_1h = _floor_bucket(now - 40, 3600) - 3600
        total_hours = self.settings.bootstrap_1h_background_days * 24
        target_1h = [latest_closed_1h - i * 3600 for i in range(total_hours)]
        existing_1h = await self.repo.get_existing_bucket_timestamps("candles_1h", min(target_1h))
        missing_1h = [ts for ts in target_1h if ts not in existing_1h]

        if not missing_5m and not missing_1h:
            return {
                "status": "clean",
                "message": "No missing 5m or 30d 1h candle gaps found.",
                "filled_5m": 0,
                "filled_1h": 0,
                "remaining_1h": 0,
            }

        filled_5m = 0
        for ts in missing_5m[:24]:
            try:
                actual_ts, data = await self.wiki.fetch_5m(ts)
                if actual_ts and data:
                    await self.repo.upsert_candles("candles_5m", actual_ts, data)
                    self.state.ingest_candle_bucket("5m", actual_ts, data)
                    filled_5m += 1
            except Exception as exc:
                logger.warning("Gap fill 5m %d failed: %s", ts, exc)

        # Fill up to 16 hourly gaps inline; if more remain, finish non-blocking in background
        inline_1h = missing_1h[:16]
        queued_1h = missing_1h[16:]
        filled_1h = 0
        cutoff_ram = now - 8 * 86400
        for ts in inline_1h:
            try:
                actual_ts, data = await self.wiki.fetch_1h(ts)
                if actual_ts and data:
                    await self.repo.upsert_candles("candles_1h", actual_ts, data)
                    if actual_ts >= cutoff_ram:
                        self.state.ingest_candle_bucket("1h", actual_ts, data)
                    filled_1h += 1
            except Exception as exc:
                logger.warning("Gap fill 1h %d failed: %s", ts, exc)

        if filled_5m or filled_1h:
            self.state.recompute_all_metrics()

        if queued_1h:
            async def _finish_rest() -> None:
                self.bg_active = True
                self.bg_total_missing = len(queued_1h)
                self.bg_fetched = 0
                try:
                    for ts in queued_1h:
                        if self._stop_event.is_set():
                            return
                        try:
                            actual_ts, data = await self.wiki.fetch_1h(ts)
                            if actual_ts and data:
                                await self.repo.upsert_candles("candles_1h", actual_ts, data)
                                if actual_ts >= cutoff_ram:
                                    self.state.ingest_candle_bucket("1h", actual_ts, data)
                                self.bg_fetched += 1
                        except Exception as exc:
                            logger.warning("Background gap fill 1h %d failed: %s", ts, exc)
                    await self.run_rollup_and_seasonality()
                finally:
                    self.bg_active = False

            self._gap_fill_task = asyncio.create_task(_finish_rest(), name="on-demand-gap-fill")
            return {
                "status": "started_background",
                "message": f"Filled {filled_5m} 5m + {filled_1h} 1h gaps immediately; {len(queued_1h)} older 1h gaps queued in background.",
                "filled_5m": filled_5m,
                "filled_1h": filled_1h,
                "remaining_1h": len(queued_1h),
            }

        return {
            "status": "completed",
            "message": f"Filled {filled_5m} 5m and {filled_1h} 1h missing candle gaps.",
            "filled_5m": filled_5m,
            "filled_1h": filled_1h,
            "remaining_1h": 0,
        }
