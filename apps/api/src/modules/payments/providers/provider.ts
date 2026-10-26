export type ProviderName = 'MOCK' | 'RAZORPAY';
export type PaymentMethod = 'upi' | 'card' | 'netbanking' | 'wallet' | 'other';
export interface ProviderOrder { id: string; amount: number; currency: string; receipt: string }
export interface VerifiedPayment {
  id: string; orderId: string; amount: number; currency: string;
  status: 'created' | 'authorized' | 'captured' | 'failed' | 'cancelled' | 'refunded';
  method: PaymentMethod; refundedAmount: number;
}
export interface VerifiedRefund { id: string; paymentId: string; amount: number; status: 'pending' | 'processed' | 'failed' }
export interface ProviderEvent { paymentId?: string; refundId?: string }
/** Provider objects expose normalized, allowlisted fields only. Never persist
 * provider payloads, card objects, PAN, CVV, bank details or UPI identifiers. */
export interface PaymentProvider {
  name: ProviderName;
  publicKey: string | null;
  createOrder(input: { amount: number; currency: string; receipt: string }): Promise<ProviderOrder>;
  findOrder(receipt: string): Promise<ProviderOrder | null>;
  fetchPayment(id: string): Promise<VerifiedPayment>;
  fetchOrderPayments(orderId: string): Promise<VerifiedPayment[]>;
  verifyCallback(orderId: string, paymentId: string, signature: string): boolean;
  verifyWebhook(raw: Buffer, signature: string): ProviderEvent;
  refund(paymentId: string, amount: number, key: string): Promise<VerifiedRefund>;
  fetchRefund(id: string): Promise<VerifiedRefund>;
}
