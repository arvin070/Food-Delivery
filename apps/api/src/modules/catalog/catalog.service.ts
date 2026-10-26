import { cityToday, slotInstant } from '../subscriptions/recurrence';
/**
 * The customer-facing catalog. **Read-only** — nothing here writes, and the
 * router mounts no write verbs, so a customer cannot alter menu data.
 *
 * Browsing is anchored to a date and a checkpoint, because those decide what
 * can actually reach the customer. A meal appears only when all of this holds:
 *
 *   • its schedule is PUBLISHED for that date,
 *   • a kitchen that serves the chosen checkpoint is producing it,
 *   • the vendor is approved and active, and the kitchen and dish are active,
 *   • stock remains, and
 *   • the ordering cutoff for that slot has not passed.
 *
 * The first four are a database filter. The cutoff is computed per row, since
 * it depends on the slot's own `orderCutoffMinutes` and on the clock.
 */
import type { Prisma } from '@prisma/client';
import {
  MealScheduleStatus,
  VendorStatus,
  type Allergen,
  type BrowseCatalogQuery,
  type CatalogFacets,
  type CatalogMeal,
  type CatalogMealDetail,
  type DeliverySlotOption,
  type DeliverySlotsQuery,
  type FoodType,
  type MealPeriod,
  type Nutrition,
  type PaginatedResult,
} from '@lunch/shared';
import { badRequest, conflict, notFound } from '../../core/errors';
import { buildPaginatedResult, toMoney, toSkipTake } from '../../core/http';
import { prisma } from '../../core/prisma';

const catalogSelect = {
  id: true,
  serviceDate: true,
  price: true,
  totalQuantity: true,
  reservedQuantity: true,
  timeSlot: {
    select: {
      id: true,
      label: true,
      mealPeriod: true,
      startMinute: true,
      orderCutoffMinutes: true,
    },
  },
  kitchen: {
    select: {
      id: true,
      name: true,
      city: { select: { timezone: true } },
      vendor: { select: { id: true, businessName: true } },
    },
  },
  meal: {
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      imageUrl: true,
      foodType: true,
      mealPeriods: true,
      cuisine: true,
      tags: true,
      ingredients: true,
      allergens: true,
      calories: true,
      proteinG: true,
      carbsG: true,
      fatG: true,
      fibreG: true,
      prepTimeMinutes: true,
      category: { select: { id: true, name: true } },
      items: { select: { name: true, quantity: true }, orderBy: { sortOrder: 'asc' } },
    },
  },
} satisfies Prisma.MealScheduleSelect;

type CatalogRow = Prisma.MealScheduleGetPayload<{ select: typeof catalogSelect }>;

/** `Decimal | null` → a two-place string, or null when not declared. */
function grams(value: Prisma.Decimal | null): string | null {
  return value === null ? null : toMoney(value);
}

function toNutrition(meal: CatalogRow['meal']): Nutrition {
  return {
    calories: meal.calories,
    proteinG: grams(meal.proteinG),
    carbsG: grams(meal.carbsG),
    fatG: grams(meal.fatG),
    fibreG: grams(meal.fibreG),
  };
}

function todayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Convert the local delivery window to an instant before comparing cutoffs. */
function isOrderable(serviceDate: Date, startMinute: number, cutoffMinutes: number, timezone: string): boolean {
  return Date.now() < slotInstant(serviceDate, startMinute, timezone).getTime() - cutoffMinutes * 60_000;
}

function toCatalogMeal(row: CatalogRow): CatalogMeal {
  const { meal } = row;
  return {
    mealScheduleId: row.id,
    mealId: meal.id,
    name: meal.name,
    slug: meal.slug,
    description: meal.description,
    imageUrl: meal.imageUrl,
    price: toMoney(row.price),
    foodType: meal.foodType as FoodType,
    mealPeriods: meal.mealPeriods as MealPeriod[],
    cuisine: meal.cuisine,
    category: meal.category,
    tags: meal.tags,
    allergens: meal.allergens as Allergen[],
    nutrition: toNutrition(meal),
    prepTimeMinutes: meal.prepTimeMinutes,
    serviceDate: row.serviceDate.toISOString().slice(0, 10),
    timeSlot: {
      id: row.timeSlot.id,
      label: row.timeSlot.label,
      mealPeriod: row.timeSlot.mealPeriod as MealPeriod,
      startMinute: row.timeSlot.startMinute,
    },
    remaining: Math.max(0, row.totalQuantity - row.reservedQuantity),
    orderable: isOrderable(
      row.serviceDate,
      row.timeSlot.startMinute,
      row.timeSlot.orderCutoffMinutes,
      row.kitchen.city.timezone
    ),
    vendor: row.kitchen.vendor,
    kitchen: { id: row.kitchen.id, name: row.kitchen.name },
  };
}

