/**
 * The vendor's order queue.
 *
 * The guarantee this file exists to uphold: **a vendor can only see and move
 * order items produced by their own kitchens.** Every query carries
 * `kitchen: { vendorId }` in its `where` clause — ownership is part of the
 * lookup, never a check performed afterwards — so an item belonging to another
 * vendor is simply not found, and the API does not confirm it exists.
 */
import type { Prisma } from '@prisma/client';
import {
  OrderItemStatus,
  TERMINAL_ORDER_ITEM_STATUSES,
  VENDOR_STATUS_TRANSITIONS,
  type BulkUpdateOrderItemStatusInput,
  type ListVendorOrdersQuery,
  type PaginatedResult,
  type UpdateOrderItemStatusInput,
  type VendorOrderItem,
} from '@lunch/shared';
import { ErrorCode } from '@lunch/shared';
import { notFound, unprocessable } from '../../core/errors';
import { buildPaginatedResult, toMoney, toSkipTake } from '../../core/http';
import { logger } from '../../core/logger';
import { prisma } from '../../core/prisma';

const orderItemSelect = {
  id: true,
  mealNameSnapshot: true,
  beneficiaryName: true,
  quantity: true,
  unitPrice: true,
  lineTotal: true,
  status: true,
  serviceDate: true,
  notes: true,
  createdAt: true,
  order: { select: { orderNumber: true } },
  timeSlot: { select: { id: true, label: true } },
  checkpoint: { select: { id: true, name: true } },
  kitchen: { select: { id: true, name: true } },
  // The kitchen must see allergies; they come from the child, or the buyer.
  child: { select: { allergies: true } },
} satisfies Prisma.OrderItemSelect;

type OrderItemRow = Prisma.OrderItemGetPayload<{ select: typeof orderItemSelect }>;

