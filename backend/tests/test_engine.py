"""Comprehensive unit & integration tests for OSRS Flip Terminal v2 backend."""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.engine.arbitrage import scan_item_sets, scan_potion_decanting
from app.engine.state import MarketState
from app.engine.strategies import generate_overnight_flips, generate_trade_calls
from app.engine.tax import calculate_ge_tax, calculate_net_flip, is_tax_exempt_name
from app.entitlements import FeatureKey, PlanTier, build_entitlements_payload, has_feature


def test_ge_tax_exact_rules():
    # Under 50 GP -> 0 tax
    assert calculate_ge_tax(1) == 0
    assert calculate_ge_tax(49) == 0
    assert calculate_ge_tax(50) == 1
    assert calculate_ge_tax(99) == 1
    assert calculate_ge_tax(100) == 2

    # Standard 2% rounded down
    assert calculate_ge_tax(1_000_000) == 20_000
    assert calculate_ge_tax(1_234_567) == 24_691

    # 5M cap at 250M+
    assert calculate_ge_tax(250_000_000) == 5_000_000
    assert calculate_ge_tax(1_600_000_000) == 5_000_000  # Twisted bow

    # Official tax-exempt items
    assert is_tax_exempt_name("Old school bond")
    assert calculate_ge_tax(15_000_000, item_name="Old school bond") == 0
    assert calculate_ge_tax(500, item_name="Lobster") == 0
    assert calculate_ge_tax(2_000, item_name="Ring of dueling(8)") == 0
    assert calculate_ge_tax(1_000, item_name="Teleport to house") == 0

    # Net flip math
    tax, profit, roi = calculate_net_flip(1_000_000, 1_050_000, quantity=10)
    assert tax == 21_000
    assert profit == (1_050_000 - 1_000_000 - 21_000) * 10
    assert pytest.approx(roi, rel=1e-3) == 2.9


