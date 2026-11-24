import { useState } from 'react';
import { ChevronDown, ChevronUp, Star, TrendingDown, TrendingUp, X } from 'lucide-react';
import type { WatchlistItem } from '../types';
import { formatGp, formatSignedGp, wikiIconUrl } from '../utils/format';

interface Props {
  items: WatchlistItem[];
  activeItemId: number | null;
  onOpenItem: (itemId: number) => void;
  onRemoveItem: (itemId: number) => Promise<void>;
}

/**
 * Persistent top strip of rich vertical mini-cards for watched items.
 * Clicking anywhere on a card opens its full /item/<id> TradingView page;
 * × unpins immediately; compact Collapse toggle lets you reclaim vertical space anytime.
 */
export function WatchRibbon({ items, activeItemId, onOpenItem, onRemoveItem }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="border-b border-white/[0.06] bg-[#07070a]/92 backdrop-blur-md">
      <div className="mx-auto max-w-[1520px] px-4 py-2.5">
        {/* Compact Top Strip Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            <Star className="h-3 w-3 text-amber-400 fill-amber-400/35" />
            <span>Watch Bar</span>
            <span className="rounded-md bg-white/[0.07] px-1.5 py-0.5 text-zinc-200 font-mono-num">
              {items.length}
            </span>
            {items.length === 0 && (
              <span className="normal-case tracking-normal font-normal text-[11px] text-zinc-500">
                — Click <strong className="text-amber-300 font-semibold">★ Watch</strong> on any item to pin a live card here
              </span>
            )}
            {collapsed && items.length > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 ml-2 normal-case tracking-normal">
                {items.slice(0, 6).map((w) => {
                  const chg = w.price_change_1h_pct ?? 0;
                  return (
                    <button
                      key={w.item_id}
                      type="button"
                      onClick={() => onOpenItem(w.item_id)}
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition ${
                        activeItemId === w.item_id
                          ? 'border-amber-400/50 bg-amber-500/15 text-amber-200'
                          : 'border-white/[0.08] bg-[#0e0e13] text-zinc-300 hover:border-white/[0.2]'
                      }`}
                    >
                      {w.icon && <img src={wikiIconUrl(w.icon)} alt="" className="h-3.5 w-3.5 object-contain" />}
                      <span className="max-w-[84px] truncate">{w.item_name}</span>
                      <span
                        className={`font-mono-num text-[10px] font-bold ${
                          chg > 0.15 ? 'text-emerald-400' : chg < -0.15 ? 'text-rose-400' : 'text-zinc-500'
                        }`}
                      >
                        {chg >= 0 ? '+' : ''}
                        {chg.toFixed(1)}%
                      </span>
                    </button>
                  );
                })}
                {items.length > 6 && (
                  <span className="text-[10px] text-zinc-500">+{items.length - 6} more</span>
                )}
              </div>
            )}
          </div>

          {items.length > 0 && (
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-white/[0.08] bg-[#0d0d12] px-2 py-1 text-[10px] font-semibold text-zinc-400 transition hover:border-white/[0.18] hover:text-zinc-100"
              title={collapsed ? 'Expand Watch cards' : 'Collapse Watch bar'}
            >
              {collapsed ? (
                <>
                  <ChevronDown className="h-3 w-3" />
                  <span>Expand</span>
                </>
              ) : (
                <>
                  <ChevronUp className="h-3 w-3" />
                  <span>Collapse</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Horizontal Strip of Rich Vertical Mini-Cards */}
        {!collapsed && items.length > 0 && (
          <div className="mt-2.5 flex items-stretch gap-2.5 overflow-x-auto pb-1">
            {items.map((w) => {
              const isSelected = activeItemId === w.item_id;
              const chg1h = w.price_change_1h_pct ?? 0;
              const chg24h = w.price_change_24h_pct ?? 0;
              const ofi = w.ofi_1h ?? w.ofi_5m ?? 0;
              const buyFlowPct = Math.max(8, Math.min(92, Math.round(((ofi + 1) / 2) * 100)));
              const hasTrigger = w.triggered.length > 0;
              const isUp = chg1h > 0.15 || (Math.abs(chg1h) <= 0.15 && ofi > 0.25);
              const isDown = chg1h < -0.15 || (Math.abs(chg1h) <= 0.15 && ofi < -0.25);

              const cardBorder = isSelected
                ? 'border-amber-400/65 bg-amber-500/[0.09] shadow-[0_0_20px_rgba(245,158,11,0.14)]'
                : hasTrigger
                  ? 'border-amber-500/45 bg-amber-500/[0.06] hover:border-amber-400/65'
                  : isUp
                    ? 'border-emerald-500/20 bg-[#0b0f0e] hover:border-emerald-400/45'
                    : isDown
                      ? 'border-rose-500/20 bg-[#110b0e] hover:border-rose-400/45'
                      : 'border-white/[0.08] bg-[#0c0c11] hover:border-white/[0.2]';

              const dotColor = hasTrigger
                ? 'bg-amber-400 animate-pulse'
                : isUp
                  ? 'bg-emerald-400'
                  : isDown
                    ? 'bg-rose-400'
                    : 'bg-zinc-500';

              const trendBadgeCls = isUp
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25'
                : isDown
                  ? 'bg-rose-500/15 text-rose-300 border-rose-500/25'
                  : 'bg-white/[0.05] text-zinc-400 border-white/[0.08]';

              return (
                <div
                  key={w.item_id}
                  className={`group relative flex w-[224px] shrink-0 flex-col justify-between overflow-hidden rounded-xl border transition ${cardBorder}`}
                >
                  {/* Unwatch × button (stops propagation so card click stays pure) */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveItem(w.item_id);
                    }}
                    title={`Unwatch ${w.item_name}`}
                    className="absolute right-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-md text-zinc-500 opacity-50 transition hover:bg-white/[0.12] hover:text-rose-300 group-hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>

                  {/* Pure Click-to-Open Card Surface */}
                  <button
                    type="button"
                    onClick={() => onOpenItem(w.item_id)}
                    className="flex flex-1 flex-col gap-2 p-2.5 text-left"
                    title={`Open ${w.item_name} full chart & analytics`}
                  >
                    {/* Row 1: Dot + Icon + Name */}
                    <div className="flex items-center gap-2 pr-5 min-w-0">
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColor}`} />
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-[#14141b]">
                        {w.icon && <img src={wikiIconUrl(w.icon)} alt="" className="h-4 w-4 object-contain" />}
                      </div>
                      <span className="truncate text-xs font-bold text-zinc-100">{w.item_name}</span>
                    </div>

                    {/* Row 2: Live Bid -> Ask & Net Margin / ROI */}
                    <div className="flex items-baseline justify-between gap-2 font-mono-num">
                      <div className="min-w-0">
                        <div className="font-sans text-[9px] uppercase tracking-wider text-zinc-500">Bid → Ask</div>
                        <div className="truncate text-[11px] font-semibold text-zinc-200">
                          {formatGp(w.low, true)} <span className="text-zinc-600">→</span>{' '}
                          <span className="text-amber-300">{formatGp(w.high, true)}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div
                          className={`text-xs font-bold ${
                            w.net_margin > 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {formatSignedGp(w.net_margin, true)}
                        </div>
                        <div className="text-[10px] text-zinc-500">{w.net_roi_pct.toFixed(1)}% ROI</div>
                      </div>
                    </div>

                    {/* Row 3: 1h Trend Pill + 24h Trend + 1h Vol / Trigger */}
                    <div className="flex items-center justify-between gap-1.5 text-[10px] font-mono-num">
                      <span
                        className={`inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 font-bold ${trendBadgeCls}`}
                      >
                        {isUp ? (
                          <TrendingUp className="h-2.5 w-2.5" />
                        ) : isDown ? (
                          <TrendingDown className="h-2.5 w-2.5" />
                        ) : null}
                        1h {chg1h >= 0 ? '+' : ''}
                        {chg1h.toFixed(1)}%
                      </span>
                      {hasTrigger ? (
                        <span className="rounded-md bg-amber-500/20 px-1.5 py-0.5 font-sans text-[9px] font-bold uppercase text-amber-300">
                          Alert Hit
                        </span>
                      ) : (
                        <span className="truncate text-zinc-500">
                          24h{' '}
                          <span
                            className={
                              chg24h > 0.2 ? 'text-emerald-400/90' : chg24h < -0.2 ? 'text-rose-400/90' : 'text-zinc-400'
                            }
                          >
                            {chg24h >= 0 ? '+' : ''}
                            {chg24h.toFixed(1)}%
                          </span>{' '}
                          · {formatGp(w.vol_1h, true)}/h
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Bottom Edge: Subtle Buy vs. Sell Flow Bar (OFI) */}
                  <div
                    className="flex h-[3px] w-full bg-rose-500/50"
                    title={`Order Flow: ${buyFlowPct}% Buy / ${100 - buyFlowPct}% Sell (OFI ${ofi >= 0 ? '+' : ''}${ofi.toFixed(2)})`}
                  >
                    <div className="h-full bg-emerald-400/85 transition-all" style={{ width: `${buyFlowPct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
