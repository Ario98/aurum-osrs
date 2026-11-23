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
import { BadgePill, STRATEGY_META } from './BadgePill';
import { MLSignalBadge } from './MLSignalBadge';

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

  const meta = STRATEGY_META[call.strategy] || STRATEGY_META.auto_mix;
  const isDump = call.strategy === 'dump_sniper' && Boolean(call.dump_details);
  const dumpLabel = isDump ? `DUMP ${(call.dump_details?.drop_pct ?? 0).toFixed(1)}%` : meta.label;
  const dumpDetails = isDump && call.dump_details
    ? [
        { label: `${call.dump_details.timeframe} Hourly Avg`, value: `${formatGp(call.dump_details.baseline_vwap)} gp` },
        { label: 'Drop vs Avg', value: `${call.dump_details.drop_pct.toFixed(1)}%`, highlight: 'rose' as const },
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
        { label: 'Sell Target Basis', value: call.dump_details.target_basis },
      ]
    : undefined;

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
            <button
              type="button"
              onClick={() => onOpenChart(call.item_id)}
              title="Open item chart & order ticket"
              className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-[#141419] transition hover:border-amber-400/40 hover:bg-[#1a1a23]"
            >
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
            </button>
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => onOpenChart(call.item_id)}
                className="group/item inline-flex items-center gap-1 truncate text-left text-sm font-semibold text-zinc-100 hover:text-amber-300 hover:underline underline-offset-2 transition max-w-full"
                title="Open item chart & order ticket"
              >
                <span className="truncate">{call.item_name}</span>
                <span className="text-[10px] text-amber-400/0 transition group-hover/item:text-amber-400">↗</span>
              </button>
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
                    tooltipText="Official OSRS GE tax-exempt item. You keep 100% of the spread."
                  />
                )}
                {call.is_mega_rare_capped && (
                  <BadgePill
                    label="5M CAP"
                    cls="border-amber-500/25 bg-amber-500/10 text-amber-300"
                    tooltipTitle="5M GP Tax Cap"
                    tooltipText="Items ≥ 250M gp cap GE tax at 5,000,000 gp per unit instead of a full 2%."
                  />
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

        {/* 1h Buy vs. Sell Volume Strip */}
        <div className="mt-2.5 rounded-lg border border-white/[0.04] bg-[#08080b] px-2.5 py-2 text-[11px] tabular-nums">
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">
              1h Vol <strong className="text-zinc-100">{call.vol_1h.toLocaleString()}</strong>
              <span className="text-zinc-600"> · 24h {formatGp(call.vol_24h, true)}</span>
            </span>
            {(() => {
              const b = call.vol_1h_high ?? 0;
              const s = call.vol_1h_low ?? 0;
              const tot = b + s;
              const bPct = tot > 0 ? Math.round((b / tot) * 100) : 50;
              return (
                <span>
                  <span className="text-emerald-400 font-semibold">{bPct}% B</span>
                  <span className="text-zinc-600"> / </span>
                  <span className="text-rose-400 font-semibold">{100 - bPct}% S</span>
                </span>
              );
            })()}
          </div>
          {(() => {
            const b = call.vol_1h_high ?? 0;
            const s = call.vol_1h_low ?? 0;
            const tot = b + s;
            const bPct = tot > 0 ? Math.round((b / tot) * 100) : 50;
            return (
              <div className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-rose-500/55">
                <div className="h-full bg-emerald-400" style={{ width: `${bPct}%` }} />
              </div>
            );
          })()}
        </div>

        {/* Dump Sniper Transparency Box */}
        {call.strategy === 'dump_sniper' && call.dump_details && (
          <div className="mt-2.5 rounded-lg border border-rose-500/20 bg-rose-500/[0.06] px-2.5 py-2 text-[11px] space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-rose-300 flex items-center gap-1">
                <Flame className="h-3 w-3" />
                {call.dump_details.timeframe} Hourly Avg: {formatGp(call.dump_details.baseline_vwap)} gp
              </span>
              <span
                className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
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
            <div className="text-[10px] text-zinc-400 leading-snug">
              Sell target = <strong className="text-zinc-200">{call.dump_details.target_basis}</strong> ({call.dump_details.drop_pct.toFixed(1)}% below hourly avg).
            </div>
          </div>
        )}

        {/* Plain-English Reason */}
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-400 line-clamp-2">
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
