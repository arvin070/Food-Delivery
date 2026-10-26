import { z } from 'zod';
import { dateOnlySchema, idSchema } from '@lunch/shared';
export const subscribeSchema = z.object({
  mealScheduleId: idSchema,
  checkpointId: idSchema,
  childId: idSchema.optional(),
  plan: z.enum(['ONE_TIME', 'DAILY', 'WEEKLY', 'MONTHLY', 'WEEKDAYS', 'CUSTOM']),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema.optional(),
  daysOfWeek: z.array(z.number().int().min(1).max(7)).max(7).default([]),
  quantity: z.number().int().min(1).max(20).default(1),
  idempotencyKey: z.string().min(8).max(100),
}).refine(v => v.plan !== 'CUSTOM' || v.daysOfWeek.length > 0, 'Select at least one weekday')
  .refine(v => !v.endDate || v.endDate >= v.startDate, 'End date must follow start date');
export type SubscribeInput = z.infer<typeof subscribeSchema>;
export const actionSchema = z.object({
  action: z.enum(['PAUSE', 'RESUME', 'SKIP', 'CANCEL']),
  date: dateOnlySchema.optional(),
}).refine(v => v.action !== 'SKIP' || !!v.date, 'Choose a date to skip');
