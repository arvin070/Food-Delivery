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
  type FoodType,
  type MealPeriod,
  type Nutrition,
  type PaginatedResult,
} from '@lunch/shared';
import { notFound } from '../../core/errors';
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

/**
 * Whether a slot on a date is still open for ordering.
 *
 * Cutoff is `orderCutoffMinutes` before the slot starts. Both are minutes in
 * the city's local day, which is why this is integer arithmetic on the date
 * rather than a timezone conversion.
 */
function isOrderable(serviceDate: Date, startMinute: number, cutoffMinutes: number): boolean {
  const slotStart = new Date(serviceDate);
  slotStart.setUTCMinutes(slotStart.getUTCMinutes() + startMinute);
  const cutoff = new Date(slotStart.getTime() - cutoffMinutes * 60_000);
  return Date.now() < cutoff.getTime();
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
      row.timeSlot.orderCutoffMinutes
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
  const from = todayUtc();
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
