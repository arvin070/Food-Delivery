import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/core/prisma';
import { api, registerUser } from './helpers';
import { addDays, cityToday, dateKey, occursOn, planDates, slotInstant } from '../src/modules/subscriptions/recurrence';
import { subscribeSchema } from '../src/modules/subscriptions/subscription.schema';
import { addHoliday, changeSubscription, generateDate, generateSubscription, subscribe, subscriptionDetail } from '../src/modules/subscriptions/subscription.service';

let user: Awaited<ReturnType<typeof registerUser>>;
let other: Awaited<ReturnType<typeof registerUser>>;
let cityId: string, vendorId: string, kitchenId: string, mealId: string, checkpointId: string, timeSlotId: string, scheduleId: string, childId: string;
const serviceDate = addDays(cityToday('Asia/Kolkata'), 2);
const nextDate = addDays(serviceDate, 1);
const suffix = randomUUID();
const input = () => ({ mealScheduleId: scheduleId, checkpointId, childId, startDate: dateKey(serviceDate), plan: 'DAILY' as const, daysOfWeek: [], quantity: 1, idempotencyKey: randomUUID() });

beforeAll(async () => {
  user = await registerUser(); other = await registerUser();
  cityId = (await prisma.city.create({ data: { name: `Subscription test ${suffix}`, state: 'Test' } })).id;
  vendorId = (await prisma.vendor.create({ data: { ownerUserId: other.id, businessName: 'Subscription test kitchen', status: 'APPROVED' } })).id;
  kitchenId = (await prisma.kitchen.create({ data: { vendorId, cityId, name: 'Test kitchen', capacityPerSlot: 10 } })).id;
  mealId = (await prisma.meal.create({ data: { vendorId, kitchenId, name: 'Lunch', slug: suffix, basePrice: 100, mealPeriods: ['LUNCH'] } })).id;
  checkpointId = (await prisma.checkpoint.create({ data: { cityId, name: 'ABC College Gate A', type: 'COLLEGE_GATE', deliveryCapacity: 10 } })).id;
  timeSlotId = (await prisma.timeSlot.create({ data: { cityId, label: 'Lunch', mealPeriod: 'LUNCH', startMinute: 750, endMinute: 780, orderCutoffMinutes: 60 } })).id;
  await prisma.checkpointTimeSlot.create({ data: { checkpointId, timeSlotId, maxOrders: 10 } });
  await prisma.kitchenServiceArea.create({ data: { kitchenId, checkpointId } });
  childId = (await prisma.child.create({ data: { parentId: user.id, fullName: 'Rahul' } })).id;
  scheduleId = (await prisma.mealSchedule.create({ data: { mealId, kitchenId, timeSlotId, serviceDate, price: 100, totalQuantity: 10, status: 'PUBLISHED' } })).id;
  await prisma.mealSchedule.create({ data: { mealId, kitchenId, timeSlotId, serviceDate: nextDate, price: 110, totalQuantity: 10, status: 'PUBLISHED' } });
});
beforeEach(async () => {
  await prisma.order.deleteMany({ where: { customerId: user.id } });
  await prisma.subscription.deleteMany({ where: { userId: user.id } });
  await prisma.serviceHoliday.deleteMany({ where: { cityId } });
  await prisma.mealSchedule.updateMany({ where: { mealId }, data: { reservedQuantity: 0, totalQuantity: 10, status: 'PUBLISHED' } });
  await prisma.kitchen.update({ where: { id: kitchenId }, data: { capacityPerSlot: 10 } });
  await prisma.checkpointTimeSlot.update({ where: { checkpointId_timeSlotId: { checkpointId, timeSlotId } }, data: { maxOrders: 10 } });
});
afterAll(async () => {
  if (!user) return;
  await prisma.order.deleteMany({ where: { customerId: user.id } });
  await prisma.subscription.deleteMany({ where: { userId: user.id } });
  await prisma.serviceHoliday.deleteMany({ where: { cityId } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: user.id } });
  await prisma.mealSchedule.deleteMany({ where: { mealId } });
  await prisma.meal.deleteMany({ where: { id: mealId } });
  await prisma.kitchen.deleteMany({ where: { id: kitchenId } });
  await prisma.checkpoint.deleteMany({ where: { id: checkpointId } });
  await prisma.timeSlot.deleteMany({ where: { id: timeSlotId } });
  await prisma.city.deleteMany({ where: { id: cityId } });
  await prisma.user.deleteMany({ where: { id: { in: [user.id, other.id] } } });
  await prisma.$disconnect();
});

