# Module 19 — Intelligence layer

Customer page: `/intelligence` (Lunch assistant). Super-admin page: `/admin/intelligence` (Intelligence & planning). Both have desktop/mobile layouts and are linked from the appropriate navigation.

## Independent architecture

`apps/api/src/modules/intelligence` contains recommendation, demand, route and support services. These services read application records and return shared DTOs. They never create orders, reserve stock, verify payments, change subscriptions, or assign deliveries. No core ordering logic or database schema was changed.

The initial implementation is an explainable **statistical/rule-based baseline**, not a trained model or LLM. Recommendation and demand strategies have explicit interfaces in `algorithms.ts`; route planning is isolated in its own service. Method identifiers and timestamps identify results. A later model can replace these strategies without altering ordering or fulfilment. There are no external AI calls, credentials, or transfers of customer data.

## API

All paths are under `/api/v1/intelligence`. Authentication is required. Reports are private/no-store and limited to 60 requests per signed-in user per minute.

| Endpoint | Access | Input |
| --- | --- | --- |
| GET `/options` | Signed in | Public active checkpoints; kitchen names only for super admins; up to 50 of the caller's orders/subscriptions only for buyer roles |
| GET `/recommendations` | Customer, parent, student | `checkpointId`, `date`, optional `mealPeriod` |
| POST `/support` | Customer, parent, student | `question`; optional owned `orderId`, owned `subscriptionId`, `checkpointId`, `date` |
| GET `/demand` | Super admin | `checkpointId`, `date`, optional `mealId`, optional matching `institutionId` |
| POST `/routes` | Super admin | `kitchenId`, `date`, `departureMinute`; optional `maxMeals` (80), `speedKmh` (20), `stopMinutes` (5) |

Recommendation/forecast/route dates are bounded to today through 30 days ahead in the relevant city's timezone. Schemas reject invalid dates, unexpected properties and out-of-range assumptions. Public options are capped at 500 checkpoints/kitchens.

## Meal recommendations

Candidates must have a published schedule, active meal, approved vendor, active serving kitchen, active institution/checkpoint/window, remaining stock and kitchen/checkpoint capacity. Local ordering cutoffs and service holidays are respected. Capacity checks are read-only snapshots; checkout remains authoritative.

Hard food-type filtering follows the signed-in user's dietary preference. Ranking uses the user's own non-child, non-cancelled fulfilment history from the last 90 days, food/cuisine/tag preferences and preferred time slot. All meal times are available unless a meal period is selected; elapsed ordering windows are excluded. Scores and reasons are explainable. Cold-start users see available dietary matches without fabricated preferences.

The service ranks at most 500 candidate schedules and returns 12 suggestions; truncation is disclosed. These are recommendations for the account holder, not recommendations inferred for a child. Free-text allergy notes cannot establish allergen safety: declared allergens are shown, with an explicit prompt to check with the kitchen where allergy notes exist.

## Demand forecasts

Forecasts group scheduled quantities by checkpoint, institution, meal, period and target weekday. The baseline averages up to eight prior matching weekdays in the last 56 days. Cancelled and pending items are excluded; failed deliveries count as ordered demand. Historical holidays are excluded. Zero-demand days after the first observed demand are included, while pre-launch days are not treated as observed zeros.

At least four matching observations are required. Otherwise predictions are null and the UI says insufficient data. Estimates are floored at known non-pending target-date bookings. Target holidays show closure and zero expected service, with a warning to review existing bookings. Variability ranges use mean ± two historical standard deviations and are explicitly not calibrated confidence intervals. Evidence labels describe sample coverage, not proven model accuracy.

No future outcomes enter the historical data. Historical grouped rows are capped at 28,000, target bookings at 5,000 and meal groups at 500; oversized requests fail explicitly rather than returning incomplete forecasts. Forecasts estimate observed ordering demand, not stockout-adjusted latent demand, and do not account for special events, weather or negotiated future plans.

## Route suggestions

The planner groups unassigned confirmed/preparing/packed items by checkpoint and time window. It uses kitchen/checkpoint coordinates, local delivery windows, quantities and currently available active riders in the kitchen's city. Riders with unfinished routes or deliveries on that date are excluded. Input is bounded to 1,000 order items and 100 rider candidates; rider truncation is disclosed.

For each rider, the planner chooses feasible stops by earliest window deadline, then distance. Travel uses haversine distance × 1.3 and an explicit average-speed assumption; arrival waits for a window to open and must leave room for the per-stop service time. Meal capacity is operator supplied because rider-specific capacity is not yet stored. Oversized checkpoint batches, missing/invalid coordinates, holidays, late windows and insufficient riders appear as unassigned work with reasons. Departure must be in the future.

These are drafts, not road navigation or guaranteed ETAs. There is no traffic, road routing, vehicle fit, packing-ready-time or optimality model. Review suggestions and use the existing Delivery routes screen to assign batches; that service retains payment, assignment and concurrency checks. No automated assignments are made.

## Grounded customer support

Intent routing supports the four requested questions and returns structured facts plus links to source screens. It performs fresh, ownership-scoped backend reads. Multiple candidate orders/subscriptions trigger a selection prompt. Explicit identifiers belonging to someone else return 404, including identifiers attached to unknown intents.

Order answers report stored item/delivery state, never guessed live location or arrival time. At most 20 meal lines are included and the answer states that limit. Payment answers distinguish unverified state from the last provider-verified state. They do not call a recorded failure a confirmed payment failure until verification exists, and do not invent a bank explanation or expose raw provider payloads/reasons. Payment verification stays in the payment module.

Skip answers check plan dates, recurrence, existing skips, fulfilment and paid-meal restrictions. Tomorrow uses the subscription checkpoint's timezone; other dates must be supplied explicitly. Answers are advisory and link to Subscriptions, where changes are revalidated. Asking about available meals requires a checkpoint and date and retrieves current recommendation/availability results. Ambiguous or unsupported intents receive a capability explanation. Backend errors propagate as errors, not fabricated answers.

Support is deterministic and has no tool execution, arbitrary SQL, mutation path, cross-user context or external model prompt. No conversation history is stored. OTPs, customer contact details, card information and provider payloads are excluded from responses.

## Validation

`apps/api/tests/intelligence.test.ts` covers authorization, ownership, dietary/ranking rules, stock/capacity/cutoffs, holidays, weekday forecasting with zero-demand days, sparse history, route feasibility, rider conflicts, read-only behavior, verified versus unverified payment answers, skip guidance and unsupported prompts.

Run `npm test` and `npm run build`. No migration or AI-provider configuration is required for this baseline.
