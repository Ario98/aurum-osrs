import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Brain,
  Compass,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { AurumMark, BRAND_NAME, BRAND_REPO_URL, BRAND_SIGNATURE, BRAND_SUBTITLE } from './AurumLogo';

interface Props {
  open: boolean;
  onClose: () => void;
}

type HelpTab = 'quickstart' | 'ai' | 'glossary' | 'rules';

interface GlossaryEntry {
  term: string;
  short: string;
  category: 'AI & ML' | 'Market Metrics' | 'Strategies' | 'GE Rules';
  detail: string;
}

const GLOSSARY: GlossaryEntry[] = [
  {
    term: 'AI 4h Win %',
    short: 'Predicted odds a quick 4-hour flip profits ≥ 0.5% after tax',
    category: 'AI & ML',
    detail:
      'Probability estimated by our Gradient-Boosted ML model that buying at low + 1 gp and selling into realistic next-4h high volume clears at least +0.5% net profit after the exact 2% GE tax.',
  },
  {
    term: 'AI 12h Win % & Pred ROI',
    short: 'Overnight win probability (≥ 1.2% net) & expected 12h return',
    category: 'AI & ML',
    detail:
      'Estimates how likely an overnight bid is to fill and sell into morning highs over hours +2 to +12 for ≥ +1.2% net profit after 2% tax, alongside the model’s expected net ROI percentage.',
  },
  {
    term: 'ML Boost (On / Off)',
    short: 'Blends validated AI scores into Trade Calls & Overnight ranking',
    category: 'AI & ML',
    detail:
      'Only unlocks when out-of-sample walk-forward validation beats the rules baseline. Even when On, hard GE tax, liquidity, 4h buy limit, and safety guardrails are never bypassed.',
  },
  {
    term: 'ROC-AUC',
    short: 'How well the AI ranks winning flips above losing flips (0.50–1.00)',
    category: 'AI & ML',
    detail:
      '0.50 is a random coin flip; 0.70+ is solid signal; 0.85+ means the model strongly separates high-probability post-tax flips from traps out-of-sample.',
  },
  {
    term: 'Walk-Forward & 12h Embargo',
    short: 'Leak-free historical backtest simulating future trading',
    category: 'AI & ML',
    detail:
      'The model trains only on past days, skips a 12-hour embargo buffer so future 12h outcomes cannot leak into training, and is scored strictly on unseen future days across 3 expanding folds.',
  },
  {
    term: 'OFI (Order Flow Imbalance)',
    short: 'Buy pressure vs. sell pressure (-1.0 to +1.0)',
    category: 'Market Metrics',
    detail:
      'Calculated as (Instant-Buy Vol − Instant-Sell Vol) / Total Vol. Positive OFI (> +0.25) means buyers are aggressively lifting offers (bullish); deeply negative OFI (< −0.40) means sellers are dumping.',
  },
  {
    term: 'VWAP (24h / 7d)',
    short: 'Volume-Weighted Average Price over hourly candles',
    category: 'Market Metrics',
    detail:
      'The true average traded price weighted by volume rather than noisy 1-item outliers. Used as the fair-value anchor for Dump Sniper bounce targets.',
  },
  {
    term: 'Z-Score (σ)',
    short: 'How many standard deviations price is below or above average',
    category: 'Market Metrics',
    detail:
      'Measured across hourly (/1h) candles. A Z-score of −2.0σ or lower means an item is trading unusually far below its normal 24h or 7d VWAP — the core trigger for Dump Sniper.',
  },
  {
    term: 'p25 → p75 Band (7d)',
    short: 'Typical 7-day low-to-high trading corridor',
    category: 'Market Metrics',
    detail:
      '25th and 75th percentiles of 7 days of hourly prices. Overnight Flips anchor buy bids near p25 and morning sell targets near p75 so offers fill reliably while you sleep.',
  },
  {
    term: 'Safety Score (0–100)',
    short: 'Overall liquidity, quote freshness, and anti-trap rating',
    category: 'Market Metrics',
    detail:
      'Penalizes stale quotes, thin volume, inverted spreads, falling knives, and erratic spikes. 75+ is very steady; under 45 means higher risk or low liquidity.',
  },
  {
    term: 'Flip Sharpe',
    short: 'Net ROI relative to price volatility',
    category: 'Market Metrics',
    detail:
      'Net ROI % divided by 24h volatility %. Higher Flip Sharpe means you are earning clean margin without wild price swings.',
  },
  {
    term: 'Alch Floor',
    short: 'Downside price cushion near High Alchemy value',
    category: 'Strategies',
    detail:
      'Items trading near (High Alch − Nature Rune cost) rarely crash far below that floor because players buy them to alch for guaranteed GP.',
  },
  {
    term: 'Dump Sniper',
    short: 'Catches panic crashes that are likely to bounce back to VWAP',
    category: 'Strategies',
    detail:
      'Finds items trading far below 24h/7d hourly VWAP (low Z-score) with healthy volume, then suggests a conservative 99% VWAP bounce target.',
  },
  {
    term: 'Overnight Flips & Night Coach',
    short: '8–12h set-and-forget bids with calm coach thresholds',
    category: 'Strategies',
    detail:
      'Targets patient sleep-window fills using 7d p25→p75 bands. Marking a slot as Overnight stops the Proactive Offer Coach from nagging you to relist normal 1–3% underbids.',
  },
  {
    term: '2% GE Tax & 5M Cap',
    short: 'Exact May 2025+ OSRS Grand Exchange seller tax',
    category: 'GE Rules',
    detail:
      '2% rounded down per sold item, 0 gp tax on items under 50 gp, capped at 5,000,000 gp on mega-rares ≥ 250M gp (e.g., Twisted bow, Shadow), and 0% on the 41 official tax-exempt items (Bonds, Lobsters, low-level teleports, etc.).',
  },
  {
    term: '4-Hour GE Buy Limit',
    short: 'Maximum quantity you can buy per item every 4 hours',
    category: 'GE Rules',
    detail:
      'Every item has a rolling 4-hour RuneScape buy limit. Trade Calls and Overnight automatically size quantities to fit both your cash stack and remaining 4h buy limit.',
  },
  {
    term: 'WAL Checkpoint',
    short: 'Flushes SQLite write-ahead log safely back into the main DB file',
    category: 'GE Rules',
    detail:
      'In Settings → System Health, WAL Checkpoint merges pending SQLite journal frames into the primary database file cleanly without interrupting live polling.',
  },
];

