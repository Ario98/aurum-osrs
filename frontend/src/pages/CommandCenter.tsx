import { useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Check,
  Copy,
  Flame,
  Layers,
  LayoutGrid,
  LayoutList,
  Play,
  RefreshCw,
  Shield,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react';
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

const STRATEGY_PILL: Record<string, { label: string; cls: string }> = {
  fast_flip: { label: 'FAST', cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  overnight: { label: 'MARGIN', cls: 'text-zinc-300 bg-white/[0.06] border-white/[0.1]' },
  dump_sniper: { label: 'DUMP', cls: 'text-rose-400 bg-rose-500/10 border-rose-500/25' },
  alch_floor: { label: 'ALCH', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/20' },
  auto_mix: { label: 'CALL', cls: 'text-zinc-300 bg-white/[0.06] border-white/[0.1]' },
};

interface Props {
  cashStack: number;
  mode: StrategyMode;
  onChangeMode: (m: StrategyMode) => void;
  tradeData: TradeCallsResponse | null;
  slotsFull: boolean;
  loading: boolean;
  onRefresh: () => void;
  onStartFlip: (call: TradeCall) => Promise<void>;
  onOpenChart: (itemId: number) => void;
}

export function CommandCenter({
  cashStack,
  mode,
  onChangeMode,
  tradeData,
  slotsFull,
  loading,
  onRefresh,
  onStartFlip,
  onOpenChart,
}: Props) {
  const [view, setView] = useState<'rows' | 'grid'>('rows');

  return (
    <div className="space-y-5">
      {/* Clean Header & KPI Strip */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-100">Trade Calls</h1>
          <p className="mt-0.5 text-xs text-zinc-500">
            Sized for <strong className="text-zinc-300 font-mono-num">{formatGp(cashStack, true)} gp</strong> · Exact 2% GE tax & 5M cap deducted
          </p>
        </div>

        {tradeData && (
          <div className="flex flex-wrap items-center gap-6 text-xs font-mono-num">
            <div>
              <div className="text-[10px] font-sans uppercase tracking-wider text-zinc-500">Batch Profit</div>
              <div className="text-base font-bold text-emerald-400">
                {formatSignedGp(tradeData.summary.est_batch_profit, true)}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-sans uppercase tracking-wider text-zinc-500">Est. Potential</div>
              <div className="text-base font-bold text-zinc-100 flex items-center gap-1">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                {formatGp(tradeData.summary.est_combined_gp_per_hour, true)}/hr
              </div>
            </div>
            <div>
              <div className="text-[10px] font-sans uppercase tracking-wider text-zinc-500">Capital Used</div>
              <div className="text-base font-semibold text-zinc-300">
                {formatGp(tradeData.summary.allocated_capital, true)}
              </div>
            </div>
          </div>
        )}
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
              onStartFlip={onStartFlip}
              onOpenChart={onOpenChart}
              disabledStart={slotsFull}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a0a0e]">
          {/* Desktop Column Headers */}
          <div className="hidden lg:grid grid-cols-[2.1fr_1.7fr_1.1fr_1.2fr_0.9fr_auto] items-center gap-4 border-b border-white/[0.06] bg-[#08080b] px-5 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            <span>Item & Signal</span>
            <span>Action (Click Price to Copy)</span>
            <span className="text-right">Net Profit / ROI</span>
            <span>1h Buy / Sell Flow</span>
            <span className="text-right">Fill & Safety</span>
            <span className="text-right w-[158px]">Trade</span>
          </div>

          <div className="divide-y divide-white/[0.05]">
            {tradeData.calls.map((call, idx) => (
              <TradeCallRow
                key={call.item_id}
                call={call}
                rank={idx + 1}
                disabledStart={slotsFull}
                onStartFlip={onStartFlip}
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
  disabledStart,
  onStartFlip,
  onOpenChart,
}: {
  call: TradeCall;
  rank: number;
  disabledStart: boolean;
  onStartFlip: (call: TradeCall) => Promise<void>;
  onOpenChart: (itemId: number) => void;
}) {
  const [copied, setCopied] = useState<'buy' | 'sell' | null>(null);
  const [starting, setStarting] = useState(false);

  const pill = STRATEGY_PILL[call.strategy] || STRATEGY_PILL.auto_mix;
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
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-[#121217]">
            {call.icon ? (
              <img src={wikiIconUrl(call.icon)} alt="" className="h-6 w-6 object-contain" loading="lazy" />
            ) : (
              <Sparkles className="h-4 w-4 text-amber-400" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => onOpenChart(call.item_id)}
                className="truncate text-sm font-semibold text-zinc-100 hover:text-white transition"
              >
                {call.item_name}
              </button>
              <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-wider ${pill.cls}`}>
                {pill.label}
              </span>
              {call.is_tax_exempt && (
                <span className="rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-400">
                  0% TAX
                </span>
              )}
              {call.is_mega_rare_capped && (
                <span className="rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">
                  5M CAP
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500 truncate">
              Cost <span className="text-zinc-300 font-mono-num">{formatGp(call.capital_required, true)}</span> · {call.reason}
            </div>
          </div>
        </div>

        {/* 2. Action: BUY Qty @ Price -> SELL Price */}
        <div className="flex items-center gap-2 font-mono-num">
          <button
            onClick={() => copyPrice('buy', call.buy_price)}
            className="flex flex-col rounded-lg border border-white/[0.06] bg-[#07070a] px-2.5 py-1.5 text-left hover:border-white/[0.16] transition"
            title="Copy exact Buy price"
          >
            <span className="font-sans text-[9px] uppercase tracking-wider text-zinc-500">
              Buy {call.quantity.toLocaleString()}x
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
            className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-zinc-900/90 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition"
          >
            <BarChart3 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={async () => {
              setStarting(true);
              try {
                await onStartFlip(call);
              } finally {
                setStarting(false);
              }
            }}
            disabled={starting || disabledStart}
            className="flex flex-1 lg:flex-initial items-center justify-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-white disabled:opacity-40 transition"
          >
            <Play className="h-3 w-3 fill-current" />
            {starting ? 'Adding' : 'Start Flip'}
          </button>
        </div>
      </div>

      {/* Optional Dump Transparency Sub-Line */}
      {call.strategy === 'dump_sniper' && call.dump_details && (
        <div className="mt-2 ml-0 lg:ml-8 flex flex-wrap items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/[0.05] px-3 py-1.5 text-[11px]">
          <Flame className="h-3.5 w-3.5 text-rose-400 shrink-0" />
          <span className="text-rose-200 font-medium">
            {call.dump_details.timeframe} Hourly Avg: <strong className="font-mono-num">{formatGp(call.dump_details.baseline_vwap)} gp</strong> ({call.dump_details.drop_pct.toFixed(1)}%)
          </span>
          <span className="text-zinc-500">·</span>
          <span className="text-zinc-400">Target = {call.dump_details.target_basis}</span>
          <span
            className={`ml-auto rounded px-1.5 py-0.5 text-[9px] font-bold ${
              call.dump_details.bounce_outlook === 'HIGH'
                ? 'bg-emerald-500/20 text-emerald-300'
                : call.dump_details.bounce_outlook === 'MEDIUM'
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'bg-rose-500/20 text-rose-300'
            }`}
          >
            BOUNCE: {call.dump_details.bounce_outlook}
          </span>
        </div>
      )}
    </div>
  );
}
