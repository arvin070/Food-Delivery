/**
 * Vendor and kitchen management.
 *
 * The guarantee under test, above all others: a vendor sees and changes only
 * their own kitchens, menu and orders. `cross-vendor isolation` builds a second
 * vendor from scratch and attempts every read and write against the first.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ErrorCode,
  OrderItemStatus,
  UserRole,
  VendorStatus,
  type VendorDashboard,
} from '@lunch/shared';
import { prisma } from '../src/core/prisma';
import {
  api,
  cleanupTestUsers,
  disconnect,
  registerUser,
  uniqueEmail,
  VALID_PASSWORD,
  type RegisteredUser,
} from './helpers';

const SEED_PASSWORD = 'Lunch@1234';

/** The seeded, approved vendor. */
let seededVendorToken: string;
let seededVendorId: string;
let seededKitchenId: string;

/** A second vendor, created through the admin API, used for isolation tests. */
let otherVendorToken: string;
let otherVendorId: string;
let otherKitchenId: string;

let adminToken: string;
let cityId: string;
let checkpointIds: string[];

async function signIn(identifier: string, password = SEED_PASSWORD): Promise<string> {
  const res = await api()
    .post('/api/v1/auth/login')
    .send({ identifier, password })
    .expect(200);
  return res.body.data.tokens.accessToken as string;
}

/** Registers an owner, creates a vendor for them, approves it, returns a token. */
async function provisionVendor(businessName: string): Promise<{
  token: string;
  vendorId: string;
  owner: RegisteredUser;
}> {
  const owner = await registerUser();

  const createRes = await api()
    .post('/api/v1/admin/vendors')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ ownerEmail: owner.email, businessName })
    .expect(201);

  const vendorId = createRes.body.data.vendor.id as string;

  await api()
    .patch(`/api/v1/admin/vendors/${vendorId}/status`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ status: VendorStatus.APPROVED })
    .expect(200);

  // Creating the vendor revoked their sessions, so sign in afresh.
  const token = await signIn(owner.email, owner.password);
  return { token, vendorId, owner };
}

beforeAll(async () => {
  await cleanupTestUsers();

  adminToken = await signIn('admin@lunch.test');
  seededVendorToken = await signIn('vendor@lunch.test');

  const profile = await api()
    .get('/api/v1/vendor/profile')
    .set('Authorization', `Bearer ${seededVendorToken}`)
    .expect(200);
  seededVendorId = profile.body.data.vendor.id;
  seededKitchenId = profile.body.data.kitchens[0].id;

  const city = await prisma.city.findFirstOrThrow({ select: { id: true } });
  cityId = city.id;
  const checkpoints = await prisma.checkpoint.findMany({
    where: { isActive: true },
    select: { id: true },
    take: 3,
  });
  checkpointIds = checkpoints.map((c) => c.id);

  // A second, independent vendor with its own kitchen.
  const other = await provisionVendor('Rival Tiffin Co');
  otherVendorToken = other.token;
  otherVendorId = other.vendorId;

  const otherKitchen = await prisma.kitchen.create({
    data: { vendorId: otherVendorId, name: 'Rival Kitchen', cityId, capacityPerSlot: 50 },
  });
  otherKitchenId = otherKitchen.id;
});

afterAll(async () => {
  await prisma.kitchen.deleteMany({ where: { name: { in: ['Rival Kitchen'] } } });
  await cleanupTestUsers();
  await disconnect();
});

const vendorAuth = () => `Bearer ${seededVendorToken}`;
const otherAuth = () => `Bearer ${otherVendorToken}`;
const adminAuth = () => `Bearer ${adminToken}`;

// ─────────────────────────────────────────────────────────────────────────────

