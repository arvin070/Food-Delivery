/**
 * Children belonging to the signed-in account.
 *
 * `authorizeGuardian()` restricts the surface to roles that order for someone
 * else, and the service scopes every query by `parentId`, so the two layers are
 * independent: a routing mistake alone cannot expose another family's records.
 */
import { Router } from 'express';
import { childIdParamSchema, createChildSchema, updateChildSchema } from '@lunch/shared';
import { asyncHandler, created, noContent, ok } from '../../core/http';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { authorizeGuardian } from '../../middleware/authorize';
import { validateBody, validateParams } from '../../middleware/validate';
import * as childService from './child.service';

export const childRouter = Router();

childRouter.use(authenticate, authorizeGuardian());

childRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = requireAuth(req);
    const children = await childService.listChildren(userId);
    return ok(res, { children });
  })
);

childRouter.post(
  '/',
  validateBody(createChildSchema),
  asyncHandler(async (req, res) => {
    const { userId } = requireAuth(req);
    const child = await childService.createChild(userId, req.body);
    return created(res, { child });
  })
);

childRouter.get(
  '/:childId',
  validateParams(childIdParamSchema),
  asyncHandler(async (req, res) => {
    const { userId } = requireAuth(req);
    const child = await childService.getChild(userId, req.params['childId'] as string);
    return ok(res, { child });
  })
);

childRouter.patch(
  '/:childId',
  validateParams(childIdParamSchema),
  validateBody(updateChildSchema),
  asyncHandler(async (req, res) => {
    const { userId } = requireAuth(req);
    const child = await childService.updateChild(
      userId,
      req.params['childId'] as string,
      req.body
    );
    return ok(res, { child });
  })
);

childRouter.delete(
  '/:childId',
  validateParams(childIdParamSchema),
  asyncHandler(async (req, res) => {
    const { userId } = requireAuth(req);
    await childService.removeChild(userId, req.params['childId'] as string);
    return noContent(res);
  })
);
