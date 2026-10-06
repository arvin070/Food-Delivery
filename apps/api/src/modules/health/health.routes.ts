import { Router } from 'express';
import { asyncHandler, ok } from '../../core/http';
import { prisma } from '../../core/prisma';

export const healthRouter = Router();

/** Liveness — is the process up? Cheap enough for a frequent probe. */
healthRouter.get('/live', (_req, res) => ok(res, { status: 'ok', uptime: process.uptime() }));

/** Readiness — can we actually serve traffic? Checks the database. */
healthRouter.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    const startedAt = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    return ok(res, {
      status: 'ok',
      database: { reachable: true, latencyMs: Date.now() - startedAt },
    });
  })
);
