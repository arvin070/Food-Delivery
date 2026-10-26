import { Router } from 'express';
import {
  corporateQuerySchema,
  createCompanySchema,
  corporatePolicySchema,
  approveCompanySchema,
  corporateEmployeeSchema,
  corporateEmployeeUpdateSchema,
  corporateOfficeSchema,
  corporateOrderSchema,
  corporateInvoiceSchema,
  corporateSettlementSchema,
} from '@lunch/shared';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validateBody, validateQuery } from '../../middleware/validate';
import { asyncHandler, ok } from '../../core/http';
import * as s from './corporate.service';
export const corporateRouter = Router();
corporateRouter.use(
  authenticate,
  authorize('CUSTOMER', 'PARENT', 'STUDENT', 'SUPER_ADMIN'),
);
corporateRouter.get(
  '/',
  validateQuery(corporateQuerySchema),
  asyncHandler(async (req, res) =>
    ok(res, await s.list(requireAuth(req), req.query as never)),
  ),
);
corporateRouter.post(
  '/',
  validateBody(createCompanySchema),
  asyncHandler(async (req, res) =>
    ok(res, await s.create(requireAuth(req), req.body), 201),
  ),
);
corporateRouter.get(
  '/:id',
  asyncHandler(async (req, res) =>
    ok(res, await s.detail(requireAuth(req), req.params['id']!)),
  ),
);
corporateRouter.patch(
  '/:id/policy',
  validateBody(corporatePolicySchema),
  asyncHandler(async (req, res) =>
    ok(res, await s.policy(requireAuth(req), req.params['id']!, req.body)),
  ),
);
corporateRouter.post(
  '/:id/credit',
  authorize('SUPER_ADMIN'),
  validateBody(approveCompanySchema),
  asyncHandler(async (req, res) =>
    ok(res, await s.approve(requireAuth(req), req.params['id']!, req.body)),
  ),
);
corporateRouter.get(
  '/:id/employees',
  validateQuery(corporateQuerySchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await s.employees(
        requireAuth(req),
        req.params['id']!,
        req.query as never,
      ),
    ),
  ),
);
corporateRouter.post(
  '/:id/employees',
  validateBody(corporateEmployeeSchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await s.addEmployee(requireAuth(req), req.params['id']!, req.body),
      201,
    ),
  ),
);
corporateRouter.patch(
  '/:id/employees/:memberId',
  validateBody(corporateEmployeeUpdateSchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await s.updateEmployee(
        requireAuth(req),
        req.params['id']!,
        req.params['memberId']!,
        req.body,
      ),
    ),
  ),
);
corporateRouter.get(
  '/:id/offices',
  asyncHandler(async (req, res) =>
    ok(res, await s.offices(requireAuth(req), req.params['id']!)),
  ),
);
corporateRouter.post(
  '/:id/offices',
  validateBody(corporateOfficeSchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await s.createOffice(requireAuth(req), req.params['id']!, req.body),
      201,
    ),
  ),
);
corporateRouter.get(
  '/:id/usage',
  validateQuery(corporateQuerySchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await s.usage(requireAuth(req), req.params['id']!, req.query as never),
    ),
  ),
);
corporateRouter.get(
  '/:id/offers',
  validateQuery(corporateQuerySchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await s.offers(requireAuth(req), req.params['id']!, req.query as never),
    ),
  ),
);
corporateRouter.get(
  '/:id/orders',
  validateQuery(corporateQuerySchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await s.orders(requireAuth(req), req.params['id']!, req.query as never),
    ),
  ),
);
corporateRouter.post(
  '/:id/orders',
  validateBody(corporateOrderSchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await s.checkout(requireAuth(req), req.params['id']!, req.body),
      201,
    ),
  ),
);
corporateRouter.post(
  '/:id/orders/:orderId/cancel',
  asyncHandler(async (req, res) =>
    ok(
      res,
      await s.cancel(
        requireAuth(req),
        req.params['id']!,
        req.params['orderId']!,
      ),
    ),
  ),
);
corporateRouter.post(
  '/:id/expire',
  asyncHandler(async (req, res) =>
    ok(res, await s.expire(requireAuth(req), req.params['id']!)),
  ),
);
corporateRouter.get(
  '/:id/invoices',
  validateQuery(corporateQuerySchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await s.invoices(requireAuth(req), req.params['id']!, req.query as never),
    ),
  ),
);
corporateRouter.post(
  '/:id/invoices',
  validateBody(corporateInvoiceSchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await s.issueInvoice(requireAuth(req), req.params['id']!, req.body.month),
      201,
    ),
  ),
);
corporateRouter.post(
  '/:id/invoices/:invoiceId/settle',
  authorize('SUPER_ADMIN'),
  validateBody(corporateSettlementSchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await s.settleInvoice(
        requireAuth(req),
        req.params['id']!,
        req.params['invoiceId']!,
        req.body,
      ),
    ),
  ),
);
