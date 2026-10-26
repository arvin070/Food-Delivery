# Module 11: Kitchen preparation and packing

Open **Kitchen operations** at `/kitchen`. Vendor-role users land here after sign-in.
Choose a kitchen and service date. If the date is omitted, the API uses that
kitchen city's local date, not the API server's timezone.

## Daily dashboard

The dashboard includes full-day meal quantities, confirmed meals waiting to start,
meals preparing, packed meals ready for handover, and handed-over/delivered meals.
Breakdowns show food type, meal period, checkpoint, time slot and delivery route.
All counts sum `OrderItem.quantity`; an order item with 35 meals contributes 35,
not one. Unpaid, cancelled, failed and refunded orders are excluded.

A full-day delivery-window preparation list displays entries such as:

`12:30 PM — ABC College Gate A — 35 meals`

Meal batches are grouped by date, time slot, checkpoint, meal identity/name and
assigned delivery route. Summaries use the entire filtered day even when detailed
batches are paginated. The SQL aggregation works on meal rows and uses an `EXISTS`
payment check, so multiple historical payment records cannot multiply counts.

Routes come from the item's existing delivery → stop → run assignment. A route must
belong to the same kitchen, date and slot; otherwise the item appears under
**Unassigned route**. The dashboard does not guess routes from checkpoint proximity
or create delivery runs. Route assignment remains a delivery-planning concern.

## Workflow

Kitchen operations expose exactly:

`CONFIRMED → PREPARING → PACKED`

Staff can update an individual packing-list item or the eligible items in a meal
batch. Group actions process at most 200 order items per request and explicitly
report whether more remain. Requests validate the kitchen and service date again
on the server. Items that changed since the screen loaded are reported individually;
no backward transition or direct confirmed-to-packed jump is allowed.

Each update locks its order, rechecks captured payment, validates the current
status and updates the parent order rollup. It records preparing/packing timestamps
and an audit entry with the staff actor. Repeating the same action is a no-op and
does not overwrite timestamps. Concurrent updates retry serialization conflicts.

The **Packing checklist** includes beneficiary, meal, quantity, checkpoint, time,
child/self allergy information and order notes. It supports per-item preparation and
packing actions. Refresh retrieves current state; print produces the daily summary
and current page of the selected list. Pagination is labelled on printed worklists.

## Authorization and staff setup

No kitchen/vendor id from a request body grants access. The API resolves access
from current database ownership or `KitchenStaff` membership on every request.

- Vendor owners can operate their own kitchens.
- Assigned staff use an existing `VENDOR`-role account but need no vendor profile.
  They can operate only kitchens explicitly assigned to them, including when the
  vendor owns several kitchens.
- Staff cannot use the legacy vendor endpoints to access their employer's other
  kitchens; those endpoints still require actual vendor ownership.
- `SUPER_ADMIN` has explicit support access.
- Suspended/inactive/unapproved kitchens/vendors are read-only. Removing an
  assignment takes effect on the next request, without waiting for token expiry.

An administrator assigns or revokes an active vendor-role user's membership:

- `PUT /api/v1/admin/kitchens/:kitchenId/staff/:userId`
- `DELETE /api/v1/admin/kitchens/:kitchenId/staff/:userId`

Both operations are audited. Staff provisioning is currently API-based; creating a
staff invitation flow is separate from the kitchen dashboard.

## API

Kitchen endpoints require VENDOR or SUPER_ADMIN authentication:

- `GET /api/v1/kitchen/kitchens` — only accessible kitchen options.
- `GET /api/v1/kitchen/:kitchenId/dashboard?serviceDate=YYYY-MM-DD&page=1&pageSize=50`
- `GET /api/v1/kitchen/:kitchenId/packing?serviceDate=YYYY-MM-DD&page=1&pageSize=50`
- `POST /api/v1/kitchen/:kitchenId/items/status` — `{ serviceDate, orderItemIds, status }`.
- `POST /api/v1/kitchen/:kitchenId/groups/status` — `{ serviceDate, timeSlotId, checkpointId, mealId, mealName, routeId, status }`.

Status must be PREPARING or PACKED. Nullable `mealId`/`routeId` explicitly select
unassigned values; foreign identifiers cannot escape the kitchen/date filter.

Apply `20261023170000_kitchen_operations` and regenerate Prisma Client before
starting the new API. PostgreSQL integration tests cover quantities and pagination,
route grouping, unpaid exclusions, allergies, state transitions, timestamps,
concurrent retries, staff isolation, revocation and suspended vendors.
