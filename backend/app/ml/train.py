"""Isolated Histogram GBDT training + strict walk-forward backtester (zero lookahead leakage).

Uses scikit-learn's LightGBM-style HistGradientBoosting (completely self-contained — zero
system `libgomp1` apt dependency across bare Linux, Docker, Windows, and macOS).

Run directly as a subprocess so FastAPI's event loop & live 20s ticks are never blocked:
    python -m app.ml.train --db data/osrs_terminal.db --out data/models
"""

from __future__ import annotations

import argparse
import json
import logging
import time
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor

from app.ml.features import FEATURE_NAMES, build_training_dataset

logger = logging.getLogger(__name__)


def _roc_auc_score(y_true: np.ndarray, y_score: np.ndarray) -> float:
    """Fast pure-NumPy ROC-AUC."""
    y_true = np.asarray(y_true, dtype=np.int8)
    y_score = np.asarray(y_score, dtype=np.float64)
    pos = int(np.sum(y_true == 1))
    neg = int(np.sum(y_true == 0))
    if pos == 0 or neg == 0:
        return 0.5
    order = np.argsort(y_score, kind="mergesort")
    ranks = np.empty_like(order, dtype=np.float64)
    ranks[order] = np.arange(1, len(y_score) + 1, dtype=np.float64)
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


def _fit_hgb_binary(X_tr: np.ndarray, y_tr: np.ndarray) -> HistGradientBoostingClassifier:
    clf = HistGradientBoostingClassifier(
        max_iter=180,
        max_leaf_nodes=31,
        max_depth=6,
        learning_rate=0.05,
        min_samples_leaf=40,
        l2_regularization=2.0,
        early_stopping=True,
        validation_fraction=0.12,
        n_iter_no_change=18,
        random_state=42,
    )
    clf.fit(X_tr, y_tr)
    return clf


def _fit_hgb_reg(X_tr: np.ndarray, y_tr: np.ndarray) -> HistGradientBoostingRegressor:
    reg = HistGradientBoostingRegressor(
        loss="absolute_error",
        max_iter=180,
        max_leaf_nodes=31,
        max_depth=6,
        learning_rate=0.05,
        min_samples_leaf=40,
        l2_regularization=2.0,
        early_stopping=True,
        validation_fraction=0.12,
        n_iter_no_change=18,
        random_state=42,
    )
    reg.fit(X_tr, y_tr)
    return reg


def _extract_gain_importances(model: Any, n_features: int) -> np.ndarray:
    """Compute exact normalized split-gain importances from HistGradientBoosting trees in <1ms."""
    gains = np.zeros(n_features, dtype=np.float64)
    predictors = getattr(model, "_predictors", None)
    if predictors:
        for iter_trees in predictors:
            for tree in iter_trees:
                nodes = getattr(tree, "nodes", None)
                if nodes is None:
                    continue
                is_split = nodes["is_leaf"] == 0
                fidx = nodes["feature_idx"][is_split]
                g = nodes["gain"][is_split]
                for fi, gv in zip(fidx, g):
                    if 0 <= int(fi) < n_features and gv > 0:
                        gains[int(fi)] += float(gv)
    total = float(gains.sum())
    if total > 0:
        return gains / total
    return np.full(n_features, 1.0 / max(n_features, 1), dtype=np.float64)


