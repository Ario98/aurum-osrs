import { useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronUp,
  Moon,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Zap,
} from 'lucide-react';
import type { ActiveSlot } from '../types';
import { formatGp, formatSignedGp, wikiIconUrl } from '../utils/format';

interface Props {
  slots: ActiveSlot[];
  onUpdateSlot: (
    slotNumber: number,
    updates: {
      status?: 'BUYING' | 'BOUGHT' | 'SELLING';
      buy_price?: number;
      target_sell_price?: number;
      flip_mode?: 'active' | 'overnight';
    },
  ) => Promise<void>;
  onCompleteSlot: (slotNumber: number, sellPrice: number) => Promise<void>;
  onClearSlot: (slotNumber: number) => Promise<void>;
  onOpenChart: (itemId: number) => void;
}

export function SlotRibbon({ slots, onUpdateSlot, onCompleteSlot, onClearSlot, onOpenChart }: Props) {
  const [selectedNum, setSelectedNum] = useState<number | null>(null);
  const [applyingSlot, setApplyingSlot] = useState<number | null>(null);
  const [appliedMsg, setAppliedMsg] = useState<string>('');

  const byNumber = new Map<number, ActiveSlot>();
  for (const s of slots) {
    byNumber.set(s.slot_number, s);
  }

  const selectedSlot = selectedNum ? byNumber.get(selectedNum) || null : null;
  const attentionCount = slots.filter(
    (s) => s.coach_severity === 'warning' || s.coach_severity === 'danger',
  ).length;

  return (
    <div className="border-b border-white/[0.06] bg-[#07070a]/90 backdrop-blur-md">
      <div className="mx-auto max-w-[1520px] px-4 py-2">
        {/* Compact 8-Slot Chip Strip */}
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
          <div className="hidden lg:flex items-center gap-1.5 pr-2 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            <span>GE Slots</span>
            <span className="rounded-md bg-white/[0.07] px-1.5 py-0.5 text-zinc-200 font-mono-num">
              {slots.length}/8
            </span>
            {attentionCount > 0 && (
              <span className="rounded-md bg-amber-500/20 px-1.5 py-0.5 text-amber-300 animate-pulse">
                {attentionCount} coach
              </span>
            )}
          </div>

          <div className="flex flex-1 items-center gap-1.5 min-w-0">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((num) => {
              const slot = byNumber.get(num);
              const isSelected = selectedNum === num && !!slot;

              if (!slot) {
                return (
                  <div
                    key={num}
                    className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-white/[0.06] bg-white/[0.015] px-2.5 text-[11px] text-zinc-600"
                  >
                    <span className="font-mono-num text-[10px]">S{num}</span>
                    <span className="hidden xl:inline text-[10px]">Open</span>
                  </div>
                );
              }

              const isDanger = slot.coach_severity === 'danger';
              const isWarn = slot.coach_severity === 'warning';
              const isSuccess = slot.coach_severity === 'success';
              const isNight = slot.flip_mode === 'overnight';

              const chipBorder = isSelected
                ? 'border-white/35 bg-white/[0.1]'
                : isDanger
                  ? 'border-rose-500/50 bg-rose-500/[0.1] hover:bg-rose-500/[0.16]'
                  : isWarn
                    ? 'border-amber-500/45 bg-amber-500/[0.09] hover:bg-amber-500/[0.15]'
                    : isSuccess
                      ? 'border-emerald-500/40 bg-emerald-500/[0.08] hover:bg-emerald-500/[0.14]'
                      : 'border-white/[0.1] bg-[#0e0e13] hover:border-white/[0.2]';

              const dotColor = isDanger
                ? 'bg-rose-400 animate-ping'
                : isWarn
                  ? 'bg-amber-400 animate-pulse'
                  : isSuccess
                    ? 'bg-emerald-400'
                    : 'bg-emerald-500/70';

              return (
                <button
                  key={num}
                  onClick={() => setSelectedNum(isSelected ? null : num)}
                  className={`flex h-8 shrink-0 items-center gap-2 rounded-lg border px-2.5 text-xs transition ${chipBorder}`}
                  title={slot.coach_message}
                >
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColor}`} />
                  {slot.icon && (
                    <img src={wikiIconUrl(slot.icon)} alt="" className="h-4 w-4 shrink-0 object-contain" />
                  )}
                  <span className="max-w-[96px] truncate font-medium text-zinc-100">{slot.item_name}</span>
                  {isNight && <Moon className="h-3 w-3 text-indigo-300 shrink-0" />}
                  <span className="rounded bg-black/40 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-400">
                    {slot.status === 'BUYING' ? 'BUY' : slot.status === 'SELLING' ? 'SELL' : 'FILL'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Expanded Offer Coach & Slot Management Tray */}
        {selectedSlot && (
          <div className="mt-2.5 rounded-xl border border-white/[0.1] bg-[#0d0d12] p-3.5 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Left: Item & Mode Toggle */}
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.1] bg-[#14141a]">
                  {selectedSlot.icon && (
                    <img src={wikiIconUrl(selectedSlot.icon)} alt="" className="h-6 w-6 object-contain" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-zinc-100">
                      Slot {selectedSlot.slot_number} · {selectedSlot.item_name}
                    </span>
                    <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-semibold text-zinc-300">
                      {selectedSlot.status} · {selectedSlot.quantity.toLocaleString()}x
                    </span>
                    {selectedSlot.source === 'dink' && (
                      <span className="rounded-md bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-300">
                        DINK
                      </span>
                    )}
                    <button
                      onClick={() =>
                        onUpdateSlot(selectedSlot.slot_number, {
                          flip_mode: selectedSlot.flip_mode === 'overnight' ? 'active' : 'overnight',
                        })
                      }
                      className={`flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold transition ${
                        selectedSlot.flip_mode === 'overnight'
                          ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25'
                          : 'border-white/[0.1] bg-zinc-900 text-zinc-400 hover:text-zinc-100'
                      }`}
                      title="Toggle Coach between Fast Active Flip vs Calm Overnight Mode"
                    >
                      {selectedSlot.flip_mode === 'overnight' ? (
                        <>
                          <Moon className="h-3 w-3" /> Overnight Coach
                        </>
                      ) : (
                        <>
                          <Zap className="h-3 w-3 text-amber-400" /> Active Coach
                        </>
                      )}
                    </button>
                  </div>

                  {/* Coach Advice Line */}
                  <div className="mt-1 flex items-center gap-1.5 text-xs">
                    {selectedSlot.coach_severity === 'danger' ? (
                      <ShieldAlert className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                    ) : selectedSlot.coach_severity === 'warning' ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    )}
                    <span
                      className={
                        selectedSlot.coach_severity === 'danger'
                          ? 'text-rose-200'
                          : selectedSlot.coach_severity === 'warning'
                            ? 'text-amber-200'
                            : 'text-zinc-300'
                      }
                    >
                      {selectedSlot.coach_message}
                    </span>
                  </div>
                </div>
              </div>

              {/* Center: Compact Prices */}
              <div className="flex items-center gap-4 text-xs font-mono-num">
                <div>
                  <div className="text-[9px] text-zinc-500">BUY</div>
                  <div className="font-bold text-zinc-100">{formatGp(selectedSlot.buy_price)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-zinc-500">SELL</div>
                  <div className="font-bold text-amber-300">{formatGp(selectedSlot.target_sell_price)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-zinc-500">EST NET</div>
                  <div
                    className={`font-bold ${selectedSlot.expected_net_profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
                  >
                    {formatSignedGp(selectedSlot.expected_net_profit, true)}
                  </div>
                </div>
              </div>

              {/* Right: Action Buttons */}
              <div className="flex flex-wrap items-center gap-1.5">
                {appliedMsg && (
                  <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                    {appliedMsg}
                  </span>
                )}
                {selectedSlot.recommended_price &&
                  selectedSlot.coach_action !== 'HOLD' &&
                  selectedSlot.recommended_price !==
                    (selectedSlot.status === 'BUYING'
                      ? selectedSlot.buy_price
                      : selectedSlot.target_sell_price) && (
                    <button
                      disabled={applyingSlot === selectedSlot.slot_number}
                      onClick={async () => {
                        const p = selectedSlot.recommended_price!;
                        setApplyingSlot(selectedSlot.slot_number);
                        try {
                          if (selectedSlot.status === 'BUYING') {
                            await onUpdateSlot(selectedSlot.slot_number, { buy_price: p });
                          } else if (selectedSlot.status === 'BOUGHT') {
                            await onUpdateSlot(selectedSlot.slot_number, { status: 'SELLING', target_sell_price: p });
                          } else {
                            await onUpdateSlot(selectedSlot.slot_number, { target_sell_price: p });
                          }
                          navigator.clipboard?.writeText(String(p)).catch(() => {});
                          setAppliedMsg(`Applied & copied ${formatGp(p)}`);
                          window.setTimeout(() => setAppliedMsg(''), 2500);
                        } finally {
                          setApplyingSlot(null);
                        }
                      }}
                      title="Update tracked offer price & copy to clipboard for RuneScape GE"
                      className="flex items-center gap-1 rounded-lg border border-amber-500/35 bg-amber-500/15 px-2.5 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 disabled:opacity-50"
                    >
                      <RefreshCw className={`h-3 w-3 ${applyingSlot === selectedSlot.slot_number ? 'animate-spin' : ''}`} />
                      {applyingSlot === selectedSlot.slot_number
                        ? 'Applying...'
                        : `Apply ${formatGp(selectedSlot.recommended_price)}`}
                    </button>
                  )}

                {selectedSlot.status === 'BUYING' && (
                  <button
                    onClick={() => onUpdateSlot(selectedSlot.slot_number, { status: 'SELLING' })}
                    className="rounded-lg border border-white/15 bg-zinc-900 px-2.5 py-1.5 text-xs font-semibold text-zinc-100 hover:bg-zinc-800"
                  >
                    Bought → Sell
                  </button>
                )}
                {selectedSlot.status === 'BOUGHT' && (
                  <button
                    onClick={() => onUpdateSlot(selectedSlot.slot_number, { status: 'SELLING' })}
                    className="rounded-lg border border-white/15 bg-zinc-900 px-2.5 py-1.5 text-xs font-semibold text-zinc-100 hover:bg-zinc-800"
                  >
                    Mark Selling
                  </button>
                )}
                {selectedSlot.status === 'SELLING' && (
                  <button
                    onClick={async () => {
                      await onCompleteSlot(selectedSlot.slot_number, selectedSlot.target_sell_price);
                      setSelectedNum(null);
                    }}
                    className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-zinc-950 hover:bg-emerald-400"
                  >
                    Mark Sold
                  </button>
                )}

                <button
                  onClick={() => onOpenChart(selectedSlot.item_id)}
                  className="rounded-lg border border-white/[0.08] bg-zinc-900 p-1.5 text-zinc-400 hover:text-white"
                  title="Inspect Chart"
                >
                  <BarChart3 className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={async () => {
                    await onClearSlot(selectedSlot.slot_number);
                    setSelectedNum(null);
                  }}
                  className="rounded-lg border border-white/[0.08] bg-zinc-900 p-1.5 text-zinc-500 hover:text-rose-400"
                  title="Cancel / Clear slot"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setSelectedNum(null)}
                  className="rounded-lg p-1.5 text-zinc-500 hover:text-zinc-200"
                  title="Collapse"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
