/**
 * The signed-in user's own profile.
 *
 * Everything here is scoped to `req.auth.userId` — there is no route that takes
 * a user id, so one customer cannot read another's profile through this surface.
 * Administrative access to other users lives under /admin.
 */
import { Router } from 'express';
import { updateProfileSchema } from '@lunch/shared';
import { asyncHandler, ok } from '../../core/http';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { validateBody } from '../../middleware/validate';
import * as profileService from './profile.service';

export const profileRouter = Router();

profileRouter.use(authenticate);

profileRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const { userId } = requireAuth(req);
    const profile = await profileService.getProfile(userId);
    return ok(res, { profile });
  })
);

profileRouter.patch(
  '/me',
  validateBody(updateProfileSchema),
  asyncHandler(async (req, res) => {
    const { userId } = requireAuth(req);
    const profile = await profileService.updateProfile(userId, req.body);
    return ok(res, { profile });
  })
);
