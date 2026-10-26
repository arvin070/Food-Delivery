import { Prisma } from "@prisma/client";
import type { DemandQuery, DemandForecast } from "@lunch/shared";
import { prisma } from "../../core/prisma";
import { badRequest } from "../../core/errors";
import { checkpointContext, isHoliday } from "./context";
import { demandStrategy } from "./algorithms";
import { cityToday, addDays, dateKey } from "../subscriptions/recurrence";
export async function forecast(input: DemandQuery): Promise<DemandForecast> {
  const cp = await checkpointContext(input.checkpointId, input.date);
  if (input.institutionId && input.institutionId !== cp.institutionId)
    throw badRequest("Checkpoint does not belong to the selected institution");
  const today = cityToday(cp.city.timezone),
    start = addDays(today, -56),
    end = addDays(today, -1),
    target = new Date(input.date);
  const historical = await prisma.$queryRaw<
    {
      date: string;
      mealId: string | null;
      meal: string;
      period: string;
      quantity: number;
    }[]
  >(
    Prisma.sql`SELECT i."serviceDate"::text date,i."mealId",MIN(i."mealNameSnapshot") meal,t."mealPeriod"::text period,SUM(i.quantity)::int quantity FROM order_items i JOIN time_slots t ON t.id=i."timeSlotId" WHERE i."checkpointId"=${cp.id} AND i."serviceDate">=${dateKey(start)}::date AND i."serviceDate"<=${dateKey(end)}::date AND i.status IN ('CONFIRMED','PREPARING','PACKED','OUT_FOR_DELIVERY','DELIVERED','FAILED') ${input.mealId ? Prisma.sql`AND i."mealId"=${input.mealId}` : Prisma.empty} GROUP BY i."serviceDate",i."mealId",t."mealPeriod" ORDER BY i."serviceDate" LIMIT 28001`,
  );
  if (historical.length > 28000)
    throw badRequest("Too many historical meal groups; select a meal");
  const booked = await prisma.orderItem.findMany({
    where: {
      checkpointId: cp.id,
      serviceDate: target,
      ...(input.mealId ? { mealId: input.mealId } : {}),
      status: { notIn: ["CANCELLED", "FAILED", "PENDING"] },
    },
    select: {
      mealId: true,
      mealNameSnapshot: true,
      quantity: true,
      timeSlot: { select: { mealPeriod: true } },
    },
    take: 5001,
  });
  if (booked.length > 5000)
    throw badRequest(
      "Too many booked items for a single forecast; select a meal",
    );
  const holidays = await prisma.serviceHoliday.findMany({
    where: {
      serviceDate: { gte: start, lte: end },
      OR: [{ cityId: null }, { cityId: cp.cityId }],
    },
    select: { serviceDate: true },
  });
  const excluded = new Set(holidays.map((h) => dateKey(h.serviceDate)));
  // Start at the first observed service day, avoiding treating pre-launch days as zero demand.
  const first = historical[0]?.date;
  const sampleDates: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1))
    if (
      day.getUTCDay() === target.getUTCDay() &&
      first &&
      dateKey(day) >= first &&
      !excluded.has(dateKey(day))
    )
      sampleDates.push(dateKey(day));
  const keys = new Map<
    string,
    { mealId: string | null; meal: string; period: string }
  >();
  for (const r of historical)
    keys.set((r.mealId ?? r.meal) + "|" + r.period, {
      mealId: r.mealId,
      meal: r.meal,
      period: r.period,
    });
  for (const r of booked)
    keys.set((r.mealId ?? r.mealNameSnapshot) + "|" + r.timeSlot.mealPeriod, {
      mealId: r.mealId,
      meal: r.mealNameSnapshot,
      period: r.timeSlot.mealPeriod,
    });
  if (keys.size > 500) throw badRequest("Too many meal groups; select a meal");
  const closed = await isHoliday(input.date, cp.cityId);
  const rows = [...keys.values()].map((k) => {
    const same = (r: { mealId: string | null; meal: string; period: string }) =>
      r.mealId === k.mealId &&
      r.period === k.period &&
      (k.mealId !== null || r.meal === k.meal);
    const samples = sampleDates.map((date) =>
      historical
        .filter((r) => r.date === date && same(r))
        .reduce((n, r) => n + r.quantity, 0),
    );
    const predicted = demandStrategy.predict(samples);
    const committed = booked
      .filter((r) =>
        same({
          mealId: r.mealId,
          meal: r.mealNameSnapshot,
          period: r.timeSlot.mealPeriod,
        }),
      )
      .reduce((n, r) => n + r.quantity, 0);
    return {
      ...k,
      expected: closed
        ? 0
        : predicted
          ? Math.max(committed, predicted.expected)
          : null,
      low: closed ? 0 : predicted ? Math.max(committed, predicted.low) : null,
      high: closed ? 0 : predicted ? Math.max(committed, predicted.high) : null,
      booked: committed,
      confidence:
        closed || !predicted
          ? ("INSUFFICIENT" as const)
          : samples.length >= 6
            ? ("MODERATE" as const)
            : ("LOW" as const),
    };
  });
  return {
    method: "same-weekday-mean-v1",
    asOf: new Date().toISOString(),
    date: input.date,
    dayOfWeek: target.toLocaleDateString("en", {
      weekday: "long",
      timeZone: "UTC",
    }),
    checkpoint: cp.name,
    institution: cp.institution?.name ?? null,
    historyFrom: dateKey(start),
    historyTo: dateKey(end),
    observations: sampleDates.length,
    closed,
    rows,
    warnings: [
      "Estimate from up to eight prior matching weekdays; zero-order days after first observed demand are included. At least four observations are required.",
      "Ranges show historical variability, not a calibrated confidence interval. No weather, events or latent unsold demand model is included.",
      "Known bookings are a lower bound on estimates. Forecasts do not reserve meals or create orders.",
      ...(closed
        ? ["Holiday closure: review any existing bookings separately."]
        : []),
    ],
  };
}
