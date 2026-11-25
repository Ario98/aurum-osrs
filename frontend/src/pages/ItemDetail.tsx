import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, LineStyle, LineType } from 'lightweight-charts';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Brain,
  Check,
  Copy,
  Flame,
  Info,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { api } from '../api/client';
import { InfoTooltip } from '../components/InfoTooltip';
import { getAiVerdict } from '../components/MLSignalBadge';
import { VolumeIndicator } from '../components/VolumeIndicator';
import type { ChartPoint, ItemMetrics } from '../types';
import { formatAge, formatGp, formatSignedGp, wikiIconUrl } from '../utils/format';

interface Props {
  itemId: number;
  backLabel: string;
  isStarred: boolean;
  tickVersion: number;
  onBack: () => void;
  onToggleStar: (item: { id: number; name: string; low?: number | null }) => Promise<void>;
}

type ChartWindow = '6h' | '24h' | '7d' | '30d' | '90d' | '1y';
type LowerPaneMode = 'volume_cvd' | 'ofi_wave';

const TIMEFRAMES: { key: ChartWindow; label: string; hint: string }[] = [
  { key: '6h', label: '6H', hint: '6 hours (5m candles)' },
  { key: '24h', label: '24H', hint: '24 hours (5m candles)' },
  { key: '7d', label: '7D', hint: '7 days (1h candles)' },
  { key: '30d', label: '30D', hint: '30 days (1h candles)' },
  { key: '90d', label: '90D', hint: '90 days (6h candles)' },
  { key: '1y', label: '1Y', hint: '1 year (24h candles)' },
];

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

function getPressureVerdict(ofi1h: number, ofi5m: number) {
  const composite = ofi1h * 0.6 + ofi5m * 0.4;
  if (composite >= 0.35) {
    return {
      label: 'Strong Buying Pressure',
      tone: 'text-emerald-400',
      badge: 'border-emerald-500/35 bg-emerald-500/15 text-emerald-300',
      desc: 'Buyers are aggressively lifting asks — momentum favors quick upward fills.',
    };
  }
  if (composite >= 0.14) {
    return {
      label: 'Mild Buying Edge',
      tone: 'text-emerald-300',
      badge: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
      desc: 'Slightly more instant buys than sells — healthy demand supporting ask prices.',
    };
  }
  if (composite <= -0.35) {
    return {
      label: 'Heavy Selling Pressure',
      tone: 'text-rose-400',
      badge: 'border-rose-500/35 bg-rose-500/15 text-rose-300',
      desc: 'Sellers are dumping into bids — wait for stabilization or bid defensively.',
    };
  }
  if (composite <= -0.14) {
    return {
      label: 'Mild Selling Pressure',
      tone: 'text-rose-300',
      badge: 'border-rose-500/25 bg-rose-500/10 text-rose-300',
      desc: 'Instant sells outpace buys slightly — bids fill quickly, watch resistance on asks.',
    };
  }
  return {
    label: 'Balanced Two-Way Flow',
    tone: 'text-zinc-200',
    badge: 'border-white/[0.12] bg-white/[0.06] text-zinc-200',
    desc: 'Even instant-buy and instant-sell turnover — ideal liquidity for clean spread flips.',
  };
}

