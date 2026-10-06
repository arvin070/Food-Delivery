/**
 * Availability: making a meal purchasable on a date.
 *
 * A `Meal` is a definition; a `MealSchedule` is a thing a customer can buy —
 * this dish, from this kitchen, on this date, in this slot, at this price, with
 * this much stock. Everything here creates and maintains those rows.
 *
 * Scoped by `vendorId` like the rest of the vendor module: the meal and the
 * kitchen are both confirmed to belong to the caller before anything is written.
 */
import type { Prisma } from '@prisma/client';
import {
  MealScheduleStatus,
  type FoodType,
  type ListAvailabilityQuery,
  type MealAvailability,
  type MealPeriod,
  type PaginatedResult,
  type PublishAvailabilityInput,
  type UpdateAvailabilityInput,
} from '@lunch/shared';
import { badRequest, conflict, notFound } from '../../core/errors';
import { buildPaginatedResult, toMoney, toSkipTake } from '../../core/http';
import { logger } from '../../core/logger';
import { prisma } from '../../core/prisma';

const scheduleSelect = {
  id: true,
  serviceDate: true,
  price: true,
  totalQuantity: true,
  reservedQuantity: true,
  status: true,
  timeSlot: { select: { id: true, label: true, mealPeriod: true } },
  meal: { select: { id: true, name: true, foodType: true } },
  kitchen: { select: { id: true, name: true } },
} satisfies Prisma.MealScheduleSelect;

type ScheduleRow = Prisma.MealScheduleGetPayload<{ select: typeof scheduleSelect }>;

function toAvailability(row: ScheduleRow): MealAvailability {
  return {
    id: row.id,
    serviceDate: row.serviceDate.toISOString().slice(0, 10),
    timeSlot: {
      id: row.timeSlot.id,
      label: row.timeSlot.label,
      mealPeriod: row.timeSlot.mealPeriod as MealPeriod,
    },
    meal: {
      id: row.meal.id,
      name: row.meal.name,
      foodType: row.meal.foodType as FoodType,
    },
    kitchen: row.kitchen,
    price: toMoney(row.price),
    totalQuantity: row.totalQuantity,
    reservedQuantity: row.reservedQuantity,
    remaining: Math.max(0, row.totalQuantity - row.reservedQuantity),
    status: row.status as MealScheduleStatus,
  };
}

