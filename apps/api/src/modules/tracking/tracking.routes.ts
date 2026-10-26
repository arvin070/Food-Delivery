import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { riderEtaSchema, riderLocationSchema, trackingSessionSchema, UserRole } from '@lunch/shared';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validateBody } from '../../middleware/validate';
import { makeLimiter } from '../../middleware/rate-limit';
import { asyncHandler, ok } from '../../core/http';
import * as service from './tracking.service';

export const trackingRouter = Router();
trackingRouter.use(authenticate);
const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  orderId: z.string().cuid().optional(),
}).strict();
const routeParam = z.string().cuid();
const connections = new Map<string, number>();
let totalConnections = 0;

/** DB-backed snapshots work across API replicas. Never trust a client-supplied audience or channel. */
async function stream(req: Request, res: Response, snapshot: () => Promise<unknown>) {
  const userId = requireAuth(req).userId;
  if ((connections.get(userId) ?? 0) >= 6 || totalConnections >= 500) {
    res.setHeader('Retry-After', '10');
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many live connections. Close another tab and retry.' } });
    return;
  }
  connections.set(userId, (connections.get(userId) ?? 0) + 1);
  totalConnections++;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = setTimeout(() => res.end(), 50_000);
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer); clearTimeout(deadline);
    const count = (connections.get(userId) ?? 1) - 1;
    if (count) connections.set(userId, count); else connections.delete(userId);
    totalConnections--;
  };
  res.on('close', cleanup);
  let previous = '';
  const send = async () => {
    // Re-read session, role, suspension and object ownership for every snapshot.
    await new Promise<void>((resolve, reject) => { void authenticate(req, res, err => err ? reject(err) : resolve()); });
    const value = await snapshot();
    if (closed || res.destroyed) return;
    if (!res.headersSent) {
      res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'private, no-store, no-transform',
        'X-Accel-Buffering': 'no', 'Connection': 'keep-alive' });
      res.flushHeaders();
      res.write('retry: 3000\n\n');
    }
    // serverTime is refreshed in every tracking snapshot so clients can age locations independently of their clock.
    const payload = JSON.stringify(value);
    const frame = payload !== previous ? `event: snapshot\ndata: ${payload}\n\n` : 'event: heartbeat\ndata: {}\n\n';
    previous = payload;
    if (!res.write(frame)) { res.end(); return; } // Bound buffers for slow/disconnected clients.
    timer = setTimeout(() => { void send().catch(fail); }, 5000);
  };
  const fail = (error: unknown) => {
    if (closed) return;
    const status = (error as { statusCode?: number })?.statusCode;
    if (res.headersSent) {
      res.write(`event: ${[401, 403, 404].includes(status ?? 0) ? 'access-lost' : 'unavailable'}\ndata: {}\n\n`);
      res.end();
    } else { cleanup(); res.status(status && status < 500 ? status : 503).json({ error: {
      code: status === 401 ? 'UNAUTHENTICATED' : 'TRACKING_UNAVAILABLE', message: 'Live tracking is unavailable. Reconnect or sign in again.',
    } }); }
  };
  try { await send(); } catch (error) { fail(error); }
}
trackingRouter.get('/events', asyncHandler(async (req, res) => {
  await stream(req, res, () => service.dashboardRevision(requireAuth(req)));
}));
trackingRouter.get('/meals', asyncHandler(async (req, res) => {
  const q = querySchema.parse(req.query);
  return ok(res, await service.trackingSnapshot(requireAuth(req).userId, q.page, q.orderId));
}));
trackingRouter.get('/meals/events', asyncHandler(async (req, res) => {
  const q = querySchema.parse(req.query);
  await stream(req, res, () => service.trackingSnapshot(requireAuth(req).userId, q.page, q.orderId));
}));
trackingRouter.use('/routes', authorize(UserRole.DELIVERY_PARTNER), makeLimiter({
  windowMs: 60_000, limit: 40, keyGenerator: req => requireAuth(req).userId,
}));
trackingRouter.post('/routes/:routeId/sharing', asyncHandler(async (req, res) =>
  ok(res, await service.startSharing(requireAuth(req).userId, routeParam.parse(req.params['routeId'])))));
trackingRouter.delete('/routes/:routeId/sharing', validateBody(trackingSessionSchema), asyncHandler(async (req, res) =>
  ok(res, await service.stopSharing(requireAuth(req).userId, routeParam.parse(req.params['routeId']), req.body.sessionId))));
trackingRouter.put('/routes/:routeId/location', validateBody(riderLocationSchema), asyncHandler(async (req, res) =>
  ok(res, await service.updateLocation(requireAuth(req).userId, routeParam.parse(req.params['routeId']), req.body))));
trackingRouter.put('/routes/:routeId/eta', validateBody(riderEtaSchema), asyncHandler(async (req, res) =>
  ok(res, await service.updateEta(requireAuth(req).userId, routeParam.parse(req.params['routeId']), req.body))));
