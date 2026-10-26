import type { RouteSuggestion, RouteSuggestionInput } from "@lunch/shared";
import { prisma } from "../../core/prisma";
import { badRequest, notFound } from "../../core/errors";
import { assertHorizon, isHoliday } from "./context";
import { distanceKm } from "./algorithms";
import { slotInstant } from "../subscriptions/recurrence";
function coordinates(p: {
  latitude: number | null;
  longitude: number | null;
}): p is { latitude: number; longitude: number } {
  return (
    p.latitude !== null &&
    p.longitude !== null &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    Math.abs(p.latitude) <= 90 &&
    Math.abs(p.longitude) <= 180
  );
}
export async function suggestRoutes(
  input: RouteSuggestionInput,
): Promise<RouteSuggestion> {
  const kitchen = await prisma.kitchen.findFirst({
    where: { id: input.kitchenId, isActive: true, deletedAt: null },
    include: { city: true },
  });
  if (!kitchen) throw notFound("Kitchen");
  assertHorizon(input.date, kitchen.city.timezone);
  const departure = slotInstant(
    new Date(input.date),
    input.departureMinute,
    kitchen.city.timezone,
  ).getTime();
  if (departure < Date.now())
    throw badRequest("Departure must be in the future");
  const closed = await isHoliday(input.date, kitchen.cityId);
  const output: RouteSuggestion = {
    method: "window-nearest-feasible-v1",
    asOf: new Date().toISOString(),
    date: input.date,
    kitchen: kitchen.name,
    assumptions: {
      maxMeals: input.maxMeals,
      speedKmh: input.speedKmh,
      stopMinutes: input.stopMinutes,
    },
    routes: [],
    unassigned: [],
    warnings: [
      "Draft suggestions only. Review and assign through Delivery routes; no assignments were changed.",
      "Travel uses straight-line distance × 1.3 and the selected average speed, without road or live traffic data. Rider capacity is an operator-supplied assumption.",
      "Only unassigned, confirmed/preparing/packed meals are considered. Available riders with any unfinished route or delivery on this date are excluded.",
    ],
  };
  const items = await prisma.orderItem.findMany({
    where: {
      kitchenId: kitchen.id,
      serviceDate: new Date(input.date),
      status: { in: ["CONFIRMED", "PREPARING", "PACKED"] },
      OR: [
        { delivery: null },
        {
          delivery: {
            deliveryStopId: null,
            deliveryPartnerId: null,
            status: "ASSIGNED",
          },
        },
      ],
    },
    select: {
      id: true,
      quantity: true,
      checkpoint: {
        select: {
          id: true,
          name: true,
          isActive: true,
          latitude: true,
          longitude: true,
          city: { select: { timezone: true } },
        },
      },
      timeSlot: {
        select: { id: true, label: true, startMinute: true, endMinute: true },
      },
    },
    orderBy: { id: "asc" },
    take: 1001,
  });
  if (items.length > 1000)
    throw badRequest(
      "This kitchen has more than 1000 candidate items; plan smaller batches through Delivery routes",
    );
  const partners = await prisma.deliveryPartner.findMany({
    where: {
      cityId: kitchen.cityId,
      isActive: true,
      isAvailable: true,
      deletedAt: null,
      user: { status: "ACTIVE", deletedAt: null, role: "DELIVERY_PARTNER" },
      deliveryRuns: {
        none: {
          serviceDate: new Date(input.date),
          status: { notIn: ["COMPLETED", "CANCELLED"] },
        },
      },
    },
    select: { id: true, user: { select: { fullName: true } } },
    orderBy: { id: "asc" },
    take: 101,
  });
  const busy = await prisma.delivery.findMany({
    where: {
      deliveryPartnerId: { in: partners.map((p) => p.id) },
      orderItem: { serviceDate: new Date(input.date) },
      status: { notIn: ["DELIVERED", "FAILED"] },
    },
    select: { deliveryPartnerId: true },
    distinct: ["deliveryPartnerId"],
  });
  const riders = partners
    .slice(0, 100)
    .filter((p) => !busy.some((b) => b.deliveryPartnerId === p.id));
  type Stop = {
    checkpoint: (typeof items)[number]["checkpoint"];
    slot: (typeof items)[number]["timeSlot"];
    meals: number;
    itemIds: string[];
    start: number;
    end: number;
  };
  const grouped = new Map<string, Stop>();
  for (const item of items) {
    const key = item.checkpoint.id + "|" + item.timeSlot.id;
    const g = grouped.get(key) ?? {
      checkpoint: item.checkpoint,
      slot: item.timeSlot,
      meals: 0,
      itemIds: [],
      start: slotInstant(
        new Date(input.date),
        item.timeSlot.startMinute,
        item.checkpoint.city.timezone,
      ).getTime(),
      end: slotInstant(
        new Date(input.date),
        item.timeSlot.endMinute,
        item.checkpoint.city.timezone,
      ).getTime(),
    };
    g.meals += item.quantity;
    g.itemIds.push(item.id);
    grouped.set(key, g);
  }
  const pending: Stop[] = [];
  for (const stop of grouped.values()) {
    let reason = "";
    if (closed)
      reason = "Service holiday: review existing bookings with operations";
    else if (!coordinates(kitchen))
      reason = "Kitchen coordinates are missing or invalid";
    else if (!stop.checkpoint.isActive || !coordinates(stop.checkpoint))
      reason = "Checkpoint is inactive or coordinates are missing";
    else if (stop.meals > input.maxMeals)
      reason =
        "Checkpoint batch exceeds rider meal capacity; split the batch manually";
    if (reason)
      output.unassigned.push({
        checkpoint: stop.checkpoint.name,
        meals: stop.meals,
        reason,
      });
    else pending.push(stop);
  }
  if (!coordinates(kitchen)) return output;
  for (const rider of riders) {
    let position = { latitude: kitchen.latitude, longitude: kitchen.longitude },
      clock = departure,
      quantity = 0,
      distance = 0;
    const stops: RouteSuggestion["routes"][number]["stops"] = [];
    while (pending.length) {
      const options = pending
        .flatMap((s, index) => {
          if (!coordinates(s.checkpoint) || quantity + s.meals > input.maxMeals)
            return [];
          const km = distanceKm(position, s.checkpoint) * 1.3;
          const arrival = Math.max(
            s.start,
            clock + (km / input.speedKmh) * 3600000,
          );
          if (arrival + input.stopMinutes * 60000 > s.end) return [];
          return [{ s, index, km, arrival }];
        })
        .sort(
          (a, b) =>
            a.s.end - b.s.end ||
            a.km - b.km ||
            a.s.checkpoint.id.localeCompare(b.s.checkpoint.id),
        );
      const next = options[0];
      if (!next) break;
      pending.splice(next.index, 1);
      quantity += next.s.meals;
      distance += next.km;
      clock = next.arrival + input.stopMinutes * 60000;
      position = {
        latitude: next.s.checkpoint.latitude!,
        longitude: next.s.checkpoint.longitude!,
      };
      stops.push({
        checkpointId: next.s.checkpoint.id,
        checkpoint: next.s.checkpoint.name,
        slotId: next.s.slot.id,
        slot: next.s.slot.label,
        meals: next.s.meals,
        itemIds: next.s.itemIds,
        arrival: new Date(next.arrival).toISOString(),
        windowEnd: new Date(next.s.end).toISOString(),
      });
    }
    if (stops.length)
      output.routes.push({
        partner: { id: rider.id, name: rider.user.fullName },
        meals: quantity,
        distanceKm: Math.round(distance * 10) / 10,
        stops,
      });
  }
  for (const s of pending)
    output.unassigned.push({
      checkpoint: s.checkpoint.name,
      meals: s.meals,
      reason:
        "No eligible rider, remaining capacity or feasible delivery window",
    });
  if (partners.length > 100)
    output.warnings.push(
      "Rider candidate list limited to 100; additional riders were not evaluated.",
    );
  return output;
}
