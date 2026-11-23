"""ML model status, walk-forward backtest report, and on-demand subprocess training."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request

from app.auth import require_auth

router = APIRouter(prefix="/api/ml", tags=["ml"], dependencies=[Depends(require_auth)])


@router.get("/status")
async def get_ml_status(request: Request) -> dict[str, Any]:
    ml = request.app.state.ml_predictor
    return ml.get_status()


@router.post("/train")
async def trigger_ml_train(request: Request) -> dict[str, Any]:
    ml = request.app.state.ml_predictor
    db = request.app.state.db
    state = request.app.state.market_state
    settings = request.app.state.settings
    ws_hub = request.app.state.ws_hub

    async def _notify_ws(status: dict[str, Any]) -> None:
        await ws_hub.broadcast(
            {
                "type": "ml_trained",
                "loaded": status.get("loaded", False),
                "validated": status.get("validated", False),
            }
        )

    return ml.start_training(
        db_path=db.db_path,
        state=state,
        lookback_days=settings.bootstrap_1h_background_days,
        on_complete=_notify_ws,
    )
