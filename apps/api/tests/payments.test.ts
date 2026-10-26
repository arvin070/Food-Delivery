import { createHash, createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/core/prisma';
import { api, registerUser } from './helpers';
import { addDays, cityToday, dateKey } from '../src/modules/subscriptions/recurrence';
import { createPayment, getPayment, getReceipt, refreshPayment, refundPayment, simulatePayment, verifyPayment, reconcilePayments } from '../src/modules/payments/payment.service';
import { mock } from '../src/modules/payments/providers';
import { cancelOrder } from '../src/modules/orders/order.service';
import { updateOrderItemStatus, bulkUpdateOrderItemStatus } from '../src/modules/vendor/order.service';
const paymentIds: string[] = [];
const webhookDigests: string[] = [];
const secret = 'integration-test-webhook-secret';
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
  await prisma.mockProviderRefund.deleteMany({ where: { paymentId: { in: paymentIds.map(id => `mock_pay_${id}`) } } });
  await prisma.mockProviderPayment.deleteMany({ where: { id: { in: paymentIds } } });
  await prisma.paymentWebhook.deleteMany({ where: { digest: { in: webhookDigests } } });
  await prisma.$disconnect();
});

async function order() {
  const row = await prisma.order.create({ data: {
    orderNumber: `PAY-${randomUUID()}`, customerId: user.id, cityId, subtotal: 100, totalAmount: 100,
    items: { create: { mealScheduleId: scheduleId, mealId, kitchenId, checkpointId, timeSlotId, serviceDate, childId, beneficiaryName: 'Rahul', mealNameSnapshot: 'Lunch', unitPrice: 100, lineTotal: 100 } },
    payments: { create: { amount: 100 } },
  }, include: { items: true, payments: true } });
  await prisma.mealSchedule.update({ where: { id: scheduleId }, data: { reservedQuantity: { increment: 1 } } });
  paymentIds.push(row.payments[0]!.id);
  return row;
}
function signature(orderId: string, paymentId: string) { return createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex'); }
async function webhook(paymentId: string, valid = true) {
  const raw = JSON.stringify({ paymentId });
  webhookDigests.push(createHash('sha256').update(raw).digest('hex'));
  return api().post('/api/v1/payments/webhooks/mock').set('Content-Type','application/json')
    .set('x-payment-signature', valid ? createHmac('sha256',secret).update(raw).digest('hex') : '0'.repeat(64)).send(raw);
}

describe('payment verification and billing', () => {
  it('creates one provider order under concurrent requests and uses server totals', async () => {
    const o = await order();
    const results = await Promise.allSettled([createPayment(user.id,o.id),createPayment(user.id,o.id)]);
    expect(results.some(r => r.status === 'fulfilled')).toBe(true);
    const retry = await createPayment(user.id,o.id);
    expect(retry.checkout.amount).toBe(10000);
    expect(await prisma.payment.count({ where: { orderId: o.id } })).toBe(1);
    expect(await prisma.mockProviderPayment.count({ where: { id: retry.payment.id } })).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id:o.id } })).status).toBe('AWAITING_PAYMENT');
    await api().post('/api/v1/payments').set('Authorization',`Bearer ${user.accessToken}`).send({ orderId:o.id, amount:1, cardNumber:'4111111111111111' }).expect(422);
  });
  it('does not confirm authorized payments, and confirms only a fetched capture', async () => {
    const o = await order(); const p = await createPayment(user.id,o.id);
    await simulatePayment(user.id,p.payment.id,'authorized');
    expect((await getPayment(user.id,p.payment.id)).status).toBe('AUTHORIZED');
    expect((await prisma.order.findUniqueOrThrow({ where:{ id:o.id } })).status).toBe('AWAITING_PAYMENT');
    await mock.simulate(p.checkout.orderId!, 'captured');
    const input = { providerPaymentId:`mock_pay_${p.payment.id}`, signature:signature(p.checkout.orderId!,`mock_pay_${p.payment.id}`) };
    await Promise.all([verifyPayment(user.id,p.payment.id,input),verifyPayment(user.id,p.payment.id,input)]);
    expect((await prisma.order.findUniqueOrThrow({ where:{ id:o.id } })).status).toBe('CONFIRMED');
    expect((await prisma.orderItem.findUniqueOrThrow({ where:{ id:o.items[0]!.id } })).status).toBe('CONFIRMED');
    expect(await prisma.paymentReceipt.count({ where:{ paymentId:p.payment.id } })).toBe(1);
    expect(await prisma.notification.count({where:{eventKey:'payment:'+p.payment.id+':successful',channel:'IN_APP',status:'SENT'}})).toBe(1);
    expect(await prisma.notification.count({where:{eventKey:'order:'+o.id+':confirmed',channel:'IN_APP',status:'SENT'}})).toBe(1);
  });
  it('rejects forged signatures and provider order, amount and currency mismatches', async () => {
    const o=await order(); const p=await createPayment(user.id,o.id);
    const paymentId=`mock_pay_${p.payment.id}`;
    await expect(verifyPayment(user.id,p.payment.id,{ providerPaymentId:paymentId,signature:'0'.repeat(64) })).rejects.toThrow('signature');
    const original=await mock.fetchPayment(paymentId);
    for (const mismatch of [{amount:1},{currency:'USD'},{orderId:'another_order'}]) {
      const spy=vi.spyOn(mock,'fetchPayment').mockResolvedValue({ ...original,...mismatch,status:'captured' });
      try { await expect(verifyPayment(user.id,p.payment.id,{providerPaymentId:paymentId,signature:signature(p.checkout.orderId!,paymentId)})).rejects.toThrow('match'); }
      finally { spy.mockRestore(); }
    }
    expect((await prisma.order.findUniqueOrThrow({where:{id:o.id}})).status).toBe('AWAITING_PAYMENT');
  });
  it('verifies raw webhook bytes and handles duplicate delivery without duplicate receipts', async () => {
    const o=await order(); const p=await createPayment(user.id,o.id);
    const paymentId=`mock_pay_${p.payment.id}`;
    expect((await webhook(paymentId,false)).status).toBe(400);
    await mock.simulate(p.checkout.orderId!,'captured');
    expect((await webhook(paymentId)).status).toBe(200);
    expect((await webhook(paymentId)).status).toBe(200);
    expect(await prisma.paymentReceipt.count({where:{paymentId:p.payment.id}})).toBe(1);
    const digest=webhookDigests[webhookDigests.length-1]!;
    expect(await prisma.paymentWebhook.count({where:{digest}})).toBe(1);
    const raw=JSON.stringify({paymentId});
    await api().post('/api/v1/payments/webhooks/mock').set('Content-Type','application/json').set('x-payment-signature',createHmac('sha256',secret).update(raw).digest('hex')).send(` ${raw}`).expect(400);
  });
  it('allows retry after failed/cancelled payment, but stale failure never overwrites capture', async () => {
    const o=await order(); const p=await createPayment(user.id,o.id);
    await simulatePayment(user.id,p.payment.id,'failed');
    expect((await prisma.order.findUniqueOrThrow({where:{id:o.id}})).status).toBe('PAYMENT_FAILED');
    expect(await prisma.notification.count({where:{eventKey:'payment-attempt:mock_pay_'+p.payment.id+':failed',channel:'IN_APP',status:'SENT'}})).toBe(1);
    expect((await createPayment(user.id,o.id)).payment.id).toBe(p.payment.id);
    await simulatePayment(user.id,p.payment.id,'cancelled');
    expect((await getPayment(user.id,p.payment.id)).status).toBe('CANCELLED');
    await simulatePayment(user.id,p.payment.id,'captured');
    const captured=await mock.fetchPayment(`mock_pay_${p.payment.id}`);
    const spy=vi.spyOn(mock,'fetchPayment').mockResolvedValue({...captured,status:'failed'});
    try { await refreshPayment(user.id,p.payment.id); } finally { spy.mockRestore(); }
    expect((await getPayment(user.id,p.payment.id)).status).toBe('PAID');
  });
  it('records late capture for a cancelled order without resurrecting meals', async () => {
    const o=await order(); const p=await createPayment(user.id,o.id);
    await cancelOrder(user.id,o.id,{});
    await simulatePayment(user.id,p.payment.id,'captured');
    expect((await getPayment(user.id,p.payment.id)).status).toBe('PAID');
    expect((await prisma.order.findUniqueOrThrow({where:{id:o.id}})).status).toBe('CANCELLED');
    expect((await prisma.mealSchedule.findUniqueOrThrow({where:{id:scheduleId}})).reservedQuantity).toBe(0);
  });
  it('handles partial and full refunds, idempotent retries and immutable receipts', async () => {
    const o=await order(); const p=await createPayment(user.id,o.id); await simulatePayment(user.id,p.payment.id,'captured');
    const receipt=await getReceipt(user.id,p.payment.id);
    await cancelOrder(user.id,o.id,{});
    const data={idempotencyKey:randomUUID(),amount:'40.00',reason:'Partial adjustment'};
    const [a,b]=await Promise.all([refundPayment(user.id,p.payment.id,data,true),refundPayment(user.id,p.payment.id,data,true)]);
    expect(a.id).toBe(b.id);
    expect((await getPayment(user.id,p.payment.id)).status).toBe('PARTIALLY_REFUNDED');
    await refundPayment(user.id,p.payment.id,{idempotencyKey:randomUUID(),reason:'Remaining balance'});
    const result=await getPayment(user.id,p.payment.id);
    expect(result.status).toBe('REFUNDED'); expect(result.refundedAmount.toString()).toBe('100');
    expect((await getReceipt(user.id,p.payment.id)).snapshot).toEqual(receipt.snapshot);
    expect((await prisma.order.findUniqueOrThrow({where:{id:o.id}})).status).toBe('REFUNDED');
  });
  it('reserves refunds before calling the provider and prevents over-refunds', async () => {
    const o=await order();const p=await createPayment(user.id,o.id);await simulatePayment(user.id,p.payment.id,'captured');await cancelOrder(user.id,o.id,{});
    const results=await Promise.allSettled([refundPayment(user.id,p.payment.id,{idempotencyKey:randomUUID(),amount:'80',reason:'A'},true),refundPayment(user.id,p.payment.id,{idempotencyKey:randomUUID(),amount:'80',reason:'B'},true)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const sum=await prisma.refund.aggregate({where:{paymentId:p.payment.id,status:{in:['PENDING','PROCESSED']}},_sum:{amount:true}});
    expect(sum._sum.amount?.toString()).toBe('80');
  });
  it('leaves uncertain refunds pending and safely retries the same provider key', async () => {
    const o=await order();const p=await createPayment(user.id,o.id);await simulatePayment(user.id,p.payment.id,'captured');await cancelOrder(user.id,o.id,{});
    const real=mock.refund.bind(mock);
    const spy=vi.spyOn(mock,'refund').mockImplementationOnce(async (...args)=>{await real(...args);throw new Error('Lost provider response');});
    const data={idempotencyKey:randomUUID(),reason:'Cancellation'};
    try { await expect(refundPayment(user.id,p.payment.id,data)).rejects.toThrow('Lost'); } finally { spy.mockRestore(); }
    expect((await prisma.refund.findUniqueOrThrow({where:{idempotencyKey:data.idempotencyKey}})).status).toBe('PENDING');
    await refundPayment(user.id,p.payment.id,data);
    expect(await prisma.mockProviderRefund.count({where:{paymentId:`mock_pay_${p.payment.id}`}})).toBe(1);
  });
  it('recovers a provider creation accepted before a timeout without issuing another order', async () => {
    const o=await order(); const real=mock.createOrder.bind(mock);
    const spy=vi.spyOn(mock,'createOrder').mockImplementationOnce(async input=>{await real(input);throw new Error('Lost response');});
    try {await expect(createPayment(user.id,o.id)).rejects.toThrow('Lost');} finally {spy.mockRestore();}
    const recovered=await createPayment(user.id,o.id);
    expect(recovered.payment.providerOrderId).toBeTruthy();
    expect(await prisma.mockProviderPayment.count({where:{id:recovered.payment.id}})).toBe(1);
  });
  it('blocks vendor confirmation and bulk preparation until verified payment', async () => {
    const o=await order();
    await expect(updateOrderItemStatus(vendorId,o.items[0]!.id,{status:'CONFIRMED'})).rejects.toThrow('verified');
    const bulk=await bulkUpdateOrderItemStatus(vendorId,{orderItemIds:[o.items[0]!.id],status:'CONFIRMED'});
    expect(bulk.updated).toHaveLength(0);
    const p=await createPayment(user.id,o.id);await simulatePayment(user.id,p.payment.id,'captured');
    expect((await updateOrderItemStatus(vendorId,o.items[0]!.id,{status:'PREPARING'})).status).toBe('PREPARING');
  });
  it('isolates customer payment history, refunds, receipts and simulation', async () => {
    const o=await order();const p=await createPayment(user.id,o.id);
    const auth=`Bearer ${other.accessToken}`;
    await api().get(`/api/v1/payments/${p.payment.id}`).set('Authorization',auth).expect(404);
    await api().get(`/api/v1/payments/${p.payment.id}/receipt`).set('Authorization',auth).expect(404);
    await api().post(`/api/v1/payments/${p.payment.id}/simulate`).set('Authorization',auth).send({status:'captured'}).expect(404);
    await api().post(`/api/v1/payments/${p.payment.id}/refunds`).set('Authorization',auth).send({idempotencyKey:randomUUID(),reason:'Not mine'}).expect(404);
    await api().post(`/api/v1/admin/payments/${p.payment.id}/refunds`).set('Authorization',auth).send({idempotencyKey:randomUUID(),reason:'Not admin'}).expect(403);
    await api().get('/api/v1/payments').expect(401);
    const history=await api().get('/api/v1/payments').set('Authorization',`Bearer ${user.accessToken}`).expect(200);
    expect(history.body.data[0].id).toBe(p.payment.id);
    expect(history.body.data[0]).not.toHaveProperty('rawPayload');
  });
  it('background reconciliation settles a captured payment without a browser callback', async () => {
    const o=await order();const p=await createPayment(user.id,o.id);await mock.simulate(p.checkout.orderId!,'captured');
    await reconcilePayments();
    expect((await getPayment(user.id,p.payment.id)).status).toBe('PAID');
  });
});
