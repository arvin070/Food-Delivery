/**
 * Administrative API.
 *
 * Every route here is SUPER_ADMIN only. The guard is applied once to the whole
 * router rather than per route, so a new endpoint cannot be added without it.
 */
import { Router } from 'express';
import { listUsersQuerySchema, updateUserStatusSchema, userIdPathSchema } from '@lunch/shared';
import { asyncHandler, clientIp, ok, paginated } from '../../core/http';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { authorizeAdmin } from '../../middleware/authorize';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate';
import * as userService from '../users/user.service';

export const adminRouter = Router();

adminRouter.use(authenticate, authorizeAdmin());

adminRouter.get(
  '/users',
  validateQuery(listUsersQuerySchema),
  asyncHandler(async (req, res) => {
    const result = await userService.listUsers(req.query as never);
    return paginated(res, result);
  })
);

adminRouter.get(
  '/users/:userId',
  validateParams(userIdPathSchema),
  asyncHandler(async (req, res) => {
    const user = await userService.getUser(req.params['userId'] as string);
    return ok(res, { user });
  })
);

adminRouter.patch(
  '/users/:userId/status',
  validateParams(userIdPathSchema),
  validateBody(updateUserStatusSchema),
  asyncHandler(async (req, res) => {
    const actor = requireAuth(req);
    const user = await userService.updateUserStatus(
      actor.userId,
      req.params['userId'] as string,
      req.body,
      { ip: clientIp(req), userAgent: req.headers['user-agent'] }
    );
    return ok(res, { user });
  })
);
