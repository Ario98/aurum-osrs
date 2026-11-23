export function formatGp(val: number | null | undefined, compact = false): string {
  if (val === null || val === undefined || Number.isNaN(val)) return '—';
  const sign = val < 0 ? '-' : '';
  const abs = Math.abs(val);
  if (compact) {
    if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 10_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  }
  return `${sign}${Math.round(abs).toLocaleString()}`;
}

export function formatSignedGp(val: number | null | undefined, compact = false): string {
  if (val === null || val === undefined) return '—';
  const prefix = val > 0 ? '+' : '';
  return `${prefix}${formatGp(val, compact)}`;
}

export function formatAge(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return '—';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return 'Ready';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function wikiIconUrl(icon: string | undefined): string {
  if (!icon) return '';
  const encoded = encodeURIComponent(icon.replace(/ /g, '_'));
  return `https://oldschool.runescape.wiki/images/${encoded}`;
}

export function parseGpInput(raw: string): number | null {
  const cleaned = raw.trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, '');
  if (!cleaned) return null;
  const match = cleaned.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  const suffix = match[2];
  if (suffix === 'k') return Math.round(num * 1_000);
  if (suffix === 'm') return Math.round(num * 1_000_000);
  if (suffix === 'b') return Math.round(num * 1_000_000_000);
  return Math.round(num);
}

export function playAlertChime(severity: 'info' | 'success' | 'warning' | 'danger' = 'info'): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = severity === 'danger' ? 'sawtooth' : 'sine';
    const freq = severity === 'danger' ? 420 : severity === 'success' ? 880 : 660;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (severity === 'success') {
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.09);
    }
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch {
    // Ignore autoplay blocks
  }
}
