import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  Bell,
  BookOpen,
  ChevronDown,
  Coins,
  FlaskConical,
  HelpCircle,
  Lock,
  LogOut,
  Moon,
  Search,
  Settings as SettingsIcon,
  Star,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import { api } from './api/client';
import { AlertDrawer, AlertToastStack } from './components/AlertToast';
import {
  AurumMark,
  AurumWordmark,
  BRAND_NAME,
  BRAND_REPO_URL,
  BRAND_SIGNATURE,
  BRAND_SUBTITLE,
} from './components/AurumLogo';
import { CommandPalette } from './components/CommandPalette';
import { HelpModal } from './components/HelpModal';
import { ItemModal } from './components/ItemModal';
import { SlotRibbon } from './components/SlotRibbon';
import { useMarketSocket } from './hooks/useMarketSocket';
import { Arbitrage } from './pages/Arbitrage';
import { CommandCenter } from './pages/CommandCenter';
import { Journal } from './pages/Journal';
import { Overnight } from './pages/Overnight';
import { Scanner } from './pages/Scanner';
import { Settings, type SettingsSubTab } from './pages/Settings';
import { Watchlist } from './pages/Watchlist';
import type {
  ActiveSlot,
  AlertItem,
  ItemMetrics,
  MarketStatus,
  OvernightFlip,
  StrategyMode,
  TradeCall,
  TradeCallsResponse,
  UserSettings,
} from './types';
import { formatGp, parseGpInput, playAlertChime } from './utils/format';

type NavTab = 'command' | 'overnight' | 'watchlist' | 'scanner' | 'arbitrage' | 'journal' | 'settings';

