/**
 * Vendor API.
 *
 * VENDOR only, plus SUPER_ADMIN for support (who must name a vendor with
 * `?vendorId=`). The guard is applied to the whole router, and every handler
 * resolves its vendor through `resolveVendorContext` and passes that id into
 * the service — so no handler can reach another business's data by accident.
 *
 * Reads are allowed for any vendor; writes additionally require an APPROVED
 * vendor, via `assertVendorCanTrade`.
 */
import { Router } from 'express';
import {
  bulkUpdateOrderItemStatusSchema,
  createMealSchema,
  listAvailabilityQuerySchema,
  publishAvailabilitySchema,
  scheduleIdParamSchema,
  updateAvailabilitySchema,
  kitchenIdParamSchema,
  listMealsQuerySchema,
  listVendorOrdersQuerySchema,
  mealIdParamSchema,
  orderItemIdParamSchema,
  updateKitchenSchema,
  updateMealSchema,
  updateOrderItemStatusSchema,
  updateServiceAreasSchema,
} from '@lunch/shared';
import { asyncHandler, created, noContent, ok, paginated } from '../../core/http';
import { authenticate } from '../../middleware/authenticate';
import { authorizeVendor } from '../../middleware/authorize';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate';
import * as availabilityService from './availability.service';
import * as dashboardService from './dashboard.service';
import * as kitchenService from './kitchen.service';
import * as mealService from './meal.service';
import * as orderService from './order.service';
import { assertVendorCanTrade, resolveVendorContext } from './vendor.context';

export const vendorRouter = Router();

vendorRouter.use(authenticate, authorizeVendor());

// ─── Profile & dashboard ─────────────────────────────────────────────────────

vendorRouter.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const context = await resolveVendorContext(req);
    const kitchens = await kitchenService.listKitchens(context.vendorId);
    return ok(res, {
      vendor: {
        id: context.vendorId,
        businessName: context.businessName,
        status: context.status,
        commissionPct: context.commissionPct,
      },
      kitchens,
    });
  })
);

vendorRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const context = await resolveVendorContext(req);
    const dashboard = await dashboardService.getDashboard(context);
    return ok(res, { dashboard });
  })
);

// ─── Kitchens ────────────────────────────────────────────────────────────────

vendorRouter.get(
  '/kitchens',
  asyncHandler(async (req, res) => {
    const context = await resolveVendorContext(req);
    const kitchens = await kitchenService.listKitchens(context.vendorId);
    return ok(res, { kitchens });
  })
);

vendorRouter.get(
  '/kitchens/:kitchenId',
  validateParams(kitchenIdParamSchema),
  asyncHandler(async (req, res) => {
    const context = await resolveVendorContext(req);
    const kitchen = await kitchenService.getKitchen(
      context.vendorId,
      req.params['kitchenId'] as string
    );
    return ok(res, { kitchen });
  })
);

vendorRouter.patch(
  '/kitchens/:kitchenId',
  validateParams(kitchenIdParamSchema),
  validateBody(updateKitchenSchema),
  asyncHandler(async (req, res) => {
    const context = await resolveVendorContext(req);
    assertVendorCanTrade(context);
    const kitchen = await kitchenService.updateKitchen(
      context.vendorId,
      req.params['kitchenId'] as string,
      req.body
    );
    return ok(res, { kitchen });
  })
);

vendorRouter.put(
  '/kitchens/:kitchenId/service-areas',
  validateParams(kitchenIdParamSchema),
  validateBody(updateServiceAreasSchema),
  asyncHandler(async (req, res) => {
    const context = await resolveVendorContext(req);
    assertVendorCanTrade(context);
    const kitchen = await kitchenService.updateServiceAreas(
      context.vendorId,
      req.params['kitchenId'] as string,
      req.body
    );
    return ok(res, { kitchen });
  })
);

// ─── Menu ────────────────────────────────────────────────────────────────────

vendorRouter.get(
  '/meals',
  validateQuery(listMealsQuerySchema),
  asyncHandler(async (req, res) => {
    const context = await resolveVendorContext(req);
    const result = await mealService.listMeals(context.vendorId, req.query as never);
    return paginated(res, result);
  })
);

vendorRouter.post(
  '/meals',
  validateBody(createMealSchema),
  asyncHandler(async (req, res) => {
    const context = await resolveVendorContext(req);
    assertVendorCanTrade(context);
    const meal = await mealService.createMeal(context.vendorId, req.body);
    return created(res, { meal });
  })
);