describe('subscription recurrence and validation', () => {
  it('defines each plan and rejects empty custom days and invalid dates', () => {
    const start = new Date('2028-01-31');
    expect(dateKey(planDates('ONE_TIME', start).endDate!)).toBe('2028-01-31');
    expect(dateKey(planDates('WEEKLY', start).endDate!)).toBe('2028-02-06');
    expect(dateKey(planDates('MONTHLY', start).endDate!)).toBe('2028-02-28');
    expect(planDates('WEEKDAYS', start).daysOfWeek).toEqual([1,2,3,4,5]);
    expect(planDates('CUSTOM', start, undefined, [1,3,3]).daysOfWeek).toEqual([1,3]);
    expect(occursOn({ startDate: start, ...planDates('WEEKDAYS', start) }, new Date('2028-02-05'))).toBe(false);
    expect(subscribeSchema.safeParse({ ...input(), plan: 'CUSTOM' }).success).toBe(false);
    expect(subscribeSchema.safeParse({ ...input(), startDate: '2028-02-30' }).success).toBe(false);
  });
  it('converts local delivery times, including a DST timezone', () => {
    expect(slotInstant(new Date('2026-10-25'), 750, 'Asia/Kolkata').toISOString()).toBe('2026-10-25T07:00:00.000Z');
    expect(slotInstant(new Date('2026-07-01'), 750, 'America/New_York').toISOString()).toBe('2026-07-01T16:30:00.000Z');
  });
});

