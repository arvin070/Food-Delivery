import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/config/env', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/config/env')>();
  return { ...actual, env: { ...actual.env, RAZORPAY_KEY_ID: 'rzp_test_key', RAZORPAY_KEY_SECRET: 'test_secret', RAZORPAY_WEBHOOK_SECRET: 'webhook_secret' } };
});
import { RazorpayProvider } from '../src/modules/payments/providers/razorpay';
const provider = new RazorpayProvider();
afterEach(() => { vi.unstubAllGlobals(); });
describe('Razorpay adapter contract', () => {
  it('validates checkout signatures against the server order id', () => {
    const signature=createHmac('sha256','test_secret').update('order_one|pay_one').digest('hex');
    expect(provider.verifyCallback('order_one','pay_one',signature)).toBe(true);
    expect(provider.verifyCallback('order_other','pay_one',signature)).toBe(false);
    expect(provider.verifyCallback('order_one','pay_one','bad')).toBe(false);
  });
  it('validates raw webhook bytes and extracts only payment identifiers', () => {
    const raw=Buffer.from(JSON.stringify({event:'payment.captured',payload:{payment:{entity:{id:'pay_one',card:{number:'sensitive-placeholder'}}}}}));
    const signature=createHmac('sha256','webhook_secret').update(raw).digest('hex');
    expect(provider.verifyWebhook(raw,signature)).toEqual({paymentId:'pay_one'});
    expect(()=>provider.verifyWebhook(Buffer.concat([raw,Buffer.from(' ')]),signature)).toThrow('signature');
  });
  it('fetches provider status with credentials and strips card/bank/UPI data', async () => {
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({id:'pay_one',order_id:'order_one',amount:10000,currency:'INR',status:'captured',method:'card',amount_refunded:0,card:{number:'sensitive-placeholder'},vpa:'private@upi',bank:'private'})));
    vi.stubGlobal('fetch',fetcher);
    const payment=await provider.fetchPayment('pay_one');
    expect(payment).toEqual({id:'pay_one',orderId:'order_one',amount:10000,currency:'INR',status:'captured',method:'card',refundedAmount:0});
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.razorpay.com/v1/payments/pay_one');
    expect(fetcher.mock.calls[0]?.[1].headers.Authorization).toBe(`Basic ${Buffer.from('rzp_test_key:test_secret').toString('base64')}`);
  });
  it('uses the same provider refund idempotency key and amount on retries', async () => {
    const fetcher=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({id:'rfnd_one',payment_id:'pay_one',amount:4000,status:'processed'})));
    vi.stubGlobal('fetch',fetcher);
    await provider.refund('pay_one',4000,'refund-key-12345');await provider.refund('pay_one',4000,'refund-key-12345');
    expect(fetcher.mock.calls[0]?.[1].headers['X-Refund-Idempotency']).toBe('refund-key-12345');
    expect(fetcher.mock.calls[0]?.[1].body).toBe(fetcher.mock.calls[1]?.[1].body);
  });
  it('does not leak provider error payloads', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({secret:'private-provider-details'}),{status:500})));
    await expect(provider.fetchPayment('pay_one')).rejects.toThrow('Payment provider could not complete');
  });
});
