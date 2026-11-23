import { useEffect, useState } from 'react';
import {
  Award,
  Calendar,
  Clock,
  Download,
  History,
  Percent,
  Receipt,
  TrendingDown,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import { api } from '../api/client';
import type { JournalDailyPnl, JournalEquityPoint, JournalResponse } from '../types';
import { formatCountdown, formatGp, formatSignedGp } from '../utils/format';

interface Props {
  slotsVersion: number;
  onOpenChart: (itemId: number) => void;
}

function formatHold(mins: number): string {
  if (!mins || mins < 1) return '<1m';
  if (mins < 60) return `${Math.round(mins)}m`;
  return `${(mins / 60).toFixed(1)}h`;
}

function RealizedProfitChart({ points }: { points: JournalEquityPoint[] }) {
  if (points.length === 0) {
    return (
      <div className="flex h-44 items-center justify-center rounded-xl border border-white/[0.06] bg-[#060608] text-xs text-zinc-500">
        Complete your first flip (or let RuneLite Dink log a sale) to chart your realized GP curve.
      </div>
    );
  }

  const series = [{ ts: points[0].ts, val: 0 }, ...points.map((p) => ({ ts: p.ts, val: p.cumulative_profit }))];
  const vals = series.map((s) => s.val);
  const min = Math.min(0, ...vals);
  const max = Math.max(0, ...vals, min + 1);
  const lastVal = vals[vals.length - 1];
  const stroke = lastVal >= 0 ? '#10b981' : '#f43f5e';

  const w = 520;
  const h = 160;
  const padX = 10;
  const padY = 14;

  const coords = series.map((pt, i) => {
    const x = series.length === 1 ? w / 2 : padX + (i / (series.length - 1)) * (w - padX * 2);
    const y = h - padY - ((pt.val - min) / (max - min)) * (h - padY * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const zeroY = h - padY - ((0 - min) / (max - min)) * (h - padY * 2);
  const polyline = coords.join(' ');
  const area = `${padX},${zeroY.toFixed(1)} ${polyline} ${w - padX},${zeroY.toFixed(1)}`;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#060608] p-3.5">
      <div className="mb-1.5 flex items-center justify-between text-[11px] tabular-nums">
        <span className="text-zinc-400">Cumulative Net Profit ({points.length} flips)</span>
        <span className={`font-bold ${lastVal >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {formatSignedGp(lastVal, true)} gp
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-40 w-full overflow-visible">
        <defs>
          <linearGradient id="realizedGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <line
          x1={padX}
          y1={zeroY}
          x2={w - padX}
          y2={zeroY}
          stroke="rgba(255,255,255,0.12)"
          strokeDasharray="3 3"
        />
        <polygon points={area} fill="url(#realizedGrad)" />
        <polyline
          fill="none"
          stroke={stroke}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={polyline}
        />
      </svg>
      <div className="mt-1 flex items-center justify-between text-[10px] tabular-nums text-zinc-500">
        <span>Min: {formatSignedGp(min, true)}</span>
        <span>Peak: {formatSignedGp(max, true)}</span>
      </div>
    </div>
  );
}

function DailyProfitStrip({ days }: { days: JournalDailyPnl[] }) {
  if (days.length === 0) return null;
  const maxAbs = Math.max(1, ...days.map((d) => Math.abs(d.net_profit)));
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#060608] p-3.5 space-y-2">
      <div className="flex items-center justify-between text-[11px]">
        <span className="flex items-center gap-1.5 font-semibold text-zinc-300">
          <Calendar className="h-3.5 w-3.5 text-amber-400" /> Daily Net Profit (UTC)
        </span>
        <span className="text-[10px] text-zinc-500">Last {days.length} active day{days.length === 1 ? '' : 's'}</span>
      </div>
      <div className="flex items-end gap-1.5 h-20 pt-2">
        {days.map((d) => {
          const pct = Math.max(10, Math.round((Math.abs(d.net_profit) / maxAbs) * 100));
          const pos = d.net_profit >= 0;
          return (
            <div
              key={d.date}
              className="group relative flex-1 flex flex-col items-center justify-end h-full"
              title={`${d.date}: ${formatSignedGp(d.net_profit)} gp (${d.flips} flips, ${d.wins} wins)`}
            >
              <div
                className={`w-full max-w-[26px] rounded-t-md transition ${
                  pos ? 'bg-emerald-500/75 hover:bg-emerald-400' : 'bg-rose-500/75 hover:bg-rose-400'
                }`}
                style={{ height: `${pct}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between text-[10px] tabular-nums text-zinc-500">
        <span>{days[0]?.date}</span>
        <span>{days[days.length - 1]?.date}</span>
      </div>
    </div>
  );
}

export function Journal({ slotsVersion, onOpenChart }: Props) {
  const [data, setData] = useState<JournalResponse | null>(null);

  useEffect(() => {
    api.journal(150).then(setData);
  }, [slotsVersion]);

  const s = data?.summary;
  const analytics = data?.analytics;

  return (
    <div className="space-y-5">
      {/* Header + Export CSV */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-100">Journal & Realized P&L</h1>
          <p className="mt-0.5 text-xs text-zinc-500">
            Post-2%-tax profit tracking, per-item performance leaderboard & active 4-hour GE buy limits
          </p>
        </div>
        <a
          href="/api/journal/export.csv"
          download="osrs_flip_journal.csv"
          className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.1] bg-[#0c0c0f] px-3.5 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-900 hover:text-white transition"
        >
          <Download className="h-3.5 w-3.5 text-emerald-400" /> Export CSV
        </a>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi
          icon={<Trophy className="h-4 w-4 text-emerald-400" />}
          label="Total Net Profit"
          value={formatSignedGp(s?.total_profit ?? 0, true)}
          accent={(s?.total_profit ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}
        />
        <Kpi
          icon={<TrendingUp className="h-4 w-4 text-amber-400" />}
          label="24h Profit"
          value={formatSignedGp(s?.profit_24h ?? 0, true)}
          accent="text-amber-300"
        />
        <Kpi
          icon={<TrendingUp className="h-4 w-4 text-zinc-300" />}
          label="7d Profit"
          value={formatSignedGp(s?.profit_7d ?? 0, true)}
        />
        <Kpi
          icon={<Clock className="h-4 w-4 text-emerald-400" />}
          label="Realized GP/hr"
          value={formatGp(s?.realized_gp_per_hour ?? 0, true)}
          sub={`Avg hold ${formatHold(s?.avg_hold_minutes ?? 0)}`}
        />
        <Kpi
          icon={<Percent className="h-4 w-4 text-zinc-300" />}
          label="Win Rate"
          value={`${s?.win_rate_pct ?? 0}%`}
          sub={`${s?.total_flips ?? 0} flips · avg ${s?.avg_roi_pct ?? 0}% ROI`}
        />
        <Kpi
          icon={<Receipt className="h-4 w-4 text-rose-400" />}
          label="2% GE Tax Paid"
          value={formatGp(s?.total_tax_paid ?? 0, true)}
          accent="text-rose-400"
        />
      </div>

      {/* Analytics Row: Cumulative P&L Curve + Per-Item Leaderboard */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.25fr_1fr]">
        <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-4 space-y-3">
          <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" /> Realized Profit Curve & Daily P&L
          </h3>
          <RealizedProfitChart points={analytics?.equity_curve ?? []} />
          <DailyProfitStrip days={analytics?.daily_pnl ?? []} />
        </div>

        {/* Per-Item Leaderboard */}
        <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
              <Award className="h-3.5 w-3.5 text-amber-400" /> Top Performing Items
            </h3>
            <span className="text-[10px] text-zinc-500">By realized net GP</span>
          </div>

          {!analytics || analytics.top_winners.length === 0 ? (
            <div className="flex h-44 items-center justify-center rounded-xl border border-white/[0.06] bg-[#060608] px-6 text-center text-xs text-zinc-500">
              Your personal best & worst flipping items will rank here automatically as flips complete.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#060608]">
                <table className="w-full text-left text-xs tabular-nums">
                  <thead className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-zinc-500">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2 text-right">Flips</th>
                      <th className="px-3 py-2 text-right">Win%</th>
                      <th className="px-3 py-2 text-right">Net GP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {analytics.top_winners.slice(0, 7).map((it) => (
                      <tr
                        key={it.item_id}
                        onClick={() => onOpenChart(it.item_id)}
                        className="cursor-pointer hover:bg-white/[0.04]"
                      >
                        <td className="px-3 py-2 font-semibold text-zinc-100 hover:text-amber-300 truncate max-w-[160px]">
                          {it.item_name}
                        </td>
                        <td className="px-3 py-2 text-right text-zinc-400">{it.flips}</td>
                        <td className="px-3 py-2 text-right text-zinc-300">{it.win_rate_pct}%</td>
                        <td
                          className={`px-3 py-2 text-right font-bold ${
                            it.total_profit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {formatSignedGp(it.total_profit, true)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {analytics.worst_items.length > 0 && (
                <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.05] p-3 text-xs space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-rose-300">
                    <TrendingDown className="h-3.5 w-3.5" /> Biggest Losses (Review Before Re-Flipping)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {analytics.worst_items.map((w) => (
                      <button
                        key={w.item_id}
                        onClick={() => onOpenChart(w.item_id)}
                        className="rounded-lg border border-rose-500/25 bg-[#09070a] px-2.5 py-1 text-[11px] text-rose-200 hover:bg-rose-500/15"
                      >
                        {w.item_name}: <strong className="font-mono-num">{formatSignedGp(w.total_profit, true)}</strong>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Active 4-Hour GE Buy Limits */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-amber-400" /> Active 4-Hour GE Buy-Limit Cooldowns
        </h3>
        {!data || data.buy_limits.length === 0 ? (
          <p className="mt-3 text-xs text-zinc-500">
            No active 4h buy limits. Limits track automatically when you complete buys or connect RuneLite Dink.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {data.buy_limits.map((bl) => {
              const pct = bl.buy_limit > 0 ? Math.min(100, (bl.quantity_bought / bl.buy_limit) * 100) : 0;
              return (
                <div key={bl.item_id} className="rounded-xl border border-white/[0.06] bg-[#070709] p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => onOpenChart(bl.item_id)}
                      title="Open item chart & order ticket"
                      className="truncate font-semibold text-zinc-100 hover:text-amber-300 hover:underline underline-offset-2"
                    >
                      {bl.item_name}
                    </button>
                    <span className="text-[11px] font-semibold text-amber-300 tabular-nums">
                      {formatCountdown(bl.seconds_remaining)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex justify-between text-[11px] text-zinc-500 tabular-nums">
                    <span>Bought: {bl.quantity_bought.toLocaleString()}</span>
                    <span>Limit: {bl.buy_limit ? bl.buy_limit.toLocaleString() : '—'}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
                    <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Flip History */}
      <div className="overflow-x-auto rounded-2xl border border-white/[0.08] bg-[#0c0c0f]">
        <div className="border-b border-white/[0.07] px-4 py-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
          <History className="h-3.5 w-3.5 text-zinc-300" /> Completed Flips History
        </div>
        {!data || data.history.length === 0 ? (
          <div className="p-8 text-center text-xs text-zinc-500">
            No completed flips logged yet. Mark a slot sold (or let Dink auto-log your sales) to track your real GP/hr.
          </div>
        ) : (
          <table className="w-full text-left text-xs tabular-nums">
            <thead className="border-b border-white/[0.07] bg-[#08080b] text-[10px] uppercase tracking-widest text-zinc-500">
              <tr>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Buy</th>
                <th className="px-4 py-3 text-right">Sell</th>
                <th className="px-4 py-3 text-right">2% Tax</th>
                <th className="px-4 py-3 text-right">Net Profit</th>
                <th className="px-4 py-3 text-right">ROI</th>
                <th className="px-4 py-3 text-right">Hold</th>
                <th className="px-4 py-3 text-right">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {data.history.map((f) => (
                <tr key={f.id} onClick={() => onOpenChart(f.item_id)} className="cursor-pointer hover:bg-white/[0.03]">
                  <td className="px-4 py-3 font-semibold text-zinc-100 hover:text-amber-300">{f.item_name}</td>
                  <td className="px-4 py-3 text-right text-zinc-300">{f.quantity.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-zinc-200">{formatGp(f.buy_price)}</td>
                  <td className="px-4 py-3 text-right text-amber-300">{formatGp(f.sell_price)}</td>
                  <td className="px-4 py-3 text-right text-rose-400">-{formatGp(f.tax_paid)}</td>
                  <td className={`px-4 py-3 text-right font-bold ${f.net_profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {formatSignedGp(f.net_profit)} gp
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-400">{f.roi_pct.toFixed(1)}%</td>
                  <td className="px-4 py-3 text-right text-zinc-500">{formatHold(f.duration_sec / 60)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="rounded-md border border-white/[0.08] bg-[#141419] px-1.5 py-0.5 text-[10px] uppercase text-zinc-300">
                      {f.source}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
  accent = 'text-zinc-100',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-3.5 tabular-nums">
      <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
        {icon} {label}
      </div>
      <div className={`mt-1 text-lg font-bold ${accent}`}>{value}</div>
      {sub && <div className="text-[10px] text-zinc-500">{sub}</div>}
    </div>
  );
}