vendorRouter.get(
  '/meals/:mealId',
  validateParams(mealIdParamSchema),
  asyncHandler(async (req, res) => {
    const context = await resolveVendorContext(req);
    const meal = await mealService.getMeal(context.vendorId, req.params['mealId'] as string);
    return ok(res, { meal });
  })
);

vendorRouter.patch(
  '/meals/:mealId',
  validateParams(mealIdParamSchema),
  validateBody(updateMealSchema),
  asyncHandler(async (req, res) => {
    const context = await resolveVendorContext(req);
    assertVendorCanTrade(context);
    const meal = await mealService.updateMeal(
      context.vendorId,
      req.params['mealId'] as string,
      req.body
    );
    return ok(res, { meal });
  })
);

vendorRouter.delete(
  '/meals/:mealId',
  validateParams(mealIdParamSchema),
  asyncHandler(async (req, res) => {
    const context = await resolveVendorContext(req);
    assertVendorCanTrade(context);
    await mealService.removeMeal(context.vendorId, req.params['mealId'] as string);
    return noContent(res);
  })
);

// ─── Orders ──────────────────────────────────────────────────────────────────

vendorRouter.get(
  '/orders',
  validateQuery(listVendorOrdersQuerySchema),
  asyncHandler(async (req, res) => {
    const context = await resolveVendorContext(req);
    const result = await orderService.listOrders(context.vendorId, req.query as never);
    return paginated(res, result);
  })
);

vendorRouter.get(
  '/orders/:orderItemId',
  validateParams(orderItemIdParamSchema),
  asyncHandler(async (req, res) => {
    const context = await resolveVendorContext(req);
    const orderItem = await orderService.getOrderItem(
      context.vendorId,
      req.params['orderItemId'] as string
    );
    return ok(res, { orderItem });
  })
);

vendorRouter.patch(
  '/orders/:orderItemId/status',
  validateParams(orderItemIdParamSchema),
  validateBody(updateOrderItemStatusSchema),
  asyncHandler(async (req, res) => {
    const context = await resolveVendorContext(req);
    assertVendorCanTrade(context);
    const orderItem = await orderService.updateOrderItemStatus(
      context.vendorId,
      req.params['orderItemId'] as string,
      req.body
    );
    return ok(res, { orderItem });
  })
);

vendorRouter.post(
  '/orders/bulk-status',
  validateBody(bulkUpdateOrderItemStatusSchema),
  asyncHandler(async (req, res) => {
    const context = await resolveVendorContext(req);
    assertVendorCanTrade(context);
    const result = await orderService.bulkUpdateOrderItemStatus(context.vendorId, req.body);
    return ok(res, result);
  })
);

// ─── Availability (publishing meals for dates) ───────────────────────────────

vendorRouter.get(
  '/availability',
  validateQuery(listAvailabilityQuerySchema),
  asyncHandler(async (req, res) => {
    const context = await resolveVendorContext(req);
    const result = await availabilityService.listAvailability(context.vendorId, req.query as never);
    return paginated(res, result);
  })
);

vendorRouter.post(
  '/availability',
  validateBody(publishAvailabilitySchema),
  asyncHandler(async (req, res) => {
    const context = await resolveVendorContext(req);
    assertVendorCanTrade(context);
    const result = await availabilityService.publishAvailability(context.vendorId, req.body);
    return created(res, result);
  })
);

vendorRouter.patch(
  '/availability/:scheduleId',
  validateParams(scheduleIdParamSchema),
  validateBody(updateAvailabilitySchema),
  asyncHandler(async (req, res) => {
    const context = await resolveVendorContext(req);
    assertVendorCanTrade(context);
    const availability = await availabilityService.updateAvailability(
      context.vendorId,
      req.params['scheduleId'] as string,
      req.body
    );
    return ok(res, { availability });
  })
);

vendorRouter.delete(
  '/availability/:scheduleId',
  validateParams(scheduleIdParamSchema),
  asyncHandler(async (req, res) => {
    const context = await resolveVendorContext(req);
    assertVendorCanTrade(context);
    await availabilityService.withdrawAvailability(
      context.vendorId,
      req.params['scheduleId'] as string
    );
    return noContent(res);
  })
);
