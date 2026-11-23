export type StrategyMode = 'auto_mix' | 'fast_flip' | 'overnight' | 'dump_sniper' | 'alch_floor';
export type ScannerPreset = 'all' | 'fast_flip' | 'overnight' | 'dump_sniper' | 'alch_floor' | 'tax_exempt' | 'mega_rares';

export interface MarketStatus {
  ready: boolean;
  enrichment_done: boolean;
  bootstrap: {
    stage: string;
    fast_done: boolean;
    bg_done: boolean;
    buckets_5m_loaded: number;
    buckets_1h_loaded: number;
    elapsed_sec?: number;
  };
  items_tracked: number;
  last_latest_update: number;
  last_recompute_ms: number;
  nature_rune_price: number;
  total_wiki_requests: number;
}

export interface TradeCall {
  item_id: number;
  item_name: string;
  icon: string;
  members: boolean;
  strategy: StrategyMode;
  action: string;
  buy_price: number;
  sell_price: number;
  quantity: number;
  buy_limit: number;
  capital_required: number;
  tax_per_unit: number;
  total_tax: number;
  net_margin_unit: number;
  est_net_profit: number;
  net_roi_pct: number;
  est_fill_minutes: number;
  est_fill_label: string;
  est_gp_per_hour: number;
  safety_score: number;
  confidence_score: number;
  is_tax_exempt: boolean;
  is_mega_rare_capped: boolean;
  ofi_1h: number;
  zscore_7d: number;
  vol_1h: number;
  vol_24h: number;
  high_age_sec: number | null;
  low_age_sec: number | null;
  reason: string;
  manipulation_flags: string[];
}

export interface TradeCallsResponse {
  cash_stack: number;
  free_slots: number;
  active_slots_count: number;
  mode: StrategyMode;
  members: boolean;
  summary: {
    allocated_capital: number;
    est_batch_profit: number;
    est_combined_gp_per_hour: number;
  };
  calls: TradeCall[];
}

export interface ItemMetrics {
  id: number;
  name: string;
  icon: string;
  members: boolean;
  buy_limit: number;
  highalch: number;
  lowalch: number;
  is_tax_exempt: boolean;
  is_mega_rare_capped: boolean;
  high: number | null;
  high_time: number | null;
  low: number | null;
  low_time: number | null;
  high_age_sec: number | null;
  low_age_sec: number | null;
  mid_price: number | null;
  suggested_buy: number | null;
  suggested_sell: number | null;
  raw_margin: number;
  tax: number;
  net_margin: number;
  net_roi_pct: number;
  max_profit_per_limit: number;
  vol_5m_high: number;
  vol_5m_low: number;
  vol_5m: number;
  vol_1h_high: number;
  vol_1h_low: number;
  vol_1h: number;
  vol_24h_high: number;
  vol_24h_low: number;
  vol_24h: number;
  avg_high_1h: number | null;
  avg_low_1h: number | null;
  ofi_5m: number;
  ofi_1h: number;
  ofi_24h: number;
  vwap_24h: number | null;
  vwap_7d: number | null;
  volatility_24h_pct: number;
  zscore_24h: number;
  zscore_7d: number;
  price_change_1h_pct: number;
  price_change_24h_pct: number;
  volume_spike_ratio: number;
  seasonality_bias_pct: number;
  est_fill_minutes_limit: number;
  est_gp_per_hour_limit: number;
  flip_sharpe: number;
  alch_profit: number;
  alch_floor_pct: number | null;
  safety_score: number;
  manipulation_flags: string[];
  fast_flip_score: number;
  overnight_score: number;
  dump_sniper_score: number;
  alch_floor_score: number;
  overall_score: number;
  examine?: string;
  value?: number;
  nature_rune_price?: number;
}

