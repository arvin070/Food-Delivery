'use client';
import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { RiderRoute } from '@lunch/shared';
import { apiClient, ApiError } from '@/lib/api.client';
import { toFormErrors } from '@/lib/form';

type Session = { routeId: string; sessionId: string };
type Sharing = {
  routeId: string | null; busy: boolean; message: string; lastSent: number | null;
  start: (routeId: string) => Promise<void>; stop: () => void;
  estimate: (stopId: string, minutes: number | null) => Promise<void>;
};
const Context = createContext<Sharing | null>(null);
export function useRiderSharing() {
  const value = useContext(Context);
  if (!value) throw new Error('Rider sharing provider is missing');
  return value;
}
function revoke(session: Session) {
  // Best-effort on navigation/closing. Server-side expiry bounds exposure if offline.
  void fetch(`/api/v1/tracking/routes/${session.routeId}/sharing`, {
    method: 'DELETE', credentials: 'same-origin', keepalive: true,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.sessionId }),
  }).catch(() => undefined);
}
export function RiderSharingProvider({ children }: { children: React.ReactNode }) {
  const active = useRef<Session | null>(null);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('Location sharing is off.');
  const [lastSent, setLastSent] = useState<number | null>(null);
  const starting = useRef(false);
  const stop = useCallback(() => {
    const current = active.current; active.current = null;
    setRouteId(null); setLastSent(null);
    setMessage('Location sharing stopped. If offline, the last reading expires within 90 seconds.');
    if (current) revoke(current);
  }, []);
  async function start(id: string) {
    if (starting.current) return;
    if (!window.isSecureContext || !navigator.geolocation) {
      setMessage('Location requires an HTTPS connection and browser location support.'); return;
    }
    if (!navigator.onLine) { setMessage('Connect to the internet before starting location sharing.'); return; }
    starting.current = true; setBusy(true); stop();
    try {
      const session = await apiClient.post<{ sessionId: string }>(`/v1/tracking/routes/${id}/sharing`, {});
      active.current = { routeId: id, sessionId: session.sessionId };
      setRouteId(id); setMessage('Allow location access when your phone asks.');
    } catch (e) { setMessage(toFormErrors(e).formError ?? 'Could not start sharing.'); }
    finally { starting.current = false; setBusy(false); }
  }
  useEffect(() => {
    if (!routeId) return;
    let disposed = false, sending = false;
    async function sample() {
      const session = active.current;
      if (disposed || sending || !session || session.routeId !== routeId) return;
      if (!navigator.onLine) { setMessage('Offline. New locations will be sent when connectivity returns.'); return; }
      sending = true;
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true, maximumAge: 0, timeout: 10000,
        }));
        if (disposed || active.current !== session) return;
        if (position.coords.accuracy > 1000) { setMessage('GPS accuracy is too low. Waiting for a better reading.'); return; }
        const result = await apiClient.put<{ accepted: boolean }>(`/v1/tracking/routes/${session.routeId}/location`, {
          sessionId: session.sessionId, latitude: position.coords.latitude, longitude: position.coords.longitude,
          accuracy: position.coords.accuracy, observedAt: new Date(position.timestamp).toISOString(),
        });
        if (disposed || active.current !== session) return;
        if (result.accepted) {
          setLastSent(Date.now()); setMessage('Sharing your current location with customers on this route.');
        }
      } catch (e) {
        if (disposed || active.current !== session) return;
        if (e instanceof ApiError && [401, 403, 404, 409].includes(e.status)) {
          stop(); setMessage('Sharing paused because the session expired or the route changed. Tap Share location to resume if this route is still active.');
        } else if (typeof e === 'object' && e && 'code' in e && e.code === 1) {
          stop(); setMessage('Location permission was denied. Enable it in browser settings before sharing.');
        } else setMessage('Waiting for a fresh GPS reading or connection. No locations are queued while offline.');
      } finally { sending = false; }
    }
    void sample();
    const timer = setInterval(() => void sample(), 10000);
    const online = () => void sample();
    const offline = () => setMessage('Offline. Customers will see the location become stale.');
    const visible = () => { if (document.visibilityState === 'visible') void sample(); };
    window.addEventListener('online', online); window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', visible);
    return () => {
      disposed = true; clearInterval(timer);
      window.removeEventListener('online', online); window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [routeId, stop]);
  useEffect(() => {
    const leave = () => stop();
    window.addEventListener('pagehide', leave);
    return () => { window.removeEventListener('pagehide', leave); if (active.current) revoke(active.current); active.current = null; };
  }, [stop]);
  async function estimate(stopId: string, minutes: number | null) {
    const session = active.current;
    if (!session) return;
    await apiClient.put(`/v1/tracking/routes/${session.routeId}/eta`, {
      sessionId: session.sessionId, stopId,
      estimatedArrivalAt: minutes === null ? null : new Date(Date.now() + minutes * 60000).toISOString(),
    });
  }
  return <Context.Provider value={{ routeId, busy, message, lastSent, start, stop, estimate }}>
    {routeId && <aside className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-emerald-900 px-4 py-3 text-sm text-white" aria-label="Location sharing controls">
      <span>Location sharing is on · Keep this page open while riding.</span>
      <button onClick={stop} className="min-h-11 shrink-0 rounded-lg border border-white px-4 font-semibold">Stop sharing</button>
    </aside>}
    {children}
  </Context.Provider>;
}

