import { corporateFunding } from '../corporate/funding';
import { Prisma } from '@prisma/client';
import { conflict } from '../../core/errors';
/** Core fulfilment policy contains no payment-provider implementation. */
export async function assertOrderPaid(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { totalAmount: true, currency: true, status: true } });
  const funding = await corporateFunding(tx, orderId);
  if (funding && order.totalAmount.isZero() && !['CANCELLED','REFUNDED','PAYMENT_FAILED'].includes(order.status)) return;
  if (['CANCELLED','REFUNDED','PAYMENT_FAILED'].includes(order.status) || !await tx.payment.count({ where: { orderId, status: 'PAID', lastVerifiedAt: { not: null }, amount: order.totalAmount, currency: order.currency } })) {
    throw conflict('A verified captured payment is required before fulfilment');
  }
}

/** SQL equivalent of assertOrderPaid for operational lists. The caller aliases
 * orders as `o`. Corporate authorization is validated even for co-payments. */
export const fundedOrderSql = Prisma.sql`
  o.status NOT IN ('CANCELLED','REFUNDED','PAYMENT_FAILED')
  AND (
    NOT EXISTS (SELECT 1 FROM corporate_charges cc WHERE cc."orderId" = o.id)
    OR EXISTS (SELECT 1 FROM corporate_charges cc WHERE cc."orderId" = o.id
      AND cc.status <> 'RELEASED' AND o.currency = 'INR'
      AND cc."companyAmount" = o."discountAmount" AND cc."employeeAmount" = o."totalAmount"
      AND cc."companyAmount" + cc."employeeAmount" = o.subtotal)
  )
  AND (
    (o."totalAmount" = 0 AND EXISTS (SELECT 1 FROM corporate_charges cc WHERE cc."orderId" = o.id))
    OR EXISTS (SELECT 1 FROM payments p WHERE p."orderId" = o.id AND p.status = 'PAID'
      AND p."lastVerifiedAt" IS NOT NULL AND p.amount = o."totalAmount" AND p.currency = o.currency)
  )
`;