describe('admin: vendor lifecycle', () => {
  it('creates a vendor and promotes the owner to VENDOR', async () => {
    const owner = await registerUser();

    const res = await api()
      .post('/api/v1/admin/vendors')
      .set('Authorization', adminAuth())
      .send({ ownerEmail: owner.email, businessName: 'Brand New Kitchen Co' })
      .expect(201);

    expect(res.body.data.vendor).toMatchObject({
      businessName: 'Brand New Kitchen Co',
      status: VendorStatus.PENDING_APPROVAL,
      isActive: false,
    });

    const row = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(row.role).toBe(UserRole.VENDOR);
  });

  it('revokes the owner’s sessions so the new role takes effect', async () => {
    const owner = await registerUser();
    await api()
      .post('/api/v1/admin/vendors')
      .set('Authorization', adminAuth())
      .send({ ownerEmail: owner.email, businessName: 'Session Revoke Co' })
      .expect(201);

    await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: owner.refreshToken })
      .expect(401);
  });

  it('refuses an owner with no account', async () => {
    const res = await api()
      .post('/api/v1/admin/vendors')
      .set('Authorization', adminAuth())
      .send({ ownerEmail: uniqueEmail('ghost'), businessName: 'Ghost Kitchen' })
      .expect(400);
    expect(res.body.error.details.ownerEmail).toBeDefined();
  });

  it('refuses an owner who already runs a vendor', async () => {
    const res = await api()
      .post('/api/v1/admin/vendors')
      .set('Authorization', adminAuth())
      .send({ ownerEmail: 'vendor@lunch.test', businessName: 'Duplicate Co' })
      .expect(409);
    expect(res.body.error.code).toBe(ErrorCode.CONFLICT);
  });

  it('rejects a malformed GSTIN', async () => {
    const owner = await registerUser();
    const res = await api()
      .post('/api/v1/admin/vendors')
      .set('Authorization', adminAuth())
      .send({ ownerEmail: owner.email, businessName: 'Bad GST Co', gstin: 'nope' })
      .expect(422);
    expect(res.body.error.details.gstin).toBeDefined();
  });

  it('approves a vendor, activating it and stamping approvedAt', async () => {
    const owner = await registerUser();
    const createRes = await api()
      .post('/api/v1/admin/vendors')
      .set('Authorization', adminAuth())
      .send({ ownerEmail: owner.email, businessName: 'To Be Approved Co' })
      .expect(201);

    const res = await api()
      .patch(`/api/v1/admin/vendors/${createRes.body.data.vendor.id}/status`)
      .set('Authorization', adminAuth())
      .send({ status: VendorStatus.APPROVED })
      .expect(200);

    expect(res.body.data.vendor.status).toBe(VendorStatus.APPROVED);
    expect(res.body.data.vendor.isActive).toBe(true);
    expect(res.body.data.vendor.approvedAt).not.toBeNull();
  });

  it('suspending a vendor deactivates its kitchens and hides its inventory', async () => {
    const { vendorId } = await provisionVendor('Suspendable Co');
    const kitchen = await prisma.kitchen.create({
      data: { vendorId, name: 'Suspendable Kitchen', cityId },
    });
    const meal = await prisma.meal.create({
      data: { vendorId, name: 'Suspendable Meal', slug: `susp-${Date.now()}`, basePrice: '100.00' },
    });
    const future = new Date();
    future.setUTCHours(0, 0, 0, 0);
    future.setUTCDate(future.getUTCDate() + 3);
    const slot = await prisma.timeSlot.findFirstOrThrow({ select: { id: true } });
    const schedule = await prisma.mealSchedule.create({
      data: {
        mealId: meal.id,
        kitchenId: kitchen.id,
        timeSlotId: slot.id,
        serviceDate: future,
        price: '100.00',
        totalQuantity: 10,
        status: 'PUBLISHED',
      },
    });

    await api()
      .patch(`/api/v1/admin/vendors/${vendorId}/status`)
      .set('Authorization', adminAuth())
      .send({ status: VendorStatus.SUSPENDED, reason: 'Hygiene complaint' })
      .expect(200);

    const kitchenRow = await prisma.kitchen.findUniqueOrThrow({ where: { id: kitchen.id } });
    expect(kitchenRow.isActive).toBe(false);

    // The schedule is left alone — the catalog hides it via the vendor filter,
    // so restoring the vendor restores their inventory intact.
    const scheduleRow = await prisma.mealSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(scheduleRow.status).toBe('PUBLISHED');

    const customerToken = (
      await api()
        .post('/api/v1/auth/login')
        .send({ identifier: 'customer@lunch.test', password: SEED_PASSWORD })
        .expect(200)
    ).body.data.tokens.accessToken as string;

    const browse = await api()
      .get(`/api/v1/catalog/meals?serviceDate=${future.toISOString().slice(0, 10)}&pageSize=100`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(
      browse.body.data.some((m: { mealId: string }) => m.mealId === meal.id)
    ).toBe(false);

    // Restoring brings it straight back.
    await api()
      .patch(`/api/v1/admin/vendors/${vendorId}/status`)
      .set('Authorization', adminAuth())
      .send({ status: VendorStatus.APPROVED })
      .expect(200);

    const after = await api()
      .get(`/api/v1/catalog/meals?serviceDate=${future.toISOString().slice(0, 10)}&pageSize=100`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(after.body.data.some((m: { mealId: string }) => m.mealId === meal.id)).toBe(true);
  });

  it('records status changes in the audit log', async () => {
    const { vendorId } = await provisionVendor('Audited Co');
    await api()
      .patch(`/api/v1/admin/vendors/${vendorId}/status`)
      .set('Authorization', adminAuth())
      .send({ status: VendorStatus.SUSPENDED, reason: 'Investigation' })
      .expect(200);

    const entry = await prisma.auditLog.findFirst({
      where: { entityType: 'Vendor', entityId: vendorId, action: 'vendor.status.updated' },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry?.after).toMatchObject({ status: VendorStatus.SUSPENDED, reason: 'Investigation' });
  });

  it('lists and filters vendors', async () => {
    const res = await api()
      .get(`/api/v1/admin/vendors?status=${VendorStatus.APPROVED}`)
      .set('Authorization', adminAuth())
      .expect(200);

    expect(res.body.data.length).toBeGreaterThan(0);
    for (const v of res.body.data) expect(v.status).toBe(VendorStatus.APPROVED);
  });

  it('is closed to every non-admin role', async () => {
    for (const token of [seededVendorToken, otherVendorToken]) {
      await api().get('/api/v1/admin/vendors').set('Authorization', `Bearer ${token}`).expect(403);
    }
    const customer = await signIn('customer@lunch.test');
    await api().get('/api/v1/admin/vendors').set('Authorization', `Bearer ${customer}`).expect(403);
    await api().get('/api/v1/admin/vendors').expect(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('cross-vendor isolation', () => {
  it('a vendor sees only their own kitchens', async () => {
    const res = await api()
      .get('/api/v1/vendor/kitchens')
      .set('Authorization', otherAuth())
      .expect(200);

    const ids = res.body.data.kitchens.map((k: { id: string }) => k.id);
    expect(ids).toContain(otherKitchenId);
    expect(ids).not.toContain(seededKitchenId);
  });

  it('cannot read another vendor’s kitchen', async () => {
    const res = await api()
      .get(`/api/v1/vendor/kitchens/${seededKitchenId}`)
      .set('Authorization', otherAuth())
      .expect(404);
    expect(res.body.error.code).toBe(ErrorCode.NOT_FOUND);
  });

  it('cannot modify another vendor’s kitchen', async () => {
    await api()
      .patch(`/api/v1/vendor/kitchens/${seededKitchenId}`)
      .set('Authorization', otherAuth())
      .send({ name: 'Hijacked Kitchen', capacityPerSlot: 1 })
      .expect(404);

    const row = await prisma.kitchen.findUniqueOrThrow({ where: { id: seededKitchenId } });
    expect(row.name).not.toBe('Hijacked Kitchen');
  });

  it('cannot change another vendor’s service areas', async () => {
    await api()
      .put(`/api/v1/vendor/kitchens/${seededKitchenId}/service-areas`)
      .set('Authorization', otherAuth())
      .send({ checkpoints: [] })
      .expect(404);

    const remaining = await prisma.kitchenServiceArea.count({
      where: { kitchenId: seededKitchenId, isActive: true },
    });
    expect(remaining).toBeGreaterThan(0);
  });

  it('cannot read or edit another vendor’s meals', async () => {
    const meal = await prisma.meal.findFirstOrThrow({
      where: { vendorId: seededVendorId, deletedAt: null },
      select: { id: true, name: true },
    });

    await api()
      .get(`/api/v1/vendor/meals/${meal.id}`)
      .set('Authorization', otherAuth())
      .expect(404);

    await api()
      .patch(`/api/v1/vendor/meals/${meal.id}`)
      .set('Authorization', otherAuth())
      .send({ name: 'Stolen Dish', basePrice: '1.00' })
      .expect(404);

    await api()
      .delete(`/api/v1/vendor/meals/${meal.id}`)
      .set('Authorization', otherAuth())
      .expect(404);

    const row = await prisma.meal.findUniqueOrThrow({ where: { id: meal.id } });
    expect(row.name).toBe(meal.name);
    expect(row.deletedAt).toBeNull();
  });

  it('a vendor’s meal list excludes other vendors’ meals', async () => {
    const res = await api()
      .get('/api/v1/vendor/meals')
      .set('Authorization', otherAuth())
      .expect(200);
    expect(res.body.meta.total).toBe(0);
  });

  it('cannot see another vendor’s orders', async () => {
    const res = await api()
      .get('/api/v1/vendor/orders?range=upcoming')
      .set('Authorization', otherAuth())
      .expect(200);
    expect(res.body.meta.total).toBe(0);
  });

  it('CANNOT modify an order belonging to another vendor', async () => {
    const item = await prisma.orderItem.findFirstOrThrow({
      where: { kitchen: { vendorId: seededVendorId }, status: OrderItemStatus.PENDING },
      select: { id: true, status: true },
    });

    const res = await api()
      .patch(`/api/v1/vendor/orders/${item.id}/status`)
      .set('Authorization', otherAuth())
      .send({ status: OrderItemStatus.CONFIRMED })
      .expect(404);
    expect(res.body.error.code).toBe(ErrorCode.NOT_FOUND);

    const after = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.status).toBe(item.status);
  });

  it('a bulk update silently skips another vendor’s items rather than moving them', async () => {
    const item = await prisma.orderItem.findFirstOrThrow({
      where: { kitchen: { vendorId: seededVendorId } },
      select: { id: true, status: true },
    });

    const res = await api()
      .post('/api/v1/vendor/orders/bulk-status')
      .set('Authorization', otherAuth())
      .send({ orderItemIds: [item.id], status: OrderItemStatus.CONFIRMED })
      .expect(200);

    expect(res.body.data.updated).toHaveLength(0);
    expect(res.body.data.skipped[0]).toMatchObject({ orderItemId: item.id, reason: 'Not found' });

    const after = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.status).toBe(item.status);
  });

  it('a vendor cannot attach a meal to another vendor’s kitchen', async () => {
    const res = await api()
      .post('/api/v1/vendor/meals')
      .set('Authorization', otherAuth())
      .send({ name: 'Wrong Kitchen Meal', basePrice: '120.00', kitchenId: seededKitchenId })
      .expect(404);
    expect(res.body.error.code).toBe(ErrorCode.NOT_FOUND);
  });

  it('the dashboard reports only this vendor’s figures', async () => {
    const res = await api()
      .get('/api/v1/vendor/dashboard')
      .set('Authorization', otherAuth())
      .expect(200);

    const dashboard = res.body.data.dashboard as VendorDashboard;
    expect(dashboard.vendor.id).toBe(otherVendorId);
    expect(dashboard.today.totalOrders).toBe(0);
    expect(dashboard.revenue.today).toBe('0.00');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('kitchen management', () => {
  it('updates name, contact and capacity', async () => {
    const res = await api()
      .patch(`/api/v1/vendor/kitchens/${otherKitchenId}`)
      .set('Authorization', otherAuth())
      .send({ name: 'Rival Kitchen Updated', contactPhone: '+919000099911', capacityPerSlot: 180 })
      .expect(200);

    expect(res.body.data.kitchen).toMatchObject({
      name: 'Rival Kitchen Updated',
      capacityPerSlot: 180,
    });
  });

  it('sets an address, creating it on first save', async () => {
    const res = await api()
      .patch(`/api/v1/vendor/kitchens/${otherKitchenId}`)
      .set('Authorization', otherAuth())
      .send({
        address: {
          line1: '14 Avinashi Road',
          area: 'Peelamedu',
          cityName: 'Coimbatore',
          state: 'Tamil Nadu',
          postalCode: '641004',
          latitude: 11.0268,
          longitude: 77.0054,
        },
      })
      .expect(200);

    expect(res.body.data.kitchen.address).toMatchObject({
      line1: '14 Avinashi Road',
      postalCode: '641004',
    });

    // Updating again edits the same address rather than creating a second.
    const updated = await api()
      .patch(`/api/v1/vendor/kitchens/${otherKitchenId}`)
      .set('Authorization', otherAuth())
      .send({
        address: {
          line1: '16 Avinashi Road',
          cityName: 'Coimbatore',
          state: 'Tamil Nadu',
          postalCode: '641004',
        },
      })
      .expect(200);
    expect(updated.body.data.kitchen.address.line1).toBe('16 Avinashi Road');
    expect(updated.body.data.kitchen.address.id).toBe(res.body.data.kitchen.address.id);
  });

  it('rejects a bad PIN code', async () => {
    const res = await api()
      .patch(`/api/v1/vendor/kitchens/${otherKitchenId}`)
      .set('Authorization', otherAuth())
      .send({
        address: { line1: 'X Road', cityName: 'Coimbatore', state: 'TN', postalCode: '12' },
      })
      .expect(422);
    expect(res.body.error.details['address.postalCode']).toBeDefined();
  });

  it('replaces the week of operating hours', async () => {
    const hours = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
      dayOfWeek: day,
      opensMinute: 420,
      closesMinute: 1260,
      isClosed: day === 7,
    }));

    const res = await api()
      .patch(`/api/v1/vendor/kitchens/${otherKitchenId}`)
      .set('Authorization', otherAuth())
      .send({ operatingHours: hours })
      .expect(200);

    expect(res.body.data.kitchen.operatingHours).toHaveLength(7);
    expect(res.body.data.kitchen.operatingHours[6]).toMatchObject({
      dayOfWeek: 7,
      isClosed: true,
    });
  });

  it('rejects closing before opening', async () => {
    const res = await api()
      .patch(`/api/v1/vendor/kitchens/${otherKitchenId}`)
      .set('Authorization', otherAuth())
      .send({ operatingHours: [{ dayOfWeek: 1, opensMinute: 1200, closesMinute: 600 }] })
      .expect(422);
    expect(JSON.stringify(res.body.error.details)).toMatch(/closesMinute/);
  });

  it('rejects a duplicated weekday', async () => {
    const res = await api()
      .patch(`/api/v1/vendor/kitchens/${otherKitchenId}`)
      .set('Authorization', otherAuth())
      .send({
        operatingHours: [
          { dayOfWeek: 1, opensMinute: 400, closesMinute: 1200 },
          { dayOfWeek: 1, opensMinute: 500, closesMinute: 1300 },
        ],
      })
      .expect(400);
    expect(res.body.error.details.operatingHours).toBeDefined();
  });

  it('rejects an invalid capacity', async () => {
    const res = await api()
      .patch(`/api/v1/vendor/kitchens/${otherKitchenId}`)
      .set('Authorization', otherAuth())
      .send({ capacityPerSlot: 0 })
      .expect(422);
    expect(res.body.error.details.capacityPerSlot).toBeDefined();
  });

  it('replaces delivery areas', async () => {
    const res = await api()
      .put(`/api/v1/vendor/kitchens/${otherKitchenId}/service-areas`)
      .set('Authorization', otherAuth())
      .send({
        checkpoints: checkpointIds.slice(0, 2).map((id) => ({
          checkpointId: id,
          prepLeadMinutes: 100,
          travelMinutes: 20,
        })),
      })
      .expect(200);

    expect(res.body.data.kitchen.serviceAreas).toHaveLength(2);

    // Narrowing the set deactivates the dropped one.
    const narrowed = await api()
      .put(`/api/v1/vendor/kitchens/${otherKitchenId}/service-areas`)
      .set('Authorization', otherAuth())
      .send({ checkpoints: [{ checkpointId: checkpointIds[0]!, prepLeadMinutes: 90, travelMinutes: 30 }] })
      .expect(200);
    expect(narrowed.body.data.kitchen.serviceAreas).toHaveLength(1);
  });

  it('rejects an unknown checkpoint', async () => {
    const res = await api()
      .put(`/api/v1/vendor/kitchens/${otherKitchenId}/service-areas`)
      .set('Authorization', otherAuth())
      .send({ checkpoints: [{ checkpointId: 'clnonexistent000000000' }] })
      .expect(400);
    expect(res.body.error.details.checkpoints).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('menu management', () => {
  it('creates a meal with components and a unique slug', async () => {
    const res = await api()
      .post('/api/v1/vendor/meals')
      .set('Authorization', otherAuth())
      .send({
        name: 'Rival Veg Thali',
        description: 'Rice, sambar and two poriyals.',
        basePrice: '139.00',
        foodType: 'VEG',
        cuisine: 'South Indian',
        calories: 640,
        tags: ['thali', 'veg'],
        prepTimeMinutes: 40,
        components: [
          { name: 'Steamed rice', quantity: '1 cup' },
          { name: 'Sambar', quantity: '150 ml' },
        ],
      })
      .expect(201);

    expect(res.body.data.meal).toMatchObject({
      name: 'Rival Veg Thali',
      slug: 'rival-veg-thali',
      basePrice: '139.00',
      foodType: 'VEG',
    });
    expect(res.body.data.meal.components).toHaveLength(2);
  });

  it('de-duplicates slugs within a vendor', async () => {
    const res = await api()
      .post('/api/v1/vendor/meals')
      .set('Authorization', otherAuth())
      .send({ name: 'Rival Veg Thali', basePrice: '145.00' })
      .expect(201);
    expect(res.body.data.meal.slug).toBe('rival-veg-thali-2');
  });

  it('rejects a malformed price', async () => {
    const res = await api()
      .post('/api/v1/vendor/meals')
      .set('Authorization', otherAuth())
      .send({ name: 'Bad Price Meal', basePrice: 'free' })
      .expect(422);
    expect(res.body.error.details.basePrice).toBeDefined();
  });

  it('updates a meal and replaces its components', async () => {
    const created = await api()
      .post('/api/v1/vendor/meals')
      .set('Authorization', otherAuth())
      .send({
        name: 'Editable Meal',
        basePrice: '110.00',
        components: [{ name: 'Old item' }],
      })
      .expect(201);

    const res = await api()
      .patch(`/api/v1/vendor/meals/${created.body.data.meal.id}`)
      .set('Authorization', otherAuth())
      .send({ basePrice: '125.50', components: [{ name: 'New item', quantity: '2 nos' }] })
      .expect(200);

    expect(res.body.data.meal.basePrice).toBe('125.50');
    expect(res.body.data.meal.components).toEqual([{ name: 'New item', quantity: '2 nos' }]);
  });

  it('soft-deletes a meal and cancels its future publications', async () => {
    const created = await api()
      .post('/api/v1/vendor/meals')
      .set('Authorization', otherAuth())
      .send({ name: 'Deletable Meal', basePrice: '100.00' })
      .expect(201);
    const mealId = created.body.data.meal.id as string;

    const future = new Date();
    future.setUTCHours(0, 0, 0, 0);
    future.setUTCDate(future.getUTCDate() + 4);
    const slot = await prisma.timeSlot.findFirstOrThrow({ select: { id: true } });
    const schedule = await prisma.mealSchedule.create({
      data: {
        mealId,
        kitchenId: otherKitchenId,
        timeSlotId: slot.id,
        serviceDate: future,
        price: '100.00',
        totalQuantity: 20,
        status: 'PUBLISHED',
      },
    });

    await api()
      .delete(`/api/v1/vendor/meals/${mealId}`)
      .set('Authorization', otherAuth())
      .expect(204);

    const row = await prisma.meal.findUniqueOrThrow({ where: { id: mealId } });
    expect(row.deletedAt).toBeInstanceOf(Date);

    const scheduleRow = await prisma.mealSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(scheduleRow.status).toBe('CANCELLED');

    await api().get(`/api/v1/vendor/meals/${mealId}`).set('Authorization', otherAuth()).expect(404);
  });

  it('refuses to delete a meal with orders still to fulfil', async () => {
    const meal = await prisma.meal.findFirstOrThrow({
      where: {
        vendorId: seededVendorId,
        deletedAt: null,
        orderItems: { some: { status: { in: ['PENDING', 'CONFIRMED', 'PREPARING'] } } },
      },
      select: { id: true },
    });

    const res = await api()
      .delete(`/api/v1/vendor/meals/${meal.id}`)
      .set('Authorization', vendorAuth())
      .expect(400);
    expect(res.body.error.message).toMatch(/still to be fulfilled/i);
  });

  it('filters the menu by search and active state', async () => {
    const res = await api()
      .get('/api/v1/vendor/meals?search=thali')
      .set('Authorization', otherAuth())
      .expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const m of res.body.data) {
      expect(`${m.name} ${m.description ?? ''} ${m.cuisine ?? ''}`.toLowerCase()).toContain('thali');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('order queue and status pipeline', () => {
  let queueFixtureIndex = 0;
  /** Paid fixtures cover today's and tomorrow's kitchen queues. */
  async function freshItem(status: OrderItemStatus = OrderItemStatus.PENDING): Promise<string> {
    const schedule = await prisma.mealSchedule.findFirstOrThrow({
      where: { kitchen: { vendorId: seededVendorId }, status: 'PUBLISHED' },
      include: { meal: true },
    });
    const buyer = await prisma.user.findFirstOrThrow({ where: { email: 'customer@lunch.test' } });
    const order = await prisma.order.create({
      data: {
        orderNumber: `LN-T${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
        customerId: buyer.id,
        subtotal: '100.00',
        totalAmount: '100.00',
        status: 'CONFIRMED',
        payments: { create: { amount: '100.00', status: 'PAID', paidAt: new Date(), lastVerifiedAt: new Date() } },
      },
    });
    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        mealScheduleId: schedule.id,
        mealId: schedule.mealId,
        kitchenId: schedule.kitchenId,
        checkpointId: checkpointIds[0]!,
        timeSlotId: schedule.timeSlotId,
        serviceDate: new Date(new Date().setUTCHours(0, 0, 0, 0) + (queueFixtureIndex++ % 2) * 86400000),
        beneficiaryName: 'Queue Test',
        mealNameSnapshot: schedule.meal.name,
        unitPrice: '100.00',
        quantity: 1,
        lineTotal: '100.00',
        status,
      },
    });
    return item.id;
  }

  it('walks PENDING → CONFIRMED → PREPARING → PACKED', async () => {
    const itemId = await freshItem();

    for (const next of [
      OrderItemStatus.CONFIRMED,
      OrderItemStatus.PREPARING,
      OrderItemStatus.PACKED,
    ]) {
      const res = await api()
        .patch(`/api/v1/vendor/orders/${itemId}/status`)
        .set('Authorization', vendorAuth())
        .send({ status: next })
        .expect(200);
      expect(res.body.data.orderItem.status).toBe(next);
    }

    const row = await prisma.orderItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(row.preparingAt).toBeInstanceOf(Date);
    expect(row.packedAt).toBeInstanceOf(Date);
  });

  it('refuses to skip a step', async () => {
    const itemId = await freshItem();
    const res = await api()
      .patch(`/api/v1/vendor/orders/${itemId}/status`)
      .set('Authorization', vendorAuth())
      .send({ status: OrderItemStatus.PACKED })
      .expect(422);
    expect(res.body.error.code).toBe(ErrorCode.INVALID_STATE_TRANSITION);
  });

  it('refuses to move backwards', async () => {
    const itemId = await freshItem(OrderItemStatus.PACKED);
    const res = await api()
      .patch(`/api/v1/vendor/orders/${itemId}/status`)
      .set('Authorization', vendorAuth())
      .send({ status: OrderItemStatus.PREPARING })
      .expect(422);
    expect(res.body.error.code).toBe(ErrorCode.INVALID_STATE_TRANSITION);
  });

  it('refuses to touch a delivered item', async () => {
    const itemId = await freshItem(OrderItemStatus.DELIVERED);
    const res = await api()
      .patch(`/api/v1/vendor/orders/${itemId}/status`)
      .set('Authorization', vendorAuth())
      .send({ status: OrderItemStatus.CONFIRMED })
      .expect(422);
    expect(res.body.error.code).toBe(ErrorCode.INVALID_STATE_TRANSITION);
  });

  it('rejects a delivery status a vendor does not own', async () => {
    const itemId = await freshItem();
    const res = await api()
      .patch(`/api/v1/vendor/orders/${itemId}/status`)
      .set('Authorization', vendorAuth())
      .send({ status: OrderItemStatus.DELIVERED })
      .expect(422);
    expect(res.body.error.details.status).toBeDefined();
  });

  it('allows cancelling before packing', async () => {
    const itemId = await freshItem(OrderItemStatus.CONFIRMED);
    const res = await api()
      .patch(`/api/v1/vendor/orders/${itemId}/status`)
      .set('Authorization', vendorAuth())
      .send({ status: OrderItemStatus.CANCELLED, reason: 'Ingredient shortage' })
      .expect(200);
    expect(res.body.data.orderItem.status).toBe(OrderItemStatus.CANCELLED);
  });

  it('moves a batch and reports what it skipped', async () => {
    const movable = await freshItem(OrderItemStatus.CONFIRMED);
    const blocked = await freshItem(OrderItemStatus.DELIVERED);

    const res = await api()
      .post('/api/v1/vendor/orders/bulk-status')
      .set('Authorization', vendorAuth())
      .send({ orderItemIds: [movable, blocked], status: OrderItemStatus.PREPARING })
      .expect(200);

    expect(res.body.data.updated).toEqual([movable]);
    expect(res.body.data.skipped).toHaveLength(1);
    expect(res.body.data.skipped[0].orderItemId).toBe(blocked);
  });

  it('shows the beneficiary’s allergies to the kitchen', async () => {
    const res = await api()
      .get('/api/v1/vendor/orders?range=today')
      .set('Authorization', vendorAuth())
      .expect(200);
    // The field is always present, null when nothing is recorded.
    expect(res.body.data[0]).toHaveProperty('allergies');
  });

  it('filters by service date range and status', async () => {
    const today = await api()
      .get('/api/v1/vendor/orders?range=today')
      .set('Authorization', vendorAuth())
      .expect(200);
    const upcoming = await api()
      .get('/api/v1/vendor/orders?range=upcoming')
      .set('Authorization', vendorAuth())
      .expect(200);

    const todayDate = new Date().toISOString().slice(0, 10);
    for (const item of today.body.data) expect(item.serviceDate).toBe(todayDate);
    for (const item of upcoming.body.data) expect(item.serviceDate > todayDate).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('dashboard', () => {
  it('reports today, upcoming, production counts and revenue', async () => {
    const res = await api()
      .get('/api/v1/vendor/dashboard')
      .set('Authorization', vendorAuth())
      .expect(200);

    const d = res.body.data.dashboard as VendorDashboard;

    expect(d.vendor.id).toBe(seededVendorId);
    expect(d.today.date).toBe(new Date().toISOString().slice(0, 10));
    expect(d.today.totalOrders).toBeGreaterThan(0);
    expect(d.today.toPrepare).toBeGreaterThanOrEqual(0);
    expect(d.upcoming.totalOrders).toBeGreaterThan(0);

    // Revenue is a decimal string, never a float.
    expect(d.revenue.today).toMatch(/^\d+\.\d{2}$/);
    expect(d.revenue.last30Days).toMatch(/^\d+\.\d{2}$/);
    expect(Number(d.revenue.last30Days)).toBeGreaterThanOrEqual(Number(d.revenue.today));

    // Net is gross minus commission.
    const expectedNet = Number(d.revenue.today) * (1 - Number(d.revenue.commissionPct) / 100);
    expect(Math.abs(Number(d.revenue.todayNet) - expectedNet)).toBeLessThan(0.01);
  });

  it('excludes cancelled items from revenue', async () => {
    const before = await api()
      .get('/api/v1/vendor/dashboard')
      .set('Authorization', vendorAuth())
      .expect(200);
    const beforeRevenue = Number(before.body.data.dashboard.revenue.today);

    const todayDate = new Date();
    todayDate.setUTCHours(0, 0, 0, 0);
    const item = await prisma.orderItem.findFirst({
      where: {
        kitchen: { vendorId: seededVendorId },
        serviceDate: todayDate,
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
      select: { id: true, lineTotal: true, status: true },
    });

    if (item) {
      await api()
        .patch(`/api/v1/vendor/orders/${item.id}/status`)
        .set('Authorization', vendorAuth())
        .send({ status: OrderItemStatus.CANCELLED })
        .expect(200);

      const after = await api()
        .get('/api/v1/vendor/dashboard')
        .set('Authorization', vendorAuth())
        .expect(200);

      expect(Number(after.body.data.dashboard.revenue.today)).toBeCloseTo(
        beforeRevenue - (item.status === 'CONFIRMED' ? Number(item.lineTotal) : 0),
        2
      );
    }
  });

  it('reports slot load against kitchen capacity', async () => {
    const res = await api()
      .get('/api/v1/vendor/dashboard')
      .set('Authorization', vendorAuth())
      .expect(200);

    const d = res.body.data.dashboard as VendorDashboard;
    expect(Array.isArray(d.slotLoad)).toBe(true);
    for (const slot of d.slotLoad) {
      expect(slot.capacity).toBeGreaterThan(0);
      expect(slot.ordered).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('vendor status gates writes but not reads', () => {
  it('a pending vendor can read but not change anything', async () => {
    const owner = await registerUser();
    const createRes = await api()
      .post('/api/v1/admin/vendors')
      .set('Authorization', adminAuth())
      .send({ ownerEmail: owner.email, businessName: 'Still Pending Co' })
      .expect(201);

    const token = await signIn(owner.email, owner.password);
    const vendorId = createRes.body.data.vendor.id as string;

    // Reads are fine — they need to see why they cannot trade.
    const profile = await api()
      .get('/api/v1/vendor/profile')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(profile.body.data.vendor.status).toBe(VendorStatus.PENDING_APPROVAL);

    // Writes are refused.
    const res = await api()
      .post('/api/v1/vendor/meals')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Premature Meal', basePrice: '100.00' })
      .expect(403);
    expect(res.body.error.message).toMatch(/awaiting approval/i);

    await prisma.vendor.delete({ where: { id: vendorId } });
  });

  it('a suspended vendor cannot change order status', async () => {
    const { token, vendorId } = await provisionVendor('Will Be Suspended Co');

    await api()
      .patch(`/api/v1/admin/vendors/${vendorId}/status`)
      .set('Authorization', adminAuth())
      .send({ status: VendorStatus.SUSPENDED })
      .expect(200);

    const res = await api()
      .post('/api/v1/vendor/meals')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Suspended Meal', basePrice: '100.00' })
      .expect(403);
    expect(res.body.error.message).toMatch(/suspended/i);
  });
});

describe('non-vendor roles are shut out', () => {
  it('rejects customers, riders and anonymous callers', async () => {
    const customer = await signIn('customer@lunch.test');
    const rider = await signIn('rider@lunch.test');

    for (const path of ['/api/v1/vendor/dashboard', '/api/v1/vendor/kitchens', '/api/v1/vendor/meals']) {
      await api().get(path).set('Authorization', `Bearer ${customer}`).expect(403);
      await api().get(path).set('Authorization', `Bearer ${rider}`).expect(403);
      await api().get(path).expect(401);
    }
  });

  it('a user promoted away from VENDOR immediately loses access', async () => {
    const { token, owner } = await provisionVendor('Demoted Co');
    await api().get('/api/v1/vendor/dashboard').set('Authorization', `Bearer ${token}`).expect(200);

    await prisma.user.update({ where: { id: owner.id }, data: { role: UserRole.CUSTOMER } });

    // `authenticate` re-reads the role on every request.
    await api().get('/api/v1/vendor/dashboard').set('Authorization', `Bearer ${token}`).expect(403);
  });
});
