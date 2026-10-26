import { env } from '../../../config/env';
import { conflict } from '../../../core/errors';
import { MockProvider } from './mock';
import { RazorpayProvider } from './razorpay';
import type { PaymentProvider } from './provider';
const mock = new MockProvider();
const razorpay = new RazorpayProvider();
export function providerFor(name: string = env.PAYMENT_PROVIDER.toUpperCase()): PaymentProvider {
  if (name === 'MOCK' && env.NODE_ENV !== 'production') return mock;
  if (name === 'RAZORPAY') return razorpay;
  throw conflict('Payment provider is not supported');
}
export { mock };
