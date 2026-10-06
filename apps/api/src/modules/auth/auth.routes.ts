import { Router } from 'express';
import { changePasswordSchema, loginSchema, refreshSchema, registerSchema } from '@lunch/shared';
import { asyncHandler } from '../../core/http';
import { authenticate } from '../../middleware/authenticate';
import { authLimiter } from '../../middleware/rate-limit';
import { validateBody } from '../../middleware/validate';
import * as controller from './auth.controller';

export const authRouter = Router();

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

authRouter.post(
  '/refresh',
  validateBody(refreshSchema),
  asyncHandler(controller.refreshHandler)
);

authRouter.post('/logout', asyncHandler(controller.logoutHandler));

authRouter.get('/me', authenticate, asyncHandler(controller.meHandler));

authRouter.post(
  '/change-password',
  authenticate,
  authLimiter,
  validateBody(changePasswordSchema),
  asyncHandler(controller.changePasswordHandler)
);
