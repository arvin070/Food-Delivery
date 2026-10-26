# Lunch Deployment

## Topology

This deployment uses immutable GHCR images on a dedicated Linux Docker host. Caddy is the only public application container and terminates HTTPS for the frontend domain. The frontend forwards `/api/*` to the private API container, which reaches an external managed PostgreSQL database over TLS. Neither API nor PostgreSQL publishes a host port. The database must have public access disabled; allow connections only from the deployment host's fixed private network address/security group, with TLS required and a least-privilege application role.

Use separate managed database instances, DNS names, payment credentials, signing secrets, Sentry projects, and host environment files for development, staging, and production. Never reuse credentials between environments.

## Environment Setup

Templates are in `deploy/environments/`:

- `development.env.example` for local development
- `staging.env.example` for the staging API and web runtime
- `production.env.example` for the production API and web runtime
- `web-staging.env.example` and `web-production.env.example` for frontend server-only error reporting

Copy templates only into local ignored `.env` files or protected secret stores. Replace every `CHANGE_ME` and `SET_*` value. Generate independent signing keys with a cryptographic random generator (at least 32 bytes). Do not add populated env files, credentials, private keys, or database dumps to git.

On each deployment host, create `/etc/lunch` owned by root and mode `0700`. Store the matching API env as `/etc/lunch/staging.env` or `/etc/lunch/production.env`, the matching frontend Sentry config as `/etc/lunch/web-staging.env` or `/etc/lunch/web-production.env`, and migration-only database credentials as `/etc/lunch/migration-staging.env` or `/etc/lunch/migration-production.env`, all mode `0600`. Use an application database role with only runtime permissions; the one-off migration service uses a separate schema-owner credential. Supply runtime values from this host path or the cloud host's secret manager, never from the image.

The frontend's `API_INTERNAL_URL` is `http://api:4000` on the private Compose network. `API_PUBLIC_URL` and `CORS_ORIGINS` should be the HTTPS frontend origin. Browsers only use the same-origin `/api` proxy; do not expose an API hostname or set a `NEXT_PUBLIC_API_*` value.

## Host Provisioning

1. Provision a dedicated Linux VM with a stable public IP, Docker Engine and the Compose plugin. Permit inbound TCP 22 only from operator/CI address ranges, and TCP 80/443 from the internet. Do not publish database or API ports. Use a non-root deployment account restricted to the deployment directory and Docker operations; keep `/etc/lunch` root-owned.
2. Provision an independent managed PostgreSQL database for each environment. `terraform/postgres/` provides an AWS RDS PostgreSQL 16 reference with encrypted storage, forced TLS, private subnets, host-security-group-only ingress, Secrets Manager-managed master credentials, automated point-in-time recovery, production deletion protection, and final snapshots. Copy the matching `.tfvars.example`, select a currently supported PostgreSQL 16 minor version, and use a separate encrypted/locked Terraform state per environment/account. Review `terraform plan` and obtain infrastructure-owner approval before `terraform apply`; this repository does not run Terraform against your account. Staging uses its own smaller non-Multi-AZ instance. Create separate least-privilege `lunch_app` runtime and `lunch_migrator` schema credentials; the RDS master secret is break-glass only. Restrict inbound DB access to the deployment host security group only.
3. Configure DNS A/AAAA records for the staging and production frontend domains to their respective Caddy hosts. Ensure the domain resolves publicly before first startup. Set `DOMAIN` and `ACME_EMAIL` in the matching GitHub Environment. Caddy obtains and renews certificates automatically; keep ports 80 and 443 reachable for ACME.
4. Create private GHCR packages for the API and web images. On each host, authenticate Docker to GHCR using a dedicated read-only package token stored in the host's credential store. Do not use a developer's personal token.
5. Create `/etc/lunch/<environment>.env` from the matching template and place actual secret values in the platform secret manager or protected host file. Choose a real production payment provider and configure its webhook to `https://<domain>/api/v1/payments/webhooks/razorpay`. Do not enable mock payments in production.
6. Set up the deployment directory and ensure the deploy account can update only that directory. Install the `/etc/lunch` env files independently of workflow sync so application releases cannot overwrite credentials. Docker control is root-equivalent; keep this account and host dedicated to Lunch.

## GitHub CI/CD

The workflow at `.github/workflows/deploy.yml` builds API and web images using Dockerfiles and runs `npm ci` in each image build. Pull requests build both images without publishing. A push to `main` publishes commit-SHA tags to GHCR and deploys to the `staging` GitHub Environment. Production deployment and rollback are manual `workflow_dispatch` operations.

