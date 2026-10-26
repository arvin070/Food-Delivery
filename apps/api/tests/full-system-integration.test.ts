import { reconcileOrderStatus } from '../src/modules/orders/reconcile-status';
/**
 * Module 21 — Full System Integration Test Suite
 *
 * Exercises the end-to-end integration across all 20 modules:
 * 1. Complete multi-persona ordering lifecycle (Parent -> Child -> Menu -> Checkpoint -> Slot -> Cart -> Checkout -> Payment -> Kitchen Prep -> Packing -> Route -> Rider Pickup -> Delivery -> OTP Handover -> Parent Confirmation).
 * 2. Cross-dashboard status consistency across Customer, Vendor, Rider, and Admin surfaces.
 * 3. Payment failure and recovery workflow.
 * 4. Pre- and post-payment cancellation workflows with inventory and refund verification.
 * 5. Delivery failure, wrong OTP handling, and complaint filing/resolution.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { api, registerUser, type RegisteredUser } from './helpers';
import { mock } from '../src/modules/payments/providers';
import { prisma } from '../src/core/prisma';
import { cityToday, dateKey } from '../src/modules/subscriptions/recurrence';

const timezone = new Date().getUTCHours() < 20 ? 'UTC' : 'Pacific/Honolulu';
const today = cityToday(timezone);
const serviceDateStr = dateKey(today);

let parentUser: RegisteredUser;
let vendorUser: RegisteredUser;
let riderUser: RegisteredUser;
let riderUser2: RegisteredUser;
let riderUser3: RegisteredUser;
let partnerId3: string;
let adminToken: string;

let cityId: string;
let institutionId: string;
let checkpointId: string;
let timeSlotId: string;
let kitchenId: string;
let mealId: string;
let scheduleId: string;
let partnerId: string;
let partnerId2: string;

// Tracked entities for cleanup
const createdOrderIds: string[] = [];
const createdRouteIds: string[] = [];

beforeAll(async () => {
  // 1. Create and setup users with distinct roles
  parentUser = await registerUser({ role: 'PARENT' });
  vendorUser = await registerUser();
  riderUser = await registerUser();
  riderUser2 = await registerUser();
  riderUser3 = await registerUser();
  await prisma.user.update({ where: { id: riderUser3.id }, data: { role: 'DELIVERY_PARTNER' } });

  await prisma.user.update({
    where: { id: vendorUser.id },
    data: { role: 'VENDOR' },
  });
  await prisma.user.update({
    where: { id: riderUser.id },
    data: { role: 'DELIVERY_PARTNER' },
  });
  await prisma.user.update({
    where: { id: riderUser2.id },
    data: { role: 'DELIVERY_PARTNER' },
  });

  // 2. Admin login
  const adminLogin = await api()
    .post('/api/v1/auth/login')
    .send({ identifier: 'admin@lunch.test', password: 'Lunch@1234' })
    .expect(200);
  adminToken = 'Bearer ' + adminLogin.body.data.tokens.accessToken;

  // 3. Setup city, institution, checkpoint, time slot
  cityId = (
    await prisma.city.create({
      data: { name: 'Integration City ' + randomUUID(), state: 'Test', timezone },
    })
  ).id;

  institutionId = (
    await prisma.institution.create({
      data: { name: 'Full System Model College', type: 'COLLEGE', cityId },
    })
  ).id;

  checkpointId = (
    await prisma.checkpoint.create({
      data: {
        cityId,
        institutionId,
        name: 'Main Gate Checkpoint',
        type: 'COLLEGE_GATE',
        deliveryCapacity: 100,
      },
    })
  ).id;

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  const minute = Number(parts.hour) * 60 + Number(parts.minute) + 60;

  timeSlotId = (
    await prisma.timeSlot.create({
      data: {
        cityId,
        label: 'Lunch Break Slot',
        mealPeriod: 'LUNCH',
        startMinute: minute,
        endMinute: minute + 45,
        orderCutoffMinutes: 0,
      },
    })
  ).id;

  await prisma.checkpointTimeSlot.create({
    data: { checkpointId, timeSlotId, maxOrders: 100 },
  });

  // 4. Setup vendor, kitchen, service area, and meal schedule
  const vendor = await prisma.vendor.create({
    data: {
      ownerUserId: vendorUser.id,
      businessName: 'System Integration Kitchens',
      status: 'APPROVED',
    },
  });

  kitchenId = (
    await prisma.kitchen.create({
      data: {
        vendorId: vendor.id,
        cityId,
        name: 'Central Prep Kitchen',
        capacityPerSlot: 100,
      },
    })
  ).id;

  await prisma.kitchenServiceArea.create({
    data: { checkpointId, kitchenId },
  });

  mealId = (
    await prisma.meal.create({
      data: {
        vendorId: vendor.id,
        kitchenId,
        name: 'Integrated Deluxe Thali',
        slug: 'integrated-thali-' + randomUUID(),
        basePrice: 150,
        foodType: 'VEG',
        mealPeriods: ['LUNCH'],
      },
    })
  ).id;

  scheduleId = (
    await prisma.mealSchedule.create({
      data: {
        mealId,
        kitchenId,
        timeSlotId,
        serviceDate: today,
        totalQuantity: 50,
        price: 150,
        status: 'PUBLISHED',
      },
    })
  ).id;

  // 5. Setup delivery partners
  partnerId = (
    await prisma.deliveryPartner.create({
      data: { userId: riderUser.id, cityId, isAvailable: true },
    })
  ).id;

  partnerId3 = (await prisma.deliveryPartner.create({ data: { userId: riderUser3.id, cityId, isAvailable: true } })).id;
  partnerId2 = (
    await prisma.deliveryPartner.create({
      data: { userId: riderUser2.id, cityId, isAvailable: true },
    })
  ).id;
});

afterAll(async () => {
  vi.restoreAllMocks();
  if (createdOrderIds.length > 0) {
    const payments = await prisma.payment.findMany({ where: { orderId: { in: createdOrderIds } }, select: { id: true } });
    await prisma.mockProviderRefund.deleteMany({ where: { paymentId: { in: payments.map(p => 'mock_pay_' + p.id) } } });
    await prisma.mockProviderPayment.deleteMany({ where: { id: { in: payments.map(p => p.id) } } });
    await prisma.complaint.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.delivery.deleteMany({ where: { orderItem: { orderId: { in: createdOrderIds } } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.refund.deleteMany({ where: { payment: { orderId: { in: createdOrderIds } } } });
    await prisma.payment.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  }
  if (createdRouteIds.length > 0) {
    await prisma.deliveryStop.deleteMany({ where: { deliveryRunId: { in: createdRouteIds } } });
    await prisma.deliveryRun.deleteMany({ where: { id: { in: createdRouteIds } } });
  }
  if (parentUser) await prisma.child.deleteMany({ where: { parentId: parentUser.id } });
  if (kitchenId) {
    await prisma.kitchenServiceArea.deleteMany({ where: { kitchenId } });
    await prisma.kitchen.delete({ where: { id: kitchenId } });
  }
  if (mealId) {
    await prisma.mealSchedule.deleteMany({ where: { mealId } });
    await prisma.meal.delete({ where: { id: mealId } });
  }
  if (checkpointId) {
    await prisma.checkpointTimeSlot.deleteMany({ where: { checkpointId } });
    await prisma.checkpoint.delete({ where: { id: checkpointId } });
  }
  if (timeSlotId) await prisma.timeSlot.delete({ where: { id: timeSlotId } });
  if (institutionId) await prisma.institution.delete({ where: { id: institutionId } });
  if (cityId) await prisma.city.delete({ where: { id: cityId } });
  await prisma.user.deleteMany({
    where: { id: { in: [parentUser?.id, vendorUser?.id, riderUser?.id, riderUser2?.id, riderUser3?.id].filter(Boolean) } },
  });
});

describe('Module 21 — Full System Integration Workflows', () => {
  it('executes the full happy path workflow and synchronizes status across all 4 dashboards', async () => {
    // A. Parent login via cookie-enabled session
    const login = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: parentUser.email, password: parentUser.password })
      .expect(200);

    const cookie = login.headers['set-cookie']
      .map((c: string) => c.split(';')[0])
      .join('; ');
    const parentHeaders = { Cookie: cookie, Origin: 'http://localhost:3000' };

    // B. Parent creates a child record
    const childRes = await api()
      .post('/api/v1/children')
      .set(parentHeaders)
      .send({
        fullName: 'Aarav Sharma',
        institutionId,
        defaultCheckpointId: checkpointId,
        defaultTimeSlotId: timeSlotId,
      })
      .expect(201);
    const childId = childRes.body.data.child.id;
    expect(childId).toBeDefined();

    // C. Parent discovers delivery slots and meal catalog
    const slots = await api()
      .get('/api/v1/catalog/delivery-slots')
      .set(parentHeaders)
      .query({ checkpointId, serviceDate: serviceDateStr })
      .expect(200);
    expect(slots.body.data.slots.some((s: { timeSlotId: string }) => s.timeSlotId === timeSlotId)).toBe(true);

    const meals = await api()
      .get('/api/v1/catalog/meals')
      .set(parentHeaders)
      .query({ checkpointId, timeSlotId, serviceDate: serviceDateStr })
      .expect(200);
    expect(meals.body.data.some((m: { mealScheduleId: string }) => m.mealScheduleId === scheduleId)).toBe(true);

    // D. Parent adds meal to cart with child beneficiary
    await api()
      .post('/api/v1/cart/items')
      .set(parentHeaders)
      .send({
        mealScheduleId: scheduleId,
        checkpointId,
        timeSlotId,
        childId,
        quantity: 1,
      })
      .expect(201);

    // E. Checkout atomically
    const idempotencyKey = randomUUID();
    const checkoutRes = await api()
      .post('/api/v1/orders/checkout')
      .set(parentHeaders)
      .send({ idempotencyKey })
      .expect(201);

    const orderId = checkoutRes.body.data.order.id;
    const itemId = checkoutRes.body.data.order.items[0].id;
    createdOrderIds.push(orderId);

    expect(checkoutRes.body.data.order.status).toBe('AWAITING_PAYMENT');
    expect(checkoutRes.body.data.order.items[0].beneficiaryName).toBe('Aarav Sharma');

    // F. Verify unpaid items cannot be prepared by kitchen
    const vendorHeaders = { Authorization: 'Bearer ' + vendorUser.accessToken };
    const prepUrl = `/api/v1/kitchen/${kitchenId}/items/status`;

    const unpaidAttempt = await api()
      .post(prepUrl)
      .set(vendorHeaders)
      .send({ serviceDate: serviceDateStr, orderItemIds: [itemId], status: 'PREPARING' })
      .expect(200);
    expect(unpaidAttempt.body.data.updated).toEqual([]);

    const unpaidDashboard = await api().get('/api/v1/vendor/dashboard').set(vendorHeaders).expect(200);
    expect(unpaidDashboard.body.data.dashboard.today.toPrepare).toBe(0);
    expect(unpaidDashboard.body.data.dashboard.revenue.today).toBe('0.00');

    // G. Payment initialization and simulation
    const paymentRes = await api()
      .post('/api/v1/payments')
      .set(parentHeaders)
      .send({ orderId })
      .expect(201);
    const paymentId = paymentRes.body.data.payment.id;

    const paidRes = await api()
      .post(`/api/v1/payments/${paymentId}/simulate`)
      .set(parentHeaders)
      .send({ status: 'captured' })
      .expect(200);
    expect(paidRes.body.data.status).toBe('PAID');

    // H. Verify order status transitions to CONFIRMED
    const confirmedOrder = await api()
      .get(`/api/v1/orders/${orderId}`)
      .set(parentHeaders)
      .expect(200);
    expect(confirmedOrder.body.data.order.status).toBe('CONFIRMED');

    await assertViews(orderId, 'CONFIRMED');

    // I. Kitchen prepares and packs the meal
    for (const status of ['PREPARING', 'PACKED']) {
      const prepRes = await api()
        .post(prepUrl)
        .set(vendorHeaders)
        .send({ serviceDate: serviceDateStr, orderItemIds: [itemId], status })
        .expect(200);
      expect(prepRes.body.data.updated).toEqual([itemId]);
      await assertViews(orderId, status);
    }

    // J. Admin creates delivery route
    const routeRes = await api()
      .post('/api/v1/admin/routes')
      .set('Authorization', adminToken)
      .send({
        name: 'Model College Route',
        date: serviceDateStr,
        kitchenId,
        deliveryPartnerId: partnerId,
        checkpointIds: [checkpointId],
        orderItemIds: [itemId],
        idempotencyKey: randomUUID(),
      })
      .expect(201);

    const routeId = routeRes.body.data.route.id;
    const stopId = routeRes.body.data.route.stops[0].id;
    createdRouteIds.push(routeId);

    await assertViews(orderId, 'ASSIGNED');

    // K. Delivery rider workflow: dashboard -> pickup -> start -> arrive
    const riderHeaders = { Authorization: 'Bearer ' + riderUser.accessToken };

    const dashboard = await api()
      .get('/api/v1/delivery/dashboard')
      .set(riderHeaders)
      .expect(200);
    expect(dashboard.body.data.routes.some((r: { id: string }) => r.id === routeId)).toBe(true);

    await api()
      .post(`/api/v1/delivery/routes/${routeId}/pickup`)
      .set(riderHeaders)
      .expect(200);

    await api()
      .post(`/api/v1/delivery/routes/${routeId}/start`)
      .set(riderHeaders)
      .expect(200);

    await api()
      .post(`/api/v1/delivery/routes/${routeId}/stops/${stopId}/arrive`)
      .set(riderHeaders)
      .expect(200);

    await assertViews(orderId, 'AT_CHECKPOINT');

    // L. Parent requests delivery code
    const deliveryRecord = await prisma.delivery.findUniqueOrThrow({
      where: { orderItemId: itemId },
    });

    const codeRes = await api()
      .post(`/api/v1/orders/${orderId}/items/${itemId}/delivery-code`)
      .set(parentHeaders)
      .expect(200);
    const validOtp = codeRes.body.data.code;
    expect(validOtp).toMatch(/^\d{6}$/);

    // M. Rider delivers item with OTP verification
    const deliverRes = await api()
      .patch(`/api/v1/delivery/items/${deliveryRecord.id}/status`)
      .set(riderHeaders)
      .send({
        status: 'DELIVERED',
        receiverName: 'Aarav Sharma',
        otp: validOtp,
      })
      .expect(200);
    expect(deliverRes.body.data.delivery.status).toBe('DELIVERED');

    await assertViews(orderId, 'DELIVERED');
    const completedRoute = await api().get('/api/v1/delivery/dashboard').set(riderHeaders).expect(200);
    expect(completedRoute.body.data.routes.find((r: {id: string}) => r.id === routeId).status).toBe('COMPLETED');

    // N. Parent receives confirmation notification
    const notifications = await api()
      .get('/api/v1/notifications')
      .set(parentHeaders)
      .expect(200);
    const deliveryNote = notifications.body.data.items.find(
      (n: { type: string }) => n.type === 'delivery.delivered'
    );
    expect(deliveryNote).toBeDefined();
    expect(deliveryNote.body).toContain('Aarav Sharma');
    expect(deliveryNote.body).toContain('Main Gate Checkpoint');

    // O. Cross-Dashboard Status Consistency Verification
    // 1. Customer order view
    const customerOrderView = await api()
      .get(`/api/v1/orders/${orderId}`)
      .set(parentHeaders)
      .expect(200);
    expect(customerOrderView.body.data.order.status).toBe('DELIVERED');
    expect(customerOrderView.body.data.order.items[0].status).toBe('DELIVERED');

    // 2. Vendor order view
    const vendorOrderView = await api()
      .get('/api/v1/vendor/orders')
      .set(vendorHeaders)
      .query({ status: 'DELIVERED', range: 'date', serviceDate: serviceDateStr })
      .expect(200);
    expect(vendorOrderView.body.data.some((i: { id: string }) => i.id === itemId)).toBe(true);

    // 3. Admin order console view
    const adminOrderView = await api()
      .get(`/api/v1/admin/manage/orders/${orderId}`)
      .set('Authorization', adminToken)
      .expect(200);
    expect(adminOrderView.body.data.record.status).toBe('DELIVERED');
  });

  it('handles payment failure and successful recovery', async () => {
    const login = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: parentUser.email, password: parentUser.password })
      .expect(200);
    const cookie = login.headers['set-cookie'].map((c: string) => c.split(';')[0]).join('; ');
    const parentHeaders = { Cookie: cookie, Origin: 'http://localhost:3000' };

    // Add to cart & checkout
    await api()
      .post('/api/v1/cart/items')
      .set(parentHeaders)
      .send({ mealScheduleId: scheduleId, checkpointId, quantity: 1 })
      .expect(201);

    const checkoutRes = await api()
      .post('/api/v1/orders/checkout')
      .set(parentHeaders)
      .send({ idempotencyKey: randomUUID() })
      .expect(201);

    const orderId = checkoutRes.body.data.order.id;
    const itemId = checkoutRes.body.data.order.items[0].id;
    createdOrderIds.push(orderId);

    // Initialize payment
    const paymentRes = await api()
      .post('/api/v1/payments')
      .set(parentHeaders)
      .send({ orderId })
      .expect(201);
    const paymentId = paymentRes.body.data.payment.id;

    // Simulate payment failure
    await api()
      .post(`/api/v1/payments/${paymentId}/simulate`)
      .set(parentHeaders)
      .send({ status: 'failed' })
      .expect(200);

    const failedOrder = await api()
      .get(`/api/v1/orders/${orderId}`)
      .set(parentHeaders)
      .expect(200);
    expect(failedOrder.body.data.order.status).toBe('PAYMENT_FAILED');

    // Kitchen must NOT be able to prepare this order
    const vendorHeaders = { Authorization: 'Bearer ' + vendorUser.accessToken };
    const unpaidAttempt = await api()
      .post(`/api/v1/kitchen/${kitchenId}/items/status`)
      .set(vendorHeaders)
      .send({ serviceDate: serviceDateStr, orderItemIds: [itemId], status: 'PREPARING' })
      .expect(200);
    expect(unpaidAttempt.body.data.updated).toEqual([]);

    // Customer retries payment
    const retryPaymentRes = await api()
      .post('/api/v1/payments')
      .set(parentHeaders)
      .send({ orderId })
      .expect(201);
    const retryPaymentId = retryPaymentRes.body.data.payment.id;

    await api()
      .post(`/api/v1/payments/${retryPaymentId}/simulate`)
      .set(parentHeaders)
      .send({ status: 'captured' })
      .expect(200);

    // Order status is now CONFIRMED
    const recoveredOrder = await api()
      .get(`/api/v1/orders/${orderId}`)
      .set(parentHeaders)
      .expect(200);
    expect(recoveredOrder.body.data.order.status).toBe('CONFIRMED');

    // Kitchen can now prepare
    const prepRes = await api()
      .post(`/api/v1/kitchen/${kitchenId}/items/status`)
      .set(vendorHeaders)
      .send({ serviceDate: serviceDateStr, orderItemIds: [itemId], status: 'PREPARING' })
      .expect(200);
    expect(prepRes.body.data.updated).toEqual([itemId]);
  });

  it('handles cancellation pre-payment, post-payment with refund, and prevents cancellation post-preparation', async () => {
    const login = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: parentUser.email, password: parentUser.password })
      .expect(200);
    const cookie = login.headers['set-cookie'].map((c: string) => c.split(';')[0]).join('; ');
    const parentHeaders = { Cookie: cookie, Origin: 'http://localhost:3000' };

    // 1. Pre-payment cancellation
    await api()
      .post('/api/v1/cart/items')
      .set(parentHeaders)
      .send({ mealScheduleId: scheduleId, checkpointId, quantity: 2 })
      .expect(201);

    const initialSchedule = await prisma.mealSchedule.findUniqueOrThrow({
      where: { id: scheduleId },
      select: { reservedQuantity: true },
    });

    const prePayCheckout = await api()
      .post('/api/v1/orders/checkout')
      .set(parentHeaders)
      .send({ idempotencyKey: randomUUID() })
      .expect(201);
    const prePayOrderId = prePayCheckout.body.data.order.id;
    createdOrderIds.push(prePayOrderId);

    // Cancel while AWAITING_PAYMENT
    const cancelledPrePay = await api()
      .post(`/api/v1/orders/${prePayOrderId}/cancel`)
      .set(parentHeaders)
      .send({ reason: 'Changed mind before paying' })
      .expect(200);
    expect(cancelledPrePay.body.data.order.status).toBe('CANCELLED');

    const afterCancelSchedule = await prisma.mealSchedule.findUniqueOrThrow({
      where: { id: scheduleId },
      select: { reservedQuantity: true },
    });
    expect(afterCancelSchedule.reservedQuantity).toBe(initialSchedule.reservedQuantity);

    // 2. Post-payment cancellation and customer refund request
    await api()
      .post('/api/v1/cart/items')
      .set(parentHeaders)
      .send({ mealScheduleId: scheduleId, checkpointId, quantity: 1 })
      .expect(201);

    const postPayCheckout = await api()
      .post('/api/v1/orders/checkout')
      .set(parentHeaders)
      .send({ idempotencyKey: randomUUID() })
      .expect(201);
    const postPayOrderId = postPayCheckout.body.data.order.id;
    createdOrderIds.push(postPayOrderId);

    const payment = await api()
      .post('/api/v1/payments')
      .set(parentHeaders)
      .send({ orderId: postPayOrderId })
      .expect(201);

    await api()
      .post(`/api/v1/payments/${payment.body.data.payment.id}/simulate`)
      .set(parentHeaders)
      .send({ status: 'captured' })
      .expect(200);

    const cancelledPostPay = await api()
      .post(`/api/v1/orders/${postPayOrderId}/cancel`)
      .set(parentHeaders)
      .send({ reason: 'Child unwell' })
      .expect(200);
    expect(cancelledPostPay.body.data.order.status).toBe('CANCELLED');

    // Customer requests refund for cancelled order
    const refundRes = await api()
      .post(`/api/v1/payments/${payment.body.data.payment.id}/refunds`)
      .set(parentHeaders)
      .send({ idempotencyKey: randomUUID(), reason: 'Child unwell' })
      .expect(201);
    expect(refundRes.body.data.status).toBe('PROCESSED');

    // 3. Prevent cancellation after kitchen starts preparation
    await api()
      .post('/api/v1/cart/items')
      .set(parentHeaders)
      .send({ mealScheduleId: scheduleId, checkpointId, quantity: 1 })
      .expect(201);

    const prepCheckout = await api()
      .post('/api/v1/orders/checkout')
      .set(parentHeaders)
      .send({ idempotencyKey: randomUUID() })
      .expect(201);
    const prepOrderId = prepCheckout.body.data.order.id;
    const prepItemId = prepCheckout.body.data.order.items[0].id;
    createdOrderIds.push(prepOrderId);

    const prepPayment = await api()
      .post('/api/v1/payments')
      .set(parentHeaders)
      .send({ orderId: prepOrderId })
      .expect(201);

    await api()
      .post(`/api/v1/payments/${prepPayment.body.data.payment.id}/simulate`)
      .set(parentHeaders)
      .send({ status: 'captured' })
      .expect(200);

    // Vendor prepares the meal
    const vendorHeaders = { Authorization: 'Bearer ' + vendorUser.accessToken };
    await api()
      .post(`/api/v1/kitchen/${kitchenId}/items/status`)
      .set(vendorHeaders)
      .send({ serviceDate: serviceDateStr, orderItemIds: [prepItemId], status: 'PREPARING' })
      .expect(200);

    // Customer cancellation must now be rejected
    await api()
      .post(`/api/v1/orders/${prepOrderId}/cancel`)
      .set(parentHeaders)
      .send({ reason: 'Too late to cancel' })
      .expect(422);
  });

  it('rejects invalid OTP, handles delivery failure, and resolves customer complaint', async () => {
    const login = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: parentUser.email, password: parentUser.password })
      .expect(200);
    const cookie = login.headers['set-cookie'].map((c: string) => c.split(';')[0]).join('; ');
    const parentHeaders = { Cookie: cookie, Origin: 'http://localhost:3000' };

    await api()
      .post('/api/v1/cart/items')
      .set(parentHeaders)
      .send({ mealScheduleId: scheduleId, checkpointId, quantity: 1 })
      .expect(201);

    const checkout = await api()
      .post('/api/v1/orders/checkout')
      .set(parentHeaders)
      .send({ idempotencyKey: randomUUID() })
      .expect(201);
    const orderId = checkout.body.data.order.id;
    const itemId = checkout.body.data.order.items[0].id;
    createdOrderIds.push(orderId);

    const payment = await api()
      .post('/api/v1/payments')
      .set(parentHeaders)
      .send({ orderId })
      .expect(201);
    await api()
      .post(`/api/v1/payments/${payment.body.data.payment.id}/simulate`)
      .set(parentHeaders)
      .send({ status: 'captured' })
      .expect(200);

    const vendorHeaders = { Authorization: 'Bearer ' + vendorUser.accessToken };
    for (const status of ['PREPARING', 'PACKED']) {
      await api()
        .post(`/api/v1/kitchen/${kitchenId}/items/status`)
        .set(vendorHeaders)
        .send({ serviceDate: serviceDateStr, orderItemIds: [itemId], status })
        .expect(200);
    }

    // Use partnerId2 to ensure distinct partner route per slot
    const routeRes = await api()
      .post('/api/v1/admin/routes')
      .set('Authorization', adminToken)
      .send({
        name: 'Failure Test Route',
        date: serviceDateStr,
        kitchenId,
        deliveryPartnerId: partnerId2,
        checkpointIds: [checkpointId],
        orderItemIds: [itemId],
        idempotencyKey: randomUUID(),
      })
      .expect(201);
    const routeId = routeRes.body.data.route.id;
    const stopId = routeRes.body.data.route.stops[0].id;
    createdRouteIds.push(routeId);

    const riderHeaders = { Authorization: 'Bearer ' + riderUser2.accessToken };
    await api().post(`/api/v1/delivery/routes/${routeId}/pickup`).set(riderHeaders).expect(200);
    await api().post(`/api/v1/delivery/routes/${routeId}/start`).set(riderHeaders).expect(200);
    await api().post(`/api/v1/delivery/routes/${routeId}/stops/${stopId}/arrive`).set(riderHeaders).expect(200);

    const deliveryRecord = await prisma.delivery.findUniqueOrThrow({
      where: { orderItemId: itemId },
    });

    // Parent generates delivery code
    const issuedCode = await api()
      .post(`/api/v1/orders/${orderId}/items/${itemId}/delivery-code`)
      .set(parentHeaders)
      .expect(200);
    const validOtp = issuedCode.body.data.code;
    const wrongOtp = validOtp === '111111' ? '222222' : '111111';

    // 1. Rider submits wrong OTP -> rejected
    await api()
      .patch(`/api/v1/delivery/items/${deliveryRecord.id}/status`)
      .set(riderHeaders)
      .send({
        status: 'DELIVERED',
        receiverName: 'Test Student',
        otp: wrongOtp,
      })
      .expect(400);

    // 2. Rider marks delivery as failed (recipient absent)
    await api()
      .patch(`/api/v1/delivery/items/${deliveryRecord.id}/status`)
      .set(riderHeaders)
      .send({
        status: 'FAILED',
        failureReason: 'Student was not at checkpoint',
      })
      .expect(200);

    // 3. Verify order status reflects FAILED
    const failedOrder = await api()
      .get(`/api/v1/orders/${orderId}`)
      .set(parentHeaders)
      .expect(200);
    expect(failedOrder.body.data.order.status).toBe('FAILED');

    // 4. Customer files a complaint
    const complaintRes = await api()
      .post('/api/v1/complaints')
      .set(parentHeaders)
      .send({
        orderId,
        subject: 'Lunch delivery missed',
        message: 'My child was at the gate but the rider could not find them.',
        idempotencyKey: randomUUID(),
      })
      .expect(201);
    const complaintId = complaintRes.body.data.id;
    expect(complaintId).toBeDefined();

    // 5. Admin views and resolves complaint
    const adminComplaint = await api()
      .get(`/api/v1/admin/manage/complaints/${complaintId}`)
      .set('Authorization', adminToken)
      .expect(200);
    expect(adminComplaint.body.data.record.name).toBe('Lunch delivery missed');

    await api()
      .post(`/api/v1/admin/manage/complaints/${complaintId}/actions`)
      .set('Authorization', adminToken)
      .send({
        action: 'RESOLVE',
        expectedStatus: 'OPEN',
        revision: adminComplaint.body.data.record.revision,
        reason: 'Contacted school supervisor and explained the failed delivery.',
      })
      .expect(200);

    const resolved = await prisma.complaint.findUniqueOrThrow({
      where: { id: complaintId },
    });
    expect(resolved.status).toBe('RESOLVED');
  });
});

/** Compare persisted order state with every order-level read surface. */
async function assertViews(orderId: string, status: string) {
  const customer = await api().get(`/api/v1/orders/${orderId}`).set('Authorization', 'Bearer ' + parentUser.accessToken).expect(200);
  const admin = await api().get(`/api/v1/admin/manage/orders/${orderId}`).set('Authorization', adminToken).expect(200);
  expect(customer.body.data.order.status).toBe(status);
  expect(admin.body.data.record.status).toBe(status);
  if (createdOrderIds.length === 1 && serviceDateStr === new Date().toISOString().slice(0,10)) {
    const overview = await api().get('/api/v1/vendor/dashboard').set('Authorization', 'Bearer ' + vendorUser.accessToken).expect(200);
    expect(overview.body.data.dashboard.revenue.today).toBe('150.00');
  }
  const stored = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  expect(stored.status).toBe(status);
  const filtered = await api().get('/api/v1/orders').set('Authorization', 'Bearer ' + parentUser.accessToken).query({ status }).expect(200);
  expect(filtered.body.data.some((o: {id: string}) => o.id === orderId)).toBe(true);
  for (const item of customer.body.data.order.items) {
    const vendor = await api().get('/api/v1/vendor/orders/' + item.id).set('Authorization', 'Bearer ' + vendorUser.accessToken).expect(200);
    expect(vendor.body.data.orderItem.status).toBe(item.status);
  }
}

