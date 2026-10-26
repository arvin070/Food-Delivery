'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { TrackedMeal, TrackingSnapshot } from '@lunch/shared';
import { useLiveSnapshot } from './useLiveSnapshot';

function time(value: string, timezone: string) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}
function TrackingCard({ meal, live, now }: { meal: TrackedMeal; live: boolean; now: number }) {
  const { location, window: windowInfo } = meal;
  const fresh = live && location.state === 'LIVE' && !!location.expiresAt && new Date(location.expiresAt).getTime() > now;
  const eta = fresh && meal.eta && new Date(meal.eta.expiresAt).getTime() > now ? meal.eta : null;
  const coordinate = fresh && location.latitude !== null && location.longitude !== null ? `${location.latitude},${location.longitude}` : null;
  const state = (meal.deliveryStatus ?? meal.status).replaceAll('_', ' ').toLowerCase();
  return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-semibold">{meal.beneficiary}</h2><p>{meal.quantity} × {meal.meal}</p>
        <p className="text-xs text-slate-500">Order {meal.orderNumber} · {meal.orderStatus.replaceAll('_', ' ').toLowerCase()}</p></div>
      <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium capitalize text-emerald-800">{state}</span>
    </header>
    <div className="rounded-xl bg-slate-50 p-4">
      <h3 className="font-semibold">{meal.checkpoint.name}</h3>
      <p className="text-sm">{new Date(windowInfo.start).toLocaleDateString('en-IN', { timeZone: windowInfo.timezone, weekday: 'short', day: 'numeric', month: 'short' })}</p>
      <p className="text-sm">Scheduled: {time(windowInfo.start, windowInfo.timezone)} – {time(windowInfo.end, windowInfo.timezone)} ({windowInfo.timezone})</p>
      {meal.checkpoint.instructions && <p className="mt-2 text-sm text-slate-600">{meal.checkpoint.instructions}</p>}
    </div>
    {meal.late && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">The scheduled delivery window has passed. {live ? 'Delivery has not yet been confirmed.' : 'Reconnect for the latest delivery status.'}</p>}
    {meal.deliveredAt ? <div className="rounded-xl bg-emerald-50 p-4 text-emerald-900">
      <p className="font-semibold">{meal.beneficiary}’s meal was delivered at {meal.checkpoint.name}.</p>
      <p className="text-sm">{time(meal.deliveredAt, windowInfo.timezone)}{meal.verifiedAt ? ' · OTP verified' : ''}</p>
    </div> : !['CANCELLED', 'FAILED', 'REFUNDED'].includes(meal.status) && <section className="space-y-2">
      <h3 className="font-semibold">Rider location</h3>
      {coordinate ? <>
        <p className="text-sm text-emerald-700">Live · GPS accuracy within {Math.round(location.accuracy ?? 0)} m</p>
        <p className="text-sm tabular-nums">{location.latitude!.toFixed(5)}, {location.longitude!.toFixed(5)}</p>
        <a className="inline-block min-h-11 rounded-lg border px-4 py-2 font-medium text-emerald-800" target="_blank" rel="noreferrer"
          href={`https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=16/${location.latitude}/${location.longitude}`}>View shared location on map ↗</a>
      </> : <p className="text-sm text-slate-600">{!live ? 'Live location unavailable while reconnecting.' :
        location.state === 'STALE' || location.state === 'LIVE' ? 'Location update is stale. The rider may be offline or their phone may be in the background.' :
        location.state === 'NOT_SHARING' ? 'The rider is not sharing a current location.' : 'A live rider location is not available yet.'}</p>}
      {location.observedAt && <p className="text-xs text-slate-500">Last GPS reading: {time(location.observedAt, windowInfo.timezone)}</p>}
      <p className="text-sm">{eta ? `Estimated arrival: ${time(eta.at, windowInfo.timezone)} · Rider estimate, updated ${time(eta.reportedAt, windowInfo.timezone)}` : 'Arrival estimate unavailable. The scheduled window above is not a live ETA.'}</p>
    </section>}
    <details open><summary className="cursor-pointer py-2 font-semibold">Order timeline</summary>
      <ol className="ml-2 space-y-3 border-l-2 border-emerald-200 pl-4">
        {meal.timeline.map((event, index) => <li key={`${event.label}-${index}`} className="text-sm flex justify-between gap-3">
          <span>{event.label}</span><time dateTime={event.at} className="text-slate-500">{time(event.at, windowInfo.timezone)}</time>
        </li>)}
      </ol>
    </details>
  </article>;
}
export function CustomerTracking({ orderId }: { orderId?: string }) {
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page), ...(orderId ? { orderId } : {}) }).toString();
  const { data, connection, receivedAt } = useLiveSnapshot<TrackingSnapshot>('/v1/tracking/meals/events?' + query);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const now = data ? Date.parse(data.serverTime) + Math.max(0, clock - receivedAt) : clock;
  return <div className="space-y-5">
    <header><Link className="text-sm text-emerald-700" href={orderId ? `/orders/${orderId}` : '/orders'}>← {orderId ? 'Order and delivery code' : 'My orders'}</Link>
      <h1 className="mt-3 text-3xl font-semibold">{orderId ? 'Track your delivery' : 'Family delivery tracking'}</h1>
      <p className="mt-2 text-slate-600">Meals for you and your children, from preparation to handoff.</p>
      <p role="status" className="mt-3 text-sm text-slate-600">{connection === 'LIVE' ? '● Live updates connected' : connection === 'OFFLINE' ? 'Offline · Showing the last received status' : connection === 'ACCESS_LOST' ? 'Tracking access is unavailable. Sign in again or return to your orders.' : 'Connecting to live updates…'}</p>
    </header>
    {!data && connection !== 'ACCESS_LOST' && <p className="rounded-xl border p-5">Waiting for delivery information…</p>}
    {data && !data.meals.length && <p className="rounded-xl border p-5">No recent or upcoming meals on this page.</p>}
    <div className="grid gap-5 md:grid-cols-2">{data?.meals.map(meal => <TrackingCard key={meal.id} meal={meal} live={connection === 'LIVE'} now={now} />)}</div>
    <nav className="flex justify-between gap-3">
      {page > 1 && <button className="min-h-12 rounded-lg border px-4" onClick={() => setPage(p => p - 1)}>Previous meals</button>}
      {data?.hasMore && <button className="min-h-12 rounded-lg border px-4" onClick={() => setPage(p => p + 1)}>More meals →</button>}
    </nav>
  </div>;
}
