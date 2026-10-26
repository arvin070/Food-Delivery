import type { Prisma, NotificationChannel } from '@prisma/client';
import type { NotificationEvent, NotificationPreferences } from '@lunch/shared';
import { prisma } from '../../core/prisma';
import { notFound, conflict } from '../../core/errors';
import { createHash } from 'node:crypto';
import { paymentTransaction } from '../payments/transaction';
import {
  renderTemplate,
  TEMPLATE_VERSION,
  type TemplateData,
} from './templates';
export const DEFAULT_PREFERENCES: NotificationPreferences = {
  inApp: true,
  email: false,
  sms: false,
  whatsapp: false,
  push: false,
  disabledEvents: [],
};
export const CHANNELS = ['IN_APP', 'EMAIL', 'SMS', 'WHATSAPP', 'PUSH'] as const;
export function enabled(
  preferences: Omit<NotificationPreferences, 'disabledEvents'> & {
    disabledEvents: string[];
  },
  channel: NotificationChannel,
  event: string,
) {
  const key = {
    IN_APP: 'inApp',
    EMAIL: 'email',
    SMS: 'sms',
    WHATSAPP: 'whatsapp',
    PUSH: 'push',
  } as const;
  return (
    preferences[key[channel]] &&
    !preferences.disabledEvents.includes(event as NotificationEvent)
  );
}
export interface NotificationEventInput {
  userId: string;
  event: NotificationEvent;
  key: string;
  data?: TemplateData;
}
/** Transactional outbox: business code records intent; never calls a provider. */
export async function enqueueNotifications(
  tx: Prisma.TransactionClient,
  events: NotificationEventInput[],
) {
  if (!events.length) return;
  const users = await tx.user.findMany({
    where: {
      id: { in: [...new Set(events.map((e) => e.userId))] },
      status: 'ACTIVE',
      deletedAt: null,
    },
    select: { id: true, notificationPreference: true },
  });
  const byUser = new Map(
    users.map((u) => [u.id, u.notificationPreference ?? DEFAULT_PREFERENCES]),
  );
  const records: Prisma.NotificationCreateManyInput[] = [];
  for (const event of events) {
    const pref = byUser.get(event.userId);
    if (!pref) continue;
    const template = renderTemplate(event.event, event.data ?? {});
    const variables = Object.fromEntries(
      ['orderNumber', 'beneficiary', 'checkpoint', 'meal', 'endDate'].flatMap(
        (key) => {
          const value = event.data?.[key as keyof TemplateData];
          return typeof value === 'string' ? [[key, value]] : [];
        },
      ),
    );
    for (const channel of CHANNELS) {
      const allowed = enabled(pref, channel, event.event);
      records.push({
        nextAttemptAt: new Date(),
        createdAt: new Date(),
        userId: event.userId,
        eventKey: event.key,
        channel,
        type: event.event,
        ...template,
        metadata: variables,
        templateVersion: TEMPLATE_VERSION,
        status: !allowed ? 'SKIPPED' : channel === 'IN_APP' ? 'SENT' : 'QUEUED',
        sentAt: allowed && channel === 'IN_APP' ? new Date() : null,
        lastError: allowed ? null : 'PREFERENCE_DISABLED',
      });
    }
  }
  for (let i = 0; i < records.length; i += 500)
    await tx.notification.createMany({
      data: records.slice(i, i + 500),
      skipDuplicates: true,
    });
}
const progressEvents: Record<string, NotificationEvent> = {
  PREPARING: 'meal.preparing',
  PACKED: 'meal.packed',
  ASSIGNED: 'delivery.assigned',
  OUT_FOR_DELIVERY: 'delivery.started',
  AT_CHECKPOINT: 'delivery.arriving',
  DELIVERED: 'delivery.delivered',
  FAILED: 'delivery.failed',
};
/** The buyer receives progress; a linked parent also receives verified delivery confirmation. */
export async function notifyItemProgress(
  tx: Prisma.TransactionClient,
  itemIds: string[],
) {
  const items = await tx.orderItem.findMany({
    where: { id: { in: itemIds } },
    select: {
      id: true,
      status: true,
      beneficiaryName: true,
      mealNameSnapshot: true,
      order: { select: { customerId: true } },
      checkpoint: { select: { name: true } },
      child: { select: { parentId: true, isActive: true } },
    },
  });
  const events: NotificationEventInput[] = [];
  for (const item of items) {
    const event = progressEvents[item.status];
    if (!event) continue;
    const recipients = new Set([item.order.customerId]);
    if (item.status === 'DELIVERED' && item.child?.isActive)
      recipients.add(item.child.parentId);
    for (const userId of recipients)
      events.push({
        userId,
        event,
        key: `item:${item.id}:${event}`,
        data: {
          beneficiary: item.beneficiaryName,
          meal: item.mealNameSnapshot,
          checkpoint: item.checkpoint.name,
        },
      });
  }
  await enqueueNotifications(tx, events);
}
export async function inbox(userId: string, page: number, onlyUnread: boolean) {
  const base = { userId, channel: 'IN_APP' as const, status: 'SENT' as const };
  const where = { ...base, ...(onlyUnread ? { readAt: null } : {}) };
  const [items, total, unread] = await prisma.$transaction([
    prisma.notification.findMany({
      where,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        createdAt: true,
        readAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 30,
      skip: (page - 1) * 30,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { ...base, readAt: null } }),
  ]);
  return { items, total, unread, page, pageSize: 30 };
}
export async function markRead(userId: string, id: string) {
  const n = await prisma.notification.findFirst({
    where: { id, userId, channel: 'IN_APP', status: 'SENT' },
    select: { id: true },
  });
  if (!n) throw notFound('Notification');
  await prisma.notification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { read: true };
}
export async function markAllRead(userId: string) {
  return prisma.notification.updateMany({
    where: { userId, channel: 'IN_APP', status: 'SENT', readAt: null },
    data: { readAt: new Date() },
  });
}
export async function preferences(userId: string) {
  const pref = await prisma.notificationPreference.findUnique({
    where: { userId },
  });
  return pref
    ? {
        inApp: pref.inApp,
        email: pref.email,
        sms: pref.sms,
        whatsapp: pref.whatsapp,
        push: pref.push,
        disabledEvents: pref.disabledEvents,
      }
    : DEFAULT_PREFERENCES;
}
export async function updatePreferences(
  userId: string,
  input: NotificationPreferences,
) {
  await prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, ...input },
    update: input,
  });
  return preferences(userId);
}
export async function registerDevice(
  userId: string,
  input: { token: string; platform: string },
) {
  return paymentTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
    const tokenHash = createHash('sha256').update(input.token).digest('hex');
    const existing = await tx.pushDevice.findUnique({ where: { tokenHash } });
    if (existing && existing.userId !== userId)
      throw conflict('This device is already registered');
    if (!existing && (await tx.pushDevice.count({ where: { userId } })) >= 10)
      throw conflict('Remove an old device before adding another');
    return tx.pushDevice.upsert({
      where: { tokenHash },
      create: { userId, tokenHash, ...input },
      update: { platform: input.platform },
      select: { id: true, platform: true },
    });
  });
}
export async function removeDevice(userId: string, id: string) {
  const result = await prisma.pushDevice.deleteMany({ where: { id, userId } });
  if (!result.count) throw notFound('Device');
  return { removed: true };
}