Configure GitHub Environments named `staging` and `production`. Each requires these environment variables:

- `DEPLOY_HOST`: environment-specific host
- `DEPLOY_USER`: restricted deployment account
- `DEPLOY_PATH`: dedicated deployment directory
- `DOMAIN`: public frontend hostname
- `ACME_EMAIL`: certificate contact address
And these environment secrets:

- `DEPLOY_SSH_KEY`: deployment-only private key
- `DEPLOY_KNOWN_HOSTS`: pre-verified host key entry; do not generate trust with `ssh-keyscan` during CI

Configure required reviewers and prevent untrusted branches from using the production Environment. Keep staging and production secrets distinct. The host must have read-only GHCR credentials already configured.

## Database Migrations

Migrations are versioned under `apps/api/prisma/migrations`. The workflow executes `prisma migrate deploy` from the exact API image before replacing running services. Production migration execution is behind the protected production Environment approval. Do not use `prisma db push`, `migrate dev`, or `migrate reset` in a deployed environment.

Use expand-and-contract migrations: add nullable/defaulted structures first, deploy compatible application code, backfill with an explicitly reviewed job, then remove obsolete structures only in a later approved release. Review every production migration for locks, table rewrites, data loss, and runtime duration before approving deployment. The deploy workflow does not automatically reverse migrations.

## Backups and Storage

Configure the managed database's automated encrypted snapshots and point-in-time recovery; those are the primary recovery mechanism. `backup-managed-postgres.sh` streams a custom-format `pg_dump` through the host to a private S3 bucket using the host's IAM role. Install `lunch-db-backup.service` and `lunch-db-backup.timer` as systemd units after changing `/opt/lunch` if the deployment path differs. Put `BACKUP_BUCKET`, `BACKUP_KMS_KEY_ID`, `DEPLOY_ENV`, and `LUNCH_ENV_FILE` in `/etc/lunch/backup-production.env` (mode `0600`); install a separate service/env for staging. Apply `backup-lifecycle.json` to that bucket, enable bucket versioning and default SSE-KMS encryption, deny public access, and grant the host role only `s3:PutObject` for the environment prefix and KMS encrypt permissions. Keep DB snapshot retention at least 14 days; the supplemental dump lifecycle is 35 days.

The current application deliberately rejects multipart uploads and has no object-storage writer. Product images are URL references. No file-storage bucket is needed for current runtime behavior; before enabling uploads, add an audited storage implementation with private objects, scoped presigned operations, content-type/size validation, and malware scanning rather than adding credentials alone.

## HTTPS, Routing, and Operations

Caddy serves `DOMAIN`, enforces HTTPS, and proxies to Next.js. It overwrites `X-Forwarded-For` with the connected client address; Next.js passes only those edge-generated IP/protocol headers to the private API, whose `API_TRUST_PROXY_HOPS=1` setting trusts the single Next.js hop. Do not add another unaccounted proxy/CDN without revisiting this trust count and its header sanitization. Next.js proxies `/api/v1/*` to the internal API, preserving first-party HTTP-only secure auth cookies. CORS should remain limited to the frontend origin even though browsers normally use the same origin. Keep DNS and application domains environment-specific.

The API exposes `/api/v1/health/live` for process liveness and `/api/v1/health/ready` for database readiness. Compose probes these endpoints and the web root. API and Next.js use Sentry DSNs per environment with PII collection disabled; Pino emits structured JSON outside development and redacts credentials/OTP fields. Caddy access logs are JSON and local container log files are size-bounded. Route container logs to the host/cloud log collector with access controls and retention; do not log env files or request bodies.

## Deploy and Rollback

The workflow publishes images with immutable commit-SHA tags, transfers the deployment configuration, runs database migrations, then replaces API/web containers. Caddy's certificate state persists in Docker volumes. The generated `deploy/release.env` is ignored by git and contains image references and public routing metadata only.

Rollback from GitHub Actions by choosing `workflow_dispatch`, selecting the environment, and selecting `rollback`. This restores the prior API/web image references and does not run migrations. Before rolling back code after a schema change, confirm the previous release remains compatible with the new schema. If the schema is not backward compatible, stop and use an approved recovery plan.

Database restore is a separate, destructive operation and is never automated by this workflow. For recovery, obtain incident approval, identify the exact recovery point, restore into a separate database first, preserve the failed database for investigation, and update the environment secret only after the recovery owner approves the target. Never restore or overwrite a production database without explicit approval.
