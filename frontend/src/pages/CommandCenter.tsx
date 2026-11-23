import { useState } from 'react';
import { Coins, Flame, Layers, RefreshCw, Shield, Sparkles, TrendingUp, Zap } from 'lucide-react';
import { SlotCoachBar } from '../components/SlotCoachBar';
import { TradeCallCard } from '../components/TradeCallCard';
import type { ActiveSlot, StrategyMode, TradeCall, TradeCallsResponse } from '../types';
import { formatGp, formatSignedGp, parseGpInput } from '../utils/format';

const BANK_PRESETS = [
  { label: '5M', value: 5_000_000 },
  { label: '25M', value: 25_000_000 },
  { label: '100M', value: 100_000_000 },
  { label: '500M', value: 500_000_000 },
  { label: '1B', value: 1_000_000_000 },
];

const MODE_OPTIONS: { key: StrategyMode; label: string; desc: string }[] = [
  { key: 'auto_mix', label: 'Auto-Mix', desc: 'Best blend for your bank' },
  { key: 'fast_flip', label: 'Fast Flips', desc: 'High-volume quick fills' },
  { key: 'overnight', label: 'Big Margin', desc: 'High profit / 4h limit' },
  { key: 'dump_sniper', label: 'Dump Sniper', desc: 'Crash rebounds (Z < -1.6)' },
  { key: 'alch_floor', label: 'Alch Floor', desc: 'Safe near High-Alch' },
];

interface Props {
  cashStack: number;
  onChangeCashStack: (val: number) => void;
  mode: StrategyMode;
  onChangeMode: (m: StrategyMode) => void;
  members: boolean;
  onChangeMembers: (m: boolean) => void;
  tradeData: TradeCallsResponse | null;
  slots: ActiveSlot[];
  loading: boolean;
  onRefresh: () => void;
  onStartFlip: (call: TradeCall) => Promise<void>;
  onUpdateSlot: (
    slotNumber: number,
    updates: { status?: 'BUYING' | 'BOUGHT' | 'SELLING'; buy_price?: number; target_sell_price?: number },
  ) => Promise<void>;
  onCompleteSlot: (slotNumber: number, sellPrice: number) => Promise<void>;
  onClearSlot: (slotNumber: number) => Promise<void>;
  onOpenChart: (itemId: number) => void;
}