/** The filter that decides what a customer may see. Used by browse and detail. */
function visibleWhere(query: Partial<BrowseCatalogQuery>): Prisma.MealScheduleWhereInput {
  const serviceDate = query.serviceDate ? new Date(`${query.serviceDate}T00:00:00Z`) : todayUtc();

  return {
    status: MealScheduleStatus.PUBLISHED,
    serviceDate,
    // Only kitchens that are live, belonging to a vendor that is live.
    kitchen: {
      isActive: true,
      deletedAt: null,
      vendor: { status: VendorStatus.APPROVED, isActive: true, deletedAt: null },
      // …and that actually deliver to the chosen checkpoint.
      ...(query.checkpointId
        ? { serviceAreas: { some: { checkpointId: query.checkpointId, isActive: true } } }
        : {}),
    },
    meal: {
      isActive: true,
      deletedAt: null,
      ...(query.foodType ? { foodType: query.foodType } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      // `hasSome` with the excluded set, negated: hide anything declaring one.
      ...(query.excludeAllergens && query.excludeAllergens.length > 0
        ? { NOT: { allergens: { hasSome: query.excludeAllergens } } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
              { cuisine: { contains: query.search, mode: 'insensitive' } },
              { tags: { has: query.search.toLowerCase() } },
              { ingredients: { has: query.search.toLowerCase() } },
            ],
          }
        : {}),
    },
    ...(query.timeSlotId ? { timeSlotId: query.timeSlotId } : {}),
    ...(query.mealPeriod ? { timeSlot: { mealPeriod: query.mealPeriod } } : {}),
    ...(query.minPrice !== undefined || query.maxPrice !== undefined
      ? {
          price: {
            ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}),
            ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}),
          },
        }
      : {}),
  };
}

function orderBy(sort: BrowseCatalogQuery['sort']): Prisma.MealScheduleOrderByWithRelationInput[] {
  switch (sort) {
    case 'price_asc':
      return [{ price: 'asc' }, { meal: { name: 'asc' } }];
    case 'price_desc':
      return [{ price: 'desc' }, { meal: { name: 'asc' } }];
    case 'popular':
      // Most reserved first — a reasonable stand-in until there is order history
      // worth ranking on.
      return [{ reservedQuantity: 'desc' }, { meal: { name: 'asc' } }];
    default:
      return [{ timeSlot: { startMinute: 'asc' } }, { meal: { name: 'asc' } }];
  }
}

export async function browse(
  query: BrowseCatalogQuery
): Promise<{ result: PaginatedResult<CatalogMeal>; facets: CatalogFacets }> {
  if (query.timeSlotId) {
    if (!query.checkpointId) {
      throw badRequest('Choose a checkpoint before selecting a delivery time', {
        checkpointId: ['Required when selecting a delivery window'],
      });
    }
    const date = query.serviceDate ?? todayUtc().toISOString().slice(0, 10);
    const slots = await availableDeliverySlots({
      checkpointId: query.checkpointId,
      serviceDate: date,
    });
    const selected = slots.find((slot) => slot.timeSlotId === query.timeSlotId);
    if (!selected) {
      throw badRequest('This delivery window is not active for the selected checkpoint', {
        timeSlotId: ['Choose an active delivery window for this checkpoint'],
      });
    }
    if (!selected.orderable) {
      throw conflict(
        selected.remainingOrders === 0
          ? 'The delivery window has reached its order capacity'
          : 'The ordering cutoff for this delivery window has passed'
      );
    }
  }

  const where = visibleWhere(query);
  const { skip, take } = toSkipTake(query);

  const [rows, total] = await prisma.$transaction([
    prisma.mealSchedule.findMany({
      where,
      select: catalogSelect,
      orderBy: orderBy(query.sort),
      skip,
      take,
    }),
    prisma.mealSchedule.count({ where }),
  ]);

  const items = rows.map(toCatalogMeal).filter((item) => item.remaining > 0);

  return { result: buildPaginatedResult(items, total, query), facets: await facetsFor(query) };
}

