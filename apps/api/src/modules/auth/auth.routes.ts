import { Router } from 'express';
import {
  changePasswordSchema,
  confirmPasswordResetSchema,
  confirmVerificationSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  requestPasswordResetSchema,
  requestVerificationSchema,
} from '@lunch/shared';
import { asyncHandler } from '../../core/http';
import { authenticate } from '../../middleware/authenticate';
import { authLimiter, otpLimiter } from '../../middleware/rate-limit';
import { validateBody } from '../../middleware/validate';
import * as controller from './auth.controller';

export const authRouter = Router();

// ─── Public ──────────────────────────────────────────────────────────────────

authRouter.post(
  '/register',
  authLimiter,
  validateBody(registerSchema),
  asyncHandler(controller.registerHandler)
);

authRouter.post(
  '/login',
  authLimiter,
  validateBody(loginSchema),
  asyncHandler(controller.loginHandler)
);

authRouter.post('/refresh', authLimiter, validateBody(refreshSchema), asyncHandler(controller.refreshHandler));

authRouter.post('/logout', validateBody(refreshSchema), asyncHandler(controller.logoutHandler));

/**
 * Password reset. Rate limited harder than login: these endpoints send
 * messages, so abuse costs money as well as security.
 */
authRouter.post(
  '/password-reset/request',
  otpLimiter,
  validateBody(requestPasswordResetSchema),
  asyncHandler(controller.requestPasswordResetHandler)
);

authRouter.post(
  '/password-reset/confirm',
  otpLimiter,
  validateBody(confirmPasswordResetSchema),
  asyncHandler(controller.confirmPasswordResetHandler)
);

// ─── Authenticated ───────────────────────────────────────────────────────────

authRouter.get('/me', authenticate, asyncHandler(controller.meHandler));

authRouter.post(
  '/change-password',
  authenticate,
  authLimiter,
  validateBody(changePasswordSchema),
  asyncHandler(controller.changePasswordHandler)
);

authRouter.post(
  '/verify/request',
  authenticate,
  otpLimiter,
  validateBody(requestVerificationSchema),
  asyncHandler(controller.requestVerificationHandler)
);

authRouter.post(
  '/verify/confirm',
  authenticate,
  otpLimiter,
  validateBody(confirmVerificationSchema),
  asyncHandler(controller.confirmVerificationHandler)
);
