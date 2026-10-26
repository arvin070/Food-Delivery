import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCode } from '@lunch/shared';
import { prisma } from '../src/core/prisma';
import { api, disconnect } from './helpers';

const PASSWORD = 'Lunch@1234';
const KEY_PREFIX = `order-flow-test-${Date.now()}-`;
let token: string;
let customerId: string;
let cartId: string;
let scheduleId: string;
let checkpointId: string;
let timeSlotId: string;
let kitchenId: string;
let kitchenCapacity: number;
let checkpointWindowId: string;
let checkpointWindowCapacity: number | null;
let expectedPrice: string;
let serviceDate: Date;
let cartItemId: string;
let orderId: string;
let idempotencyKey: string;

const auth = () => `Bearer ${token}`;

beforeAll(async () => {
  const login = await api()
    .post('/api/v1/auth/login')
    .send({ identifier: 'customer@lunch.test', password: PASSWORD })
    .expect(200);
  token = login.body.data.tokens.accessToken as string;
  const customer = await prisma.user.findUniqueOrThrow({
    where: { email: 'customer@lunch.test' },
    select: { id: true },
  });
  customerId = customer.id;
  const cart = await prisma.cart.upsert({
    where: { userId: customerId },
    update: {},
    create: { userId: customerId },
    select: { id: true },
  });
  cartId = cart.id;
  await prisma.cartItem.deleteMany({ where: { cartId } });
  await prisma.order.deleteMany({ where: { customerId, idempotencyKey: { startsWith: KEY_PREFIX } } });

  const kitchen = await prisma.kitchen.findFirstOrThrow({
    where: { vendor: { status: 'APPROVED', isActive: true }, isActive: true },
    select: { id: true, vendorId: true, capacityPerSlot: true, serviceAreas: { where: { isActive: true }, select: { checkpointId: true } } },
  });
  kitchenId = kitchen.id;
  kitchenCapacity = kitchen.capacityPerSlot;
  const meal = await prisma.meal.findFirstOrThrow({
    where: { vendorId: kitchen.vendorId, isActive: true, deletedAt: null },
    select: { id: true, basePrice: true },
  });
  const window = await prisma.checkpointTimeSlot.findFirstOrThrow({
    where: {
      isActive: true,
      checkpointId: { in: kitchen.serviceAreas.map((area) => area.checkpointId) },
      timeSlot: { isActive: true },
    },
    select: { id: true, checkpointId: true, timeSlotId: true, maxOrders: true },
  });
  checkpointId = window.checkpointId;
  const slot = { id: window.timeSlotId };
  checkpointWindowId = window.id;
  checkpointWindowCapacity = window.maxOrders;
  timeSlotId = slot.id;
  serviceDate = new Date();
  serviceDate.setUTCHours(0, 0, 0, 0);
  serviceDate.setUTCDate(serviceDate.getUTCDate() + 90);
  const schedule = await prisma.mealSchedule.create({
    data: {
      mealId: meal.id,
      kitchenId: kitchen.id,
      timeSlotId,
      serviceDate,
      price: meal.basePrice,
      totalQuantity: 10,
      status: 'PUBLISHED',
    },
    select: { id: true, price: true },
  });
  scheduleId = schedule.id;
  expectedPrice = Number(schedule.price).toFixed(2);
});

afterAll(async () => {
  await prisma.cartItem.deleteMany({ where: { cartId } });
  await prisma.order.deleteMany({ where: { customerId, idempotencyKey: { startsWith: KEY_PREFIX } } });
  if (checkpointWindowId) {
    await prisma.checkpointTimeSlot.update({ where: { id: checkpointWindowId }, data: { maxOrders: checkpointWindowCapacity } });
  }
  if (kitchenId) await prisma.kitchen.update({ where: { id: kitchenId }, data: { capacityPerSlot: kitchenCapacity } });
  if (scheduleId) await prisma.mealSchedule.deleteMany({ where: { id: scheduleId } });
  await disconnect();
});

