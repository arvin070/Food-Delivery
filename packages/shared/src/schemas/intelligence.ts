import { z } from "zod";
import { dateOnlySchema, idSchema } from "./common.js";
export const recommendationQuerySchema = z
  .object({
    checkpointId: idSchema,
    date: dateOnlySchema,
    mealPeriod: z.enum(["BREAKFAST", "LUNCH", "SNACKS", "DINNER"]).optional(),
  })
  .strict();
export const demandQuerySchema = z
  .object({
    checkpointId: idSchema,
    date: dateOnlySchema,
    mealId: idSchema.optional(),
    institutionId: idSchema.optional(),
  })
  .strict();
export const routeSuggestionSchema = z
  .object({
    kitchenId: idSchema,
    date: dateOnlySchema,
    departureMinute: z.number().int().min(0).max(1439),
    maxMeals: z.number().int().min(1).max(500).default(80),
    speedKmh: z.number().min(5).max(60).default(20),
    stopMinutes: z.number().int().min(1).max(30).default(5),
  })
  .strict();
export const supportQuestionSchema = z
  .object({
    question: z.string().trim().min(3).max(500),
    orderId: idSchema.optional(),
    subscriptionId: idSchema.optional(),
    checkpointId: idSchema.optional(),
    date: dateOnlySchema.optional(),
  })
  .strict();
export type RecommendationQuery = z.infer<typeof recommendationQuerySchema>;
export type DemandQuery = z.infer<typeof demandQuerySchema>;
export type RouteSuggestionInput = z.infer<typeof routeSuggestionSchema>;
export type SupportQuestion = z.infer<typeof supportQuestionSchema>;
export interface IntelligenceOptions {
  orders: { id: string; orderNumber: string }[];
  subscriptions: { id: string; label: string }[];
  checkpoints: { id: string; name: string; institutionId: string | null }[];
  kitchens: { id: string; name: string }[];
}
export interface Recommendations {
  method: string;
  asOf: string;
  date: string;
  warnings: string[];
  truncated: boolean;
  meals: {
    scheduleId: string;
    mealId: string;
    name: string;
    price: string;
    slot: string;
    period: string;
    remaining: number;
    score: number;
    reasons: string[];
    allergens: string[];
  }[];
}
export interface DemandForecast {
  method: string;
  asOf: string;
  date: string;
  dayOfWeek: string;
  checkpoint: string;
  institution: string | null;
  historyFrom: string;
  historyTo: string;
  observations: number;
  closed: boolean;
  rows: {
    mealId: string | null;
    meal: string;
    period: string;
    expected: number | null;
    low: number | null;
    high: number | null;
    booked: number;
    confidence: "INSUFFICIENT" | "LOW" | "MODERATE";
  }[];
  warnings: string[];
}
export interface RouteSuggestion {
  method: string;
  asOf: string;
  date: string;
  kitchen: string;
  assumptions: { speedKmh: number; stopMinutes: number; maxMeals: number };
  routes: {
    partner: { id: string; name: string };
    meals: number;
    distanceKm: number;
    stops: {
      checkpointId: string;
      checkpoint: string;
      slotId: string;
      slot: string;
      meals: number;
      itemIds: string[];
      arrival: string;
      windowEnd: string;
    }[];
  }[];
  unassigned: { checkpoint: string; meals: number; reason: string }[];
  warnings: string[];
}
export interface SupportAnswer {
  intent: "ORDER" | "PAYMENT" | "SKIP" | "MEALS" | "UNKNOWN";
  answer: string;
  asOf: string;
  sources: { label: string; href: string }[];
  facts: { label: string; value: string }[];
  changed: false;
}
