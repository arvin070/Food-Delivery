/**
 * HTTP adapter for the auth module. Translates requests into service calls and
 * service results into responses — no business rules live here.
 */
import type { Request, Response } from 'express';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  type ChangePasswordInput,
  type ConfirmPasswordResetInput,
  type ConfirmVerificationInput,
  type LoginInput,
  type RegisterInput,
  type RequestPasswordResetInput,
  type RequestVerificationInput,
} from '@lunch/shared';
import { unauthenticated } from '../../core/errors';
import { clientIp, created, noContent, ok } from '../../core/http';
import { requireAuth } from '../../middleware/authenticate';
import * as authService from './auth.service';
import { REFRESH_COOKIE, clearAuthCookies, setAuthCookies } from './auth.cookies';
import { revokeRefreshToken, rotateRefreshToken, type SessionContext } from './token.service';

function sessionContext(req: Request): SessionContext {
  return { userAgent: req.headers['user-agent'], ip: clientIp(req) };
}

export async function registerHandler(req: Request, res: Response) {
  const input = req.body as RegisterInput;
  const session = await authService.register(input, sessionContext(req));
  setAuthCookies(res, session.tokens);
  return created(res, session);
}

export async function loginHandler(req: Request, res: Response) {
  const input = req.body as LoginInput;
  const session = await authService.login(input, sessionContext(req));
  setAuthCookies(res, session.tokens);
  return ok(res, session);
}

export async function refreshHandler(req: Request, res: Response) {
  // Browsers send it as a cookie; mobile clients put it in the body.
  const presented =
    (req.body as { refreshToken?: string } | undefined)?.refreshToken ??
    (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];

  if (!presented) throw unauthenticated('No refresh token was provided');

  const { tokens } = await rotateRefreshToken(presented, sessionContext(req));
  setAuthCookies(res, tokens);
  return ok(res, { tokens });
}

export async function logoutHandler(req: Request, res: Response) {
  const presented =
    (req.body as { refreshToken?: string } | undefined)?.refreshToken ??
    (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];

  if (presented) await revokeRefreshToken(presented);
  clearAuthCookies(res);
  return noContent(res);
}

export async function meHandler(req: Request, res: Response) {
  const { userId } = requireAuth(req);
  const user = await authService.getCurrentUser(userId);
  return ok(res, { user });
}

export async function changePasswordHandler(req: Request, res: Response) {
  const { userId } = requireAuth(req);
  await authService.changePassword(userId, req.body as ChangePasswordInput);
  clearAuthCookies(res);
  return noContent(res);
}

/** Re-exported so routes import schemas and handlers from one place. */
export const schemas = { registerSchema, loginSchema, changePasswordSchema };

// ─── Password reset ──────────────────────────────────────────────────────────

export async function requestPasswordResetHandler(req: Request, res: Response) {
  const result = await authService.requestPasswordReset(req.body as RequestPasswordResetInput);
  // Always 200 with the same shape, so the response cannot be used to discover
  // which identifiers are registered.
  return ok(res, result);
}

export async function confirmPasswordResetHandler(req: Request, res: Response) {
  await authService.confirmPasswordReset(req.body as ConfirmPasswordResetInput);
  // Every session was revoked, so clear this client's cookies too.
  clearAuthCookies(res);
  return noContent(res);
}

// ─── Email / phone verification ──────────────────────────────────────────────

export async function requestVerificationHandler(req: Request, res: Response) {
  const { userId } = requireAuth(req);
  const { channel } = req.body as RequestVerificationInput;
  const result = await authService.requestVerification(userId, channel);
  return ok(res, result);
}

export async function confirmVerificationHandler(req: Request, res: Response) {
  const { userId } = requireAuth(req);
  const user = await authService.confirmVerification(userId, req.body as ConfirmVerificationInput);
  return ok(res, { user });
}
