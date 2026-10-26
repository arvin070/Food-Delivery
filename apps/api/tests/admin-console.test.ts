import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { adminResources } from '@lunch/shared';
import { api, registerUser, disconnect, type RegisteredUser } from './helpers';
import { prisma } from '../src/core/prisma';
let admin: string, customer: RegisteredUser;
const root = '/api/v1/admin';
beforeAll(async () => {
  const login = await api()
    .post('/api/v1/auth/login')
    .send({ identifier: 'admin@lunch.test', password: 'Lunch@1234' })
    .expect(200);
  admin = 'Bearer ' + login.body.data.tokens.accessToken;
  customer = await registerUser();
});
afterAll(async () => {
  await prisma.order.deleteMany({ where: { customerId: customer.id } });
  await prisma.user.delete({ where: { id: customer.id } });
  await disconnect();
});
for (const resource of adminResources) {
  it(`lists and searches ${resource} with safe projections`, async () => {
    const res = await api()
      .get(`${root}/manage/${resource}`)
      .set('Authorization', admin)
      .expect(200);
    expect(res.body.data.pageSize).toBe(25);
    expect(res.body.data.items.length).toBeLessThanOrEqual(25);
    expect(JSON.stringify(res.body)).not.toMatch(
      /passwordHash|providerPayload|otpHash|refreshToken/,
    );
    await api()
      .get(`${root}/manage/${resource}?search=%27%25_&page=2`)
      .set('Authorization', admin)
      .expect(200);
    if (res.body.data.items[0])
      await api()
        .get(`${root}/manage/${resource}/${res.body.data.items[0].id}`)
        .set('Authorization', admin)
        .expect(200);
  });
  it(`denies customers access to ${resource}`, async () => {
    await api()
      .get(`${root}/manage/${resource}`)
      .set('Authorization', 'Bearer ' + customer.accessToken)
      .expect(403);
    await api()
      .post(`${root}/manage/${resource}/unknown/actions`)
      .set('Authorization', 'Bearer ' + customer.accessToken)
      .send({})
      .expect(403);
  });
}
it('validates resource, dates and status filters', async () => {
  await api()
    .get(`${root}/manage/secrets`)
    .set('Authorization', admin)
    .expect(422);
  await api()
    .get(`${root}/dashboard?date=2040-02-31`)
    .set('Authorization', admin)
    .expect(422);
  await api()
    .get(`${root}/manage/users?status=INVALID`)
    .set('Authorization', admin)
    .expect(400);
  const res = await api()
    .get(
      `${root}/manage/users?search=${customer.email}&role=CUSTOMER&status=ACTIVE`,
    )
    .set('Authorization', admin)
    .expect(200);
  expect(res.body.data.items.map((x: { id: string }) => x.id)).toEqual([
    customer.id,
  ]);
});
it('returns date-scoped metrics and rejects anonymous access', async () => {
  await api().get(`${root}/dashboard`).expect(401);
  const res = await api()
    .get(`${root}/dashboard?date=2098-01-01`)
    .set('Authorization', admin)
    .expect(200);
  expect(res.body.data).toMatchObject({
    date: '2098-01-01',
    timezone: 'Asia/Kolkata',
    metrics: { orders: 0, meals: 0, pendingDeliveries: 0, failedDeliveries: 0 },
    revenue: [],
  });
  expect(res.body.data.metrics.activeUsers).toBeGreaterThan(0);
});
it('handles complaints idempotently, enforces ownership and audits revision-checked resolution', async () => {
  const auth = 'Bearer ' + customer.accessToken;
  const input = {
    subject: 'Missing meal',
    message: 'The meal did not arrive at my checkpoint.',
    idempotencyKey: randomUUID(),
  };
  const first = await api()
    .post('/api/v1/complaints')
    .set('Authorization', auth)
    .send(input)
    .expect(201);
  const id = first.body.data.id;
  const replay = await api()
    .post('/api/v1/complaints')
    .set('Authorization', auth)
    .send(input)
    .expect(201);
  expect(replay.body.data.id).toBe(id);
  await api()
    .post('/api/v1/complaints')
    .set('Authorization', auth)
    .send({ ...input, subject: 'Changed subject' })
    .expect(409);
  await api()
    .post('/api/v1/complaints')
    .set('Authorization', auth)
    .send({ ...input, idempotencyKey: randomUUID(), orderId: 'not-owned' })
    .expect(404);
  const change = {
    action: 'RESOLVE',
    expectedStatus: 'OPEN',
    revision: 0,
    reason: 'Replacement meal arranged.',
  };
  await api()
    .post(`${root}/manage/complaints/${id}/actions`)
    .set('Authorization', admin)
    .send(change)
    .expect(200);
  await api()
    .post(`${root}/manage/complaints/${id}/actions`)
    .set('Authorization', admin)
    .send(change)
    .expect(409);
  const own = await api()
    .get('/api/v1/complaints')
    .set('Authorization', auth)
    .expect(200);
  expect(own.body.data.items).toHaveLength(1);
  expect(own.body.data.items[0]).toMatchObject({
    status: 'RESOLVED',
    response: change.reason,
  });
  const audit = await api()
    .get(`${root}/audit?search=${id}`)
    .set('Authorization', admin)
    .expect(200);
  expect(audit.body.data.items[0]).toMatchObject({
    entityId: id,
    after: { status: 'RESOLVED', reason: change.reason },
  });
});
it('suspends users atomically, audits the reason and rejects stale changes', async () => {
  const path = `${root}/manage/users/${customer.id}/actions`;
  await api()
    .post(path)
    .set('Authorization', admin)
    .send({
      action: 'SUSPEND',
      expectedStatus: 'ACTIVE',
      reason: 'Investigating complaint abuse',
    })
    .expect(200);
  await api()
    .get('/api/v1/auth/me')
    .set('Authorization', 'Bearer ' + customer.accessToken)
    .expect(403);
  await api()
    .post(path)
    .set('Authorization', admin)
    .send({
      action: 'DEACTIVATE',
      expectedStatus: 'ACTIVE',
      reason: 'Stale request',
    })
    .expect(409);
  const entry = await prisma.auditLog.findFirst({
    where: { entityId: customer.id, action: 'user.status.updated' },
  });
  expect(entry?.after).toMatchObject({
    status: 'SUSPENDED',
    reason: 'Investigating complaint abuse',
  });
  await api()
    .post(path)
    .set('Authorization', admin)
    .send({
      action: 'ACTIVATE',
      expectedStatus: 'SUSPENDED',
      reason: 'Investigation complete',
    })
    .expect(200);
  await api().get('/api/v1/auth/me').set('Authorization','Bearer '+customer.accessToken).expect(401);
  customer.accessToken=(await api().post('/api/v1/auth/login').send({identifier:customer.email,password:customer.password}).expect(200)).body.data.tokens.accessToken;
});

