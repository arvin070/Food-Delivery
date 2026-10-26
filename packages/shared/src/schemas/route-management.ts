import { z } from 'zod';
const id = z.string().min(1).max(100);
const ids = z
  .array(id)
  .max(500)
  .refine((v) => new Set(v).size === v.length, 'Duplicate IDs are not allowed');
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    'Invalid date',
  );
export const routeQuerySchema = z.object({
  date,
  kitchenId: id.optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});
export const routeCandidatesQuerySchema = routeQuerySchema.extend({
  kitchenId: id,
});
export const createRouteSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    date,
    kitchenId: id,
    deliveryPartnerId: id,
    checkpointIds: ids.refine((v) => v.length > 0, 'Choose checkpoints'),
    orderItemIds: ids.refine((v) => v.length > 0, 'Choose packed meals'),
    idempotencyKey: z.string().uuid(),
  })
  .strict();
export const editRouteSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    deliveryPartnerId: id,
    checkpointIds: ids.refine((v) => v.length > 0, 'Choose checkpoints'),
    orderItemIds: ids.default([]),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type CreateRouteInput = z.infer<typeof createRouteSchema>;
export type EditRouteInput = z.infer<typeof editRouteSchema>;
export type RouteQuery = z.infer<typeof routeQuerySchema>;
export interface RouteTotals {
  meals: number;
  orders: number;
  checkpoints: number;
  deliveries: number;
  delivered: number;
  failed: number;
}
export interface ManagedRoute {
  id: string;
  name: string;
  date: string;
  status: string;
  revision: number;
  editable: boolean;
  kitchen: {
    id: string;
    name: string;
    latitude: number | null;
    longitude: number | null;
  };
  partner: { id: string; name: string } | null;
  timeSlots: { id: string; label: string; startMinute: number }[];
  totals: RouteTotals;
  stops: {
    id: string;
    checkpointId: string;
    sequence: number;
    name: string;
    status: string;
    instructions: string | null;
    latitude: number | null;
    longitude: number | null;
    meals: number;
    orders: number;
    deliveries: number;
    batches: {
      mealId: string;
      mealName: string;
      timeSlotId: string;
      timeSlot: string;
      quantity: number;
      deliveries: number;
    }[];
  }[];
}
export interface RouteCandidate {
  id: string;
  orderId: string;
  orderNumber: string;
  mealName: string;
  quantity: number;
  checkpoint: { id: string; name: string };
  timeSlot: { id: string; label: string };
}
export interface RouteOptions {
  kitchens: { id: string; name: string; cityId: string }[];
  partners: {
    id: string;
    name: string;
    cityId: string | null;
    isAvailable: boolean;
  }[];
}
export interface ManagedRouteList {
  routes: ManagedRoute[];
  total: number;
  page: number;
  pageSize: number;
}
export interface RouteCandidateList {
  items: RouteCandidate[];
  total: number;
  page: number;
  pageSize: number;
}
