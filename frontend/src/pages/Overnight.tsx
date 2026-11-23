import { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Check,
  Coins,
  Copy,
  Layers,
  Moon,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { api } from '../api/client';
import type { OvernightFlip, OvernightResponse, OvernightStyle } from '../types';
import { formatGp, formatSignedGp, parseGpInput, wikiIconUrl } from '../utils/format';

const BANK_PRESETS = [
  { label: '5M', value: 5_000_000 },
  { label: '25M', value: 25_000_000 },
  { label: '100M', value: 100_000_000 },
  { label: '500M', value: 500_000_000 },
  { label: '1B', value: 1_000_000_000 },
];

const STYLES: { key: OvernightStyle; label: string; desc: string }[] = [
  { key: 'balanced', label: 'Balanced Set & Forget', desc: 'Best blend of stability, 8h fill odds & profit' },
  { key: 'safe', label: 'Ultra-Safe Sleep', desc: 'Tight ranges, high safety & alch-floor protection' },
  { key: 'high_margin', label: 'High-Margin Swings', desc: 'Bigger GP per slot on PvM gear & >250M rares' },
];

interface Props {
  cashStack: number;
  onChangeCashStack: (val: number) => void;
  members: boolean;
  slotsFull: boolean;
  tickVersion: number;
  slotsVersion: number;
  onStartOvernight: (flip: OvernightFlip) => Promise<void>;
  onOpenChart: (itemId: number) => void;
}

export function Overnight({
  cashStack,
  onChangeCashStack,
  members,
  slotsFull,
  tickVersion,
  slotsVersion,
  onStartOvernight,
  onOpenChart,
}: Props) {
  const [slots, setSlots] = useState(8);
  const [style, setStyle] = useState<OvernightStyle>('balanced');
  const [cashInput, setCashInput] = useState(() => formatGp(cashStack, true));
  const [data, setData] = useState<OvernightResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setCashInput(formatGp(cashStack, true));
  }, [cashStack]);

  const fetchOvernight = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.overnightFlips({
        cash_stack: cashStack,
        slots,
        style,
        members,
        count: 16,
      });
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [cashStack, slots, style, members]);

  useEffect(() => {
    fetchOvernight();
  }, [fetchOvernight, tickVersion, slotsVersion]);

  const commitCash = () => {
    const parsed = parseGpInput(cashInput);
    if (parsed && parsed >= 10_000) {
      onChangeCashStack(parsed);
      setCashInput(formatGp(parsed, true));
    } else {
      setCashInput(formatGp(cashStack, true));
    }
  };

  return (
    <div className="space-y-5">
      {/* Overnight Planner Header & Controls */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-indigo-500/30 bg-indigo-500/10 text-indigo-300">
              <Moon className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-zinc-100">Overnight Flips (8–12h Set & Forget)</h1>
              <p className="text-xs text-zinc-500">
                Bids anchored near 7d hourly 25th-percentile troughs · Targets near 75th-percentile peaks · Multi-day downtrends filtered out
              </p>
            </div>
          </div>

          <button
            onClick={fetchOvernight}
            className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#08080b] px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-900 hover:text-white"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-xl border border-white/[0.1] bg-[#060608] px-3 py-1.5">
              <Coins className="h-4 w-4 text-amber-400" />
              <span className="text-xs text-zinc-500">Overnight Bank</span>
              <input
                value={cashInput}
                onChange={(e) => setCashInput(e.target.value)}
                onBlur={commitCash}
                onKeyDown={(e) => e.key === 'Enter' && commitCash()}
                className="w-24 bg-transparent text-sm font-bold text-zinc-100 outline-none tabular-nums"
              />
            </div>

            <div className="flex items-center gap-1">
              {BANK_PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => onChangeCashStack(p.value)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                    cashStack === p.value
                      ? 'bg-zinc-100 text-zinc-950'
                      : 'border border-white/[0.06] bg-[#08080b] text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#060608] px-3 py-1.5 text-xs">
              <Layers className="h-3.5 w-3.5 text-zinc-400" />
              <span className="text-zinc-500">Slots</span>
              <select
                value={slots}
                onChange={(e) => setSlots(Number(e.target.value))}
                className="bg-transparent font-bold text-zinc-100 outline-none"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n} className="bg-[#0c0c0f]">
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {data && (
            <div className="flex flex-wrap items-center gap-5 text-xs tabular-nums">
              <div>
                <span className="text-zinc-500">Deployed ({slots} slots) </span>
                <strong className="text-zinc-100">{formatGp(data.summary.allocated_capital, true)}</strong>
              </div>
              <div className="flex items-center gap-1">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-zinc-500">Est. Overnight Profit </span>
                <strong className="text-emerald-400">
                  {formatSignedGp(data.summary.est_overnight_profit, true)}
                </strong>
              </div>
              <div>
                <span className="text-zinc-500">Avg Net ROI </span>
                <strong className="text-amber-300">{data.summary.avg_roi_pct.toFixed(2)}%</strong>
              </div>
            </div>
          )}
        </div>

        {/* Style Selector */}
        <div className="flex flex-wrap gap-1.5">
          {STYLES.map((s) => (
            <button
              key={s.key}
              onClick={() => setStyle(s.key)}
              title={s.desc}
              className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                style === s.key
                  ? 'border-white/20 bg-white/[0.1] text-white'
                  : 'border-white/[0.05] bg-[#070709] text-zinc-500 hover:border-white/[0.12] hover:text-zinc-200'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Overnight Cards Grid */}
      {!data || data.flips.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-12 text-center text-sm text-zinc-500">
          {loading
            ? 'Scanning 7-day hourly ranges for safe overnight plays...'
            : 'No overnight flips matched this strict filter. Try Balanced style or increase your bankroll.'}
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

  const copyPrice = (kind: 'buy' | 'sell', val: number) => {
    navigator.clipboard.writeText(String(val));
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1200);
  };

  const riskBadge =
    flip.overnight_risk === 'LOW'
      ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400'
      : flip.overnight_risk === 'MODERATE'
        ? 'border-amber-500/25 bg-amber-500/10 text-amber-300'
        : 'border-indigo-500/30 bg-indigo-500/15 text-indigo-300';

  const fillBadge =
    flip.fill_confidence === 'HIGH'
      ? 'text-emerald-400'
      : flip.fill_confidence === 'MEDIUM'
        ? 'text-amber-300'
        : 'text-zinc-400';

  // Compute positions on the visual 7-day range bar
  const span = Math.max(1, flip.max_7d - flip.min_7d);
  const buyPct = Math.max(0, Math.min(100, ((flip.buy_price - flip.min_7d) / span) * 100));
  const sellPct = Math.max(buyPct + 3, Math.min(100, ((flip.sell_price - flip.min_7d) / span) * 100));

  const tot24 = flip.vol_24h_high + flip.vol_24h_low;
  const buyVolPct = tot24 > 0 ? Math.round((flip.vol_24h_high / tot24) * 100) : 50;

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-4 transition-all hover:border-white/[0.16] hover:bg-[#101014]">
      <div>
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-[#141419]">
              {flip.icon ? (
                <img src={wikiIconUrl(flip.icon)} alt="" className="h-7 w-7 object-contain" loading="lazy" />
              ) : (
                <Sparkles className="h-4 w-4 text-indigo-300" />
              )}
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
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${riskBadge}`}>
                  {flip.overnight_risk} RISK
                </span>
                {flip.alch_protected && (
                  <span className="rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                    ALCH FLOOR
                  </span>
                )}
                {flip.is_tax_exempt && (
                  <span className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                    0% TAX
                  </span>
                )}
                {flip.is_mega_rare_capped && (
                  <span className="rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                    5M CAP
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="text-right shrink-0 tabular-nums">
            <div className="text-base font-bold text-emerald-400">
              {formatSignedGp(flip.est_net_profit, true)}
            </div>
            <div className="text-[11px] text-zinc-500">{flip.net_roi_pct.toFixed(1)}% net ROI</div>
          </div>
        </div>

        {/* Overnight Bid -> Morning Sell */}
        <div className="mt-3.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl border border-white/[0.06] bg-[#070709] p-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
              Night Bid · {flip.quantity.toLocaleString()}x
            </div>
            <button
              onClick={() => copyPrice('buy', flip.buy_price)}
              className="mt-0.5 flex items-center gap-1.5 text-sm font-bold text-zinc-100 hover:text-white tabular-nums"
            >
              {formatGp(flip.buy_price)}
              {copied === 'buy' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3 w-3 text-zinc-600" />}
            </button>
          </div>
          <ArrowRight className="h-4 w-4 text-zinc-700" />
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Morning Sell</div>
            <button
              onClick={() => copyPrice('sell', flip.sell_price)}
              className="mt-0.5 ml-auto flex items-center justify-end gap-1.5 text-sm font-bold text-amber-300 hover:text-amber-200 tabular-nums"
            >
              {copied === 'sell' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3 w-3 text-zinc-600" />}
              {formatGp(flip.sell_price)}
            </button>
          </div>
        </div>

        {/* Visual 7-Day Range Position Bar */}
        <div className="mt-2.5 rounded-xl border border-white/[0.04] bg-[#08080b] p-2.5 text-[10px] tabular-nums">
          <div className="flex justify-between text-zinc-500 mb-1.5">
            <span>7d Low: {formatGp(flip.min_7d, true)}</span>
            <span className="text-zinc-400">7d Oscillation Band</span>
            <span>7d High: {formatGp(flip.max_7d, true)}</span>
          </div>
          <div className="relative h-2 w-full rounded-full bg-zinc-900">
            <div
              className="absolute top-0 h-full rounded-full bg-gradient-to-r from-emerald-400 to-amber-400"
              style={{ left: `${buyPct}%`, width: `${Math.max(4, sellPct - buyPct)}%` }}
            />
          </div>
        </div>

        {/* 8h Sleep Volume + Buy/Sell Split + Stability */}
        <div className="mt-2.5 grid grid-cols-3 gap-2 text-[11px] tabular-nums">
          <div className="rounded-lg border border-white/[0.04] bg-[#08080b] px-2 py-1.5">
            <div className="text-[9px] text-zinc-500">8h FILL ODDS</div>
            <div className={`font-bold ${fillBadge}`}>{flip.fill_confidence}</div>
          </div>
          <div className="rounded-lg border border-white/[0.04] bg-[#08080b] px-2 py-1.5">
            <div className="text-[9px] text-zinc-500">8h VOL / SPLIT</div>
            <div className="font-semibold text-zinc-200">
              {formatGp(flip.est_8h_volume, true)}{' '}
              <span className="text-[10px] text-emerald-400">{buyVolPct}%B</span>
            </div>
          </div>
          <div className="rounded-lg border border-white/[0.04] bg-[#08080b] px-2 py-1.5">
            <div className="text-[9px] text-zinc-500 flex items-center gap-0.5">
              <ShieldCheck className="h-2.5 w-2.5 text-amber-400" /> 7d DRIFT
            </div>
            <div className={`font-semibold ${Math.abs(flip.trend_7d_pct) <= 2 ? 'text-emerald-400' : 'text-zinc-300'}`}>
              {flip.trend_7d_pct >= 0 ? '+' : ''}
              {flip.trend_7d_pct.toFixed(1)}%
            </div>
          </div>
        </div>

        <p className="mt-2 text-[11px] text-zinc-500 line-clamp-2">{flip.reason}</p>
      </div>

      {/* Footer */}
      <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
        <span className="text-[11px] text-zinc-500 tabular-nums">
          Cost: <strong className="text-zinc-200">{formatGp(flip.capital_required, true)}</strong>
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onOpenChart(flip.item_id)}
            className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white"
          >
            <BarChart3 className="h-3.5 w-3.5" /> Inspect
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
            className="flex items-center gap-1 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-white disabled:opacity-40"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            {starting ? 'Adding...' : 'Start Night'}
          </button>
        </div>
      </div>
    </div>
  );
}