it('recovers interrupted checkout and provider initialization without duplicating reservations or charges', async () => {
  const headers = { Authorization: 'Bearer ' + parentUser.accessToken };
  await api().post('/api/v1/cart/items').set(headers).send({ mealScheduleId: scheduleId, checkpointId, quantity: 1 }).expect(201);
  const body = { idempotencyKey: randomUUID() };
  const checkout = await api().post('/api/v1/orders/checkout').set(headers).send(body).expect(201);
  const orderId = checkout.body.data.order.id;
  createdOrderIds.push(orderId);
  // Lost checkout response: repeating the original request must recover the order.
  const replay = await api().post('/api/v1/orders/checkout').set(headers).send(body).expect(201);
  expect(replay.body.data.order.id).toBe(orderId);
  expect(await prisma.order.count({ where: { customerId: parentUser.id, idempotencyKey: body.idempotencyKey } })).toBe(1);
  const original = mock.createOrder.bind(mock);
  const fault = vi.spyOn(mock, 'createOrder').mockImplementationOnce(async input => {
    await original(input);
    throw new Error('Simulated connection loss after provider acceptance');
  });
  try {
    await api().post('/api/v1/payments').set(headers).send({ orderId }).expect(500);
    await assertViews(orderId, 'AWAITING_PAYMENT');
    const recovered = await api().post('/api/v1/payments').set(headers).send({ orderId }).expect(201);
    expect(fault).toHaveBeenCalledTimes(1);
    const id = recovered.body.data.payment.id;
    await api().post(`/api/v1/payments/${id}/simulate`).set(headers).send({ status: 'cancelled' }).expect(200);
    await assertViews(orderId, 'AWAITING_PAYMENT');
    const resumed = await api().post('/api/v1/payments').set(headers).send({ orderId }).expect(201);
    expect(resumed.body.data.payment.id).toBe(id);
    await api().post(`/api/v1/payments/${id}/simulate`).set(headers).send({ status: 'captured' }).expect(200);
    await assertViews(orderId, 'CONFIRMED');
    await api().post(`/api/v1/payments/${id}/refresh`).set(headers).expect(200);
    expect(await prisma.paymentReceipt.count({ where: { paymentId: id } })).toBe(1);
  } finally { fault.mockRestore(); }
});

