import { z } from 'zod';
import { Allergen, FoodType, MealPeriod, OrderItemStatus, VendorStatus } from '../enums/index.js';
import {
  dateOnlySchema,
  emailSchema,
  idSchema,
  minuteOfDaySchema,
  nameSchema,
  paginationSchema,
  phoneSchema,
} from './common.js';

/** Money crosses the wire as a decimal string; see `money.ts`. */
const priceSchema = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? v.toFixed(2) : v.trim()))
  .pipe(z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter an amount like 149.50'));

// ─── Admin: vendor lifecycle ─────────────────────────────────────────────────

export const createVendorSchema = z.object({
  /** The person who will operate the vendor. Promoted to the VENDOR role. */
  ownerEmail: emailSchema.optional(),
  ownerPhone: phoneSchema.optional(),
  /** Supplied when creating the owner account at the same time. */
  ownerFullName: nameSchema.optional(),

  businessName: nameSchema,
  legalName: z.string().trim().max(160).nullish(),
  gstin: z
    .string()
    .trim()
    .regex(/^[0-9A-Z]{15}$/, 'A GSTIN is 15 characters')
    .nullish(),
  contactEmail: emailSchema.nullish(),
  contactPhone: phoneSchema.nullish(),
  commissionPct: z.coerce.number().min(0).max(100).default(15),
})
  .refine((v) => Boolean(v.ownerEmail || v.ownerPhone), {
    message: 'Identify the owner by email or phone',
    path: ['ownerEmail'],
  });
export type CreateVendorInput = z.infer<typeof createVendorSchema>;

export const updateVendorStatusSchema = z.object({
  status: z.enum(Object.values(VendorStatus) as [VendorStatus, ...VendorStatus[]]),
  /** Recorded in the audit log; expected when rejecting or suspending. */
  reason: z.string().trim().max(500).optional(),
});
export type UpdateVendorStatusInput = z.infer<typeof updateVendorStatusSchema>;

export const listVendorsQuerySchema = paginationSchema.extend({
  status: z.enum(Object.values(VendorStatus) as [VendorStatus, ...VendorStatus[]]).optional(),
  search: z.string().trim().min(1).max(120).optional(),
});
export type ListVendorsQuery = z.infer<typeof listVendorsQuerySchema>;

export const vendorIdParamSchema = z.object({ vendorId: idSchema });

export interface VendorSummary {
  id: string;
  businessName: string;
  legalName: string | null;
  status: VendorStatus;
  isActive: boolean;
  commissionPct: string;
  contactEmail: string | null;
  contactPhone: string | null;
  gstin: string | null;
  approvedAt: string | null;
  createdAt: string;
  owner: { id: string; fullName: string; email: string | null; phone: string | null };
  kitchenCount: number;
  mealCount: number;
}

// ─── Kitchen ─────────────────────────────────────────────────────────────────

export const addressSchema = z.object({
  line1: z.string().trim().min(3, 'Enter the street address').max(160),
  line2: z.string().trim().max(160).nullish(),
  landmark: z.string().trim().max(120).nullish(),
  area: z.string().trim().max(120).nullish(),
  cityName: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter a 6-digit PIN code'),
  latitude: z.coerce.number().min(-90).max(90).nullish(),
  longitude: z.coerce.number().min(-180).max(180).nullish(),
});
export type AddressInput = z.infer<typeof addressSchema>;

export const operatingHourSchema = z
  .object({
    /** ISO weekday: 1 = Monday … 7 = Sunday. */
    dayOfWeek: z.coerce.number().int().min(1).max(7),
    opensMinute: minuteOfDaySchema,
    closesMinute: minuteOfDaySchema,
    isClosed: z.boolean().default(false),
  })
  .refine((v) => v.isClosed || v.closesMinute > v.opensMinute, {
    message: 'Closing time must be after opening time',
    path: ['closesMinute'],
  });
export type OperatingHourInput = z.infer<typeof operatingHourSchema>;

export const updateKitchenSchema = z.object({
  name: nameSchema.optional(),
  contactPhone: phoneSchema.nullish(),
  /** Hard ceiling on meals this kitchen can produce in one time slot. */
  capacityPerSlot: z.coerce
    .number()
    .int()
    .min(1, 'Capacity must be at least 1')
    .max(10_000, 'That capacity looks too high')
    .optional(),
  isActive: z.boolean().optional(),
  address: addressSchema.optional(),
  /** Replaces the whole week when present — partial weeks are ambiguous. */
  operatingHours: z.array(operatingHourSchema).max(7).optional(),
});
export type UpdateKitchenInput = z.infer<typeof updateKitchenSchema>;

/** Checkpoints this kitchen will deliver to, replacing the current set. */
export const updateServiceAreasSchema = z.object({
  checkpoints: z
    .array(
      z.object({
        checkpointId: idSchema,
        prepLeadMinutes: z.coerce.number().int().min(0).max(1440).default(90),
        travelMinutes: z.coerce.number().int().min(0).max(600).default(30),
      })
    )
    .max(200),
});
export type UpdateServiceAreasInput = z.infer<typeof updateServiceAreasSchema>;

export const kitchenIdParamSchema = z.object({ kitchenId: idSchema });

export interface KitchenOperatingHour {
  dayOfWeek: number;
  opensMinute: number;
  closesMinute: number;
  isClosed: boolean;
}

export interface KitchenServiceArea {
  checkpointId: string;
  checkpointName: string;
  checkpointType: string;
  prepLeadMinutes: number;
  travelMinutes: number;
}

export interface KitchenDetail {
  id: string;
  vendorId: string;
  name: string;
  contactPhone: string | null;
  capacityPerSlot: number;
  isActive: boolean;
  city: { id: string; name: string } | null;
  address: (AddressInput & { id: string }) | null;
  operatingHours: KitchenOperatingHour[];
  serviceAreas: KitchenServiceArea[];
}

// ─── Menu ────────────────────────────────────────────────────────────────────

export const mealComponentSchema = z.object({
  name: z.string().trim().min(1, 'Name the item').max(80),
  quantity: z.string().trim().max(40).nullish(),
});

const gramsSchema = z.coerce.number().min(0).max(1000).nullish();

export const createMealSchema = z.object({
  name: nameSchema,
  description: z.string().trim().max(1000).nullish(),
  imageUrl: z.string().url().max(2048).refine(v => /^https?:\/\//i.test(v), 'Use an HTTP or HTTPS image URL').nullish(),
  basePrice: priceSchema,
  foodType: z.enum(Object.values(FoodType) as [FoodType, ...FoodType[]]).default(FoodType.VEG),
  /** Which parts of the day this dish suits. Checked against the slot on publish. */
  mealPeriods: z
    .array(z.enum(Object.values(MealPeriod) as [MealPeriod, ...MealPeriod[]]))
    .max(4)
    .optional(),
  categoryId: idSchema.nullish(),
  kitchenId: idSchema.nullish(),
  cuisine: z.string().trim().max(60).nullish(),

  /** What the dish is made of. */
  ingredients: z.array(z.string().trim().min(1).max(80)).max(60).optional(),
  /** Declared allergens, from the fixed list. */
  allergens: z
    .array(z.enum(Object.values(Allergen) as [Allergen, ...Allergen[]]))
    .max(12)
    .optional(),

  /** Nutrition per serving. Null means not declared. */
  calories: z.coerce.number().int().min(0).max(5000).nullish(),
  proteinG: gramsSchema,
  carbsG: gramsSchema,
  fatG: gramsSchema,
  fibreG: gramsSchema,

  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  prepTimeMinutes: z.coerce.number().int().min(1).max(600).default(45),
  /** Default ceiling when publishing this dish for a date. */
  maxDailyQuantity: z.coerce.number().int().min(1).max(10_000).nullish(),
  isActive: z.boolean().default(true),
  /** What is inside the tiffin. Display only. */
  components: z.array(mealComponentSchema).max(30).optional(),
});
export type CreateMealInput = z.infer<typeof createMealSchema>;

export const updateMealSchema = createMealSchema.partial();
export type UpdateMealInput = z.infer<typeof updateMealSchema>;

export const mealIdParamSchema = z.object({ mealId: idSchema });

export const listMealsQuerySchema = paginationSchema.extend({
  search: z.string().trim().min(1).max(120).optional(),
  mealPeriod: z.enum(Object.values(MealPeriod) as [MealPeriod, ...MealPeriod[]]).optional(),
  foodType: z.enum(Object.values(FoodType) as [FoodType, ...FoodType[]]).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ListMealsQuery = z.infer<typeof listMealsQuerySchema>;

export interface VendorMeal {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  basePrice: string;
  foodType: FoodType;
  mealPeriods: MealPeriod[];
  cuisine: string | null;
  ingredients: string[];
  allergens: Allergen[];
  calories: number | null;
  proteinG: string | null;
  carbsG: string | null;
  fatG: string | null;
  fibreG: string | null;
  tags: string[];
  prepTimeMinutes: number;
  maxDailyQuantity: number | null;
  isActive: boolean;
  category: { id: string; name: string } | null;
  kitchen: { id: string; name: string } | null;
  components: { name: string; quantity: string | null }[];
  /** How many future dates this meal is published for. */
  scheduledCount: number;
}

// ─── Vendor orders ───────────────────────────────────────────────────────────

/** The statuses a vendor drives. Delivery states belong to the rider. */
export const VENDOR_ORDER_STATUSES = [
  OrderItemStatus.PENDING,
  OrderItemStatus.CONFIRMED,
  OrderItemStatus.PREPARING,
  OrderItemStatus.PACKED,
] as const;
export type VendorOrderStatus = (typeof VENDOR_ORDER_STATUSES)[number];

/**
 * Allowed moves, as a forward-only pipeline.
 *
 * A vendor may also cancel an item that has not been packed. Anything past
 * PACKED belongs to the delivery partner, so it is absent here.
 */
export const VENDOR_STATUS_TRANSITIONS: Record<string, readonly OrderItemStatus[]> = {
  [OrderItemStatus.PENDING]: [OrderItemStatus.CONFIRMED, OrderItemStatus.CANCELLED],
  [OrderItemStatus.CONFIRMED]: [OrderItemStatus.PREPARING, OrderItemStatus.CANCELLED],
  [OrderItemStatus.PREPARING]: [OrderItemStatus.PACKED, OrderItemStatus.CANCELLED],
  [OrderItemStatus.PACKED]: [],
};

export const updateOrderItemStatusSchema = z.object({
  status: z.enum([
    OrderItemStatus.CONFIRMED,
    OrderItemStatus.PREPARING,
    OrderItemStatus.PACKED,
    OrderItemStatus.CANCELLED,
  ]),
  reason: z.string().trim().max(500).optional(),
});
export type UpdateOrderItemStatusInput = z.infer<typeof updateOrderItemStatusSchema>;

/** Moving many items at once — the kitchen works in batches, not one by one. */
export const bulkUpdateOrderItemStatusSchema = z.object({
  orderItemIds: z.array(idSchema).min(1, 'Select at least one item').max(200),
  status: z.enum([
    OrderItemStatus.CONFIRMED,
    OrderItemStatus.PREPARING,
    OrderItemStatus.PACKED,
  ]),
});
export type BulkUpdateOrderItemStatusInput = z.infer<typeof bulkUpdateOrderItemStatusSchema>;

export const listVendorOrdersQuerySchema = paginationSchema.extend({
  /** Defaults to today when omitted. */
  serviceDate: dateOnlySchema.optional(),
  /** `upcoming` means every future date, for planning. */
  range: z.enum(['today', 'upcoming', 'date']).default('today'),
  status: z
    .enum(Object.values(OrderItemStatus) as [OrderItemStatus, ...OrderItemStatus[]])
    .optional(),
  kitchenId: idSchema.optional(),
  timeSlotId: idSchema.optional(),
  checkpointId: idSchema.optional(),
});
export type ListVendorOrdersQuery = z.infer<typeof listVendorOrdersQuerySchema>;

export const orderItemIdParamSchema = z.object({ orderItemId: idSchema });

export interface VendorOrderItem {
  id: string;
  orderNumber: string;
  mealName: string;
  beneficiaryName: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  status: OrderItemStatus;
  serviceDate: string;
  timeSlot: { id: string; label: string };
  checkpoint: { id: string; name: string };
  kitchen: { id: string; name: string };
  notes: string | null;
  /** Allergies recorded for the beneficiary — the kitchen must see these. */
  allergies: string | null;
  createdAt: string;
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export interface VendorDashboard {
  vendor: { id: string; businessName: string; status: VendorStatus };
  today: {
    date: string;
    totalOrders: number;
    byStatus: Record<string, number>;
    /** Items still needing kitchen action: PENDING + CONFIRMED + PREPARING. */
    toPrepare: number;
    packed: number;
    delivered: number;
  };
  upcoming: {
    totalOrders: number;
    /** Next seven service dates with at least one order. */
    byDate: { date: string; count: number }[];
  };
  revenue: {
    currency: string;
    /** Gross value of today's non-cancelled items. */
    today: string;
    last7Days: string;
    last30Days: string;
    /** Net of the platform commission, at the vendor's current rate. */
    todayNet: string;
    commissionPct: string;
  };
  /** Production load per slot for today, against kitchen capacity. */
  slotLoad: {
    timeSlotId: string;
    label: string;
    ordered: number;
    capacity: number;
  }[];
}
