# Module 14 — Notification system

## User experience

Every signed-in role has a **Notifications** link at /notifications. The page provides a paginated inbox, unread count/filter, individual read actions, mark-all-read, refresh, channel/event preferences and removal of registered push devices.

In-app notifications are enabled by default. Email, SMS, WhatsApp and push require explicit opt-in. Event preferences apply across all channels. Opting out of a channel or event prevents future delivery, including queued work that has not yet been sent. Already accepted provider messages cannot be recalled.

Delivery confirmations go to the purchaser and, for a linked active child, the child's parent. When they are the same person, only one notification is created per channel. Each recipient's preferences are applied independently. Unrelated accounts cannot access another user's inbox, settings or push devices.

Example template:

> Rahul's lunch was delivered at ABC College Gate A.

## Event coverage

| Event | Trigger |
| --- | --- |
| account.created | Successful registration transaction |
| order.confirmed | Provider-verified payment confirms an eligible order |
| payment.successful | First verified capture |
| payment.failed | Provider-verified failed attempt |
| meal.preparing | Kitchen/vendor preparation transition |
| meal.packed | Kitchen/vendor packing transition |
| delivery.assigned | Single-item assignment or route batch assignment |
| delivery.started | Route departs after pickup |
| delivery.arriving | Arrival at the assigned checkpoint |
| delivery.delivered | Verified handoff; also informs the linked parent |
| delivery.failed | Terminal failed-delivery transition |
| subscription.renewal | Active plan ends within two days, once per plan/end date |
| subscription.paused | Successful pause transition; separate pause cycles are separate events |

Recurring billing is not enabled. The renewal template is explicitly a reminder to plan the next meals and does not claim an automatic charge or a completed renewal. Unlimited-duration plans have no end-date reminder.

Security OTPs and password resets retain their existing dedicated notifier. They do not pass through optional notification preferences or the business-event inbox, and their secrets are not stored in this outbox.

## Architecture

Business services call enqueueNotifications or notifyItemProgress with the **same Prisma transaction** that changes business state. They never call a notification provider.

The central service renders versioned templates and writes Notification rows for each recipient/channel. A unique (userId, eventKey, channel) constraint suppresses replay duplicates. In-app entries are immediately visible. Disabled channels/events are recorded as SKIPPED, preserving deduplication if preferences are enabled later. Messages are not retroactively replayed after opt-in.

A worker claims up to 20 external jobs per sweep using PostgreSQL FOR UPDATE SKIP LOCKED. It sends four concurrently, with two-minute leases, five-second gateway request timeouts, at most five attempts, and exponential backoff starting at 30 seconds. Multiple API replicas can run workers. Expired leases recover after a crash; expired final attempts become FAILED. Retry and lease comparisons explicitly use UTC to match Prisma DateTime storage.

Provider calls happen **after** the transaction commits. Provider downtime does not undo order, payment, delivery or subscription state. Queue/database failures still roll back the business transaction so committed changes do not silently lose their notification intent.

Delivery is at least once at the transport boundary. Each retry uses the notification ID as a stable provider idempotency key. A gateway must persist and deduplicate this key, including per-device sends, to prevent a timeout or crash from delivering duplicates. Cross-channel delivery ordering is not guaranteed.

Statuses: QUEUED, PROCESSING, SENT, SKIPPED, FAILED. For external messages, SENT means the gateway accepted the message and returned a receipt; it does not claim a read or handset-delivery receipt. Provider delivery webhooks are a future extension.

## Templates and providers

- templates.ts: event-to-title/body registry, version 1.
- notification.service.ts: preferences, recipient resolution, transactional enqueue and inbox ownership.
- notification.worker.ts: claims, leases, retry policy and dispatch.
- providers.ts: NotificationProvider interface and channel registry.

Provider implementations are selected in the registry, independently for EMAIL, SMS, WHATSAPP and PUSH. The included gateway adapter uses a provider-neutral HTTP contract. Vendor SDKs, WhatsApp approved-template mappings and push SDK configuration belong in adapters/gateways, not order or kitchen services.

Gateway request:

- POST to NOTIFICATION_GATEWAY_URL.
- Authorization: Bearer <server-side token>.
- Idempotency-Key: <notification ID>.
- JSON fields: idempotencyKey, channel, destinations, title, body, template, templateVersion, variables.
- Variables are restricted to orderNumber, beneficiary, checkpoint, meal and endDate.
- Success: HTTP 2xx with {"messageId":"provider-receipt"}.
- Retryable: timeouts/network errors, HTTP 429, HTTP 5xx, or malformed success receipts.
- Other HTTP failures are terminal.
- Redirects are refused, and upstream response bodies/errors are not logged or exposed.

Messages contain plain text. A provider that converts to HTML must escape text. No OTPs, raw card data, payment credentials, allergy details or customer contact data are embedded in template variables. Destinations are resolved at dispatch from the recipient's current verified email/phone or registered push devices.

## Configuration

The migration adds WhatsApp as a channel, outbox fields/indexes, NotificationPreference and PushDevice. Existing notifications are preserved.

Run the normal Prisma migrate deploy command to apply 20261024120000_notifications.

Default configuration:

```dotenv
NOTIFICATION_PROVIDER=disabled
NOTIFICATION_WORKER_ENABLED=true
```

In-app notifications work with these defaults. Live external channels require a configured adapter or gateway:

```dotenv
NOTIFICATION_PROVIDER=gateway
NOTIFICATION_GATEWAY_URL=https://your-notification-gateway.example/messages
NOTIFICATION_GATEWAY_TOKEN=<secret-at-least-16-characters>
```

Production requires HTTPS. The worker can be disabled with NOTIFICATION_WORKER_ENABLED=false when a separate process runs processNotificationBatch.

No real external messages were sent during validation. Gateway behavior was tested with mocked HTTP responses. With no provider configured, an eligible external message becomes FAILED with PROVIDER_NOT_CONFIGURED; it is never reported as sent. Skipped or terminal failed messages do not replay automatically when configuration changes. Operators should investigate failures before any deliberate resend.

## APIs

All paths below are authenticated and scoped to the signed-in user under /api/v1/notifications:

| Method | Path | Behavior |
| --- | --- | --- |
| GET | /?page=1&unread=false | Inbox, 30 items per page; total and unread count |
| GET | /preferences | Channel/event settings and safe device summaries |
| PUT | /preferences | Set inApp, email, sms, whatsapp, push, disabledEvents |
| POST | /:notificationId/read | Idempotently mark an owned in-app notification read |
| POST | /read-all | Mark owned inbox notifications read |
| POST | /devices | Register {token, platform: web/android/ios} |
| DELETE | /devices/:deviceId | Remove an owned device |

Push registrations are capped at 10 per user, have unique token hashes, and never return raw tokens. Another account cannot overwrite or delete a registered device. A mobile client or web push integration supplies platform tokens; this module provides the registration and dispatch architecture, not a browser service worker or vendor push SDK.

## Verification

All 342 API tests and the production build pass. Coverage includes all templates, transaction rollback, duplicate event suppression, preferences, inbox/device ownership, verified destinations, concurrent workers, lease recovery, bounded batches, backoff, attempt exhaustion, gateway error classification, parent confirmation, and integration with payment, kitchen, delivery and subscription transitions.
