/**
 * Checkpoint management service.
 *
 * Authorization model:
 *   SUPER_ADMIN  — full CRUD across all checkpoints.
 *   INSTITUTION_ADMIN — create and manage checkpoints attached to institutions
 *                       they administer.  The service enforces this by checking
 *                       institution membership before every write; the route
 *                       layer's authorize() call is a first gate, not a
 *                       substitute for the per-record check here.
 *   Authenticated users (any role) — read active checkpoints; search.
 *
 * Every query that narrows by institutionId, cityId, etc. does so in the
 * `where` clause rather than fetching and filtering, so the DB does the work
 * and we never leak rows through a forgotten check.
 */
import type { Prisma } from '@prisma/client';
import type {
  CheckpointDetail,
  CheckpointSummary,
  CreateCheckpointInput,
  DeliveryWindow,
  ListCheckpointsQuery,
  UpdateCheckpointInput,
} from '@lunch/shared';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors';
import { buildPaginatedResult, toSkipTake } from '../../core/http';
import { logger } from '../../core/logger';
import { prisma } from '../../core/prisma';
import type { PaginatedResult } from '@lunch/shared';

// ─── Select shapes ────────────────────────────────────────────────────────────

const checkpointSummarySelect = {
  id: true,
  name: true,
  type: true,
  isActive: true,
  city: { select: { id: true, name: true, state: true } },
  institution: { select: { id: true, name: true, isActive: true } },
  address: { select: { line1: true, area: true, cityName: true, postalCode: true } },
} satisfies Prisma.CheckpointSelect;

const checkpointDetailSelect = {
  id: true,
  name: true,
  type: true,
  latitude: true,
  longitude: true,
  geofenceRadiusM: true,
  instructions: true,
  deliveryCapacity: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  city: { select: { id: true, name: true, state: true } },
  zone: { select: { id: true, name: true } },
  institution: { select: { id: true, name: true, isActive: true } },
  address: {
    select: {
      id: true,
      line1: true,
      line2: true,
      landmark: true,
      area: true,
      cityName: true,
      state: true,
      postalCode: true,
      latitude: true,
      longitude: true,
    },
  },
  timeSlots: {
    select: {
      id: true,
      timeSlotId: true,
      maxOrders: true,
      orderCutoffMinutes: true,
      isActive: true,
      timeSlot: { select: { label: true, mealPeriod: true } },
    },
    orderBy: { timeSlot: { sortOrder: 'asc' as const } },
  },
} satisfies Prisma.CheckpointSelect;

type SummaryRow = Prisma.CheckpointGetPayload<{ select: typeof checkpointSummarySelect }>;
type DetailRow = Prisma.CheckpointGetPayload<{ select: typeof checkpointDetailSelect }>;

// ─── Mappers ──────────────────────────────────────────────────────────────────

function toSummary(row: SummaryRow): CheckpointSummary {
  return {
    id: row.id,
    name: row.name,
    type: row.type as CheckpointSummary['type'],
    institutionName: row.institution?.name ?? null,
    cityName: row.city.name,
    isActive: row.isActive,
    addressLabel: row.address
      ? [row.address.line1, row.address.area, row.address.cityName, row.address.postalCode]
          .filter(Boolean)
          .join(', ')
      : null,
  };
}

