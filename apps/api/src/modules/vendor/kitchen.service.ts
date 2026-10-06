/**
 * Kitchen profile: name, address, contact, operating hours, capacity and the
 * checkpoints the kitchen will deliver to.
 *
 * Every query is scoped by `vendorId`; see `vendor.context.ts`.
 */
import type { Prisma } from '@prisma/client';
import type {
  KitchenDetail,
  UpdateKitchenInput,
  UpdateServiceAreasInput,
} from '@lunch/shared';
import { badRequest, notFound } from '../../core/errors';
import { logger } from '../../core/logger';
import { prisma } from '../../core/prisma';

const kitchenSelect = {
  id: true,
  vendorId: true,
  name: true,
  contactPhone: true,
  capacityPerSlot: true,
  isActive: true,
  city: { select: { id: true, name: true } },
  address: true,
  operatingHours: { orderBy: { dayOfWeek: 'asc' } },
  serviceAreas: {
    where: { isActive: true },
    select: {
      prepLeadMinutes: true,
      travelMinutes: true,
      checkpoint: { select: { id: true, name: true, type: true } },
    },
    orderBy: { checkpoint: { name: 'asc' } },
  },
} satisfies Prisma.KitchenSelect;

type KitchenRow = Prisma.KitchenGetPayload<{ select: typeof kitchenSelect }>;

function toKitchenDetail(row: KitchenRow): KitchenDetail {
  return {
    id: row.id,
    vendorId: row.vendorId,
    name: row.name,
    contactPhone: row.contactPhone,
    capacityPerSlot: row.capacityPerSlot,
    isActive: row.isActive,
    city: row.city ? { id: row.city.id, name: row.city.name } : null,
    address: row.address
      ? {
          id: row.address.id,
          line1: row.address.line1,
          line2: row.address.line2,
          landmark: row.address.landmark,
          area: row.address.area,
          cityName: row.address.cityName,
          state: row.address.state,
          postalCode: row.address.postalCode,
          latitude: row.address.latitude,
          longitude: row.address.longitude,
        }
      : null,
    operatingHours: row.operatingHours.map((h) => ({
      dayOfWeek: h.dayOfWeek,
      opensMinute: h.opensMinute,
      closesMinute: h.closesMinute,
      isClosed: h.isClosed,
    })),
    serviceAreas: row.serviceAreas.map((a) => ({
      checkpointId: a.checkpoint.id,
      checkpointName: a.checkpoint.name,
      checkpointType: a.checkpoint.type,
      prepLeadMinutes: a.prepLeadMinutes,
      travelMinutes: a.travelMinutes,
    })),
  };
}

export async function listKitchens(vendorId: string): Promise<KitchenDetail[]> {
  const rows = await prisma.kitchen.findMany({
    where: { vendorId, deletedAt: null },
    select: kitchenSelect,
    orderBy: { name: 'asc' },
  });
  return rows.map(toKitchenDetail);
}

export async function getKitchen(vendorId: string, kitchenId: string): Promise<KitchenDetail> {
  const row = await prisma.kitchen.findFirst({
    where: { id: kitchenId, vendorId, deletedAt: null },
    select: kitchenSelect,
  });
  if (!row) throw notFound('Kitchen');
  return toKitchenDetail(row);
}

/**
 * Updates the kitchen.
 *
 * Operating hours are replaced wholesale when present: a partial week is
 * ambiguous (is a missing Tuesday "closed" or "unchanged"?), so the client
 * sends the full week or omits the field entirely.
 */
