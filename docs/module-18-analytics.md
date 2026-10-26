# Module 18 — Analytics and reporting

Open **Admin → Analytics** at `/admin/analytics`. The dashboard includes summary cards, daily/weekly order charts, a daily net-collections chart with currency selection, popular meals/checkpoints, kitchen preparation statistics and delivery partner performance. Charts include exact-value tables. Empty ranges show zero counts and unavailable rates rather than misleading percentages.

## Access and endpoint

`GET /api/v1/admin/analytics?from=2026-10-01&to=2026-10-25`

Both the page and API require an authenticated, active SUPER_ADMIN. Other roles, including institution and corporate administrators, cannot access platform-wide reporting. Responses use `Cache-Control: private, no-store`. Only aggregated operational data and partner display names are returned; customer identities, beneficiary details, contact information, payment references and delivery codes are excluded.

Both dates are inclusive and must be supplied together. The default is the last 30 days through today in Asia/Kolkata. Invalid, reversed and over-366-day ranges are rejected. Reports run in a repeatable-read database transaction, with date-limited queries, a 30-second timeout, top-10 popularity lists and top-50 performance tables. Summary totals are not limited to those rankings. Date indexes support placement, creation fallback, scheduled meals, payments, refunds and corporate settlements.

## Definitions

- Orders per day/week: orders placed in the selected range; creation time is the fallback when placement is absent. Weeks start Monday and include only selected dates at the boundaries. Calendar placement and collection dates use Asia/Kolkata.
- Active customers: distinct customers with non-cancelled/non-refunded orders placed in range, including unpaid bookings.
- Active subscriptions: currently ACTIVE subscriptions whose start/end dates overlap the selected range. This is explicitly a current-state snapshot, not historical subscription reconstruction.
- Average order value: non-cancelled/non-refunded order totals plus corporate contributions, divided by qualifying orders, separately by currency. Unpaid bookings are included.
- Cancellation rate: orders currently CANCELLED or REFUNDED divided by all orders placed in range. Later changes to order status affect previous placement cohorts.
- Revenue: provider payments with successful verified status, grouped by capture date, plus verified corporate invoice settlements by settlement date, minus processed refunds by processing date. This is cash collections, not accrual accounting. Unverified/failed payments and unsettled invoices are excluded. Currency totals are never combined. Refund-only days can have negative net revenue.
- Popularity and kitchen performance: non-cancelled item quantities scheduled for the selected service dates, including unpaid demand. Order counts are distinct. Preparation duration averages valid preparing-to-packed timestamps per item line.
- Delivery performance: delivery records on non-cancelled items scheduled in range. Failed delivery rate is failed / (delivered + failed); pending records are excluded. On-time rate is on-time / delivered records with timestamps. Missing timestamps are reported as timing coverage, not assumed punctual.
- On-time deadline: the end of the checkpoint's time slot in its city's time zone. Historical slot edits can change past comparisons: the current schema does not snapshot the delivery deadline. Zero eligible observations produce null rates, displayed as a dash.

## Validation and deployment

Apply `npm run db:deploy -w @lunch/api` to install the analytics indexes. No credentials or notification/payment provider changes are required.

`apps/api/tests/analytics.test.ts` exercises role restrictions, inclusive boundaries, creation fallback, distinct order counting, corporate-funded order value, verified collections, processed refunds, currency separation, local-time delivery deadlines, missing timestamps, rankings, preparation durations, empty reports and date validation against PostgreSQL.
