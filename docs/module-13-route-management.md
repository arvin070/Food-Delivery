# Module 13 — Delivery route and batch management

## Admin workflow

Open **Admin → Delivery routes** at /admin/routes.

1. Choose a delivery date and kitchen to review existing routes.
2. Select **Plan a route**, enter a name, and choose an available delivery partner.
3. Select packed, unassigned meals. The picker groups items by checkpoint and displays their quantities, order references and time slots. Checkpoint selection applies to the visible page; selections persist across pages.
4. Arrange checkpoints with the up/down buttons.
5. Create the route. Assignment of the complete batch is atomic.
6. Open a route to review checkpoint preparation lists, add more packed meals, change the partner, or reorder checkpoints before pickup.

A route follows Kitchen → Checkpoint 1 → Checkpoint 2 → … . Each checkpoint appears once, even when it contains many orders, meals or time slots.

The route view shows date, kitchen, partner, all delivery slots, ordered checkpoints, delivery progress, meal quantity, distinct order count and checkpoint count. Each checkpoint has a meal/time-slot quantity breakdown. The rider application receives the same stop order and all time slots. Kitchen operations group every assigned meal under its route name.

After pickup, or any delivery progress, route editing is locked. Partners continue using Module 12's pickup, departure, checkpoint arrival and verified delivery workflow.

## Data model

Existing relationships are reused:

Kitchen → DeliveryRun → ordered DeliveryStop → Delivery → OrderItem → Order.

- DeliveryRun: kitchen, service date, partner, name, status, revision, creation key/hash, pickup/departure/completion timestamps.
- DeliveryRun.timeSlotId: the earliest delivery slot in the batch, retained as the existing run anchor. A route's full slot list is derived from its order items.
- DeliveryStop: checkpoint, sequence, progress and arrival/completion timestamps. The existing unique route/checkpoint constraint guarantees one stop per checkpoint.
- Delivery: unique order-item assignment, partner, stop and handoff state.
- OrderItem: authoritative meal snapshot, quantity, delivery date and time slot.
- Kitchen and Checkpoint: coordinates already available for future planning.

Totals use SUM(quantity) for meals and COUNT(DISTINCT orderId) for orders. An order spanning two checkpoints counts once in the route total. Delivery count means the number of assigned order items; it is distinct from both meal and order counts.

The existing unique kitchen/date/anchor-slot/partner constraint remains. Add to the existing route when that combination is already planned, or use a different partner. Multiple time slots can share a route. Route feasibility and travel timing remain a manual planning decision.

## API

All endpoints are SUPER_ADMIN-only under /api/v1/admin/routes:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /options | Active kitchens and partner choices |
| GET | /?date=YYYY-MM-DD&kitchenId=…&page=1 | Routes, 20 per page; kitchen filter optional |
| GET | /candidates?date=YYYY-MM-DD&kitchenId=…&page=1 | Packed unassigned items, 100 per page |
| GET | /:routeId | Route totals and checkpoint batches |
| POST | / | Create and assign a complete route |
| PATCH | /:routeId | Update partner/name/order and append items before pickup |

Create body:

```json
{
  "name": "College lunch",
  "date": "2026-10-24",
  "kitchenId": "<kitchen>",
  "deliveryPartnerId": "<partner>",
  "checkpointIds": ["<gate-a>", "<gate-b>", "<hostel>"],
  "orderItemIds": ["<item-1>", "<item-2>", "<item-3>"],
  "idempotencyKey": "<UUID>"
}
```

Edit body: name, deliveryPartnerId, checkpointIds, revision, and optional orderItemIds to append. Supply the complete ordered checkpoint list, including all existing stops. Meal reassignment between existing routes, removing assigned meals and route cancellation are outside this module.

## Integrity

- Only packed, unassigned meals from the chosen kitchen and service date can be added.
- Verified captured payment is checked before assignment.
- Partners must be active and available, and must serve the kitchen's city when restricted to a city. Checkpoints must be active.
- Past-date planning is rejected using the kitchen city's timezone.
- Checkpoint IDs must match the assigned batch exactly; duplicate, missing and unrelated checkpoints are rejected.
- A route has at most 500 delivery items. Candidate and route lists are paginated.
- Serializable transactions and row locks protect batch edits and concurrent assignment.
- Unique item assignments prevent a meal from being assigned twice.
- Creation keys provide retry safety; reuse with a different payload returns a conflict.
- Revision checks reject stale edits. The existing single-item assignment endpoint also increments the route revision.
- Reassigning a partner updates the run and every delivery atomically, removing the previous partner's access.
- Create/edit operations record audit entries with actor, assignment and checkpoint order.
- The batch API omits beneficiary names, phone numbers, customer profiles and OTP values; admin planning does not require them.
- Assignment uses existing orders and capacity reservations. It does not generate orders or reserve capacity a second time.

## Future optimization

No AI, routing engine, distance calculation or automatic stop ordering is implemented.

A future planner can consume kitchen/checkpoint coordinates, service date, per-item time slots, quantities and partner assignments, then propose an ordered list of checkpoint IDs. Apply that proposal through the same revision-checked edit service before pickup. Preserve stable stop IDs and assignment/payment checks. Planned ETAs, distance estimates, vehicle constraints and optimization-run provenance can be added without changing the order-to-delivery ownership model.

## Deployment and verification

Apply migration 20261024090000_route_management using the normal Prisma migrate deploy command. It adds nullable route name and creation metadata plus a revision default, preserving existing runs. No new environment variables or services are required.

Validation: all 321 API tests, workspace typechecks and the production build pass. Module 13 integration tests cover distinct-order counting, multi-slot batches, kitchen/rider integration, role restrictions, idempotency, competing assignments, atomic rejection, availability, checkpoint validity, date/payment constraints, partner transfer, stale revisions, pickup locks, checkpoint ordering and candidate pagination.
