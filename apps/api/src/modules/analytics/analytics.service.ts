import { Prisma } from "@prisma/client";
import type {
  AnalyticsReport,
  AnalyticsRevenue,
  AnalyticsTrend,
} from "@lunch/shared";
import { prisma } from "../../core/prisma";
import {
  addDays,
  cityToday,
  dateKey,
  slotInstant,
} from "../subscriptions/recurrence";
export const REPORT_TIMEZONE = "Asia/Kolkata";
const rate = (numerator: number, denominator: number) =>
  denominator ? Math.round((numerator / denominator) * 10000) / 100 : null;
type Counts = {
  orders: number;
  cancelledOrders: number;
  activeCustomers: number;
  activeSubscriptions: number;
};
type DeliveryCounts = {
  deliveries: number;
  delivered: number;
  failed: number;
  onTime: number;
  timedDeliveries: number;
};
type MoneyRow = {
  date: string;
  currency: string;
  providerCollections: string;
  corporateCollections: string;
  refunds: string;
};
function money(row: Omit<MoneyRow, "date">): AnalyticsRevenue {
  const provider = new Prisma.Decimal(row.providerCollections),
    corporate = new Prisma.Decimal(row.corporateCollections),
    refunds = new Prisma.Decimal(row.refunds);
  return {
    currency: row.currency,
    providerCollections: provider.toFixed(2),
    corporateCollections: corporate.toFixed(2),
    refunds: refunds.toFixed(2),
    net: provider.add(corporate).sub(refunds).toFixed(2),
  };
}
export async function report(query: {
  from?: string;
  to?: string;
}): Promise<AnalyticsReport> {
  const end = query.to ? new Date(query.to) : cityToday(REPORT_TIMEZONE),
    start = query.from ? new Date(query.from) : addDays(end, -29);
  const from = dateKey(start),
    to = dateKey(end),
    lower = slotInstant(start, 0, REPORT_TIMEZONE).toISOString(),
    upper = slotInstant(addDays(end, 1), 0, REPORT_TIMEZONE).toISOString();
  // Each CTE has an explicit date range. No raw customer or provider records leave this module.
  const orderCohort = Prisma.sql`SELECT o.*, (COALESCE(o."placedAt",o."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE ${REPORT_TIMEZONE})::date::text "day", o.status IN ('CANCELLED','REFUNDED') cancelled, o."totalAmount"+COALESCE(c."companyAmount",0) gross FROM orders o LEFT JOIN corporate_charges c ON c."orderId"=o.id WHERE (o."placedAt">=${lower}::timestamp AND o."placedAt"<${upper}::timestamp) OR (o."placedAt" IS NULL AND o."createdAt">=${lower}::timestamp AND o."createdAt"<${upper}::timestamp)`;
  const itemCohort = Prisma.sql`SELECT i.*, k.name "kitchenName",c.name "checkpointName", t."endMinute",city.timezone,d.id "deliveryId",d.status::text "deliveryStatus",d."deliveryPartnerId",d."deliveredAt", ((i."serviceDate"::timestamp + t."endMinute" * INTERVAL '1 minute') AT TIME ZONE city.timezone AT TIME ZONE 'UTC') deadline FROM order_items i JOIN kitchens k ON k.id=i."kitchenId" JOIN checkpoints c ON c.id=i."checkpointId" JOIN cities city ON city.id=c."cityId" JOIN time_slots t ON t.id=i."timeSlotId" LEFT JOIN deliveries d ON d."orderItemId"=i.id WHERE i."serviceDate">=${from}::date AND i."serviceDate"<=${to}::date AND i.status<>'CANCELLED'`;
  const deliveryCounts = Prisma.sql`COUNT("deliveryId")::int deliveries,COUNT(*) FILTER(WHERE "deliveryStatus"='DELIVERED')::int delivered,COUNT(*) FILTER(WHERE "deliveryStatus"='FAILED')::int failed,COUNT(*) FILTER(WHERE "deliveryStatus"='DELIVERED' AND "deliveredAt" IS NOT NULL)::int "timedDeliveries",COUNT(*) FILTER(WHERE "deliveryStatus"='DELIVERED' AND "deliveredAt"<=deadline)::int "onTime"`;
  // Revenue means cash collections, with offline company settlements kept separate.
  const collections = Prisma.sql`
 SELECT (p."paidAt" AT TIME ZONE 'UTC' AT TIME ZONE ${REPORT_TIMEZONE})::date::text date,p.currency,p.amount provider,0::numeric corporate,0::numeric refund FROM payments p WHERE p."paidAt">=${lower}::timestamp AND p."paidAt"<${upper}::timestamp AND p."lastVerifiedAt" IS NOT NULL AND p.status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')
 UNION ALL SELECT (r."processedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${REPORT_TIMEZONE})::date::text date,p.currency,0::numeric,0::numeric,r.amount FROM refunds r JOIN payments p ON p.id=r."paymentId" WHERE r.status='PROCESSED' AND r."processedAt">=${lower}::timestamp AND r."processedAt"<${upper}::timestamp
 UNION ALL SELECT (i."settledAt" AT TIME ZONE 'UTC' AT TIME ZONE ${REPORT_TIMEZONE})::date::text date,i.currency,0::numeric,i.amount,0::numeric FROM corporate_invoices i WHERE i."settledAt">=${lower}::timestamp AND i."settledAt"<${upper}::timestamp AND i."settlementReference" IS NOT NULL AND i."settledByUserId" IS NOT NULL`;
  const result = await prisma.$transaction(
    async (tx) => {
      const counts = await tx.$queryRaw<Counts[]>(
        Prisma.sql`WITH cohort AS (${orderCohort}) SELECT COUNT(*)::int orders,COUNT(*) FILTER(WHERE cancelled)::int "cancelledOrders",COUNT(DISTINCT "customerId") FILTER(WHERE NOT cancelled)::int "activeCustomers",(SELECT COUNT(*)::int FROM subscriptions WHERE status='ACTIVE' AND "startDate"<=${to}::date AND ("endDate" IS NULL OR "endDate">=${from}::date)) "activeSubscriptions" FROM cohort`,
      );
      const daily = await tx.$queryRaw<AnalyticsTrend[]>(
        Prisma.sql`WITH cohort AS (${orderCohort}) SELECT "day" date,COUNT(*)::int orders,COUNT(*) FILTER(WHERE cancelled)::int cancelled FROM cohort GROUP BY "day" ORDER BY "day"`,
      );
      const averages = await tx.$queryRaw<
        { currency: string; orders: number; value: string }[]
      >(
        Prisma.sql`WITH cohort AS (${orderCohort}) SELECT currency,COUNT(*)::int orders,ROUND(AVG(gross),2)::text value FROM cohort WHERE NOT cancelled GROUP BY currency ORDER BY currency`,
      );
      const delivery = await tx.$queryRaw<DeliveryCounts[]>(
        Prisma.sql`WITH cohort AS (${itemCohort}) SELECT ${deliveryCounts} FROM cohort`,
      );
      const dailyMoney = await tx.$queryRaw<MoneyRow[]>(
        Prisma.sql`WITH collections AS (${collections}) SELECT date,currency,SUM(provider)::text "providerCollections",SUM(corporate)::text "corporateCollections",SUM(refund)::text refunds FROM collections GROUP BY date,currency ORDER BY date,currency`,
      );
      const meals = await tx.$queryRaw<AnalyticsReport["popularMeals"]>(
        Prisma.sql`WITH cohort AS (${itemCohort}) SELECT COALESCE("mealId",'snapshot:'||"mealNameSnapshot") id,MIN("mealNameSnapshot") name,SUM(quantity)::int meals,COUNT(DISTINCT "orderId")::int orders FROM cohort GROUP BY COALESCE("mealId",'snapshot:'||"mealNameSnapshot") ORDER BY meals DESC,id LIMIT 10`,
      );
      const checkpoints = await tx.$queryRaw<
        AnalyticsReport["popularCheckpoints"]
      >(
        Prisma.sql`WITH cohort AS (${itemCohort}) SELECT "checkpointId" id,MIN("checkpointName") name,SUM(quantity)::int meals,COUNT(DISTINCT "orderId")::int orders FROM cohort GROUP BY "checkpointId" ORDER BY meals DESC,id LIMIT 10`,
      );
      const kitchens = await tx.$queryRaw<AnalyticsReport["kitchens"]>(
        Prisma.sql`WITH cohort AS (${itemCohort}) SELECT "kitchenId" id,MIN("kitchenName") name,SUM(quantity)::int meals,COALESCE(SUM(quantity) FILTER(WHERE "packedAt" IS NOT NULL),0)::int "packedMeals",COALESCE(SUM(quantity) FILTER(WHERE status='DELIVERED'),0)::int "deliveredMeals",COALESCE(SUM(quantity) FILTER(WHERE status='FAILED'),0)::int "failedMeals",ROUND(AVG(EXTRACT(EPOCH FROM ("packedAt"-"preparingAt"))/60) FILTER(WHERE "preparingAt" IS NOT NULL AND "packedAt">="preparingAt"),1)::float8 "averagePreparationMinutes" FROM cohort GROUP BY "kitchenId" ORDER BY meals DESC,id LIMIT 50`,
      );
      const partners = await tx.$queryRaw<
        (DeliveryCounts & { id: string; name: string })[]
      >(
        Prisma.sql`WITH cohort AS (${itemCohort}) SELECT p.id,u."fullName" name,${deliveryCounts} FROM cohort JOIN delivery_partners p ON p.id="deliveryPartnerId" JOIN users u ON u.id=p."userId" GROUP BY p.id,u."fullName" ORDER BY deliveries DESC,p.id LIMIT 50`,
      );
      return {
        counts: counts[0]!,
        daily,
        averages,
        delivery: delivery[0]!,
        dailyMoney,
        meals,
        checkpoints,
        kitchens,
        partners,
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 30000 },
  );
  const daily: AnalyticsTrend[] = [];
  const byDay = new Map(result.daily.map((d) => [d.date, d]));
  for (let day = start; day <= end; day = addDays(day, 1))
    daily.push(
      byDay.get(dateKey(day)) ?? {
        date: dateKey(day),
        orders: 0,
        cancelled: 0,
      },
    );
  const weeks = new Map<string, AnalyticsTrend>();
  for (const day of daily) {
    const date = new Date(day.date);
    const monday = dateKey(addDays(date, -((date.getUTCDay() + 6) % 7)));
    const bucket = weeks.get(monday) ?? {
      date: monday,
      orders: 0,
      cancelled: 0,
    };
    bucket.orders += day.orders;
    bucket.cancelled += day.cancelled;
    weeks.set(monday, bucket);
  }
  const currencies = [
    ...new Set(result.dailyMoney.map((r) => r.currency)),
  ].sort();
  const dailyRevenue: AnalyticsReport["dailyRevenue"] = [];
  const moneyByDay = new Map(
    result.dailyMoney.map((r) => [r.date + "|" + r.currency, r]),
  );
  for (const day of daily)
    for (const currency of currencies)
      dailyRevenue.push({
        date: day.date,
        ...money(
          moneyByDay.get(day.date + "|" + currency) ?? {
            currency,
            providerCollections: "0",
            corporateCollections: "0",
            refunds: "0",
          },
        ),
      });
  const revenue = currencies.map((currency) => {
    const rows = result.dailyMoney.filter((r) => r.currency === currency);
    const sum = (
      key: "providerCollections" | "corporateCollections" | "refunds",
    ) => rows.reduce((n, r) => n.add(r[key]), new Prisma.Decimal(0)).toFixed(2);
    return money({
      currency,
      providerCollections: sum("providerCollections"),
      corporateCollections: sum("corporateCollections"),
      refunds: sum("refunds"),
    });
  });
  const d = result.delivery;
  return {
    from,
    to,
    timezone: REPORT_TIMEZONE,
    generatedAt: new Date().toISOString(),
    summary: {
      ...result.counts,
      ...d,
      cancellationRate: rate(
        result.counts.cancelledOrders,
        result.counts.orders,
      ),
      failedDeliveryRate: rate(d.failed, d.delivered + d.failed),
      onTimeDeliveryRate: rate(d.onTime, d.timedDeliveries),
      unknownTiming: d.delivered - d.timedDeliveries,
    },
    revenue,
    averageOrderValue: result.averages.map((a) => ({
      ...a,
      value: new Prisma.Decimal(a.value).toFixed(2),
    })),
    daily,
    weekly: [...weeks.values()],
    dailyRevenue,
    popularMeals: result.meals,
    popularCheckpoints: result.checkpoints,
    kitchens: result.kitchens,
    partners: result.partners.map((p) => ({
      ...p,
      unknownTiming: p.delivered - p.timedDeliveries,
      failedDeliveryRate: rate(p.failed, p.delivered + p.failed),
      onTimeDeliveryRate: rate(p.onTime, p.timedDeliveries),
    })),
    limits: { popular: 10, performance: 50 },
  };
}
