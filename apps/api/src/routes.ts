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
apiRouter.use('/auth', authRouter);

// Scoped to the signed-in user; no route here takes another user's id.
apiRouter.use('/profile', profileRouter);
apiRouter.use('/children', childRouter);
apiRouter.use('/reference', referenceRouter);

// Read-only customer catalog. Registers no write verbs at all.
apiRouter.use('/catalog', catalogRouter);

// Role-guarded surfaces. Each router applies its own authorize() internally, so
// mounting one here cannot accidentally expose it.
apiRouter.use('/admin', adminRouter);
apiRouter.use('/vendor', vendorRouter);
apiRouter.use('/delivery', deliveryRouter);
apiRouter.use('/checkpoints', checkpointRouter);
apiRouter.use('/cart', cartRouter);
apiRouter.use('/orders', orderRouter);

// Mounted as the modules land:
//   apiRouter.use('/payments', paymentsRouter);
//   apiRouter.use('/subscriptions', subscriptionsRouter);
