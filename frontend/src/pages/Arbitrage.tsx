import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, FlaskConical, Package, Sparkles, Zap } from 'lucide-react';
import { api } from '../api/client';
import type { ArbitrageSummary } from '../types';
import { formatGp, formatSignedGp } from '../utils/format';

interface Props {
  members: boolean;
  tickVersion: number;
  onOpenChart: (itemId: number) => void;
}

export function Arbitrage({ members, tickVersion, onOpenChart }: Props) {
  const [tab, setTab] = useState<'sets' | 'decanting' | 'alch'>('sets');
  const [data, setData] = useState<ArbitrageSummary | null>(null);
  const [expandedSet, setExpandedSet] = useState<number | null>(null);

  useEffect(() => {
    api.arbitrageSummary(members).then(setData);
  }, [members, tickVersion]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-3.5">
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setTab('sets')}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
              tab === 'sets'
                ? 'bg-zinc-100 text-zinc-950'
                : 'border border-white/[0.06] bg-[#070709] text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
            }`}
          >
            <Package className="h-3.5 w-3.5" /> GE Item Sets ({data?.sets.length || 0})
          </button>
          <button
            onClick={() => setTab('decanting')}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
              tab === 'decanting'
                ? 'bg-zinc-100 text-zinc-950'
                : 'border border-white/[0.06] bg-[#070709] text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
            }`}
          >
            <FlaskConical className="h-3.5 w-3.5" /> Bob Barter Decanting ({data?.decanting.length || 0})
          </button>
          <button
            onClick={() => setTab('alch')}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
              tab === 'alch'
                ? 'bg-zinc-100 text-zinc-950'
                : 'border border-white/[0.06] bg-[#070709] text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" /> High Alchemy ({data?.high_alch.length || 0})
          </button>
        </div>

        <div className="text-xs text-zinc-500 tabular-nums">
          Live Nature Rune <strong className="text-emerald-400">{formatGp(data?.nature_rune_price)} gp</strong> · Exact 2% GE tax included
        </div>
      </div>

      {/* GE ITEM SETS */}
      {tab === 'sets' && (
        <div className="space-y-2.5">
          {!data || data.sets.length === 0 ? (
            <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-8 text-center text-xs text-zinc-500">
              No profitable GE Item Set pack/unpack spreads found right now.
            </div>
          ) : (
            data.sets.map((s) => {
              const isOpen = expandedSet === s.set_id;
              return (
                <div key={s.set_id} className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] overflow-hidden">
                  <div
                    onClick={() => setExpandedSet(isOpen ? null : s.set_id)}
                    className="flex cursor-pointer flex-wrap items-center justify-between gap-3 p-4 hover:bg-white/[0.03]"
                  >
                    <div className="flex items-center gap-2.5">
                      {isOpen ? <ChevronDown className="h-4 w-4 text-zinc-500" /> : <ChevronRight className="h-4 w-4 text-zinc-500" />}
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${
                          s.direction === 'PACK'
                            ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400'
                            : 'border-white/15 bg-zinc-900 text-zinc-200'
                        }`}
                      >
                        {s.direction === 'PACK' ? 'BUY PIECES → PACK SET' : 'BUY SET → UNPACK'}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenChart(s.set_id);
                        }}
                        className="text-sm font-semibold text-zinc-100 hover:text-white"
                      >
                        {s.set_name}
                      </button>
                      {s.is_instant_profitable && (
                        <span className="flex items-center gap-0.5 rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                          <Zap className="h-3 w-3" /> INSTANT
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-5 text-xs tabular-nums">
                      <div>
                        <span className="text-zinc-500">Cost </span>
                        <strong className="text-zinc-200">{formatGp(s.capital_required, true)}</strong>
                      </div>
                      <div>
                        <span className="text-zinc-500">Limit Net </span>
                        <strong className="text-emerald-400">{formatSignedGp(s.net_profit)} gp ({s.roi_pct}%)</strong>
                      </div>
                      <div>
                        <span className="text-zinc-500">Instant </span>
                        <strong className={s.instant_profit > 0 ? 'text-amber-300' : 'text-zinc-600'}>
                          {formatSignedGp(s.instant_profit)} gp
                        </strong>
                      </div>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t border-white/[0.06] bg-[#070709] p-4 text-xs">
                      <div className="mb-3 flex justify-between text-zinc-500">
                        <span>
                          Set Box Price: Low <strong className="text-zinc-200">{formatGp(s.set_low)}</strong> / High{' '}
                          <strong className="text-amber-300">{formatGp(s.set_high)}</strong> (24h vol: {s.set_vol_24h})
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-4">
                        {s.components.map((c) => (
                          <div
                            key={c.id}
                            onClick={() => onOpenChart(c.id)}
                            className="cursor-pointer rounded-xl border border-white/[0.07] bg-[#0e0e12] p-2.5 hover:border-white/[0.2]"
                          >
                            <div className="font-medium text-zinc-200 truncate">{c.name}</div>
                            <div className="mt-1 flex justify-between text-[11px] tabular-nums">
                              <span className="text-zinc-300">Low: {formatGp(c.low)}</span>
                              <span className="text-amber-300">High: {formatGp(c.high)}</span>
                            </div>
                            <div className="mt-0.5 text-[10px] text-zinc-600">24h Vol: {c.vol_24h}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* POTION DECANTING */}
      {tab === 'decanting' && (
        <div className="overflow-x-auto rounded-2xl border border-white/[0.08] bg-[#0c0c0f]">
          <table className="w-full text-left text-xs tabular-nums">
            <thead className="border-b border-white/[0.07] bg-[#08080b] text-[10px] uppercase tracking-widest text-zinc-500">
              <tr>
                <th className="px-4 py-3">Conversion (Bob Barter @ GE)</th>
                <th className="px-4 py-3 text-right">Buy Source</th>
                <th className="px-4 py-3 text-right">Sell (4)-Dose</th>
                <th className="px-4 py-3 text-right">Limit Profit / (4)</th>
                <th className="px-4 py-3 text-right">Instant / (4)</th>
                <th className="px-4 py-3 text-right">Profit / 4h Limit</th>
                <th className="px-4 py-3 text-right">24h Vol</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {(data?.decanting || []).map((d) => (
                <tr key={`${d.from_item_id}-${d.to_item_id}`} className="hover:bg-white/[0.03]">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => onOpenChart(d.from_item_id)}
                      title="Open item chart & order ticket"
                      className="font-semibold text-zinc-100 hover:text-amber-300 hover:underline underline-offset-2"
                    >
                      {d.from_item_name}
                    </button>
                    <span className="mx-1.5 text-zinc-600">→</span>
                    <button onClick={() => onOpenChart(d.to_item_id)} className="text-zinc-300 hover:underline">
                      {d.to_item_name}
                    </button>
                    {d.is_instant_profitable && (
                      <span className="ml-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                        INSTANT
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-200">{formatGp(d.from_buy_price)}</td>
                  <td className="px-4 py-3 text-right text-amber-300">{formatGp(d.to_sell_price)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-emerald-400">
                    +{d.net_profit_per_4dose.toFixed(0)} gp ({d.roi_pct}%)
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold ${d.instant_profit_per_4dose > 0 ? 'text-amber-300' : 'text-zinc-600'}`}>
                    {d.instant_profit_per_4dose > 0 ? '+' : ''}
                    {d.instant_profit_per_4dose.toFixed(0)} gp
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-emerald-300">
                    {formatSignedGp(d.profit_per_limit, true)}
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-500">{d.from_vol_24h.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* HIGH ALCH */}
      {tab === 'alch' && (
        <div className="overflow-x-auto rounded-2xl border border-white/[0.08] bg-[#0c0c0f]">
          <table className="w-full text-left text-xs tabular-nums">
            <thead className="border-b border-white/[0.07] bg-[#08080b] text-[10px] uppercase tracking-widest text-zinc-500">
              <tr>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3 text-right">Buy (Low)</th>
                <th className="px-4 py-3 text-right">High Alch</th>
                <th className="px-4 py-3 text-right">Net Alch Profit</th>
                <th className="px-4 py-3 text-right">ROI %</th>
                <th className="px-4 py-3 text-right">Profit / 4h Limit</th>
                <th className="px-4 py-3 text-right">24h Vol</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {(data?.high_alch || []).map((a) => (
                <tr key={a.item_id} onClick={() => onOpenChart(a.item_id)} className="cursor-pointer hover:bg-white/[0.03]">
                  <td className="px-4 py-3 font-semibold text-zinc-100">{a.item_name}</td>
                  <td className="px-4 py-3 text-right text-zinc-200">{formatGp(a.buy_price)}</td>
                  <td className="px-4 py-3 text-right text-amber-300">{formatGp(a.highalch)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-emerald-400">+{formatGp(a.alch_profit)} gp</td>
                  <td className="px-4 py-3 text-right text-emerald-300">{a.roi_pct}%</td>
                  <td className="px-4 py-3 text-right font-bold text-zinc-100">{formatSignedGp(a.profit_per_limit, true)}</td>
                  <td className="px-4 py-3 text-right text-zinc-500">{a.vol_24h.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
