import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import { api, registerUser, type RegisteredUser } from "./helpers";
import { prisma } from "../src/core/prisma";
import {
  addDays,
  dateKey,
  slotInstant,
} from "../src/modules/subscriptions/recurrence";
let admin: string,
  a: RegisteredUser,
  b: RegisteredUser,
  rider: RegisteredUser,
  rider2: RegisteredUser;
let cityId: string,
  nyCityId: string,
  vendorId: string,
  kitchenId: string,
  nyKitchenId: string,
  checkpointId: string,
  nyCheckpointId: string,
  mealId: string,
  slotId: string,
  nySlotId: string,
  partnerId: string,
  partner2Id: string,
  institutionId: string,
  companyId: string;
const start = new Date("2095-03-14"),
  end = addDays(start, 2),
  from = dateKey(start),
  to = dateKey(end);
const lower = slotInstant(start, 0, "Asia/Kolkata"),
  upper = slotInstant(addDays(end, 1), 0, "Asia/Kolkata");
const endpoint = "/api/v1/admin/analytics";
const scoped = () => endpoint + "?from=" + from + "&to=" + to;
beforeAll(async () => {
  admin =
    "Bearer " +
    (
      await api()
        .post("/api/v1/auth/login")
        .send({ identifier: "admin@lunch.test", password: "Lunch@1234" })
        .expect(200)
    ).body.data.tokens.accessToken;
  a = await registerUser({ fullName: "Private Customer Alpha" });
  b = await registerUser({ fullName: "Private Customer Beta" });
  rider = await registerUser({ fullName: "Analytics Rider A" });
  rider2 = await registerUser({ fullName: "Analytics Rider B" });
  cityId = (
    await prisma.city.create({
      data: {
        name: "Analytics India " + randomUUID(),
        state: "Test",
        timezone: "Asia/Kolkata",
      },
    })
  ).id;
  nyCityId = (
    await prisma.city.create({
      data: {
        name: "Analytics NY " + randomUUID(),
        state: "Test",
        timezone: "America/New_York",
      },
    })
  ).id;
  vendorId = (
    await prisma.vendor.create({
      data: {
        ownerUserId: a.id,
        businessName: "Analytics vendor",
        status: "APPROVED",
      },
    })
  ).id;
  kitchenId = (
    await prisma.kitchen.create({
      data: { name: "Analytics kitchen India", cityId, vendorId },
    })
  ).id;
  nyKitchenId = (
    await prisma.kitchen.create({
      data: { name: "Analytics kitchen NY", cityId: nyCityId, vendorId },
    })
  ).id;
  checkpointId = (
    await prisma.checkpoint.create({
      data: { name: "Analytics Gate A", cityId, type: "COLLEGE_GATE" },
    })
  ).id;
  nyCheckpointId = (
    await prisma.checkpoint.create({
      data: {
        name: "Analytics office NY",
        cityId: nyCityId,
        type: "OFFICE_RECEPTION",
      },
    })
  ).id;
  mealId = (
    await prisma.meal.create({
      data: {
        vendorId,
        kitchenId,
        name: "Analytics Lunch",
        slug: randomUUID(),
        basePrice: 100,
        mealPeriods: ["LUNCH"],
      },
    })
  ).id;
  slotId = (
    await prisma.timeSlot.create({
      data: {
        cityId,
        label: "Analytics India lunch",
        mealPeriod: "LUNCH",
        startMinute: 750,
        endMinute: 780,
      },
    })
  ).id;
  nySlotId = (
    await prisma.timeSlot.create({
      data: {
        cityId: nyCityId,
        label: "Analytics NY lunch",
        mealPeriod: "LUNCH",
        startMinute: 750,
        endMinute: 780,
      },
    })
  ).id;
  partnerId = (
    await prisma.deliveryPartner.create({
      data: { userId: rider.id, cityId, licenceNumber: "PRIVATE LICENCE" },
    })
  ).id;
  partner2Id = (
    await prisma.deliveryPartner.create({
      data: { userId: rider2.id, cityId: nyCityId },
    })
  ).id;
  const first = await prisma.order.create({
    data: {
      customerId: a.id,
      orderNumber: "AN-" + randomUUID(),
      subtotal: 300,
      totalAmount: 300,
      status: "DELIVERED",
      placedAt: lower,
    },
  });
  const second = await prisma.order.create({
    data: {
      customerId: b.id,
      orderNumber: "AN-" + randomUUID(),
      subtotal: 280,
      discountAmount: 80,
      totalAmount: 200,
      status: "DELIVERED",
      placedAt: slotInstant(addDays(start, 1), 600, "Asia/Kolkata"),
    },
  });
  const cancelled = await prisma.order.create({
    data: {
      customerId: a.id,
      orderNumber: "AN-" + randomUUID(),
      subtotal: 900,
      totalAmount: 900,
      status: "CANCELLED",
      placedAt: slotInstant(start, 600, "Asia/Kolkata"),
    },
  });
  const fallback = await prisma.order.create({
    data: {
      customerId: a.id,
      orderNumber: "AN-" + randomUUID(),
      subtotal: 100,
      totalAmount: 100,
      status: "DELIVERED",
      placedAt: null,
      createdAt: slotInstant(end, 600, "Asia/Kolkata"),
    },
  });
  const outside = await prisma.order.create({
    data: {
      customerId: a.id,
      orderNumber: "AN-" + randomUUID(),
      subtotal: 1000,
      totalAmount: 1000,
      status: "DELIVERED",
      placedAt: upper,
    },
  });
  const before = await prisma.order.create({
    data: {
      customerId: b.id,
      orderNumber: "AN-" + randomUUID(),
      subtotal: 12.34,
      totalAmount: 12.34,
      currency: "USD",
      status: "DELIVERED",
      placedAt: new Date(lower.getTime() - 1),
    },
  });
  const base = {
    mealId,
    kitchenId,
    checkpointId,
    timeSlotId: slotId,
    serviceDate: start,
    beneficiaryName: "PRIVATE BENEFICIARY",
    mealNameSnapshot: "Analytics Lunch",
    unitPrice: 100,
    lineTotal: 100,
  };
  const i1 = await prisma.orderItem.create({
    data: {
      ...base,
      orderId: first.id,
      status: "DELIVERED",
      quantity: 2,
      lineTotal: 200,
      preparingAt: new Date("2095-03-14T06:00:00Z"),
      packedAt: new Date("2095-03-14T06:30:00Z"),
    },
  });
  const i2 = await prisma.orderItem.create({
    data: {
      ...base,
      orderId: first.id,
      status: "FAILED",
      serviceDate: addDays(start, 1),
    },
  });
  const i3 = await prisma.orderItem.create({
    data: { ...base, orderId: second.id, status: "DELIVERED" },
  });
  const i4 = await prisma.orderItem.create({
    data: {
      ...base,
      orderId: second.id,
      status: "DELIVERED",
      kitchenId: nyKitchenId,
      checkpointId: nyCheckpointId,
      timeSlotId: nySlotId,
      unitPrice: 180,
      lineTotal: 180,
    },
  });
  const i5 = await prisma.orderItem.create({
    data: { ...base, orderId: fallback.id, status: "DELIVERED" },
  });
  await prisma.orderItem.create({
    data: {
      ...base,
      orderId: cancelled.id,
      status: "CANCELLED",
      quantity: 9,
      lineTotal: 900,
    },
  });
  await prisma.orderItem.create({
    data: {
      ...base,
      orderId: outside.id,
      status: "DELIVERED",
      quantity: 10,
      lineTotal: 1000,
      serviceDate: addDays(end, 1),
    },
  });
  await prisma.delivery.createMany({
    data: [
      {
        orderItemId: i1.id,
        deliveryPartnerId: partnerId,
        status: "DELIVERED",
        deliveredAt: slotInstant(start, 780, "Asia/Kolkata"),
        otpHash: "PRIVATE OTP",
        receiverName: "PRIVATE RECEIVER",
      },
      {
        orderItemId: i2.id,
        deliveryPartnerId: partnerId,
        status: "FAILED",
        failureReason: "PRIVATE FAILURE",
      },
      {
        orderItemId: i3.id,
        deliveryPartnerId: partnerId,
        status: "DELIVERED",
        deliveredAt: slotInstant(start, 781, "Asia/Kolkata"),
      },
      {
        orderItemId: i4.id,
        deliveryPartnerId: partner2Id,
        status: "DELIVERED",
        deliveredAt: slotInstant(start, 779, "America/New_York"),
      },
      {
        orderItemId: i5.id,
        deliveryPartnerId: partnerId,
        status: "DELIVERED",
        deliveredAt: null,
      },
    ],
  });
  await prisma.payment.create({
    data: {
      orderId: first.id,
      amount: 300,
      status: "PAID",
      paidAt: lower,
      lastVerifiedAt: lower,
      rawPayload: { secret: "PRIVATE PROVIDER" },
    },
  });
  const partial = await prisma.payment.create({
    data: {
      orderId: second.id,
      amount: 200,
      status: "PARTIALLY_REFUNDED",
      paidAt: slotInstant(addDays(start, 1), 500, "Asia/Kolkata"),
      lastVerifiedAt: lower,
      refundedAmount: 50,
    },
  });
  await prisma.refund.createMany({
    data: [
      {
        paymentId: partial.id,
        amount: 50,
        status: "PROCESSED",
        processedAt: slotInstant(end, 500, "Asia/Kolkata"),
      },
      {
        paymentId: partial.id,
        amount: 7,
        status: "PENDING",
        processedAt: lower,
      },
    ],
  });
  await prisma.payment.create({
    data: { orderId: fallback.id, amount: 100, status: "PAID", paidAt: lower },
  });
  await prisma.payment.create({
    data: {
      orderId: outside.id,
      amount: 1000,
      status: "PAID",
      paidAt: upper,
      lastVerifiedAt: upper,
    },
  });
  await prisma.payment.create({
    data: {
      orderId: cancelled.id,
      amount: 777,
      status: "FAILED",
      paidAt: lower,
      lastVerifiedAt: lower,
    },
  });
  const usd = await prisma.payment.create({
    data: {
      orderId: before.id,
      amount: 12.34,
      currency: "USD",
      status: "PARTIALLY_REFUNDED",
      paidAt: lower,
      lastVerifiedAt: lower,
      refundedAmount: 2.34,
    },
  });
  await prisma.refund.create({
    data: {
      paymentId: usd.id,
      amount: 2.34,
      status: "PROCESSED",
      processedAt: lower,
    },
  });
  institutionId = (
    await prisma.institution.create({
      data: { name: "Analytics corporate", type: "CORPORATE", cityId },
    })
  ).id;
  companyId = (
    await prisma.corporateAccount.create({
      data: {
        institutionId,
        billingEmail: "private@example.test",
        status: "ACTIVE",
        members: { create: { userId: b.id } },
      },
    })
  ).id;
  const member = await prisma.corporateMember.findFirstOrThrow({
    where: { companyId },
  });
  const batch = await prisma.corporateOrderBatch.create({
    data: {
      companyId,
      actorUserId: b.id,
      idempotencyKey: randomUUID(),
      requestHash: "analytics-fixture",
    },
  });
  await prisma.corporateCharge.create({
    data: {
      companyId,
      memberId: member.id,
      orderId: second.id,
      batchId: batch.id,
      month: from.slice(0, 7),
      serviceDate: start,
      quantity: 2,
      companyAmount: 80,
      employeeAmount: 200,
      policySnapshot: {},
    },
  });
  await prisma.corporateInvoice.create({
    data: {
      companyId,
      month: from.slice(0, 7),
      number: "AN-" + randomUUID(),
      amount: 80,
      currency: "INR",
      snapshot: {},
      settledAt: lower,
      settledByUserId: a.id,
      settlementReference: randomUUID(),
    },
  });
  await prisma.corporateInvoice.create({
    data: {
      companyId,
      month: "2095-02",
      number: "AN-" + randomUUID(),
      amount: 999,
      currency: "INR",
      snapshot: {},
    },
  });
  await prisma.subscription.createMany({
    data: [
      {
        userId: a.id,
        mealId,
        kitchenId,
        checkpointId,
        timeSlotId: slotId,
        startDate: start,
        endDate: addDays(start, 30),
        pricePerMeal: 100,
        status: "ACTIVE",
      },
      {
        userId: a.id,
        mealId,
        kitchenId,
        checkpointId,
        timeSlotId: slotId,
        startDate: start,
        endDate: addDays(start, 30),
        pricePerMeal: 100,
        status: "PAUSED",
      },
      {
        userId: a.id,
        mealId,
        kitchenId,
        checkpointId,
        timeSlotId: slotId,
        startDate: addDays(end, 1),
        pricePerMeal: 100,
        status: "ACTIVE",
      },
    ],
  });
});
afterAll(async () => {
  if (!a) return;
  await prisma.order.deleteMany({
    where: { customerId: { in: [a.id, b.id] } },
  });
  await prisma.subscription.deleteMany({ where: { userId: a.id } });
  await prisma.corporateOrderBatch.deleteMany({ where: { companyId } });
  await prisma.corporateInvoice.deleteMany({ where: { companyId } });
  await prisma.corporateAccount.delete({ where: { id: companyId } });
  await prisma.institution.delete({ where: { id: institutionId } });
  await prisma.meal.delete({ where: { id: mealId } });
  await prisma.kitchen.deleteMany({
    where: { id: { in: [kitchenId, nyKitchenId] } },
  });
  await prisma.checkpoint.deleteMany({
    where: { id: { in: [checkpointId, nyCheckpointId] } },
  });
  await prisma.timeSlot.deleteMany({
    where: { id: { in: [slotId, nySlotId] } },
  });
  await prisma.city.deleteMany({ where: { id: { in: [cityId, nyCityId] } } });
  await prisma.user.deleteMany({
    where: { id: { in: [a.id, b.id, rider.id, rider2.id] } },
  });
  await prisma.$disconnect();
});
it("restricts global reporting to super admins, including institution and corporate administrators", async () => {
  await api().get(endpoint).expect(401);
  for (const email of [
    "customer@lunch.test",
    "parent@lunch.test",
    "student@lunch.test",
    "vendor@lunch.test",
    "rider@lunch.test",
    "institution@lunch.test",
  ]) {
    const login = await api()
      .post("/api/v1/auth/login")
      .send({ identifier: email, password: "Lunch@1234" })
      .expect(200);
    await api()
      .get(scoped())
      .set("Authorization", "Bearer " + login.body.data.tokens.accessToken)
      .expect(403);
  }
  await prisma.corporateMember.update({
    where: { companyId_userId: { companyId, userId: b.id } },
    data: { role: "ADMIN" },
  });
  await api()
    .get(scoped())
    .set("Authorization", "Bearer " + b.accessToken)
    .expect(403);
});
it("counts placement cohorts once, includes creation fallback, and calculates cancellation, customers and subscription overlap", async () => {
  const res = await api().get(scoped()).set("Authorization", admin).expect(200);
  const d = res.body.data;
  expect(res.headers["cache-control"]).toBe("private, no-store");
  expect(d.summary).toMatchObject({
    orders: 4,
    cancelledOrders: 1,
    cancellationRate: 25,
    activeCustomers: 2,
    activeSubscriptions: 1,
  });
  expect(d.daily.map((x: { orders: number }) => x.orders)).toEqual([2, 1, 1]);
  expect(
    d.weekly.reduce((n: number, x: { orders: number }) => n + x.orders, 0),
  ).toBe(4);
  for (const w of d.weekly) expect(new Date(w.date).getUTCDay()).toBe(1);
  expect(d.averageOrderValue).toEqual([
    { currency: "INR", orders: 3, value: "226.67" },
  ]);
});
it("separates currencies and counts verified cash, processed refunds and corporate settlements without boundary duplication", async () => {
  const res = await api().get(scoped()).set("Authorization", admin).expect(200);
  expect(res.body.data.revenue).toEqual([
    {
      currency: "INR",
      providerCollections: "500.00",
      corporateCollections: "80.00",
      refunds: "50.00",
      net: "530.00",
    },
    {
      currency: "USD",
      providerCollections: "12.34",
      corporateCollections: "0.00",
      refunds: "2.34",
      net: "10.00",
    },
  ]);
  const daily = res.body.data.dailyRevenue.filter(
    (x: { currency: string }) => x.currency === "INR",
  );
  expect(daily.map((x: { net: string }) => x.net)).toEqual([
    "380.00",
    "200.00",
    "-50.00",
  ]);
});
it("uses local checkpoint slot deadlines, handles missing timing and excludes pending from delivery-rate denominators", async () => {
  const res = await api().get(scoped()).set("Authorization", admin).expect(200);
  const d = res.body.data;
  expect(d.summary).toMatchObject({
    deliveries: 5,
    delivered: 4,
    failed: 1,
    failedDeliveryRate: 20,
    onTime: 2,
    timedDeliveries: 3,
    unknownTiming: 1,
    onTimeDeliveryRate: 66.67,
  });
  expect(
    d.partners.find((p: { id: string }) => p.id === partnerId),
  ).toMatchObject({
    deliveries: 4,
    delivered: 3,
    failed: 1,
    failedDeliveryRate: 25,
    onTimeDeliveryRate: 50,
    unknownTiming: 1,
  });
  expect(
    d.partners.find((p: { id: string }) => p.id === partner2Id),
  ).toMatchObject({ delivered: 1, onTimeDeliveryRate: 100 });
});
it("ranks meal quantities, avoids item-order duplication, and reports kitchen timing without personal details", async () => {
  const res = await api().get(scoped()).set("Authorization", admin).expect(200);
  const d = res.body.data;
  expect(d.popularMeals).toEqual([
    { id: mealId, name: "Analytics Lunch", meals: 6, orders: 3 },
  ]);
  expect(d.popularCheckpoints[0]).toMatchObject({
    id: checkpointId,
    meals: 5,
    orders: 3,
  });
  expect(
    d.kitchens.find((k: { id: string }) => k.id === kitchenId),
  ).toMatchObject({
    meals: 5,
    packedMeals: 2,
    deliveredMeals: 4,
    failedMeals: 1,
    averagePreparationMinutes: 30,
  });
  expect(JSON.stringify(d)).not.toMatch(
    /Private Customer|PRIVATE|passwordHash|otpHash|rawPayload|beneficiaryName|billingEmail|settlementReference/,
  );
});
it("returns zero-filled series and null rates for an empty interval", async () => {
  const res = await api()
    .get(endpoint + "?from=2099-01-01&to=2099-01-03")
    .set("Authorization", admin)
    .expect(200);
  const d = res.body.data;
  expect(d.summary).toMatchObject({
    orders: 0,
    cancellationRate: null,
    failedDeliveryRate: null,
    onTimeDeliveryRate: null,
    activeCustomers: 0,
  });
  expect(d.daily).toHaveLength(3);
  expect(d.daily.every((x: { orders: number }) => x.orders === 0)).toBe(true);
  expect(d.revenue).toEqual([]);
  expect(d.popularMeals).toEqual([]);
});
it("validates dates and caps queries at 366 inclusive days", async () => {
  for (const q of [
    "from=2095-02-30&to=2095-03-01",
    "from=2095-01-01",
    "from=2095-03-02&to=2095-03-01",
    "from=2095-01-01&to=2096-01-02",
    "from=2095-01-01&to=2095-01-02&role=SUPER_ADMIN",
  ])
    await api()
      .get(endpoint + "?" + q)
      .set("Authorization", admin)
      .expect(422);
  const res = await api()
    .get(endpoint + "?from=2096-01-01&to=2096-12-31")
    .set("Authorization", admin)
    .expect(200);
  expect(res.body.data.daily).toHaveLength(366);
});
it("applies date filters to scheduled delivery reports independently of order placement", async () => {
  const date = dateKey(addDays(start, 1));
  const res = await api()
    .get(endpoint + "?from=" + date + "&to=" + date)
    .set("Authorization", admin)
    .expect(200);
  expect(res.body.data.summary).toMatchObject({
    orders: 1,
    deliveries: 1,
    failed: 1,
    failedDeliveryRate: 100,
    onTimeDeliveryRate: null,
  });
  expect(res.body.data.popularMeals[0].meals).toBe(1);
});
