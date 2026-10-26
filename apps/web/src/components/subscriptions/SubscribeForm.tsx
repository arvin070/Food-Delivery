'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Child } from '@lunch/shared';
import { apiClient } from '@/lib/api.client';
import { Button } from '@/components/ui/Button';
export function SubscribeForm({ mealScheduleId, checkpointId, children, serviceDate }: { mealScheduleId: string; checkpointId: string; children: Child[]; serviceDate: string }) {
  const router = useRouter();
  const key = useRef<string>();
  const [plan, setPlan] = useState('WEEKDAYS');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <form className="space-y-3 rounded-lg border border-slate-200 p-4" onChange={() => { key.current = undefined; }} onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError('');
    const form = new FormData(e.currentTarget);
    key.current ??= crypto.randomUUID();
    try {
      const { subscription } = await apiClient.post<{ subscription: { id: string } }>('/v1/subscriptions', { mealScheduleId, checkpointId, plan, childId: form.get('childId') || undefined, startDate: form.get('startDate'), endDate: form.get('endDate') || undefined, quantity: Number(form.get('quantity')), daysOfWeek: form.getAll('days').map(Number), idempotencyKey: key.current });
      router.push(`/subscriptions/${subscription.id}`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not subscribe'); setBusy(false); }
  }}>
    <h2 className="font-semibold">Set up a meal plan</h2>
    <label className="block text-sm">Plan<select className="mt-1 block w-full rounded border p-2" value={plan} onChange={e => setPlan(e.target.value)}>
      <option value="ONE_TIME">One-time order</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly · 7 days</option><option value="MONTHLY">Monthly · 1 calendar month</option><option value="WEEKDAYS">Monday–Friday</option><option value="CUSTOM">Custom selected weekdays</option>
    </select></label>
    <label className="block text-sm">Meal for<select name="childId" className="mt-1 block w-full rounded border p-2"><option value="">Me</option>{children.map(child => <option key={child.id} value={child.id}>{child.fullName}</option>)}</select></label>
    <div className="flex gap-3"><label className="text-sm">Start date<input name="startDate" type="date" defaultValue={serviceDate} required className="mt-1 block rounded border p-2" /></label><label className="text-sm">Meals per day<input name="quantity" type="number" min="1" max="20" defaultValue="1" required className="mt-1 block w-24 rounded border p-2" /></label></div>
    {['DAILY','WEEKDAYS','CUSTOM'].includes(plan) && <label className="block text-sm">End date (optional)<input name="endDate" type="date" className="mt-1 block rounded border p-2" /></label>}
    {plan === 'CUSTOM' && <fieldset><legend className="text-sm">Delivery days</legend><div className="flex flex-wrap gap-3">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((day,i) => <label key={day} className="text-sm"><input type="checkbox" name="days" value={i+1} /> {day}</label>)}</div></fieldset>}
    <p className="text-sm text-slate-500">Meals use this checkpoint and delivery time. Upcoming meals are booked up to seven days ahead, subject to availability. Each meal is billed separately; automatic recurring payments are not enabled.</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <Button disabled={busy} type="submit">{busy ? 'Saving…' : 'Subscribe'}</Button>
  </form>;
}
