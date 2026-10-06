/**
 * Authentication business logic.
 *
 * Nothing here touches HTTP: it takes validated input and returns domain
 * results or throws an `AppError`. That keeps it reusable from a controller, a
 * background job or a test.
 */
import { ErrorCode, UserRole, type AuthPrincipal, type AuthSession, type ChangePasswordInput, type LoginInput, type PublicUser, type RegisterInput } from '@lunch/shared';
import { conflict, forbidden, notFound, unauthenticated } from '../../core/errors';
import { logger } from '../../core/logger';
import { prisma } from '../../core/prisma';
import { fakeVerifyPassword, hashPassword, verifyPassword } from '../../lib/password';
import { publicUserSelect, toPublicUser } from '../users/user.mapper';
import {
  issueTokens,
  revokeAllUserTokens,
  type SessionContext,
} from './token.service';

/** An identifier is an email if it contains `@`; otherwise treat it as a phone. */
function identifierWhere(identifier: string) {
  const value = identifier.trim();
  return value.includes('@')
    ? { email: value.toLowerCase() }
    : { phone: value.replace(/[\s\-()]/g, '') };
}

/**
 * Builds the principal, resolving the role-specific ids the API needs so a
 * vendor or rider never has to pass their own vendorId/partnerId.
 */
async function buildPrincipal(userId: string): Promise<AuthPrincipal> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      vendor: { select: { id: true } },
      deliveryPartner: { select: { id: true } },
      institutionMembers: {
        where: { isActive: true, role: 'ADMIN' },
        select: { institutionId: true },
        take: 1,
      },
    },
  });
  if (!user) throw notFound('User');

  return {
    userId: user.id,
    role: user.role as UserRole,
    ...(user.vendor ? { vendorId: user.vendor.id } : {}),
    ...(user.deliveryPartner ? { deliveryPartnerId: user.deliveryPartner.id } : {}),
    ...(user.institutionMembers[0]
      ? { institutionId: user.institutionMembers[0].institutionId }
      : {}),
  };
}

export async function register(
  input: RegisterInput,
  context: SessionContext = {}
): Promise<AuthSession> {
  // Checked up front for a clean field-level error; the unique indexes remain
  // the actual guarantee under concurrency (handled by the Prisma error mapper).
  if (input.email) {
    const taken = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (taken) throw conflict('That email address is already registered', ErrorCode.EMAIL_TAKEN);
  }
  if (input.phone) {
    const taken = await prisma.user.findUnique({ where: { phone: input.phone }, select: { id: true } });
    if (taken) throw conflict('That phone number is already registered', ErrorCode.PHONE_TAKEN);
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        fullName: input.fullName,
        email: input.email ?? null,
        phone: input.phone ?? null,
        passwordHash,
        role: input.role,
        // Email/phone verification is a later module; accounts start usable.
        status: 'ACTIVE',
        profile: { create: {} },
        wallet: { create: {} },
      },
      select: publicUserSelect,
    });
    return created;
  });

  logger.info({ userId: user.id, role: user.role }, 'User registered');

  const principal: AuthPrincipal = { userId: user.id, role: user.role as UserRole };
  const tokens = await issueTokens(principal, context);
  return { user: toPublicUser(user), tokens };
}

export async function login(
  input: LoginInput,
  context: SessionContext = {}
): Promise<AuthSession> {
  const user = await prisma.user.findFirst({
    where: { ...identifierWhere(input.identifier), deletedAt: null },
    select: { ...publicUserSelect, passwordHash: true },
  });

  if (!user) {
    // Keep the timing indistinguishable from a wrong password.
    await fakeVerifyPassword(input.password);
    throw unauthenticated('Email/phone or password is incorrect', ErrorCode.INVALID_CREDENTIALS);
  }

  const passwordOk = await verifyPassword(input.password, user.passwordHash);
  if (!passwordOk) {
    throw unauthenticated('Email/phone or password is incorrect', ErrorCode.INVALID_CREDENTIALS);
  }

  if (user.status === 'SUSPENDED') {
    throw forbidden('Your account has been suspended', ErrorCode.ACCOUNT_SUSPENDED);
  }
  if (user.status === 'DEACTIVATED') {
    throw forbidden('Your account has been deactivated', ErrorCode.ACCOUNT_SUSPENDED);
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const principal = await buildPrincipal(user.id);
  const tokens = await issueTokens(principal, context);

  logger.info({ userId: user.id, role: user.role }, 'User signed in');

  const { passwordHash: _omit, ...publicFields } = user;
  return { user: toPublicUser(publicFields), tokens };
}

export async function getCurrentUser(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: publicUserSelect,
  });
  if (!user) throw notFound('User');
  return toPublicUser(user);
}

/**
 * Changes the password and ends every other session, which is what a user
 * expects after rotating a credential they fear was exposed.
 */
export async function changePassword(
  userId: string,
  input: ChangePasswordInput
): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, passwordHash: true },
  });
  if (!user) throw notFound('User');

  const currentOk = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!currentOk) {
    throw unauthenticated('Your current password is incorrect', ErrorCode.INVALID_CREDENTIALS);
  }

  const passwordHash = await hashPassword(input.newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await revokeAllUserTokens(userId, tx);
  });

  logger.info({ userId }, 'Password changed; all sessions revoked');
}
