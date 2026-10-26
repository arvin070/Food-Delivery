import type { RequestHandler } from "express";
import { env } from "../config/env";
import { forbidden, badRequest } from "../core/errors";
/** Cookie writes require a known browser origin; bearer-only native clients do not. */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  const hasSessionCookie =
    !!req.cookies?.lunch_access_token || !!req.cookies?.lunch_refresh_token;
  if (
    (origin && !env.CORS_ORIGINS.includes(origin)) ||
    (hasSessionCookie && !origin)
  )
    return next(forbidden("A trusted Origin is required for this request"));
  next();
};
/** Bound complexity before validation allocates issue objects (also covers query input). */
export const inputBudget: RequestHandler = (req, _res, next) => {
  let count = 0;
  const stack: { value: unknown; depth: number }[] = [
    { value: req.body, depth: 0 },
    { value: req.query, depth: 0 },
  ];
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++count > 12000 || depth > 20)
      return next(badRequest("Request is too complex"));
    if (value && typeof value === "object") {
      const values = Object.values(value);
      if (values.length > 1000)
        return next(badRequest("Collection is too large"));
      for (const v of values) stack.push({ value: v, depth: depth + 1 });
    }
  }
  next();
};
