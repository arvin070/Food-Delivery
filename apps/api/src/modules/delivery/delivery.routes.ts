/**
 * Delivery-partner API.
 *
 * DELIVERY_PARTNER only, plus SUPER_ADMIN for support. Runs, routes and
 * proof-of-delivery arrive with the delivery module.
 */
import { Router } from 'express';
import {
  assignDeliverySchema,
  deliveryIdParamSchema,
  deliveryOrderItemIdParamSchema,
  updateDeliveryStatusSchema,
} from '@lunch/shared';
import { asyncHandler, ok } from '../../core/http';
import { notFound } from '../../core/errors';
import { prisma } from '../../core/prisma';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { authorize, authorizeDeliveryPartner } from '../../middleware/authorize';
import { validateBody, validateParams } from '../../middleware/validate';
import { UserRole } from '@lunch/shared';
import * as deliveryService from './delivery.service';

export const deliveryRouter = Router();

deliveryRouter.use(authenticate, authorizeDeliveryPartner());

deliveryRouter.get(
  '/items',
  asyncHandler(async (req, res) => {
    const { userId, role } = requireAuth(req);
    return ok(res, { deliveries: await deliveryService.listDeliveries(userId, role === UserRole.SUPER_ADMIN) });
  })
);

deliveryRouter.post(
  '/items/:orderItemId/assign',
  authorize(UserRole.SUPER_ADMIN),
  validateParams(deliveryOrderItemIdParamSchema),
  validateBody(assignDeliverySchema),
  asyncHandler(async (req, res) => {
    const delivery = await deliveryService.assignDelivery(
      req.params['orderItemId'] as string,
      req.body.deliveryPartnerId
    );
    return ok(res, { delivery }, 201);
  })
);

deliveryRouter.patch(
  '/items/:deliveryId/status',
  validateParams(deliveryIdParamSchema),
  validateBody(updateDeliveryStatusSchema),
  asyncHandler(async (req, res) => {
    const { userId, role } = requireAuth(req);
    const delivery = await deliveryService.updateDeliveryStatus(
      userId,
      role === UserRole.SUPER_ADMIN,
      req.params['deliveryId'] as string,
      req.body
    );
    return ok(res, { delivery });
  })
);

/** The delivery-partner record belonging to the signed-in user. */
deliveryRouter.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const { userId } = requireAuth(req);

    const partner = await prisma.deliveryPartner.findFirst({
      where: { userId, deletedAt: null },
      select: {
        id: true,
        vehicleType: true,
        vehicleNumber: true,
        isAvailable: true,
        isActive: true,
        cityId: true,
      },
    });

    if (!partner) throw notFound('Delivery partner profile');

    return ok(res, { deliveryPartner: partner });
  })
);
