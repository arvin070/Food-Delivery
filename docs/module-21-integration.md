# Module 21 — Full system integration

The existing modular monolith remains intact: Next.js clients call the versioned
Express API; Prisma/PostgreSQL owns domain state. Payment providers, notification
transports and intelligence services remain separate from the core ordering flow.
See [architecture](architecture.md) and the [security pass](security/audit-2026-10-25.md).

## Integration fixes

- **One order status:** removed conflicting customer-side roll-up logic and moved
  fulfilment synchronization out of the vendor module into `orders/order-state.ts`.
  Customer detail/history/filtering and admin records now use the persisted status.
  Mixed completed/cancelled/failed items become `PARTIALLY_FULFILLED`; a failed
  handoff cannot prevent delivery of the remaining funded items.
- **Corporate funding reaches operations:** kitchen dashboards and packing lists
  now recognize validated company credit authorizations as well as captured
  provider payments. Released or inconsistent credits are excluded. Existing
  payment policy still gates preparation and handoff.
- **Cancelled items:** a customer can cancel remaining unprepared items after a
  vendor cancels one line. Inventory is released only for newly cancelled lines.
  An unpaid partially cancelled order stays unpaid and cannot be charged its old
  full total; cancel/reorder rather than inventing a new settlement policy.
- **Time alignment:** catalog, cart, checkout and cancellation use city-local
  delivery instants, matching subscriptions and payment verification. A 12:30
  India lunch closes at the correct instant rather than 12:30 UTC. Kitchen
  availability is grouped by kitchen AND time slot.
- **Vendor summary:** unpaid items no longer count as preparation work or revenue;
  assigned, picked-up and at-checkpoint items no longer disappear from revenue.
- **Admin checkpoints:** corrected the paginated API response handling that caused
  the page to crash when reading `meta.total`.
- **Catalog state:** dependent filters are disabled while URL navigation settles,
  preventing a fast date change from discarding a checkpoint selection.
- **Interrupted checkout:** retains a cart-scoped idempotency key in session
  storage. A browser reload after a lost response offers recovery of the original
  order. Quantity/removal controls cannot race an unresolved checkout. No payment
  or session credentials are stored in browser storage.
- **Existing database state:** a dry-run-first maintenance command processes at
  most 100 orders per invocation. It rechecks each order under its fulfilment lock,
  repairs only the roll-up, and writes an audit entry. It does not resurrect
  cancelled/refunded orders or replay historical delivery notifications. The local
  database was reconciled and verified clean.
- **Compatibility and presentation:** duplicate order history/checkout route
  handlers share canonical implementations; existing URLs continue working.
  Status badges normalize case and cover payment and delivery states.
- **Complaint integration:** the end-to-end test now sends the required optimistic
  revision read from the admin record, preserving stale-write protection.

## Module connections reviewed

| Modules / capability | Integrated dependency |
| --- | --- |
| Authentication, profiles, parent/child | Current session + role checks; beneficiary ownership carried into cart and order snapshots |
| Vendor, meals, menu, checkpoints/windows | Published meal schedules and active service areas feed catalog and capacity checks |
| Cart/orders | Transactional checkout, stock/window/kitchen capacity locks, canonical order items |
| 9 subscriptions | Bounded generation into the same orders; pause, skip, cancel, holiday and availability tests |
| 10 payments | Server-verified capture, callback/refund idempotency, reconciliation, receipts |
| 11 kitchen | Funded order items, preparation groups, packing checklist, scoped updates |
| 12–13 delivery/routes | Packed batches, assigned rider, ordered checkpoints, pickup/arrival, OTP and failure |
| 14 notifications | Transactional events and durable outbox; parent confirmation uses beneficiary/checkpoint snapshots |
| 15 administration | Scoped management APIs, expected-status/revision controls, audit records |
| 16 institutions | Institutional checkpoints/windows and registrations feed customer selection |
| 17 corporate | Approved credits/co-payments use ordinary kitchen and delivery operations |
| 18 analytics | Read-only aggregates of persisted orders, payments, kitchens and deliveries |
| 19 intelligence | Independent readers of scoped backend data; no fabricated order/payment status |
| 20 security/testing | Session revocation, ownership/role denial, OTP races, CSRF and provider-boundary regressions retained |

