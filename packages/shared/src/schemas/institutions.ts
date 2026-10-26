import { z } from 'zod';
import { InstitutionType } from '../enums/index.js';
export const institutionTypes = Object.values(InstitutionType);
const type = z.nativeEnum(InstitutionType);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    'Invalid date',
  );
const profile = {
  name: z.string().trim().min(2).max(160),
  type,
  contactName: z.string().trim().max(120).nullable(),
  contactEmail: z.string().email().max(200).nullable(),
  contactPhone: z.string().trim().max(30).nullable(),
  deliveryNotes: z.string().trim().max(1500).nullable(),
  registrationOpen: z.boolean(),
};
export const createInstitutionSchema = z
  .object({
    ...profile,
    cityId: z.string().min(1).max(100),
    adminUserId: z.string().min(1).max(100),
  })
  .strict();
export const updateInstitutionSchema = z
  .object({ ...profile, revision: z.number().int().nonnegative() })
  .strict();
export const institutionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  search: z.string().trim().max(120).optional(),
  date: date.optional(),
});
export const institutionRegistrationSchema = z
  .object({
    identifier: z.string().trim().min(1).max(100).nullable().optional(),
  })
  .strict();
export const institutionWindowSchema = z
  .object({
    label: z.string().trim().min(2).max(100),
    mealPeriod: z.enum(['BREAKFAST', 'LUNCH', 'DINNER', 'SNACKS']),
    startMinute: z.number().int().min(0).max(1438),
    endMinute: z.number().int().min(1).max(1439),
    orderCutoffMinutes: z.number().int().min(0).max(1440),
    maxOrders: z.number().int().min(1).max(100000).nullable(),
  })
  .strict()
  .refine((v) => v.endMinute > v.startMinute, {
    message: 'End time must be later than start time',
    path: ['endMinute'],
  });
export const bulkMealRequestSchema = z
  .object({
    quantityPerDay: z.number().int().min(1).max(100000),
    mealPeriod: z.enum(['BREAKFAST', 'LUNCH', 'DINNER', 'SNACKS']),
    startDate: date,
    endDate: date.nullable(),
    notes: z.string().trim().max(2000).nullable(),
    idempotencyKey: z.string().uuid(),
  })
  .strict()
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: 'End date must follow start date',
    path: ['endDate'],
  });
export type InstitutionProfileInput = z.infer<typeof updateInstitutionSchema>;
export interface InstitutionSummary {
  id: string;
  name: string;
  type: string;
  cityId: string;
  isActive: boolean;
  registrationOpen: boolean;
  city: { name: string; timezone: string };
}
export interface InstitutionDetail extends InstitutionSummary {
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  deliveryNotes: string | null;
  revision: number;
  isBilledCentrally: boolean;
}
export interface InstitutionRegistration {
  id: string;
  name: string;
  kind: 'MEMBER' | 'CHILD';
  identifier: string | null;
  role: string;
  isActive: boolean;
}
export interface InstitutionStatistics {
  date: string;
  timezone: string;
  orders: number;
  meals: number;
  deliveredMeals: number;
  failedMeals: number;
  pendingMeals: number;
  groups: {
    checkpointId: string;
    checkpoint: string;
    timeSlot: string;
    status: string;
    quantity: number;
    orders: number;
  }[];
}
export interface InstitutionBulkRequest {
  id: string;
  quantityPerDay: number;
  mealPeriod: string;
  startDate: string;
  endDate: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
}
