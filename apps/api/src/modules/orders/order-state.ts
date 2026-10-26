import type { OrderItemStatus, OrderStatus, Prisma } from '@prisma/client';
import { releaseCorporateFunding } from '../corporate/funding';

/** Financial states belong to checkout/payment; fulfilment is rolled up here only.
 * A failed/cancelled line must not prevent the remaining paid lines being delivered. */
export function deriveOrderStatus(current: OrderStatus, items: OrderItemStatus[]): OrderStatus {
  if (!items.length) return current;
  if (current === 'REFUNDED' || current === 'CANCELLED') return current;
  if (items.every(s => s === 'CANCELLED')) return 'CANCELLED';
  if (['AWAITING_PAYMENT', 'PAYMENT_FAILED'].includes(current)) return current;
  if (items.every(s => s === 'DELIVERED')) return 'DELIVERED';
  if (items.every(s => s === 'FAILED')) return 'FAILED';
  if (items.every(s => ['DELIVERED', 'FAILED', 'CANCELLED'].includes(s))) return 'PARTIALLY_FULFILLED';
  for (const status of ['AT_CHECKPOINT', 'OUT_FOR_DELIVERY', 'PICKED_UP', 'ASSIGNED', 'DISPATCHED', 'PACKED', 'PREPARING', 'CONFIRMED', 'PENDING'] as const) {
    if (items.includes(status)) return status === 'DISPATCHED' ? 'ASSIGNED' : status;
  }
  return current;
}

/** Callers lock orders before changing items; update the persisted status in the
 * same transaction, so lists, analytics and detail endpoints read identical state. */
export async function syncOrderStatuses(tx: Prisma.TransactionClient, orderIds: string[]): Promise<void> {
  for (const id of [...new Set(orderIds)].sort()) {
    const order = await tx.order.findUniqueOrThrow({ where: { id }, select: { status: true, items: { select: { status: true } } } });
    const status = deriveOrderStatus(order.status, order.items.map(i => i.status));
    if (status === 'CANCELLED') await releaseCorporateFunding(tx, id);
    await tx.order.update({ where: { id }, data: { status } });
  }
}
