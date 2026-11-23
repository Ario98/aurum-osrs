import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Brain,
  CheckCircle2,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { api } from '../api/client';
import type { MLStatusResponse } from '../types';
import { formatGp } from '../utils/format';
import { InfoTooltip } from './InfoTooltip';

function formatAgo(ts: number | null | undefined): string {
  if (!ts) return 'Never';
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${(diff / 3600).toFixed(1)}h ago`;
  return `${(diff / 86400).toFixed(1)}d ago`;
}

function EquityCurveChart({ points }: { points: Array<{ ts: number; ml_gp: number; rules_gp: number }> }) {
  if (points.length < 2) {
    return (
      <div className="flex h-44 items-center justify-center rounded-xl border border-white/[0.06] bg-[#060608] text-xs text-zinc-500">
        Not enough walk-forward cycles to draw equity curve.
      </div>
    );
  }

  const allVals = points.flatMap((p) => [p.ml_gp, p.rules_gp]);
  const min = Math.min(...allVals);
  const max = Math.max(...allVals, min + 100_000);
  const w = 640;
  const h = 175;
  const padX = 12;
  const padY = 14;

  const toLine = (key: 'ml_gp' | 'rules_gp') =>
    points
      .map((p, i) => {
        const x = padX + (i / (points.length - 1)) * (w - padX * 2);
        const y = h - padY - ((p[key] - min) / (max - min)) * (h - padY * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  const mlLine = toLine('ml_gp');
  const rulesLine = toLine('rules_gp');
  const mlArea = `${padX},${h - padY} ${mlLine} ${w - padX},${h - padY}`;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#060608] p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
            <span className="h-2 w-2 rounded-full bg-emerald-400" /> ML-Boosted Top 8
          </span>
          <span className="flex items-center gap-1.5 text-zinc-400">
            <span className="h-0.5 w-3 bg-zinc-500 inline-block" /> Rules-Only Baseline
          </span>
        </div>
        <span className="tabular-nums text-zinc-500">
          Out-of-sample · 25M start · 60% deployment · Exact 2% GE tax
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-44 w-full overflow-visible">
        <defs>
          <linearGradient id="mlEqGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <polygon points={mlArea} fill="url(#mlEqGrad)" />
        <polyline
          fill="none"
          stroke="#71717a"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          strokeLinecap="round"
          points={rulesLine}
        />
        <polyline
          fill="none"
          stroke="#10b981"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={mlLine}
        />
      </svg>
      <div className="mt-1 flex items-center justify-between text-[10px] tabular-nums text-zinc-500">
        <span>Low: {formatGp(min, true)} gp</span>
        <span>Peak: {formatGp(max, true)} gp</span>
      </div>
    </div>
  );
}

export function MLBacktest({ onModelUpdated }: { onModelUpdated?: () => void }) {
  const [status, setStatus] = useState<MLStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggerMsg, setTriggerMsg] = useState('');
  const [starting, setStarting] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.mlStatus();
      setStatus(res);
      return res;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Poll every 3s while training subprocess is active
  useEffect(() => {
    if (!status?.training_in_progress) return;
    const id = window.setInterval(async () => {
      const next = await fetchStatus();
      if (next && !next.training_in_progress) {
        setTriggerMsg('Training & walk-forward backtest completed!');
        onModelUpdated?.();
      }
    }, 3000);
    return () => window.clearInterval(id);
  }, [status?.training_in_progress, fetchStatus, onModelUpdated]);

  const handleTrain = async () => {
    setStarting(true);
    setTriggerMsg('');
    try {
      const res = await api.mlTrain();
      setTriggerMsg(res.message);
      await fetchStatus();
    } catch (err) {
      setTriggerMsg(err instanceof Error ? err.message : 'Failed to start training');
    } finally {
      setStarting(false);
    }
  };

  if (loading && !status) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-10 text-center text-xs text-zinc-500">
        Loading ML model diagnostics & walk-forward backtest report...
      </div>
    );
  }

  const report = status?.report ?? null;
  const summary = report?.summary;

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-xl border ${
                status?.validated
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                  : status?.loaded
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                    : 'border-white/[0.1] bg-zinc-900 text-zinc-400'
              }`}
            >
              <Brain className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold text-zinc-100">Dual-Horizon GBDT & Walk-Forward Backtest</h2>
                {status?.training_in_progress ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300">
                    <RefreshCw className="h-3 w-3 animate-spin" /> Training Worker Running
                  </span>
                ) : status?.validated ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                    <ShieldCheck className="h-3 w-3" /> Validated · ML Boost Active
                  </span>
                ) : status?.loaded ? (
                  <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                    Advisory Mode Only
                  </span>
                ) : (
                  <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    Not Trained Yet
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                {report?.trained_at
                  ? `Last trained ${formatAgo(report.trained_at)} (${report.elapsed_sec}s) · ${report.dataset_rows.toLocaleString()} item-hours across ${report.dataset_items.toLocaleString()} liquid items · Live inference ${status?.last_inference_ms ?? 0}ms`
                  : 'Trains in an isolated background subprocess on 30d hourly history (auto-retrains daily; zero impact on live 20s ticks).'}
              </p>
            </div>
          </div>

          <button
            onClick={handleTrain}
            disabled={starting || status?.training_in_progress}
            className="flex items-center gap-1.5 rounded-xl bg-zinc-100 px-3.5 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-white disabled:opacity-50"
          >
            {status?.training_in_progress ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5 fill-current" />
            )}
            {status?.training_in_progress ? 'Training...' : 'Retrain & Backtest Now'}
          </button>
        </div>

        {triggerMsg && (
          <div className="mt-3 rounded-xl border border-sky-500/25 bg-sky-500/10 px-3.5 py-2 text-xs text-sky-200">
            {triggerMsg}
          </div>
        )}

        {status?.last_train_error && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
            <span className="font-mono text-[11px] break-all">{status.last_train_error}</span>
          </div>
        )}

        {report?.validation_reason && (
          <div
            className={`mt-3 flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs ${
              report.validated
                ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-200'
                : 'border-amber-500/20 bg-amber-500/5 text-amber-200'
            }`}
          >
            {report.validated ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            )}
            <span>{report.validation_reason}</span>
          </div>
        )}
      </div>

      {/* Empty State when never trained */}
      {!summary ? (
        <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-8 text-center space-y-3">
          <Sparkles className="mx-auto h-7 w-7 text-amber-400" />
          <div className="text-sm font-semibold text-zinc-100">Ready for Walk-Forward Training</div>
          <p className="mx-auto max-w-lg text-xs text-zinc-400 leading-relaxed">
            {report?.reason ||
              'Click "Retrain & Backtest Now" to train 4h Active/Bounce and 12h Overnight Gradient-Boosted models across your 30-day hourly dataset with strict 12-hour embargoed out-of-sample validation.'}
          </p>
        </div>
      ) : (
        <>
          {/* Out-of-Sample Head-to-Head KPI Comparison */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* 4h Active / Bounce */}
            <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  4h Active / Bounce (OOS)
                  <InfoTooltip
                    title="Out-of-Sample (OOS) 4h Test"
                    text="Tested strictly on future days the model never saw during training. Measures how often top-8 picks cleared ≥ +0.5% net profit within 4h after 2% GE tax."
                    align="left"
                  />
                </span>
                <span className="flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-mono font-bold text-emerald-300">
                  AUC {summary.auc_4h.toFixed(3)}
                  <InfoTooltip
                    title="ROC-AUC Score (0.50–1.00)"
                    text="How accurately the model ranks winning flips above losing flips. 0.50 = coin flip, 0.70+ = solid signal, 0.85+ = very strong separation."
                    align="right"
                  />
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs tabular-nums">
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2.5">
                  <div className="text-[10px] text-emerald-300">ML Top-8 Picks</div>
                  <div className="mt-0.5 text-base font-bold text-emerald-300">{summary.ml_win_4h}% win</div>
                  <div className="text-[11px] text-emerald-200/80">
                    {summary.ml_roi_4h >= 0 ? '+' : ''}
                    {summary.ml_roi_4h}% net ROI
                  </div>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-[#060608] p-2.5">
                  <div className="text-[10px] text-zinc-500">Rules Baseline</div>
                  <div className="mt-0.5 text-base font-bold text-zinc-200">{summary.rules_win_4h}% win</div>
                  <div className="text-[11px] text-zinc-400">
                    {summary.rules_roi_4h >= 0 ? '+' : ''}
                    {summary.rules_roi_4h}% net ROI
                  </div>
                </div>
              </div>
            </div>

            {/* 12h Overnight */}
            <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  12h Overnight (OOS)
                </span>
                <span className="rounded-md bg-sky-500/10 px-2 py-0.5 text-[10px] font-mono font-bold text-sky-300">
                  AUC {summary.auc_12h.toFixed(3)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs tabular-nums">
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2.5">
                  <div className="text-[10px] text-emerald-300">ML Top-8 Picks</div>
                  <div className="mt-0.5 text-base font-bold text-emerald-300">{summary.ml_win_12h}% win</div>
                  <div className="text-[11px] text-emerald-200/80">
                    {summary.ml_roi_12h >= 0 ? '+' : ''}
                    {summary.ml_roi_12h}% net ROI
                  </div>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-[#060608] p-2.5">
                  <div className="text-[10px] text-zinc-500">Rules Baseline</div>
                  <div className="mt-0.5 text-base font-bold text-zinc-200">{summary.rules_win_12h}% win</div>
                  <div className="text-[11px] text-zinc-400">
                    {summary.rules_roi_12h >= 0 ? '+' : ''}
                    {summary.rules_roi_12h}% net ROI
                  </div>
                </div>
              </div>
            </div>

            {/* Simulated Equity */}
            <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  Simulated 25M Bankroll
                </span>
                <span className="text-[10px] tabular-nums text-zinc-500">{summary.sim_cycles_12h} × 12h cycles</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs tabular-nums">
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2.5">
                  <div className="text-[10px] text-emerald-300">ML-Boosted</div>
                  <div className="mt-0.5 text-base font-bold text-emerald-300">
                    {formatGp(summary.sim_ml_end_gp, true)}
                  </div>
                  <div className="text-[11px] text-emerald-200/80">
                    {(((summary.sim_ml_end_gp - summary.sim_start_gp) / summary.sim_start_gp) * 100).toFixed(1)}% total
                  </div>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-[#060608] p-2.5">
                  <div className="text-[10px] text-zinc-500">Rules Baseline</div>
                  <div className="mt-0.5 text-base font-bold text-zinc-200">
                    {formatGp(summary.sim_rules_end_gp, true)}
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    {(((summary.sim_rules_end_gp - summary.sim_start_gp) / summary.sim_start_gp) * 100).toFixed(1)}% total
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Equity Curve */}
          {report?.equity_curve && (
            <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-5 space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
                <TrendingUp className="h-4 w-4 text-emerald-400" /> Walk-Forward Out-of-Sample Equity Curve
              </h3>
              <EquityCurveChart points={report.equity_curve} />
            </div>
          )}

          {/* Fold Breakdown + Feature Importances */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Per-Fold Table */}
            <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-zinc-100">Expanding Walk-Forward Folds</h3>
                <span className="flex items-center gap-1 text-[11px] text-zinc-500">
                  12h embargo gap
                  <InfoTooltip
                    title="12-Hour Embargo Gap"
                    text="Skips 12 hours between training and test windows so 12h forward outcomes from the end of training can never leak into the test set."
                    align="right"
                  />
                </span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-white/[0.06] bg-[#060608]">
                <table className="w-full text-left text-xs tabular-nums">
                  <thead className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-zinc-500">
                    <tr>
                      <th className="px-3 py-2">Fold</th>
                      <th className="px-3 py-2 text-right">4h AUC</th>
                      <th className="px-3 py-2 text-right">12h AUC</th>
                      <th className="px-3 py-2 text-right">ML 12h ROI</th>
                      <th className="px-3 py-2 text-right">Rules 12h</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04] text-zinc-300">
                    {(report?.folds || []).map((f) => (
                      <tr key={f.fold}>
                        <td className="px-3 py-2 font-semibold text-zinc-200">Fold {f.fold}</td>
                        <td className="px-3 py-2 text-right text-emerald-300">{f.auc_4h.toFixed(3)}</td>
                        <td className="px-3 py-2 text-right text-sky-300">{f.auc_12h.toFixed(3)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-emerald-400">
                          {f.ml_roi_12h >= 0 ? '+' : ''}
                          {f.ml_roi_12h}%
                        </td>
                        <td className="px-3 py-2 text-right text-zinc-400">
                          {f.rules_roi_12h >= 0 ? '+' : ''}
                          {f.rules_roi_12h}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Top Feature Importances */}
            <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
                  <BarChart3 className="h-4 w-4 text-amber-400" /> Top Signal Drivers (Gain %)
                  <InfoTooltip
                    title="Feature Importance (Gain %)"
                    text="Shows which market signals contributed the most decision power across the model's trees (e.g. spread_pct = live bid/ask spread, zscore_24h = drop vs 24h average)."
                    align="left"
                  />
                </h3>
                <span className="text-[11px] text-zinc-500">21 causal features</span>
              </div>
              <div className="space-y-2">
                {(report?.feature_importances || []).map((fi) => (
                  <div key={fi.feature} className="space-y-1 text-xs">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-mono text-zinc-300">{fi.feature}</span>
                      <span className="tabular-nums text-zinc-400">{fi.importance_pct}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-400"
                        style={{ width: `${Math.min(100, fi.importance_pct * 3.5)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
