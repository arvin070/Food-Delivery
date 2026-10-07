import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/core/prisma';
import { api, disconnect } from './helpers';

const PREFIX = `delivery-flow-${Date.now()}-`;
let adminToken: string;
let riderToken: string;
let customerToken: string;
let riderId: string;
let orderId: string;
let orderItemId: string;
let deliveryId: string;

beforeAll(async () => {
  const [admin, rider, customer] = await Promise.all([
    api().post('/api/v1/auth/login').send({ identifier: 'admin@lunch.test', password: 'Lunch@1234' }),
    api().post('/api/v1/auth/login').send({ identifier: 'rider@lunch.test', password: 'Lunch@1234' }),
    api().post('/api/v1/auth/login').send({ identifier: 'customer@lunch.test', password: 'Lunch@1234' }),
  ]);
  adminToken = admin.body.data.tokens.accessToken as string;
  riderToken = rider.body.data.tokens.accessToken as string;
  customerToken = customer.body.data.tokens.accessToken as string;
  const [buyer, partner, schedule] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { email: 'customer@lunch.test' }, select: { id: true } }),
    prisma.deliveryPartner.findFirstOrThrow({ where: { user: { email: 'rider@lunch.test' }, isActive: true }, select: { id: true } }),
    prisma.mealSchedule.findFirstOrThrow({
      where: {
        status: 'PUBLISHED',
        kitchen: { vendor: { status: 'APPROVED', isActive: true }, serviceAreas: { some: { isActive: true } } },
      },
      include: { meal: true, kitchen: true, timeSlot: true },
    }),
  ]);
  riderId = partner.id;
  const serviceArea = await prisma.kitchenServiceArea.findFirstOrThrow({
    where: { kitchenId: schedule.kitchenId, isActive: true, checkpoint: { isActive: true } },
    select: { checkpointId: true },
  });
  const order = await prisma.order.create({
    data: {
      orderNumber: `${PREFIX}ORDER`,
      customerId: buyer.id,
      status: 'PACKED',
      subtotal: schedule.price,
      totalAmount: schedule.price,
      items: {
        create: {
          mealScheduleId: schedule.id,
          mealId: schedule.mealId,
          kitchenId: schedule.kitchenId,
          checkpointId: serviceArea.checkpointId,
          timeSlotId: schedule.timeSlotId,
          serviceDate: schedule.serviceDate,
          beneficiaryName: 'Delivery Flow Beneficiary',
          mealNameSnapshot: schedule.meal.name,
          unitPrice: schedule.price,
          quantity: 1,
          lineTotal: schedule.price,
          status: 'PACKED',
        },
      },
    },
    select: { id: true, items: { select: { id: true } } },
  });
  orderId = order.id;
  orderItemId = order.items[0]!.id;
});

afterAll(async () => {
  if (orderId) await prisma.order.delete({ where: { id: orderId } });
  await disconnect();
});

describe('delivery assignment and order status lifecycle', () => {
  it('assigns packed orders to a rider and advances delivery through checkpoint handoff', async () => {
    const assigned = await api()
      .post(`/api/v1/delivery/items/${orderItemId}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ deliveryPartnerId: riderId })
      .expect(201);
    deliveryId = assigned.body.data.delivery.id as string;
    expect(assigned.body.data.delivery.orderStatus).toBe('ASSIGNED');

    const queue = await api()
      .get('/api/v1/delivery/items')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(200);
    expect(queue.body.data.deliveries.some((delivery: { id: string }) => delivery.id === deliveryId)).toBe(true);

    for (const status of ['OUT_FOR_DELIVERY', 'AT_CHECKPOINT'] as const) {
      const response = await api()
        .patch(`/api/v1/delivery/items/${deliveryId}/status`)
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ status })
        .expect(200);
      expect(response.body.data.delivery.status).toBe(status);
    }

    await api()
      .patch(`/api/v1/delivery/items/${deliveryId}/status`)
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ status: 'DELIVERED', receiverName: 'Campus Security' })
      .expect(200);

    const order = await api()
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(order.body.data.order.status).toBe('DELIVERED');
    expect(order.body.data.order.items[0].deliveryStatus).toBe('DELIVERED');
  });

  it('rejects delivery skips after handoff is complete', async () => {
    const impossible = await api()
      .patch(`/api/v1/delivery/items/${deliveryId}/status`)
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ status: 'OUT_FOR_DELIVERY' })
      .expect(422);
    expect(impossible.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });
});