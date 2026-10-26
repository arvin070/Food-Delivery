import { z } from 'zod';
export const adminResources = [
  'users',
  'vendors',
  'kitchens',
  'meals',
  'orders',
  'subscriptions',
  'checkpoints',
  'time-slots',
  'delivery-partners',
  'routes',
  'payments',
  'refunds',
  'complaints',
] as const;
export type AdminResource = (typeof adminResources)[number];
export const adminActions = [
  'ACTIVATE',
  'DEACTIVATE',
  'APPROVE',
  'SUSPEND',
  'REJECT',
  'PAUSE',
  'RESUME',
  'CANCEL',
  'REFUND',
  'START_REVIEW',
  'RESOLVE',
  'REOPEN',
] as const;
export type AdminAction = (typeof adminActions)[number];
export const adminResourceSchema = z.object({
  resource: z.enum(adminResources),
});
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    'Invalid date',
  );
export const adminListSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  search: z.string().trim().max(120).optional(),
  status: z.string().max(40).optional(),
  date: date.optional(),
  cityId: z.string().max(100).optional(),
  role: z
    .enum([
      'SUPER_ADMIN',
      'VENDOR',
      'DELIVERY_PARTNER',
      'CUSTOMER',
      'PARENT',
      'STUDENT',
      'INSTITUTION_ADMIN',
    ])
    .optional(),
  available: z.enum(['true', 'false']).optional(),
});
export type AdminListQuery = z.infer<typeof adminListSchema>;
export const adminActionSchema = z
  .object({
    action: z.enum(adminActions),
    reason: z.string().trim().min(3).max(500),
    expectedStatus: z.string().max(40),
    revision: z.number().int().nonnegative().optional(),
    amount: z
      .string()
      .regex(/^\d{1,8}(\.\d{1,2})?$/)
      .optional(),
    idempotencyKey: z.string().uuid().optional(),
  })
  .strict();
export type AdminActionInput = z.infer<typeof adminActionSchema>;
export const complaintSchema = z
  .object({
    subject: z.string().trim().min(3).max(160),
    message: z.string().trim().min(10).max(4000),
    orderId: z.string().min(1).max(100).optional(),
    idempotencyKey: z.string().uuid(),
  })
  .strict();
export const ADMIN_SECTIONS: Record<
  AdminResource,
  { label: string; statuses: string[] }
> = {
  users: {
    label: 'Users',
    statuses: ['ACTIVE', 'PENDING_VERIFICATION', 'SUSPENDED', 'DEACTIVATED'],
  },
  vendors: {
    label: 'Vendors',
    statuses: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SUSPENDED'],
  },
  kitchens: { label: 'Kitchens', statuses: ['ACTIVE', 'INACTIVE'] },
  meals: { label: 'Meals', statuses: ['ACTIVE', 'INACTIVE'] },
  orders: {
    label: 'Orders',
    statuses: [
      'PENDING',
      'AWAITING_PAYMENT',
      'PAYMENT_FAILED',
      'CONFIRMED',
      'PREPARING',
      'PACKED',
      'ASSIGNED',
      'PICKED_UP',
      'DISPATCHED',
      'OUT_FOR_DELIVERY',
      'AT_CHECKPOINT',
      'DELIVERED',
      'PARTIALLY_FULFILLED',
      'CANCELLED',
      'FAILED',
      'REFUNDED',
    ],
  },
  subscriptions: {
    label: 'Subscriptions',
    statuses: ['ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED'],
  },
  checkpoints: { label: 'Checkpoints', statuses: ['ACTIVE', 'INACTIVE'] },
  'time-slots': { label: 'Time slots', statuses: ['ACTIVE', 'INACTIVE'] },
  'delivery-partners': {
    label: 'Delivery partners',
    statuses: ['ACTIVE', 'INACTIVE'],
  },
  routes: {
    label: 'Routes',
    statuses: ['PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  },
  payments: {
    label: 'Payments',
    statuses: [
      'CREATED',
      'PENDING',
      'AUTHORIZED',
      'PAID',
      'FAILED',
      'CANCELLED',
      'REFUNDED',
      'PARTIALLY_REFUNDED',
    ],
  },
  refunds: { label: 'Refunds', statuses: ['PENDING', 'PROCESSED', 'FAILED'] },
  complaints: {
    label: 'Complaints',
    statuses: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'],
  },
};
export function administrativeActions(
  resource: AdminResource,
  status: string,
): AdminAction[] {
  if (resource === 'users')
    return status === 'ACTIVE' ? ['SUSPEND', 'DEACTIVATE'] : ['ACTIVATE'];
  if (resource === 'vendors')
    return status === 'APPROVED'
      ? ['SUSPEND']
      : status === 'PENDING_APPROVAL'
        ? ['APPROVE', 'REJECT']
        : ['APPROVE'];
  if (
    [
      'kitchens',
      'meals',
      'checkpoints',
      'time-slots',
      'delivery-partners',
    ].includes(resource)
  )
    return status === 'ACTIVE' ? ['DEACTIVATE'] : ['ACTIVATE'];
  if (resource === 'subscriptions')
    return status === 'ACTIVE'
      ? ['PAUSE', 'CANCEL']
      : status === 'PAUSED'
        ? ['RESUME', 'CANCEL']
        : [];
  if (resource === 'payments')
    return ['PAID', 'PARTIALLY_REFUNDED'].includes(status) ? ['REFUND'] : [];
  if (resource === 'complaints')
    return status === 'OPEN'
      ? ['START_REVIEW', 'RESOLVE', 'REJECT']
      : status === 'IN_PROGRESS'
        ? ['RESOLVE', 'REJECT']
        : ['REOPEN'];
  return [];
}
export interface AdminRecord {
  id: string;
  name: string;
  status: string;
  summary: string;
  fields: Record<string, string | number | boolean | null>;
  createdAt: string;
  revision?: number;
}
export interface AdminList {
  items: AdminRecord[];
  total: number;
  page: number;
  pageSize: number;
}
export interface AdminDetail {
  record: AdminRecord;
  related: Record<string, string | number | null>[];
  relatedTotal: number;
  page: number;
  pageSize: number;
}
export interface AdminDashboard {
  date: string;
  timezone: string;
  metrics: {
    orders: number;
    meals: number;
    activeUsers: number;
    activeSubscriptions: number;
    activeKitchens: number;
    activeDeliveryPartners: number;
    pendingDeliveries: number;
    failedDeliveries: number;
  };
  revenue: {
    currency: string;
    collected: string;
    refunded: string;
    net: string;
  }[];
}
