import { randomUUID } from 'node:crypto';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { notificationEvents } from '@lunch/shared';
import { api, registerUser } from './helpers';
import { prisma } from '../src/core/prisma';
import {
  DEFAULT_PREFERENCES,
  enqueueNotifications,
  notifyItemProgress,
  updatePreferences,
} from '../src/modules/notifications/notification.service';
import { processNotificationBatch } from '../src/modules/notifications/notification.worker';
import {
  DeliveryError,
  type NotificationMessage,
  type ProviderRegistry,
} from '../src/modules/notifications/providers';
import { renderTemplate } from '../src/modules/notifications/templates';
import {
  changeSubscription,
  generateSubscription,
} from '../src/modules/subscriptions/subscription.service';
import { addDays, cityToday } from '../src/modules/subscriptions/recurrence';
let user: Awaited<ReturnType<typeof registerUser>>,
  other: Awaited<ReturnType<typeof registerUser>>,
  parent: Awaited<ReturnType<typeof registerUser>>;
let kitchenId: string,
  mealId: string,
  checkpointId: string,
  timeSlotId: string,
  childId: string;
const orders: string[] = [];
const send = vi.fn(async (message: NotificationMessage) => ({
  messageId: 'receipt-' + message.idempotencyKey,
}));
const providers: ProviderRegistry = {
  EMAIL: { send },
  SMS: { send },
  WHATSAPP: { send },
  PUSH: { send },
};
beforeAll(async () => {
  user = await registerUser();
  other = await registerUser();
  parent = await registerUser({ role: 'PARENT' });
  const schedule = await prisma.mealSchedule.findFirstOrThrow({
    include: { kitchen: { include: { serviceAreas: { take: 1 } } } },
  });
  kitchenId = schedule.kitchenId;
  mealId = schedule.mealId;
  timeSlotId = schedule.timeSlotId;
  checkpointId = schedule.kitchen.serviceAreas[0]!.checkpointId;
  childId = (
    await prisma.child.create({
      data: { parentId: parent.id, fullName: 'Rahul' },
    })
  ).id;
  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerifiedAt: new Date(),
      phone: '+9198' + String(Date.now()).slice(-8),
      phoneVerifiedAt: new Date(),
    },
  });
});
beforeEach(async () => {
  send.mockReset();
  send.mockImplementation(async (m) => ({
    messageId: 'receipt-' + m.idempotencyKey,
  }));
  await prisma.notification.deleteMany({
    where: { userId: { in: [user.id, other.id, parent.id] } },
  });
  await updatePreferences(user.id, DEFAULT_PREFERENCES);
  await updatePreferences(parent.id, DEFAULT_PREFERENCES);
  await prisma.pushDevice.deleteMany({
    where: { userId: { in: [user.id, other.id] } },
  });
});
afterAll(async () => {
  await prisma.order.deleteMany({ where: { id: { in: orders } } });
  await prisma.user.deleteMany({
    where: { id: { in: [user.id, other.id, parent.id] } },
  });
});
async function emit(
  event: (typeof notificationEvents)[number] = 'delivery.delivered',
  key = randomUUID(),
) {
  await prisma.$transaction((tx) =>
    enqueueNotifications(tx, [
      {
        userId: user.id,
        event,
        key,
        data: {
          beneficiary: 'Rahul',
          meal: 'lunch',
          checkpoint: 'ABC College Gate A',
        },
      },
    ]),
  );
  return key;
}
async function row(
  key: string,
  channel: 'EMAIL' | 'PUSH' | 'SMS' | 'WHATSAPP' = 'EMAIL',
) {
  return prisma.notification.findFirstOrThrow({
    where: { userId: user.id, eventKey: key, channel },
  });
}
async function deliveredOrder() {
  const order = await prisma.order.create({
    data: {
      customerId: user.id,
      orderNumber: 'NT-' + randomUUID(),
      subtotal: 100,
      totalAmount: 100,
      status: 'DELIVERED',
      items: {
        create: {
          kitchenId,
          mealId,
          checkpointId,
          timeSlotId,
          childId,
          serviceDate: cityToday('Asia/Kolkata'),
          beneficiaryName: 'Rahul',
          mealNameSnapshot: 'lunch',
          quantity: 1,
          unitPrice: 100,
          lineTotal: 100,
          status: 'DELIVERED',
        },
      },
    },
    include: { items: true },
  });
  orders.push(order.id);
  return order;
}
describe('centralized notifications', () => {
  it('has a versioned template for every requested event and renders the parent example', () => {
    for (const event of notificationEvents) {
      const rendered = renderTemplate(event, {});
      expect(rendered.title).toBeTruthy();
      expect(rendered.body).not.toContain('undefined');
    }
    expect(
      renderTemplate('delivery.delivered', {
        beneficiary: 'Rahul',
        meal: 'lunch',
        checkpoint: 'ABC College Gate A',
      }).body,
    ).toBe("Rahul's lunch was delivered at ABC College Gate A.");
  });
  it('records account creation through registration', async () => {
    const fresh = await registerUser();
    try {
      const inbox = await api()
        .get('/api/v1/notifications')
        .set('Authorization', 'Bearer ' + fresh.accessToken)
        .expect(200);
      expect(inbox.body.data.items[0].type).toBe('account.created');
      expect(
        await prisma.notification.count({
          where: { userId: fresh.id, status: 'QUEUED' },
        }),
      ).toBe(0);
    } finally {
      await prisma.user.delete({ where: { id: fresh.id } });
    }
  });
  it('rolls notification intent back with the business transaction', async () => {
    const key = randomUUID();
    await expect(
      prisma.$transaction(async (tx) => {
        await enqueueNotifications(tx, [
          { userId: user.id, event: 'meal.packed', key },
        ]);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await prisma.notification.count({ where: { eventKey: key } })).toBe(
      0,
    );
  });
  it('deduplicates event replays and stores opt-outs so enabling later cannot replay old events', async () => {
    const key = await emit();
    await emit('delivery.delivered', key);
    expect(
      await prisma.notification.count({
        where: { userId: user.id, eventKey: key },
      }),
    ).toBe(5);
    expect(
      await prisma.notification.count({
        where: { eventKey: key, status: 'SENT' },
      }),
    ).toBe(1);
    await updatePreferences(user.id, { ...DEFAULT_PREFERENCES, email: true });
    await emit('delivery.delivered', key);
    expect((await row(key)).status).toBe('SKIPPED');
  });
  it('enforces inbox ownership and idempotent read actions', async () => {
    const key = await emit();
    const n = await prisma.notification.findFirstOrThrow({
      where: { eventKey: key, channel: 'IN_APP' },
    });
    await api().get('/api/v1/notifications').expect(401);
    const foreign = await api()
      .get('/api/v1/notifications')
      .set('Authorization', 'Bearer ' + other.accessToken)
      .expect(200);
    expect(foreign.body.data.total).toBe(0);
    await api()
      .post('/api/v1/notifications/' + n.id + '/read')
      .set('Authorization', 'Bearer ' + other.accessToken)
      .expect(404);
    for (let i = 0; i < 2; i++)
      await api()
        .post('/api/v1/notifications/' + n.id + '/read')
        .set('Authorization', 'Bearer ' + user.accessToken)
        .expect(200);
    const unread = await api()
      .get('/api/v1/notifications?unread=true')
      .set('Authorization', 'Bearer ' + user.accessToken)
      .expect(200);
    expect(unread.body.data.unread).toBe(0);
    expect(JSON.stringify(unread.body)).not.toMatch(
      /leaseToken|providerMessageId/,
    );
  });
  it('persists per-channel and per-event preferences without exposing another user settings', async () => {
    const pref = {
      ...DEFAULT_PREFERENCES,
      email: true,
      disabledEvents: ['delivery.delivered'],
    };
    await api()
      .put('/api/v1/notifications/preferences')
      .set('Authorization', 'Bearer ' + user.accessToken)
      .send(pref)
      .expect(200);
    const key = await emit();
    expect((await row(key)).status).toBe('SKIPPED');
    const theirs = await api()
      .get('/api/v1/notifications/preferences')
      .set('Authorization', 'Bearer ' + other.accessToken)
      .expect(200);
    expect(theirs.body.data.preferences.email).toBe(false);
    await api()
      .put('/api/v1/notifications/preferences')
      .set('Authorization', 'Bearer ' + user.accessToken)
      .send({ ...pref, userId: other.id })
      .expect(422);
  });
  it('sends enabled channels with stable idempotency keys and never sends again after success', async () => {
    await updatePreferences(user.id, {
      ...DEFAULT_PREFERENCES,
      email: true,
      sms: true,
      whatsapp: true,
      push: true,
    });
    await api()
      .post('/api/v1/notifications/devices')
      .set('Authorization', 'Bearer ' + user.accessToken)
      .send({ token: 'device-' + randomUUID(), platform: 'android' })
      .expect(201);
    const key = await emit();
    await processNotificationBatch(providers);
    expect(send).toHaveBeenCalledTimes(4);
    expect(new Set(send.mock.calls.map(([m]) => m.channel))).toEqual(
      new Set(['EMAIL', 'SMS', 'WHATSAPP', 'PUSH']),
    );
    expect((await row(key)).status).toBe('SENT');
    await processNotificationBatch(providers);
    expect(send).toHaveBeenCalledTimes(4);
  });
  it('retries temporary failures with backoff and the same provider key', async () => {
    await updatePreferences(user.id, { ...DEFAULT_PREFERENCES, email: true });
    const key = await emit();
    send.mockRejectedValueOnce(new DeliveryError('PROVIDER_HTTP_503', true));
    await processNotificationBatch(providers);
    const failed = await row(key);
    expect(failed.status).toBe('QUEUED');
    expect(failed.attempts).toBe(1);
    expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    await processNotificationBatch(providers);
    expect(send).toHaveBeenCalledTimes(1);
    await prisma.notification.update({
      where: { id: failed.id },
      data: { nextAttemptAt: new Date(0) },
    });
    await processNotificationBatch(providers);
    expect((await row(key)).status).toBe('SENT');
    expect(send.mock.calls[0]![0].idempotencyKey).toBe(
      send.mock.calls[1]![0].idempotencyKey,
    );
  });
  it('rechecks preferences and verified destinations before delivery', async () => {
    await updatePreferences(user.id, { ...DEFAULT_PREFERENCES, email: true });
    const key = await emit();
    await updatePreferences(user.id, DEFAULT_PREFERENCES);
    await processNotificationBatch(providers);
    expect(send).not.toHaveBeenCalled();
    expect((await row(key)).status).toBe('SKIPPED');
    await updatePreferences(user.id, { ...DEFAULT_PREFERENCES, email: true });
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: null },
    });
    const unverified = await emit();
    try {
      await processNotificationBatch(providers);
      expect((await row(unverified)).lastError).toBe('NO_VERIFIED_DESTINATION');
    } finally {
      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      });
    }
  });
  it('claims each job only once across concurrent workers', async () => {
    await updatePreferences(user.id, { ...DEFAULT_PREFERENCES, email: true });
    const key = await emit();
    await Promise.all([
      processNotificationBatch(providers),
      processNotificationBatch(providers),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await row(key)).status).toBe('SENT');
  });
  it('recovers expired leases and terminates exhausted or permanent failures', async () => {
    await updatePreferences(user.id, { ...DEFAULT_PREFERENCES, email: true });
    const key = await emit(),
      n = await row(key);
    await prisma.notification.update({
      where: { id: n.id },
      data: {
        status: 'PROCESSING',
        attempts: 1,
        leaseToken: 'abandoned',
        leaseUntil: new Date(0),
      },
    });
    await processNotificationBatch(providers);
    expect((await row(key)).status).toBe('SENT');
    const exhausted = await emit(),
      e = await row(exhausted);
    await prisma.notification.update({
      where: { id: e.id },
      data: {
        status: 'PROCESSING',
        attempts: 5,
        leaseToken: 'abandoned',
        leaseUntil: new Date(0),
      },
    });
    await processNotificationBatch(providers);
    expect((await row(exhausted)).status).toBe('FAILED');
    const permanent = await emit();
    send.mockRejectedValueOnce(new DeliveryError('PROVIDER_HTTP_400', false));
    await processNotificationBatch(providers);
    expect((await row(permanent)).status).toBe('FAILED');
  });
  it('fails explicitly when no external provider is configured', async () => {
    await updatePreferences(user.id, { ...DEFAULT_PREFERENCES, email: true });
    const key = await emit();
    await processNotificationBatch();
    expect((await row(key)).lastError).toBe('PROVIDER_NOT_CONFIGURED');
    expect((await row(key)).status).toBe('FAILED');
  });
  it('bounds each worker batch to twenty notifications', async () => {
    await updatePreferences(user.id, { ...DEFAULT_PREFERENCES, email: true });
    await prisma.$transaction((tx) =>
      enqueueNotifications(
        tx,
        Array.from({ length: 25 }, () => ({
          userId: user.id,
          event: 'meal.packed' as const,
          key: randomUUID(),
        })),
      ),
    );
    expect((await processNotificationBatch(providers)).processed).toBe(20);
    expect(send).toHaveBeenCalledTimes(20);
    expect((await processNotificationBatch(providers)).processed).toBe(5);
  });
  it('stops retrying after five temporary failures', async () => {
    await updatePreferences(user.id, { ...DEFAULT_PREFERENCES, email: true });
    const key = await emit();
    send.mockRejectedValue(new DeliveryError('PROVIDER_HTTP_503', true));
    for (let i = 0; i < 5; i++) {
      await prisma.notification.updateMany({
        where: { eventKey: key, channel: 'EMAIL' },
        data: { nextAttemptAt: new Date(0) },
      });
      await processNotificationBatch(providers);
    }
    expect((await row(key)).status).toBe('FAILED');
    expect((await row(key)).attempts).toBe(5);
    await processNotificationBatch(providers);
    expect(send).toHaveBeenCalledTimes(5);
  });
  it('keeps push tokens private and restricts device registration and deletion to its owner', async () => {
    const token = 'private-device-' + randomUUID();
    const first = await api()
      .post('/api/v1/notifications/devices')
      .set('Authorization', 'Bearer ' + user.accessToken)
      .send({ token, platform: 'web' })
      .expect(201);
    expect(JSON.stringify(first.body)).not.toContain(token);
    await api()
      .post('/api/v1/notifications/devices')
      .set('Authorization', 'Bearer ' + other.accessToken)
      .send({ token, platform: 'web' })
      .expect(409);
    await api()
      .delete('/api/v1/notifications/devices/' + first.body.data.id)
      .set('Authorization', 'Bearer ' + other.accessToken)
      .expect(404);
    const settings = await api()
      .get('/api/v1/notifications/preferences')
      .set('Authorization', 'Bearer ' + user.accessToken)
      .expect(200);
    expect(JSON.stringify(settings.body)).not.toContain(token);
    await api()
      .delete('/api/v1/notifications/devices/' + first.body.data.id)
      .set('Authorization', 'Bearer ' + user.accessToken)
      .expect(200);
  });
  it('notifies the purchaser and linked parent once, and never an unrelated account', async () => {
    const order = await deliveredOrder();
    for (let i = 0; i < 2; i++)
      await prisma.$transaction((tx) =>
        notifyItemProgress(tx, [order.items[0]!.id]),
      );
    const notifications = await prisma.notification.findMany({
      where: { type: 'delivery.delivered', channel: 'IN_APP', status: 'SENT' },
    });
    const current = notifications.filter(
      (n) =>
        n.eventKey === 'item:' + order.items[0]!.id + ':delivery.delivered',
    );
    expect(new Set(current.map((n) => n.userId))).toEqual(
      new Set([user.id, parent.id]),
    );
    expect(
      current.every((n) => n.body.startsWith("Rahul's lunch was delivered at")),
    ).toBe(true);
    expect(current.some((n) => n.userId === other.id)).toBe(false);
  });
  it('respects parent delivery opt-out independently of the purchaser', async () => {
    await updatePreferences(parent.id, {
      ...DEFAULT_PREFERENCES,
      disabledEvents: ['delivery.delivered'],
    });
    const order = await deliveredOrder();
    await prisma.$transaction((tx) =>
      notifyItemProgress(tx, [order.items[0]!.id]),
    );
    expect(
      await prisma.notification.count({
        where: {
          userId: parent.id,
          type: 'delivery.delivered',
          status: 'SENT',
        },
      }),
    ).toBe(0);
    expect(
      await prisma.notification.count({
        where: { userId: user.id, type: 'delivery.delivered', status: 'SENT' },
      }),
    ).toBe(1);
  });
  it('emits renewal reminders once per plan end date and pause alerts once per pause transition', async () => {
    const today = cityToday('Asia/Kolkata');
    const sub = await prisma.subscription.create({
      data: {
        userId: user.id,
        mealId,
        kitchenId,
        checkpointId,
        timeSlotId,
        startDate: today,
        endDate: addDays(today, 1),
        daysOfWeek: [],
        pricePerMeal: 100,
      },
    });
    await generateSubscription(user.id, sub.id);
    await generateSubscription(user.id, sub.id);
    expect(
      await prisma.notification.count({
        where: {
          userId: user.id,
          type: 'subscription.renewal',
          channel: 'IN_APP',
          status: 'SENT',
        },
      }),
    ).toBe(1);
    await changeSubscription(user.id, sub.id, 'PAUSE');
    await changeSubscription(user.id, sub.id, 'RESUME');
    await changeSubscription(user.id, sub.id, 'PAUSE');
    expect(
      await prisma.notification.count({
        where: {
          userId: user.id,
          type: 'subscription.paused',
          channel: 'IN_APP',
          status: 'SENT',
        },
      }),
    ).toBe(2);
  });
});
