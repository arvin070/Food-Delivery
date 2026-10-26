import type { OrderItemStatus } from '@lunch/shared';

const STYLES: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-700 ring-slate-200',
  CONFIRMED: 'bg-blue-50 text-blue-700 ring-blue-200',
  PREPARING: 'bg-amber-50 text-amber-800 ring-amber-200',
  PACKED: 'bg-violet-50 text-violet-700 ring-violet-200',
  ASSIGNED: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  PICKED_UP: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  AT_CHECKPOINT: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  AWAITING_PAYMENT: 'bg-amber-50 text-amber-800 ring-amber-200',
  PAYMENT_FAILED: 'bg-red-50 text-red-700 ring-red-200',
  PARTIALLY_FULFILLED: 'bg-amber-50 text-amber-800 ring-amber-200',
  REFUNDED: 'bg-slate-100 text-slate-700 ring-slate-200',
  DISPATCHED: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  OUT_FOR_DELIVERY: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  DELIVERED: 'bg-green-50 text-green-700 ring-green-200',
  CANCELLED: 'bg-red-50 text-red-700 ring-red-200',
  FAILED: 'bg-red-50 text-red-700 ring-red-200',
  // Vendor statuses
  APPROVED: 'bg-green-50 text-green-700 ring-green-200',
  PENDING_APPROVAL: 'bg-amber-50 text-amber-800 ring-amber-200',
  SUSPENDED: 'bg-red-50 text-red-700 ring-red-200',
  REJECTED: 'bg-red-50 text-red-700 ring-red-200',
  // Generic active / inactive
  ACTIVE: 'bg-green-50 text-green-700 ring-green-200',
  INACTIVE: 'bg-slate-100 text-slate-500 ring-slate-200',
};

const LABELS: Record<string, string> = {
  OUT_FOR_DELIVERY: 'Out for delivery',
  PENDING_APPROVAL: 'Pending approval',
};

export function StatusBadge({ status }: { status: OrderItemStatus | string }) {
  status = status.toUpperCase();
  const label =
    LABELS[status] ?? status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ');

  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
        STYLES[status] ?? 'bg-slate-100 text-slate-700 ring-slate-200'
      }`}
    >
      {label}
    </span>
  );
}
