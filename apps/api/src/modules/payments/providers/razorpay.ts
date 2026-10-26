import { z } from 'zod';
import { badRequest, conflict } from '../../../core/errors';
import { env } from '../../../config/env';
import { validSignature } from './signatures';
import type { PaymentProvider, ProviderOrder, VerifiedPayment, VerifiedRefund } from './provider';
const id = z.string().regex(/^[A-Za-z0-9_]+$/).max(100);
const orderSchema = z.object({ id, amount: z.number().int().positive(), currency: z.string(), receipt: z.string() });
const paymentSchema = z.object({ id, order_id: id, amount: z.number().int().positive(), currency: z.string(), status: z.enum(['created','authorized','captured','failed','refunded']), method: z.string(), amount_refunded: z.number().int().nonnegative().default(0) });
const refundSchema = z.object({ id, payment_id: id, amount: z.number().int().positive(), status: z.enum(['pending','processed','failed']) });
const eventSchema = z.object({ event: z.string(), payload: z.object({ payment: z.object({ entity: z.object({ id }) }).optional(), refund: z.object({ entity: z.object({ id, payment_id: id }) }).optional() }) });
export class RazorpayProvider implements PaymentProvider {
  readonly name = 'RAZORPAY' as const;
  readonly publicKey = env.RAZORPAY_KEY_ID ?? null;
  private async request(path: string, body?: unknown, headers: Record<string,string> = {}): Promise<unknown> {
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) throw conflict('Payment provider credentials are unavailable');
    try {
      const response = await fetch(`https://api.razorpay.com/v1/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')}`, 'Content-Type': 'application/json', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10000),
      });
      // Never propagate provider payloads or fetch errors containing credentials.
      if (!response.ok) throw new Error('Provider request failed');
      return await response.json();
    } catch { throw conflict('Payment provider could not complete the request. Check status before retrying.'); }
  }
  async createOrder(input: { amount: number; currency: string; receipt: string }): Promise<ProviderOrder> {
    return orderSchema.parse(await this.request('orders', input));
  }
  async findOrder(receipt: string): Promise<ProviderOrder | null> {
    const response = z.object({ items: z.array(orderSchema) }).parse(await this.request(`orders?receipt=${encodeURIComponent(receipt)}&count=100`));
    const matches = response.items.filter(row => row.receipt === receipt);
    if (matches.length > 1) throw conflict('Provider order needs reconciliation');
    return matches[0] ?? null;
  }
  async fetchPayment(paymentId: string): Promise<VerifiedPayment> {
    const p = paymentSchema.parse(await this.request(`payments/${id.parse(paymentId)}`));
    return { id: p.id, orderId: p.order_id, amount: p.amount, currency: p.currency, status: p.status, method: ['upi','card','netbanking','wallet'].includes(p.method) ? p.method as VerifiedPayment['method'] : 'other', refundedAmount: p.amount_refunded };
  }
  async fetchOrderPayments(orderId: string): Promise<VerifiedPayment[]> {
    const list = z.object({ items: z.array(z.object({ id })) }).parse(await this.request(`orders/${id.parse(orderId)}/payments`));
    if (list.items.length > 100) throw conflict('Payment attempts require reconciliation');
    return Promise.all(list.items.map(p => this.fetchPayment(p.id)));
  }
  verifyCallback(orderId: string, paymentId: string, signature: string) {
    return validSignature(`${orderId}|${paymentId}`, signature, env.RAZORPAY_KEY_SECRET ?? '');
  }
  verifyWebhook(raw: Buffer, signature: string) {
    if (!validSignature(raw, signature, env.RAZORPAY_WEBHOOK_SECRET ?? '')) throw badRequest('Invalid webhook signature');
    const e = eventSchema.parse(JSON.parse(raw.toString('utf8')));
    if (['refund.processed','refund.failed','refund.created'].includes(e.event)) return { paymentId: e.payload.refund?.entity.payment_id, refundId: e.payload.refund?.entity.id };
    if (['payment.captured','payment.failed','payment.authorized','order.paid'].includes(e.event)) return { paymentId: e.payload.payment?.entity.id };
    return {};
  }
  private normalizeRefund(raw: unknown): VerifiedRefund {
    const r = refundSchema.parse(raw);
    return { id: r.id, paymentId: r.payment_id, amount: r.amount, status: r.status };
  }
  async refund(paymentId: string, amount: number, key: string) {
    return this.normalizeRefund(await this.request(`payments/${id.parse(paymentId)}/refund`, { amount, receipt: key }, { 'X-Refund-Idempotency': key }));
  }
  async fetchRefund(refundId: string) { return this.normalizeRefund(await this.request(`refunds/${id.parse(refundId)}`)); }
}
