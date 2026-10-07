/**
 * Checkpoint API.
 *
 * Surface layout:
 *
 *   GET    /checkpoints           — paginated list (public read, admin sees inactive)
 *   GET    /checkpoints/:id       — detail
 *   POST   /checkpoints           — create (SUPER_ADMIN | INSTITUTION_ADMIN)
 *   PATCH  /checkpoints/:id       — update (SUPER_ADMIN | INSTITUTION_ADMIN)
 *   PATCH  /checkpoints/:id/status — toggle active (SUPER_ADMIN only)
 *   POST   /checkpoints/:id/default  — set as my default
 *   DELETE /checkpoints/:id/default  — clear my default
 *
 * The `childId` query param on the default endpoints lets a parent assign the
 * checkpoint to one of their children rather than themselves.
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  checkpointIdParamSchema,
  createCheckpointSchema,
  idSchema,
  listCheckpointsQuerySchema,
  updateCheckpointSchema,
} from '@lunch/shared';
import { UserRole } from '@lunch/shared';
import { asyncHandler, created, noContent, ok, paginated } from '../../core/http';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate';
import * as checkpointService from './checkpoint.service';

export const checkpointRouter = Router();

// All checkpoint endpoints require authentication.
checkpointRouter.use(authenticate);

// ─── Read endpoints (any authenticated role) ──────────────────────────────────

checkpointRouter.get(
  '/',
  validateQuery(listCheckpointsQuerySchema),
  asyncHandler(async (req, res) => {
    const { role, userId } = requireAuth(req);
    const result = await checkpointService.listCheckpoints(req.query as never, role, userId);
    return paginated(res, result);
  })
);

checkpointRouter.get(
  '/:checkpointId',
  validateParams(checkpointIdParamSchema),
  asyncHandler(async (req, res) => {
    const { role, userId } = requireAuth(req);
    const checkpoint = await checkpointService.getCheckpoint(
      req.params['checkpointId'] as string,
      role,
      userId
    );
    return ok(res, { checkpoint });
  })
);

// ─── Write endpoints (SUPER_ADMIN | INSTITUTION_ADMIN) ────────────────────────

checkpointRouter.post(
  '/',
  authorize(UserRole.SUPER_ADMIN, UserRole.INSTITUTION_ADMIN),
  validateBody(createCheckpointSchema),
  asyncHandler(async (req, res) => {
    const { role, userId } = requireAuth(req);
    const checkpoint = await checkpointService.createCheckpoint(req.body, role, userId);
    return created(res, { checkpoint });
  })
);

checkpointRouter.patch(
  '/:checkpointId',
  authorize(UserRole.SUPER_ADMIN, UserRole.INSTITUTION_ADMIN),
  validateParams(checkpointIdParamSchema),
  validateBody(updateCheckpointSchema),
  asyncHandler(async (req, res) => {
    const { role, userId } = requireAuth(req);
    const checkpoint = await checkpointService.updateCheckpoint(
      req.params['checkpointId'] as string,
      req.body,
      role,
      userId
    );
    return ok(res, { checkpoint });
  })
);

checkpointRouter.patch(
  '/:checkpointId/status',
  authorize(UserRole.SUPER_ADMIN, UserRole.INSTITUTION_ADMIN),
  validateParams(checkpointIdParamSchema),
  validateBody(z.object({ isActive: z.boolean() })),
  asyncHandler(async (req, res) => {
    const { role, userId } = requireAuth(req);
    const checkpoint = await checkpointService.setCheckpointStatus(
      req.params['checkpointId'] as string,
      req.body.isActive as boolean,
      role,
      userId
    );
    return ok(res, { checkpoint });
  })
);

// ─── Default checkpoint management (any buyer role) ───────────────────────────

const defaultQuerySchema = z.object({ childId: idSchema.optional() });

checkpointRouter.post(
  '/:checkpointId/default',
  validateParams(checkpointIdParamSchema),
  validateQuery(defaultQuerySchema),
  asyncHandler(async (req, res) => {
    const { userId } = requireAuth(req);
    const { childId } = req.query as { childId?: string };
    await checkpointService.saveDefaultCheckpoint(
      userId,
      req.params['checkpointId'] as string,
      childId
    );
    return noContent(res);
  })
);

checkpointRouter.delete(
  '/:checkpointId/default',
  validateParams(checkpointIdParamSchema),
  validateQuery(defaultQuerySchema),
  asyncHandler(async (req, res) => {
    const { userId } = requireAuth(req);
    const { childId } = req.query as { childId?: string };
    await checkpointService.clearDefaultCheckpoint(userId, childId);
    return noContent(res);
  })
);
