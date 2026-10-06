import { z } from 'zod';
import { Allergen, FoodType, MealPeriod, MealScheduleStatus } from '../enums/index.js';
import { dateOnlySchema, idSchema, paginationSchema } from './common.js';

/** Money crosses the wire as a decimal string; see `money.ts`. */
const priceSchema = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? v.toFixed(2) : v.trim()))
  .pipe(z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter an amount like 149.50'));

const allergenSchema = z.enum(Object.values(Allergen) as [Allergen, ...Allergen[]]);
const mealPeriodSchema = z.enum(Object.values(MealPeriod) as [MealPeriod, ...MealPeriod[]]);

/** Grams, to two places. Null means "not declared". */
const gramsSchema = z.coerce.number().min(0).max(1000).nullish();

// ─── Nutrition & allergens on a meal ─────────────────────────────────────────

export const nutritionSchema = z.object({
  calories: z.coerce.number().int().min(0).max(5000).nullish(),
  proteinG: gramsSchema,
  carbsG: gramsSchema,
  fatG: gramsSchema,
  fibreG: gramsSchema,
});
export type NutritionInput = z.infer<typeof nutritionSchema>;

export interface Nutrition {
  calories: number | null;
  proteinG: string | null;
  carbsG: string | null;
  fatG: string | null;
  fibreG: string | null;
}

// ─── Availability (publishing a meal for a date) ─────────────────────────────

/**
 * Publishing a meal makes it purchasable. The vendor picks dates and slots;
 * one `MealSchedule` row is created per date × slot.
 */
export const publishAvailabilitySchema = z
  .object({
    mealId: idSchema,
    kitchenId: idSchema,
    /** Each date to publish for. A range is expanded by the client. */
    serviceDates: z.array(dateOnlySchema).min(1, 'Pick at least one date').max(90),
    timeSlotIds: z.array(idSchema).min(1, 'Pick at least one delivery time').max(10),
    /** Overrides the meal's base price for these dates. */
    price: priceSchema.optional(),
    quantity: z.coerce
      .number()
      .int()
      .min(1, 'Publish at least one meal')
      .max(10_000, 'That quantity looks too high'),
    /** Publish immediately, or keep as a draft to review first. */
    publish: z.boolean().default(true),
  })
  .refine(
    (v) => {
      // Publishing into the past is always a mistake.
      const today = new Date().toISOString().slice(0, 10);
      return v.serviceDates.every((d) => d >= today);
    },
    { message: 'You cannot publish for a date that has passed', path: ['serviceDates'] }
  );
export type PublishAvailabilityInput = z.infer<typeof publishAvailabilitySchema>;

export const updateAvailabilitySchema = z.object({
  quantity: z.coerce.number().int().min(0).max(10_000).optional(),
  price: priceSchema.optional(),
  status: z
    .enum([
      MealScheduleStatus.DRAFT,
      MealScheduleStatus.PUBLISHED,
      MealScheduleStatus.CLOSED,
      MealScheduleStatus.CANCELLED,
    ])
    .optional(),
});
export type UpdateAvailabilityInput = z.infer<typeof updateAvailabilitySchema>;

export const listAvailabilityQuerySchema = paginationSchema.extend({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  mealId: idSchema.optional(),
  kitchenId: idSchema.optional(),
  status: z
    .enum(Object.values(MealScheduleStatus) as [MealScheduleStatus, ...MealScheduleStatus[]])
    .optional(),
});
export type ListAvailabilityQuery = z.infer<typeof listAvailabilityQuerySchema>;

export const scheduleIdParamSchema = z.object({ scheduleId: idSchema });

export interface MealAvailability {
  id: string;
  serviceDate: string;
  timeSlot: { id: string; label: string; mealPeriod: MealPeriod };
  meal: { id: string; name: string; foodType: FoodType };
  kitchen: { id: string; name: string };
  price: string;
  totalQuantity: number;
  reservedQuantity: number;
  /** `totalQuantity - reservedQuantity`, never below zero. */
  remaining: number;
  status: MealScheduleStatus;
}

// ─── Customer catalog (read-only) ────────────────────────────────────────────

/**
 * Browsing is anchored to a **date and a checkpoint**, because that is what
 * determines what can actually reach the customer: only kitchens that serve
 * that checkpoint, with stock left, before the ordering cutoff.
 */
export const browseCatalogQuerySchema = paginationSchema.extend({
  /** Defaults to today when omitted. */
  serviceDate: dateOnlySchema.optional(),
  checkpointId: idSchema.optional(),
  mealPeriod: mealPeriodSchema.optional(),
  timeSlotId: idSchema.optional(),
  foodType: z.enum(Object.values(FoodType) as [FoodType, ...FoodType[]]).optional(),
  categoryId: idSchema.optional(),
  search: z.string().trim().min(1).max(120).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  /**
   * Hide anything declaring these allergens. Repeatable in the query string.
   * This is the filter a parent with an allergic child actually uses.
   */
  excludeAllergens: z
    .union([allergenSchema, z.array(allergenSchema)])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  sort: z.enum(['price_asc', 'price_desc', 'name', 'popular']).default('name'),
});
export type BrowseCatalogQuery = z.infer<typeof browseCatalogQuerySchema>;

export const mealScheduleIdParamSchema = z.object({ mealScheduleId: idSchema });

/** A purchasable meal: the dish, pinned to a date, slot, kitchen and price. */
export interface CatalogMeal {
  /** The MealSchedule id — this is what goes in the cart, not the meal id. */
  mealScheduleId: string;
  mealId: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;

  price: string;
  foodType: FoodType;
  mealPeriods: MealPeriod[];
  cuisine: string | null;
  category: { id: string; name: string } | null;
  tags: string[];

  allergens: Allergen[];
  nutrition: Nutrition;
  prepTimeMinutes: number;

  serviceDate: string;
  timeSlot: { id: string; label: string; mealPeriod: MealPeriod; startMinute: number };
  remaining: number;
  /** False once the ordering cutoff for this slot has passed. */
  orderable: boolean;

  vendor: { id: string; businessName: string };
  kitchen: { id: string; name: string };
}

/** Everything on the detail screen, including what is in the box. */
export interface CatalogMealDetail extends CatalogMeal {
  ingredients: string[];
  components: { name: string; quantity: string | null }[];
  /** Other slots the same dish is available in on the same date. */
  alsoAvailableIn: { mealScheduleId: string; timeSlotLabel: string; price: string }[];
}

/** The facets a browse response carries, so the UI can build its filters. */
export interface CatalogFacets {
  mealPeriods: { value: MealPeriod; count: number }[];
  foodTypes: { value: FoodType; count: number }[];
  categories: { id: string; name: string; count: number }[];
  priceRange: { min: string; max: string } | null;
}
