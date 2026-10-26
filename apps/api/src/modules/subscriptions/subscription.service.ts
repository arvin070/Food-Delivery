import { enqueueNotifications } from '../notifications/notification.service';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { logger } from '../../core/logger';
import { prisma } from '../../core/prisma';
import { AppError, badRequest, conflict, notFound } from '../../core/errors';
import { assertDeliverySlotCapacity } from '../catalog/catalog.service';
import { addDays, cityToday, dateKey, GENERATION_DAYS, occursOn, planDates, slotInstant } from './recurrence';
import type { SubscribeInput } from './subscription.schema';

// Serializable transactions protect stock/capacity against ordinary checkout too.
// Retry the entire transaction, never an individual write inside a failed transaction.
async function atomic<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(fn, { isolationLevel: 'Serializable', timeout: 15000 }); }
    catch (e) {
      const retryable = e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2034' || (e.code === 'P2010' && ['40001', '40P01'].includes(String(e.meta?.code))));
      if (retryable && attempt < 3) continue;
      if (retryable) throw conflict('Capacity changed during this request. Please retry.');
      throw e;
    }
  }
}
const summary = { meal: { select: { name: true } }, child: { select: { fullName: true } }, checkpoint: { select: { name: true, city: { select: { timezone: true } } } }, timeSlot: { select: { label: true, startMinute: true } } } satisfies Prisma.SubscriptionInclude;
export async function listSubscriptions(userId: string, page = 1) {
  return prisma.subscription.findMany({ where: { userId }, include: summary, orderBy: { createdAt: 'desc' }, take: 20, skip: (page - 1) * 20 });
}
export async function subscriptionDetail(userId: string, id: string, page = 1) {
  const sub = await prisma.subscription.findFirst({ where: { id, userId }, include: summary });
  if (!sub) throw notFound('Subscription');
  const today = cityToday(sub.checkpoint.city.timezone);
  const [upcoming, history, events, skips] = await Promise.all([
    prisma.orderItem.findMany({ where: { subscriptionId: id, serviceDate: { gte: today }, status: { notIn: ['CANCELLED','FAILED'] } }, orderBy: { serviceDate: 'asc' }, take: 31, include: { order: { select: { id: true, orderNumber: true } } } }),
    prisma.orderItem.findMany({ where: { subscriptionId: id }, orderBy: { serviceDate: 'desc' }, take: 20, skip: (page - 1) * 20, include: { order: { select: { id: true, orderNumber: true } } } }),
    prisma.subscriptionEvent.findMany({ where: { subscriptionId: id }, orderBy: { createdAt: 'desc' }, take: 20, skip: (page - 1) * 20 }),
    prisma.subscriptionSkip.findMany({ where: { subscriptionId: id, serviceDate: { gte: today, lte: addDays(today, 30) } }, take: 31 }),
  ]);
  return { ...sub, upcoming, history, events, skips };
}
export async function subscribe(userId: string, input: SubscribeInput) {
  const replay = await prisma.subscription.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } } });
  if (replay) return replay;
  return atomic(async tx => {
    const schedule = await tx.mealSchedule.findFirst({ where: { id: input.mealScheduleId, status: 'PUBLISHED', meal: { isActive: true, deletedAt: null }, kitchen: { isActive: true, deletedAt: null, vendor: { isActive: true, status: 'APPROVED', deletedAt: null } } }, include: { kitchen: true } });
    if (!schedule) throw badRequest('Choose an available meal');
    const checkpoint = await tx.checkpoint.findFirst({ where: { id: input.checkpointId, OR: [{ institutionId: null }, { institution: { isActive: true } }], isActive: true, city: { isActive: true }, servingKitchens: { some: { kitchenId: schedule.kitchenId, isActive: true } }, timeSlots: { some: { timeSlotId: schedule.timeSlotId, isActive: true, timeSlot: { isActive: true } } } }, include: { city: true } });
    if (!checkpoint || checkpoint.cityId !== schedule.kitchen.cityId) throw badRequest('Choose a checkpoint served by this kitchen and time slot');
    if (input.childId && !await tx.child.findFirst({ where: { id: input.childId, parentId: userId, isActive: true, deletedAt: null } })) throw notFound('Child');
    const startDate = new Date(input.startDate);
    if (startDate < cityToday(checkpoint.city.timezone)) throw badRequest('Start date cannot be in the past');
    return tx.subscription.create({ data: { userId, mealId: schedule.mealId, kitchenId: schedule.kitchenId, checkpointId: checkpoint.id, timeSlotId: schedule.timeSlotId, childId: input.childId, startDate, ...planDates(input.plan, startDate, input.endDate ? new Date(input.endDate) : undefined, input.daysOfWeek), plan: input.plan, quantity: input.quantity, pricePerMeal: schedule.price, idempotencyKey: input.idempotencyKey, events: { create: { action: 'SUBSCRIBED' } } } });
  }).catch(async e => {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const existing = await prisma.subscription.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } } });
      if (existing) return existing;
    }
    throw e;
  });
}

