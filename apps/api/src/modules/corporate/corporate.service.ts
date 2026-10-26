import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  createCompanySchema,
  corporatePolicySchema,
  approveCompanySchema,
  corporateEmployeeSchema,
  corporateEmployeeUpdateSchema,
  corporateOfficeSchema,
  corporateOrderSchema,
  corporateQuerySchema,
  corporateSettlementSchema,
} from '@lunch/shared';
import { prisma } from '../../core/prisma';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors';
import { paymentTransaction as retryTransaction } from '../payments/transaction';
import { cityToday, dateKey, addDays } from '../subscriptions/recurrence';
import { assertDeliverySlotCapacity } from '../catalog/catalog.service';
import { cancelOrder } from '../orders/order.service';
import { enqueueNotifications } from '../notifications/notification.service';
import { releaseCorporateFunding } from './funding';
const paymentTransaction = <T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
) => retryTransaction(fn, { timeout: 30000 });
type Actor = { userId: string; role: string };
type Query = z.infer<typeof corporateQuerySchema>;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
async function scope(
  actor: Actor,
  id: string,
  admin = false,
  db: Prisma.TransactionClient = prisma,
) {
  const company = await db.corporateAccount.findUnique({
    where: { id },
    include: {
      institution: { include: { city: true } },
      members: { where: { userId: actor.userId, isActive: true }, take: 1 },
    },
  });
  const member = company?.members[0];
  if (
    !company ||
    (actor.role !== 'SUPER_ADMIN' &&
      (!member || (admin && member.role !== 'ADMIN')))
  )
    throw notFound('Company');
  return {
    company,
    member,
    isAdmin: actor.role === 'SUPER_ADMIN' || member?.role === 'ADMIN',
  };
}
async function lock(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM corporate_accounts WHERE id=${id} FOR UPDATE`;
}
async function audit(
  tx: Prisma.TransactionClient,
  actor: Actor,
  action: string,
  id: string,
  after: Prisma.InputJsonValue,
) {
  await tx.auditLog.create({
    data: {
      actorUserId: actor.userId,
      action: 'corporate.' + action,
      entityType: 'CorporateAccount',
      entityId: id,
      after,
    },
  });
}
export async function list(actor: Actor, q: Query) {
  const where: Prisma.CorporateAccountWhereInput = {
    ...(actor.role === 'SUPER_ADMIN'
      ? {}
      : { members: { some: { userId: actor.userId, isActive: true } } }),
    ...(q.search
      ? { institution: { name: { contains: q.search, mode: 'insensitive' } } }
      : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.corporateAccount.findMany({
      where,
      include: {
        institution: { include: { city: true } },
        members: { where: { userId: actor.userId, isActive: true }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
      skip: (q.page - 1) * 25,
    }),
    prisma.corporateAccount.count({ where }),
  ]);
  return {
    items: rows.map((c) => ({
      id: c.id,
      name: c.institution.name,
      status: c.status,
      currency: c.currency,
      role: actor.role === 'SUPER_ADMIN' ? 'ADMIN' : c.members[0]!.role,
      memberId: c.members[0]?.id ?? null,
      cityId: c.institution.cityId,
      timezone: c.institution.city.timezone,
    })),
    total,
    page: q.page,
    pageSize: 25,
  };
}
export async function detail(actor: Actor, id: string) {
  const { company: c, member, isAdmin } = await scope(actor, id);
  return {
    id: c.id,
    name: c.institution.name,
    status: c.status,
    currency: c.currency,
    role: isAdmin ? 'ADMIN' : 'EMPLOYEE',
    memberId: member?.id ?? null,
    cityId: c.institution.cityId,
    timezone: c.institution.city.timezone,
    revision: c.revision,
    employeeMonthlyCredit: c.employeeMonthlyCredit.toFixed(2),
    subsidyPerMeal: c.subsidyPerMeal.toFixed(2),
    maxMealsPerDay: c.maxMealsPerDay,
    allowedWeekdays: c.allowedWeekdays,
    allowedPeriods: c.allowedPeriods,
    allowCopayment: c.allowCopayment,
    ...(isAdmin
      ? {
          billingEmail: c.billingEmail,
          monthlyBudget: c.monthlyBudget.toFixed(2),
          creditLimit: c.creditLimit.toFixed(2),
        }
      : {}),
  };
}
export async function create(
  actor: Actor,
  input: z.infer<typeof createCompanySchema>,
) {
  return paymentTransaction(async (tx) => {
    if (!(await tx.city.count({ where: { id: input.cityId, isActive: true } })))
      throw badRequest('Choose an active city');
    const c = await tx.corporateAccount.create({
      data: {
        billingEmail: input.billingEmail,
        institution: {
          create: {
            name: input.name,
            type: 'CORPORATE',
            cityId: input.cityId,
            registrationOpen: false,
            contactEmail: input.billingEmail,
          },
        },
        members: { create: { userId: actor.userId, role: 'ADMIN' } },
      },
    });
    await audit(tx, actor, 'created', c.id, {
      name: input.name,
      status: 'PENDING',
    });
    return { id: c.id };
  });
}
export async function policy(
  actor: Actor,
  id: string,
  input: z.infer<typeof corporatePolicySchema>,
) {
  return paymentTransaction(async (tx) => {
    await lock(tx, id);
    const { company } = await scope(actor, id, true, tx);
    if (company.revision !== input.revision)
      throw conflict('Company changed. Reload before saving.');
    const { revision, ...data } = input;
    await tx.corporateAccount.update({
      where: { id },
      data: { ...data, revision: { increment: 1 } },
    });
    await audit(
      tx,
      actor,
      'policy.updated',
      id,
      JSON.parse(JSON.stringify(input)),
    );
    return { saved: true };
  });
}
export async function approve(
  actor: Actor,
  id: string,
  input: z.infer<typeof approveCompanySchema>,
) {
  if (actor.role !== 'SUPER_ADMIN')
    throw forbidden('Platform credit approval is required');
  return paymentTransaction(async (tx) => {
    await lock(tx, id);
    const { company } = await scope(actor, id, true, tx);
    if (company.revision !== input.revision)
      throw conflict('Company changed. Reload before saving.');
    const committed = await tx.corporateCharge.aggregate({
      where: { companyId: id, status: { in: ['AUTHORIZED', 'INVOICED'] } },
      _sum: { companyAmount: true },
    });
    if (D(input.creditLimit).lt(committed._sum.companyAmount ?? 0))
      throw conflict(
        'Credit limit cannot be below outstanding authorizations and invoices',
      );
    await tx.corporateAccount.update({
      where: { id },
      data: {
        status: input.status,
        creditLimit: input.creditLimit,
        revision: { increment: 1 },
      },
    });
    await audit(tx, actor, 'credit.updated', id, input);
    return { saved: true };
  });
}
export async function employees(actor: Actor, id: string, q: Query) {
  await scope(actor, id, true);
  const where: Prisma.CorporateMemberWhereInput = {
    companyId: id,
    ...(q.search
      ? {
          user: {
            OR: [
              { fullName: { contains: q.search, mode: 'insensitive' } },
              { email: { contains: q.search, mode: 'insensitive' } },
            ],
          },
        }
      : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.corporateMember.findMany({
      where,
      select: {
        id: true,
        userId: true,
        role: true,
        isActive: true,
        employeeNumber: true,
        monthlyCredit: true,
        user: { select: { fullName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
      skip: (q.page - 1) * 25,
    }),
    prisma.corporateMember.count({ where }),
  ]);
  return { items, total, page: q.page, pageSize: 25 };
}
export async function addEmployee(
  actor: Actor,
  id: string,
  input: z.infer<typeof corporateEmployeeSchema>,
) {
  return paymentTransaction(async (tx) => {
    await lock(tx, id);
    await scope(actor, id, true, tx);
    const user = await tx.user.findFirst({
      where: {
        email: { equals: input.email, mode: 'insensitive' },
        status: 'ACTIVE',
        deletedAt: null,
        role: { in: ['CUSTOMER', 'PARENT', 'STUDENT'] },
      },
    });
    if (!user)
      throw badRequest(
        'Employee must have an active customer, parent or student account',
      );
    if (
      await tx.corporateMember.count({
        where: { companyId: id, userId: user.id },
      })
    )
      throw conflict(
        'Employee is already registered; update the existing record',
      );
    const row = await tx.corporateMember.create({
      data: {
        companyId: id,
        userId: user.id,
        role: input.role,
        employeeNumber: input.employeeNumber,
        monthlyCredit: input.monthlyCredit,
      },
    });
    await audit(tx, actor, 'employee.added', id, {
      memberId: row.id,
      role: row.role,
    });
    return { id: row.id };
  });
}
export async function updateEmployee(
  actor: Actor,
  id: string,
  memberId: string,
  input: z.infer<typeof corporateEmployeeUpdateSchema>,
) {
  return paymentTransaction(async (tx) => {
    await lock(tx, id);
    await scope(actor, id, true, tx);
    const member = await tx.corporateMember.findFirst({
      where: { id: memberId, companyId: id },
    });
    if (!member) throw notFound('Employee');
    if (!input.isActive && member.userId === actor.userId)
      throw conflict('You cannot deactivate your own company membership');
    if (
      !input.isActive &&
      member.role === 'ADMIN' &&
      (await tx.corporateMember.count({
        where: { companyId: id, role: 'ADMIN', isActive: true },
      })) <= 1
    )
      throw conflict('Keep at least one active company administrator');
    await tx.corporateMember.update({
      where: { id: memberId },
      data: { isActive: input.isActive, monthlyCredit: input.monthlyCredit },
    });
    await audit(tx, actor, 'employee.updated', id, { memberId, ...input });
    return { saved: true };
  });
}
export async function offices(actor: Actor, id: string) {
  const { company } = await scope(actor, id);
  return prisma.checkpoint.findMany({
    where: { institutionId: company.institutionId },
    select: {
      id: true,
      name: true,
      instructions: true,
      deliveryCapacity: true,
      isActive: true,
      timeSlots: {
        where: { isActive: true },
        select: {
          timeSlot: {
            select: {
              id: true,
              label: true,
              startMinute: true,
              endMinute: true,
            },
          },
        },
      },
    },
    orderBy: { name: 'asc' },
    take: 100,
  });
}
export async function createOffice(
  actor: Actor,
  id: string,
  input: z.infer<typeof corporateOfficeSchema>,
) {
  return paymentTransaction(async (tx) => {
    await lock(tx, id);
    const { company } = await scope(actor, id, true, tx);
    if (
      (await tx.checkpoint.count({
        where: { institutionId: company.institutionId },
      })) >= 100
    )
      throw conflict('A company supports up to 100 office checkpoints');
    const count = await tx.timeSlot.count({
      where: {
        id: { in: input.timeSlotIds },
        isActive: true,
        AND: [
          { OR: [{ cityId: null }, { cityId: company.institution.cityId }] },
          {
            OR: [
              { institutionId: null },
              { institutionId: company.institutionId },
            ],
          },
        ],
      },
    });
    if (count !== input.timeSlotIds.length)
      throw badRequest('Choose valid delivery windows for this office city');
    const cp = await tx.checkpoint.create({
      data: {
        name: input.name,
        type: 'OFFICE_RECEPTION',
        cityId: company.institution.cityId,
        institutionId: company.institutionId,
        instructions: input.instructions,
        deliveryCapacity: input.deliveryCapacity,
        timeSlots: {
          create: input.timeSlotIds.map((timeSlotId) => ({
            timeSlotId,
            maxOrders: input.deliveryCapacity,
          })),
        },
      },
    });
    await audit(tx, actor, 'office.created', id, { checkpointId: cp.id });
    return { id: cp.id };
  });
}
export async function usage(actor: Actor, id: string, q: Query) {
  const { company, member, isAdmin } = await scope(actor, id);
  const month =
    q.month ??
    dateKey(cityToday(company.institution.city.timezone)).slice(0, 7);
  const where: Prisma.CorporateChargeWhereInput = {
    companyId: id,
    month,
    status: { not: 'RELEASED' },
    ...(!isAdmin ? { memberId: member!.id } : {}),
  };
  const [sum, own, outstanding] = await prisma.$transaction([
    prisma.corporateCharge.aggregate({
      where,
      _sum: { companyAmount: true, employeeAmount: true, quantity: true },
      _count: true,
    }),
    prisma.corporateCharge.aggregate({
      where: {
        companyId: id,
        month,
        memberId: member?.id ?? '__none__',
        status: { not: 'RELEASED' },
      },
      _sum: { companyAmount: true },
    }),
    prisma.corporateCharge.aggregate({
      where: { companyId: id, status: { in: ['AUTHORIZED', 'INVOICED'] } },
      _sum: { companyAmount: true },
    }),
  ]);
  return {
    month,
    companyAmount: (sum._sum.companyAmount ?? D(0)).toFixed(2),
    employeeAmount: (sum._sum.employeeAmount ?? D(0)).toFixed(2),
    orders: sum._count,
    meals: sum._sum.quantity ?? 0,
    remainingCredit: Prisma.Decimal.max(
      0,
      (member?.monthlyCredit ?? company.employeeMonthlyCredit).sub(
        own._sum.companyAmount ?? 0,
      ),
    ).toFixed(2),
    ...(isAdmin
      ? {
          remainingBudget: Prisma.Decimal.max(
            0,
            company.monthlyBudget.sub(sum._sum.companyAmount ?? 0),
          ).toFixed(2),
          outstanding: (outstanding._sum.companyAmount ?? D(0)).toFixed(2),
        }
      : {}),
  };
}
const chargeSelect = {
  id: true,
  orderId: true,
  memberId: true,
  month: true,
  serviceDate: true,
  quantity: true,
  companyAmount: true,
  employeeAmount: true,
  status: true,
  order: {
    select: {
      orderNumber: true,
      status: true,
      items: {
        select: {
          mealNameSnapshot: true,
          beneficiaryName: true,
          status: true,
          checkpoint: { select: { name: true } },
        },
      },
    },
  },
} satisfies Prisma.CorporateChargeSelect;
export async function orders(actor: Actor, id: string, q: Query) {
  const { member, isAdmin } = await scope(actor, id);
  const where: Prisma.CorporateChargeWhereInput = {
    companyId: id,
    ...(q.month ? { month: q.month } : {}),
    ...(!isAdmin ? { memberId: member!.id } : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.corporateCharge.findMany({
      where,
      select: chargeSelect,
      orderBy: { createdAt: 'desc' },
      take: 25,
      skip: (q.page - 1) * 25,
    }),
    prisma.corporateCharge.count({ where }),
  ]);
  return { items, total, page: q.page, pageSize: 25 };
}
export async function cancel(actor: Actor, id: string, orderId: string) {
  const { member, isAdmin } = await scope(actor, id);
  const charge = await prisma.corporateCharge.findFirst({
    where: {
      companyId: id,
      orderId,
      ...(!isAdmin ? { memberId: member!.id } : {}),
    },
    include: { order: true },
  });
  if (!charge) throw notFound('Corporate order');
  const result = await cancelOrder(charge.order.customerId, orderId, {
    reason: 'Cancelled through corporate account',
  }, {actorUserId:actor.userId,action:'corporate.order.cancelled',details:{companyId:id}});
  return result;
}
export async function offers(actor: Actor, id: string, q: Query) {
  const { company } = await scope(actor, id);
  const today = cityToday(company.institution.city.timezone);
  const day = q.date ? new Date(q.date) : addDays(today, 1);
  if (day < today || day > addDays(today, 30))
    throw badRequest('Choose a delivery date within the next 30 days');
  if (!q.checkpointId)
    return { items: [], total: 0, page: q.page, pageSize: 25 };
  const cp = await prisma.checkpoint.findFirst({
    where: {
      id: q.checkpointId,
      institutionId: company.institutionId,
      isActive: true,
    },
    include: {
      timeSlots: { where: { isActive: true }, select: { timeSlotId: true } },
    },
  });
  if (!cp) throw notFound('Office checkpoint');
  const where: Prisma.MealScheduleWhereInput = {
    serviceDate: day,
    status: 'PUBLISHED',
    timeSlotId: { in: cp.timeSlots.map((x) => x.timeSlotId) },
    timeSlot: { isActive: true },
    meal: { isActive: true, deletedAt: null },
    kitchen: {
      isActive: true,
      deletedAt: null,
      vendor: { status: 'APPROVED', isActive: true, deletedAt: null },
      serviceAreas: { some: { checkpointId: cp.id, isActive: true } },
    },
  };
  const [items, total] = await prisma.$transaction([
    prisma.mealSchedule.findMany({
      where,
      select: {
        id: true,
        price: true,
        totalQuantity: true,
        reservedQuantity: true,
        meal: { select: { name: true } },
        timeSlot: { select: { label: true, mealPeriod: true } },
        kitchen: { select: { name: true } },
      },
      orderBy: { id: 'asc' },
      take: 25,
      skip: (q.page - 1) * 25,
    }),
    prisma.mealSchedule.count({ where }),
  ]);
  return { items, total, page: q.page, pageSize: 25 };
}

/** Corporate checkout never touches a consumer cart. Batches are bounded and atomic. */
export async function checkout(
  actor: Actor,
  id: string,
  input: z.infer<typeof corporateOrderSchema>,
) {
  const hash = createHash('sha256')
    .update(JSON.stringify({ actor: actor.userId, ...input }))
    .digest('hex');
  return paymentTransaction(async (tx) => {
    await lock(tx, id);
    const { company, member, isAdmin } = await scope(actor, id, false, tx);
    const replay = await tx.corporateOrderBatch.findUnique({
      where: {
        companyId_idempotencyKey: {
          companyId: id,
          idempotencyKey: input.idempotencyKey,
        },
      },
      include: { charges: { select: chargeSelect } },
    });
    if (replay) {
      if (replay.requestHash !== hash)
        throw conflict('Request key already used for a different order');
      return { batchId: replay.id, orders: replay.charges };
    }
    if (
      company.status !== 'ACTIVE' ||
      !company.institution.isActive ||
      !company.institution.city.isActive
    )
      throw conflict(
        'Company credit must be approved and active before ordering',
      );
    const onBehalf =
      input.lines.length > 1 || input.lines[0]!.memberId !== member?.id;
    if (onBehalf && !isAdmin)
      throw forbidden('Employees may order only for themselves');
    if (onBehalf && !D(input.maxEmployeeAmount).isZero())
      throw badRequest(
        'Administrator bulk orders must be fully company-funded',
      );
    const today = cityToday(company.institution.city.timezone);
    const scheduleIds = [
      ...new Set(input.lines.map((l) => l.mealScheduleId)),
    ].sort();
    for (const sid of scheduleIds)
      await tx.$queryRaw`SELECT id FROM meal_schedules WHERE id=${sid} FOR UPDATE`;
    const batch = await tx.corporateOrderBatch.create({
      data: {
        companyId: id,
        actorUserId: actor.userId,
        idempotencyKey: input.idempotencyKey,
        requestHash: hash,
      },
    });
    for (const line of input.lines) {
      const employee = await tx.corporateMember.findFirst({
        where: {
          id: line.memberId,
          companyId: id,
          isActive: true,
          user: {
            status: 'ACTIVE',
            deletedAt: null,
            role: { in: ['CUSTOMER', 'PARENT', 'STUDENT'] },
          },
        },
        include: { user: { select: { fullName: true } } },
      });
      if (!employee) throw badRequest('Choose an active company employee');
      const schedule = await tx.mealSchedule.findFirst({
        where: {
          id: line.mealScheduleId,
          status: 'PUBLISHED',
          meal: { isActive: true, deletedAt: null },
          timeSlot: { isActive: true },
          kitchen: {
            isActive: true,
            deletedAt: null,
            cityId: company.institution.cityId,
            vendor: { isActive: true, status: 'APPROVED', deletedAt: null },
          },
        },
        include: { timeSlot: true, meal: true, kitchen: true },
      });
      if (!schedule) throw conflict('Meal is unavailable');
      if (
        schedule.serviceDate < today ||
        schedule.serviceDate > addDays(today, 30)
      )
        throw badRequest('Choose a date within the next 30 days');
      if (
        !company.allowedWeekdays.includes(schedule.serviceDate.getUTCDay()) ||
        !company.allowedPeriods.includes(schedule.timeSlot.mealPeriod)
      )
        throw conflict('This meal is outside company meal policy');
      if (
        await tx.serviceHoliday.count({
          where: {
            serviceDate: schedule.serviceDate,
            OR: [{ cityId: null }, { cityId: company.institution.cityId }],
          },
        })
      )
        throw conflict('No corporate deliveries on this holiday');
      if (
        !(await tx.checkpoint.count({
          where: {
            id: line.checkpointId,
            institutionId: company.institutionId,
            cityId: company.institution.cityId,
            isActive: true,
            servingKitchens: {
              some: { kitchenId: schedule.kitchenId, isActive: true },
            },
          },
        }))
      )
        throw badRequest('Choose an office served by this kitchen');
      const month = dateKey(schedule.serviceDate).slice(0, 7);
      if (await tx.corporateInvoice.count({ where: { companyId: id, month } }))
        throw conflict('This billing month is closed');
      const total = schedule.price.mul(line.quantity);
      const subsidy = Prisma.Decimal.min(
        total,
        company.subsidyPerMeal.mul(line.quantity),
      );
      const copay = total.sub(subsidy);
      if (subsidy.lte(0))
        throw conflict(
          'Configure a positive company subsidy before corporate ordering',
        );
      if (
        copay.gt(input.maxEmployeeAmount) ||
        (copay.gt(0) && (!company.allowCopayment || onBehalf))
      )
        throw conflict(
          'Employee co-payment exceeds the authorized amount or policy; bulk orders require full subsidy',
        );
      const [companyUsed, employeeUsed, daily, outstanding] = await Promise.all(
        [
          tx.corporateCharge.aggregate({
            where: { companyId: id, month, status: { not: 'RELEASED' } },
            _sum: { companyAmount: true },
          }),
          tx.corporateCharge.aggregate({
            where: {
              memberId: employee.id,
              month,
              status: { not: 'RELEASED' },
            },
            _sum: { companyAmount: true },
          }),
          tx.corporateCharge.aggregate({
            where: {
              memberId: employee.id,
              serviceDate: schedule.serviceDate,
              status: { not: 'RELEASED' },
            },
            _sum: { quantity: true },
          }),
          tx.corporateCharge.aggregate({
            where: {
              companyId: id,
              status: { in: ['AUTHORIZED', 'INVOICED'] },
            },
            _sum: { companyAmount: true },
          }),
        ],
      );
      if (
        subsidy
          .add(companyUsed._sum.companyAmount ?? 0)
          .gt(company.monthlyBudget)
      )
        throw conflict('Company monthly meal budget exceeded');
      if (
        subsidy
          .add(employeeUsed._sum.companyAmount ?? 0)
          .gt(employee.monthlyCredit ?? company.employeeMonthlyCredit)
      )
        throw conflict('Employee monthly meal credits exhausted');
      if (
        subsidy.add(outstanding._sum.companyAmount ?? 0).gt(company.creditLimit)
      )
        throw conflict(
          'Company credit limit exceeded; settle an invoice or request a limit increase',
        );
      if (line.quantity + (daily._sum.quantity ?? 0) > company.maxMealsPerDay)
        throw conflict('Employee daily meal limit exceeded');
      if (schedule.reservedQuantity + line.quantity > schedule.totalQuantity)
        throw conflict('Not enough meal stock');
      await assertDeliverySlotCapacity(tx, {
        checkpointId: line.checkpointId,
        timeSlotId: schedule.timeSlotId,
        serviceDate: dateKey(schedule.serviceDate),
        quantity: line.quantity,
        timezone: company.institution.city.timezone,
      });
      await tx.$queryRaw`SELECT id FROM kitchens WHERE id=${schedule.kitchenId} FOR UPDATE`;
      const kitchenUsed = await tx.orderItem.aggregate({
        where: {
          kitchenId: schedule.kitchenId,
          timeSlotId: schedule.timeSlotId,
          serviceDate: schedule.serviceDate,
          status: { notIn: ['CANCELLED', 'FAILED'] },
        },
        _sum: { quantity: true },
      });
      if (
        line.quantity + (kitchenUsed._sum.quantity ?? 0) >
        schedule.kitchen.capacityPerSlot
      )
        throw conflict('Kitchen capacity exceeded');
      const full = copay.isZero();
      const order = await tx.order.create({
        data: {
          customerId: employee.userId,
          orderNumber: 'LN-C-' + randomUUID(),
          cityId: company.institution.cityId,
          status: full ? 'CONFIRMED' : 'AWAITING_PAYMENT',
          subtotal: total,
          discountAmount: subsidy,
          totalAmount: copay,
          currency: 'INR',
          placedAt: new Date(),
          ...(full
            ? {}
            : {
                payments: {
                  create: { amount: copay, currency: 'INR', status: 'CREATED' },
                },
              }),
          items: {
            create: {
              mealScheduleId: schedule.id,
              mealId: schedule.mealId,
              kitchenId: schedule.kitchenId,
              checkpointId: line.checkpointId,
              timeSlotId: schedule.timeSlotId,
              serviceDate: schedule.serviceDate,
              beneficiaryName: employee.user.fullName,
              mealNameSnapshot: schedule.meal.name,
              quantity: line.quantity,
              unitPrice: schedule.price,
              lineTotal: total,
              status: full ? 'CONFIRMED' : 'PENDING',
            },
          },
        },
      });
      await tx.corporateCharge.create({
        data: {
          companyId: id,
          memberId: employee.id,
          orderId: order.id,
          batchId: batch.id,
          month,
          serviceDate: schedule.serviceDate,
          quantity: line.quantity,
          companyAmount: subsidy,
          employeeAmount: copay,
          policySnapshot: {
            revision: company.revision,
            subsidyPerMeal: company.subsidyPerMeal.toFixed(2),
            monthlyCredit: (
              employee.monthlyCredit ?? company.employeeMonthlyCredit
            ).toFixed(2),
            approvedCreditLimit: company.creditLimit.toFixed(2),
            fundingBasis: 'APPROVED_CORPORATE_CREDIT',
            billFailedDeliveries: true,
          },
        },
      });
      await tx.mealSchedule.update({
        where: { id: schedule.id },
        data: { reservedQuantity: { increment: line.quantity } },
      });
      if (full)
        await enqueueNotifications(tx, [
          {
            userId: employee.userId,
            event: 'order.confirmed',
            key: 'order:' + order.id + ':confirmed',
            data: { orderNumber: order.orderNumber },
          },
        ]);
    }
    await audit(tx, actor, 'checkout.authorized', id, {
      batchId: batch.id,
      orders: input.lines.length,
    });
    return {
      batchId: batch.id,
      orders: await tx.corporateCharge.findMany({
        where: { batchId: batch.id },
        select: chargeSelect,
      }),
    };
  });
}

/** Bounded cleanup; uncertain provider captures remain refundable on the cancelled order. */
export async function expire(actor: Actor, id: string) {
  return paymentTransaction(async (tx) => {
    await lock(tx, id);
    const { company } = await scope(actor, id, true, tx);
    const today = cityToday(company.institution.city.timezone);
    const rows = await tx.corporateCharge.findMany({
      where: {
        companyId: id,
        status: 'AUTHORIZED',
        serviceDate: { lt: today },
        order: {
          status: { in: ['PENDING', 'AWAITING_PAYMENT', 'PAYMENT_FAILED'] },
        },
      },
      take: 50,
      orderBy: { createdAt: 'asc' },
    });
    let expired = 0;
    for (const charge of rows) {
      await tx.$queryRaw`SELECT id FROM orders WHERE id=${charge.orderId} FOR UPDATE`;
      const order = await tx.order.findUniqueOrThrow({
        where: { id: charge.orderId },
        include: { items: true, payments: true },
      });
      if (
        !['PENDING', 'AWAITING_PAYMENT', 'PAYMENT_FAILED'].includes(
          order.status,
        ) ||
        order.items.some((i) => i.status !== 'PENDING') ||
        order.payments.some((p) =>
          ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(p.status),
        )
      )
        continue;
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancellationReason: 'Expired corporate co-payment',
        },
      });
      await tx.orderItem.updateMany({
        where: { orderId: order.id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      for (const item of order.items)
        if (item.mealScheduleId)
          await tx.mealSchedule.update({
            where: { id: item.mealScheduleId },
            data: { reservedQuantity: { decrement: item.quantity } },
          });
      await releaseCorporateFunding(tx, order.id);
      expired++;
    }
    await audit(tx, actor, 'unpaid.expired', id, { expired });
    return { expired, batchLimit: 50 };
  });
}
export async function invoices(actor: Actor, id: string, q: Query) {
  await scope(actor, id, true);
  const where = { companyId: id };
  const [items, total] = await prisma.$transaction([
    prisma.corporateInvoice.findMany({
      where,
      orderBy: { month: 'desc' },
      take: 25,
      skip: (q.page - 1) * 25,
    }),
    prisma.corporateInvoice.count({ where }),
  ]);
  return { items, total, page: q.page, pageSize: 25 };
}
export async function issueInvoice(actor: Actor, id: string, month: string) {
  return paymentTransaction(async (tx) => {
    await lock(tx, id);
    const { company } = await scope(actor, id, true, tx);
    if (
      month >= dateKey(cityToday(company.institution.city.timezone)).slice(0, 7)
    )
      throw badRequest('Issue invoices only after the service month has ended');
    const existing = await tx.corporateInvoice.findUnique({
      where: { companyId_month: { companyId: id, month } },
    });
    if (existing) return existing;
    const where: Prisma.CorporateChargeWhereInput = {
      companyId: id,
      month,
      status: 'AUTHORIZED',
    };
    if (
      await tx.corporateCharge.count({
        where: {
          ...where,
          order: {
            items: { some: { status: { notIn: ['DELIVERED', 'FAILED'] } } },
          },
        },
      })
    )
      throw conflict(
        'Resolve unfinished deliveries or expire unpaid orders before closing this month',
      );
    const sum = await tx.corporateCharge.aggregate({
      where,
      _sum: { companyAmount: true, quantity: true },
      _count: true,
    });
    if (!sum._count)
      throw conflict('No billable corporate meals for this month');
    const invoice = await tx.corporateInvoice.create({
      data: {
        companyId: id,
        month,
        number: 'CI-' + month + '-' + randomUUID(),
        amount: sum._sum.companyAmount!,
        currency: company.currency,
        snapshot: {
          companyName: company.institution.name,
          billingEmail: company.billingEmail,
          month,
          currency: company.currency,
          companyAmount: sum._sum.companyAmount!.toFixed(2),
          meals: sum._sum.quantity,
          orders: sum._count,
          terms:
            'Company subsidy only. Employee co-payments are billed separately. Prepared meals with failed delivery are chargeable.',
        },
      },
    });
    await tx.corporateCharge.updateMany({
      where,
      data: { status: 'INVOICED', invoiceId: invoice.id },
    });
    await audit(tx, actor, 'invoice.issued', id, {
      invoiceId: invoice.id,
      amount: invoice.amount.toFixed(2),
      month,
    });
    return invoice;
  });
}
export async function settleInvoice(
  actor: Actor,
  id: string,
  invoiceId: string,
  input: z.infer<typeof corporateSettlementSchema>,
) {
  if (actor.role !== 'SUPER_ADMIN')
    throw forbidden('Only platform finance can record settlement');
  return paymentTransaction(async (tx) => {
    await lock(tx, id);
    await scope(actor, id, true, tx);
    const invoice = await tx.corporateInvoice.findFirst({
      where: { id: invoiceId, companyId: id },
    });
    if (!invoice) throw notFound('Invoice');
    if (!invoice.amount.equals(input.amount))
      throw badRequest('Settlement must match the full invoice amount');
    if (invoice.settledAt) {
      if (invoice.settlementReference !== input.reference)
        throw conflict(
          'Invoice has already been settled with another reference',
        );
      return invoice;
    }
    if (
      await tx.corporateInvoice.count({
        where: { settlementReference: input.reference },
      })
    )
      throw conflict('Settlement reference is already used');
    const updated = await tx.corporateInvoice.update({
      where: { id: invoiceId },
      data: {
        settledAt: new Date(),
        settlementReference: input.reference,
        settledByUserId: actor.userId,
      },
    });
    await tx.corporateCharge.updateMany({
      where: { invoiceId, status: 'INVOICED' },
      data: { status: 'SETTLED' },
    });
    await audit(tx, actor, 'invoice.settled', id, { invoiceId, ...input });
    return updated;
  });
}
