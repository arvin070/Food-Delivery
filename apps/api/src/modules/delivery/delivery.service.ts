import { notifyItemProgress } from '../notifications/notification.service';
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env";
import { paymentTransaction } from "../payments/transaction";
import { syncOrderStatuses } from "../orders/order-state";
import { cityToday, dateKey } from "../subscriptions/recurrence";
import { assertOrderPaid } from "../orders/payment-policy";
import type { Prisma } from "@prisma/client";
import {
  DeliveryStatus,
  OrderItemStatus,
  type UpdateDeliveryStatusInput,
} from "@lunch/shared";
import { badRequest, conflict, notFound } from "../../core/errors";
import { prisma } from "../../core/prisma";

const deliverySelect = {
  deliveryStop: { select: { id: true, deliveryRunId: true } },
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
          latitude: true,
          longitude: true,
          address: {
            select: {
              line1: true,
              area: true,
              cityName: true,
              postalCode: true,
            },
          },
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
    routeId: row.deliveryStop?.deliveryRunId ?? null,
    stopId: row.deliveryStop?.id ?? null,
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
      id: row.orderItem.checkpoint.id,
      name: row.orderItem.checkpoint.name,
      instructions: row.orderItem.checkpoint.instructions,
      latitude: row.orderItem.checkpoint.latitude,
      longitude: row.orderItem.checkpoint.longitude,
      addressLabel: row.orderItem.checkpoint.address
        ? [
            row.orderItem.checkpoint.address.line1,
            row.orderItem.checkpoint.address.area,
            row.orderItem.checkpoint.address.cityName,
            row.orderItem.checkpoint.address.postalCode,
          ]
            .filter(Boolean)
            .join(", ")
        : null,
    },
    timeSlot: row.orderItem.timeSlot,
    kitchen: row.orderItem.kitchen,
  };
}

