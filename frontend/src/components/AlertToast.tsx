import { AlertTriangle, Bell, CheckCircle2, Info, ShieldAlert, X } from 'lucide-react';
import type { AlertItem } from '../types';

interface Props {
  toasts: AlertItem[];
  onDismiss: (id: number) => void;
  onOpenItem: (itemId: number) => void;
}

export function AlertToastStack({ toasts, onDismiss, onOpenItem }: Props) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex w-90 flex-col gap-2">
      {toasts.map((t) => {
        const cls =
          t.severity === 'danger'
            ? 'border-rose-500/50 bg-[#14090b]/95 text-rose-100'
            : t.severity === 'warning'
              ? 'border-amber-500/45 bg-[#141008]/95 text-amber-100'
              : t.severity === 'success'
                ? 'border-emerald-500/45 bg-[#08130d]/95 text-emerald-100'
                : 'border-white/15 bg-[#0e0e12]/95 text-zinc-100';

        const Icon =
          t.severity === 'danger'
            ? ShieldAlert
            : t.severity === 'warning'
              ? AlertTriangle
              : t.severity === 'success'
                ? CheckCircle2
                : Info;

        return (
          <div key={t.id} className={`rounded-2xl border p-3.5 shadow-2xl backdrop-blur-md ${cls}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2.5 min-w-0">
                <Icon className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <button
                    onClick={() => t.item_id && onOpenItem(t.item_id)}
                    className="text-left text-xs font-bold hover:underline block"
                  >
                    {t.title}
                  </button>
                  <p className="mt-0.5 text-[11px] opacity-85 leading-snug">{t.message.replace(/\*\*/g, '')}</p>
                </div>
              </div>
              <button onClick={() => onDismiss(t.id)} className="opacity-60 hover:opacity-100">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AlertDrawer({
  open,
  alerts,
  onClose,
  onOpenItem,
}: {
  open: boolean;
  alerts: AlertItem[];
  onClose: () => void;
  onOpenItem: (itemId: number) => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-xs" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-white/[0.08] bg-[#0a0a0d] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3.5">
          <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
            <Bell className="h-4 w-4 text-amber-400" /> Recent Alerts ({alerts.length})
          </h3>
          <button onClick={onClose} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-900 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex-1 space-y-2 overflow-y-auto">
          {alerts.length === 0 ? (
            <p className="py-12 text-center text-xs text-zinc-500">
              No alerts yet. Dump snipes, instant arbitrage, and Offer Coach warnings will appear here live.
            </p>
          ) : (
            alerts.map((a) => (
              <div
                key={a.id}
                onClick={() => a.item_id && onOpenItem(a.item_id)}
                className="cursor-pointer rounded-xl border border-white/[0.07] bg-[#101014] p-3 hover:border-white/[0.15]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-zinc-100">{a.title}</span>
                  <span className="text-[10px] text-zinc-500">
                    {new Date(a.created_at * 1000).toLocaleTimeString()}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-zinc-400">{a.message.replace(/\*\*/g, '')}</p>
                {a.discord_sent && (
                  <span className="mt-1.5 inline-block rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-300">
                    Sent to Discord
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
