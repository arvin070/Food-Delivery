'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatCurrency, OrderItemStatus, type CustomerOrder } from '@lunch/shared';
import { apiClient } from '@/lib/api.client';
import { toFormErrors } from '@/lib/form';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';

export function OrderDetails({ order }: { order: CustomerOrder }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const cancellable = order.items.every((item) =>
    item.status === OrderItemStatus.PENDING || item.status === OrderItemStatus.CONFIRMED
  );

  async function cancel() {
    setCancelling(true);
    setError(null);
    try {
      await apiClient.post(`/v1/orders/${order.id}/cancel`, { reason: 'Cancelled by customer' });
      router.refresh();
    } catch (err) {
      const { formError } = toFormErrors(err);
      setError(formError ?? 'This order could not be cancelled.');
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-sm text-slate-500">Order {order.orderNumber}</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">{formatCurrency(order.totalAmount)}</h1>
          <p className="mt-1 text-sm text-slate-500">Payment: {order.paymentStatus.toLowerCase()}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={order.status.toLowerCase()} />
          {cancellable && order.status !== 'CANCELLED' && (
            <Button variant="danger" size="sm" loading={cancelling} onClick={cancel}>Cancel order</Button>
          )}
        </div>
      </div>
      <ul className="divide-y divide-slate-200 border-y border-slate-200">
        {order.items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-start justify-between gap-4 py-4">
            <div>
              <h2 className="font-semibold text-slate-900">{item.quantity} × {item.mealName}</h2>
              <p className="mt-1 text-sm text-slate-600">For {item.beneficiaryName} · {item.kitchen.name}</p>
              <p className="text-sm text-slate-500">{item.serviceDate} · {item.timeSlot.label} · {item.checkpoint.name}</p>
              {item.deliveryStatus && <p className="mt-1 text-xs text-slate-500">Delivery: {item.deliveryStatus.toLowerCase()}</p>}
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge status={item.status.toLowerCase()} />
              <span className="font-medium tabular-nums text-slate-900">{formatCurrency(item.lineTotal)}</span>
            </div>
          </li>
        ))}
      </ul>
      <Link href="/orders" className="text-sm font-semibold text-brand-700">← Order history</Link>
    </div>
  );
}