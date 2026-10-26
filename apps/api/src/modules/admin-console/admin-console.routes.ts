import { Router } from 'express';
import {
  adminResourceSchema,
  adminListSchema,
  adminActionSchema,
  complaintSchema,
} from '@lunch/shared';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { authorizeAdmin } from '../../middleware/authorize';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../middleware/validate';
import { asyncHandler, ok, clientIp } from '../../core/http';
import { prisma } from '../../core/prisma';
import * as service from './admin-console.service';
import * as complaints from './complaint.service';
export const adminConsoleRouter = Router();
adminConsoleRouter.use(authenticate, authorizeAdmin());
adminConsoleRouter.get(
  '/dashboard',
  validateQuery(adminListSchema),
  asyncHandler(async (req, res) =>
    ok(res, await service.dashboard(req.query['date'] as string | undefined)),
  ),
);
adminConsoleRouter.get(
  '/options',
  asyncHandler(async (_req, res) =>
    ok(res, {
      cities: await prisma.city.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    }),
  ),
);
adminConsoleRouter.get(
  '/audit',
  validateQuery(adminListSchema),
  asyncHandler(async (req, res) =>
    ok(res, await service.audit(req.query as never)),
  ),
);
adminConsoleRouter.use(
  '/manage/:resource',
  validateParams(adminResourceSchema),
);
adminConsoleRouter.get(
  '/manage/:resource',
  validateQuery(adminListSchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await service.list(req.params['resource'] as never, req.query as never),
    ),
  ),
);
adminConsoleRouter.get(
  '/manage/:resource/:id',
  validateQuery(adminListSchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await service.detail(
        req.params['resource'] as never,
        req.params['id']!,
        Number(req.query['page']),
      ),
    ),
  ),
);
adminConsoleRouter.post(
  '/manage/:resource/:id/actions',
  validateBody(adminActionSchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await service.act(
        requireAuth(req).userId,
        req.params['resource'] as never,
        req.params['id']!,
        req.body,
        { ip: clientIp(req), userAgent: req.headers['user-agent'] },
      ),
    ),
  ),
);
export const complaintRouter = Router();
complaintRouter.use(authenticate);
complaintRouter.get(
  '/',
  validateQuery(adminListSchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await complaints.listComplaints(
        requireAuth(req).userId,
        Number(req.query['page']),
      ),
    ),
  ),
);
complaintRouter.post(
  '/',
  validateBody(complaintSchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await complaints.submitComplaint(requireAuth(req).userId, req.body),
      201,
    ),
  ),
);
