'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DeliveryStatus, type DeliveryStatus as DeliveryStatusType } from '@lunch/shared';
import { apiClient } from '@/lib/api.client';
import { toFormErrors } from '@/lib/form';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';

export interface DeliveryQueueItem {
  id: string;
  status: DeliveryStatusType;
  orderItemId: string;
  orderNumber: string;
  mealName: string;
  beneficiaryName: string;
  quantity: number;
  serviceDate: string;
  orderStatus: string;
  checkpoint: {
    name: string;
    instructions: string | null;
    addressLabel: string | null;
  };
  timeSlot: { label: string };
  kitchen: { name: string };
}

const NEXT: Partial<Record<DeliveryStatusType, { status: DeliveryStatusType; label: string }>> = {
  [DeliveryStatus.PENDING]: { status: DeliveryStatus.OUT_FOR_DELIVERY, label: 'Start delivery' },
  [DeliveryStatus.OUT_FOR_DELIVERY]: { status: DeliveryStatus.AT_CHECKPOINT, label: 'Arrived at checkpoint' },
};

export function DeliveryQueue({ deliveries }: { deliveries: DeliveryQueueItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [receiverNames, setReceiverNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function update(item: DeliveryQueueItem, status: DeliveryStatusType) {
    setBusy(item.id);
    setError(null);
    try {
      const body = status === DeliveryStatus.DELIVERED
        ? { status, receiverName: receiverNames[item.id] ?? '' }
        : status === DeliveryStatus.FAILED
          ? { status, failureReason: 'Unable to complete handover' }
          : { status };
      await apiClient.patch(`/v1/delivery/items/${item.id}/status`, body);
      router.refresh();
    } catch (err) {
      const { formError, fields } = toFormErrors(err);
      setError(formError ?? Object.values(fields)[0] ?? 'Delivery update failed.');
    } finally {
      setBusy(null);
    }
  }

  if (deliveries.length === 0) {
    return <EmptyState title="No assigned deliveries" description="Assigned checkpoint drops will appear here." />;
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <ul className="divide-y divide-slate-200 border-y border-slate-200">
        {deliveries.map((item) => {
          const next = NEXT[item.status];
          return (
            <li key={item.id} className="flex flex-wrap items-start justify-between gap-4 py-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-slate-900">{item.checkpoint.name}</h2>
                  <StatusBadge status={item.status.toLowerCase()} />
                </div>
                <p className="mt-1 text-sm text-slate-600">{item.serviceDate} · {item.timeSlot.label} · {item.kitchen.name}</p>
                <p className="text-sm text-slate-600">{item.quantity} × {item.mealName} · for {item.beneficiaryName} · {item.orderNumber}</p>
                {item.checkpoint.addressLabel && <p className="mt-1 text-sm text-slate-500">{item.checkpoint.addressLabel}</p>}
                {item.checkpoint.instructions && <p className="mt-1 text-sm text-slate-500">{item.checkpoint.instructions}</p>}
                {item.status === DeliveryStatus.AT_CHECKPOINT && (
                  <label className="mt-3 block max-w-sm text-sm font-medium text-slate-800">
                    Receiver name
                    <input
                      className="mt-1 block w-full rounded-md border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300"
                      value={receiverNames[item.id] ?? ''}
                      onChange={(event) => setReceiverNames({ ...receiverNames, [item.id]: event.target.value })}
                    />
                  </label>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {next && <Button size="sm" loading={busy === item.id} onClick={() => update(item, next.status)}>{next.label}</Button>}
                {item.status === DeliveryStatus.AT_CHECKPOINT && (
                  <>
                    <Button size="sm" loading={busy === item.id} disabled={(receiverNames[item.id] ?? '').trim().length < 2} onClick={() => update(item, DeliveryStatus.DELIVERED)}>Mark delivered</Button>
                    <Button size="sm" variant="danger" loading={busy === item.id} onClick={() => update(item, DeliveryStatus.FAILED)}>Unable to deliver</Button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}