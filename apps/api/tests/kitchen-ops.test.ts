import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { OrderItemStatus } from '@prisma/client';
import { prisma } from '../src/core/prisma';
import { api, registerUser } from './helpers';
import { addDays, cityToday, dateKey } from '../src/modules/subscriptions/recurrence';
import { kitchenDashboard, packingList } from '../src/modules/kitchen-ops/kitchen-ops.service';
let staff: Awaited<ReturnType<typeof registerUser>>;
let kitchen2: string, meal2: string;
let user: Awaited<ReturnType<typeof registerUser>>;
let other: Awaited<ReturnType<typeof registerUser>>;
let cityId: string, vendorId: string, kitchenId: string, mealId: string, checkpointId: string, timeSlotId: string, scheduleId: string, childId: string;
const serviceDate = addDays(cityToday('Asia/Kolkata'), 2);
const nextDate = addDays(serviceDate, 1);
const suffix = randomUUID();
const input = () => ({ mealScheduleId: scheduleId, checkpointId, childId, startDate: dateKey(serviceDate), plan: 'DAILY' as const, daysOfWeek: [], quantity: 1, idempotencyKey: randomUUID() });

beforeAll(async () => {
  user = await registerUser(); other = await registerUser(); staff = await registerUser();
  await prisma.user.updateMany({ where: { id: { in: [other.id,staff.id] } }, data: { role: 'VENDOR' } });
  cityId = (await prisma.city.create({ data: { name: `Subscription test ${suffix}`, state: 'Test' } })).id;
  vendorId = (await prisma.vendor.create({ data: { ownerUserId: other.id, businessName: 'Subscription test kitchen', status: 'APPROVED' } })).id;
  kitchenId = (await prisma.kitchen.create({ data: { vendorId, cityId, name: 'Test kitchen', capacityPerSlot: 10 } })).id;
  mealId = (await prisma.meal.create({ data: { vendorId, kitchenId, name: 'Lunch', slug: suffix, basePrice: 100, mealPeriods: ['LUNCH'] } })).id;
  checkpointId = (await prisma.checkpoint.create({ data: { cityId, name: 'ABC College Gate A', type: 'COLLEGE_GATE', deliveryCapacity: 10 } })).id;
  timeSlotId = (await prisma.timeSlot.create({ data: { cityId, label: 'Lunch', mealPeriod: 'LUNCH', startMinute: 750, endMinute: 780, orderCutoffMinutes: 60 } })).id;
  await prisma.checkpointTimeSlot.create({ data: { checkpointId, timeSlotId, maxOrders: 10 } });
  await prisma.kitchenServiceArea.create({ data: { kitchenId, checkpointId } });
  kitchen2 = (await prisma.kitchen.create({ data: { vendorId, cityId, name: 'Other kitchen' } })).id;
  meal2 = (await prisma.meal.create({ data: { vendorId, kitchenId, name: 'Chicken lunch', slug: `${suffix}-chicken`, basePrice: 100, foodType: 'NON_VEG' } })).id;
  await prisma.kitchenStaff.create({ data: { userId: staff.id, kitchenId } });
  childId = (await prisma.child.create({ data: { parentId: user.id, fullName: 'Rahul' } })).id;
  scheduleId = (await prisma.mealSchedule.create({ data: { mealId, kitchenId, timeSlotId, serviceDate, price: 100, totalQuantity: 10, status: 'PUBLISHED' } })).id;
  await prisma.mealSchedule.create({ data: { mealId, kitchenId, timeSlotId, serviceDate: nextDate, price: 110, totalQuantity: 10, status: 'PUBLISHED' } });
});
beforeEach(async () => {
  await prisma.order.deleteMany({ where: { customerId: user.id } });
  await prisma.subscription.deleteMany({ where: { userId: user.id } });
  await prisma.deliveryRun.deleteMany({ where: { kitchenId } });
  await prisma.kitchenStaff.upsert({where:{userId_kitchenId:{userId:staff.id,kitchenId}},create:{userId:staff.id,kitchenId},update:{}});
  await prisma.vendor.update({where:{id:vendorId},data:{status:'APPROVED'}});
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
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [user.id, other.id, staff.id] } } });
  await prisma.mealSchedule.deleteMany({ where: { mealId } });
  await prisma.deliveryRun.deleteMany({ where: { kitchenId } });
  await prisma.meal.deleteMany({ where: { id: { in: [mealId,meal2] } } });
  await prisma.kitchen.deleteMany({ where: { id: { in: [kitchenId,kitchen2] } } });
  await prisma.checkpoint.deleteMany({ where: { id: checkpointId } });
  await prisma.timeSlot.deleteMany({ where: { id: timeSlotId } });
  await prisma.city.deleteMany({ where: { id: cityId } });
  await prisma.user.deleteMany({ where: { id: { in: [user.id, other.id, staff.id] } } });
  await prisma.$disconnect();
});

