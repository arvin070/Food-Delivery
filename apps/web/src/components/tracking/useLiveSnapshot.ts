'use client';
import { useEffect, useState } from 'react';
export type ConnectionState = 'CONNECTING' | 'LIVE' | 'RECONNECTING' | 'OFFLINE' | 'ACCESS_LOST';

/** Snapshot replay on reconnect avoids missing transitions while a phone is offline. No credentials in URLs. */
export function useLiveSnapshot<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('CONNECTING');
  const [receivedAt, setReceivedAt] = useState(0);
  useEffect(() => {
    let disposed = false, denied = false, retry = 1000, lastFrame = Date.now();
    let source: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controllers = new Set<AbortController>();
    setData(null); setConnection('CONNECTING');
    function accessLost() {
      denied = true; source?.close(); clearTimeout(timer);
      setData(null); setConnection('ACCESS_LOST');
    }
    async function checkAccess() {
      const controller = new AbortController(); controllers.add(controller);
      try {
        const endpoint = path.includes('/meals/events') ? path.replace('/meals/events', '/meals') : '/v1/auth/me';
        const response = await fetch('/api' + endpoint, { credentials: 'same-origin', cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) });
        if (!disposed && [401, 403, 404].includes(response.status)) accessLost();
      } catch { /* Connectivity will retry; never interpret a network failure as delivery progress. */ }
      finally { controllers.delete(controller); }
    }
    function reconnect() {
      source?.close(); clearTimeout(timer);
      if (disposed || denied) return;
      setConnection(navigator.onLine ? 'RECONNECTING' : 'OFFLINE');
      if (!navigator.onLine) return;
      timer = setTimeout(connect, retry + Math.random() * 500);
      retry = Math.min(retry * 2, 30000);
    }
    function connect() {
      if (disposed || denied) return;
      if (!navigator.onLine) { setConnection('OFFLINE'); return; }
      source?.close(); lastFrame = Date.now();
      source = new EventSource('/api' + path);
      source.addEventListener('snapshot', event => {
        if (disposed || denied) return;
        try {
          const value = JSON.parse((event as MessageEvent<string>).data) as T;
          lastFrame = Date.now(); retry = 1000;
          setData(value); setReceivedAt(lastFrame); setConnection('LIVE');
        } catch { reconnect(); }
      });
      source.addEventListener('heartbeat', () => { lastFrame = Date.now(); setConnection('LIVE'); retry = 1000; });
      source.addEventListener('access-lost', accessLost);
      source.addEventListener('unavailable', reconnect);
      source.onerror = () => { reconnect(); void checkAccess(); };
    }
    const online = () => { clearTimeout(timer); retry = 1000; connect(); };
    const offline = () => { source?.close(); clearTimeout(timer); setConnection('OFFLINE'); };
    const visible = () => { if (document.visibilityState === 'visible') online(); };
    window.addEventListener('online', online); window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', visible);
    const watchdog = setInterval(() => { if (Date.now() - lastFrame > 20000) { lastFrame = Date.now(); reconnect(); } }, 5000);
    connect();
    return () => {
      disposed = true; source?.close(); clearTimeout(timer); clearInterval(watchdog);
      for (const controller of controllers) controller.abort();
      window.removeEventListener('online', online); window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [path]);
  return { data, connection, receivedAt };
}
