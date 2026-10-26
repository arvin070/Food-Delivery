import type { Prisma } from '@prisma/client';
import { conflict } from '../../core/errors';
/** A durable credit authorization is a trusted funding state, not a provider payment. */
export async function corporateFunding(
  tx: Prisma.TransactionClient,
  orderId: string,
) {
  const charge = await tx.corporateCharge.findUnique({
    where: { orderId },
    include: {
      order: {
        select: {
          subtotal: true,
          totalAmount: true,
          discountAmount: true,
          currency: true,
        },
      },
    },
  });
  if (!charge) return null;
  if (
    charge.status === 'RELEASED' ||
    charge.order.currency !== 'INR' ||
    !charge.companyAmount.equals(charge.order.discountAmount) ||
    !charge.employeeAmount.equals(charge.order.totalAmount) ||
    !charge.companyAmount
      .add(charge.employeeAmount)
      .equals(charge.order.subtotal)
  )
    throw conflict('Corporate funding requires reconciliation');
  return charge;
}
export async function releaseCorporateFunding(
  tx: Prisma.TransactionClient,
  orderId: string,
) {
  await tx.corporateCharge.updateMany({
    where: { orderId, status: 'AUTHORIZED' },
    data: { status: 'RELEASED' },
  });
}
