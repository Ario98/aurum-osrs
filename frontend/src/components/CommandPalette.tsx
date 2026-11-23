import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft, Search, X } from 'lucide-react';
import { api } from '../api/client';
import type { ItemMetrics } from '../types';
import { formatGp, formatSignedGp, wikiIconUrl } from '../utils/format';

interface Props {
  open: boolean;
  onClose: () => void;
  onSelectItem: (itemId: number) => void;
}

export function CommandPalette({ open, onClose, onSelectItem }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ItemMetrics[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    setQuery('');
    setSelectedIdx(0);
    window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, [open]);

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
          limit: 12,
        });
        if (!cancelled) {
          setResults(res.items);
          setSelectedIdx(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query ? 90 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(results.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter' && results[selectedIdx]) {
        e.preventDefault();
        onSelectItem(results[selectedIdx].id);
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, results, selectedIdx, onClose, onSelectItem]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/75 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0b0b0f] shadow-[0_24px_80px_rgba(0,0,0,0.85)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-white/[0.08] px-4 py-3.5">
          <Search className="h-4 w-4 text-zinc-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to any of 4,682 OSRS items or item ID..."
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 outline-none"
          />
          {loading && <span className="text-[11px] text-zinc-500">Searching...</span>}
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[420px] overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="py-10 text-center text-xs text-zinc-500">
              {loading ? 'Searching Grand Exchange...' : 'No matching items found.'}
            </div>
          ) : (
            results.map((item, idx) => {
              const active = idx === selectedIdx;
              return (
                <button
                  key={item.id}
                  onMouseEnter={() => setSelectedIdx(idx)}
                  onClick={() => {
                    onSelectItem(item.id);
                    onClose();
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                    active ? 'bg-white/[0.08] text-white' : 'text-zinc-300 hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.07] bg-[#141419]">
                      {item.icon && (
                        <img src={wikiIconUrl(item.icon)} alt="" className="h-5 w-5 object-contain" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs font-semibold text-zinc-100">{item.name}</span>
                        {item.is_tax_exempt && (
                          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400">
                            0% TAX
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-zinc-500 font-mono-num">
                        24h Vol {item.vol_24h.toLocaleString()} · Limit {item.buy_limit || '—'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0 text-right font-mono-num">
                    <div className="text-xs">
                      <span className="text-zinc-300">{formatGp(item.low, true)}</span>
                      <span className="mx-1 text-zinc-600">→</span>
                      <span className="text-amber-300">{formatGp(item.high, true)}</span>
                    </div>
                    <div className={`w-16 text-xs font-semibold ${item.net_margin > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {formatSignedGp(item.net_margin, true)}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-white/[0.07] bg-[#08080b] px-4 py-2 text-[10px] text-zinc-500">
          <span>↑↓ Navigate · Enter to Inspect Chart & Flip Calculator</span>
          <span className="flex items-center gap-1">
            <CornerDownLeft className="h-3 w-3" /> Esc to close
          </span>
        </div>
      </div>
    </div>
  );
}
