import type { RecommendationQuery, Recommendations } from "@lunch/shared";
import { prisma } from "../../core/prisma";
import { checkpointContext, isHoliday } from "./context";
import { dietaryTypes, recommendationStrategy } from "./algorithms";
import { slotInstant, addDays } from "../subscriptions/recurrence";
export async function recommend(
  userId: string,
  input: RecommendationQuery,
): Promise<Recommendations> {
  const cp = await checkpointContext(input.checkpointId, input.date);
  const output: Recommendations = {
    method: "preference-history-v1",
    asOf: new Date().toISOString(),
    date: input.date,
    warnings: [
      "Recommendations use your profile, not a child’s dietary profile. Availability is checked again at checkout.",
    ],
    truncated: false,
    meals: [],
  };
  if (await isHoliday(input.date, cp.cityId)) {
    output.warnings.push("Meal service is closed for a holiday.");
    return output;
  }
  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  if (profile?.allergies)
    output.warnings.push(
      "Your allergy notes require checking with the kitchen. Recommendations are not an allergy-safety guarantee.",
    );
  const serviceDate = new Date(input.date);
  const slots = cp.timeSlots.filter(
    (w) =>
      (!input.mealPeriod || w.timeSlot.mealPeriod === input.mealPeriod) &&
      slotInstant(
        serviceDate,
        w.timeSlot.startMinute,
        cp.city.timezone,
      ).getTime() -
        (w.orderCutoffMinutes ?? w.timeSlot.orderCutoffMinutes) * 60000 >
        Date.now(),
  );
  const [schedules, history, checkpointBooked] = await Promise.all([
    prisma.mealSchedule.findMany({
      where: {
        serviceDate,
        timeSlotId: { in: slots.map((w) => w.timeSlotId) },
        status: "PUBLISHED",
        meal: {
          isActive: true,
          deletedAt: null,
          foodType: {
            in: dietaryTypes(profile?.dietaryPreference ?? "NONE") as never,
          },
        },
        kitchen: {
          cityId: cp.cityId,
          isActive: true,
          deletedAt: null,
          vendor: { isActive: true, status: "APPROVED", deletedAt: null },
          serviceAreas: { some: { checkpointId: cp.id, isActive: true } },
        },
      },
      include: { meal: true, kitchen: true, timeSlot: true },
      orderBy: { id: "asc" },
      take: 501,
    }),
    prisma.orderItem.groupBy({
      by: ["mealId"],
      where: {
        order: { customerId: userId },
        childId: null,
        serviceDate: { gte: addDays(new Date(), -90), lte: new Date() },
        status: {
          in: [
            "CONFIRMED",
            "PREPARING",
            "PACKED",
            "OUT_FOR_DELIVERY",
            "DELIVERED",
          ],
        },
      },
      _sum: { quantity: true },
    }),
    prisma.orderItem.groupBy({
      by: ["timeSlotId"],
      where: {
        checkpointId: cp.id,
        serviceDate,
        status: { notIn: ["CANCELLED", "FAILED"] },
      },
      _sum: { quantity: true },
    }),
  ]);
  output.truncated = schedules.length > 500;
  const candidates = schedules.slice(0, 500);
  const kitchenBooked = await prisma.orderItem.groupBy({
    by: ["kitchenId", "timeSlotId"],
    where: {
      kitchenId: { in: [...new Set(candidates.map((s) => s.kitchenId))] },
      serviceDate,
      status: { notIn: ["CANCELLED", "FAILED"] },
    },
    _sum: { quantity: true },
  });
  const preferences = (profile?.foodPreferences ?? []).map((p) =>
    p.toLowerCase(),
  );
  for (const s of candidates) {
    const window = slots.find((w) => w.timeSlotId === s.timeSlotId)!;
    const cpUsed =
      checkpointBooked.find((b) => b.timeSlotId === s.timeSlotId)?._sum
        .quantity ?? 0;
    const kitchenUsed =
      kitchenBooked.find(
        (b) => b.kitchenId === s.kitchenId && b.timeSlotId === s.timeSlotId,
      )?._sum.quantity ?? 0;
    const remaining = Math.min(
      s.totalQuantity - s.reservedQuantity,
      s.kitchen.capacityPerSlot - kitchenUsed,
      (cp.deliveryCapacity ?? Infinity) - cpUsed,
      (window.maxOrders ?? Infinity) - cpUsed,
    );
    if (remaining < 1) continue;
    const past = history.find((h) => h.mealId === s.mealId)?._sum.quantity ?? 0;
    const matches = preferences.filter((p) =>
      [s.meal.cuisine, ...s.meal.tags, s.meal.name].some((v) =>
        v?.toLowerCase().includes(p),
      ),
    ).length;
    const preferredSlot = profile?.defaultTimeSlotId === s.timeSlotId;
    output.meals.push({
      scheduleId: s.id,
      mealId: s.mealId,
      name: s.meal.name,
      price: s.price.toFixed(2),
      slot: s.timeSlot.label,
      period: s.timeSlot.mealPeriod,
      remaining,
      allergens: s.meal.allergens,
      score: recommendationStrategy.score({
        pastQuantity: past,
        preferenceMatches: matches,
        preferredSlot,
      }),
      reasons: [
        ...(past ? ["Previously ordered by you"] : []),
        ...(matches ? ["Matches your meal preferences"] : []),
        ...(preferredSlot ? ["Your preferred delivery time"] : []),
        "Available before the local ordering cutoff",
      ],
    });
  }
  output.meals.sort(
    (a, b) => b.score - a.score || a.scheduleId.localeCompare(b.scheduleId),
  );
  output.meals = output.meals.slice(0, 12);
  return output;
}
