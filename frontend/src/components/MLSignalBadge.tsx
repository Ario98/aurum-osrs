import { useState } from 'react';
import { Brain } from 'lucide-react';
import type { MLPrediction } from '../types';

interface Props {
  ml: MLPrediction;
  horizon?: '4h' | '12h';
  compact?: boolean;
}

export function getAiVerdict(ml: MLPrediction): {
  label: string;
  tone: 'emerald' | 'sky' | 'amber' | 'rose';
  summary: string;
} {
  const p4 = ml.prob_4h_pct;
  const p12 = ml.prob_12h_pct;
  const roi12 = ml.pred_12h_roi_pct;

  if (p4 >= 75 && p12 >= 75) {
    return {
      label: 'Strong 4h & Overnight',
      tone: 'emerald',
      summary: `High historical odds for both a quick 4h flip (${p4.toFixed(0)}%) and an overnight hold (${p12.toFixed(0)}%, est. ${roi12 >= 0 ? '+' : ''}${roi12.toFixed(1)}% after 2% tax).`,
    };
  }
  if (p4 >= 70 && p12 < 55) {
    return {
      label: 'Good Fast Flip · Weak Overnight',
      tone: 'sky',
      summary: `Strong short-term 4h spread odds (${p4.toFixed(0)}%), but weaker overnight follow-through (${p12.toFixed(0)}%). Better for active flipping than sleeping on it.`,
    };
  }
  if (p12 >= 72 && p4 < 65) {
    return {
      label: 'Strong Overnight Hold',
      tone: 'sky',
      summary: `Better suited for an 8–12h overnight swing (${p12.toFixed(0)}% win odds, est. ${roi12 >= 0 ? '+' : ''}${roi12.toFixed(1)}% net ROI) than a rushed quick flip.`,
    };
  }
  if (p4 >= 55 || p12 >= 55) {
    return {
      label: 'Moderate AI Confidence',
      tone: 'amber',
      summary: `Mixed historical edge (4h: ${p4.toFixed(0)}%, 12h: ${p12.toFixed(0)}%). Confirm live buy/sell flow and spread before sizing up.`,
    };
  }
  return {
    label: 'Low AI Win Odds',
    tone: 'rose',
    summary: `Model sees weak post-tax win odds right now (4h: ${p4.toFixed(0)}%, 12h: ${p12.toFixed(0)}%). Watch out for thin spreads or fading volume.`,
  };
}

/**
 * High-visibility AI signal pill with Brain icon, explicit horizon label, confidence tier color,
 * and rich hover/tap popover explaining what the prediction means after 2% GE tax.
 */
export function MLSignalBadge({ ml, horizon = '4h', compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const pct = horizon === '12h' ? ml.prob_12h_pct : ml.prob_4h_pct;

  const tierCls =
    pct >= 75
      ? 'border-cyan-400/35 bg-cyan-500/12 text-cyan-200 shadow-[0_0_12px_rgba(34,211,238,0.12)]'
      : pct >= 55
        ? 'border-amber-400/30 bg-amber-500/10 text-amber-200'
        : 'border-rose-500/30 bg-rose-500/10 text-rose-300';

  const tierWord = pct >= 75 ? 'High' : pct >= 55 ? 'Mid' : 'Low';
  const roiSign = ml.pred_12h_roi_pct >= 0 ? '+' : '';

  const label =
    horizon === '12h'
      ? compact
        ? `AI 12h: ${Math.round(ml.prob_12h_pct)}%`
        : `AI 12h: ${Math.round(ml.prob_12h_pct)}% · ${roiSign}${ml.pred_12h_roi_pct.toFixed(1)}%`
      : compact
        ? `AI 4h: ${Math.round(ml.prob_4h_pct)}%`
        : `AI 4h: ${Math.round(ml.prob_4h_pct)}% Win`;

  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold tracking-tight font-mono-num transition hover:brightness-110 ${tierCls}`}
      >
        <Brain className="h-3 w-3 shrink-0" />
        <span>{label}</span>
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-full left-0 z-50 mb-2 w-72 rounded-xl border border-cyan-500/25 bg-[#0e1016] p-3 text-left text-[11px] font-normal leading-relaxed text-zinc-300 shadow-2xl"
        >
          <div className="mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-bold text-cyan-200">
              <Brain className="h-3.5 w-3.5 text-cyan-400" /> AI Post-Tax Forecast
            </span>
            <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-semibold text-zinc-300">
              {tierWord} Confidence
            </span>
          </div>
          <div className="mb-2 grid grid-cols-3 gap-1.5 rounded-lg border border-white/[0.06] bg-[#07080c] p-2 text-center font-mono-num">
            <div>
              <div className="text-[9px] font-sans uppercase text-zinc-500">4h Win</div>
              <div className="text-xs font-bold text-zinc-100">{ml.prob_4h_pct.toFixed(0)}%</div>
            </div>
            <div>
              <div className="text-[9px] font-sans uppercase text-zinc-500">12h Win</div>
              <div className="text-xs font-bold text-zinc-100">{ml.prob_12h_pct.toFixed(0)}%</div>
            </div>
            <div>
              <div className="text-[9px] font-sans uppercase text-zinc-500">12h ROI</div>
              <div
                className={`text-xs font-bold ${
                  ml.pred_12h_roi_pct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {roiSign}
                {ml.pred_12h_roi_pct.toFixed(1)}%
              </div>
            </div>
          </div>
          <p className="text-[10.5px] text-zinc-400">
            Estimated odds this flip clears at least <strong className="text-zinc-200">+0.5% (4h)</strong> or{' '}
            <strong className="text-zinc-200">+1.2% (12h)</strong> net profit <em>after</em> the exact 2% GE tax,
            trained on 30 days of hourly OSRS market data.
          </p>
        </div>
      )}
    </span>
  );
}
