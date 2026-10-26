# Module 17 — Corporate Meal Management

## Workspace and roles

`/corporate` is available to customers, parents, students and super admins. A company creator becomes its corporate ADMIN through a company-scoped membership; no consumer account role is changed. Corporate EMPLOYEEs see their own credits, usage and orders. Corporate ADMINs manage employees, offices, policy, company usage, orders and billing. Super admins approve company credit and record verified bank settlements. Scope is rechecked on every operation.

A company links to a CORPORATE institution for city, timezone and office checkpoints, while corporate membership, policy, authorizations and billing live in independent tables. Institution self-registration never creates a corporate membership or grants meal benefits.

## Onboarding and policy

1. Create the company with its name, city and billing email.
2. Add employees using their existing active Lunch account email. Assign EMPLOYEE or corporate ADMIN membership and an optional employee number and monthly credit override. No invitations or outbound emails are sent by this operation.
3. Create office checkpoints with capacity, delivery instructions and existing city delivery windows. Lunch/kitchen staff must configure kitchen coverage and published meals before ordering is available.
4. Set the company monthly budget, default employee monthly credits, subsidy per meal, eligible weekdays/meal periods, daily meal limit and whether employee co-payment is allowed.
5. A platform super admin approves and activates a finite company credit limit. Company admins cannot self-approve credit, mark an invoice settled or alter payment state.

New companies are PENDING with zero credit. Policy updates use revisions and audit logging. Account suspension blocks new authorizations while existing commitments retain their funding. Deactivating an employee blocks future corporate access/orders; personal orders remain accessible through the consumer account.

## Credits, subsidies and checkout

All amounts currently use INR and decimal arithmetic. Employee credits are a monthly allowance for company subsidies, not a cash wallet. An employee-specific monthly allowance overrides the company default. Unused credits do not carry forward. Budget and credit usage are assigned to the meal's service month in the company city's timezone.

For each meal order:

- Gross meal amount = server-side scheduled price × quantity.
- Company contribution = the lesser of gross amount and per-meal subsidy × quantity.
- Employee co-payment = gross amount − company contribution.

Checkout rejects requests exceeding the employee allowance, company monthly budget, approved outstanding company credit, daily meal limit or allowed days/meal periods. It does not silently shift an exhausted subsidy to an employee. The employee also supplies a maximum authorized co-payment; server-calculated co-payment cannot exceed it. Changing policy affects future authorizations, not recorded funding snapshots.

Corporate checkout is separate from the consumer cart. It reuses the inventory and delivery-capacity rules and creates normal orders/order items consumed by the kitchen, route and delivery systems. Each corporate order belongs to one employee and has one meal line. Batches accept at most 50 distinct employees, commit atomically, and deduplicate through a company/request key plus payload hash. Requests for other employees require corporate admin scope and full company funding; an admin cannot impose co-payments on employees.

Company and employee allowances, outstanding credit, stock, checkpoint capacity, kitchen capacity, holidays, date horizon (30 days), active resources and local ordering cutoffs are validated in the transaction. Company locking plus serializable retries prevents overspending across concurrent checkouts. The consumer cart is never read, cleared or modified by corporate checkout.

## Trusted funding and consumer payment integration

A durable CorporateCharge authorizes the company contribution against approved credit. The consumer order snapshots the gross price as subtotal, the company contribution as its funding discount, and the employee portion as totalAmount. The independent charge ledger distinguishes company funding from a promotional discount.

Fully subsidized orders have zero employee total and become CONFIRMED under the explicit trusted state `APPROVED_CORPORATE_CREDIT`. They do not create a fake PAID provider payment. The fulfilment guard validates the charge and exact subtotal/contribution/co-payment reconciliation.

For partial subsidies, the existing payment abstraction creates and verifies only the employee co-payment. The order stays AWAITING_PAYMENT until server-side provider verification succeeds. Normal consumer orders still require verified captured payment of their complete total. Provider implementations remain isolated from corporate logic.

Customer, corporate-admin and kitchen cancellations release an AUTHORIZED company charge in the same transaction as cancellation. Replays cannot release it twice. Employee refunds go through the existing provider refund flow and return only the captured employee amount. Late/refunded-before-confirmation payments also release company authorization when the payment engine cancels the order.

## Monthly billing

CorporateCharge states are AUTHORIZED, RELEASED, INVOICED and SETTLED. AUTHORIZED and INVOICED amounts consume outstanding credit. All non-released charges continue consuming their original service-month budget/allowance, including settled charges.

After a service month closes, a corporate admin can issue one immutable monthly company invoice. All included meal items must be terminal (DELIVERED or FAILED); unresolved meals block closure. Prepared meals with failed delivery are billable under the recorded initial policy. Cancelled charges are excluded. Invoice totals include company contributions only, never employee co-payments. The snapshot retains company name, billing email, month, quantities, totals and terms; paginated order history provides the supporting records. Issuance and charge linking commit atomically, and repeated issuance returns the same invoice.

The admin can expire past unpaid orders in batches of at most 50. Expiry locks and rechecks each order, cancels pending items, releases stock and company authorization, and leaves any later provider capture on a cancelled order for the existing refund flow. It never expires captured payments or meals already in fulfilment. Repeat the operation if more than 50 eligible orders remain.

Company admins cannot mark invoices paid. Platform finance can record a **verified offline full bank settlement** with the exact invoice amount, a globally unique bank reference and a required verification note. Replays with the same reference are idempotent; mismatched amounts/references are rejected. The action is audited and releases outstanding credit. This is an explicit trusted finance operation, not provider-verified online invoice collection. Automated bank reconciliation, provider-based company invoice payment, recurring billing and tax-document generation are future integrations. The current document is a company meal billing statement.

## API

All paths are under `/api/v1/corporate`:

- `GET/POST /`: list linked companies / create company.
- `GET /:id`: role-appropriate company policy summary.
- `PATCH /:id/policy`: revision-checked corporate policy/budget update.
- `POST /:id/credit`: platform-only credit approval/suspension.
- `GET/POST /:id/employees`, `PATCH /:id/employees/:memberId`: scoped employee management.
- `GET/POST /:id/offices`: office checkpoints and windows (up to 100 offices).
- `GET /:id/offers?date=&checkpointId=`: paginated published office meals.
- `GET /:id/usage?month=YYYY-MM`, `GET /:id/orders`: scoped usage/order history.
- `POST /:id/orders`: bounded idempotent employee/bulk checkout.
- `POST /:id/orders/:orderId/cancel`: scoped cancellation using the core order workflow.
- `POST /:id/expire`: expire up to 50 past unpaid orders.
- `GET/POST /:id/invoices`: monthly statement history/issuance.
- `POST /:id/invoices/:invoiceId/settle`: platform-only verified bank settlement.

## Migration and validation

Apply `20261025120000_corporate_meals` and regenerate Prisma. No new credentials or environment variables are required. Existing consumer data receives no corporate membership, pricing or billing changes.

Integration tests cover company isolation, protected billing controls, approval and policy revisions, concurrency/idempotency, fully funded and co-payment verification paths, bulk atomicity, employee consent, credit and capacity limits, holidays, customer/kitchen cancellation, co-payment refunds, invoice replay/settlement, bounded expiry and unchanged consumer payment rules. The complete API regression suite also exercises the earlier modules.
