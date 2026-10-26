/**
 * Delivery-partner API.
 *
 * Partner operations always resolve the authenticated, active partner.
 * Only SUPER_ADMIN may create assignments; there is no handoff bypass.
 */
import { Router } from "express";
import {
  availabilitySchema,
  assignDeliverySchema,
  deliveryIdParamSchema,
  deliveryOrderItemIdParamSchema,
  updateDeliveryStatusSchema,
} from "@lunch/shared";
import { asyncHandler, ok } from "../../core/http";
import { notFound } from "../../core/errors";
import { prisma } from "../../core/prisma";
import { authenticate, requireAuth } from "../../middleware/authenticate";
import {
  authorize,
  authorizeDeliveryPartner,
} from "../../middleware/authorize";
import { validateBody, validateParams } from "../../middleware/validate";
import { UserRole } from "@lunch/shared";
import * as deliveryService from "./delivery.service";

export const deliveryRouter = Router();

deliveryRouter.use(authenticate, authorizeDeliveryPartner());

deliveryRouter.get(
  "/items",
  asyncHandler(async (req, res) => {
    const { userId, role } = requireAuth(req);
    return ok(res, {
      deliveries: await deliveryService.listDeliveries(
        userId,
        role === UserRole.SUPER_ADMIN,
      ),
    });
  }),
);

deliveryRouter.post(
  "/items/:orderItemId/assign",
  authorize(UserRole.SUPER_ADMIN),
  validateParams(deliveryOrderItemIdParamSchema),
  validateBody(assignDeliverySchema),
  asyncHandler(async (req, res) => {
    const delivery = await deliveryService.assignDelivery(
      req.params["orderItemId"] as string,
      req.body.deliveryPartnerId,
    );
    return ok(res, { delivery }, 201);
  }),
);

deliveryRouter.patch(
  "/items/:deliveryId/status",
  validateParams(deliveryIdParamSchema),
  validateBody(updateDeliveryStatusSchema),
  asyncHandler(async (req, res) => {
    const { userId, role } = requireAuth(req);
    const delivery = await deliveryService.updateDeliveryStatus(
      userId,
      role === UserRole.SUPER_ADMIN,
      req.params["deliveryId"] as string,
      req.body,
    );
    return ok(res, { delivery });
  }),
);

/** The delivery-partner record belonging to the signed-in user. */
deliveryRouter.get(
  "/profile",
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

    if (!partner) throw notFound("Delivery partner profile");

    return ok(res, { deliveryPartner: partner });
  }),
);

deliveryRouter.get(
  "/dashboard",
  asyncHandler(async (req, res) =>
    ok(res, await deliveryService.dashboard(requireAuth(req).userId)),
  ),
);
deliveryRouter.patch(
  "/availability",
  validateBody(availabilitySchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await deliveryService.availability(
        requireAuth(req).userId,
        req.body.isAvailable,
      ),
    ),
  ),
);
for (const action of ["pickup", "start"] as const)
  deliveryRouter.post(
    "/routes/:routeId/" + action,
    asyncHandler(async (req, res) =>
      ok(
        res,
        await deliveryService.routeAction(
          requireAuth(req).userId,
          req.params["routeId"]!,
          action,
        ),
      ),
    ),
  );
deliveryRouter.post(
  "/routes/:routeId/stops/:stopId/arrive",
  asyncHandler(async (req, res) =>
    ok(
      res,
      await deliveryService.routeAction(
        requireAuth(req).userId,
        req.params["routeId"]!,
        "arrive",
        req.params["stopId"]!,
      ),
    ),
  ),
);
deliveryRouter.get(
  "/routes/:routeId/stops/:stopId",
  asyncHandler(async (req, res) => {
    const page = Number(req.query["page"] ?? 1);
    return ok(
      res,
      await deliveryService.stopDetail(
        requireAuth(req).userId,
        req.params["routeId"]!,
        req.params["stopId"]!,
        Number.isSafeInteger(page) && page > 0 ? page : 1,
      ),
    );
  }),
);
