import { ErrorCode } from '@lunch/shared';

/**
 * The only error type the HTTP layer knows how to render.
 *
 * Services throw these; the error middleware turns them into a response. Any
 * other thrown value is treated as a bug and reported as a 500 with its detail
 * withheld from the client.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: Record<string, string[]>;
  /** False for genuine bugs — tells the middleware to log at `error` level. */
  readonly isExpected: boolean;

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    options: { details?: Record<string, string[]>; isExpected?: boolean; cause?: unknown } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details;
    this.isExpected = options.isExpected ?? true;
    Error.captureStackTrace?.(this, AppError);
  }
}

/* Factories — these read better at the call site than `new AppError(404, …)`. */

export const badRequest = (message = 'Bad request', details?: Record<string, string[]>) =>
  new AppError(400, ErrorCode.BAD_REQUEST, message, { details });

export const validationError = (
  details: Record<string, string[]>,
  message = 'The submitted data is invalid'
) => new AppError(422, ErrorCode.VALIDATION_ERROR, message, { details });

export const unauthenticated = (
  message = 'You need to sign in to do that',
  code: ErrorCode = ErrorCode.UNAUTHENTICATED
) => new AppError(401, code, message);

export const forbidden = (
  message = 'You do not have permission to do that',
  code: ErrorCode = ErrorCode.FORBIDDEN
) => new AppError(403, code, message);

export const notFound = (resource = 'Resource') =>
  new AppError(404, ErrorCode.NOT_FOUND, `${resource} not found`);

export const conflict = (message: string, code: ErrorCode = ErrorCode.CONFLICT) =>
  new AppError(409, code, message);

/** 422 — the request was well-formed but breaks a domain rule. */
export const unprocessable = (code: ErrorCode, message: string, details?: Record<string, string[]>) =>
  new AppError(422, code, message, { details });

export const internalError = (message = 'Something went wrong', cause?: unknown) =>
  new AppError(500, ErrorCode.INTERNAL_ERROR, message, { isExpected: false, cause });
