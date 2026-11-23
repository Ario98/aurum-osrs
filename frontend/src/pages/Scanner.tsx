import { useCallback, useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import { api } from '../api/client';
import type { ItemMetrics, ScannerPreset } from '../types';
import { formatAge, formatGp, formatSignedGp, wikiIconUrl } from '../utils/format';

const PRESETS: { key: ScannerPreset; label: string }[] = [
  { key: 'all', label: 'All Items' },
  { key: 'fast_flip', label: 'Fast Flips' },
  { key: 'overnight', label: 'Big Margin' },
  { key: 'dump_sniper', label: 'Dump Sniper' },
  { key: 'alch_floor', label: 'Alch Floor' },
  { key: 'tax_exempt', label: '0% Tax Exempt' },
  { key: 'mega_rares', label: '>250M Tax Cap' },
];

interface Props {
  members: boolean;
  tickVersion: number;
  onOpenChart: (itemId: number) => void;
}

export function Scanner({ members, tickVersion, onOpenChart }: Props) {
  const [query, setQuery] = useState('');
  const [preset, setPreset] = useState<ScannerPreset>('fast_flip');
  const [minVol, setMinVol] = useState(50);
  const [minSafety, setMinSafety] = useState(40);
  const [hideStale, setHideStale] = useState(true);
  const [sortBy, setSortBy] = useState('overall_score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [items, setItems] = useState<ItemMetrics[]>([]);
  const [totalMatched, setTotalMatched] = useState(0);
  const [loading, setLoading] = useState(false);

  const parentRef = useRef<HTMLDivElement | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.scanner({
        q: query,
        preset,
        members,
        min_vol_24h: query ? 0 : minVol,
        min_safety: query ? 0 : minSafety,
        hide_stale: hideStale,
        sort_by: sortBy,
        sort_dir: sortDir,
        limit: 1500,
      });
      setItems(res.items);
      setTotalMatched(res.total_matched);
    } finally {
      setLoading(false);
    }
  }, [query, preset, members, minVol, minSafety, hideStale, sortBy, sortDir]);

  useEffect(() => {
    const id = window.setTimeout(fetchItems, query ? 150 : 0);
    return () => window.clearTimeout(id);
  }, [fetchItems, tickVersion]);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 50,
    overscan: 15,
  });

  const toggleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(col);
      setSortDir('desc');
    }
  };

  const SortHeader = ({ field, label, align = 'right' }: { field: string; label: string; align?: 'left' | 'right' }) => (
    <button
      onClick={() => toggleSort(field)}
      className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500 hover:text-zinc-200 ${
        align === 'right' ? 'ml-auto justify-end' : ''
      }`}
    >
      {label}
      {sortBy === field && (sortDir === 'desc' ? <ArrowDown className="h-3 w-3 text-amber-400" /> : <ArrowUp className="h-3 w-3 text-amber-400" />)}
    </button>
  );

  return (
    <div className="space-y-3.5">
      {/* Filter Toolbar */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-4 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search any of 4,600+ OSRS items or ID..."
              className="w-full rounded-xl border border-white/[0.1] bg-[#060608] py-2 pl-9 pr-3 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-white/25 outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-300">
            <label className="flex items-center gap-1.5">
              <span className="text-zinc-500">Min 24h Vol</span>
              <select
                value={minVol}
                onChange={(e) => setMinVol(Number(e.target.value))}
                className="rounded-lg border border-white/[0.1] bg-[#060608] px-2.5 py-1 text-xs text-zinc-200 outline-none"
              >
                <option value={0}>Any</option>
                <option value={50}>50+</option>
                <option value={250}>250+</option>
                <option value={1000}>1,000+</option>
                <option value={10000}>10,000+</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-zinc-500">Min Safety</span>
              <select
                value={minSafety}
                onChange={(e) => setMinSafety(Number(e.target.value))}
                className="rounded-lg border border-white/[0.1] bg-[#060608] px-2.5 py-1 text-xs text-zinc-200 outline-none"
              >
                <option value={0}>Any</option>
                <option value={40}>40+</option>
                <option value={65}>65+</option>
                <option value={80}>80+</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={hideStale}
                onChange={(e) => setHideStale(e.target.checked)}
                className="accent-zinc-100"
              />
              <span className="text-zinc-400">Hide stale</span>
            </label>
            <span className="text-zinc-500 tabular-nums">
              {loading ? 'Scanning...' : `${totalMatched.toLocaleString()} items`}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => {
                setPreset(p.key);
                if (p.key === 'fast_flip') setSortBy('fast_flip_score');
                else if (p.key === 'overnight') setSortBy('overnight_score');
                else if (p.key === 'dump_sniper') setSortBy('dump_sniper_score');
                else if (p.key === 'alch_floor') setSortBy('alch_floor_score');
                else setSortBy('overall_score');
                setSortDir('desc');
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                preset === p.key
                  ? 'bg-zinc-100 text-zinc-950'
                  : 'border border-white/[0.06] bg-[#070709] text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Virtualized Table */}
      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0c0f]">
        <div className="grid grid-cols-[2.2fr_1fr_1fr_1fr_0.8fr_1fr_1fr_0.9fr_0.7fr] items-center gap-2 border-b border-white/[0.07] bg-[#08080b] px-4 py-3">
          <SortHeader field="name" label="Item" align="left" />
          <SortHeader field="low" label="Buy (Low)" />
          <SortHeader field="high" label="Sell (High)" />
          <SortHeader field="net_margin" label="Net Margin" />
          <SortHeader field="net_roi_pct" label="ROI %" />
          <SortHeader field="max_profit_per_limit" label="Profit / Limit" />
          <SortHeader field="vol_24h" label="24h Vol" />
          <SortHeader field="ofi_1h" label="Flow / Z" />
          <SortHeader field="overall_score" label="Score" />
        </div>

        <div ref={parentRef} className="h-[640px] overflow-auto">
          <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map((vRow) => {
              const item = items[vRow.index];
              if (!item) return null;
              return (
                <div
                  key={item.id}
                  onClick={() => onOpenChart(item.id)}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${vRow.size}px`,
                    transform: `translateY(${vRow.start}px)`,
                  }}
                  className="grid cursor-pointer grid-cols-[2.2fr_1fr_1fr_1fr_0.8fr_1fr_1fr_0.9fr_0.7fr] items-center gap-2 border-b border-white/[0.04] px-4 text-xs hover:bg-white/[0.04] tabular-nums transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {item.icon && (
                      <img src={wikiIconUrl(item.icon)} alt="" className="h-6 w-6 shrink-0 object-contain" loading="lazy" />
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-medium text-zinc-100">{item.name}</div>
                      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                        <span>Lim {item.buy_limit ? item.buy_limit.toLocaleString() : '—'}</span>
                        <span>· {formatAge(Math.max(item.high_age_sec || 0, item.low_age_sec || 0))}</span>
                        {item.is_tax_exempt && <span className="text-emerald-400 font-semibold">0% TAX</span>}
                        {item.is_mega_rare_capped && <span className="text-amber-300 font-semibold">5M CAP</span>}
                      </div>
                    </div>
                  </div>

                  <div className="text-right font-medium text-zinc-200">{formatGp(item.low)}</div>
                  <div className="text-right font-medium text-amber-300">{formatGp(item.high)}</div>
                  <div className={`text-right font-semibold ${item.net_margin > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {formatSignedGp(item.net_margin)}
                  </div>
                  <div className={`text-right ${item.net_roi_pct > 0 ? 'text-emerald-300' : 'text-rose-400'}`}>
                    {item.net_roi_pct.toFixed(1)}%
                  </div>
                  <div className="text-right font-medium text-zinc-200">{formatGp(item.max_profit_per_limit, true)}</div>
                  <div className="text-right text-zinc-400">{item.vol_24h.toLocaleString()}</div>
                  <div className="text-right text-[11px]">
                    <span className={item.ofi_1h >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                      {item.ofi_1h >= 0 ? '+' : ''}
                      {(item.ofi_1h * 100).toFixed(0)}%
                    </span>
                    <span className="text-zinc-700"> / </span>
                    <span className={item.zscore_7d <= -1.6 ? 'text-rose-400 font-bold' : 'text-zinc-500'}>
                      {item.zscore_7d.toFixed(1)}σ
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="inline-block rounded-lg border border-white/[0.08] bg-[#141419] px-2 py-0.5 font-bold text-zinc-100">
                      {Math.round(item.overall_score)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
