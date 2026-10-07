import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  DeliveryStatus,
  ErrorCode,
  OrderItemStatus,
  OrderStatus,
  PaymentStatus,
  type CancelOrderInput,
  type CustomerOrder,
  type ListOrdersQuery,
  type PaginatedResult,
} from '@lunch/shared';
import { badRequest, conflict, notFound, unprocessable } from '../../core/errors';
import { buildPaginatedResult, toMoney, toSkipTake } from '../../core/http';
import { logger } from '../../core/logger';
import { prisma } from '../../core/prisma';
import { assertDeliverySlotCapacity } from '../catalog/catalog.service';
import { loadCartForCheckout } from '../cart/cart.service';

const orderSelect = {
  id: true,
  orderNumber: true,
  status: true,
  subtotal: true,
  totalAmount: true,
  currency: true,
  createdAt: true,
  placedAt: true,
  cancelledAt: true,
  payments: { select: { status: true }, orderBy: { createdAt: 'desc' as const }, take: 1 },
  items: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      mealNameSnapshot: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
      beneficiaryName: true,
      serviceDate: true,
      status: true,
      notes: true,
      checkpoint: { select: { id: true, name: true } },
      timeSlot: { select: { id: true, label: true } },
      kitchen: { select: { id: true, name: true } },
      delivery: { select: { status: true } },
    },
  },
} satisfies Prisma.OrderSelect;

type OrderRow = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

function statusRollup(row: OrderRow): OrderStatus {
  if (row.status === OrderStatus.CANCELLED || row.status === OrderStatus.FAILED) {
    return row.status as OrderStatus;
  }
  const statuses = row.items.map((item) => item.status as OrderItemStatus);
  if (statuses.length > 0 && statuses.every((status) => status === OrderItemStatus.CANCELLED)) {
    return OrderStatus.CANCELLED;
  }
  if (statuses.length > 0 && statuses.every((status) => status === OrderItemStatus.DELIVERED)) {
    return OrderStatus.DELIVERED;
  }
  if (statuses.includes(OrderItemStatus.FAILED)) return OrderStatus.FAILED;
  if (statuses.includes(OrderItemStatus.AT_CHECKPOINT)) return OrderStatus.AT_CHECKPOINT;
  if (statuses.includes(OrderItemStatus.OUT_FOR_DELIVERY)) return OrderStatus.OUT_FOR_DELIVERY;
  if (statuses.includes(OrderItemStatus.ASSIGNED) || statuses.includes(OrderItemStatus.DISPATCHED)) {
    return OrderStatus.ASSIGNED;
  }
  if (statuses.includes(OrderItemStatus.PACKED)) return OrderStatus.PACKED;
  if (statuses.includes(OrderItemStatus.PREPARING)) return OrderStatus.PREPARING;
  if (statuses.includes(OrderItemStatus.CONFIRMED)) return OrderStatus.CONFIRMED;
  if (statuses.includes(OrderItemStatus.CANCELLED)) return OrderStatus.FAILED;
  return row.status === OrderStatus.PENDING ? OrderStatus.PENDING : OrderStatus.CONFIRMED;
}

function toCustomerOrder(row: OrderRow): CustomerOrder {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: statusRollup(row),
    paymentStatus: (row.payments[0]?.status ?? PaymentStatus.CREATED) as PaymentStatus,
    subtotal: toMoney(row.subtotal),
    totalAmount: toMoney(row.totalAmount),
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
    placedAt: row.placedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    items: row.items.map((item) => ({
      id: item.id,
      mealName: item.mealNameSnapshot,
      quantity: item.quantity,
      unitPrice: toMoney(item.unitPrice),
      lineTotal: toMoney(item.lineTotal),
      beneficiaryName: item.beneficiaryName,
      serviceDate: item.serviceDate.toISOString().slice(0, 10),
      checkpoint: item.checkpoint,
      timeSlot: item.timeSlot,
      kitchen: item.kitchen,
      status: item.status as OrderItemStatus,
      deliveryStatus: item.delivery?.status as DeliveryStatus | undefined ?? null,
      notes: item.notes,
    })),
  };
}

