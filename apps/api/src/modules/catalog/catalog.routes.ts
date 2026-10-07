/**
 * Customer catalog. **Read-only by construction**: this router registers only
 * GET handlers, so there is no path by which a customer can modify menu data.
 * Menu writes live on the vendor router behind `authorizeVendor()`.
 *
 * Authenticated but not role-restricted — every buyer role browses the same
 * catalog, and an admin may look at it for support.
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  browseCatalogQuerySchema,
  deliverySlotsQuerySchema,
  mealScheduleIdParamSchema,
} from '@lunch/shared';
import { asyncHandler, ok, paginated } from '../../core/http';
import { authenticate } from '../../middleware/authenticate';
import { validateParams, validateQuery } from '../../middleware/validate';
import * as catalogService from './catalog.service';

export const catalogRouter = Router();

catalogRouter.use(authenticate);

/** Browse what can be delivered to a checkpoint on a date. */
catalogRouter.get(
  '/delivery-slots',
  validateQuery(deliverySlotsQuerySchema),
  asyncHandler(async (req, res) => {
    const slots = await catalogService.availableDeliverySlots(req.query as never);
    return ok(res, { slots });
  })
);

catalogRouter.get(
  '/meals',
  validateQuery(browseCatalogQuerySchema),
  asyncHandler(async (req, res) => {
    const { result, facets } = await catalogService.browse(req.query as never);
    const { items, ...meta } = result;
    return res.status(200).json({ data: items, meta: { ...meta, facets } });
  })
);

const datesQuerySchema = z.object({
  checkpointId: z.string().min(1).optional(),
  days: z.coerce.number().int().min(1).max(60).default(14),
});

/** Which of the next N dates have anything available. Drives the date picker. */
catalogRouter.get(
  '/dates',
  validateQuery(datesQuerySchema),
  asyncHandler(async (req, res) => {
    const { checkpointId, days } = req.query as unknown as z.infer<typeof datesQuerySchema>;
    const dates = await catalogService.availableDates(checkpointId, days);
    return ok(res, { dates });
  })
);

const detailQuerySchema = z.object({ checkpointId: z.string().min(1).optional() });

catalogRouter.get(
  '/meals/:mealScheduleId',
  validateParams(mealScheduleIdParamSchema),
  validateQuery(detailQuerySchema),
  asyncHandler(async (req, res) => {
    const { checkpointId } = req.query as { checkpointId?: string };
    const meal = await catalogService.getMealDetail(
      req.params['mealScheduleId'] as string,
      checkpointId
    );
    return ok(res, { meal });
  })
);

// Intentionally no POST/PATCH/PUT/DELETE. Any such request falls through to the
// 404 handler, so the read-only guarantee does not depend on a role check.
