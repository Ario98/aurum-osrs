import { Star, TrendingDown, TrendingUp, X } from 'lucide-react';
import type { WatchlistItem } from '../types';
import { formatGp, formatSignedGp, wikiIconUrl } from '../utils/format';

interface Props {
  items: WatchlistItem[];
  activeItemId: number | null;
  onOpenItem: (itemId: number) => void;
  onRemoveItem: (itemId: number) => Promise<void>;
}

/**
 * Persistent Live Watch Ticker Bar pinned directly below the header.
 * Replaces manual GE Slot tracking: click ★ Watch on any item to pin a live
 * price, spread, and up/down trend tab up top and jump straight to its full page.
 */
export function WatchRibbon({ items, activeItemId, onOpenItem, onRemoveItem }: Props) {
  return (
    <div className="border-b border-white/[0.06] bg-[#07070a]/90 backdrop-blur-md">
      <div className="mx-auto max-w-[1520px] px-4 py-2">
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
          {/* Ribbon Label */}
          <div className="hidden lg:flex items-center gap-1.5 pr-2 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            <Star className="h-3 w-3 text-amber-400 fill-amber-400/30" />
            <span>Watching</span>
            <span className="rounded-md bg-white/[0.07] px-1.5 py-0.5 text-zinc-200 font-mono-num">
              {items.length}
            </span>
          </div>

          {items.length === 0 ? (
            <div className="flex h-8 items-center gap-2 text-[11px] text-zinc-500">
              <span>
                Click <strong className="text-amber-300 font-semibold">★ Watch</strong> on any item to pin live price
                &amp; trend tabs here for instant access.
              </span>
            </div>
          ) : (
            <div className="flex flex-1 items-center gap-2 min-w-0">
              {items.map((w) => {
                const isSelected = activeItemId === w.item_id;
                const chg1h = w.price_change_1h_pct ?? 0;
                const chg24h = w.price_change_24h_pct ?? 0;
                const ofi = w.ofi_5m ?? 0;
                const hasTrigger = w.triggered.length > 0;
                const isUp = chg1h > 0.15 || (Math.abs(chg1h) <= 0.15 && ofi > 0.25);
                const isDown = chg1h < -0.15 || (Math.abs(chg1h) <= 0.15 && ofi < -0.25);

                const tabBorder = isSelected
                  ? 'border-amber-400/60 bg-amber-500/[0.11] shadow-[0_0_16px_rgba(245,158,11,0.12)]'
                  : hasTrigger
                    ? 'border-amber-500/45 bg-amber-500/[0.08] hover:bg-amber-500/[0.14]'
                    : isUp
                      ? 'border-emerald-500/25 bg-[#0d1210] hover:border-emerald-400/45'
                      : isDown
                        ? 'border-rose-500/25 bg-[#130d10] hover:border-rose-400/45'
                        : 'border-white/[0.09] bg-[#0e0e13] hover:border-white/[0.2]';

                const dotColor = hasTrigger
                  ? 'bg-amber-400 animate-pulse'
                  : isUp
                    ? 'bg-emerald-400'
                    : isDown
                      ? 'bg-rose-400'
                      : 'bg-zinc-500';

                const trendColor = isUp
                  ? 'text-emerald-400'
                  : isDown
                    ? 'text-rose-400'
                    : 'text-zinc-400';

                const tooltip = [
                  `${w.item_name}`,
                  `Live: ${formatGp(w.low)} → ${formatGp(w.high)} gp (Net ${formatSignedGp(w.net_margin, true)} / ${w.net_roi_pct.toFixed(1)}%)`,
                  `1h: ${chg1h >= 0 ? '+' : ''}${chg1h.toFixed(2)}% · 24h: ${chg24h >= 0 ? '+' : ''}${chg24h.toFixed(2)}% · 5m OFI: ${ofi >= 0 ? '+' : ''}${ofi.toFixed(2)}`,
                  hasTrigger ? `Alert triggered: ${w.triggered.join(', ')}` : 'Click to open full item chart',
                ].join('\n');

                return (
                  <div
                    key={w.item_id}
                    className={`group flex h-9 shrink-0 items-center rounded-xl border transition ${tabBorder}`}
                    title={tooltip}
                  >
                    <button
                      type="button"
                      onClick={() => onOpenItem(w.item_id)}
                      className="flex h-full items-center gap-2 pl-2.5 pr-1.5 text-left"
                    >
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColor}`} />
                      {w.icon && (
                        <img src={wikiIconUrl(w.icon)} alt="" className="h-4 w-4 shrink-0 object-contain" />
                      )}
                      <div className="flex flex-col leading-tight">
                        <div className="flex items-center gap-1.5">
                          <span className="max-w-[104px] truncate text-[11px] font-semibold text-zinc-100">
                            {w.item_name}
                          </span>
                          <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold font-mono-num ${trendColor}`}>
                            {isUp ? (
                              <TrendingUp className="h-2.5 w-2.5" />
                            ) : isDown ? (
                              <TrendingDown className="h-2.5 w-2.5" />
                            ) : null}
                            {chg1h >= 0 ? '+' : ''}
                            {chg1h.toFixed(1)}%
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] font-mono-num text-zinc-400">
                          <span>
                            {formatGp(w.low, true)}→{formatGp(w.high, true)}
                          </span>
                          <span className={w.net_margin > 0 ? 'text-emerald-400/90' : 'text-zinc-500'}>
                            ({formatSignedGp(w.net_margin, true)})
                          </span>
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveItem(w.item_id);
                      }}
                      title={`Unwatch ${w.item_name}`}
                      className="mr-1 flex h-5 w-5 items-center justify-center rounded-md text-zinc-500 opacity-60 transition hover:bg-white/[0.1] hover:text-rose-300 group-hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
