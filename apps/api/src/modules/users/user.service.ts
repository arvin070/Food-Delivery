import { paymentTransaction } from '../payments/transaction';
/**
 * User administration.
 *
 * Only reachable by SUPER_ADMIN (enforced at the route). Every status change is
 * written to the audit log, because suspending an account is an action someone
 * may later have to answer for.
 */
import type { Prisma } from '@prisma/client';
import {
  UserStatus,
  type ListUsersQuery,
  type PaginatedResult,
  type PublicUser,
  type UpdateUserStatusInput,
} from '@lunch/shared';
import { badRequest, notFound, conflict, forbidden } from '../../core/errors';
import { buildPaginatedResult, toSkipTake } from '../../core/http';
import { logger } from '../../core/logger';
import { prisma } from '../../core/prisma';
import { revokeAllUserTokens } from '../auth/token.service';
import { publicUserSelect, toPublicUser } from './user.mapper';

export async function listUsers(query: ListUsersQuery): Promise<PaginatedResult<PublicUser>> {
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    ...(query.role ? { role: query.role } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { fullName: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
            { phone: { contains: query.search } },
          ],
        }
      : {}),
  };

  const { skip, take } = toSkipTake(query);

  // One round-trip for the page and its total.
  const [rows, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: publicUserSelect,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.user.count({ where }),
  ]);

  return buildPaginatedResult(rows.map(toPublicUser), total, query);
}

export async function getUser(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: publicUserSelect,
  });
  if (!user) throw notFound('User');
  return toPublicUser(user);
}

/**
 * Changes an account's status.
 *
 * Suspending or deactivating revokes every session immediately — otherwise a
 * suspended user keeps working until their access token expires. `authenticate`
 * re-reads status on each request, so this is belt and braces, but it also
 * stops them minting a fresh access token from a live refresh token.
 */
export async function updateUserStatus(
  actorUserId: string,
  targetUserId: string,
  input: UpdateUserStatusInput,
  context: { ip?: string; userAgent?: string; expectedStatus?: string } = {}
): Promise<PublicUser> {
  // An administrator locking themselves out is almost always a mistake, and
  // recovering needs database access.
  if (actorUserId === targetUserId && input.status !== UserStatus.ACTIVE) {
    throw badRequest('You cannot suspend or deactivate your own account');
  }

  const deactivating = input.status !== UserStatus.ACTIVE;
  const updated = await paymentTransaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(721501)::text`;
    if(!await tx.user.count({where:{id:actorUserId,role:'SUPER_ADMIN',status:'ACTIVE',deletedAt:null}})) throw forbidden('Administrator access is no longer active');
    const target=await tx.user.findFirst({where:{id:targetUserId,deletedAt:null},select:{id:true,status:true,role:true}});
    if(!target) throw notFound('User');
    if(context.expectedStatus&&target.status!==context.expectedStatus) throw conflict('Account changed. Refresh before updating.');
    if(target.status===input.status) return tx.user.findUniqueOrThrow({where:{id:targetUserId},select:publicUserSelect});
    if(deactivating&&target.role==='SUPER_ADMIN'&&await tx.user.count({where:{role:'SUPER_ADMIN',status:'ACTIVE',deletedAt:null,id:{not:targetUserId}}})===0) throw badRequest('Keep at least one active super admin');
    const row = await tx.user.update({
      where: { id: targetUserId },
      data: { status: input.status },
      select: publicUserSelect,
    });

    if (deactivating) await revokeAllUserTokens(targetUserId, tx);

    await tx.auditLog.create({
      data: {
        actorUserId,
        action: 'user.status.updated',
        entityType: 'User',
        entityId: targetUserId,
        before: { status: target.status },
        after: { status: input.status, reason: input.reason ?? null },
        ip: context.ip ?? null,
        userAgent: context.userAgent?.slice(0, 255) ?? null,
      },
    });

    return row;
  });

  logger.info(
    { actorUserId, targetUserId, to: input.status },
    'User status changed'
  );

  return toPublicUser(updated);
}
