/**
 * Vendor dashboard.
 *
 * Aggregates are computed in the database with groupBy/aggregate rather than by
 * loading rows and counting in JavaScript — a busy kitchen's day is thousands
 * of items, and the dashboard is the most frequently refreshed screen a vendor
 * has.
 *
 * Every aggregate is scoped by `kitchen: { vendorId }`, the same clause the
 * order queue uses.
 */
import type { Prisma } from '@prisma/client';
import { OrderItemStatus, VendorStatus, type VendorDashboard } from '@lunch/shared';
import { DEFAULT_CURRENCY, fromMinorUnits, toMinorUnits } from '@lunch/shared';
import { prisma } from '../../core/prisma';
import type { VendorContext } from './vendor.context';

function todayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function daysAgo(days: number): Date {
  const d = todayUtc();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

/** Cancelled items are excluded from every revenue figure. */
const EARNING_STATUSES: OrderItemStatus[] = [
  OrderItemStatus.PENDING,
  OrderItemStatus.CONFIRMED,
  OrderItemStatus.PREPARING,
  OrderItemStatus.PACKED,
  OrderItemStatus.DISPATCHED,
  OrderItemStatus.OUT_FOR_DELIVERY,
  OrderItemStatus.DELIVERED,
];

async function sumRevenue(
  vendorId: string,
  from: Date,
  to?: Date
): Promise<string> {
  const result = await prisma.orderItem.aggregate({
    where: {
      kitchen: { vendorId },
      status: { in: EARNING_STATUSES },
      serviceDate: to ? { gte: from, lte: to } : { gte: from },
    },
    _sum: { lineTotal: true },
  });
  return (result._sum.lineTotal ?? 0).toString();
}

export async function getDashboard(context: VendorContext): Promise<VendorDashboard> {
  const { vendorId } = context;
  const today = todayUtc();
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const weekOut = new Date(today);
  weekOut.setUTCDate(weekOut.getUTCDate() + 7);

  const scope: Prisma.OrderItemWhereInput = { kitchen: { vendorId } };

  const [
    todayByStatus,
    upcomingByDate,
    todayRevenue,
    revenue7,
    revenue30,
    slotGroups,
    kitchens,
    timeSlots,
  ] = await Promise.all([
    prisma.orderItem.groupBy({
      by: ['status'],
      where: { ...scope, serviceDate: today },
      _count: { _all: true },
    }),
    prisma.orderItem.groupBy({
      by: ['serviceDate'],
      where: { ...scope, serviceDate: { gte: tomorrow, lte: weekOut }, status: { not: 'CANCELLED' } },
      _count: { _all: true },
      orderBy: { serviceDate: 'asc' },
    }),
    sumRevenue(vendorId, today, today),
    sumRevenue(vendorId, daysAgo(6), today),
    sumRevenue(vendorId, daysAgo(29), today),
    prisma.orderItem.groupBy({
      by: ['timeSlotId'],
      where: { ...scope, serviceDate: today, status: { not: 'CANCELLED' } },
      _sum: { quantity: true },
    }),
    prisma.kitchen.findMany({
      where: { vendorId, deletedAt: null, isActive: true },
      select: { capacityPerSlot: true },
    }),
    prisma.timeSlot.findMany({
      where: { isActive: true },
      select: { id: true, label: true, startMinute: true },
      orderBy: { startMinute: 'asc' },
    }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const group of todayByStatus) byStatus[group.status] = group._count._all;

  const countOf = (...statuses: OrderItemStatus[]) =>
    statuses.reduce((sum, s) => sum + (byStatus[s] ?? 0), 0);

  const totalToday = Object.values(byStatus).reduce((a, b) => a + b, 0);

  // Combined capacity across the vendor's active kitchens, per slot.
  const capacityPerSlot = kitchens.reduce((sum, k) => sum + k.capacityPerSlot, 0);
  const orderedBySlot = new Map(slotGroups.map((g) => [g.timeSlotId, g._sum.quantity ?? 0]));

  const commissionPct = Number.parseFloat(context.commissionPct);
  const todayNetMinor = Math.round(
    toMinorUnits(todayRevenue) * (1 - (Number.isFinite(commissionPct) ? commissionPct : 0) / 100)
  );

  return {
    vendor: {
      id: vendorId,
      businessName: context.businessName,
      status: context.status as VendorStatus,
    },
    today: {
      date: today.toISOString().slice(0, 10),
      totalOrders: totalToday,
      byStatus,
      toPrepare: countOf(
        OrderItemStatus.PENDING,
        OrderItemStatus.CONFIRMED,
        OrderItemStatus.PREPARING
      ),
      packed: countOf(OrderItemStatus.PACKED),
      delivered: countOf(OrderItemStatus.DELIVERED),
    },
    upcoming: {
      totalOrders: upcomingByDate.reduce((sum, g) => sum + g._count._all, 0),
      byDate: upcomingByDate.map((g) => ({
        date: g.serviceDate.toISOString().slice(0, 10),
        count: g._count._all,
      })),
    },
    revenue: {
      currency: DEFAULT_CURRENCY,
      today: Number.parseFloat(todayRevenue).toFixed(2),
      last7Days: Number.parseFloat(revenue7).toFixed(2),
      last30Days: Number.parseFloat(revenue30).toFixed(2),
      todayNet: fromMinorUnits(todayNetMinor),
      commissionPct: context.commissionPct,
    },
    slotLoad: timeSlots
      .map((slot) => ({
        timeSlotId: slot.id,
        label: slot.label,
        ordered: orderedBySlot.get(slot.id) ?? 0,
        capacity: capacityPerSlot,
      }))
      // Only slots with something in them are worth a row.
      .filter((s) => s.ordered > 0 || capacityPerSlot > 0),
  };
}
