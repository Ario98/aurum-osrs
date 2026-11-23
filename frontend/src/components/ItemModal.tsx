import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, ColorType, LineStyle } from 'lightweight-charts';
import { AlertTriangle, Check, Copy, Flame, Info, Moon, Play, TrendingUp, X, Zap } from 'lucide-react';
import { api } from '../api/client';
import type { ChartPoint, ItemMetrics } from '../types';
import { formatAge, formatGp, formatSignedGp, wikiIconUrl } from '../utils/format';

interface Props {
  itemId: number | null;
  cashStack: number;
  freeSlots: number;
  slotsFull: boolean;
  onClose: () => void;
  onStartCustomFlip: (params: {
    item_id: number;
    item_name: string;
    quantity: number;
    buy_price: number;
    target_sell_price: number;
    flip_mode: 'active' | 'overnight';
  }) => Promise<void>;
}

const TIMEFRAMES: { key: '5m' | '1h' | '6h' | '24h'; label: string }[] = [
  { key: '5m', label: '30H (5m)' },
  { key: '1h', label: '15D (1h)' },
  { key: '6h', label: '90D (6h)' },
  { key: '24h', label: '1Y (24h)' },
];

function computeGeTax(sellPrice: number, isTaxExempt: boolean): number {
  if (isTaxExempt || sellPrice < 50) return 0;
  return Math.min(Math.floor(sellPrice * 0.02), 5_000_000);
}