it('keeps a partially cancelled unpaid order unconfirmed and allows cancelling the remainder', async () => {
  const headers = { Authorization: 'Bearer ' + parentUser.accessToken };
  const child = await prisma.child.findFirstOrThrow({ where: { parentId: parentUser.id } });
  for (const childId of [null, child.id]) await api().post('/api/v1/cart/items').set(headers)
    .send({ mealScheduleId: scheduleId, checkpointId, quantity: 1, childId }).expect(201);
  const checkout = await api().post('/api/v1/orders/checkout').set(headers).send({ idempotencyKey: randomUUID() }).expect(201);
  const orderId = checkout.body.data.order.id;
  createdOrderIds.push(orderId);
  const [first, second] = checkout.body.data.order.items;
  const vendorHeaders = { Authorization: 'Bearer ' + vendorUser.accessToken };
  await api().patch(`/api/v1/vendor/orders/${first.id}/status`).set(vendorHeaders).send({ status: 'CANCELLED', reason: 'Unavailable serving' }).expect(200);
  await assertViews(orderId, 'AWAITING_PAYMENT');
  // A partial cancellation needs reconciliation, not a charge for the original full total.
  await api().post('/api/v1/payments').set(headers).send({ orderId }).expect(409);
  await api().post(`/api/v1/orders/${orderId}/cancel`).set(headers).send({ reason: 'Cancel remaining meal' }).expect(200);
  await assertViews(orderId, 'CANCELLED');
});

