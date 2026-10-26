import { z } from 'zod';
import { CheckpointType } from '../enums/index.js';
import { idSchema, paginationSchema } from './common.js';

// ─── Primitives ───────────────────────────────────────────────────────────────

const checkpointTypeSchema = z.enum(
  Object.values(CheckpointType) as [CheckpointType, ...CheckpointType[]]
);

/**
 * Latitude: −90 to +90. Longitude: −180 to +180.
 * Stored as bare floats; map SDK integration will happen in a later module.
 */
const latitudeSchema = z.number().min(-90).max(90);
const longitudeSchema = z.number().min(-180).max(180);

// ─── Address sub-object for checkpoint create/update ─────────────────────────

export const checkpointAddressSchema = z.object({
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).nullish(),
  landmark: z.string().trim().max(120).nullish(),
  area: z.string().trim().max(120).nullish(),
  cityName: z.string().trim().min(1).max(120),
  state: z.string().trim().min(1).max(80),
  postalCode: z.string().trim().regex(/^\d{6}$/, 'Enter a 6-digit postal code'),
});
export type CheckpointAddressInput = z.infer<typeof checkpointAddressSchema>;

// ─── Delivery window (allowed time-slot ids) ─────────────────────────────────

export const allowedWindowSchema = z.object({
  timeSlotId: idSchema,
  maxOrders: z.number().int().min(1).max(10_000).nullish(),
  orderCutoffMinutes: z.number().int().min(0).max(1440).nullish(),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).default([1, 2, 3, 4, 5, 6, 7]).refine((days) => new Set(days).size === days.length, 'Duplicate weekday'),
  preparationBufferMinutes: z.number().int().min(0).max(1440).default(0),
  travelBufferMinutes: z.number().int().min(0).max(1440).default(0),
  isActive: z.boolean().default(true),
});
export type AllowedWindowInput = z.infer<typeof allowedWindowSchema>;

export const checkpointScheduleExceptionSchema = z.object({
  startDate: z.string().date(),
  endDate: z.string().date(),
  timeSlotId: idSchema.nullish(),
  replacementCheckpointId: idSchema.nullish(),
  reason: z.string().trim().min(3).max(300),
}).strict().refine((value) => value.endDate >= value.startDate, { message: 'End date must be on or after start date', path: ['endDate'] });
export type CheckpointScheduleExceptionInput = z.infer<typeof checkpointScheduleExceptionSchema>;

// ─── Create checkpoint ────────────────────────────────────────────────────────

const checkpointCoreFields = {
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  type: checkpointTypeSchema,
  cityId: idSchema,
  zoneId: idSchema.nullish(),
  institutionId: idSchema.nullish(),

  /** Free-text street address. If supplied, a new Address record is created. */
  address: checkpointAddressSchema.nullish(),

  latitude: latitudeSchema.nullish(),
  longitude: longitudeSchema.nullish(),

  geofenceRadiusM: z.number().int().min(10).max(5000).default(150),

  /**
   * Rider guidance — displayed on the delivery app before scanning, so the
   * rider finds the spot without phoning anyone.
   */
  instructions: z.string().trim().max(1000).nullish(),

  /**
   * Maximum meals per delivery window across all slots.
   * Null = no platform-level cap.
   */
  deliveryCapacity: z.number().int().min(1).max(100_000).nullish(),

  isActive: z.boolean().default(true),

  /** Delivery windows to enable on creation. Can be added/removed later. */
  windows: z.array(allowedWindowSchema).max(20).optional(),
};

export const createCheckpointSchema = z.object(checkpointCoreFields).refine(
  (v) =>
    (v.latitude == null) === (v.longitude == null),
  {
    message: 'Provide both latitude and longitude, or neither',
    path: ['longitude'],
  }
);
export type CreateCheckpointInput = z.infer<typeof createCheckpointSchema>;

// ─── Update checkpoint ────────────────────────────────────────────────────────

export const updateCheckpointSchema = z
  .object(checkpointCoreFields)
  .partial()
  .refine(
    (v) => {
      if (v.latitude != null && v.longitude == null) return false;
      if (v.longitude != null && v.latitude == null) return false;
      return true;
    },
    {
      message: 'Provide both latitude and longitude, or neither',
      path: ['longitude'],
    }
  );
export type UpdateCheckpointInput = z.infer<typeof updateCheckpointSchema>;

// ─── List / search query ──────────────────────────────────────────────────────

export const listCheckpointsQuerySchema = paginationSchema.extend({
  cityId: idSchema.optional(),
  institutionId: idSchema.optional(),
  zoneId: idSchema.optional(),
  type: checkpointTypeSchema.optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  q: z.string().trim().max(120).optional(),
});
export type ListCheckpointsQuery = z.infer<typeof listCheckpointsQuerySchema>;

// ─── Path params ─────────────────────────────────────────────────────────────

export const checkpointIdParamSchema = z.object({ checkpointId: idSchema });

// ─── Response shapes (shared interface, not Prisma types) ────────────────────

export interface CheckpointSummary {
  id: string;
  name: string;
  type: CheckpointType;
  institutionName: string | null;
  cityName: string;
  isActive: boolean;
  addressLabel: string | null;
}

export interface DeliveryWindow {
  id: string;
  timeSlotId: string;
  timeSlotLabel: string;
  mealPeriod: string;
  maxOrders: number | null;
  orderCutoffMinutes: number | null;
  weekdays: number[];
  preparationBufferMinutes: number;
  travelBufferMinutes: number;
  isActive: boolean;
}

export interface CheckpointScheduleException {
  id: string;
  startDate: string;
  endDate: string;
  timeSlotId: string | null;
  replacementCheckpointId: string | null;
  replacementCheckpointName: string | null;
  reason: string;
}

export interface CheckpointDetail {
  id: string;
  name: string;
  type: CheckpointType;

  city: { id: string; name: string; state: string };
  zone: { id: string; name: string } | null;
  institution: { id: string; name: string } | null;

  address: {
    id: string;
    line1: string;
    line2: string | null;
    landmark: string | null;
    area: string | null;
    cityName: string;
    state: string;
    postalCode: string;
    latitude: number | null;
    longitude: number | null;
  } | null;

  latitude: number | null;
  longitude: number | null;
  geofenceRadiusM: number;
  instructions: string | null;
  deliveryCapacity: number | null;
  isActive: boolean;

  windows: DeliveryWindow[];

  createdAt: string;
  updatedAt: string;
}
