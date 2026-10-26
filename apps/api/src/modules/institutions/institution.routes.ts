import { Router } from 'express';
import {
  createInstitutionSchema,
  updateInstitutionSchema,
  institutionQuerySchema,
  institutionWindowSchema,
  institutionRegistrationSchema,
  bulkMealRequestSchema,
} from '@lunch/shared';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validateBody, validateQuery } from '../../middleware/validate';
import { asyncHandler, ok } from '../../core/http';
import * as service from './institution.service';
export const institutionRouter = Router();
institutionRouter.use(authenticate);
const buyers = authorize('CUSTOMER', 'PARENT', 'STUDENT');
institutionRouter.get(
  '/registrations/me',
  buyers,
  asyncHandler(async (req, res) =>
    ok(res, await service.myRegistrations(requireAuth(req).userId)),
  ),
);
institutionRouter.post(
  '/:id/register',
  buyers,
  validateBody(institutionRegistrationSchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await service.register(
        requireAuth(req).userId,
        req.params['id']!,
        req.body.identifier,
      ),
    ),
  ),
);
institutionRouter.delete(
  '/:id/register',
  buyers,
  asyncHandler(async (req, res) => {
    await service.unregister(requireAuth(req).userId, req.params['id']!);
    return ok(res, { removed: true });
  }),
);
institutionRouter.use(authorize('INSTITUTION_ADMIN', 'SUPER_ADMIN'));
institutionRouter.get(
  '/',
  validateQuery(institutionQuerySchema),
  asyncHandler(async (req, res) =>
    ok(res, await service.list(requireAuth(req), req.query as never)),
  ),
);
institutionRouter.post(
  '/',
  authorize('SUPER_ADMIN'),
  validateBody(createInstitutionSchema),
  asyncHandler(async (req, res) =>
    ok(res, await service.create(requireAuth(req), req.body), 201),
  ),
);
institutionRouter.get(
  '/:id',
  asyncHandler(async (req, res) =>
    ok(
      res,
      await service.requireInstitution(requireAuth(req), req.params['id']!),
    ),
  ),
);
institutionRouter.patch(
  '/:id',
  validateBody(updateInstitutionSchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await service.update(requireAuth(req), req.params['id']!, req.body),
    ),
  ),
);
institutionRouter.get(
  '/:id/registrations',
  validateQuery(institutionQuerySchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await service.registrations(
        requireAuth(req),
        req.params['id']!,
        req.query as never,
      ),
    ),
  ),
);
institutionRouter.get(
  '/:id/statistics',
  validateQuery(institutionQuerySchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await service.statistics(
        requireAuth(req),
        req.params['id']!,
        req.query['date'] as string | undefined,
      ),
    ),
  ),
);
institutionRouter.post(
  '/:id/checkpoints/:checkpointId/windows',
  validateBody(institutionWindowSchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await service.createWindow(
        requireAuth(req),
        req.params['id']!,
        req.params['checkpointId']!,
        req.body,
      ),
      201,
    ),
  ),
);
institutionRouter.get(
  '/:id/bulk-requests',
  validateQuery(institutionQuerySchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await service.bulkRequests(
        requireAuth(req),
        req.params['id']!,
        req.query as never,
      ),
    ),
  ),
);
institutionRouter.post(
  '/:id/bulk-requests',
  validateBody(bulkMealRequestSchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await service.requestBulk(requireAuth(req), req.params['id']!, req.body),
      201,
    ),
  ),
);
