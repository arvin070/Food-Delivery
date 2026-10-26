/** Real PostgreSQL + HTTP application flow. Provider payment is the local mock adapter.
 * Only menu/infrastructure fixtures are seeded; every customer/fulfilment transition uses HTTP. */
import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { api, registerUser, type RegisteredUser } from "./helpers";
import { prisma } from "../src/core/prisma";
import { cityToday, dateKey } from "../src/modules/subscriptions/recurrence";
let parent: RegisteredUser, vendor: RegisteredUser, rider: RegisteredUser;
let cityId: string,
  institutionId: string,
  kitchenId: string,
  checkpointId: string,
  slotId: string,
  mealId: string,
  scheduleId: string,
  partnerId: string,
  orderId: string,
  runId: string;
let adminToken: string;
const timezone = new Date().getUTCHours() < 20 ? "UTC" : "Pacific/Honolulu";
const today = cityToday(timezone),
  date = dateKey(today);
beforeAll(async () => {
  parent = await registerUser({ role: "PARENT" });
  vendor = await registerUser();
  rider = await registerUser();
  await prisma.user.update({
    where: { id: vendor.id },
    data: { role: "VENDOR" },
  });
  await prisma.user.update({
    where: { id: rider.id },
    data: { role: "DELIVERY_PARTNER" },
  });
  adminToken =
    "Bearer " +
    (
      await api()
        .post("/api/v1/auth/login")
        .send({ identifier: "admin@lunch.test", password: "Lunch@1234" })
        .expect(200)
    ).body.data.tokens.accessToken;
  cityId = (
    await prisma.city.create({
      data: { name: "E2E " + randomUUID(), state: "Test", timezone },
    })
  ).id;
  institutionId = (
    await prisma.institution.create({
      data: { name: "ABC College E2E", type: "COLLEGE", cityId },
    })
  ).id;
  const v = await prisma.vendor.create({
    data: {
      ownerUserId: vendor.id,
      businessName: "E2E Kitchen",
      status: "APPROVED",
    },
  });
  kitchenId = (
    await prisma.kitchen.create({
      data: {
        vendorId: v.id,
        cityId,
        name: "E2E Kitchen",
        capacityPerSlot: 100,
      },
    })
  ).id;
  checkpointId = (
    await prisma.checkpoint.create({
      data: {
        cityId,
        institutionId,
        name: "ABC College Gate A",
        type: "COLLEGE_GATE",
        deliveryCapacity: 100,
      },
    })
  ).id;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  const minute = Number(parts.hour) * 60 + Number(parts.minute) + 60;
  slotId = (
    await prisma.timeSlot.create({
      data: {
        cityId,
        label: "E2E lunch window",
        mealPeriod: "LUNCH",
        startMinute: minute,
        endMinute: minute + 45,
        orderCutoffMinutes: 0,
      },
    })
  ).id;
  await prisma.checkpointTimeSlot.create({
    data: { checkpointId, timeSlotId: slotId, maxOrders: 100 },
  });
  await prisma.kitchenServiceArea.create({ data: { checkpointId, kitchenId } });
  mealId = (
    await prisma.meal.create({
      data: {
        vendorId: v.id,
        kitchenId,
        name: "Lunch for Rahul",
        slug: randomUUID(),
        basePrice: 100,
        foodType: "VEG",
        mealPeriods: ["LUNCH"],
      },
    })
  ).id;
  scheduleId = (
    await prisma.mealSchedule.create({
      data: {
        mealId,
        kitchenId,
        timeSlotId: slotId,
        serviceDate: today,
        totalQuantity: 20,
        price: 100,
        status: "PUBLISHED",
      },
    })
  ).id;
  partnerId = (
    await prisma.deliveryPartner.create({
      data: { userId: rider.id, cityId, isAvailable: true },
    })
  ).id;
});
afterAll(async () => {
  if (orderId) await prisma.order.deleteMany({ where: { id: orderId } });
  if (runId) await prisma.deliveryRun.deleteMany({ where: { id: runId } });
  if (parent) await prisma.child.deleteMany({ where: { parentId: parent.id } });
  if (kitchenId) await prisma.kitchen.delete({ where: { id: kitchenId } });
  if (mealId) await prisma.meal.delete({ where: { id: mealId } });
  if (checkpointId)
    await prisma.checkpoint.delete({ where: { id: checkpointId } });
  if (slotId) await prisma.timeSlot.delete({ where: { id: slotId } });
  if (institutionId)
    await prisma.institution.delete({ where: { id: institutionId } });
  if (cityId) await prisma.city.delete({ where: { id: cityId } });
  await prisma.user.deleteMany({
    where: { id: { in: [parent?.id, vendor?.id, rider?.id].filter(Boolean) } },
  });
});
it("parent login → child → menu/checkpoint/slot → checkout → verified payment → packing → route → OTP → parent confirmation", async () => {
  const login = await api()
    .post("/api/v1/auth/login")
    .send({ identifier: parent.email, password: parent.password })
    .expect(200);
  const cookie = login.headers["set-cookie"]
    .map((c: string) => c.split(";")[0])
    .join("; ");
  const parentHeaders = { Cookie: cookie, Origin: "http://localhost:3000" };
  const child = await api()
    .post("/api/v1/children")
    .set(parentHeaders)
    .send({
      fullName: "Rahul",
      institutionId,
      defaultCheckpointId: checkpointId,
      defaultTimeSlotId: slotId,
    })
    .expect(201);
  const childId = child.body.data.child.id;
  const slots = await api()
    .get("/api/v1/catalog/delivery-slots")
    .set(parentHeaders)
    .query({ checkpointId, serviceDate: date })
    .expect(200);
  expect(
    slots.body.data.slots.some(
      (s: { timeSlotId: string }) => s.timeSlotId === slotId,
    ),
  ).toBe(true);
  const menu = await api()
    .get("/api/v1/catalog/meals")
    .set(parentHeaders)
    .query({ checkpointId, timeSlotId: slotId, serviceDate: date })
    .expect(200);
  expect(
    menu.body.data.some(
      (m: { mealScheduleId: string }) => m.mealScheduleId === scheduleId,
    ),
  ).toBe(true);
  const cart = await api()
    .post("/api/v1/cart/items")
    .set(parentHeaders)
    .send({
      mealScheduleId: scheduleId,
      checkpointId,
      timeSlotId: slotId,
      childId,
      quantity: 1,
      price: "0.01",
    })
    .expect(201);
  expect(cart.body.data.cart.items[0].unitPrice).toBe("100.00");
  const key = randomUUID();
  const checkout = await api()
    .post("/api/v1/orders/checkout")
    .set(parentHeaders)
    .send({ idempotencyKey: key })
    .expect(201);
  orderId = checkout.body.data.order.id;
  const itemId = checkout.body.data.order.items[0].id;
  expect(checkout.body.data.order.status).toBe("AWAITING_PAYMENT");
  expect(checkout.body.data.order.items[0].beneficiaryName).toBe("Rahul");
  expect(
    (
      await api()
        .post("/api/v1/orders/checkout")
        .set(parentHeaders)
        .send({ idempotencyKey: key })
        .expect(201)
    ).body.data.order.id,
  ).toBe(orderId);
  const vendorHeaders = { Authorization: "Bearer " + vendor.accessToken };
  const statusUrl = "/api/v1/kitchen/" + kitchenId + "/items/status";
  const unpaid = await api()
    .post(statusUrl)
    .set(vendorHeaders)
    .send({ serviceDate: date, orderItemIds: [itemId], status: "PREPARING" })
    .expect(200);
  expect(unpaid.body.data.updated).toEqual([]);
  const payment = await api()
    .post("/api/v1/payments")
    .set(parentHeaders)
    .send({ orderId })
    .expect(201);
  const paymentId = payment.body.data.payment.id;
  const paid = await api()
    .post("/api/v1/payments/" + paymentId + "/simulate")
    .set(parentHeaders)
    .send({ status: "captured" })
    .expect(200);
  expect(paid.body.data.status).toBe("PAID");
  expect(paid.body.data.lastVerifiedAt).not.toBeNull();
  expect(
    (
      await api()
        .get("/api/v1/orders/" + orderId)
        .set(parentHeaders)
        .expect(200)
    ).body.data.order.status,
  ).toBe("CONFIRMED");
  await api()
    .get("/api/v1/payments/" + paymentId + "/receipt")
    .set(parentHeaders)
    .expect(200);
  for (const status of ["PREPARING", "PACKED"]) {
    const r = await api()
      .post(statusUrl)
      .set(vendorHeaders)
      .send({ serviceDate: date, orderItemIds: [itemId], status })
      .expect(200);
    expect(r.body.data.updated).toEqual([itemId]);
  }
  const route = await api()
    .post("/api/v1/admin/routes")
    .set("Authorization", adminToken)
    .send({
      name: "College lunch",
      date,
      kitchenId,
      deliveryPartnerId: partnerId,
      checkpointIds: [checkpointId],
      orderItemIds: [itemId],
      idempotencyKey: randomUUID(),
    })
    .expect(201);
  runId = route.body.data.route.id;
  const stopId = route.body.data.route.stops[0].id;
  const riderHeaders = { Authorization: "Bearer " + rider.accessToken };
  const dashboard = await api()
    .get("/api/v1/delivery/dashboard")
    .set(riderHeaders)
    .expect(200);
  expect(JSON.stringify(dashboard.body)).toContain(runId);
  expect(JSON.stringify(dashboard.body)).not.toContain(parent.email);
  for (const action of ["pickup", "start"])
    await api()
      .post("/api/v1/delivery/routes/" + runId + "/" + action)
      .set(riderHeaders)
      .expect(200);
  await api()
    .post("/api/v1/delivery/routes/" + runId + "/stops/" + stopId + "/arrive")
    .set(riderHeaders)
    .expect(200);
  const details = await api()
    .get("/api/v1/delivery/routes/" + runId + "/stops/" + stopId)
    .set(riderHeaders)
    .expect(200);
  expect(JSON.stringify(details.body)).not.toMatch(
    /otpHash|passwordHash|customerId/,
  );
  const delivery = await prisma.delivery.findUniqueOrThrow({
    where: { orderItemId: itemId },
  });
  const issued = await api()
    .post("/api/v1/orders/" + orderId + "/items/" + itemId + "/delivery-code")
    .set(parentHeaders)
    .expect(200);
  await api()
    .patch("/api/v1/delivery/items/" + delivery.id + "/status")
    .set(riderHeaders)
    .send({
      status: "DELIVERED",
      receiverName: "Rahul",
      otp: issued.body.data.code,
    })
    .expect(200);
  const final = await api()
    .get("/api/v1/orders/" + orderId)
    .set(parentHeaders)
    .expect(200);
  expect(final.body.data.order.status).toBe("DELIVERED");
  const inbox = await api()
    .get("/api/v1/notifications")
    .set(parentHeaders)
    .expect(200);
  const confirmation = inbox.body.data.items.find(
    (n: { type: string }) => n.type === "delivery.delivered",
  );
  expect(confirmation).toBeDefined();
  expect(confirmation.body).toContain("Rahul");
  expect(confirmation.body).toContain("ABC College Gate A");
  // Replay must not create a second delivery confirmation.
  await api()
    .patch("/api/v1/delivery/items/" + delivery.id + "/status")
    .set(riderHeaders)
    .send({
      status: "DELIVERED",
      receiverName: "Rahul",
      otp: issued.body.data.code,
    })
    .expect(200);
  expect(
    await prisma.notification.count({
      where: {
        userId: parent.id,
        type: "delivery.delivered",
        channel: "IN_APP",
      },
    }),
  ).toBe(1);
});