it('delivers remaining paid meals after one handoff fails and reports partial fulfilment everywhere', async () => {
  const parent = { Authorization: 'Bearer ' + parentUser.accessToken };
  const vendor = { Authorization: 'Bearer ' + vendorUser.accessToken };
  const rider = { Authorization: 'Bearer ' + riderUser3.accessToken };
  const child = await prisma.child.findFirstOrThrow({ where: { parentId: parentUser.id } });
  for (const childId of [null, child.id]) await api().post('/api/v1/cart/items').set(parent)
    .send({ mealScheduleId: scheduleId, checkpointId, childId, quantity: 1 }).expect(201);
  const checkout = await api().post('/api/v1/orders/checkout').set(parent).send({ idempotencyKey: randomUUID() }).expect(201);
  const orderId = checkout.body.data.order.id;
  createdOrderIds.push(orderId);
  const items = checkout.body.data.order.items as { id: string }[];
  const payment = await api().post('/api/v1/payments').set(parent).send({ orderId }).expect(201);
  await api().post(`/api/v1/payments/${payment.body.data.payment.id}/simulate`).set(parent).send({ status: 'captured' }).expect(200);
  for (const status of ['PREPARING', 'PACKED']) {
    const result = await api().post(`/api/v1/kitchen/${kitchenId}/items/status`).set(vendor)
      .send({ serviceDate: serviceDateStr, orderItemIds: items.map(i => i.id), status }).expect(200);
    expect(result.body.data.updated).toHaveLength(2);
  }
  const assigned = await api().post('/api/v1/admin/routes').set('Authorization', adminToken)
    .send({ name: 'Mixed outcome route', date: serviceDateStr, kitchenId, deliveryPartnerId: partnerId3,
      checkpointIds: [checkpointId], orderItemIds: items.map(i => i.id), idempotencyKey: randomUUID() }).expect(201);
  const route = assigned.body.data.route;
  createdRouteIds.push(route.id);
  for (const action of ['pickup', 'start']) await api().post(`/api/v1/delivery/routes/${route.id}/${action}`).set(rider).expect(200);
  await api().post(`/api/v1/delivery/routes/${route.id}/stops/${route.stops[0].id}/arrive`).set(rider).expect(200);
  const failed = await prisma.delivery.findUniqueOrThrow({ where: { orderItemId: items[0]!.id } });
  const success = await prisma.delivery.findUniqueOrThrow({ where: { orderItemId: items[1]!.id } });
  await api().patch(`/api/v1/delivery/items/${failed.id}/status`).set(rider)
    .send({ status: 'FAILED', failureReason: 'Recipient unavailable' }).expect(200);
  await assertViews(orderId, 'AT_CHECKPOINT');
  const packing = await api().get(`/api/v1/kitchen/${kitchenId}/packing`).set(vendor).query({ serviceDate: serviceDateStr }).expect(200);
  expect(packing.body.data.items.some((i: { id: string }) => i.id === items[1]!.id)).toBe(true);
  const code = await api().post(`/api/v1/orders/${orderId}/items/${items[1]!.id}/delivery-code`).set(parent).expect(200);
  await api().patch(`/api/v1/delivery/items/${success.id}/status`).set(rider)
    .send({ status: 'DELIVERED', receiverName: 'Recipient', otp: code.body.data.code }).expect(200);
  await assertViews(orderId, 'PARTIALLY_FULFILLED');
  const adminRoute = await api().get('/api/v1/admin/routes/' + route.id).set('Authorization', adminToken).expect(200);
  expect(adminRoute.body.data.route.totals).toMatchObject({ delivered: 1, failed: 1, meals: 2 });
});