export function ItemDetail({
  itemId,
  backLabel,
  isStarred,
  tickVersion,
  onBack,
  onToggleStar,
}: Props) {
  const [item, setItem] = useState<ItemMetrics | null>(null);
  const [loadingItem, setLoadingItem] = useState(true);
  const [chartWindow, setChartWindow] = useState<ChartWindow>('24h');
  const [lowerMode, setLowerMode] = useState<LowerPaneMode>('volume_cvd');
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [loadingChart, setLoadingChart] = useState(false);
  const [chartReloadNonce, setChartReloadNonce] = useState(0);

  // Chart overlays
  const [showAiForecast, setShowAiForecast] = useState(true);
  const [showVwapLines, setShowVwapLines] = useState(true);
  const [trimOutliers, setTrimOutliers] = useState(true);
  const [hoverPoint, setHoverPoint] = useState<ChartPoint | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const chartFrameRef = useRef<HTMLDivElement | null>(null);
  const priceContainerRef = useRef<HTMLDivElement | null>(null);
  const volContainerRef = useRef<HTMLDivElement | null>(null);

  const copyGp = (key: string, val: number | null | undefined) => {
    if (!val || val <= 0) return;
    navigator.clipboard.writeText(String(Math.round(val)));
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 1150);
  };

  // Escape navigates back when not typing
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

  // Reset timeframe & scroll top when switching items
  useEffect(() => {
    setChartWindow('24h');
    setItem(null);
    setLoadingItem(true);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [itemId]);

  // Live 10s item telemetry refresh
  useEffect(() => {
    let cancelled = false;
    api
      .itemDetail(itemId)
      .then((d) => {
        if (!cancelled) setItem(d);
      })
      .finally(() => {
        if (!cancelled) setLoadingItem(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId, tickVersion]);

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

  // Full-Width Obsidian Quant Synchronized Two-Pane Chart
  useEffect(() => {
    if (!priceContainerRef.current || !volContainerRef.current || points.length === 0) return;

    const pointByTs = new Map<number, ChartPoint>();
    for (const p of points) {
      pointByTs.set(p.timestamp, p);
    }

    const isWide = window.innerWidth >= 1024;
    const priceHeight = isWide ? Math.max(440, Math.min(540, Math.round(window.innerHeight * 0.52))) : 310;
    const volHeight = isWide ? 175 : 130;

    const commonOpts = {
      layout: {
        background: { type: ColorType.Solid, color: '#06060a' },
        textColor: '#a1a1aa',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.035)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      crosshair: {
        vertLine: { color: 'rgba(255,255,255,0.22)', labelBackgroundColor: '#18181b' },
        horzLine: { color: 'rgba(255,255,255,0.18)', labelBackgroundColor: '#18181b' },
      },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.07)', minimumWidth: 80 },
    };

    const priceChart = createChart(priceContainerRef.current, {
      ...commonOpts,
      width: priceContainerRef.current.clientWidth,
      height: priceHeight,
      timeScale: { visible: false, borderColor: 'rgba(255,255,255,0.07)', rightOffset: 4 },
    });

    const volChart = createChart(volContainerRef.current, {
      ...commonOpts,
      width: volContainerRef.current.clientWidth,
      height: volHeight,
      leftPriceScale: {
        visible: lowerMode === 'volume_cvd',
        borderColor: 'rgba(56, 189, 248, 0.16)',
        minimumWidth: 64,
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: 'rgba(255,255,255,0.07)',
        rightOffset: 4,
      },
    });

    const highData = points
      .filter((p) => p.avgHighPrice !== null)
      .map((p) => ({ time: p.timestamp as never, value: p.avgHighPrice as number }));
    const lowData = points
      .filter((p) => p.avgLowPrice !== null)
      .map((p) => ({ time: p.timestamp as never, value: p.avgLowPrice as number }));

    // Determine whether we plot the forward +4h/+12h AI projection cone on the time axis
    const ml = item?.ml;
    const lastTs = points[points.length - 1].timestamp;
    const lastHigh = highData.length > 0 ? highData[highData.length - 1].value : item?.high || 0;
    const lastLow = lowData.length > 0 ? lowData[lowData.length - 1].value : item?.low || lastHigh;
    const useForwardCone =
      showAiForecast &&
      Boolean(ml?.target_12h_price) &&
      (chartWindow === '6h' || chartWindow === '24h' || chartWindow === '7d');

    const t4 = lastTs + 4 * 3600;
    const t12 = lastTs + 12 * 3600;
    const target4 = ml?.target_4h_price || ml?.target_12h_price || lastHigh;
    const target12 = ml?.target_12h_price || lastHigh;
    const bHi4 = ml?.band_high_4h || target4;
    const bLo4 = ml?.band_low_4h || target4;
    const bHi12 = ml?.band_high_12h || target12;
    const bLo12 = ml?.band_low_12h || target12;

    const allPrices = [...highData.map((d) => d.value), ...lowData.map((d) => d.value)];
    if (useForwardCone && target12 > 0) {
      allPrices.push(target4, target12, bHi12, bLo12);
    }
    allPrices.sort((a, b) => a - b);

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
      const pad = span <= 2 ? 1 : Math.max(1, span * 0.12);
      return {
        priceRange: {
          minValue: Math.max(0, Math.floor(lo - pad)),
          maxValue: Math.ceil(hi + pad),
        },
      };
    };

    const lineType = isMicroTick ? LineType.WithSteps : LineType.Simple;

    // 1. Historical High Ask Line + Warm Translucent Spread Corridor
    const highSeries = priceChart.addAreaSeries({
      lineColor: '#fbbf24',
      topColor: 'rgba(245, 158, 11, 0.26)',
      bottomColor: 'rgba(245, 158, 11, 0.03)',
      lineWidth: 2,
      lineType,
      priceFormat,
      autoscaleInfoProvider: autoscaleProvider,
      title: 'Ask',
    });

    // 2. Historical Low Bid Line (masks fill underneath to carve out crisp spread ribbon)
    const lowSeries = priceChart.addAreaSeries({
      lineColor: '#e4e4e7',
      topColor: 'rgba(6, 6, 10, 0.86)',
      bottomColor: 'rgba(6, 6, 10, 0.86)',
      lineWidth: 2,
      lineType,
      priceFormat,
      autoscaleInfoProvider: () => null,
      title: 'Bid',
    });

    highSeries.setData(highData);
    lowSeries.setData(lowData);

    // 3. True Forward AI Projection Cone (Now -> +4h -> +12h)
    if (useForwardCone && lastHigh > 0 && target12 > 0) {
      // Shaded upper forecast cone
      const coneUpper = priceChart.addAreaSeries({
        lineColor: 'rgba(34, 211, 238, 0.45)',
        topColor: 'rgba(34, 211, 238, 0.20)',
        bottomColor: 'rgba(16, 185, 129, 0.04)',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        priceFormat,
        autoscaleInfoProvider: () => null,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      // Lower cone boundary mask
      const coneLower = priceChart.addAreaSeries({
        lineColor: 'rgba(34, 211, 238, 0.35)',
        topColor: 'rgba(6, 6, 10, 0.88)',
        bottomColor: 'rgba(6, 6, 10, 0.88)',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        priceFormat,
        autoscaleInfoProvider: () => null,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      // Expected AI projection trajectory line
      const aiPath = priceChart.addLineSeries({
        color: '#22d3ee',
        lineWidth: 2,
        lineStyle: LineStyle.LargeDashed,
        priceFormat,
        autoscaleInfoProvider: () => null,
        title: 'AI +12h',
        priceLineVisible: true,
        priceLineColor: 'rgba(34, 211, 238, 0.45)',
      });

      coneUpper.setData([
        { time: lastTs as never, value: lastHigh },
        { time: t4 as never, value: Math.max(bHi4, target4) },
        { time: t12 as never, value: Math.max(bHi12, target12) },
      ]);
      coneLower.setData([
        { time: lastTs as never, value: lastLow },
        { time: t4 as never, value: Math.min(bLo4, target4) },
        { time: t12 as never, value: Math.min(bLo12, target12) },
      ]);
      aiPath.setData([
        { time: lastTs as never, value: lastHigh },
        { time: t4 as never, value: target4 },
        { time: t12 as never, value: target12 },
      ]);

      // Subtle +4h horizontal reference marker
      highSeries.createPriceLine({
        price: target4,
        color: 'rgba(56, 189, 248, 0.45)',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: `AI +4h (${ml!.prob_4h_pct.toFixed(0)}%)`,
      });
    } else if (showAiForecast && ml?.target_12h_price) {
      // On 30D/90D/1Y horizons, keep clean horizontal AI target line so long timeline isn't distorted
      highSeries.createPriceLine({
        price: ml.target_12h_price,
        color: '#22d3ee',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `AI 12h (${ml.prob_12h_pct.toFixed(0)}%)`,
      });
    }

    // 4. Optional 24h & 7d VWAP Lines
    if (showVwapLines && item) {
      const refLo = trimOutliers ? p02 : rawMin;
      const refHi = trimOutliers ? p98 : rawMax;
      const maxAllowedDist = Math.max(20, (refHi - refLo) * 3.0);
      if (item.vwap_24h && item.vwap_24h > 0 && (!trimOutliers || Math.abs(item.vwap_24h - refHi) <= maxAllowedDist)) {
        highSeries.createPriceLine({
          price: Math.round(item.vwap_24h),
          color: '#a78bfa',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: '24h VWAP',
        });
      }
      if (item.vwap_7d && item.vwap_7d > 0 && (!trimOutliers || Math.abs(item.vwap_7d - refHi) <= maxAllowedDist)) {
        highSeries.createPriceLine({
          price: Math.round(item.vwap_7d),
          color: 'rgba(167, 139, 250, 0.55)',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: '7d VWAP',
        });
      }
    }

    // =========================================================================
    // LOWER PANE: Upgraded Volume + Cumulative Net-Delta (CVD) OR OFI Wave
    // =========================================================================
    const futurePadding = useForwardCone
      ? [
          { time: t4 as never, value: 0, color: 'rgba(0,0,0,0)' },
          { time: t12 as never, value: 0, color: 'rgba(0,0,0,0)' },
        ]
      : [];

    if (lowerMode === 'volume_cvd') {
      const avgTotVol =
        points.reduce((acc, p) => acc + (p.highPriceVolume || 0) + (p.lowPriceVolume || 0), 0) /
        Math.max(1, points.length);

      const buyVolSeries = volChart.addHistogramSeries({
        color: 'rgba(16, 185, 129, 0.85)',
        priceFormat: {
          type: 'custom',
          formatter: (val: number) => formatAxisGp(Math.abs(val)),
        },
        title: 'Buy',
      });
      const sellVolSeries = volChart.addHistogramSeries({
        color: 'rgba(244, 63, 94, 0.85)',
        priceFormat: {
          type: 'custom',
          formatter: (val: number) => formatAxisGp(Math.abs(val)),
        },
        title: 'Sell',
      });

      buyVolSeries.setData([
        ...points.map((p) => {
          const bv = p.highPriceVolume || 0;
          const sv = p.lowPriceVolume || 0;
          const isSpike = avgTotVol > 0 && bv + sv >= avgTotVol * 2.2;
          const dominant = bv >= sv;
          const color = isSpike
            ? 'rgba(52, 211, 153, 0.96)'
            : dominant
              ? 'rgba(16, 185, 129, 0.84)'
              : 'rgba(16, 185, 129, 0.42)';
          return { time: p.timestamp as never, value: bv, color };
        }),
        ...futurePadding,
      ]);

      sellVolSeries.setData([
        ...points.map((p) => {
          const bv = p.highPriceVolume || 0;
          const sv = p.lowPriceVolume || 0;
          const isSpike = avgTotVol > 0 && bv + sv >= avgTotVol * 2.2;
          const dominant = sv > bv;
          const color = isSpike
            ? 'rgba(251, 113, 133, 0.96)'
            : dominant
              ? 'rgba(244, 63, 94, 0.84)'
              : 'rgba(244, 63, 94, 0.42)';
          return { time: p.timestamp as never, value: -sv, color };
        }),
        ...futurePadding,
      ]);

      // Glowing Sky-Blue Cumulative Net-Delta (CVD) Curve on left axis
      let runningDelta = 0;
      const cvdData = points.map((p) => {
        runningDelta += (p.highPriceVolume || 0) - (p.lowPriceVolume || 0);
        return { time: p.timestamp as never, value: runningDelta };
      });
      const cvdSeries = volChart.addLineSeries({
        priceScaleId: 'left',
        color: '#38bdf8',
        lineWidth: 2,
        priceFormat: {
          type: 'custom',
          formatter: (val: number) => `${val >= 0 ? '+' : ''}${formatAxisGp(val)}`,
        },
        title: 'CVD',
        priceLineVisible: false,
      });
      cvdSeries.setData(cvdData);
    } else {
      // Pure OFI Buying vs. Selling Pressure Oscillator (-1.0 .. +1.0)
      const ofiSeries = volChart.addHistogramSeries({
        priceFormat: {
          type: 'custom',
          formatter: (val: number) => `${val >= 0 ? '+' : ''}${val.toFixed(2)}`,
        },
        title: 'OFI',
      });
      ofiSeries.setData([
        ...points.map((p) => {
          const bv = p.highPriceVolume || 0;
          const sv = p.lowPriceVolume || 0;
          const tot = bv + sv;
          const ofi = tot > 0 ? (bv - sv) / tot : 0;
          const color =
            ofi >= 0.3
              ? 'rgba(52, 211, 153, 0.92)'
              : ofi > 0
                ? 'rgba(16, 185, 129, 0.62)'
                : ofi <= -0.3
                  ? 'rgba(251, 113, 133, 0.92)'
                  : 'rgba(244, 63, 94, 0.62)';
          return { time: p.timestamp as never, value: Number(ofi.toFixed(3)), color };
        }),
        ...futurePadding,
      ]);
      ofiSeries.createPriceLine({
        price: 0,
        color: 'rgba(255,255,255,0.16)',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
      });
    }

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
      priceChart.remove();
      volChart.remove();
    };
  }, [
    points,
    lowerMode,
    showAiForecast,
    showVwapLines,
    trimOutliers,
    chartWindow,
    item?.vwap_24h,
    item?.vwap_7d,
    item?.ml?.target_4h_price,
    item?.ml?.target_12h_price,
    item?.ml?.band_high_12h,
    item?.ml?.band_low_12h,
  ]);

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
  const sellFlowPct = 100 - buyFlowPct;
  const buyGpPerHr = (item?.vol_1h_high || 0) * (item?.high || item?.mid_price || 0);
  const sellGpPerHr = (item?.vol_1h_low || 0) * (item?.low || item?.mid_price || 0);

  const limitTurnover1h =
    item && item.buy_limit > 0 && item.vol_1h > 0 ? (item.vol_1h / item.buy_limit).toFixed(1) : null;

  const pressureVerdict = getPressureVerdict(item?.ofi_1h || 0, item?.ofi_5m || 0);
  const aiVerdict = item?.ml ? getAiVerdict(item.ml) : null;

  const bounceBadgeCls =
    item?.dump_bounce_outlook === 'HIGH'
      ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-300'
      : item?.dump_bounce_outlook === 'MEDIUM'
        ? 'border-amber-500/30 bg-amber-500/15 text-amber-300'
        : item?.dump_bounce_outlook === 'LOW'
          ? 'border-rose-500/35 bg-rose-500/15 text-rose-300'
          : 'border-white/10 bg-zinc-900 text-zinc-400';

  const taxLabel = item?.is_tax_exempt
    ? '0% tax exempt'
    : item?.is_mega_rare_capped
      ? '5M cap'
      : '2% tax';

  return (
    <div className="space-y-4">
      {/* ===================================================================== */}
      {/* 1. SLEEK FULL-WIDTH TICKER BAR (1-Click Copy + Tax-Transparent Margin) */}
      {/* ===================================================================== */}
      <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-[#101017] to-[#0a0a0f] px-4 py-3.5 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Left: Back + Icon + Identity */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={onBack}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/[0.09] bg-[#14141c] px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:border-white/[0.22] hover:text-white"
              title={`Back to ${backLabel} (Esc)`}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{backLabel}</span>
            </button>

            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-400/20 bg-[#15151e] shadow-[0_0_20px_rgba(245,158,11,0.1)]">
              {item?.icon ? (
                <img src={wikiIconUrl(item.icon)} alt="" className="h-8 w-8 object-contain" />
              ) : (
                <Sparkles className="h-5 w-5 text-amber-400" />
              )}
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-lg font-bold tracking-tight text-white">
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
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-500">
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

          {/* Right: 1-Click Copy Bid / Ask + Full Tax-Transparent Net Margin + Watch */}
          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
            {item && (
              <div className="flex flex-wrap items-center gap-2 font-mono-num">
                {/* Clickable Bid */}
                <button
                  type="button"
                  onClick={() => copyGp('bid', item.suggested_buy || item.low)}
                  title="Click to copy front-of-queue Buy price"
                  className="rounded-xl border border-white/[0.08] bg-[#07070c] px-3 py-1.5 text-left transition hover:border-white/[0.22]"
                >
                  <div className="flex items-center justify-between gap-2 font-sans text-[9px] uppercase tracking-wider text-zinc-500">
                    <span>Buy Bid ({formatAge(item.low_age_sec)})</span>
                    {copiedKey === 'bid' ? (
                      <Check className="h-2.5 w-2.5 text-emerald-400" />
                    ) : (
                      <Copy className="h-2.5 w-2.5 text-zinc-600" />
                    )}
                  </div>
                  <div className="text-xs font-bold text-zinc-100">
                    {formatGp(item.suggested_buy || item.low)} gp
                  </div>
                </button>

                {/* Clickable Ask */}
                <button
                  type="button"
                  onClick={() => copyGp('ask', item.suggested_sell || item.high)}
                  title="Click to copy front-of-queue Sell price"
                  className="rounded-xl border border-white/[0.08] bg-[#07070c] px-3 py-1.5 text-left transition hover:border-amber-400/35"
                >
                  <div className="flex items-center justify-between gap-2 font-sans text-[9px] uppercase tracking-wider text-zinc-500">
                    <span>Sell Ask ({formatAge(item.high_age_sec)})</span>
                    {copiedKey === 'ask' ? (
                      <Check className="h-2.5 w-2.5 text-emerald-400" />
                    ) : (
                      <Copy className="h-2.5 w-2.5 text-zinc-600" />
                    )}
                  </div>
                  <div className="text-xs font-bold text-amber-300">
                    {formatGp(item.suggested_sell || item.high)} gp
                  </div>
                </button>

                {/* Tax-Transparent Net Margin Pill */}
                <div
                  className="rounded-xl border border-white/[0.08] bg-[#07070c] px-3 py-1.5 text-left"
                  title={`Raw spread: ${formatGp(item.raw_margin)} gp\nGE Tax (${taxLabel}): -${formatGp(item.tax)} gp/unit\nNet Profit: ${formatSignedGp(item.net_margin)} gp/unit (${item.net_roi_pct.toFixed(2)}%)\nMax per 4h Limit (${item.buy_limit.toLocaleString()}x): ${formatSignedGp(item.max_profit_per_limit)} gp`}
                >
                  <div className="flex items-center gap-1.5 font-sans text-[9px] uppercase tracking-wider text-zinc-500">
                    <span>Net Margin</span>
                    <span className="text-zinc-600">·</span>
                    <span className="normal-case font-mono-num text-zinc-400">
                      Raw {formatGp(item.raw_margin, true)} − {formatGp(item.tax, true)} ({taxLabel})
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-xs font-bold ${item.net_margin > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {formatSignedGp(item.net_margin)} gp ({item.net_roi_pct >= 0 ? '+' : ''}
                      {item.net_roi_pct.toFixed(2)}%)
                    </span>
                    {item.max_profit_per_limit > 0 && (
                      <span className="hidden lg:inline text-[10px] text-zinc-500">
                        · Limit {formatSignedGp(item.max_profit_per_limit, true)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {item && (
              <button
                onClick={() => onToggleStar({ id: item.id, name: item.name, low: item.low })}
                className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-xs font-semibold transition ${
                  isStarred
                    ? 'border-amber-500/45 bg-amber-500/15 text-amber-200 hover:bg-amber-500/20'
                    : 'border-white/[0.1] bg-[#14141c] text-zinc-300 hover:border-amber-400/40 hover:text-amber-200'
                }`}
                title={isStarred ? 'Unpin from top Watch Bar' : 'Pin live card to top Watch Bar'}
              >
                <Star className={`h-3.5 w-3.5 ${isStarred ? 'fill-current' : ''}`} />
                <span>{isStarred ? 'Watching' : 'Watch'}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* 2. FULL-WIDTH OBSIDIAN QUANT CINEMA CHART HERO                        */}
      {/* ===================================================================== */}
      <div
        ref={chartFrameRef}
        className="overflow-hidden rounded-2xl border border-white/[0.1] bg-[#06060a] shadow-[0_0_40px_rgba(245,158,11,0.06)]"
      >
        {/* Unified Chart Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] bg-[#0b0b11] px-4 py-2.5">
          {/* Left: Timeframes + Glowing Overlay Pills */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-lg border border-white/[0.08] bg-[#060609] p-0.5">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf.key}
                  onClick={() => setChartWindow(tf.key)}
                  title={tf.hint}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                    chartWindow === tf.key
                      ? 'bg-zinc-100 text-zinc-950 shadow-xs'
                      : 'text-zinc-400 hover:text-zinc-100'
                  }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>

            {item?.ml && (
              <button
                type="button"
                onClick={() => setShowAiForecast((v) => !v)}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                  showAiForecast
                    ? 'border-cyan-400/40 bg-cyan-500/15 text-cyan-200'
                    : 'border-white/[0.08] bg-[#07070c] text-zinc-400 hover:text-zinc-200'
                }`}
                title="Plot ML +4h & +12h forward forecast cone directly onto the price timeline"
              >
                <Brain className="h-3 w-3" />
                AI Forecast
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowVwapLines((v) => !v)}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                showVwapLines
                  ? 'border-violet-400/40 bg-violet-500/15 text-violet-200'
                  : 'border-white/[0.08] bg-[#07070c] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              VWAP
            </button>

            <button
              type="button"
              onClick={() => setTrimOutliers((v) => !v)}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                trimOutliers
                  ? 'border-amber-400/35 bg-amber-500/12 text-amber-200'
                  : 'border-white/[0.08] bg-[#07070c] text-zinc-400 hover:text-zinc-200'
              }`}
              title="Trims 2nd–98th percentile spikes so micro-tick items fill the chart cleanly"
            >
              Trim Outliers
            </button>

            <button
              type="button"
              onClick={() => setChartReloadNonce((n) => n + 1)}
              className="rounded-lg border border-white/[0.08] bg-[#07070c] p-1.5 text-zinc-400 hover:text-white transition"
              title="Reload chart candles"
            >
              <RefreshCw className={`h-3 w-3 ${loadingChart ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Right: Live Hovered Candle OHLC + Spread + Volume Readout */}
          {displayPoint && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono-num">
              <span className="text-zinc-500">{displayTimeStr}</span>
              <span>
                <span className="text-amber-400 font-semibold">Ask</span>{' '}
                <span className="text-zinc-100">{formatGp(displayPoint.avgHighPrice)}</span>
              </span>
              <span>
                <span className="text-zinc-400 font-semibold">Bid</span>{' '}
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

        {/* Chart Canvas Area */}
        {loadingChart && points.length === 0 ? (
          <div className="flex h-[620px] items-center justify-center text-xs text-zinc-500">
            Loading {chartWindow.toUpperCase()} price, AI forecast &amp; order-flow history...
          </div>
        ) : points.length === 0 ? (
          <div className="flex h-[620px] items-center justify-center text-xs text-zinc-500">
            No historical candle points returned for this timeframe.
          </div>
        ) : (
          <div>
            {/* Price Pane with Subtle Floating HUD Badges */}
            <div className="relative">
              {item && (
                <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2">
                  {item.ml && showAiForecast && (
                    <div className="flex items-center gap-2 rounded-xl border border-cyan-400/30 bg-[#080d12]/85 px-2.5 py-1 text-[11px] backdrop-blur-md font-mono-num">
                      <Brain className="h-3.5 w-3.5 text-cyan-400" />
                      <span className="text-cyan-200 font-bold">
                        +4h {item.ml.prob_4h_pct.toFixed(0)}%
                        {item.ml.target_4h_price ? ` (${formatGp(item.ml.target_4h_price, true)})` : ''}
                      </span>
                      <span className="text-white/20">·</span>
                      <span className="text-emerald-300 font-bold">
                        +12h {item.ml.prob_12h_pct.toFixed(0)}%
                        {item.ml.target_12h_price ? ` (${formatGp(item.ml.target_12h_price, true)})` : ''}
                      </span>
                    </div>
                  )}
                  <div className="hidden sm:flex items-center gap-1.5 rounded-xl border border-white/[0.09] bg-[#0a0a10]/82 px-2.5 py-1 text-[11px] backdrop-blur-md font-mono-num">
                    <span className={buyFlowPct >= 55 ? 'text-emerald-400 font-bold' : buyFlowPct <= 45 ? 'text-rose-400 font-bold' : 'text-zinc-300 font-semibold'}>
                      {buyFlowPct >= 50 ? `${buyFlowPct}% Buyers` : `${sellFlowPct}% Sellers`}
                    </span>
                    <span className="text-white/20">·</span>
                    <span className="text-zinc-400">
                      OFI {item.ofi_1h >= 0 ? '+' : ''}
                      {item.ofi_1h.toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
              <div ref={priceContainerRef} className="w-full" />
            </div>

            {/* Upgraded Lower Pane Header with 1-Click Mode Switch */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-y border-white/[0.07] bg-[#0a0a10] px-4 py-1.5 text-[10px]">
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-lg border border-white/[0.08] bg-[#060609] p-0.5 font-semibold">
                  <button
                    type="button"
                    onClick={() => setLowerMode('volume_cvd')}
                    className={`rounded-md px-2 py-0.5 transition ${
                      lowerMode === 'volume_cvd'
                        ? 'bg-sky-500/20 text-sky-200'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Volume + Net Delta (CVD)
                  </button>
                  <button
                    type="button"
                    onClick={() => setLowerMode('ofi_wave')}
                    className={`rounded-md px-2 py-0.5 transition ${
                      lowerMode === 'ofi_wave'
                        ? 'bg-emerald-500/20 text-emerald-200'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    OFI Pressure Wave
                  </button>
                </div>
              </div>

              {lowerMode === 'volume_cvd' ? (
                <div className="flex flex-wrap items-center gap-3 text-zinc-400">
                  <span className="flex items-center gap-1 text-emerald-400">
                    <span className="h-2 w-2 rounded-xs bg-emerald-400" /> Instant Buy (Up)
                  </span>
                  <span className="flex items-center gap-1 text-rose-400">
                    <span className="h-2 w-2 rounded-xs bg-rose-400" /> Instant Sell (Down)
                  </span>
                  <span className="flex items-center gap-1 text-sky-400 font-semibold">
                    <span className="h-0.5 w-3 bg-sky-400" /> Cumulative Net Delta (CVD)
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-3 text-zinc-400">
                  <span className="text-emerald-400">+1.0 = 100% Aggressive Buying</span>
                  <span className="text-zinc-600">·</span>
                  <span className="text-rose-400">-1.0 = 100% Aggressive Selling</span>
                </div>
              )}
            </div>

            <div ref={volContainerRef} className="w-full" />
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* 3. PROMINENT 2-COLUMN COMMAND STRIP: ML FORECAST + BUY/SELL PRESSURE  */}
      {/* ===================================================================== */}
      {item && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* LEFT HERO CARD: ML Dual-Horizon Forecast */}
          <div className="rounded-2xl border border-cyan-500/25 bg-gradient-to-b from-[#0c1218] to-[#0a0a10] p-5 space-y-4 shadow-[0_0_32px_rgba(34,211,238,0.08)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-cyan-400">
                  <Brain className="h-3.5 w-3.5" />
                  <span>ML Dual-Horizon Forecast</span>
                  <InfoTooltip
                    title="Walk-Forward GBDT Predictions"
                    text="4 strictly causal Gradient-Boosted models trained on hourly OSRS history. Predicts 4h & 12h post-2%-tax win odds, expected ROI %, and implied target prices."
                  />
                </div>
                <h2 className="mt-1 text-base font-bold text-white">
                  {aiVerdict ? aiVerdict.label : 'ML Predictions Warming Up'}
                </h2>
              </div>

              {item.ml?.target_12h_price && (
                <button
                  type="button"
                  onClick={() => copyGp('ai12', item.ml?.target_12h_price)}
                  title="Click to copy AI +12h Projected Target Price"
                  className="flex items-center gap-1.5 rounded-xl border border-cyan-400/35 bg-cyan-500/15 px-3 py-1.5 text-xs font-bold text-cyan-200 font-mono-num transition hover:bg-cyan-500/25"
                >
                  <span>12h Target {formatGp(item.ml.target_12h_price)}</span>
                  {copiedKey === 'ai12' ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3 text-cyan-300/80" />
                  )}
                </button>
              )}
            </div>

            {item.ml ? (
              <>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 font-mono-num">
                  {/* 4h Win & Target */}
                  <div className="rounded-xl border border-white/[0.07] bg-[#07080d] p-3 space-y-1.5">
                    <div className="flex items-center justify-between font-sans text-[10px] uppercase tracking-wider text-zinc-400">
                      <span>4h Quick Flip</span>
                      <span className="text-zinc-500">≥ +0.5%</span>
                    </div>
                    <div
                      className={`text-xl font-extrabold ${
                        item.ml.prob_4h_pct >= 70
                          ? 'text-emerald-400'
                          : item.ml.prob_4h_pct >= 55
                            ? 'text-amber-300'
                            : 'text-rose-400'
                      }`}
                    >
                      {item.ml.prob_4h_pct.toFixed(0)}%
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
                      <div
                        className={`h-full rounded-full ${
                          item.ml.prob_4h_pct >= 70
                            ? 'bg-emerald-400'
                            : item.ml.prob_4h_pct >= 55
                              ? 'bg-amber-400'
                              : 'bg-rose-400'
                        }`}
                        style={{ width: `${Math.min(100, item.ml.prob_4h_pct)}%` }}
                      />
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      {item.ml.target_4h_price ? (
                        <>
                          +4h ≈ <strong className="text-cyan-200">{formatGp(item.ml.target_4h_price, true)}</strong>
                          {item.ml.pred_4h_roi_pct !== undefined && (
                            <span className="text-zinc-500">
                              {' '}
                              ({item.ml.pred_4h_roi_pct >= 0 ? '+' : ''}
                              {item.ml.pred_4h_roi_pct.toFixed(1)}%)
                            </span>
                          )}
                        </>
                      ) : (
                        'Active spread odds'
                      )}
                    </div>
                  </div>

                  {/* 12h Overnight Win */}
                  <div className="rounded-xl border border-white/[0.07] bg-[#07080d] p-3 space-y-1.5">
                    <div className="flex items-center justify-between font-sans text-[10px] uppercase tracking-wider text-zinc-400">
                      <span>12h Overnight</span>
                      <span className="text-zinc-500">≥ +1.2%</span>
                    </div>
                    <div
                      className={`text-xl font-extrabold ${
                        item.ml.prob_12h_pct >= 70
                          ? 'text-cyan-300'
                          : item.ml.prob_12h_pct >= 55
                            ? 'text-amber-300'
                            : 'text-rose-400'
                      }`}
                    >
                      {item.ml.prob_12h_pct.toFixed(0)}%
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
                      <div
                        className={`h-full rounded-full ${
                          item.ml.prob_12h_pct >= 70
                            ? 'bg-cyan-400'
                            : item.ml.prob_12h_pct >= 55
                              ? 'bg-amber-400'
                              : 'bg-rose-400'
                        }`}
                        style={{ width: `${Math.min(100, item.ml.prob_12h_pct)}%` }}
                      />
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      {item.ml.band_low_12h && item.ml.band_high_12h ? (
                        <>
                          Range{' '}
                          <strong className="text-zinc-200">
                            {formatGp(item.ml.band_low_12h, true)}–{formatGp(item.ml.band_high_12h, true)}
                          </strong>
                        </>
                      ) : (
                        'Overnight swing odds'
                      )}
                    </div>
                  </div>

                  {/* Predicted 12h Post-Tax ROI */}
                  <div className="rounded-xl border border-white/[0.07] bg-[#07080d] p-3 space-y-1.5">
                    <div className="font-sans text-[10px] uppercase tracking-wider text-zinc-400">
                      Pred 12h Net ROI
                    </div>
                    <div
                      className={`text-xl font-extrabold ${
                        item.ml.pred_12h_roi_pct >= 1.2
                          ? 'text-amber-300'
                          : item.ml.pred_12h_roi_pct >= 0
                            ? 'text-zinc-100'
                            : 'text-rose-400'
                      }`}
                    >
                      {item.ml.pred_12h_roi_pct >= 0 ? '+' : ''}
                      {item.ml.pred_12h_roi_pct.toFixed(2)}%
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      After {taxLabel}
                    </div>
                    {item.suggested_buy && (
                      <div className="text-[11px] text-emerald-400 font-semibold">
                        ~{formatSignedGp(Math.round(item.suggested_buy * (item.ml.pred_12h_roi_pct / 100)), true)}/ea
                      </div>
                    )}
                  </div>
                </div>

                {aiVerdict && (
                  <p className="text-xs leading-relaxed text-zinc-300">{aiVerdict.summary}</p>
                )}
              </>
            ) : (
              <p className="rounded-xl border border-white/[0.06] bg-[#07080d] p-4 text-xs text-zinc-400">
                ML predictions are currently unavailable for this item (either models haven't been trained yet in
                Settings → ML &amp; Backtest, or this item has too little hourly liquidity to score reliably).
              </p>
            )}
          </div>

          {/* RIGHT HERO CARD: Live Buying vs. Selling Pressure */}
          <div className="rounded-2xl border border-white/[0.1] bg-gradient-to-b from-[#111119] to-[#0a0a10] p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                  <Activity className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Live Buying vs. Selling Pressure</span>
                  <InfoTooltip
                    title="Order-Flow Imbalance (OFI)"
                    text="Compares real RuneLite instant-buys (players paying Ask) against instant-sells (players dumping into Bid) across 5m, 1h, and 24h windows."
                    align="right"
                  />
                </div>
                <h2 className={`mt-1 text-base font-bold ${pressureVerdict.tone}`}>
                  {pressureVerdict.label}
                </h2>
              </div>

              <span className={`rounded-xl border px-3 py-1.5 text-xs font-bold font-mono-num ${pressureVerdict.badge}`}>
                {buyFlowPct >= 50 ? `${buyFlowPct}% Buyers` : `${sellFlowPct}% Sellers`}
              </span>
            </div>

            {/* Bold Visual Tug-of-War Pressure Bar */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs font-mono-num">
                <span className="flex items-center gap-1 font-bold text-emerald-400">
                  <TrendingUp className="h-3.5 w-3.5" />
                  {item.vol_1h_high.toLocaleString()}/h
                  <span className="text-[11px] font-normal text-emerald-300/75">
                    ({formatGp(buyGpPerHr, true)} gp/h)
                  </span>
                </span>
                <span className="flex items-center gap-1 font-bold text-rose-400">
                  <span className="text-[11px] font-normal text-rose-300/75">
                    ({formatGp(sellGpPerHr, true)} gp/h)
                  </span>
                  {item.vol_1h_low.toLocaleString()}/h
                  <TrendingDown className="h-3.5 w-3.5" />
                </span>
              </div>

              <div className="relative flex h-3.5 w-full overflow-hidden rounded-full bg-rose-500/75 p-0.5 shadow-inner">
                <div
                  className="h-full rounded-l-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-all duration-300"
                  style={{ width: `${Math.max(4, Math.min(96, buyFlowPct))}%` }}
                />
                {/* Center 50% equilibrium tick */}
                <span className="pointer-events-none absolute left-1/2 top-0 bottom-0 w-px bg-white/40" />
              </div>
            </div>

            {/* 3-Horizon OFI Telemetry: 5m Tape | 1h Flow | 24h Flow */}
            <div className="grid grid-cols-3 gap-2.5 text-center font-mono-num">
              {[
                { label: '5m Tape', val: item.ofi_5m, sub: `↑${item.vol_5m_high} · ↓${item.vol_5m_low}` },
                { label: '1h Flow', val: item.ofi_1h, sub: `${buyFlowPct}%B / ${sellFlowPct}%S` },
                { label: '24h Flow', val: item.ofi_24h, sub: `${formatGp(item.vol_24h, true)} total` },
              ].map((h) => {
                const pos = h.val >= 0.15;
                const neg = h.val <= -0.15;
                const cls = pos
                  ? 'border-emerald-500/25 bg-emerald-500/[0.07]'
                  : neg
                    ? 'border-rose-500/25 bg-rose-500/[0.07]'
                    : 'border-white/[0.07] bg-[#07080d]';
                const txt = pos ? 'text-emerald-400' : neg ? 'text-rose-400' : 'text-zinc-200';
                return (
                  <div key={h.label} className={`rounded-xl border p-2.5 ${cls}`}>
                    <div className="font-sans text-[10px] uppercase tracking-wider text-zinc-400">{h.label}</div>
                    <div className={`mt-0.5 text-sm font-extrabold ${txt}`}>
                      {h.val >= 0 ? '+' : ''}
                      {h.val.toFixed(2)} {pos ? '↑' : neg ? '↓' : '→'}
                    </div>
                    <div className="mt-0.5 text-[10px] text-zinc-500 truncate">{h.sub}</div>
                  </div>
                );
              })}
            </div>

            <p className="text-xs leading-relaxed text-zinc-400">{pressureVerdict.desc}</p>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 4. DEEP ANALYTICS DECK: VWAP/DUMPS + MARKET REGIME & MICROSTRUCTURE   */}
      {/* ===================================================================== */}
      {item && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Card A: VWAP & Mean-Reversion / Dump Targets */}
          <div className="rounded-2xl border border-white/[0.08] bg-[#0b0b11] p-4 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Flame className="h-4 w-4 text-rose-400" />
                <span className="text-xs font-bold text-zinc-100">VWAP &amp; Mean-Reversion Targets</span>
              </div>
              <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${bounceBadgeCls}`}>
                Bounce: {item.dump_bounce_outlook || 'NONE'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 text-xs font-mono-num">
              <div className="rounded-xl border border-white/[0.06] bg-[#07070b] p-2.5">
                <div className="font-sans text-[10px] text-sky-400">24h VWAP</div>
                <div className="mt-0.5 font-bold text-zinc-100">
                  {formatGp(item.vwap_24h ? Math.round(item.vwap_24h) : null)}
                </div>
                <div className={`text-[10px] ${item.zscore_24h <= -1.6 ? 'text-rose-400 font-bold' : 'text-zinc-500'}`}>
                  Z = {item.zscore_24h.toFixed(2)}σ
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-[#07070b] p-2.5">
                <div className="font-sans text-[10px] text-violet-400">7d VWAP</div>
                <div className="mt-0.5 font-bold text-zinc-100">
                  {formatGp(item.vwap_7d ? Math.round(item.vwap_7d) : null)}
                </div>
                <div className={`text-[10px] ${item.zscore_7d <= -1.6 ? 'text-rose-400 font-bold' : 'text-zinc-500'}`}>
                  Z = {item.zscore_7d.toFixed(2)}σ
                </div>
              </div>
              <button
                type="button"
                onClick={() => copyGp('bounce', item.dump_conservative_target)}
                disabled={!item.dump_conservative_target}
                className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-2.5 text-left hover:bg-emerald-500/15 disabled:opacity-40 transition"
                title="Click to copy Safe Bounce Target"
              >
                <div className="flex items-center justify-between font-sans text-[10px] text-emerald-300">
                  <span>Safe Bounce</span>
                  {copiedKey === 'bounce' ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5 opacity-70" />}
                </div>
                <div className="mt-0.5 font-bold text-emerald-200">{formatGp(item.dump_conservative_target)}</div>
                <div className="font-sans text-[10px] text-emerald-400/80">99% VWAP</div>
              </button>
              <button
                type="button"
                onClick={() => copyGp('rebound', item.dump_full_target)}
                disabled={!item.dump_full_target}
                className="rounded-xl border border-violet-500/25 bg-violet-500/10 p-2.5 text-left hover:bg-violet-500/15 disabled:opacity-40 transition"
                title="Click to copy Full 7d Rebound Target"
              >
                <div className="flex items-center justify-between font-sans text-[10px] text-violet-300">
                  <span>7d Rebound</span>
                  {copiedKey === 'rebound' ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5 opacity-70" />}
                </div>
                <div className="mt-0.5 font-bold text-violet-200">{formatGp(item.dump_full_target)}</div>
                <div className="font-sans text-[10px] text-violet-400/80">98.5% 7d</div>
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

          {/* Card B: Market Regime, Activity & Safety */}
          <div className="rounded-2xl border border-white/[0.08] bg-[#0b0b11] p-4 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-amber-400" />
                <span className="text-xs font-bold text-zinc-100">Market Regime &amp; Microstructure</span>
              </div>
              <div className="flex items-center gap-3">
                <VolumeIndicator
                  vol5m={item.vol_5m}
                  vol1h={item.vol_1h}
                  vol24h={item.vol_24h}
                  unitPrice={item.low || item.high || 1}
                />
                <span className="text-[11px] font-mono-num text-zinc-400">
                  Safety{' '}
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
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 text-xs font-mono-num">
              <div className="rounded-xl border border-white/[0.06] bg-[#07070b] p-2.5">
                <div className="font-sans text-[10px] text-zinc-500">48h Band (p25–p75)</div>
                <div className="mt-0.5 font-bold text-indigo-300">
                  {item.p25_48h && item.p75_48h
                    ? `${formatGp(item.p25_48h, true)}–${formatGp(item.p75_48h, true)}`
                    : '—'}
                </div>
                <div className="text-[10px] text-zinc-500">
                  7d drift{' '}
                  {item.trend_7d_pct !== undefined
                    ? `${item.trend_7d_pct >= 0 ? '+' : ''}${item.trend_7d_pct.toFixed(1)}%`
                    : '—'}
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-[#07070b] p-2.5">
                <div className="font-sans text-[10px] text-zinc-500">Volume (5m / 1h / 24h)</div>
                <div className="mt-0.5 font-bold text-zinc-100">
                  {formatGp(item.vol_1h, true)}/h
                </div>
                <div className="text-[10px] text-zinc-500">
                  5m {item.vol_5m.toLocaleString()} · 24h {formatGp(item.vol_24h, true)}
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-[#07070b] p-2.5">
                <div className="font-sans text-[10px] text-zinc-500">High Alch / Floor</div>
                <div className="mt-0.5 font-bold text-zinc-100">
                  {item.highalch > 0 ? formatGp(item.highalch) : '—'}
                </div>
                <div className="text-[10px] text-zinc-500">
                  {item.alch_floor_pct !== null
                    ? `${item.alch_floor_pct >= 0 ? '+' : ''}${item.alch_floor_pct.toFixed(1)}% vs floor`
                    : 'No floor'}
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-[#07070b] p-2.5">
                <div className="font-sans text-[10px] text-zinc-500">24h Volatility</div>
                <div className="mt-0.5 font-bold text-zinc-100">{item.volatility_24h_pct.toFixed(2)}%</div>
                <div className="text-[10px] text-zinc-500">Sharpe {item.flip_sharpe.toFixed(2)}</div>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-[#07070b] p-2.5">
                <div className="font-sans text-[10px] text-zinc-500">Hour Seasonality</div>
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
              <div className="rounded-xl border border-white/[0.06] bg-[#07070b] p-2.5">
                <div className="font-sans text-[10px] text-zinc-500">Volume Spike Ratio</div>
                <div
                  className={`mt-0.5 font-bold ${
                    item.volume_spike_ratio >= 2.0 ? 'text-amber-300' : 'text-zinc-100'
                  }`}
                >
                  {item.volume_spike_ratio.toFixed(2)}×
                </div>
                <div className="text-[10px] text-zinc-500">5m vs 24h avg</div>
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
        </div>
      )}
    </div>
  );
}