function toDetail(row: DetailRow): CheckpointDetail {
  const windows: DeliveryWindow[] = row.timeSlots.map((cts) => ({
    id: cts.id,
    timeSlotId: cts.timeSlotId,
    timeSlotLabel: cts.timeSlot.label,
    mealPeriod: cts.timeSlot.mealPeriod,
    maxOrders: cts.maxOrders,
    orderCutoffMinutes: cts.orderCutoffMinutes,
    isActive: cts.isActive,
  }));

  return {
    id: row.id,
    name: row.name,
    type: row.type as CheckpointDetail['type'],
    city: row.city,
    zone: row.zone,
    institution: row.institution,
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
    latitude: row.latitude,
    longitude: row.longitude,
    geofenceRadiusM: row.geofenceRadiusM,
    instructions: row.instructions,
    deliveryCapacity: row.deliveryCapacity,
    isActive: row.isActive,
    windows,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── Authorization helpers ────────────────────────────────────────────────────

/**
 * Confirms the user is an ADMIN member of the institution.
 *
 * Called before writes by institution admins; SUPER_ADMIN callers skip this
 * check entirely, handled in the route layer.
 */
async function assertInstitutionAdmin(userId: string, institutionId: string): Promise<void> {
  const membership = await prisma.institutionMember.findFirst({
    where: {
      userId,
      institutionId,
      role: 'ADMIN',
      isActive: true,
      institution: { isActive: true },
    },
    select: { id: true },
  });
  if (!membership) {
    throw forbidden('You are not an admin of that institution');
  }
}

/**
 * Returns the set of institution ids the user administers.
 * Used to scope list queries for INSTITUTION_ADMIN callers.
 */
async function adminInstitutionIds(userId: string): Promise<string[]> {
  const memberships = await prisma.institutionMember.findMany({
    where: { userId, role: 'ADMIN', isActive: true, institution: { isActive: true } },
    select: { institutionId: true },
  });
  return memberships.map((m) => m.institutionId);
}

// ─── Public read operations ───────────────────────────────────────────────────

/**
 * Paginated list of checkpoints with optional filters.
 *
 * `callerRole` and `callerUserId` are used to restrict institution admins to
 * checkpoints belonging to their own institutions only.
 */
export async function listCheckpoints(
  query: ListCheckpointsQuery,
  callerRole: string,
  callerUserId: string
): Promise<PaginatedResult<CheckpointSummary>> {
  const { page, pageSize, cityId, institutionId, zoneId, type, isActive, q } = query;

  let where: Prisma.CheckpointWhereInput = {};

  // Non-admins only see active checkpoints; checkpoint admins may manage both.
  if (callerRole !== 'SUPER_ADMIN' && callerRole !== 'INSTITUTION_ADMIN') {
    where.isActive = true;
    where.AND = [{OR: [{ institutionId: null }, { institution: { isActive: true } }]}];
  } else if (isActive !== undefined) {
    where.isActive = isActive;
  }

  if (cityId) where.cityId = cityId;
  if (zoneId) where.zoneId = zoneId;
  if (type) where.type = type;

  // Institution scoping: INSTITUTION_ADMIN can only see their own institutions.
  if (callerRole === 'INSTITUTION_ADMIN') {
    const adminIds = await adminInstitutionIds(callerUserId);
    if (adminIds.length === 0) {
      return buildPaginatedResult([], 0, { page, pageSize });
    }
    where.institutionId = institutionId
      ? adminIds.includes(institutionId)
        ? institutionId
        : undefined // unknown institution → empty result below
      : { in: adminIds };
    if (institutionId && !adminIds.includes(institutionId)) {
      return buildPaginatedResult([], 0, { page, pageSize });
    }
  } else if (institutionId) {
    where.institutionId = institutionId;
  }

  // Free-text search across name and instructions.
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { instructions: { contains: q, mode: 'insensitive' } },
      { institution: { name: { contains: q, mode: 'insensitive' } } },
      {
        address: {
          is: {
            OR: [
              { line1: { contains: q, mode: 'insensitive' } },
              { line2: { contains: q, mode: 'insensitive' } },
              { landmark: { contains: q, mode: 'insensitive' } },
              { area: { contains: q, mode: 'insensitive' } },
              { cityName: { contains: q, mode: 'insensitive' } },
              { postalCode: { contains: q, mode: 'insensitive' } },
            ],
          },
        },
      },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.checkpoint.count({ where }),
    prisma.checkpoint.findMany({
      where,
      select: checkpointSummarySelect,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      ...toSkipTake({ page, pageSize }),
    }),
  ]);

  return buildPaginatedResult(rows.map(toSummary), total, { page, pageSize });
}

