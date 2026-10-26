import { handleWebhook } from './modules/payments/payment.service';
import { asyncHandler, ok } from './core/http';
/**
 * Express application assembly.
 *
 * Exported separately from `server.ts` so tests can mount the app with
 * supertest without binding a port.
 */
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';
import { env, isTest } from './config/env';
import { logger } from './core/logger';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { csrfProtection, inputBudget } from './middleware/security';
import { forbidden } from './core/errors';
import { globalLimiter, webhookLimiter } from './middleware/rate-limit';
import { apiRouter } from './routes';

export function createApp(): Express {
  const app = express();

  // Forwarding headers are trusted only with an explicitly configured proxy topology.
  app.set('trust proxy', env.API_TRUST_PROXY_HOPS);
  app.disable('x-powered-by');

  app.use(helmet());

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and non-browser clients send no Origin header.
        if (!origin || env.CORS_ORIGINS.includes(origin)) return callback(null, true);
        callback(forbidden('Origin is not allowed'));
      },
      credentials: true,
    })
  );

  // Signature verification must receive the exact bytes, before JSON parsing.
  app.post('/api/v1/payments/webhooks/:provider', webhookLimiter, express.raw({ type: 'application/json', limit: '256kb' }), asyncHandler(async (req, res) => {
    await handleWebhook(req.params.provider as string, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), String(req.headers['x-razorpay-signature'] ?? req.headers['x-payment-signature'] ?? ''));
    return ok(res, { received: true });
  }));
  app.use(globalLimiter);
  app.use((req,res,next)=>{
    if(req.is('multipart/form-data'))return res.status(415).json({error:{code:'BAD_REQUEST',message:'File uploads are not supported'}});
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());
  app.use(csrfProtection, inputBudget);
  app.use((_req,res,next)=>{res.setHeader('Cache-Control','private, no-store');next();});

  if (!isTest) {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req, res) => {
          const existing = req.headers['x-request-id'];
          const id = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        // Health probes would otherwise dominate the log.
        autoLogging: { ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false },
      })
    );
  }

  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
