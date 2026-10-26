# Module 12 — Delivery partner application

## Using the app

Open /delivery-login and sign in with an administrator-provisioned DELIVERY_PARTNER account. Existing /login also routes partners to /delivery. Local seed account: rider@lunch.test, with the development seed password documented in the project setup.

The mobile dashboard shows today's assigned routes in each kitchen's city timezone, delivery counts, quantities of meals, delivered/failed counts, and ordered checkpoints. Availability controls new assignments; going unavailable does not hide existing work. Refresh assignments fetches the latest dashboard.

1. Confirm meal pickup at the kitchen.
2. Start the route.
3. Open the next checkpoint and mark arrival.
4. Enter the receiver name and the customer's six-digit delivery code.
5. Verify and mark delivered, or record a specific failure reason.

Each checkpoint includes public location details and delivery instructions. Delivery cards show beneficiary name, meal and quantity, and order reference. They omit phone numbers, email, customer/child IDs, payment details, and OTP secrets. Checkpoint deliveries are paginated, 50 per page.

Customers open their order and select **Get delivery code** on the delivery date. The code is returned only to the authenticated order owner, with a no-store response. Share it with the partner only at handoff. A replacement invalidates the old code.

## API

All paths below are under /api/v1.

- POST /auth/login: existing authentication, active partner role required for partner operations.
- GET /delivery/dashboard: today's own routes, stops and counts.
- PATCH /delivery/availability: { isAvailable: boolean }.
- GET /delivery/routes/:routeId/stops/:stopId?page=1: own checkpoint and delivery details.
- POST /delivery/routes/:routeId/pickup: ASSIGNED → PICKED_UP.
- POST /delivery/routes/:routeId/start: PICKED_UP → OUT_FOR_DELIVERY.
- POST /delivery/routes/:routeId/stops/:stopId/arrive: OUT_FOR_DELIVERY → AT_CHECKPOINT.
- PATCH /delivery/items/:deliveryId/status: DELIVERED with receiverName and otp; or FAILED with failureReason.
- POST /orders/:orderId/items/:orderItemId/delivery-code: buyer-owned code generation.
- POST /delivery/items/:orderItemId/assign: SUPER_ADMIN only; requires an active, available partner, a packed item, and verified payment.
- GET /delivery/items: compatibility endpoint; latest 100 own assignments. Use dashboard/checkpoint endpoints for normal operations.

Routes group one partner's kitchen/date/time-slot assignments; checkpoints become ordered stops. Assignment retries reuse the same delivery. New assignments cannot be added once a route starts or closes. Previous checkpoints must finish before arrival at the next. Failed delivery is an explicit terminal exception from any active delivery phase. All-terminal stops and routes close even when some deliveries failed.

## Integrity and security

Ownership is checked on every read and action using the authenticated active partner, not a partner ID supplied by the caller. Admin assignment does not grant an OTP bypass. Customer ownership is checked separately for code issuance.

Serializable transactions with bounded retries protect concurrent assignment and status changes. Route row locks serialize workflow updates. Repeated successful actions return without repeating handoffs or resetting timestamps. Route, delivery and order item/order states update atomically. Pickup, departure, arrival, verification, completion and failure timestamps are persisted.

OTP values use a delivery-bound keyed HMAC, not plaintext or an unkeyed hash. Production requires DELIVERY_OTP_SECRET (at least 32 random characters); development can fall back to the existing JWT signing secret. DELIVERY_OTP_TTL_MINUTES defaults to 30; DELIVERY_OTP_MAX_ATTEMPTS defaults to 5. Incorrect attempts are committed before returning an error. Expired or locked codes cannot verify. Owners can replace codes after a 60-second cooldown. Completed/failed deliveries clear the stored code. No SMS provider is required: code delivery is through the authenticated customer order page.

This module does not provide GPS tracking, automatic route optimization, push notifications, or automatic refunds for failed delivery. Existing billing workflows handle refunds separately.

## Database and deployment

Run the normal Prisma migrate deploy command. Module 12 migrations add pickup states and timestamps, backfill legacy per-item assignments into routes/stops, and preserve mixed legacy workflow progress. Mixed legacy routes require pickup/start for remaining assigned meals; already progressed deliveries retain their status.

Set DELIVERY_OTP_SECRET before production startup. Partner accounts and delivery assignments are managed through the existing administration/provisioning flow and the admin assignment endpoint.

## Validation

Integration coverage includes login/role checks, assignment replay, route sequencing, availability, meal quantities, cross-partner read/write rejection, privacy of response fields, owner-only code issuance, regeneration cooldown, expired codes, five-attempt lockout, committed incorrect attempts, successful/repeated verification, terminal-state rejection, and failed delivery/route completion. All 309 API tests and the production build passed.
