import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { AuthPrincipal, RiderEtaInput, RiderLocationInput, TrackedMeal, TrackingSnapshot } from '@lunch/shared';
import { prisma } from '../../core/prisma';
import { badRequest, conflict, notFound } from '../../core/errors';
import { paymentTransaction } from '../payments/transaction';
import { cityToday, slotInstant } from '../subscriptions/recurrence';

const LIVE_MS = 90_000;
const LEASE_MS = 120_000;
const terminal = new Set(['DELIVERED', 'FAILED', 'CANCELLED', 'REFUNDED']);
export function customerScope(userId: string): Prisma.OrderItemWhereInput {
  // Linked parents see only their child's items, never the rest of another buyer's order.
  return { OR: [{ order: { customerId: userId } }, { child: { parentId: userId, isActive: true, deletedAt: null } }] };
}
const itemInclude = {
  order: { select: { id: true, orderNumber: true, status: true, createdAt: true } },
  checkpoint: { select: { name: true, instructions: true, latitude: true, longitude: true, city: { select: { timezone: true } } } },
  timeSlot: { select: { label: true, startMinute: true, endMinute: true } },
  delivery: { include: { deliveryStop: { include: { deliveryRun: { include: {
    tracking: true,
    deliveryPartner: { select: { id: true, isActive: true, deletedAt: true, user: { select: { status: true, deletedAt: true } } } },
  } } } } } },
} satisfies Prisma.OrderItemInclude;
type Item = Prisma.OrderItemGetPayload<{ include: typeof itemInclude }>;
export function scheduledEnd(item: { serviceDate: Date; timeSlot: { startMinute: number; endMinute: number }; checkpoint: { city: { timezone: string } } }) {
  const { startMinute, endMinute } = item.timeSlot;
  return slotInstant(item.serviceDate, endMinute + (endMinute < startMinute ? 1440 : 0), item.checkpoint.city.timezone);
}
function mealDto(item: Item, now: Date): TrackedMeal {
  const d = item.delivery;
  const run = d?.deliveryStop?.deliveryRun;
  const p = run?.deliveryPartner;
  const t = run?.tracking;
  const done = terminal.has(item.status) || terminal.has(item.order.status) || (d && terminal.has(d.status));
  const active = !done && !!run?.departedAt && run.status === 'IN_PROGRESS' &&
    run.serviceDate.getTime() === cityToday(item.checkpoint.city.timezone, now).getTime() &&
    p?.isActive && !p.deletedAt && p.user.status === 'ACTIVE' && !p.user.deletedAt &&
    d?.deliveryPartnerId === p.id;
  const consented = active && t?.deliveryPartnerId === p?.id;
  const fresh = consented && t && t.expiresAt > now && t.observedAt &&
    now.getTime() - t.observedAt.getTime() <= LIVE_MS;
  const state: TrackedMeal['location']['state'] = done ? 'COMPLETE' : !active ? 'UNAVAILABLE' :
    !consented ? 'NOT_SHARING' : fresh ? 'LIVE' : 'STALE';
  const end = scheduledEnd(item);
  const timeline: TrackedMeal['timeline'] = [{ label: 'Order placed', at: item.order.createdAt.toISOString() }];
  const events: [string, Date | null | undefined][] = [
    ['Preparing', item.preparingAt], ['Packed', item.packedAt], ['Picked up', d?.pickedUpAt],
    ['Out for delivery', d?.outForDeliveryAt], ['At checkpoint', d?.arrivedAt],
    ['OTP verified', d?.verifiedAt], ['Delivered', d?.deliveredAt], ['Delivery failed', d?.failedAt],
    ['Cancelled', item.cancelledAt],
  ];
  for (const [label, at] of events) if (at) timeline.push({ label, at: at.toISOString() });
  timeline.sort((a, b) => a.at.localeCompare(b.at));
  const etaFresh = fresh && t?.estimatedArrivalAt && t.etaReportedAt &&
    t.etaStopId === d?.deliveryStopId && d?.deliveryStop?.status === 'PENDING' &&
    t.estimatedArrivalAt > now && now.getTime() - t.etaReportedAt.getTime() < 15 * 60_000;
  return {
    id: item.id, orderId: item.order.id, orderNumber: item.order.orderNumber, orderStatus: item.order.status,
    beneficiary: item.beneficiaryName, meal: item.mealNameSnapshot, quantity: item.quantity,
    status: item.status, deliveryStatus: d?.status ?? null,
    checkpoint: { name: item.checkpoint.name, instructions: item.checkpoint.instructions, latitude: item.checkpoint.latitude, longitude: item.checkpoint.longitude },
    window: { start: slotInstant(item.serviceDate, item.timeSlot.startMinute, item.checkpoint.city.timezone).toISOString(),
      end: end.toISOString(), timezone: item.checkpoint.city.timezone, label: item.timeSlot.label },
    timeline, deliveredAt: d?.deliveredAt?.toISOString() ?? null, verifiedAt: d?.verifiedAt?.toISOString() ?? null,
    late: !done && !['PENDING', 'AWAITING_PAYMENT', 'PAYMENT_FAILED'].includes(item.order.status) && end < now,
    location: { state, latitude: fresh ? t!.latitude : null, longitude: fresh ? t!.longitude : null,
      accuracy: fresh ? t!.accuracy : null, observedAt: consented ? t?.observedAt?.toISOString() ?? null : null,
      expiresAt: fresh ? new Date(Math.min(t!.expiresAt.getTime(), t!.observedAt!.getTime() + LIVE_MS)).toISOString() : null },
    eta: etaFresh ? { at: t!.estimatedArrivalAt!.toISOString(), reportedAt: t!.etaReportedAt!.toISOString(),
      expiresAt: new Date(Math.min(t!.estimatedArrivalAt!.getTime(), t!.etaReportedAt!.getTime() + 15 * 60_000)).toISOString(), source: 'RIDER' } : null,
  };
}
export async function trackingSnapshot(userId: string, page: number, orderId?: string): Promise<TrackingSnapshot> {
  const now = new Date();
  const meals = await prisma.orderItem.findMany({
    where: { AND: [customerScope(userId), orderId ? { orderId } : {
      // Recent deliveries and upcoming meals; pagination is bounded per request.
      serviceDate: { gte: new Date(now.getTime() - 2 * 86400000), lte: new Date(now.getTime() + 7 * 86400000) },
    }] }, include: itemInclude, orderBy: [{ serviceDate: 'desc' }, { id: 'asc' }], take: 21, skip: (page - 1) * 20,
  });
  if (orderId && page === 1 && !meals.length) throw notFound('Order');
  return { serverTime: now.toISOString(), meals: meals.slice(0, 20).map(i => mealDto(i, now)), page, hasMore: meals.length > 20 };
}