export function ItemModal({ itemId, cashStack, freeSlots, slotsFull, onClose, onStartCustomFlip }: Props) {
  const [item, setItem] = useState<ItemMetrics | null>(null);
  const [timestep, setTimestep] = useState<'5m' | '1h' | '6h' | '24h'>('5m');
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [loadingChart, setLoadingChart] = useState(false);
  const [showVwapLines, setShowVwapLines] = useState(true);
  const [hoverPoint, setHoverPoint] = useState<ChartPoint | null>(null);

  // Interactive Order Ticket state
  const [buyInput, setBuyInput] = useState<number>(0);
  const [sellInput, setSellInput] = useState<number>(0);
  const [qtyInput, setQtyInput] = useState<number>(1);
  const [flipMode, setFlipMode] = useState<'active' | 'overnight'>('active');
  const [copied, setCopied] = useState<'buy' | 'sell' | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const priceContainerRef = useRef<HTMLDivElement | null>(null);
  const volContainerRef = useRef<HTMLDivElement | null>(null);

  const slotBudget = useMemo(() => {
    const denom = Math.max(1, Math.min(freeSlots || 1, 8));
    return Math.floor(cashStack / denom);
  }, [cashStack, freeSlots]);

  useEffect(() => {
    if (!itemId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [itemId, onClose]);

  useEffect(() => {
    if (!itemId) return;
    let cancelled = false;
    api.itemDetail(itemId).then((d) => {
      if (cancelled) return;
      setItem(d);
      const initBuy = d.suggested_buy || d.low || d.high || 1;
      const initSell = d.suggested_sell || d.high || d.low || 1;
      setBuyInput(initBuy);
      setSellInput(initSell);
      const limit = d.buy_limit > 0 ? d.buy_limit : 1000;
      const affordable = initBuy > 0 ? Math.floor(slotBudget / initBuy) : 1;
      setQtyInput(Math.max(1, Math.min(limit, affordable || 1)));
    });
    return () => {
      cancelled = true;
    };
  }, [itemId, slotBudget]);

  useEffect(() => {
    if (!itemId) return;
    let cancelled = false;
    setLoadingChart(true);
    api
      .itemChart(itemId, timestep)
      .then((res) => {
        if (!cancelled) {
          setPoints(res.points);
          setHoverPoint(res.points.length > 0 ? res.points[res.points.length - 1] : null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingChart(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId, timestep]);

  // Synchronized Two-Pane Chart: Top = High/Low Price + VWAP lines, Bottom = Dedicated Buy (+) vs Sell (-) Volume
  useEffect(() => {
    if (!priceContainerRef.current || !volContainerRef.current || points.length === 0) return;

    const pointByTs = new Map<number, ChartPoint>();
    for (const p of points) {
      pointByTs.set(p.timestamp, p);
    }

    const commonOpts = {
      layout: {
        background: { type: ColorType.Solid, color: '#070709' },
        textColor: '#a1a1aa',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      crosshair: {
        vertLine: { color: 'rgba(255,255,255,0.22)', labelBackgroundColor: '#18181b' },
        horzLine: { color: 'rgba(255,255,255,0.18)', labelBackgroundColor: '#18181b' },
      },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.07)', minimumWidth: 72 },
    };

    const priceChart = createChart(priceContainerRef.current, {
      ...commonOpts,
      width: priceContainerRef.current.clientWidth,
      height: 295,
      timeScale: { visible: false, borderColor: 'rgba(255,255,255,0.07)' },
    });

    const volChart = createChart(volContainerRef.current, {
      ...commonOpts,
      width: volContainerRef.current.clientWidth,
      height: 155,
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: 'rgba(255,255,255,0.07)' },
    });

    const highSeries = priceChart.addLineSeries({
      color: '#f59e0b',
      lineWidth: 2,
      title: 'High',
    });
    const lowSeries = priceChart.addLineSeries({
      color: '#e4e4e7',
      lineWidth: 2,
      title: 'Low',
    });

    const highData = points
      .filter((p) => p.avgHighPrice !== null)
      .map((p) => ({ time: p.timestamp as never, value: p.avgHighPrice as number }));
    const lowData = points
      .filter((p) => p.avgLowPrice !== null)
      .map((p) => ({ time: p.timestamp as never, value: p.avgLowPrice as number }));

    highSeries.setData(highData);
    lowSeries.setData(lowData);

    // Optional VWAP reference lines so you can literally see the Dump Sniper mean-reversion baseline
    if (showVwapLines && item) {
      if (item.vwap_24h && item.vwap_24h > 0) {
        highSeries.createPriceLine({
          price: Math.round(item.vwap_24h),
          color: '#38bdf8',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: '24h VWAP',
        });
      }
      if (item.vwap_7d && item.vwap_7d > 0) {
        highSeries.createPriceLine({
          price: Math.round(item.vwap_7d),
          color: '#a78bfa',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: '7d VWAP',
        });
      }
    }

    // Bottom Pane: Diverging Buy Volume (Emerald UP) vs Sell Volume (Rose DOWN)
    const buyVolSeries = volChart.addHistogramSeries({
      color: 'rgba(16, 185, 129, 0.85)',
      priceFormat: {
        type: 'custom',
        formatter: (val: number) => `${Math.round(Math.abs(val)).toLocaleString()}`,
      },
      title: 'Buy Vol',
    });
    const sellVolSeries = volChart.addHistogramSeries({
      color: 'rgba(244, 63, 94, 0.85)',
      priceFormat: {
        type: 'custom',
        formatter: (val: number) => `${Math.round(Math.abs(val)).toLocaleString()}`,
      },
      title: 'Sell Vol',
    });

    buyVolSeries.setData(
      points.map((p) => ({
        time: p.timestamp as never,
        value: p.highPriceVolume || 0,
        color: 'rgba(16, 185, 129, 0.82)',
      })),
    );
    sellVolSeries.setData(
      points.map((p) => ({
        time: p.timestamp as never,
        value: -(p.lowPriceVolume || 0),
        color: 'rgba(244, 63, 94, 0.82)',
      })),
    );

    priceChart.timeScale().fitContent();
    volChart.timeScale().fitContent();

    // Two-way time-range sync between Price and Volume panes
    let syncing = false;
    priceChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (syncing || !range) return;
      syncing = true;
      volChart.timeScale().setVisibleLogicalRange(range);
      syncing = false;
    });
    volChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (syncing || !range) return;
      syncing = true;
      priceChart.timeScale().setVisibleLogicalRange(range);
      syncing = false;
    });

    // Live hover legend sync from either pane
    const handleHover = (param: { time?: unknown }) => {
      if (typeof param.time === 'number') {
        const pt = pointByTs.get(param.time);
        if (pt) setHoverPoint(pt);
      } else if (points.length > 0) {
        setHoverPoint(points[points.length - 1]);
      }
    };
    priceChart.subscribeCrosshairMove(handleHover);
    volChart.subscribeCrosshairMove(handleHover);

    const onResize = () => {
      if (priceContainerRef.current) {
        priceChart.applyOptions({ width: priceContainerRef.current.clientWidth });
      }
      if (volContainerRef.current) {
        volChart.applyOptions({ width: volContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      priceChart.remove();
      volChart.remove();
    };
  }, [points, showVwapLines, item?.vwap_24h, item?.vwap_7d]);

  if (!itemId) return null;

  const safeBuy = Math.max(0, Math.floor(buyInput || 0));
  const safeSell = Math.max(0, Math.floor(sellInput || 0));
  const safeQty = Math.max(1, Math.floor(qtyInput || 1));
  const taxUnit = computeGeTax(safeSell, Boolean(item?.is_tax_exempt));
  const netUnit = safeSell - safeBuy - taxUnit;
  const totalCost = safeBuy * safeQty;
  const totalTax = taxUnit * safeQty;
  const totalNetProfit = netUnit * safeQty;
  const netRoiPct = safeBuy > 0 ? (netUnit / safeBuy) * 100 : 0;

  const copyVal = (kind: 'buy' | 'sell', val: number) => {
    navigator.clipboard.writeText(String(val));
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1200);
  };

  const handleSubmit = async () => {
    if (!item || safeBuy <= 0 || safeSell <= 0 || safeQty <= 0) return;
    setSubmitting(true);
    try {
      await onStartCustomFlip({
        item_id: item.id,
        item_name: item.name,
        quantity: safeQty,
        buy_price: safeBuy,
        target_sell_price: safeSell,
        flip_mode: flipMode,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const displayPt = hoverPoint || (points.length > 0 ? points[points.length - 1] : null);
  const volRows = item
    ? [
        { label: '5m', buy: item.vol_5m_high, sell: item.vol_5m_low, total: item.vol_5m },
        { label: '1h', buy: item.vol_1h_high, sell: item.vol_1h_low, total: item.vol_1h },
        { label: '24h', buy: item.vol_24h_high, sell: item.vol_24h_low, total: item.vol_24h },
      ]
    : [];

  const limitTurnover1h =
    item && item.buy_limit > 0 && item.vol_1h > 0 ? (item.vol_1h / item.buy_limit).toFixed(1) : null;

  const bounceBadgeCls =
    item?.dump_bounce_outlook === 'HIGH'
      ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
      : item?.dump_bounce_outlook === 'MEDIUM'
        ? 'border-amber-500/30 bg-amber-500/15 text-amber-300'
        : item?.dump_bounce_outlook === 'LOW'
          ? 'border-rose-500/35 bg-rose-500/15 text-rose-300'
          : 'border-white/10 bg-zinc-900 text-zinc-400';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-5 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[94vh] w-full max-w-[1340px] flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0a0a0d] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] bg-[#0c0c10] px-5 py-3.5">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[0.1] bg-[#141419]">
              {item?.icon && <img src={wikiIconUrl(item.icon)} alt="" className="h-8 w-8 object-contain" />}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-zinc-100 truncate">{item?.name || `Item #${itemId}`}</h2>
                {item?.is_tax_exempt && (
                  <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                    0% TAX EXEMPT
                  </span>
                )}
                {item?.is_mega_rare_capped && (
                  <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                    5M TAX CAP
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">
                ID #{itemId} · {item?.members ? 'Members' : 'F2P'} · 4h GE Limit:{' '}
                <strong className="text-zinc-200">{item?.buy_limit?.toLocaleString() || '—'}</strong>
                {limitTurnover1h && (
                  <span className="text-emerald-400"> · 1h Vol = {limitTurnover1h}× limit</span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {item && (
              <div className="hidden sm:flex items-center gap-4 text-xs tabular-nums border-r border-white/[0.08] pr-4">
                <div>
                  <div className="text-[10px] text-zinc-500">LIVE LOW (BID)</div>
                  <div className="font-bold text-zinc-100">
                    {formatGp(item.low)}{' '}
                    <span className="text-[10px] font-normal text-zinc-500">({formatAge(item.low_age_sec)})</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-zinc-500">LIVE HIGH (ASK)</div>
                  <div className="font-bold text-amber-300">
                    {formatGp(item.high)}{' '}
                    <span className="text-[10px] font-normal text-zinc-500">({formatAge(item.high_age_sec)})</span>
                  </div>
                </div>
              </div>
            )}
            <button
              onClick={onClose}
              className="rounded-xl border border-white/[0.08] bg-zinc-900 p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              title="Close (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body: Spacious 2-Column Layout */}
        <div className="grid flex-1 grid-cols-1 gap-5 overflow-y-auto p-5 lg:grid-cols-[1.68fr_1fr]">
          {/* LEFT COLUMN: Synced 2-Pane Chart (Price + Dedicated Buy/Sell Volume) + Volume Breakdown */}
          <div className="space-y-3.5 min-w-0">
            {/* Controls + Live Crosshair Readout */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {TIMEFRAMES.map((tf) => (
                  <button
                    key={tf.key}
                    onClick={() => setTimestep(tf.key)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      timestep === tf.key
                        ? 'bg-zinc-100 text-zinc-950'
                        : 'border border-white/[0.06] bg-[#111115] text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                    }`}
                  >
                    {tf.label}
                  </button>
                ))}
                <label className="ml-2 flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showVwapLines}
                    onChange={(e) => setShowVwapLines(e.target.checked)}
                    className="accent-sky-400"
                  />
                  <span>VWAP lines</span>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-amber-400" /> High
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-zinc-200" /> Low
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-emerald-400" /> Buy Vol ↑
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-rose-400" /> Sell Vol ↓
                </span>
                {loadingChart && <span className="text-amber-300">Loading...</span>}
              </div>
            </div>

            {/* Live Hover Legend Strip */}
            {displayPt && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-[#0f0f13] px-3.5 py-2 text-xs tabular-nums">
                <span className="text-zinc-400 font-medium">
                  {new Date(displayPt.timestamp * 1000).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <div className="flex flex-wrap items-center gap-4">
                  <span>
                    <span className="text-zinc-500">High </span>
                    <strong className="text-amber-300">{formatGp(displayPt.avgHighPrice)}</strong>
                  </span>
                  <span>
                    <span className="text-zinc-500">Low </span>
                    <strong className="text-zinc-100">{formatGp(displayPt.avgLowPrice)}</strong>
                  </span>
                  <span>
                    <span className="text-zinc-500">Instant-Buys </span>
                    <strong className="text-emerald-400">+{displayPt.highPriceVolume.toLocaleString()}</strong>
                  </span>
                  <span>
                    <span className="text-zinc-500">Instant-Sells </span>
                    <strong className="text-rose-400">-{displayPt.lowPriceVolume.toLocaleString()}</strong>
                  </span>
                  <span>
                    <span className="text-zinc-500">Net Flow </span>
                    <strong
                      className={
                        displayPt.highPriceVolume - displayPt.lowPriceVolume >= 0
                          ? 'text-emerald-300'
                          : 'text-rose-300'
                      }
                    >
                      {displayPt.highPriceVolume - displayPt.lowPriceVolume >= 0 ? '+' : ''}
                      {(displayPt.highPriceVolume - displayPt.lowPriceVolume).toLocaleString()}
                    </strong>
                  </span>
                </div>
              </div>
            )}

            {/* Synchronized Dual-Pane Chart Container */}
            <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#070709]">
              <div ref={priceContainerRef} className="w-full" />
              <div className="flex items-center justify-between border-y border-white/[0.06] bg-[#0b0b0f] px-3 py-1 text-[10px] uppercase tracking-wider text-zinc-500">
                <span>Buy vs. Sell Volume (Emerald ↑ = Instant-Buys into Sell Offers · Rose ↓ = Instant-Sells into Buy Offers)</span>
              </div>
              <div ref={volContainerRef} className="w-full" />
            </div>

            {/* Dedicated Buy vs. Sell Volume Breakdown (5m / 1h / 24h) */}
            {item && (
              <div className="rounded-xl border border-white/[0.07] bg-[#0f0f13] p-3.5">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                    Buy vs. Sell Volume Breakdown
                  </span>
                  <span className="text-[11px] text-zinc-500 tabular-nums">
                    5m Vol Spike: <strong className={item.volume_spike_ratio >= 2 ? 'text-amber-300' : 'text-zinc-300'}>{item.volume_spike_ratio.toFixed(1)}×</strong> normal
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  {volRows.map((row) => {
                    const buyPct = row.total > 0 ? Math.round((row.buy / row.total) * 100) : 50;
                    const sellPct = 100 - buyPct;
                    return (
                      <div key={row.label} className="rounded-lg border border-white/[0.05] bg-[#070709] p-2.5 text-xs tabular-nums">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-zinc-200">{row.label} Window</span>
                          <span className="text-zinc-400">Total: <strong className="text-zinc-100">{row.total.toLocaleString()}</strong></span>
                        </div>
                        <div className="mt-1.5 flex justify-between text-[11px]">
                          <span className="text-emerald-400 font-semibold">Buy: {row.buy.toLocaleString()} ({buyPct}%)</span>
                          <span className="text-rose-400 font-semibold">Sell: {row.sell.toLocaleString()} ({sellPct}%)</span>
                        </div>
                        <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-rose-500/60">
                          <div className="h-full bg-emerald-400" style={{ width: `${buyPct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Mean-Reversion / Dump Sniper Explainer Panel */}
            {item && (
              <div className="rounded-xl border border-white/[0.08] bg-[#0f0f13] p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Flame className="h-4 w-4 text-rose-400" />
                    <span className="text-xs font-bold text-zinc-100">
                      Mean-Reversion & Dump Analysis (Hourly Candles)
                    </span>
                  </div>
                  <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${bounceBadgeCls}`}>
                    Bounce Outlook: {item.dump_bounce_outlook || 'NONE'}
                  </span>
                </div>

                <p className="text-[11px] leading-relaxed text-zinc-400 flex items-start gap-1.5">
                  <Info className="h-3.5 w-3.5 text-sky-400 shrink-0 mt-0.5" />
                  <span>
                    Standard deviation (σ) is measured over <strong>hourly (/1h) candles</strong>:{' '}
                    <strong>24h</strong> = last 24 hourly candles (1σ = {formatGp(item.std_24h ? Math.round(item.std_24h) : 0)} gp),{' '}
                    <strong>7d</strong> = last {item.candles_1h_count || 24} hourly candles (1σ = {formatGp(item.std_7d ? Math.round(item.std_7d) : 0)} gp).{' '}
                    {item.dump_bounce_reason}
                  </span>
                </p>

                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 text-xs tabular-nums">
                  <div className="rounded-lg border border-white/[0.05] bg-[#070709] p-2.5">
                    <div className="text-[10px] text-sky-400">24h Hourly VWAP</div>
                    <div className="mt-0.5 font-bold text-zinc-100">{formatGp(item.vwap_24h ? Math.round(item.vwap_24h) : null)}</div>
                    <div className={`text-[10px] ${item.zscore_24h <= -1.6 ? 'text-rose-400 font-bold' : 'text-zinc-500'}`}>
                      Z = {item.zscore_24h.toFixed(2)}σ
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/[0.05] bg-[#070709] p-2.5">
                    <div className="text-[10px] text-violet-400">7d Hourly VWAP</div>
                    <div className="mt-0.5 font-bold text-zinc-100">{formatGp(item.vwap_7d ? Math.round(item.vwap_7d) : null)}</div>
                    <div className={`text-[10px] ${item.zscore_7d <= -1.6 ? 'text-rose-400 font-bold' : 'text-zinc-500'}`}>
                      Z = {item.zscore_7d.toFixed(2)}σ
                    </div>
                  </div>
                  <button
                    onClick={() => item.dump_conservative_target && setSellInput(item.dump_conservative_target)}
                    disabled={!item.dump_conservative_target}
                    className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-2.5 text-left hover:bg-emerald-500/15 disabled:opacity-40 transition"
                    title="Click to load Safe Bounce Target into calculator"
                  >
                    <div className="text-[10px] text-emerald-300">Safe Bounce Target ↗</div>
                    <div className="mt-0.5 font-bold text-emerald-200">{formatGp(item.dump_conservative_target)}</div>
                    <div className="text-[10px] text-emerald-400/80">99% of lower VWAP</div>
                  </button>
                  <button
                    onClick={() => item.dump_full_target && setSellInput(item.dump_full_target)}
                    disabled={!item.dump_full_target}
                    className="rounded-lg border border-violet-500/25 bg-violet-500/10 p-2.5 text-left hover:bg-violet-500/15 disabled:opacity-40 transition"
                    title="Click to load Full 7d Rebound Target into calculator"
                  >
                    <div className="text-[10px] text-violet-300">Full 7d Rebound ↗</div>
                    <div className="mt-0.5 font-bold text-violet-200">{formatGp(item.dump_full_target)}</div>
                    <div className="text-[10px] text-violet-400/80">98.5% of 7d VWAP</div>
                  </button>
                </div>
              </div>
            )}

            {/* Risk flags if present */}
            {item && item.manipulation_flags.length > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                <span>
                  Caution flags: <strong>{item.manipulation_flags.join(' · ')}</strong>
                </span>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: Interactive Flip Calculator & Order Ticket + Key Scores */}
          <div className="flex flex-col justify-between rounded-2xl border border-white/[0.08] bg-[#0f0f13] p-5">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-white/[0.07] pb-3">
                <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
                  <TrendingUp className="h-4 w-4 text-emerald-400" /> Flip Calculator & Order Ticket
                </h3>
                <span className="text-[11px] text-zinc-500 tabular-nums">
                  Slot Budget: <strong className="text-zinc-300">{formatGp(slotBudget, true)}</strong>
                </span>
              </div>

              {/* Buy Price Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-zinc-400">Buy Price (GP)</label>
                  <div className="flex items-center gap-1.5 text-[11px]">
                    {item?.low && (
                      <>
                        <button
                          onClick={() => setBuyInput(item.low!)}
                          className="rounded-md bg-zinc-900 px-2 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                        >
                          Low
                        </button>
                        <button
                          onClick={() => setBuyInput(item.low! + 1)}
                          className="rounded-md bg-zinc-900 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                        >
                          Low +1
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => copyVal('buy', safeBuy)}
                      className="flex items-center gap-1 rounded-md bg-zinc-900 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800"
                    >
                      {copied === 'buy' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                      Copy
                    </button>
                  </div>
                </div>
                <input
                  type="number"
                  min={1}
                  value={buyInput || ''}
                  onChange={(e) => setBuyInput(Number(e.target.value))}
                  className="w-full rounded-xl border border-white/[0.1] bg-[#060608] px-3.5 py-2.5 text-base font-bold text-zinc-100 outline-none focus:border-white/30 tabular-nums"
                />
              </div>

              {/* Sell Price Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-zinc-400">Target Sell Price (GP)</label>
                  <div className="flex items-center gap-1.5 text-[11px]">
                    {item?.high && (
                      <>
                        <button
                          onClick={() => setSellInput(Math.max(1, item.high! - 1))}
                          className="rounded-md bg-zinc-900 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                        >
                          High -1
                        </button>
                        <button
                          onClick={() => setSellInput(item.high!)}
                          className="rounded-md bg-zinc-900 px-2 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                        >
                          High
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => copyVal('sell', safeSell)}
                      className="flex items-center gap-1 rounded-md bg-zinc-900 px-2 py-0.5 text-amber-300 hover:bg-zinc-800"
                    >
                      {copied === 'sell' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                      Copy
                    </button>
                  </div>
                </div>
                <input
                  type="number"
                  min={1}
                  value={sellInput || ''}
                  onChange={(e) => setSellInput(Number(e.target.value))}
                  className="w-full rounded-xl border border-white/[0.1] bg-[#060608] px-3.5 py-2.5 text-base font-bold text-amber-300 outline-none focus:border-amber-400/50 tabular-nums"
                />
              </div>

              {/* Quantity Input + Quick Sizing */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-zinc-400">Quantity</label>
                  <div className="flex items-center gap-1 text-[11px]">
                    <button
                      onClick={() => {
                        const affordable = safeBuy > 0 ? Math.max(1, Math.floor(slotBudget / safeBuy)) : 1;
                        const lim = item?.buy_limit && item.buy_limit > 0 ? item.buy_limit : affordable;
                        setQtyInput(Math.min(lim, affordable));
                      }}
                      className="rounded-md bg-zinc-900 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800"
                    >
                      Slot Budget
                    </button>
                    {item?.buy_limit && item.buy_limit > 0 && (
                      <button
                        onClick={() => setQtyInput(item.buy_limit)}
                        className="rounded-md bg-zinc-900 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800"
                      >
                        Max ({item.buy_limit.toLocaleString()})
                      </button>
                    )}
                    <button
                      onClick={() => setQtyInput(1)}
                      className="rounded-md bg-zinc-900 px-2 py-0.5 text-zinc-400 hover:bg-zinc-800"
                    >
                      1x
                    </button>
                  </div>
                </div>
                <input
                  type="number"
                  min={1}
                  value={qtyInput || ''}
                  onChange={(e) => setQtyInput(Number(e.target.value))}
                  className="w-full rounded-xl border border-white/[0.1] bg-[#060608] px-3.5 py-2.5 text-base font-bold text-zinc-100 outline-none focus:border-white/30 tabular-nums"
                />
              </div>

              {/* Live 2% Post-Tax Profit Breakdown */}
              <div className="rounded-xl border border-white/[0.08] bg-[#060608] p-4 space-y-2.5 text-xs tabular-nums">
                <div className="flex justify-between text-zinc-400">
                  <span>Capital Required</span>
                  <strong className="text-zinc-100">{formatGp(totalCost)} gp</strong>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>2% GE Tax ({item?.is_tax_exempt ? 'Exempt' : `${formatGp(taxUnit)}/ea`})</span>
                  <strong className="text-rose-400">-{formatGp(totalTax)} gp</strong>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Net Margin / Unit</span>
                  <strong className={netUnit >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                    {formatSignedGp(netUnit)} gp
                  </strong>
                </div>
                <div className="border-t border-white/[0.08] pt-2.5 flex items-baseline justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Est. Net Profit</span>
                  <div className="text-right">
                    <div className={`text-xl font-black ${totalNetProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {formatSignedGp(totalNetProfit)} gp
                    </div>
                    <div className="text-[11px] text-zinc-500">{netRoiPct.toFixed(2)}% net ROI</div>
                  </div>
                </div>
              </div>

              {/* Compact Strategy Scores + High Alch */}
              {item && (
                <div className="grid grid-cols-4 gap-1.5 rounded-xl border border-white/[0.07] bg-[#060608] p-3 text-center text-xs tabular-nums">
                  <div>
                    <div className="text-[9px] text-zinc-500">FAST</div>
                    <div className="mt-0.5 font-bold text-emerald-400">{Math.round(item.fast_flip_score)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-zinc-500">MARGIN</div>
                    <div className="mt-0.5 font-bold text-zinc-200">{Math.round(item.overnight_score)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-zinc-500">DUMP</div>
                    <div className="mt-0.5 font-bold text-rose-400">{Math.round(item.dump_sniper_score)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-zinc-500">SAFETY</div>
                    <div className="mt-0.5 font-bold text-amber-300">{item.safety_score}</div>
                  </div>
                </div>
              )}
            </div>

            {/* Coach Mode Selector + Submit CTA */}
            <div className="mt-5 space-y-2.5">
              <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-white/[0.08] bg-[#060608] p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setFlipMode('active')}
                  className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 font-semibold transition ${
                    flipMode === 'active'
                      ? 'bg-white/[0.12] text-white'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <Zap className="h-3.5 w-3.5 text-amber-400" /> Active Coach
                </button>
                <button
                  type="button"
                  onClick={() => setFlipMode('overnight')}
                  className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 font-semibold transition ${
                    flipMode === 'overnight'
                      ? 'bg-indigo-500/25 text-indigo-200'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <Moon className="h-3.5 w-3.5 text-indigo-300" /> Overnight Coach
                </button>
              </div>
              <button
                onClick={handleSubmit}
                disabled={submitting || slotsFull || safeBuy <= 0 || safeSell <= 0}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-100 py-3 text-sm font-bold text-zinc-950 hover:bg-white disabled:opacity-40 transition"
              >
                <Play className="h-4 w-4 fill-current" />
                {slotsFull
                  ? 'All 8 GE Slots Full'
                  : submitting
                    ? 'Assigning Slot...'
                    : `Start ${flipMode === 'overnight' ? 'Overnight' : 'Flip'} (${safeQty.toLocaleString()}x @ ${formatGp(safeBuy)})`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
