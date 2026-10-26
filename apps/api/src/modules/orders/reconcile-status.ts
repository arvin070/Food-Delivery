import { prisma } from '../../core/prisma';
import { deriveOrderStatus, syncOrderStatuses } from './order-state';

/** Maintenance only: no public route. Does not modify items, payments, stock or
 * send historical notifications. Re-read under the same lock as fulfilment. */
export async function reconcileOrderStatus(id: string, apply = false) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${id} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id }, select: { status: true, items: { select: { status: true } } } });
    if (!order) return { changed: false, applied: false };
    const status = deriveOrderStatus(order.status, order.items.map(i => i.status));
    if (status === order.status) return { changed: false, applied: false };
    if (apply) {
      await syncOrderStatuses(tx, [id]);
      await tx.auditLog.create({ data: {
        action: 'order.status.reconciled', entityType: 'Order', entityId: id,
        before: { status: order.status }, after: { status, source: 'module21-maintenance' },
      } });
    }
    return { changed: true, applied: apply };
  });
}

/** One bounded batch; an operator explicitly continues using the cursor. */
export async function reconcileStatusBatch(after = '', apply = false) {
  const orders = await prisma.order.findMany({ where: { id: { gt: after } }, orderBy: { id: 'asc' }, take: 100, select: { id: true } });
  let mismatches = 0, repaired = 0;
  for (const order of orders) {
    const result = await reconcileOrderStatus(order.id, apply);
    if (result.changed) mismatches++;
    if (result.applied) repaired++;
  }
  return { examined: orders.length, mismatches, repaired, nextCursor: orders.length === 100 ? orders[99]!.id : null };
}
