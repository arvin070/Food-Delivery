import { notifyItemProgress } from '../notifications/notification.service';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type {
  CreateRouteInput,
  EditRouteInput,
  ManagedRoute,
  RouteQuery,
} from '@lunch/shared';
import { prisma } from '../../core/prisma';
import { conflict, notFound } from '../../core/errors';
import { paymentTransaction } from '../payments/transaction';
import { assertOrderPaid } from '../orders/payment-policy';
import { syncOrderStatuses } from '../orders/order-state';
import { cityToday, dateKey } from '../subscriptions/recurrence';

const include = {
  kitchen: {
    select: { id: true, name: true, latitude: true, longitude: true },
  },
  deliveryPartner: {
    select: { id: true, user: { select: { fullName: true } } },
  },
  timeSlot: { select: { id: true, label: true, startMinute: true } },
  stops: {
    orderBy: { sequence: 'asc' as const },
    include: {
      checkpoint: {
        select: {
          id: true,
          name: true,
          instructions: true,
          latitude: true,
          longitude: true,
        },
      },
      deliveries: {
        select: {
          status: true,
          orderItem: {
            select: {
              id: true,
              orderId: true,
              mealId: true,
              mealNameSnapshot: true,
              quantity: true,
              timeSlot: {
                select: { id: true, label: true, startMinute: true },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.DeliveryRunInclude;
type Row = Prisma.DeliveryRunGetPayload<{ include: typeof include }>;
function dto(r: Row): ManagedRoute {
  const deliveries = r.stops.flatMap((s) => s.deliveries);
  const slots = new Map(
    deliveries.map((d) => [d.orderItem.timeSlot.id, d.orderItem.timeSlot]),
  );
  if (!slots.size) slots.set(r.timeSlot.id, r.timeSlot);
  return {
    id: r.id,
    name: r.name ?? 'Route ' + r.id.slice(-6),
    date: dateKey(r.serviceDate),
    status: r.status,
    revision: r.revision,
    editable:
      !r.startedAt &&
      ['PLANNED', 'ASSIGNED'].includes(r.status) &&
      deliveries.every((d) => d.status === 'ASSIGNED'),
    kitchen: r.kitchen,
    partner: r.deliveryPartner
      ? { id: r.deliveryPartner.id, name: r.deliveryPartner.user.fullName }
      : null,
    timeSlots: [...slots.values()].sort(
      (a, b) => a.startMinute - b.startMinute,
    ),
    totals: {
      meals: deliveries.reduce((n, d) => n + d.orderItem.quantity, 0),
      orders: new Set(deliveries.map((d) => d.orderItem.orderId)).size,
      checkpoints: r.stops.length,
      deliveries: deliveries.length,
      delivered: deliveries.filter((d) => d.status === 'DELIVERED').length,
      failed: deliveries.filter((d) => d.status === 'FAILED').length,
    },
    stops: r.stops.map((s) => {
      const batches = new Map<
        string,
        ManagedRoute['stops'][number]['batches'][number]
      >();
      for (const d of s.deliveries) {
        const i = d.orderItem,
          key = (i.mealId ?? i.mealNameSnapshot) + ':' + i.timeSlot.id;
        const b = batches.get(key) ?? {
          mealId: i.mealId ?? i.mealNameSnapshot,
          mealName: i.mealNameSnapshot,
          timeSlotId: i.timeSlot.id,
          timeSlot: i.timeSlot.label,
          quantity: 0,
          deliveries: 0,
        };
        b.quantity += i.quantity;
        b.deliveries++;
        batches.set(key, b);
      }
      return {
        id: s.id,
        checkpointId: s.checkpoint.id,
        sequence: s.sequence,
        name: s.checkpoint.name,
        status: s.status,
        instructions: s.checkpoint.instructions,
        latitude: s.checkpoint.latitude,
        longitude: s.checkpoint.longitude,
        meals: s.deliveries.reduce((n, d) => n + d.orderItem.quantity, 0),
        orders: new Set(s.deliveries.map((d) => d.orderItem.orderId)).size,
        deliveries: s.deliveries.length,
        batches: [...batches.values()],
      };
    }),
  };
}
export async function options() {
  const [kitchens, partners] = await Promise.all([
    prisma.kitchen.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, name: true, cityId: true },
      orderBy: { name: 'asc' },
    }),
    prisma.deliveryPartner.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        user: { status: 'ACTIVE', role: 'DELIVERY_PARTNER' },
      },
      select: {
        id: true,
        cityId: true,
        isAvailable: true,
        user: { select: { fullName: true } },
      },
      orderBy: { user: { fullName: 'asc' } },
    }),
  ]);
  return {
    kitchens,
    partners: partners.map((p) => ({
      id: p.id,
      name: p.user.fullName,
      cityId: p.cityId,
      isAvailable: p.isAvailable,
    })),
  };
}
export async function list(query: RouteQuery) {
  const where = {
    serviceDate: new Date(query.date),
    ...(query.kitchenId ? { kitchenId: query.kitchenId } : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.deliveryRun.findMany({
      where,
      include,
      orderBy: [{ timeSlot: { startMinute: 'asc' } }, { id: 'asc' }],
      take: 20,
      skip: (query.page - 1) * 20,
    }),
    prisma.deliveryRun.count({ where }),
  ]);
  return { routes: rows.map(dto), total, page: query.page, pageSize: 20 };
}
export async function detail(id: string) {
  const r = await prisma.deliveryRun.findUnique({ where: { id }, include });
  if (!r) throw notFound('Route');
  return dto(r);
}
export async function candidates(query: RouteQuery & { kitchenId: string }) {
  const where: Prisma.OrderItemWhereInput = {
    kitchenId: query.kitchenId,
    serviceDate: new Date(query.date),
    status: 'PACKED',
    delivery: { is: null },
  };
  const [rows, total] = await prisma.$transaction([
    prisma.orderItem.findMany({
      where,
      select: {
        id: true,
        orderId: true,
        mealNameSnapshot: true,
        quantity: true,
        order: { select: { orderNumber: true } },
        checkpoint: { select: { id: true, name: true } },
        timeSlot: { select: { id: true, label: true } },
      },
      orderBy: [
        { checkpoint: { name: 'asc' } },
        { timeSlot: { startMinute: 'asc' } },
        { id: 'asc' },
      ],
      take: 100,
      skip: (query.page - 1) * 100,
    }),
    prisma.orderItem.count({ where }),
  ]);
  return {
    items: rows.map((i) => ({
      id: i.id,
      orderId: i.orderId,
      orderNumber: i.order.orderNumber,
      mealName: i.mealNameSnapshot,
      quantity: i.quantity,
      checkpoint: i.checkpoint,
      timeSlot: i.timeSlot,
    })),
    total,
    page: query.page,
    pageSize: 100,
  };
}
async function validateContext(
  tx: Prisma.TransactionClient,
  kitchenId: string,
  date: Date,
  partnerId: string,
) {
  const kitchen = await tx.kitchen.findFirst({
    where: { id: kitchenId, isActive: true, deletedAt: null },
    include: { city: { select: { timezone: true } } },
  });
  if (!kitchen) throw notFound('Active kitchen');
  if (date < cityToday(kitchen.city.timezone))
    throw conflict('Routes cannot be planned in the past');
  await tx.$queryRaw`SELECT id FROM delivery_partners WHERE id=${partnerId} FOR UPDATE`;
  const partner = await tx.deliveryPartner.findFirst({
    where: {
      id: partnerId,
      isActive: true,
      isAvailable: true,
      deletedAt: null,
      user: { status: 'ACTIVE', role: 'DELIVERY_PARTNER' },
    },
  });
  if (!partner) throw conflict('Choose an active, available delivery partner');
  if (partner.cityId && partner.cityId !== kitchen.cityId)
    throw conflict('Partner and kitchen must serve the same city');
  return kitchen;
}
async function loadItems(
  tx: Prisma.TransactionClient,
  ids: string[],
  kitchenId: string,
  date: Date,
  routeId?: string,
) {
  const items = await tx.orderItem.findMany({
    where: { id: { in: ids } },
    include: {
      delivery: { include: { deliveryStop: true } },
      timeSlot: { select: { startMinute: true } },
      checkpoint: { select: { isActive: true } },
    },
  });
  if (items.length !== ids.length) throw notFound('Selected order item');
  for (const item of items) {
    const alreadyHere =
      routeId && item.delivery?.deliveryStop?.deliveryRunId === routeId;
    if (
      item.kitchenId !== kitchenId ||
      dateKey(item.serviceDate) !== dateKey(date)
    )
      throw conflict('Every meal must belong to the route kitchen and date');
    if (!item.checkpoint.isActive)
      throw conflict('A selected checkpoint is inactive');
    if (!alreadyHere && (item.status !== 'PACKED' || item.delivery))
      throw conflict('Select packed, unassigned meals only');
    if (alreadyHere && item.delivery?.status !== 'ASSIGNED')
      throw conflict('Delivery has already progressed');
  }
  for (const orderId of new Set(items.map((i) => i.orderId)))
    await assertOrderPaid(tx, orderId);
  return items;
}
async function placeItems(
  tx: Prisma.TransactionClient,
  routeId: string,
  partnerId: string,
  checkpointIds: string[],
  items: Awaited<ReturnType<typeof loadItems>>,
) {
  const existing = await tx.deliveryStop.findMany({
    where: { deliveryRunId: routeId },
    include: { deliveries: { select: { id: true } } },
  });
  const required = new Set([
    ...existing.map((s) => s.checkpointId),
    ...items.map((i) => i.checkpointId),
  ]);
  if (
    required.size !== checkpointIds.length ||
    checkpointIds.some((id) => !required.has(id))
  )
    throw conflict(
      'Include each assigned checkpoint exactly once, in delivery order',
    );
  const count =
    existing.reduce((n, s) => n + s.deliveries.length, 0) +
    items.filter((i) => !i.delivery).length;
  if (count > 500)
    throw conflict(
      'A route can contain at most 500 deliveries; split this batch',
    );
  for (const [index, checkpointId] of checkpointIds.entries()) {
    const stop = await tx.deliveryStop.upsert({
      where: {
        deliveryRunId_checkpointId: { deliveryRunId: routeId, checkpointId },
      },
      create: { deliveryRunId: routeId, checkpointId, sequence: index + 1 },
      update: { sequence: index + 1 },
    });
    const newItems = items.filter(
      (i) => i.checkpointId === checkpointId && !i.delivery,
    );
    await tx.delivery.createMany({
      data: newItems.map((item) => ({
        orderItemId: item.id,
        deliveryPartnerId: partnerId,
        deliveryStopId: stop.id,
        status: 'ASSIGNED' as const,
      })),
    });
    await tx.orderItem.updateMany({
      where: { id: { in: newItems.map((i) => i.id) } },
      data: { status: 'ASSIGNED' },
    });
  }
  await tx.delivery.updateMany({
    where: { deliveryStop: { deliveryRunId: routeId } },
    data: { deliveryPartnerId: partnerId },
  });
  await syncOrderStatuses(tx, [...new Set(items.map((i) => i.orderId))]);
  await notifyItemProgress(tx,items.filter(i=>!i.delivery).map(i=>i.id));
}
async function uniqueSlot(
  tx: Prisma.TransactionClient,
  kitchenId: string,
  date: Date,
  timeSlotId: string,
  partnerId: string,
  exclude?: string,
) {
  if (
    await tx.deliveryRun.count({
      where: {
        kitchenId,
        serviceDate: date,
        timeSlotId,
        deliveryPartnerId: partnerId,
        ...(exclude ? { id: { not: exclude } } : {}),
      },
    })
  )
    throw conflict(
      'This partner already has a route for this kitchen and departure slot. Add meals to that route or select another partner.',
    );
}
function hashInput(input: CreateRouteInput) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        ...input,
        orderItemIds: [...input.orderItemIds].sort(),
      }),
    )
    .digest('hex');
}
async function transaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  try {
    return await paymentTransaction(fn);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
      throw conflict('An assignment changed concurrently. Refresh and retry.');
    throw e;
  }
}
export async function create(actorId: string, input: CreateRouteInput) {
  return transaction(async (tx) => {
    const hash = hashInput(input);
    const prior = await tx.deliveryRun.findUnique({
      where: { creationKey: input.idempotencyKey },
      include,
    });
    if (prior) {
      if (prior.creationHash !== hash)
        throw conflict('This request key was used for a different route');
      return dto(prior);
    }
    const date = new Date(input.date);
    await validateContext(tx, input.kitchenId, date, input.deliveryPartnerId);
    const items = await loadItems(
      tx,
      input.orderItemIds,
      input.kitchenId,
      date,
    );
    const first = [...items].sort(
      (a, b) =>
        a.timeSlot.startMinute - b.timeSlot.startMinute ||
        a.timeSlotId.localeCompare(b.timeSlotId),
    )[0]!;
    await uniqueSlot(
      tx,
      input.kitchenId,
      date,
      first.timeSlotId,
      input.deliveryPartnerId,
    );
    const run = await tx.deliveryRun.create({
      data: {
        name: input.name,
        kitchenId: input.kitchenId,
        serviceDate: date,
        timeSlotId: first.timeSlotId,
        deliveryPartnerId: input.deliveryPartnerId,
        status: 'ASSIGNED',
        creationKey: input.idempotencyKey,
        creationHash: hash,
      },
    });
    await placeItems(
      tx,
      run.id,
      input.deliveryPartnerId,
      input.checkpointIds,
      items,
    );
    await tx.auditLog.create({
      data: {
        actorUserId: actorId,
        action: 'ROUTE_CREATED',
        entityType: 'DeliveryRun',
        entityId: run.id,
        after: {
          checkpointIds: input.checkpointIds,
          deliveryPartnerId: input.deliveryPartnerId,
          orderItemIds: input.orderItemIds,
        },
      },
    });
    return dto(
      await tx.deliveryRun.findUniqueOrThrow({
        where: { id: run.id },
        include,
      }),
    );
  });
}
export async function edit(actorId: string, id: string, input: EditRouteInput) {
  return transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM delivery_runs WHERE id=${id} FOR UPDATE`;
    const run = await tx.deliveryRun.findUnique({ where: { id }, include });
    if (!run) throw notFound('Route');
    if (!dto(run).editable)
      throw conflict(
        'Routes cannot be edited after pickup or delivery progress',
      );
    if (run.revision !== input.revision)
      throw conflict('Route changed. Refresh before editing.');
    await validateContext(
      tx,
      run.kitchenId,
      run.serviceDate,
      input.deliveryPartnerId,
    );
    const existingIds = run.stops.flatMap((s) =>
      s.deliveries.map((d) => d.orderItem.id),
    );
    const items = await loadItems(
      tx,
      [...new Set([...existingIds, ...input.orderItemIds])],
      run.kitchenId,
      run.serviceDate,
      id,
    );
    const first = [...items].sort(
      (a, b) =>
        a.timeSlot.startMinute - b.timeSlot.startMinute ||
        a.timeSlotId.localeCompare(b.timeSlotId),
    )[0];
    const timeSlotId = first?.timeSlotId ?? run.timeSlotId;
    await uniqueSlot(
      tx,
      run.kitchenId,
      run.serviceDate,
      timeSlotId,
      input.deliveryPartnerId,
      id,
    );
    await placeItems(
      tx,
      id,
      input.deliveryPartnerId,
      input.checkpointIds,
      items,
    );
    await tx.deliveryRun.update({
      where: { id },
      data: {
        name: input.name,
        deliveryPartnerId: input.deliveryPartnerId,
        timeSlotId,
        status: 'ASSIGNED',
        revision: { increment: 1 },
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actorId,
        action: 'ROUTE_UPDATED',
        entityType: 'DeliveryRun',
        entityId: id,
        before: {
          deliveryPartnerId: run.deliveryPartnerId,
          checkpointIds: run.stops.map((s) => s.checkpoint.id),
          revision: run.revision,
        },
        after: {
          deliveryPartnerId: input.deliveryPartnerId,
          checkpointIds: input.checkpointIds,
          addedOrderItemIds: input.orderItemIds,
          revision: run.revision + 1,
        },
      },
    });
    return dto(
      await tx.deliveryRun.findUniqueOrThrow({ where: { id }, include }),
    );
  });
}
