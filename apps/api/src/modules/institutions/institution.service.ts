import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  createInstitutionSchema,
  updateInstitutionSchema,
  institutionWindowSchema,
  bulkMealRequestSchema,
  institutionQuerySchema,
} from '@lunch/shared';
import { prisma } from '../../core/prisma';
import { badRequest, conflict, notFound } from '../../core/errors';
import { cityToday, dateKey } from '../subscriptions/recurrence';
type Actor = { userId: string; role: string };
type Query = z.infer<typeof institutionQuerySchema>;
const summary = {
  id: true,
  name: true,
  type: true,
  cityId: true,
  isActive: true,
  registrationOpen: true,
  city: { select: { name: true, timezone: true } },
} satisfies Prisma.InstitutionSelect;
const detail = {
  ...summary,
  contactName: true,
  contactEmail: true,
  contactPhone: true,
  deliveryNotes: true,
  revision: true,
  isBilledCentrally: true,
} satisfies Prisma.InstitutionSelect;
function scope(actor: Actor): Prisma.InstitutionWhereInput {
  return actor.role === 'SUPER_ADMIN'
    ? {}
    : {
        isActive: true,
        members: {
          some: { userId: actor.userId, role: 'ADMIN', isActive: true },
        },
      };
}
export async function requireInstitution(
  actor: Actor,
  id: string,
  db: Prisma.TransactionClient = prisma,
) {
  const institution = await db.institution.findFirst({
    where: { id, ...scope(actor) },
    select: detail,
  });
  if (!institution) throw notFound('Institution');
  return institution;
}
export async function list(actor: Actor, q: Query) {
  const where = {
    ...scope(actor),
    ...(q.search
      ? { name: { contains: q.search, mode: 'insensitive' as const } }
      : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.institution.findMany({
      where,
      select: summary,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 25,
      skip: (q.page - 1) * 25,
    }),
    prisma.institution.count({ where }),
  ]);
  return { items, total, page: q.page, pageSize: 25 };
}
export async function create(
  actor: Actor,
  input: z.infer<typeof createInstitutionSchema>,
) {
  return prisma.$transaction(async (tx) => {
    if (!(await tx.city.count({ where: { id: input.cityId, isActive: true } })))
      throw badRequest('Choose an active city');
    if (
      !(await tx.user.count({
        where: {
          id: input.adminUserId,
          role: 'INSTITUTION_ADMIN',
          status: 'ACTIVE',
          deletedAt: null,
        },
      }))
    )
      throw badRequest('Choose an active institution administrator account');
    const { adminUserId, ...data } = input;
    const record = await tx.institution.create({
      data: {
        ...data,
        type: data.type as Prisma.InstitutionCreateInput['type'],
        members: { create: { userId: adminUserId, role: 'ADMIN' } },
      },
      select: detail,
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: 'institution.created',
        entityType: 'Institution',
        entityId: record.id,
        after: { name: record.name, adminUserId },
      },
    });
    return record;
  });
}
export async function update(
  actor: Actor,
  id: string,
  input: z.infer<typeof updateInstitutionSchema>,
) {
  return prisma.$transaction(async (tx) => {
    const before = await requireInstitution(actor, id, tx);
    const { revision, ...data } = input;
    const result = await tx.institution.updateMany({
      where: { id, revision },
      data: {
        ...data,
        type: data.type as Prisma.InstitutionCreateInput['type'],
        revision: { increment: 1 },
      },
    });
    if (!result.count)
      throw conflict('Institution changed. Refresh before saving.');
    await tx.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: 'institution.updated',
        entityType: 'Institution',
        entityId: id,
        before: {
          name: before.name,
          revision: before.revision,
          registrationOpen: before.registrationOpen,
        },
        after: { ...data, revision: revision + 1 },
      },
    });
    return requireInstitution(actor, id, tx);
  });
}
export async function registrations(actor: Actor, id: string, q: Query) {
  await requireInstitution(actor, id);
  // Only registration identity, never parent contacts, addresses or child medical data.
  const search = q.search
    ? '%' + q.search.replace(/[\\%_]/g, '\\$&') + '%'
    : '%';
  const rows = Prisma.sql`SELECT m.id,u."fullName" name,'MEMBER' kind,m.identifier,u.role::text role,m."isActive" FROM institution_members m JOIN users u ON u.id=m."userId" WHERE m."institutionId"=${id} AND u."deletedAt" IS NULL UNION ALL SELECT c.id,c."fullName" name,'CHILD' kind,c."rollNumber" identifier,'CHILD' role,c."isActive" FROM children c WHERE c."institutionId"=${id} AND c."deletedAt" IS NULL`;
  const [items, count] = await prisma.$transaction(
    [
      prisma.$queryRaw(
        Prisma.sql`WITH registrations AS (${rows}) SELECT * FROM registrations WHERE name ILIKE ${search} OR identifier ILIKE ${search} ORDER BY name,id LIMIT 25 OFFSET ${(q.page - 1) * 25}`,
      ),
      prisma.$queryRaw<{ total: number }[]>(
        Prisma.sql`WITH registrations AS (${rows}) SELECT COUNT(*)::int total FROM registrations WHERE name ILIKE ${search} OR identifier ILIKE ${search}`,
      ),
    ],
    { isolationLevel: 'RepeatableRead' },
  );
  return { items, total: count[0]!.total, page: q.page, pageSize: 25 };
}
export async function statistics(actor: Actor, id: string, date?: string) {
  const inst = await requireInstitution(actor, id);
  const day = date ? new Date(date) : cityToday(inst.city.timezone);
  const rows = await prisma.$queryRaw<
    {
      checkpointId: string;
      checkpoint: string;
      timeSlot: string;
      status: string;
      quantity: number;
      orders: number;
      orderIds: string[];
    }[]
  >(
    Prisma.sql`SELECT c.id "checkpointId",c.name checkpoint,t.label "timeSlot",i.status::text status,SUM(i.quantity)::int quantity,COUNT(DISTINCT i."orderId")::int orders,array_agg(DISTINCT i."orderId") "orderIds" FROM order_items i JOIN checkpoints c ON c.id=i."checkpointId" JOIN time_slots t ON t.id=i."timeSlotId" WHERE c."institutionId"=${id} AND i."serviceDate"=${day}::date AND i.status<>'CANCELLED' GROUP BY c.id,c.name,t.id,t.label,i.status ORDER BY c.name,t.label,i.status`,
  );
  const sum = (fn: (s: string) => boolean) =>
    rows.filter((r) => fn(r.status)).reduce((n, r) => n + r.quantity, 0);
  return {
    date: dateKey(day),
    timezone: inst.city.timezone,
    orders: new Set(rows.flatMap((r) => r.orderIds)).size,
    meals: sum(() => true),
    deliveredMeals: sum((s) => s === 'DELIVERED'),
    failedMeals: sum((s) => s === 'FAILED'),
    pendingMeals: sum((s) => !['DELIVERED', 'FAILED'].includes(s)),
    groups: rows.map(({ orderIds, ...r }) => r),
  };
}
export async function createWindow(
  actor: Actor,
  id: string,
  checkpointId: string,
  input: z.infer<typeof institutionWindowSchema>,
) {
  return prisma.$transaction(async (tx) => {
    const inst = await requireInstitution(actor, id, tx);
    await tx.$queryRaw`SELECT id FROM checkpoints WHERE id=${checkpointId} FOR UPDATE`;
    if (
      !(await tx.checkpoint.count({
        where: { id: checkpointId, institutionId: id, cityId: inst.cityId },
      }))
    )
      throw notFound('Checkpoint');
    if (
      (await tx.checkpointTimeSlot.count({
        where: { checkpointId, isActive: true },
      })) >= 20
    )
      throw conflict('A checkpoint supports at most 20 active windows');
    const { maxOrders, ...data } = input;
    const overlap = await tx.checkpointTimeSlot.count({
      where: {
        checkpointId,
        isActive: true,
        timeSlot: {
          isActive: true,
          startMinute: { lt: data.endMinute },
          endMinute: { gt: data.startMinute },
        },
      },
    });
    if (overlap)
      throw conflict('This window overlaps an existing delivery window');
    const slot = await tx.timeSlot.create({
      data: { ...data, cityId: inst.cityId, institutionId: id },
    });
    const window = await tx.checkpointTimeSlot.create({
      data: {
        checkpointId,
        timeSlotId: slot.id,
        maxOrders,
        orderCutoffMinutes: data.orderCutoffMinutes,
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: 'institution.window.created',
        entityType: 'Checkpoint',
        entityId: checkpointId,
        after: { ...input, timeSlotId: slot.id },
      },
    });
    return window;
  });
}
export async function register(
  userId: string,
  id: string,
  identifier?: string | null,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM institutions WHERE id=${id} FOR UPDATE`;
    const inst = await tx.institution.findFirst({
      where: { id, isActive: true, registrationOpen: true },
    });
    if (!inst) throw notFound('Institution accepting registrations');
    const old = await tx.institutionMember.findUnique({
      where: { institutionId_userId: { institutionId: id, userId } },
    });
    if (old?.role === 'ADMIN')
      throw conflict(
        'Administrator membership cannot be changed through registration',
      );
    return tx.institutionMember.upsert({
      where: { institutionId_userId: { institutionId: id, userId } },
      create: { institutionId: id, userId, identifier, role: 'MEMBER' },
      update: { identifier, isActive: true },
      select: {
        id: true,
        institutionId: true,
        identifier: true,
        isActive: true,
      },
    });
  });
}
export async function myRegistrations(userId: string) {
  return prisma.institutionMember.findMany({
    where: { userId, role: 'MEMBER' },
    select: {
      id: true,
      institutionId: true,
      identifier: true,
      isActive: true,
      institution: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}
export async function unregister(userId: string, id: string) {
  await prisma.institutionMember.updateMany({
    where: { institutionId: id, userId, role: 'MEMBER' },
    data: { isActive: false },
  });
}
export async function bulkRequests(actor: Actor, id: string, q: Query) {
  await requireInstitution(actor, id);
  const where = { institutionId: id };
  const [items, total] = await prisma.$transaction([
    prisma.institutionBulkRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 25,
      skip: (q.page - 1) * 25,
    }),
    prisma.institutionBulkRequest.count({ where }),
  ]);
  return { items, total, page: q.page, pageSize: 25 };
}
export async function requestBulk(
  actor: Actor,
  id: string,
  input: z.infer<typeof bulkMealRequestSchema>,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM institutions WHERE id=${id} FOR UPDATE`;
    const inst = await requireInstitution(actor, id, tx);
    const { idempotencyKey, ...body } = input;
    const existing = await tx.institutionBulkRequest.findUnique({
      where: {
        institutionId_idempotencyKey: { institutionId: id, idempotencyKey },
      },
    });
    if (existing) {
      if (
        existing.quantityPerDay !== body.quantityPerDay ||
        existing.mealPeriod !== body.mealPeriod ||
        dateKey(existing.startDate) !== body.startDate ||
        (existing.endDate ? dateKey(existing.endDate) : null) !==
          body.endDate ||
        existing.notes !== body.notes
      )
        throw conflict('Request key already used');
      return existing;
    }
    if (new Date(body.startDate) < cityToday(inst.city.timezone))
      throw badRequest('Choose today or a future start date');
    const record = await tx.institutionBulkRequest.create({
      data: {
        ...body,
        startDate: new Date(body.startDate),
        endDate: body.endDate ? new Date(body.endDate) : null,
        institutionId: id,
        requesterUserId: actor.userId,
        idempotencyKey,
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: 'institution.bulk.requested',
        entityType: 'Institution',
        entityId: id,
        after: { requestId: record.id, quantityPerDay: record.quantityPerDay },
      },
    });
    return record;
  });
}
