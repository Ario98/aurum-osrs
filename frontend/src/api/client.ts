import type {
  ActiveSlot,
  AlertItem,
  ArbitrageSummary,
  ChartPoint,
  ItemMetrics,
  JournalResponse,
  MarketStatus,
  OvernightResponse,
  OvernightStyle,
  ScannerPreset,
  StrategyMode,
  TradeCallsResponse,
  UserSettings,
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
  tradeCalls: (params: {
    cash_stack: number;
    free_slots?: number;
    mode: StrategyMode;
    members: boolean;
    min_safety?: number;
    count?: number;
  }) => {
    const q = new URLSearchParams();
    q.set('cash_stack', String(params.cash_stack));
    if (params.free_slots) q.set('free_slots', String(params.free_slots));
    q.set('mode', params.mode);
    q.set('members', String(params.members));
    if (params.min_safety !== undefined) q.set('min_safety', String(params.min_safety));
    if (params.count !== undefined) q.set('count', String(params.count));
    return request<TradeCallsResponse>(`/api/market/trade-calls?${q.toString()}`);
  },
  overnightFlips: (params: {
    cash_stack: number;
    slots: number;
    style: OvernightStyle;
    members: boolean;
    count?: number;
  }) => {
    const q = new URLSearchParams();
    q.set('cash_stack', String(params.cash_stack));
    q.set('slots', String(params.slots));
    q.set('style', params.style);
    q.set('members', String(params.members));
    if (params.count !== undefined) q.set('count', String(params.count));
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
  itemChart: (id: number, timestep: '5m' | '1h' | '6h' | '24h') =>
    request<{ item_id: number; timestep: string; source: string; points: ChartPoint[] }>(
      `/api/market/items/${id}/chart?timestep=${timestep}`,
    ),

  // Arbitrage
  arbitrageSummary: (members: boolean) =>
    request<ArbitrageSummary>(`/api/arbitrage/summary?members=${members}`),

  // Slots & Journal
  slots: () => request<{ used_slots: number; free_slots: number; slots: ActiveSlot[] }>('/api/slots'),
  startSlot: (body: {
    slot_number?: number;
    item_id: number;
    item_name: string;
    status?: 'BUYING' | 'BOUGHT' | 'SELLING';
    quantity: number;
    buy_price: number;
    target_sell_price: number;
  }) =>
    request<ActiveSlot>('/api/slots', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateSlot: (
    slotNumber: number,
    body: {
      status?: 'BUYING' | 'BOUGHT' | 'SELLING';
      quantity?: number;
      buy_price?: number;
      target_sell_price?: number;
    },
  ) =>
    request<ActiveSlot>(`/api/slots/${slotNumber}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  completeSlot: (slotNumber: number, body: { sell_price?: number; quantity?: number } = {}) =>
    request<{ net_profit: number; tax_paid: number; roi_pct: number }>(
      `/api/slots/${slotNumber}/complete`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    ),
  deleteSlot: (slotNumber: number) =>
    request<{ deleted: boolean }>(`/api/slots/${slotNumber}`, { method: 'DELETE' }),
  journal: (limit = 100) => request<JournalResponse>(`/api/journal?limit=${limit}`),

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
};
