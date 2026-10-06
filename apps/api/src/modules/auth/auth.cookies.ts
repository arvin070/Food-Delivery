import type { Response } from 'express';
import type { AuthTokens } from '@lunch/shared';
import { isProduction } from '../../config/env';

/**
 * Cookie-based session, used by the browser client.
 *
 * Both tokens are httpOnly so page JavaScript cannot read them, which removes
 * the XSS-steals-the-token class of bug. Mobile clients ignore cookies and use
 * the tokens from the response body with an Authorization header instead.
 */
export const ACCESS_COOKIE = 'lunch_access_token';
export const REFRESH_COOKIE = 'lunch_refresh_token';

const baseOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  path: '/',
} as const;

export function setAuthCookies(res: Response, tokens: AuthTokens): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...baseOptions,
    maxAge: tokens.expiresIn * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...baseOptions,
    // Only sent to the refresh/logout endpoints, not on every API call.
    path: '/api/v1/auth',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...baseOptions });
  res.clearCookie(REFRESH_COOKIE, { ...baseOptions, path: '/api/v1/auth' });
}
