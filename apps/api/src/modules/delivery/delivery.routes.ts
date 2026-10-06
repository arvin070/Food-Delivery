/**
 * Delivery-partner API.
 *
 * DELIVERY_PARTNER only, plus SUPER_ADMIN for support. Runs, routes and
 * proof-of-delivery arrive with the delivery module.
 */
import { Router } from 'express';
import { asyncHandler, ok } from '../../core/http';
import { notFound } from '../../core/errors';
import { prisma } from '../../core/prisma';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { authorizeDeliveryPartner } from '../../middleware/authorize';

export const deliveryRouter = Router();

deliveryRouter.use(authenticate, authorizeDeliveryPartner());

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
