# Module 9: Meal subscriptions

Choose a meal and checkpoint in the catalog, then use **Set up a meal plan**.
The subscription retains the meal, kitchen, child (or self), checkpoint, delivery
slot, quantity and agreed per-meal price. Manage it from **Subscriptions**.
Ordinary one-time checkout remains available through the cart; the plan form also
supports a one-date plan.

## Plan semantics

- One-time: start date only.
- Daily: every day, optionally ending on an inclusive end date.
- Weekly: seven consecutive calendar dates, including the start date.
- Monthly: from the start date until the next calendar-month anniversary
  (exclusive). Anniversaries clamp to the last day of a shorter month.
- Monday–Friday: ISO weekdays 1–5, optionally ending on an inclusive end date.
- Custom: chosen ISO weekdays 1–7, optionally ending on an inclusive end date.

Weekly/monthly describe the service term, not a billing cycle. Holidays and
unavailable dates do not extend the term. Open-ended plans continue until cancelled.

## Generation and operational safety

The API starts a worker on startup. Every minute it scans at most **50 active
subscriptions**, each over **today through today + 6 days**, using the checkpoint
city's timezone. An in-memory cursor advances through the active subscriptions;
after the last batch it starts a new sweep. One process never overlaps its own
batches. Multiple replicas and restart-driven rescans are safe. A failed plan is
logged and retried on a later sweep without blocking all other plans.

Creation and resume also attempt this bounded window immediately. Customers can
retry using **Book upcoming meals**. No client can expand the horizon. Dates
outside a plan, past dates, pauses, skips, global/city holidays, unavailable meals,
closed cutoffs and inactive beneficiaries are excluded. Missing schedules or full
capacity are retried on later sweeps; the generator does not advance an exclusive
watermark that would permanently lose those dates.

Each occurrence runs in a serializable transaction. Subscription, schedule,
checkpoint window and kitchen locks plus transactional capacity counts protect
reservations against other generators and ordinary checkout. The database enforces
unique `(subscriptionId, serviceDate)` and order idempotency keys. Stock reservation,
order creation and subscription progress commit together. Serialization/deadlock
failures retry the whole transaction at most three times. Infrastructure errors are
logged rather than treated as sold-out dates.

Pause, skip and cancel release eligible future stock and mark the generated orders
cancelled in the same transaction. Meals in preparation or past their delivery start
cannot be stopped online. Paid/authorized meals require a refund workflow before
cancellation; this module does not silently cancel a paid obligation. Resume
revalidates availability and capacity and restores the **same** paused order/item;
it does not create another order for that date. Explicitly skipped or individually
cancelled orders are never restored. Ended active plans become expired. Event and
order history remain queryable, including cancellations.

## HTTP endpoints

All customer routes require an authenticated CUSTOMER, PARENT or STUDENT and enforce
ownership. Lists/history use 20-row pages (`?page=...`).

- `GET /api/v1/subscriptions`
- `POST /api/v1/subscriptions`: `mealScheduleId`, `checkpointId`, optional `childId`,
  `plan`, `startDate`, optional `endDate`, `daysOfWeek` for custom plans, `quantity`,
  and a client-generated `idempotencyKey`.
- `GET /api/v1/subscriptions/:id`: plan, booked upcoming meals, order history,
  event history and skipped dates in the next month.
- `POST /api/v1/subscriptions/:id/actions`: `{ action: "PAUSE" | "RESUME" | "SKIP" | "CANCEL", date?: "YYYY-MM-DD" }`.
- `POST /api/v1/subscriptions/:id/generate`: results for the fixed seven-day window.
- `GET /api/v1/admin/holidays` and `POST /api/v1/admin/holidays`: SUPER_ADMIN only.
  Creation accepts `{ date, name, cityId? }`; omit cityId for a global closure.
  It cancels affected eligible recurring orders atomically and records an audit
  event. If any affected order needs a refund or operational intervention, the
  holiday change is rejected in full. More than 500 affected booked meals also
  requires operations handling. These holiday rules cover recurring orders.

## Billing integration boundary

Subscriptions record `billingMode = PER_ORDER`, optional `billingProvider` and
`billingReference`, and their agreed `pricePerMeal`. Generated orders contain price
snapshots and an ordinary CREATED payment record; **no automatic charge or paid
status is fabricated**. Future recurring billing can attach a provider agreement,
authorize a billing period, and reconcile webhook events to these orders. Provider
webhooks must have their own idempotency and authorization checks. Billing periods,
mandates, proration, refunds and failed-payment policy are intentionally not activated
by this module. They must gate fulfilment appropriately when introduced.

## Deployment and checks

Apply `20261023120000_meal_subscriptions` with the existing Prisma migration deploy
command, regenerate the Prisma client, and restart the API to start the worker.
For very large installations the same `generateBatch(cursor)` can be invoked by a
dedicated worker; preserve the bounded batch and DB constraints.

`npm run test -w @lunch/api -- tests/subscriptions.test.ts tests/orders.test.ts`
exercises the real PostgreSQL constraints, concurrent generation, capacity,
lifecycle, timezone cutoffs, holidays, ownership, billing guards and checkout.
