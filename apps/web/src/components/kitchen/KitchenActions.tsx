'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { KitchenPreparationGroup, KitchenStatusResult } from '@lunch/shared';
import { apiClient } from '@/lib/api.client';
import { Button } from '@/components/ui/Button';
export function KitchenActions({ kitchenId, serviceDate, group, item, disabled = false }: {
  kitchenId: string; serviceDate: string; group?: KitchenPreparationGroup;
  item?: { id: string; status: string }; disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function advance(status: 'PREPARING' | 'PACKED') {
    setBusy(true); setMessage('');
    try {
      const payload = group ? { serviceDate, status, timeSlotId: group.timeSlotId, checkpointId: group.checkpointId, mealId: group.mealId, mealName: group.mealName, routeId: group.routeId } : { serviceDate, status, orderItemIds: [item!.id] };
      const result = await apiClient.post<KitchenStatusResult>(`/v1/kitchen/${kitchenId}/${group ? 'groups' : 'items'}/status`, payload);
      setMessage(`${result.updated.length} order items updated.${result.unchanged.length ? ` ${result.unchanged.length} already updated.` : ''}${result.skipped.length ? ` ${result.skipped.length} skipped: ${result.skipped[0]?.reason}.` : ''}${result.hasMore ? ' More items remain; repeat to process the next batch.' : ''}`);
      router.refresh();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not update meals'); }
    finally { setBusy(false); }
  }
  const prepare = group ? group.confirmed > 0 : item?.status === 'CONFIRMED';
  const pack = group ? group.preparing > 0 : item?.status === 'PREPARING';
  return <div className="space-y-2 print:hidden"><div className="flex flex-wrap gap-2">
    {prepare && <Button size="sm" disabled={disabled || busy} onClick={() => advance('PREPARING')}>Start preparing{group ? ` (${group.confirmed} meals)` : ''}</Button>}
    {pack && <Button size="sm" variant="secondary" disabled={disabled || busy} onClick={() => advance('PACKED')}>Mark packed{group ? ` (${group.preparing} meals)` : ''}</Button>}
  </div>{message && <p role="status" className="max-w-sm text-xs text-slate-600">{message}</p>}</div>;
}
export function KitchenToolbar() {
  const router = useRouter();
  return <div className="flex gap-2 print:hidden"><Button variant="secondary" onClick={() => router.refresh()}>Refresh</Button><Button variant="secondary" onClick={() => window.print()}>Print list</Button></div>;
}
