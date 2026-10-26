import { Router } from 'express';
import {
  notificationPreferenceSchema,
  notificationQuerySchema,
  pushDeviceSchema,
} from '@lunch/shared';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { validateBody, validateQuery } from '../../middleware/validate';
import { asyncHandler, ok } from '../../core/http';
import { prisma } from '../../core/prisma';
import { env } from '../../config/env';
import * as service from './notification.service';
export const notificationRouter = Router();
notificationRouter.use(authenticate);
notificationRouter.get(
  '/',
  validateQuery(notificationQuerySchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await service.inbox(
        requireAuth(req).userId,
        Number(req.query['page']),
        req.query['unread'] === 'true',
      ),
    ),
  ),
);
notificationRouter.get(
  '/preferences',
  asyncHandler(async (req, res) => {
    const userId = requireAuth(req).userId;
    const [preferences, devices] = await Promise.all([
      service.preferences(userId),
      prisma.pushDevice.findMany({
        where: { userId },
        select: { id: true, platform: true, updatedAt: true },
      }),
    ]);
    return ok(res, {
      preferences,
      devices,
      externalDeliveryConfigured: env.NOTIFICATION_PROVIDER === 'gateway',
    });
  }),
);
notificationRouter.put(
  '/preferences',
  validateBody(notificationPreferenceSchema),
  asyncHandler(async (req, res) =>
    ok(res, {
      preferences: await service.updatePreferences(
        requireAuth(req).userId,
        req.body,
      ),
    }),
  ),
);
notificationRouter.post(
  '/read-all',
  asyncHandler(async (req, res) =>
    ok(res, await service.markAllRead(requireAuth(req).userId)),
  ),
);
notificationRouter.post(
  '/:notificationId/read',
  asyncHandler(async (req, res) =>
    ok(
      res,
      await service.markRead(
        requireAuth(req).userId,
        req.params['notificationId']!,
      ),
    ),
  ),
);
notificationRouter.post(
  '/devices',
  validateBody(pushDeviceSchema),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await service.registerDevice(requireAuth(req).userId, req.body),
      201,
    ),
  ),
);
notificationRouter.delete(
  '/devices/:deviceId',
  asyncHandler(async (req, res) =>
    ok(
      res,
      await service.removeDevice(
        requireAuth(req).userId,
        req.params['deviceId']!,
      ),
    ),
  ),
);
