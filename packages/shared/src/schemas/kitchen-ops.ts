import { z } from 'zod';
import { dateOnlySchema, idSchema, paginationSchema } from './common.js';
export const kitchenOperationsQuerySchema = paginationSchema.extend({ serviceDate: dateOnlySchema.optional() });
export const kitchenOperationsStatusSchema = z.object({
  serviceDate: dateOnlySchema,
  orderItemIds: z.array(idSchema).min(1).max(200),
  status: z.enum(['PREPARING','PACKED']),
}).strict();
export const kitchenGroupStatusSchema = z.object({
  serviceDate: dateOnlySchema,
  timeSlotId: idSchema,
  checkpointId: idSchema,
  mealId: idSchema.nullable(),
  mealName: z.string().min(1).max(200),
  routeId: idSchema.nullable(),
  status: z.enum(['PREPARING','PACKED']),
}).strict();
export interface KitchenOption { id: string; name: string; timezone: string; canUpdate: boolean }
export interface KitchenMealCounts { confirmed: number; preparing: number; packed: number; handedOver: number }
export interface KitchenBreakdown { key: string; label: string; quantity: number }
export interface KitchenPreparationGroup extends KitchenMealCounts {
  serviceDate: string; timeSlotId: string; timeSlot: string; startMinute: number;
  checkpointId: string; checkpoint: string; mealId: string | null; mealName: string;
  foodType: string; mealPeriod: string; routeId: string | null; route: string;
  quantity: number;
}
export interface KitchenOperationsDashboard {
  kitchen: KitchenOption;
  serviceDate: string;
  totalMeals: number;
  counts: KitchenMealCounts;
  byMealType: KitchenBreakdown[];
  byMealPeriod: KitchenBreakdown[];
  byCheckpoint: KitchenBreakdown[];
  byTimeSlot: KitchenBreakdown[];
  byRoute: KitchenBreakdown[];
  drops: { timeSlotId: string; timeSlot: string; startMinute: number; checkpointId: string; checkpoint: string; quantity: number }[];
  groups: KitchenPreparationGroup[];
  totalGroups: number;
  page: number; pageSize: number;
}
export interface KitchenPackingItem {
  id: string; orderNumber: string; meal: string; beneficiary: string; quantity: number;
  status: string; checkpoint: string; timeSlot: string; startMinute: number;
  allergies: string | null; notes: string | null; preparingAt: string | null; packedAt: string | null;
}
export interface KitchenStatusResult { updated: string[]; unchanged: string[]; skipped: { id: string; reason: string }[]; hasMore?: boolean }
