import { notifyItemProgress } from '../notifications/notification.service';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { KitchenOperationsDashboard, KitchenPackingItem, KitchenStatusResult, kitchenGroupStatusSchema, kitchenOperationsStatusSchema } from '@lunch/shared';
import { prisma } from '../../core/prisma';
import { conflict, notFound } from '../../core/errors';
import { cityToday, dateKey } from '../subscriptions/recurrence';
import { assertOrderPaid, fundedOrderSql } from '../orders/payment-policy';
import { paymentTransaction } from '../payments/transaction';
import { syncOrderStatuses } from '../orders/order-state';
import { accessKitchen, type KitchenActor } from './kitchen-access';

/** One row per meal item. EXISTS avoids multiplying quantities by payment attempts.
 * Routes come from actual delivery assignments; missing/invalid routes stay unassigned. */
function baseQuery(kitchenId: string, serviceDate: string) {
  return Prisma.sql`
    SELECT i.id, i.quantity, i.status::text AS status, i."serviceDate"::text AS "serviceDate",
      i."timeSlotId", s.label AS "timeSlot", s."startMinute", s."mealPeriod"::text AS "mealPeriod",
      i."checkpointId", c.name AS checkpoint, i."mealId", i."mealNameSnapshot" AS "mealName",
      COALESCE(m."foodType"::text, 'UNSPECIFIED') AS "foodType",
      r.id AS "routeId", CASE WHEN r.id IS NULL THEN 'Unassigned route' ELSE COALESCE(r.name, 'Route ' || r.id) END AS route
    FROM order_items i
    JOIN orders o ON o.id = i."orderId"
    JOIN time_slots s ON s.id = i."timeSlotId"
    JOIN checkpoints c ON c.id = i."checkpointId"
    LEFT JOIN meals m ON m.id = i."mealId"
    LEFT JOIN deliveries d ON d."orderItemId" = i.id
    LEFT JOIN delivery_stops ds ON ds.id = d."deliveryStopId" AND ds."checkpointId" = i."checkpointId"
    LEFT JOIN delivery_runs r ON r.id = ds."deliveryRunId" AND r."kitchenId" = i."kitchenId"
      AND r."serviceDate" = i."serviceDate" AND r.status <> 'CANCELLED'
    WHERE i."kitchenId" = ${kitchenId} AND i."serviceDate" = ${new Date(serviceDate)}::date
      AND i.status IN ('CONFIRMED','PREPARING','PACKED','ASSIGNED','PICKED_UP','DISPATCHED','OUT_FOR_DELIVERY','AT_CHECKPOINT','DELIVERED')
      AND (${fundedOrderSql})
  `;
}
const counts = Prisma.sql`
  COALESCE(SUM(quantity) FILTER (WHERE status = 'CONFIRMED'),0)::int AS confirmed,
  COALESCE(SUM(quantity) FILTER (WHERE status = 'PREPARING'),0)::int AS preparing,
  COALESCE(SUM(quantity) FILTER (WHERE status = 'PACKED'),0)::int AS packed,
  COALESCE(SUM(quantity) FILTER (WHERE status NOT IN ('CONFIRMED','PREPARING','PACKED')),0)::int AS "handedOver"
`;
export async function kitchenDashboard(actor: KitchenActor, kitchenId: string, query: { serviceDate?: string; page: number; pageSize: number }): Promise<KitchenOperationsDashboard> {
  const kitchen = await accessKitchen(actor, kitchenId);
  const serviceDate = query.serviceDate ?? dateKey(cityToday(kitchen.timezone));
  type Result = Omit<KitchenOperationsDashboard,'kitchen'|'serviceDate'|'page'|'pageSize'>;
  const rows = await prisma.$queryRaw<Result[]>(Prisma.sql`
    WITH base AS (${baseQuery(kitchenId, serviceDate)}),
    grouped AS (
      SELECT "serviceDate", "timeSlotId", "timeSlot", "startMinute", "checkpointId", checkpoint,
        "mealId", "mealName", "foodType", "mealPeriod", "routeId", route,
        SUM(quantity)::int AS quantity, ${counts}
      FROM base GROUP BY "serviceDate", "timeSlotId", "timeSlot", "startMinute", "checkpointId", checkpoint,
        "mealId", "mealName", "foodType", "mealPeriod", "routeId", route
    )
    SELECT (SELECT COALESCE(SUM(quantity),0)::int FROM base) AS "totalMeals",
      (SELECT row_to_json(t) FROM (SELECT ${counts} FROM base) t) AS counts,
      (SELECT COUNT(*)::int FROM grouped) AS "totalGroups",
      (SELECT COALESCE(json_agg(t),'[]'::json) FROM (SELECT "timeSlotId", "timeSlot", "startMinute", "checkpointId", checkpoint, SUM(quantity)::int AS quantity FROM base GROUP BY "timeSlotId", "timeSlot", "startMinute", "checkpointId", checkpoint ORDER BY "startMinute", "timeSlotId", checkpoint, "checkpointId") t) AS drops,
      (SELECT COALESCE(json_agg(t),'[]'::json) FROM (SELECT * FROM grouped ORDER BY "startMinute", "timeSlotId", checkpoint, "checkpointId", "mealName", "mealId", "routeId" LIMIT ${query.pageSize} OFFSET ${(query.page-1)*query.pageSize}) t) AS groups,
      (SELECT COALESCE(json_agg(t),'[]'::json) FROM (SELECT "foodType" AS key, "foodType" AS label, SUM(quantity)::int AS quantity FROM base GROUP BY "foodType" ORDER BY "foodType") t) AS "byMealType",
      (SELECT COALESCE(json_agg(t),'[]'::json) FROM (SELECT "mealPeriod" AS key, "mealPeriod" AS label, SUM(quantity)::int AS quantity FROM base GROUP BY "mealPeriod" ORDER BY "mealPeriod") t) AS "byMealPeriod",
      (SELECT COALESCE(json_agg(t),'[]'::json) FROM (SELECT "checkpointId" AS key, checkpoint AS label, SUM(quantity)::int AS quantity FROM base GROUP BY "checkpointId", checkpoint ORDER BY checkpoint) t) AS "byCheckpoint",
      (SELECT COALESCE(json_agg(t),'[]'::json) FROM (SELECT "timeSlotId" AS key, "timeSlot" AS label, SUM(quantity)::int AS quantity FROM base GROUP BY "timeSlotId", "timeSlot", "startMinute" ORDER BY "startMinute", "timeSlotId") t) AS "byTimeSlot",
      (SELECT COALESCE(json_agg(t),'[]'::json) FROM (SELECT COALESCE("routeId",'UNASSIGNED') AS key, route AS label, SUM(quantity)::int AS quantity FROM base GROUP BY "routeId", route ORDER BY route) t) AS "byRoute"
  `);
  return { ...rows[0]!, kitchen, serviceDate, page: query.page, pageSize: query.pageSize };
}

