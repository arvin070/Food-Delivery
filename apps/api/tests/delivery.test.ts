import { cityToday } from "../src/modules/subscriptions/recurrence";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/core/prisma";
import { api, disconnect } from "./helpers";

const PREFIX = `delivery-flow-${Date.now()}-`;
let adminToken: string;
let riderToken: string;
let foreignRiderToken: string;
let customerToken: string;
let riderId: string;
let orderId: string;
let orderItemId: string;
let deliveryId: string;
let failedOrderId: string;
let failedDeliveryId: string;
let routeId: string;
let stopId: string;

beforeAll(async () => {
  const [admin, rider, customer] = await Promise.all([
    api()
      .post("/api/v1/auth/login")
      .send({ identifier: "admin@lunch.test", password: "Lunch@1234" }),
    api()
      .post("/api/v1/auth/login")
      .send({ identifier: "rider@lunch.test", password: "Lunch@1234" }),
    api()
      .post("/api/v1/auth/login")
      .send({ identifier: "customer@lunch.test", password: "Lunch@1234" }),
  ]);
  adminToken = admin.body.data.tokens.accessToken as string;
  riderToken = rider.body.data.tokens.accessToken as string;
  foreignRiderToken = riderToken;
  customerToken = customer.body.data.tokens.accessToken as string;
  const [buyer, partner, schedule] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { email: "customer@lunch.test" },
      select: { id: true },
    }),
    prisma.deliveryPartner.findFirstOrThrow({
      where: { user: { email: "rider@lunch.test" }, isActive: true },
      select: { id: true },
    }),
    prisma.mealSchedule.findFirstOrThrow({
      where: {
        status: "PUBLISHED",
        kitchen: {
          vendor: { status: "APPROVED", isActive: true },
          serviceAreas: { some: { isActive: true } },
        },
      },
      include: { meal: true, kitchen: true, timeSlot: true },
    }),
  ]);
  const original = await prisma.user.findFirstOrThrow({
    where: { email: "rider@lunch.test" },
  });
  const fresh = await prisma.user.create({
    data: {
      email: PREFIX + "@test.local",
      fullName: "Test rider",
      passwordHash: original.passwordHash,
      role: "DELIVERY_PARTNER",
      status: "ACTIVE",
      deliveryPartner: { create: { isAvailable: true } },
    },
    include: { deliveryPartner: true },
  });
  riderId = fresh.deliveryPartner!.id;
  const login = await api()
    .post("/api/v1/auth/login")
    .send({ identifier: fresh.email, password: "Lunch@1234" });
  riderToken = login.body.data.tokens.accessToken;
  const serviceArea = await prisma.kitchenServiceArea.findFirstOrThrow({
    where: {
      kitchenId: schedule.kitchenId,
      isActive: true,
      checkpoint: { isActive: true },
    },
    select: { checkpointId: true },
  });
  const order = await prisma.order.create({
    data: {
      orderNumber: `${PREFIX}ORDER`,
      customerId: buyer.id,
      status: "PACKED",
      subtotal: schedule.price,
      totalAmount: schedule.price,
      payments: {
        create: {
          amount: schedule.price,
          status: "PAID",
          paidAt: new Date(),
          lastVerifiedAt: new Date(),
        },
      },
      items: {
        create: {
          mealScheduleId: schedule.id,
          mealId: schedule.mealId,
          kitchenId: schedule.kitchenId,
          checkpointId: serviceArea.checkpointId,
          timeSlotId: schedule.timeSlotId,
          serviceDate: cityToday("Asia/Kolkata"),
          beneficiaryName: "Delivery Flow Beneficiary",
          mealNameSnapshot: schedule.meal.name,
          unitPrice: schedule.price,
          quantity: 1,
          lineTotal: schedule.price,
          status: "PACKED",
        },
      },
    },
    select: { id: true, items: { select: { id: true } } },
  });
  orderId = order.id;
  orderItemId = order.items[0]!.id;
});

afterAll(async () => {
  if (failedOrderId)
    await prisma.order.delete({ where: { id: failedOrderId } });
  if (orderId) await prisma.order.delete({ where: { id: orderId } });
  if (routeId) await prisma.deliveryRun.delete({ where: { id: routeId } });
  if (riderId) {
    const p = await prisma.deliveryPartner.findUnique({
      where: { id: riderId },
    });
    if (p) await prisma.user.delete({ where: { id: p.userId } });
  }
  await disconnect();
});