async function ownRun(tx: Prisma.TransactionClient, userId: string, routeId: string) {
  // Serialize consent/location writes with reassignment and route completion.
  await tx.$queryRaw`SELECT id FROM delivery_runs WHERE id=${routeId} FOR UPDATE`;
  const run = await tx.deliveryRun.findFirst({ where: { id: routeId, deliveryPartner: { userId, isActive: true, deletedAt: null } },
    include: { kitchen: { select: { city: { select: { timezone: true } } } }, tracking: true } });
  if (!run) throw notFound('Assigned route');
  return run;
}
function assertActive(run: Awaited<ReturnType<typeof ownRun>>) {
  if (run.status !== 'IN_PROGRESS' || !run.departedAt || run.serviceDate.getTime() !== cityToday(run.kitchen.city.timezone).getTime())
    throw conflict('Start today’s assigned route before sharing location');
}
export async function startSharing(userId: string, routeId: string) {
  return paymentTransaction(async tx => {
    const run = await ownRun(tx, userId, routeId); assertActive(run);
    const data = { deliveryPartnerId: run.deliveryPartnerId!, sessionId: randomUUID(), expiresAt: new Date(Date.now() + LEASE_MS),
      latitude: null, longitude: null, accuracy: null, observedAt: null, receivedAt: null,
      etaStopId: null, estimatedArrivalAt: null, etaReportedAt: null };
    await tx.deliveryRunTracking.upsert({ where: { deliveryRunId: routeId }, create: { deliveryRunId: routeId, ...data }, update: data });
    return { sessionId: data.sessionId };
  });
}
export async function stopSharing(userId: string, routeId: string, sessionId: string) {
  return paymentTransaction(async tx => {
    await ownRun(tx, userId, routeId);
    await tx.deliveryRunTracking.deleteMany({ where: { deliveryRunId: routeId, sessionId } });
    return { sharing: false };
  });
}
function assertSession(run: Awaited<ReturnType<typeof ownRun>>, sessionId: string) {
  assertActive(run);
  if (!run.tracking || run.tracking.sessionId !== sessionId || run.tracking.deliveryPartnerId !== run.deliveryPartnerId || run.tracking.expiresAt <= new Date())
    throw conflict('Location sharing expired or stopped. Start sharing again.');
}
export async function updateLocation(userId: string, routeId: string, input: RiderLocationInput) {
  const observed = new Date(input.observedAt);
  if (observed.getTime() > Date.now() + 10_000 || Date.now() - observed.getTime() > 60_000)
    throw badRequest('Location must be a recent GPS reading');
  return paymentTransaction(async tx => {
    const run = await ownRun(tx, userId, routeId); assertSession(run, input.sessionId);
    if (run.tracking!.observedAt && observed <= run.tracking!.observedAt) return { accepted: false };
    await tx.deliveryRunTracking.update({ where: { deliveryRunId: routeId }, data: {
      latitude: input.latitude, longitude: input.longitude, accuracy: input.accuracy, observedAt: observed,
      receivedAt: new Date(), expiresAt: new Date(Date.now() + LEASE_MS),
    } });
    return { accepted: true };
  });
}
export async function updateEta(userId: string, routeId: string, input: RiderEtaInput) {
  const at = input.estimatedArrivalAt ? new Date(input.estimatedArrivalAt) : null;
  if (at && (at.getTime() <= Date.now() || at.getTime() > Date.now() + 120 * 60_000)) throw badRequest('Estimate must be within the next two hours');
  return paymentTransaction(async tx => {
    const run = await ownRun(tx, userId, routeId); assertSession(run, input.sessionId);
    const next = await tx.deliveryStop.findFirst({ where: { deliveryRunId: routeId, status: { in: ['PENDING', 'ARRIVED'] } }, orderBy: { sequence: 'asc' } });
    if (!next || next.id !== input.stopId || next.status !== 'PENDING') throw conflict('Only estimate arrival at your next pending checkpoint');
    await tx.deliveryRunTracking.update({ where: { deliveryRunId: routeId }, data: { etaStopId: next.id, estimatedArrivalAt: at, etaReportedAt: at ? new Date() : null } });
    return { saved: true };
  });
}