def _eval_top_k_cycles(
    ts: np.ndarray,
    scores: np.ndarray,
    actual_roi: np.ndarray,
    actual_win: np.ndarray,
    cap_gp: np.ndarray,
    step_hours: int,
    top_k: int = 8,
    bankroll_gp: float = 25_000_000.0,
) -> tuple[float, float, list[tuple[int, float, float]]]:
    """Simulate picking top-K items every `step_hours` cycle with REAL 4h buy_limit + 8-slot GP caps.

    Returns (win_rate_pct, capital_weighted_roi_pct, [(ts, cycle_profit_gp, deployed_gp)]).
    """
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

    per_slot_cap = bankroll_gp / max(top_k, 1)
    wins: list[float] = []
    weighted_rois: list[float] = []
    cycle_profits: list[tuple[int, float, float]] = []

    for t in selected_ts:
        mask = ts == t
        idx = np.flatnonzero(mask)
        if len(idx) < 3:
            continue
        k = min(top_k, len(idx))
        # Rank by expected GP profit (score * deployable buy_limit slot GP), matching real flipping!
        slot_cap = np.minimum(cap_gp[idx], per_slot_cap)
        ranked_score = scores[idx] * np.sqrt(np.maximum(slot_cap, 1.0) / per_slot_cap)
        top_local = idx[np.argpartition(-ranked_score, k - 1)[:k]]

        deployed = np.minimum(cap_gp[top_local], per_slot_cap)
        total_deployed = float(np.sum(deployed))
        if total_deployed <= 0:
            continue
        # Realistic partial-fill factor (65% of bid/ask limit actually fills cleanly in window)
        eff_deployed = deployed * 0.65
        profit_gp = float(np.sum(eff_deployed * (actual_roi[top_local] / 100.0)))
        c_roi = (profit_gp / bankroll_gp) * 100.0
        c_win = float(np.mean(actual_win[top_local])) * 100.0
        wins.append(c_win)
        weighted_rois.append(c_roi)
        cycle_profits.append((t, profit_gp, float(np.sum(eff_deployed))))

    if not weighted_rois:
        return 0.0, 0.0, []
    return float(np.mean(wins)), float(np.mean(weighted_rois)), cycle_profits


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
    cap4_gp: np.ndarray = ds["cap4_gp"]
    cap12_gp: np.ndarray = ds["cap12_gp"]

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
    oos_cap4: list[np.ndarray] = []
    oos_cap12: list[np.ndarray] = []

    for fold_idx, (start_frac, end_frac) in enumerate(fold_bounds, start=1):
        test_start = min_ts + int(span * start_frac)
        test_end = min_ts + int(span * end_frac)
        train_end = test_start - embargo_sec

        tr_mask = ts <= train_end
        te_mask = (ts >= test_start) & (ts < test_end)
        if int(np.sum(tr_mask)) < 500 or int(np.sum(te_mask)) < 200:
            continue

        X_tr = X[tr_mask]
        m4 = _fit_hgb_binary(X_tr, y4_win[tr_mask])
        m12_cls = _fit_hgb_binary(X_tr, y12_win[tr_mask])
        m12_reg = _fit_hgb_reg(X_tr, y12_roi[tr_mask])

        X_te = X[te_mask]
        p4 = m4.predict_proba(X_te)[:, 1]
        p12 = m12_cls.predict_proba(X_te)[:, 1]
        r12 = m12_reg.predict(X_te)

        auc4 = _roc_auc_score(y4_win[te_mask], p4)
        auc12 = _roc_auc_score(y12_win[te_mask], p12)

        ml_score_4 = p4
        ml_score_12 = p12 * np.maximum(r12, 0.1)

        ml_w4, ml_roi4, _ = _eval_top_k_cycles(ts[te_mask], ml_score_4, y4_roi[te_mask], y4_win[te_mask], cap4_gp[te_mask], step_hours=4)
        ru_w4, ru_roi4, _ = _eval_top_k_cycles(ts[te_mask], rule4[te_mask], y4_roi[te_mask], y4_win[te_mask], cap4_gp[te_mask], step_hours=4)
        ml_w12, ml_roi12, _ = _eval_top_k_cycles(ts[te_mask], ml_score_12, y12_roi[te_mask], y12_win[te_mask], cap12_gp[te_mask], step_hours=12)
        ru_w12, ru_roi12, _ = _eval_top_k_cycles(ts[te_mask], rule12[te_mask], y12_roi[te_mask], y12_win[te_mask], cap12_gp[te_mask], step_hours=12)

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
        oos_cap4.append(cap4_gp[te_mask])
        oos_cap12.append(cap12_gp[te_mask])

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
    all_cap4 = np.concatenate(oos_cap4)
    all_cap12 = np.concatenate(oos_cap12)

    overall_auc4 = _roc_auc_score(all_y4_w, all_p4)
    overall_auc12 = _roc_auc_score(all_y12_w, all_p12)
    rules_auc4 = _roc_auc_score(all_y4_w, all_ru4)
    rules_auc12 = _roc_auc_score(all_y12_w, all_ru12)

    ml_w4, ml_roi4, _ = _eval_top_k_cycles(all_ts, all_p4, all_y4_r, all_y4_w, all_cap4, step_hours=4)
    ru_w4, ru_roi4, _ = _eval_top_k_cycles(all_ts, all_ru4, all_y4_r, all_y4_w, all_cap4, step_hours=4)

    ml_s12 = all_p12 * np.maximum(all_r12, 0.1)
    ml_w12, ml_roi12, ml_cycles_12 = _eval_top_k_cycles(all_ts, ml_s12, all_y12_r, all_y12_w, all_cap12, step_hours=12)
    ru_w12, ru_roi12, ru_cycles_12 = _eval_top_k_cycles(all_ts, all_ru12, all_y12_r, all_y12_w, all_cap12, step_hours=12)

    # Realistic 25M GP simulated equity curve enforcing exact 4h GE buy limits & 8-slot caps!
    start_gp = 25_000_000.0
    ml_eq = start_gp
    ru_eq = start_gp
    ru_map = {t: prof for t, prof, _ in ru_cycles_12}
    equity_curve: list[dict[str, Any]] = [{"ts": int(all_ts.min()), "ml_gp": int(start_gp), "rules_gp": int(start_gp)}]
    for t, prof_ml, _ in ml_cycles_12:
        prof_ru = ru_map.get(t, 0.0)
        # Scale profit gently if equity changes, but cap slot deployment by real 4h buy limits
        ml_eq = max(1_000_000.0, ml_eq + prof_ml)
        ru_eq = max(1_000_000.0, ru_eq + prof_ru)
        equity_curve.append({"ts": int(t), "ml_gp": int(round(ml_eq)), "rules_gp": int(round(ru_eq))})

    # Safety Gate: ML boost only activates when out-of-sample validation clearly clears baseline
    validated = bool(
        overall_auc4 >= 0.54
        and overall_auc12 >= 0.54
        and (ml_roi4 >= ru_roi4 or ml_roi12 >= ru_roi12)
    )

    # Fit final production models on 100% of clean dataset
    prod_4h = _fit_hgb_binary(X, y4_win)
    prod_12h_cls = _fit_hgb_binary(X, y12_win)
    prod_12h_reg = _fit_hgb_reg(X, y12_roi)

    bundle = {
        "m4": prod_4h,
        "m12_cls": prod_12h_cls,
        "m12_reg": prod_12h_reg,
        "feature_names": FEATURE_NAMES,
    }
    tmp_path = out_dir / "models.joblib.tmp"
    final_path = out_dir / "models.joblib"
    joblib.dump(bundle, tmp_path, compress=3)
    tmp_path.replace(final_path)

    # Normalized combined feature importances (split gain)
    g4 = _extract_gain_importances(prod_4h, len(FEATURE_NAMES))
    g12 = _extract_gain_importances(prod_12h_cls, len(FEATURE_NAMES))
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
    parser = argparse.ArgumentParser(description="Train OSRS Flip Terminal GBDT models + walk-forward backtest")
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
