import type { Entitlements } from './config/features';

export type StrategyMode = 'auto_mix' | 'fast_flip' | 'overnight' | 'dump_sniper' | 'alch_floor';
export type OvernightStyle = 'balanced' | 'safe' | 'high_margin';
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
  health_status?: 'healthy' | 'degraded';
  health_issues?: string[];
  entitlements?: Entitlements;
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
  zscore_24h?: number;
  zscore_7d: number;
  vol_1h: number;
  vol_1h_high?: number;
  vol_1h_low?: number;
  vol_24h: number;
  vol_24h_high?: number;
  vol_24h_low?: number;
  high_age_sec: number | null;
  low_age_sec: number | null;
  reason: string;
  manipulation_flags: string[];
  dump_details?: {
    timeframe: string;
    baseline_vwap: number | null;
    drop_pct: number;
    bounce_outlook: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
    bounce_reason: string;
    conservative_target: number | null;
    full_target: number | null;
    target_basis: string;
  };
  ml?: MLPrediction | null;
}

export interface MLPrediction {
  prob_4h_pct: number;
  prob_12h_pct: number;
  pred_12h_roi_pct: number;
}

export interface MLMeta {
  loaded: boolean;
  validated: boolean;
  boost_active: boolean;
}

export interface TradeCallsResponse {
  cash_stack: number;
  free_slots: number;
  active_slots_count: number;
  mode: StrategyMode;
  members: boolean;
  ml_meta?: MLMeta;
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
  std_24h?: number;
  std_7d?: number;
  candles_1h_count?: number;
  volatility_24h_pct: number;
  zscore_24h: number;
  zscore_7d: number;
  price_change_1h_pct: number;
  price_change_24h_pct: number;
  volume_spike_ratio: number;
  seasonality_bias_pct: number;
  p25_48h?: number | null;
  p75_48h?: number | null;
  min_48h?: number | null;
  max_48h?: number | null;
  p25_7d?: number | null;
  p75_7d?: number | null;
  min_7d?: number | null;
  max_7d?: number | null;
  trend_7d_pct?: number;
  dump_timeframe?: string;
  dump_baseline_vwap?: number | null;
  dump_drop_pct?: number;
  dump_bounce_outlook?: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  dump_bounce_reason?: string;
  dump_conservative_target?: number | null;
  dump_full_target?: number | null;
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
  ml?: MLPrediction | null;
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
  flip_mode: 'active' | 'overnight';
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

export interface JournalEquityPoint {
  ts: number;
  profit: number;
  cumulative_profit: number;
  item_name: string;
}

export interface JournalDailyPnl {
  date: string;
  flips: number;
  wins: number;
  net_profit: number;
  tax_paid: number;
}

export interface JournalLeaderboardItem {
  item_id: number;
  item_name: string;
  flips: number;
  win_rate_pct: number;
  total_profit: number;
  avg_roi_pct: number;
  avg_hold_minutes: number;
  gp_per_hour: number;
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
    avg_hold_minutes?: number;
  };
  history: FlipRecord[];
  buy_limits: BuyLimitRecord[];
  analytics?: {
    equity_curve: JournalEquityPoint[];
    daily_pnl: JournalDailyPnl[];
    top_winners: JournalLeaderboardItem[];
    worst_items: JournalLeaderboardItem[];
  };
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

export interface HerbZahurArbitrage {
  method: 'ZAHUR_UNF' | 'HERB_CLEAN';
  method_label: string;
  level_req: number;
  input_id: number;
  input_name: string;
  input_price: number;
  extra_cost: number;
  extra_note: string;
  output_id: number;
  output_name: string;
  output_price: number;
  tax: number;
  net_profit: number;
  instant_profit: number;
  is_instant_profitable: boolean;
  roi_pct: number;
  buy_limit: number;
  profit_per_limit: number;
  vol_24h: number;
}

export interface ProcessingArbitrage {
  category: 'PLANK_MAKE' | 'SAWMILL' | 'ENCHANT';
  method_label: string;
  input_id: number;
  input_name: string;
  input_price: number;
  extra_cost: number;
  extra_note: string;
  output_id: number;
  output_name: string;
  output_price: number;
  tax: number;
  net_profit: number;
  roi_pct: number;
  buy_limit: number;
  profit_per_limit: number;
  est_gp_per_hour: number;
  vol_24h: number;
  is_tax_exempt: boolean;
}

export interface ArbitrageSummary {
  nature_rune_price: number;
  sets: SetArbitrage[];
  decanting: DecantArbitrage[];
  herbs_zahur: HerbZahurArbitrage[];
  processing: ProcessingArbitrage[];
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
  alert_min_dump_score: number;
  alert_min_arb_profit: number;
  wiki_user_agent: string;
}

export interface ChartPoint {
  timestamp: number;
  avgHighPrice: number | null;
  avgLowPrice: number | null;
  highPriceVolume: number;
  lowPriceVolume: number;
}

export interface OvernightFlip {
  item_id: number;
  item_name: string;
  icon: string;
  members: boolean;
  buy_price: number;
  sell_price: number;
  live_low: number;
  live_high: number;
  quantity: number;
  buy_limit: number;
  capital_required: number;
  tax_per_unit: number;
  total_tax: number;
  net_margin_unit: number;
  est_net_profit: number;
  net_roi_pct: number;
  est_8h_volume: number;
  vol_24h: number;
  vol_24h_high: number;
  vol_24h_low: number;
  fill_confidence: 'HIGH' | 'MEDIUM' | 'PATIENT';
  overnight_risk: 'LOW' | 'MODERATE' | 'SWING';
  alch_protected: boolean;
  is_tax_exempt: boolean;
  is_mega_rare_capped: boolean;
  safety_score: number;
  trend_7d_pct: number;
  volatility_24h_pct: number;
  min_7d: number;
  p25_7d: number;
  p75_7d: number;
  max_7d: number;
  score: number;
  reason: string;
  ml?: MLPrediction | null;
}

export interface OvernightResponse {
  cash_stack: number;
  slots: number;
  style: OvernightStyle;
  members: boolean;
  ml_meta?: MLMeta;
  summary: {
    allocated_capital: number;
    est_overnight_profit: number;
    avg_roi_pct: number;
    picks_count: number;
  };
  flips: OvernightFlip[];
}

export interface WatchlistItem {
  item_id: number;
  item_name: string;
  icon: string;
  buy_below: number | null;
  sell_above: number | null;
  min_net_margin: number | null;
  discord_notify: boolean;
  notes: string;
  created_at: number;
  updated_at: number;
  high: number | null;
  low: number | null;
  high_age_sec?: number | null;
  low_age_sec?: number | null;
  net_margin: number;
  net_roi_pct: number;
  vol_1h: number;
  vol_24h: number;
  price_change_1h_pct?: number;
  price_change_24h_pct?: number;
  trend_7d_pct?: number;
  ofi_5m?: number;
  ofi_1h?: number;
  zscore_7d: number;
  safety_score: number;
  is_tax_exempt: boolean;
  triggered: string[];
}

export interface CandleTableStats {
  buckets: number;
  rows: number;
  oldest_ts: number | null;
  newest_ts: number | null;
}

export interface SystemHealthResponse {
  overall_status: 'healthy' | 'degraded' | 'offline';
  issues: string[];
  generated_at: number;
  db_stats_cached: boolean;
  dataset: {
    candles_5m: CandleTableStats;
    candles_1h: CandleTableStats;
    candles_24h: CandleTableStats;
    expected_1h_30d: number;
    present_1h_30d: number;
    missing_1h_30d: number;
    coverage_30d_pct: number;
    seasonality_30d_items: number;
    db_size_mb: number;
    wal_size_mb: number;
    retention_1h_days?: number;
    stored_1h_days?: number;
    pipeline_health: {
      score: number;
      healthy: boolean;
      checks: Array<{
        label: string;
        ok: boolean;
        detail: string;
      }>;
    };
  };
  engine: {
    ready: boolean;
    enrichment_done: boolean;
    items_tracked: number;
    last_latest_update: number;
    last_latest_age_sec: number | null;
    last_5m_ts: number | null;
    last_1h_ts: number | null;
    last_recompute_ms: number;
    last_candle_agg_ms: number;
    recompute_history: Array<{ ts: number; ms: number }>;
    wiki_total_requests: number;
    wiki_total_errors: number;
    wiki_consecutive_errors: number;
    wiki_last_error: string | null;
    wiki_last_error_ts: number | null;
    ws_clients: number;
    backfill: {
      active: boolean;
      fetched: number;
      total: number;
      target_days?: number;
      stage: string;
    };
  };
  runtime: {
    platform: string;
    uptime_sec: number;
    process_rss_mb: number | null;
    system_ram_used_mb: number | null;
    system_ram_total_mb: number | null;
    load_avg_1m: number | null;
    cpu_count: number;
    disk_free_gb: number | null;
    disk_total_gb: number | null;
    backup: {
      found: boolean;
      filename: string | null;
      timestamp: number | null;
      age_hours: number | null;
      size_mb: number | null;
      count: number;
    };
  };
  integrations: {
    discord_configured: boolean;
    last_discord_sent_ts: number | null;
    last_discord_ok: boolean | null;
    last_discord_error: string | null;
    discord_sent_count: number;
    discord_fail_count: number;
    alerts_24h_total: number;
    alerts_24h_by_type: Record<string, number>;
    watchlist_count: number;
  };
}

export interface MLBacktestFold {
  fold: number;
  train_rows: number;
  test_rows: number;
  test_start_ts: number;
  test_end_ts: number;
  auc_4h: number;
  auc_12h: number;
  ml_win_4h: number;
  rules_win_4h: number;
  ml_roi_4h: number;
  rules_roi_4h: number;
  ml_win_12h: number;
  rules_win_12h: number;
  ml_roi_12h: number;
  rules_roi_12h: number;
}

export interface MLReport {
  status: 'ready' | 'insufficient_data';
  validated: boolean;
  validation_reason?: string;
  reason?: string;
  trained_at: number;
  elapsed_sec: number;
  dataset_rows: number;
  dataset_items: number;
  lookback_days?: number;
  embargo_hours?: number;
  summary?: {
    auc_4h: number;
    rules_auc_4h: number;
    auc_12h: number;
    rules_auc_12h: number;
    ml_win_4h: number;
    rules_win_4h: number;
    ml_roi_4h: number;
    rules_roi_4h: number;
    ml_win_12h: number;
    rules_win_12h: number;
    ml_roi_12h: number;
    rules_roi_12h: number;
    sim_start_gp: number;
    sim_ml_end_gp: number;
    sim_rules_end_gp: number;
    sim_cycles_12h: number;
  };
  folds?: MLBacktestFold[];
  equity_curve?: Array<{ ts: number; ml_gp: number; rules_gp: number }>;
  feature_importances?: Array<{ feature: string; importance_pct: number }>;
}

export interface MLStatusResponse {
  loaded: boolean;
  validated: boolean;
  predictions_count: number;
  last_inference_ms: number;
  last_inference_ts: number;
  training_in_progress: boolean;
  training_started_at: number | null;
  last_train_error: string | null;
  report: MLReport | null;
}
