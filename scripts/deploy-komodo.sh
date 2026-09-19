#!/usr/bin/env bash

set -euo pipefail

APP_NAME="leetcode-preparation"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

KOMODO_SERVER="${KOMODO_SERVER:-}"
KOMODO_STACK="${KOMODO_STACK:-$APP_NAME}"
KOMODO_HOST="${KOMODO_HOST:-}"

log() {
  printf '\033[1;34m[%s]\033[0m %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

error() {
  printf '\033[1;31m[%s] ✖ %s\033[0m\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2
}

require() {
  if [[ -z "$1" ]]; then
    error "Missing required value: $2"
    exit 1
  fi
}

require "$KOMODO_SERVER" "KOMODO_SERVER"
require "$KOMODO_HOST" "KOMODO_HOST"

log "Deploying $APP_NAME to Komodo"
log "Komodo server: $KOMODO_SERVER"
log "Komodo stack: $KOMODO_STACK"

if ! command -v docker >/dev/null 2>&1; then
  error "Docker is required for Compose validation"
  exit 1
fi

log "Validating Compose configuration"
TEMP_ENV="$(mktemp)"
trap 'rm -f "$TEMP_ENV"' EXIT
printf 'POSTGRES_PASSWORD=dummy-password\nAPP_PORT=3000\n' > "$TEMP_ENV"
docker compose -f "$PROJECT_ROOT/docker-compose.yml" --env-file "$TEMP_ENV" config >/dev/null

log "Compose configuration is valid"

cat <<EOF

Komodo stack configuration:
  Repository: https://github.com/umbertocicciaa/leetcode-preparation.git
  Branch: ${KOMODO_BRANCH:-main}
  Compose file: docker-compose.yml
  Stack: $KOMODO_STACK

Set these environment variables in Komodo:
  POSTGRES_PASSWORD=<strong-password>
  POSTGRES_DB=leetcode
  POSTGRES_USER=leetcode
  APP_PORT=3000

Persistent volume:
  leetcode_postgres_data

This script validates the deployment configuration locally. Remote stack
creation/redeployment is intentionally delegated to the Komodo server/API
configured in your environment rather than hard-coding Komodo credentials.

EOF

log "Deployment configuration validated successfully"