export async function changeSubscription(userId: string, id: string, action: 'PAUSE' | 'RESUME' | 'SKIP' | 'CANCEL', date?: string, admin?: {actorUserId:string;reason:string;expectedStatus?:string;ip?:string;userAgent?:string}) {
  await atomic(async tx => {
    await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${id} FOR UPDATE`;
    const sub = await tx.subscription.findFirst({ where: { id, userId }, include: summary });
    if (!sub) throw notFound('Subscription');
    if (admin?.expectedStatus && sub.status !== admin.expectedStatus) throw conflict('Subscription changed. Refresh before updating.');
    if (sub.status === 'CANCELLED' || sub.status === 'EXPIRED') throw conflict('This subscription has ended');
    const today = cityToday(sub.checkpoint.city.timezone);
    const selected = date ? new Date(date) : today;
    if (action === 'SKIP' && (selected < today || !occursOn(sub, selected))) throw badRequest('Choose a future date in this plan');
    if (action === 'RESUME' && sub.status !== 'PAUSED') throw conflict('Subscription is not paused');
    if (action === 'PAUSE' && sub.status !== 'ACTIVE') throw conflict('Subscription is not active');
    if (action !== 'RESUME') {
      const items = await tx.orderItem.findMany({ where: { subscriptionId: id, serviceDate: action === 'SKIP' ? selected : { gte: today }, status: { notIn: ['CANCELLED', 'FAILED', 'DELIVERED'] } } });
      for (const item of items) {
        // Do not silently leave a meal behind when the customer asks to stop it.
        if (!['PENDING','CONFIRMED'].includes(item.status) || slotInstant(item.serviceDate, sub.timeSlot.startMinute, sub.checkpoint.city.timezone) <= new Date()) throw conflict('A meal is already in fulfilment. Contact support before changing this plan.');
        if (await tx.payment.count({ where: { orderId: item.orderId, status: { in: ['PAID','AUTHORIZED','PARTIALLY_REFUNDED'] } } })) throw conflict('A paid meal requires a refund. Contact support.');
        await tx.orderItem.update({ where: { id: item.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
        if (item.mealScheduleId) await tx.mealSchedule.update({ where: { id: item.mealScheduleId }, data: { reservedQuantity: { decrement: item.quantity } } });
        await tx.order.update({ where: { id: item.orderId }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: `Subscription ${action.toLowerCase()}` } });
      }
    }
    if (action === 'SKIP') await tx.subscriptionSkip.upsert({ where: { subscriptionId_serviceDate: { subscriptionId: id, serviceDate: selected } }, create: { subscriptionId: id, serviceDate: selected }, update: {} });
    else await tx.subscription.update({ where: { id }, data: action === 'PAUSE' ? { status: 'PAUSED', pausedFrom: today, pausedTo: null } : action === 'RESUME' ? { status: 'ACTIVE', pausedTo: today } : { status: 'CANCELLED', cancelledAt: new Date() } });
    const event=await tx.subscriptionEvent.create({ data: { subscriptionId: id, action, serviceDate: selected } });
    if(admin) await tx.auditLog.create({data:{actorUserId:admin.actorUserId,action:'admin.subscription.'+action.toLowerCase(),entityType:'Subscription',entityId:id,before:{status:sub.status},after:{status:action==='PAUSE'?'PAUSED':action==='RESUME'?'ACTIVE':'CANCELLED',reason:admin.reason},ip:admin.ip,userAgent:admin.userAgent?.slice(0,255)}});
    if(action==='PAUSE') await enqueueNotifications(tx,[{userId,event:'subscription.paused',key:'subscription-event:'+event.id}]);
  });
  return subscriptionDetail(userId, id);
}

export async function generateDate(id: string, serviceDate: Date) {
  return atomic(async tx => {
    await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${id} FOR UPDATE`;
    const sub = await tx.subscription.findUnique({ where: { id }, include: { ...summary, user: true, child: true } });
    if (!sub) return 'NOT_FOUND';
    const today = cityToday(sub.checkpoint.city.timezone);
    if (serviceDate < today || serviceDate >= addDays(today, GENERATION_DAYS)) return 'OUTSIDE_WINDOW';
    if (sub.status !== 'ACTIVE' || !occursOn(sub, serviceDate)) return 'INACTIVE_DATE';
    if (sub.pausedFrom && !sub.pausedTo && serviceDate >= sub.pausedFrom) return 'PAUSED';
    if (sub.user.status !== 'ACTIVE' || sub.user.deletedAt || (sub.childId && (!sub.child?.isActive || sub.child.deletedAt))) return 'BENEFICIARY_UNAVAILABLE';
    if (await tx.subscriptionSkip.findUnique({ where: { subscriptionId_serviceDate: { subscriptionId: id, serviceDate } } })) return 'SKIPPED';
    const configuredCheckpoint = await tx.checkpoint.findUniqueOrThrow({ where: { id: sub.checkpointId }, include: { city: true } });
    if (await tx.serviceHoliday.count({ where: { serviceDate, OR: [{ cityId: null }, { cityId: configuredCheckpoint.cityId }] } })) return 'HOLIDAY';
    const exception = await tx.checkpointScheduleException.findFirst({ where: { checkpointId: sub.checkpointId, startDate: { lte: serviceDate }, endDate: { gte: serviceDate }, OR: [{ timeSlotId: null }, { timeSlotId: sub.timeSlotId }] } });
    if (exception && !exception.replacementCheckpointId) return 'CHECKPOINT_CLOSED';
    const checkpointId = exception?.replacementCheckpointId ?? sub.checkpointId;
    const checkpoint = checkpointId === sub.checkpointId ? configuredCheckpoint : await tx.checkpoint.findFirst({ where: { id: checkpointId, cityId: configuredCheckpoint.cityId, isActive: true }, include: { city: true } });
    if (!checkpoint) return 'CHECKPOINT_UNAVAILABLE';
    const existing = await tx.orderItem.findUnique({ where: { subscriptionId_serviceDate: { subscriptionId: id, serviceDate } }, include: { order: true } });
    const restore = existing?.status === 'CANCELLED' && existing.order.cancellationReason === 'Subscription pause';
    if (existing && !restore) return 'ALREADY_GENERATED';
    if (restore && await tx.payment.count({ where: { orderId: existing!.orderId, status: { in: ['PAID','AUTHORIZED','PARTIALLY_REFUNDED','REFUNDED'] } } })) return 'PAYMENT_REVIEW_REQUIRED';
    const schedule = await tx.mealSchedule.findFirst({ where: { mealId: sub.mealId, kitchenId: sub.kitchenId ?? '__missing__', timeSlotId: sub.timeSlotId, serviceDate, status: 'PUBLISHED', meal: { isActive: true, deletedAt: null }, kitchen: { isActive: true, deletedAt: null, vendor: { status: 'APPROVED', isActive: true, deletedAt: null } } }, include: { kitchen: true, meal: true, timeSlot: true } });
    if (!schedule) return 'MEAL_UNAVAILABLE';
    await tx.$queryRaw`SELECT id FROM meal_schedules WHERE id = ${schedule.id} FOR UPDATE`;
    if (schedule.totalQuantity - schedule.reservedQuantity < sub.quantity) return 'MEAL_CAPACITY';
    if (!await tx.kitchenServiceArea.count({ where: { kitchenId: schedule.kitchenId, checkpointId, isActive: true } })) return 'CHECKPOINT_UNAVAILABLE';
    const window = await tx.checkpointTimeSlot.findUnique({ where: { checkpointId_timeSlotId: { checkpointId, timeSlotId: sub.timeSlotId } } });
    const weekday = serviceDate.getUTCDay() === 0 ? 7 : serviceDate.getUTCDay();
    if (!window?.isActive || !window.weekdays.includes(weekday)) return 'CHECKPOINT_UNAVAILABLE';
    if (slotInstant(serviceDate, schedule.timeSlot.startMinute, checkpoint.city.timezone).getTime() - ((window.orderCutoffMinutes ?? schedule.timeSlot.orderCutoffMinutes) + window.preparationBufferMinutes + window.travelBufferMinutes) * 60000 <= Date.now()) return 'CUTOFF_PASSED';
    await assertDeliverySlotCapacity(tx, { checkpointId, timeSlotId: sub.timeSlotId, serviceDate: dateKey(serviceDate), quantity: sub.quantity, timezone: checkpoint.city.timezone });
    await tx.$queryRaw`SELECT id FROM kitchens WHERE id = ${schedule.kitchenId} FOR UPDATE`;
    const committed = await tx.orderItem.aggregate({ where: { kitchenId: schedule.kitchenId, timeSlotId: sub.timeSlotId, serviceDate, status: { notIn: ['CANCELLED','FAILED'] } }, _sum: { quantity: true } });
    if ((committed._sum.quantity ?? 0) + sub.quantity > schedule.kitchen.capacityPerSlot) return 'KITCHEN_CAPACITY';
    const amount = sub.pricePerMeal.mul(sub.quantity);
    // PER_ORDER records a payable obligation; no provider charge or paid status is fabricated.
    if (existing && restore) {
      await tx.orderItem.update({ where: { id: existing.id }, data: { status: 'PENDING', cancelledAt: null, mealScheduleId: schedule.id, checkpointId } });
      await tx.order.update({ where: { id: existing.orderId }, data: { status: 'AWAITING_PAYMENT', cancelledAt: null, cancellationReason: null } });
    } else await tx.order.create({ data: {
      customerId: sub.userId, cityId: checkpoint.cityId, orderNumber: `LN-${randomBytes(8).toString('hex').toUpperCase()}`, idempotencyKey: `subscription:${id}:${dateKey(serviceDate)}`, status: 'AWAITING_PAYMENT', subtotal: amount, totalAmount: amount, placedAt: new Date(),
      payments: { create: { amount, status: 'CREATED' } },
      items: { create: { subscriptionId: id, mealScheduleId: schedule.id, mealId: sub.mealId, kitchenId: schedule.kitchenId, checkpointId, timeSlotId: sub.timeSlotId, serviceDate, childId: sub.childId, beneficiaryName: sub.child?.fullName ?? sub.user.fullName, mealNameSnapshot: schedule.meal.name, unitPrice: sub.pricePerMeal, quantity: sub.quantity, lineTotal: amount } },
    } });
    await tx.mealSchedule.update({ where: { id: schedule.id }, data: { reservedQuantity: { increment: sub.quantity } } });
    await tx.subscription.update({ where: { id }, data: { generatedThrough: !sub.generatedThrough || serviceDate > sub.generatedThrough ? serviceDate : sub.generatedThrough } });
    return 'GENERATED';
  });
}

