import { Router } from 'express';
import {
  createRouteSchema,
  editRouteSchema,
  routeQuerySchema,
  routeCandidatesQuerySchema,
} from '@lunch/shared';
import { asyncHandler, ok } from '../../core/http';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { authorizeAdmin } from '../../middleware/authorize';
import { validateBody, validateQuery } from '../../middleware/validate';
import * as service from './route-management.service';
export const routeManagementRouter = Router();
routeManagementRouter.use(authenticate, authorizeAdmin());
routeManagementRouter.get(
  '/options',
  asyncHandler(async (_req, res) => ok(res, await service.options())),
);
routeManagementRouter.get(
  '/candidates',
  validateQuery(routeCandidatesQuerySchema),
  asyncHandler(async (req, res) =>
    ok(res, await service.candidates(req.query as never)),
  ),
);
routeManagementRouter.get(
  '/',
  validateQuery(routeQuerySchema),
  asyncHandler(async (req, res) =>
    ok(res, await service.list(req.query as never)),
  ),
);
routeManagementRouter.get(
  '/:routeId',
  asyncHandler(async (req, res) =>
    ok(res, { route: await service.detail(req.params['routeId']!) }),
  ),
);
routeManagementRouter.post(
  '/',
  validateBody(createRouteSchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      { route: await service.create(requireAuth(req).userId, req.body) },
      201,
    ),
  ),
);
routeManagementRouter.patch(
  '/:routeId',
  validateBody(editRouteSchema),
  asyncHandler(async (req, res) =>
    ok(res, {
      route: await service.edit(
        requireAuth(req).userId,
        req.params['routeId']!,
        req.body,
      ),
    }),
  ),
);
