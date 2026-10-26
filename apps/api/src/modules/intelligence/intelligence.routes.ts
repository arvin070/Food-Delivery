import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  recommendationQuerySchema,
  demandQuerySchema,
  routeSuggestionSchema,
  supportQuestionSchema,
} from "@lunch/shared";
import { authenticate, requireAuth } from "../../middleware/authenticate";
import { authorizeBuyer, authorizeAdmin } from "../../middleware/authorize";
import { validateQuery, validateBody } from "../../middleware/validate";
import { asyncHandler, ok } from "../../core/http";
import { prisma } from "../../core/prisma";
import { recommend } from "./recommendation.service";
import { forecast } from "./demand.service";
import { suggestRoutes } from "./route.service";
import { answerQuestion } from "./support.service";
export const intelligenceRouter = Router();
intelligenceRouter.use(
  authenticate,
  rateLimit({
    windowMs: 60000,
    limit: 60,
    keyGenerator: (req) => requireAuth(req).userId,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  }),
  (req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  },
);
intelligenceRouter.get(
  "/options",
  asyncHandler(async (req, res) => {
    const admin = requireAuth(req).role === "SUPER_ADMIN";
    const checkpoints = await prisma.checkpoint.findMany({
      where: {
        isActive: true,
        city: { isActive: true },
        OR: [{ institutionId: null }, { institution: { isActive: true } }],
      },
      select: { id: true, name: true, institutionId: true },
      orderBy: { name: "asc" },
      take: 500,
    });
    const kitchens = admin
      ? await prisma.kitchen.findMany({
          where: { isActive: true, deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
          take: 500,
        })
      : [];
    const userId = requireAuth(req).userId;
    const buyer = ["CUSTOMER", "PARENT", "STUDENT"].includes(
      requireAuth(req).role,
    );
    const orders = buyer
      ? await prisma.order.findMany({
          where: { customerId: userId },
          select: { id: true, orderNumber: true },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
      : [];
    const subscriptions = buyer
      ? await prisma.subscription.findMany({
          where: { userId },
          select: {
            id: true,
            meal: { select: { name: true } },
            checkpoint: { select: { name: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
      : [];
    return ok(res, {
      checkpoints,
      kitchens,
      orders,
      subscriptions: subscriptions.map((s) => ({
        id: s.id,
        label: s.meal.name + " · " + s.checkpoint.name,
      })),
    });
  }),
);
intelligenceRouter.get(
  "/recommendations",
  authorizeBuyer(),
  validateQuery(recommendationQuerySchema),
  asyncHandler(async (req, res) =>
    ok(res, await recommend(requireAuth(req).userId, req.query as never)),
  ),
);
intelligenceRouter.post(
  "/support",
  authorizeBuyer(),
  validateBody(supportQuestionSchema),
  asyncHandler(async (req, res) =>
    ok(res, await answerQuestion(requireAuth(req).userId, req.body)),
  ),
);
intelligenceRouter.get(
  "/demand",
  authorizeAdmin(),
  validateQuery(demandQuerySchema),
  asyncHandler(async (req, res) => ok(res, await forecast(req.query as never))),
);
intelligenceRouter.post(
  "/routes",
  authorizeAdmin(),
  validateBody(routeSuggestionSchema),
  asyncHandler(async (req, res) => ok(res, await suggestRoutes(req.body))),
);
