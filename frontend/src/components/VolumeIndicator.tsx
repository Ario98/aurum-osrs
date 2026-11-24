import { formatGp } from '../utils/format';

export interface VolumeTier {
  level: 1 | 2 | 3 | 4;
  label: 'Very High' | 'High' | 'Moderate' | 'Light';
  barColor: string;
  textColor: string;
}

/**
 * Classifies how actively an item trades across all price tiers — accounts for both
 * raw unit volume AND daily GP turnover so high-value PvM gear (e.g. Twisted bow,
 * Abyssal whip) is graded fairly alongside high-count commodities (bars, runes, food).
 */
export function getVolumeTier(vol1h: number, vol24h: number, unitPrice: number): VolumeTier {
  const dailyGpTurnover = vol24h * Math.max(unitPrice, 1);

  if (vol1h >= 2_500 || vol24h >= 50_000 || dailyGpTurnover >= 500_000_000) {
    return { level: 4, label: 'Very High', barColor: 'bg-emerald-400', textColor: 'text-emerald-400' };
  }
  if (vol1h >= 350 || vol24h >= 8_000 || dailyGpTurnover >= 100_000_000) {
    return { level: 3, label: 'High', barColor: 'bg-sky-400', textColor: 'text-sky-300' };
  }
  if (vol1h >= 50 || vol24h >= 1_200 || dailyGpTurnover >= 25_000_000) {
    return { level: 2, label: 'Moderate', barColor: 'bg-amber-400', textColor: 'text-amber-300' };
  }
  return { level: 1, label: 'Light', barColor: 'bg-zinc-400', textColor: 'text-zinc-400' };
}

interface Props {
  vol5m?: number;
  vol1h?: number;
  vol24h: number;
  unitPrice: number;
  compact?: boolean;
}

export function VolumeIndicator({ vol5m, vol1h, vol24h, unitPrice, compact = false }: Props) {
  const eff1h = vol1h ?? Math.round(vol24h / 24);
  const tier = getVolumeTier(eff1h, vol24h, unitPrice);
  const perMin = eff1h / 60;
  const paceStr =
    perMin >= 10
      ? `~${Math.round(perMin).toLocaleString()}/min`
      : perMin >= 1
        ? `~${perMin.toFixed(1)}/min`
        : `${eff1h.toLocaleString()}/hr`;

  const tooltip = [
    `Trading Activity: ${tier.label} (${paceStr})`,
    vol5m !== undefined ? `Last 5m: ${vol5m.toLocaleString()} traded` : null,
    `Last 1h: ${eff1h.toLocaleString()} traded`,
    `Last 24h: ${vol24h.toLocaleString()} traded (${formatGp(vol24h * Math.max(unitPrice, 1), true)} gp turnover)`,
  ]
    .filter(Boolean)
    .join('\n');

  const heights = ['h-1.5', 'h-2', 'h-2.5', 'h-3'];

  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap"
      title={tooltip}
    >
      {/* 4-Bar Liquidity / Activity Signal Meter */}
      <span className="inline-flex items-end gap-[2px] h-3" aria-hidden="true">
        {[1, 2, 3, 4].map((bar) => (
          <span
            key={bar}
            className={`w-[3px] rounded-xs transition-colors ${heights[bar - 1]} ${
              bar <= tier.level ? tier.barColor : 'bg-white/[0.1]'
            }`}
          />
        ))}
      </span>
      <span className={`font-sans text-[10px] font-semibold ${tier.textColor}`}>
        {compact ? formatGp(vol24h, true) : tier.label}
      </span>
    </span>
  );
}