/** Full checkpoint detail, visible to any authenticated user (active only for non-admins). */
export async function getCheckpoint(
  checkpointId: string,
  callerRole: string,
  callerUserId: string
): Promise<CheckpointDetail> {
  const where: Prisma.CheckpointWhereUniqueInput = { id: checkpointId };
  const row = await prisma.checkpoint.findUnique({
    where,
    select: checkpointDetailSelect,
  });

  if (!row) throw notFound('Checkpoint');
  if (row.institution && !row.institution.isActive && callerRole !== 'SUPER_ADMIN') throw notFound('Checkpoint');
  if (!row.isActive && callerRole !== 'SUPER_ADMIN') {
    // Inactive checkpoints are private: reads must not reveal their existence
    // through the write guard's 403 response.
    const canRead = callerRole === 'INSTITUTION_ADMIN' && row.institution &&
      (await adminInstitutionIds(callerUserId)).includes(row.institution.id);
    if (!canRead) throw notFound('Checkpoint');
  }

  return toDetail(row);
}

// ─── Write operations ─────────────────────────────────────────────────────────

export async function createCheckpoint(
  input: CreateCheckpointInput,
  callerRole: string,
  callerUserId: string
): Promise<CheckpointDetail> {
  // Validate city exists.
  const city = await prisma.city.findFirst({
    where: { id: input.cityId, isActive: true },
    select: { id: true },
  });
  if (!city) throw badRequest('City not found', { cityId: ['City not found or inactive'] });

  // Validate zone belongs to city if given.
  if (input.zoneId) {
    const zone = await prisma.zone.findFirst({
      where: { id: input.zoneId, cityId: input.cityId },
      select: { id: true },
    });
    if (!zone)
      throw badRequest('Zone not found in that city', { zoneId: ['Zone not found in that city'] });
  }

  // Institution admins must be admins of the institution they're attaching.
  if (callerRole === 'INSTITUTION_ADMIN') {
    if (!input.institutionId) {
      throw badRequest('Institution is required for institution admins', {
        institutionId: ['Select your institution'],
      });
    }
    await assertInstitutionAdmin(callerUserId, input.institutionId);
  }

  // Validate institution exists if provided.
  if (input.institutionId) {
    const inst = await prisma.institution.findFirst({
      where: { id: input.institutionId, isActive: true, cityId: input.cityId },
      select: { id: true },
    });
    if (!inst)
      throw badRequest('Institution not found', {
        institutionId: ['Institution not found or inactive'],
      });
  }

  // Validate that all provided time-slot ids exist.
  if (input.windows && input.windows.length > 0) {
    const tsIds = input.windows.map((w) => w.timeSlotId);
    const found = await prisma.timeSlot.count({
      where: { id: { in: tsIds }, isActive: true, AND: [{OR:[{cityId:null},{cityId:input.cityId}]},{OR:[{institutionId:null},...(input.institutionId?[{institutionId:input.institutionId}]:[])]}] },
    });
    if (found !== tsIds.length) {
      throw badRequest('One or more delivery windows reference invalid time slots', {
        windows: ['Some time slots were not found'],
      });
    }
  }

  // Build nested address create if supplied.
  const addressCreate: Prisma.AddressCreateWithoutCheckpointsInput | undefined = input.address
    ? {
        line1: input.address.line1,
        line2: input.address.line2 ?? null,
        landmark: input.address.landmark ?? null,
        area: input.address.area ?? null,
        cityName: input.address.cityName,
        state: input.address.state,
        postalCode: input.address.postalCode,
        // Address-level coordinates mirror top-level if provided.
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
      }
    : undefined;

  // A nested create addresses the slot through its relation, not a raw
  // scalar id — the unchecked (scalar) form is only available when the parent
  // is not itself being created in the same statement.
  const windowData: Prisma.CheckpointTimeSlotCreateWithoutCheckpointInput[] =
    input.windows?.map((w) => ({
      timeSlot: { connect: { id: w.timeSlotId } },
      maxOrders: w.maxOrders ?? null,
      orderCutoffMinutes: w.orderCutoffMinutes ?? null,
      isActive: w.isActive,
    })) ?? [];

  const row = await prisma.$transaction(async tx => {
  const created = await tx.checkpoint.create({
    data: {
      name: input.name,
      type: input.type,
      city: { connect: { id: input.cityId } },
      ...(input.zoneId ? { zone: { connect: { id: input.zoneId } } } : {}),
      ...(input.institutionId ? { institution: { connect: { id: input.institutionId } } } : {}),
      ...(addressCreate ? { address: { create: addressCreate } } : {}),
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      geofenceRadiusM: input.geofenceRadiusM ?? 150,
      instructions: input.instructions ?? null,
      deliveryCapacity: input.deliveryCapacity ?? null,
      isActive: input.isActive ?? true,
      ...(windowData.length > 0
        ? { timeSlots: { create: windowData } }
        : {}),
    },
    select: checkpointDetailSelect,
  });

  await tx.auditLog.create({data:{actorUserId:callerUserId,action:'checkpoint.created',entityType:'Checkpoint',entityId:created.id,after:{name:created.name,institutionId:input.institutionId??null}}});
  return created;
  });

  logger.info({ checkpointId: row.id, callerUserId }, 'Checkpoint created');
  return toDetail(row);
}