describe('subscription reservations', () => {
  it('deduplicates subscription creation and concurrent generation, snapshots beneficiary and price', async () => {
    const data = input();
    const [a,b] = await Promise.all([subscribe(user.id, data), subscribe(user.id, data)]);
    expect(a.id).toBe(b.id);
    const results = await Promise.all([generateDate(a.id, serviceDate), generateDate(a.id, serviceDate)]);
    expect(results.sort()).toEqual(['ALREADY_GENERATED','GENERATED']);
    expect(await generateDate(a.id, nextDate)).toBe('GENERATED');
    const detail = await subscriptionDetail(user.id, a.id);
    expect(detail.upcoming).toHaveLength(2);
    expect(detail.upcoming[0]?.beneficiaryName).toBe('Rahul');
    expect(detail.upcoming[1]?.unitPrice.toString()).toBe('100');
    expect((await prisma.mealSchedule.findUniqueOrThrow({ where: { id: scheduleId } })).reservedQuantity).toBe(1);
  });
  it('caps the window, retries unavailable dates, and never backfills past dates', async () => {
    const sub = await subscribe(user.id, input());
    expect(await generateDate(sub.id, addDays(cityToday('Asia/Kolkata'), 7))).toBe('OUTSIDE_WINDOW');
    expect(await generateDate(sub.id, addDays(cityToday('Asia/Kolkata'), -1))).toBe('OUTSIDE_WINDOW');
    await prisma.mealSchedule.update({ where: { id: scheduleId }, data: { status: 'CLOSED' } });
    expect(await generateDate(sub.id, serviceDate)).toBe('MEAL_UNAVAILABLE');
    await prisma.mealSchedule.update({ where: { id: scheduleId }, data: { status: 'PUBLISHED' } });
    expect(await generateDate(sub.id, serviceDate)).toBe('GENERATED');
    expect(await generateSubscription(user.id, sub.id)).toHaveLength(7);
  });
  it('pauses, releases stock, resumes the same order, and preserves skips and cancellation', async () => {
    const sub = await subscribe(user.id, input());
    await generateDate(sub.id, serviceDate);
    const original = await prisma.orderItem.findFirstOrThrow({ where: { subscriptionId: sub.id } });
    await changeSubscription(user.id, sub.id, 'PAUSE');
    expect((await prisma.mealSchedule.findUniqueOrThrow({ where: { id: scheduleId } })).reservedQuantity).toBe(0);
    expect(await generateDate(sub.id, nextDate)).toBe('INACTIVE_DATE');
    await changeSubscription(user.id, sub.id, 'RESUME');
    expect(await generateDate(sub.id, serviceDate)).toBe('GENERATED');
    expect((await prisma.orderItem.findFirstOrThrow({ where: { subscriptionId: sub.id } })).id).toBe(original.id);
    await changeSubscription(user.id, sub.id, 'SKIP', dateKey(serviceDate));
    expect(await generateDate(sub.id, serviceDate)).toBe('SKIPPED');
    await changeSubscription(user.id, sub.id, 'CANCEL');
    expect(await generateDate(sub.id, nextDate)).toBe('INACTIVE_DATE');
    expect((await subscriptionDetail(user.id, sub.id)).events.map(e => e.action)).toEqual(expect.arrayContaining(['SUBSCRIBED','PAUSE','RESUME','SKIP','CANCEL']));
  });
  it('honours holidays and reconciles previously generated reservations', async () => {
    const sub = await subscribe(user.id, input());
    await generateDate(sub.id, serviceDate);
    await addHoliday(user.id, { date: dateKey(serviceDate), cityId, name: 'College holiday' });
    expect(await generateDate(sub.id, serviceDate)).toBe('HOLIDAY');
    expect((await prisma.mealSchedule.findUniqueOrThrow({ where: { id: scheduleId } })).reservedQuantity).toBe(0);
    expect((await subscriptionDetail(user.id, sub.id)).history[0]?.status).toBe('CANCELLED');
  });
  it('enforces stock, checkpoint and kitchen limits', async () => {
    const sub = await subscribe(user.id, input());
    await prisma.mealSchedule.update({ where: { id: scheduleId }, data: { totalQuantity: 0 } });
    expect(await generateDate(sub.id, serviceDate)).toBe('MEAL_CAPACITY');
    await prisma.mealSchedule.update({ where: { id: scheduleId }, data: { totalQuantity: 10 } });
    await prisma.checkpointTimeSlot.update({ where: { checkpointId_timeSlotId: { checkpointId, timeSlotId } }, data: { maxOrders: 0 } });
    await expect(generateDate(sub.id, serviceDate)).rejects.toThrow('capacity');
    await prisma.checkpointTimeSlot.update({ where: { checkpointId_timeSlotId: { checkpointId, timeSlotId } }, data: { maxOrders: 10 } });
    await prisma.kitchen.update({ where: { id: kitchenId }, data: { capacityPerSlot: 0 } });
    expect(await generateDate(sub.id, serviceDate)).toBe('KITCHEN_CAPACITY');
    expect(await prisma.order.count({ where: { customerId: user.id } })).toBe(0);
  });
  it('does not oversell when different subscriptions compete for the last meal', async () => {
    const a = await subscribe(user.id, input()); const b = await subscribe(user.id, input());
    await prisma.mealSchedule.update({ where: { id: scheduleId }, data: { totalQuantity: 1 } });
    const results = await Promise.all([generateDate(a.id, serviceDate), generateDate(b.id, serviceDate)]);
    expect(results.filter(r => r === 'GENERATED')).toHaveLength(1);
    expect((await prisma.mealSchedule.findUniqueOrThrow({ where: { id: scheduleId } })).reservedQuantity).toBe(1);
  });
  it('does not cancel a meal already in preparation', async () => {
    const sub = await subscribe(user.id, input()); await generateDate(sub.id, serviceDate);
    await prisma.orderItem.updateMany({ where: { subscriptionId: sub.id }, data: { status: 'PREPARING' } });
    await expect(changeSubscription(user.id, sub.id, 'CANCEL')).rejects.toThrow('fulfilment');
    expect((await subscriptionDetail(user.id, sub.id)).status).toBe('ACTIVE');
  });
  it('enforces ownership on read, mutation and generation routes', async () => {
    const sub = await subscribe(user.id, input());
    const auth = `Bearer ${other.accessToken}`;
    await api().get(`/api/v1/subscriptions/${sub.id}`).set('Authorization', auth).expect(404);
    await api().post(`/api/v1/subscriptions/${sub.id}/actions`).set('Authorization', auth).send({ action: 'CANCEL' }).expect(404);
    await api().post(`/api/v1/subscriptions/${sub.id}/generate`).set('Authorization', auth).expect(404);
    await api().post('/api/v1/admin/holidays').set('Authorization', auth).send({ date: dateKey(serviceDate), name: 'Invalid' }).expect(403);
    await api().get('/api/v1/subscriptions').expect(401);
  });
  it('honours checkpoint cutoff overrides in the city timezone', async () => {
    const sub = await subscribe(user.id, input());
    await prisma.checkpointTimeSlot.update({ where: { checkpointId_timeSlotId: { checkpointId, timeSlotId } }, data: { orderCutoffMinutes: 10080 } });
    try { expect(await generateDate(sub.id, serviceDate)).toBe('CUTOFF_PASSED'); }
    finally { await prisma.checkpointTimeSlot.update({ where: { checkpointId_timeSlotId: { checkpointId, timeSlotId } }, data: { orderCutoffMinutes: null } }); }
  });
  it('keeps pause and generation consistent when they race', async () => {
    const sub = await subscribe(user.id, input());
    await Promise.all([generateDate(sub.id, serviceDate), changeSubscription(user.id, sub.id, 'PAUSE')]);
    expect((await subscriptionDetail(user.id, sub.id)).upcoming).toHaveLength(0);
    expect((await prisma.mealSchedule.findUniqueOrThrow({ where: { id: scheduleId } })).reservedQuantity).toBe(0);
  });
  it('expires an ended plan and refuses dates outside selected weekdays', async () => {
    const day = serviceDate.getUTCDay() || 7;
    const sub = await subscribe(user.id, { ...input(), plan: 'CUSTOM', daysOfWeek: [day === 7 ? 1 : day + 1] });
    expect(await generateDate(sub.id, serviceDate)).toBe('INACTIVE_DATE');
    await prisma.subscription.update({ where: { id: sub.id }, data: { endDate: addDays(cityToday('Asia/Kolkata'), -1) } });
    expect(await generateSubscription(user.id, sub.id)).toEqual([]);
    expect((await subscriptionDetail(user.id, sub.id)).status).toBe('EXPIRED');
  });
  it('blocks another customer’s child and refuses automatic cancellation of paid meals', async () => {
    await expect(subscribe(other.id, input())).rejects.toThrow('Child');
    const sub = await subscribe(user.id, input()); await generateDate(sub.id, serviceDate);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { subscriptionId: sub.id } });
    await prisma.payment.updateMany({ where: { orderId: item.orderId }, data: { status: 'PAID' } });
    await expect(changeSubscription(user.id, sub.id, 'CANCEL')).rejects.toThrow('refund');
    expect((await subscriptionDetail(user.id, sub.id)).status).toBe('ACTIVE');
  });
  it('creates and generates through the customer API', async () => {
    const response = await api().post('/api/v1/subscriptions').set('Authorization', `Bearer ${user.accessToken}`).send({ ...input(), plan: 'ONE_TIME' }).expect(201);
    expect(response.body.data.generation.filter((r: { result: string }) => r.result === 'GENERATED')).toHaveLength(1);
    expect(response.body.data.subscription.endDate.slice(0,10)).toBe(dateKey(serviceDate));
  });
});
