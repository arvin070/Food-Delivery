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
  CheckpointScheduleExceptionInput,
  CreateCheckpointInput,
  DeliveryWindow,
  ListCheckpointsQuery,
  UpdateCheckpointInput,
} from '@lunch/shared';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors';
import { buildPaginatedResult, toSkipTake } from '../../core/http';
import { logger } from '../../core/logger';
import { prisma } from '../../core/prisma';
import { enqueueNotifications } from '../notifications/notification.service';
import { cityToday, dateKey, slotInstant } from '../subscriptions/recurrence';
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
      weekdays: true,
      preparationBufferMinutes: true,
      travelBufferMinutes: true,
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
    weekdays: cts.weekdays,
    preparationBufferMinutes: cts.preparationBufferMinutes,
    travelBufferMinutes: cts.travelBufferMinutes,
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

export async function createScheduleException(checkpointId: string, input: CheckpointScheduleExceptionInput, callerRole: string, callerUserId: string) {
  const startDate = new Date(`${input.startDate}T00:00:00.000Z`);
  const endDate = new Date(`${input.endDate}T00:00:00.000Z`);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM checkpoints WHERE id=${checkpointId} FOR UPDATE`;
    const checkpoint = await tx.checkpoint.findUnique({ where: { id: checkpointId }, select: { id: true, cityId: true, institutionId: true, city: { select: { timezone: true } } } });
    if (!checkpoint) throw notFound('Checkpoint');
    if (callerRole === 'INSTITUTION_ADMIN') {
      if (!checkpoint.institutionId) throw forbidden('You can only manage checkpoints in your institution');
      const membership = await tx.institutionMember.count({ where: { userId: callerUserId, institutionId: checkpoint.institutionId, role: 'ADMIN', isActive: true, institution: { isActive: true } } });
      if (!membership) throw forbidden('You are not an admin of that institution');
    } else if (callerRole !== 'SUPER_ADMIN') throw forbidden('Checkpoint operations access required');
    if (startDate < cityToday(checkpoint.city.timezone)) throw badRequest('Schedule exceptions must start today or later');
    if (input.replacementCheckpointId && !input.timeSlotId) throw badRequest('Choose a specific delivery window for reassignment');
    if (input.timeSlotId && !await tx.checkpointTimeSlot.count({ where: { checkpointId, timeSlotId: input.timeSlotId, isActive: true } })) throw badRequest('The selected window is not active at this checkpoint');
    if (await tx.checkpointScheduleException.count({ where: {
      checkpointId, startDate: { lte: endDate }, endDate: { gte: startDate },
      ...(input.timeSlotId ? { OR: [{ timeSlotId: null }, { timeSlotId: input.timeSlotId }] } : {}),
    } })) throw conflict('An overlapping checkpoint exception already exists');

    const bookings = await tx.orderItem.findMany({
      where: { checkpointId, serviceDate: { gte: startDate, lte: endDate }, ...(input.timeSlotId ? { timeSlotId: input.timeSlotId } : {}), status: { notIn: ['CANCELLED', 'FAILED', 'DELIVERED'] } },
      select: {
        id: true,
        serviceDate: true,
        timeSlotId: true,
        quantity: true,
        kitchenId: true,
        status: true,
        delivery: { select: { id: true, deliveryStop: { select: { deliveryRun: { select: { status: true, startedAt: true } } } } } },
        order: { select: { customerId: true } },
        child: { select: { parentId: true, isActive: true } },
        mealNameSnapshot: true,
        beneficiaryName: true,
      },
      take: 501,
    });
    if (bookings.length > 500) throw conflict('More than 500 bookings are affected; contact platform operations');
    if (bookings.some(item => item.delivery?.deliveryStop?.deliveryRun?.startedAt || item.delivery?.deliveryStop?.deliveryRun?.status === 'IN_PROGRESS')) throw conflict('A rider route has started for an affected delivery');

    let replacementName: string | null = null;
    if (input.replacementCheckpointId) {
      const replacement = await tx.checkpoint.findFirst({ where: { id: input.replacementCheckpointId, cityId: checkpoint.cityId, isActive: true, OR: [{ institutionId: null }, { institution: { isActive: true } }] }, select: { id: true, name: true, deliveryCapacity: true } });
      if (!replacement || !input.timeSlotId) throw badRequest('Replacement checkpoint must be active in the same city');
      const replacementWindow = await tx.checkpointTimeSlot.findFirst({ where: { checkpointId: replacement.id, timeSlotId: input.timeSlotId, isActive: true }, select: { maxOrders: true, weekdays: true } });
      if (!replacementWindow) throw badRequest('Replacement checkpoint does not serve this delivery window');
      replacementName = replacement.name;
      for (const booking of bookings) {
        const localDay = booking.serviceDate.getUTCDay() === 0 ? 7 : booking.serviceDate.getUTCDay();
        if (!replacementWindow.weekdays.includes(localDay)) throw conflict('Replacement checkpoint is not scheduled on every affected day');
        const [holiday, closure] = await Promise.all([
          tx.serviceHoliday.count({ where: { serviceDate: booking.serviceDate, OR: [{ cityId: null }, { cityId: checkpoint.cityId }] } }),
          tx.checkpointScheduleException.count({ where: { checkpointId: replacement.id, startDate: { lte: booking.serviceDate }, endDate: { gte: booking.serviceDate }, OR: [{ timeSlotId: null }, { timeSlotId: input.timeSlotId }] } }),
        ]);
        if (holiday || closure) throw conflict('Replacement checkpoint is unavailable on an affected date');
        if (!await tx.kitchenServiceArea.count({ where: { kitchenId: booking.kitchenId, checkpointId: replacement.id, isActive: true } })) throw conflict('A booked kitchen does not serve the replacement checkpoint');
        if (booking.delivery) throw conflict('An assigned delivery must be rerouted before checkpoint reassignment');
      }
      const limits = [replacementWindow.maxOrders, replacement.deliveryCapacity].filter((value): value is number => value !== null);
      if (limits.length) {
        const max = Math.min(...limits);
        for (const booking of bookings) {
          const existing = await tx.orderItem.aggregate({ where: { checkpointId: replacement.id, serviceDate: booking.serviceDate, timeSlotId: booking.timeSlotId, status: { notIn: ['CANCELLED', 'FAILED'] } }, _sum: { quantity: true } });
          const moved = bookings.filter(other => other.serviceDate.getTime() === booking.serviceDate.getTime() && other.timeSlotId === booking.timeSlotId).reduce((total, other) => total + other.quantity, 0);
          if ((existing._sum.quantity ?? 0) + moved > max) throw conflict('Replacement checkpoint lacks capacity for the affected deliveries');
        }
      }
    } else if (bookings.length) {
      throw conflict('Resolve existing bookings before closing this checkpoint window');
    }

    const row = await tx.checkpointScheduleException.create({ data: {
      checkpointId, timeSlotId: input.timeSlotId ?? null, replacementCheckpointId: input.replacementCheckpointId ?? null,
      startDate, endDate, reason: input.reason, createdByUserId: callerUserId,
    }, include: { replacementCheckpoint: { select: { name: true } } } });
    if (input.replacementCheckpointId) {
      for (const booking of bookings) await tx.orderItem.update({ where: { id: booking.id }, data: { checkpointId: input.replacementCheckpointId } });
      await enqueueNotifications(tx, bookings.flatMap(item => {
        const recipients = new Set([item.order.customerId]);
        if (item.child?.isActive) recipients.add(item.child.parentId);
        return [...recipients].map(userId => ({ userId, event: 'checkpoint.changed' as const, key: `checkpoint-exception:${row.id}:item:${item.id}`, data: { beneficiary: item.beneficiaryName, meal: item.mealNameSnapshot, checkpoint: replacementName! } }));
      }));
    }
    const subscriptions = await tx.subscription.findMany({ where: { checkpointId, status: 'ACTIVE', startDate: { lte: endDate }, OR: [{ endDate: null }, { endDate: { gte: startDate } }] }, select: { id: true, userId: true, child: { select: { parentId: true, isActive: true, deletedAt: true } } }, take: 1000 });
    await enqueueNotifications(tx, subscriptions.flatMap(subscription => {
      const recipients = new Set([subscription.userId]);
      if (subscription.child?.isActive && !subscription.child.deletedAt) recipients.add(subscription.child.parentId);
      const change = replacementName ? `This checkpoint is temporarily reassigned to ${replacementName}` : 'This checkpoint is temporarily unavailable';
      return [...recipients].map(userId => ({ userId, event: 'checkpoint.changed' as const, key: `checkpoint-exception:${row.id}:subscription:${subscription.id}:user:${userId}`, data: { checkpoint: replacementName ?? checkpointId, reason: `${change} ${input.startDate} through ${input.endDate}. ${input.reason}.` } }));
    }));
    await tx.auditLog.create({ data: { actorUserId: callerUserId, action: input.replacementCheckpointId ? 'checkpoint.reassigned' : 'checkpoint.closed', entityType: 'CheckpointScheduleException', entityId: row.id, after: { checkpointId, startDate: input.startDate, endDate: input.endDate, timeSlotId: input.timeSlotId ?? null, replacementCheckpointId: input.replacementCheckpointId ?? null, reason: input.reason } } });
    return { id: row.id, startDate: input.startDate, endDate: input.endDate, timeSlotId: row.timeSlotId, replacementCheckpointId: row.replacementCheckpointId, replacementCheckpointName: row.replacementCheckpoint?.name ?? null, reason: row.reason };
  });
}

export async function operationsDashboard(callerRole: string, callerUserId: string) {
  let where: Prisma.CheckpointWhereInput = {};
  if (callerRole === 'INSTITUTION_ADMIN') where.institutionId = { in: await adminInstitutionIds(callerUserId) };
  else if (callerRole !== 'SUPER_ADMIN') throw forbidden('Checkpoint operations access required');
  const checkpoints = await prisma.checkpoint.findMany({ where, take: 500, orderBy: { name: 'asc' }, select: {
    id: true, name: true, type: true, isActive: true, deliveryCapacity: true, city: { select: { timezone: true } },
    timeSlots: { where: { isActive: true }, select: { timeSlotId: true, maxOrders: true, weekdays: true, timeSlot: { select: { label: true, startMinute: true, endMinute: true } } } },
  } });
  const todayItems = await prisma.orderItem.findMany({ where: { serviceDate: { gte: new Date(Date.now() - 86400000), lte: new Date(Date.now() + 86400000) }, checkpointId: { in: checkpoints.map(c => c.id) }, status: { notIn: ['CANCELLED', 'FAILED'] } }, select: {
    id: true, checkpointId: true, serviceDate: true, timeSlotId: true, quantity: true, status: true, timeSlot: { select: { label: true, startMinute: true } },
    delivery: { select: { status: true, deliveryPartner: { select: { user: { select: { fullName: true } } } } } }, checkpoint: { select: { city: { select: { timezone: true } } } },
  } });
  const exceptions = await prisma.checkpointScheduleException.findMany({ where: { checkpointId: { in: checkpoints.map(c => c.id) }, endDate: { gte: new Date(Date.now() - 86400000) } }, include: { replacementCheckpoint: { select: { name: true } } }, orderBy: { startDate: 'asc' }, take: 200 });
  return {
    generatedAt: new Date().toISOString(),
    checkpoints: checkpoints.map(checkpoint => {
      const localToday = dateKey(cityToday(checkpoint.city.timezone));
      const items = todayItems.filter(item => item.checkpointId === checkpoint.id && item.serviceDate.toISOString().slice(0, 10) === localToday);
      const totalMeals = items.reduce((sum, item) => sum + item.quantity, 0);
      const windows = checkpoint.timeSlots.map(window => {
        const bookings = items.filter(item => item.timeSlotId === window.timeSlotId);
        const limitValues = [window.maxOrders, checkpoint.deliveryCapacity].filter((value): value is number => value !== null);
        return { label: window.timeSlot.label, startMinute: window.timeSlot.startMinute, meals: bookings.reduce((sum, item) => sum + item.quantity, 0), capacity: limitValues.length ? Math.min(...limitValues) : null, delayed: bookings.filter(item => ['OUT_FOR_DELIVERY', 'AT_CHECKPOINT'].includes(item.status) && slotInstant(item.serviceDate, window.timeSlot.endMinute, checkpoint.city.timezone).getTime() < Date.now()).length, riders: [...new Set(bookings.map(item => item.delivery?.deliveryPartner?.user.fullName).filter((name): name is string => !!name))] };
      });
      return { id: checkpoint.id, name: checkpoint.name, type: checkpoint.type, active: checkpoint.isActive, meals: totalMeals, capacity: checkpoint.deliveryCapacity, windows, unavailable: exceptions.filter(exception => exception.checkpointId === checkpoint.id).map(exception => ({ startDate: dateKey(exception.startDate), endDate: dateKey(exception.endDate), timeSlotId: exception.timeSlotId, reason: exception.reason, replacementCheckpointName: exception.replacementCheckpoint?.name ?? null })) };
    }),
  };
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
      weekdays: w.weekdays,
      preparationBufferMinutes: w.preparationBufferMinutes,
      travelBufferMinutes: w.travelBufferMinutes,
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
          weekdays: w.weekdays,
          preparationBufferMinutes: w.preparationBufferMinutes,
          travelBufferMinutes: w.travelBufferMinutes,
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
          weekdays: w.weekdays,
          preparationBufferMinutes: w.preparationBufferMinutes,
          travelBufferMinutes: w.travelBufferMinutes,
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
