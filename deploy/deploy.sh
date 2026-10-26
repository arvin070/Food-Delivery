#!/bin/sh
set -eu

COMPOSE='docker compose --env-file deploy/release.env -f deploy/compose.production.yml'
STATE_FILE=${DEPLOY_STATE_FILE:-deploy/previous-images.env}
RELEASE_FILE=${RELEASE_FILE:-deploy/release.env}
ACTION=${1:-deploy}

case "$ACTION" in
  deploy)
    : "${API_IMAGE:?Set API_IMAGE to an immutable image reference}"
    : "${WEB_IMAGE:?Set WEB_IMAGE to an immutable image reference}"
    : "${DOMAIN:?Set the public application domain}"
    : "${ACME_EMAIL:?Set the certificate contact email}"
    mkdir -p "$(dirname "$STATE_FILE")"
    if [ -f "$RELEASE_FILE" ]; then cp "$RELEASE_FILE" "$STATE_FILE.next"; else : > "$STATE_FILE.next"; fi
    mkdir -p "$(dirname "$RELEASE_FILE")"
    printf 'API_IMAGE=%s\nWEB_IMAGE=%s\nDOMAIN=%s\nACME_EMAIL=%s\nLUNCH_ENV_FILE=%s\nWEB_ENV_FILE=%s\nMIGRATION_ENV_FILE=%s\n' "$API_IMAGE" "$WEB_IMAGE" "$DOMAIN" "$ACME_EMAIL" "${LUNCH_ENV_FILE:-/etc/lunch/production.env}" "${WEB_ENV_FILE:-/etc/lunch/web-production.env}" "${MIGRATION_ENV_FILE:-/etc/lunch/migration-production.env}" > "$RELEASE_FILE"
    export API_IMAGE WEB_IMAGE LUNCH_ENV_FILE=${LUNCH_ENV_FILE:-/etc/lunch/production.env}
    $COMPOSE pull api web
    $COMPOSE --profile migration run --rm migrate
    $COMPOSE up -d --remove-orphans api web caddy
    mv "$STATE_FILE.next" "$STATE_FILE"
    ;;
  rollback)
    if [ ! -s "$STATE_FILE" ]; then echo 'No previous image release is recorded.' >&2; exit 1; fi
    cp "$RELEASE_FILE" "$RELEASE_FILE.failed"
    cp "$STATE_FILE" "$RELEASE_FILE"
    . "$RELEASE_FILE"
    export API_IMAGE WEB_IMAGE LUNCH_ENV_FILE=${LUNCH_ENV_FILE:-/etc/lunch/production.env}
    $COMPOSE pull api web
    $COMPOSE up -d --remove-orphans api web caddy
    mv "$RELEASE_FILE.failed" "$STATE_FILE"
    ;;
  *) echo 'Usage: deploy.sh deploy|rollback' >&2; exit 2 ;;
esac
