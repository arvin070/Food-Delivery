/**
 * Vendor API.
 *
 * VENDOR only, plus SUPER_ADMIN so support staff can inspect a vendor's view.
 * Business endpoints (menu, schedules, order status) arrive with the vendor
 * module; this file establishes the guarded surface they attach to.
 */
import { Router } from 'express';
import { asyncHandler, ok } from '../../core/http';
import { notFound } from '../../core/errors';
import { prisma } from '../../core/prisma';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { authorizeVendor } from '../../middleware/authorize';

export const vendorRouter = Router();

vendorRouter.use(authenticate, authorizeVendor());

/** The vendor record belonging to the signed-in user. */
vendorRouter.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const { userId } = requireAuth(req);

    const vendor = await prisma.vendor.findFirst({
      where: { ownerUserId: userId, deletedAt: null },
      select: {
        id: true,
        businessName: true,
        legalName: true,
        status: true,
        commissionPct: true,
        isActive: true,
        approvedAt: true,
        kitchens: {
          where: { deletedAt: null },
          select: { id: true, name: true, capacityPerSlot: true, isActive: true },
        },
      },
    });

    if (!vendor) throw notFound('Vendor profile');

    return ok(res, {
      vendor: { ...vendor, commissionPct: vendor.commissionPct.toString() },
    });
  })
);
