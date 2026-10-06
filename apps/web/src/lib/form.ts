'use client';

import type { ZodTypeAny, z } from 'zod';
import { ApiError } from './api-error';

/**
 * Shared form plumbing.
 *
 * Every form in the app validates with the same Zod schema the API uses, then
 * maps either Zod issues or an `ApiError`'s `details` onto the same
 * `Record<field, message>` shape — so a validation failure looks identical to
 * the user whether it was caught in the browser or by the server.
 */
export type FieldErrors = Record<string, string>;

export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    errors[key] ??= issue.message;
  }
  return errors;
}

export function apiFieldErrors(error: ApiError): FieldErrors {
  return Object.fromEntries(
    Object.entries(error.details).map(([key, messages]) => [key, messages[0] ?? ''])
  );
}

/**
 * Normalises a caught error into field errors plus an optional form-level
 * message. A form-level message is used only when the API gave no field detail.
 */
export function toFormErrors(err: unknown): { fields: FieldErrors; formError: string | null } {
  if (err instanceof ApiError) {
    const fields = apiFieldErrors(err);
    return {
      fields,
      formError: Object.keys(fields).length > 0 ? null : err.message,
    };
  }
  return {
    fields: {},
    formError: 'We could not reach the server. Check your connection and try again.',
  };
}

/** `""` → undefined, so an untouched optional select is omitted, not sent blank. */
export function blankToUndefined(value: FormDataEntryValue | null): string | undefined {
  const str = String(value ?? '').trim();
  return str === '' ? undefined : str;
}

/** `""` → null, for fields the user is explicitly clearing. */
export function blankToNull(value: FormDataEntryValue | null): string | null {
  const str = String(value ?? '').trim();
  return str === '' ? null : str;
}

/** Splits a comma-separated input into trimmed tags. */
export function parseTags(value: FormDataEntryValue | null): string[] {
  return String(value ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

export function parseWithSchema<S extends ZodTypeAny>(
  schema: S,
  raw: unknown
): { ok: true; data: z.infer<S> } | { ok: false; fields: FieldErrors } {
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, fields: zodFieldErrors(result.error) };
}
