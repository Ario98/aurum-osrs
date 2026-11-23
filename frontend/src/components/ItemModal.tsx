import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, ColorType, type IChartApi } from 'lightweight-charts';
import { AlertTriangle, Check, Copy, Play, TrendingUp, X } from 'lucide-react';
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

  // Interactive Order Ticket state
  const [buyInput, setBuyInput] = useState<number>(0);
  const [sellInput, setSellInput] = useState<number>(0);
  const [qtyInput, setQtyInput] = useState<number>(1);
  const [copied, setCopied] = useState<'buy' | 'sell' | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const slotBudget = useMemo(() => {
    const denom = Math.max(1, Math.min(freeSlots || 1, 8));
    return Math.floor(cashStack / denom);
  }, [cashStack, freeSlots]);

  // Close on Escape
  useEffect(() => {
    if (!itemId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [itemId, onClose]);

  // Load item details & initialize calculator
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

  // Load chart candles lazily
  useEffect(() => {
    if (!itemId) return;
    let cancelled = false;
    setLoadingChart(true);
    api
      .itemChart(itemId, timestep)
      .then((res) => {
        if (!cancelled) setPoints(res.points);
      })
      .finally(() => {
        if (!cancelled) setLoadingChart(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId, timestep]);

  // Render TradingView lightweight-charts
  useEffect(() => {
    if (!chartContainerRef.current || points.length === 0) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#070709' },
        textColor: '#a1a1aa',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      crosshair: {
        vertLine: { color: 'rgba(255,255,255,0.2)', labelBackgroundColor: '#18181b' },
        horzLine: { color: 'rgba(255,255,255,0.2)', labelBackgroundColor: '#18181b' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 390,
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: 'rgba(255,255,255,0.07)' },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.07)' },
    });
    chartRef.current = chart;

    const highSeries = chart.addLineSeries({
      color: '#f59e0b',
      lineWidth: 2,
      title: 'High (Sell)',
    });
    const lowSeries = chart.addLineSeries({
      color: '#e4e4e7',
      lineWidth: 2,
      title: 'Low (Buy)',
    });
    const volSeries = chart.addHistogramSeries({
      color: 'rgba(16, 185, 129, 0.25)',
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    volSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    const highData = points
      .filter((p) => p.avgHighPrice !== null)
      .map((p) => ({ time: p.timestamp as never, value: p.avgHighPrice as number }));
    const lowData = points
      .filter((p) => p.avgLowPrice !== null)
      .map((p) => ({ time: p.timestamp as never, value: p.avgLowPrice as number }));
    const volData = points.map((p) => ({
      time: p.timestamp as never,
      value: (p.highPriceVolume || 0) + (p.lowPriceVolume || 0),
      color:
        (p.highPriceVolume || 0) >= (p.lowPriceVolume || 0)
          ? 'rgba(16, 185, 129, 0.32)'
          : 'rgba(244, 63, 94, 0.32)',
    }));

    highSeries.setData(highData);
    lowSeries.setData(lowData);
    volSeries.setData(volData);
    chart.timeScale().fitContent();

    const onResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [points]);

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
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const ofiPct = item ? Math.round(((item.ofi_1h + 1) / 2) * 100) : 50;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-[1280px] flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0a0a0d] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] bg-[#0c0c10] px-5 py-4">
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
                {item?.examine && <span className="hidden md:inline text-zinc-600"> · {item.examine}</span>}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {item && (
              <div className="hidden sm:flex items-center gap-4 text-xs tabular-nums border-r border-white/[0.08] pr-4">
                <div>
                  <div className="text-[10px] text-zinc-500">LIVE LOW (BID)</div>
                  <div className="font-bold text-zinc-100">
                    {formatGp(item.low)} <span className="text-[10px] font-normal text-zinc-500">({formatAge(item.low_age_sec)})</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-zinc-500">LIVE HIGH (ASK)</div>
                  <div className="font-bold text-amber-300">
                    {formatGp(item.high)} <span className="text-[10px] font-normal text-zinc-500">({formatAge(item.high_age_sec)})</span>
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
        <div className="grid flex-1 grid-cols-1 gap-5 overflow-y-auto p-5 lg:grid-cols-[1.65fr_1fr]">
          {/* LEFT COLUMN: Widescreen Chart + Market Microstructure */}
          <div className="space-y-4 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-1.5">
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
              </div>
              <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-amber-400" /> High (Sell)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-zinc-200" /> Low (Buy)
                </span>
                {loadingChart && <span className="text-amber-300">Loading...</span>}
              </div>
            </div>

            <div
              ref={chartContainerRef}
              className="w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-[#070709]"
            />

            {/* Risk flags if present */}
            {item && item.manipulation_flags.length > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                <span>Caution flags: <strong>{item.manipulation_flags.join(' · ')}</strong></span>
              </div>
            )}

            {/* Market Microstructure Metrics Strip */}
            {item && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 text-xs tabular-nums">
                  <MetricTile
                    label="24h Volume"
                    value={item.vol_24h.toLocaleString()}
                    sub={`1h: ${item.vol_1h.toLocaleString()} · 5m: ${item.vol_5m.toLocaleString()}`}
                  />
                  <MetricTile
                    label="7d VWAP / Z-Score"
                    value={formatGp(item.vwap_7d ? Math.round(item.vwap_7d) : null)}
                    sub={`Z: ${item.zscore_7d.toFixed(2)}σ · Vol: ${item.volatility_24h_pct.toFixed(1)}%`}
                    accent={item.zscore_7d <= -1.6 ? 'text-rose-400' : 'text-zinc-100'}
                  />
                  <MetricTile
                    label="Max Profit / Limit"
                    value={formatGp(item.max_profit_per_limit, true)}
                    sub={`Est: ${formatGp(item.est_gp_per_hour_limit, true)}/hr`}
                    accent="text-emerald-400"
                  />
                  <MetricTile
                    label="High Alch Floor"
                    value={formatGp(item.highalch)}
                    sub={item.alch_floor_pct !== null ? `Cushion: ${item.alch_floor_pct.toFixed(1)}%` : 'No alch'}
                  />
                </div>

                {/* Order-Flow Pressure Bar + Strategy Scores */}
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div className="rounded-xl border border-white/[0.07] bg-[#0f0f13] p-3">
                    <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-2">
                      <span>Order-Flow Pressure (1h)</span>
                      <span className={item.ofi_1h >= 0 ? 'font-bold text-emerald-400' : 'font-bold text-rose-400'}>
                        {item.ofi_1h >= 0 ? '+' : ''}
                        {(item.ofi_1h * 100).toFixed(0)}% {item.ofi_1h > 0.25 ? '(Buying)' : item.ofi_1h < -0.25 ? '(Selling)' : '(Balanced)'}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-rose-500/35">
                      <div className="h-full bg-emerald-400 transition-all" style={{ width: `${ofiPct}%` }} />
                    </div>
                    <div className="mt-1.5 flex justify-between text-[10px] text-zinc-500 tabular-nums">
                      <span>Instant-Sells: {item.vol_1h_low.toLocaleString()}</span>
                      <span>Instant-Buys: {item.vol_1h_high.toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-1.5 rounded-xl border border-white/[0.07] bg-[#0f0f13] p-3 text-center text-xs tabular-nums">
                    <div>
                      <div className="text-[9px] text-zinc-500">FAST</div>
                      <div className="mt-1 text-sm font-bold text-emerald-400">{Math.round(item.fast_flip_score)}</div>
                    </div>
                    <div>
                      <div className="text-[9px] text-zinc-500">MARGIN</div>
                      <div className="mt-1 text-sm font-bold text-zinc-200">{Math.round(item.overnight_score)}</div>
                    </div>
                    <div>
                      <div className="text-[9px] text-zinc-500">DUMP</div>
                      <div className="mt-1 text-sm font-bold text-rose-400">{Math.round(item.dump_sniper_score)}</div>
                    </div>
                    <div>
                      <div className="text-[9px] text-zinc-500">SAFETY</div>
                      <div className="mt-1 text-sm font-bold text-amber-300">{item.safety_score}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: Interactive Flip Calculator & Order Ticket */}
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
            </div>

            {/* Submit CTA */}
            <div className="mt-5">
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
                    : `Start Flip (${safeQty.toLocaleString()}x @ ${formatGp(safeBuy)})`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  sub,
  accent = 'text-zinc-100',
}: {
  label: string;
  value: string;
  sub: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-[#0f0f13] p-3">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-1 text-sm font-bold ${accent}`}>{value}</div>
      <div className="mt-0.5 text-[10px] text-zinc-500">{sub}</div>
    </div>
  );
}
