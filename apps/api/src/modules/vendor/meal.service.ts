/**
 * Menu management. A `Meal` is the vendor's definition of a dish; it becomes
 * purchasable only when a `MealSchedule` publishes it for a date and slot.
 */
import type { Prisma } from '@prisma/client';
import type {
  Allergen,
  CreateMealInput,
  FoodType,
  ListMealsQuery,
  MealPeriod,
  PaginatedResult,
  UpdateMealInput,
  VendorMeal,
} from '@lunch/shared';
import { badRequest, notFound } from '../../core/errors';
import { buildPaginatedResult, toMoney, toSkipTake } from '../../core/http';
import { logger } from '../../core/logger';
import { prisma } from '../../core/prisma';
import { assertKitchenBelongsToVendor } from './vendor.context';

const mealSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  imageUrl: true,
  basePrice: true,
  foodType: true,
  mealPeriods: true,
  cuisine: true,
  ingredients: true,
  allergens: true,
  calories: true,
  proteinG: true,
  carbsG: true,
  fatG: true,
  fibreG: true,
  tags: true,
  prepTimeMinutes: true,
  maxDailyQuantity: true,
  isActive: true,
  category: { select: { id: true, name: true } },
  kitchen: { select: { id: true, name: true } },
  items: { select: { name: true, quantity: true }, orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.MealSelect;

type MealRow = Prisma.MealGetPayload<{ select: typeof mealSelect }>;

function toVendorMeal(row: MealRow, scheduledCount: number): VendorMeal {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    imageUrl: row.imageUrl,
    basePrice: toMoney(row.basePrice),
    foodType: row.foodType as FoodType,
    mealPeriods: row.mealPeriods as MealPeriod[],
    cuisine: row.cuisine,
    ingredients: row.ingredients,
    allergens: row.allergens as Allergen[],
    calories: row.calories,
    // Nutrition is Decimal in the database; null means "not declared".
    proteinG: row.proteinG === null ? null : toMoney(row.proteinG),
    carbsG: row.carbsG === null ? null : toMoney(row.carbsG),
    fatG: row.fatG === null ? null : toMoney(row.fatG),
    fibreG: row.fibreG === null ? null : toMoney(row.fibreG),
    tags: row.tags,
    prepTimeMinutes: row.prepTimeMinutes,
    maxDailyQuantity: row.maxDailyQuantity,
    isActive: row.isActive,
    category: row.category,
    kitchen: row.kitchen,
    components: row.items,
    scheduledCount,
  };
}