/** Only an opaque revision leaves this endpoint. All dashboard data keeps its existing API permissions. */
export async function dashboardRevision(principal: AuthPrincipal) {
  const { userId, role } = principal;
  let scope: Prisma.OrderItemWhereInput = customerScope(userId);
  if (role === 'SUPER_ADMIN') scope = {};
  if (role === 'VENDOR') scope = { kitchen: { isActive: true, deletedAt: null, OR: [
    { vendor: { ownerUserId: userId } }, { staff: { some: { userId } } },
  ] } };
  if (role === 'DELIVERY_PARTNER') scope = { delivery: { deliveryPartner: { userId, isActive: true, deletedAt: null } } };
  if (role === 'INSTITUTION_ADMIN') scope = { checkpoint: { institution: { isActive: true, members: { some: { userId, isActive: true, role: 'ADMIN' } } } } };
  const values = await Promise.all([
    prisma.orderItem.aggregate({ where: scope, _count: true, _max: { updatedAt: true } }),
    prisma.order.aggregate({ where: { items: { some: scope } }, _count: true, _max: { updatedAt: true } }),
    prisma.delivery.aggregate({ where: { orderItem: scope }, _count: true, _max: { updatedAt: true } }),
    prisma.notification.aggregate({ where: { userId }, _count: true, _max: { createdAt: true, readAt: true } }),
    prisma.deliveryRun.aggregate({ where: role === 'SUPER_ADMIN' ? {} : role === 'DELIVERY_PARTNER' ? {
      deliveryPartner: { userId, isActive: true, deletedAt: null },
    } : { stops: { some: { deliveries: { some: { orderItem: scope } } } } }, _count: true, _max: { updatedAt: true } }),
  ]);
  return { revision: createHash('sha256').update(JSON.stringify([role, values])).digest('hex') };
}
