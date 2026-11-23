import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Bell, BellOff, Plus, Save, Search, Star, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import type { ItemMetrics, WatchlistItem } from '../types';
import { formatGp, formatSignedGp, wikiIconUrl } from '../utils/format';

interface Props {
  tickVersion: number;
  watchlistVersion: number;
  onWatchlistChanged: () => void;
  onOpenChart: (itemId: number) => void;
}

export function Watchlist({ tickVersion, watchlistVersion, onWatchlistChanged, onOpenChart }: Props) {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState<ItemMetrics[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.watchlist();
      setItems(res.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, tickVersion, watchlistVersion]);

  useEffect(() => {
    if (!search.trim()) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const id = window.setTimeout(async () => {
      const res = await api.scanner({ q: search, hide_stale: false, sort_by: 'vol_24h', limit: 6 });
      if (!cancelled) setSuggestions(res.items);
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [search]);

  const addItem = async (m: ItemMetrics) => {
    await api.upsertWatchlist({
      item_id: m.id,
      item_name: m.name,
      buy_below: m.low ? Math.max(1, Math.round(m.low * 0.97)) : null,
      sell_above: null,
      min_net_margin: null,
      discord_notify: true,
    });
    setSearch('');
    setSuggestions([]);
    await load();
    onWatchlistChanged();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300">
            <Star className="h-4 w-4 fill-current" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-zinc-100">Watchlist & Price Alerts</h1>
            <p className="text-xs text-zinc-500">
              Track favorite items and get instant in-app + Discord alerts when live buy, sell, or net margin targets trigger
            </p>
          </div>
        </div>

        {/* Inline Add-to-Watchlist Search */}
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Add item to watchlist (e.g. Old school bond)..."
            className="w-full rounded-xl border border-white/[0.1] bg-[#0b0b0f] py-2 pl-9 pr-3 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-white/25 outline-none"
          />
          {suggestions.length > 0 && (
            <div className="absolute right-0 left-0 mt-1.5 z-30 overflow-hidden rounded-xl border border-white/[0.12] bg-[#0d0d12] shadow-2xl">
              {suggestions.map((m) => (
                <button
                  key={m.id}
                  onClick={() => addItem(m)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-white/[0.06]"
                >
                  <span className="flex items-center gap-2 truncate">
                    {m.icon && <img src={wikiIconUrl(m.icon)} alt="" className="h-4 w-4 object-contain" />}
                    <span className="truncate font-medium text-zinc-100">{m.name}</span>
                  </span>
                  <span className="flex items-center gap-1 text-amber-300 shrink-0 font-mono-num">
                    {formatGp(m.low, true)} <Plus className="h-3.5 w-3.5" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/[0.1] bg-[#0a0a0d] p-12 text-center text-xs text-zinc-500">
          {loading
            ? 'Loading watchlist...'
            : 'No starred items yet. Use the search box above or click the Star icon inside any Item Modal to track custom buy/sell/margin alerts!'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a0a0e]">
          <div className="divide-y divide-white/[0.05]">
            {items.map((item) => (
              <WatchlistRow
                key={item.item_id}
                item={item}
                onOpenChart={onOpenChart}
                onSave={async (updates) => {
                  await api.upsertWatchlist({
                    item_id: item.item_id,
                    item_name: item.item_name,
                    ...updates,
                  });
                  await load();
                  onWatchlistChanged();
                }}
                onDelete={async () => {
                  await api.deleteWatchlist(item.item_id);
                  await load();
                  onWatchlistChanged();
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WatchlistRow({
  item,
  onOpenChart,
  onSave,
  onDelete,
}: {
  item: WatchlistItem;
  onOpenChart: (id: number) => void;
  onSave: (u: {
    buy_below: number | null;
    sell_above: number | null;
    min_net_margin: number | null;
    discord_notify: boolean;
  }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [buyBelow, setBuyBelow] = useState(item.buy_below ? String(item.buy_below) : '');
  const [sellAbove, setSellAbove] = useState(item.sell_above ? String(item.sell_above) : '');
  const [minMargin, setMinMargin] = useState(item.min_net_margin ? String(item.min_net_margin) : '');
  const [discord, setDiscord] = useState(item.discord_notify);
  const [saving, setSaving] = useState(false);

  const isTriggered = item.triggered.length > 0;

  const parseOpt = (v: string): number | null => {
    const n = Number(v.replace(/,/g, '').trim());
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  };

  return (
    <div className={`px-4 py-3.5 lg:px-5 ${isTriggered ? 'bg-emerald-500/[0.05]' : 'hover:bg-white/[0.02]'}`}>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.6fr_1.1fr_2.4fr_auto] lg:items-center lg:gap-4">
        {/* Item Info */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => onOpenChart(item.item_id)}
            title="Open item chart & order ticket"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-[#121217] transition hover:border-amber-400/40 hover:bg-[#191922]"
          >
            {item.icon && <img src={wikiIconUrl(item.icon)} alt="" className="h-6 w-6 object-contain" />}
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => onOpenChart(item.item_id)}
                title="Open item chart & order ticket"
                className="group/item inline-flex items-center gap-1 truncate text-sm font-semibold text-zinc-100 hover:text-amber-300 hover:underline underline-offset-2 transition"
              >
                <span className="truncate">{item.item_name}</span>
                <span className="text-[10px] text-amber-400/0 transition group-hover/item:text-amber-400">↗</span>
              </button>
              {isTriggered && (
                <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300 animate-pulse">
                  TARGET HIT
                </span>
              )}
            </div>
            <div className="text-[11px] text-zinc-500 font-mono-num">
              1h Vol {item.vol_1h.toLocaleString()} · 24h {formatGp(item.vol_24h, true)} · Z {item.zscore_7d.toFixed(1)}σ
            </div>
          </div>
        </div>

        {/* Live Quote */}
        <div className="font-mono-num text-xs">
          <div>
            <span className="text-zinc-200 font-bold">{formatGp(item.low)}</span>
            <span className="mx-1 text-zinc-600">→</span>
            <span className="text-amber-300 font-bold">{formatGp(item.high)}</span>
          </div>
          <div className={`text-[11px] ${item.net_margin > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            Net {formatSignedGp(item.net_margin)} ({item.net_roi_pct.toFixed(1)}%)
          </div>
        </div>

        {/* Editable Alert Targets */}
        <div className="grid grid-cols-3 gap-2 text-xs font-mono-num">
          <div>
            <label className="block font-sans text-[9px] uppercase text-zinc-500 mb-0.5">Buy ≤ (GP)</label>
            <input
              type="number"
              value={buyBelow}
              onChange={(e) => setBuyBelow(e.target.value)}
              placeholder="Off"
              className="w-full rounded-lg border border-white/[0.08] bg-[#060608] px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-white/25"
            />
          </div>
          <div>
            <label className="block font-sans text-[9px] uppercase text-zinc-500 mb-0.5">Sell ≥ (GP)</label>
            <input
              type="number"
              value={sellAbove}
              onChange={(e) => setSellAbove(e.target.value)}
              placeholder="Off"
              className="w-full rounded-lg border border-white/[0.08] bg-[#060608] px-2.5 py-1.5 text-xs text-amber-300 outline-none focus:border-amber-400/40"
            />
          </div>
          <div>
            <label className="block font-sans text-[9px] uppercase text-zinc-500 mb-0.5">Margin ≥ (GP)</label>
            <input
              type="number"
              value={minMargin}
              onChange={(e) => setMinMargin(e.target.value)}
              placeholder="Off"
              className="w-full rounded-lg border border-white/[0.08] bg-[#060608] px-2.5 py-1.5 text-xs text-emerald-300 outline-none focus:border-emerald-400/40"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-1.5">
          <button
            onClick={() => setDiscord((d) => !d)}
            className={`rounded-lg border p-1.5 transition ${
              discord
                ? 'border-indigo-500/35 bg-indigo-500/15 text-indigo-300'
                : 'border-white/[0.08] bg-zinc-900 text-zinc-500'
            }`}
            title={discord ? 'Discord pings ON' : 'Discord pings OFF'}
          >
            {discord ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={async () => {
              setSaving(true);
              try {
                await onSave({
                  buy_below: parseOpt(buyBelow),
                  sell_above: parseOpt(sellAbove),
                  min_net_margin: parseOpt(minMargin),
                  discord_notify: discord,
                });
              } finally {
                setSaving(false);
              }
            }}
            disabled={saving}
            className="flex items-center gap-1 rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-white"
          >
            <Save className="h-3.5 w-3.5" /> {saving ? '...' : 'Save'}
          </button>
          <button
            onClick={() => onOpenChart(item.item_id)}
            className="rounded-lg border border-white/[0.08] bg-zinc-900 p-1.5 text-zinc-300 hover:text-white"
            title="Inspect Chart"
          >
            <BarChart3 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="rounded-lg border border-white/[0.08] bg-zinc-900 p-1.5 text-zinc-500 hover:text-rose-400"
            title="Remove from Watchlist"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
