export interface PaymentView {
  id: string; orderId: string; provider: string; status: string; amount: string; currency: string; refundedAmount: string; method: string | null; createdAt: string; failureReason: string | null;
  order: { orderNumber: string; status: string }; receipt: { number: string } | null;
  refunds: { id: string; status: string; amount: string; reason: string | null }[];
  attempts: { providerPaymentId: string; status: string; method: string; observedAt: string }[];
}
export interface ReceiptView {
  number: string; issuedAt: string;
  snapshot: { customerName: string; orderNumber: string; amount: string; currency: string; provider: string; providerPaymentId: string; subtotal: string; taxAmount: string; deliveryFee: string; discountAmount: string; items: { meal: string; beneficiary: string; date: string; quantity: number; unitPrice: string; total: string }[] };
}
