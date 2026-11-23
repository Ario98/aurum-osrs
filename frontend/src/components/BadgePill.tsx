import { useState, type ReactNode } from 'react';

interface DetailRow {
  label: string;
  value: string;
  highlight?: 'emerald' | 'amber' | 'rose' | 'zinc';
}

interface Props {
  label: string;
  cls: string;
  tooltipTitle: string;
  tooltipText: string;
  icon?: ReactNode;
  details?: DetailRow[];
}

/**
 * Uniform pill badge with an instant hover/tap plain-English popover.
 */
export function BadgePill({ label, cls, tooltipTitle, tooltipText, icon, details }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-flex items-center shrink-0"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9.5px] font-bold tracking-wider transition hover:brightness-115 ${cls}`}
      >
        {icon}
        <span>{label}</span>
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-full left-0 z-50 mb-2 w-64 rounded-xl border border-white/[0.14] bg-[#111117] p-3 text-left text-[11px] font-normal normal-case tracking-normal leading-relaxed text-zinc-300 shadow-2xl"
        >
          <div className="mb-1 font-bold text-zinc-100">{tooltipTitle}</div>
          <p className="text-[10.5px] text-zinc-400">{tooltipText}</p>
          {details && details.length > 0 && (
            <div className="mt-2 space-y-1 rounded-lg border border-white/[0.06] bg-[#07080c] p-2 text-[10.5px]">
              {details.map((d) => {
                const vCls =
                  d.highlight === 'emerald'
                    ? 'text-emerald-400 font-bold'
                    : d.highlight === 'amber'
                      ? 'text-amber-300 font-bold'
                      : d.highlight === 'rose'
                        ? 'text-rose-400 font-bold'
                        : 'text-zinc-200 font-semibold';
                return (
                  <div key={d.label} className="flex items-center justify-between gap-2">
                    <span className="text-zinc-500">{d.label}</span>
                    <span className={`font-mono-num ${vCls}`}>{d.value}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </span>
  );
}

export const STRATEGY_META: Record<
  string,
  { label: string; cls: string; title: string; desc: string }
> = {
  fast_flip: {
    label: 'FAST',
    cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
    title: 'Fast Flip (High-Volume Spread)',
    desc: 'High hourly volume with a clean instant buy/sell spread after 2% GE tax — sized for quick fills while actively playing.',
  },
  overnight: {
    label: 'MARGIN',
    cls: 'text-zinc-200 bg-white/[0.06] border-white/[0.12]',
    title: 'Big-Margin Swing',
    desc: 'Higher GP profit per 4-hour buy limit with slightly more patient fill times.',
  },
  dump_sniper: {
    label: 'DUMP',
    cls: 'text-rose-300 bg-rose-500/12 border-rose-500/30',
    title: 'Dump Sniper (Crash Rebound)',
    desc: 'Trading unusually far below its hourly VWAP average due to a sudden sell-off, targeting a conservative bounce back toward fair value.',
  },
  alch_floor: {
    label: 'ALCH',
    cls: 'text-amber-300 bg-amber-500/10 border-amber-500/25',
    title: 'High-Alch Floor Protection',
    desc: 'Trading near High Alchemy minus Nature Rune value, giving a natural downside floor against steep crashes.',
  },
  auto_mix: {
    label: 'CALL',
    cls: 'text-zinc-300 bg-white/[0.06] border-white/[0.12]',
    title: 'Top Auto-Mix Trade Call',
    desc: 'Automatically selected as one of the highest GP/hr opportunities sized for your cash stack.',
  },
};

export const OVERNIGHT_RISK_META: Record<
  string,
  { cls: string; title: string; desc: string }
> = {
  LOW: {
    cls: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400',
    title: 'Low Overnight Risk',
    desc: 'High safety score (≥ 78), tight 24h volatility (≤ 3.5%), or protected near its High Alch floor — ideal for sleeping.',
  },
  MODERATE: {
    cls: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
    title: 'Moderate Overnight Risk',
    desc: 'Healthy liquidity and steady 7-day corridor with slightly wider daily price swings for higher upside.',
  },
  SWING: {
    cls: 'border-indigo-500/30 bg-indigo-500/15 text-indigo-300',
    title: 'Swing Overnight Risk',
    desc: 'Wider price range and bigger GP margin per slot — higher reward, but check the 7d chart before sizing up.',
  },
};
