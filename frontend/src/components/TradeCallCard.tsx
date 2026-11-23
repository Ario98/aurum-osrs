import { useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Check,
  Clock,
  Copy,
  Flame,
  Play,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import type { TradeCall } from '../types';
import { formatGp, formatSignedGp, wikiIconUrl } from '../utils/format';

const STRATEGY_BADGES: Record<string, { label: string; cls: string }> = {
  fast_flip: { label: 'FAST FLIP', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25' },
  overnight: { label: 'BIG MARGIN', cls: 'bg-zinc-800 text-zinc-200 border-zinc-700' },
  dump_sniper: { label: 'DUMP SNIPE', cls: 'bg-rose-500/10 text-rose-400 border-rose-500/25' },
  alch_floor: { label: 'ALCH FLOOR', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/25' },
  auto_mix: { label: 'TOP CALL', cls: 'bg-zinc-800 text-zinc-200 border-zinc-700' },
};

interface Props {
  call: TradeCall;
  rank: number;
  onStartFlip: (call: TradeCall) => Promise<void>;
  onOpenChart: (itemId: number) => void;
  disabledStart?: boolean;
}

export function TradeCallCard({ call, rank, onStartFlip, onOpenChart, disabledStart }: Props) {
  const [copied, setCopied] = useState<'buy' | 'sell' | null>(null);
  const [starting, setStarting] = useState(false);

  const badge = STRATEGY_BADGES[call.strategy] || STRATEGY_BADGES.auto_mix;

  const copyPrice = (kind: 'buy' | 'sell', val: number) => {
    navigator.clipboard.writeText(String(val));
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1200);
  };

  const handleStart = async () => {
    setStarting(true);
    try {
      await onStartFlip(call);
    } finally {
      setStarting(false);
    }
  };

  const safetyColor =
    call.safety_score >= 80
      ? 'text-emerald-400'
      : call.safety_score >= 60
        ? 'text-amber-400'
        : 'text-rose-400';

  return (
    <div className="group relative flex flex-col justify-between rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-4 transition-all duration-150 hover:border-white/[0.16] hover:bg-[#101014]">
      <div>
        <div className="flex items-start justify-between gap-2.5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-[#141419]">
              {call.icon ? (
                <img
                  src={wikiIconUrl(call.icon)}
                  alt={call.item_name}
                  className="h-7 w-7 object-contain"
                  loading="lazy"
                />
              ) : (
                <Sparkles className="h-4 w-4 text-amber-400" />
              )}
              <span className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-bold text-zinc-300 ring-1 ring-white/15">
                {rank}
              </span>
            </div>
            <div className="min-w-0">
              <button
                onClick={() => onOpenChart(call.item_id)}
                className="truncate text-left text-sm font-semibold text-zinc-100 hover:text-white transition block max-w-full"
                title={call.item_name}
              >
                {call.item_name}
              </button>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tracking-wider ${badge.cls}`}>
                  {badge.label}
                </span>
                {call.is_tax_exempt && (
                  <span className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                    0% TAX
                  </span>
                )}
                {call.is_mega_rare_capped && (
                  <span className="rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                    5M CAP
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end shrink-0">
            <span className="text-base font-bold text-emerald-400 tabular-nums">
              {formatSignedGp(call.est_net_profit, true)}
            </span>
            <span className="text-[11px] text-zinc-500 tabular-nums">
              {call.net_roi_pct.toFixed(1)}% net ROI
            </span>
          </div>
        </div>

        {/* Action Ticket: BUY -> SELL */}
        <div className="mt-3.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl border border-white/[0.06] bg-[#070709] p-3">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              Buy {call.quantity.toLocaleString()}x
            </div>
            <button
              onClick={() => copyPrice('buy', call.buy_price)}
              className="mt-0.5 flex items-center gap-1.5 text-sm font-bold text-zinc-100 hover:text-white tabular-nums"
              title="Click to copy exact Buy price"
            >
              {formatGp(call.buy_price)}
              {copied === 'buy' ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3 w-3 text-zinc-600 group-hover:text-zinc-400" />
              )}
            </button>
          </div>

          <ArrowRight className="h-4 w-4 text-zinc-700" />

          <div className="text-right">
            <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              Sell (net 2% tax)
            </div>
            <button
              onClick={() => copyPrice('sell', call.sell_price)}
              className="mt-0.5 ml-auto flex items-center justify-end gap-1.5 text-sm font-bold text-amber-300 hover:text-amber-200 tabular-nums"
              title="Click to copy exact Sell price"
            >
              {copied === 'sell' ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3 w-3 text-zinc-600 group-hover:text-zinc-400" />
              )}
              {formatGp(call.sell_price)}
            </button>
          </div>
        </div>

        {/* Key Stats Strip */}
        <div className="mt-2.5 grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg border border-white/[0.04] bg-[#08080b] px-2.5 py-1.5">
            <div className="text-[10px] text-zinc-500 flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-emerald-400" /> Est. GP/hr
            </div>
            <div className="font-semibold text-zinc-100 tabular-nums">
              {formatGp(call.est_gp_per_hour, true)}
            </div>
          </div>
          <div className="rounded-lg border border-white/[0.04] bg-[#08080b] px-2.5 py-1.5">
            <div className="text-[10px] text-zinc-500 flex items-center gap-1">
              <Clock className="h-3 w-3 text-zinc-400" /> Fill Time
            </div>
            <div className="font-semibold text-zinc-100 tabular-nums">{call.est_fill_label}</div>
          </div>
          <div className="rounded-lg border border-white/[0.04] bg-[#08080b] px-2.5 py-1.5">
            <div className="text-[10px] text-zinc-500 flex items-center gap-1">
              <ShieldCheck className="h-3 w-3 text-amber-400" /> Safety
            </div>
            <div className={`font-semibold tabular-nums ${safetyColor}`}>{call.safety_score}/100</div>
          </div>
        </div>

        {/* Plain-English Reason */}
        <p className="mt-2.5 text-[11px] leading-relaxed text-zinc-400 line-clamp-2">
          {call.strategy === 'dump_sniper' && <Flame className="inline h-3 w-3 text-rose-400 mr-1 -mt-0.5" />}
          {call.reason}
        </p>
      </div>

      {/* Footer Actions */}
      <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
        <span className="text-[11px] text-zinc-500 tabular-nums">
          Capital: <strong className="text-zinc-200">{formatGp(call.capital_required, true)}</strong>
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onOpenChart(call.item_id)}
            className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition"
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Inspect
          </button>
          <button
            onClick={handleStart}
            disabled={starting || disabledStart}
            className="flex items-center gap-1 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-white disabled:opacity-40 transition"
            title={disabledStart ? 'All 8 GE slots are full' : 'Assign this trade to a free GE slot'}
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            {starting ? 'Adding...' : 'Start Flip'}
          </button>
        </div>
      </div>
    </div>
  );
}
