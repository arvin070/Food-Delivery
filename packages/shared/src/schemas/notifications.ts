import { z } from 'zod';
export const notificationEvents = [
  'account.created',
  'order.confirmed',
  'payment.successful',
  'meal.preparing',
  'meal.packed',
  'delivery.assigned',
  'delivery.started',
  'delivery.arriving',
  'delivery.delivered',
  'delivery.failed',
  'delivery.late',
  'subscription.renewal',
  'subscription.paused',
  'payment.failed',
] as const;
export type NotificationEvent = (typeof notificationEvents)[number];
export const notificationPreferenceSchema = z
  .object({
    inApp: z.boolean(),
    email: z.boolean(),
    sms: z.boolean(),
    whatsapp: z.boolean(),
    push: z.boolean(),
    disabledEvents: z
      .array(z.enum(notificationEvents))
      .max(notificationEvents.length)
      .refine((v) => new Set(v).size === v.length, 'Duplicate event'),
  })
  .strict();
export type NotificationPreferences = z.infer<
  typeof notificationPreferenceSchema
>;
export const pushDeviceSchema = z
  .object({
    token: z.string().min(16).max(4096),
    platform: z.enum(['web', 'android', 'ios']),
  })
  .strict();
export const notificationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  unread: z.enum(['true', 'false']).default('false'),
});
export interface InboxNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}
export interface NotificationInbox {
  items: InboxNotification[];
  total: number;
  unread: number;
  page: number;
  pageSize: number;
}
export interface NotificationSettings {
  preferences: NotificationPreferences;
  externalDeliveryConfigured: boolean;
  devices: { id: string; platform: string; updatedAt: string }[];
}
