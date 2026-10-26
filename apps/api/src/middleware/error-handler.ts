import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorCode, type ApiErrorBody } from '@lunch/shared';
import { AppError, notFound } from '../core/errors';
import { logger } from '../core/logger';
import { Prisma } from '../core/prisma';
import { isProduction } from '../config/env';
import { zodToDetails } from './validate';

/** 404 for any route that did not match. Mounted last, before the error handler. */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(notFound('Endpoint'));
};

/** Maps a Prisma error to the right HTTP status instead of leaking a 500. */
function fromPrisma(err: Prisma.PrismaClientKnownRequestError): AppError {
  const target = (err.meta?.['target'] as string[] | string | undefined) ?? [];
  const fields = Array.isArray(target) ? target : [target];

  switch (err.code) {
    case 'P2002': {
      // Unique constraint violated.
      const field = fields[0] ?? 'value';
      const code =
        field === 'email'
          ? ErrorCode.EMAIL_TAKEN
          : field === 'phone'
            ? ErrorCode.PHONE_TAKEN
            : ErrorCode.CONFLICT;
      return new AppError(409, code, `That ${field} is already in use`, {
        details: { [String(field)]: ['Already in use'] },
      });
    }
    case 'P2003':
    case 'P2025':
      // Foreign key failed / record required but not found.
      return new AppError(404, ErrorCode.NOT_FOUND, 'A referenced record was not found');
    case 'P2014':
      return new AppError(409, ErrorCode.CONFLICT, 'That change would break a required relation');
    default:
      return new AppError(500, ErrorCode.INTERNAL_ERROR, 'Database error', {
        isExpected: false,
        cause: err,
      });
  }
}

function normalise(err: unknown): AppError {
  if(err && typeof err==='object' && 'status' in err && [413,415].includes(Number(err.status))) return new AppError(Number(err.status),ErrorCode.BAD_REQUEST,Number(err.status)===413?'Request body too large':'Unsupported content type');
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return new AppError(422, ErrorCode.VALIDATION_ERROR, 'The submitted data is invalid', {
      details: zodToDetails(err),
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) return fromPrisma(err);

  if (err instanceof Prisma.PrismaClientValidationError) {
    return new AppError(400, ErrorCode.BAD_REQUEST, 'Malformed database query', {
      isExpected: false,
      cause: err,
    });
  }

  // Express's body parser signals malformed JSON this way.
  if (
    err instanceof SyntaxError &&
    'status' in err &&
    (err as { status?: number }).status === 400
  ) {
    return new AppError(400, ErrorCode.BAD_REQUEST, 'Request body is not valid JSON');
  }

  return new AppError(500, ErrorCode.INTERNAL_ERROR, 'Something went wrong', {
    isExpected: false,
    cause: err,
  });
}

/**
 * The single place an error becomes a response.
 *
 * Unexpected errors are logged with their stack and replaced with a generic
 * message in production, so an internal detail never reaches a client.
 */
export const errorHandler: ErrorRequestHandler = (
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (res.headersSent) return next(err);

  const appError = normalise(err);
  const requestId = (req as Request & { id?: string }).id;

  const logPayload = {
    err: appError.isExpected ? { code: appError.code, message: appError.message } : appError,
    cause: appError.cause,
    requestId,
    method: req.method,
    path: req.originalUrl,
    userId: req.auth?.userId,
  };

  if (appError.isExpected) {
    logger.debug(logPayload, appError.message);
  } else {
    logger.error(logPayload, `Unhandled error: ${appError.message}`);
  }

  const body: ApiErrorBody = {
    error: {
      code: appError.code,
      message:
        appError.isExpected || !isProduction ? appError.message : 'Something went wrong',
      ...(appError.details ? { details: appError.details } : {}),
      ...(requestId ? { requestId } : {}),
    },
  };

  res.status(appError.statusCode).json(body);
};
