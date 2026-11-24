import { useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Brain,
  Check,
  Copy,
  Flame,
  Layers,
  LayoutGrid,
  LayoutList,
  RefreshCw,
  Shield,
  Sparkles,
  Star,
  Zap,
} from 'lucide-react';
import { BadgePill, STRATEGY_META } from '../components/BadgePill';
import { InfoTooltip } from '../components/InfoTooltip';
import { MLSignalBadge } from '../components/MLSignalBadge';
import { TradeCallCard } from '../components/TradeCallCard';
import type { StrategyMode, TradeCall, TradeCallsResponse } from '../types';
import { formatGp, formatSignedGp, wikiIconUrl } from '../utils/format';

const MODE_OPTIONS: { key: StrategyMode; label: string; desc: string }[] = [
  { key: 'auto_mix', label: 'Auto-Mix', desc: 'Best blend for your bank' },
  { key: 'fast_flip', label: 'Fast Flips', desc: 'High-volume quick fills' },
  { key: 'overnight', label: 'Big Margin', desc: 'High profit / 4h limit' },
  { key: 'dump_sniper', label: 'Dump Sniper', desc: 'Crash rebounds (hourly σ)' },
  { key: 'alch_floor', label: 'Alch Floor', desc: 'Protected near High-Alch' },
];

interface Props {
  cashStack: number;
  mode: StrategyMode;
  onChangeMode: (m: StrategyMode) => void;
  mlBoost: boolean;
  onToggleMlBoost: () => void;
  tradeData: TradeCallsResponse | null;
  starredIds: Set<number>;
  loading: boolean;
  onRefresh: () => void;
  onToggleWatch: (item: { id: number; name: string; low?: number | null }) => Promise<void>;
  onOpenChart: (itemId: number) => void;
  onOpenMlLab: () => void;
}

