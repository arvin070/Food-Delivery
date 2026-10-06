import rateLimit, { type Options } from 'express-rate-limit';
import { ErrorCode, type ApiErrorBody } from '@lunch/shared';
import { isTest } from '../config/env';

const errorBody: ApiErrorBody = {
  error: { code: ErrorCode.RATE_LIMITED, message: 'Too many requests. Please try again shortly.' },
};

function makeLimiter(options: Partial<Options>) {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: errorBody,
    // Rate limiting would make the test suite order-dependent.
    skip: () => isTest,
    ...options,
  });
}

/** Baseline limit for the whole API. */
export const globalLimiter = makeLimiter({ windowMs: 60_000, limit: 300 });

/** Credential endpoints: tight, to blunt password spraying. */
export const authLimiter = makeLimiter({ windowMs: 15 * 60_000, limit: 20 });

/** OTP issue/verify: tighter still. */
export const otpLimiter = makeLimiter({ windowMs: 15 * 60_000, limit: 10 });