export function CommandCenter({
  cashStack,
  onChangeCashStack,
  mode,
  onChangeMode,
  members,
  onChangeMembers,
  tradeData,
  slots,
  loading,
  onRefresh,
  onStartFlip,
  onUpdateSlot,
  onCompleteSlot,
  onClearSlot,
  onOpenChart,
}: Props) {
  const [cashInput, setCashInput] = useState(() => formatGp(cashStack, true));

  const commitCash = () => {
    const parsed = parseGpInput(cashInput);
    if (parsed && parsed >= 10_000) {
      onChangeCashStack(parsed);
      setCashInput(formatGp(parsed, true));
    } else {
      setCashInput(formatGp(cashStack, true));
    }
  };

  const applyPreset = (val: number) => {
    onChangeCashStack(val);
    setCashInput(formatGp(val, true));
  };

  return (
    <div className="space-y-6">
      {/* Control Bar */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Cash Stack Input & Quick Presets */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-xl border border-white/[0.1] bg-[#060608] px-3 py-1.5">
              <Coins className="h-4 w-4 text-amber-400" />
              <span className="text-xs text-zinc-500">Cash Stack</span>
              <input
                value={cashInput}
                onChange={(e) => setCashInput(e.target.value)}
                onBlur={commitCash}
                onKeyDown={(e) => e.key === 'Enter' && commitCash()}
                className="w-24 bg-transparent text-sm font-bold text-zinc-100 outline-none tabular-nums"
                placeholder="25M"
              />
            </div>

            <div className="flex items-center gap-1">
              {BANK_PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => applyPreset(p.value)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                    cashStack === p.value
                      ? 'bg-zinc-100 text-zinc-950'
                      : 'border border-white/[0.06] bg-[#08080b] text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Right Controls: Members Toggle + Refresh */}
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl border border-white/[0.08] bg-[#060608] p-0.5 text-xs">
              <button
                onClick={() => onChangeMembers(true)}
                className={`rounded-lg px-3 py-1 font-semibold transition ${
                  members ? 'bg-zinc-100 text-zinc-950' : 'text-zinc-500 hover:text-zinc-200'
                }`}
              >
                Members
              </button>
              <button
                onClick={() => onChangeMembers(false)}
                className={`rounded-lg px-3 py-1 font-semibold transition ${
                  !members ? 'bg-zinc-100 text-zinc-950' : 'text-zinc-500 hover:text-zinc-200'
                }`}
              >
                F2P
              </button>
            </div>
            <button
              onClick={onRefresh}
              className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#08080b] px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-900 hover:text-white"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Mode Selector + Summary KPIs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-3.5">
          <div className="flex flex-wrap gap-1.5">
            {MODE_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => onChangeMode(opt.key)}
                className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                  mode === opt.key
                    ? 'border-white/20 bg-white/[0.09] text-white'
                    : 'border-white/[0.05] bg-[#070709] text-zinc-500 hover:border-white/[0.12] hover:text-zinc-200'
                }`}
                title={opt.desc}
              >
                {opt.key === 'auto_mix' && <Sparkles className="h-3.5 w-3.5 text-amber-400" />}
                {opt.key === 'fast_flip' && <Zap className="h-3.5 w-3.5 text-emerald-400" />}
                {opt.key === 'overnight' && <Layers className="h-3.5 w-3.5 text-zinc-300" />}
                {opt.key === 'dump_sniper' && <Flame className="h-3.5 w-3.5 text-rose-400" />}
                {opt.key === 'alch_floor' && <Shield className="h-3.5 w-3.5 text-amber-300" />}
                {opt.label}
              </button>
            ))}
          </div>

          {tradeData && (
            <div className="flex flex-wrap items-center gap-5 text-xs tabular-nums">
              <div>
                <span className="text-zinc-500">Free Slots </span>
                <strong className="text-zinc-100">{tradeData.free_slots}/8</strong>
              </div>
              <div>
                <span className="text-zinc-500">Batch Profit (net 2%) </span>
                <strong className="text-emerald-400">
                  {formatSignedGp(tradeData.summary.est_batch_profit, true)}
                </strong>
              </div>
              <div className="flex items-center gap-1">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-zinc-500">Est. Potential </span>
                <strong className="text-amber-300">
                  {formatGp(tradeData.summary.est_combined_gp_per_hour, true)}/hr
                </strong>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Active 8-Slot GE Tracker + Proactive Offer Coach */}
      <SlotCoachBar
        slots={slots}
        onUpdateSlot={onUpdateSlot}
        onCompleteSlot={onCompleteSlot}
        onClearSlot={onClearSlot}
        onOpenChart={onOpenChart}
      />

      {/* Top Trade Calls Grid */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
            Recommended Trade Calls ({tradeData?.calls.length || 0}) — Sized for{' '}
            <span className="text-zinc-200">{formatGp(cashStack, true)} gp</span>
          </h2>
          <span className="text-[11px] text-zinc-600">
            Click prices to copy · Click Inspect or name for widescreen chart & flip calculator
          </span>
        </div>

        {!tradeData || tradeData.calls.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-12 text-center text-sm text-zinc-500">
            {loading
              ? 'Calculating live OSRS flipping opportunities...'
              : 'No items matched this strict filter right now. Try Auto-Mix or adjust your Cash Stack.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {tradeData.calls.map((call, idx) => (
              <TradeCallCard
                key={call.item_id}
                call={call}
                rank={idx + 1}
                onStartFlip={onStartFlip}
                onOpenChart={onOpenChart}
                disabledStart={slots.length >= 8}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