/**
 * Counts for the filter controls.
 *
 * Deliberately computed against the query *without* the facet's own filter
 * applied, so selecting "Lunch" does not make every other period read zero.
 */
async function facetsFor(query: BrowseCatalogQuery): Promise<CatalogFacets> {
  const base = visibleWhere({ ...query, mealPeriod: undefined, foodType: undefined, categoryId: undefined });

  const rows = await prisma.mealSchedule.findMany({
    where: base,
    select: {
      price: true,
      timeSlot: { select: { mealPeriod: true } },
      meal: { select: { foodType: true, category: { select: { id: true, name: true } } } },
    },
  });

  const tally = <T extends string>(values: T[]): { value: T; count: number }[] => {
    const counts = new Map<T, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
  };

  const categoryCounts = new Map<string, { id: string; name: string; count: number }>();
  for (const row of rows) {
    const category = row.meal.category;
    if (!category) continue;
    const existing = categoryCounts.get(category.id);
    if (existing) existing.count += 1;
    else categoryCounts.set(category.id, { ...category, count: 1 });
  }

  const prices = rows.map((r) => Number.parseFloat(r.price.toString())).filter(Number.isFinite);

  return {
    mealPeriods: tally(rows.map((r) => r.timeSlot.mealPeriod as MealPeriod)),
    foodTypes: tally(rows.map((r) => r.meal.foodType as FoodType)),
    categories: [...categoryCounts.values()].sort((a, b) => b.count - a.count),
    priceRange:
      prices.length > 0
        ? { min: Math.min(...prices).toFixed(2), max: Math.max(...prices).toFixed(2) }
        : null,
  };
}

export async function getMealDetail(
  mealScheduleId: string,
  checkpointId?: string
): Promise<CatalogMealDetail> {
  const row = await prisma.mealSchedule.findFirst({
    where: {
      id: mealScheduleId,
      status: MealScheduleStatus.PUBLISHED,
      kitchen: {
        isActive: true,
        deletedAt: null,
        vendor: { status: VendorStatus.APPROVED, isActive: true, deletedAt: null },
        ...(checkpointId
          ? { serviceAreas: { some: { checkpointId, isActive: true } } }
          : {}),
      },
      meal: { isActive: true, deletedAt: null },
    },
    select: catalogSelect,
  });

  if (!row) throw notFound('Meal');

  // The same dish may run in several slots that day; offer them as alternatives
  // rather than making the customer go back and search again.
  const siblings = await prisma.mealSchedule.findMany({
    where: {
      mealId: row.meal.id,
      serviceDate: row.serviceDate,
      status: MealScheduleStatus.PUBLISHED,
      id: { not: row.id },
      kitchen: {
        isActive: true,
        vendor: { status: VendorStatus.APPROVED, isActive: true },
        ...(checkpointId
          ? { serviceAreas: { some: { checkpointId, isActive: true } } }
          : {}),
      },
    },
    select: {
      id: true,
      price: true,
      totalQuantity: true,
      reservedQuantity: true,
      timeSlot: { select: { label: true, startMinute: true } },
    },
    orderBy: { timeSlot: { startMinute: 'asc' } },
  });

  return {
    ...toCatalogMeal(row),
    ingredients: row.meal.ingredients,
    components: row.meal.items,
    alsoAvailableIn: siblings
      .filter((s) => s.totalQuantity - s.reservedQuantity > 0)
      .map((s) => ({
        mealScheduleId: s.id,
        timeSlotLabel: s.timeSlot.label,
        price: toMoney(s.price),
      })),
  };
}