export async function updateKitchen(
  vendorId: string,
  kitchenId: string,
  input: UpdateKitchenInput
): Promise<KitchenDetail> {
  const existing = await prisma.kitchen.findFirst({
    where: { id: kitchenId, vendorId, deletedAt: null },
    select: { id: true, addressId: true },
  });
  if (!existing) throw notFound('Kitchen');

  if (input.operatingHours) {
    const days = input.operatingHours.map((h) => h.dayOfWeek);
    if (new Set(days).size !== days.length) {
      throw badRequest('Each weekday can appear only once', {
        operatingHours: ['Duplicate weekday'],
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    const data: Prisma.KitchenUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.contactPhone !== undefined) data.contactPhone = input.contactPhone;
    if (input.capacityPerSlot !== undefined) data.capacityPerSlot = input.capacityPerSlot;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    if (input.address) {
      const addressData = {
        line1: input.address.line1,
        line2: input.address.line2 ?? null,
        landmark: input.address.landmark ?? null,
        area: input.address.area ?? null,
        cityName: input.address.cityName,
        state: input.address.state,
        postalCode: input.address.postalCode,
        latitude: input.address.latitude ?? null,
        longitude: input.address.longitude ?? null,
      };

      if (existing.addressId) {
        await tx.address.update({ where: { id: existing.addressId }, data: addressData });
      } else {
        const created = await tx.address.create({ data: addressData });
        data.address = { connect: { id: created.id } };
      }

      // Keep the kitchen's own coordinates in step with its address.
      if (input.address.latitude != null) data.latitude = input.address.latitude;
      if (input.address.longitude != null) data.longitude = input.address.longitude;
    }

    if (Object.keys(data).length > 0) {
      await tx.kitchen.update({ where: { id: kitchenId }, data });
    }

    if (input.operatingHours) {
      await tx.kitchenOperatingHour.deleteMany({ where: { kitchenId } });
      if (input.operatingHours.length > 0) {
        await tx.kitchenOperatingHour.createMany({
          data: input.operatingHours.map((h) => ({
            kitchenId,
            dayOfWeek: h.dayOfWeek,
            opensMinute: h.opensMinute,
            closesMinute: h.closesMinute,
            isClosed: h.isClosed,
          })),
        });
      }
    }
  });

  logger.info({ vendorId, kitchenId }, 'Kitchen updated');
  return getKitchen(vendorId, kitchenId);
}

/**
 * Replaces the kitchen's delivery areas.
 *
 * Removal is a deactivation rather than a delete: existing orders reference the
 * service area's checkpoint, and the historical prep/travel estimates stay
 * useful for reconciliation.
 */
export async function updateServiceAreas(
  vendorId: string,
  kitchenId: string,
  input: UpdateServiceAreasInput
): Promise<KitchenDetail> {
  const existing = await prisma.kitchen.findFirst({
    where: { id: kitchenId, vendorId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) throw notFound('Kitchen');

  const checkpointIds = input.checkpoints.map((c) => c.checkpointId);
  if (new Set(checkpointIds).size !== checkpointIds.length) {
    throw badRequest('Each checkpoint can appear only once', {
      checkpoints: ['Duplicate checkpoint'],
    });
  }

  if (checkpointIds.length > 0) {
    const found = await prisma.checkpoint.count({
      where: { id: { in: checkpointIds }, isActive: true },
    });
    if (found !== checkpointIds.length) {
      throw badRequest('One or more checkpoints are no longer available', {
        checkpoints: ['Unknown or inactive checkpoint'],
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    // Everything not in the new set is switched off…
    await tx.kitchenServiceArea.updateMany({
      where: { kitchenId, checkpointId: { notIn: checkpointIds } },
      data: { isActive: false },
    });

    // …and everything in it is created or reactivated with fresh timings.
    for (const area of input.checkpoints) {
      await tx.kitchenServiceArea.upsert({
        where: {
          kitchenId_checkpointId: { kitchenId, checkpointId: area.checkpointId },
        },
        update: {
          isActive: true,
          prepLeadMinutes: area.prepLeadMinutes,
          travelMinutes: area.travelMinutes,
        },
        create: {
          kitchenId,
          checkpointId: area.checkpointId,
          prepLeadMinutes: area.prepLeadMinutes,
          travelMinutes: area.travelMinutes,
        },
      });
    }
  });

  logger.info({ vendorId, kitchenId, count: checkpointIds.length }, 'Kitchen service areas updated');
  return getKitchen(vendorId, kitchenId);
}