function newOrderNumber(): string {
  return `LN-${randomBytes(5).toString('hex').toUpperCase()}`;
}

async function orderByIdempotency(userId: string, key: string): Promise<OrderRow | null> {
  return prisma.order.findUnique({
    where: { customerId_idempotencyKey: { customerId: userId, idempotencyKey: key } },
    select: orderSelect,
  });
}

export async function checkout(userId: string, idempotencyKey: string): Promise<CustomerOrder> {
  const replay = await orderByIdempotency(userId, idempotencyKey);
  if (replay) return toCustomerOrder(replay);

  try {
    const createdOrderId = await prisma.$transaction(async (tx) => {
      const cart = await loadCartForCheckout(tx, userId);
      await tx.$queryRaw`SELECT id FROM "carts" WHERE id = ${cart.cartId} FOR UPDATE`;

      const cartRows = await tx.cartItem.findMany({
        where: { cartId: cart.cartId },
        select: {
          id: true,
          mealScheduleId: true,
          checkpointId: true,
          childId: true,
          quantity: true,
          notes: true,
        },
        orderBy: [{ mealScheduleId: 'asc' }, { checkpointId: 'asc' }, { id: 'asc' }],
      });
      if (cartRows.length === 0) throw badRequest('Your cart is empty');

      const items: {
        cartItemId: string;
        scheduleId: string;
        mealId: string;
        mealName: string;
        kitchenId: string;
        kitchenName: string;
        cityId: string;
        checkpointId: string;
        checkpointName: string;
        timeSlotId: string;
        serviceDate: Date;
        beneficiaryId: string | null;
        beneficiaryName: string;
        quantity: number;
        unitPrice: Prisma.Decimal;
        lineTotal: Prisma.Decimal;
        notes: string | null;
      }[] = [];

      const scheduleIds = [...new Set(cartRows.map((item) => item.mealScheduleId))].sort();
      for (const scheduleId of scheduleIds) {
        await tx.$queryRaw`SELECT id FROM "meal_schedules" WHERE id = ${scheduleId} FOR UPDATE`;
      }

      for (const cartItem of cartRows) {
        const schedule = await tx.mealSchedule.findFirst({
          where: {
            id: cartItem.mealScheduleId,
            status: 'PUBLISHED',
            meal: { isActive: true, deletedAt: null },
            kitchen: {
              isActive: true,
              deletedAt: null,
              vendor: { status: 'APPROVED', isActive: true, deletedAt: null },
            },
            timeSlot: { isActive: true },
          },
          select: {
            id: true,
            mealId: true,
            serviceDate: true,
            timeSlotId: true,
            price: true,
            totalQuantity: true,
            reservedQuantity: true,
            timeSlot: { select: { startMinute: true, orderCutoffMinutes: true } },
            meal: { select: { name: true } },
            kitchen: {
              select: {
                id: true,
                name: true,
                cityId: true,
                capacityPerSlot: true,
              },
            },
          },
        });
        if (!schedule) throw badRequest('A meal in your cart is no longer available');

        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        if (schedule.serviceDate < today) throw badRequest('A delivery date in your cart has passed');
        const cutoff = new Date(schedule.serviceDate);
        cutoff.setUTCMinutes(schedule.timeSlot.startMinute - schedule.timeSlot.orderCutoffMinutes);
        if (Date.now() >= cutoff.getTime()) throw conflict('Ordering cutoff has passed for a cart item');
        if (schedule.totalQuantity - schedule.reservedQuantity < cartItem.quantity) {
          throw conflict('Not enough meal stock remains for a cart item');
        }

        const [checkpoint, serviceArea, window, child] = await Promise.all([
          tx.checkpoint.findFirst({ where: { id: cartItem.checkpointId, isActive: true }, select: { id: true, name: true } }),
          tx.kitchenServiceArea.findFirst({ where: { kitchenId: schedule.kitchen.id, checkpointId: cartItem.checkpointId, isActive: true }, select: { id: true } }),
          tx.checkpointTimeSlot.findFirst({ where: { checkpointId: cartItem.checkpointId, timeSlotId: schedule.timeSlotId, isActive: true, timeSlot: { isActive: true } }, select: { id: true } }),
          cartItem.childId
            ? tx.child.findFirst({ where: { id: cartItem.childId, parentId: userId, isActive: true, deletedAt: null }, select: { id: true, fullName: true } })
            : Promise.resolve(null),
        ]);
        if (!checkpoint || !serviceArea || !window) {
          throw badRequest('A cart item has an invalid checkpoint or delivery window');
        }
        if (cartItem.childId && !child) throw badRequest('A beneficiary in your cart is no longer available');

        const lineTotal = schedule.price.mul(cartItem.quantity);
        items.push({
          cartItemId: cartItem.id,
          scheduleId: schedule.id,
          mealId: schedule.mealId,
          mealName: schedule.meal.name,
          kitchenId: schedule.kitchen.id,
          kitchenName: schedule.kitchen.name,
          cityId: schedule.kitchen.cityId,
          checkpointId: checkpoint.id,
          checkpointName: checkpoint.name,
          timeSlotId: schedule.timeSlotId,
          serviceDate: schedule.serviceDate,
          beneficiaryId: child?.id ?? null,
          beneficiaryName: child?.fullName ?? (await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true } })).fullName,
          quantity: cartItem.quantity,
          unitPrice: schedule.price,
          lineTotal,
          notes: cartItem.notes,
        });
      }

      const capacityGroups = new Map<string, typeof items>();
      for (const item of items) {
        const key = `${item.checkpointId}|${item.timeSlotId}|${item.serviceDate.toISOString().slice(0, 10)}`;
        capacityGroups.set(key, [...(capacityGroups.get(key) ?? []), item]);
      }
      for (const group of capacityGroups.values()) {
        const first = group[0]!;
        await assertDeliverySlotCapacity(tx, {
          checkpointId: first.checkpointId,
          timeSlotId: first.timeSlotId,
          serviceDate: first.serviceDate.toISOString().slice(0, 10),
          quantity: group.reduce((sum, item) => sum + item.quantity, 0),
        });
      }

      const kitchenGroups = new Map<string, typeof items>();
      for (const item of items) {
        const key = `${item.kitchenId}|${item.timeSlotId}|${item.serviceDate.toISOString().slice(0, 10)}`;
        kitchenGroups.set(key, [...(kitchenGroups.get(key) ?? []), item]);
      }
      for (const group of kitchenGroups.values()) {
        const first = group[0]!;
        await tx.$queryRaw`SELECT id FROM "kitchens" WHERE id = ${first.kitchenId} FOR UPDATE`;
        const kitchen = await tx.kitchen.findUniqueOrThrow({ where: { id: first.kitchenId }, select: { capacityPerSlot: true } });
        const committed = await tx.orderItem.aggregate({
          where: {
            kitchenId: first.kitchenId,
            timeSlotId: first.timeSlotId,
            serviceDate: first.serviceDate,
            status: { notIn: ['CANCELLED', 'FAILED'] },
          },
          _sum: { quantity: true },
        });
        const quantity = group.reduce((sum, item) => sum + item.quantity, 0);
        if ((committed._sum.quantity ?? 0) + quantity > kitchen.capacityPerSlot) {
          throw conflict('The kitchen has reached its capacity for this delivery window');
        }
      }

      const subtotal = items.reduce((total, item) => total.add(item.lineTotal), new Prisma.Decimal(0));
      const order = await tx.order.create({
        data: {
          orderNumber: newOrderNumber(),
          customerId: userId,
          idempotencyKey,
          cityId: items[0]?.cityId,
          status: 'PENDING',
          subtotal,
          totalAmount: subtotal,
          placedAt: new Date(),
          payments: { create: { amount: subtotal, currency: 'INR', status: 'CREATED' } },
          items: {
            create: items.map((item) => ({
              mealScheduleId: item.scheduleId,
              mealId: item.mealId,
              kitchenId: item.kitchenId,
              checkpointId: item.checkpointId,
              timeSlotId: item.timeSlotId,
              serviceDate: item.serviceDate,
              childId: item.beneficiaryId,
              beneficiaryName: item.beneficiaryName,
              mealNameSnapshot: item.mealName,
              unitPrice: item.unitPrice,
              quantity: item.quantity,
              lineTotal: item.lineTotal,
              status: 'PENDING',
              notes: item.notes,
            })),
          },
        },
        select: { id: true },
      });

      for (const scheduleId of scheduleIds) {
        const quantity = items
          .filter((item) => item.scheduleId === scheduleId)
          .reduce((sum, item) => sum + item.quantity, 0);
        await tx.mealSchedule.update({ where: { id: scheduleId }, data: { reservedQuantity: { increment: quantity } } });
      }
      await tx.cartItem.deleteMany({ where: { id: { in: cartRows.map((item) => item.id) } } });
      return order.id;
    }, { isolationLevel: 'Serializable' });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: createdOrderId }, select: orderSelect });
    logger.info({ userId, orderId: order.id, orderNumber: order.orderNumber }, 'Order checked out');
    return toCustomerOrder(order);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2002' || error.code === 'P2034')
    ) {
      const replayed = await orderByIdempotency(userId, idempotencyKey);
      if (replayed) return toCustomerOrder(replayed);
      if (error.code === 'P2034') {
        throw conflict('Order capacity changed while checking out. Please review your cart and retry.');
      }
    }
    throw error;
  }
}

