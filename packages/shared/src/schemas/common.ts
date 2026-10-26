import { z } from 'zod';

/** CUID2-ish / cuid identifiers produced by Prisma's `@default(cuid())`. */
export const idSchema = z.string().min(1, 'Required').max(64);

/** E.164-ish Indian-friendly phone. Stored normalised, without spaces. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-()]/g, ''))
  .pipe(
    z
      .string()
      .regex(/^\+?[1-9]\d{7,14}$/, 'Enter a valid phone number')
  );

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address');

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Include at least one lowercase letter')
  .regex(/[A-Z]/, 'Include at least one uppercase letter')
  .regex(/\d/, 'Include at least one number')
  .refine(v => new TextEncoder().encode(v).length <= 72, 'Password must fit within 72 UTF-8 bytes');

export const nameSchema = z.string().trim().min(2, 'Too short').max(120, 'Too long');

/** A calendar date with no time component, as `YYYY-MM-DD`. */
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => {
    const date = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === v;
  }, 'Not a real date');

/** Minutes from midnight, local to the city's timezone. 0–1439. */
export const minuteOfDaySchema = z.number().int().min(0).max(1439);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof paginationSchema>;

export const sortOrderSchema = z.enum(['asc', 'desc']).default('desc');

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Shape of every error the API returns. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Field-level validation messages, keyed by dotted field path. */
    details?: Record<string, string[]>;
    requestId?: string;
  };
}
