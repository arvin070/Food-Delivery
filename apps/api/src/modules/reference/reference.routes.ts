/**
 * Read-only lookups that populate form dropdowns: institutions, checkpoints,
 * cities and delivery time slots.
 *
 * Authenticated but not role-restricted — this is public reference data, and
 * every role needs some of it. Nothing here is user-specific, so there is
 * nothing to scope.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../../core/http';
import { prisma } from '../../core/prisma';
import { authenticate } from '../../middleware/authenticate';
import { validateQuery } from '../../middleware/validate';

export const referenceRouter = Router();

referenceRouter.use(authenticate);

const cityFilterSchema = z.object({ cityId: z.string().min(1).optional() });

referenceRouter.get(
  '/cities',
  asyncHandler(async (_req, res) => {
    const cities = await prisma.city.findMany({
      where: { isActive: true },
      select: { id: true, name: true, state: true },
      orderBy: { name: 'asc' },
    });
    return ok(res, { cities });
  })
);

referenceRouter.get(
  '/institutions',
  validateQuery(cityFilterSchema),
  asyncHandler(async (req, res) => {
    const { cityId } = req.query as { cityId?: string };
    const institutions = await prisma.institution.findMany({
      where: { isActive: true, ...(cityId ? { cityId } : {}) },
      select: { id: true, name: true, type: true, cityId: true },
      orderBy: { name: 'asc' },
    });
    return ok(res, { institutions });
  })
);

const checkpointFilterSchema = cityFilterSchema.extend({
  institutionId: z.string().min(1).optional(),
});

referenceRouter.get(
  '/checkpoints',
  validateQuery(checkpointFilterSchema),
  asyncHandler(async (req, res) => {
    const { cityId, institutionId } = req.query as { cityId?: string; institutionId?: string };
    const checkpoints = await prisma.checkpoint.findMany({
      where: {
        isActive: true,
        ...(cityId ? { cityId } : {}),
        ...(institutionId ? { institutionId } : {}),
      },
      select: {
        id: true,
        name: true,
        type: true,
        instructions: true,
        cityId: true,
        institutionId: true,
      },
      orderBy: { name: 'asc' },
    });
    return ok(res, { checkpoints });
  })
);

referenceRouter.get(
  '/time-slots',
  validateQuery(cityFilterSchema),
  asyncHandler(async (req, res) => {
    const { cityId } = req.query as { cityId?: string };
    const timeSlots = await prisma.timeSlot.findMany({
      where: { isActive: true, ...(cityId ? { cityId } : {}) },
      select: {
        id: true,
        label: true,
        mealPeriod: true,
        startMinute: true,
        endMinute: true,
        cityId: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { startMinute: 'asc' }],
    });
    return ok(res, { timeSlots });
  })
);
