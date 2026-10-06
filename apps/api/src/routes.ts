/**
 * API surface, versioned at `/api/v1`.
 *
 * Each feature module owns its own router; this file only mounts them. Adding a
 * module means adding one line here.
 */
import { Router } from 'express';
import { authRouter } from './modules/auth/auth.routes';
import { healthRouter } from './modules/health/health.routes';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);

// Mounted as the modules land:
//   apiRouter.use('/profile', profileRouter);
//   apiRouter.use('/children', childrenRouter);
//   apiRouter.use('/catalog', catalogRouter);
//   apiRouter.use('/cart', cartRouter);
//   apiRouter.use('/orders', ordersRouter);
//   apiRouter.use('/payments', paymentsRouter);
//   apiRouter.use('/subscriptions', subscriptionsRouter);
//   apiRouter.use('/vendor', vendorRouter);
//   apiRouter.use('/delivery', deliveryRouter);
//   apiRouter.use('/admin', adminRouter);
