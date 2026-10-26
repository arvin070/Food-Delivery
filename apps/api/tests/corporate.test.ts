import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import { api, registerUser, type RegisteredUser } from './helpers';
import { prisma } from '../src/core/prisma';
import {
  addDays,
  cityToday,
  dateKey,
} from '../src/modules/subscriptions/recurrence';
import { updateOrderItemStatus } from '../src/modules/vendor/order.service';
import { assertOrderPaid } from '../src/modules/orders/payment-policy';
import {
  createPayment,
  simulatePayment,
  refundPayment,
} from '../src/modules/payments/payment.service';
let owner: RegisteredUser,
  employee: RegisteredUser,
  outsider: RegisteredUser,
  admin: string;
let companyId: string,
  institutionId: string,
  cityId: string,
  kitchenId: string,
  vendorId: string,
  mealId: string,
  slotId: string,
  checkpointId: string,
  scheduleId: string,
  employeeId: string,
  ownerId: string;
const day = addDays(cityToday('Asia/Kolkata'), 2);
const month = dateKey(day).slice(0, 7);
const paymentIds: string[] = [];
const auth = (u: RegisteredUser) => 'Bearer ' + u.accessToken;
const root = () => '/api/v1/corporate/' + companyId;
const input = (memberId = employeeId, maxEmployeeAmount = '0') => ({
  idempotencyKey: randomUUID(),
  maxEmployeeAmount,
  lines: [{ memberId, mealScheduleId: scheduleId, checkpointId, quantity: 1 }],
});
const policy = () => ({
  revision: 0,
  monthlyBudget: '1000',
  employeeMonthlyCredit: '500',
  subsidyPerMeal: '100',
  maxMealsPerDay: 2,
  allowedWeekdays: [0, 1, 2, 3, 4, 5, 6],
  allowedPeriods: ['LUNCH'],
  allowCopayment: true,
  billingEmail: 'billing@example.test',
});
beforeAll(async () => {
  owner = await registerUser();
  employee = await registerUser();
  outsider = await registerUser();
  admin =
    'Bearer ' +
    (
      await api()
        .post('/api/v1/auth/login')
        .send({ identifier: 'admin@lunch.test', password: 'Lunch@1234' })
        .expect(200)
    ).body.data.tokens.accessToken;
  cityId = (
    await prisma.city.create({
      data: {
        name: 'Corporate ' + randomUUID(),
        state: 'Test',
        timezone: 'Asia/Kolkata',
      },
    })
  ).id;
  vendorId = (
    await prisma.vendor.create({
      data: {
        ownerUserId: outsider.id,
        businessName: 'Corporate test',
        status: 'APPROVED',
      },
    })
  ).id;
  kitchenId = (
    await prisma.kitchen.create({
      data: {
        vendorId,
        cityId,
        name: 'Corporate kitchen',
        capacityPerSlot: 100,
      },
    })
  ).id;
  mealId = (
    await prisma.meal.create({
      data: {
        vendorId,
        kitchenId,
        name: 'Corporate lunch',
        slug: randomUUID(),
        basePrice: 100,
        mealPeriods: ['LUNCH'],
      },
    })
  ).id;
  slotId = (
    await prisma.timeSlot.create({
      data: {
        cityId,
        label: 'Office lunch 12:30',
        mealPeriod: 'LUNCH',
        startMinute: 750,
        endMinute: 780,
        orderCutoffMinutes: 60,
      },
    })
  ).id;
  const c = await api()
    .post('/api/v1/corporate')
    .set('Authorization', auth(owner))
    .send({
      name: 'Example Company',
      cityId,
      billingEmail: 'billing@example.test',
    })
    .expect(201);
  companyId = c.body.data.id;
  institutionId = (
    await prisma.corporateAccount.findUniqueOrThrow({
      where: { id: companyId },
    })
  ).institutionId;
  ownerId = (
    await prisma.corporateMember.findFirstOrThrow({
      where: { companyId, userId: owner.id },
    })
  ).id;
  employeeId = (
    await api()
      .post(root() + '/employees')
      .set('Authorization', auth(owner))
      .send({
        email: employee.email,
        employeeNumber: 'E-1',
        monthlyCredit: null,
        role: 'EMPLOYEE',
      })
      .expect(201)
  ).body.data.id;
  checkpointId = (
    await api()
      .post(root() + '/offices')
      .set('Authorization', auth(owner))
      .send({
        name: 'Office reception',
        instructions: 'Meet at reception',
        deliveryCapacity: 100,
        timeSlotIds: [slotId],
      })
      .expect(201)
  ).body.data.id;
  await prisma.kitchenServiceArea.create({ data: { kitchenId, checkpointId } });
  scheduleId = (
    await prisma.mealSchedule.create({
      data: {
        mealId,
        kitchenId,
        timeSlotId: slotId,
        serviceDate: day,
        price: 100,
        totalQuantity: 100,
        status: 'PUBLISHED',
      },
    })
  ).id;
});
beforeEach(async () => {
  await prisma.order.deleteMany({
    where: { customerId: { in: [owner.id, employee.id] } },
  });
  await prisma.corporateOrderBatch.deleteMany({ where: { companyId } });
  await prisma.corporateInvoice.deleteMany({ where: { companyId } });
  await prisma.corporateAccount.update({
    where: { id: companyId },
    data: { ...policy(), status: 'ACTIVE', creditLimit: 1000, revision: 0 },
  });
  await prisma.corporateMember.updateMany({
    where: { companyId },
    data: { isActive: true, monthlyCredit: null },
  });
  await prisma.mealSchedule.update({
    where: { id: scheduleId },
    data: {
      reservedQuantity: 0,
      totalQuantity: 100,
      status: 'PUBLISHED',
      price: 100,
      serviceDate: day,
    },
  });
  await prisma.kitchen.update({
    where: { id: kitchenId },
    data: { capacityPerSlot: 100 },
  });
  await prisma.checkpointTimeSlot.update({
    where: { checkpointId_timeSlotId: { checkpointId, timeSlotId: slotId } },
    data: { maxOrders: 100 },
  });
  await prisma.serviceHoliday.deleteMany({ where: { cityId } });
});
afterAll(async () => {
  await prisma.order.deleteMany({
    where: { customerId: { in: [owner.id, employee.id] } },
  });
  await prisma.corporateOrderBatch.deleteMany({ where: { companyId } });
  await prisma.corporateInvoice.deleteMany({ where: { companyId } });
  await prisma.corporateAccount.delete({ where: { id: companyId } });
  await prisma.mealSchedule.deleteMany({ where: { mealId } });
  await prisma.meal.delete({ where: { id: mealId } });
  await prisma.kitchen.delete({ where: { id: kitchenId } });
  await prisma.checkpoint.delete({ where: { id: checkpointId } });
  await prisma.timeSlot.delete({ where: { id: slotId } });
  await prisma.institution.delete({ where: { id: institutionId } });
  await prisma.city.delete({ where: { id: cityId } });
  await prisma.mockProviderRefund.deleteMany({
    where: { paymentId: { in: paymentIds.map((id) => 'mock_pay_' + id) } },
  });
  await prisma.mockProviderPayment.deleteMany({
    where: { id: { in: paymentIds } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [owner.id, employee.id, outsider.id] } },
  });
  await prisma.$disconnect();
});
it('isolates corporate admin permissions and private employee/billing data', async () => {
  await api().get(root()).set('Authorization', auth(outsider)).expect(404);
  for (const path of ['/employees', '/invoices'])
    await api()
      .get(root() + path)
      .set('Authorization', auth(employee))
      .expect(404);
  await api()
    .patch(root() + '/policy')
    .set('Authorization', auth(employee))
    .send(policy())
    .expect(404);
  await api()
    .post(root() + '/credit')
    .set('Authorization', auth(owner))
    .send({
      revision: 0,
      status: 'ACTIVE',
      creditLimit: '1000',
      reason: 'Approve myself',
    })
    .expect(403);
  const d = await api()
    .get(root())
    .set('Authorization', auth(employee))
    .expect(200);
  expect(d.body.data.creditLimit).toBeUndefined();
  expect(d.body.data.billingEmail).toBeUndefined();
  await api()
    .post(root() + '/employees')
    .set('Authorization', auth(employee))
    .send({ email: outsider.email, employeeNumber: null, monthlyCredit: null })
    .expect(404);
  await api().get('/api/v1/corporate').expect(401);
});
it('requires platform credit approval, records policy revisions, and rejects protected financial fields', async () => {
  await prisma.corporateAccount.update({
    where: { id: companyId },
    data: { status: 'PENDING', creditLimit: 0 },
  });
  await api()
    .post(root() + '/orders')
    .set('Authorization', auth(employee))
    .send(input())
    .expect(409);
  await api()
    .post(root() + '/credit')
    .set('Authorization', admin)
    .send({
      revision: 0,
      status: 'ACTIVE',
      creditLimit: '1000',
      reason: 'Verified company credit approval',
    })
    .expect(200);
  await api()
    .patch(root() + '/policy')
    .set('Authorization', auth(owner))
    .send({ ...policy(), revision: 1 })
    .expect(200);
  await api()
    .patch(root() + '/policy')
    .set('Authorization', auth(owner))
    .send(policy())
    .expect(409);
  await api()
    .patch(root() + '/policy')
    .set('Authorization', auth(owner))
    .send({ ...policy(), revision: 2, creditLimit: '999999' })
    .expect(422);
  expect(
    await prisma.auditLog.count({
      where: { entityId: companyId, action: 'corporate.credit.updated' },
    }),
  ).toBeGreaterThan(0);
});
it('funds meals with approved company credit without inventing a provider payment, and deduplicates concurrent checkout', async () => {
  const body = input();
  const results = await Promise.all(
    [1, 2].map(() =>
      api()
        .post(root() + '/orders')
        .set('Authorization', auth(employee))
        .send(body)
        .expect(201),
    ),
  );
  const orderId = results[0].body.data.orders[0].orderId;
  expect(results[1].body.data.orders[0].orderId).toBe(orderId);
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { payments: true },
  });
  expect(order.status).toBe('CONFIRMED');
  expect(order.totalAmount.toString()).toBe('0');
  expect(order.payments).toHaveLength(0);
  await prisma.$transaction((tx) => assertOrderPaid(tx, orderId));
  expect(
    (await prisma.mealSchedule.findUniqueOrThrow({ where: { id: scheduleId } }))
      .reservedQuantity,
  ).toBe(1);
  await api()
    .post(root() + '/orders')
    .set('Authorization', auth(employee))
    .send({ ...body, maxEmployeeAmount: '1' })
    .expect(409);
});
it('charges only the employee co-payment and requires verified capture before fulfilment', async () => {
  await prisma.corporateAccount.update({
    where: { id: companyId },
    data: { subsidyPerMeal: 60 },
  });
  await api()
    .post(root() + '/orders')
    .set('Authorization', auth(employee))
    .send(input(employeeId, '39'))
    .expect(409);
  const result = await api()
    .post(root() + '/orders')
    .set('Authorization', auth(employee))
    .send(input(employeeId, '40'))
    .expect(201);
  const orderId = result.body.data.orders[0].orderId;
  await expect(
    prisma.$transaction((tx) => assertOrderPaid(tx, orderId)),
  ).rejects.toThrow(/verified/);
  const p = await createPayment(employee.id, orderId);
  paymentIds.push(p.payment.id);
  expect(p.checkout.amount).toBe(4000);
  await simulatePayment(employee.id, p.payment.id, 'authorized');
  expect(
    (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status,
  ).toBe('AWAITING_PAYMENT');
  await simulatePayment(employee.id, p.payment.id, 'captured');
  await prisma.$transaction((tx) => assertOrderPaid(tx, orderId));
  expect(
    (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status,
  ).toBe('CONFIRMED');
  await api()
    .post(root() + '/orders/' + orderId + '/cancel')
    .set('Authorization', auth(employee))
    .expect(200);
  expect(
    (await prisma.corporateCharge.findUniqueOrThrow({ where: { orderId } }))
      .status,
  ).toBe('RELEASED');
  const refund = await refundPayment(employee.id, p.payment.id, {
    idempotencyKey: randomUUID(),
    reason: 'Cancelled corporate meal',
  });
  expect(refund.amount.toString()).toBe('40');
});
it('rejects employee impersonation and admin-imposed co-payments; rolls back an invalid bulk batch', async () => {
  await api()
    .post(root() + '/orders')
    .set('Authorization', auth(employee))
    .send(input(ownerId))
    .expect(403);
  await prisma.corporateAccount.update({
    where: { id: companyId },
    data: { subsidyPerMeal: 60 },
  });
  await api()
    .post(root() + '/orders')
    .set('Authorization', auth(owner))
    .send(input(employeeId, '40'))
    .expect(400);
  await api()
    .post(root() + '/orders')
    .set('Authorization', auth(owner))
    .send(input(employeeId))
    .expect(409);
  await prisma.corporateAccount.update({
    where: { id: companyId },
    data: { subsidyPerMeal: 100 },
  });
  const body = input(ownerId);
  body.lines.push({
    ...body.lines[0]!,
    memberId: employeeId,
    mealScheduleId: 'missing',
  });
  await api()
    .post(root() + '/orders')
    .set('Authorization', auth(owner))
    .send(body)
    .expect(409);
  expect(await prisma.corporateCharge.count({ where: { companyId } })).toBe(0);
  expect(
    (await prisma.mealSchedule.findUniqueOrThrow({ where: { id: scheduleId } }))
      .reservedQuantity,
  ).toBe(0);
  body.lines[1]!.mealScheduleId = scheduleId;
  const good = await api()
    .post(root() + '/orders')
    .set('Authorization', auth(owner))
    .send({ ...body, idempotencyKey: randomUUID() })
    .expect(201);
  expect(good.body.data.orders).toHaveLength(2);
});
it('serializes company budgets across concurrent employees and restores credits on cancellation once', async () => {
  await prisma.corporateAccount.update({
    where: { id: companyId },
    data: { monthlyBudget: 100 },
  });
  const results = await Promise.all([
    api()
      .post(root() + '/orders')
      .set('Authorization', auth(employee))
      .send(input()),
    api()
      .post(root() + '/orders')
      .set('Authorization', auth(owner))
      .send(input(ownerId)),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  const charge = await prisma.corporateCharge.findFirstOrThrow({
    where: { companyId },
  });
  await api()
    .post(root() + '/orders/' + charge.orderId + '/cancel')
    .set('Authorization', auth(owner))
    .expect(200);
  await api()
    .post(root() + '/orders/' + charge.orderId + '/cancel')
    .set('Authorization', auth(owner))
    .expect(200);
  expect(
    (await prisma.mealSchedule.findUniqueOrThrow({ where: { id: scheduleId } }))
      .reservedQuantity,
  ).toBe(0);
  const usage = await api()
    .get(root() + '/usage?month=' + month)
    .set('Authorization', auth(owner))
    .expect(200);
  expect(usage.body.data.companyAmount).toBe('0.00');
});
it('enforces daily limits, employee credits, approved credit and meal policies', async () => {
  await prisma.corporateMember.update({
    where: { id: employeeId },
    data: { monthlyCredit: 50 },
  });
  await api()
    .post(root() + '/orders')
    .set('Authorization', auth(employee))
    .send(input())
    .expect(409);
  await prisma.corporateMember.update({
    where: { id: employeeId },
    data: { monthlyCredit: null },
  });
  await prisma.corporateAccount.update({
    where: { id: companyId },
    data: { creditLimit: 50 },
  });
  await api()
    .post(root() + '/orders')
    .set('Authorization', auth(employee))
    .send(input())
    .expect(409);
  await prisma.corporateAccount.update({
    where: { id: companyId },
    data: { creditLimit: 1000, allowedWeekdays: [(day.getUTCDay() + 1) % 7] },
  });
  await api()
    .post(root() + '/orders')
    .set('Authorization', auth(employee))
    .send(input())
    .expect(409);
  await prisma.corporateAccount.update({
    where: { id: companyId },
    data: { allowedWeekdays: [0, 1, 2, 3, 4, 5, 6], maxMealsPerDay: 1 },
  });
  await api()
    .post(root() + '/orders')
    .set('Authorization', auth(employee))
    .send(input())
    .expect(201);
  await api()
    .post(root() + '/orders')
    .set('Authorization', auth(employee))
    .send(input())
    .expect(409);
});
it('respects stock, checkpoint capacity, kitchen capacity and holidays without leaking budget reservations', async () => {
  await prisma.mealSchedule.update({
    where: { id: scheduleId },
    data: { totalQuantity: 0 },
  });
  await api()
    .post(root() + '/orders')
    .set('Authorization', auth(employee))
    .send(input())
    .expect(409);
  await prisma.mealSchedule.update({
    where: { id: scheduleId },
    data: { totalQuantity: 100 },
  });
  await prisma.kitchen.update({
    where: { id: kitchenId },
    data: { capacityPerSlot: 0 },
  });
  await api()
    .post(root() + '/orders')
    .set('Authorization', auth(employee))
    .send(input())
    .expect(409);
  await prisma.kitchen.update({
    where: { id: kitchenId },
    data: { capacityPerSlot: 100 },
  });
  await prisma.checkpointTimeSlot.update({
    where: { checkpointId_timeSlotId: { checkpointId, timeSlotId: slotId } },
    data: { maxOrders: 0 },
  });
  await api()
    .post(root() + '/orders')
    .set('Authorization', auth(employee))
    .send(input())
    .expect(409);
  await prisma.checkpointTimeSlot.update({
    where: { checkpointId_timeSlotId: { checkpointId, timeSlotId: slotId } },
    data: { maxOrders: 100 },
  });
  await prisma.serviceHoliday.create({
    data: { cityId, serviceDate: day, name: 'Closed' },
  });
  await api()
    .post(root() + '/orders')
    .set('Authorization', auth(employee))
    .send(input())
    .expect(409);
  expect(await prisma.corporateCharge.count({ where: { companyId } })).toBe(0);
});
it('creates immutable monthly statements once, excludes employee co-payments and restricts settlement to platform finance', async () => {
  const result = await api()
    .post(root() + '/orders')
    .set('Authorization', auth(employee))
    .send(input())
    .expect(201);
  const orderId = result.body.data.orders[0].orderId;
  const previous = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth() - 1, 10),
  );
  const billMonth = dateKey(previous).slice(0, 7);
  await prisma.orderItem.updateMany({
    where: { orderId },
    data: { serviceDate: previous, status: 'DELIVERED' },
  });
  await prisma.corporateCharge.update({
    where: { orderId },
    data: { serviceDate: previous, month: billMonth },
  });
  const issued = await api()
    .post(root() + '/invoices')
    .set('Authorization', auth(owner))
    .send({ month: billMonth })
    .expect(201);
  const invoiceId = issued.body.data.id;
  expect(issued.body.data.amount).toBe('100');
  const replay = await api()
    .post(root() + '/invoices')
    .set('Authorization', auth(owner))
    .send({ month: billMonth })
    .expect(201);
  expect(replay.body.data.id).toBe(invoiceId);
  const data = {
    amount: '100',
    reference: 'BANK-' + randomUUID(),
    reason: 'Bank transfer verified by finance',
  };
  await api()
    .post(root() + '/invoices/' + invoiceId + '/settle')
    .set('Authorization', auth(owner))
    .send(data)
    .expect(403);
  await api()
    .post(root() + '/invoices/' + invoiceId + '/settle')
    .set('Authorization', admin)
    .send({ ...data, amount: '99' })
    .expect(400);
  await api()
    .post(root() + '/invoices/' + invoiceId + '/settle')
    .set('Authorization', admin)
    .send(data)
    .expect(200);
  await api()
    .post(root() + '/invoices/' + invoiceId + '/settle')
    .set('Authorization', admin)
    .send(data)
    .expect(200);
  expect(
    (await prisma.corporateCharge.findUniqueOrThrow({ where: { orderId } }))
      .status,
  ).toBe('SETTLED');
  expect(
    await prisma.auditLog.count({
      where: { entityId: companyId, action: 'corporate.invoice.settled' },
    }),
  ).toBe(1);
});
it('expires unpaid past meals in bounded batches and releases stock and company credit', async () => {
  await prisma.corporateAccount.update({
    where: { id: companyId },
    data: { subsidyPerMeal: 60 },
  });
  const result = await api()
    .post(root() + '/orders')
    .set('Authorization', auth(employee))
    .send(input(employeeId, '40'))
    .expect(201);
  const orderId = result.body.data.orders[0].orderId;
  const past = addDays(cityToday('Asia/Kolkata'), -1);
  await prisma.corporateCharge.update({
    where: { orderId },
    data: { serviceDate: past },
  });
  await prisma.orderItem.updateMany({
    where: { orderId },
    data: { serviceDate: past },
  });
  const res = await api()
    .post(root() + '/expire')
    .set('Authorization', auth(owner))
    .expect(200);
  expect(res.body.data).toEqual({ expired: 1, batchLimit: 50 });
  expect(
    (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status,
  ).toBe('CANCELLED');
  expect(
    (await prisma.mealSchedule.findUniqueOrThrow({ where: { id: scheduleId } }))
      .reservedQuantity,
  ).toBe(0);
});
it('keeps consumer ordering and existing unverified-payment rules intact', async () => {
  const personal = await prisma.order.create({
    data: {
      customerId: employee.id,
      orderNumber: 'PERSONAL-' + randomUUID(),
      subtotal: 100,
      totalAmount: 100,
    },
  });
  await expect(
    prisma.$transaction((tx) => assertOrderPaid(tx, personal.id)),
  ).rejects.toThrow(/verified/);
  const before = await prisma.cart.count({ where: { userId: employee.id } });
  await api()
    .post(root() + '/orders')
    .set('Authorization', auth(employee))
    .send(input())
    .expect(201);
  expect(await prisma.cart.count({ where: { userId: employee.id } })).toBe(
    before,
  );
  await prisma.corporateMember.update({
    where: { id: employeeId },
    data: { isActive: false },
  });
  await api()
    .get(root() + '/orders')
    .set('Authorization', auth(employee))
    .expect(404);
  await api()
    .get('/api/v1/orders')
    .set('Authorization', auth(employee))
    .expect(200);
});

it('releases company credits when a kitchen cancels the meal', async () => {
  const result = await api()
    .post(root() + '/orders')
    .set('Authorization', auth(employee))
    .send(input())
    .expect(201);
  const orderId = result.body.data.orders[0].orderId;
  const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });
  await updateOrderItemStatus(vendorId, item.id, {
    status: 'CANCELLED',
    reason: 'Kitchen unavailable',
  });
  expect(
    (await prisma.corporateCharge.findUniqueOrThrow({ where: { orderId } }))
      .status,
  ).toBe('RELEASED');
  expect(
    (await prisma.mealSchedule.findUniqueOrThrow({ where: { id: scheduleId } }))
      .reservedQuantity,
  ).toBe(0);
  const usage = await api()
    .get(root() + '/usage?month=' + month)
    .set('Authorization', auth(owner))
    .expect(200);
  expect(usage.body.data.companyAmount).toBe('0.00');
});

it('integrates company-funded meals into kitchen lists, packing and route candidates', async () => {
  const result = await api().post(root() + '/orders').set('Authorization', auth(employee)).send(input()).expect(201);
  const orderId = result.body.data.orders[0].orderId;
  const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });
  const url = `/api/v1/kitchen/${kitchenId}`;
  const query = { serviceDate: dateKey(day) };
  const dashboard = await api().get(url + '/dashboard').set('Authorization', admin).query(query).expect(200);
  expect(dashboard.body.data.totalMeals).toBe(1);
  const packing = await api().get(url + '/packing').set('Authorization', admin).query(query).expect(200);
  expect(packing.body.data.items.map((i: { id: string }) => i.id)).toContain(item.id);
  for (const status of ['PREPARING', 'PACKED']) {
    const updated = await api().post(url + '/items/status').set('Authorization', admin)
      .send({ ...query, orderItemIds: [item.id], status }).expect(200);
    expect(updated.body.data.updated).toEqual([item.id]);
  }
  const available = await api().get('/api/v1/admin/routes/candidates').set('Authorization', admin)
    .query({ date: dateKey(day), kitchenId }).expect(200);
  expect(JSON.stringify(available.body.data)).toContain(item.id);
  await prisma.corporateCharge.update({ where: { orderId }, data: { status: 'RELEASED' } });
  const released = await api().get(url + '/dashboard').set('Authorization', admin).query(query).expect(200);
  expect(released.body.data.totalMeals).toBe(0);
});
