'use client';

import { useState, type FormEvent } from 'react';
import type { CheckpointDetail, CheckpointSummary } from '@lunch/shared';
import { apiClient } from '@/lib/api.client';
import { toFormErrors } from '@/lib/form';

export function CheckpointExceptionManager({ checkpoint, replacements }: { checkpoint: CheckpointDetail; replacements: CheckpointSummary[] }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(''); setError(''); setBusy(true);
    const form = new FormData(event.currentTarget);
    const formElement = event.currentTarget;
    const timeSlotId = String(form.get('timeSlotId') ?? '');
    const replacementCheckpointId = String(form.get('replacementCheckpointId') ?? '');
    if (replacementCheckpointId && !timeSlotId) {
      setError('Choose a specific delivery window before reassigning.'); setBusy(false); return;
    }
    try {
      await apiClient.post(`/v1/checkpoints/${checkpoint.id}/exceptions`, {
        startDate: form.get('startDate'), endDate: form.get('endDate'), reason: form.get('reason'),
        ...(timeSlotId ? { timeSlotId } : {}), ...(replacementCheckpointId ? { replacementCheckpointId } : {}),
      });
      formElement.reset(); setNotice('Checkpoint schedule exception saved. Affected customers were notified if deliveries were reassigned.');
    } catch (cause) { setError(toFormErrors(cause).formError ?? 'Could not save this schedule change.'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 border-t border-slate-200 pt-5">
    <div><h2 className="text-lg font-semibold">Temporary closure or reassignment</h2><p className="text-sm text-slate-500">A reassignment moves future, unassigned orders and notifies buyers and linked parents.</p></div>
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
      <label className="text-sm">From date<input required type="date" name="startDate" className="mt-1 block min-h-11 w-full rounded-md border border-slate-300 px-3" /></label>
      <label className="text-sm">Through date<input required type="date" name="endDate" className="mt-1 block min-h-11 w-full rounded-md border border-slate-300 px-3" /></label>
      <label className="text-sm">Delivery window<select name="timeSlotId" className="mt-1 block min-h-11 w-full rounded-md border border-slate-300 px-3"><option value="">All windows</option>{checkpoint.windows.filter(window => window.isActive).map(window => <option key={window.timeSlotId} value={window.timeSlotId}>{window.timeSlotLabel}</option>)}</select></label>
      <label className="text-sm">Replacement checkpoint<select name="replacementCheckpointId" className="mt-1 block min-h-11 w-full rounded-md border border-slate-300 px-3"><option value="">Close without reassignment</option>{replacements.filter(item => item.id !== checkpoint.id && item.isActive).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="text-sm md:col-span-2">Reason<input required minLength={3} maxLength={300} name="reason" className="mt-1 block min-h-11 w-full rounded-md border border-slate-300 px-3" placeholder="Campus closure, bus route change, office access…" /></label>
      {error && <p role="alert" className="text-sm text-red-700 md:col-span-2">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-800 md:col-span-2">{notice}</p>}
      <div className="md:col-span-2"><button disabled={busy} className="min-h-11 rounded-md bg-slate-900 px-4 font-medium text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save schedule change'}</button></div>
    </form>
  </section>;
}
