import { AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert, Trash2, Zap } from 'lucide-react';
import type { ActiveSlot } from '../types';
import { formatGp, formatSignedGp, wikiIconUrl } from '../utils/format';

interface Props {
  slots: ActiveSlot[];
  onUpdateSlot: (
    slotNumber: number,
    updates: { status?: 'BUYING' | 'BOUGHT' | 'SELLING'; buy_price?: number; target_sell_price?: number },
  ) => Promise<void>;
  onCompleteSlot: (slotNumber: number, sellPrice: number) => Promise<void>;
  onClearSlot: (slotNumber: number) => Promise<void>;
  onOpenChart: (itemId: number) => void;
}

export function SlotCoachBar({ slots, onUpdateSlot, onCompleteSlot, onClearSlot, onOpenChart }: Props) {
  if (slots.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/[0.1] bg-[#0a0a0d] p-4 text-center text-xs text-zinc-500">
        All <strong className="text-zinc-200">8 GE slots</strong> are open. Click{' '}
        <strong className="text-zinc-100">Start Flip</strong> on any Trade Call below (or connect RuneLite{' '}
        <strong className="text-amber-300">Dink</strong> in Settings) to activate the live{' '}
        <strong className="text-emerald-400">Proactive Offer Coach</strong>.
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-amber-400" />
          Active GE Slots ({slots.length}/8) & Proactive Offer Coach
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {slots.map((slot) => {
          const borderCls =
            slot.coach_severity === 'danger'
              ? 'border-rose-500/60 bg-[#14090b]'
              : slot.coach_severity === 'warning'
                ? 'border-amber-500/50 bg-[#141008]'
                : slot.coach_severity === 'success'
                  ? 'border-emerald-500/40 bg-[#08130d]'
                  : 'border-white/[0.08] bg-[#0c0c0f]';

          const bannerCls =
            slot.coach_severity === 'danger'
              ? 'bg-rose-500/10 text-rose-200 border-rose-500/25'
              : slot.coach_severity === 'warning'
                ? 'bg-amber-500/10 text-amber-200 border-amber-500/25'
                : slot.coach_severity === 'success'
                  ? 'bg-emerald-500/10 text-emerald-200 border-emerald-500/25'
                  : 'bg-[#070709] text-zinc-400 border-white/[0.06]';

          const applyCoachPrice = async () => {
            if (!slot.recommended_price) return;
            if (slot.status === 'BUYING') {
              await onUpdateSlot(slot.slot_number, { buy_price: slot.recommended_price });
            } else if (slot.status === 'BOUGHT') {
              await onUpdateSlot(slot.slot_number, {
                status: 'SELLING',
                target_sell_price: slot.recommended_price,
              });
            } else {
              await onUpdateSlot(slot.slot_number, { target_sell_price: slot.recommended_price });
            }
          };

          return (
            <div key={slot.slot_number} className={`rounded-2xl border p-3.5 flex flex-col justify-between ${borderCls}`}>
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-[11px] font-bold text-zinc-200 ring-1 ring-white/10">
                      {slot.slot_number}
                    </span>
                    {slot.icon && (
                      <img src={wikiIconUrl(slot.icon)} alt="" className="h-6 w-6 shrink-0 object-contain" />
                    )}
                    <div className="min-w-0">
                      <button
                        onClick={() => onOpenChart(slot.item_id)}
                        className="truncate block max-w-full text-left text-xs font-semibold text-zinc-100 hover:text-white"
                      >
                        {slot.item_name}
                      </button>
                      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                        <span className="font-semibold text-zinc-300">{slot.status}</span>
                        <span>· {slot.quantity.toLocaleString()}x</span>
                        <span>· {Math.round(slot.elapsed_minutes)}m</span>
                        {slot.source === 'dink' && (
                          <span className="rounded bg-white/10 px-1 text-[9px] text-zinc-200">DINK</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => onClearSlot(slot.slot_number)}
                    className="rounded-lg p-1 text-zinc-600 hover:bg-zinc-900 hover:text-rose-400"
                    title="Clear / Cancel slot"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Prices row */}
                <div className="mt-2.5 grid grid-cols-3 gap-1.5 rounded-xl border border-white/[0.05] bg-[#060608] p-2 text-[11px] tabular-nums">
                  <div>
                    <div className="text-[9px] text-zinc-500">BUY</div>
                    <div className="font-semibold text-zinc-100">{formatGp(slot.buy_price)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-zinc-500">SELL</div>
                    <div className="font-semibold text-amber-300">{formatGp(slot.target_sell_price)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] text-zinc-500">EST NET</div>
                    <div className={slot.expected_net_profit >= 0 ? 'font-semibold text-emerald-400' : 'font-semibold text-rose-400'}>
                      {formatSignedGp(slot.expected_net_profit, true)}
                    </div>
                  </div>
                </div>

                {/* Coach Banner */}
                <div className={`mt-2.5 rounded-xl border px-2.5 py-2 text-[11px] leading-snug ${bannerCls}`}>
                  <div className="flex items-start gap-1.5">
                    {slot.coach_severity === 'danger' ? (
                      <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5 text-rose-400" />
                    ) : slot.coach_severity === 'warning' ? (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5 text-emerald-400" />
                    )}
                    <span>{slot.coach_message}</span>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {slot.recommended_price && slot.coach_action !== 'HOLD' && (
                  <button
                    onClick={applyCoachPrice}
                    className="flex items-center gap-1 rounded-lg bg-amber-500/15 border border-amber-500/30 px-2.5 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/25"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Apply {formatGp(slot.recommended_price)}
                  </button>
                )}

                {slot.status === 'BUYING' && (
                  <button
                    onClick={() => onUpdateSlot(slot.slot_number, { status: 'SELLING' })}
                    className="ml-auto rounded-lg border border-white/15 bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-800"
                  >
                    Bought → Sell
                  </button>
                )}
                {slot.status === 'BOUGHT' && (
                  <button
                    onClick={() => onUpdateSlot(slot.slot_number, { status: 'SELLING' })}
                    className="ml-auto rounded-lg border border-white/15 bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-800"
                  >
                    Mark Selling
                  </button>
                )}
                {slot.status === 'SELLING' && (
                  <button
                    onClick={() => onCompleteSlot(slot.slot_number, slot.target_sell_price)}
                    className="ml-auto rounded-lg bg-emerald-500 px-2.5 py-1 text-[11px] font-semibold text-zinc-950 hover:bg-emerald-400"
                  >
                    Mark Sold
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