const BANK_PRESETS = [
  { label: '5M', value: 5_000_000 },
  { label: '25M', value: 25_000_000 },
  { label: '100M', value: 100_000_000 },
  { label: '500M', value: 500_000_000 },
  { label: '1B', value: 1_000_000_000 },
];

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [activeTab, setActiveTab] = useState<NavTab>('command');
  const [settingsSubTab, setSettingsSubTab] = useState<SettingsSubTab>('general');
  const [status, setStatus] = useState<MarketStatus | null>(null);

  // User trading state
  const [cashStack, setCashStack] = useState(25_000_000);
  const [cashMenuOpen, setCashMenuOpen] = useState(false);
  const [cashDraft, setCashDraft] = useState('25.00M');
  const cashMenuRef = useRef<HTMLDivElement | null>(null);

  const [mode, setMode] = useState<StrategyMode>('auto_mix');
  const [members, setMembers] = useState(true);
  const [mlBoost, setMlBoost] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const [tradeData, setTradeData] = useState<TradeCallsResponse | null>(null);
  const [loadingTrades, setLoadingTrades] = useState(false);
  const [slots, setSlots] = useState<ActiveSlot[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [toasts, setToasts] = useState<AlertItem[]>([]);
  const [alertDrawerOpen, setAlertDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);

  const [tickVersion, setTickVersion] = useState(0);
  const [slotsVersion, setSlotsVersion] = useState(0);
  const [watchlistVersion, setWatchlistVersion] = useState(0);
  const [starredIds, setStarredIds] = useState<Set<number>>(new Set());

  // Global Ctrl+K / Cmd+K shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Close bank popover on outside click
  useEffect(() => {
    if (!cashMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (cashMenuRef.current && !cashMenuRef.current.contains(e.target as Node)) {
        setCashMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [cashMenuOpen]);

  useEffect(() => {
    setCashDraft(formatGp(cashStack, true));
  }, [cashStack]);

  useEffect(() => {
    api
      .authStatus()
      .then((res) => {
        setAuthRequired(res.auth_required);
        setAuthenticated(res.authenticated);
      })
      .finally(() => setAuthChecked(true));
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.marketStatus());
    } catch {
      // ignore transient errors
    }
  }, []);

  const refreshSlots = useCallback(async () => {
    try {
      const res = await api.slots();
      setSlots(res.slots);
      setSlotsVersion((v) => v + 1);
    } catch {
      // ignore
    }
  }, []);

  const refreshTradeCalls = useCallback(async () => {
    setLoadingTrades(true);
    try {
      const res = await api.tradeCalls({ cash_stack: cashStack, mode, members, count: 12, ml_boost: mlBoost });
      setTradeData(res);
    } catch {
      // ignore
    } finally {
      setLoadingTrades(false);
    }
  }, [cashStack, mode, members, mlBoost]);

  const refreshAlerts = useCallback(async () => {
    try {
      const res = await api.alerts(50);
      setAlerts(res.alerts);
    } catch {
      // ignore
    }
  }, []);

  const refreshWatchlistIds = useCallback(async () => {
    try {
      const res = await api.watchlist();
      setStarredIds(new Set(res.items.map((w) => w.item_id)));
      setWatchlistVersion((v) => v + 1);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    api.settings().then((s) => {
      setCashStack(s.cash_stack);
      setMembers(s.members);
      setMode(s.default_mode);
      setSoundEnabled(s.sound_enabled);
    });
    refreshStatus();
    refreshSlots();
    refreshAlerts();
    refreshWatchlistIds();
  }, [authenticated, refreshStatus, refreshSlots, refreshAlerts, refreshWatchlistIds]);

  useEffect(() => {
    if (!authenticated || status?.ready) return;
    const id = window.setInterval(refreshStatus, 3000);
    return () => window.clearInterval(id);
  }, [authenticated, status?.ready, refreshStatus]);

  useEffect(() => {
    if (!authenticated) return;
    refreshTradeCalls();
  }, [authenticated, refreshTradeCalls, tickVersion, slotsVersion]);

  const { connected } = useMarketSocket(authenticated, {
    onMarketTick: () => {
      setTickVersion((v) => v + 1);
      refreshStatus();
      refreshSlots();
    },
    onSlotsUpdated: () => {
      refreshSlots();
    },
    onBootstrapUpdate: () => {
      refreshStatus();
      setTickVersion((v) => v + 1);
    },
    onAlert: (alert) => {
      setAlerts((prev) => [alert, ...prev.slice(0, 49)]);
      setToasts((prev) => [alert, ...prev.slice(0, 3)]);
      if (soundEnabled) {
        playAlertChime(alert.severity);
      }
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== alert.id));
      }, 9000);
    },
  });

  const updateCash = (val: number) => {
    setCashStack(val);
    setCashMenuOpen(false);
    api.saveSettings({ cash_stack: val }).catch(() => {});
  };

  const commitCashDraft = () => {
    const parsed = parseGpInput(cashDraft);
    if (parsed && parsed >= 10_000) {
      updateCash(parsed);
    } else {
      setCashDraft(formatGp(cashStack, true));
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    try {
      await api.login(password);
      setAuthenticated(true);
      setPassword('');
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  const handleStartFlip = async (call: TradeCall) => {
    await api.startSlot({
      item_id: call.item_id,
      item_name: call.item_name,
      status: 'BUYING',
      quantity: call.quantity,
      buy_price: call.buy_price,
      target_sell_price: call.sell_price,
      flip_mode: call.strategy === 'overnight' ? 'overnight' : 'active',
    });
    await refreshSlots();
  };

  const handleStartCustomFlip = async (params: {
    item_id: number;
    item_name: string;
    quantity: number;
    buy_price: number;
    target_sell_price: number;
    flip_mode: 'active' | 'overnight';
  }) => {
    await api.startSlot({
      ...params,
      status: 'BUYING',
    });
    await refreshSlots();
  };

  const handleStartOvernightFlip = async (flip: OvernightFlip) => {
    await api.startSlot({
      item_id: flip.item_id,
      item_name: flip.item_name,
      status: 'BUYING',
      quantity: flip.quantity,
      buy_price: flip.buy_price,
      target_sell_price: flip.sell_price,
      flip_mode: 'overnight',
    });
    await refreshSlots();
  };

  const handleToggleStar = async (item: ItemMetrics) => {
    if (starredIds.has(item.id)) {
      await api.deleteWatchlist(item.id);
    } else {
      await api.upsertWatchlist({
        item_id: item.id,
        item_name: item.name,
        buy_below: item.low ? Math.max(1, Math.round(item.low * 0.97)) : null,
        discord_notify: true,
      });
    }
    await refreshWatchlistIds();
  };

  const handleSettingsSaved = (s: UserSettings) => {
    setCashStack(s.cash_stack);
    setMembers(s.members);
    setMode(s.default_mode);
    setSoundEnabled(s.sound_enabled);
  };

  if (!authChecked) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#050507] text-sm text-zinc-500">
        <AurumMark className="h-11 w-11 animate-pulse" />
        <span>Connecting to {BRAND_NAME}...</span>
      </div>
    );
  }

  if (authRequired && !authenticated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#050507] p-4">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-sm rounded-2xl border border-white/[0.1] bg-[#0c0c0f] p-6 shadow-2xl space-y-4"
        >
          <div className="flex items-center gap-3">
            <AurumMark className="h-11 w-11 shrink-0 shadow-[0_0_24px_rgba(245,158,11,0.18)] rounded-xl" />
            <div>
              <div className="flex items-center gap-2">
                <AurumWordmark size="md" />
              </div>
              <p className="text-xs text-zinc-500">{BRAND_SUBTITLE} · Private access</p>
            </div>
          </div>

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            className="w-full rounded-xl border border-white/[0.1] bg-[#060608] px-3.5 py-2.5 text-sm text-zinc-100 outline-none focus:border-amber-400/40"
          />
          {loginError && <p className="text-xs text-rose-400">{loginError}</p>}
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-300 to-amber-400 py-2.5 text-sm font-bold text-zinc-950 transition hover:from-amber-200 hover:to-amber-300"
          >
            <Lock className="h-3.5 w-3.5" />
            Unlock {BRAND_NAME}
          </button>
        </form>
        <a
          href={BRAND_REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-5 text-[11px] text-zinc-600 transition hover:text-amber-300/80"
        >
          {BRAND_NAME} · {BRAND_SIGNATURE}
        </a>
      </div>
    );
  }

  const navItems: { key: NavTab; label: string; shortLabel: string; icon: React.ReactNode }[] = [
    { key: 'command', label: 'Trade Calls', shortLabel: 'Trade', icon: <Zap className="h-[18px] w-[18px]" /> },
    { key: 'overnight', label: 'Overnight', shortLabel: 'Night', icon: <Moon className="h-[18px] w-[18px]" /> },
    { key: 'watchlist', label: 'Watchlist & Alerts', shortLabel: 'Watch', icon: <Star className="h-[18px] w-[18px]" /> },
    { key: 'scanner', label: 'Market Scanner', shortLabel: 'Scan', icon: <Search className="h-[18px] w-[18px]" /> },
    { key: 'arbitrage', label: 'Arbitrage', shortLabel: 'Arb', icon: <FlaskConical className="h-[18px] w-[18px]" /> },
    { key: 'journal', label: 'Journal & Limits', shortLabel: 'Journal', icon: <BookOpen className="h-[18px] w-[18px]" /> },
    { key: 'settings', label: 'Settings & System', shortLabel: 'Settings', icon: <SettingsIcon className="h-[18px] w-[18px]" /> },
  ];

  return (
    <div className="min-h-screen text-zinc-100 flex">
      {/* Desktop Slim Left Icon Rail */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 z-40 w-[68px] flex-col items-center justify-between border-r border-white/[0.07] bg-[#07070a]/95 py-3.5 backdrop-blur-xl">
        <div className="flex flex-col items-center gap-5 w-full px-2">
          {/* Logo Mark */}
          <button
            onClick={() => setActiveTab('command')}
            className="group flex h-10 w-10 items-center justify-center rounded-xl shadow-[0_0_24px_rgba(245,158,11,0.16)] transition hover:scale-105 hover:shadow-[0_0_28px_rgba(245,158,11,0.3)]"
            title={`${BRAND_NAME} — ${BRAND_SUBTITLE}`}
          >
            <AurumMark className="h-10 w-10" />
          </button>

          {/* Navigation Icons */}
          <nav className="flex flex-col items-center gap-1.5 w-full">
            {navItems.map((n) => {
              const active = activeTab === n.key;
              return (
                <button
                  key={n.key}
                  onClick={() => setActiveTab(n.key)}
                  title={n.label}
                  className={`group relative flex h-11 w-full flex-col items-center justify-center gap-0.5 rounded-xl transition ${
                    active
                      ? 'bg-white/[0.1] text-white'
                      : 'text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200'
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-2.5 bottom-2.5 w-[2.5px] rounded-r-full bg-amber-400" />
                  )}
                  {n.icon}
                  <span className="text-[9px] font-medium leading-none">{n.shortLabel}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Utility Icons */}
        <div className="flex flex-col items-center gap-2 px-2 w-full">
          <button
            onClick={() => {
              setActiveTab('settings');
              setSettingsSubTab('health');
            }}
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/[0.06] transition"
            title={
              !connected
                ? 'Offline — click for System & Data Health'
                : status?.health_status === 'degraded'
                  ? `Degraded: ${status.health_issues?.join(' · ') || 'Check System Health'}`
                  : status?.ready
                    ? `Live · ${status.items_tracked.toLocaleString()} items · ${status.last_recompute_ms}ms (click for Data Health)`
                    : 'Bootstrapping...'
            }
          >
            <span
              className={`h-2 w-2 rounded-full ${
                !connected
                  ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]'
                  : status?.health_status === 'degraded'
                    ? 'bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.8)]'
                    : status?.ready
                      ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]'
                      : 'bg-amber-400 animate-pulse'
              }`}
            />
          </button>
          {authRequired && (
            <button
              onClick={async () => {
                await api.logout();
                setAuthenticated(false);
              }}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-500 hover:bg-white/[0.05] hover:text-rose-400"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex flex-1 flex-col md:pl-[68px] min-w-0 pb-16 md:pb-0">
        {/* Persistent Top Command Bar */}
        <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-[#060609]/85 backdrop-blur-xl">
          <div className="mx-auto flex h-14 max-w-[1520px] items-center justify-between gap-3 px-4">
            {/* Left: Brand Wordmark + Ctrl+K Instant Search Trigger */}
            <div className="flex flex-1 min-w-0 items-center gap-3">
              <button
                onClick={() => setActiveTab('command')}
                className="flex shrink-0 items-center gap-2 rounded-lg py-1 pr-1 text-left transition hover:opacity-90"
                title={`${BRAND_NAME} — ${BRAND_SUBTITLE}`}
              >
                <AurumMark className="h-7 w-7 md:hidden" />
                <span className="hidden sm:inline-flex items-baseline gap-2">
                  <AurumWordmark size="sm" />
                  <span className="hidden lg:inline h-3 w-px bg-white/[0.1]" aria-hidden="true" />
                </span>
              </button>

              <button
                onClick={() => setPaletteOpen(true)}
                className="flex flex-1 max-w-md items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#0c0c10] px-3.5 py-2 text-xs text-zinc-400 hover:border-white/[0.16] hover:text-zinc-200 transition"
              >
                <span className="flex items-center gap-2 truncate">
                  <Search className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                  <span className="truncate">
                    Search {status?.items_tracked ? status.items_tracked.toLocaleString() : '4,682'} OSRS items...
                  </span>
                </span>
                <kbd className="hidden sm:inline-flex items-center rounded-md border border-white/[0.1] bg-black/50 px-1.5 py-0.5 text-[10px] font-mono text-zinc-500">
                  Ctrl K
                </kbd>
              </button>
            </div>

            {/* Right: Smart Health Pill, Cash Stack, Members Toggle, Alerts */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Clickable Smart Health Status Pill -> Settings > System & Data Health */}
              <button
                onClick={() => {
                  setActiveTab('settings');
                  setSettingsSubTab('health');
                }}
                className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                  !connected
                    ? 'border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/15'
                    : status?.health_status === 'degraded'
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15'
                      : 'border-white/[0.08] bg-[#0c0c10] text-zinc-300 hover:border-white/[0.18]'
                }`}
                title={
                  !connected
                    ? 'WebSocket disconnected — click to inspect System & Data Health'
                    : status?.health_status === 'degraded'
                      ? `Degraded: ${status.health_issues?.join(' · ') || 'Check System Health'}`
                      : 'System & Data Health (click to open)'
                }
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    !connected
                      ? 'bg-rose-400'
                      : status?.health_status === 'degraded'
                        ? 'bg-amber-400 animate-pulse'
                        : status?.ready
                          ? 'bg-emerald-400'
                          : 'bg-amber-400 animate-pulse'
                  }`}
                />
                <span className="hidden sm:inline">
                  {!connected
                    ? 'Offline'
                    : status?.health_status === 'degraded'
                      ? 'Degraded'
                      : status?.ready
                        ? `Live · ${Math.round(status.last_recompute_ms)}ms`
                        : 'Syncing'}
                </span>
              </button>

              {/* Cash Stack Popover */}
              <div className="relative" ref={cashMenuRef}>
                <button
                  onClick={() => setCashMenuOpen((o) => !o)}
                  className="flex items-center gap-1.5 rounded-xl border border-white/[0.09] bg-[#0c0c10] px-3 py-1.5 text-xs hover:border-white/[0.18] transition"
                >
                  <Coins className="h-3.5 w-3.5 text-amber-400" />
                  <span className="font-bold text-zinc-100 font-mono-num">{formatGp(cashStack, true)}</span>
                  <ChevronDown className="h-3 w-3 text-zinc-500" />
                </button>

                {cashMenuOpen && (
                  <div className="absolute right-0 mt-2 w-60 rounded-2xl border border-white/[0.12] bg-[#0d0d12] p-3.5 shadow-2xl space-y-3 z-50">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                      Flipping Cash Stack
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        value={cashDraft}
                        onChange={(e) => setCashDraft(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && commitCashDraft()}
                        className="flex-1 rounded-lg border border-white/[0.1] bg-[#060608] px-2.5 py-1.5 text-xs font-bold text-zinc-100 font-mono-num outline-none focus:border-white/30"
                        placeholder="e.g. 50M"
                      />
                      <button
                        onClick={commitCashDraft}
                        className="rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs font-bold text-zinc-950 hover:bg-white"
                      >
                        Set
                      </button>
                    </div>
                    <div className="grid grid-cols-5 gap-1">
                      {BANK_PRESETS.map((p) => (
                        <button
                          key={p.label}
                          onClick={() => updateCash(p.value)}
                          className={`rounded-lg py-1 text-[11px] font-semibold transition ${
                            cashStack === p.value
                              ? 'bg-amber-400 text-zinc-950'
                              : 'bg-white/[0.05] text-zinc-400 hover:bg-white/[0.1] hover:text-white'
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Members / F2P Toggle */}
              <button
                onClick={() => {
                  const next = !members;
                  setMembers(next);
                  api.saveSettings({ members: next }).catch(() => {});
                }}
                className={`hidden sm:flex items-center rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                  members
                    ? 'border-white/[0.08] bg-[#0c0c10] text-zinc-300 hover:border-white/[0.18]'
                    : 'border-sky-500/35 bg-sky-500/10 text-sky-300 hover:bg-sky-500/15'
                }`}
                title={
                  members
                    ? 'Members (P2P · 8 GE slots) — click to switch to F2P'
                    : 'Free-to-Play (F2P · 3 GE slots) — click to switch to P2P'
                }
              >
                {members ? 'P2P' : 'F2P'}
              </button>

              {/* Sound Chime */}
              <button
                onClick={() => setSoundEnabled((s) => !s)}
                className="rounded-xl border border-white/[0.08] bg-[#0c0c10] p-2 text-zinc-400 hover:text-zinc-100"
                title={soundEnabled ? 'Mute alert chime' : 'Enable alert chime'}
              >
                {soundEnabled ? <Volume2 className="h-3.5 w-3.5 text-emerald-400" /> : <VolumeX className="h-3.5 w-3.5" />}
              </button>

              {/* Guide & Glossary Help Modal */}
              <button
                onClick={() => setHelpOpen(true)}
                className="rounded-xl border border-white/[0.08] bg-[#0c0c10] p-2 text-zinc-400 hover:border-white/[0.18] hover:text-amber-300 transition"
                title="Guide & Trading Glossary"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </button>

              {/* Alerts Bell */}
              <button
                onClick={() => setAlertDrawerOpen(true)}
                className="relative rounded-xl border border-white/[0.08] bg-[#0c0c10] p-2 text-zinc-300 hover:text-white"
                title="Alerts Feed"
              >
                <Bell className="h-3.5 w-3.5" />
                {alerts.length > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-bold text-zinc-950">
                    {Math.min(99, alerts.length)}
                  </span>
                )}
              </button>
            </div>
          </div>
        </header>

        {/* Persistent Live GE Slot Ribbon (8 slots P2P, 3 slots F2P) */}
        <SlotRibbon
          slots={slots}
          maxSlots={members ? 8 : 3}
          onUpdateSlot={async (slotNum, updates) => {
            await api.updateSlot(slotNum, updates);
            await refreshSlots();
          }}
          onCompleteSlot={async (slotNum, sellPrice) => {
            await api.completeSlot(slotNum, { sell_price: sellPrice });
            await refreshSlots();
          }}
          onClearSlot={async (slotNum) => {
            await api.deleteSlot(slotNum);
            await refreshSlots();
          }}
          onOpenChart={setSelectedItemId}
        />

        {/* Fast Bootstrap Banner */}
        {status && !status.ready && (
          <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-200 flex items-center justify-center gap-2">
            <Activity className="h-3.5 w-3.5 animate-spin text-amber-400" />
            <span>
              Fast bootstrap ({status.bootstrap.stage}) — 1h: <strong>{status.bootstrap.buckets_1h_loaded}</strong>, 5m:{' '}
              <strong>{status.bootstrap.buckets_5m_loaded}</strong>
            </span>
          </div>
        )}

        {/* Main Workspace Canvas */}
        <main className="mx-auto w-full max-w-[1520px] flex-1 px-4 py-6">
          {activeTab === 'command' && (
            <CommandCenter
              cashStack={cashStack}
              mode={mode}
              onChangeMode={setMode}
              mlBoost={mlBoost}
              onToggleMlBoost={() => setMlBoost((b) => !b)}
              tradeData={tradeData}
              slotsFull={slots.length >= (members ? 8 : 3)}
              loading={loadingTrades}
              onRefresh={refreshTradeCalls}
              onStartFlip={handleStartFlip}
              onOpenChart={setSelectedItemId}
              onOpenMlLab={() => {
                setActiveTab('settings');
                setSettingsSubTab('ml');
              }}
            />
          )}

          {activeTab === 'overnight' && (
            <Overnight
              cashStack={cashStack}
              members={members}
              mlBoost={mlBoost}
              onToggleMlBoost={() => setMlBoost((b) => !b)}
              slotsFull={slots.length >= (members ? 8 : 3)}
              tickVersion={tickVersion}
              slotsVersion={slotsVersion}
              onStartOvernight={handleStartOvernightFlip}
              onOpenChart={setSelectedItemId}
              onOpenMlLab={() => {
                setActiveTab('settings');
                setSettingsSubTab('ml');
              }}
            />
          )}

          {activeTab === 'watchlist' && (
            <Watchlist
              tickVersion={tickVersion}
              watchlistVersion={watchlistVersion}
              onWatchlistChanged={refreshWatchlistIds}
              onOpenChart={setSelectedItemId}
            />
          )}

          {activeTab === 'scanner' && (
            <Scanner members={members} tickVersion={tickVersion} onOpenChart={setSelectedItemId} />
          )}

          {activeTab === 'arbitrage' && (
            <Arbitrage members={members} tickVersion={tickVersion} onOpenChart={setSelectedItemId} />
          )}

          {activeTab === 'journal' && (
            <Journal slotsVersion={slotsVersion} onOpenChart={setSelectedItemId} />
          )}

          {activeTab === 'settings' && (
            <Settings
              activeSubTab={settingsSubTab}
              onChangeSubTab={setSettingsSubTab}
              onSettingsSaved={handleSettingsSaved}
              onModelUpdated={() => setTickVersion((v) => v + 1)}
            />
          )}
        </main>

        {/* Quiet Brand Footer */}
        <footer className="mx-auto w-full max-w-[1520px] px-4 pb-5 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.05] pt-3.5 text-[11px] text-zinc-600">
            <div className="flex items-center gap-2">
              <AurumMark className="h-4 w-4 opacity-85" />
              <span className="font-semibold tracking-[0.08em] uppercase text-zinc-500">{BRAND_NAME}</span>
              <span className="text-zinc-700">·</span>
              <span>{BRAND_SUBTITLE}</span>
            </div>
            <a
              href={BRAND_REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-zinc-500 transition hover:text-amber-300"
            >
              {BRAND_SIGNATURE}
            </a>
          </div>
        </footer>
      </div>

      {/* Mobile / iPhone Fixed Bottom Navigation Bar */}
      <nav className="md:hidden fixed inset-x-0 bottom-0 z-40 grid grid-cols-7 border-t border-white/[0.08] bg-[#07070a]/95 px-1 py-1.5 backdrop-blur-xl">
        {navItems.map((n) => {
          const active = activeTab === n.key;
          return (
            <button
              key={n.key}
              onClick={() => setActiveTab(n.key)}
              className={`flex flex-col items-center justify-center gap-0.5 rounded-lg py-1 text-[10px] font-medium transition ${
                active ? 'text-amber-300' : 'text-zinc-500'
              }`}
            >
              {n.icon}
              <span>{n.shortLabel}</span>
            </button>
          );
        })}
      </nav>

      {/* Modals & Overlays */}
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onSelectItem={setSelectedItemId}
      />
      <ItemModal
        itemId={selectedItemId}
        cashStack={cashStack}
        freeSlots={Math.max(1, (members ? 8 : 3) - slots.length)}
        slotsFull={slots.length >= (members ? 8 : 3)}
        isStarred={selectedItemId !== null && starredIds.has(selectedItemId)}
        onToggleStar={handleToggleStar}
        onClose={() => setSelectedItemId(null)}
        onStartCustomFlip={handleStartCustomFlip}
      />
      <AlertDrawer
        open={alertDrawerOpen}
        alerts={alerts}
        onClose={() => setAlertDrawerOpen(false)}
        onOpenItem={(id) => {
          setAlertDrawerOpen(false);
          setSelectedItemId(id);
        }}
      />
      <AlertToastStack
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
        onOpenItem={setSelectedItemId}
      />
    </div>
  );
}
