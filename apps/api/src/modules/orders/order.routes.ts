import { issueCode } from '../delivery/delivery.service';
import { Router } from 'express';
import {
  cancelOrderSchema,
  checkoutSchema,
  listOrdersQuerySchema,
  orderIdParamSchema,
} from '@lunch/shared';
import { asyncHandler, created, ok, paginated } from '../../core/http';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { authorizeBuyer } from '../../middleware/authorize';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate';
import * as orderService from './order.service';

export const orderRouter = Router();
orderRouter.use(authenticate, authorizeBuyer());

orderRouter.get(
  ['/', '/history'],
  validateQuery(listOrdersQuerySchema),
  asyncHandler(async (req, res) => {
    const { userId } = requireAuth(req);
    return paginated(res, await orderService.listOrders(userId, req.query as never));
  })
);

orderRouter.post(
  ['/checkout', '/'],
  validateBody(checkoutSchema),
  asyncHandler(async (req, res) => {
    const { userId } = requireAuth(req);
    const order = await orderService.checkout(userId, req.body.idempotencyKey);
    return created(res, { order });
  })
);

orderRouter.get(
  '/:orderId',
  validateParams(orderIdParamSchema),
  asyncHandler(async (req, res) => {
    const { userId } = requireAuth(req);
    return ok(res, { order: await orderService.getOrder(userId, req.params['orderId'] as string) });
  })
);

orderRouter.post(
  '/:orderId/cancel',
  validateParams(orderIdParamSchema),
  validateBody(cancelOrderSchema),
  asyncHandler(async (req, res) => {
    const { userId } = requireAuth(req);
    const order = await orderService.cancelOrder(userId, req.params['orderId'] as string, req.body);
    return ok(res, { order });
  })
);
orderRouter.post('/:orderId/items/:orderItemId/delivery-code',asyncHandler(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 return ok(res,await issueCode(requireAuth(req).userId,req.params['orderId']!,req.params['orderItemId']!));
}));