async function partnerFor(
  userId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  const partner = await tx.deliveryPartner.findFirst({
    where: { userId, isActive: true, deletedAt: null },
  });
  if (!partner) throw notFound("Delivery partner");
  return partner;
}
export async function availability(userId: string, isAvailable: boolean) {
  const p = await partnerFor(userId);
  await prisma.deliveryPartner.update({
    where: { id: p.id },
    data: { isAvailable },
  });
  return { isAvailable };
}
export async function listDeliveries(userId: string, _admin: boolean) {
  const p = await partnerFor(userId);
  return (
    await prisma.delivery.findMany({
      where: { deliveryPartnerId: p.id },
      select: deliverySelect,
      take: 100,
      orderBy: { createdAt: "desc" },
    })
  ).map(toDelivery);
}
export async function assignDelivery(
  orderItemId: string,
  deliveryPartnerId: string,
) {
  return paymentTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "delivery_partners" WHERE id=${deliveryPartnerId} FOR UPDATE`;
    const existing = await tx.delivery.findUnique({
      where: { orderItemId },
      select: deliverySelect,
    });
    if (existing) {
      const owned = await tx.delivery.count({
        where: { orderItemId, deliveryPartnerId },
      });
      if (!owned) throw conflict("Already assigned to another partner");
      return toDelivery(existing);
    }
    const p = await tx.deliveryPartner.findFirst({
      where: {
        id: deliveryPartnerId,
        isActive: true,
        isAvailable: true,
        deletedAt: null,
      },
    });
    if (!p) throw badRequest("Delivery partner is unavailable");
    const item = await tx.orderItem.findUnique({ where: { id: orderItemId } });
    if (!item) throw notFound("Order item");
    if (item.status !== "PACKED")
      throw conflict("Only packed meals can be assigned");
    await assertOrderPaid(tx, item.orderId);
    let run = await tx.deliveryRun.findFirst({
      where: {
        kitchenId: item.kitchenId,
        timeSlotId: item.timeSlotId,
        serviceDate: item.serviceDate,
        deliveryPartnerId,
      },
    });
    if (
      run?.startedAt ||
      run?.status === "CANCELLED" ||
      run?.status === "COMPLETED"
    )
      throw conflict("Route already started or closed");
    if (!run)
      run = await tx.deliveryRun.create({
        data: {
          kitchenId: item.kitchenId,
          timeSlotId: item.timeSlotId,
          serviceDate: item.serviceDate,
          deliveryPartnerId,
          status: "ASSIGNED",
        },
      });
    await tx.$queryRaw`SELECT id FROM delivery_runs WHERE id=${run.id} FOR UPDATE`;
    if(await tx.delivery.count({where:{deliveryStop:{deliveryRunId:run.id}}})>=500) throw conflict("Route is full; use another route");
    await tx.deliveryRun.update({where:{id:run.id},data:{revision:{increment:1}}});
    let stop = await tx.deliveryStop.findUnique({
      where: {
        deliveryRunId_checkpointId: {
          deliveryRunId: run.id,
          checkpointId: item.checkpointId,
        },
      },
    });
    if (!stop) {
      const last = await tx.deliveryStop.aggregate({
        where: { deliveryRunId: run.id },
        _max: { sequence: true },
      });
      stop = await tx.deliveryStop.create({
        data: {
          deliveryRunId: run.id,
          checkpointId: item.checkpointId,
          sequence: (last._max.sequence ?? 0) + 1,
        },
      });
    }
    const row = await tx.delivery.create({
      data: {
        orderItemId,
        deliveryPartnerId,
        deliveryStopId: stop.id,
        status: "ASSIGNED",
      },
      select: deliverySelect,
    });
    await tx.orderItem.update({
      where: { id: orderItemId },
      data: { status: "ASSIGNED" },
    });
    await syncOrderStatuses(tx, [item.orderId]);
    await notifyItemProgress(tx,[item.id]);
    return toDelivery(
      await tx.delivery.findUniqueOrThrow({
        where: { id: row.id },
        select: deliverySelect,
      }),
    );
  });
}
const runInclude = {
  kitchen: {
    select: { id: true, name: true, city: { select: { timezone: true } } },
  },
  timeSlot: { select: { label: true, startMinute: true } },
  stops: {
    orderBy: { sequence: "asc" as const },
    include: {
      checkpoint: { select: { name: true, instructions: true, latitude: true, longitude: true } },
      deliveries: {
        select: { status: true, orderItem: { select: { quantity: true, timeSlot: {select: {id:true, label:true, startMinute:true}} } } },
      },
    },
  },
} satisfies Prisma.DeliveryRunInclude;
type Run = Prisma.DeliveryRunGetPayload<{ include: typeof runInclude }>;
function routeDto(r: Run) {
  const deliveries = r.stops.flatMap((s) => s.deliveries);
  return {
    id: r.id,
    status: r.status,
    serviceDate: dateKey(r.serviceDate),
    startedAt: r.startedAt?.toISOString() ?? null,
    departedAt: r.departedAt?.toISOString() ?? null,
    kitchen: {
      id: r.kitchen.id,
      name: r.kitchen.name,
      timezone: r.kitchen.city.timezone,
    },
    timeSlot: r.timeSlot,
    timeSlots: [...new Map(deliveries.map(d=>[d.orderItem.timeSlot.id,d.orderItem.timeSlot])).values()].sort((a,b)=>a.startMinute-b.startMinute),
    deliveryCount: deliveries.length,
    mealCount: deliveries.reduce((n, d) => n + d.orderItem.quantity, 0),
    completedCount: deliveries.filter((d) => d.status === "DELIVERED").length,
    failedCount: deliveries.filter((d) => d.status === "FAILED").length,
    stops: r.stops.map((s) => ({
      id: s.id,
      sequence: s.sequence,
      status: s.status,
      checkpoint: s.checkpoint,
      deliveryCount: s.deliveries.length,
      mealCount: s.deliveries.reduce((n, d) => n + d.orderItem.quantity, 0),
    })),
  };
}
export async function dashboard(userId: string) {
  const p = await partnerFor(userId);
  const ids = await prisma.$queryRaw<
    { id: string }[]
  >`SELECT r.id FROM "delivery_runs" r JOIN "kitchens" k ON k.id=r."kitchenId" JOIN "cities" c ON c.id=k."cityId" WHERE r."deliveryPartnerId"=${p.id} AND r."serviceDate"=(CURRENT_TIMESTAMP AT TIME ZONE c.timezone)::date AND r.status <> 'CANCELLED'`;
  const runs = await prisma.deliveryRun.findMany({
    where: { id: { in: ids.map((r) => r.id) } },
    include: runInclude,
    orderBy: { timeSlot: { startMinute: "asc" } },
  });
  const routes = runs.map(routeDto);
  return {
    partner: {
      id: p.id,
      isAvailable: p.isAvailable,
      vehicleType: p.vehicleType,
      vehicleNumber: p.vehicleNumber,
    },
    routes,
    page: 1,
    pageSize: routes.length,
    totals: {
      routes: routes.length,
      deliveries: routes.reduce((n, r) => n + r.deliveryCount, 0),
      meals: routes.reduce((n, r) => n + r.mealCount, 0),
      delivered: routes.reduce((n, r) => n + r.completedCount, 0),
      failed: routes.reduce((n, r) => n + r.failedCount, 0),
    },
  };
}
async function ownRun(
  tx: Prisma.TransactionClient,
  userId: string,
  routeId: string,
) {
  const p = await partnerFor(userId, tx);
  await tx.$queryRaw`SELECT id FROM "delivery_runs" WHERE id=${routeId} FOR UPDATE`;
  const run = await tx.deliveryRun.findFirst({
    where: { id: routeId, deliveryPartnerId: p.id },
    include: runInclude,
  });
  if (!run) throw notFound("Route");
  return run;
}
function today(run: Run) {
  if (
    dateKey(run.serviceDate) !== dateKey(cityToday(run.kitchen.city.timezone))
  )
    throw conflict("Only today’s routes can be updated");
  if (run.status === "CANCELLED") throw conflict("Route cancelled");
}
export async function stopDetail(
  userId: string,
  routeId: string,
  stopId: string,
  page = 1,
) {
  const p = await partnerFor(userId);
  const run = await prisma.deliveryRun.findFirst({
    where: { id: routeId, deliveryPartnerId: p.id },
    include: runInclude,
  });
  if (!run || !run.stops.some((s) => s.id === stopId))
    throw notFound("Checkpoint");
  const where = { deliveryStopId: stopId, deliveryPartnerId: p.id };
  const [rows, total] = await Promise.all([
    prisma.delivery.findMany({
      where,
      select: deliverySelect,
      take: 50,
      skip: (page - 1) * 50,
      orderBy: { id: "asc" },
    }),
    prisma.delivery.count({ where }),
  ]);
  return {
    route: routeDto(run),
    stopId,
    deliveries: rows.map(toDelivery),
    total,
    page,
    pageSize: 50,
  };
}
export async function routeAction(
  userId: string,
  routeId: string,
  action: "pickup" | "start" | "arrive",
  stopId?: string,
) {
  return paymentTransaction(async (tx) => {
    const run = await ownRun(tx, userId, routeId);
    today(run);
    if (
      (action === "pickup" && run.startedAt) ||
      (action === "start" && run.departedAt)
    )
      return { id: run.id };
    if (run.status === "COMPLETED") throw conflict("Route completed");
    if (
      (action === "start" && !run.startedAt) ||
      (action === "arrive" && !run.departedAt)
    )
      throw conflict("Complete the previous route step first");
    if (action === "arrive") {
      const stop = run.stops.find((s) => s.id === stopId);
      if (!stop) throw notFound("Checkpoint");
      if (["COMPLETED", "SKIPPED"].includes(stop.status)) return { id: run.id };
      if (
        run.stops.some(
          (s) =>
            s.sequence < stop.sequence &&
            !["COMPLETED", "SKIPPED"].includes(s.status),
        )
      )
        throw conflict("Complete the previous checkpoint first");
    }
    const from =
      action === "pickup"
        ? "ASSIGNED"
        : action === "start"
          ? "PICKED_UP"
          : "OUT_FOR_DELIVERY";
    const status =
      action === "pickup"
        ? "PICKED_UP"
        : action === "start"
          ? "OUT_FOR_DELIVERY"
          : "AT_CHECKPOINT";
    const rows = await tx.delivery.findMany({
      where: {
        deliveryPartnerId: run.deliveryPartnerId,
        deliveryStop: { deliveryRunId: run.id },
        ...(stopId ? { deliveryStopId: stopId } : {}),
        status: from,
      },
      include: { orderItem: true },
    });
    for (const orderId of new Set(rows.map((d) => d.orderItem.orderId)))
      await assertOrderPaid(tx, orderId);
    const now = new Date();
    await tx.delivery.updateMany({
      where: { id: { in: rows.map((d) => d.id) } },
      data: {
        status,
        ...(action === "pickup"
          ? { pickedUpAt: now }
          : action === "start"
            ? { outForDeliveryAt: now }
            : { arrivedAt: now }),
      },
    });
    await tx.orderItem.updateMany({
      where: { id: { in: rows.map((d) => d.orderItemId) } },
      data: { status },
    });
    if (action === "arrive")
      await tx.deliveryStop.update({
        where: { id: stopId! },
        data: { status: "ARRIVED", arrivedAt: now },
      });
    else
      await tx.deliveryRun.update({
        where: { id: routeId },
        data:
          action === "pickup"
            ? { status: "IN_PROGRESS", startedAt: now }
            : { departedAt: now },
      });
    await notifyItemProgress(tx,rows.map(d=>d.orderItemId));
    await syncOrderStatuses(tx, [
      ...new Set(rows.map((d) => d.orderItem.orderId)),
    ]);
    return { id: run.id };
  });
}
function hashCode(id: string, code: string) {
  return createHmac("sha256", env.DELIVERY_OTP_SECRET ?? env.JWT_ACCESS_SECRET)
    .update(id + ":" + code)
    .digest("hex");
}
export async function issueCode(
  userId: string,
  orderId: string,
  orderItemId: string,
) {
  return paymentTransaction(async (tx) => {
    const d = await tx.delivery.findFirst({
      where: {
        orderItemId,
        orderItem: { orderId, order: { customerId: userId } },
      },
      include: {
        orderItem: { include: { kitchen: { include: { city: true } } } },
      },
    });
    if (!d) throw notFound("Delivery");
    if (
      !["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "AT_CHECKPOINT"].includes(
        d.status,
      )
    )
      throw conflict("Delivery is not awaiting handoff");
    if (
      dateKey(d.orderItem.serviceDate) !==
      dateKey(cityToday(d.orderItem.kitchen.city.timezone))
    )
      throw conflict("Codes are available on the delivery date");
    if (d.otpIssuedAt && Date.now() - d.otpIssuedAt.getTime() < 60000)
      throw conflict("Wait one minute before requesting a new code");
    const code = String(randomInt(100000, 1000000));
    const expiresAt = new Date(
      Date.now() + env.DELIVERY_OTP_TTL_MINUTES * 60000,
    );
    await tx.delivery.update({
      where: { id: d.id },
      data: {
        otpHash: hashCode(d.id, code),
        otpExpiresAt: expiresAt,
        otpIssuedAt: new Date(),
        otpAttempts: 0,
      },
    });
    return { code, expiresAt: expiresAt.toISOString() };
  });
}
export async function updateDeliveryStatus(
  userId: string,
  _admin: boolean,
  deliveryId: string,
  input: UpdateDeliveryStatusInput,
) {
  const result = await paymentTransaction(async (tx) => {
    const p = await partnerFor(userId, tx);
    const initial = await tx.delivery.findFirst({
      where: { id: deliveryId, deliveryPartnerId: p.id },
      include: { deliveryStop: true },
    });
    if (!initial?.deliveryStop) throw notFound("Delivery");
    const run = await ownRun(tx, userId, initial.deliveryStop.deliveryRunId);
    today(run);
    const d = await tx.delivery.findUniqueOrThrow({
      where: { id: deliveryId },
      include: { orderItem: true },
    });
    if (d.status === input.status)
      return {
        delivery: toDelivery(
          await tx.delivery.findUniqueOrThrow({
            where: { id: d.id },
            select: deliverySelect,
          }),
        ),
      };
    if (["DELIVERED", "FAILED"].includes(d.status))
      throw conflict("Delivery is already closed");
    if (input.status === "DELIVERED") {
      if (d.status !== "AT_CHECKPOINT")
        throw conflict("Arrive at the checkpoint first");
      if (
        !d.otpHash ||
        !d.otpExpiresAt ||
        d.otpExpiresAt.getTime() < Date.now() ||
        d.otpAttempts >= env.DELIVERY_OTP_MAX_ATTEMPTS
      )
        throw conflict("Request a fresh delivery code from the customer");
      if (
        !timingSafeEqual(
          Buffer.from(d.otpHash),
          Buffer.from(hashCode(d.id, input.otp)),
        )
      ) {
        await tx.delivery.update({
          where: { id: d.id },
          data: { otpAttempts: { increment: 1 } },
        });
        return { error: true };
      }
      await assertOrderPaid(tx, d.orderItem.orderId);
    }
    const now = new Date();
    await tx.delivery.update({
      where: { id: d.id },
      data: {
        status: input.status,
        otpHash: null,
        otpExpiresAt: null,
        ...(input.status === "DELIVERED"
          ? {
              receiverName: input.receiverName,
              deliveredAt: now,
              verifiedAt: now,
            }
          : { failureReason: input.failureReason, failedAt: now }),
      },
    });
    await tx.orderItem.update({
      where: { id: d.orderItemId },
      data: { status: input.status },
    });
    await syncOrderStatuses(tx, [d.orderItem.orderId]);
    await notifyItemProgress(tx,[d.orderItemId]);
    const remaining = await tx.delivery.count({
      where: {
        deliveryStopId: d.deliveryStopId,
        status: { notIn: ["DELIVERED", "FAILED"] },
      },
    });
    if (!remaining)
      await tx.deliveryStop.update({
        where: { id: d.deliveryStopId! },
        data: { status: "COMPLETED", completedAt: now },
      });
    const open = await tx.delivery.count({
      where: {
        deliveryStop: { deliveryRunId: run.id },
        status: { notIn: ["DELIVERED", "FAILED"] },
      },
    });
    if (!open)
      await tx.deliveryRun.update({
        where: { id: run.id },
        data: { status: "COMPLETED", completedAt: now },
      });
    return {
      delivery: toDelivery(
        await tx.delivery.findUniqueOrThrow({
          where: { id: d.id },
          select: deliverySelect,
        }),
      ),
    };
  });
  if ("error" in result) throw badRequest("Incorrect delivery code");
  return result.delivery;
}
