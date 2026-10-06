import { Prisma, PrismaClient } from '@prisma/client';
import { env, isDevelopment, isProduction } from '../config/env';
import { logger } from './logger';

/**
 * The single Prisma client for the process.
 *
 * Held on `globalThis` in development so `tsx watch` reloads do not open a new
 * connection pool on every file save until Postgres refuses connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
    log: isProduction
      ? [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
      : [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'warn' },
          { emit: 'event', level: 'error' },
        ],
  });

prisma.$on('warn' as never, (e: Prisma.LogEvent) => logger.warn({ prisma: e }, e.message));
prisma.$on('error' as never, (e: Prisma.LogEvent) => logger.error({ prisma: e }, e.message));
if (!isProduction) {
  prisma.$on('query' as never, (e: Prisma.QueryEvent) =>
    logger.debug({ durationMs: e.duration, params: e.params }, e.query)
  );
}

if (isDevelopment) globalForPrisma.prisma = prisma;

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  logger.info('Database connected');
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  logger.info('Database disconnected');
}

/** A transaction client — what a service receives when it participates in one. */
export type PrismaTransaction = Prisma.TransactionClient;

/** Either the root client or a transaction. Services accept this so they can be
 *  composed inside a larger transaction without knowing about it. */
export type Db = PrismaClient | PrismaTransaction;

export { Prisma };
