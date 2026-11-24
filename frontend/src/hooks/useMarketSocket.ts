import { useEffect, useRef, useState } from 'react';
import type { AlertItem } from '../types';

interface SocketEvents {
  onMarketTick: () => void;
  onAlert: (alert: AlertItem) => void;
  onBootstrapUpdate: () => void;
}

export function useMarketSocket(enabled: boolean, events: SocketEvents) {
  const [connected, setConnected] = useState(false);
  const eventsRef = useRef(events);
  eventsRef.current = events;

  useEffect(() => {
    if (!enabled) return;

    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;
    let closedByUser = false;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/ws/market`;
      ws = new WebSocket(url);

      ws.onopen = () => {
        setConnected(true);
        pingTimer = window.setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send('ping');
          }
        }, 25000);
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'market_tick') {
            eventsRef.current.onMarketTick();
          } else if (msg.type === 'alert' && msg.alert) {
            eventsRef.current.onAlert(msg.alert as AlertItem);
          } else if (msg.type === 'bootstrap_ready' || msg.type === 'enrichment_complete') {
            eventsRef.current.onBootstrapUpdate();
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (pingTimer) window.clearInterval(pingTimer);
        if (!closedByUser) {
          reconnectTimer = window.setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      closedByUser = true;
      if (pingTimer) window.clearInterval(pingTimer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [enabled]);

  return { connected };
}
