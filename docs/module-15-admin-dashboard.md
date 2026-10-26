# Module 15 — Super Admin Dashboard

The central console is `/admin`. It links to searchable, paginated lists and details for users, vendors, kitchens, meals, orders, subscriptions, checkpoints, time slots, delivery partners, routes, payments, refunds, and complaints. Existing route planning, vendor onboarding and checkpoint editing remain available. `/admin/audit` provides searchable administrative history. Customers submit and track complaints at `/support`.

## Metrics

The dashboard defaults to today's date in Asia/Kolkata and supports historical dates. Orders count distinct orders with a non-cancelled meal scheduled on the selected date; meals sum their quantities, including meals awaiting payment. Pending and failed deliveries use the scheduled meal date. Active account, subscription, kitchen and partner counts describe the current state, independent of the date picker.

Revenue is verified captured collections minus processed refunds during the selected India calendar day. Refunds are counted on their processing date, which may differ from payment date. Amounts remain decimal values and currencies are shown separately. Unverified, failed and merely authorized payments are excluded. This is a collections report, not an accounting revenue-recognition ledger.

## Controls and authorization

Every console endpoint requires an authenticated, active SUPER_ADMIN; hiding navigation is not the authorization boundary. List and detail responses use fixed field projections and never include password hashes, OTP secrets, tokens or raw payment provider payloads. Lists return 25 records per page with search, status, date and relevant city/role/availability filters. Date filters mean scheduled service date for orders/routes, start or end date for subscriptions, payment/refund date for financial records, and creation date for other resources.

Supported actions depend on the resource and current state: user suspension/reactivation/deactivation, vendor approval/rejection/suspension, operational activation/deactivation, subscription pause/resume/cancel, refunds, and complaint review/resolution/reopening. Orders and route lifecycle changes remain in their dedicated business workflows. There is no manual payment-success or order-confirmation shortcut.

Actions require a reason and expected status. Complaint updates additionally require a revision. State changes and audit records commit together; stale updates return conflicts. Account suspension revokes sessions. Self-suspension and removing the last active super admin are blocked. Kitchen deactivation is blocked while meals remain outstanding; partner deactivation is blocked while deliveries remain assigned. Subscription controls retain existing fulfilment and refund restrictions. Refunds use the existing provider abstraction and idempotency keys.

Audit entries retain actor, action, entity, previous/new state, reason, timestamp and request context. The audit viewer is read-only. Complaints are customer-scoped, support optional owned-order links, and use request keys to prevent duplicate creation. Support responses are visible to their owner.

## API and migration

- `GET /api/v1/admin/dashboard?date=YYYY-MM-DD`
- `GET /api/v1/admin/options`
- `GET /api/v1/admin/manage/:resource`
- `GET /api/v1/admin/manage/:resource/:id`
- `POST /api/v1/admin/manage/:resource/:id/actions`
- `GET /api/v1/admin/audit`
- `GET/POST /api/v1/complaints`

Apply migration `20261024150000_admin_dashboard` with `npm run db:deploy -w @lunch/api`; regenerate Prisma as part of the API build. No new credentials are required. Existing payment and notification environment settings continue to apply.

Integration tests exercise all 13 resource projections, access denial, filters, details, complaint ownership/idempotency/revision conflicts, suspension and audit trails, kitchen guards, forbidden manual confirmation, distinct order/quantity counts, and timezone/currency/verification boundaries for collections.
