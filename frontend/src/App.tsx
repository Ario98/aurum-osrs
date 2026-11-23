import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Bell,
  BookOpen,
  Coins,
  FlaskConical,
  Lock,
  LogOut,
  Search,
  Settings as SettingsIcon,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import { api } from './api/client';
import { AlertDrawer, AlertToastStack } from './components/AlertToast';
import { ItemModal } from './components/ItemModal';
import { useMarketSocket } from './hooks/useMarketSocket';
import { Arbitrage } from './pages/Arbitrage';
import { CommandCenter } from './pages/CommandCenter';
import { Journal } from './pages/Journal';
import { Scanner } from './pages/Scanner';
import { Settings } from './pages/Settings';
import type {
  ActiveSlot,
  AlertItem,
  MarketStatus,
  StrategyMode,
  TradeCall,
  TradeCallsResponse,
  UserSettings,
} from './types';
import { playAlertChime } from './utils/format';

type NavTab = 'command' | 'scanner' | 'arbitrage' | 'journal' | 'settings';

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [activeTab, setActiveTab] = useState<NavTab>('command');
  const [status, setStatus] = useState<MarketStatus | null>(null);

  // User trading state
  const [cashStack, setCashStack] = useState(25_000_000);
  const [mode, setMode] = useState<StrategyMode>('auto_mix');
  const [members, setMembers] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const [tradeData, setTradeData] = useState<TradeCallsResponse | null>(null);
  const [loadingTrades, setLoadingTrades] = useState(false);
  const [slots, setSlots] = useState<ActiveSlot[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [toasts, setToasts] = useState<AlertItem[]>([]);
  const [alertDrawerOpen, setAlertDrawerOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);

  const [tickVersion, setTickVersion] = useState(0);
  const [slotsVersion, setSlotsVersion] = useState(0);

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
      const res = await api.tradeCalls({ cash_stack: cashStack, mode, members, count: 12 });
      setTradeData(res);
    } catch {
      // ignore
    } finally {
      setLoadingTrades(false);
    }
  }, [cashStack, mode, members]);

  const refreshAlerts = useCallback(async () => {
    try {
      const res = await api.alerts(50);
      setAlerts(res.alerts);
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
  }, [authenticated, refreshStatus, refreshSlots, refreshAlerts]);

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
    });
    await refreshSlots();
  };

  const handleStartCustomFlip = async (params: {
    item_id: number;
    item_name: string;
    quantity: number;
    buy_price: number;
    target_sell_price: number;
  }) => {
    await api.startSlot({
      ...params,
      status: 'BUYING',
    });
    await refreshSlots();
  };

  const handleSettingsSaved = (s: UserSettings) => {
    setCashStack(s.cash_stack);
    setMembers(s.members);
    setMode(s.default_mode);
    setSoundEnabled(s.sound_enabled);
  };

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050507] text-sm text-zinc-500">
        Connecting to OSRS Flip Terminal v2...
      </div>
    );
  }

  if (authRequired && !authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050507] p-4">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-sm rounded-2xl border border-white/[0.1] bg-[#0c0c0f] p-6 shadow-2xl space-y-4"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.1] bg-[#141419] text-amber-400">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-zinc-100">OSRS Flip Terminal v2</h1>
              <p className="text-xs text-zinc-500">Enter your private dashboard password</p>
            </div>
          </div>

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            className="w-full rounded-xl border border-white/[0.1] bg-[#060608] px-3.5 py-2.5 text-sm text-zinc-100 outline-none focus:border-white/30"
          />
          {loginError && <p className="text-xs text-rose-400">{loginError}</p>}
          <button
            type="submit"
            className="w-full rounded-xl bg-zinc-100 py-2.5 text-sm font-bold text-zinc-950 hover:bg-white"
          >
            Unlock Terminal
          </button>
        </form>
      </div>
    );
  }

  const navItems: { key: NavTab; label: string; icon: React.ReactNode }[] = [
    { key: 'command', label: 'Command Center', icon: <Zap className="h-3.5 w-3.5" /> },
    { key: 'scanner', label: 'Scanner (4.6k)', icon: <Search className="h-3.5 w-3.5" /> },
    { key: 'arbitrage', label: 'Arbitrage', icon: <FlaskConical className="h-3.5 w-3.5" /> },
    { key: 'journal', label: 'Journal & Limits', icon: <BookOpen className="h-3.5 w-3.5" /> },
    { key: 'settings', label: 'Settings & Dink', icon: <SettingsIcon className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="min-h-screen bg-[#050507] text-zinc-100 flex flex-col">
      {/* Top Navbar */}
      <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-[#050507]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-zinc-100 text-zinc-950 font-black">
                <Coins className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-bold tracking-tight text-zinc-100 leading-none">
                  OSRS Flip Terminal <span className="text-amber-400">v2</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-500">
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      connected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                    }`}
                  />
                  {status?.ready ? (
                    <span>
                      Live · {status.items_tracked.toLocaleString()} items · {status.last_recompute_ms}ms
                      {!status.enrichment_done && ' · Enriching 7d...'}
                    </span>
                  ) : (
                    <span>Fast bootstrap ({status?.bootstrap.stage || 'starting'})...</span>
                  )}
                </div>
              </div>
            </div>

            <nav className="flex items-center gap-1">
              {navItems.map((n) => (
                <button
                  key={n.key}
                  onClick={() => setActiveTab(n.key)}
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                    activeTab === n.key
                      ? 'bg-white/[0.1] text-white'
                      : 'text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200'
                  }`}
                >
                  {n.icon}
                  <span className="hidden sm:inline">{n.label}</span>
                </button>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setSoundEnabled((s) => !s)}
              className="rounded-xl border border-white/[0.08] bg-[#0c0c0f] p-2 text-zinc-400 hover:text-zinc-100"
              title={soundEnabled ? 'Mute alert chime' : 'Enable alert chime'}
            >
              {soundEnabled ? <Volume2 className="h-4 w-4 text-emerald-400" /> : <VolumeX className="h-4 w-4" />}
            </button>
            <button
              onClick={() => setAlertDrawerOpen(true)}
              className="relative rounded-xl border border-white/[0.08] bg-[#0c0c0f] p-2 text-zinc-300 hover:text-white"
              title="Open Alerts Feed"
            >
              <Bell className="h-4 w-4" />
              {alerts.length > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-bold text-zinc-950">
                  {Math.min(99, alerts.length)}
                </span>
              )}
            </button>
            {authRequired && (
              <button
                onClick={async () => {
                  await api.logout();
                  setAuthenticated(false);
                }}
                className="rounded-xl border border-white/[0.08] bg-[#0c0c0f] p-2 text-zinc-400 hover:text-rose-400"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Fast Bootstrap Banner */}
      {status && !status.ready && (
        <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-200 flex items-center justify-center gap-2">
          <Activity className="h-4 w-4 animate-spin text-amber-400" />
          <span>
            Running 30-second tiered bootstrap ({status.bootstrap.stage}) — 1h buckets:{' '}
            <strong>{status.bootstrap.buckets_1h_loaded}</strong>, 5m buckets:{' '}
            <strong>{status.bootstrap.buckets_5m_loaded}</strong>. Trade calls will populate automatically.
          </span>
        </div>
      )}

      {/* Main Content */}
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-5">
        {activeTab === 'command' && (
          <CommandCenter
            cashStack={cashStack}
            onChangeCashStack={(val) => {
              setCashStack(val);
              api.saveSettings({ cash_stack: val }).catch(() => {});
            }}
            mode={mode}
            onChangeMode={setMode}
            members={members}
            onChangeMembers={(m) => {
              setMembers(m);
              api.saveSettings({ members: m }).catch(() => {});
            }}
            tradeData={tradeData}
            slots={slots}
            loading={loadingTrades}
            onRefresh={refreshTradeCalls}
            onStartFlip={handleStartFlip}
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

        {activeTab === 'settings' && <Settings onSettingsSaved={handleSettingsSaved} />}
      </main>

      {/* Wide Centered Item Modal + Alerts */}
      <ItemModal
        itemId={selectedItemId}
        cashStack={cashStack}
        freeSlots={Math.max(1, 8 - slots.length)}
        slotsFull={slots.length >= 8}
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
