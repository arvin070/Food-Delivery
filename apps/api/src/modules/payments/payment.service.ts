import { releaseCorporateFunding } from '../corporate/funding';
import { enqueueNotifications } from '../notifications/notification.service';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../core/prisma';
import { badRequest, conflict, notFound } from '../../core/errors';
import { logger } from '../../core/logger';
import { slotInstant } from '../subscriptions/recurrence';
import { providerFor, mock } from './providers';
import type { ProviderName, VerifiedPayment, VerifiedRefund } from './providers/provider';
import { paymentTransaction } from './transaction';

const paidStates = ['PAID','PARTIALLY_REFUNDED','REFUNDED'];
export function minorUnits(value: Prisma.Decimal): number {
  const amount = value.mul(100);
  if (!amount.isInteger() || !Number.isSafeInteger(amount.toNumber()) || amount.lte(0)) throw badRequest('Invalid payment amount');
  return amount.toNumber();
}
const paymentSelect = {
  id: true, orderId: true, provider: true, providerOrderId: true, providerPaymentId: true,
  amount: true, currency: true, status: true, method: true, failureReason: true,
  paidAt: true, createdAt: true, lastVerifiedAt: true, refundedAmount: true,
  attempts: { select: { providerPaymentId: true, status: true, method: true, observedAt: true }, orderBy: { observedAt: 'desc' as const }, take: 20 },
  order: { select: { orderNumber: true, status: true } },
  refunds: { select: { id: true, amount: true, status: true, reason: true, createdAt: true, processedAt: true }, orderBy: { createdAt: 'desc' as const } },
  receipt: { select: { number: true } },
} satisfies Prisma.PaymentSelect;

export async function paymentHistory(userId: string, page = 1) {
  return prisma.payment.findMany({ where: { order: { customerId: userId } }, select: paymentSelect, orderBy: { createdAt: 'desc' }, take: 20, skip: (page - 1) * 20 });
}
export async function getPayment(userId: string, id: string) {
  const payment = await prisma.payment.findFirst({ where: { id, order: { customerId: userId } }, select: paymentSelect });
  if (!payment) throw notFound('Payment');
  return payment;
}

export async function createPayment(userId: string, orderId: string) {
  const reservation = await paymentTransaction(async tx => {
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findFirst({ where: { id: orderId, customerId: userId }, include: { items: { include: { timeSlot: true, checkpoint: { include: { city: true } } } }, payments: { orderBy: { createdAt: 'asc' } } } });
    if (!order) throw notFound('Order');
    if (order.items.length === 0 || !['PENDING','AWAITING_PAYMENT','PAYMENT_FAILED'].includes(order.status) || order.items.some(i => i.status !== 'PENDING')) throw conflict('This order cannot accept a payment');
    if (order.items.some(i => slotInstant(i.serviceDate, i.timeSlot.startMinute, i.checkpoint.city.timezone) <= new Date())) throw conflict('This delivery date has passed');
    if (order.payments.some(p => paidStates.includes(p.status))) throw conflict('This order is already paid');
    let payment = order.payments.find(p => p.initializationStartedAt || p.providerOrderId) ?? order.payments[0];
    if (!payment) payment = await tx.payment.create({ data: { orderId, amount: order.totalAmount, currency: order.currency } });
    if (!payment.amount.equals(order.totalAmount) || payment.currency !== order.currency) throw conflict('Payment amount requires reconciliation');
    const first = !payment.initializationStartedAt && !payment.providerOrderId;
    if (first) payment = await tx.payment.update({ where: { id: payment.id }, data: { provider: env.PAYMENT_PROVIDER.toUpperCase() as ProviderName, initializationStartedAt: new Date(), status: 'PENDING' } });
    return { payment, first };
  });
  const { payment, first } = reservation;
  const provider = providerFor(payment.provider);
  if (!payment.providerOrderId) {
    // A timeout might mean the provider accepted the request. Never create again
    // blindly: recover by the durable receipt reference, or leave reconciliation pending.
    const input = { amount: minorUnits(payment.amount), currency: payment.currency, receipt: payment.id };
    const remote = first ? await provider.createOrder(input) : await provider.findOrder(payment.id);
    if (!remote) throw conflict('Payment creation is being reconciled. Check again shortly; do not create another order.');
    if (remote.receipt !== payment.id || remote.amount !== input.amount || remote.currency !== input.currency) throw conflict('Provider order does not match the payment');
    await prisma.payment.update({ where: { id: payment.id }, data: { providerOrderId: remote.id } });
  }
  const current = await getPayment(userId, payment.id);
  return { payment: current, checkout: { provider: payment.provider, key: provider.publicKey, orderId: current.providerOrderId, amount: minorUnits(payment.amount), currency: payment.currency, methods: ['upi','card','netbanking','wallet'] } };
}