## Verification

Verified on 26 October 2026 against local PostgreSQL and production-built Next.js:

| Gate | Executed result |
| --- | --- |
| `npm test` | **446 passed**, 26 suites |
| `npm run test:browser` | **13 passed**: 5 integration/navigation + 8 security checks |
| Production build | Shared package, API and Next.js passed; API rebuilt after maintenance addition |
| `npm run typecheck` | All workspaces passed |
| `npm run db:verify` | All **19 migrations** replayed; fresh and application schemas match Prisma |
| Production configuration checks | **4 passed** |
| Local persisted-status reconciliation | 284 orders examined; **180 repaired** with audit entries; repeat scan **0 mismatches** |
| `git diff --check` | Passed |

The browser suites start separate dedicated servers sequentially. This keeps
credential/global rate-limit budgets independent while retaining live rate
limiting for the security checks; production limits were not weakened for tests.
Tests and builds that initially failed were corrected and rerun. The counts above
refer to the completed passing runs, not the interrupted or failed attempts.

The API integration suite exercises successful and failed payment, cancelled
checkout, refunds, wrong OTP, failed delivery, complaint resolution, partial
fulfilment, provider acceptance followed by a lost response, and idempotent retry.
It compares customer detail/list filtering, vendor items, admin records and
persisted state, plus kitchen lists and rider/route outcomes where applicable.

The Chromium integration test uses four separate authenticated personas and a
390-pixel mobile rider viewport. It adds a child, selects an institution/date/
checkpoint/window/meal, checks out with a deliberately lost response and page
reload, pays using the development provider, prepares/packs through the kitchen
UI, assigns a route through admin, and completes rider pickup/arrival/OTP handoff.
Infrastructure/menu fixtures are inserted through Prisma; business lifecycle
transitions use the UI. External payment and notification networks are not real.

Migration verification creates a disposable local database, applies the full
chain, compares it to the Prisma schema, checks the application database for
schema drift, and drops only the disposable database. No application reset or
schema push is used.

## Repeatable gate

Use the seeded local development database. Never point these tests at production.
Run database-writing suites sequentially; older feature suites clean shared test
fixtures and must not overlap browser/API runs.

```sh
npm ci
npm run db:start
npm run db:verify
npm run test:integration
npm test
npm run build
npm run typecheck
npx playwright install chromium
npm run test:browser
node scripts/security-runtime-checks.mjs
```

For an existing database, after building the API:

```sh
npm run db:reconcile-order-status
npm run db:reconcile-order-status -- --apply
# Continue explicitly with --after <nextCursor> until nextCursor is null.
```

The first command is a dry run. Review each batch before applying it in a deployed
environment; it modifies persisted status and records an audit entry. New databases
do not require this data repair. No schema migration was added by Module 21.

## Remaining blockers and boundaries

- **Live payment acceptance:** real provider credentials, settlement/refund checks
  and actual signed incoming webhooks require provider-side integration testing.
  Local tests use real database operations with mock external providers.
- **External notification delivery:** parent confirmation is verified in-app.
  Push/email/SMS/WhatsApp delivery requires configured adapters/credentials and
  delivery testing. Production account reset/verification still needs a real
  notifier transport; its current unconfigured implementation is not operational.
- **Production operations:** TLS/ingress, least-privilege database access, backups,
  secrets, monitoring and deployment configuration have not been verified here.
  Multiple replicas need shared rate-limit counters or equivalent gateway limits.
- **Explicit product boundaries retained:** recurring automatic charging, advanced
  route optimization and an LLM support provider are not enabled. Subscription
  orders are paid separately; intelligence uses independent deterministic/statistical
  services and verified application data.
- **Refresh model:** successful actions refresh their current screen. Changes by
  another persona appear on refresh/reload; there is no realtime dashboard push.
  Expired web access sessions can require signing in again; automatic browser
  session renewal is not claimed by this module.
- **Other environments:** the local data repair is complete. Existing deployed
  databases must run the bounded reconciliation after rollout; production data
  was not accessed by this pass.
