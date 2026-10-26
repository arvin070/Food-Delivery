'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveSnapshot } from './useLiveSnapshot';

export function useRealtimeRevision() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const update = () => setRevision(v => v + 1);
    window.addEventListener('lunch:status-changed', update);
    return () => window.removeEventListener('lunch:status-changed', update);
  }, []);
  return revision;
}
export function RealtimeSync() {
  const router = useRouter();
  const { data, connection } = useLiveSnapshot<{ revision: string }>('/v1/tracking/events');
  const previous = useRef('');
  useEffect(() => {
    if (!data || data.revision === previous.current) return;
    previous.current = data.revision;
    window.dispatchEvent(new Event('lunch:status-changed'));
    router.refresh();
  }, [data, router]);
  if (connection === 'LIVE' || connection === 'CONNECTING') return null;
  return <div role="status" className="border-b bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
    {connection === 'ACCESS_LOST' ? <a href="/login" className="underline">Live updates stopped. Sign in again to continue.</a> :
      connection === 'OFFLINE' ? 'You’re offline. Displayed statuses may be out of date.' : 'Reconnecting live updates… Displayed statuses may be out of date.'}
  </div>;
}
