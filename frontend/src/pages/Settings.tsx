import { useEffect, useState } from 'react';
import { Activity, Bell, Check, Copy, Plug, Save, Send, SlidersHorizontal } from 'lucide-react';
import { api } from '../api/client';
import { SystemHealth } from '../components/SystemHealth';
import type { UserSettings } from '../types';

export type SettingsSubTab = 'general' | 'health';

interface Props {
  activeSubTab: SettingsSubTab;
  onChangeSubTab: (tab: SettingsSubTab) => void;
  onSettingsSaved: (s: UserSettings) => void;
}

export function Settings({ activeSubTab, onChangeSubTab, onSettingsSaved }: Props) {
  const [form, setForm] = useState<UserSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [testingDiscord, setTestingDiscord] = useState(false);
  const [discordStatus, setDiscordStatus] = useState('');
  const [copiedDink, setCopiedDink] = useState(false);

  useEffect(() => {
    api.settings().then(setForm);
  }, []);

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    setSavedMsg('');
    try {
      const updated = await api.saveSettings({
        cash_stack: form.cash_stack,
        ge_slots: form.ge_slots,
        members: form.members,
        default_mode: form.default_mode,
        discord_webhook_url: form.discord_webhook_url,
        alerts_enabled: form.alerts_enabled,
        sound_enabled: form.sound_enabled,
        discord_dump_alerts: form.discord_dump_alerts,
        discord_arb_alerts: form.discord_arb_alerts,
        discord_coach_alerts: form.discord_coach_alerts,
        alert_min_dump_score: form.alert_min_dump_score,
        alert_min_arb_profit: form.alert_min_arb_profit,
      });
      setForm(updated);
      onSettingsSaved(updated);
      setSavedMsg('Saved!');
      window.setTimeout(() => setSavedMsg(''), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleTestDiscord = async () => {
    if (!form) return;
    setTestingDiscord(true);
    setDiscordStatus('');
    try {
      await api.testDiscord(form.discord_webhook_url);
      setDiscordStatus('Test alert sent to Discord!');
    } catch (err) {
      setDiscordStatus(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setTestingDiscord(false);
    }
  };

  const copyDink = () => {
    if (!form) return;
    navigator.clipboard.writeText(form.dink_webhook_url);
    setCopiedDink(true);
    window.setTimeout(() => setCopiedDink(false), 1800);
  };

  return (
    <div className="space-y-5">
      {/* Segmented Switch: General & Integrations | System & Data Health */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-white/[0.08] bg-[#0c0c0f] p-1">
          <button
            onClick={() => onChangeSubTab('general')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
              activeSubTab === 'general'
                ? 'bg-zinc-100 text-zinc-950'
                : 'text-zinc-400 hover:text-zinc-100'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            General & Integrations
          </button>
          <button
            onClick={() => onChangeSubTab('health')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
              activeSubTab === 'health'
                ? 'bg-zinc-100 text-zinc-950'
                : 'text-zinc-400 hover:text-zinc-100'
            }`}
          >
            <Activity className="h-3.5 w-3.5" />
            System & Data Health
          </button>
        </div>
      </div>

      {activeSubTab === 'health' ? (
        <SystemHealth />
      ) : !form ? (
        <div className="p-8 text-center text-xs text-zinc-500">Loading settings...</div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {/* Alerts & Discord Settings */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
            <Bell className="h-4 w-4 text-amber-400" /> Alerts & Discord Webhook
          </h2>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-xl bg-zinc-100 px-3.5 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-white"
          >
            <Save className="h-3.5 w-3.5" /> {saving ? 'Saving...' : savedMsg || 'Save Settings'}
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <label className="block text-zinc-500 mb-1.5">Discord Webhook URL</label>
            <div className="flex gap-2">
              <input
                value={form.discord_webhook_url}
                onChange={(e) => setForm({ ...form, discord_webhook_url: e.target.value })}
                placeholder="https://discord.com/api/webhooks/..."
                className="flex-1 rounded-xl border border-white/[0.1] bg-[#060608] px-3 py-2 text-xs text-zinc-100 outline-none focus:border-white/25"
              />
              <button
                onClick={handleTestDiscord}
                disabled={testingDiscord || !form.discord_webhook_url}
                className="flex items-center gap-1 rounded-xl border border-white/[0.1] bg-zinc-900 px-3 py-2 font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
              >
                <Send className="h-3.5 w-3.5" /> Test
              </button>
            </div>
            {discordStatus && <p className="mt-1.5 text-[11px] text-amber-300">{discordStatus}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1 text-zinc-300">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.alerts_enabled}
                onChange={(e) => setForm({ ...form, alerts_enabled: e.target.checked })}
                className="accent-zinc-100"
              />
              <span>Enable live alerts engine</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.sound_enabled}
                onChange={(e) => setForm({ ...form, sound_enabled: e.target.checked })}
                className="accent-zinc-100"
              />
              <span>In-app audio chime</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.discord_dump_alerts}
                onChange={(e) => setForm({ ...form, discord_dump_alerts: e.target.checked })}
                className="accent-zinc-100"
              />
              <span>Discord Dump Sniper pings</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.discord_arb_alerts}
                onChange={(e) => setForm({ ...form, discord_arb_alerts: e.target.checked })}
                className="accent-zinc-100"
              />
              <span>Discord Instant Arb pings</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.discord_coach_alerts}
                onChange={(e) => setForm({ ...form, discord_coach_alerts: e.target.checked })}
                className="accent-zinc-100"
              />
              <span>Discord Offer Coach warnings</span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-white/[0.06] pt-3.5">
            <div>
              <label className="block text-zinc-500 mb-1">Min Dump Snipe Score (0–99)</label>
              <input
                type="number"
                value={form.alert_min_dump_score}
                onChange={(e) => setForm({ ...form, alert_min_dump_score: Number(e.target.value) })}
                className="w-full rounded-xl border border-white/[0.1] bg-[#060608] px-3 py-2 text-xs tabular-nums outline-none focus:border-white/25"
              />
            </div>
            <div>
              <label className="block text-zinc-500 mb-1">Min Instant Arb Alert Profit (GP)</label>
              <input
                type="number"
                value={form.alert_min_arb_profit}
                onChange={(e) => setForm({ ...form, alert_min_arb_profit: Number(e.target.value) })}
                className="w-full rounded-xl border border-white/[0.1] bg-[#060608] px-3 py-2 text-xs tabular-nums outline-none focus:border-white/25"
              />
            </div>
          </div>

          <div className="border-t border-white/[0.06] pt-3 text-[11px] text-zinc-500">
            Active Wiki API User-Agent: <code className="text-zinc-300">{form.wiki_user_agent}</code>
          </div>
        </div>
      </div>

      {/* 30-Second RuneLite Dink Setup Wizard */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0f] p-5 space-y-4">
        <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
          <Plug className="h-4 w-4 text-emerald-400" /> 30-Second RuneLite Auto-Sync (Dink Plugin)
        </h2>
        <p className="text-xs text-zinc-400 leading-relaxed">
          Connect the official <strong className="text-zinc-200">Dink</strong> plugin from the RuneLite Plugin Hub
          so your 8 GE slots, 4-hour buy limits, Proactive Offer Coach, and realized post-tax profit sync
          automatically as you trade in-game.
        </p>

        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">
            Your Private Dink Webhook URL
          </label>
          <div className="flex gap-2">
            <input
              readOnly
              value={form.dink_webhook_url}
              className="flex-1 rounded-xl border border-white/[0.1] bg-[#060608] px-3 py-2 text-xs font-mono text-zinc-200 outline-none"
            />
            <button
              onClick={copyDink}
              className="flex items-center gap-1 rounded-xl bg-zinc-100 px-3.5 py-2 text-xs font-semibold text-zinc-950 hover:bg-white"
            >
              {copiedDink ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedDink ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <ol className="space-y-2 text-xs text-zinc-300 list-decimal list-inside bg-[#060608] rounded-xl border border-white/[0.06] p-4">
          <li>
            In <strong>RuneLite</strong>, open the Plugin Hub and install <strong>Dink</strong>.
          </li>
          <li>
            Open <strong>Dink settings</strong> → expand <strong>Grand Exchange</strong> and enable{' '}
            <strong>Enable Grand Exchange</strong>.
          </li>
          <li>
            Paste the webhook URL above into <strong>Grand Exchange Webhook Override</strong> (or Primary Webhook URL).
          </li>
          <li>
            Set <strong>Min Value</strong> to <code>1</code> and disable screenshots for Grand Exchange (faster & lighter).
          </li>
        </ol>

        <p className="text-[11px] text-zinc-500">
          When hosted behind HTTPS (e.g. Tailscale Serve, Cloudflare Tunnel, or a reverse proxy), this URL automatically uses your public domain so RuneLite syncs from anywhere.
        </p>
      </div>
    </div>
      )}
    </div>
  );
}
