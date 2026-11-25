import type {
  AlertItem,
  ArbitrageSummary,
  ChartPoint,
  ItemMetrics,
  MarketStatus,
  MLStatusResponse,
  OvernightResponse,
  OvernightStyle,
  ScannerPreset,
  StrategyMode,
  SystemHealthResponse,
  TradeCallsResponse,
  UserSettings,
  WatchlistItem,
} from '../types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      const parsed = JSON.parse(text);
      msg = parsed.detail || text;
    } catch {
      // plain text
    }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // Auth
  authStatus: () => request<{ auth_required: boolean; authenticated: boolean }>('/api/auth/status'),
  login: (password: string) =>
    request<{ authenticated: boolean }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  logout: () => request<{ authenticated: boolean }>('/api/auth/logout', { method: 'POST' }),

  // Market
  marketStatus: () => request<MarketStatus>('/api/market/status'),
  refreshMarket: () =>
    request<{ ok: boolean; fetched: boolean; timestamp: number; recompute_ms: number; items_count: number }>(
      '/api/market/refresh',
      { method: 'POST' },
    ),
  tradeCalls: (params: {
    cash_stack: number;
    free_slots?: number;
    mode: StrategyMode;
    members: boolean;
    min_safety?: number;
    count?: number;
    ml_boost?: boolean;
  }) => {
    const q = new URLSearchParams();
    q.set('cash_stack', String(params.cash_stack));
    if (params.free_slots) q.set('free_slots', String(params.free_slots));
    q.set('mode', params.mode);
    q.set('members', String(params.members));
    if (params.min_safety !== undefined) q.set('min_safety', String(params.min_safety));
    if (params.count !== undefined) q.set('count', String(params.count));
    if (params.ml_boost !== undefined) q.set('ml_boost', String(params.ml_boost));
    return request<TradeCallsResponse>(`/api/market/trade-calls?${q.toString()}`);
  },
  overnightFlips: (params: {
    cash_stack: number;
    slots: number;
    style: OvernightStyle;
    members: boolean;
    count?: number;
    ml_boost?: boolean;
  }) => {
    const q = new URLSearchParams();
    q.set('cash_stack', String(params.cash_stack));
    q.set('slots', String(params.slots));
    q.set('style', params.style);
    q.set('members', String(params.members));
    if (params.count !== undefined) q.set('count', String(params.count));
    if (params.ml_boost !== undefined) q.set('ml_boost', String(params.ml_boost));
    return request<OvernightResponse>(`/api/market/overnight?${q.toString()}`);
  },
  scanner: (params: {
    q?: string;
    preset?: ScannerPreset;
    members?: boolean;
    min_price?: number;
    max_price?: number;
    min_vol_24h?: number;
    min_roi?: number;
    min_safety?: number;
    hide_stale?: boolean;
    sort_by?: string;
    sort_dir?: 'asc' | 'desc';
    limit?: number;
  }) => {
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '' && v !== null) sp.set(k, String(v));
    });
    return request<{ total_matched: number; recompute_ms: number; items: ItemMetrics[] }>(
      `/api/market/scanner?${sp.toString()}`,
    );
  },
  itemDetail: (id: number) => request<ItemMetrics>(`/api/market/items/${id}`),
  itemChart: (id: number, window: 'live' | '6h' | '24h' | '7d' | '30d' | '90d' | '1y') =>
    request<{
      item_id: number;
      timestep: string;
      window?: string;
      window_seconds?: number | null;
      source: string;
      points: ChartPoint[];
    }>(`/api/market/items/${id}/chart?window=${window}`),

  // Arbitrage
  arbitrageSummary: (members: boolean) =>
    request<ArbitrageSummary>(`/api/arbitrage/summary?members=${members}`),

  // Settings & Alerts
  settings: () => request<UserSettings>('/api/settings'),
  saveSettings: (body: Partial<UserSettings>) =>
    request<UserSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  alerts: (limit = 50) => request<{ alerts: AlertItem[] }>(`/api/alerts?limit=${limit}`),
  testDiscord: (webhook_url?: string) =>
    request<{ ok: boolean }>('/api/alerts/test-discord', {
      method: 'POST',
      body: JSON.stringify({ webhook_url: webhook_url || undefined }),
    }),

  // Watchlist
  watchlist: () => request<{ items: WatchlistItem[] }>('/api/watchlist'),
  upsertWatchlist: (body: {
    item_id: number;
    item_name?: string;
    buy_below?: number | null;
    sell_above?: number | null;
    min_net_margin?: number | null;
    discord_notify?: boolean;
    notes?: string;
  }) =>
    request<WatchlistItem>('/api/watchlist', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteWatchlist: (itemId: number) =>
    request<{ deleted: boolean }>(`/api/watchlist/${itemId}`, { method: 'DELETE' }),

  // System & Data Health
  systemHealth: (fresh = false) =>
    request<SystemHealthResponse>(`/api/system/health${fresh ? '?fresh=true' : ''}`),
  actionRollup: () =>
    request<{ ok: boolean; rolled_24h_rows: number; seasonality_items: number; recompute_ms: number; elapsed_ms: number }>(
      '/api/system/actions/rollup',
      { method: 'POST' },
    ),
  actionFillGaps: () =>
    request<{ ok: boolean; status: string; message: string; filled_5m: number; filled_1h: number; remaining_1h: number }>(
      '/api/system/actions/fill-gaps',
      { method: 'POST' },
    ),
  actionCheckpoint: () =>
    request<{ ok: boolean; busy: number; log_frames: number; checkpointed_frames: number }>(
      '/api/system/actions/checkpoint',
      { method: 'POST' },
    ),
  actionBackupDb: () =>
    request<{ ok: boolean; filename: string; size_mb: number; elapsed_ms: number; pruned: number; total_backups: number }>(
      '/api/system/actions/backup',
      { method: 'POST' },
    ),
  actionBackfillHistory: (days: number) =>
    request<{
      ok: boolean;
      started: boolean;
      status: string;
      target_days: number;
      missing_buckets: number;
      est_minutes?: number;
      message: string;
    }>('/api/system/actions/backfill', {
      method: 'POST',
      body: JSON.stringify({ days }),
    }),

  // Phase 5 ML & Walk-Forward Backtest
  mlStatus: () => request<MLStatusResponse>('/api/ml/status'),
  mlTrain: () => request<{ started: boolean; status: string; message: string }>('/api/ml/train', { method: 'POST' }),
};
