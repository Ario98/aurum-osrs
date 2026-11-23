import { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Brain,
  Check,
  Copy,
  Layers,
  LayoutGrid,
  LayoutList,
  Moon,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { api } from '../api/client';
import type { OvernightFlip, OvernightResponse, OvernightStyle } from '../types';
import { formatGp, formatSignedGp, wikiIconUrl } from '../utils/format';

const STYLES: { key: OvernightStyle; label: string; desc: string }[] = [
  { key: 'balanced', label: 'Balanced Set & Forget', desc: 'Best blend of stability, 8h fill odds & profit' },
  { key: 'safe', label: 'Ultra-Safe Sleep', desc: 'Tight ranges, high safety & alch-floor protection' },
  { key: 'high_margin', label: 'High-Margin Swings', desc: 'Bigger GP per slot on PvM gear & >250M rares' },
];

interface Props {
  cashStack: number;
  members: boolean;
  mlBoost: boolean;
  onToggleMlBoost: () => void;
  slotsFull: boolean;
  tickVersion: number;
  slotsVersion: number;
  onStartOvernight: (flip: OvernightFlip) => Promise<void>;
  onOpenChart: (itemId: number) => void;
  onOpenMlLab: () => void;
}

export function Overnight({
  cashStack,
  members,
  mlBoost,
  onToggleMlBoost,
  slotsFull,
  tickVersion,
  slotsVersion,
  onStartOvernight,
  onOpenChart,
  onOpenMlLab,
}: Props) {
  const [slots, setSlots] = useState(8);
  const [style, setStyle] = useState<OvernightStyle>('balanced');
  const [view, setView] = useState<'rows' | 'grid'>('rows');
  const [data, setData] = useState<OvernightResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchOvernight = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.overnightFlips({
        cash_stack: cashStack,
        slots,
        style,
        members,
        count: 16,
        ml_boost: mlBoost,
      });
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [cashStack, slots, style, members, mlBoost]);

  useEffect(() => {
    fetchOvernight();
  }, [fetchOvernight, tickVersion, slotsVersion]);

  return (
    <div className="space-y-5">
      {/* Header & Summary */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-indigo-500/30 bg-indigo-500/10 text-indigo-300">
            <Moon className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-zinc-100">Overnight Flips</h1>
            <p className="text-xs text-zinc-500">
              8–12h bids anchored to 7d hourly 25th→75th percentile bands · Overnight Coach stays quiet while you sleep
            </p>
          </div>
        </div>

        {data && (
          <div className="flex flex-wrap items-center gap-6 text-xs font-mono-num">
            <div>
              <div className="text-[10px] font-sans uppercase tracking-wider text-zinc-500">Est. Overnight Profit</div>
              <div className="text-base font-bold text-emerald-400 flex items-center gap-1">
                <TrendingUp className="h-3.5 w-3.5" />
                {formatSignedGp(data.summary.est_overnight_profit, true)}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-sans uppercase tracking-wider text-zinc-500">Avg Net ROI</div>
              <div className="text-base font-bold text-amber-300">{data.summary.avg_roi_pct.toFixed(2)}%</div>
            </div>
            <div>
              <div className="text-[10px] font-sans uppercase tracking-wider text-zinc-500">Deployed ({slots} slots)</div>
              <div className="text-base font-semibold text-zinc-300">{formatGp(data.summary.allocated_capital, true)}</div>
            </div>
          </div>
        )}
      </div>

      {/* Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 rounded-xl border border-white/[0.07] bg-[#0a0a0e] p-1">
            {STYLES.map((s) => (
              <button
                key={s.key}
                onClick={() => setStyle(s.key)}
                title={s.desc}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  style === s.key ? 'bg-white/[0.11] text-white' : 'text-zinc-500 hover:text-zinc-200'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#0a0a0e] px-3 py-1.5 text-xs">
            <Layers className="h-3.5 w-3.5 text-zinc-400" />
            <span className="text-zinc-500">Slots</span>
            <select
              value={slots}
              onChange={(e) => setSlots(Number(e.target.value))}
              className="bg-transparent font-bold text-zinc-100 outline-none font-mono-num"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n} className="bg-[#0c0c0f]">
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {data?.ml_meta?.loaded ? (
            <button
              onClick={onToggleMlBoost}
              title={
                data.ml_meta.validated
                  ? 'Toggle LightGBM 12h ML ranking boost (validated out-of-sample)'
                  : 'ML model is in advisory-only mode'
              }
              className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                data.ml_meta.boost_active
                  ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-300'
                  : 'border-white/[0.08] bg-[#0a0a0e] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Brain className="h-3.5 w-3.5" />
              <span>
                {!data.ml_meta.validated
                  ? 'ML: Advisory'
                  : mlBoost
                    ? 'ML Boost: On'
                    : 'ML Boost: Off'}
              </span>
            </button>
          ) : (
            <button
              onClick={onOpenMlLab}
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
            >
              <LayoutList className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setView('grid')}
              className={`rounded-lg p-1.5 transition ${
                view === 'grid' ? 'bg-white/[0.11] text-white' : 'text-zinc-500 hover:text-zinc-200'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
          </div>
          <button
            onClick={fetchOvernight}
            className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#0b0b0f] px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-white/[0.06] hover:text-white"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Overnight List / Grid */}
      {!data || data.flips.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.07] bg-[#0b0b0f] p-14 text-center text-sm text-zinc-500">
          {loading
            ? 'Scanning 7-day hourly ranges for safe overnight plays...'
            : 'No overnight flips matched this filter. Try Balanced style or adjust your Cash Stack.'}
        </div>
      ) : view === 'rows' ? (
        <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a0a0e]">
          <div className="hidden lg:grid grid-cols-[2fr_1.7fr_1fr_1.4fr_0.9fr_auto] items-center gap-4 border-b border-white/[0.06] bg-[#08080b] px-5 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            <span>Item & Risk</span>
            <span>Night Bid → Morning Sell</span>
            <span className="text-right">Est. Net / ROI</span>
            <span>7d Oscillation Band</span>
            <span className="text-right">8h Fill & Drift</span>
            <span className="text-right w-[166px]">Action</span>
          </div>
          <div className="divide-y divide-white/[0.05]">
            {data.flips.map((flip, idx) => (
              <OvernightRow
                key={flip.item_id}
                flip={flip}
                rank={idx + 1}
                slotsFull={slotsFull}
                onStart={onStartOvernight}
                onOpenChart={onOpenChart}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {data.flips.map((flip, idx) => (
            <OvernightCard
              key={flip.item_id}
              flip={flip}
              rank={idx + 1}
              slotsFull={slotsFull}
              onStart={onStartOvernight}
              onOpenChart={onOpenChart}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OvernightRow({
  flip,
  rank,
  slotsFull,
  onStart,
  onOpenChart,
}: {
  flip: OvernightFlip;
  rank: number;
  slotsFull: boolean;
  onStart: (f: OvernightFlip) => Promise<void>;
  onOpenChart: (id: number) => void;
}) {
  const [copied, setCopied] = useState<'buy' | 'sell' | null>(null);
  const [starting, setStarting] = useState(false);

  const span = Math.max(1, flip.max_7d - flip.min_7d);
  const buyPct = Math.max(0, Math.min(100, ((flip.buy_price - flip.min_7d) / span) * 100));
  const sellPct = Math.max(buyPct + 3, Math.min(100, ((flip.sell_price - flip.min_7d) / span) * 100));

  const riskBadge =
    flip.overnight_risk === 'LOW'
      ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400'
      : flip.overnight_risk === 'MODERATE'
        ? 'border-amber-500/25 bg-amber-500/10 text-amber-300'
        : 'border-indigo-500/30 bg-indigo-500/15 text-indigo-300';

  const copyPrice = (kind: 'buy' | 'sell', val: number) => {
    navigator.clipboard.writeText(String(val));
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1100);
  };

  return (
    <div className="px-4 py-3.5 lg:px-5 transition-colors hover:bg-white/[0.025]">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1.7fr_1fr_1.4fr_0.9fr_auto] lg:items-center lg:gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-5 text-center text-[11px] font-mono-num text-zinc-600 shrink-0">{rank}</span>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-[#121217]">
            {flip.icon ? (
              <img src={wikiIconUrl(flip.icon)} alt="" className="h-6 w-6 object-contain" loading="lazy" />
            ) : (
              <Sparkles className="h-4 w-4 text-indigo-300" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => onOpenChart(flip.item_id)}
                className="truncate text-sm font-semibold text-zinc-100 hover:text-white"
              >
                {flip.item_name}
              </button>
              <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold ${riskBadge}`}>
                {flip.overnight_risk}
              </span>
              {flip.alch_protected && (
                <span className="rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">
                  ALCH FLOOR
                </span>
              )}
              {flip.is_tax_exempt && (
                <span className="rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-400">
                  0% TAX
                </span>
              )}
              {flip.ml && (
                <span
                  className={`rounded border px-1.5 py-0.5 text-[9px] font-bold font-mono-num ${
                    flip.ml.prob_12h_pct >= 62
                      ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                      : 'border-white/[0.1] bg-white/[0.04] text-zinc-300'
                  }`}
                  title={`LightGBM 12h overnight win probability: ${flip.ml.prob_12h_pct}% · predicted net ROI: ${flip.ml.pred_12h_roi_pct >= 0 ? '+' : ''}${flip.ml.pred_12h_roi_pct}%`}
                >
                  ML {Math.round(flip.ml.prob_12h_pct)}% · {flip.ml.pred_12h_roi_pct >= 0 ? '+' : ''}
                  {flip.ml.pred_12h_roi_pct.toFixed(1)}%
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500 truncate">
              Cost <span className="text-zinc-300 font-mono-num">{formatGp(flip.capital_required, true)}</span> · 8h vol{' '}
              <span className="font-mono-num">{flip.est_8h_volume.toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono-num">
          <button
            onClick={() => copyPrice('buy', flip.buy_price)}
            className="flex flex-col rounded-lg border border-white/[0.06] bg-[#07070a] px-2.5 py-1.5 text-left hover:border-white/[0.16]"
          >
            <span className="font-sans text-[9px] uppercase text-zinc-500">Bid {flip.quantity.toLocaleString()}x</span>
            <span className="flex items-center gap-1 text-xs font-bold text-zinc-100">
              {formatGp(flip.buy_price)}
              {copied === 'buy' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-2.5 w-2.5 text-zinc-600" />}
            </span>
          </button>
          <ArrowRight className="h-3.5 w-3.5 text-zinc-700 shrink-0" />
          <button
            onClick={() => copyPrice('sell', flip.sell_price)}
            className="flex flex-col rounded-lg border border-white/[0.06] bg-[#07070a] px-2.5 py-1.5 text-left hover:border-amber-400/30"
          >
            <span className="font-sans text-[9px] uppercase text-zinc-500">Morning Sell</span>
            <span className="flex items-center gap-1 text-xs font-bold text-amber-300">
              {formatGp(flip.sell_price)}
              {copied === 'sell' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-2.5 w-2.5 text-zinc-600" />}
            </span>
          </button>
        </div>

        <div className="flex items-baseline justify-between lg:flex-col lg:items-end font-mono-num">
          <span className="text-sm font-bold text-emerald-400">{formatSignedGp(flip.est_net_profit, true)}</span>
          <span className="text-[11px] text-zinc-500">{flip.net_roi_pct.toFixed(1)}% net ROI</span>
        </div>

        <div className="font-mono-num">
          <div className="flex justify-between text-[10px] text-zinc-500 mb-1">
            <span>{formatGp(flip.min_7d, true)}</span>
            <span>{formatGp(flip.max_7d, true)}</span>
          </div>
          <div className="relative h-2 w-full rounded-full bg-zinc-900">
            <div
              className="absolute top-0 h-full rounded-full bg-gradient-to-r from-emerald-400 to-amber-400"
              style={{ left: `${buyPct}%`, width: `${Math.max(4, sellPct - buyPct)}%` }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between lg:flex-col lg:items-end text-xs font-mono-num">
          <span
            className={`font-bold ${
              flip.fill_confidence === 'HIGH'
                ? 'text-emerald-400'
                : flip.fill_confidence === 'MEDIUM'
                  ? 'text-amber-300'
                  : 'text-zinc-400'
            }`}
          >
            {flip.fill_confidence} FILL
          </span>
          <span className="text-[11px] text-zinc-400">
            7d {flip.trend_7d_pct >= 0 ? '+' : ''}
            {flip.trend_7d_pct.toFixed(1)}%
          </span>
        </div>

        <div className="flex items-center justify-end gap-1.5 lg:w-[166px]">
          <button
            onClick={() => onOpenChart(flip.item_id)}
            className="rounded-lg border border-white/[0.08] bg-zinc-900 p-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-white"
          >
            <BarChart3 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={async () => {
              setStarting(true);
              try {
                await onStart(flip);
              } finally {
                setStarting(false);
              }
            }}
            disabled={starting || slotsFull}
            className="flex flex-1 lg:flex-initial items-center justify-center gap-1.5 rounded-lg bg-indigo-500/20 border border-indigo-400/35 px-3 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/30 disabled:opacity-40 transition"
          >
            <Moon className="h-3 w-3" />
            {starting ? 'Adding' : 'Start Night'}
          </button>
        </div>
      </div>
    </div>
  );
}

function OvernightCard({
  flip,
  rank,
  slotsFull,
  onStart,
  onOpenChart,
}: {
  flip: OvernightFlip;
  rank: number;
  slotsFull: boolean;
  onStart: (f: OvernightFlip) => Promise<void>;
  onOpenChart: (id: number) => void;
}) {
  const [copied, setCopied] = useState<'buy' | 'sell' | null>(null);
  const [starting, setStarting] = useState(false);

  const span = Math.max(1, flip.max_7d - flip.min_7d);
  const buyPct = Math.max(0, Math.min(100, ((flip.buy_price - flip.min_7d) / span) * 100));
  const sellPct = Math.max(buyPct + 3, Math.min(100, ((flip.sell_price - flip.min_7d) / span) * 100));

  const copyPrice = (kind: 'buy' | 'sell', val: number) => {
    navigator.clipboard.writeText(String(val));
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1200);
  };

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-4 hover:border-white/[0.16] transition">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-[#141419]">
              {flip.icon && <img src={wikiIconUrl(flip.icon)} alt="" className="h-7 w-7 object-contain" />}
              <span className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-bold text-zinc-300 ring-1 ring-white/15">
                {rank}
              </span>
            </div>
            <div className="min-w-0">
              <button
                onClick={() => onOpenChart(flip.item_id)}
                className="truncate block max-w-full text-left text-sm font-semibold text-zinc-100 hover:text-white"
              >
                {flip.item_name}
              </button>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
                <span>{flip.overnight_risk} RISK</span>
                <span>· {flip.fill_confidence} FILL</span>
                {flip.ml && (
                  <span className="rounded bg-sky-500/10 px-1.5 py-0.5 font-mono-num font-semibold text-sky-300">
                    ML {Math.round(flip.ml.prob_12h_pct)}% ({flip.ml.pred_12h_roi_pct >= 0 ? '+' : ''}
                    {flip.ml.pred_12h_roi_pct.toFixed(1)}%)
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="text-right font-mono-num shrink-0">
            <div className="text-base font-bold text-emerald-400">{formatSignedGp(flip.est_net_profit, true)}</div>
            <div className="text-[11px] text-zinc-500">{flip.net_roi_pct.toFixed(1)}% ROI</div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl border border-white/[0.06] bg-[#070709] p-2.5 font-mono-num">
          <div>
            <div className="font-sans text-[10px] text-zinc-500">Bid {flip.quantity.toLocaleString()}x</div>
            <button onClick={() => copyPrice('buy', flip.buy_price)} className="flex items-center gap-1 text-sm font-bold text-zinc-100">
              {formatGp(flip.buy_price)} {copied === 'buy' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3 text-zinc-600" />}
            </button>
          </div>
          <ArrowRight className="h-4 w-4 text-zinc-700" />
          <div className="text-right">
            <div className="font-sans text-[10px] text-zinc-500">Morning Sell</div>
            <button onClick={() => copyPrice('sell', flip.sell_price)} className="ml-auto flex items-center gap-1 text-sm font-bold text-amber-300">
              {copied === 'sell' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3 text-zinc-600" />} {formatGp(flip.sell_price)}
            </button>
          </div>
        </div>

        <div className="mt-2.5 rounded-lg border border-white/[0.04] bg-[#08080b] p-2 text-[10px] font-mono-num">
          <div className="flex justify-between text-zinc-500 mb-1">
            <span>{formatGp(flip.min_7d, true)}</span>
            <span className="flex items-center gap-1 font-sans">
              <ShieldCheck className="h-3 w-3 text-amber-400" /> 7d Range
            </span>
            <span>{formatGp(flip.max_7d, true)}</span>
          </div>
          <div className="relative h-1.5 w-full rounded-full bg-zinc-900">
            <div
              className="absolute top-0 h-full rounded-full bg-gradient-to-r from-emerald-400 to-amber-400"
              style={{ left: `${buyPct}%`, width: `${Math.max(4, sellPct - buyPct)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-3">
        <span className="text-[11px] text-zinc-500 font-mono-num">{formatGp(flip.capital_required, true)}</span>
        <div className="flex gap-1.5">
          <button onClick={() => onOpenChart(flip.item_id)} className="rounded-lg border border-white/[0.08] bg-zinc-900 p-1.5 text-zinc-300">
            <BarChart3 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={async () => {
              setStarting(true);
              try {
                await onStart(flip);
              } finally {
                setStarting(false);
              }
            }}
            disabled={starting || slotsFull}
            className="flex items-center gap-1 rounded-lg bg-indigo-500/20 border border-indigo-400/35 px-3 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/30 disabled:opacity-40"
          >
            <Play className="h-3 w-3 fill-current" /> Start Night
          </button>
        </div>
      </div>
    </div>
  );
}
