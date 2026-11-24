import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft, Search, Star, X } from 'lucide-react';
import { api } from '../api/client';
import type { ItemMetrics } from '../types';
import { formatGp, formatSignedGp, wikiIconUrl } from '../utils/format';

interface Props {
  itemsTracked: number;
  starredIds: Set<number>;
  onSelectItem: (itemId: number) => void;
  onToggleWatch: (item: { id: number; name: string; low?: number | null }) => Promise<void>;
}

export function HeaderSearch({ itemsTracked, starredIds, onSelectItem, onToggleWatch }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ItemMetrics[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Ctrl+K / Cmd+K (or `/` outside inputs) focuses inline search directly
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onOutside);
    return () => window.removeEventListener('mousedown', onOutside);
  }, [open]);

  // Fetch live suggestions whenever dropdown is open or query changes
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.scanner({
          q: query,
          preset: 'all',
          hide_stale: !query,
          sort_by: query ? 'vol_24h' : 'overall_score',
          sort_dir: 'desc',
          limit: 8,
        });
        if (!cancelled) {
          setResults(res.items);
          setSelectedIdx(0);
        }
      } catch {
        // ignore transient errors
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query ? 85 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const handleSelect = (itemId: number) => {
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
    onSelectItem(itemId);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      inputRef.current?.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      setSelectedIdx((i) => Math.min(Math.max(0, results.length - 1), i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && results[selectedIdx]) {
      e.preventDefault();
      handleSelect(results[selectedIdx].id);
    }
  };

  return (
    <div ref={containerRef} className="relative flex-1 max-w-md min-w-0">
      <div
        className={`flex items-center gap-2 rounded-xl border bg-[#0c0c10] px-3 py-1.5 text-xs transition ${
          open
            ? 'border-amber-400/40 ring-1 ring-amber-400/15'
            : 'border-white/[0.08] hover:border-white/[0.16]'
        }`}
      >
        <Search className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={`Search ${itemsTracked ? itemsTracked.toLocaleString() : '4,682'} OSRS items...`}
          className="w-full min-w-0 bg-transparent text-xs text-zinc-100 placeholder:text-zinc-500 outline-none"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            className="rounded p-0.5 text-zinc-500 hover:text-zinc-200"
            title="Clear search"
          >
            <X className="h-3 w-3" />
          </button>
        ) : (
          <kbd className="hidden sm:inline-flex shrink-0 items-center rounded-md border border-white/[0.1] bg-black/50 px-1.5 py-0.5 text-[10px] font-mono text-zinc-500">
            Ctrl K
          </kbd>
        )}
      </div>

      {/* Inline Autocomplete Dropdown */}
      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0b0b10] shadow-[0_20px_60px_rgba(0,0,0,0.85)]">
          <div className="flex items-center justify-between border-b border-white/[0.06] bg-[#08080c] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            <span>{query.trim() ? 'Matching Items' : 'Top Live Opportunities'}</span>
            <span>{loading ? 'Searching...' : `${results.length} results`}</span>
          </div>

          <div className="max-h-[380px] overflow-y-auto p-1.5">
            {results.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-500">
                {loading ? 'Searching Grand Exchange...' : 'No matching items found.'}
              </div>
            ) : (
              <div className="space-y-0.5">
                {results.map((item, idx) => {
                  const active = idx === selectedIdx;
                  const watched = starredIds.has(item.id);
                  return (
                    <div
                      key={item.id}
                      onMouseEnter={() => setSelectedIdx(idx)}
                      className={`flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 transition ${
                        active ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleSelect(item.id)}
                        className="flex flex-1 min-w-0 items-center justify-between gap-2 text-left"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-[#141419]">
                            {item.icon && (
                              <img src={wikiIconUrl(item.icon)} alt="" className="h-5 w-5 object-contain" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-xs font-semibold text-zinc-100">{item.name}</span>
                              {item.is_tax_exempt && (
                                <span className="shrink-0 rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] font-semibold text-emerald-400">
                                  0%
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-zinc-500 font-mono-num">
                              {formatGp(item.low, true)} → {formatGp(item.high, true)} · Vol {formatGp(item.vol_24h, true)}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 text-right font-mono-num">
                          <div>
                            <div
                              className={`text-xs font-bold ${
                                item.net_margin > 0 ? 'text-emerald-400' : 'text-zinc-500'
                              }`}
                            >
                              {formatSignedGp(item.net_margin, true)}
                            </div>
                            <div className="text-[10px] text-zinc-500">{item.net_roi_pct.toFixed(1)}%</div>
                          </div>
                          {active && <CornerDownLeft className="h-3 w-3 text-zinc-500 hidden sm:block" />}
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleWatch({ id: item.id, name: item.name, low: item.low });
                        }}
                        title={watched ? 'Remove from Watch Ribbon' : 'Pin to top Watch Ribbon'}
                        className={`shrink-0 rounded-lg border p-1.5 transition ${
                          watched
                            ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                            : 'border-white/[0.07] bg-[#121218] text-zinc-500 hover:border-amber-400/30 hover:text-amber-300'
                        }`}
                      >
                        <Star className={`h-3 w-3 ${watched ? 'fill-current' : ''}`} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-white/[0.06] bg-[#08080c] px-3 py-1.5 text-[10px] text-zinc-500">
            <span>↑↓ Navigate · Enter Open · ★ Pin to Watch bar</span>
            <span>Esc to close</span>
          </div>
        </div>
      )}
    </div>
  );
}
