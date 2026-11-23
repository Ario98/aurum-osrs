"""Fast in-memory Histogram GBDT inference + non-blocking subprocess training coordinator."""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

import numpy as np

from app.ml.features import extract_live_features

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class MLPrediction:
    prob_4h_win: float       # 0.0 .. 1.0 (active flip / bounce win probability)
    prob_12h_win: float      # 0.0 .. 1.0 (overnight flip win probability)
    pred_12h_roi_pct: float  # predicted post-2%-tax 12h net ROI %

    def to_dict(self) -> dict[str, Any]:
        return {
            "prob_4h_pct": round(self.prob_4h_win * 100.0, 1),
            "prob_12h_pct": round(self.prob_12h_win * 100.0, 1),
            "pred_12h_roi_pct": round(self.pred_12h_roi_pct, 2),
        }


class MLPredictor:
    """Loads saved GBDT models, serves <25ms batch inference, and runs isolated training workers."""

    def __init__(self, models_dir: Path) -> None:
        self.models_dir = models_dir
        self._m4: Any = None
        self._m12_cls: Any = None
        self._m12_reg: Any = None
        self.report: Optional[dict[str, Any]] = None
        self.predictions: dict[int, MLPrediction] = {}
        self.last_inference_ms: float = 0.0
        self.last_inference_ts: int = 0

        # Subprocess training coordination
        self.training_in_progress: bool = False
        self.training_started_at: Optional[int] = None
        self.last_train_error: Optional[str] = None
        self._train_task: Optional[asyncio.Task[Any]] = None

    @property
    def loaded(self) -> bool:
        return self._m4 is not None and self._m12_cls is not None and self._m12_reg is not None

    @property
    def validated(self) -> bool:
        return bool(self.loaded and self.report and self.report.get("validated") is True)

    def load_models(self) -> bool:
        """Load models.joblib + report.json from disk safely (never blocks or crashes boot)."""
        bundle_path = self.models_dir / "models.joblib"
        rep_path = self.models_dir / "report.json"

        if rep_path.exists():
            try:
                self.report = json.loads(rep_path.read_text(encoding="utf-8"))
            except Exception as exc:
                logger.warning("Failed to parse ML report.json: %s", exc)

        if not bundle_path.exists():
            self._m4 = None
            self._m12_cls = None
            self._m12_reg = None
            return False

        try:
            import joblib

            bundle = joblib.load(bundle_path)
            self._m4 = bundle["m4"]
            self._m12_cls = bundle["m12_cls"]
            self._m12_reg = bundle["m12_reg"]
            logger.info(
                "Loaded GBDT models from %s (validated=%s)",
                bundle_path,
                self.validated,
            )
            return True
        except Exception as exc:
            logger.warning("Failed to load GBDT models: %s", exc)
            self._m4 = None
            self._m12_cls = None
            self._m12_reg = None
            return False

    def refresh_predictions(self, state: Any) -> float:
        """Run fast batch inference across all active items in <25ms."""
        if not self.loaded:
            self.predictions.clear()
            return 0.0

        t0 = time.perf_counter()
        item_ids, X = extract_live_features(state)
        if len(item_ids) == 0:
            self.predictions.clear()
            return 0.0

        p4 = np.clip(self._m4.predict_proba(X)[:, 1], 0.01, 0.99)
        p12 = np.clip(self._m12_cls.predict_proba(X)[:, 1], 0.01, 0.99)
        r12 = np.clip(self._m12_reg.predict(X), -15.0, 25.0)

        preds: dict[int, MLPrediction] = {}
        for idx, item_id in enumerate(item_ids):
            preds[item_id] = MLPrediction(
                prob_4h_win=float(p4[idx]),
                prob_12h_win=float(p12[idx]),
                pred_12h_roi_pct=float(r12[idx]),
            )

        self.predictions = preds
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        self.last_inference_ms = round(elapsed_ms, 2)
        self.last_inference_ts = int(time.time())
        return elapsed_ms

    def get_status(self) -> dict[str, Any]:
        return {
            "loaded": self.loaded,
            "validated": self.validated,
            "predictions_count": len(self.predictions),
            "last_inference_ms": self.last_inference_ms,
            "last_inference_ts": self.last_inference_ts,
            "training_in_progress": self.training_in_progress,
            "training_started_at": self.training_started_at,
            "last_train_error": self.last_train_error,
            "report": self.report,
        }

    def start_training(
        self,
        db_path: Path,
        state: Any,
        lookback_days: int = 30,
        on_complete: Optional[Callable[[dict[str, Any]], Awaitable[None]]] = None,
    ) -> dict[str, Any]:
        """Launch isolated subprocess training (non-blocking, frees all peak RAM on exit)."""
        if self.training_in_progress:
            return {
                "started": False,
                "status": "already_running",
                "message": "ML training & walk-forward backtest is already running.",
            }

        self.training_in_progress = True
        self.training_started_at = int(time.time())
        self.last_train_error = None

        async def _runner() -> None:
            try:
                cmd = [
                    sys.executable,
                    "-m",
                    "app.ml.train",
                    "--db",
                    str(db_path),
                    "--out",
                    str(self.models_dir),
                    "--days",
                    str(lookback_days),
                ]
                logger.info("Starting isolated ML training worker: %s", " ".join(cmd))
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout, stderr = await proc.communicate()
                if proc.returncode != 0:
                    err_txt = (stderr.decode("utf-8", errors="ignore") or stdout.decode("utf-8", errors="ignore")).strip()
                    self.last_train_error = err_txt[-400:] if err_txt else f"Exit code {proc.returncode}"
                    logger.error("ML training worker failed (rc=%s): %s", proc.returncode, self.last_train_error)
                else:
                    self.load_models()
                    if state is not None and state.metrics:
                        self.refresh_predictions(state)
                    logger.info(
                        "ML training complete! loaded=%s validated=%s inference=%.1fms",
                        self.loaded,
                        self.validated,
                        self.last_inference_ms,
                    )
                    if on_complete is not None:
                        await on_complete(self.get_status())
            except Exception as exc:
                self.last_train_error = str(exc)[:300]
                logger.exception("ML training runner raised exception")
            finally:
                self.training_in_progress = False

        self._train_task = asyncio.create_task(_runner(), name="ml-train-worker")
        return {
            "started": True,
            "status": "started",
            "message": "Walk-forward training started in background worker (~20–45s).",
        }