export async function updateCheckpoint(
  checkpointId: string,
  input: UpdateCheckpointInput,
  callerRole: string,
  callerUserId: string
): Promise<CheckpointDetail> {
  return prisma.$transaction(async tx => {
  await tx.$queryRaw`SELECT id FROM checkpoints WHERE id=${checkpointId} FOR UPDATE`;
  const existing = await tx.checkpoint.findUnique({
    where: { id: checkpointId },
    select: { id: true, institutionId: true, addressId: true, cityId: true, zoneId: true, latitude: true, longitude: true },
  });
  if (!existing) throw notFound('Checkpoint');
  if (callerRole === 'INSTITUTION_ADMIN' && input.institutionId !== undefined && input.institutionId !== existing.institutionId) throw forbidden('Institution checkpoints cannot be transferred or detached');
  const targetInstitutionId = input.institutionId !== undefined ? input.institutionId : existing.institutionId;
  if (targetInstitutionId && !await tx.institution.count({ where: { id: targetInstitutionId, cityId: input.cityId ?? existing.cityId, isActive: true } })) throw badRequest('Institution must be active and in the checkpoint city');
  if ((input.cityId && input.cityId !== existing.cityId || input.institutionId !== undefined && input.institutionId !== existing.institutionId) && await tx.orderItem.count({where:{checkpointId}})) throw conflict('A checkpoint with order history cannot be transferred');

  // Institution admins may only edit checkpoints under their institution.
  if (callerRole === 'INSTITUTION_ADMIN') {
    if (!existing.institutionId) throw forbidden('You can only edit checkpoints in your institution');
    await assertInstitutionAdmin(callerUserId, existing.institutionId);
    // If switching institution, must also be admin of the new one.
    if (input.institutionId && input.institutionId !== existing.institutionId) {
      await assertInstitutionAdmin(callerUserId, input.institutionId);
    }
  }

  if (input.cityId) {
    const city = await tx.city.findFirst({
      where: { id: input.cityId, isActive: true },
      select: { id: true },
    });
    if (!city) throw badRequest('City not found', { cityId: ['City not found or inactive'] });
  }

  if (input.institutionId && callerRole === 'INSTITUTION_ADMIN') {
    await assertInstitutionAdmin(callerUserId, input.institutionId);
  }

  const targetCityId = input.cityId ?? existing.cityId;
  const targetZoneId = input.zoneId !== undefined ? input.zoneId : existing.zoneId;
  if (targetZoneId && (input.zoneId !== undefined || input.cityId !== undefined)) {
    const zone = await tx.zone.findFirst({
      where: { id: targetZoneId, cityId: targetCityId },
      select: { id: true },
    });
    if (!zone) {
      throw badRequest('Zone not found in that city', { zoneId: ['Zone not found in that city'] });
    }
  }

  const data: Prisma.CheckpointUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.type !== undefined) data.type = input.type;
  if (input.cityId !== undefined) data.city = { connect: { id: input.cityId } };
  if (input.zoneId !== undefined) {
    data.zone = input.zoneId ? { connect: { id: input.zoneId } } : { disconnect: true };
  }
  if (input.institutionId !== undefined) {
    data.institution = input.institutionId
      ? { connect: { id: input.institutionId } }
      : { disconnect: true };
  }
  if (input.latitude !== undefined) data.latitude = input.latitude;
  if (input.longitude !== undefined) data.longitude = input.longitude;
  if (input.geofenceRadiusM !== undefined) data.geofenceRadiusM = input.geofenceRadiusM;
  if (input.instructions !== undefined) data.instructions = input.instructions;
  if (input.deliveryCapacity !== undefined) data.deliveryCapacity = input.deliveryCapacity;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.address !== undefined) {
    if (input.address === null) {
      if (existing.addressId) data.address = { disconnect: true };
    } else {
      const addressData = {
        line1: input.address.line1,
        line2: input.address.line2 ?? null,
        landmark: input.address.landmark ?? null,
        area: input.address.area ?? null,
        cityName: input.address.cityName,
        state: input.address.state,
        postalCode: input.address.postalCode,
        latitude: input.latitude !== undefined ? input.latitude : existing.latitude,
        longitude: input.longitude !== undefined ? input.longitude : existing.longitude,
      };
      data.address = existing.addressId
        ? { update: addressData }
        : { create: addressData };
    }
  } else if (existing.addressId && (input.latitude !== undefined || input.longitude !== undefined)) {
    data.address = {
      update: {
        ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
        ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
      },
    };
  }

  const row = await tx.checkpoint.update({
    where: { id: checkpointId },
    data,
    select: checkpointDetailSelect,
  });

  await tx.auditLog.create({data:{actorUserId:callerUserId,action:'checkpoint.updated',entityType:'Checkpoint',entityId:checkpointId,after:JSON.parse(JSON.stringify(input))}});
  // Handle window updates if provided.
  if (input.windows !== undefined) {
    await syncWindows(checkpointId, input.windows, tx);
    const updated = await tx.checkpoint.findUnique({
      where: { id: checkpointId },
      select: checkpointDetailSelect,
    });
    logger.info({ checkpointId, callerUserId }, 'Checkpoint updated');
    return toDetail(updated!);
  }

  logger.info({ checkpointId, callerUserId }, 'Checkpoint updated');
  return toDetail(row);
  });
}

