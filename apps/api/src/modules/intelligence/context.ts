import { prisma } from "../../core/prisma";
import { badRequest, notFound } from "../../core/errors";
import { cityToday, addDays } from "../subscriptions/recurrence";
export async function checkpointContext(id: string, date: string) {
  const checkpoint = await prisma.checkpoint.findFirst({
    where: {
      id,
      isActive: true,
      city: { isActive: true },
      OR: [{ institutionId: null }, { institution: { isActive: true } }],
    },
    include: {
      city: true,
      institution: { select: { id: true, name: true } },
      timeSlots: {
        where: { isActive: true, timeSlot: { isActive: true } },
        include: { timeSlot: true },
      },
    },
  });
  if (!checkpoint) throw notFound("Checkpoint");
  assertHorizon(date, checkpoint.city.timezone);
  return checkpoint;
}
export function assertHorizon(date: string, timezone: string) {
  const target = new Date(date),
    today = cityToday(timezone);
  if (target < today || target > addDays(today, 30))
    throw badRequest("Choose today or a date within the next 30 days");
}
export async function isHoliday(date: string, cityId: string) {
  return !!(await prisma.serviceHoliday.findFirst({
    where: { serviceDate: new Date(date), OR: [{ cityId: null }, { cityId }] },
    select: { id: true },
  }));
}