const actor = () => ({ userId: staff.id, role: 'VENDOR' });
const query = () => ({ serviceDate: dateKey(serviceDate), page: 1, pageSize: 20 });
const staffAuth = () => `Bearer ${staff.accessToken}`;
async function item(quantity: number, status: OrderItemStatus = 'CONFIRMED', options: { kitchenId?: string; mealId?: string; paid?: boolean; date?: Date } = {}) {
  const order = await prisma.order.create({ data: {
    customerId: user.id, orderNumber: `KO-${randomUUID()}`, subtotal: 100 * quantity, totalAmount: 100 * quantity,
    status: status === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED',
    payments: { create: { amount: 100 * quantity, status: options.paid === false ? 'CREATED' : 'PAID', lastVerifiedAt: options.paid === false ? null : new Date() } },
    items: { create: { kitchenId: options.kitchenId ?? kitchenId, mealId: options.mealId ?? mealId, checkpointId, timeSlotId, serviceDate: options.date ?? serviceDate, quantity, status, beneficiaryName: 'Rahul', childId, mealNameSnapshot: options.mealId === meal2 ? 'Chicken lunch' : 'Lunch', unitPrice: 100, lineTotal: 100 * quantity } },
  }, include: { items: true } });
  return order.items[0]!;
}
async function update(ids: string[], status: string, kitchen = kitchenId, date = dateKey(serviceDate)) {
  return api().post(`/api/v1/kitchen/${kitchen}/items/status`).set('Authorization',staffAuth()).send({serviceDate:date,orderItemIds:ids,status});
}