/**
 * Syncs the allowed delivery windows for a checkpoint.
 *
 * New entries are created; existing ones are updated in place; slots no longer
 * in the list are deactivated (not deleted) so historical order data retains
 * its slot reference.
 */
async function syncWindows(
  checkpointId: string,
  windows: NonNullable<UpdateCheckpointInput['windows']>,
  db: Prisma.TransactionClient
): Promise<void> {
  const checkpoint=await db.checkpoint.findUniqueOrThrow({where:{id:checkpointId}});
  const slotIds = windows.map((window) => window.timeSlotId);
  const activeSlotCount = await db.timeSlot.count({
    where: { id: { in: slotIds }, isActive: true, AND: [{OR:[{cityId:null},{cityId:checkpoint.cityId}]},{OR:[{institutionId:null},...(checkpoint.institutionId?[{institutionId:checkpoint.institutionId}]:[])]}] },
  });
  if (activeSlotCount !== slotIds.length) {
    throw badRequest('One or more delivery windows reference invalid time slots', {
      windows: ['Some time slots were not found or are duplicated'],
    });
  }

  const existing = await db.checkpointTimeSlot.findMany({
    where: { checkpointId },
    select: { id: true, timeSlotId: true },
  });
  const existingBySlot = new Map(existing.map((e) => [e.timeSlotId, e.id]));
  const incomingSlotIds = new Set(windows.map((w) => w.timeSlotId));

  // Deactivate removed slots.
  const toDeactivate = existing
    .filter((e) => !incomingSlotIds.has(e.timeSlotId))
    .map((e) => e.id);
  if (toDeactivate.length > 0) {
    await db.checkpointTimeSlot.updateMany({
      where: { id: { in: toDeactivate } },
      data: { isActive: false },
    });
  }

  // Upsert each incoming window.
  for (const w of windows) {
    const existingId = existingBySlot.get(w.timeSlotId);
    if (existingId) {
      await db.checkpointTimeSlot.update({
        where: { id: existingId },
        data: {
          maxOrders: w.maxOrders ?? null,
          orderCutoffMinutes: w.orderCutoffMinutes ?? null,
          isActive: w.isActive,
        },
      });
    } else {
      await db.checkpointTimeSlot.create({
        data: {
          checkpointId,
          timeSlotId: w.timeSlotId,
          maxOrders: w.maxOrders ?? null,
          orderCutoffMinutes: w.orderCutoffMinutes ?? null,
          isActive: w.isActive,
        },
      });
    }
  }
}

