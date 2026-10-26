import type { SupportAnswer, SupportQuestion } from "@lunch/shared";
import { prisma } from "../../core/prisma";
import { notFound } from "../../core/errors";
import {
  cityToday,
  addDays,
  dateKey,
  occursOn,
  slotInstant,
} from "../subscriptions/recurrence";
import { recommend } from "./recommendation.service";
export function classify(question: string): SupportAnswer["intent"] {
  const q = question.toLowerCase();
  const matches = [
    /payment|paid|refund|charged/.test(q) ? "PAYMENT" : null,
    /skip/.test(q) ? "SKIP" : null,
    /available|recommend|menu/.test(q) ? "MEALS" : null,
    /where|track|delivery|delivered|order status/.test(q) ? "ORDER" : null,
  ].filter(Boolean);
  return matches.length === 1
    ? (matches[0] as SupportAnswer["intent"])
    : "UNKNOWN";
}
export async function answerQuestion(
  userId: string,
  input: SupportQuestion,
): Promise<SupportAnswer> {
  const intent = classify(input.question);
  const result: SupportAnswer = {
    intent,
    answer:
      "I can check order status, payment status, subscription skips, or available meals. Please ask about one of these at a time.",
    asOf: new Date().toISOString(),
    sources: [],
    facts: [],
    changed: false,
  };
  // Explicit identifiers are always ownership checked, even if the requested intent differs.
  if (
    input.orderId &&
    !(await prisma.order.findFirst({
      where: { id: input.orderId, customerId: userId },
      select: { id: true },
    }))
  )
    throw notFound("Order");
  if (
    input.subscriptionId &&
    !(await prisma.subscription.findFirst({
      where: { id: input.subscriptionId, userId },
      select: { id: true },
    }))
  )
    throw notFound("Subscription");
  if (intent === "ORDER" || intent === "PAYMENT") {
    const orders = await prisma.order.findMany({
      where: {
        customerId: userId,
        ...(input.orderId ? { id: input.orderId } : {}),
      },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        items: {
          take: 20,
          orderBy: { serviceDate: "desc" },
          select: {
            status: true,
            serviceDate: true,
            mealNameSnapshot: true,
            checkpoint: { select: { name: true } },
            delivery: {
              select: { status: true, deliveredAt: true, arrivedAt: true },
            },
          },
        },
        payments: {
          take: 1,
          orderBy: { createdAt: "desc" },
          select: { status: true, lastVerifiedAt: true, updatedAt: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: input.orderId ? 1 : 6,
    });
    if (!orders.length) {
      result.answer = "No orders were found for your account.";
      return result;
    }
    if (!input.orderId && orders.length > 1) {
      result.answer =
        "You have multiple orders. Choose an order to check; I will not assume which lunch or payment you mean.";
      result.sources = orders.map((o) => ({
        label: o.orderNumber,
        href: "/orders/" + o.id,
      }));
      result.facts = orders.map((o) => ({ label: o.orderNumber, value: o.id }));
      return result;
    }
    const order = orders[0]!;
    result.sources = [
      { label: order.orderNumber, href: "/orders/" + order.id },
    ];
    if (intent === "ORDER") {
      result.answer =
        "Here is the latest recorded status from Lunch (up to 20 meal lines). No live location or arrival estimate is available from these records.";
      result.facts = [
        { label: "Order " + order.orderNumber, value: order.status },
        ...order.items.map((i) => ({
          label:
            dateKey(i.serviceDate) +
            " · " +
            i.mealNameSnapshot +
            " · " +
            i.checkpoint.name,
          value: i.delivery
            ? i.delivery.status +
              (i.delivery.deliveredAt
                ? " · Delivered " + i.delivery.deliveredAt.toISOString()
                : "")
            : i.status,
        })),
      ];
    } else {
      const payment = order.payments[0];
      if (!payment)
        result.answer = "No payment attempt is recorded for this order.";
      else if (!payment.lastVerifiedAt) {
        result.answer =
          "This payment has not been verified with the provider. I cannot confirm whether it succeeded or failed. Open Payments to check its status.";
        result.facts = [
          { label: "Recorded state (unverified)", value: payment.status },
        ];
      } else {
        result.answer =
          payment.status === "FAILED"
            ? "The backend records a verified failed payment. A reliable failure explanation is not available to this assistant; I cannot determine the bank’s reason. Open Payments or contact support."
            : "Here is the latest verified payment state recorded by the backend. This is not a new provider verification.";
        result.facts = [
          { label: "Payment status", value: payment.status },
          {
            label: "Last verified",
            value: payment.lastVerifiedAt.toISOString(),
          },
        ];
      }
      result.sources.push({ label: "Payments", href: "/payments" });
    }
    return result;
  }
  if (intent === "SKIP") {
    if (!input.date && !/\btomorrow\b/i.test(input.question)) {
      result.answer =
        "Please specify a skip date, or ask about tomorrow. You can select a date in Subscriptions.";
      result.sources = [
        { label: "Manage subscriptions", href: "/subscriptions" },
      ];
      return result;
    }
    const subs = await prisma.subscription.findMany({
      where: {
        userId,
        ...(input.subscriptionId
          ? { id: input.subscriptionId }
          : { status: { in: ["ACTIVE", "PAUSED"] } }),
      },
      include: {
        checkpoint: { include: { city: true } },
        timeSlot: true,
        meal: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 21,
    });
    result.sources = [
      { label: "Manage subscriptions", href: "/subscriptions" },
    ];
    if (!subs.length) {
      result.answer = "No matching subscription was found for your account.";
      return result;
    }
    if (subs.length > 1 && !input.subscriptionId) {
      result.answer = "Choose a subscription before I check a skip date.";
      result.facts = subs
        .slice(0, 20)
        .map((s) => ({
          label: s.meal.name + " · " + s.checkpoint.name,
          value: s.id,
        }));
      return result;
    }
    const sub = subs[0]!;
    const date =
      input.date ??
      dateKey(addDays(cityToday(sub.checkpoint.city.timezone), 1));
    const target = new Date(date);
    result.facts = [
      { label: "Subscription", value: sub.meal.name + " · " + sub.status },
      { label: "Requested date", value: date },
    ];
    if (
      ["CANCELLED", "EXPIRED"].includes(sub.status) ||
      target < cityToday(sub.checkpoint.city.timezone) ||
      !occursOn(sub, target)
    ) {
      result.answer = "This date is not eligible for a skip on this plan.";
      return result;
    }
    if (
      await prisma.subscriptionSkip.findUnique({
        where: {
          subscriptionId_serviceDate: {
            subscriptionId: sub.id,
            serviceDate: target,
          },
        },
      })
    ) {
      result.answer = "This date is already skipped.";
      return result;
    }
    const items = await prisma.orderItem.findMany({
      where: {
        subscriptionId: sub.id,
        serviceDate: target,
        status: { notIn: ["CANCELLED", "FAILED", "DELIVERED"] },
      },
      select: {
        status: true,
        order: {
          select: {
            payments: {
              where: {
                status: { in: ["PAID", "AUTHORIZED", "PARTIALLY_REFUNDED"] },
              },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
    });
    const blocked = items.some(
      (i) =>
        !["PENDING", "CONFIRMED"].includes(i.status) ||
        i.order.payments.length ||
        slotInstant(
          target,
          sub.timeSlot.startMinute,
          sub.checkpoint.city.timezone,
        ) <= new Date(),
    );
    result.answer = blocked
      ? "This date has a paid meal or a meal already in fulfilment. Contact support before changing it."
      : sub.status === "PAUSED"
        ? "This plan is paused. You can still record a skip for this date in Subscriptions; no new meals are currently generated."
        : "Based on the current records, you can request this skip in Subscriptions. The subscription service will recheck eligibility when you submit it. Nothing has been changed.";
    return result;
  }
  if (intent === "MEALS") {
    if (!input.checkpointId || !input.date) {
      result.answer =
        "Choose a checkpoint and delivery date so I can check available meals.";
      return result;
    }
    const meals = await recommend(userId, {
      checkpointId: input.checkpointId,
      date: input.date,
    });
    result.answer = meals.meals.length
      ? "These meals currently match your profile and delivery selection. Availability is rechecked at checkout."
      : "No matching meals are currently available for this selection.";
    result.facts = meals.meals.map((m) => ({
      label: m.name + " · " + m.slot,
      value: m.remaining + " available",
    }));
    result.sources = [{ label: "Browse meals", href: "/meals" }];
    return result;
  }
  return result;
}