describe("delivery assignment and order status lifecycle", () => {
  it("assigns packed orders to a rider and advances delivery through checkpoint handoff", async () => {
    const assigned = await api()
      .post(`/api/v1/delivery/items/${orderItemId}/assign`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ deliveryPartnerId: riderId })
      .expect(201);
    deliveryId = assigned.body.data.delivery.id as string;
    routeId = assigned.body.data.delivery.routeId;
    expect(assigned.body.data.delivery.orderStatus).toBe("ASSIGNED");

    const queue = await api()
      .get("/api/v1/delivery/items")
      .set("Authorization", `Bearer ${riderToken}`)
      .expect(200);
    expect(
      queue.body.data.deliveries.some(
        (delivery: { id: string }) => delivery.id === deliveryId,
      ),
    ).toBe(true);

    const repeated = await api()
      .post("/api/v1/delivery/items/" + orderItemId + "/assign")
      .set("Authorization", "Bearer " + adminToken)
      .send({ deliveryPartnerId: riderId })
      .expect(201);
    expect(repeated.body.data.delivery.id).toBe(deliveryId);
    routeId = assigned.body.data.delivery.routeId;
    stopId = assigned.body.data.delivery.stopId;

    const source = await prisma.orderItem.findUniqueOrThrow({
      where: { id: orderItemId },
    });
    const { id: omitId, orderId: omitOrder, ...itemFields } = source;
    const originalOrder = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    const failedOrder = await prisma.order.create({
      data: {
        orderNumber: PREFIX + "FAILED",
        customerId: originalOrder.customerId,
        status: "PACKED",
        subtotal: source.unitPrice.mul(2),
        totalAmount: source.unitPrice.mul(2),
        payments: {
          create: {
            amount: source.unitPrice.mul(2),
            status: "PAID",
            paidAt: new Date(),
            lastVerifiedAt: new Date(),
          },
        },
        items: {
          create: {
            ...itemFields,
            status: "PACKED",
            quantity: 2,
            lineTotal: source.unitPrice.mul(2),
          },
        },
      },
      include: { items: true },
    });
    failedOrderId = failedOrder.id;
    await api()
      .patch("/api/v1/delivery/availability")
      .set("Authorization", "Bearer " + riderToken)
      .send({ isAvailable: false })
      .expect(200);
    await api()
      .post("/api/v1/delivery/items/" + failedOrder.items[0]!.id + "/assign")
      .set("Authorization", "Bearer " + adminToken)
      .send({ deliveryPartnerId: riderId })
      .expect(400);
    await api()
      .patch("/api/v1/delivery/availability")
      .set("Authorization", "Bearer " + riderToken)
      .send({ isAvailable: true })
      .expect(200);
    const failedAssignment = await api()
      .post("/api/v1/delivery/items/" + failedOrder.items[0]!.id + "/assign")
      .set("Authorization", "Bearer " + adminToken)
      .send({ deliveryPartnerId: riderId })
      .expect(201);
    failedDeliveryId = failedAssignment.body.data.delivery.id;
    await api()
      .get("/api/v1/delivery/routes/" + routeId + "/stops/" + stopId)
      .set("Authorization", "Bearer " + foreignRiderToken)
      .expect(404);
    await api()
      .post("/api/v1/delivery/routes/" + routeId + "/pickup")
      .set("Authorization", "Bearer " + foreignRiderToken)
      .expect(404);
    await api()
      .patch("/api/v1/delivery/items/" + deliveryId + "/status")
      .set("Authorization", "Bearer " + foreignRiderToken)
      .send({ status: "FAILED", failureReason: "Not mine" })
      .expect(404);
    await api()
      .get("/api/v1/delivery/dashboard")
      .set("Authorization", "Bearer " + customerToken)
      .expect(403);
    await api()
      .patch("/api/v1/delivery/availability")
      .set("Authorization", "Bearer " + riderToken)
      .send({ isAvailable: false })
      .expect(200);
    expect(
      (
        await prisma.deliveryPartner.findUniqueOrThrow({
          where: { id: riderId },
        })
      ).isAvailable,
    ).toBe(false);
    const dashboard = await api()
      .get("/api/v1/delivery/dashboard")
      .set("Authorization", "Bearer " + riderToken)
      .expect(200);
    expect(dashboard.body.data.totals.meals).toBe(3);
    expect(dashboard.body.data.totals.deliveries).toBe(2);
    expect(
      dashboard.body.data.routes.some((r: { id: string }) => r.id === routeId),
    ).toBe(true);
    await api()
      .post("/api/v1/delivery/routes/" + routeId + "/start")
      .set("Authorization", "Bearer " + riderToken)
      .expect(409);
    for (const action of ["pickup", "start"])
      await api()
        .post("/api/v1/delivery/routes/" + routeId + "/" + action)
        .set("Authorization", "Bearer " + riderToken)
        .expect(200);
    await api()
      .post(
        "/api/v1/delivery/routes/" + routeId + "/stops/" + stopId + "/arrive",
      )
      .set("Authorization", "Bearer " + riderToken)
      .expect(200);

    for (let i = 0; i < 2; i++)
      await api()
        .patch("/api/v1/delivery/items/" + failedDeliveryId + "/status")
        .set("Authorization", "Bearer " + riderToken)
        .send({ status: "FAILED", failureReason: "Beneficiary absent" })
        .expect(200);
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: failedOrderId } }))
        .status,
    ).toBe("FAILED");
    const detail = await api()
      .get("/api/v1/delivery/routes/" + routeId + "/stops/" + stopId)
      .set("Authorization", "Bearer " + riderToken)
      .expect(200);
    expect(JSON.stringify(detail.body)).not.toMatch(
      /otpHash|customerId|phone|email/,
    );
    await api()
      .post(
        "/api/v1/orders/" +
          orderId +
          "/items/" +
          orderItemId +
          "/delivery-code",
      )
      .set("Authorization", "Bearer " + riderToken)
      .expect(403);
    const issued = await api()
      .post(
        "/api/v1/orders/" +
          orderId +
          "/items/" +
          orderItemId +
          "/delivery-code",
      )
      .set("Authorization", "Bearer " + customerToken)
      .expect(200);
    let otp = issued.body.data.code;
    await api()
      .post(
        "/api/v1/orders/" +
          orderId +
          "/items/" +
          orderItemId +
          "/delivery-code",
      )
      .set("Authorization", "Bearer " + customerToken)
      .expect(409);
    await api()
      .post("/api/v1/orders/not-mine/items/" + orderItemId + "/delivery-code")
      .set("Authorization", "Bearer " + customerToken)
      .expect(404);
    const wrong = otp === "111111" ? "222222" : "111111";
    await api()
      .patch("/api/v1/delivery/items/" + deliveryId + "/status")
      .set("Authorization", "Bearer " + riderToken)
      .send({
        status: "DELIVERED",
        receiverName: "Campus Security",
        otp: wrong,
      })
      .expect(400);
    expect(
      (await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } }))
        .otpAttempts,
    ).toBe(1);

    for (let i = 1; i < 5; i++)
      await api()
        .patch("/api/v1/delivery/items/" + deliveryId + "/status")
        .set("Authorization", "Bearer " + riderToken)
        .send({
          status: "DELIVERED",
          receiverName: "Campus Security",
          otp: wrong,
        })
        .expect(400);
    await api()
      .patch("/api/v1/delivery/items/" + deliveryId + "/status")
      .set("Authorization", "Bearer " + riderToken)
      .send({ status: "DELIVERED", receiverName: "Campus Security", otp })
      .expect(409);
    await prisma.delivery.update({
      where: { id: deliveryId },
      data: { otpIssuedAt: new Date(Date.now() - 61000) },
    });
    const fresh = await api()
      .post(
        "/api/v1/orders/" +
          orderId +
          "/items/" +
          orderItemId +
          "/delivery-code",
      )
      .set("Authorization", "Bearer " + customerToken)
      .expect(200);
    otp = fresh.body.data.code;
    await prisma.delivery.update({
      where: { id: deliveryId },
      data: { otpExpiresAt: new Date(Date.now() - 1000) },
    });
    await api()
      .patch("/api/v1/delivery/items/" + deliveryId + "/status")
      .set("Authorization", "Bearer " + riderToken)
      .send({ status: "DELIVERED", receiverName: "Campus Security", otp })
      .expect(409);
    await prisma.delivery.update({
      where: { id: deliveryId },
      data: { otpExpiresAt: new Date(Date.now() + 60000) },
    });
    for (let i = 0; i < 2; i++)
      await api()
        .patch("/api/v1/delivery/items/" + deliveryId + "/status")
        .set("Authorization", "Bearer " + riderToken)
        .send({ status: "DELIVERED", receiverName: "Campus Security", otp })
        .expect(200);
    const saved = await prisma.delivery.findUniqueOrThrow({
      where: { id: deliveryId },
    });
    expect(saved.otpHash).toBeNull();
    expect(saved.verifiedAt).not.toBeNull();
    const alerts=await prisma.notification.findMany({where:{eventKey:{startsWith:'item:'+orderItemId+':'},channel:'IN_APP',status:'SENT'}});
    expect(alerts.map(n=>n.type).sort()).toEqual(['delivery.assigned','delivery.started','delivery.arriving','delivery.delivered'].sort());
    const failedItem=await prisma.delivery.findUniqueOrThrow({where:{id:failedDeliveryId}});
    expect(await prisma.notification.count({where:{eventKey:'item:'+failedItem.orderItemId+':delivery.failed',channel:'IN_APP',status:'SENT'}})).toBe(1);

    expect(
      (await prisma.deliveryRun.findUniqueOrThrow({ where: { id: routeId } }))
        .status,
    ).toBe("COMPLETED");
    const order = await api()
      .get(`/api/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${customerToken}`)
      .expect(200);
    expect(order.body.data.order.status).toBe("DELIVERED");
    expect(order.body.data.order.items[0].deliveryStatus).toBe("DELIVERED");
  });

  it("rejects delivery skips after handoff is complete", async () => {
    const impossible = await api()
      .patch(`/api/v1/delivery/items/${deliveryId}/status`)
      .set("Authorization", `Bearer ${riderToken}`)
      .send({ status: "FAILED", failureReason: "Too late to fail" })
      .expect(409);
    expect(impossible.body.error.code).toBe("CONFLICT");
  });
});