/** Toggle a checkpoint active/inactive (soft activation, not delete). */
export async function setCheckpointStatus(
  checkpointId: string,
  isActive: boolean,
  callerRole: string,
  callerUserId: string
): Promise<CheckpointDetail> {
  return updateCheckpoint(checkpointId, { isActive }, callerRole, callerUserId);
}

/**
 * Saves a checkpoint as the caller's default.
 *
 * When `childId` is supplied the checkpoint is saved as the child's default;
 * the service verifies the child belongs to the caller.
 */
export async function saveDefaultCheckpoint(
  userId: string,
  checkpointId: string,
  childId?: string
): Promise<void> {
  // Confirm the checkpoint is active.
  const checkpoint = await prisma.checkpoint.findFirst({
    where: { id: checkpointId, isActive: true, OR: [{ institutionId: null }, { institution: { isActive: true } }] },
    select: { id: true },
  });
  if (!checkpoint) throw notFound('Checkpoint');

  if (childId) {
    // Verify ownership before writing.
    const child = await prisma.child.findFirst({
      where: { id: childId, parentId: userId, deletedAt: null },
      select: { id: true },
    });
    if (!child) throw notFound('Child');

    await prisma.child.update({
      where: { id: childId },
      data: { defaultCheckpointId: checkpointId },
    });
    logger.info({ userId, childId, checkpointId }, 'Default checkpoint set for child');
  } else {
    await prisma.userProfile.upsert({
      where: { userId },
      update: { defaultCheckpointId: checkpointId },
      create: { userId, defaultCheckpointId: checkpointId },
    });
    logger.info({ userId, checkpointId }, 'Default checkpoint set for user');
  }
}

/** Clears the default checkpoint for the user or one of their children. */
export async function clearDefaultCheckpoint(userId: string, childId?: string): Promise<void> {
  if (childId) {
    const child = await prisma.child.findFirst({
      where: { id: childId, parentId: userId, deletedAt: null },
      select: { id: true },
    });
    if (!child) throw notFound('Child');
    await prisma.child.update({
      where: { id: childId },
      data: { defaultCheckpointId: null },
    });
  } else {
    await prisma.userProfile.upsert({
      where: { userId },
      update: { defaultCheckpointId: null },
      create: { userId },
    });
  }
}