function toVendorOrderItem(row: OrderItemRow): VendorOrderItem {
  return {
    id: row.id,
    orderNumber: row.order.orderNumber,
    mealName: row.mealNameSnapshot,
    beneficiaryName: row.beneficiaryName,
    quantity: row.quantity,
    unitPrice: toMoney(row.unitPrice),
    lineTotal: toMoney(row.lineTotal),
    status: row.status as OrderItemStatus,
    serviceDate: row.serviceDate.toISOString().slice(0, 10),
    timeSlot: row.timeSlot,
    checkpoint: row.checkpoint,
    kitchen: row.kitchen,
    notes: row.notes,
    allergies: row.child?.allergies ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Midnight UTC today, matching the `@db.Date` columns. */
function todayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function serviceDateFilter(query: ListVendorOrdersQuery): Prisma.OrderItemWhereInput {
  if (query.range === 'date' && query.serviceDate) {
    return { serviceDate: new Date(`${query.serviceDate}T00:00:00Z`) };
  }
  if (query.range === 'upcoming') {
    const tomorrow = todayUtc();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return { serviceDate: { gte: tomorrow } };
  }
  return { serviceDate: todayUtc() };
}

/** The scoping clause. Nothing in this module queries order items without it. */
function vendorScope(vendorId: string): Prisma.OrderItemWhereInput {
  return { kitchen: { vendorId } };
}

export async function listOrders(
  vendorId: string,
  query: ListVendorOrdersQuery
): Promise<PaginatedResult<VendorOrderItem>> {
  const where: Prisma.OrderItemWhereInput = {
    ...vendorScope(vendorId),
    ...serviceDateFilter(query),
    ...(query.status ? { status: query.status } : {}),
    ...(query.kitchenId ? { kitchenId: query.kitchenId } : {}),
    ...(query.timeSlotId ? { timeSlotId: query.timeSlotId } : {}),
    ...(query.checkpointId ? { checkpointId: query.checkpointId } : {}),
  };

  const { skip, take } = toSkipTake(query);
  const [rows, total] = await prisma.$transaction([
    prisma.orderItem.findMany({
      where,
      select: orderItemSelect,
      // The production queue reads in service order: date, then slot, then
      // checkpoint, so a packer works through one drop at a time.
      orderBy: [
        { serviceDate: 'asc' },
        { timeSlot: { startMinute: 'asc' } },
        { checkpoint: { name: 'asc' } },
        { createdAt: 'asc' },
      ],
      skip,
      take,
    }),
    prisma.orderItem.count({ where }),
  ]);

  return buildPaginatedResult(rows.map(toVendorOrderItem), total, query);
}

export async function getOrderItem(
  vendorId: string,
  orderItemId: string
): Promise<VendorOrderItem> {
  const row = await prisma.orderItem.findFirst({
    where: { id: orderItemId, ...vendorScope(vendorId) },
    select: orderItemSelect,
  });
  if (!row) throw notFound('Order item');
  return toVendorOrderItem(row);
}

/** Rejects a move that is not on the vendor's pipeline. */
function assertTransitionAllowed(from: OrderItemStatus, to: OrderItemStatus): void {
  if (TERMINAL_ORDER_ITEM_STATUSES.includes(from)) {
    throw unprocessable(
      ErrorCode.INVALID_STATE_TRANSITION,
      `This item is already ${from.toLowerCase()} and cannot be changed.`
    );
  }

  const allowed = VENDOR_STATUS_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw unprocessable(
      ErrorCode.INVALID_STATE_TRANSITION,
      allowed.length === 0
        ? `An item that is ${from.toLowerCase()} is no longer the kitchen's to change.`
        : `An item that is ${from.toLowerCase()} can only move to ${allowed
            .map((s) => s.toLowerCase())
            .join(' or ')}.`
    );
  }
}

/** Timestamps that go with a status, so the dashboard can measure throughput. */
function statusTimestamps(status: OrderItemStatus): Prisma.OrderItemUpdateInput {
  switch (status) {
    case OrderItemStatus.PREPARING:
      return { preparingAt: new Date() };
    case OrderItemStatus.PACKED:
      return { packedAt: new Date() };
    case OrderItemStatus.CANCELLED:
      return { cancelledAt: new Date() };
    default:
      return {};
  }
}

async function syncOrderStatuses(
  tx: Prisma.TransactionClient,
  orderIds: string[]
): Promise<void> {
  for (const orderId of new Set(orderIds)) {
    const items = await tx.orderItem.findMany({
      where: { orderId },
      select: { status: true },
    });
    const statuses = items.map((item) => item.status as OrderItemStatus);
    let status: string = 'PENDING';
    if (statuses.length > 0 && statuses.every((itemStatus) => itemStatus === OrderItemStatus.CANCELLED)) {
      status = 'CANCELLED';
    } else if (statuses.some((itemStatus) => itemStatus === OrderItemStatus.FAILED)) {
      status = 'FAILED';
    } else if (statuses.length > 0 && statuses.every((itemStatus) => itemStatus === OrderItemStatus.DELIVERED)) {
      status = 'DELIVERED';
    } else if (statuses.includes(OrderItemStatus.AT_CHECKPOINT)) {
      status = 'AT_CHECKPOINT';
    } else if (statuses.includes(OrderItemStatus.OUT_FOR_DELIVERY)) {
      status = 'OUT_FOR_DELIVERY';
    } else if (statuses.includes(OrderItemStatus.ASSIGNED) || statuses.includes(OrderItemStatus.DISPATCHED)) {
      status = 'ASSIGNED';
    } else if (statuses.includes(OrderItemStatus.PACKED)) {
      status = 'PACKED';
    } else if (statuses.includes(OrderItemStatus.PREPARING)) {
      status = 'PREPARING';
    } else if (statuses.includes(OrderItemStatus.CONFIRMED)) {
      status = 'CONFIRMED';
    } else if (statuses.includes(OrderItemStatus.CANCELLED)) {
      status = 'PARTIALLY_FULFILLED';
    }
    await tx.order.update({ where: { id: orderId }, data: { status: status as never } });
  }
}

export async function updateOrderItemStatus(
  vendorId: string,
  orderItemId: string,
  input: UpdateOrderItemStatusInput
): Promise<VendorOrderItem> {
  // Ownership is established by the lookup itself.
  const existing = await prisma.orderItem.findFirst({
    where: { id: orderItemId, ...vendorScope(vendorId) },
    select: { id: true, orderId: true, mealScheduleId: true, quantity: true, status: true },
  });
  if (!existing) throw notFound('Order item');

  assertTransitionAllowed(existing.status as OrderItemStatus, input.status);

  await prisma.$transaction(async (tx) => {
    await tx.orderItem.update({
      where: { id: orderItemId },
      data: {
        status: input.status,
        ...statusTimestamps(input.status),
        ...(input.reason ? { notes: input.reason } : {}),
      },
    });
    if (input.status === OrderItemStatus.CANCELLED && existing.mealScheduleId) {
      await tx.mealSchedule.updateMany({
        where: { id: existing.mealScheduleId, reservedQuantity: { gte: existing.quantity } },
        data: { reservedQuantity: { decrement: existing.quantity } },
      });
    }
    await syncOrderStatuses(tx, [existing.orderId]);
  });

  logger.info(
    { vendorId, orderItemId, from: existing.status, to: input.status },
    'Order item status changed by vendor'
  );

  return getOrderItem(vendorId, orderItemId);
}

export interface BulkStatusResult {
  updated: string[];
  /** Items that could not move, with the reason, so the UI can explain. */
  skipped: { orderItemId: string; reason: string }[];
}

/**
 * Moves several items at once — a kitchen confirms or packs a whole slot, not
 * one meal at a time.
 *
 * Items that cannot legally move are reported rather than failing the batch:
 * one already-cancelled item should not block packing the other forty.
 */
export async function bulkUpdateOrderItemStatus(
  vendorId: string,
  input: BulkUpdateOrderItemStatusInput
): Promise<BulkStatusResult> {
  const rows = await prisma.orderItem.findMany({
    where: { id: { in: input.orderItemIds }, ...vendorScope(vendorId) },
    select: { id: true, orderId: true, status: true },
  });

  const found = new Set(rows.map((r) => r.id));
  const result: BulkStatusResult = { updated: [], skipped: [] };

  // Ids that matched nothing belong to another vendor or do not exist. Both
  // are reported identically, so the response is not an existence oracle.
  for (const id of input.orderItemIds) {
    if (!found.has(id)) result.skipped.push({ orderItemId: id, reason: 'Not found' });
  }

  const movable: string[] = [];
  for (const row of rows) {
    try {
      assertTransitionAllowed(row.status as OrderItemStatus, input.status);
      movable.push(row.id);
    } catch (err) {
      result.skipped.push({
        orderItemId: row.id,
        reason: err instanceof Error ? err.message : 'Cannot be changed',
      });
    }
  }

  if (movable.length > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.orderItem.updateMany({
        where: { id: { in: movable }, ...vendorScope(vendorId) },
        data: { status: input.status, ...statusTimestamps(input.status) },
      });
      await syncOrderStatuses(
        tx,
        rows.filter((row) => movable.includes(row.id)).map((row) => row.orderId)
      );
    });
    result.updated = movable;
  }

  logger.info(
    { vendorId, updated: result.updated.length, skipped: result.skipped.length, to: input.status },
    'Bulk order item status change'
  );

  return result;
}
