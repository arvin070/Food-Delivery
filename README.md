# Lunch

Scheduled meal and tiffin delivery. Not instant food delivery — customers book a
meal for a **future date and time slot**, and it is delivered to a **designated
checkpoint** they already go to (a college gate, school gate, bus stop, office
reception, hostel or apartment community point) rather than a street address.

```
Customer → Meal → Date → Time slot → Checkpoint → Kitchen → Delivery route → Customer
```

Parents can order for their children remotely and are notified when the meal is
handed over.

---

## Stack

| Layer          | Choice                                              | Why |
| -------------- | --------------------------------------------------- | --- |
| Monorepo       | npm workspaces                                      | No extra tooling; `packages/shared` is consumed by every app |
| API            | Node 20, Express 4, TypeScript                       | A standalone REST API, so the vendor dashboard and a future rider mobile app are peers of the web app rather than bolted onto it |
| Database       | PostgreSQL 18 + Prisma                               | Relational integrity for orders/payments; Prisma migrations are reviewable SQL |
| Web            | Next.js 15 (App Router), React 18, Tailwind CSS      | Server components keep the session server-side; one framework for marketing and app screens |
| Validation     | Zod, shared between API and web                      | One schema defines a rule once; the client and server cannot disagree |
| Auth           | JWT access tokens + rotating refresh tokens          | Stateless request auth, with revocable sessions and leak detection |

### Layer separation

```
packages/shared     enums · Zod schemas · API contracts · money helpers
                    (no Node or browser globals — runs in both)

apps/api
  config/           environment parsing; the only place process.env is read
  core/             logger · Prisma client · error types · HTTP helpers
  middleware/       validation · authentication · authorization · error handling
  modules/<name>/   routes → controller → service        (business logic in services)
  prisma/           schema · migrations · seed

apps/web
  src/app/          routes (server components by default)
  src/components/   reusable UI primitives and shared components
  src/lib/          API clients · session access · config
```

A module's `service` holds the business rules and never imports Express. Its
`controller` is a thin HTTP adapter. Its `routes` file declares the URL,
validation schema and required roles — so "who can call this, with what?" is
answerable by reading one line.

---

## Getting started

Requires **Node 20.9+**. No Docker and no system Postgres needed — the dev
database runs from an npm package.

```bash
npm install
```

```bash
cp .env.example .env
```

Generate real secrets (the committed example values are placeholders):

```bash
node -e "console.log('JWT_ACCESS_SECRET='+require('crypto').randomBytes(48).toString('base64'))"
```

Start the database. It downloads a real PostgreSQL 18 on first run and keeps its
data in `.pgdata/`. Leave it running in its own terminal:

```bash
npm run db:start
```

Apply migrations and load demo data:

```bash
npm run db:migrate && npm run db:seed
```

Run the API (`:4000`) and the web app (`:3000`):

```bash
npm run dev
```

Open <http://localhost:3000>.

> Prefer Docker? `docker compose up -d postgres` serves the same database on the
> same port; skip `npm run db:start`.

### Seeded accounts

Every account uses the password `Lunch@1234`.

| Role                | Email                    |
| ------------------- | ------------------------ |
| `SUPER_ADMIN`       | `admin@lunch.test`       |
| `CUSTOMER`          | `customer@lunch.test`    |
| `PARENT`            | `parent@lunch.test`      |
| `STUDENT`           | `student@lunch.test`     |
| `VENDOR`            | `vendor@lunch.test`      |
| `DELIVERY_PARTNER`  | `rider@lunch.test`       |
| `INSTITUTION_ADMIN` | `institution@lunch.test` |

The seed also creates one city, 3 institutions, 6 checkpoints, 4 time slots, an
approved vendor with a kitchen, 6 meals, and published availability for the next
14 days. `parent@lunch.test` has two children at two different institutions.

---

## Commands

