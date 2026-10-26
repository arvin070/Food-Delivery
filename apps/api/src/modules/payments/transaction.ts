import { Prisma } from '@prisma/client';
import { prisma } from '../../core/prisma';
import { conflict } from '../../core/errors';
export async function paymentTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, options: {timeout?:number} = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(fn, { isolationLevel: 'Serializable', ...options }); }
    catch (e) {
      const retry = e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2034' || (e.code === 'P2010' && ['40001','40P01'].includes(String(e.meta?.code))));
      if (retry && attempt < 3) continue;
      if (retry) throw conflict('Payment state changed. Please retry.');
      throw e;
    }
  }
}