export async function getOrder(userId: string, orderId: string): Promise<CustomerOrder> {
  const row = await prisma.order.findFirst({ where: { id: orderId, customerId: userId }, select: orderSelect });
  if (!row) throw notFound('Order');
  return toCustomerOrder(row);
}

export async function listOrders(userId: string, query: ListOrdersQuery): Promise<PaginatedResult<CustomerOrder>> {
  const where: Prisma.OrderWhereInput = {
    customerId: userId,
    ...(query.status ? { status: query.status } : {}),
  };
  const { skip, take } = toSkipTake(query);
  const [rows, total] = await Promise.all([
    prisma.order.findMany({ where, select: orderSelect, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.order.count({ where }),
  ]);
  return buildPaginatedResult(rows.map(toCustomerOrder), total, query);
}

export async function cancelOrder(
  userId: string,
  orderId: string,
  input: CancelOrderInput
): Promise<CustomerOrder> {
  const row = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, customerId: userId },
      select: { id: true, status: true, items: { select: { id: true, status: true, mealScheduleId: true, quantity: true, serviceDate: true, timeSlot: { select: { startMinute: true } } } } },
    });
    if (!order) throw notFound('Order');
    const cancellable = order.items.filter(
      (item) => item.status === OrderItemStatus.PENDING || item.status === OrderItemStatus.CONFIRMED
    );
    if (cancellable.length !== order.items.length) {
      throw unprocessable(ErrorCode.INVALID_STATE_TRANSITION, 'This order can no longer be cancelled online.');
    }
    const now = new Date();
    for (const item of cancellable) {
      const cutoff = new Date(item.serviceDate);
      cutoff.setUTCMinutes(item.timeSlot.startMinute);
      if (now >= cutoff) throw unprocessable(ErrorCode.INVALID_STATE_TRANSITION, 'An order after its delivery window starts cannot be cancelled online.');
    }
    await tx.orderItem.updateMany({ where: { id: { in: cancellable.map((item) => item.id) } }, data: { status: 'CANCELLED', cancelledAt: now } });
    for (const item of cancellable) {
      if (item.mealScheduleId) {
        await tx.mealSchedule.updateMany({
          where: { id: item.mealScheduleId, reservedQuantity: { gte: item.quantity } },
          data: { reservedQuantity: { decrement: item.quantity } },
        });
      }
    }
    await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', cancelledAt: now, cancellationReason: input.reason ?? null } });
    return tx.order.findUniqueOrThrow({ where: { id: order.id }, select: orderSelect });
  });
  return toCustomerOrder(row);
}