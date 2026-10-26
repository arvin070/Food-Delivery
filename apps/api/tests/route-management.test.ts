import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/core/prisma';
import { api, disconnect } from './helpers';
import {
  cityToday,
  dateKey,
  addDays,
} from '../src/modules/subscriptions/recurrence';
import type { CreateRouteInput, ManagedRoute } from '@lunch/shared';

const prefix = 'routes-' + Date.now();
let admin: string,
  customerToken: string,
  buyerId: string,
  kitchenId: string,
  cityId: string,
  mealId: string,
  passwordHash: string;
let date: string;
const checkpoints: string[] = [];
const slots: string[] = [];
const users: string[] = [];
const orders: string[] = [];
beforeAll(async () => {
  const [a, c, buyer, kitchen, rider] = await Promise.all([
    api()
      .post('/api/v1/auth/login')
      .send({ identifier: 'admin@lunch.test', password: 'Lunch@1234' })
      .expect(200),
    api()
      .post('/api/v1/auth/login')
      .send({ identifier: 'customer@lunch.test', password: 'Lunch@1234' })
      .expect(200),
    prisma.user.findUniqueOrThrow({ where: { email: 'customer@lunch.test' } }),
    prisma.kitchen.findFirstOrThrow({
      where: { isActive: true, deletedAt: null, meals: { some: {} } },
      include: { city: true, meals: { take: 1 } },
    }),
    prisma.user.findUniqueOrThrow({ where: { email: 'rider@lunch.test' } }),
  ]);
  admin = a.body.data.tokens.accessToken;
  customerToken = c.body.data.tokens.accessToken;
  buyerId = buyer.id;
  kitchenId = kitchen.id;
  cityId = kitchen.cityId;
  mealId = kitchen.meals[0]!.id;
  passwordHash = rider.passwordHash!;
  date = dateKey(cityToday(kitchen.city.timezone));
  for (const name of ['Gate A', 'Gate B', 'Hostel']) {
    const cp = await prisma.checkpoint.create({
      data: {
        name: prefix + ' ' + name,
        type: 'OTHER',
        cityId,
        latitude: 12.9,
        longitude: 77.6,
      },
    });
    checkpoints.push(cp.id);
  }
  for (const minute of [750, 780]) {
    const slot = await prisma.timeSlot.create({
      data: {
        cityId,
        label: prefix + ' ' + minute,
        mealPeriod: 'LUNCH',
        startMinute: minute,
        endMinute: minute + 30,
      },
    });
    slots.push(slot.id);
  }
});
afterAll(async () => {
  await prisma.order.deleteMany({ where: { id: { in: orders } } });
  const runs = await prisma.deliveryRun.findMany({
    where: { deliveryPartner: { userId: { in: users } } },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({
    where: {
      entityType: 'DeliveryRun',
      entityId: { in: runs.map((r) => r.id) },
    },
  });
  await prisma.deliveryRun.deleteMany({
    where: { id: { in: runs.map((r) => r.id) } },
  });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.checkpoint.deleteMany({ where: { id: { in: checkpoints } } });
  await prisma.timeSlot.deleteMany({ where: { id: { in: slots } } });
  await disconnect();
});
async function partner() {
  const u = await prisma.user.create({
    data: {
      email: prefix + '-' + randomUUID() + '@test.local',
      fullName: 'Route rider',
      role: 'DELIVERY_PARTNER',
      status: 'ACTIVE',
      passwordHash,
      deliveryPartner: { create: { cityId } },
    },
    include: { deliveryPartner: true },
  });
  users.push(u.id);
  const r = await api()
    .post('/api/v1/auth/login')
    .send({ identifier: u.email, password: 'Lunch@1234' })
    .expect(200);
  return {
    id: u.deliveryPartner!.id,
    token: r.body.data.tokens.accessToken as string,
  };
}
async function order(
  items: { checkpoint: number; slot: number; quantity: number }[],
  paid = true,
) {
  const total = items.reduce((n, i) => n + i.quantity * 100, 0);
  const o = await prisma.order.create({
    data: {
      orderNumber: prefix + '-' + randomUUID(),
      customerId: buyerId,
      status: 'PACKED',
      subtotal: total,
      totalAmount: total,
      payments: {
        create: {
          amount: total,
          status: paid ? 'PAID' : 'PENDING',
          lastVerifiedAt: paid ? new Date() : null,
        },
      },
      items: {
        create: items.map((i) => ({
          kitchenId,
          mealId,
          checkpointId: checkpoints[i.checkpoint]!,
          timeSlotId: slots[i.slot]!,
          serviceDate: new Date(date),
          beneficiaryName: 'Route beneficiary',
          mealNameSnapshot: 'Lunch',
          unitPrice: 100,
          quantity: i.quantity,
          lineTotal: i.quantity * 100,
          status: 'PACKED' as const,
        })),
      },
    },
    include: { items: true },
  });
  orders.push(o.id);
  return o;
}
async function fixture() {
  const p = await partner();
  const a = await order([
    { checkpoint: 0, slot: 0, quantity: 2 },
    { checkpoint: 0, slot: 1, quantity: 3 },
  ]);
  const b = await order([{ checkpoint: 1, slot: 1, quantity: 4 }]);
  const input: CreateRouteInput = {
    name: 'College lunch',
    date,
    kitchenId,
    deliveryPartnerId: p.id,
    checkpointIds: [checkpoints[1]!, checkpoints[0]!],
    orderItemIds: [...a.items, ...b.items].map((i) => i.id),
    idempotencyKey: randomUUID(),
  };
  return { p, a, b, input };
}
const create = (input: CreateRouteInput) =>
  api()
    .post('/api/v1/admin/routes')
    .set('Authorization', 'Bearer ' + admin)
    .send(input);
const patch = (r: ManagedRoute, changes: Record<string, unknown> = {}) =>
  api()
    .patch('/api/v1/admin/routes/' + r.id)
    .set('Authorization', 'Bearer ' + admin)
    .send({
      name: r.name,
      deliveryPartnerId: r.partner!.id,
      checkpointIds: r.stops.map((s) => s.checkpointId),
      revision: r.revision,
      ...changes,
    });

describe('admin route and batch management', () => {
  it('groups multiple orders and time slots into ordered checkpoint batches with correct quantities', async () => {
    const f = await fixture();
    const result = await create(f.input).expect(201);
    const r = result.body.data.route as ManagedRoute;
    expect(r.totals).toEqual({
      meals: 9,
      orders: 2,
      checkpoints: 2,
      deliveries: 3,
      delivered: 0,
      failed: 0,
    });
    expect(r.stops.map((s) => s.checkpointId)).toEqual(f.input.checkpointIds);
    expect(r.timeSlots.map((s) => s.id)).toEqual(slots);
    expect(r.stops[1]!.batches.map((b) => b.quantity).sort()).toEqual([2, 3]);
    expect(r.stops[1]!.orders).toBe(1);
    const kitchen = await api()
      .get('/api/v1/kitchen/' + kitchenId + '/dashboard')
      .query({ serviceDate: date })
      .set('Authorization', 'Bearer ' + admin)
      .expect(200);
    expect(kitchen.body.data.byRoute).toEqual(
      expect.arrayContaining([{ key: r.id, label: r.name, quantity: 9 }]),
    );
    const dashboard = await api()
      .get('/api/v1/delivery/dashboard')
      .set('Authorization', 'Bearer ' + f.p.token)
      .expect(200);
    expect(dashboard.body.data.routes[0].timeSlots).toHaveLength(2);
    const listing = await api()
      .get('/api/v1/admin/routes')
      .query({ date, kitchenId })
      .set('Authorization', 'Bearer ' + admin)
      .expect(200);
    expect(
      listing.body.data.routes.some((r2: ManagedRoute) => r2.id === r.id),
    ).toBe(true);
  });
  it('counts a single order once even when its meals span checkpoints', async () => {
    const p = await partner(),
      o = await order([
        { checkpoint: 0, slot: 0, quantity: 2 },
        { checkpoint: 1, slot: 1, quantity: 3 },
      ]);
    const result = await create({
      name: 'Split order',
      date,
      kitchenId,
      deliveryPartnerId: p.id,
      checkpointIds: [checkpoints[0]!, checkpoints[1]!],
      orderItemIds: o.items.map((i) => i.id),
      idempotencyKey: randomUUID(),
    }).expect(201);
    expect(result.body.data.route.totals).toMatchObject({
      orders: 1,
      meals: 5,
      checkpoints: 2,
      deliveries: 2,
    });
  });
  it('replays a creation key without duplicate deliveries, and rejects changed payload reuse', async () => {
    const f = await fixture();
    const first = await create(f.input).expect(201);
    const second = await create(f.input).expect(201);
    expect(second.body.data.route.id).toBe(first.body.data.route.id);
    expect(
      await prisma.delivery.count({
        where: { orderItemId: { in: f.input.orderItemIds } },
      }),
    ).toBe(3);
    expect(
      await prisma.auditLog.count({
        where: { entityId: first.body.data.route.id, action: 'ROUTE_CREATED' },
      }),
    ).toBe(1);
    await create({ ...f.input, name: 'Different route' }).expect(409);
  });
  it('rejects non-admin route planning, listing, and editing', async () => {
    const f = await fixture();
    const created = await create(f.input).expect(201);
    const id = created.body.data.route.id;
    for (const token of [f.p.token, customerToken]) {
      for (const path of [
        '/options',
        '/candidates?date=' + date + '&kitchenId=' + kitchenId,
        '?date=' + date,
        '/' + id,
      ])
        await api()
          .get('/api/v1/admin/routes' + path)
          .set('Authorization', 'Bearer ' + token)
          .expect(403);
      await api()
        .post('/api/v1/admin/routes')
        .set('Authorization', 'Bearer ' + token)
        .send(f.input)
        .expect(403);
      await api()
        .patch('/api/v1/admin/routes/' + id)
        .set('Authorization', 'Bearer ' + token)
        .send({})
        .expect(403);
    }
  });
  it('rejects checkpoint omissions, extras, duplicates, and oversized batches atomically', async () => {
    const f = await fixture();
    await create({ ...f.input, checkpointIds: [checkpoints[0]!] }).expect(409);
    await create({
      ...f.input,
      checkpointIds: [...f.input.checkpointIds, checkpoints[2]!],
    }).expect(409);
    await create({
      ...f.input,
      checkpointIds: [checkpoints[0]!, checkpoints[0]!],
    }).expect(422);
    await create({
      ...f.input,
      orderItemIds: Array.from({ length: 501 }, (_, i) => 'item-' + i),
    }).expect(422);
    expect(
      await prisma.deliveryRun.count({
        where: { creationKey: f.input.idempotencyKey },
      }),
    ).toBe(0);
    expect(
      await prisma.delivery.count({
        where: { orderItemId: { in: f.input.orderItemIds } },
      }),
    ).toBe(0);
  });
  it('requires paid packed meals and the same service date, without partial assignments', async () => {
    const f = await fixture();
    await prisma.payment.updateMany({
      where: { orderId: f.b.id },
      data: { status: 'PENDING' },
    });
    await create(f.input).expect(409);
    expect(
      await prisma.delivery.count({
        where: { orderItemId: { in: f.input.orderItemIds } },
      }),
    ).toBe(0);
    await prisma.payment.updateMany({
      where: { orderId: f.b.id },
      data: { status: 'PAID' },
    });
    await create({
      ...f.input,
      date: dateKey(addDays(new Date(date), 1)),
    }).expect(409);
    await prisma.orderItem.update({
      where: { id: f.b.items[0]!.id },
      data: { status: 'PREPARING' },
    });
    await create(f.input).expect(409);
    expect(
      await prisma.deliveryRun.count({
        where: { creationKey: f.input.idempotencyKey },
      }),
    ).toBe(0);
  });
  it('rejects unavailable partners, inactive checkpoints and past dates', async () => {
    const f = await fixture();
    await prisma.deliveryPartner.update({
      where: { id: f.p.id },
      data: { isAvailable: false },
    });
    await create(f.input).expect(409);
    await prisma.deliveryPartner.update({
      where: { id: f.p.id },
      data: { isAvailable: true },
    });
    await prisma.checkpoint.update({
      where: { id: checkpoints[0]! },
      data: { isActive: false },
    });
    try {
      await create(f.input).expect(409);
    } finally {
      await prisma.checkpoint.update({
        where: { id: checkpoints[0]! },
        data: { isActive: true },
      });
    }
    await create({
      ...f.input,
      date: dateKey(addDays(new Date(date), -1)),
    }).expect(409);
  });
  it('prevents competing batches from assigning the same meal twice', async () => {
    const f = await fixture(),
      other = await partner();
    const responses = await Promise.all([
      create(f.input),
      create({
        ...f.input,
        deliveryPartnerId: other.id,
        idempotencyKey: randomUUID(),
      }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await prisma.delivery.count({
        where: { orderItemId: { in: f.input.orderItemIds } },
      }),
    ).toBe(3);
  });
  it('adds checkpoint batches, reorders stops and transfers all deliveries to a new partner', async () => {
    const f = await fixture(),
      other = await partner();
    const initial = (await create(f.input).expect(201)).body.data
      .route as ManagedRoute;
    const extra = await order([{ checkpoint: 2, slot: 1, quantity: 2 }]);
    const updated = await patch(initial, {
      deliveryPartnerId: other.id,
      checkpointIds: [checkpoints[2], checkpoints[0], checkpoints[1]],
      orderItemIds: extra.items.map((i) => i.id),
    }).expect(200);
    const r = updated.body.data.route as ManagedRoute;
    expect(r.totals).toMatchObject({
      meals: 11,
      orders: 3,
      checkpoints: 3,
      deliveries: 4,
    });
    expect(r.stops.map((s) => s.sequence)).toEqual([1, 2, 3]);
    expect(r.partner!.id).toBe(other.id);
    expect(
      await prisma.delivery.count({
        where: {
          deliveryStop: { deliveryRunId: r.id },
          deliveryPartnerId: other.id,
        },
      }),
    ).toBe(4);
    await api()
      .get('/api/v1/delivery/routes/' + r.id + '/stops/' + r.stops[0]!.id)
      .set('Authorization', 'Bearer ' + f.p.token)
      .expect(404);
    await api()
      .get('/api/v1/delivery/routes/' + r.id + '/stops/' + r.stops[0]!.id)
      .set('Authorization', 'Bearer ' + other.token)
      .expect(200);
    await patch(initial, { name: 'Stale edit' }).expect(409);
    expect(
      await prisma.auditLog.count({
        where: { entityId: r.id, action: 'ROUTE_UPDATED' },
      }),
    ).toBe(1);
  });
  it('locks route edits after pickup and enforces the planned checkpoint order', async () => {
    const f = await fixture();
    const r = (await create(f.input).expect(201)).body.data
      .route as ManagedRoute;
    await api()
      .post('/api/v1/delivery/routes/' + r.id + '/pickup')
      .set('Authorization', 'Bearer ' + f.p.token)
      .expect(200);
    await patch(r, { name: 'Too late' }).expect(409);
    await api()
      .post('/api/v1/delivery/routes/' + r.id + '/start')
      .set('Authorization', 'Bearer ' + f.p.token)
      .expect(200);
    await api()
      .post(
        '/api/v1/delivery/routes/' +
          r.id +
          '/stops/' +
          r.stops[1]!.id +
          '/arrive',
      )
      .set('Authorization', 'Bearer ' + f.p.token)
      .expect(409);
    await api()
      .post(
        '/api/v1/delivery/routes/' +
          r.id +
          '/stops/' +
          r.stops[0]!.id +
          '/arrive',
      )
      .set('Authorization', 'Bearer ' + f.p.token)
      .expect(200);
    const detail = await api()
      .get('/api/v1/admin/routes/' + r.id)
      .set('Authorization', 'Bearer ' + admin)
      .expect(200);
    expect(detail.body.data.route.editable).toBe(false);
    expect(detail.body.data.route.stops[0].status).toBe('ARRIVED');
  });
  it('invalidates stale route editors when the legacy assignment endpoint adds a meal', async () => {
    const f = await fixture();
    const r = (await create(f.input).expect(201)).body.data
      .route as ManagedRoute;
    const extra = await order([{ checkpoint: 2, slot: 0, quantity: 1 }]);
    await api()
      .post('/api/v1/delivery/items/' + extra.items[0]!.id + '/assign')
      .set('Authorization', 'Bearer ' + admin)
      .send({ deliveryPartnerId: f.p.id })
      .expect(201);
    await patch(r).expect(409);
  });
  it('lists packed candidates with pagination and removes assigned items from the list', async () => {
    const f = await fixture();
    const path = '/api/v1/admin/routes/candidates';
    const before = await api()
      .get(path)
      .query({ date, kitchenId })
      .set('Authorization', 'Bearer ' + admin)
      .expect(200);
    expect(before.body.data.pageSize).toBe(100);
    expect(before.body.data.items.length).toBeLessThanOrEqual(100);
    expect(JSON.stringify(before.body.data)).not.toMatch(
      /beneficiaryName|passwordHash|otpHash/,
    );
    await create(f.input).expect(201);
    const after = await api()
      .get(path)
      .query({ date, kitchenId })
      .set('Authorization', 'Bearer ' + admin)
      .expect(200);
    expect(after.body.data.total).toBe(before.body.data.total - 3);
    await api()
      .get(path)
      .query({ date: '2026-02-30', kitchenId })
      .set('Authorization', 'Bearer ' + admin)
      .expect(422);
  });
});
