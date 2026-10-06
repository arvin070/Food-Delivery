import type { Prisma } from '@prisma/client';
import type { PublicUser, UserRole } from '@lunch/shared';

/**
 * The only `select` used when a user is returned to a client. Naming it once
 * means `passwordHash` cannot be leaked by a forgotten `select` somewhere.
 */
export const publicUserSelect = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

type PublicUserRow = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

export function toPublicUser(user: PublicUserRow): PublicUser {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: user.role as UserRole,
    status: user.status,
    emailVerified: Boolean(user.emailVerifiedAt),
    phoneVerified: Boolean(user.phoneVerifiedAt),
    createdAt: user.createdAt.toISOString(),
  };
}