/** Only normalized results fetched using server credentials enter this function. */
async function applyPayment(id: string, remote: VerifiedPayment) {
  await paymentTransaction(async tx => {
    const ref = await tx.payment.findUniqueOrThrow({ where: { id }, select: { orderId: true } });
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${ref.orderId} FOR UPDATE`;
    const p = await tx.payment.findUniqueOrThrow({ where: { id }, include: { order: { include: { customer: { select: { fullName: true } }, items: { include: { timeSlot: true, checkpoint: { include: { city: true } } } } } } } });
    if (remote.orderId !== p.providerOrderId || remote.amount !== minorUnits(p.amount) || remote.currency !== p.currency || remote.refundedAmount > remote.amount) throw badRequest('Provider payment does not match this order or amount');
    const captured = ['captured','refunded'].includes(remote.status);
    const observed = captured ? 'PAID' : remote.status === 'authorized' ? 'AUTHORIZED' : remote.status === 'failed' ? 'FAILED' : remote.status === 'cancelled' ? 'CANCELLED' : 'PENDING';
    const prior = await tx.paymentAttempt.findUnique({ where: { providerPaymentId: remote.id } });
    if (prior && prior.paymentId !== id) throw conflict('Payment attempt belongs to another payment');
    if (!prior || prior.status !== 'PAID') await tx.paymentAttempt.upsert({ where: { providerPaymentId: remote.id }, create: { paymentId: id, providerPaymentId: remote.id, status: observed, method: remote.method }, update: { status: observed, observedAt: new Date() } });
    // A failed attempt or old authorization cannot overwrite a successful capture.
    if (paidStates.includes(p.status) && !captured) return;
    if (paidStates.includes(p.status) && p.providerPaymentId !== remote.id) throw conflict('Multiple captured payments require reconciliation');
    const status = captured
      ? remote.refundedAmount === remote.amount ? 'REFUNDED' : remote.refundedAmount > 0 ? 'PARTIALLY_REFUNDED' : 'PAID'
      : remote.status === 'authorized' ? 'AUTHORIZED' : remote.status === 'failed' ? 'FAILED' : remote.status === 'cancelled' ? 'CANCELLED' : 'PENDING';
    // Do not regress refund totals if an older fetch races a refund notification.
    if (p.status === 'REFUNDED' || (p.status === 'PARTIALLY_REFUNDED' && status === 'PAID')) return;
    await tx.payment.update({ where: { id }, data: { status, refundedAmount: Prisma.Decimal.max(p.refundedAmount, new Prisma.Decimal(remote.refundedAmount).div(100)), providerPaymentId: remote.id, method: remote.method, lastVerifiedAt: new Date(), ...(captured && !p.paidAt ? { paidAt: new Date() } : {}), failureReason: remote.status === 'failed' ? 'Payment failed at the provider. You can retry checkout.' : null } });
    if (captured) {
      if(!p.paidAt) await enqueueNotifications(tx,[{userId:p.order.customerId,event:'payment.successful',key:'payment:'+id+':successful',data:{orderNumber:p.order.orderNumber}}]);
      await tx.paymentReceipt.upsert({ where: { paymentId: id }, update: {}, create: {
        paymentId: id, number: `RC-${randomUUID()}`, snapshot: {
          orderNumber: p.order.orderNumber, customerName: p.order.customer.fullName,
          amount: p.amount.toFixed(2), currency: p.currency, provider: p.provider,
          providerPaymentId: remote.id, subtotal: p.order.subtotal.toFixed(2),
          taxAmount: p.order.taxAmount.toFixed(2), deliveryFee: p.order.deliveryFee.toFixed(2), discountAmount: p.order.discountAmount.toFixed(2),
          items: p.order.items.map(i => ({ meal: i.mealNameSnapshot, beneficiary: i.beneficiaryName, quantity: i.quantity, unitPrice: i.unitPrice.toFixed(2), total: i.lineTotal.toFixed(2), date: i.serviceDate.toISOString().slice(0,10) })),
        },
      } });
      const payable = ['PENDING','AWAITING_PAYMENT','PAYMENT_FAILED'].includes(p.order.status) && p.order.items.every(i => i.status === 'PENDING');
      const tooLate = p.order.items.some(i => slotInstant(i.serviceDate, i.timeSlot.startMinute, i.checkpoint.city.timezone) <= new Date());
      if (payable && (tooLate || remote.refundedAmount > 0)) {
        await releaseCorporateFunding(tx, p.orderId);
        await tx.orderItem.updateMany({ where: { orderId: p.orderId, status: 'PENDING' }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
        for (const item of p.order.items) if (item.mealScheduleId) await tx.mealSchedule.updateMany({ where: { id: item.mealScheduleId, reservedQuantity: { gte: item.quantity } }, data: { reservedQuantity: { decrement: item.quantity } } });
        await tx.order.update({ where: { id: p.orderId }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: tooLate ? 'Payment arrived after delivery start; refund required' : 'Payment was refunded before confirmation' } });
      } else if (payable && remote.refundedAmount === 0) {
        await tx.order.update({ where: { id: p.orderId }, data: { status: 'CONFIRMED' } });
        await enqueueNotifications(tx,[{userId:p.order.customerId,event:'order.confirmed',key:'order:'+p.orderId+':confirmed',data:{orderNumber:p.order.orderNumber}}]);
        await tx.orderItem.updateMany({ where: { orderId: p.orderId, status: 'PENDING' }, data: { status: 'CONFIRMED' } });
      }
    } else if (status === 'FAILED') {
      await enqueueNotifications(tx,[{userId:p.order.customerId,event:'payment.failed',key:'payment-attempt:'+remote.id+':failed',data:{orderNumber:p.order.orderNumber}}]);
      await tx.order.updateMany({ where: { id: p.orderId, status: { in: ['PENDING','AWAITING_PAYMENT','PAYMENT_FAILED'] } }, data: { status: 'PAYMENT_FAILED' } });
    }
  });
}

export async function verifyPayment(userId: string, id: string, input: { providerPaymentId: string; signature: string }) {
  const p = await getPayment(userId, id);
  if (!p.providerOrderId) throw conflict('Payment checkout has not been created');
  const provider = providerFor(p.provider);
  if (!provider.verifyCallback(p.providerOrderId, input.providerPaymentId, input.signature)) throw badRequest('Invalid payment signature');
  await applyPayment(id, await provider.fetchPayment(input.providerPaymentId));
  return getPayment(userId, id);
}
export async function refreshPayment(userId: string, id: string) {
  const p = await getPayment(userId, id);
  if (!p.providerOrderId) return p;
  const provider = providerFor(p.provider);
  const attempts = await provider.fetchOrderPayments(p.providerOrderId);
  // Process unsuccessful attempts first; a capture always wins, independent of callback order.
  attempts.sort((a,b) => Number(['captured','refunded'].includes(a.status)) - Number(['captured','refunded'].includes(b.status)));
  for (const remote of attempts) await applyPayment(id, remote);
  return getPayment(userId, id);
}
export async function simulatePayment(userId: string, id: string, status: 'captured' | 'failed' | 'cancelled' | 'authorized') {
  const p = await getPayment(userId, id);
  if (env.NODE_ENV === 'production' || p.provider !== 'MOCK' || !p.providerOrderId) throw notFound('Endpoint');
  await mock.simulate(p.providerOrderId, status);
  return refreshPayment(userId, id);
}

async function applyRefund(refundId: string, remote: VerifiedRefund) {
  await paymentTransaction(async tx => {
    const ref = await tx.refund.findUniqueOrThrow({ where: { id: refundId }, include: { payment: true } });
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${ref.payment.orderId} FOR UPDATE`;
    const r = await tx.refund.findUniqueOrThrow({ where: { id: refundId }, include: { payment: true } });
    if (remote.paymentId !== r.payment.providerPaymentId || remote.amount !== minorUnits(r.amount) || (r.providerRefundId && r.providerRefundId !== remote.id)) throw badRequest('Provider refund does not match');
    if (r.status === 'PROCESSED') return;
    await tx.refund.update({ where: { id: refundId }, data: { providerRefundId: remote.id, status: remote.status.toUpperCase() as 'PENDING' | 'PROCESSED' | 'FAILED', processedAt: remote.status === 'processed' ? new Date() : null } });
    const sum = await tx.refund.aggregate({ where: { paymentId: r.paymentId, status: 'PROCESSED' }, _sum: { amount: true } });
    const total = sum._sum.amount ?? new Prisma.Decimal(0);
    if (total.gt(0)) {
      const full = total.gte(r.payment.amount);
      if (r.payment.status !== 'REFUNDED') await tx.payment.update({ where: { id: r.paymentId }, data: { status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED', refundedAmount: Prisma.Decimal.max(r.payment.refundedAmount, total) } });
      if (full) await tx.order.updateMany({ where: { id: r.payment.orderId, status: 'CANCELLED' }, data: { status: 'REFUNDED' } });
    }
  });
}
export async function refundPayment(userId: string, id: string, input: { idempotencyKey: string; amount?: string; reason: string }, admin = false) {
  const p = await prisma.payment.findFirst({ where: { id, ...(admin ? {} : { order: { customerId: userId } }) }, include: { order: true } });
  if (!p) throw notFound('Payment');
  // Refresh before calculating remaining refundable money, including provider dashboard refunds.
  await refreshPayment(p.order.customerId, id);
  const refund = await paymentTransaction(async tx => {
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${p.orderId} FOR UPDATE`;
    const current = await tx.payment.findUniqueOrThrow({ where: { id }, include: { order: true } });
    const replay = await tx.refund.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (replay) {
      if (replay.paymentId !== id || (input.amount && !replay.amount.equals(input.amount)) || replay.reason !== input.reason) throw conflict('Refund key was already used for a different request');
      return replay;
    }
    if (!['CANCELLED','FAILED'].includes(current.order.status)) throw conflict('Cancel the order before requesting a refund');
    if (!['PAID','PARTIALLY_REFUNDED'].includes(current.status) || !current.providerPaymentId) throw conflict('This payment is not refundable');
    const pending = await tx.refund.aggregate({ where: { paymentId: id, status: 'PENDING' }, _sum: { amount: true } });
    const remaining = current.amount.sub(current.refundedAmount).sub(pending._sum.amount ?? 0);
    const amount = input.amount ? new Prisma.Decimal(input.amount) : remaining;
    if (amount.lte(0) || amount.gt(remaining)) throw badRequest('Refund amount exceeds the refundable balance');
    if (!admin && input.amount) throw badRequest('Customer refunds cover the remaining balance');
    const r = await tx.refund.create({ data: { paymentId: id, amount, idempotencyKey: input.idempotencyKey, reason: input.reason } });
    await tx.auditLog.create({ data: { actorUserId: userId, action: 'payment.refund.requested', entityType: 'Refund', entityId: r.id, after: { amount: amount.toFixed(2), paymentId: id } } });
    return r;
  });
  if (refund.status === 'PROCESSED' || refund.status === 'FAILED') return refund;
  // The DB row reserves the amount before the network call. Uncertain failures
  // remain PENDING; retries use the same provider idempotency key and amount.
  const provider = providerFor(p.provider);
  const remote = refund.providerRefundId ? await provider.fetchRefund(refund.providerRefundId) : await provider.refund((await prisma.payment.findUniqueOrThrow({ where: { id } })).providerPaymentId!, minorUnits(refund.amount), refund.id);
  await applyRefund(refund.id, remote);
  return prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
}
export async function getReceipt(userId: string, paymentId: string) {
  await getPayment(userId, paymentId);
  const receipt = await prisma.paymentReceipt.findUnique({ where: { paymentId } });
  if (!receipt) throw notFound('Receipt (available after verified payment)');
  return receipt;
}

export async function handleWebhook(name: string, raw: Buffer, signature: string) {
  const provider = providerFor(name.toUpperCase());
  const event = provider.verifyWebhook(raw, signature);
  const digest = createHash('sha256').update(raw).digest('hex');
  if (await prisma.paymentWebhook.findUnique({ where: { provider_digest: { provider: provider.name, digest } } })) return;
  if (event.paymentId) {
    const remote = await provider.fetchPayment(event.paymentId);
    const payment = await prisma.payment.findFirst({ where: { provider: provider.name, providerOrderId: remote.orderId } });
    // A callback may arrive before creation recovery links the provider order.
    if (!payment) throw conflict('Payment order is not linked yet; retry webhook');
    await applyPayment(payment.id, remote);
    if (event.refundId) {
      const remoteRefund = await provider.fetchRefund(event.refundId);
      const local = await prisma.refund.findFirst({ where: { paymentId: payment.id, providerRefundId: event.refundId } });
      if (local) await applyRefund(local.id, remoteRefund);
    }
  }
  // Effect and dedup write may be retried independently: all effects are idempotent.
  await prisma.paymentWebhook.upsert({ where: { provider_digest: { provider: provider.name, digest } }, create: { provider: provider.name, digest }, update: {} });
}

export async function reconcilePayments() {
  const pending = await prisma.payment.findMany({ where: { initializationStartedAt: { not: null }, status: { in: ['CREATED','PENDING','AUTHORIZED','FAILED','CANCELLED'] } }, orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }], take: 20, include: { order: { select: { customerId: true } } } });
  for (const p of pending) {
    try {
      if (!p.providerOrderId) {
        const found = await providerFor(p.provider).findOrder(p.id);
        if (found && found.amount === minorUnits(p.amount) && found.currency === p.currency && found.receipt === p.id) await prisma.payment.update({ where: { id: p.id }, data: { providerOrderId: found.id } });
      }
      await refreshPayment(p.order.customerId, p.id);
    } catch { logger.warn({ paymentId: p.id }, 'Payment reconciliation will retry'); }
    // A failed provider fetch must never mark a payment as verified.
    finally { await prisma.payment.update({ where: { id: p.id }, data: { updatedAt: new Date() } }); }
  }
  const refunds = await prisma.refund.findMany({ where: { status: 'PENDING' }, take: 20, orderBy: { updatedAt: 'asc' }, include: { payment: true } });
  for (const r of refunds) {
    try {
      const provider = providerFor(r.payment.provider);
      const remote = r.providerRefundId ? await provider.fetchRefund(r.providerRefundId) : await provider.refund(r.payment.providerPaymentId!, minorUnits(r.amount), r.id);
      await applyRefund(r.id, remote);
    } catch { logger.warn({ refundId: r.id }, 'Refund reconciliation will retry'); }
    finally { await prisma.refund.update({ where: { id: r.id }, data: { updatedAt: new Date() } }); }
  }
}