/** Dates in the next `days` that have at least one published, in-stock meal. */
export async function availableDates(
  checkpointId: string | undefined,
  days = 14
): Promise<string[]> {
  const checkpoint = checkpointId ? await prisma.checkpoint.findUnique({ where: { id: checkpointId }, select: { city: { select: { timezone: true } } } }) : null;
  const from = checkpoint ? cityToday(checkpoint.city.timezone) : todayUtc();
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + days);

  const rows = await prisma.mealSchedule.groupBy({
    by: ['serviceDate'],
    where: {
      status: MealScheduleStatus.PUBLISHED,
      serviceDate: { gte: from, lte: to },
      kitchen: {
        isActive: true,
        deletedAt: null,
        vendor: { status: VendorStatus.APPROVED, isActive: true, deletedAt: null },
        ...(checkpointId
          ? { serviceAreas: { some: { checkpointId, isActive: true } } }
          : {}),
      },
      meal: { isActive: true, deletedAt: null },
    },
    _count: { _all: true },
    orderBy: { serviceDate: 'asc' },
  });

  return rows.map((r) => r.serviceDate.toISOString().slice(0, 10));
}

/**
 * Dated checkpoint windows backed by the reusable checkpoint/time-slot link.
 * The kitchen list is derived from published meal schedules for this date.
 */
export async function availableDeliverySlots(
  query: DeliverySlotsQuery
): Promise<DeliverySlotOption[]> {
  const serviceDate = new Date(`${query.serviceDate}T00:00:00Z`);

  const checkpoint = await prisma.checkpoint.findFirst({
    where: { id: query.checkpointId, OR: [{ institutionId: null }, { institution: { isActive: true } }], isActive: true },
    select: { id: true, deliveryCapacity: true, city: { select: { timezone: true } } },
  });
  if (!checkpoint) throw notFound('Checkpoint');
  if (serviceDate < cityToday(checkpoint.city.timezone)) {
    throw badRequest('Delivery date cannot be in the past', {
      serviceDate: ['Choose today or a future date'],
    });
  }


  const windows = await prisma.checkpointTimeSlot.findMany({
    where: {
      checkpointId: checkpoint.id,
      isActive: true,
      timeSlot: { isActive: true },
    },
    select: {
      timeSlotId: true,
      maxOrders: true,
      orderCutoffMinutes: true,
      timeSlot: {
        select: {
          label: true,
          mealPeriod: true,
          startMinute: true,
          endMinute: true,
          orderCutoffMinutes: true,
        },
      },
    },
    orderBy: { timeSlot: { startMinute: 'asc' } },
  });
  if (windows.length === 0) return [];

  const timeSlotIds = windows.map((window) => window.timeSlotId);
  const [bookedRows, schedules] = await Promise.all([
    prisma.orderItem.groupBy({
      by: ['timeSlotId'],
      where: {
        checkpointId: checkpoint.id,
        serviceDate,
        timeSlotId: { in: timeSlotIds },
        status: { notIn: ['CANCELLED', 'FAILED'] },
      },
      _sum: { quantity: true },
    }),
    prisma.mealSchedule.findMany({
      where: {
        serviceDate,
        timeSlotId: { in: timeSlotIds },
        status: MealScheduleStatus.PUBLISHED,
        kitchen: {
          isActive: true,
          deletedAt: null,
          vendor: { status: VendorStatus.APPROVED, isActive: true, deletedAt: null },
          serviceAreas: { some: { checkpointId: checkpoint.id, isActive: true } },
        },
        meal: { isActive: true, deletedAt: null },
      },
      distinct: ['kitchenId', 'timeSlotId'],
      select: { timeSlotId: true, kitchen: { select: { id: true, name: true } } },
    }),
  ]);

  const bookedBySlot = new Map(
    bookedRows.map((row) => [row.timeSlotId, row._sum.quantity ?? 0])
  );
  const kitchensBySlot = new Map<string, Map<string, { id: string; name: string }>>();
  for (const schedule of schedules) {
    const kitchens = kitchensBySlot.get(schedule.timeSlotId) ?? new Map();
    kitchens.set(schedule.kitchen.id, schedule.kitchen);
    kitchensBySlot.set(schedule.timeSlotId, kitchens);
  }

  return windows.map((window) => {
    const limits = [window.maxOrders, checkpoint.deliveryCapacity].filter(
      (limit): limit is number => limit !== null
    );
    const maxOrders = limits.length ? Math.min(...limits) : null;
    const bookedOrders = bookedBySlot.get(window.timeSlotId) ?? 0;
    const cutoffMinutes = window.orderCutoffMinutes ?? window.timeSlot.orderCutoffMinutes;
    const remainingOrders = maxOrders === null ? null : Math.max(0, maxOrders - bookedOrders);
    return {
      timeSlotId: window.timeSlotId,
      label: window.timeSlot.label,
      mealPeriod: window.timeSlot.mealPeriod as MealPeriod,
      startMinute: window.timeSlot.startMinute,
      endMinute: window.timeSlot.endMinute,
      maxOrders,
      bookedOrders,
      remainingOrders,
      orderable:
        isOrderable(serviceDate, window.timeSlot.startMinute, cutoffMinutes, checkpoint.city.timezone) &&
        remainingOrders !== 0,
      kitchens: [...(kitchensBySlot.get(window.timeSlotId)?.values() ?? [])],
    };
  });
}

