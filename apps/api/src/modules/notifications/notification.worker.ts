import { randomUUID } from 'node:crypto';
import type { NotificationChannel } from '@prisma/client';
import { prisma } from '../../core/prisma';
import { logger } from '../../core/logger';
import { env } from '../../config/env';
import { DEFAULT_PREFERENCES, enabled } from './notification.service';
import {
  DeliveryError,
  notificationProviders,
  type ProviderRegistry,
  type ExternalChannel,
} from './providers';
const MAX_ATTEMPTS = 5;
async function dispatch(
  id: string,
  leaseToken: string,
  providers: ProviderRegistry,
) {
  const row = await prisma.notification.findFirst({
    where: { id, leaseToken, status: 'PROCESSING' },
    include: {
      user: { include: { notificationPreference: true, pushDevices: true } },
    },
  });
  if (!row) return;
  const finish = (
    data: Parameters<typeof prisma.notification.updateMany>[0]['data'],
  ) =>
    prisma.notification.updateMany({
      where: { id, leaseToken, status: 'PROCESSING' },
      data: { ...data, leaseToken: null, leaseUntil: null },
    });
  const user = row.user;
  if (
    user.status !== 'ACTIVE' ||
    user.deletedAt ||
    !enabled(
      user.notificationPreference ?? DEFAULT_PREFERENCES,
      row.channel,
      row.type,
    )
  ) {
    await finish({
      status: 'SKIPPED',
      lastError: 'PREFERENCE_OR_ACCOUNT_DISABLED',
    });
    return;
  }
  let destinations: string[] = [];
  if (row.channel === 'EMAIL' && user.emailVerifiedAt && user.email)
    destinations = [user.email];
  if (
    (row.channel === 'SMS' || row.channel === 'WHATSAPP') &&
    user.phoneVerifiedAt &&
    user.phone
  )
    destinations = [user.phone];
  if (row.channel === 'PUSH')
    destinations = user.pushDevices.map((d) => d.token);
  if (!destinations.length) {
    await finish({ status: 'SKIPPED', lastError: 'NO_VERIFIED_DESTINATION' });
    return;
  }
  try {
    const channel = row.channel as ExternalChannel;
    const variables = Object.fromEntries(
      Object.entries(
        row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
      ).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
    const sent = await providers[channel].send({
      idempotencyKey: row.id,
      channel,
      destinations,
      title: row.title,
      body: row.body,
      template: row.type,
      templateVersion: row.templateVersion,
      variables,
    });
    await finish({
      status: 'SENT',
      providerMessageId: sent.messageId,
      sentAt: new Date(),
      lastError: null,
    });
  } catch (e) {
    const error =
      e instanceof DeliveryError
        ? e
        : new DeliveryError('PROVIDER_ERROR', true);
    const retry = error.retryable && row.attempts < MAX_ATTEMPTS;
    await finish({
      status: retry ? 'QUEUED' : 'FAILED',
      lastError: error.code,
      nextAttemptAt: new Date(
        Date.now() + Math.min(3600000, 30000 * 2 ** (row.attempts - 1)),
      ),
    });
  }
}
/** A bounded batch. SKIP LOCKED and leases allow multiple workers safely.
 * A crashed send is retried with the same provider idempotency key.
 * Prisma DateTime values are UTC without a SQL timezone; compare/lease in UTC. */
export async function processNotificationBatch(
  providers = notificationProviders(),
) {
  await prisma.notification.updateMany({
    where: {
      status: 'PROCESSING',
      leaseUntil: { lte: new Date() },
      attempts: { gte: MAX_ATTEMPTS },
    },
    data: {
      status: 'FAILED',
      leaseToken: null,
      leaseUntil: null,
      lastError: 'ATTEMPTS_EXHAUSTED',
    },
  });
  const token = randomUUID();
  const rows = await prisma.$queryRaw<
    { id: string; channel: NotificationChannel }[]
  >`
  WITH ready AS (
   SELECT id FROM notifications
   WHERE channel <> 'IN_APP' AND attempts < ${MAX_ATTEMPTS}
    AND ((status='QUEUED' AND "nextAttemptAt"<=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) OR (status='PROCESSING' AND "leaseUntil"<=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')))
   ORDER BY "nextAttemptAt",id LIMIT 20 FOR UPDATE SKIP LOCKED
  )
  UPDATE notifications n SET status='PROCESSING',attempts=n.attempts+1,"leaseToken"=${token},"leaseUntil"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')+INTERVAL '2 minutes'
  FROM ready WHERE n.id=ready.id RETURNING n.id,n.channel`;
  // Four concurrent sends, each with a five-second gateway timeout.
  for (let i = 0; i < rows.length; i += 4)
    await Promise.all(
      rows.slice(i, i + 4).map((row) => dispatch(row.id, token, providers)),
    );
  return { processed: rows.length };
}
export function startNotificationWorker() {
  let stopped = false,
    running: Promise<unknown> | undefined;
  const tick = () => {
    if (stopped || running) return;
    running = processNotificationBatch()
      .catch(() =>
        logger.warn('Notification batch failed; durable jobs will be retried'),
      )
      .finally(() => {
        running = undefined;
      });
  };
  if (env.NOTIFICATION_WORKER_ENABLED) tick();
  const timer = setInterval(() => {
    if (env.NOTIFICATION_WORKER_ENABLED) tick();
  }, 10000);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}
