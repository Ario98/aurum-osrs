import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Cpu,
  Database,
  HardDrive,
  History,
  Layers,
  RefreshCw,
  Server,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { api } from '../api/client';
import type { SystemHealthResponse } from '../types';

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const days = Math.floor(sec / 86400);
  const hrs = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  if (days > 0) return `${days}d ${hrs}h`;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function formatAgeFromTs(ts: number | null): string {
  if (!ts) return 'Never';
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${(diff / 3600).toFixed(1)}h ago`;
  return `${(diff / 86400).toFixed(1)}d ago`;
}

function LatencySparkline({ points }: { points: Array<{ ts: number; ms: number }> }) {
  if (!points.length) {
    return (
      <div className="flex h-12 items-center justify-center rounded-xl border border-white/[0.06] bg-[#060608] text-[11px] text-zinc-600">
        Collecting recompute telemetry...
      </div>
    );
  }
  const values = points.map((p) => p.ms);
  const min = Math.min(...values);
  const max = Math.max(...values, min + 1);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const w = 260;
  const h = 44;
  const pad = 4;

  const coords = values.map((v, i) => {
    const x = values.length === 1 ? w / 2 : pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / (max - min)) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const polyline = coords.join(' ');
  const area = `${pad},${h - pad} ${polyline} ${w - pad},${h - pad}`;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#060608] p-2.5">
      <div className="mb-1 flex items-center justify-between text-[10px] text-zinc-500">
        <span>Last {values.length} recompute ticks</span>
        <span className="tabular-nums text-zinc-400">
          avg {avg.toFixed(0)}ms · min {min.toFixed(0)}ms · max {max.toFixed(0)}ms
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-11 w-full overflow-visible">
        <defs>
          <linearGradient id="recomputeGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#recomputeGrad)" />
        <polyline
          fill="none"
          stroke="#10b981"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={polyline}
        />
      </svg>
    </div>
  );
}

export function SystemHealth() {
  const [data, setData] = useState<SystemHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [backfillDays, setBackfillDays] = useState<30 | 60 | 90>(60);
  const [actionFeedback, setActionFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async (fresh = false) => {
    if (fresh) setRefreshing(true);
    try {
      const res = await api.systemHealth(fresh);
      setData(res);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load system health');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const backfillActive = data?.engine.backfill.active ?? false;

  useEffect(() => {
    load(false);
    const intervalMs = backfillActive ? 5_000 : 15_000;
    const id = window.setInterval(() => load(false), intervalMs);
    return () => window.clearInterval(id);
  }, [load, backfillActive]);

  const runBackfill = async () => {
    setRunningAction('backfill');
    setActionFeedback(null);
    try {
      const res = await api.actionBackfillHistory(backfillDays);
      setActionFeedback({ kind: 'ok', text: res.message });
      await load(true);
    } catch (err) {
      setActionFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'History backfill failed',
      });
    } finally {
      setRunningAction(null);
    }
  };

  const runAction = async (key: 'rollup' | 'gaps' | 'checkpoint' | 'backup') => {
    setRunningAction(key);
    setActionFeedback(null);
    try {
      if (key === 'rollup') {
        const res = await api.actionRollup();
        setActionFeedback({
          kind: 'ok',
          text: `Rolled ${res.rolled_24h_rows.toLocaleString()} daily rows & refreshed 30d seasonality for ${res.seasonality_items.toLocaleString()} items (${res.elapsed_ms} ms).`,
        });
      } else if (key === 'gaps') {
        const res = await api.actionFillGaps();
        setActionFeedback({ kind: 'ok', text: res.message });
      } else if (key === 'checkpoint') {
        const res = await api.actionCheckpoint();
        setActionFeedback({
          kind: 'ok',
          text: `WAL checkpoint complete: ${res.checkpointed_frames}/${res.log_frames} frames flushed (busy=${res.busy}).`,
        });
      } else {
        const res = await api.actionBackupDb();
        setActionFeedback({
          kind: 'ok',
          text: `Hot SQLite backup saved to ${res.filename} (${res.size_mb} MB in ${res.elapsed_ms} ms · ${res.total_backups} archived).`,
        });
      }
      await load(true);
    } catch (err) {
      setActionFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Maintenance action failed',
      });
    } finally {
      setRunningAction(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-10 text-center text-xs text-zinc-500">
        Loading system & data health telemetry...
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-6 text-xs text-rose-300">
        {error}
      </div>
    );
  }

  if (!data) return null;

  const { dataset, engine, runtime, integrations } = data;
  const isHealthy = data.overall_status === 'healthy';
  const ramPct =
    runtime.system_ram_used_mb !== null && runtime.system_ram_total_mb
      ? Math.min(100, Math.round((runtime.system_ram_used_mb / runtime.system_ram_total_mb) * 100))
      : null;
  const diskUsedGb =
    runtime.disk_total_gb !== null && runtime.disk_free_gb !== null
      ? Math.max(0, runtime.disk_total_gb - runtime.disk_free_gb)
      : null;
  const diskPct =
    diskUsedGb !== null && runtime.disk_total_gb
      ? Math.min(100, Math.round((diskUsedGb / runtime.disk_total_gb) * 100))
      : null;
  const hasOsTelemetry = runtime.process_rss_mb !== null || runtime.load_avg_1m !== null;

  return (
    <div className="space-y-5">
      {/* Top Status Banner + Quick KPI Strip */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-xl border ${
                isHealthy
                  ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400'
                  : 'border-amber-500/25 bg-amber-500/10 text-amber-400'
              }`}
            >
              {isHealthy ? <ShieldCheck className="h-4.5 w-4.5" /> : <AlertTriangle className="h-4.5 w-4.5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-zinc-100">System & Data Health</h2>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                    isHealthy
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-amber-500/15 text-amber-300'
                  }`}
                >
                  {isHealthy ? 'All Systems Healthy' : 'Degraded'}
                </span>
              </div>
              <p className="text-[11px] text-zinc-500">
                Auto-refreshes every 15s · SQLite counts cached 30s server-side · Uptime {formatUptime(runtime.uptime_sec)}
              </p>
            </div>
          </div>

          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-xl border border-white/[0.1] bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing...' : 'Refresh Now'}
          </button>
        </div>

        {data.issues.length > 0 && (
          <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
            <span className="font-semibold">Attention:</span> {data.issues.join(' · ')}
          </div>
        )}

        {/* 4 Top KPI Tiles */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-white/[0.06] bg-[#060608] p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">30d Coverage</div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-lg font-bold tabular-nums text-zinc-100">{dataset.coverage_30d_pct}%</span>
              <span className="text-[11px] tabular-nums text-zinc-500">
                {dataset.present_1h_30d}/{dataset.expected_1h_30d}h
              </span>
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-[#060608] p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Live Recompute</div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-lg font-bold tabular-nums text-emerald-400">
                {engine.last_recompute_ms.toFixed(0)} ms
              </span>
              <span className="text-[11px] tabular-nums text-zinc-500">
                {engine.items_tracked.toLocaleString()} items
              </span>
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-[#060608] p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">SQLite DB</div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-lg font-bold tabular-nums text-zinc-100">{dataset.db_size_mb} MB</span>
              <span className="text-[11px] tabular-nums text-zinc-500">+{dataset.wal_size_mb} WAL</span>
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-[#060608] p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Data Pipeline</div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span
                className={`text-lg font-bold tabular-nums ${
                  dataset.pipeline_health.healthy ? 'text-emerald-400' : 'text-amber-300'
                }`}
              >
                {dataset.pipeline_health.score}%
              </span>
              <span className="text-[11px] text-zinc-500">
                {dataset.pipeline_health.healthy ? 'Healthy' : 'Collecting'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 2x2 Observability Grid */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Card 1: Dataset & History Coverage */}
        <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
              <Database className="h-4 w-4 text-sky-400" /> Dataset & History Coverage
            </h3>
            <span className="text-[11px] tabular-nums text-zinc-500">
              {dataset.missing_1h_30d === 0
                ? '0 missing 1h gaps'
                : `${dataset.missing_1h_30d} missing 1h gaps`}
            </span>
          </div>

          <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#060608]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Table</th>
                  <th className="px-3 py-2 font-semibold text-right">Buckets</th>
                  <th className="px-3 py-2 font-semibold text-right">Rows</th>
                  <th className="px-3 py-2 font-semibold text-right">Newest</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04] tabular-nums text-zinc-300">
                <tr>
                  <td className="px-3 py-2 font-mono text-[11px] text-zinc-200">candles_5m</td>
                  <td className="px-3 py-2 text-right">{dataset.candles_5m.buckets.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{dataset.candles_5m.rows.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-zinc-400">{formatAgeFromTs(dataset.candles_5m.newest_ts)}</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-mono text-[11px] text-zinc-200">candles_1h</td>
                  <td className="px-3 py-2 text-right">{dataset.candles_1h.buckets.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{dataset.candles_1h.rows.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-zinc-400">{formatAgeFromTs(dataset.candles_1h.newest_ts)}</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-mono text-[11px] text-zinc-200">candles_24h</td>
                  <td className="px-3 py-2 text-right">{dataset.candles_24h.buckets.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{dataset.candles_24h.rows.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-zinc-400">{formatAgeFromTs(dataset.candles_24h.newest_ts)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Data Pipeline Health Checklist */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-semibold text-zinc-200">
                <Layers className="h-3.5 w-3.5 text-sky-400" /> Data Pipeline Health
              </span>
              <span className="tabular-nums font-semibold text-zinc-300">{dataset.pipeline_health.score}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-900">
              <div
                className={`h-full rounded-full transition-all ${
                  dataset.pipeline_health.healthy ? 'bg-emerald-500' : 'bg-amber-400'
                }`}
                style={{ width: `${Math.min(100, dataset.pipeline_health.score)}%` }}
              />
            </div>
            <div className="space-y-1.5 pt-1">
              {dataset.pipeline_health.checks.map((chk) => (
                <div key={chk.label} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="flex items-center gap-1.5 text-zinc-300">
                    <CheckCircle2
                      className={`h-3.5 w-3.5 shrink-0 ${chk.ok ? 'text-emerald-400' : 'text-zinc-600'}`}
                    />
                    {chk.label}
                  </span>
                  <span className="shrink-0 tabular-nums text-zinc-500">{chk.detail}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Card 2: Live Engine & Ingestion Telemetry */}
        <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
              <Activity className="h-4 w-4 text-emerald-400" /> Live Engine & Ingestion
            </h3>
            <span className="text-[11px] tabular-nums text-zinc-500">
              {engine.ws_clients} active WS {engine.ws_clients === 1 ? 'client' : 'clients'}
            </span>
          </div>

          <LatencySparkline points={engine.recompute_history} />

          {engine.backfill.active && (
            <div className="rounded-xl border border-sky-500/20 bg-sky-500/10 px-3.5 py-2.5 text-xs text-sky-200">
              <div className="flex items-center justify-between">
                <span className="font-semibold">
                  {engine.backfill.target_days || 30}-Day Hourly Backfill Running
                </span>
                <span className="tabular-nums">
                  {engine.backfill.fetched} / {engine.backfill.total} buckets
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-sky-950">
                <div
                  className="h-full rounded-full bg-sky-400 transition-all"
                  style={{
                    width: `${
                      engine.backfill.total > 0
                        ? Math.min(100, Math.round((engine.backfill.fetched / engine.backfill.total) * 100))
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2.5 text-xs">
            <div className="rounded-xl border border-white/[0.06] bg-[#060608] p-3">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Last /latest Poll</div>
              <div className="mt-1 font-semibold tabular-nums text-zinc-200">
                {engine.last_latest_age_sec !== null ? `${engine.last_latest_age_sec}s ago` : 'Pending'}
              </div>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-[#060608] p-3">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Candle Cache Rebuild</div>
              <div className="mt-1 font-semibold tabular-nums text-zinc-200">
                {engine.last_candle_agg_ms > 0 ? `${engine.last_candle_agg_ms} ms` : '—'}
              </div>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-[#060608] p-3">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Wiki API Requests</div>
              <div className="mt-1 font-semibold tabular-nums text-zinc-200">
                {engine.wiki_total_requests.toLocaleString()}
              </div>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-[#060608] p-3">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Wiki API Errors</div>
              <div
                className={`mt-1 font-semibold tabular-nums ${
                  engine.wiki_consecutive_errors > 0 ? 'text-amber-400' : 'text-zinc-200'
                }`}
              >
                {engine.wiki_total_errors} total ({engine.wiki_consecutive_errors} streak)
              </div>
            </div>
          </div>

          {engine.wiki_last_error && (
            <div className="truncate rounded-xl border border-white/[0.06] bg-[#060608] px-3 py-2 text-[11px] text-zinc-400">
              Last Wiki error ({formatAgeFromTs(engine.wiki_last_error_ts)}):{' '}
              <span className="text-amber-300">{engine.wiki_last_error}</span>
            </div>
          )}
        </div>

        {/* Card 3: Runtime & Storage (cross-platform: local or server) */}
        <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
              <Server className="h-4 w-4 text-violet-400" /> Runtime & Storage
            </h3>
            <span className="rounded-full border border-white/[0.08] bg-zinc-900 px-2.5 py-0.5 text-[10px] font-medium text-zinc-300">
              {runtime.platform} · {runtime.cpu_count} CPU{runtime.cpu_count > 1 ? 's' : ''}
            </span>
          </div>

          {hasOsTelemetry && (
            <div className="grid grid-cols-2 gap-2.5 text-xs">
              {runtime.process_rss_mb !== null && (
                <div className="rounded-xl border border-white/[0.06] bg-[#060608] p-3">
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500">
                    <Cpu className="h-3 w-3" /> Process Memory
                  </div>
                  <div className="mt-1 font-semibold tabular-nums text-zinc-200">{runtime.process_rss_mb} MB</div>
                </div>
              )}
              {runtime.load_avg_1m !== null && (
                <div className="rounded-xl border border-white/[0.06] bg-[#060608] p-3">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">CPU Load (1m)</div>
                  <div className="mt-1 font-semibold tabular-nums text-zinc-200">
                    {runtime.load_avg_1m.toFixed(2)} / {runtime.cpu_count}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* System RAM (shown when host OS exposes /proc/meminfo) & Disk Storage */}
          <div className="space-y-3 text-xs">
            {ramPct !== null && runtime.system_ram_used_mb !== null && runtime.system_ram_total_mb !== null && (
              <div>
                <div className="mb-1 flex items-center justify-between text-[11px]">
                  <span className="text-zinc-400">Host Memory</span>
                  <span className="tabular-nums text-zinc-300">
                    {Math.round(runtime.system_ram_used_mb)} / {Math.round(runtime.system_ram_total_mb)} MB ({ramPct}%)
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
                  <div className="h-full rounded-full bg-violet-400" style={{ width: `${ramPct}%` }} />
                </div>
              </div>
            )}

            <div>
              <div className="mb-1 flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-1 text-zinc-400">
                  <HardDrive className="h-3 w-3" /> Disk Storage
                </span>
                <span className="tabular-nums text-zinc-300">
                  {runtime.disk_free_gb !== null && runtime.disk_total_gb !== null
                    ? `${runtime.disk_free_gb} GB free of ${runtime.disk_total_gb} GB`
                    : 'Unavailable'}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
                <div
                  className={`h-full rounded-full ${
                    (diskPct ?? 0) > 85 ? 'bg-amber-400' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${diskPct ?? 0}%` }}
                />
              </div>
            </div>
          </div>

          {/* SQLite Backup Archive Status */}
          <div className="rounded-xl border border-white/[0.06] bg-[#060608] p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                SQLite Backups
              </span>
              {runtime.backup.found ? (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                  {runtime.backup.count} archived
                </span>
              ) : (
                <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
                  No backups yet
                </span>
              )}
            </div>
            {runtime.backup.found ? (
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-zinc-300">
                <span className="truncate font-mono text-zinc-400">{runtime.backup.filename}</span>
                <span className="shrink-0 tabular-nums text-zinc-300">
                  {runtime.backup.size_mb} MB · {runtime.backup.age_hours}h ago
                </span>
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-zinc-500">
                Click <strong>Backup DB Now</strong> below to save a consistent hot snapshot into <code>backups/</code>.
              </p>
            )}
          </div>
        </div>

        {/* Card 4: Integrations & Alert Diagnostics */}
        <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
              <Bell className="h-4 w-4 text-amber-400" /> Integrations & Alert Diagnostics
            </h3>
            <span className="text-[11px] tabular-nums text-zinc-500">
              {integrations.alerts_24h_total} alerts (24h)
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-xs">
            <div className="rounded-xl border border-white/[0.06] bg-[#060608] p-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">RuneLite Dink</span>
                <span
                  className={`h-2 w-2 rounded-full ${
                    integrations.dink_configured ? 'bg-emerald-400' : 'bg-zinc-600'
                  }`}
                />
              </div>
              <div className="mt-1 font-semibold tabular-nums text-zinc-200">
                {integrations.dink_events_total} GE events
              </div>
              <div className="mt-0.5 text-[11px] text-zinc-500">
                Last: {formatAgeFromTs(integrations.last_dink_ts)}
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.06] bg-[#060608] p-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">Discord Webhook</span>
                <span
                  className={`h-2 w-2 rounded-full ${
                    !integrations.discord_configured
                      ? 'bg-zinc-600'
                      : integrations.last_discord_ok === false
                        ? 'bg-rose-400'
                        : 'bg-emerald-400'
                  }`}
                />
              </div>
              <div className="mt-1 font-semibold tabular-nums text-zinc-200">
                {integrations.discord_configured
                  ? `${integrations.discord_sent_count} sent · ${integrations.discord_fail_count} err`
                  : 'Not configured'}
              </div>
              <div className="mt-0.5 text-[11px] text-zinc-500">
                {integrations.last_discord_error
                  ? `Err: ${integrations.last_discord_error}`
                  : `Last: ${formatAgeFromTs(integrations.last_discord_sent_ts)}`}
              </div>
            </div>
          </div>

          {/* 24h Alert Breakdown */}
          <div className="rounded-xl border border-white/[0.06] bg-[#060608] p-3 text-xs">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              24-Hour Alert Breakdown
            </div>
            {Object.keys(integrations.alerts_24h_by_type).length === 0 ? (
              <div className="text-[11px] text-zinc-500">No alerts fired in the last 24 hours.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(integrations.alerts_24h_by_type).map(([type, count]) => (
                  <span
                    key={type}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-zinc-900/90 px-2 py-1 text-[11px] text-zinc-300"
                  >
                    <span className="font-mono text-[10px] text-zinc-400">{type}</span>
                    <span className="font-semibold tabular-nums text-zinc-100">{count}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Live User Data Counters */}
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-xl border border-white/[0.06] bg-[#060608] py-2">
              <div className="text-sm font-bold tabular-nums text-zinc-100">{integrations.active_slots_count}/8</div>
              <div className="text-[10px] text-zinc-500">Active Slots</div>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-[#060608] py-2">
              <div className="text-sm font-bold tabular-nums text-zinc-100">{integrations.watchlist_count}</div>
              <div className="text-[10px] text-zinc-500">Watchlist</div>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-[#060608] py-2">
              <div className="text-sm font-bold tabular-nums text-zinc-100">{integrations.journal_flips_count}</div>
              <div className="text-[10px] text-zinc-500">Logged Flips</div>
            </div>
          </div>
        </div>
      </div>

      {/* Safe Maintenance Actions */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
              <Wrench className="h-4 w-4 text-zinc-400" /> Safe Maintenance Actions
            </h3>
            <p className="text-[11px] text-zinc-500">
              Idempotent, non-destructive operations — safe to run anytime while trading.
            </p>
          </div>
        </div>

        {/* Historical Backfill Depth Control */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-[#060608] px-3.5 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
              <History className="h-3.5 w-3.5 text-sky-400" />
              Expand Historical Hourly Data
              <span className="rounded-md border border-white/[0.08] bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-zinc-300">
                {dataset.stored_1h_days !== undefined
                  ? `${dataset.stored_1h_days}d stored`
                  : `${(dataset.candles_1h.buckets / 24).toFixed(1)}d stored`}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              Fresh installs backfill 30d and grow naturally 1h/hr up to {dataset.retention_1h_days ?? 90}d. Pull deeper history anytime for richer ML walk-forward training.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-white/[0.08] bg-zinc-950 p-0.5 text-[11px] font-semibold">
              {([30, 60, 90] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setBackfillDays(d)}
                  disabled={engine.backfill.active || runningAction !== null}
                  className={`rounded-md px-2.5 py-1 transition disabled:opacity-50 ${
                    backfillDays === d
                      ? 'bg-sky-500/20 text-sky-200 shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={runBackfill}
              disabled={engine.backfill.active || runningAction !== null}
              className="rounded-xl border border-sky-500/30 bg-sky-500/15 px-3.5 py-1.5 text-xs font-semibold text-sky-200 transition hover:bg-sky-500/25 disabled:opacity-50"
            >
              {engine.backfill.active
                ? `Backfilling ${engine.backfill.target_days || backfillDays}d (${engine.backfill.fetched}/${engine.backfill.total})...`
                : runningAction === 'backfill'
                  ? 'Starting...'
                  : `Backfill ${backfillDays}d`}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2.5">
          <button
            onClick={() => runAction('rollup')}
            disabled={runningAction !== null}
            className="rounded-xl border border-white/[0.1] bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
          >
            {runningAction === 'rollup' ? 'Running Rollup...' : 'Refresh 24h Rollup & Seasonality'}
          </button>
          <button
            onClick={() => runAction('gaps')}
            disabled={runningAction !== null}
            className="rounded-xl border border-white/[0.1] bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
          >
            {runningAction === 'gaps' ? 'Scanning Gaps...' : 'Check & Fill Missing Candle Gaps'}
          </button>
          <button
            onClick={() => runAction('checkpoint')}
            disabled={runningAction !== null}
            className="rounded-xl border border-white/[0.1] bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
          >
            {runningAction === 'checkpoint' ? 'Checkpointing...' : 'SQLite WAL Checkpoint'}
          </button>
          <button
            onClick={() => runAction('backup')}
            disabled={runningAction !== null}
            className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-2 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-50"
          >
            {runningAction === 'backup' ? 'Creating Backup...' : 'Backup DB Now'}
          </button>
        </div>

        {actionFeedback && (
          <div
            className={`rounded-xl border px-3.5 py-2.5 text-xs ${
              actionFeedback.kind === 'ok'
                ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
                : 'border-rose-500/25 bg-rose-500/10 text-rose-200'
            }`}
          >
            {actionFeedback.text}
          </div>
        )}
      </div>
    </div>
  );
}
