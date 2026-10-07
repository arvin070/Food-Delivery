import { Router } from 'express';
import {
  addCartItemSchema,
  cartItemIdParamSchema,
  updateCartItemSchema,
} from '@lunch/shared';
import { asyncHandler, noContent, ok } from '../../core/http';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { authorizeBuyer } from '../../middleware/authorize';
import { validateBody, validateParams } from '../../middleware/validate';
import * as cartService from './cart.service';

export const cartRouter = Router();
cartRouter.use(authenticate, authorizeBuyer());

cartRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = requireAuth(req);
    return ok(res, { cart: await cartService.getCart(userId) });
  })
);

cartRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = requireAuth(req);
    return ok(res, { cart: await cartService.getCart(userId) }, 201);
  })
);

cartRouter.post(
  '/items',
  validateBody(addCartItemSchema),
  asyncHandler(async (req, res) => {
    const { userId } = requireAuth(req);
    return ok(res, { cart: await cartService.addCartItem(userId, req.body) }, 201);
  })
);

cartRouter.patch(
  '/items/:cartItemId',
  validateParams(cartItemIdParamSchema),
  validateBody(updateCartItemSchema),
  asyncHandler(async (req, res) => {
    const { userId } = requireAuth(req);
    const cart = await cartService.updateCartItem(
      userId,
      req.params['cartItemId'] as string,
      req.body
    );
    return ok(res, { cart });
  })
);

cartRouter.delete(
  '/items/:cartItemId',
  validateParams(cartItemIdParamSchema),
  asyncHandler(async (req, res) => {
    const { userId } = requireAuth(req);
    await cartService.removeCartItem(userId, req.params['cartItemId'] as string);
    return noContent(res);
  })
);