export async function generateSubscription(userId: string, id: string) {
  const sub = await prisma.subscription.findFirst({ where: { id, userId }, include: summary });
  if (!sub) throw notFound('Subscription');
  const today = cityToday(sub.checkpoint.city.timezone);
  if (sub.endDate && sub.endDate < today) {
    await atomic(async tx => {
      const ended = await tx.subscription.updateMany({ where: { id, status: 'ACTIVE' }, data: { status: 'EXPIRED' } });
      if (ended.count) await tx.subscriptionEvent.create({ data: { subscriptionId: id, action: 'EXPIRED' } });
    });
    return [];
  }
  if(sub.status==='ACTIVE' && sub.endDate && sub.endDate<=addDays(today,2)) {
    await atomic(async tx=>{
      await tx.$queryRaw`SELECT id FROM subscriptions WHERE id=${id} FOR UPDATE`;
      const current=await tx.subscription.findFirst({where:{id,userId,status:'ACTIVE'}});
      if(current?.endDate && current.endDate>=today && current.endDate<=addDays(today,2))
        await enqueueNotifications(tx,[{userId,event:'subscription.renewal',key:'subscription:'+id+':renewal:'+dateKey(current.endDate),data:{endDate:dateKey(current.endDate)}}]);
    });
  }
  const results: { date: string; result: string }[] = [];
  for (let day = 0; day < GENERATION_DAYS; day++) {
    const date = addDays(today, day);
    try { results.push({ date: dateKey(date), result: await generateDate(id, date) }); }
    catch (e) {
      if (e instanceof AppError && [400,409].includes(e.statusCode)) results.push({ date: dateKey(date), result: e.message });
      else throw e;
    }
  }
  return results;
}
/** A single bounded, cursor-paginated job. Run repeatedly from an external scheduler. */
export async function generateBatch(after = '') {
  const subscriptions = await prisma.subscription.findMany({ where: { id: { gt: after }, status: 'ACTIVE' }, orderBy: { id: 'asc' }, take: 50, select: { id: true, userId: true } });
  for (const sub of subscriptions) {
    try { await generateSubscription(sub.userId, sub.id); }
    catch (error) { logger.error({ err: error, subscriptionId: sub.id }, 'Subscription generation failed; retry on next sweep'); }
  }
  return { processed: subscriptions.length, nextCursor: subscriptions.length === 50 ? subscriptions[49]!.id : null };
}

