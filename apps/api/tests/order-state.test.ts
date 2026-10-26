import { expect, it } from 'vitest';
import { deriveOrderStatus } from '../src/modules/orders/order-state';

it('keeps financial gates while only part of an unpaid order is cancelled', () => {
  expect(deriveOrderStatus('AWAITING_PAYMENT', ['CANCELLED', 'PENDING'])).toBe('AWAITING_PAYMENT');
  expect(deriveOrderStatus('PAYMENT_FAILED', ['CANCELLED', 'PENDING'])).toBe('PAYMENT_FAILED');
  expect(deriveOrderStatus('AWAITING_PAYMENT', ['CANCELLED', 'CANCELLED'])).toBe('CANCELLED');
  expect(deriveOrderStatus('REFUNDED', ['CANCELLED'])).toBe('REFUNDED');
  expect(deriveOrderStatus('CANCELLED', ['CONFIRMED'])).toBe('CANCELLED');
});
it('keeps unfinished paid lines actionable after another line fails', () => {
  expect(deriveOrderStatus('AT_CHECKPOINT', ['FAILED', 'CONFIRMED'])).toBe('CONFIRMED');
  expect(deriveOrderStatus('AT_CHECKPOINT', ['FAILED', 'AT_CHECKPOINT'])).toBe('AT_CHECKPOINT');
  expect(deriveOrderStatus('AT_CHECKPOINT', ['DELIVERED', 'FAILED'])).toBe('PARTIALLY_FULFILLED');
  expect(deriveOrderStatus('AT_CHECKPOINT', ['DELIVERED', 'CANCELLED'])).toBe('PARTIALLY_FULFILLED');
  expect(deriveOrderStatus('AT_CHECKPOINT', ['FAILED', 'FAILED'])).toBe('FAILED');
});
