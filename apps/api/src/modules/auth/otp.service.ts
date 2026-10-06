/**
 * One-time codes, shared by password reset and account verification.
 *
 * Design points:
 *
 *  • Only the SHA-256 hash of a code is stored. A database leak cannot be
 *    replayed into an account takeover.
 *  • Issuing a new code consumes any outstanding one for the same
 *    identifier + purpose, so an old code in an old SMS stops working.
 *  • Attempts are counted per code and capped, which is what actually stops a
 *    six-digit code being brute-forced; the route-level rate limit only slows
 *    an attacker down.
 *  • Verification failures are deliberately indistinguishable from one another
 *    where it matters — see `requestPasswordReset` for the enumeration rule.
 */
import type { OtpPurpose } from '@prisma/client';
import { ErrorCode } from '@lunch/shared';
import { env } from '../../config/env';
import { unprocessable } from '../../core/errors';
import { logger } from '../../core/logger';
import { notifier, type NotificationChannel } from '../../core/notifier';
import { prisma, type Db } from '../../core/prisma';
import { numericCode, sha256 } from '../../lib/crypto';

/** Codes are short-lived: long enough to read an email, short enough to matter. */
const OTP_TTL_MINUTES = 15;
const OTP_LENGTH = 6;

export interface IssuedOtp {
  /** The plaintext code. Never log or return this outside development. */
  code: string;
  expiresAt: Date;
}

/** `+919000000003` → `+9190*****03`; `a@b.com` → `a***@b.com`. */
export function maskIdentifier(identifier: string): string {
  if (identifier.includes('@')) {
    const [local = '', domain = ''] = identifier.split('@');
    const head = local.slice(0, 1);
    return `${head}${'*'.repeat(Math.max(1, local.length - 1))}@${domain}`;
  }
  const tail = identifier.slice(-2);
  const head = identifier.slice(0, Math.max(0, identifier.length - 7));
  return `${head}${'*'.repeat(5)}${tail}`;
}

/**
 * Issues a code for `identifier` + `purpose`, invalidating any outstanding one.
 *
 * Returns the plaintext code so the caller can deliver it. The caller must not
 * put it in an API response outside development.
 */
export async function issueOtp(
  identifier: string,
  purpose: OtpPurpose,
  userId: string | null,
  db: Db = prisma
): Promise<IssuedOtp> {
  const code = numericCode(OTP_LENGTH);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);

  // Supersede outstanding codes so only the newest one works.
  await db.otpVerification.updateMany({
    where: { identifier, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  await db.otpVerification.create({
    data: {
      identifier,
      purpose,
      userId,
      codeHash: sha256(code),
      expiresAt,
    },
  });

  return { code, expiresAt };
}

/**
 * Checks a code and consumes it on success.
 *
 * Throws `OTP_INVALID`, `OTP_EXPIRED` or `OTP_ATTEMPTS_EXCEEDED`. A wrong code
 * increments the attempt counter on the outstanding record, so repeated guesses
 * burn the code rather than the attacker's patience.
 */
export async function verifyOtp(
  identifier: string,
  purpose: OtpPurpose,
  code: string
): Promise<{ userId: string | null }> {
  const record = await prisma.otpVerification.findFirst({
    where: { identifier, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) {
    throw unprocessable(ErrorCode.OTP_INVALID, 'That code is not valid. Request a new one.');
  }

  if (record.attempts >= env.DELIVERY_OTP_MAX_ATTEMPTS) {
    // Burn it so further guessing is pointless.
    await prisma.otpVerification.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    throw unprocessable(
      ErrorCode.OTP_ATTEMPTS_EXCEEDED,
      'Too many incorrect attempts. Request a new code.'
    );
  }

  if (record.expiresAt <= new Date()) {
    throw unprocessable(ErrorCode.OTP_EXPIRED, 'That code has expired. Request a new one.');
  }

  if (record.codeHash !== sha256(code)) {
    await prisma.otpVerification.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    throw unprocessable(ErrorCode.OTP_INVALID, 'That code is not correct.');
  }

  await prisma.otpVerification.update({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });

  return { userId: record.userId };
}

/** Delivers a code over the channel implied by the identifier. */
export async function deliverOtp(
  identifier: string,
  code: string,
  purpose: OtpPurpose
): Promise<void> {
  const channel: NotificationChannel = identifier.includes('@') ? 'email' : 'phone';

  const copy: Record<OtpPurpose, { subject: string; body: string }> = {
    PASSWORD_RESET: {
      subject: 'Reset your Lunch password',
      body: `Your Lunch password reset code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes. If you did not request this, you can ignore this message.`,
    },
    EMAIL_VERIFICATION: {
      subject: 'Verify your email address',
      body: `Your Lunch verification code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`,
    },
    PHONE_VERIFICATION: {
      subject: 'Verify your phone number',
      body: `Your Lunch verification code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`,
    },
    LOGIN: {
      subject: 'Your Lunch sign-in code',
      body: `Your Lunch sign-in code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`,
    },
  };

  const message = copy[purpose];

  try {
    await notifier.send({ channel, to: identifier, ...message });
  } catch (err) {
    // Surface the delivery failure rather than leaving the user waiting for a
    // message that will never arrive.
    logger.error({ err, channel, purpose }, 'Failed to deliver one-time code');
    throw err;
  }
}
