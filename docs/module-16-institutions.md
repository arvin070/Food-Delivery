# Module 16 — College and School Management

## Surfaces

- `/institution`: institution admin workspace; super admins also use this page to create institutions and assign an existing active INSTITUTION_ADMIN account.
- `/institutions`: customer, student and parent self-registration and withdrawal. Parents link children through the existing child profile form.
- `/meals`: optional institution filter, followed by checkpoint and delivery window selection. Existing checkout, kitchen coverage, published menu, capacity, cutoff and payment verification rules remain authoritative.

Institution types include SCHOOL, COLLEGE, UNIVERSITY and CORPORATE (displayed as Corporate office). Existing COMMUNITY and OTHER records remain supported. Profile management includes name, type, coordinator contact details, publicly visible delivery guidance and self-registration availability. City is fixed when the institution is created. Updates require the current revision to avoid overwriting another administrator's changes.

## Scope and privacy

Private institution APIs require INSTITUTION_ADMIN plus an active ADMIN membership of the selected active institution, or SUPER_ADMIN. Membership is checked on every request. Institution administrators cannot provision institutions, grant themselves administrator membership, detach checkpoints or edit another institution. Self-registration always creates a MEMBER and cannot alter an administrator membership.

Registration lists combine account memberships with parent-managed child profiles. These are self-reported registrations, not verified enrolment. Only names, registration identifiers, role/kind and active state are exposed; parent contact details, addresses, dates of birth, allergies, emergency contacts, payment details and order identifiers are excluded. Closing registration prevents new account self-registrations; it does not erase existing memberships or change child profiles or orders.

## Checkpoints and delivery windows

Admins create checkpoints in the institution's city, set meal capacity and rider instructions, and define named windows with start/end time, meal period, order cutoff and slot capacity. For example: Gate A 12:30–12:40, Gate B 12:40–12:50 and Hostel 12:50–13:00. Times use the institution city's timezone.

Each new window has an institution-owned TimeSlot and CheckpointTimeSlot. Same-checkpoint overlaps and more than 20 active windows are rejected. Existing checkpoint editing supports enabling/disabling windows and updating their capacity/cutoff. Window edits are atomic; invalid or foreign-city/institution slots roll back the entire checkpoint update. Removal deactivates the checkpoint-slot association and retains historical references. Checkpoints with order history cannot be transferred to another institution or city.

An enabled window alone does not make a meal orderable: a kitchen must serve the checkpoint and publish a menu for that slot. Inactive institution checkpoints are excluded from public choices and new order validation. Current orders retain their original records.

## Statistics

Statistics default to today's service date in the institution city's timezone. They count unique orders and meal quantities, with delivered, failed and pending meal totals, grouped by checkpoint, slot and fulfilment status. Cancelled items are excluded; pending includes unpaid items. The report is scoped by institution checkpoint, including deliveries for customers who have not self-registered. Groups omit individual order/customer identifiers.

## Bulk-plan foundation

InstitutionBulkRequest records non-binding quantity per day, meal period, date range, requirements, requesting administrator and review status. Submission is idempotent per institution and request key, including simultaneous retries. Super admins can view requests through the same workspace. This module captures demand; automated negotiation, quote approval and contract activation are future work.

A future versioned agreement can reference the request and define negotiated rates, eligible beneficiaries, delivery schedules and billing-account terms. No request changes retail prices, enables `isBilledCentrally`, generates orders, confirms payments or starts recurring billing. Those effects must go through the order/payment/subscription engines after a trusted agreement is approved.

## API

All paths are under `/api/v1/institutions`:

- `GET /`: paginated, searchable admin-scoped institutions.
- `POST /`: super-admin onboarding, with an existing institution-admin account.
- `GET/PATCH /:id`: profile/settings and revision-checked updates.
- `GET /:id/registrations`: paginated, searchable registrations.
- `GET /:id/statistics?date=YYYY-MM-DD`: daily scoped aggregates.
- `POST /:id/checkpoints/:checkpointId/windows`: define an owned delivery window.
- `GET/POST /:id/bulk-requests`: paginated history and idempotent demand requests.
- `GET /registrations/me`, `POST/DELETE /:id/register`: buyer-scoped registrations.

Existing `/checkpoints` endpoints provide scoped checkpoint management and audit logging. Public authenticated `/reference/institutions`, `/reference/checkpoints` and `/reference/time-slots` support ordering dropdowns. Mutations to profiles, windows, checkpoints and bulk requests create audit records alongside their changes.

## Migration and validation

Apply `20261025090000_institution_management` with `npm run db:deploy -w @lunch/api` and regenerate Prisma. No new environment variables are needed. Existing rows default to accepting registrations, with revision zero and no institution-specific delivery note.

Integration tests cover institution isolation, revoked membership, administrator provisioning rules, profile conflicts and protected billing fields, checkpoint detachment, city/slot ownership, window overlaps and atomic rollback, registration privacy and closure, date-based statistics, public ordering choices, and simultaneous bulk-request retries without financial side effects.
