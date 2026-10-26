import { Prisma } from '@prisma/client';
import {
  ADMIN_SECTIONS,
  administrativeActions,
  type AdminResource,
  type AdminListQuery,
  type AdminRecord,
  type AdminActionInput,
} from '@lunch/shared';
import { prisma } from '../../core/prisma';
import { badRequest, conflict, notFound } from '../../core/errors';
import {
  cityToday,
  dateKey,
  addDays,
  slotInstant,
} from '../subscriptions/recurrence';
import { paymentTransaction } from '../payments/transaction';
import { updateUserStatus } from '../users/user.service';
import { updateVendorStatus } from '../admin/vendor.admin.service';
import { changeSubscription } from '../subscriptions/subscription.service';
import { refundPayment } from '../payments/payment.service';
export const ADMIN_TIMEZONE = 'Asia/Kolkata';
type RecordRow = Omit<AdminRecord, 'createdAt'> & { createdAt: Date };
// Only these fixed projections are queryable. Never expose model-wide records or raw provider data.
const source: Record<AdminResource, Prisma.Sql> = {
  users: Prisma.sql`SELECT u.id,u."fullName" name,u.status::text status,concat_ws(' · ',u.email,u.phone,u.role) summary,jsonb_build_object('email',u.email,'phone',u.phone,'role',u.role) fields,u."createdAt",p."cityId",ARRAY[u."createdAt"::date::text] dates,u.role::text role,NULL::boolean available,0 revision FROM users u LEFT JOIN user_profiles p ON p."userId"=u.id WHERE u."deletedAt" IS NULL`,
  vendors: Prisma.sql`SELECT v.id,v."businessName" name,v.status::text status,u."fullName" summary,jsonb_build_object('owner',u."fullName",'contactEmail',v."contactEmail",'contactPhone',v."contactPhone",'active',v."isActive") fields,v."createdAt",NULL::text "cityId",ARRAY[v."createdAt"::date::text] dates,NULL::text role,NULL::boolean available,0 revision FROM vendors v JOIN users u ON u.id=v."ownerUserId" WHERE v."deletedAt" IS NULL`,
  kitchens: Prisma.sql`SELECT k.id,k.name,CASE WHEN k."isActive" THEN 'ACTIVE' ELSE 'INACTIVE' END status,concat_ws(' · ',v."businessName",c.name) summary,jsonb_build_object('vendor',v."businessName",'city',c.name,'capacityPerSlot',k."capacityPerSlot",'contactPhone',k."contactPhone") fields,k."createdAt",k."cityId",ARRAY[k."createdAt"::date::text] dates,NULL::text role,NULL::boolean available,0 revision FROM kitchens k JOIN vendors v ON v.id=k."vendorId" JOIN cities c ON c.id=k."cityId" WHERE k."deletedAt" IS NULL`,
  meals: Prisma.sql`SELECT m.id,m.name,CASE WHEN m."isActive" THEN 'ACTIVE' ELSE 'INACTIVE' END status,k.name summary,jsonb_build_object('kitchen',k.name,'price',m."basePrice"::text,'foodType',m."foodType",'description',m.description) fields,m."createdAt",k."cityId",ARRAY[m."createdAt"::date::text] dates,NULL::text role,NULL::boolean available,0 revision FROM meals m LEFT JOIN kitchens k ON k.id=m."kitchenId" WHERE m."deletedAt" IS NULL`,
  orders: Prisma.sql`SELECT o.id,o."orderNumber" name,o.status::text status,u."fullName" summary,jsonb_build_object('customer',u."fullName",'amount',o."totalAmount"::text,'currency',o.currency,'placedAt',o."placedAt") fields,o."createdAt",o."cityId",ARRAY(SELECT DISTINCT i."serviceDate"::text FROM order_items i WHERE i."orderId"=o.id) dates,NULL::text role,NULL::boolean available,0 revision FROM orders o JOIN users u ON u.id=o."customerId"`,
  subscriptions: Prisma.sql`SELECT s.id,m.name,u."fullName" summary,s.status::text status,jsonb_build_object('customer',u."fullName",'beneficiary',ch."fullName",'plan',s.plan,'quantity',s.quantity,'startDate',s."startDate"::text,'endDate',s."endDate"::text,'checkpoint',c.name,'timeSlot',t.label) fields,s."createdAt",c."cityId",ARRAY[s."startDate"::text,s."endDate"::text] dates,NULL::text role,NULL::boolean available,0 revision FROM subscriptions s JOIN users u ON u.id=s."userId" JOIN meals m ON m.id=s."mealId" JOIN checkpoints c ON c.id=s."checkpointId" JOIN time_slots t ON t.id=s."timeSlotId" LEFT JOIN children ch ON ch.id=s."childId"`,
  checkpoints: Prisma.sql`SELECT p.id,p.name,CASE WHEN p."isActive" THEN 'ACTIVE' ELSE 'INACTIVE' END status,c.name summary,jsonb_build_object('city',c.name,'type',p.type,'instructions',p.instructions,'capacity',p."deliveryCapacity") fields,p."createdAt",p."cityId",ARRAY[p."createdAt"::date::text] dates,NULL::text role,NULL::boolean available,0 revision FROM checkpoints p JOIN cities c ON c.id=p."cityId"`,
  'time-slots': Prisma.sql`SELECT t.id,t.label name,CASE WHEN t."isActive" THEN 'ACTIVE' ELSE 'INACTIVE' END status,COALESCE(c.name,'All cities') summary,jsonb_build_object('mealPeriod',t."mealPeriod",'startMinute',t."startMinute",'endMinute',t."endMinute",'cutoffMinutes',t."orderCutoffMinutes") fields,t."createdAt",t."cityId",ARRAY[t."createdAt"::date::text] dates,NULL::text role,NULL::boolean available,0 revision FROM time_slots t LEFT JOIN cities c ON c.id=t."cityId"`,
  'delivery-partners': Prisma.sql`SELECT p.id,u."fullName" name,CASE WHEN p."isActive" THEN 'ACTIVE' ELSE 'INACTIVE' END status,concat_ws(' · ',p."vehicleType",p."vehicleNumber") summary,jsonb_build_object('vehicle',p."vehicleType",'vehicleNumber',p."vehicleNumber",'available',p."isAvailable",'accountStatus',u.status) fields,p."createdAt",p."cityId",ARRAY[p."createdAt"::date::text] dates,NULL::text role,p."isAvailable" available,0 revision FROM delivery_partners p JOIN users u ON u.id=p."userId" WHERE p."deletedAt" IS NULL`,
  routes: Prisma.sql`SELECT r.id,COALESCE(r.name,'Route '||right(r.id,6)) name,r.status::text status,concat_ws(' · ',k.name,u."fullName") summary,jsonb_build_object('kitchen',k.name,'partner',u."fullName",'date',r."serviceDate"::text,'earliestSlot',t.label) fields,r."createdAt",k."cityId",ARRAY[r."serviceDate"::text] dates,NULL::text role,NULL::boolean available,r.revision FROM delivery_runs r JOIN kitchens k ON k.id=r."kitchenId" JOIN time_slots t ON t.id=r."timeSlotId" LEFT JOIN delivery_partners p ON p.id=r."deliveryPartnerId" LEFT JOIN users u ON u.id=p."userId"`,
  payments: Prisma.sql`SELECT p.id,o."orderNumber" name,p.status::text status,concat_ws(' · ',p.provider,p.method) summary,jsonb_build_object('orderId',o.id,'amount',p.amount::text,'currency',p.currency,'refundedAmount',p."refundedAmount"::text,'provider',p.provider,'verifiedAt',p."lastVerifiedAt",'paidAt',p."paidAt") fields,p."createdAt",o."cityId",ARRAY[(COALESCE(p."paidAt",p."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE ${ADMIN_TIMEZONE})::date::text] dates,NULL::text role,NULL::boolean available,0 revision FROM payments p JOIN orders o ON o.id=p."orderId"`,
  refunds: Prisma.sql`SELECT r.id,o."orderNumber" name,r.status::text status,COALESCE(r.reason,'Refund') summary,jsonb_build_object('paymentId',p.id,'amount',r.amount::text,'currency',p.currency,'reason',r.reason,'processedAt',r."processedAt") fields,r."createdAt",o."cityId",ARRAY[(COALESCE(r."processedAt",r."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE ${ADMIN_TIMEZONE})::date::text] dates,NULL::text role,NULL::boolean available,0 revision FROM refunds r JOIN payments p ON p.id=r."paymentId" JOIN orders o ON o.id=p."orderId"`,
  complaints: Prisma.sql`SELECT c.id,c.subject name,c.status::text status,u."fullName" summary,jsonb_build_object('customer',u."fullName",'orderId',c."orderId",'message',c.message,'response',c.response,'resolvedAt',c."resolvedAt") fields,c."createdAt",o."cityId",ARRAY[(c."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${ADMIN_TIMEZONE})::date::text] dates,NULL::text role,NULL::boolean available,c.revision FROM complaints c JOIN users u ON u.id=c."userId" LEFT JOIN orders o ON o.id=c."orderId"`,
};
function dto(row: RecordRow): AdminRecord {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    summary: row.summary,
    fields: row.fields,
    createdAt: row.createdAt.toISOString(),
    revision: row.revision,
  };
}
function filters(resource: AdminResource, q: AdminListQuery) {
  if (q.status && !ADMIN_SECTIONS[resource].statuses.includes(q.status))
    throw badRequest('Invalid status for this section');
  if (q.role && resource !== 'users')
    throw badRequest('Role filters apply to users only');
  if (q.available && resource !== 'delivery-partners')
    throw badRequest('Availability filters apply to delivery partners only');
  const clauses: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (q.search) {
    const search = '%' + q.search.replace(/[\\%_]/g, '\\$&') + '%';
    clauses.push(
      Prisma.sql`(id ILIKE ${search} OR name ILIKE ${search} OR summary ILIKE ${search})`,
    );
  }
  if (q.status) clauses.push(Prisma.sql`status=${q.status}`);
  if (q.cityId) clauses.push(Prisma.sql`"cityId"=${q.cityId}`);
  if (q.date) clauses.push(Prisma.sql`${q.date}=ANY(dates)`);
  if (q.role) clauses.push(Prisma.sql`role=${q.role}`);
  if (q.available)
    clauses.push(Prisma.sql`available=${q.available === 'true'}`);
  return Prisma.join(clauses, ' AND ');
}
export async function list(resource: AdminResource, q: AdminListQuery) {
  const where = filters(resource, q);
  const [items, count] = await prisma.$transaction(
    [
      prisma.$queryRaw<RecordRow[]>(
        Prisma.sql`WITH records AS (${source[resource]}) SELECT * FROM records WHERE ${where} ORDER BY "createdAt" DESC,id DESC LIMIT 25 OFFSET ${(q.page - 1) * 25}`,
      ),
      prisma.$queryRaw<{ total: number }[]>(
        Prisma.sql`WITH records AS (${source[resource]}) SELECT COUNT(*)::int total FROM records WHERE ${where}`,
      ),
    ],
    { isolationLevel: 'RepeatableRead' },
  );
  return {
    items: items.map(dto),
    total: count[0]!.total,
    page: q.page,
    pageSize: 25,
  };
}
export async function getRecord(
  resource: AdminResource,
  id: string,
  db: Prisma.TransactionClient = prisma,
) {
  const rows = await db.$queryRaw<RecordRow[]>(
    Prisma.sql`WITH records AS (${source[resource]}) SELECT * FROM records WHERE id=${id}`,
  );
  if (!rows[0]) throw notFound(ADMIN_SECTIONS[resource].label);
  return dto(rows[0]);
}
export async function detail(resource: AdminResource, id: string, page = 1) {
  const record = await getRecord(resource, id);
  let related: Record<string, string | number | null>[] = [],
    relatedTotal = 0;
  if (resource === 'orders' || resource === 'subscriptions') {
    const where =
      resource === 'orders' ? { orderId: id } : { subscriptionId: id };
    const [items, total] = await prisma.$transaction([
      prisma.orderItem.findMany({
        where,
        select: {
          id: true,
          mealNameSnapshot: true,
          beneficiaryName: true,
          quantity: true,
          status: true,
          serviceDate: true,
          checkpoint: { select: { name: true } },
          timeSlot: { select: { label: true } },
        },
        orderBy: [{ serviceDate: 'desc' }, { id: 'asc' }],
        take: 25,
        skip: (page - 1) * 25,
      }),
      prisma.orderItem.count({ where }),
    ]);
    related = items.map((i) => ({
      id: i.id,
      meal: i.mealNameSnapshot,
      beneficiary: i.beneficiaryName,
      quantity: i.quantity,
      status: i.status,
      date: dateKey(i.serviceDate),
      checkpoint: i.checkpoint.name,
      timeSlot: i.timeSlot.label,
    }));
    relatedTotal = total;
  }
  return { record, related, relatedTotal, page, pageSize: 25 };
}
export async function dashboard(date?: string) {
  const day = date ? new Date(date) : cityToday(ADMIN_TIMEZONE),
    dateValue = dateKey(day);
  const from = slotInstant(day, 0, ADMIN_TIMEZONE),
    to = slotInstant(addDays(day, 1), 0, ADMIN_TIMEZONE);
  const [counts, received, returned] = await prisma.$transaction(
    [
      prisma.$queryRaw<
        {
          orders: number;
          meals: number;
          activeUsers: number;
          activeSubscriptions: number;
          activeKitchens: number;
          activeDeliveryPartners: number;
          pendingDeliveries: number;
          failedDeliveries: number;
        }[]
      >(Prisma.sql`
   SELECT
    (SELECT COUNT(DISTINCT "orderId")::int FROM order_items WHERE "serviceDate"=${day}::date AND status<>'CANCELLED') orders,
    (SELECT COALESCE(SUM(quantity),0)::int FROM order_items WHERE "serviceDate"=${day}::date AND status<>'CANCELLED') meals,
    (SELECT COUNT(*)::int FROM users WHERE status='ACTIVE' AND "deletedAt" IS NULL) "activeUsers",
    (SELECT COUNT(*)::int FROM subscriptions WHERE status='ACTIVE') "activeSubscriptions",
    (SELECT COUNT(*)::int FROM kitchens k JOIN vendors v ON v.id=k."vendorId" WHERE k."isActive" AND k."deletedAt" IS NULL AND v."isActive" AND v.status='APPROVED' AND v."deletedAt" IS NULL) "activeKitchens",
    (SELECT COUNT(*)::int FROM delivery_partners p JOIN users u ON u.id=p."userId" WHERE p."isActive" AND p."deletedAt" IS NULL AND u.status='ACTIVE' AND u."deletedAt" IS NULL) "activeDeliveryPartners",
    (SELECT COUNT(*)::int FROM deliveries d JOIN order_items i ON i.id=d."orderItemId" WHERE i."serviceDate"=${day}::date AND d.status IN ('PENDING','ASSIGNED','PICKED_UP','OUT_FOR_DELIVERY','AT_CHECKPOINT')) "pendingDeliveries",
    (SELECT COUNT(*)::int FROM deliveries d JOIN order_items i ON i.id=d."orderItemId" WHERE i."serviceDate"=${day}::date AND d.status='FAILED') "failedDeliveries"`),
      prisma.$queryRaw<{ currency: string; amount: string }[]>(
        Prisma.sql`SELECT currency,SUM(amount)::text amount FROM payments WHERE "paidAt">=${from.toISOString()}::timestamp AND "paidAt"<${to.toISOString()}::timestamp AND "lastVerifiedAt" IS NOT NULL AND status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED') GROUP BY currency`,
      ),
      prisma.$queryRaw<{ currency: string; amount: string }[]>(
        Prisma.sql`SELECT p.currency,SUM(r.amount)::text amount FROM refunds r JOIN payments p ON p.id=r."paymentId" WHERE r.status='PROCESSED' AND r."processedAt">=${from.toISOString()}::timestamp AND r."processedAt"<${to.toISOString()}::timestamp GROUP BY p.currency`,
      ),
    ],
    { isolationLevel: 'RepeatableRead' },
  );
  const currencies = new Set([
    ...received.map((r) => r.currency),
    ...returned.map((r) => r.currency),
  ]);
  const revenue = [...currencies].sort().map((currency) => {
    const gross = new Prisma.Decimal(
      received.find((r) => r.currency === currency)?.amount ?? 0,
    );
    const refunds = new Prisma.Decimal(
      returned.find((r) => r.currency === currency)?.amount ?? 0,
    );
    return {
      currency,
      collected: gross.toFixed(2),
      refunded: refunds.toFixed(2),
      net: gross.minus(refunds).toFixed(2),
    };
  });
  return {
    date: dateValue,
    timezone: ADMIN_TIMEZONE,
    metrics: counts[0]!,
    revenue,
  };
}
export async function act(
  actorId: string,
  resource: AdminResource,
  id: string,
  input: AdminActionInput,
  context: { ip?: string; userAgent?: string } = {},
) {
  const before = await getRecord(resource, id);
  if (before.status !== input.expectedStatus)
    throw conflict('Record changed. Refresh before applying this action.');
  if (!administrativeActions(resource, before.status).includes(input.action))
    throw badRequest('This action is not available for this record');
  if (resource === 'users')
    return updateUserStatus(
      actorId,
      id,
      {
        status:
          input.action === 'ACTIVATE'
            ? 'ACTIVE'
            : input.action === 'SUSPEND'
              ? 'SUSPENDED'
              : 'DEACTIVATED',
        reason: input.reason,
      },
      { ...context, expectedStatus: input.expectedStatus },
    );
  if (resource === 'vendors')
    return updateVendorStatus(
      actorId,
      id,
      {
        status:
          input.action === 'APPROVE'
            ? 'APPROVED'
            : input.action === 'SUSPEND'
              ? 'SUSPENDED'
              : 'REJECTED',
        reason: input.reason,
      },
      { ...context, expectedStatus: input.expectedStatus },
    );
  if (resource === 'payments') {
    if (!input.idempotencyKey)
      throw badRequest('A refund request key is required');
    return refundPayment(
      actorId,
      id,
      {
        idempotencyKey: input.idempotencyKey,
        amount: input.amount,
        reason: input.reason.slice(0, 200),
      },
      true,
    );
  }
  if (resource === 'subscriptions') {
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { id } });
    return changeSubscription(
      sub.userId,
      id,
      input.action === 'RESUME'
        ? 'RESUME'
        : input.action === 'PAUSE'
          ? 'PAUSE'
          : 'CANCEL',
      undefined,
      {
        actorUserId: actorId,
        reason: input.reason,
        expectedStatus: input.expectedStatus,
        ...context,
      },
    );
  }
  return paymentTransaction(async (tx) => {
    // Serialize admin controls; repeat the state check inside the transaction.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(721501)::text`;
    const current = await getRecord(resource, id, tx);
    if (current.status !== input.expectedStatus)
      throw conflict('Record changed. Refresh before applying this action.');
    const active = input.action === 'ACTIVATE';
    if (resource === 'complaints') {
      if (input.revision === undefined || input.revision !== current.revision)
        throw conflict('Complaint changed. Refresh before updating.');
      const status =
        input.action === 'START_REVIEW'
          ? 'IN_PROGRESS'
          : input.action === 'RESOLVE'
            ? 'RESOLVED'
            : input.action === 'REJECT'
              ? 'REJECTED'
              : 'OPEN';
      await tx.complaint.update({
        where: { id },
        data: {
          status,
          response: input.reason,
          revision: { increment: 1 },
          resolvedAt: ['RESOLVED', 'REJECTED'].includes(status)
            ? new Date()
            : null,
        },
      });
    } else if (resource === 'kitchens') {
      if (
        !active &&
        (await tx.orderItem.count({
          where: {
            kitchenId: id,
            status: { notIn: ['DELIVERED', 'CANCELLED', 'FAILED'] },
          },
        }))
      )
        throw conflict(
          'Complete or cancel outstanding meals before deactivating this kitchen.',
        );
      if (
        active &&
        !(await tx.kitchen.count({
          where: {
            id,
            vendor: { status: 'APPROVED', isActive: true, deletedAt: null },
          },
        }))
      )
        throw conflict('Approve the vendor before activating this kitchen.');
      await tx.kitchen.update({ where: { id }, data: { isActive: active } });
    } else if (resource === 'meals')
      await tx.meal.update({ where: { id }, data: { isActive: active } });
    else if (resource === 'checkpoints')
      await tx.checkpoint.update({ where: { id }, data: { isActive: active } });
    else if (resource === 'time-slots')
      await tx.timeSlot.update({ where: { id }, data: { isActive: active } });
    else if (resource === 'delivery-partners') {
      if (
        !active &&
        (await tx.delivery.count({
          where: {
            deliveryPartnerId: id,
            status: {
              in: [
                'PENDING',
                'ASSIGNED',
                'PICKED_UP',
                'OUT_FOR_DELIVERY',
                'AT_CHECKPOINT',
              ],
            },
          },
        }))
      )
        throw conflict(
          'Finish or reassign active deliveries before deactivating this partner.',
        );
      if (
        active &&
        !(await tx.deliveryPartner.count({
          where: {
            id,
            user: {
              status: 'ACTIVE',
              role: 'DELIVERY_PARTNER',
              deletedAt: null,
            },
          },
        }))
      )
        throw conflict('Activate the partner account first.');
      await tx.deliveryPartner.update({
        where: { id },
        data: { isActive: active, ...(!active ? { isAvailable: false } : {}) },
      });
    } else throw badRequest('This resource is read-only here');
    const after = await getRecord(resource, id, tx);
    await tx.auditLog.create({
      data: {
        actorUserId: actorId,
        action: 'admin.' + resource + '.' + input.action.toLowerCase(),
        entityType: resource,
        entityId: id,
        before: { status: current.status, revision: current.revision ?? 0 },
        after: {
          status: after.status,
          revision: after.revision ?? 0,
          reason: input.reason,
        },
        ip: context.ip,
        userAgent: context.userAgent?.slice(0, 255),
      },
    });
    return after;
  });
}
export async function audit(q: AdminListQuery) {
  const where: Prisma.AuditLogWhereInput = q.search
    ? {
        OR: [
          { entityId: q.search },
          { actorUserId: q.search },
          { action: { contains: q.search, mode: 'insensitive' } },
        ],
      }
    : {};
  const [items, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      select: {
        id: true,
        actorUserId: true,
        action: true,
        entityType: true,
        entityId: true,
        before: true,
        after: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 25,
      skip: (q.page - 1) * 25,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { items, total, page: q.page, pageSize: 25 };
}
