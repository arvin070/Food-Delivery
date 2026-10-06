import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { validationError } from '../core/errors';

/** Turns a ZodError into the `details` map the API contract specifies. */
export function zodToDetails(error: ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_';
    (details[key] ??= []).push(issue.message);
  }
  return details;
}

type Source = 'body' | 'query' | 'params';

/**
 * Validates one part of the request against a Zod schema and **replaces** it
 * with the parsed result, so downstream handlers get coerced, trimmed,
 * defaulted values rather than raw strings.
 */
function validateSource(source: Source) {
  return <S extends ZodTypeAny>(schema: S): RequestHandler =>
    (req: Request, _res: Response, next: NextFunction) => {
      const result = schema.safeParse(req[source]);
      if (!result.success) return next(validationError(zodToDetails(result.error)));
      // Express 4 defines `query` as a getter, so assign through defineProperty.
      Object.defineProperty(req, source, {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
      next();
    };
}

export const validateBody = validateSource('body');
export const validateQuery = validateSource('query');
export const validateParams = validateSource('params');

/** Typed accessors — `req.body` is `any` in Express's types. */
export const body = <S extends ZodTypeAny>(req: Request, _schema?: S): z.infer<S> =>
  req.body as z.infer<S>;
export const query = <S extends ZodTypeAny>(req: Request, _schema?: S): z.infer<S> =>
  req.query as unknown as z.infer<S>;
export const params = <S extends ZodTypeAny>(req: Request, _schema?: S): z.infer<S> =>
  req.params as unknown as z.infer<S>;
