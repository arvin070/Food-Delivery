export const GENERATION_DAYS = 7;
export function dateKey(date: Date): string { return date.toISOString().slice(0, 10); }
export function addDays(date: Date, days: number): Date {
  const result = new Date(date); result.setUTCDate(result.getUTCDate() + days); return result;
}
export function planDates(plan: string, start: Date, end?: Date, selected: number[] = []) {
  let endDate = end ?? null;
  if (plan === 'ONE_TIME') endDate = start;
  if (plan === 'WEEKLY') endDate = addDays(start, 6);
  if (plan === 'MONTHLY') {
    // Clamp the anniversary to the last day of the next month, then use an exclusive boundary.
    const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 2, 0));
    next.setUTCDate(Math.min(start.getUTCDate(), next.getUTCDate()));
    endDate = addDays(next, -1);
  }
  return { endDate, daysOfWeek: plan === 'WEEKDAYS' ? [1,2,3,4,5] : plan === 'CUSTOM' ? [...new Set(selected)] : [1,2,3,4,5,6,7] };
}
export function occursOn(sub: { startDate: Date; endDate: Date | null; daysOfWeek: number[] }, date: Date) {
  return date >= sub.startDate && (!sub.endDate || date <= sub.endDate) && sub.daysOfWeek.includes(date.getUTCDay() || 7);
}
/** Convert a city's wall-clock delivery minute into an instant, including DST offsets. */
export function slotInstant(date: Date, minute: number, timezone: string): Date {
  const wall = date.getTime() + minute * 60_000;
  let instant = wall;
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(format.formatToParts(new Date(instant)).map(p => [p.type, p.value]));
    const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    instant += wall - local;
  }
  return new Date(instant);
}
export function cityToday(timezone: string, now = new Date()): Date {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(now).map(p => [p.type,p.value]));
  return new Date(`${p.year}-${p.month}-${p.day}T00:00:00Z`);
}
