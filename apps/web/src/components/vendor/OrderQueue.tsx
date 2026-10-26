'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { OrderItemStatus, formatCurrency, type VendorOrderItem } from '@lunch/shared';
import { apiClient } from '@/lib/api.client';
import { toFormErrors } from '@/lib/form';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/States';

/** The next step for each status, so one button does the obvious thing. */
const NEXT_STATUS: Partial<Record<OrderItemStatus, { to: OrderItemStatus; label: string }>> = {
  [OrderItemStatus.CONFIRMED]: { to: OrderItemStatus.PREPARING, label: 'Start preparing' },
  [OrderItemStatus.PREPARING]: { to: OrderItemStatus.PACKED, label: 'Mark packed' },
};

/**
 * The kitchen's working screen.
 *
 * Items are grouped by time slot then checkpoint, because that is the order a
 * kitchen actually cooks and packs in — one drop at a time. Each group can be
 * advanced as a batch, which is how a kitchen works; per-item buttons remain
 * for exceptions.
 */
export function OrderQueue({ items }: { items: VendorOrderItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, { date: string; slot: string; checkpoint: string; items: VendorOrderItem[] }>();
    for (const item of items) {
      const key = `${item.serviceDate}::${item.timeSlot.id}::${item.checkpoint.id}`;
      const group = map.get(key);
      if (group) group.items.push(item);
      else map.set(key, { date: item.serviceDate, slot: item.timeSlot.label, checkpoint: item.checkpoint.name, items: [item] });
    }
    return [...map.entries()].map(([key, value]) => ({ key, ...value }));
  }, [items]);

  async function advanceOne(item: VendorOrderItem) {
    const next = NEXT_STATUS[item.status];
    if (!next) return;

    setError(null);
    setNotice(null);
    setBusy(item.id);
    try {
      await apiClient.patch(`/v1/vendor/orders/${item.id}/status`, { status: next.to });
      router.refresh();
    } catch (err) {
      const { formError, fields } = toFormErrors(err);
      setError(formError ?? Object.values(fields)[0] ?? 'That change was not accepted.');
    } finally {
      setBusy(null);
    }
  }

  async function advanceGroup(groupKey: string, groupItems: VendorOrderItem[]) {
    // Only items sharing the same next step can move together.
    const movable = groupItems.filter((i) => NEXT_STATUS[i.status]);
    if (movable.length === 0) return;

    const target = NEXT_STATUS[movable[0]!.status]!.to;
    const sameStep = movable.filter((i) => NEXT_STATUS[i.status]?.to === target);

    setError(null);
    setNotice(null);
    setBusy(groupKey);
    try {
      const result = await apiClient.post<{
        updated: string[];
        skipped: { orderItemId: string; reason: string }[];
      }>('/v1/vendor/orders/bulk-status', {
        orderItemIds: sameStep.map((i) => i.id),
        status: target,
      });

      if (result.skipped.length > 0) {
        setNotice(
          `${result.updated.length} updated, ${result.skipped.length} skipped: ${result.skipped[0]?.reason}`
        );
      }
      router.refresh();
    } catch (err) {
      const { formError, fields } = toFormErrors(err);
      setError(formError ?? Object.values(fields)[0] ?? 'That change was not accepted.');
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing in the queue"
        description="Orders for this date and filter will appear here as they come in."
      />
    );
  }

  return (
    <div className="space-y-5">
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="warning">{notice}</Alert>}

      {groups.map((group) => {
        const movable = group.items.filter((i) => NEXT_STATUS[i.status]);
        const nextLabel = movable.length > 0 ? NEXT_STATUS[movable[0]!.status]!.label : null;
        const batchCount = movable.filter(
          (i) => NEXT_STATUS[i.status]?.to === NEXT_STATUS[movable[0]!.status]?.to
        ).length;

        return (
          <section key={group.key} className="rounded-lg border border-slate-200 bg-white">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900">{group.checkpoint}</h3>
                <p className="text-xs text-slate-500">
                  {group.date} · {group.slot} · {group.items.reduce((total, item) => total + item.quantity, 0)} meals
                </p>
              </div>
              {nextLabel && (
                <Button
                  size="sm"
                  loading={busy === group.key}
                  onClick={() => advanceGroup(group.key, group.items)}
                >
                  {nextLabel} all ({batchCount})
                </Button>
              )}
            </header>

            <ul className="divide-y divide-slate-100">
              {group.items.map((item) => {
                const next = NEXT_STATUS[item.status];
                return (
                  <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-slate-900">
                          {item.quantity} × {item.mealName}
                        </p>
                        <StatusBadge status={item.status} />
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        For {item.beneficiaryName} · {item.orderNumber} ·{' '}
                        {formatCurrency(item.lineTotal)}
                      </p>
                      {item.allergies && (
                        <p className="mt-1 inline-block rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-inset ring-amber-200">
                          Allergies: {item.allergies}
                        </p>
                      )}
                      {item.notes && (
                        <p className="mt-1 text-xs italic text-slate-500">{item.notes}</p>
                      )}
                    </div>

                    {next && (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy === item.id}
                        onClick={() => advanceOne(item)}
                      >
                        {next.label}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