export function RiderTracking({ route }: { route: RiderRoute }) {
  const sharing = useRiderSharing();
  const [minutes, setMinutes] = useState(''), [notice, setNotice] = useState(''), [saving, setSaving] = useState(false);
  const next = route.stops.find(s => !['COMPLETED', 'SKIPPED'].includes(s.status));
  const active = route.status === 'IN_PROGRESS' && !!route.departedAt;
  const mine = sharing.routeId === route.id;
  useEffect(() => { if (mine && !active) sharing.stop(); }, [mine, active, sharing.stop]);
  const lat = next?.checkpoint.latitude, lon = next?.checkpoint.longitude;
  async function save(clear = false) {
    if (!next) return;
    setSaving(true); setNotice('');
    try { await sharing.estimate(next.id, clear ? null : Number(minutes)); setNotice(clear ? 'Arrival estimate cleared.' : 'Rider estimate shared. It expires after 15 minutes unless updated.'); }
    catch (e) { setNotice(toFormErrors(e).formError ?? 'Could not update arrival estimate.'); }
    finally { setSaving(false); }
  }
  if (['COMPLETED', 'CANCELLED'].includes(route.status)) return null;
  return <section className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
    {next && <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">Next checkpoint</p>
      <Link className="block py-2 text-lg font-semibold text-emerald-900" href={`/delivery/routes/${route.id}/stops/${next.id}`}>{next.checkpoint.name} →</Link>
      <p className="text-sm">{next.mealCount} meals · {next.deliveryCount} deliveries</p>
      {lat != null && lon != null ? <a className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-emerald-700 px-4 text-sm font-semibold text-emerald-800"
        href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`} target="_blank" rel="noreferrer">Navigate to checkpoint ↗</a> :
        <p className="mt-2 text-sm text-slate-500">Checkpoint coordinates are unavailable. Follow the delivery instructions.</p>}
    </div>}
    <p className="text-sm text-slate-600">Sharing sends your latest GPS position only while this route is active. Phone location permission is required. Backgrounded phones may stop sending updates.</p>
    <button disabled={sharing.busy || !active} className="min-h-12 w-full rounded-lg bg-emerald-700 px-4 font-semibold text-white disabled:opacity-50"
      onClick={() => mine ? sharing.stop() : void sharing.start(route.id)}>{mine ? 'Stop sharing location' : active ? 'Share location' : 'Start route to share location'}</button>
    {(mine || !sharing.routeId) && <p role="status" className="text-sm">{sharing.message}{mine && sharing.lastSent ? ` Last sent at ${new Date(sharing.lastSent).toLocaleTimeString('en-IN')}.` : ''}</p>}
    {mine && next?.status === 'PENDING' && <div className="border-t border-emerald-200 pt-3 space-y-2">
      <label className="block text-sm font-medium" htmlFor={`eta-${route.id}`}>Your arrival estimate for {next.checkpoint.name} (minutes)</label>
      <input id={`eta-${route.id}`} className="min-h-12 w-full rounded-lg border p-3" type="number" inputMode="numeric" min={1} max={120} step={1}
        value={minutes} onChange={e => setMinutes(e.target.value)} placeholder="Enter an estimate when safe to do so" />
      <div className="flex gap-2"><button disabled={saving || !Number.isInteger(Number(minutes)) || Number(minutes) < 1 || Number(minutes) > 120}
        onClick={() => void save()} className="min-h-11 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50">Share estimate</button>
        <button disabled={saving} onClick={() => void save(true)} className="min-h-11 rounded-lg border px-4 text-sm">Clear estimate</button></div>
      <p className="text-xs text-slate-600">Customers see this as your estimate, not a guaranteed arrival time.</p>
      {notice && <p role="status" className="text-sm">{notice}</p>}
    </div>}
  </section>;
}