export interface ActiveSlot {
  slot_number: number;
  item_id: number;
  item_name: string;
  icon: string;
  status: 'BUYING' | 'BOUGHT' | 'SELLING';
  quantity: number;
  filled_quantity: number;
  buy_price: number;
  target_sell_price: number;
  opened_at: number;
  updated_at: number;
  source: string;
  notes: string;
  elapsed_minutes: number;
  live_high: number | null;
  live_low: number | null;
  ofi_5m: number;
  expected_tax: number;
  expected_net_profit: number;
  live_exit_profit: number | null;
  coach_action: string;
  coach_severity: 'ok' | 'warning' | 'danger' | 'success';
  coach_message: string;
  recommended_price: number | null;
}

export interface FlipRecord {
  id: number;
  item_id: number;
  item_name: string;
  quantity: number;
  buy_price: number;
  sell_price: number;
  tax_paid: number;
  net_profit: number;
  roi_pct: number;
  opened_at: number;
  closed_at: number;
  duration_sec: number;
  source: string;
}

export interface BuyLimitRecord {
  item_id: number;
  item_name: string;
  quantity_bought: number;
  buy_limit: number;
  window_start: number;
  window_reset_at: number;
  seconds_remaining: number;
  remaining_qty: number | null;
}

export interface JournalResponse {
  summary: {
    total_flips: number;
    total_profit: number;
    total_tax_paid: number;
    profit_24h: number;
    profit_7d: number;
    win_rate_pct: number;
    avg_roi_pct: number;
    realized_gp_per_hour: number;
  };
  history: FlipRecord[];
  buy_limits: BuyLimitRecord[];
}

export interface SetArbitrage {
  direction: 'PACK' | 'UNPACK';
  set_id: number;
  set_name: string;
  set_high: number;
  set_low: number;
  set_vol_24h: number;
  min_component_vol_24h: number;
  capital_required: number;
  net_profit: number;
  instant_profit: number;
  is_instant_profitable: boolean;
  roi_pct: number;
  components: { id: number; name: string; high: number; low: number; vol_24h: number }[];
}

export interface DecantArbitrage {
  potion_family: string;
  from_item_id: number;
  from_item_name: string;
  from_doses: number;
  from_buy_price: number;
  from_instabuy_price: number | null;
  from_vol_24h: number;
  to_item_id: number;
  to_item_name: string;
  to_sell_price: number;
  to_instasell_price: number | null;
  to_vol_24h: number;
  tax_per_4dose: number;
  net_profit_per_4dose: number;
  instant_profit_per_4dose: number;
  roi_pct: number;
  buy_limit: number;
  profit_per_limit: number;
  is_instant_profitable: boolean;
  is_tax_exempt: boolean;
}

export interface AlchArbitrage {
  item_id: number;
  item_name: string;
  icon: string;
  members: boolean;
  buy_price: number;
  highalch: number;
  nature_rune_price: number;
  alch_profit: number;
  roi_pct: number;
  buy_limit: number;
  profit_per_limit: number;
  vol_24h: number;
}

export interface ArbitrageSummary {
  nature_rune_price: number;
  sets: SetArbitrage[];
  decanting: DecantArbitrage[];
  high_alch: AlchArbitrage[];
}

export interface AlertItem {
  id: number;
  alert_type: string;
  item_id: number | null;
  item_name: string | null;
  title: string;
  message: string;
  severity: 'info' | 'success' | 'warning' | 'danger';
  metadata: Record<string, unknown>;
  discord_sent: boolean;
  created_at: number;
}

export interface UserSettings {
  cash_stack: number;
  ge_slots: number;
  members: boolean;
  default_mode: StrategyMode;
  discord_webhook_url: string;
  alerts_enabled: boolean;
  sound_enabled: boolean;
  discord_dump_alerts: boolean;
  discord_arb_alerts: boolean;
  discord_coach_alerts: boolean;
  alert_min_dump_score: number;
  alert_min_arb_profit: number;
  dink_webhook_url: string;
  wiki_user_agent: string;
}

export interface ChartPoint {
  timestamp: number;
  avgHighPrice: number | null;
  avgLowPrice: number | null;
  highPriceVolume: number;
  lowPriceVolume: number;
}
