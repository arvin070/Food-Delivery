#!/usr/bin/env bash
set -euo pipefail

: "${LUNCH_ENV_FILE:?Set the path to the protected environment file}"
: "${BACKUP_BUCKET:?Set the private S3 backup bucket}"
: "${BACKUP_KMS_KEY_ID:?Set the KMS key used for server-side encryption}"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="s3://${BACKUP_BUCKET}/lunch/${DEPLOY_ENV:-production}/postgres-${stamp}.dump"
docker run --rm --network host --env-file "$LUNCH_ENV_FILE" postgres:16-alpine \
  sh -c 'pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL"' |
  aws s3 cp - "$name" --sse aws:kms --sse-kms-key-id "$BACKUP_KMS_KEY_ID" --only-show-errors
