import { trackingRouter } from './modules/tracking/tracking.routes';
import { intelligenceRouter } from './modules/intelligence/intelligence.routes';
import { analyticsRouter } from './modules/analytics/analytics.routes';
import { corporateRouter } from './modules/corporate/corporate.routes';
import { institutionRouter } from './modules/institutions/institution.routes';
import { adminConsoleRouter, complaintRouter } from './modules/admin-console/admin-console.routes';
import { notificationRouter } from './modules/notifications/notification.routes';
import { routeManagementRouter } from './modules/route-management/route-management.routes';
import { kitchenOperationsRouter, kitchenStaffRouter } from './modules/kitchen-ops/kitchen-ops.routes';
import { paymentRouter, adminPaymentRouter } from './modules/payments/payment.routes';
import { holidayRouter } from './modules/subscriptions/holiday.routes';
import { subscriptionRouter } from './modules/subscriptions/subscription.routes';
/**
 * API surface, versioned at `/api/v1`.
 *
 * Each feature module owns its own router; this file only mounts them. Adding a
 * module means adding one line here.
 */
import { Router } from 'express';
import { adminRouter } from './modules/admin/admin.routes';
import { authRouter } from './modules/auth/auth.routes';
import { catalogRouter } from './modules/catalog/catalog.routes';
import { checkpointRouter } from './modules/checkpoint/checkpoint.routes';
import { cartRouter } from './modules/cart/cart.routes';
import { childRouter } from './modules/children/child.routes';
import { deliveryRouter } from './modules/delivery/delivery.routes';
import { healthRouter } from './modules/health/health.routes';
import { orderRouter } from './modules/orders/order.routes';
import { profileRouter } from './modules/profile/profile.routes';
import { referenceRouter } from './modules/reference/reference.routes';
import { vendorRouter } from './modules/vendor/vendor.routes';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/intelligence', intelligenceRouter);
apiRouter.use('/auth', authRouter);

// Scoped to the signed-in user; no route here takes another user's id.
apiRouter.use('/profile', profileRouter);
apiRouter.use('/institutions', institutionRouter);
apiRouter.use('/corporate', corporateRouter);
apiRouter.use('/notifications', notificationRouter);
apiRouter.use('/children', childRouter);
apiRouter.use('/reference', referenceRouter);

// Read-only customer catalog. Registers no write verbs at all.
apiRouter.use('/catalog', catalogRouter);

// Role-guarded surfaces. Each router applies its own authorize() internally, so
// mounting one here cannot accidentally expose it.
apiRouter.use('/admin/holidays', holidayRouter);
apiRouter.use('/admin/payments', adminPaymentRouter);
apiRouter.use('/admin/kitchens', kitchenStaffRouter);
apiRouter.use('/admin/routes', routeManagementRouter);
apiRouter.use('/admin/analytics', analyticsRouter);
apiRouter.use('/admin', adminConsoleRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/complaints', complaintRouter);
apiRouter.use('/vendor', vendorRouter);
apiRouter.use('/kitchen', kitchenOperationsRouter);
apiRouter.use('/delivery', deliveryRouter);
apiRouter.use('/tracking', trackingRouter);
apiRouter.use('/checkpoints', checkpointRouter);
apiRouter.use('/cart', cartRouter);
apiRouter.use('/orders', orderRouter);

// Mounted as the modules land:
apiRouter.use('/payments', paymentRouter);
apiRouter.use('/subscriptions', subscriptionRouter);