def _build_sample_state() -> MarketState:
    now = int(time.time())
    state = MarketState()
    state.load_items(
        [
            {"id": 561, "name": "Nature rune", "members": 1, "buy_limit": 18000, "highalch": 108, "lowalch": 72, "is_tax_exempt": 0, "icon": "Nature_rune.png"},
            {"id": 4151, "name": "Abyssal whip", "members": 1, "buy_limit": 70, "highalch": 72000, "lowalch": 48000, "is_tax_exempt": 0, "icon": "Abyssal_whip.png"},
            {"id": 1127, "name": "Rune platebody", "members": 0, "buy_limit": 70, "highalch": 39000, "lowalch": 26000, "is_tax_exempt": 0, "icon": "Rune_platebody.png"},
            {"id": 2434, "name": "Prayer potion(4)", "members": 1, "buy_limit": 2000, "highalch": 114, "lowalch": 76, "is_tax_exempt": 0, "icon": "Prayer_potion(4).png"},
            {"id": 139, "name": "Prayer potion(3)", "members": 1, "buy_limit": 2000, "highalch": 114, "lowalch": 76, "is_tax_exempt": 0, "icon": "Prayer_potion(3).png"},
            {"id": 12877, "name": "Dharok's armour set", "members": 1, "buy_limit": 8, "highalch": 0, "lowalch": 0, "is_tax_exempt": 0, "icon": "Dharok.png"},
            {"id": 4716, "name": "Dharok's helm", "members": 1, "buy_limit": 15, "highalch": 0, "lowalch": 0, "is_tax_exempt": 0, "icon": ""},
            {"id": 4720, "name": "Dharok's platebody", "members": 1, "buy_limit": 15, "highalch": 0, "lowalch": 0, "is_tax_exempt": 0, "icon": ""},
            {"id": 4722, "name": "Dharok's platelegs", "members": 1, "buy_limit": 15, "highalch": 0, "lowalch": 0, "is_tax_exempt": 0, "icon": ""},
            {"id": 4718, "name": "Dharok's greataxe", "members": 1, "buy_limit": 15, "highalch": 0, "lowalch": 0, "is_tax_exempt": 0, "icon": ""},
            {"id": 99999, "name": "Crashed Bandos item", "members": 1, "buy_limit": 8, "highalch": 100000, "lowalch": 50000, "is_tax_exempt": 0, "icon": ""},
        ]
    )
    state.update_latest(
        {
            561: {"high": 100, "highTime": now - 10, "low": 98, "lowTime": now - 12},
            4151: {"high": 1_560_000, "highTime": now - 20, "low": 1_500_000, "lowTime": now - 25},
            1127: {"high": 39_800, "highTime": now - 15, "low": 38_700, "lowTime": now - 18},
            2434: {"high": 12_000, "highTime": now - 15, "low": 11_800, "lowTime": now - 15},
            139: {"high": 8_600, "highTime": now - 15, "low": 8_400, "lowTime": now - 15},
            12877: {"high": 4_500_000, "highTime": now - 60, "low": 4_400_000, "lowTime": now - 60},
            4716: {"high": 1_000_000, "highTime": now - 60, "low": 980_000, "lowTime": now - 60},
            4720: {"high": 1_100_000, "highTime": now - 60, "low": 1_050_000, "lowTime": now - 60},
            4722: {"high": 1_050_000, "highTime": now - 60, "low": 1_000_000, "lowTime": now - 60},
            4718: {"high": 1_100_000, "highTime": now - 60, "low": 1_050_000, "lowTime": now - 60},
            99999: {"high": 8_200_000, "highTime": now - 30, "low": 8_000_000, "lowTime": now - 20},
        }
    )

    # Populate 24 hourly candles
    for h in range(1, 25):
        ts = ((now // 3600) - h) * 3600
        state.ingest_candle_bucket(
            "1h",
            ts,
            {
                4151: {"avgHighPrice": 1_555_000, "avgLowPrice": 1_505_000, "highPriceVolume": 45, "lowPriceVolume": 42},
                1127: {"avgHighPrice": 39_700, "avgLowPrice": 38_700, "highPriceVolume": 120, "lowPriceVolume": 115},
                2434: {"avgHighPrice": 12_000, "avgLowPrice": 11_800, "highPriceVolume": 3000, "lowPriceVolume": 2900},
                139: {"avgHighPrice": 8_600, "avgLowPrice": 8_400, "highPriceVolume": 1500, "lowPriceVolume": 1600},
                12877: {"avgHighPrice": 4_500_000, "avgLowPrice": 4_400_000, "highPriceVolume": 10, "lowPriceVolume": 10},
                4716: {"avgHighPrice": 1_000_000, "avgLowPrice": 980_000, "highPriceVolume": 15, "lowPriceVolume": 15},
                4720: {"avgHighPrice": 1_100_000, "avgLowPrice": 1_050_000, "highPriceVolume": 15, "lowPriceVolume": 15},
                4722: {"avgHighPrice": 1_050_000, "avgLowPrice": 1_000_000, "highPriceVolume": 15, "lowPriceVolume": 15},
                4718: {"avgHighPrice": 1_100_000, "avgLowPrice": 1_050_000, "highPriceVolume": 15, "lowPriceVolume": 15},
                # Crashed item normally trades at 10M with minor noise
                99999: {
                    "avgHighPrice": 10_050_000 + (h % 3) * 20_000,
                    "avgLowPrice": 9_950_000 - (h % 2) * 20_000,
                    "highPriceVolume": 20,
                    "lowPriceVolume": 20,
                },
            },
        )
    ts5 = ((now // 300) - 1) * 300
    state.ingest_candle_bucket(
        "5m",
        ts5,
        {
            4151: {"avgHighPrice": 1_560_000, "avgLowPrice": 1_500_000, "highPriceVolume": 4, "lowPriceVolume": 4},
            1127: {"avgHighPrice": 39_800, "avgLowPrice": 38_700, "highPriceVolume": 10, "lowPriceVolume": 9},
            99999: {"avgHighPrice": 8_300_000, "avgLowPrice": 8_000_000, "highPriceVolume": 2, "lowPriceVolume": 25},
        },
    )
    state.recompute_all_metrics()
    return state


def test_metrics_and_trade_calls():
    state = _build_sample_state()
    whip = state.metrics[4151]
    assert whip.net_margin > 0
    assert whip.tax == calculate_ge_tax(whip.suggested_sell)
    assert whip.fast_flip_score > 20

    # Dump sniper should strongly detect the crashed item
    crashed = state.metrics[99999]
    assert crashed.zscore_24h < -2.0
    assert crashed.dump_sniper_score > 60

    # Trade calls should allocate within cash_stack and respect F2P filter
    calls = generate_trade_calls(state, cash_stack=20_000_000, free_slots=4, mode="auto_mix", members=True)
    assert len(calls) > 0
    assert all(c["est_net_profit"] > 0 for c in calls)

    f2p_calls = generate_trade_calls(state, cash_stack=10_000_000, free_slots=8, mode="auto_mix", members=False)
    assert all(not c["members"] for c in f2p_calls)

    # Fast Flips enforce live 5m volume, front-of-queue >=4 gp spread, and quick <=45m cycle sizing
    f2p_fast = generate_trade_calls(state, cash_stack=5_000_000, free_slots=8, mode="fast_flip", members=False)
    assert len(f2p_fast) > 0
    assert all(not c["members"] and c["est_fill_minutes"] <= 45.0 for c in f2p_fast)

    # Regression test 1: 1-gp FIFO queue-locked runes (5->6 gp) must NEVER appear in Fast Flips
    now = int(time.time())
    state.load_items(
        list(state.items.values())
        + [
            {"id": 556, "name": "Air rune", "members": 0, "buy_limit": 50000, "highalch": 2, "lowalch": 1, "is_tax_exempt": 0, "icon": ""},
            {"id": 379, "name": "Lobster", "members": 0, "buy_limit": 10000, "highalch": 72, "lowalch": 48, "is_tax_exempt": 1, "icon": ""},
        ]
    )
    state.update_latest(
        {
            556: {"high": 6, "highTime": now - 5, "low": 5, "lowTime": now - 5},
            379: {"high": 92, "highTime": now - 10, "low": 89, "lowTime": now - 10},
        }
    )
    # Give Air rune massive 1h & 5m volume (classic 20% ROI FIFO trap)
    for h in range(1, 25):
        ts = ((now // 3600) - h) * 3600
        state.ingest_candle_bucket(
            "1h", ts, {556: {"avgHighPrice": 6, "avgLowPrice": 5, "highPriceVolume": 900_000, "lowPriceVolume": 900_000}}
        )
    state.ingest_candle_bucket(
        "5m", ((now // 300) - 1) * 300, {556: {"avgHighPrice": 6, "avgLowPrice": 5, "highPriceVolume": 80_000, "lowPriceVolume": 80_000}}
    )
    # Regression test 2: Lobster traded at 94-100 gp 5-6 days ago, then shifted to 87-91 gp for the last 4 days.
    # Recent 48h anchor must NOT recommend stale 94 gp sell!
    for h in range(1, 165):
        ts = ((now // 3600) - h) * 3600
        if h <= 96:
            lob = {"avgHighPrice": 90, "avgLowPrice": 87, "highPriceVolume": 5000, "lowPriceVolume": 5000}
        else:
            lob = {"avgHighPrice": 97, "avgLowPrice": 93, "highPriceVolume": 5000, "lowPriceVolume": 5000}
        state.ingest_candle_bucket("1h", ts, {379: lob})
    state.recompute_all_metrics()

    air = state.metrics[556]
    assert "QUEUE_LOCKED" in air.manipulation_flags
    assert air.fast_flip_score == 0.0
    f2p_fast_after = generate_trade_calls(state, cash_stack=5_000_000, free_slots=3, mode="fast_flip", members=False)
    assert all(c["item_id"] != 556 for c in f2p_fast_after)

    lob_m = state.metrics[379]
    assert lob_m.p75_48h == 90
    assert lob_m.p75_7d >= 94  # 7d still shows the old regime, while 48h tracks the live regime!
    ov_f2p = generate_overnight_flips(state, cash_stack=2_000_000, slots=3, style="balanced", members=False)
    lob_ov = [f for f in ov_f2p if f["item_id"] == 379]
    if lob_ov:
        assert lob_ov[0]["sell_price"] <= 92

    # Dedicated overnight flips anchored to 7d hourly percentile band
    overnight = generate_overnight_flips(state, cash_stack=25_000_000, slots=8, style="balanced", members=True)
    assert len(overnight) > 0
    assert all(f["est_net_profit"] > 0 and f["p25_7d"] <= f["p75_7d"] for f in overnight)

    # Verify two-stage recompute uses cached candle stats and runs cleanly
    fast_ms = state.recompute_all_metrics()
    assert fast_ms >= 0.0
    assert state.metrics[4151].net_margin > 0


@pytest.mark.asyncio
async def test_watchlist_and_24h_rollup(tmp_path: Path):
    from app.db.database import Database
    from app.db.repository import Repository
    from app.routers import watchlist as watchlist_router
    from fastapi import FastAPI

    db = Database(tmp_path / "watch.db")
    await db.connect()
    repo = Repository(db)
    state = _build_sample_state()

    # Verify daily rollup inserts rows for yesterday's UTC hours
    now = int(time.time())
    yesterday_hr = ((now // 86400) - 1) * 86400 + 3600
    await repo.upsert_candles("candles_1h", yesterday_hr, {4151: {"avgHighPrice": 1550000, "avgLowPrice": 1500000, "highPriceVolume": 10, "lowPriceVolume": 12}})
    rolled = await repo.rollup_candles_24h()
    assert rolled >= 1

    # Verify watchlist CRUD + target trigger detection
    app = FastAPI()
    app.state.repo = repo
    app.state.market_state = state
    app.include_router(watchlist_router.router)
    client = TestClient(app)

    res = client.post(
        "/api/watchlist",
        json={"item_id": 4151, "buy_below": 1_520_000, "min_net_margin": 10_000, "discord_notify": True},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["item_name"] == "Abyssal whip"
    assert "BUY_BELOW" in data["triggered"]
    assert "MIN_MARGIN" in data["triggered"]

    listed = client.get("/api/watchlist").json()
    assert len(listed["items"]) == 1

    deleted = client.delete("/api/watchlist/4151").json()
    assert deleted["deleted"] is True

    await db.close()


def test_arbitrage_decanting_and_sets():
    state = _build_sample_state()

    # 4 x Prayer potion(3) @ 8400 = 33,600 -> 3 x Prayer potion(4) @ 12,000 - 240 tax = 35,280 -> +560 gp/4-dose!
    decants = scan_potion_decanting(state, members=True, min_profit_per_4dose=5)
    assert len(decants) >= 1
    assert decants[0]["potion_family"] == "Prayer potion"
    assert decants[0]["net_profit_per_4dose"] > 500

    # Dharok's pack: components low sum = 4,080,000; set high = 4,500,000 - 90,000 tax = 4,410,000 -> +330,000 gp!
    sets = scan_item_sets(state, members=True, min_profit=10_000)
    assert len(sets) >= 1
    assert sets[0]["set_name"] == "Dharok's armour set"
    assert sets[0]["direction"] == "PACK"
    assert sets[0]["net_profit"] == 330_000

    # Expanded Arbitrage: Zahur Unfinished Potions & Plank Make / Enchanting
    from app.engine.arbitrage import scan_herb_and_zahur, scan_processing_and_enchanting

    now = int(time.time())
    st2 = MarketState()
    st2.load_items(
        [
            {"id": 561, "name": "Nature rune", "members": 1, "buy_limit": 18000, "highalch": 108, "lowalch": 72, "is_tax_exempt": 0, "icon": ""},
            {"id": 9075, "name": "Astral rune", "members": 1, "buy_limit": 10000, "highalch": 30, "lowalch": 20, "is_tax_exempt": 0, "icon": ""},
            {"id": 564, "name": "Cosmic rune", "members": 1, "buy_limit": 12000, "highalch": 30, "lowalch": 20, "is_tax_exempt": 0, "icon": ""},
            {"id": 227, "name": "Vial of water", "members": 0, "buy_limit": 13000, "highalch": 1, "lowalch": 1, "is_tax_exempt": 0, "icon": ""},
            {"id": 257, "name": "Ranarr weed", "members": 1, "buy_limit": 11000, "highalch": 10, "lowalch": 5, "is_tax_exempt": 0, "icon": ""},
            {"id": 99, "name": "Ranarr potion (unf)", "members": 1, "buy_limit": 10000, "highalch": 10, "lowalch": 5, "is_tax_exempt": 0, "icon": ""},
            {"id": 1639, "name": "Emerald ring", "members": 0, "buy_limit": 10000, "highalch": 765, "lowalch": 510, "is_tax_exempt": 0, "icon": ""},
            {"id": 2552, "name": "Ring of dueling(8)", "members": 1, "buy_limit": 10000, "highalch": 765, "lowalch": 510, "is_tax_exempt": 1, "icon": ""},
        ]
    )
    st2.update_latest(
        {
            561: {"high": 100, "highTime": now, "low": 98, "lowTime": now},
            9075: {"high": 80, "highTime": now, "low": 78, "lowTime": now},
            564: {"high": 120, "highTime": now, "low": 118, "lowTime": now},
            227: {"high": 5, "highTime": now, "low": 4, "lowTime": now},
            257: {"high": 6000, "highTime": now, "low": 5900, "lowTime": now},
            99: {"high": 6600, "highTime": now, "low": 6500, "lowTime": now},
            1639: {"high": 800, "highTime": now, "low": 780, "lowTime": now},
            2552: {"high": 1150, "highTime": now, "low": 1100, "lowTime": now},
        }
    )
    st2.ingest_candle_bucket(
        "1h",
        ((now // 3600) - 1) * 3600,
        {
            257: {"avgHighPrice": 6000, "avgLowPrice": 5900, "highPriceVolume": 500, "lowPriceVolume": 500},
            99: {"avgHighPrice": 6600, "avgLowPrice": 6500, "highPriceVolume": 500, "lowPriceVolume": 500},
            1639: {"avgHighPrice": 800, "avgLowPrice": 780, "highPriceVolume": 500, "lowPriceVolume": 500},
            2552: {"avgHighPrice": 1150, "avgLowPrice": 1100, "highPriceVolume": 500, "lowPriceVolume": 500},
        },
    )
    st2.recompute_all_metrics()

    herbs = scan_herb_and_zahur(st2, members=True)
    assert any(h["method"] == "ZAHUR_UNF" and h["net_profit"] > 0 for h in herbs)

    proc = scan_processing_and_enchanting(st2, members=True)
    assert any(p["category"] == "ENCHANT" and p["output_name"] == "Ring of dueling(8)" and p["tax"] == 0 for p in proc)


def test_silent_entitlements_registry(monkeypatch: pytest.MonkeyPatch):
    from app.config import get_settings

    # Default self-hosted/private mode: billing_enforced=False -> everything unlocked, zero upgrade UI
    monkeypatch.setenv("BILLING_ENFORCED", "false")
    get_settings.cache_clear()
    cfg_free = get_settings()
    assert has_feature(FeatureKey.ML_PREDICTIONS, cfg_free, PlanTier.FREE) is True
    assert has_feature(FeatureKey.ML_BOOST, cfg_free, PlanTier.FREE) is True
    payload = build_entitlements_payload(cfg_free, PlanTier.FREE)
    assert payload["show_upgrade_ui"] is False
    assert all(payload["features"].values())

    # Future SaaS mode: billing_enforced=True -> Pro features cleanly gated by plan
    monkeypatch.setenv("BILLING_ENFORCED", "true")
    get_settings.cache_clear()
    cfg_saas = get_settings()
    assert has_feature(FeatureKey.ML_PREDICTIONS, cfg_saas, PlanTier.FREE) is False
    assert has_feature(FeatureKey.ML_PREDICTIONS, cfg_saas, PlanTier.PRO) is True
    assert build_entitlements_payload(cfg_saas, PlanTier.FREE)["show_upgrade_ui"] is True
    assert build_entitlements_payload(cfg_saas, PlanTier.PRO)["show_upgrade_ui"] is False
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_system_health_and_actions(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "sys.db"))
    monkeypatch.setenv("APP_PASSWORD", "")

    from app.alerts.dispatcher import AlertDispatcher
    from app.config import get_settings
    from app.db.database import Database
    from app.db.repository import Repository
    from app.ingestion.collector import CollectorService
    from app.ingestion.wiki_client import WikiApiClient
    from app.main import WebSocketHub
    from app.routers import system as system_router
    from fastapi import FastAPI

    get_settings.cache_clear()
    cfg = get_settings()
    db = Database(cfg.db_file)
    await db.connect()
    repo = Repository(db)
    wiki = WikiApiClient(cfg)
    state = _build_sample_state()
    ws_hub = WebSocketHub()
    alerts = AlertDispatcher(cfg, repo, ws_hub.broadcast)
    collector = CollectorService(cfg, db, repo, wiki, state, alerts, ws_hub.broadcast)

    system_router.invalidate_db_stats_cache()
    app = FastAPI()
    app.state.settings = cfg
    app.state.db = db
    app.state.repo = repo
    app.state.wiki_client = wiki
    app.state.market_state = state
    app.state.ws_hub = ws_hub
    app.state.alerts = alerts
    app.state.collector = collector
    app.include_router(system_router.router)

    client = TestClient(app)
    res = client.get("/api/system/health?fresh=true")
    assert res.status_code == 200
    body = res.json()
    assert body["overall_status"] in ("healthy", "degraded")
    assert body["engine"]["items_tracked"] == len(state.metrics)
    assert len(body["engine"]["recompute_history"]) >= 1
    assert "pipeline_health" in body["dataset"]
    assert body["dataset"]["retention_1h_days"] == cfg.retention_1h_days
    assert "stored_1h_days" in body["dataset"]
    assert body["engine"]["backfill"]["target_days"] == cfg.bootstrap_1h_background_days
    assert body["runtime"]["platform"]

    chk = client.post("/api/system/actions/checkpoint")
    assert chk.status_code == 200
    assert chk.json()["ok"] is True

    rol = client.post("/api/system/actions/rollup")
    assert rol.status_code == 200
    assert rol.json()["ok"] is True

    bak = client.post("/api/system/actions/backup")
    assert bak.status_code == 200
    assert bak.json()["ok"] is True
    assert bak.json()["filename"].startswith("osrs_terminal_")

    # History backfill validation & in-flight guard (no live network calls)
    bad_bf = client.post("/api/system/actions/backfill", json={"days": 999})
    assert bad_bf.status_code == 422

    collector.bg_active = True
    collector.bg_target_days = 60
    busy_bf = client.post("/api/system/actions/backfill", json={"days": 90})
    assert busy_bf.status_code == 200
    assert busy_bf.json()["ok"] is True
    assert busy_bf.json()["started"] is False
    assert busy_bf.json()["status"] == "already_running"
    collector.bg_active = False

    await alerts.close()
    await db.close()
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_ml_walk_forward_training_and_inference(tmp_path: Path):
    import math
    from app.db.database import Database
    from app.db.repository import Repository
    from app.ml.predictor import MLPredictor
    from app.ml.train import run_training_pipeline

    db_path = tmp_path / "ml_test.db"
    models_dir = tmp_path / "models"
    db = Database(db_path)
    await db.connect()
    repo = Repository(db)

    # Seed 8 liquid items and 16 days (384 hours) of oscillating hourly candles
    items = [
        {"id": 1000 + i, "name": f"Test Item {i}", "members": True, "limit": 500, "highalch": 1000, "lowalch": 500, "icon": ""}
        for i in range(8)
    ]
    await repo.upsert_items(items)

    base_ts = ((int(time.time()) // 3600) - 400) * 3600
    for h in range(384):
        ts = base_ts + h * 3600
        bucket: dict[int, dict[str, int]] = {}
        for i in range(8):
            base_p = 100_000 + i * 25_000
            wave = int(base_p * 0.04 * math.sin(2 * math.pi * (h + i * 2) / 24.0))
            low_p = base_p + wave
            high_p = int(low_p * 1.032)
            bucket[1000 + i] = {
                "avgHighPrice": high_p,
                "avgLowPrice": low_p,
                "highPriceVolume": 40 + (h % 15),
                "lowPriceVolume": 40 + ((h + 5) % 15),
            }
        await repo.upsert_candles("candles_1h", ts, bucket)
    await db.close()

    report = run_training_pipeline(db_path, models_dir, lookback_days=30, min_item_candles=72, min_hourly_gp_vol=10_000.0)
    assert report["status"] == "ready"
    assert report["dataset_rows"] >= 2000
    assert len(report["folds"]) >= 2
    assert len(report["equity_curve"]) >= 2
    assert len(report["feature_importances"]) == 10

    predictor = MLPredictor(models_dir)
    assert predictor.load_models() is True
    state = _build_sample_state()
    inf_ms = predictor.refresh_predictions(state)
    assert inf_ms >= 0.0
    assert 4151 in predictor.predictions
    pred = predictor.predictions[4151]
    assert 0.0 < pred.prob_4h_win < 1.0
    assert 0.0 < pred.prob_12h_win < 1.0
