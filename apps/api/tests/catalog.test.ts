/**
 * Meal catalog and availability.
 *
 * Two guarantees matter most here:
 *   • customers can read the catalog but cannot change menu data, and
 *   • a meal only appears when it can actually reach the customer — right date,
 *     a kitchen that serves their checkpoint, stock left, cutoff not passed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Allergen, ErrorCode, MealScheduleStatus, VendorStatus } from '@lunch/shared';
import { prisma } from '../src/core/prisma';
import { api, cleanupTestUsers, disconnect, registerUser } from './helpers';
import { assertDeliverySlotCapacity } from '../src/modules/catalog/catalog.service';

const SEED_PASSWORD = 'Lunch@1234';

let customerToken: string;
let vendorToken: string;
let adminToken: string;
let vendorId: string;
let kitchenId: string;
let checkpointId: string;
/** A checkpoint the seeded kitchen does NOT serve. */
let unservedCheckpointId: string;
let lunchSlotId: string;
let breakfastSlotId: string;
let capacityWindowOriginal: { id: string; maxOrders: number | null };
let capacityTestOrderPrefix: string;

async function signIn(identifier: string, password = SEED_PASSWORD): Promise<string> {
  const res = await api().post('/api/v1/auth/login').send({ identifier, password }).expect(200);
  return res.body.data.tokens.accessToken as string;
}

/** `YYYY-MM-DD`, `offset` days from today. */
function dateIso(offset: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  await cleanupTestUsers();

  [customerToken, vendorToken, adminToken] = await Promise.all([
    signIn('customer@lunch.test'),
    signIn('vendor@lunch.test'),
    signIn('admin@lunch.test'),
  ]);

  const profile = await api()
    .get('/api/v1/vendor/profile')
    .set('Authorization', `Bearer ${vendorToken}`)
    .expect(200);
  vendorId = profile.body.data.vendor.id;
  kitchenId = profile.body.data.kitchens[0].id;

  const served = await prisma.kitchenServiceArea.findFirstOrThrow({
    where: { kitchenId, isActive: true },
    select: { checkpointId: true },
  });
  checkpointId = served.checkpointId;

  // A checkpoint outside this kitchen's service areas, created for the test.
  const city = await prisma.city.findFirstOrThrow({ select: { id: true } });
  const unserved = await prisma.checkpoint.create({
    data: { name: 'Unserved Test Gate', type: 'OTHER', cityId: city.id },
  });
  unservedCheckpointId = unserved.id;

  const [lunch, breakfast] = await Promise.all([
    prisma.timeSlot.findFirstOrThrow({ where: { mealPeriod: 'LUNCH' }, select: { id: true } }),
    prisma.timeSlot.findFirstOrThrow({ where: { mealPeriod: 'BREAKFAST' }, select: { id: true } }),
  ]);
  lunchSlotId = lunch.id;
  breakfastSlotId = breakfast.id;
  const capacityWindow = await prisma.checkpointTimeSlot.findUniqueOrThrow({
    where: { checkpointId_timeSlotId: { checkpointId, timeSlotId: lunchSlotId } },
    select: { id: true, maxOrders: true },
  });
  capacityWindowOriginal = capacityWindow;
  capacityTestOrderPrefix = `SLOT-CAPACITY-TEST-${Date.now()}-`;
});

afterAll(async () => {
  await prisma.order.deleteMany({ where: { orderNumber: { startsWith: capacityTestOrderPrefix } } });
  await prisma.checkpointTimeSlot.update({
    where: { id: capacityWindowOriginal.id },
    data: { maxOrders: capacityWindowOriginal.maxOrders },
  });
  await prisma.checkpoint.deleteMany({ where: { name: 'Unserved Test Gate' } });
  await cleanupTestUsers();
  await disconnect();
});

const customerAuth = () => `Bearer ${customerToken}`;
const vendorAuth = () => `Bearer ${vendorToken}`;

// ─────────────────────────────────────────────────────────────────────────────