it('uses the city timezone consistently for catalog, cart, checkout and cancellation', async () => {
  // At 08:00 UTC it is 13:30 in India: the 12:30 lunch is already closed.
  const headers = { Authorization: 'Bearer ' + parentUser.accessToken };
  const originalSlot = await prisma.timeSlot.findUniqueOrThrow({ where: { id: timeSlotId } });
  const originalCity = await prisma.city.findUniqueOrThrow({ where: { id: cityId } });
  await prisma.city.update({ where: { id: cityId }, data: { timezone: 'Asia/Kolkata' } });
  await prisma.timeSlot.update({ where: { id: timeSlotId }, data: { startMinute: 750, endMinute: 780 } });
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date(serviceDateStr + 'T06:00:00Z'));
    headers.Authorization = 'Bearer ' + (await api().post('/api/v1/auth/login').send({ identifier: parentUser.email, password: parentUser.password }).expect(200)).body.data.tokens.accessToken;
    await api().post('/api/v1/cart/items').set(headers).send({ mealScheduleId: scheduleId, checkpointId, quantity: 1 }).expect(201);
    const checked = await api().post('/api/v1/orders/checkout').set(headers).send({ idempotencyKey: randomUUID() }).expect(201);
    const id = checked.body.data.order.id; createdOrderIds.push(id);
    await api().post('/api/v1/cart/items').set(headers).send({ mealScheduleId: scheduleId, checkpointId, quantity: 1 }).expect(201);
    vi.setSystemTime(new Date(serviceDateStr + 'T08:00:00Z'));
    headers.Authorization = 'Bearer ' + (await api().post('/api/v1/auth/login').send({ identifier: parentUser.email, password: parentUser.password }).expect(200)).body.data.tokens.accessToken;
    const slots = await api().get('/api/v1/catalog/delivery-slots').set(headers).query({ checkpointId, serviceDate: serviceDateStr }).expect(200);
    expect(slots.body.data.slots.find((s: {timeSlotId: string}) => s.timeSlotId === timeSlotId).orderable).toBe(false);
    const detail = await api().get('/api/v1/catalog/meals/' + scheduleId).set(headers).query({ checkpointId }).expect(200);
    expect(detail.body.data.meal.orderable).toBe(false);
    const cart = await api().get('/api/v1/cart').set(headers).expect(200);
    expect(cart.body.data.cart.items[0].orderable).toBe(false);
    await api().post('/api/v1/cart/items').set(headers).send({ mealScheduleId: scheduleId, checkpointId, quantity: 1 }).expect(400);
    await api().post('/api/v1/orders/checkout').set(headers).send({ idempotencyKey: randomUUID() }).expect(409);
    await api().post(`/api/v1/orders/${id}/cancel`).set(headers).send({ reason: 'Too late locally' }).expect(422);
  } finally {
    vi.useRealTimers();
    await prisma.cartItem.deleteMany({ where: { cart: { userId: parentUser.id } } });
    await prisma.city.update({ where: { id: cityId }, data: { timezone: originalCity.timezone } });
    await prisma.timeSlot.update({ where: { id: timeSlotId }, data: { startMinute: originalSlot.startMinute, endMinute: originalSlot.endMinute } });
  }
});


it('reconciles historical status drift once with an audit record and no fulfilment side effects', async () => {
  const order = await prisma.order.findFirstOrThrow({ where: { id: { in: createdOrderIds }, status: 'DELIVERED' }, include: { items: true } });
  const beforeNotes = await prisma.notification.count({ where: { userId: parentUser.id } });
  // Simulate an old record written before order roll-ups were synchronized.
  await prisma.order.update({ where: { id: order.id }, data: { status: 'CONFIRMED' } });
  expect(await reconcileOrderStatus(order.id)).toEqual({ changed: true, applied: false });
  expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CONFIRMED');
  expect(await reconcileOrderStatus(order.id, true)).toEqual({ changed: true, applied: true });
  expect(await reconcileOrderStatus(order.id, true)).toEqual({ changed: false, applied: false });
  await assertViews(order.id, 'DELIVERED');
  expect(await prisma.auditLog.count({ where: { entityId: order.id, action: 'order.status.reconciled' } })).toBe(1);
  expect(await prisma.notification.count({ where: { userId: parentUser.id } })).toBe(beforeNotes);
});