it('counts orders once, excludes cancelled meals, and reconciles verified daily collections by currency', async () => {
  const kitchen = await prisma.kitchen.findFirstOrThrow();
  const checkpoint = await prisma.checkpoint.findFirstOrThrow();
  const slot = await prisma.timeSlot.findFirstOrThrow();
  const date = new Date('2097-04-10');
  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      orderNumber: 'ADMIN-' + randomUUID(),
      subtotal: 500,
      totalAmount: 500,
      items: {
        create: [
          {
            kitchenId: kitchen.id,
            checkpointId: checkpoint.id,
            timeSlotId: slot.id,
            serviceDate: date,
            beneficiaryName: 'Test',
            mealNameSnapshot: 'Lunch',
            unitPrice: 100,
            lineTotal: 200,
            quantity: 2,
            status: 'CONFIRMED',
          },
          {
            kitchenId: kitchen.id,
            checkpointId: checkpoint.id,
            timeSlotId: slot.id,
            serviceDate: date,
            beneficiaryName: 'Test',
            mealNameSnapshot: 'Lunch',
            unitPrice: 100,
            lineTotal: 300,
            quantity: 3,
            status: 'CANCELLED',
          },
          {
            kitchenId: kitchen.id,
            checkpointId: checkpoint.id,
            timeSlotId: slot.id,
            serviceDate: date,
            beneficiaryName: 'Test',
            mealNameSnapshot: 'Lunch',
            unitPrice: 100,
            lineTotal: 100,
            quantity: 1,
            status: 'CONFIRMED',
          },
        ],
      },
    },
  });
  const start = new Date('2097-04-09T18:30:00Z');
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      amount: 500,
      status: 'PARTIALLY_REFUNDED',
      paidAt: start,
      lastVerifiedAt: start,
      refundedAmount: 100,
    },
  });
  await prisma.refund.create({
    data: {
      paymentId: payment.id,
      amount: 100,
      status: 'PROCESSED',
      processedAt: start,
    },
  });
  await prisma.payment.createMany({
    data: [
      { orderId: order.id, amount: 999, status: 'PAID', paidAt: start },
      {
        orderId: order.id,
        amount: 888,
        status: 'FAILED',
        paidAt: start,
        lastVerifiedAt: start,
      },
      {
        orderId: order.id,
        amount: 777,
        status: 'PAID',
        paidAt: new Date('2097-04-10T18:30:00Z'),
        lastVerifiedAt: start,
      },
      {
        orderId: order.id,
        amount: 12.34,
        currency: 'USD',
        status: 'PAID',
        paidAt: start,
        lastVerifiedAt: start,
      },
    ],
  });
  const res = await api()
    .get(`${root}/dashboard?date=2097-04-10`)
    .set('Authorization', admin)
    .expect(200);
  expect(res.body.data.metrics).toMatchObject({ orders: 1, meals: 3 });
  expect(res.body.data.revenue).toEqual([
    { currency: 'INR', collected: '500.00', refunded: '100.00', net: '400.00' },
    { currency: 'USD', collected: '12.34', refunded: '0.00', net: '12.34' },
  ]);
  const listing = await api()
    .get(`${root}/manage/orders?date=2097-04-10`)
    .set('Authorization', admin)
    .expect(200);
  expect(listing.body.data.items.map((x: { id: string }) => x.id)).toEqual([
    order.id,
  ]);
  await api()
    .post(`${root}/manage/kitchens/${kitchen.id}/actions`)
    .set('Authorization', admin)
    .send({
      action: 'DEACTIVATE',
      expectedStatus: 'ACTIVE',
      reason: 'Kitchen maintenance',
    })
    .expect(409);
  await api()
    .post(`${root}/manage/orders/${order.id}/actions`)
    .set('Authorization', admin)
    .send({
      action: 'APPROVE',
      expectedStatus: 'AWAITING_PAYMENT',
      reason: 'Manual confirmation attempt',
    })
    .expect(400);
});

it('replays simultaneous complaint submissions without duplicate records', async () => {
 const input={subject:'Concurrent request',message:'Please check this delivery request.',idempotencyKey:randomUUID()};
 const results=await Promise.all([1,2].map(()=>api().post('/api/v1/complaints').set('Authorization','Bearer '+customer.accessToken).send(input).expect(201)));
 expect(results[0].body.data.id).toBe(results[1].body.data.id);
 expect(await prisma.complaint.count({where:{userId:customer.id,idempotencyKey:input.idempotencyKey}})).toBe(1);
});
