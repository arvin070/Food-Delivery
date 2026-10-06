import type { Request, RequestHandler, Response } from 'express';
import type { PaginatedResult, Pagination } from '@lunch/shared';

/**
 * Wraps an async handler so a rejected promise reaches Express's error
 * middleware. Without this, an async throw becomes an unhandled rejection and
 * the request hangs.
 */
export const asyncHandler =
  <T extends RequestHandler>(handler: T): RequestHandler =>
  (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };

/** 200 with a `data` envelope. Every success response uses this shape. */
export function ok<T>(res: Response, data: T, status = 200): Response {
  return res.status(status).json({ data });
}

export function created<T>(res: Response, data: T): Response {
  return ok(res, data, 201);
}

export function noContent(res: Response): Response {
  return res.status(204).send();
}

/** 200 with a `data` array plus a `meta` block the client pages through. */
export function paginated<T>(res: Response, result: PaginatedResult<T>): Response {
  const { items, ...meta } = result;
  return res.status(200).json({ data: items, meta });
}

export function buildPaginatedResult<T>(
  items: T[],
  total: number,
  { page, pageSize }: Pagination
): PaginatedResult<T> {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function toSkipTake({ page, pageSize }: Pagination): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

/** Best-effort client IP, honouring one proxy hop. */
export function clientIp(req: Request): string | undefined {
  return req.ip ?? req.socket.remoteAddress ?? undefined;
}