describe('customers cannot modify menu data', () => {
  const writeAttempts = [
    { method: 'post' as const, path: '/api/v1/catalog/meals' },
    { method: 'patch' as const, path: '/api/v1/catalog/meals/anything' },
    { method: 'put' as const, path: '/api/v1/catalog/meals/anything' },
    { method: 'delete' as const, path: '/api/v1/catalog/meals/anything' },
  ];

  for (const attempt of writeAttempts) {
    it(`refuses ${attempt.method.toUpperCase()} on the catalog`, async () => {
      const res = await api()
        [attempt.method](attempt.path)
        .set('Authorization', customerAuth())
        .send({ name: 'Hacked Meal', basePrice: '1.00' });

      // The router registers no write verbs, so these fall through to 404.
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCode.NOT_FOUND);
    });
  }

  it('refuses a customer on the vendor menu API', async () => {
    const meal = await prisma.meal.findFirstOrThrow({ where: { vendorId }, select: { id: true } });

    await api()
      .post('/api/v1/vendor/meals')
      .set('Authorization', customerAuth())
      .send({ name: 'Customer Dish', basePrice: '100.00' })
      .expect(403);

    await api()
      .patch(`/api/v1/vendor/meals/${meal.id}`)
      .set('Authorization', customerAuth())
      .send({ basePrice: '0.01' })
      .expect(403);

    await api()
      .delete(`/api/v1/vendor/meals/${meal.id}`)
      .set('Authorization', customerAuth())
      .expect(403);
  });

  it('refuses a customer on the availability API', async () => {
    await api()
      .post('/api/v1/vendor/availability')
      .set('Authorization', customerAuth())
      .send({
        mealId: 'x',
        kitchenId: 'y',
        serviceDates: [dateIso(1)],
        timeSlotIds: [lunchSlotId],
        quantity: 10,
      })
      .expect(403);
  });

  it('leaves the menu untouched after those attempts', async () => {
    const meal = await prisma.meal.findFirstOrThrow({
      where: { vendorId },
      select: { basePrice: true, deletedAt: true },
    });
    expect(meal.deletedAt).toBeNull();
    expect(Number(meal.basePrice)).toBeGreaterThan(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('browsing the catalog', () => {
  it('lists active dated windows for the selected checkpoint', async () => {
    const res = await api()
      .get(`/api/v1/catalog/delivery-slots?serviceDate=${dateIso(1)}&checkpointId=${checkpointId}`)
      .set('Authorization', customerAuth())
      .expect(200);

    expect(res.body.data.slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          timeSlotId: lunchSlotId,
          startMinute: expect.any(Number),
          endMinute: expect.any(Number),
          orderable: true,
        }),
      ])
    );
  });

  it('rejects impossible calendar dates', async () => {
    await api()
      .get(`/api/v1/catalog/delivery-slots?serviceDate=2026-02-30&checkpointId=${checkpointId}`)
      .set('Authorization', customerAuth())
      .expect(422);
  });

  it('requires a checkpoint and an allowed window for selected delivery times', async () => {
    await api()
      .get(`/api/v1/catalog/meals?serviceDate=${dateIso(1)}&timeSlotId=${lunchSlotId}`)
      .set('Authorization', customerAuth())
      .expect(400);

    await api()
      .get(
        `/api/v1/catalog/meals?serviceDate=${dateIso(1)}&checkpointId=${unservedCheckpointId}&timeSlotId=${lunchSlotId}`
      )
      .set('Authorization', customerAuth())
      .expect(400);
  });

  it('serializes concurrent reservations at the checkpoint capacity limit', async () => {
    await prisma.checkpointTimeSlot.update({
      where: { id: capacityWindowOriginal.id },
      data: { maxOrders: 1 },
    });
    const [customer, schedule] = await Promise.all([
      prisma.user.findFirstOrThrow({ where: { email: 'customer@lunch.test' }, select: { id: true } }),
      prisma.mealSchedule.findFirstOrThrow({
        where: { timeSlotId: lunchSlotId },
        select: { id: true, mealId: true, kitchenId: true, price: true },
      }),
    ]);
    const serviceDate = dateIso(45);

    const attempt = (suffix: string) =>
      prisma.$transaction(async (tx) => {
        await assertDeliverySlotCapacity(tx, {
          checkpointId,
          timeSlotId: lunchSlotId,
          serviceDate,
          quantity: 1,
        });
        const order = await tx.order.create({
          data: {
            orderNumber: `${capacityTestOrderPrefix}${suffix}`,
            customerId: customer.id,
            subtotal: '100.00',
            totalAmount: '100.00',
          },
          select: { id: true },
        });
        await tx.orderItem.create({
          data: {
            orderId: order.id,
            mealScheduleId: schedule.id,
            mealId: schedule.mealId,
            kitchenId: schedule.kitchenId,
            checkpointId,
            timeSlotId: lunchSlotId,
            serviceDate: new Date(`${serviceDate}T00:00:00Z`),
            beneficiaryName: 'Capacity Test',
            mealNameSnapshot: 'Capacity Test Meal',
            unitPrice: schedule.price,
            quantity: 1,
            lineTotal: schedule.price,
          },
        });
      });

    const results = await Promise.allSettled([attempt('A'), attempt('B')]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('returns meals for today with everything the card needs', async () => {
    const res = await api()
      .get(`/api/v1/catalog/meals?serviceDate=${dateIso(1)}&checkpointId=${checkpointId}`)
      .set('Authorization', customerAuth())
      .expect(200);

    expect(res.body.data.length).toBeGreaterThan(0);
    const meal = res.body.data[0];

    expect(meal).toMatchObject({
      mealScheduleId: expect.any(String),
      mealId: expect.any(String),
      name: expect.any(String),
      serviceDate: dateIso(1),
    });
    // Price is a two-place decimal string, never a float.
    expect(meal.price).toMatch(/^\d+\.\d{2}$/);
    expect(Array.isArray(meal.allergens)).toBe(true);
    expect(meal.nutrition).toHaveProperty('calories');
    expect(meal.vendor.businessName).toBeTypeOf('string');
    expect(meal.remaining).toBeGreaterThan(0);
  });

  it('carries facet counts for the filter controls', async () => {
    const res = await api()
      .get(`/api/v1/catalog/meals?serviceDate=${dateIso(1)}&checkpointId=${checkpointId}`)
      .set('Authorization', customerAuth())
      .expect(200);

    const { facets } = res.body.meta;
    expect(facets.mealPeriods.length).toBeGreaterThan(0);
    expect(facets.foodTypes.length).toBeGreaterThan(0);
    expect(facets.priceRange).toMatchObject({
      min: expect.stringMatching(/^\d+\.\d{2}$/),
      max: expect.stringMatching(/^\d+\.\d{2}$/),
    });
  });

  it('shows nothing for a checkpoint no kitchen serves', async () => {
    const res = await api()
      .get(`/api/v1/catalog/meals?serviceDate=${dateIso(1)}&checkpointId=${unservedCheckpointId}`)
      .set('Authorization', customerAuth())
      .expect(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('requires authentication', async () => {
    await api().get('/api/v1/catalog/meals').expect(401);
  });

  it('lists only dates that have something available', async () => {
    const res = await api()
      .get(`/api/v1/catalog/dates?checkpointId=${checkpointId}&days=14`)
      .set('Authorization', customerAuth())
      .expect(200);

    expect(res.body.data.dates.length).toBeGreaterThan(0);
    for (const d of res.body.data.dates) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('searching and filtering', () => {
  const base = () => `/api/v1/catalog/meals?serviceDate=${dateIso(1)}&checkpointId=${checkpointId}`;

  it('searches by name', async () => {
    const res = await api()
      .get(`${base()}&search=biryani`)
      .set('Authorization', customerAuth())
      .expect(200);

    expect(res.body.data.length).toBeGreaterThan(0);
    for (const m of res.body.data) expect(m.name.toLowerCase()).toContain('biryani');
  });

  it('searches by ingredient', async () => {
    const res = await api()
      .get(`${base()}&search=paneer`)
      .set('Authorization', customerAuth())
      .expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('filters by food type', async () => {
    const res = await api()
      .get(`${base()}&foodType=VEGAN`)
      .set('Authorization', customerAuth())
      .expect(200);

    expect(res.body.data.length).toBeGreaterThan(0);
    for (const m of res.body.data) expect(m.foodType).toBe('VEGAN');
  });

  it('filters by meal period', async () => {
    const res = await api()
      .get(`${base()}&mealPeriod=SNACKS`)
      .set('Authorization', customerAuth())
      .expect(200);

    for (const m of res.body.data) expect(m.timeSlot.mealPeriod).toBe('SNACKS');
  });

  it('filters by price range', async () => {
    const res = await api()
      .get(`${base()}&minPrice=100&maxPrice=160`)
      .set('Authorization', customerAuth())
      .expect(200);

    expect(res.body.data.length).toBeGreaterThan(0);
    for (const m of res.body.data) {
      const price = Number(m.price);
      expect(price).toBeGreaterThanOrEqual(100);
      expect(price).toBeLessThanOrEqual(160);
    }
  });

  it('excludes meals declaring an allergen — the filter a parent relies on', async () => {
    const all = await api().get(base()).set('Authorization', customerAuth()).expect(200);
    const withMilk = all.body.data.filter((m: { allergens: string[] }) =>
      m.allergens.includes(Allergen.MILK)
    );
    expect(withMilk.length).toBeGreaterThan(0); // the test is meaningful

    const res = await api()
      .get(`${base()}&excludeAllergens=${Allergen.MILK}`)
      .set('Authorization', customerAuth())
      .expect(200);

    expect(res.body.data.length).toBeLessThan(all.body.data.length);
    for (const m of res.body.data) expect(m.allergens).not.toContain(Allergen.MILK);
  });

  it('excludes several allergens at once', async () => {
    const res = await api()
      .get(`${base()}&excludeAllergens=${Allergen.MILK}&excludeAllergens=${Allergen.EGGS}`)
      .set('Authorization', customerAuth())
      .expect(200);

    for (const m of res.body.data) {
      expect(m.allergens).not.toContain(Allergen.MILK);
      expect(m.allergens).not.toContain(Allergen.EGGS);
    }
  });

  it('sorts by price ascending and descending', async () => {
    const asc = await api()
      .get(`${base()}&sort=price_asc`)
      .set('Authorization', customerAuth())
      .expect(200);
    const prices = asc.body.data.map((m: { price: string }) => Number(m.price));
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);

    const desc = await api()
      .get(`${base()}&sort=price_desc`)
      .set('Authorization', customerAuth())
      .expect(200);
    const descPrices = desc.body.data.map((m: { price: string }) => Number(m.price));
    expect([...descPrices].sort((a, b) => b - a)).toEqual(descPrices);
  });

  it('rejects an unknown allergen value', async () => {
    const res = await api()
      .get(`${base()}&excludeAllergens=KRYPTONITE`)
      .set('Authorization', customerAuth())
      .expect(422);
    expect(res.body.error.details.excludeAllergens).toBeDefined();
  });
});

describe('meal detail', () => {
  it('returns ingredients, components and nutrition', async () => {
    const list = await api()
      .get(`/api/v1/catalog/meals?serviceDate=${dateIso(1)}&checkpointId=${checkpointId}&search=thali`)
      .set('Authorization', customerAuth())
      .expect(200);

    const scheduleId = list.body.data[0].mealScheduleId;
    const res = await api()
      .get(`/api/v1/catalog/meals/${scheduleId}?checkpointId=${checkpointId}`)
      .set('Authorization', customerAuth())
      .expect(200);

    const meal = res.body.data.meal;
    expect(meal.ingredients.length).toBeGreaterThan(0);
    expect(meal.components.length).toBeGreaterThan(0);
    expect(meal.nutrition.proteinG).toMatch(/^\d+\.\d{2}$/);
    expect(Array.isArray(meal.alsoAvailableIn)).toBe(true);
  });

  it('offers the same dish in its other slots that day', async () => {
    const list = await api()
      .get(`/api/v1/catalog/meals?serviceDate=${dateIso(1)}&checkpointId=${checkpointId}&search=thali`)
      .set('Authorization', customerAuth())
      .expect(200);

    const res = await api()
      .get(`/api/v1/catalog/meals/${list.body.data[0].mealScheduleId}`)
      .set('Authorization', customerAuth())
      .expect(200);

    // The thali runs at lunch and dinner, so there is at least one alternative.
    expect(res.body.data.meal.alsoAvailableIn.length).toBeGreaterThan(0);
  });

  it('returns 404 for an unknown schedule', async () => {
    await api()
      .get('/api/v1/catalog/meals/clnonexistent000000000')
      .set('Authorization', customerAuth())
      .expect(404);
  });

  it('hides a meal from a checkpoint the kitchen does not serve', async () => {
    const list = await api()
      .get(`/api/v1/catalog/meals?serviceDate=${dateIso(1)}&checkpointId=${checkpointId}`)
      .set('Authorization', customerAuth())
      .expect(200);

    await api()
      .get(
        `/api/v1/catalog/meals/${list.body.data[0].mealScheduleId}?checkpointId=${unservedCheckpointId}`
      )
      .set('Authorization', customerAuth())
      .expect(404);
  });
});

describe('visibility rules', () => {
  /** Publishes a throwaway dish and returns its schedule id. */
  async function publishThrowaway(overrides: Record<string, unknown> = {}): Promise<{
    mealId: string;
    scheduleId: string;
  }> {
    const created = await api()
      .post('/api/v1/vendor/meals')
      .set('Authorization', vendorAuth())
      .send({
        name: `Visibility Dish ${Math.random().toString(36).slice(2, 8)}`,
        basePrice: '111.00',
        mealPeriods: ['LUNCH'],
        ...overrides,
      })
      .expect(201);

    const mealId = created.body.data.meal.id as string;

    await api()
      .post('/api/v1/vendor/availability')
      .set('Authorization', vendorAuth())
      .send({
        mealId,
        kitchenId,
        serviceDates: [dateIso(2)],
        timeSlotIds: [lunchSlotId],
        quantity: 5,
      })
      .expect(201);

    const schedule = await prisma.mealSchedule.findFirstOrThrow({
      where: { mealId, serviceDate: new Date(`${dateIso(2)}T00:00:00Z`) },
      select: { id: true },
    });
    return { mealId, scheduleId: schedule.id };
  }

  async function isVisible(scheduleId: string): Promise<boolean> {
    const res = await api()
      .get(`/api/v1/catalog/meals?serviceDate=${dateIso(2)}&checkpointId=${checkpointId}&pageSize=100`)
      .set('Authorization', customerAuth())
      .expect(200);
    return res.body.data.some((m: { mealScheduleId: string }) => m.mealScheduleId === scheduleId);
  }

  it('a published, in-stock dish is visible', async () => {
    const { scheduleId } = await publishThrowaway();
    expect(await isVisible(scheduleId)).toBe(true);
  });

  it('a draft is not visible', async () => {
    const { scheduleId } = await publishThrowaway();
    await prisma.mealSchedule.update({
      where: { id: scheduleId },
      data: { status: MealScheduleStatus.DRAFT },
    });
    expect(await isVisible(scheduleId)).toBe(false);
  });

  it('a deactivated dish disappears', async () => {
    const { mealId, scheduleId } = await publishThrowaway();
    await api()
      .patch(`/api/v1/vendor/meals/${mealId}`)
      .set('Authorization', vendorAuth())
      .send({ isActive: false })
      .expect(200);
    expect(await isVisible(scheduleId)).toBe(false);
  });

  it('a sold-out dish disappears', async () => {
    const { scheduleId } = await publishThrowaway();
    await prisma.mealSchedule.update({
      where: { id: scheduleId },
      data: { reservedQuantity: 5 }, // equals totalQuantity
    });
    expect(await isVisible(scheduleId)).toBe(false);
  });

  it('a suspended vendor’s dishes disappear', async () => {
    const { scheduleId } = await publishThrowaway();
    expect(await isVisible(scheduleId)).toBe(true);

    await api()
      .patch(`/api/v1/admin/vendors/${vendorId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: VendorStatus.SUSPENDED, reason: 'Catalog visibility test' })
      .expect(200);

    expect(await isVisible(scheduleId)).toBe(false);

    // Restore, so later tests and the dev environment are unaffected.
    await api()
      .patch(`/api/v1/admin/vendors/${vendorId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: VendorStatus.APPROVED })
      .expect(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('vendor availability', () => {
  let publishMealId: string;

  beforeAll(async () => {
    const created = await api()
      .post('/api/v1/vendor/meals')
      .set('Authorization', vendorAuth())
      .send({
        name: 'Availability Test Dish',
        basePrice: '120.00',
        mealPeriods: ['LUNCH'],
        maxDailyQuantity: 50,
      })
      .expect(201);
    publishMealId = created.body.data.meal.id;
  });

  it('publishes across several dates and slots', async () => {
    const res = await api()
      .post('/api/v1/vendor/availability')
      .set('Authorization', vendorAuth())
      .send({
        mealId: publishMealId,
        kitchenId,
        serviceDates: [dateIso(3), dateIso(4), dateIso(5)],
        timeSlotIds: [lunchSlotId],
        quantity: 25,
      })
      .expect(201);

    expect(res.body.data.created).toBe(3);
    expect(res.body.data.skipped).toHaveLength(0);
  });

  it('re-publishing updates rather than failing', async () => {
    const res = await api()
      .post('/api/v1/vendor/availability')
      .set('Authorization', vendorAuth())
      .send({
        mealId: publishMealId,
        kitchenId,
        serviceDates: [dateIso(3)],
        timeSlotIds: [lunchSlotId],
        quantity: 40,
      })
      .expect(201);

    expect(res.body.data.updated).toBe(1);
    expect(res.body.data.created).toBe(0);
  });

  it('skips a slot the dish is not offered in', async () => {
    const res = await api()
      .post('/api/v1/vendor/availability')
      .set('Authorization', vendorAuth())
      .send({
        mealId: publishMealId, // LUNCH only
        kitchenId,
        serviceDates: [dateIso(6)],
        timeSlotIds: [breakfastSlotId],
        quantity: 10,
      })
      .expect(201);

    expect(res.body.data.created).toBe(0);
    expect(res.body.data.skipped[0].reason).toMatch(/not offered at breakfast/i);
  });

  it('refuses a quantity above the dish’s daily cap', async () => {
    const res = await api()
      .post('/api/v1/vendor/availability')
      .set('Authorization', vendorAuth())
      .send({
        mealId: publishMealId,
        kitchenId,
        serviceDates: [dateIso(7)],
        timeSlotIds: [lunchSlotId],
        quantity: 500, // cap is 50
      })
      .expect(400);
    expect(res.body.error.details.quantity).toBeDefined();
  });

  it('refuses to publish into the past', async () => {
    const res = await api()
      .post('/api/v1/vendor/availability')
      .set('Authorization', vendorAuth())
      .send({
        mealId: publishMealId,
        kitchenId,
        serviceDates: [dateIso(-1)],
        timeSlotIds: [lunchSlotId],
        quantity: 10,
      })
      .expect(422);
    expect(res.body.error.details.serviceDates).toBeDefined();
  });

  it('refuses to publish an inactive dish', async () => {
    const created = await api()
      .post('/api/v1/vendor/meals')
      .set('Authorization', vendorAuth())
      .send({ name: 'Inactive Publish Dish', basePrice: '100.00', isActive: false })
      .expect(201);

    const res = await api()
      .post('/api/v1/vendor/availability')
      .set('Authorization', vendorAuth())
      .send({
        mealId: created.body.data.meal.id,
        kitchenId,
        serviceDates: [dateIso(3)],
        timeSlotIds: [lunchSlotId],
        quantity: 10,
      })
      .expect(400);
    expect(res.body.error.details.mealId).toBeDefined();
  });

  it('will not reduce quantity below what is already sold', async () => {
    const schedule = await prisma.mealSchedule.findFirstOrThrow({
      where: { mealId: publishMealId, serviceDate: new Date(`${dateIso(4)}T00:00:00Z`) },
      select: { id: true },
    });
    await prisma.mealSchedule.update({
      where: { id: schedule.id },
      data: { reservedQuantity: 20 },
    });

    const res = await api()
      .patch(`/api/v1/vendor/availability/${schedule.id}`)
      .set('Authorization', vendorAuth())
      .send({ quantity: 5 })
      .expect(409);
    expect(res.body.error.message).toMatch(/already been sold/i);
  });

  it('withdraws an unsold date outright', async () => {
    const schedule = await prisma.mealSchedule.findFirstOrThrow({
      where: { mealId: publishMealId, serviceDate: new Date(`${dateIso(5)}T00:00:00Z`) },
      select: { id: true },
    });

    await api()
      .delete(`/api/v1/vendor/availability/${schedule.id}`)
      .set('Authorization', vendorAuth())
      .expect(204);

    expect(await prisma.mealSchedule.findUnique({ where: { id: schedule.id } })).toBeNull();
  });

  it('cancels rather than deletes a date with orders', async () => {
    const schedule = await prisma.mealSchedule.findFirstOrThrow({
      where: { mealId: publishMealId, serviceDate: new Date(`${dateIso(4)}T00:00:00Z`) },
      select: { id: true },
    });

    await api()
      .delete(`/api/v1/vendor/availability/${schedule.id}`)
      .set('Authorization', vendorAuth())
      .expect(204);

    const row = await prisma.mealSchedule.findUnique({ where: { id: schedule.id } });
    expect(row).not.toBeNull();
    expect(row?.status).toBe(MealScheduleStatus.CANCELLED);
  });

  it('lists availability filtered by date range', async () => {
    const res = await api()
      .get(`/api/v1/vendor/availability?from=${dateIso(0)}&to=${dateIso(7)}&mealId=${publishMealId}`)
      .set('Authorization', vendorAuth())
      .expect(200);

    expect(res.body.data.length).toBeGreaterThan(0);
    for (const a of res.body.data) {
      expect(a.serviceDate >= dateIso(0)).toBe(true);
      expect(a.serviceDate <= dateIso(7)).toBe(true);
      expect(a.remaining).toBeGreaterThanOrEqual(0);
    }
  });

  it('cannot touch another vendor’s availability', async () => {
    const owner = await registerUser();
    await api()
      .post('/api/v1/admin/vendors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ownerEmail: owner.email, businessName: 'Availability Rival Co' })
      .expect(201);

    const rivalToken = await signIn(owner.email, owner.password);
    const schedule = await prisma.mealSchedule.findFirstOrThrow({
      where: { kitchen: { vendorId } },
      select: { id: true },
    });

    await api()
      .get(`/api/v1/vendor/availability/${schedule.id}`)
      .set('Authorization', `Bearer ${rivalToken}`)
      .expect(404);

    await api()
      .patch(`/api/v1/vendor/availability/${schedule.id}`)
      .set('Authorization', `Bearer ${rivalToken}`)
      .send({ quantity: 1 })
      .expect(403); // not yet approved, so the write is refused before ownership
  });
});

describe('meal fields round-trip', () => {
  it('stores every documented field', async () => {
    const res = await api()
      .post('/api/v1/vendor/meals')
      .set('Authorization', vendorAuth())
      .send({
        name: 'Fully Described Dish',
        description: 'Everything filled in.',
        imageUrl: 'https://cdn.example.com/meal.jpg',
        basePrice: '175.50',
        foodType: 'EGG',
        mealPeriods: ['BREAKFAST', 'SNACKS'],
        cuisine: 'Continental',
        ingredients: ['egg', 'bread', 'butter'],
        allergens: ['EGGS', 'MILK', 'WHEAT_GLUTEN'],
        calories: 540,
        proteinG: 22.5,
        carbsG: 48,
        fatG: 26.25,
        fibreG: 4,
        tags: ['breakfast', 'protein'],
        prepTimeMinutes: 20,
        maxDailyQuantity: 60,
        components: [{ name: 'Omelette', quantity: '2 eggs' }],
      })
      .expect(201);

    const meal = res.body.data.meal;
    expect(meal).toMatchObject({
      name: 'Fully Described Dish',
      basePrice: '175.50',
      foodType: 'EGG',
      cuisine: 'Continental',
      calories: 540,
      prepTimeMinutes: 20,
      maxDailyQuantity: 60,
    });
    expect(meal.mealPeriods).toEqual(['BREAKFAST', 'SNACKS']);
    expect(meal.allergens).toEqual(['EGGS', 'MILK', 'WHEAT_GLUTEN']);
    expect(meal.ingredients).toEqual(['egg', 'bread', 'butter']);
    // Nutrition is returned as two-place decimal strings.
    expect(meal.proteinG).toBe('22.50');
    expect(meal.carbsG).toBe('48.00');
    expect(meal.fatG).toBe('26.25');
  });

  it('rejects an unknown allergen', async () => {
    const res = await api()
      .post('/api/v1/vendor/meals')
      .set('Authorization', vendorAuth())
      .send({ name: 'Bad Allergen Dish', basePrice: '100.00', allergens: ['GLITTER'] })
      .expect(422);
    expect(JSON.stringify(res.body.error.details)).toMatch(/allergens/);
  });

  it('rejects an unknown meal period', async () => {
    const res = await api()
      .post('/api/v1/vendor/meals')
      .set('Authorization', vendorAuth())
      .send({ name: 'Bad Period Dish', basePrice: '100.00', mealPeriods: ['BRUNCH'] })
      .expect(422);
    expect(JSON.stringify(res.body.error.details)).toMatch(/mealPeriods/);
  });

  it('rejects negative nutrition', async () => {
    const res = await api()
      .post('/api/v1/vendor/meals')
      .set('Authorization', vendorAuth())
      .send({ name: 'Negative Protein Dish', basePrice: '100.00', proteinG: -5 })
      .expect(422);
    expect(res.body.error.details.proteinG).toBeDefined();
  });

  it('filters the vendor menu by meal period', async () => {
    const res = await api()
      .get('/api/v1/vendor/meals?mealPeriod=SNACKS&pageSize=100')
      .set('Authorization', vendorAuth())
      .expect(200);

    expect(res.body.data.length).toBeGreaterThan(0);
    for (const m of res.body.data) expect(m.mealPeriods).toContain('SNACKS');
  });
});
