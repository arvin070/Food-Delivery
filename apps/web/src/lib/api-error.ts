import type { ApiErrorBody } from '@lunch/shared';

/** An error response from the API, carried with its status and field details. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, string[]>;

  constructor(status: number, body: ApiErrorBody | undefined, fallback = 'Something went wrong') {
    super(body?.error?.message ?? fallback);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error?.code ?? 'INTERNAL_ERROR';
    this.details = body?.error?.details ?? {};
  }

  /** First message for a field, for rendering under an input. */
  fieldError(field: string): string | undefined {
    return this.details[field]?.[0];
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

/** Narrow unknown caught values without `instanceof` failing across bundles. */
export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError || (typeof err === 'object' && err !== null && 'code' in err && 'status' in err);
}