/** URL-safe identifier, unique per vendor. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

/** Appends a counter until the slug is free within this vendor. */
async function uniqueSlug(vendorId: string, name: string, excludeMealId?: string): Promise<string> {
  const base = slugify(name) || 'meal';
  for (let suffix = 0; suffix < 50; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
    const clash = await prisma.meal.findFirst({
      where: {
        vendorId,
        slug: candidate,
        ...(excludeMealId ? { id: { not: excludeMealId } } : {}),
      },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/** Counts future publications, so the UI can warn before deactivating. */
async function scheduledCounts(mealIds: string[]): Promise<Map<string, number>> {
  if (mealIds.length === 0) return new Map();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const rows = await prisma.mealSchedule.groupBy({
    by: ['mealId'],
    where: { mealId: { in: mealIds }, serviceDate: { gte: today }, status: { not: 'CANCELLED' } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.mealId, r._count._all]));
}

export async function listMeals(
  vendorId: string,
  query: ListMealsQuery
): Promise<PaginatedResult<VendorMeal>> {
  const where: Prisma.MealWhereInput = {
    vendorId,
    deletedAt: null,
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    ...(query.mealPeriod ? { mealPeriods: { has: query.mealPeriod } } : {}),
    ...(query.foodType ? { foodType: query.foodType } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
            { cuisine: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const { skip, take } = toSkipTake(query);
  const [rows, total] = await prisma.$transaction([
    prisma.meal.findMany({ where, select: mealSelect, orderBy: { name: 'asc' }, skip, take }),
    prisma.meal.count({ where }),
  ]);

  const counts = await scheduledCounts(rows.map((r) => r.id));
  return buildPaginatedResult(
    rows.map((r) => toVendorMeal(r, counts.get(r.id) ?? 0)),
    total,
    query
  );
}

export async function getMeal(vendorId: string, mealId: string): Promise<VendorMeal> {
  const row = await prisma.meal.findFirst({
    where: { id: mealId, vendorId, deletedAt: null },
    select: mealSelect,
  });
  if (!row) throw notFound('Meal');
  const counts = await scheduledCounts([row.id]);
  return toVendorMeal(row, counts.get(row.id) ?? 0);
}

export async function createMeal(vendorId: string, input: CreateMealInput): Promise<VendorMeal> {
  if (input.kitchenId) await assertKitchenBelongsToVendor(vendorId, input.kitchenId);

  if (input.categoryId) {
    const found = await prisma.mealCategory.count({
      where: { id: input.categoryId, isActive: true },
    });
    if (!found) throw badRequest('That category was not found', { categoryId: ['Unknown category'] });
  }

  const slug = await uniqueSlug(vendorId, input.name);

  const row = await prisma.meal.create({
    data: {
      vendorId,
      name: input.name,
      slug,
      description: input.description ?? null,
      imageUrl: input.imageUrl ?? null,
      basePrice: input.basePrice,
      foodType: input.foodType,
      mealPeriods: input.mealPeriods ?? [],
      categoryId: input.categoryId ?? null,
      kitchenId: input.kitchenId ?? null,
      cuisine: input.cuisine ?? null,
      ingredients: input.ingredients ?? [],
      allergens: input.allergens ?? [],
      calories: input.calories ?? null,
      proteinG: input.proteinG ?? null,
      carbsG: input.carbsG ?? null,
      fatG: input.fatG ?? null,
      fibreG: input.fibreG ?? null,
      tags: input.tags ?? [],
      prepTimeMinutes: input.prepTimeMinutes,
      maxDailyQuantity: input.maxDailyQuantity ?? null,
      isActive: input.isActive,
      ...(input.components && input.components.length > 0
        ? {
            items: {
              create: input.components.map((c, i) => ({
                name: c.name,
                quantity: c.quantity ?? null,
                sortOrder: i,
              })),
            },
          }
        : {}),
    },
    select: mealSelect,
  });

  logger.info({ vendorId, mealId: row.id }, 'Meal created');
  return toVendorMeal(row, 0);
}

export async function updateMeal(
  vendorId: string,
  mealId: string,
  input: UpdateMealInput
): Promise<VendorMeal> {
  const existing = await prisma.meal.findFirst({
    where: { id: mealId, vendorId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!existing) throw notFound('Meal');

  if (input.kitchenId) await assertKitchenBelongsToVendor(vendorId, input.kitchenId);
  if (input.categoryId) {
    const found = await prisma.mealCategory.count({
      where: { id: input.categoryId, isActive: true },
    });
    if (!found) throw badRequest('That category was not found', { categoryId: ['Unknown category'] });
  }

  const data: Prisma.MealUpdateInput = {};
  if (input.name !== undefined && input.name !== existing.name) {
    data.name = input.name;
    data.slug = await uniqueSlug(vendorId, input.name, mealId);
  }
  if (input.description !== undefined) data.description = input.description;
  if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl;
  if (input.basePrice !== undefined) data.basePrice = input.basePrice;
  if (input.foodType !== undefined) data.foodType = input.foodType;
  if (input.mealPeriods !== undefined) data.mealPeriods = input.mealPeriods;
  if (input.cuisine !== undefined) data.cuisine = input.cuisine;
  if (input.ingredients !== undefined) data.ingredients = input.ingredients;
  if (input.allergens !== undefined) data.allergens = input.allergens;
  if (input.calories !== undefined) data.calories = input.calories;
  if (input.proteinG !== undefined) data.proteinG = input.proteinG;
  if (input.carbsG !== undefined) data.carbsG = input.carbsG;
  if (input.fatG !== undefined) data.fatG = input.fatG;
  if (input.fibreG !== undefined) data.fibreG = input.fibreG;
  if (input.tags !== undefined) data.tags = input.tags;
  if (input.prepTimeMinutes !== undefined) data.prepTimeMinutes = input.prepTimeMinutes;
  if (input.maxDailyQuantity !== undefined) data.maxDailyQuantity = input.maxDailyQuantity;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.categoryId !== undefined) {
    data.category = input.categoryId ? { connect: { id: input.categoryId } } : { disconnect: true };
  }
  if (input.kitchenId !== undefined) {
    data.kitchen = input.kitchenId ? { connect: { id: input.kitchenId } } : { disconnect: true };
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.meal.update({ where: { id: mealId }, data });
    }
    // Components are a list, so they are replaced rather than merged.
    if (input.components !== undefined) {
      await tx.mealComponent.deleteMany({ where: { mealId } });
      if (input.components.length > 0) {
        await tx.mealComponent.createMany({
          data: input.components.map((c, i) => ({
            mealId,
            name: c.name,
            quantity: c.quantity ?? null,
            sortOrder: i,
          })),
        });
      }
    }
  });

  logger.info({ vendorId, mealId }, 'Meal updated');
  return getMeal(vendorId, mealId);
}

/**
 * Removes a meal from the menu.
 *
 * Soft delete, because order items snapshot the meal name but still reference
 * the row. Future publications are cancelled so nothing new can be bought, but
 * dates already being prepared are left alone — a vendor deleting a dish must
 * not silently drop meals a customer has paid for.
 */
export async function removeMeal(vendorId: string, mealId: string): Promise<void> {
  const existing = await prisma.meal.findFirst({
    where: { id: mealId, vendorId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) throw notFound('Meal');

  const sold = await prisma.orderItem.count({
    where: {
      mealId,
      status: { in: ['PENDING', 'CONFIRMED', 'PREPARING', 'PACKED', 'DISPATCHED', 'OUT_FOR_DELIVERY'] },
    },
  });
  if (sold > 0) {
    throw badRequest(
      `This meal has ${sold} order${sold === 1 ? '' : 's'} still to be fulfilled. Deactivate it instead, or fulfil them first.`
    );
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  await prisma.$transaction(async (tx) => {
    await tx.mealSchedule.updateMany({
      where: { mealId, serviceDate: { gte: today }, status: { not: 'CANCELLED' } },
      data: { status: 'CANCELLED' },
    });
    await tx.meal.update({
      where: { id: mealId },
      data: { deletedAt: new Date(), isActive: false },
    });
  });

  logger.info({ vendorId, mealId }, 'Meal removed');
}
