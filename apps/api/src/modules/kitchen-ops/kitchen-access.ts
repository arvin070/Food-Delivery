import { Prisma } from '@prisma/client';
import { UserRole, type KitchenOption } from '@lunch/shared';
import { prisma } from '../../core/prisma';
import { forbidden, notFound } from '../../core/errors';
export interface KitchenActor { userId: string; role: string }
export function kitchenAccessWhere(actor: KitchenActor): Prisma.KitchenWhereInput {
  return {
    deletedAt: null,
    ...(actor.role === UserRole.SUPER_ADMIN ? {} : {
      OR: [{ vendor: { ownerUserId: actor.userId } }, { staff: { some: { userId: actor.userId } } }],
    }),
  };
}
const select = { id: true, name: true, isActive: true, city: { select: { timezone: true } }, vendor: { select: { status: true, isActive: true, deletedAt: true } } } satisfies Prisma.KitchenSelect;
function option(row: Prisma.KitchenGetPayload<{ select: typeof select }>): KitchenOption {
  return { id: row.id, name: row.name, timezone: row.city.timezone, canUpdate: row.isActive && row.vendor.status === 'APPROVED' && row.vendor.isActive && !row.vendor.deletedAt };
}
export async function listAccessibleKitchens(actor: KitchenActor) {
  return (await prisma.kitchen.findMany({ where: kitchenAccessWhere(actor), select, orderBy: { name: 'asc' } })).map(option);
}
export async function accessKitchen(actor: KitchenActor, id: string, write = false, db: Prisma.TransactionClient = prisma) {
  const row = await db.kitchen.findFirst({ where: { id, ...kitchenAccessWhere(actor) }, select });
  if (!row) throw notFound('Kitchen');
  const result = option(row);
  if (write && !result.canUpdate) throw forbidden('This kitchen is not active and approved for preparation');
  return result;
}
