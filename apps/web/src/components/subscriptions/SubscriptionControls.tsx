'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api.client';
import { Button } from '@/components/ui/Button';
export function SubscriptionControls({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [results, setResults] = useState<{ date: string; result: string }[]>([]);
  async function act(action: string) {
    setBusy(true); setMessage('');
    try {
      if (action === 'GENERATE') setResults(await apiClient.post(`/v1/subscriptions/${id}/generate`));
      else { await apiClient.post(`/v1/subscriptions/${id}/actions`, { action, ...(action === 'SKIP' ? { date } : {}) }); setMessage('Plan updated.'); }
      router.refresh();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not update plan'); }
    finally { setBusy(false); }
  }
  if (!['ACTIVE','PAUSED'].includes(status)) return null;
  return <section className="space-y-3 rounded-lg border p-4">
    <div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={() => act(status === 'PAUSED' ? 'RESUME' : 'PAUSE')}>{status === 'PAUSED' ? 'Resume' : 'Pause'}</Button><Button disabled={busy} onClick={() => act('CANCEL')}>Cancel subscription</Button>{status === 'ACTIVE' && <Button disabled={busy} onClick={() => act('GENERATE')}>Book upcoming meals</Button>}</div>
    <div className="flex flex-wrap items-end gap-3"><label className="text-sm">Skip a date<input type="date" className="mt-1 block rounded border p-2" value={date} onChange={e => setDate(e.target.value)} /></label><Button disabled={busy || !date} onClick={() => act('SKIP')}>Skip date</Button></div>
    <p className="text-sm text-slate-500">Pause and cancel release meals that have not entered preparation. Resume restores paused meals when capacity is available. Skipped dates stay skipped.</p>
    {message && <p role="status" className="text-sm">{message}</p>}
    {results.length > 0 && <ul aria-label="Booking results" className="space-y-1 text-sm">{results.map(r => <li key={r.date}>{r.date}: {r.result.toLowerCase().replaceAll('_',' ')}</li>)}</ul>}
  </section>;
}
