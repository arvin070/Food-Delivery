# Module 10: Payment and billing

Customers pay from an order's detail page and use **Payments** for status, payment
attempt history, refunds and printable receipts. One-time and subscription orders
start as `AWAITING_PAYMENT`. The server alone changes them and their pending meal
items to `CONFIRMED`, after verifying a captured payment. Authorization is not
sufficient. Vendor single/bulk transitions and delivery assignment also enforce
verified payment, so another endpoint cannot bypass the payment requirement.

## Provider boundary

`modules/payments/providers/provider.ts` defines creation, lookup/recovery, payment
fetching, callback and webhook authentication, and refunds. `RazorpayProvider` uses
server-authenticated HTTPS requests. `MockProvider` has a separate durable test
ledger and is disabled in production. The order engine knows only the local
verified-payment policy; it contains no Razorpay calls or credentials.

UPI, cards, net banking and provider wallets are selected in Razorpay Standard
Checkout, subject to merchant-account availability. There is no card form in Lunch.
The browser loads the provider checkout and returns only payment identifiers and a
signature. The backend rejects extra payment input fields. Provider responses are
normalized to allowlisted identifiers, amounts, currency, status and method. Raw
card details, CVV, bank details, UPI identifiers and raw webhook/provider payloads
are neither stored nor logged. Existing `rawPayload` schema fields are left unused.
Internal stored-value wallet debits and recurring mandates are not enabled.

## Configuration

Set these on the API server (see `.env.example`):

```dotenv
PAYMENT_PROVIDER=razorpay
RAZORPAY_KEY_ID=your_test_or_live_key_id
RAZORPAY_KEY_SECRET=your_secret
RAZORPAY_WEBHOOK_SECRET=your_distinct_webhook_secret
```

All three Razorpay variables are required when that adapter is selected. Only the
public key id reaches the browser. Configure automatic capture in the provider
account; authorized payments remain unconfirmed until the provider reports capture.
Changing `PAYMENT_PROVIDER` affects new payment sessions. Existing sessions retain
their provider so their verification and refunds continue through the original
adapter; retain the associated credentials until reconciliation is complete.

For local development use `PAYMENT_PROVIDER=mock`. An optional
`MOCK_PAYMENT_WEBHOOK_SECRET` signs development webhooks. The checkout page exposes
clearly labelled success/failure/cancellation simulation controls only for mock
sessions. Production startup rejects mock mode, and mock operations independently
guard against production use.

Register the HTTPS API endpoint:

`POST /api/v1/payments/webhooks/razorpay`

Subscribe to `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`,
`refund.created`, `refund.processed` and `refund.failed`. The route receives the exact
raw bytes before JSON middleware and verifies `X-Razorpay-Signature` with HMAC-SHA256
and a constant-time comparison. It then fetches current provider state; even a valid
signature is not treated as a substitute for checking the payment. Configure the
API URL directly or use the web app's byte-preserving `/api/v1/...` proxy.

## Idempotency and failure policy

- Creation locks the local order and reuses its payment/session. Totals come from
  the database, never the client. The provider reference is unique.
- A durable initialization marker is committed before calling the provider. An
  ambiguous timeout never causes another create call: recovery searches by the
  unique local payment id sent as the provider receipt. If no order can be found,
  the payment remains blocked for operator reconciliation. This favors avoiding a
  second charge over silently issuing a replacement checkout. After a confirmed
  provider rejection with no remote order, an operator may clear that marker only
  after verifying absence with the provider; there is no customer bypass.
- Browser callbacks require the provider signature generated using the stored
  order id. The backend fetches payment state and checks provider order, exact
  amount and currency. Capture commits payment status, an immutable receipt and
  order confirmation together in a serializable transaction.
- Webhook payload digests are unique. Duplicate callbacks and concurrent requests
  are safe even if a process stops before recording webhook completion. An old
  failure cannot overwrite a verified capture, and old capture data cannot roll
  back a completed refund. Payment attempts are kept separately from the current
  payment state.
- Failed payments remain retryable using the same provider order. Dismissing
  checkout triggers a provider status refresh, never an invented success or
  provider cancellation. Cancelled provider payments remain unconfirmed.
- A capture arriving after local cancellation is recorded as paid but does not
  reopen the order. If delivery has already started, the order is cancelled and
  eligible stock is released. These paid cancelled orders expose a refund action.
- Every minute, a non-overlapping worker reconciles at most 20 unresolved payments
  and 20 pending refunds. It rotates by verification/update time; restarts and
  multiple replicas are safe. Webhooks remain the primary low-latency mechanism.

## Refunds and receipts

Cancel an eligible order, then request its remaining refundable balance from
Payments. Admins may issue partial refunds using the admin endpoint. Refunds are
restricted to cancelled/failed orders; in-preparation cancellation still requires
operations. Subscription changes continue to reject automatic cancellation of paid
meals: cancel/refund the individual orders first before changing that plan.

A refund row reserves the amount before any provider request. Pending and completed
refunds cannot overrun the captured balance, including refunds reported by the
provider. The same local refund id is sent as `X-Refund-Idempotency` on every retry.
Timeouts remain pending instead of freeing the balance for another refund. Only a
provider-confirmed processed refund changes refunded totals; definitive failures
are visible and may be retried with a new request key. Receipts retain original
payment and meal snapshots and display current refund status separately.

The printable document is a **payment receipt**, not a GST tax invoice. Merchant
legal details, tax registration and statutory invoice numbering need a separate
configured tax-invoicing implementation; no tax compliance claim is fabricated.

## API surface

Buyer routes require CUSTOMER, PARENT or STUDENT authentication and ownership.
Lists use `?page=1` with 20 entries per page.

- `POST /api/v1/payments` — `{ orderId }`, returns payment and hosted checkout data.
- `GET /api/v1/payments` — payment/refund/attempt history.
- `GET /api/v1/payments/:id` — persisted payment status.
- `POST /api/v1/payments/:id/refresh` — fetch current provider state.
- `POST /api/v1/payments/:id/verify` — `{ providerPaymentId, signature }`.
- `GET /api/v1/payments/:id/receipt` — issued only after verified capture.
- `POST /api/v1/payments/:id/refunds` — `{ idempotencyKey, reason }` for the remaining balance.
- `POST /api/v1/admin/payments/:id/refunds` — SUPER_ADMIN only; also accepts decimal-string `amount`.
- `POST /api/v1/payments/:id/simulate` — owned mock sessions only; development/test.

## Deployment and validation

Apply `20261023150000_payment_billing`, generate Prisma Client, configure credentials
and webhook URL, and restart the API. Older paid records without a verification
timestamp must be reconciled before further fulfilment; the migration does not
pretend historical data was verified.

Integration tests cover real PostgreSQL locks, repeated/concurrent callbacks,
ownership, invalid signatures, wrong amount/currency/order, capture versus
authorization, cancellation races, partial/full/concurrent refunds, lost provider
responses, receipts and fulfilment gates. Adapter tests mock the HTTPS boundary
and check signature and request contracts. Real Razorpay test-mode payments and
webhook delivery still require merchant credentials; those are not exercised by
the local mock tests.

Provider references used for the adapter:

- [Standard Checkout integration](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/)
- [Fetch payment status](https://razorpay.com/docs/api/payments/fetch-with-id/)
- [Order lookup by receipt](https://razorpay.com/docs/api/orders/fetch-all/)
- [Webhook validation](https://razorpay.com/docs/webhooks/validate-test/)
- [Idempotent refunds](https://github.com/razorpay/markdown-docs/blob/master/api/refunds/normal-refunds-idempotent.md)
