/**
 * API surface, versioned at `/api/v1`.
 *
 * Each feature module owns its own router; this file only mounts them. Adding a
 * module means adding one line here.
 */
import { Router } from 'express';
import { adminRouter } from './modules/admin/admin.routes';
import { authRouter } from './modules/auth/auth.routes';
import { deliveryRouter } from './modules/delivery/delivery.routes';
import { healthRouter } from './modules/health/health.routes';
import { vendorRouter } from './modules/vendor/vendor.routes';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);

// Role-guarded surfaces. Each router applies its own authorize() internally, so
// mounting one here cannot accidentally expose it.
apiRouter.use('/admin', adminRouter);
apiRouter.use('/vendor', vendorRouter);
apiRouter.use('/delivery', deliveryRouter);

// Mounted as the modules land:
//   apiRouter.use('/profile', profileRouter);
//   apiRouter.use('/children', childrenRouter);
//   apiRouter.use('/catalog', catalogRouter);
//   apiRouter.use('/cart', cartRouter);
//   apiRouter.use('/orders', ordersRouter);
//   apiRouter.use('/payments', paymentsRouter);
//   apiRouter.use('/subscriptions', subscriptionsRouter);
