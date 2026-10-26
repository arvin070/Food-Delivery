import { Router } from 'express';
import { z } from 'zod';
import { paginationSchema } from '@lunch/shared';
import { asyncHandler, created, ok } from '../../core/http';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { authorizeBuyer } from '../../middleware/authorize';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate';
import { actionSchema, subscribeSchema } from './subscription.schema';
import * as service from './subscription.service';
export const subscriptionRouter = Router();
subscriptionRouter.use(authenticate, authorizeBuyer());
subscriptionRouter.get('/', validateQuery(paginationSchema), asyncHandler(async (req, res) => ok(res, await service.listSubscriptions(requireAuth(req).userId, Number(req.query.page)))));
subscriptionRouter.post('/', validateBody(subscribeSchema), asyncHandler(async (req, res) => {
  const subscription = await service.subscribe(requireAuth(req).userId, req.body);
  const generation = await service.generateSubscription(requireAuth(req).userId, subscription.id);
  return created(res, { subscription, generation });
}));
subscriptionRouter.use('/:id', validateParams(z.object({ id: z.string().min(1).max(64) })));
subscriptionRouter.get('/:id', validateQuery(paginationSchema), asyncHandler(async (req, res) => ok(res, await service.subscriptionDetail(requireAuth(req).userId, req.params.id as string, Number(req.query.page)))));
subscriptionRouter.post('/:id/actions', validateBody(actionSchema), asyncHandler(async (req, res) => {
  const userId = requireAuth(req).userId;
  const id = req.params.id as string;
  await service.changeSubscription(userId, id, req.body.action, req.body.date);
  if (req.body.action === 'RESUME') await service.generateSubscription(userId, id);
  return ok(res, await service.subscriptionDetail(userId, id));
}));
subscriptionRouter.post('/:id/generate', asyncHandler(async (req, res) => ok(res, await service.generateSubscription(requireAuth(req).userId, req.params.id as string))));
