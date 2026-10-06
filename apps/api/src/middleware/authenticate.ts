import type { NextFunction, Request, Response } from 'express';
import { ErrorCode, UserStatus, type AuthPrincipal } from '@lunch/shared';
import { forbidden, unauthenticated } from '../core/errors';
import { prisma } from '../core/prisma';
import { verifyAccessToken } from '../modules/auth/token.service';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `authenticate`. Absent on public routes. */
      auth?: AuthPrincipal;
    }
  }
}

function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim() || undefined;
  // The web app stores the access token in an httpOnly cookie set by its own
  // server, so browser requests arrive without an Authorization header.
  const cookieToken = (req.cookies as Record<string, string> | undefined)?.['lunch_access_token'];
  return cookieToken || undefined;
}

/**
 * Requires a valid access token.
 *
 * The token's claims are trusted for identity, but `status` is re-read from the
 * database: a suspended user must lose access immediately, not when their
 * 15-minute token happens to expire.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = bearerToken(req);
    if (!token) return next(unauthenticated('Sign in to continue'));

    const principal = verifyAccessToken(token);

    const user = await prisma.user.findUnique({
      where: { id: principal.userId },
      select: { id: true, status: true, role: true, deletedAt: true },
    });

    if (!user || user.deletedAt) return next(unauthenticated('Your account no longer exists'));
    if (user.status === UserStatus.SUSPENDED) {
      return next(forbidden('Your account has been suspended', ErrorCode.ACCOUNT_SUSPENDED));
    }
    if (user.status === UserStatus.DEACTIVATED) {
      return next(forbidden('Your account has been deactivated', ErrorCode.ACCOUNT_SUSPENDED));
    }
    // A role change since the token was issued takes effect at once.
    req.auth = { ...principal, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
}

/** Populates `req.auth` when a token is present, but never rejects. For routes
 *  whose response is richer for a signed-in user (e.g. meal browsing). */
export async function optionalAuthenticate(req: Request, res: Response, next: NextFunction) {
  if (!bearerToken(req)) return next();
  return authenticate(req, res, (err?: unknown) => (err ? next() : next()));
}

/** Narrows `req.auth` to defined. Throws if `authenticate` did not run. */
export function requireAuth(req: Request): AuthPrincipal {
  if (!req.auth) throw unauthenticated('Sign in to continue');
  return req.auth;
}