| Command                | Does |
| ---------------------- | ---- |
| `npm run dev`          | API and web together |
| `npm run dev:api`      | API only, with reload |
| `npm run dev:web`      | Web only |
| `npm run build`        | Build every workspace |
| `npm test`             | Run all test suites |
| `npm run typecheck`    | Typecheck every workspace |
| `npm run db:start`     | Start the local dev database |
| `npm run db:stop`      | Stop it |
| `npm run db:migrate`   | Create and apply a migration |
| `npm run db:seed`      | Load demo data (idempotent) |
| `npm run db:studio`    | Browse the database in Prisma Studio |
| `npm run db:reset`     | Drop, re-migrate and re-seed |

---

## How requests are authenticated

The browser **never calls the API directly**. It calls this app's own
`/api/*` route, which proxies to the API and passes `Set-Cookie` back
([`route.ts`](apps/web/src/app/api/%5B...path%5D/route.ts)). That keeps session
cookies first-party, so they can be `httpOnly` — page JavaScript cannot read
them, which removes the "XSS steals the session token" class of bug. The API's
address never reaches the client bundle either.

Mobile clients skip cookies entirely and send
`Authorization: Bearer <accessToken>` instead; both paths are accepted.

Refresh tokens are **rotated on every use**, and only their SHA-256 hash is
stored. Presenting an already-rotated token means it leaked, so every session
for that user is revoked rather than just the one token.

---

## API

Base path `/api/v1`. Success responses are `{ "data": … }`; errors are
`{ "error": { code, message, details?, requestId? } }`. Clients switch on
`error.code` (see `ErrorCode` in `@lunch/shared`), never on `message`.

| Method | Path                        | Auth | Purpose |
| ------ | --------------------------- | ---- | ------- |
| `GET`  | `/health/live`              | —    | Liveness |
| `GET`  | `/health/ready`             | —    | Readiness, including database reachability |
| `POST` | `/auth/register`            | —    | Register as `CUSTOMER`, `PARENT` or `STUDENT` |
| `POST` | `/auth/login`               | —    | Sign in with email **or** phone |
| `POST` | `/auth/refresh`             | —    | Rotate the refresh token |
| `POST` | `/auth/logout`              | —    | Revoke the presented refresh token |
| `GET`  | `/auth/me`                  | ✓    | The current user |
| `POST` | `/auth/change-password`     | ✓    | Change password; ends all sessions |

---

## Data model

The full schema is [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma),
and its header documents the decisions that keep later features from forcing a
restructure. The two that shape everything else:

**`MealSchedule` is the sellable unit** — one meal, from one kitchen, on one
date, in one time slot, at a price, with a quantity. Browsing, capacity limits
and (later) demand prediction all hang off this single table.

**Fulfilment state lives on `OrderItem`, not `Order`.** One order may span
several dates, checkpoints and beneficiaries — a parent buying a week of lunches
for two children at two schools is one checkout. The kitchen and the rider act
on *one meal for one person on one date*, so that is where status lives.
`Order.status` is a roll-up.

Already in place for features not yet built: `City`/`Zone` (multi-city),
`Institution`/`InstitutionMember` (college, school and corporate accounts),
`DeliveryRun`/`DeliveryStop` (an ordered route, so route optimisation becomes a
service that reorders stops), provider-agnostic `Payment`, `Wallet`, and
`Subscription`.

---

## Status

**Foundation and authentication — done.** Monorepo, shared contracts, database
schema and migration, seed data, API core (config, logging, errors, validation,
RBAC), registration/login/refresh/logout/change-password, the web shell with
role-aware navigation, and the sign-in and registration screens. 31 passing
tests; all workspaces typecheck and build.

Next: customer profile and child management, then the meal catalog
(browse → date → checkpoint → slot), cart, checkout and payment, then the
vendor, delivery-partner and admin surfaces.


## Full-system integration

[Module 21](docs/module-21-integration.md) records the integrated lifecycle,
verification evidence, migration checks and remaining external-provider blockers.
Use `npm run test:integration` for the focused database-backed gate and
`npm run test:browser` for the four-persona delivery journey, navigation and browser
security checks. Build first; browser tests start dedicated API/web servers and
use mocked payment providers. Run database-writing suites sequentially.

`npm run db:verify` checks the migration chain in a disposable local database.
`npm run db:reconcile-order-status` provides bounded, audited repair of historical
order roll-ups (dry-run by default); see Module 21 before applying it elsewhere.
