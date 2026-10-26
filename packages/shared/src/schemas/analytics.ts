import { z } from "zod";
const date = z
  .string()
  .regex(/^20\d{2}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Enter a valid date",
  );
export const analyticsQuerySchema = z
  .object({ from: date.optional(), to: date.optional() })
  .strict()
  .superRefine((v, ctx) => {
    if (Boolean(v.from) !== Boolean(v.to))
      ctx.addIssue({
        code: "custom",
        message: "Provide both start and end dates",
        path: ["from"],
      });
    if (v.from && v.to) {
      const days = (Date.parse(v.to) - Date.parse(v.from)) / 86400000;
      if (days < 0 || days > 365)
        ctx.addIssue({
          code: "custom",
          message: "Choose an ordered date range of at most 366 days",
          path: ["to"],
        });
    }
  });
export interface AnalyticsTrend {
  date: string;
  orders: number;
  cancelled: number;
}
export interface AnalyticsRevenue {
  currency: string;
  providerCollections: string;
  corporateCollections: string;
  refunds: string;
  net: string;
}
export interface AnalyticsReport {
  from: string;
  to: string;
  timezone: string;
  generatedAt: string;
  summary: {
    orders: number;
    cancelledOrders: number;
    cancellationRate: number | null;
    activeCustomers: number;
    activeSubscriptions: number;
    deliveries: number;
    delivered: number;
    failed: number;
    failedDeliveryRate: number | null;
    onTime: number;
    timedDeliveries: number;
    unknownTiming: number;
    onTimeDeliveryRate: number | null;
  };
  revenue: AnalyticsRevenue[];
  averageOrderValue: { currency: string; orders: number; value: string }[];
  daily: AnalyticsTrend[];
  weekly: AnalyticsTrend[];
  dailyRevenue: (AnalyticsRevenue & { date: string })[];
  popularMeals: { id: string; name: string; meals: number; orders: number }[];
  popularCheckpoints: {
    id: string;
    name: string;
    meals: number;
    orders: number;
  }[];
  kitchens: {
    id: string;
    name: string;
    meals: number;
    packedMeals: number;
    deliveredMeals: number;
    failedMeals: number;
    averagePreparationMinutes: number | null;
  }[];
  partners: {
    id: string;
    name: string;
    deliveries: number;
    delivered: number;
    failed: number;
    onTime: number;
    timedDeliveries: number;
    unknownTiming: number;
    failedDeliveryRate: number | null;
    onTimeDeliveryRate: number | null;
  }[];
  limits: { popular: number; performance: number };
}
