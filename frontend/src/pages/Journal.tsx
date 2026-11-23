import { useEffect, useState } from 'react';
import { Clock, History, Percent, Receipt, TrendingUp, Trophy } from 'lucide-react';
import { api } from '../api/client';
import type { JournalResponse } from '../types';
import { formatCountdown, formatGp, formatSignedGp } from '../utils/format';

interface Props {
  slotsVersion: number;
  onOpenChart: (itemId: number) => void;
}

export function Journal({ slotsVersion, onOpenChart }: Props) {
  const [data, setData] = useState<JournalResponse | null>(null);

  useEffect(() => {
    api.journal(150).then(setData);
  }, [slotsVersion]);

  const s = data?.summary;

  return (
    <div className="space-y-5">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi icon={<Trophy className="h-4 w-4 text-emerald-400" />} label="Total Net Profit" value={formatSignedGp(s?.total_profit ?? 0, true)} accent="text-emerald-400" />
        <Kpi icon={<TrendingUp className="h-4 w-4 text-amber-400" />} label="24h Profit" value={formatSignedGp(s?.profit_24h ?? 0, true)} accent="text-amber-300" />
        <Kpi icon={<TrendingUp className="h-4 w-4 text-zinc-300" />} label="7d Profit" value={formatSignedGp(s?.profit_7d ?? 0, true)} />
        <Kpi icon={<Clock className="h-4 w-4 text-emerald-400" />} label="Realized GP/hr" value={formatGp(s?.realized_gp_per_hour ?? 0, true)} />
        <Kpi icon={<Percent className="h-4 w-4 text-zinc-300" />} label="Win Rate" value={`${s?.win_rate_pct ?? 0}%`} sub={`${s?.total_flips ?? 0} flips`} />
        <Kpi icon={<Receipt className="h-4 w-4 text-rose-400" />} label="2% GE Tax Paid" value={formatGp(s?.total_tax_paid ?? 0, true)} accent="text-rose-400" />
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
                    <button onClick={() => onOpenChart(bl.item_id)} className="truncate font-semibold text-zinc-100 hover:text-white">
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
                <th className="px-4 py-3 text-right">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {data.history.map((f) => (
                <tr key={f.id} onClick={() => onOpenChart(f.item_id)} className="cursor-pointer hover:bg-white/[0.03]">
                  <td className="px-4 py-3 font-semibold text-zinc-100">{f.item_name}</td>
                  <td className="px-4 py-3 text-right text-zinc-300">{f.quantity.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-zinc-200">{formatGp(f.buy_price)}</td>
                  <td className="px-4 py-3 text-right text-amber-300">{formatGp(f.sell_price)}</td>
                  <td className="px-4 py-3 text-right text-rose-400">-{formatGp(f.tax_paid)}</td>
                  <td className={`px-4 py-3 text-right font-bold ${f.net_profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {formatSignedGp(f.net_profit)} gp
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-400">{f.roi_pct.toFixed(1)}%</td>
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

function Kpi({ icon, label, value, sub, accent = 'text-zinc-100' }: { icon: React.ReactNode; label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-3.5 tabular-nums">
      <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
        {icon} {label}
      </div>
      <div className={`mt-1 text-lg font-bold ${accent}`}>{value}</div>
      {sub && <div className="text-[10px] text-zinc-600">{sub}</div>}
    </div>
  );
}