describe('customer cart and order lifecycle', () => {
  it('creates and views an empty customer-owned cart', async () => {
    const response = await api().get('/api/v1/cart').set('Authorization', auth()).expect(200);
    expect(response.body.data.cart).toMatchObject({ id: cartId, items: [], itemCount: 0, subtotal: '0.00' });
    const created = await api().post('/api/v1/cart').set('Authorization', auth()).expect(201);
    expect(created.body.data.cart.id).toBe(cartId);
  });

  it('adds items at the server price and updates quantity', async () => {
    const added = await api()
      .post('/api/v1/cart/items')
      .set('Authorization', auth())
      .send({ mealScheduleId: scheduleId, checkpointId, quantity: 1, price: '0.01' })
      .expect(201);
    expect(added.body.data.cart.items[0]).toMatchObject({ unitPrice: expectedPrice, quantity: 1 });
    cartItemId = added.body.data.cart.items[0].id as string;

    const updated = await api()
      .patch(`/api/v1/cart/items/${cartItemId}`)
      .set('Authorization', auth())
      .send({ quantity: 2 })
      .expect(200);
    expect(updated.body.data.cart.items[0]).toMatchObject({ quantity: 2, lineTotal: (Number(expectedPrice) * 2).toFixed(2) });
  });

  it('rejects checkout over checkpoint or kitchen capacity without clearing the cart', async () => {
    await prisma.checkpointTimeSlot.update({ where: { id: checkpointWindowId }, data: { maxOrders: 1 } });
    await api()
      .post('/api/v1/orders/checkout')
      .set('Authorization', auth())
      .send({ idempotencyKey: `${KEY_PREFIX}checkpoint-capacity` })
      .expect(409);
    await prisma.checkpointTimeSlot.update({ where: { id: checkpointWindowId }, data: { maxOrders: checkpointWindowCapacity } });

    await prisma.kitchen.update({ where: { id: kitchenId }, data: { capacityPerSlot: 1 } });
    await api()
      .post('/api/v1/orders/checkout')
      .set('Authorization', auth())
      .send({ idempotencyKey: `${KEY_PREFIX}kitchen-capacity` })
      .expect(409);
    await prisma.kitchen.update({ where: { id: kitchenId }, data: { capacityPerSlot: kitchenCapacity } });

    expect((await api().get('/api/v1/cart').set('Authorization', auth()).expect(200)).body.data.cart.items).toHaveLength(1);
  });

  it('checks out atomically, snapshots payment and fulfillment data, and replays idempotently', async () => {
    idempotencyKey = `${KEY_PREFIX}checkout`;
    const response = await api()
      .post('/api/v1/orders/checkout')
      .set('Authorization', auth())
      .send({ idempotencyKey })
      .expect(201);
    const order = response.body.data.order;
    orderId = order.id as string;
    expect(order).toMatchObject({
      status: 'AWAITING_PAYMENT',
      paymentStatus: 'CREATED',
      subtotal: (Number(expectedPrice) * 2).toFixed(2),
    });
    expect(order.items).toHaveLength(1);
    const [item] = order.items;
    expect(item.mealName).toBeTypeOf('string');
    expect(item).toMatchObject({
      quantity: 2,
      unitPrice: expectedPrice,
      serviceDate: serviceDate.toISOString().slice(0, 10),
      checkpoint: { id: checkpointId },
      timeSlot: { id: timeSlotId },
      status: 'PENDING',
    });
    expect(item.kitchen.id).toBeTypeOf('string');

    const replay = await api()
      .post('/api/v1/orders/checkout')
      .set('Authorization', auth())
      .send({ idempotencyKey })
      .expect(201);
    expect(replay.body.data.order.id).toBe(orderId);
    expect(await prisma.order.count({ where: { customerId, idempotencyKey } })).toBe(1);
    expect((await api().get('/api/v1/cart').set('Authorization', auth()).expect(200)).body.data.cart.items).toHaveLength(0);
  });

  it('supports order detail and customer history while hiding other customers’ orders', async () => {
    const detail = await api()
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', auth())
      .expect(200);
    expect(detail.body.data.order.orderNumber).toMatch(/^LN-/);

    const history = await api().get('/api/v1/orders/history').set('Authorization', auth()).expect(200);
    expect(history.body.data.some((order: { id: string }) => order.id === orderId)).toBe(true);

    const other = await api().post('/api/v1/auth/register').send({
      fullName: 'Other Order Customer',
      email: `order-other-${Date.now()}@test.lunch`,
      password: 'Str0ngPass!',
    }).expect(201);
    const hidden = await api()
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${other.body.data.tokens.accessToken}`)
      .expect(404);
    expect(hidden.body.error.code).toBe(ErrorCode.NOT_FOUND);
  });

  it('cancels an eligible order and releases meal stock', async () => {
    const before = await prisma.mealSchedule.findUniqueOrThrow({ where: { id: scheduleId }, select: { reservedQuantity: true } });
    const cancelled = await api()
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', auth())
      .send({ reason: 'Changed plans' })
      .expect(200);
    expect(cancelled.body.data.order.status).toBe('CANCELLED');
    const after = await prisma.mealSchedule.findUniqueOrThrow({ where: { id: scheduleId }, select: { reservedQuantity: true } });
    expect(after.reservedQuantity).toBe(before.reservedQuantity - 2);
  });

  it('rejects unavailable schedules, invalid quantities, and anonymous cart access', async () => {
    await api().get('/api/v1/cart').expect(401);
    await api()
      .post('/api/v1/cart/items')
      .set('Authorization', auth())
      .send({ mealScheduleId: 'unknown-schedule', checkpointId, quantity: 1 })
      .expect(400);
    await api()
      .post('/api/v1/cart/items')
      .set('Authorization', auth())
      .send({ mealScheduleId: scheduleId, checkpointId, quantity: 0 })
      .expect(422);
  });

  it('removes an item from the caller’s cart', async () => {
    const item = await prisma.cartItem.create({
      data: {
        cartId,
        mealScheduleId: scheduleId,
        timeSlotId,
        serviceDate,
        checkpointId,
        quantity: 1,
        unitPrice: expectedPrice,
      },
      select: { id: true },
    });
    await api().delete(`/api/v1/cart/items/${item.id}`).set('Authorization', auth()).expect(204);
    expect(await prisma.cartItem.findUnique({ where: { id: item.id } })).toBeNull();
  });
});