import { Prisma } from '@prisma/client';
import { prisma } from '../../core/prisma';
import { conflict, notFound } from '../../core/errors';
const select = {
  id: true,
  orderId: true,
  subject: true,
  message: true,
  status: true,
  response: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ComplaintSelect;
export async function submitComplaint(
  userId: string,
  input: {
    subject: string;
    message: string;
    orderId?: string;
    idempotencyKey: string;
  },
) {
  return prisma.$transaction(async (tx) => {
    // Serialize retries from the same customer before checking the request key.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const existing = await tx.complaint.findUnique({
      where: {
        userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey },
      },
      select,
    });
    if (existing) {
      if (
        existing.subject !== input.subject ||
        existing.message !== input.message ||
        existing.orderId !== (input.orderId ?? null)
      )
        throw conflict('This request key was used for another complaint');
      return existing;
    }
    if (
      input.orderId &&
      !(await tx.order.count({
        where: { id: input.orderId, customerId: userId },
      }))
    )
      throw notFound('Order');
    return tx.complaint.create({
      data: { userId, ...input, createdAt: new Date() },
      select,
    });
  });
}
export async function listComplaints(userId: string, page: number) {
  const [items, total] = await prisma.$transaction([
    prisma.complaint.findMany({
      where: { userId },
      select,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 25,
      skip: (page - 1) * 25,
    }),
    prisma.complaint.count({ where: { userId } }),
  ]);
  return { items, total, page, pageSize: 25 };
}