describe('kitchen daily operations', () => {
  it('counts quantities, groups actual routes and excludes unpaid/foreign/cancelled dates', async () => {
    await item(3); await item(2,'PREPARING');
    const packed=await item(5,'PACKED',{mealId:meal2});
    await item(99,'CONFIRMED',{paid:false});await item(99,'CANCELLED');await item(99,'CONFIRMED',{kitchenId:kitchen2});await item(99,'CONFIRMED',{date:nextDate});
    const run=await prisma.deliveryRun.create({data:{kitchenId,timeSlotId,serviceDate,stops:{create:{checkpointId,sequence:1}}},include:{stops:true}});
    await prisma.delivery.create({data:{orderItemId:packed.id,deliveryStopId:run.stops[0]!.id}});
    const d=await kitchenDashboard(actor(),kitchenId,query());
    expect(d.totalMeals).toBe(10);expect(d.counts).toEqual({confirmed:3,preparing:2,packed:5,handedOver:0});
    expect(d.byMealType).toEqual(expect.arrayContaining([{key:'VEG',label:'VEG',quantity:5},{key:'NON_VEG',label:'NON_VEG',quantity:5}]));
    expect(d.byCheckpoint[0]?.quantity).toBe(10);expect(d.byTimeSlot[0]?.quantity).toBe(10);
    expect(d.byRoute).toEqual(expect.arrayContaining([{key:'UNASSIGNED',label:'Unassigned route',quantity:5},{key:run.id,label:`Route ${run.id}`,quantity:5}]));
    expect(d.drops).toHaveLength(1);expect(d.drops[0]).toMatchObject({startMinute:750,checkpoint:'ABC College Gate A',quantity:10});
    expect(d.groups).toHaveLength(2);expect(d.byMealPeriod[0]?.label).toBe('LUNCH');
  });
  it('keeps day totals correct when the worklist is paginated', async () => {
    await item(4);await item(6,'CONFIRMED',{mealId:meal2});
    const d=await kitchenDashboard(actor(),kitchenId,{...query(),pageSize:1});
    expect(d.groups).toHaveLength(1);expect(d.totalGroups).toBe(2);expect(d.totalMeals).toBe(10);
    expect((await kitchenDashboard(actor(),kitchenId,{...query(),page:2,pageSize:1})).groups).toHaveLength(1);
  });
  it('shows packing beneficiaries, quantities and child allergies', async () => {
    await prisma.child.update({where:{id:childId},data:{allergies:'Peanuts'}});
    await item(3,'PREPARING');
    const list=await packingList(actor(),kitchenId,query());
    expect(list.items[0]).toMatchObject({beneficiary:'Rahul',allergies:'Peanuts',quantity:3,status:'PREPARING'});
  });
  it('supports only confirmed → preparing → packed and records timestamps/audit', async () => {
    const i=await item(3);
    const skip=await update([i.id],'PACKED');expect(skip.body.data.skipped).toHaveLength(1);
    const preparing=await update([i.id],'PREPARING');expect(preparing.body.data.updated).toEqual([i.id]);
    const packed=await update([i.id],'PACKED');expect(packed.body.data.updated).toEqual([i.id]);
    const row=await prisma.orderItem.findUniqueOrThrow({where:{id:i.id}});
    expect(row.preparingAt).not.toBeNull();expect(row.packedAt).not.toBeNull();
    const alerts=await prisma.notification.findMany({where:{eventKey:{startsWith:'item:'+i.id+':'},channel:'IN_APP',status:'SENT'}});
    expect(alerts.map(n=>n.type).sort()).toEqual(['meal.packed','meal.preparing']);
    expect((await update([i.id],'PREPARING')).body.data.skipped).toHaveLength(1);
    expect(await prisma.auditLog.count({where:{entityId:i.id,action:'kitchen.preparation.updated'}})).toBe(2);
    expect((await prisma.order.findUniqueOrThrow({where:{id:i.orderId}})).status).toBe('PACKED');
  });
  it('deduplicates concurrent staff updates without overwriting timestamps', async () => {
    const i=await item(1);
    const results=await Promise.all([update([i.id],'PREPARING'),update([i.id],'PREPARING')]);
    expect(results.flatMap(r=>r.body.data.updated)).toEqual([i.id]);
    expect(results.flatMap(r=>r.body.data.unchanged)).toEqual([i.id]);
    expect(await prisma.auditLog.count({where:{entityId:i.id,action:'kitchen.preparation.updated'}})).toBe(1);
  });
  it('advances exactly the selected group and leaves other meals/dates alone', async () => {
    const a=await item(2);const b=await item(3);const c=await item(7,'CONFIRMED',{mealId:meal2});
    const d=await kitchenDashboard(actor(),kitchenId,query());const group=d.groups.find(g=>g.mealId===mealId)!;
    const response=await api().post(`/api/v1/kitchen/${kitchenId}/groups/status`).set('Authorization',staffAuth()).send({serviceDate:dateKey(serviceDate),timeSlotId,checkpointId,mealId,mealName:group.mealName,routeId:null,status:'PREPARING'}).expect(200);
    expect(response.body.data.updated.sort()).toEqual([a.id,b.id].sort());
    expect((await prisma.orderItem.findUniqueOrThrow({where:{id:c.id}})).status).toBe('CONFIRMED');
    expect((await update([c.id],'PREPARING',kitchenId,dateKey(nextDate))).body.data.skipped).toHaveLength(1);
  });
  it('restricts staff to their kitchen even when both kitchens share an owner', async () => {
    const foreign=await item(8,'CONFIRMED',{kitchenId:kitchen2});
    const options=await api().get('/api/v1/kitchen/kitchens').set('Authorization',staffAuth()).expect(200);
    expect(options.body.data.map((k:{id:string})=>k.id)).toEqual([kitchenId]);
    await api().get(`/api/v1/kitchen/${kitchen2}/dashboard?serviceDate=${dateKey(serviceDate)}`).set('Authorization',staffAuth()).expect(404);
    expect((await update([foreign.id],'PREPARING',kitchen2)).status).toBe(404);
    expect((await update([foreign.id],'PREPARING')).body.data.skipped[0].reason).toBe('Order item not found');
    const owner=await api().get('/api/v1/kitchen/kitchens').set('Authorization',`Bearer ${other.accessToken}`).expect(200);
    expect(owner.body.data.map((k:{id:string})=>k.id).sort()).toEqual([kitchenId,kitchen2].sort());
    await api().get('/api/v1/vendor/orders').set('Authorization',staffAuth()).expect(404);
  });
  it('revokes access immediately, blocks customers and suspended kitchens', async () => {
    const i=await item(1);
    await api().get('/api/v1/kitchen/kitchens').set('Authorization',`Bearer ${user.accessToken}`).expect(403);
    await api().get('/api/v1/kitchen/kitchens').expect(401);
    await prisma.vendor.update({where:{id:vendorId},data:{status:'SUSPENDED'}});
    expect((await update([i.id],'PREPARING')).status).toBe(403);
    expect((await kitchenDashboard(actor(),kitchenId,query())).kitchen.canUpdate).toBe(false);
    await prisma.kitchenStaff.deleteMany({where:{userId:staff.id,kitchenId}});
    await api().get(`/api/v1/kitchen/${kitchenId}/packing`).set('Authorization',staffAuth()).expect(404);
  });
  it('rejects unpaid preparation, invalid dates and attempts to skip the workflow', async () => {
    const i=await item(2,'CONFIRMED',{paid:false});
    expect((await update([i.id],'PREPARING')).body.data.skipped[0].reason).toContain('verified');
    expect((await update([i.id],'CONFIRMED')).status).toBe(422);
    await api().get(`/api/v1/kitchen/${kitchenId}/dashboard?serviceDate=2026-02-30`).set('Authorization',staffAuth()).expect(422);
  });
});