/** Holiday changes reconcile reservations in the same serializable transaction.
 * Refuse changes requiring operational intervention instead of silently leaving
 * already-paid or in-preparation meals on a newly closed date. */
export async function addHoliday(actorUserId: string, input: { date: string; cityId?: string; name: string }) {
  return atomic(async tx => {
    const serviceDate = new Date(input.date);
    if (input.cityId && !await tx.city.count({ where: { id: input.cityId } })) throw notFound('City');
    const items = await tx.orderItem.findMany({ where: { subscriptionId: { not: null }, serviceDate, ...(input.cityId ? { checkpoint: { cityId: input.cityId } } : {}), status: { notIn: ['CANCELLED','FAILED'] } }, include: { timeSlot: true, checkpoint: { include: { city: true } } }, take: 501 });
    if (items.length > 500) throw conflict('This holiday affects more than 500 booked meals; process it through operations.');
    for (const item of items) {
      if (!['PENDING','CONFIRMED'].includes(item.status) || slotInstant(serviceDate, item.timeSlot.startMinute, item.checkpoint.city.timezone) <= new Date()) throw conflict('Holiday affects meals already in fulfilment; contact operations.');
      if (await tx.payment.count({ where: { orderId: item.orderId, status: { in: ['PAID','AUTHORIZED','PARTIALLY_REFUNDED'] } } })) throw conflict('Holiday affects paid meals; refunds must be handled first.');
      await tx.orderItem.update({ where: { id: item.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
      if (item.mealScheduleId) await tx.mealSchedule.update({ where: { id: item.mealScheduleId }, data: { reservedQuantity: { decrement: item.quantity } } });
      await tx.order.update({ where: { id: item.orderId }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: `Holiday: ${input.name}` } });
      await tx.subscriptionEvent.create({ data: { subscriptionId: item.subscriptionId!, action: 'HOLIDAY', serviceDate } });
    }
    const holiday = await tx.serviceHoliday.create({ data: { serviceDate, cityId: input.cityId, name: input.name } });
    await tx.auditLog.create({ data: { actorUserId, action: 'holiday.created', entityType: 'ServiceHoliday', entityId: holiday.id, after: input } });
    return holiday;
  });
}
