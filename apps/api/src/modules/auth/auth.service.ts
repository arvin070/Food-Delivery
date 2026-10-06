/**
 * Authentication business logic.
 *
 * Nothing here touches HTTP: it takes validated input and returns domain
 * results or throws an `AppError`. That keeps it reusable from a controller, a
 * background job or a test.
 */
import {
  ErrorCode,
  UserRole,
  type AuthPrincipal,
  type AuthSession,
  type ChangePasswordInput,
  type ConfirmPasswordResetInput,
  type ConfirmVerificationInput,
  type LoginInput,
  type PasswordResetRequested,
  type PublicUser,
  type RegisterInput,
  type RequestPasswordResetInput,
  type VerificationChannel,
  type VerificationRequested,
} from '@lunch/shared';
import { badRequest, conflict, forbidden, notFound, unauthenticated, unprocessable } from '../../core/errors';
import { logger } from '../../core/logger';
import { canRevealOtpInResponse } from '../../core/notifier';
import { prisma } from '../../core/prisma';
import { fakeVerifyPassword, hashPassword, verifyPassword } from '../../lib/password';
import { publicUserSelect, toPublicUser } from '../users/user.mapper';
import { deliverOtp, issueOtp, maskIdentifier, verifyOtp } from './otp.service';
import {
  issueTokens,
  revokeAllUserTokens,
  type SessionContext,
} from './token.service';

/**
 * Canonical form of a login identifier: emails lowercased, phone numbers
 * stripped of spaces and punctuation. Matches how both are stored.
 */
function normaliseIdentifier(identifier: string): string {
  const value = identifier.trim();
  return value.includes('@') ? value.toLowerCase() : value.replace(/[\s\-()]/g, '');
}

/** An identifier is an email if it contains `@`; otherwise treat it as a phone. */
function identifierWhere(identifier: string) {
  const value = normaliseIdentifier(identifier);
  return value.includes('@') ? { email: value } : { phone: value };
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

// ─── Password reset ──────────────────────────────────────────────────────────

/**
 * Starts a password reset.
 *
 * **Always succeeds**, whether or not the identifier belongs to an account.
 * Returning a 404 for unknown identifiers would turn this endpoint into an
 * account-existence oracle — anyone could test whether an email is registered.
 * The response is identical either way; only the side effect differs.
 */
export async function requestPasswordReset(
  input: RequestPasswordResetInput
): Promise<PasswordResetRequested> {
  const identifier = normaliseIdentifier(input.identifier);

  const user = await prisma.user.findFirst({
    where: { ...identifierWhere(identifier), deletedAt: null },
    select: { id: true, status: true },
  });

  const response: PasswordResetRequested = { sentTo: maskIdentifier(identifier) };

  // Suspended and deactivated accounts cannot be recovered this way; an
  // operator has to restore them first.
  if (!user || user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') {
    logger.info(
      { identifier: maskIdentifier(identifier), found: Boolean(user) },
      'Password reset requested for an identifier that cannot be reset'
    );
    return response;
  }

  const { code } = await issueOtp(identifier, 'PASSWORD_RESET', user.id);
  await deliverOtp(identifier, code, 'PASSWORD_RESET');

  logger.info({ userId: user.id }, 'Password reset code issued');

  // Development only, so a client can complete the flow without a mailbox.
  return canRevealOtpInResponse ? { ...response, devCode: code } : response;
}

/**
 * Completes a password reset.
 *
 * On success every session is revoked: a reset is the thing you do when you
 * believe someone else has your password, so leaving their sessions alive would
 * defeat the point.
 */
export async function confirmPasswordReset(input: ConfirmPasswordResetInput): Promise<void> {
  const identifier = normaliseIdentifier(input.identifier);

  const { userId } = await verifyOtp(identifier, 'PASSWORD_RESET', input.code);

  // The code is bound to a user at issue time; a code with no user should not
  // exist, but refuse rather than guess if it somehow does.
  if (!userId) {
    throw unprocessable(ErrorCode.OTP_INVALID, 'That code is not valid. Request a new one.');
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!user) throw notFound('User');
  if (user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') {
    throw forbidden('This account is not active', ErrorCode.ACCOUNT_SUSPENDED);
  }

  const passwordHash = await hashPassword(input.newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    await revokeAllUserTokens(user.id, tx);
  });

  logger.info({ userId: user.id }, 'Password reset completed; all sessions revoked');
}

// ─── Email / phone verification ──────────────────────────────────────────────

/** Sends a verification code to the user's own email address or phone number. */
export async function requestVerification(
  userId: string,
  channel: VerificationChannel
): Promise<VerificationRequested> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true },
  });
  if (!user) throw notFound('User');

  const identifier = channel === 'email' ? user.email : user.phone;
  if (!identifier) {
    throw badRequest(
      `Add ${channel === 'email' ? 'an email address' : 'a phone number'} to your profile first`,
      { [channel]: ['Not set on this account'] }
    );
  }

  const alreadyVerified = channel === 'email' ? user.emailVerifiedAt : user.phoneVerifiedAt;
  if (alreadyVerified) {
    throw conflict(
      `Your ${channel === 'email' ? 'email address' : 'phone number'} is already verified`
    );
  }

  const purpose = channel === 'email' ? 'EMAIL_VERIFICATION' : 'PHONE_VERIFICATION';
  const { code } = await issueOtp(identifier, purpose, user.id);
  await deliverOtp(identifier, code, purpose);

  const response: VerificationRequested = { channel, sentTo: maskIdentifier(identifier) };
  return canRevealOtpInResponse ? { ...response, devCode: code } : response;
}

/** Confirms a verification code and marks the channel verified. */
export async function confirmVerification(
  userId: string,
  input: ConfirmVerificationInput
): Promise<PublicUser> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, email: true, phone: true },
  });
  if (!user) throw notFound('User');

  const identifier = input.channel === 'email' ? user.email : user.phone;
  if (!identifier) {
    throw badRequest('That contact method is not set on this account');
  }

  const purpose = input.channel === 'email' ? 'EMAIL_VERIFICATION' : 'PHONE_VERIFICATION';
  const { userId: codeUserId } = await verifyOtp(identifier, purpose, input.code);

  // A code issued for someone else's identifier must never verify this account.
  if (codeUserId !== user.id) {
    throw unprocessable(ErrorCode.OTP_INVALID, 'That code is not valid for this account.');
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data:
      input.channel === 'email'
        ? { emailVerifiedAt: new Date() }
        : { phoneVerifiedAt: new Date() },
    select: publicUserSelect,
  });

  logger.info({ userId: user.id, channel: input.channel }, 'Contact channel verified');
  return toPublicUser(updated);
}
