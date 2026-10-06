/**
 * Administrative API.
 *
 * Every route here is SUPER_ADMIN only. The guard is applied once to the whole
 * router rather than per route, so a new endpoint cannot be added without it.
 */
import { Router } from 'express';
import {
  createVendorSchema,
  listUsersQuerySchema,
  listVendorsQuerySchema,
  updateUserStatusSchema,
  updateVendorStatusSchema,
  userIdPathSchema,
  vendorIdParamSchema,
} from '@lunch/shared';
import { asyncHandler, clientIp, created, ok, paginated } from '../../core/http';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { authorizeAdmin } from '../../middleware/authorize';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate';
import * as userService from '../users/user.service';
import * as vendorAdminService from './vendor.admin.service';

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

// ─── Vendors ─────────────────────────────────────────────────────────────────

adminRouter.get(
  '/vendors',
  validateQuery(listVendorsQuerySchema),
  asyncHandler(async (req, res) => {
    const result = await vendorAdminService.listVendors(req.query as never);
    return paginated(res, result);
  })
);

adminRouter.post(
  '/vendors',
  validateBody(createVendorSchema),
  asyncHandler(async (req, res) => {
    const actor = requireAuth(req);
    const vendor = await vendorAdminService.createVendor(actor.userId, req.body, {
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    });
    return created(res, { vendor });
  })
);

adminRouter.get(
  '/vendors/:vendorId',
  validateParams(vendorIdParamSchema),
  asyncHandler(async (req, res) => {
    const vendor = await vendorAdminService.getVendor(req.params['vendorId'] as string);
    return ok(res, { vendor });
  })
);

adminRouter.patch(
  '/vendors/:vendorId/status',
  validateParams(vendorIdParamSchema),
  validateBody(updateVendorStatusSchema),
  asyncHandler(async (req, res) => {
    const actor = requireAuth(req);
    const vendor = await vendorAdminService.updateVendorStatus(
      actor.userId,
      req.params['vendorId'] as string,
      req.body,
      { ip: clientIp(req), userAgent: req.headers['user-agent'] }
    );
    return ok(res, { vendor });
  })
);