/** Midnight UTC for a `YYYY-MM-DD`, matching the `@db.Date` column. */
function toServiceDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export async function listAvailability(
  vendorId: string,
  query: ListAvailabilityQuery
): Promise<PaginatedResult<MealAvailability>> {
  const where: Prisma.MealScheduleWhereInput = {
    // Scoping through the kitchen is what keeps this to the caller's vendor.
    kitchen: { vendorId },
    ...(query.mealId ? { mealId: query.mealId } : {}),
    ...(query.kitchenId ? { kitchenId: query.kitchenId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.from || query.to
      ? {
          serviceDate: {
            ...(query.from ? { gte: toServiceDate(query.from) } : {}),
            ...(query.to ? { lte: toServiceDate(query.to) } : {}),
          },
        }
      : {}),
  };

  const { skip, take } = toSkipTake(query);
  const [rows, total] = await prisma.$transaction([
    prisma.mealSchedule.findMany({
      where,
      select: scheduleSelect,
      orderBy: [{ serviceDate: 'asc' }, { timeSlot: { startMinute: 'asc' } }],
      skip,
      take,
    }),
    prisma.mealSchedule.count({ where }),
  ]);

  return buildPaginatedResult(rows.map(toAvailability), total, query);
}

export interface PublishResult {
  created: number;
  updated: number;
  /** Combinations that were not published, with the reason. */
  skipped: { serviceDate: string; timeSlotId: string; reason: string }[];
}

/**
 * Publishes a meal across a set of dates and slots.
 *
 * One row per date × slot. Re-publishing an existing combination updates its
 * price and quantity rather than failing, because "set availability for next
 * week" is something a vendor does repeatedly as plans change.
 *
 * Quantity is never reduced below what is already sold: a vendor correcting
 * 50 down to 10 after 30 orders would otherwise silently oversell.
 */
export async function publishAvailability(
  vendorId: string,
  input: PublishAvailabilityInput
): Promise<PublishResult> {
  const meal = await prisma.meal.findFirst({
    where: { id: input.mealId, vendorId, deletedAt: null },
    select: {
      id: true,
      name: true,
      basePrice: true,
      isActive: true,
      mealPeriods: true,
      maxDailyQuantity: true,
    },
  });
  if (!meal) throw notFound('Meal');

  if (!meal.isActive) {
    throw badRequest('This dish is inactive. Activate it before publishing.', {
      mealId: ['Dish is inactive'],
    });
  }

  const kitchen = await prisma.kitchen.findFirst({
    where: { id: input.kitchenId, vendorId, deletedAt: null },
    select: { id: true, isActive: true, capacityPerSlot: true },
  });
  if (!kitchen) throw notFound('Kitchen');
  if (!kitchen.isActive) {
    throw badRequest('This kitchen is not active.', { kitchenId: ['Kitchen is inactive'] });
  }

  const timeSlots = await prisma.timeSlot.findMany({
    where: { id: { in: input.timeSlotIds }, isActive: true },
    select: { id: true, label: true, mealPeriod: true },
  });
  if (timeSlots.length !== input.timeSlotIds.length) {
    throw badRequest('One or more delivery times are no longer available', {
      timeSlotIds: ['Unknown or inactive delivery time'],
    });
  }

  // The meal's own cap wins over whatever was asked for.
  const cap = meal.maxDailyQuantity ?? kitchen.capacityPerSlot;
  if (input.quantity > cap) {
    throw badRequest(
      `That is more than the limit for this dish (${cap}). Raise the dish's maximum daily quantity first.`,
      { quantity: [`At most ${cap}`] }
    );
  }

  const price = input.price ?? toMoney(meal.basePrice);
  const status = input.publish ? MealScheduleStatus.PUBLISHED : MealScheduleStatus.DRAFT;
  const result: PublishResult = { created: 0, updated: 0, skipped: [] };

  for (const dateIso of input.serviceDates) {
    const serviceDate = toServiceDate(dateIso);

    for (const slot of timeSlots) {
      // A dish declared lunch-only should not quietly appear at breakfast.
      if (meal.mealPeriods.length > 0 && !meal.mealPeriods.includes(slot.mealPeriod)) {
        result.skipped.push({
          serviceDate: dateIso,
          timeSlotId: slot.id,
          reason: `${meal.name} is not offered at ${slot.mealPeriod.toLowerCase()}`,
        });
        continue;
      }

      const existing = await prisma.mealSchedule.findUnique({
        where: {
          mealId_kitchenId_serviceDate_timeSlotId: {
            mealId: meal.id,
            kitchenId: kitchen.id,
            serviceDate,
            timeSlotId: slot.id,
          },
        },
        select: { id: true, reservedQuantity: true },
      });

      if (existing) {
        if (input.quantity < existing.reservedQuantity) {
          result.skipped.push({
            serviceDate: dateIso,
            timeSlotId: slot.id,
            reason: `${existing.reservedQuantity} already sold — cannot reduce below that`,
          });
          continue;
        }
        await prisma.mealSchedule.update({
          where: { id: existing.id },
          data: { totalQuantity: input.quantity, price, status },
        });
        result.updated += 1;
      } else {
        await prisma.mealSchedule.create({
          data: {
            mealId: meal.id,
            kitchenId: kitchen.id,
            timeSlotId: slot.id,
            serviceDate,
            price,
            totalQuantity: input.quantity,
            status,
          },
        });
        result.created += 1;
      }
    }
  }

  logger.info(
    { vendorId, mealId: meal.id, ...result, skipped: result.skipped.length },
    'Availability published'
  );
  return result;
}

export async function getAvailability(
  vendorId: string,
  scheduleId: string
): Promise<MealAvailability> {
  const row = await prisma.mealSchedule.findFirst({
    where: { id: scheduleId, kitchen: { vendorId } },
    select: scheduleSelect,
  });
  if (!row) throw notFound('Availability');
  return toAvailability(row);
}

export async function updateAvailability(
  vendorId: string,
  scheduleId: string,
  input: UpdateAvailabilityInput
): Promise<MealAvailability> {
  const existing = await prisma.mealSchedule.findFirst({
    where: { id: scheduleId, kitchen: { vendorId } },
    select: { id: true, reservedQuantity: true, status: true },
  });
  if (!existing) throw notFound('Availability');

  if (input.quantity !== undefined && input.quantity < existing.reservedQuantity) {
    throw conflict(
      `${existing.reservedQuantity} ${existing.reservedQuantity === 1 ? 'meal has' : 'meals have'} already been sold. You cannot set the quantity below that.`
    );
  }

  const data: Prisma.MealScheduleUpdateInput = {};
  if (input.quantity !== undefined) data.totalQuantity = input.quantity;
  if (input.price !== undefined) data.price = input.price;
  if (input.status !== undefined) data.status = input.status;

  await prisma.mealSchedule.update({ where: { id: scheduleId }, data });

  logger.info({ vendorId, scheduleId, ...input }, 'Availability updated');
  return getAvailability(vendorId, scheduleId);
}

/**
 * Withdraws a published date.
 *
 * If nothing has sold the row is deleted outright; once there are orders it is
 * cancelled instead, so the sold meals keep a schedule to point at.
 */
export async function withdrawAvailability(vendorId: string, scheduleId: string): Promise<void> {
  const existing = await prisma.mealSchedule.findFirst({
    where: { id: scheduleId, kitchen: { vendorId } },
    select: { id: true, reservedQuantity: true },
  });
  if (!existing) throw notFound('Availability');

  if (existing.reservedQuantity > 0) {
    await prisma.mealSchedule.update({
      where: { id: scheduleId },
      data: { status: MealScheduleStatus.CANCELLED },
    });
    logger.info({ vendorId, scheduleId }, 'Availability cancelled (had orders)');
    return;
  }

  await prisma.mealSchedule.delete({ where: { id: scheduleId } });
  logger.info({ vendorId, scheduleId }, 'Availability withdrawn');
}
