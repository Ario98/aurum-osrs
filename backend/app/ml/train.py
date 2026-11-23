"""Isolated LightGBM training + strict walk-forward backtester (zero lookahead leakage).

Run directly as a subprocess so FastAPI's event loop & live 20s ticks are never blocked:
    python -m app.ml.train --db data/osrs_terminal.db --out data/models
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any

import lightgbm as lgb
import numpy as np

from app.ml.features import FEATURE_NAMES, build_training_dataset

logger = logging.getLogger(__name__)


def _roc_auc_score(y_true: np.ndarray, y_score: np.ndarray) -> float:
    """Fast pure-NumPy ROC-AUC (zero scikit-learn dependency)."""
    y_true = np.asarray(y_true, dtype=np.int8)
    y_score = np.asarray(y_score, dtype=np.float64)
    pos = int(np.sum(y_true == 1))
    neg = int(np.sum(y_true == 0))
    if pos == 0 or neg == 0:
        return 0.5
    order = np.argsort(y_score, kind="mergesort")
    ranks = np.empty_like(order, dtype=np.float64)
    ranks[order] = np.arange(1, len(y_score) + 1, dtype=np.float64)
    # Handle ties via average rank
    sorted_scores = y_score[order]
    diffs = np.flatnonzero(np.diff(sorted_scores))
    starts = np.concatenate(([0], diffs + 1))
    ends = np.concatenate((diffs + 1, [len(sorted_scores)]))
    for s, e in zip(starts, ends):
        if e - s > 1:
            avg_rank = 0.5 * (s + 1 + e)
            ranks[order[s:e]] = avg_rank
    sum_pos_ranks = float(np.sum(ranks[y_true == 1]))
    auc = (sum_pos_ranks - pos * (pos + 1) / 2.0) / (pos * neg)
    return float(max(0.0, min(1.0, auc)))


def _fit_lgb_binary(X_tr: np.ndarray, y_tr: np.ndarray, X_va: np.ndarray | None = None, y_va: np.ndarray | None = None) -> lgb.Booster:
    params: dict[str, Any] = {
        "objective": "binary",
        "metric": "auc",
        "boosting_type": "gbdt",
        "num_leaves": 31,
        "max_depth": 6,
        "learning_rate": 0.05,
        "feature_fraction": 0.8,
        "bagging_fraction": 0.8,
        "bagging_freq": 1,
        "min_child_samples": 40,
        "lambda_l2": 2.0,
        "n_jobs": min(2, os.cpu_count() or 1),
        "verbose": -1,
        "seed": 42,
    }
    dtrain = lgb.Dataset(X_tr, label=y_tr, feature_name=FEATURE_NAMES, free_raw_data=False)
    valid_sets = [dtrain]
    callbacks = [lgb.log_evaluation(period=0)]
    num_rounds = 180
    if X_va is not None and y_va is not None and len(X_va) >= 100:
        dval = lgb.Dataset(X_va, label=y_va, reference=dtrain, feature_name=FEATURE_NAMES, free_raw_data=False)
        valid_sets.append(dval)
        callbacks.append(lgb.early_stopping(stopping_rounds=25, verbose=False))
        num_rounds = 240
    return lgb.train(params, dtrain, num_boost_round=num_rounds, valid_sets=valid_sets, callbacks=callbacks)


def _fit_lgb_reg(X_tr: np.ndarray, y_tr: np.ndarray, X_va: np.ndarray | None = None, y_va: np.ndarray | None = None) -> lgb.Booster:
    params: dict[str, Any] = {
        "objective": "huber",
        "alpha": 2.5,
        "metric": "l1",
        "boosting_type": "gbdt",
        "num_leaves": 31,
        "max_depth": 6,
        "learning_rate": 0.05,
        "feature_fraction": 0.8,
        "bagging_fraction": 0.8,
        "bagging_freq": 1,
        "min_child_samples": 40,
        "lambda_l2": 2.0,
        "n_jobs": min(2, os.cpu_count() or 1),
        "verbose": -1,
        "seed": 42,
    }
    dtrain = lgb.Dataset(X_tr, label=y_tr, feature_name=FEATURE_NAMES, free_raw_data=False)
    valid_sets = [dtrain]
    callbacks = [lgb.log_evaluation(period=0)]
    num_rounds = 180
    if X_va is not None and y_va is not None and len(X_va) >= 100:
        dval = lgb.Dataset(X_va, label=y_va, reference=dtrain, feature_name=FEATURE_NAMES, free_raw_data=False)
        valid_sets.append(dval)
        callbacks.append(lgb.early_stopping(stopping_rounds=25, verbose=False))
        num_rounds = 240
    return lgb.train(params, dtrain, num_boost_round=num_rounds, valid_sets=valid_sets, callbacks=callbacks)


def _eval_top_k_cycles(
    ts: np.ndarray,
    scores: np.ndarray,
    actual_roi: np.ndarray,
    actual_win: np.ndarray,
    step_hours: int,
    top_k: int = 8,
) -> tuple[float, float, list[tuple[int, float]]]:
    """Simulate picking top-K items every `step_hours` non-overlapping cycle; return win%, avg ROI%, per-cycle ROI."""
    if len(ts) == 0:
        return 0.0, 0.0, []
    unique_ts = np.unique(ts)
    step_sec = step_hours * 3600
    selected_ts: list[int] = []
    last_t = -10**18
    for t in unique_ts:
        ti = int(t)
        if ti - last_t >= step_sec:
            selected_ts.append(ti)
            last_t = ti

    wins: list[float] = []
    rois: list[float] = []
    cycle_returns: list[tuple[int, float]] = []

    for t in selected_ts:
        mask = ts == t
        idx = np.flatnonzero(mask)
        if len(idx) < 3:
            continue
        k = min(top_k, len(idx))
        top_local = idx[np.argpartition(-scores[idx], k - 1)[:k]]
        c_roi = float(np.mean(actual_roi[top_local]))
        c_win = float(np.mean(actual_win[top_local])) * 100.0
        wins.append(c_win)
        rois.append(c_roi)
        cycle_returns.append((t, c_roi))

    if not rois:
        return 0.0, 0.0, []
    return float(np.mean(wins)), float(np.mean(rois)), cycle_returns


def run_training_pipeline(
    db_path: Path,
    out_dir: Path,
    lookback_days: int = 30,
    min_item_candles: int = 72,
    min_hourly_gp_vol: float = 40_000.0,
) -> dict[str, Any]:
    """Build 30d dataset, run 3-fold walk-forward backtest (12h embargo), and save production models."""
    t0 = time.perf_counter()
    out_dir.mkdir(parents=True, exist_ok=True)

    ds = build_training_dataset(
        db_path,
        lookback_days=lookback_days,
        min_item_candles=min_item_candles,
        min_hourly_gp_vol=min_hourly_gp_vol,
    )
    rows = int(ds["rows"])
    if rows < 2_000:
        report = {
            "status": "insufficient_data",
            "validated": False,
            "reason": f"Need at least 2,000 liquid item-hour samples (found {rows}). Wait for hourly history backfill.",
            "trained_at": int(time.time()),
            "dataset_rows": rows,
            "dataset_items": int(ds["items"]),
            "elapsed_sec": round(time.perf_counter() - t0, 2),
        }
        (out_dir / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        return report

    X: np.ndarray = ds["X"]
    ts: np.ndarray = ds["ts"]
    y4_win: np.ndarray = ds["y4_win"]
    y4_roi: np.ndarray = ds["y4_roi"]
    y12_win: np.ndarray = ds["y12_win"]
    y12_roi: np.ndarray = ds["y12_roi"]
    rule4: np.ndarray = ds["rule4"]
    rule12: np.ndarray = ds["rule12"]

    min_ts = int(ds["min_ts"])
    max_ts = int(ds["max_ts"])
    span = max(1, max_ts - min_ts)
    embargo_sec = 12 * 3600

    # 3 expanding time-series folds covering the last 45% of the window out-of-sample
    fold_bounds = [
        (0.55, 0.70),
        (0.70, 0.85),
        (0.85, 1.01),
    ]

    folds_summary: list[dict[str, Any]] = []
    oos_ts: list[np.ndarray] = []
    oos_p4: list[np.ndarray] = []
    oos_p12: list[np.ndarray] = []
    oos_r12: list[np.ndarray] = []
    oos_y4_win: list[np.ndarray] = []
    oos_y4_roi: list[np.ndarray] = []
    oos_y12_win: list[np.ndarray] = []
    oos_y12_roi: list[np.ndarray] = []
    oos_rule4: list[np.ndarray] = []
    oos_rule12: list[np.ndarray] = []

    for fold_idx, (start_frac, end_frac) in enumerate(fold_bounds, start=1):
        test_start = min_ts + int(span * start_frac)
        test_end = min_ts + int(span * end_frac)
        train_end = test_start - embargo_sec

        tr_mask = ts <= train_end
        te_mask = (ts >= test_start) & (ts < test_end)
        if int(np.sum(tr_mask)) < 500 or int(np.sum(te_mask)) < 200:
            continue

        # Internal chronological 85/15 split inside train fold for early stopping
        tr_indices = np.flatnonzero(tr_mask)
        tr_ts_sorted = np.sort(ts[tr_indices])
        val_cut = int(tr_ts_sorted[int(len(tr_ts_sorted) * 0.85)])
        fit_mask = tr_mask & (ts < val_cut - embargo_sec)
        val_mask = tr_mask & (ts >= val_cut)
        if int(np.sum(fit_mask)) < 300 or int(np.sum(val_mask)) < 100:
            fit_mask = tr_mask
            val_mask = np.zeros_like(tr_mask)

        X_fit, X_val = X[fit_mask], (X[val_mask] if np.any(val_mask) else None)
        m4 = _fit_lgb_binary(X_fit, y4_win[fit_mask], X_val, y4_win[val_mask] if X_val is not None else None)
        m12_cls = _fit_lgb_binary(X_fit, y12_win[fit_mask], X_val, y12_win[val_mask] if X_val is not None else None)
        m12_reg = _fit_lgb_reg(X_fit, y12_roi[fit_mask], X_val, y12_roi[val_mask] if X_val is not None else None)

        X_te = X[te_mask]
        p4 = m4.predict(X_te)
        p12 = m12_cls.predict(X_te)
        r12 = m12_reg.predict(X_te)

        auc4 = _roc_auc_score(y4_win[te_mask], p4)
        auc12 = _roc_auc_score(y12_win[te_mask], p12)

        ml_score_4 = p4
        ml_score_12 = p12 * np.maximum(r12, 0.1)

        ml_w4, ml_roi4, _ = _eval_top_k_cycles(ts[te_mask], ml_score_4, y4_roi[te_mask], y4_win[te_mask], step_hours=4)
        ru_w4, ru_roi4, _ = _eval_top_k_cycles(ts[te_mask], rule4[te_mask], y4_roi[te_mask], y4_win[te_mask], step_hours=4)
        ml_w12, ml_roi12, _ = _eval_top_k_cycles(ts[te_mask], ml_score_12, y12_roi[te_mask], y12_win[te_mask], step_hours=12)
        ru_w12, ru_roi12, _ = _eval_top_k_cycles(ts[te_mask], rule12[te_mask], y12_roi[te_mask], y12_win[te_mask], step_hours=12)

        folds_summary.append(
            {
                "fold": fold_idx,
                "train_rows": int(np.sum(tr_mask)),
                "test_rows": int(np.sum(te_mask)),
                "test_start_ts": test_start,
                "test_end_ts": min(test_end, max_ts),
                "auc_4h": round(auc4, 4),
                "auc_12h": round(auc12, 4),
                "ml_win_4h": round(ml_w4, 1),
                "rules_win_4h": round(ru_w4, 1),
                "ml_roi_4h": round(ml_roi4, 2),
                "rules_roi_4h": round(ru_roi4, 2),
                "ml_win_12h": round(ml_w12, 1),
                "rules_win_12h": round(ru_w12, 1),
                "ml_roi_12h": round(ml_roi12, 2),
                "rules_roi_12h": round(ru_roi12, 2),
            }
        )

        oos_ts.append(ts[te_mask])
        oos_p4.append(p4)
        oos_p12.append(p12)
        oos_r12.append(r12)
        oos_y4_win.append(y4_win[te_mask])
        oos_y4_roi.append(y4_roi[te_mask])
        oos_y12_win.append(y12_win[te_mask])
        oos_y12_roi.append(y12_roi[te_mask])
        oos_rule4.append(rule4[te_mask])
        oos_rule12.append(rule12[te_mask])

    if not oos_ts:
        report = {
            "status": "insufficient_data",
            "validated": False,
            "reason": "Not enough time span for 3 walk-forward folds with 12h embargo.",
            "trained_at": int(time.time()),
            "dataset_rows": rows,
            "dataset_items": int(ds["items"]),
            "elapsed_sec": round(time.perf_counter() - t0, 2),
        }
        (out_dir / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        return report

    all_ts = np.concatenate(oos_ts)
    all_p4 = np.concatenate(oos_p4)
    all_p12 = np.concatenate(oos_p12)
    all_r12 = np.concatenate(oos_r12)
    all_y4_w = np.concatenate(oos_y4_win)
    all_y4_r = np.concatenate(oos_y4_roi)
    all_y12_w = np.concatenate(oos_y12_win)
    all_y12_r = np.concatenate(oos_y12_roi)
    all_ru4 = np.concatenate(oos_rule4)
    all_ru12 = np.concatenate(oos_rule12)

    overall_auc4 = _roc_auc_score(all_y4_w, all_p4)
    overall_auc12 = _roc_auc_score(all_y12_w, all_p12)
    rules_auc4 = _roc_auc_score(all_y4_w, all_ru4)
    rules_auc12 = _roc_auc_score(all_y12_w, all_ru12)

    ml_w4, ml_roi4, _ = _eval_top_k_cycles(all_ts, all_p4, all_y4_r, all_y4_w, step_hours=4)
    ru_w4, ru_roi4, _ = _eval_top_k_cycles(all_ts, all_ru4, all_y4_r, all_y4_w, step_hours=4)

    ml_s12 = all_p12 * np.maximum(all_r12, 0.1)
    ml_w12, ml_roi12, ml_cycles_12 = _eval_top_k_cycles(all_ts, ml_s12, all_y12_r, all_y12_w, step_hours=12)
    ru_w12, ru_roi12, ru_cycles_12 = _eval_top_k_cycles(all_ts, all_ru12, all_y12_r, all_y12_w, step_hours=12)

    # Build out-of-sample 25M GP simulated overnight equity curve (60% capital deployed per 12h cycle)
    start_gp = 25_000_000.0
    ml_eq = start_gp
    ru_eq = start_gp
    ru_map = {t: r for t, r in ru_cycles_12}
    equity_curve: list[dict[str, Any]] = [{"ts": int(all_ts.min()), "ml_gp": int(start_gp), "rules_gp": int(start_gp)}]
    for t, r_ml in ml_cycles_12:
        r_ru = ru_map.get(t, 0.0)
        # Conservative realistic deployment: 60% of cash stack fills across 8 overnight slots
        ml_eq = max(1_000_000.0, ml_eq * (1.0 + (r_ml / 100.0) * 0.60))
        ru_eq = max(1_000_000.0, ru_eq * (1.0 + (r_ru / 100.0) * 0.60))
        equity_curve.append({"ts": int(t), "ml_gp": int(round(ml_eq)), "rules_gp": int(round(ru_eq))})

    # Safety Gate: ML boost only activates when out-of-sample validation clearly clears baseline
    validated = bool(
        overall_auc4 >= 0.54
        and overall_auc12 >= 0.54
        and (ml_roi4 >= ru_roi4 or ml_roi12 >= ru_roi12)
    )

    # Fit final production models on 100% of clean dataset (last 10% held for early stopping)
    ts_sorted = np.sort(ts)
    final_val_cut = int(ts_sorted[int(len(ts_sorted) * 0.90)])
    final_fit = ts < final_val_cut - embargo_sec
    final_val = ts >= final_val_cut
    if int(np.sum(final_fit)) < 500:
        final_fit = np.ones(len(ts), dtype=bool)
        final_val = np.zeros(len(ts), dtype=bool)

    Xf, Xv = X[final_fit], (X[final_val] if np.any(final_val) else None)
    prod_4h = _fit_lgb_binary(Xf, y4_win[final_fit], Xv, y4_win[final_val] if Xv is not None else None)
    prod_12h_cls = _fit_lgb_binary(Xf, y12_win[final_fit], Xv, y12_win[final_val] if Xv is not None else None)
    prod_12h_reg = _fit_lgb_reg(Xf, y12_roi[final_fit], Xv, y12_roi[final_val] if Xv is not None else None)

    # Atomic save of models
    prod_4h.save_model(str(out_dir / "model_4h_cls.txt"))
    prod_12h_cls.save_model(str(out_dir / "model_12h_cls.txt"))
    prod_12h_reg.save_model(str(out_dir / "model_12h_reg.txt"))

    # Normalized combined feature importances (gain)
    g4 = prod_4h.feature_importance(importance_type="gain").astype(np.float64)
    g12 = prod_12h_cls.feature_importance(importance_type="gain").astype(np.float64)
    g4 = g4 / max(float(g4.sum()), 1e-9)
    g12 = g12 / max(float(g12.sum()), 1e-9)
    combined_imp = 0.5 * (g4 + g12)
    order = np.argsort(-combined_imp)
    feature_importances = [
        {"feature": FEATURE_NAMES[int(i)], "importance_pct": round(float(combined_imp[int(i)]) * 100.0, 1)}
        for i in order[:10]
    ]

    elapsed_sec = round(time.perf_counter() - t0, 2)
    report = {
        "status": "ready",
        "validated": validated,
        "validation_reason": (
            "Out-of-sample walk-forward validation passed — ML Boost eligible."
            if validated
            else "Out-of-sample lift did not beat baseline — ML running in advisory-only mode."
        ),
        "trained_at": int(time.time()),
        "elapsed_sec": elapsed_sec,
        "dataset_rows": rows,
        "dataset_items": int(ds["items"]),
        "lookback_days": lookback_days,
        "embargo_hours": 12,
        "summary": {
            "auc_4h": round(overall_auc4, 4),
            "rules_auc_4h": round(rules_auc4, 4),
            "auc_12h": round(overall_auc12, 4),
            "rules_auc_12h": round(rules_auc12, 4),
            "ml_win_4h": round(ml_w4, 1),
            "rules_win_4h": round(ru_w4, 1),
            "ml_roi_4h": round(ml_roi4, 2),
            "rules_roi_4h": round(ru_roi4, 2),
            "ml_win_12h": round(ml_w12, 1),
            "rules_win_12h": round(ru_w12, 1),
            "ml_roi_12h": round(ml_roi12, 2),
            "rules_roi_12h": round(ru_roi12, 2),
            "sim_start_gp": int(start_gp),
            "sim_ml_end_gp": int(round(ml_eq)),
            "sim_rules_end_gp": int(round(ru_eq)),
            "sim_cycles_12h": len(ml_cycles_12),
        },
        "folds": folds_summary,
        "equity_curve": equity_curve,
        "feature_importances": feature_importances,
    }
    (out_dir / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Train OSRS Flip Terminal LightGBM models + walk-forward backtest")
    parser.add_argument("--db", required=True, help="Path to SQLite database")
    parser.add_argument("--out", required=True, help="Output directory for model files & report.json")
    parser.add_argument("--days", type=int, default=30, help="Lookback days of candles_1h")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)-7s | %(message)s")
    report = run_training_pipeline(Path(args.db), Path(args.out), lookback_days=args.days)
    print(
        json.dumps(
            {
                "status": report["status"],
                "validated": report["validated"],
                "rows": report.get("dataset_rows", 0),
                "elapsed_sec": report.get("elapsed_sec", 0),
                "summary": report.get("summary"),
            }
        )
    )


if __name__ == "__main__":
    main()
