import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  LineStyle,
  LineType,
  type IPriceLine,
  type ISeriesApi,
} from 'lightweight-charts';
import {
  AlertTriangle,
  ArrowLeft,
  Brain,
  Check,
  Copy,
  Flame,
  Info,
  Maximize2,
  Minimize2,
  Moon,
  RefreshCw,
  Star,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { api } from '../api/client';
import { InfoTooltip } from '../components/InfoTooltip';
import { getAiVerdict } from '../components/MLSignalBadge';
import type { ChartPoint, ItemMetrics } from '../types';
import { formatAge, formatGp, formatSignedGp, wikiIconUrl } from '../utils/format';

interface Props {
  itemId: number;
  backLabel: string;
  cashStack: number;
  maxSlots: number;
  isStarred: boolean;
  tickVersion: number;
  onBack: () => void;
  onToggleStar: (item: { id: number; name: string; low?: number | null }) => Promise<void>;
}

type ChartWindow = '6h' | '24h' | '7d' | '30d' | '90d' | '1y';

const TIMEFRAMES: { key: ChartWindow; label: string; hint: string }[] = [
  { key: '6h', label: '6H', hint: '6 hours (5m candles)' },
  { key: '24h', label: '24H', hint: '24 hours (5m candles)' },
  { key: '7d', label: '7D', hint: '7 days (1h candles)' },
  { key: '30d', label: '30D', hint: '30 days (1h candles)' },
  { key: '90d', label: '90D', hint: '90 days (6h candles)' },
  { key: '1y', label: '1Y', hint: '1 year (24h candles)' },
];

function computeGeTax(sellPrice: number, isTaxExempt: boolean): number {
  if (isTaxExempt || sellPrice < 50) return 0;
  return Math.min(Math.floor(sellPrice * 0.02), 5_000_000);
}

function formatAxisGp(val: number): string {
  const abs = Math.abs(val);
  if (abs < 10_000) return `${Math.round(val).toLocaleString()}`;
  if (abs < 1_000_000) {
    const k = val / 1_000;
    return `${Math.abs(k) >= 100 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  if (abs < 1_000_000_000) {
    const m = val / 1_000_000;
    return `${Math.abs(m) >= 100 ? m.toFixed(1) : m.toFixed(2)}M`;
  }
  return `${(val / 1_000_000_000).toFixed(2)}B`;
}

export function ItemDetail({
  itemId,
  backLabel,
  cashStack,
  maxSlots,
  isStarred,
  tickVersion,
  onBack,
  onToggleStar,
}: Props) {
  const [item, setItem] = useState<ItemMetrics | null>(null);
  const [loadingItem, setLoadingItem] = useState(true);
  const [chartWindow, setChartWindow] = useState<ChartWindow>('24h');
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [loadingChart, setLoadingChart] = useState(false);
  const [chartReloadNonce, setChartReloadNonce] = useState(0);

  // Chart display toggles
  const [showVwapLines, setShowVwapLines] = useState(true);
  const [trimOutliers, setTrimOutliers] = useState(true);
  const [showOrderLines, setShowOrderLines] = useState(true);
  const [chartExpanded, setChartExpanded] = useState(false);
  const [hoverPoint, setHoverPoint] = useState<ChartPoint | null>(null);

  // Read-only Tax & Profit Calculator state (preserved across 10s live ticks)
  const [buyInput, setBuyInput] = useState<number>(0);
  const [sellInput, setSellInput] = useState<number>(0);
  const [qtyInput, setQtyInput] = useState<number>(1);
  const [flipMode, setFlipMode] = useState<'active' | 'overnight'>('active');
  const [copied, setCopied] = useState<'buy' | 'sell' | null>(null);

  const initializedItemRef = useRef<number | null>(null);
  const chartFrameRef = useRef<HTMLDivElement | null>(null);
  const priceContainerRef = useRef<HTMLDivElement | null>(null);
  const volContainerRef = useRef<HTMLDivElement | null>(null);
  const highSeriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const buyLineRef = useRef<IPriceLine | null>(null);
  const sellLineRef = useRef<IPriceLine | null>(null);
  const [chartMountVersion, setChartMountVersion] = useState(0);

  const slotBudget = useMemo(() => {
    const denom = Math.max(1, Math.min(maxSlots || 1, 8));
    return Math.floor(cashStack / denom);
  }, [cashStack, maxSlots]);

  // Escape navigates back when not typing inside an input
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  // Reset timeframe & scroll to top when switching items
  useEffect(() => {
    setChartWindow('24h');
    setItem(null);
    setLoadingItem(true);
    initializedItemRef.current = null;
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [itemId]);

  // Live 10s refresh of item metrics (initializes Order Ticket only on item switch)
  useEffect(() => {
    let cancelled = false;
    api
      .itemDetail(itemId)
      .then((d) => {
        if (cancelled) return;
        setItem(d);
        if (initializedItemRef.current !== itemId) {
          initializedItemRef.current = itemId;
          const initBuy = d.suggested_buy || d.low || d.high || 1;
          const initSell = d.suggested_sell || d.high || d.low || 1;
          setBuyInput(initBuy);
          setSellInput(initSell);
          const limit = d.buy_limit > 0 ? d.buy_limit : 1000;
          const affordable = initBuy > 0 ? Math.floor(slotBudget / initBuy) : 1;
          setQtyInput(Math.max(1, Math.min(limit, affordable || 1)));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingItem(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId, tickVersion, slotBudget]);

  // Fetch chart candles
  useEffect(() => {
    let cancelled = false;
    setLoadingChart(true);
    api
      .itemChart(itemId, chartWindow)
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
  }, [itemId, chartWindow, chartReloadNonce]);

  // Synchronized Two-Pane TradingView Chart
  useEffect(() => {
    if (!priceContainerRef.current || !volContainerRef.current || points.length === 0) return;

    const pointByTs = new Map<number, ChartPoint>();
    for (const p of points) {
      pointByTs.set(p.timestamp, p);
    }

    const isWide = window.innerWidth >= 1024;
    const priceHeight = isWide ? Math.max(420, Math.min(540, Math.round(window.innerHeight * 0.5))) : 300;
    const volHeight = isWide ? 145 : 115;

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
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.07)', minimumWidth: 76 },
    };

    const priceChart = createChart(priceContainerRef.current, {
      ...commonOpts,
      width: priceContainerRef.current.clientWidth,
      height: priceHeight,
      timeScale: { visible: false, borderColor: 'rgba(255,255,255,0.07)' },
    });

    const volChart = createChart(volContainerRef.current, {
      ...commonOpts,
      width: volContainerRef.current.clientWidth,
      height: volHeight,
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: 'rgba(255,255,255,0.07)' },
    });

    const highData = points
      .filter((p) => p.avgHighPrice !== null)
      .map((p) => ({ time: p.timestamp as never, value: p.avgHighPrice as number }));
    const lowData = points
      .filter((p) => p.avgLowPrice !== null)
      .map((p) => ({ time: p.timestamp as never, value: p.avgLowPrice as number }));

    const allPrices = [...highData.map((d) => d.value), ...lowData.map((d) => d.value)].sort((a, b) => a - b);
    const nPrices = allPrices.length;
    const p02 = nPrices > 0 ? allPrices[Math.floor(nPrices * 0.02)] : 0;
    const p98 = nPrices > 0 ? allPrices[Math.min(nPrices - 1, Math.ceil(nPrices * 0.98))] : 1;
    const rawMin = nPrices > 0 ? allPrices[0] : 0;
    const rawMax = nPrices > 0 ? allPrices[nPrices - 1] : 1;
    const coreSpan = Math.max(0, p98 - p02);
    const isMicroTick = coreSpan <= 20;

    const priceFormat = {
      type: 'custom' as const,
      minMove: 1,
      formatter: formatAxisGp,
    };

    const autoscaleProvider = () => {
      if (nPrices === 0) return null;
      const lo = trimOutliers ? p02 : rawMin;
      const hi = trimOutliers ? p98 : rawMax;
      const span = hi - lo;
      const pad = span <= 2 ? 1 : Math.max(1, span * 0.1);
      return {
        priceRange: {
          minValue: Math.max(0, Math.floor(lo - pad)),
          maxValue: Math.ceil(hi + pad),
        },
      };
    };

    const lineType = isMicroTick ? LineType.WithSteps : LineType.Simple;

    const highSeries = priceChart.addAreaSeries({
      lineColor: '#f59e0b',
      topColor: 'rgba(245, 158, 11, 0.22)',
      bottomColor: 'rgba(245, 158, 11, 0.03)',
      lineWidth: 2,
      lineType,
      priceFormat,
      autoscaleInfoProvider: autoscaleProvider,
      title: 'High',
    });

    const lowSeries = priceChart.addAreaSeries({
      lineColor: '#e4e4e7',
      topColor: 'rgba(7, 7, 9, 0.84)',
      bottomColor: 'rgba(7, 7, 9, 0.84)',
      lineWidth: 2,
      lineType,
      priceFormat,
      autoscaleInfoProvider: () => null,
      title: 'Low',
    });

    highSeries.setData(highData);
    lowSeries.setData(lowData);
    highSeriesRef.current = highSeries;
    buyLineRef.current = null;
    sellLineRef.current = null;
    setChartMountVersion((v) => v + 1);

    if (showVwapLines && item) {
      const refLo = trimOutliers ? p02 : rawMin;
      const refHi = trimOutliers ? p98 : rawMax;
      const maxAllowedDist = Math.max(20, (refHi - refLo) * 3.0);
      if (item.vwap_24h && item.vwap_24h > 0 && (!trimOutliers || Math.abs(item.vwap_24h - refHi) <= maxAllowedDist)) {
        highSeries.createPriceLine({
          price: Math.round(item.vwap_24h),
          color: '#38bdf8',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: '24h VWAP',
        });
      }
      if (item.vwap_7d && item.vwap_7d > 0 && (!trimOutliers || Math.abs(item.vwap_7d - refHi) <= maxAllowedDist)) {
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

    let syncingRange = false;
    priceChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (syncingRange || !range) return;
      syncingRange = true;
      volChart.timeScale().setVisibleLogicalRange(range);
      syncingRange = false;
    });
    volChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (syncingRange || !range) return;
      syncingRange = true;
      priceChart.timeScale().setVisibleLogicalRange(range);
      syncingRange = false;
    });

    const handleCrosshair = (param: { time?: unknown }) => {
      if (typeof param.time === 'number') {
        const pt = pointByTs.get(param.time);
        if (pt) setHoverPoint(pt);
      } else if (points.length > 0) {
        setHoverPoint(points[points.length - 1]);
      }
    };
    priceChart.subscribeCrosshairMove(handleCrosshair);
    volChart.subscribeCrosshairMove(handleCrosshair);

    // ResizeObserver handles window resizes AND 1-click Expand Chart rail toggle seamlessly
    const resizeCharts = () => {
      const w = priceContainerRef.current?.clientWidth || 0;
      if (w > 0) {
        priceChart.applyOptions({ width: w });
        volChart.applyOptions({ width: w });
      }
    };
    const ro = new ResizeObserver(resizeCharts);
    if (chartFrameRef.current) ro.observe(chartFrameRef.current);
    window.addEventListener('resize', resizeCharts);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', resizeCharts);
      highSeriesRef.current = null;
      buyLineRef.current = null;
      sellLineRef.current = null;
      priceChart.remove();
      volChart.remove();
    };
  }, [points, showVwapLines, trimOutliers, item?.vwap_24h, item?.vwap_7d]);

  // Calculator math
  const safeBuy = Math.max(1, Math.floor(buyInput || 0));
  const safeSell = Math.max(1, Math.floor(sellInput || 0));
  const safeQty = Math.max(1, Math.floor(qtyInput || 1));

  // Live Buy / Sell Order Lines on Chart (updates seamlessly as you type without recreating chart!)
  useEffect(() => {
    const series = highSeriesRef.current;
    if (!series) return;

    if (buyLineRef.current) {
      try {
        series.removePriceLine(buyLineRef.current);
      } catch {
        // ignore if already removed
      }
      buyLineRef.current = null;
    }
    if (sellLineRef.current) {
      try {
        series.removePriceLine(sellLineRef.current);
      } catch {
        // ignore
      }
      sellLineRef.current = null;
    }

    if (!showOrderLines) return;

    if (safeBuy > 0) {
      buyLineRef.current = series.createPriceLine({
        price: safeBuy,
        color: '#10b981',
        lineWidth: 1,
        lineStyle: LineStyle.LargeDashed,
        axisLabelVisible: true,
        title: 'Buy',
      });
    }
    if (safeSell > 0) {
      sellLineRef.current = series.createPriceLine({
        price: safeSell,
        color: '#fbbf24',
        lineWidth: 1,
        lineStyle: LineStyle.LargeDashed,
        axisLabelVisible: true,
        title: 'Sell',
      });
    }
  }, [showOrderLines, safeBuy, safeSell, chartMountVersion]);

  const taxUnit = computeGeTax(safeSell, Boolean(item?.is_tax_exempt));
  const netUnit = safeSell - safeBuy - taxUnit;
  const totalCapital = safeBuy * safeQty;
  const totalTax = taxUnit * safeQty;
  const totalNetProfit = netUnit * safeQty;
  const netRoiPct = safeBuy > 0 ? (netUnit / safeBuy) * 100 : 0;

  const copyVal = (kind: 'buy' | 'sell', val: number) => {
    navigator.clipboard.writeText(String(val));
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1100);
  };

  const displayPoint = hoverPoint || (points.length > 0 ? points[points.length - 1] : null);
  const displayTimeStr = displayPoint
    ? new Date(displayPoint.timestamp * 1000).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
  const hoverSpread =
    displayPoint?.avgHighPrice && displayPoint?.avgLowPrice
      ? displayPoint.avgHighPrice - displayPoint.avgLowPrice
      : null;

  const vol1hTotal = (item?.vol_1h_high || 0) + (item?.vol_1h_low || 0);
  const buyFlowPct = vol1hTotal > 0 ? Math.round(((item?.vol_1h_high || 0) / vol1hTotal) * 100) : 50;
  const limitTurnover1h =
    item && item.buy_limit > 0 && item.vol_1h > 0 ? (item.vol_1h / item.buy_limit).toFixed(1) : null;

  const bounceBadgeCls =
    item?.dump_bounce_outlook === 'HIGH'
      ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-300'
      : item?.dump_bounce_outlook === 'MEDIUM'
        ? 'border-amber-500/30 bg-amber-500/15 text-amber-300'
        : item?.dump_bounce_outlook === 'LOW'
          ? 'border-rose-500/35 bg-rose-500/15 text-rose-300'
          : 'border-white/10 bg-zinc-900 text-zinc-400';

  const loadPresetPrices = (preset: 'front' | 'overnight') => {
    if (!item) return;
    if (preset === 'overnight') {
      const refP25 = item.p25_48h || item.p25_7d || item.low || 1;
      const refP75 = item.p75_48h || item.p75_7d || item.high || 1;
      const low = item.low || refP25;
      const high = item.high || refP75;
      const ovBuy = Math.max(Math.floor(low * 0.985), Math.min(low, refP25));
      const ovSell = Math.min(Math.floor(high * 1.025), Math.max(high - 1, refP75));
      setBuyInput(Math.max(1, ovBuy));
      setSellInput(Math.max(ovBuy + 1, ovSell));
      setFlipMode('overnight');
      return;
    }
    setBuyInput(item.suggested_buy || item.low || 1);
    setSellInput(item.suggested_sell || item.high || 1);
    setFlipMode('active');
  };

  return (
    <div className="space-y-4">
      {/* 1. TOP TICKER HEADER BAR */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-[#0b0b10] px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onBack}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/[0.09] bg-[#121218] px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:border-white/[0.2] hover:text-white"
            title={`Back to ${backLabel} (Esc)`}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{backLabel}</span>
          </button>

          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[0.1] bg-[#14141b]">
            {item?.icon ? (
              <img src={wikiIconUrl(item.icon)} alt="" className="h-8 w-8 object-contain" />
            ) : (
              <TrendingUp className="h-5 w-5 text-amber-400" />
            )}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-lg font-bold tracking-tight text-zinc-100">
                {item?.name || (loadingItem ? `Loading #${itemId}...` : `Item #${itemId}`)}
              </h1>
              {item && (
                <span className="rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400">
                  {item.members ? 'P2P' : 'F2P'}
                </span>
              )}
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
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">
              <span>ID #{itemId}</span>
              <span>·</span>
              <span>
                4h Limit:{' '}
                <strong className="font-mono-num text-zinc-200">
                  {item?.buy_limit ? item.buy_limit.toLocaleString() : '—'}
                </strong>
              </span>
              {limitTurnover1h && (
                <>
                  <span>·</span>
                  <span className="text-emerald-400">1h Vol = {limitTurnover1h}× limit</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: Live Quotes + Watch + Expand Chart */}
        <div className="flex flex-wrap items-center gap-3">
          {item && (
            <div className="flex items-center gap-4 border-r border-white/[0.08] pr-3.5 text-xs font-mono-num">
              <div>
                <div className="text-[10px] font-sans uppercase tracking-wider text-zinc-500">Live Low (Bid)</div>
                <div className="font-bold text-zinc-100">
                  {formatGp(item.low)}{' '}
                  <span className="text-[10px] font-normal text-zinc-500">({formatAge(item.low_age_sec)})</span>
                </div>
              </div>
              <div>
                <div className="text-[10px] font-sans uppercase tracking-wider text-zinc-500">Live High (Ask)</div>
                <div className="font-bold text-amber-300">
                  {formatGp(item.high)}{' '}
                  <span className="text-[10px] font-normal text-zinc-500">({formatAge(item.high_age_sec)})</span>
                </div>
              </div>
              <div className="hidden md:block">
                <div className="text-[10px] font-sans uppercase tracking-wider text-zinc-500">Net Margin</div>
                <div className={`font-bold ${item.net_margin > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {formatSignedGp(item.net_margin, true)}{' '}
                  <span className="text-[10px] font-normal text-zinc-400">({item.net_roi_pct.toFixed(2)}%)</span>
                </div>
              </div>
            </div>
          )}

          {item && (
            <button
              onClick={() => onToggleStar(item)}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                isStarred
                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                  : 'border-white/[0.09] bg-[#121218] text-zinc-400 hover:text-amber-300'
              }`}
              title={isStarred ? 'Remove from Watchlist' : 'Add to Watchlist & Price Alerts'}
            >
              <Star className={`h-3.5 w-3.5 ${isStarred ? 'fill-current' : ''}`} />
              <span>{isStarred ? 'Watching' : 'Watch'}</span>
            </button>
          )}

          <button
            onClick={() => setChartExpanded((e) => !e)}
            className={`hidden xl:flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
              chartExpanded
                ? 'border-amber-400/40 bg-amber-400/15 text-amber-200'
                : 'border-white/[0.09] bg-[#121218] text-zinc-300 hover:border-white/[0.2] hover:text-white'
            }`}
            title={chartExpanded ? 'Show right Order Ticket rail' : 'Expand chart to 100% page width'}
          >
            {chartExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            <span>{chartExpanded ? 'Split View' : 'Full Width'}</span>
          </button>
        </div>
      </div>

      {/* 2. MAIN TRADINGVIEW TERMINAL SPLIT */}
      <div
        className={`grid grid-cols-1 gap-4 items-start ${
          chartExpanded ? '' : 'xl:grid-cols-[minmax(0,1fr)_360px]'
        }`}
      >
        {/* LEFT COLUMN: MASSIVE CHART HERO + DEEP ANALYTICS DECK */}
        <div className="min-w-0 space-y-4">
          {/* Unified Two-Pane Chart Card */}
          <div
            ref={chartFrameRef}
            className="overflow-hidden rounded-2xl border border-white/[0.09] bg-[#070709] shadow-xl"
          >
            {/* Unified Chart Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] bg-[#0c0c10] px-4 py-2.5">
              {/* Left: Timeframes + Overlays */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center rounded-lg border border-white/[0.07] bg-[#060608] p-0.5">
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf.key}
                      onClick={() => setChartWindow(tf.key)}
                      title={tf.hint}
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                        chartWindow === tf.key
                          ? 'bg-zinc-100 text-zinc-950'
                          : 'text-zinc-400 hover:text-zinc-100'
                      }`}
                    >
                      {tf.label}
                    </button>
                  ))}
                </div>

                <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showOrderLines}
                    onChange={(e) => setShowOrderLines(e.target.checked)}
                    className="accent-emerald-400"
                  />
                  <span>Order Lines</span>
                </label>

                <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showVwapLines}
                    onChange={(e) => setShowVwapLines(e.target.checked)}
                    className="accent-sky-400"
                  />
                  <span>VWAP</span>
                </label>

                <label
                  className="flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer select-none"
                  title="Trims 2nd–98th percentile outlier spikes so micro-tick changes (like runes) fill the full chart height"
                >
                  <input
                    type="checkbox"
                    checked={trimOutliers}
                    onChange={(e) => setTrimOutliers(e.target.checked)}
                    className="accent-amber-400"
                  />
                  <span>Trim Outliers</span>
                </label>

                <button
                  onClick={() => setChartReloadNonce((n) => n + 1)}
                  className="rounded-lg border border-white/[0.07] bg-[#060608] p-1.5 text-zinc-400 hover:text-white transition"
                  title="Refresh chart candles"
                >
                  <RefreshCw className={`h-3 w-3 ${loadingChart ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {/* Right: Live Hovered Candle OHLC + Spread + Volume Readout */}
              {displayPoint && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono-num">
                  <span className="text-zinc-500">{displayTimeStr}</span>
                  <span>
                    <span className="text-amber-400 font-semibold">H</span>{' '}
                    <span className="text-zinc-100">{formatGp(displayPoint.avgHighPrice)}</span>
                  </span>
                  <span>
                    <span className="text-zinc-400 font-semibold">L</span>{' '}
                    <span className="text-zinc-100">{formatGp(displayPoint.avgLowPrice)}</span>
                  </span>
                  {hoverSpread !== null && (
                    <span>
                      <span className="text-zinc-500">Spread</span>{' '}
                      <span className="text-amber-200 font-semibold">{formatGp(hoverSpread)}</span>
                    </span>
                  )}
                  <span className="text-emerald-400">↑ {(displayPoint.highPriceVolume || 0).toLocaleString()}</span>
                  <span className="text-rose-400">↓ {(displayPoint.lowPriceVolume || 0).toLocaleString()}</span>
                </div>
              )}
            </div>

            {/* Chart Panes */}
            {loadingChart && points.length === 0 ? (
              <div className="flex h-[560px] items-center justify-center text-xs text-zinc-500">
                Loading {chartWindow.toUpperCase()} price &amp; volume history...
              </div>
            ) : points.length === 0 ? (
              <div className="flex h-[560px] items-center justify-center text-xs text-zinc-500">
                No historical candle points returned for this timeframe.
              </div>
            ) : (
              <div>
                <div ref={priceContainerRef} className="w-full" />
                <div className="flex items-center justify-between border-y border-white/[0.06] bg-[#0a0a0d] px-4 py-1 text-[10px] text-zinc-500">
                  <span className="font-semibold uppercase tracking-wider">Instant-Buy vs. Instant-Sell Volume</span>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1 text-emerald-400">
                      <span className="h-2 w-2 rounded-xs bg-emerald-500" /> Instant Buy (Up)
                    </span>
                    <span className="flex items-center gap-1 text-rose-400">
                      <span className="h-2 w-2 rounded-xs bg-rose-500" /> Instant Sell (Down)
                    </span>
                  </div>
                </div>
                <div ref={volContainerRef} className="w-full" />
              </div>
            )}
          </div>

          {/* BELOW CHART: 2-Column Deep Analytics Deck */}
          {item && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Card A: Market Microstructure & 48h/7d Regime */}
              <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c10] p-4 space-y-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-100">Market Microstructure &amp; Flow</span>
                  <span className="text-[11px] font-mono-num text-zinc-400">
                    Safety:{' '}
                    <strong
                      className={
                        item.safety_score >= 70
                          ? 'text-emerald-400'
                          : item.safety_score >= 45
                            ? 'text-amber-300'
                            : 'text-rose-400'
                      }
                    >
                      {item.safety_score}/100
                    </strong>
                  </span>
                </div>

                {/* Order Flow Balance Bar */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-mono-num">
                    <span className="text-emerald-400">
                      Buy {buyFlowPct}% ({item.vol_1h_high.toLocaleString()}/h)
                    </span>
                    <span className="text-zinc-400">
                      OFI 1h:{' '}
                      <strong className={item.ofi_1h >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {item.ofi_1h >= 0 ? '+' : ''}
                        {item.ofi_1h.toFixed(2)}
                      </strong>
                    </span>
                    <span className="text-rose-400">
                      Sell {100 - buyFlowPct}% ({item.vol_1h_low.toLocaleString()}/h)
                    </span>
                  </div>
                  <div className="flex h-2 w-full overflow-hidden rounded-full bg-zinc-900">
                    <div className="bg-emerald-500/80 transition-all" style={{ width: `${buyFlowPct}%` }} />
                    <div className="bg-rose-500/80 transition-all" style={{ width: `${100 - buyFlowPct}%` }} />
                  </div>
                </div>

                {/* Compact Metrics Grid */}
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 text-xs font-mono-num">
                  <div className="rounded-xl border border-white/[0.05] bg-[#070709] p-2.5">
                    <div className="text-[10px] font-sans text-zinc-500">5m Volume</div>
                    <div className="mt-0.5 font-bold text-zinc-100">{item.vol_5m.toLocaleString()}</div>
                    <div className="text-[10px] text-zinc-500">
                      ↑{item.vol_5m_high} · ↓{item.vol_5m_low}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/[0.05] bg-[#070709] p-2.5">
                    <div className="text-[10px] font-sans text-zinc-500">24h Volume</div>
                    <div className="mt-0.5 font-bold text-zinc-100">{item.vol_24h.toLocaleString()}</div>
                    <div className="text-[10px] text-zinc-500">{item.vol_1h.toLocaleString()}/hr</div>
                  </div>
                  <div className="rounded-xl border border-white/[0.05] bg-[#070709] p-2.5">
                    <div className="text-[10px] font-sans text-zinc-500">48h Band (p25–p75)</div>
                    <div className="mt-0.5 font-bold text-indigo-300">
                      {item.p25_48h && item.p75_48h
                        ? `${formatGp(item.p25_48h, true)}–${formatGp(item.p75_48h, true)}`
                        : '—'}
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      7d trend {item.trend_7d_pct !== undefined ? `${item.trend_7d_pct >= 0 ? '+' : ''}${item.trend_7d_pct.toFixed(1)}%` : '—'}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/[0.05] bg-[#070709] p-2.5">
                    <div className="text-[10px] font-sans text-zinc-500">High Alch / Floor</div>
                    <div className="mt-0.5 font-bold text-zinc-100">
                      {item.highalch > 0 ? formatGp(item.highalch) : '—'}
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      {item.alch_floor_pct !== null ? `${item.alch_floor_pct >= 0 ? '+' : ''}${item.alch_floor_pct.toFixed(1)}% vs floor` : 'No floor'}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/[0.05] bg-[#070709] p-2.5">
                    <div className="text-[10px] font-sans text-zinc-500">24h Volatility</div>
                    <div className="mt-0.5 font-bold text-zinc-100">{item.volatility_24h_pct.toFixed(2)}%</div>
                    <div className="text-[10px] text-zinc-500">Sharpe {item.flip_sharpe.toFixed(2)}</div>
                  </div>
                  <div className="rounded-xl border border-white/[0.05] bg-[#070709] p-2.5">
                    <div className="text-[10px] font-sans text-zinc-500">Hour Seasonality</div>
                    <div
                      className={`mt-0.5 font-bold ${
                        item.seasonality_bias_pct <= -0.8
                          ? 'text-emerald-400'
                          : item.seasonality_bias_pct >= 0.8
                            ? 'text-amber-300'
                            : 'text-zinc-200'
                      }`}
                    >
                      {item.seasonality_bias_pct >= 0 ? '+' : ''}
                      {item.seasonality_bias_pct.toFixed(2)}%
                    </div>
                    <div className="text-[10px] text-zinc-500">vs 30d mean</div>
                  </div>
                </div>

                {item.manipulation_flags.length > 0 && (
                  <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                    <span>
                      Caution flags: <strong>{item.manipulation_flags.join(' · ')}</strong>
                    </span>
                  </div>
                )}
              </div>

              {/* Card B: VWAP & Mean-Reversion / Dump Targets */}
              <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c10] p-4 space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Flame className="h-4 w-4 text-rose-400" />
                    <span className="text-xs font-bold text-zinc-100">VWAP &amp; Mean-Reversion Targets</span>
                  </div>
                  <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${bounceBadgeCls}`}>
                    Bounce: {item.dump_bounce_outlook || 'NONE'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2.5 text-xs font-mono-num">
                  <div className="rounded-xl border border-white/[0.05] bg-[#070709] p-2.5">
                    <div className="text-[10px] font-sans text-sky-400">24h VWAP</div>
                    <div className="mt-0.5 font-bold text-zinc-100">
                      {formatGp(item.vwap_24h ? Math.round(item.vwap_24h) : null)}
                    </div>
                    <div className={`text-[10px] ${item.zscore_24h <= -1.6 ? 'text-rose-400 font-bold' : 'text-zinc-500'}`}>
                      Z = {item.zscore_24h.toFixed(2)}σ
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/[0.05] bg-[#070709] p-2.5">
                    <div className="text-[10px] font-sans text-violet-400">7d VWAP</div>
                    <div className="mt-0.5 font-bold text-zinc-100">
                      {formatGp(item.vwap_7d ? Math.round(item.vwap_7d) : null)}
                    </div>
                    <div className={`text-[10px] ${item.zscore_7d <= -1.6 ? 'text-rose-400 font-bold' : 'text-zinc-500'}`}>
                      Z = {item.zscore_7d.toFixed(2)}σ
                    </div>
                  </div>
                  <button
                    onClick={() => item.dump_conservative_target && setSellInput(item.dump_conservative_target)}
                    disabled={!item.dump_conservative_target}
                    className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-2.5 text-left hover:bg-emerald-500/15 disabled:opacity-40 transition"
                    title="Click to load Safe Bounce Target into Order Ticket & move Sell line on chart"
                  >
                    <div className="text-[10px] font-sans text-emerald-300">Safe Bounce ↗</div>
                    <div className="mt-0.5 font-bold text-emerald-200">{formatGp(item.dump_conservative_target)}</div>
                    <div className="text-[10px] font-sans text-emerald-400/80">99% VWAP</div>
                  </button>
                  <button
                    onClick={() => item.dump_full_target && setSellInput(item.dump_full_target)}
                    disabled={!item.dump_full_target}
                    className="rounded-xl border border-violet-500/25 bg-violet-500/10 p-2.5 text-left hover:bg-violet-500/15 disabled:opacity-40 transition"
                    title="Click to load Full 7d Rebound Target into Order Ticket & move Sell line on chart"
                  >
                    <div className="text-[10px] font-sans text-violet-300">7d Rebound ↗</div>
                    <div className="mt-0.5 font-bold text-violet-200">{formatGp(item.dump_full_target)}</div>
                    <div className="text-[10px] font-sans text-violet-400/80">98.5% 7d</div>
                  </button>
                </div>

                <p className="text-[11px] leading-relaxed text-zinc-400 flex items-start gap-1.5">
                  <Info className="h-3.5 w-3.5 text-sky-400 shrink-0 mt-0.5" />
                  <span>
                    Hourly 1σ = {formatGp(item.std_24h ? Math.round(item.std_24h) : 0)} gp (24h) /{' '}
                    {formatGp(item.std_7d ? Math.round(item.std_7d) : 0)} gp (7d). {item.dump_bounce_reason}
                  </span>
                </p>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT STICKY RAIL: READ-ONLY TAX & PROFIT CALCULATOR + AI FORECAST */}
        {!chartExpanded && (
          <div className="space-y-4 xl:sticky xl:top-[68px]">
            {/* Tax & Profit Calculator */}
            <div className="rounded-2xl border border-white/[0.09] bg-[#0c0c10] p-4 space-y-4">
              <div className="flex items-center justify-between border-b border-white/[0.07] pb-3">
                <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
                  <TrendingUp className="h-4 w-4 text-emerald-400" /> Tax &amp; Profit Calculator
                </h2>
                <span className="text-[11px] text-zinc-500 font-mono-num">
                  Budget: <strong className="text-zinc-200">{formatGp(slotBudget, true)}</strong>
                </span>
              </div>

              {/* Flip Mode + Quick Price Presets */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => loadPresetPrices('front')}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl border py-1.5 text-xs font-semibold transition ${
                    flipMode === 'active'
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                      : 'border-white/[0.08] bg-[#070709] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Zap className="h-3.5 w-3.5" /> Active Flip
                </button>
                <button
                  type="button"
                  onClick={() => loadPresetPrices('overnight')}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl border py-1.5 text-xs font-semibold transition ${
                    flipMode === 'overnight'
                      ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300'
                      : 'border-white/[0.08] bg-[#070709] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Moon className="h-3.5 w-3.5" /> Overnight
                </button>
              </div>

              {/* Buy Input */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-medium text-zinc-400">Buy Price (GP)</label>
                  <button
                    type="button"
                    onClick={() => copyVal('buy', safeBuy)}
                    className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-100"
                  >
                    {copied === 'buy' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-2.5 w-2.5" />}
                    {copied === 'buy' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <input
                  type="number"
                  min={1}
                  value={buyInput || ''}
                  onChange={(e) => setBuyInput(Number(e.target.value))}
                  className="w-full rounded-xl border border-white/[0.1] bg-[#060608] px-3 py-2 text-sm font-bold text-zinc-100 outline-none focus:border-emerald-400/50 font-mono-num"
                />
                {item?.low && (
                  <div className="flex flex-wrap gap-1.5 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setBuyInput(item.low! + 1)}
                      className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-zinc-400 hover:text-white"
                    >
                      Low+1 ({formatGp(item.low + 1, true)})
                    </button>
                    <button
                      type="button"
                      onClick={() => setBuyInput(item.low!)}
                      className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-zinc-400 hover:text-white"
                    >
                      Low ({formatGp(item.low, true)})
                    </button>
                    {item.p25_48h && (
                      <button
                        type="button"
                        onClick={() => setBuyInput(item.p25_48h!)}
                        className="rounded-md border border-indigo-500/25 bg-indigo-500/10 px-2 py-0.5 text-indigo-300 hover:bg-indigo-500/20"
                      >
                        48h p25 ({formatGp(item.p25_48h, true)})
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Sell Input */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-medium text-zinc-400">Target Sell (GP)</label>
                  <button
                    type="button"
                    onClick={() => copyVal('sell', safeSell)}
                    className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-100"
                  >
                    {copied === 'sell' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-2.5 w-2.5" />}
                    {copied === 'sell' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <input
                  type="number"
                  min={1}
                  value={sellInput || ''}
                  onChange={(e) => setSellInput(Number(e.target.value))}
                  className="w-full rounded-xl border border-white/[0.1] bg-[#060608] px-3 py-2 text-sm font-bold text-amber-300 outline-none focus:border-amber-400/50 font-mono-num"
                />
                {item?.high && (
                  <div className="flex flex-wrap gap-1.5 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setSellInput(Math.max(1, item.high! - 1))}
                      className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-zinc-400 hover:text-white"
                    >
                      High-1 ({formatGp(Math.max(1, item.high - 1), true)})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSellInput(item.high!)}
                      className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-zinc-400 hover:text-white"
                    >
                      High ({formatGp(item.high, true)})
                    </button>
                    {item.p75_48h && (
                      <button
                        type="button"
                        onClick={() => setSellInput(item.p75_48h!)}
                        className="rounded-md border border-indigo-500/25 bg-indigo-500/10 px-2 py-0.5 text-indigo-300 hover:bg-indigo-500/20"
                      >
                        48h p75 ({formatGp(item.p75_48h, true)})
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Quantity Input */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-medium text-zinc-400">Quantity</label>
                  <span className="text-[10px] text-zinc-500 font-mono-num">
                    Limit: {item?.buy_limit ? item.buy_limit.toLocaleString() : '—'}
                  </span>
                </div>
                <input
                  type="number"
                  min={1}
                  value={qtyInput || ''}
                  onChange={(e) => setQtyInput(Number(e.target.value))}
                  className="w-full rounded-xl border border-white/[0.1] bg-[#060608] px-3 py-2 text-sm font-bold text-zinc-100 outline-none focus:border-white/30 font-mono-num"
                />
                <div className="flex flex-wrap gap-1.5 text-[10px]">
                  <button
                    type="button"
                    onClick={() => {
                      const maxByBudget = Math.max(1, Math.floor(slotBudget / safeBuy));
                      const lim = item?.buy_limit || maxByBudget;
                      setQtyInput(Math.max(1, Math.min(maxByBudget, lim)));
                    }}
                    className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-zinc-400 hover:text-white"
                  >
                    Slot Budget
                  </button>
                  {item && item.buy_limit > 0 && (
                    <button
                      type="button"
                      onClick={() => setQtyInput(item.buy_limit)}
                      className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-zinc-400 hover:text-white"
                    >
                      4h Limit ({item.buy_limit.toLocaleString()})
                    </button>
                  )}
                </div>
              </div>

              {/* Exact Economics Summary */}
              <div className="rounded-xl border border-white/[0.06] bg-[#070709] p-3 space-y-2 text-xs font-mono-num">
                <div className="flex items-center justify-between text-zinc-400">
                  <span className="font-sans">Capital Required</span>
                  <span className="text-zinc-200 font-semibold">{formatGp(totalCapital)} gp</span>
                </div>
                <div className="flex items-center justify-between text-zinc-400">
                  <span className="font-sans">
                    GE Tax {item?.is_tax_exempt ? '(0% exempt)' : '(2% / 5M cap)'}
                  </span>
                  <span className="text-zinc-300">
                    -{formatGp(totalTax)} gp ({formatGp(taxUnit)}/ea)
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-white/[0.06] pt-2">
                  <span className="font-sans font-semibold text-zinc-200">Est. Net Profit</span>
                  <div className="text-right">
                    <div className={`text-sm font-bold ${totalNetProfit > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {formatSignedGp(totalNetProfit)} gp
                    </div>
                    <div className="text-[10px] text-zinc-400">
                      {formatSignedGp(netUnit)}/ea · {netRoiPct >= 0 ? '+' : ''}
                      {netRoiPct.toFixed(2)}% ROI
                    </div>
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={!item}
                onClick={() => item && onToggleStar({ id: item.id, name: item.name, low: item.low })}
                className={`flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-bold transition disabled:opacity-40 ${
                  isStarred
                    ? 'border-amber-500/45 bg-amber-500/15 text-amber-200 hover:bg-amber-500/20'
                    : 'border-amber-400/35 bg-gradient-to-r from-amber-300 to-amber-400 text-zinc-950 hover:from-amber-200 hover:to-amber-300'
                }`}
              >
                <Star className={`h-3.5 w-3.5 ${isStarred ? 'fill-current' : ''}`} />
                {isStarred ? 'Pinned in Top Watch Bar' : 'Pin to Top Watch Bar'}
              </button>
            </div>

            {/* AI Dual-Horizon Forecast Card */}
            {item?.ml && (() => {
              const verdict = getAiVerdict(item.ml);
              const verdictToneCls =
                verdict.tone === 'emerald'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : verdict.tone === 'sky'
                    ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                    : verdict.tone === 'amber'
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                      : 'border-rose-500/30 bg-rose-500/10 text-rose-300';
              const scoreTone = (p: number) =>
                p >= 70 ? 'text-emerald-400' : p >= 55 ? 'text-amber-300' : 'text-rose-400';

              return (
                <div className="rounded-2xl border border-white/[0.09] bg-[#0c0c10] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-zinc-100">
                      <Brain className="h-3.5 w-3.5 text-emerald-400" />
                      AI Dual-Horizon Forecast
                    </span>
                    <InfoTooltip
                      title="Walk-Forward ML Signals"
                      text="Predicted probabilities that buying at low+1 and selling into realistic next-4h or overnight-12h volume beats the 2% GE tax."
                      align="right"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="rounded-xl border border-white/[0.06] bg-[#070709] p-3 space-y-0.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        4h Quick Flip
                      </div>
                      <div className={`text-lg font-bold font-mono-num ${scoreTone(item.ml.prob_4h_pct)}`}>
                        {item.ml.prob_4h_pct.toFixed(0)}%
                      </div>
                      <div className="text-[10px] text-zinc-500">≥ +0.5% net odds</div>
                    </div>
                    <div className="rounded-xl border border-white/[0.06] bg-[#070709] p-3 space-y-0.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        12h Overnight
                      </div>
                      <div className={`text-lg font-bold font-mono-num ${scoreTone(item.ml.prob_12h_pct)}`}>
                        {item.ml.prob_12h_pct.toFixed(0)}%
                      </div>
                      <div className="text-[10px] font-mono-num text-zinc-400">
                        Pred ROI:{' '}
                        <strong className={item.ml.pred_12h_roi_pct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                          {item.ml.pred_12h_roi_pct >= 0 ? '+' : ''}
                          {item.ml.pred_12h_roi_pct.toFixed(2)}%
                        </strong>
                      </div>
                    </div>
                  </div>
                  <div className={`rounded-xl border px-3 py-2 text-[11px] leading-relaxed ${verdictToneCls}`}>
                    <div className="font-bold">{verdict.label}</div>
                    <div className="mt-0.5 opacity-90">{verdict.summary}</div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
