import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { api, registerUser, disconnect, type RegisteredUser } from './helpers';
import { prisma } from '../src/core/prisma';
let owner: RegisteredUser,
  other: RegisteredUser,
  buyer: RegisteredUser,
  superToken: string;
let institutionId: string,
  otherInstitutionId: string,
  cityId: string,
  checkpointId: string,
  slotId: string;
const auth = (u: RegisteredUser) => 'Bearer ' + u.accessToken;
const root = '/api/v1/institutions';
const settings = {
  name: 'ABC University Test',
  type: 'UNIVERSITY',
  contactName: 'Campus coordinator',
  contactEmail: 'campus@example.test',
  contactPhone: null,
  deliveryNotes: 'Use the east gates.',
  registrationOpen: true,
};
beforeAll(async () => {
  owner = await registerUser();
  other = await registerUser();
  buyer = await registerUser();
  await prisma.user.updateMany({
    where: { id: { in: [owner.id, other.id] } },
    data: { role: 'INSTITUTION_ADMIN' },
  });
  const login = await api()
    .post('/api/v1/auth/login')
    .send({ identifier: 'admin@lunch.test', password: 'Lunch@1234' })
    .expect(200);
  superToken = 'Bearer ' + login.body.data.tokens.accessToken;
  cityId = (await prisma.city.findFirstOrThrow({ where: { isActive: true } }))
    .id;
  const first = await api()
    .post(root)
    .set('Authorization', superToken)
    .send({ ...settings, cityId, adminUserId: owner.id })
    .expect(201);
  institutionId = first.body.data.id;
  const second = await api()
    .post(root)
    .set('Authorization', superToken)
    .send({
      ...settings,
      name: 'Other College Test',
      type: 'COLLEGE',
      cityId,
      adminUserId: other.id,
    })
    .expect(201);
  otherInstitutionId = second.body.data.id;
});
afterAll(async () => {
  await prisma.order.deleteMany({ where: { customerId: buyer.id } });
  await prisma.child.deleteMany({ where: { parentId: buyer.id } });
  await prisma.checkpoint.deleteMany({
    where: { institutionId: { in: [institutionId, otherInstitutionId] } },
  });
  await prisma.timeSlot.deleteMany({
    where: { institutionId: { in: [institutionId, otherInstitutionId] } },
  });
  await prisma.institution.deleteMany({
    where: { id: { in: [institutionId, otherInstitutionId] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [owner.id, other.id, buyer.id] } },
  });
  await disconnect();
});
it('scopes institution lists and private endpoints to active administrators', async () => {
  const list = await api()
    .get(root)
    .set('Authorization', auth(owner))
    .expect(200);
  expect(list.body.data.items.map((r: { id: string }) => r.id)).toEqual([
    institutionId,
  ]);
  for (const suffix of ['', '/registrations', '/statistics', '/bulk-requests'])
    await api()
      .get(root + '/' + otherInstitutionId + suffix)
      .set('Authorization', auth(owner))
      .expect(404);
  await api()
    .get(root + '/' + institutionId)
    .set('Authorization', auth(buyer))
    .expect(403);
  await api().get(root).expect(401);
  await api()
    .post(root)
    .set('Authorization', auth(owner))
    .send({ ...settings, cityId, adminUserId: owner.id })
    .expect(403);
  await api()
    .post(root)
    .set('Authorization', superToken)
    .send({ ...settings, cityId, adminUserId: buyer.id })
    .expect(400);
});
it('updates settings with revision checks, rejects billing and privilege injection, and audits changes', async () => {
  const result = await api()
    .patch(root + '/' + institutionId)
    .set('Authorization', auth(owner))
    .send({ ...settings, name: 'ABC College', revision: 0 })
    .expect(200);
  expect(result.body.data.revision).toBe(1);
  await api()
    .patch(root + '/' + institutionId)
    .set('Authorization', auth(owner))
    .send({ ...settings, revision: 0 })
    .expect(409);
  await api()
    .patch(root + '/' + institutionId)
    .set('Authorization', auth(owner))
    .send({ ...settings, revision: 1, isBilledCentrally: true })
    .expect(422);
  expect(
    await prisma.auditLog.count({
      where: { entityId: institutionId, action: 'institution.updated' },
    }),
  ).toBe(1);
});
it('creates an institution checkpoint and rejects detachment, foreign institutions and mismatched city', async () => {
  const input = {
    name: 'Gate A',
    type: 'COLLEGE_GATE',
    cityId,
    institutionId,
    deliveryCapacity: 100,
  };
  const res = await api()
    .post('/api/v1/checkpoints')
    .set('Authorization', auth(owner))
    .send(input)
    .expect(201);
  checkpointId = res.body.data.checkpoint.id;
  await api()
    .patch('/api/v1/checkpoints/' + checkpointId)
    .set('Authorization', auth(owner))
    .send({ institutionId: null })
    .expect(403);
  await api()
    .post('/api/v1/checkpoints')
    .set('Authorization', auth(other))
    .send(input)
    .expect(403);
  const otherCity = await prisma.city.findFirst({
    where: { isActive: true, id: { not: cityId } },
  });
  if (otherCity)
    await api()
      .post('/api/v1/checkpoints')
      .set('Authorization', superToken)
      .send({ ...input, cityId: otherCity.id })
      .expect(400);
});
it('defines owned delivery windows and rejects overlapping, invalid and foreign writes', async () => {
  const path =
    root + '/' + institutionId + '/checkpoints/' + checkpointId + '/windows';
  const input = {
    label: 'Gate A — 12:30 PM',
    mealPeriod: 'LUNCH',
    startMinute: 750,
    endMinute: 760,
    orderCutoffMinutes: 30,
    maxOrders: 35,
  };
  const res = await api()
    .post(path)
    .set('Authorization', auth(owner))
    .send(input)
    .expect(201);
  slotId = res.body.data.timeSlotId;
  expect(
    await prisma.timeSlot.findUnique({ where: { id: slotId } }),
  ).toMatchObject({ institutionId, startMinute: 750 });
  await api()
    .post(path)
    .set('Authorization', auth(owner))
    .send(input)
    .expect(409);
  await api()
    .post(path)
    .set('Authorization', auth(other))
    .send(input)
    .expect(404);
  await api()
    .post(path)
    .set('Authorization', auth(owner))
    .send({ ...input, endMinute: 740 })
    .expect(422);
  const wrong = await prisma.timeSlot.create({
    data: {
      cityId,
      institutionId: otherInstitutionId,
      label: 'Other campus slot',
      mealPeriod: 'LUNCH',
      startMinute: 800,
      endMinute: 810,
    },
  });
  await api()
    .patch('/api/v1/checkpoints/' + checkpointId)
    .set('Authorization', auth(owner))
    .send({
      name: 'Must roll back',
      windows: [{ timeSlotId: wrong.id, isActive: true }],
    })
    .expect(400);
  expect(
    (await prisma.checkpoint.findUniqueOrThrow({ where: { id: checkpointId } }))
      .name,
  ).toBe('Gate A');
  const details = await api()
    .get('/api/v1/checkpoints/' + checkpointId)
    .set('Authorization', auth(buyer))
    .expect(200);
  expect(details.body.data.checkpoint.windows[0]).toMatchObject({
    timeSlotId: slotId,
    maxOrders: 35,
  });
});
it('registers buyers without granting admin rights, respects registration settings, and supports leaving', async () => {
  const path = root + '/' + institutionId + '/register';
  await api()
    .post(path)
    .set('Authorization', auth(buyer))
    .send({ identifier: 'ST-101', role: 'ADMIN' })
    .expect(422);
  await api()
    .post(path)
    .set('Authorization', auth(buyer))
    .send({ identifier: 'ST-101' })
    .expect(200);
  await api()
    .post(path)
    .set('Authorization', auth(buyer))
    .send({ identifier: 'ST-101' })
    .expect(200);
  expect(
    await prisma.institutionMember.count({
      where: { institutionId, userId: buyer.id },
    }),
  ).toBe(1);
  expect(
    (
      await prisma.institutionMember.findUniqueOrThrow({
        where: { institutionId_userId: { institutionId, userId: buyer.id } },
      })
    ).role,
  ).toBe('MEMBER');
  await api()
    .get(root + '/' + institutionId + '/registrations')
    .set('Authorization', auth(buyer))
    .expect(403);
  await api()
    .patch(root + '/' + institutionId)
    .set('Authorization', auth(owner))
    .send({ ...settings, registrationOpen: false, revision: 1 })
    .expect(200);
  await api()
    .post(path)
    .set('Authorization', auth(buyer))
    .send({ identifier: 'ST-101' })
    .expect(404);
  await api().delete(path).set('Authorization', auth(buyer)).expect(200);
  const mine = await api()
    .get(root + '/registrations/me')
    .set('Authorization', auth(buyer))
    .expect(200);
  expect(mine.body.data[0].isActive).toBe(false);
});
it('lists child and customer registrations with search and no private contact or medical data', async () => {
  await prisma.child.create({
    data: {
      parentId: buyer.id,
      fullName: 'Rahul Test',
      institutionId,
      rollNumber: 'R-123',
      allergies: 'PRIVATE MEDICAL',
      emergencyContactPhone: 'PRIVATE PHONE',
    },
  });
  await prisma.child.create({
    data: {
      parentId: buyer.id,
      fullName: 'Foreign Child',
      institutionId: otherInstitutionId,
    },
  });
  const res = await api()
    .get(root + '/' + institutionId + '/registrations?search=R-123')
    .set('Authorization', auth(owner))
    .expect(200);
  expect(res.body.data.total).toBe(1);
  expect(res.body.data.items[0]).toMatchObject({
    name: 'Rahul Test',
    kind: 'CHILD',
    identifier: 'R-123',
  });
  expect(JSON.stringify(res.body)).not.toMatch(
    /PRIVATE|allergies|emergencyContact|parentId|Foreign Child/,
  );
});
it('aggregates only the institution service-date meals, excluding cancellations and preserving unique order totals', async () => {
  const kitchen = await prisma.kitchen.findFirstOrThrow();
  const common = {
    kitchenId: kitchen.id,
    checkpointId,
    timeSlotId: slotId,
    serviceDate: new Date('2096-05-10'),
    beneficiaryName: 'Rahul',
    mealNameSnapshot: 'Lunch',
    unitPrice: 100,
    lineTotal: 200,
  };
  const foreignCheckpoint = await prisma.checkpoint.create({
    data: {
      name: 'Foreign gate',
      type: 'COLLEGE_GATE',
      cityId,
      institutionId: otherInstitutionId,
    },
  });
  await prisma.order.create({
    data: {
      customerId: buyer.id,
      orderNumber: 'INST-' + randomUUID(),
      subtotal: 600,
      totalAmount: 600,
      items: {
        create: [
          { ...common, quantity: 2, status: 'DELIVERED' },
          { ...common, quantity: 3, status: 'CONFIRMED' },
          { ...common, quantity: 1, status: 'FAILED' },
          { ...common, quantity: 50, status: 'CANCELLED' },
          {
            ...common,
            checkpointId: foreignCheckpoint.id,
            quantity: 90,
            status: 'DELIVERED',
          },
        ],
      },
    },
  });
  const res = await api()
    .get(root + '/' + institutionId + '/statistics?date=2096-05-10')
    .set('Authorization', auth(owner))
    .expect(200);
  expect(res.body.data).toMatchObject({
    orders: 1,
    meals: 6,
    deliveredMeals: 2,
    pendingMeals: 3,
    failedMeals: 1,
  });
  expect(res.body.data.groups).toHaveLength(3);
  expect(JSON.stringify(res.body)).not.toContain('orderIds');
  await api()
    .get(root + '/' + institutionId + '/statistics?date=2096-02-31')
    .set('Authorization', auth(owner))
    .expect(422);
});
it('records bulk demand idempotently without enabling credit, billing or order generation', async () => {
  const input = {
    quantityPerDay: 120,
    mealPeriod: 'LUNCH',
    startDate: '2096-06-01',
    endDate: '2096-06-30',
    notes: 'Monday to Friday',
    idempotencyKey: randomUUID(),
  };
  const path = root + '/' + institutionId + '/bulk-requests';
  const before = await prisma.order.count();
  const results = await Promise.all(
    [1, 2].map(() =>
      api()
        .post(path)
        .set('Authorization', auth(owner))
        .send(input)
        .expect(201),
    ),
  );
  expect(results[0].body.data.id).toBe(results[1].body.data.id);
  await api()
    .post(path)
    .set('Authorization', auth(owner))
    .send({ ...input, quantityPerDay: 121 })
    .expect(409);
  await api()
    .post(path)
    .set('Authorization', auth(other))
    .send(input)
    .expect(404);
  expect(await prisma.order.count()).toBe(before);
  expect(
    (
      await prisma.institution.findUniqueOrThrow({
        where: { id: institutionId },
      })
    ).isBilledCentrally,
  ).toBe(false);
  expect(
    await prisma.auditLog.count({
      where: { entityId: institutionId, action: 'institution.bulk.requested' },
    }),
  ).toBe(1);
});
it('exposes institution checkpoints and windows to parents and students for ordering', async () => {
  const directory = await api()
    .get('/api/v1/reference/institutions')
    .set('Authorization', auth(buyer))
    .expect(200);
  expect(
    directory.body.data.institutions.find(
      (i: { id: string }) => i.id === institutionId,
    ),
  ).toMatchObject({ type: 'UNIVERSITY', deliveryNotes: 'Use the east gates.' });
  const choices = await api()
    .get('/api/v1/reference/checkpoints?institutionId=' + institutionId)
    .set('Authorization', auth(buyer))
    .expect(200);
  expect(
    choices.body.data.checkpoints.map((c: { id: string }) => c.id),
  ).toEqual([checkpointId]);
  await api()
    .post('/api/v1/checkpoints/' + checkpointId + '/default')
    .set('Authorization', auth(buyer))
    .expect(204);
  expect(
    (
      await prisma.userProfile.findUniqueOrThrow({
        where: { userId: buyer.id },
      })
    ).defaultCheckpointId,
  ).toBe(checkpointId);
  const slots = await api()
    .get(
      '/api/v1/reference/time-slots?institutionId=' +
        institutionId +
        '&cityId=' +
        cityId,
    )
    .set('Authorization', auth(buyer))
    .expect(200);
  expect(
    slots.body.data.timeSlots.some((s: { id: string }) => s.id === slotId),
  ).toBe(true);
  expect(
    slots.body.data.timeSlots.some(
      (s: { label: string }) => s.label === 'Other campus slot',
    ),
  ).toBe(false);
});
it('revoked institution membership immediately blocks existing login tokens', async () => {
  await prisma.institutionMember.update({
    where: { institutionId_userId: { institutionId, userId: owner.id } },
    data: { isActive: false },
  });
  await api()
    .get(root + '/' + institutionId)
    .set('Authorization', auth(owner))
    .expect(404);
  await api()
    .patch('/api/v1/checkpoints/' + checkpointId)
    .set('Authorization', auth(owner))
    .send({ name: 'Unauthorized' })
    .expect(403);
});