export function CommandCenter({
  cashStack,
  mode,
  onChangeMode,
  mlBoost,
  onToggleMlBoost,
  tradeData,
  starredIds,
  loading,
  onRefresh,
  onToggleWatch,
  onOpenChart,
  onOpenMlLab,
}: Props) {
  const [view, setView] = useState<'rows' | 'grid'>('rows');

  return (
    <div className="space-y-5">
      {/* Clean Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-100">Trade Calls</h1>
          <p className="mt-0.5 text-xs text-zinc-500">
            Sized for <strong className="text-zinc-300 font-mono-num">{formatGp(cashStack, true)} gp</strong> · Exact 2% GE tax &amp; 5M cap deducted
          </p>
        </div>
      </div>

      {/* Mode Pills + View Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-white/[0.07] bg-[#0a0a0e] p-1">
          {MODE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => onChangeMode(opt.key)}
              title={opt.desc}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                mode === opt.key
                  ? 'bg-white/[0.11] text-white shadow-xs'
                  : 'text-zinc-500 hover:text-zinc-200'
              }`}
            >
              {opt.key === 'auto_mix' && <Sparkles className="h-3.5 w-3.5 text-amber-400" />}
              {opt.key === 'fast_flip' && <Zap className="h-3.5 w-3.5 text-emerald-400" />}
              {opt.key === 'overnight' && <Layers className="h-3.5 w-3.5 text-zinc-300" />}
              {opt.key === 'dump_sniper' && <Flame className="h-3.5 w-3.5 text-rose-400" />}
              {opt.key === 'alch_floor' && <Shield className="h-3.5 w-3.5 text-amber-300" />}
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* Guardrailed ML Boost Toggle */}
          {tradeData?.ml_meta?.loaded ? (
            <button
              onClick={onToggleMlBoost}
              title={
                tradeData.ml_meta.validated
                  ? 'Toggle LightGBM ML ranking boost (validated out-of-sample)'
                  : 'ML model is in advisory-only mode (did not clear walk-forward gate)'
              }
              className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                tradeData.ml_meta.boost_active
                  ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-300'
                  : 'border-white/[0.08] bg-[#0a0a0e] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Brain className="h-3.5 w-3.5" />
              <span>
                {!tradeData.ml_meta.validated
                  ? 'ML: Advisory'
                  : mlBoost
                    ? 'ML Boost: On'
                    : 'ML Boost: Off'}
              </span>
            </button>
          ) : (
            <button
              onClick={onOpenMlLab}
              title="Open ML & Backtest lab to train LightGBM models"
              className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#0a0a0e] px-2.5 py-1.5 text-[11px] font-medium text-zinc-500 hover:border-white/[0.18] hover:text-zinc-300 transition"
            >
              <Brain className="h-3.5 w-3.5" />
              <span>Train ML</span>
            </button>
          )}

          <div className="hidden md:flex items-center rounded-xl border border-white/[0.07] bg-[#0a0a0e] p-0.5">
            <button
              onClick={() => setView('rows')}
              className={`rounded-lg p-1.5 transition ${
                view === 'rows' ? 'bg-white/[0.11] text-white' : 'text-zinc-500 hover:text-zinc-200'
              }`}
              title="Wide Action Rows"
            >
              <LayoutList className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setView('grid')}
              className={`rounded-lg p-1.5 transition ${
                view === 'grid' ? 'bg-white/[0.11] text-white' : 'text-zinc-500 hover:text-zinc-200'
              }`}
              title="Card Grid"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#0b0b0f] px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-white/[0.06] hover:text-white transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Content */}
      {!tradeData || tradeData.calls.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.07] bg-[#0b0b0f] p-14 text-center text-sm text-zinc-500">
          {loading
            ? 'Calculating live OSRS flipping opportunities...'
            : 'No items matched this strict filter right now. Try Auto-Mix or adjust your Cash Stack in the top bar.'}
        </div>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {tradeData.calls.map((call, idx) => (
            <TradeCallCard
              key={call.item_id}
              call={call}
              rank={idx + 1}
              isWatched={starredIds.has(call.item_id)}
              onToggleWatch={onToggleWatch}
              onOpenChart={onOpenChart}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-white/[0.08] bg-[#0a0a0e]">
          {/* Desktop Column Headers */}
          <div className="hidden lg:grid grid-cols-[2.1fr_1.7fr_1.1fr_1.2fr_0.9fr_auto] items-center gap-4 rounded-t-2xl border-b border-white/[0.06] bg-[#08080b] px-5 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            <span className="flex items-center gap-1">
              Item & Signal
              <InfoTooltip
                title="Strategy & AI Signal"
                text="Each item shows its best strategy tag (FAST, DUMP, ALCH, MARGIN) plus the AI 4h post-tax win probability badge."
                align="left"
              />
            </span>
            <span>Action (Click Price to Copy)</span>
            <span className="text-right">Net Profit / ROI</span>
            <span className="flex items-center gap-1">
              1h Buy / Sell Flow
              <InfoTooltip
                title="1h Buy vs. Sell Flow (OFI)"
                text="Green = instant buys (players buying at high). Red = instant sells (players dumping into low). Balanced flow fills fastest; heavy green means rising demand."
              />
            </span>
            <span className="flex items-center justify-end gap-1">
              Fill & Safety
              <InfoTooltip
                title="Estimated Fill & Safety Score"
                text="Safety (0–100) grades liquidity, quote freshness, and anti-trap stability. Fill time estimates how long your exact quantity takes to buy + sell."
                align="right"
              />
            </span>
            <span className="text-right w-[158px]">Watch / Chart</span>
          </div>

          <div className="divide-y divide-white/[0.05]">
            {tradeData.calls.map((call, idx) => (
              <TradeCallRow
                key={call.item_id}
                call={call}
                rank={idx + 1}
                isWatched={starredIds.has(call.item_id)}
                onToggleWatch={onToggleWatch}
                onOpenChart={onOpenChart}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TradeCallRow({
  call,
  rank,
  isWatched,
  onToggleWatch,
  onOpenChart,
}: {
  call: TradeCall;
  rank: number;
  isWatched: boolean;
  onToggleWatch: (item: { id: number; name: string; low?: number | null }) => Promise<void>;
  onOpenChart: (itemId: number) => void;
}) {
  const [copied, setCopied] = useState<'buy' | 'sell' | null>(null);
  const [toggling, setToggling] = useState(false);

  const meta = STRATEGY_META[call.strategy] || STRATEGY_META.auto_mix;
  const isDump = call.strategy === 'dump_sniper' && Boolean(call.dump_details);
  const dumpDrop = call.dump_details?.drop_pct ?? 0;
  const dumpLabel = isDump ? `DUMP ${dumpDrop.toFixed(1)}%` : meta.label;
  const dumpDetails = isDump && call.dump_details
    ? [
        {
          label: `${call.dump_details.timeframe} Hourly Avg`,
          value: `${formatGp(call.dump_details.baseline_vwap)} gp`,
        },
        {
          label: 'Drop vs Avg',
          value: `${call.dump_details.drop_pct.toFixed(1)}%`,
          highlight: 'rose' as const,
        },
        {
          label: 'Bounce Outlook',
          value: call.dump_details.bounce_outlook,
          highlight:
            call.dump_details.bounce_outlook === 'HIGH'
              ? ('emerald' as const)
              : call.dump_details.bounce_outlook === 'MEDIUM'
                ? ('amber' as const)
                : ('rose' as const),
        },
        {
          label: 'Sell Target Basis',
          value: call.dump_details.target_basis,
        },
      ]
    : undefined;
  const b = call.vol_1h_high ?? 0;
  const s = call.vol_1h_low ?? 0;
  const tot = b + s;
  const bPct = tot > 0 ? Math.round((b / tot) * 100) : 50;

  const copyPrice = (kind: 'buy' | 'sell', val: number) => {
    navigator.clipboard.writeText(String(val));
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1100);
  };

  return (
    <div className="group px-4 py-3.5 lg:px-5 transition-colors hover:bg-white/[0.025]">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[2.1fr_1.7fr_1.1fr_1.2fr_0.9fr_auto] lg:items-center lg:gap-4">
        {/* 1. Item & Strategy */}
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-5 text-center text-[11px] font-mono-num text-zinc-600 shrink-0">{rank}</span>
          <button
            type="button"
            onClick={() => onOpenChart(call.item_id)}
            title="Open item chart & order ticket"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-[#121217] transition hover:border-amber-400/40 hover:bg-[#191922]"
          >
            {call.icon ? (
              <img src={wikiIconUrl(call.icon)} alt="" className="h-6 w-6 object-contain" loading="lazy" />
            ) : (
              <Sparkles className="h-4 w-4 text-amber-400" />
            )}
          </button>
          <div className="min-w-0">
            {/* Line 1: Clean dedicated Item Name */}
            <button
              type="button"
              onClick={() => onOpenChart(call.item_id)}
              title="Open item chart & order ticket"
              className="group/item inline-flex max-w-full items-center gap-1 truncate text-sm font-semibold text-zinc-100 hover:text-amber-300 hover:underline underline-offset-2 transition"
            >
              <span className="truncate">{call.item_name}</span>
              <span className="text-[10px] text-amber-400/0 transition group-hover/item:text-amber-400">↗</span>
            </button>

            {/* Line 2: Uniform Badge Strip + Compact Cost */}
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <BadgePill
                label={dumpLabel}
                cls={meta.cls}
                tooltipTitle={meta.title}
                tooltipText={
                  isDump && call.dump_details?.bounce_reason ? call.dump_details.bounce_reason : meta.desc
                }
                icon={isDump ? <Flame className="h-2.5 w-2.5 text-rose-400" /> : undefined}
                details={dumpDetails}
              />
              {call.ml && (
                <MLSignalBadge ml={call.ml} horizon={call.strategy === 'overnight' ? '12h' : '4h'} />
              )}
              {call.is_tax_exempt && (
                <BadgePill
                  label="0% TAX"
                  cls="border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
                  tooltipTitle="0% GE Tax Exempt"
                  tooltipText="Official OSRS GE tax-exempt item (e.g. Bonds, Lobsters, low-tier teleports). You keep 100% of the spread."
                />
              )}
              {call.is_mega_rare_capped && (
                <BadgePill
                  label="5M CAP"
                  cls="border-amber-500/25 bg-amber-500/10 text-amber-300"
                  tooltipTitle="5M GP Tax Cap (Mega-Rare)"
                  tooltipText="Items ≥ 250M gp cap GE tax at 5,000,000 gp per unit instead of a full 2%, reducing your effective tax rate."
                />
              )}
            </div>
          </div>
        </div>

        {/* 2. Action: BUY Qty @ Price -> SELL Price */}
        <div className="flex items-center gap-2 font-mono-num">
          <button
            onClick={() => copyPrice('buy', call.buy_price)}
            className="flex flex-col rounded-lg border border-white/[0.06] bg-[#07070a] px-2.5 py-1.5 text-left hover:border-white/[0.16] transition"
            title={`Copy exact Buy price · Total cost ${formatGp(call.capital_required)} gp`}
          >
            <span className="font-sans text-[9px] uppercase tracking-wider text-zinc-500 whitespace-nowrap">
              Buy {call.quantity.toLocaleString()}x · <span className="text-zinc-300 font-mono-num">{formatGp(call.capital_required, true)}</span>
            </span>
            <span className="flex items-center gap-1 text-xs font-bold text-zinc-100">
              {formatGp(call.buy_price)}
              {copied === 'buy' ? (
                <Check className="h-3 w-3 text-emerald-400" />
              ) : (
                <Copy className="h-2.5 w-2.5 text-zinc-600" />
              )}
            </span>
          </button>

          <ArrowRight className="h-3.5 w-3.5 text-zinc-700 shrink-0" />

          <button
            onClick={() => copyPrice('sell', call.sell_price)}
            className="flex flex-col rounded-lg border border-white/[0.06] bg-[#07070a] px-2.5 py-1.5 text-left hover:border-amber-400/30 transition"
            title="Copy exact Sell price"
          >
            <span className="font-sans text-[9px] uppercase tracking-wider text-zinc-500">Sell Target</span>
            <span className="flex items-center gap-1 text-xs font-bold text-amber-300">
              {formatGp(call.sell_price)}
              {copied === 'sell' ? (
                <Check className="h-3 w-3 text-emerald-400" />
              ) : (
                <Copy className="h-2.5 w-2.5 text-zinc-600" />
              )}
            </span>
          </button>
        </div>

        {/* 3. Net Profit & ROI */}
        <div className="flex items-baseline justify-between lg:flex-col lg:items-end font-mono-num">
          <span className="text-sm font-bold text-emerald-400">
            {formatSignedGp(call.est_net_profit, true)}
          </span>
          <span className="text-[11px] text-zinc-500">
            {call.net_roi_pct.toFixed(1)}% · {formatGp(call.est_gp_per_hour, true)}/hr
          </span>
        </div>

        {/* 4. 1h Buy/Sell Volume Bar */}
        <div className="font-mono-num">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-zinc-200 font-semibold">{call.vol_1h.toLocaleString()}/h</span>
            <span>
              <span className="text-emerald-400">{bPct}%B</span>
              <span className="text-zinc-700">/</span>
              <span className="text-rose-400">{100 - bPct}%S</span>
            </span>
          </div>
          <div className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-rose-500/50">
            <div className="h-full bg-emerald-400" style={{ width: `${bPct}%` }} />
          </div>
        </div>

        {/* 5. Fill & Safety */}
        <div className="flex items-center justify-between lg:flex-col lg:items-end text-xs font-mono-num">
          <span className="font-semibold text-zinc-200">{call.est_fill_label}</span>
          <span
            className={`text-[11px] font-semibold ${
              call.safety_score >= 80
                ? 'text-emerald-400'
                : call.safety_score >= 60
                  ? 'text-amber-400'
                  : 'text-rose-400'
            }`}
          >
            Safety {call.safety_score}
          </span>
        </div>

        {/* 6. Actions */}
        <div className="flex items-center justify-end gap-1.5 lg:w-[158px]">
          <button
            onClick={() => onOpenChart(call.item_id)}
            title="Open full item chart & calculator"
            className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-zinc-900/90 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition"
          >
            <BarChart3 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={async () => {
              setToggling(true);
              try {
                await onToggleWatch({ id: call.item_id, name: call.item_name, low: call.buy_price });
              } finally {
                setToggling(false);
              }
            }}
            disabled={toggling}
            title={isWatched ? 'Unpin from top Watch bar' : 'Pin live price & trend tab to top Watch bar'}
            className={`flex flex-1 lg:flex-initial items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              isWatched
                ? 'border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/20'
                : 'border-white/[0.1] bg-zinc-900 text-zinc-200 hover:border-amber-400/35 hover:text-amber-200'
            }`}
          >
            <Star className={`h-3 w-3 ${isWatched ? 'fill-current' : ''}`} />
            {isWatched ? 'Watching' : 'Watch'}
          </button>
        </div>
      </div>
    </div>
  );
}
