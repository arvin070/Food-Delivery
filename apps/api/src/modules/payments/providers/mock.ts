import { z } from 'zod';
import { prisma } from '../../../core/prisma';
import { env } from '../../../config/env';
import { badRequest, conflict, notFound } from '../../../core/errors';
import { validSignature } from './signatures';
import type { PaymentProvider, VerifiedPayment, VerifiedRefund } from './provider';
export class MockProvider implements PaymentProvider {
  readonly name = 'MOCK' as const;
  readonly publicKey = null;
  private guard() { if (env.NODE_ENV === 'production') throw conflict('Mock payments are disabled'); }
  async createOrder(input: { amount: number; currency: string; receipt: string }) {
    this.guard();
    const row = await prisma.mockProviderPayment.upsert({ where: { id: input.receipt }, create: { id: input.receipt, amount: input.amount, currency: input.currency }, update: {} });
    return { id: `mock_order_${row.id}`, receipt: row.id, amount: row.amount, currency: row.currency };
  }
  async findOrder(receipt: string) {
    this.guard(); const p = await prisma.mockProviderPayment.findUnique({ where: { id: receipt } });
    return p ? { id: `mock_order_${p.id}`, receipt: p.id, amount: p.amount, currency: p.currency } : null;
  }
  async fetchPayment(id: string): Promise<VerifiedPayment> {
    this.guard();
    if (!id.startsWith('mock_pay_')) throw notFound('Provider payment');
    const p = await prisma.mockProviderPayment.findUnique({ where: { id: id.slice(9) } });
    if (!p) throw notFound('Provider payment');
    const refunded = await prisma.mockProviderRefund.aggregate({ where: { paymentId: id, status: 'processed' }, _sum: { amount: true } });
    return { id, orderId: `mock_order_${p.id}`, amount: p.amount, currency: p.currency, status: (refunded._sum.amount ?? 0) === p.amount ? 'refunded' : p.status as VerifiedPayment['status'], refundedAmount: refunded._sum.amount ?? 0, method: 'upi' };
  }
  async fetchOrderPayments(orderId: string) { return [await this.fetchPayment(`mock_pay_${orderId.slice(11)}`)]; }
  verifyCallback(orderId: string, paymentId: string, signature: string) {
    this.guard();
    return validSignature(`${orderId}|${paymentId}`, signature, env.MOCK_PAYMENT_WEBHOOK_SECRET ?? '');
  }
  verifyWebhook(raw: Buffer, signature: string) {
    this.guard();
    if (!validSignature(raw, signature, env.MOCK_PAYMENT_WEBHOOK_SECRET ?? '')) throw badRequest('Invalid webhook signature');
    return z.object({ paymentId: z.string().optional(), refundId: z.string().optional() }).strict().parse(JSON.parse(raw.toString('utf8')));
  }
  async refund(paymentId: string, amount: number, key: string): Promise<VerifiedRefund> {
    this.guard();
    const p = await this.fetchPayment(paymentId);
    if (!['captured','refunded'].includes(p.status)) throw conflict('Payment is not captured');
    const existing = await prisma.mockProviderRefund.findUnique({ where: { id: key } });
    if (!existing && amount + p.refundedAmount > p.amount) throw conflict('Refund exceeds payment');
    const row = await prisma.mockProviderRefund.upsert({ where: { id: key }, create: { id: key, paymentId, amount }, update: {} });
    return { id: row.id, paymentId: row.paymentId, amount: row.amount, status: row.status as VerifiedRefund['status'] };
  }
  async fetchRefund(id: string): Promise<VerifiedRefund> {
    this.guard(); const r = await prisma.mockProviderRefund.findUnique({ where: { id } });
    if (!r) throw notFound('Refund');
    return { id: r.id, paymentId: r.paymentId, amount: r.amount, status: r.status as VerifiedRefund['status'] };
  }
  async simulate(orderId: string, status: 'captured' | 'failed' | 'cancelled' | 'authorized') {
    this.guard();
    // A simulated success is terminal, just as a provider capture cannot be undone by a late failure.
    await prisma.mockProviderPayment.updateMany({ where: { id: orderId.slice(11), status: { not: 'captured' } }, data: { status } });
  }
}
