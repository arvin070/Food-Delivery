import type { Prisma } from '@prisma/client';
import {
  DeliveryStatus,
  ErrorCode,
  OrderItemStatus,
  type UpdateDeliveryStatusInput,
} from '@lunch/shared';
import { badRequest, conflict, notFound, unprocessable } from '../../core/errors';
import { prisma } from '../../core/prisma';

const deliverySelect = {
  id: true,
  status: true,
  receiverName: true,
  failureReason: true,
  orderItem: {
    select: {
      id: true,
      orderId: true,
      order: { select: { orderNumber: true } },
      mealNameSnapshot: true,
      beneficiaryName: true,
      quantity: true,
      serviceDate: true,
      status: true,
      checkpoint: {
        select: {
          id: true,
          name: true,
          instructions: true,
          address: { select: { line1: true, area: true, cityName: true, postalCode: true } },
        },
      },
      timeSlot: { select: { id: true, label: true } },
      kitchen: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.DeliverySelect;

type DeliveryRow = Prisma.DeliveryGetPayload<{ select: typeof deliverySelect }>;

function toDelivery(row: DeliveryRow) {
  return {
    id: row.id,
    status: row.status as DeliveryStatus,
    receiverName: row.receiverName,
    failureReason: row.failureReason,
    orderItemId: row.orderItem.id,
    orderNumber: row.orderItem.order.orderNumber,
    mealName: row.orderItem.mealNameSnapshot,
    beneficiaryName: row.orderItem.beneficiaryName,
    quantity: row.orderItem.quantity,
    serviceDate: row.orderItem.serviceDate.toISOString().slice(0, 10),
    orderStatus: row.orderItem.status as OrderItemStatus,
    checkpoint: {
      ...row.orderItem.checkpoint,
      addressLabel: row.orderItem.checkpoint.address
        ? [
            row.orderItem.checkpoint.address.line1,
            row.orderItem.checkpoint.address.area,
            row.orderItem.checkpoint.address.cityName,
            row.orderItem.checkpoint.address.postalCode,
          ].filter(Boolean).join(', ')
        : null,
    },
    timeSlot: row.orderItem.timeSlot,
    kitchen: row.orderItem.kitchen,
  };
}

async function syncOrderStatus(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const items = await tx.orderItem.findMany({ where: { orderId }, select: { status: true } });
  const statuses = items.map((item) => item.status as OrderItemStatus);
  let status = 'PENDING';
  if (statuses.length > 0 && statuses.every((itemStatus) => itemStatus === OrderItemStatus.CANCELLED)) status = 'CANCELLED';
  else if (statuses.some((itemStatus) => itemStatus === OrderItemStatus.FAILED)) status = 'FAILED';
  else if (statuses.length > 0 && statuses.every((itemStatus) => itemStatus === OrderItemStatus.DELIVERED)) status = 'DELIVERED';
  else if (statuses.includes(OrderItemStatus.AT_CHECKPOINT)) status = 'AT_CHECKPOINT';
  else if (statuses.includes(OrderItemStatus.OUT_FOR_DELIVERY)) status = 'OUT_FOR_DELIVERY';
  else if (statuses.includes(OrderItemStatus.ASSIGNED) || statuses.includes(OrderItemStatus.DISPATCHED)) status = 'ASSIGNED';
  else if (statuses.includes(OrderItemStatus.PACKED)) status = 'PACKED';
  else if (statuses.includes(OrderItemStatus.PREPARING)) status = 'PREPARING';
  else if (statuses.includes(OrderItemStatus.CONFIRMED)) status = 'CONFIRMED';
  else if (statuses.includes(OrderItemStatus.CANCELLED)) status = 'PARTIALLY_FULFILLED';
  await tx.order.update({ where: { id: orderId }, data: { status: status as never } });
}

export async function listDeliveries(userId: string, isAdmin: boolean) {
  const partner = isAdmin
    ? null
    : await prisma.deliveryPartner.findFirst({
        where: { userId, isActive: true, deletedAt: null },
        select: { id: true },
      });
  if (!isAdmin && !partner) throw notFound('Delivery partner profile');
  const rows = await prisma.delivery.findMany({
    where: {
      ...(partner ? { deliveryPartnerId: partner.id } : {}),
      status: { in: [DeliveryStatus.PENDING, DeliveryStatus.OUT_FOR_DELIVERY, DeliveryStatus.AT_CHECKPOINT] },
    },
    select: deliverySelect,
    orderBy: [
      { orderItem: { serviceDate: 'asc' } },
      { orderItem: { timeSlot: { startMinute: 'asc' } } },
      { orderItem: { checkpoint: { name: 'asc' } } },
    ],
  });
  return rows.map(toDelivery);
}

export async function assignDelivery(orderItemId: string, deliveryPartnerId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const item = await tx.orderItem.findUnique({
      where: { id: orderItemId },
      select: { id: true, orderId: true, status: true, serviceDate: true, kitchenId: true, timeSlotId: true },
    });
    if (!item) throw notFound('Order item');
    if (item.status !== OrderItemStatus.PACKED) {
      throw unprocessable(ErrorCode.INVALID_STATE_TRANSITION, 'Only packed meals can be assigned for delivery.');
    }
    const partner = await tx.deliveryPartner.findFirst({
      where: { id: deliveryPartnerId, isActive: true, isAvailable: true, deletedAt: null },
      select: { id: true },
    });
    if (!partner) throw badRequest('Delivery partner is unavailable', { deliveryPartnerId: ['Choose an active, available delivery partner'] });
    const existing = await tx.delivery.findUnique({ where: { orderItemId }, select: { id: true } });
    if (existing) throw conflict('This order item already has a delivery assignment');
    await tx.delivery.create({ data: { orderItemId, deliveryPartnerId, status: DeliveryStatus.PENDING } });
    await tx.orderItem.update({ where: { id: item.id }, data: { status: OrderItemStatus.ASSIGNED } });
    await syncOrderStatus(tx, item.orderId);
    return tx.delivery.findUniqueOrThrow({ where: { orderItemId }, select: deliverySelect });
  });
  return toDelivery(result);
}

function nextOrderItemStatus(status: DeliveryStatus): OrderItemStatus {
  switch (status) {
    case DeliveryStatus.OUT_FOR_DELIVERY: return OrderItemStatus.OUT_FOR_DELIVERY;
    case DeliveryStatus.AT_CHECKPOINT: return OrderItemStatus.AT_CHECKPOINT;
    case DeliveryStatus.DELIVERED: return OrderItemStatus.DELIVERED;
    case DeliveryStatus.FAILED: return OrderItemStatus.FAILED;
    default: throw badRequest('Unsupported delivery status');
  }
}

export async function updateDeliveryStatus(
  userId: string,
  isAdmin: boolean,
  deliveryId: string,
  input: UpdateDeliveryStatusInput
) {
  const partner = isAdmin
    ? null
    : await prisma.deliveryPartner.findFirst({
        where: { userId, isActive: true, deletedAt: null },
        select: { id: true },
      });
  if (!isAdmin && !partner) throw notFound('Delivery partner profile');

  const row = await prisma.delivery.findFirst({
    where: { id: deliveryId, ...(partner ? { deliveryPartnerId: partner.id } : {}) },
    select: { id: true, status: true, orderItemId: true, orderItem: { select: { id: true, orderId: true } } },
  });
  if (!row) throw notFound('Delivery');

  const current = row.status as DeliveryStatus;
  const allowed: Partial<Record<DeliveryStatus, DeliveryStatus[]>> = {
    [DeliveryStatus.PENDING]: [DeliveryStatus.OUT_FOR_DELIVERY],
    [DeliveryStatus.OUT_FOR_DELIVERY]: [DeliveryStatus.AT_CHECKPOINT],
    [DeliveryStatus.AT_CHECKPOINT]: [DeliveryStatus.DELIVERED, DeliveryStatus.FAILED],
  };
  if (!allowed[current]?.includes(input.status)) {
    throw unprocessable(ErrorCode.INVALID_STATE_TRANSITION, `A delivery that is ${current.toLowerCase()} cannot move to ${input.status.toLowerCase()}.`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.delivery.update({
      where: { id: row.id },
      data: {
        status: input.status,
        ...(input.status === DeliveryStatus.DELIVERED && 'receiverName' in input ? { receiverName: input.receiverName, deliveredAt: new Date() } : {}),
        ...(input.status === DeliveryStatus.FAILED && 'failureReason' in input ? { failureReason: input.failureReason } : {}),
      },
    });
    await tx.orderItem.update({ where: { id: row.orderItemId }, data: { status: nextOrderItemStatus(input.status) } });
    await syncOrderStatus(tx, row.orderItem.orderId);
  });
  const updated = await prisma.delivery.findUniqueOrThrow({ where: { id: row.id }, select: deliverySelect });
  return toDelivery(updated);
}