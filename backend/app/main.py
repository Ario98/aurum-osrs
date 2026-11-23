"""FastAPI entry point — wires SQLite WAL, 30s Bootstrapper, Metrics Engine, Alerts & WebSockets."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.alerts.dispatcher import AlertDispatcher
from app.auth import SESSION_COOKIE_NAME, verify_session_token
from app.config import get_settings
from app.db.database import Database
from app.db.repository import Repository
from app.engine.state import MarketState
from app.ingestion.collector import CollectorService
from app.ingestion.wiki_client import WikiApiClient
from app.routers import arbitrage, market, settings as settings_router, slots, system, watchlist, webhooks


class WebSocketHub:
    """Manages active browser WebSocket connections for sub-second live pushes."""

    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._clients.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self._clients.discard(ws)

    async def broadcast(self, message: dict[str, Any]) -> None:
        dead: list[WebSocket] = []
        for ws in list(self._clients):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._clients.discard(ws)


def create_app() -> FastAPI:
    cfg = get_settings()
    logging.basicConfig(
        level=getattr(logging, cfg.log_level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        db = Database(cfg.db_file)
        await db.connect()
        repo = Repository(db)
        wiki = WikiApiClient(cfg)
        await wiki.start()
        state = MarketState()
        ws_hub = WebSocketHub()
        alerts = AlertDispatcher(cfg, repo, ws_hub.broadcast)
        collector = CollectorService(cfg, db, repo, wiki, state, alerts, ws_hub.broadcast)

        app.state.settings = cfg
        app.state.db = db
        app.state.repo = repo
        app.state.wiki_client = wiki
        app.state.market_state = state
        app.state.ws_hub = ws_hub
        app.state.alerts = alerts
        app.state.collector = collector

        await collector.start()
        try:
            yield
        finally:
            await collector.stop()
            await alerts.close()
            await wiki.close()
            await db.close()

    app = FastAPI(title=cfg.app_name, version="2.0.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health() -> dict[str, Any]:
        state: MarketState = app.state.market_state
        return {
            "status": "ok",
            "ready": state.bootstrap_fast_done,
            "items_tracked": len(state.metrics),
            "last_recompute_ms": round(state.last_recompute_ms, 2),
        }

    @app.websocket("/ws/market")
    async def market_websocket(ws: WebSocket) -> None:
        if cfg.app_password:
            token = ws.cookies.get(SESSION_COOKIE_NAME)
            if not verify_session_token(token, cfg):
                await ws.close(code=4401)
                return

        hub: WebSocketHub = app.state.ws_hub
        await hub.connect(ws)
        try:
            # Send initial status immediately on connect
            state: MarketState = app.state.market_state
            await ws.send_json(
                {
                    "type": "connected",
                    "ready": state.bootstrap_fast_done,
                    "progress": state.bootstrap_progress,
                    "items_count": len(state.metrics),
                }
            )
            while True:
                # Keepalive listener (client can send "ping")
                msg = await ws.receive_text()
                if msg == "ping":
                    await ws.send_json({"type": "pong"})
        except WebSocketDisconnect:
            hub.disconnect(ws)
        except Exception:
            hub.disconnect(ws)

    app.include_router(market.router)
    app.include_router(arbitrage.router)
    app.include_router(slots.router)
    app.include_router(watchlist.router)
    app.include_router(system.router)
    app.include_router(webhooks.router)
    app.include_router(settings_router.router)

    # Serve compiled React SPA in production container if present
    static_dir = Path(__file__).resolve().parent.parent / "static"
    if static_dir.exists() and (static_dir / "index.html").exists():
        assets_dir = static_dir / "assets"
        if assets_dir.exists():
            app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

        @app.get("/{full_path:path}")
        async def serve_spa(full_path: str) -> FileResponse:
            candidate = static_dir / full_path
            if full_path and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(static_dir / "index.html")

    return app


app = create_app()