/**
 * Checkout must call this inside the same transaction that creates its order
 * items. Locking the checkpoint window serializes competing reservations;
 * cancelled and failed items release their capacity.
 */
export async function assertDeliverySlotCapacity(
  tx: Prisma.TransactionClient,
  input: { checkpointId: string; timeSlotId: string; serviceDate: string; quantity: number; timezone?: string }
): Promise<void> {
  const serviceDate = new Date(`${input.serviceDate}T00:00:00Z`);
  if (
    Number.isNaN(serviceDate.getTime()) ||
    serviceDate.toISOString().slice(0, 10) !== input.serviceDate
  ) {
    throw badRequest('Invalid delivery date', { serviceDate: ['Use a real YYYY-MM-DD date'] });
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw badRequest('Quantity must be a positive whole number', {
      quantity: ['Enter at least one meal'],
    });
  }

  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "checkpoint_time_slots"
    WHERE "checkpointId" = ${input.checkpointId}
      AND "timeSlotId" = ${input.timeSlotId}
      AND "isActive" = true
    FOR UPDATE
  `;
  if (rows.length === 0) {
    throw badRequest('This delivery window is not available at the checkpoint', {
      timeSlotId: ['Choose an active delivery window for this checkpoint'],
    });
  }

  const [checkpoint, window] = await Promise.all([
    tx.checkpoint.findFirst({
      where: { id: input.checkpointId, OR: [{ institutionId: null }, { institution: { isActive: true } }], isActive: true },
      select: { deliveryCapacity: true, city: { select: { timezone: true } } },
    }),
    tx.checkpointTimeSlot.findFirst({
      where: { checkpointId: input.checkpointId, timeSlotId: input.timeSlotId, isActive: true },
      select: {
        maxOrders: true,
        orderCutoffMinutes: true,
        timeSlot: {
          select: { isActive: true, startMinute: true, orderCutoffMinutes: true },
        },
      },
    }),
  ]);
  if (!checkpoint || !window?.timeSlot.isActive) {
    throw badRequest('Checkpoint or delivery window is inactive');
  }
  if (serviceDate < cityToday(checkpoint.city.timezone)) {
    throw badRequest('Delivery date cannot be in the past', {
      serviceDate: ['Choose today or a future date'],
    });
  }
  const cutoff = window.orderCutoffMinutes ?? window.timeSlot.orderCutoffMinutes;
  if (!isOrderable(serviceDate, window.timeSlot.startMinute, cutoff, checkpoint.city.timezone)) {
    throw conflict('The ordering cutoff for this delivery window has passed');
  }

  const limits = [window.maxOrders, checkpoint.deliveryCapacity].filter(
    (limit): limit is number => limit !== null
  );
  if (limits.length === 0) return;
  const maxOrders = Math.min(...limits);
  const committed = await tx.orderItem.aggregate({
    where: {
      checkpointId: input.checkpointId,
      timeSlotId: input.timeSlotId,
      serviceDate,
      status: { notIn: ['CANCELLED', 'FAILED'] },
    },
    _sum: { quantity: true },
  });
  const booked = committed._sum.quantity ?? 0;
  if (booked + input.quantity > maxOrders) {
    throw conflict('The delivery window has reached its order capacity');
  }
}