export async function packingList(actor: KitchenActor, kitchenId: string, query: { serviceDate?: string; page: number; pageSize: number }) {
  const kitchen = await accessKitchen(actor, kitchenId);
  const serviceDate = query.serviceDate ?? dateKey(cityToday(kitchen.timezone));
  const ids = await prisma.$queryRaw<{id: string; total: number}[]>(Prisma.sql`
    WITH base AS (${baseQuery(kitchenId, serviceDate)})
    SELECT id, COUNT(*) OVER()::int AS total FROM base ORDER BY "startMinute", "timeSlotId", checkpoint, "checkpointId", "mealName", id
    LIMIT ${query.pageSize} OFFSET ${(query.page-1)*query.pageSize}
  `);
  const items = await prisma.orderItem.findMany({ where: { id: { in: ids.map(r=>r.id) }, kitchenId }, include: {
    order: { select: { orderNumber: true, customer: { select: { profile: { select: { allergies: true } } } } } },
    child: { select: { allergies: true } }, checkpoint: { select: { name: true } }, timeSlot: { select: { label: true, startMinute: true } },
  } });
  const byId = new Map(items.map(i=>[i.id,i]));
  const result: KitchenPackingItem[] = ids.flatMap(({ id }) => {
    const i = byId.get(id); if (!i) return [];
    return [{ id: i.id, orderNumber: i.order.orderNumber, meal: i.mealNameSnapshot, beneficiary: i.beneficiaryName, quantity: i.quantity, status: i.status, checkpoint: i.checkpoint.name, timeSlot: i.timeSlot.label, startMinute: i.timeSlot.startMinute, allergies: i.child?.allergies ?? (!i.childId ? i.order.customer.profile?.allergies ?? null : null), notes: i.notes, preparingAt: i.preparingAt?.toISOString() ?? null, packedAt: i.packedAt?.toISOString() ?? null }];
  });
  return { kitchen, serviceDate, items: result, total: ids[0]?.total ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function updateKitchenItems(actor: KitchenActor, kitchenId: string, input: z.infer<typeof kitchenOperationsStatusSchema>): Promise<KitchenStatusResult> {
  await accessKitchen(actor, kitchenId, true);
  const result: KitchenStatusResult = { updated: [], unchanged: [], skipped: [] };
  for (const id of new Set(input.orderItemIds)) {
    try {
      const outcome = await paymentTransaction(async tx => {
        await accessKitchen(actor, kitchenId, true, tx);
        const item = await tx.orderItem.findFirst({ where: { id, kitchenId, serviceDate: new Date(input.serviceDate) } });
        if (!item) throw notFound('Order item');
        await tx.$queryRaw`SELECT id FROM orders WHERE id = ${item.orderId} FOR UPDATE`;
        const current = await tx.orderItem.findUniqueOrThrow({ where: { id } });
        await assertOrderPaid(tx, current.orderId);
        if (current.status === input.status) return 'unchanged';
        const expected = input.status === 'PREPARING' ? 'CONFIRMED' : 'PREPARING';
        if (current.status !== expected) throw conflict(`Only ${expected.toLowerCase()} meals can move to ${input.status.toLowerCase()}`);
        await tx.orderItem.update({ where: { id }, data: { status: input.status, ...(input.status === 'PREPARING' ? { preparingAt: new Date() } : { packedAt: new Date() }) } });
        await syncOrderStatuses(tx, [current.orderId]);
        await notifyItemProgress(tx,[id]);
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: 'kitchen.preparation.updated', entityType: 'OrderItem', entityId: id, before: { status: current.status }, after: { status: input.status, kitchenId } } });
        return 'updated';
      });
      result[outcome].push(id);
    } catch (e) {
      // Validation/state failures are per-item; infrastructure errors must not be hidden.
      if (e instanceof Error && 'statusCode' in e) result.skipped.push({ id, reason: e.message });
      else throw e;
    }
  }
  return result;
}
export async function updateKitchenGroup(actor: KitchenActor, kitchenId: string, input: z.infer<typeof kitchenGroupStatusSchema>) {
  await accessKitchen(actor, kitchenId, true);
  const source = input.status === 'PREPARING' ? 'CONFIRMED' : 'PREPARING';
  const ids = await prisma.$queryRaw<{id:string}[]>(Prisma.sql`
    WITH base AS (${baseQuery(kitchenId,input.serviceDate)})
    SELECT id FROM base WHERE "timeSlotId" = ${input.timeSlotId} AND "checkpointId" = ${input.checkpointId}
      AND "mealId" IS NOT DISTINCT FROM ${input.mealId}::text AND "mealName" = ${input.mealName}
      AND "routeId" IS NOT DISTINCT FROM ${input.routeId}::text AND status = ${source}
    ORDER BY id LIMIT 201
  `);
  if (!ids.length) return { updated: [], unchanged: [], skipped: [], hasMore: false };
  return { ...await updateKitchenItems(actor, kitchenId, { serviceDate: input.serviceDate, orderItemIds: ids.slice(0,200).map(i=>i.id), status: input.status }), hasMore: ids.length > 200 };
}
