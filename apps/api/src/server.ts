/**
 * Process entrypoint: binds the port and shuts down cleanly.
 */
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './core/logger';
import { connectDatabase, disconnectDatabase } from './core/prisma';

async function main() {
  await connectDatabase();

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
        await disconnectDatabase();
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
