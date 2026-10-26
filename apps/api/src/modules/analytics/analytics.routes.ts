import { Router } from "express";
import { analyticsQuerySchema } from "@lunch/shared";
import { authenticate } from "../../middleware/authenticate";
import { authorizeAdmin } from "../../middleware/authorize";
import { validateQuery } from "../../middleware/validate";
import { asyncHandler, ok } from "../../core/http";
import { report } from "./analytics.service";
export const analyticsRouter = Router();
analyticsRouter.use(authenticate, authorizeAdmin());
analyticsRouter.get(
  "/",
  validateQuery(analyticsQuerySchema),
  asyncHandler(async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    return ok(res, await report(req.query as { from?: string; to?: string }));
  }),
);