export function HelpModal({ open, onClose }: Props) {
  const [tab, setTab] = useState<HelpTab>('quickstart');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const filteredGlossary = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return GLOSSARY;
    return GLOSSARY.filter(
      (g) =>
        g.term.toLowerCase().includes(q) ||
        g.short.toLowerCase().includes(q) ||
        g.detail.toLowerCase().includes(q) ||
        g.category.toLowerCase().includes(q),
    );
  }, [search]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0a0a0e] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <AurumMark className="h-8 w-8 shrink-0" />
            <div>
              <h2 className="text-sm font-bold text-zinc-100">{BRAND_NAME} Guide &amp; Trading Glossary</h2>
              <p className="text-[11px] text-zinc-500">
                Plain-English guide to AI signals, market metrics, GE tax, and flipping workflows
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-1 border-b border-white/[0.07] bg-[#07070a] px-5 py-2.5">
          {[
            { key: 'quickstart' as const, label: 'Quick Start', icon: <Compass className="h-3.5 w-3.5" /> },
            { key: 'ai' as const, label: 'AI & Backtest', icon: <Brain className="h-3.5 w-3.5" /> },
            { key: 'glossary' as const, label: 'Glossary (A–Z)', icon: <BookOpen className="h-3.5 w-3.5" /> },
            { key: 'rules' as const, label: 'GE Tax & Safety', icon: <ShieldCheck className="h-3.5 w-3.5" /> },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                tab === t.key ? 'bg-zinc-100 text-zinc-950' : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-5 space-y-4 text-xs leading-relaxed text-zinc-300">
          {tab === 'quickstart' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-white/[0.08] bg-[#0e0e13] p-4 space-y-1.5">
                  <div className="font-bold text-zinc-100">1. Set Your Cash Stack & Mode</div>
                  <p className="text-zinc-400">
                    Click your GP balance in the top bar (e.g. <strong className="text-zinc-200">25M</strong>) and
                    toggle <strong className="text-zinc-200">P2P / F2P</strong>. Every quantity, buy limit, and profit
                    estimate automatically scales to your bankroll.
                  </p>
                </div>
                <div className="rounded-xl border border-white/[0.08] bg-[#0e0e13] p-4 space-y-1.5">
                  <div className="font-bold text-zinc-100">2. Pick Flips & Track Slots</div>
                  <p className="text-zinc-400">
                    Use <strong className="text-zinc-200">Trade Calls</strong> while playing and{' '}
                    <strong className="text-zinc-200">Overnight</strong> before bed. Click{' '}
                    <strong className="text-zinc-200">Start Flip</strong> or{' '}
                    <strong className="text-zinc-200">Start Night</strong> to log the offer into your top 8-slot ribbon
                    (it tracks your offers — it never auto-clicks in RuneScape).
                  </p>
                </div>
                <div className="rounded-xl border border-white/[0.08] bg-[#0e0e13] p-4 space-y-1.5">
                  <div className="font-bold text-zinc-100">3. Connect RuneLite Dink (Optional)</div>
                  <p className="text-zinc-400">
                    Paste your private webhook URL from <strong className="text-zinc-200">Settings</strong> into the
                    RuneLite <strong className="text-zinc-200">Dink</strong> plugin so GE buys & sells automatically
                    update your 8 slots, 4h buy limits, and realized post-tax profit journal.
                  </p>
                </div>
                <div className="rounded-xl border border-white/[0.08] bg-[#0e0e13] p-4 space-y-1.5">
                  <div className="font-bold text-zinc-100">4. Use Watchlist & Proactive Coach</div>
                  <p className="text-zinc-400">
                    Star favorite items to get Discord alerts when prices hit your custom targets. Your top slot ribbon
                    warns you if you get outbid (Active flips) while staying calm on Overnight bids.
                  </p>
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-[#07070a] px-4 py-3 text-[11px] text-zinc-400">
                <strong className="text-zinc-200">Pro tip:</strong> Press{' '}
                <kbd className="rounded border border-white/15 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-200">
                  Ctrl K
                </kbd>{' '}
                anywhere to search all 4,600+ OSRS items instantly, or click the green{' '}
                <strong className="text-emerald-300">Live</strong> pill in the top bar to open System & Data Health.
              </div>
            </div>
          )}

          {tab === 'ai' && (
            <div className="space-y-3.5">
              <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/[0.06] p-4 space-y-2">
                <div className="flex items-center gap-2 font-bold text-cyan-200">
                  <Brain className="h-4 w-4 text-cyan-400" /> What Do the AI Badges Mean?
                </div>
                <p className="text-zinc-300">
                  Every liquid item is scored by 3 Gradient-Boosted ML models trained on{' '}
                  <strong className="text-white">30 days of hourly OSRS candles</strong> (21 historical features, zero
                  future leakage):
                </p>
                <ul className="list-disc list-inside space-y-1 text-zinc-300">
                  <li>
                    <strong className="text-cyan-200">AI 4h: XX% Win</strong> — Odds that buying at live low + 1 gp
                    clears <strong className="text-white">≥ +0.5% net profit</strong> within 4 hours after the 2% GE tax.
                  </li>
                  <li>
                    <strong className="text-cyan-200">AI 12h: XX% · +Y.Y%</strong> — Odds that an overnight bid clears{' '}
                    <strong className="text-white">≥ +1.2% net profit</strong> by morning, plus the predicted post-tax
                    return.
                  </li>
                </ul>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 p-3">
                  <div className="font-bold text-cyan-200">High (≥ 75%)</div>
                  <p className="mt-1 text-[11px] text-zinc-300">
                    Strong historical odds of a clean post-tax flip. Great candidate when live volume agrees.
                  </p>
                </div>
                <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3">
                  <div className="font-bold text-amber-200">Moderate (55–74%)</div>
                  <p className="mt-1 text-[11px] text-zinc-300">
                    Decent edge, but double-check the chart and Buy/Sell volume bars before committing big GP.
                  </p>
                </div>
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3">
                  <div className="font-bold text-rose-300">Weak (&lt; 55%)</div>
                  <p className="mt-1 text-[11px] text-zinc-300">
                    Thin spread, choppy trend, or poor historical follow-through on that horizon.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-white/[0.08] bg-[#0e0e13] p-4 space-y-1.5">
                <div className="font-bold text-zinc-100">Safety Gate & Honest Limits</div>
                <p className="text-zinc-400">
                  The model automatically retrains daily in an isolated background worker and must pass{' '}
                  <strong className="text-zinc-200">3-fold walk-forward validation (12h embargo)</strong> before{' '}
                  <strong className="text-zinc-200">ML Boost</strong> unlocks. AI cannot foresee unannounced Jagex game
                  updates or sudden clan dumps — always treat it as a powerful filter alongside live volume and charts.
                </p>
              </div>
            </div>
          )}

          {tab === 'glossary' && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter terms (e.g. OFI, VWAP, AUC, tax, alch, z-score)..."
                  className="w-full rounded-xl border border-white/[0.1] bg-[#060608] py-2 pl-9 pr-3 text-xs text-zinc-100 outline-none focus:border-white/25"
                />
              </div>

              <div className="space-y-2">
                {filteredGlossary.map((g) => (
                  <div
                    key={g.term}
                    className="rounded-xl border border-white/[0.07] bg-[#0e0e13] p-3.5 space-y-1"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-zinc-100">{g.term}</span>
                      <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                        {g.category}
                      </span>
                    </div>
                    <div className="text-[11px] font-medium text-amber-300/90">{g.short}</div>
                    <p className="text-[11px] text-zinc-400">{g.detail}</p>
                  </div>
                ))}
                {filteredGlossary.length === 0 && (
                  <div className="py-6 text-center text-zinc-500">No glossary entries match "{search}".</div>
                )}
              </div>
            </div>
          )}

          {tab === 'rules' && (
            <div className="space-y-3">
              <div className="rounded-xl border border-white/[0.08] bg-[#0e0e13] p-4 space-y-2">
                <div className="font-bold text-zinc-100">Exact OSRS Grand Exchange Tax (May 2025+)</div>
                <ul className="list-disc list-inside space-y-1 text-zinc-400">
                  <li>
                    <strong className="text-zinc-200">Standard rate:</strong> 2% of the sell price, rounded down per
                    unit (deducted from seller).
                  </li>
                  <li>
                    <strong className="text-zinc-200">Under 50 gp:</strong> 0 gp tax (cheap bulk runes, arrows, vials).
                  </li>
                  <li>
                    <strong className="text-zinc-200">5M Cap (≥ 250M gp):</strong> Tax caps at exactly{' '}
                    <strong className="text-amber-300">5,000,000 gp</strong> per item on mega-rares (e.g. a 1.6B Twisted
                    bow pays 5M tax — only ~0.31% effective!).
                  </li>
                  <li>
                    <strong className="text-zinc-200">41 Tax-Exempt Items:</strong> Old School Bonds, Lobsters, low-tier
                    teleports, Ring of dueling, Games necklace, and beginner gear pay{' '}
                    <strong className="text-emerald-400">0% tax</strong>.
                  </li>
                </ul>
              </div>

              <div className="rounded-xl border border-white/[0.08] bg-[#0e0e13] p-4 space-y-2">
                <div className="font-bold text-zinc-100">Anti-Trap Manipulation Flags</div>
                <ul className="list-disc list-inside space-y-1 text-zinc-400">
                  <li>
                    <strong className="text-zinc-200">STALE_QUOTE:</strong> No instant trade recorded in &gt; 30 mins.
                  </li>
                  <li>
                    <strong className="text-zinc-200">LOW_LIQUIDITY / THIN_MANIPULATION_RISK:</strong> Too few trades
                    per hour — easy to get stuck holding the bag.
                  </li>
                  <li>
                    <strong className="text-zinc-200">INVERTED_SPREAD / OUTLIER_SPREAD:</strong> Current bid/ask is
                    abnormal vs. 24h VWAP.
                  </li>
                  <li>
                    <strong className="text-zinc-200">FALLING_KNIFE:</strong> Heavy sustained sell pressure with no
                    support yet — avoid overnight holds.
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer Signature */}
        <div className="flex items-center justify-between border-t border-white/[0.07] bg-[#07070a] px-5 py-2.5 text-[11px] text-zinc-500">
          <span>
            <strong className="font-semibold tracking-wider uppercase text-zinc-400">{BRAND_NAME}</strong> · {BRAND_SUBTITLE}
          </span>
          <a
            href={BRAND_REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-zinc-400 transition hover:text-amber-300"
          >
            {BRAND_SIGNATURE}
          </a>
        </div>
      </div>
    </div>
  );
}
