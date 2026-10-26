import { startTrackingWorker } from './modules/tracking/tracking.worker';
import { startNotificationWorker } from './modules/notifications/notification.worker';
import { startPaymentWorker } from './modules/payments/payment.worker';
import { startSubscriptionWorker } from './modules/subscriptions/subscription.worker';
/**
 * Process entrypoint: binds the port and shuts down cleanly.
 */
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './core/logger';
import { connectDatabase, disconnectDatabase } from './core/prisma';
import * as Sentry from '@sentry/node';

async function main() {
  if (env.SENTRY_DSN) Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV, tracesSampleRate: 0.05, sendDefaultPii: false });
  await connectDatabase();

  const stopSubscriptions = startSubscriptionWorker();
  const stopPayments = startPaymentWorker();
  const stopNotifications = startNotificationWorker();
  const stopTracking = startTrackingWorker();
  const app = createApp();
  const server = app.listen(env.API_PORT, env.API_HOST, () => {
    logger.info(
      { port: env.API_PORT, host: env.API_HOST, env: env.NODE_ENV },
      `Lunch API listening on http://localhost:${env.API_PORT}/api/v1`
    );
  });

  /**
   * Stop accepting connections, let in-flight requests finish, then close the
   * database. The timeout stops a hung request from blocking a deploy forever.
   */
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    server.close(async (err) => {
      if (err) logger.error({ err }, 'Error while closing HTTP server');
      try {
        await stopSubscriptions();
        await stopPayments();
        await stopNotifications();
        await stopTracking();
        await disconnectDatabase();
        await Sentry.close(2000);
      } catch (dbErr) {
        logger.error({ err: dbErr }, 'Error while disconnecting the database');
      }
      process.exit(err ? 1 : 0);
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });
}

void main().catch((err) => {
  logger.fatal({ err }, 'Failed to start the API');
  process.exit(1);
});
