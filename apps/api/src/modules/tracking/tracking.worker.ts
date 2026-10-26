import { prisma } from '../../core/prisma';
import { logger } from '../../core/logger';
import { env } from '../../config/env';
import { paymentTransaction } from '../payments/transaction';
import { enqueueNotifications } from '../notifications/notification.service';
import { scheduledEnd } from './tracking.service';

/** Bounded, resumable scan. Durable notification uniqueness makes concurrent workers/restarts safe. */
export function startTrackingWorker() {
  let stopped = false;
  let cursor: string | undefined;
  let running: Promise<void> | undefined;
  async function batch() {
    const now = new Date();
    // Erase expired coordinates rather than keeping a rider movement history.
    const expired = await prisma.deliveryRunTracking.findMany({
      where: { OR: [{ expiresAt: { lte: now } }, { deliveryRun: { status: { in: ['COMPLETED', 'CANCELLED'] } } }] },
      select: { deliveryRunId: true, sessionId: true }, take: 100, orderBy: { expiresAt: 'asc' },
    });
    if (expired.length) await prisma.deliveryRunTracking.deleteMany({ where: { OR: expired.map(t => ({
      deliveryRunId: t.deliveryRunId, sessionId: t.sessionId,
      OR: [{ expiresAt: { lte: now } }, { deliveryRun: { status: { in: ['COMPLETED', 'CANCELLED'] } } }],
    })) } });
    const rows = await prisma.orderItem.findMany({
      where: { ...(cursor ? { id: { gt: cursor } } : {}),
        serviceDate: { lte: new Date(now.getTime() + 86400000) },
        status: { in: ['CONFIRMED', 'PREPARING', 'PACKED', 'ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'AT_CHECKPOINT'] },
      }, select: { id: true }, orderBy: { id: 'asc' }, take: 100,
    });
    for (const row of rows) {
      await paymentTransaction(async tx => {
        const item = await tx.orderItem.findUnique({ where: { id: row.id }, include: {
          timeSlot: true, checkpoint: { include: { city: true } }, order: true, child: true,
        } });
        if (!item || ['DELIVERED', 'FAILED', 'CANCELLED', 'PENDING'].includes(item.status) ||
          ['CANCELLED', 'REFUNDED', 'AWAITING_PAYMENT', 'PAYMENT_FAILED', 'PENDING'].includes(item.order.status) ||
          scheduledEnd(item).getTime() + env.TRACKING_LATE_GRACE_MINUTES * 60000 > now.getTime()) return;
        const recipients = new Set([item.order.customerId]);
        if (item.child?.isActive && !item.child.deletedAt) recipients.add(item.child.parentId);
        await enqueueNotifications(tx, [...recipients].map(userId => ({
          userId, event: 'delivery.late' as const, key: `item:${item.id}:delivery.late`, data: {
            beneficiary: item.beneficiaryName, meal: item.mealNameSnapshot, checkpoint: item.checkpoint.name,
          },
        })));
      });
      cursor = row.id;
    }
    if (rows.length < 100) cursor = undefined;
  }
  function tick() {
    if (stopped || running || !env.TRACKING_WORKER_ENABLED) return;
    running = batch().catch(() => logger.warn('Tracking maintenance deferred; next batch will retry')).finally(() => { running = undefined; });
  }
  tick();
  const timer = setInterval(tick, 30_000); timer.unref();
  return async () => { stopped = true; clearInterval(timer); await running; };
}
