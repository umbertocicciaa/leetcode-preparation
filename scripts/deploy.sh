#!/usr/bin/env bash

set -euo pipefail

###############################################################################
# Configuration
###############################################################################

APP_NAME="leetcode-preparation"
SERVICE_LABEL="com.umbertocicciaa.leetcode.local"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

DEPLOY_ROOT="$HOME/releases/$APP_NAME"
RELEASES_DIR="$DEPLOY_ROOT/releases"
CURRENT_LINK="$DEPLOY_ROOT/current"

VERSION=$(date +"%Y%m%d-%H%M%S")
NEW_RELEASE="$RELEASES_DIR/$VERSION"

LOG_FILE="/tmp/${APP_NAME}-deploy.log"

###############################################################################
# Logging
###############################################################################

exec > >(tee -a "$LOG_FILE") 2>&1

timestamp() {
    date +"%Y-%m-%d %H:%M:%S"
}

log() {
    printf "\033[1;34m[%s]\033[0m %s\n" "$(timestamp)" "$*"
}

success() {
    printf "\033[1;32m[%s] ✔ %s\033[0m\n" "$(timestamp)" "$*"
}

error() {
    printf "\033[1;31m[%s] ✖ %s\033[0m\n" "$(timestamp)" "$*" >&2
}

trap 'error "Deployment failed on line $LINENO"' ERR

###############################################################################
# Deploy
###############################################################################

log "Project root: $PROJECT_ROOT"

mkdir -p "$RELEASES_DIR"

log "Creating release: $VERSION"

mkdir -p "$NEW_RELEASE"

log "Copying project..."

rsync -a \
    --exclude ".git" \
    --exclude ".DS_Store" \
    --exclude "releases" \
    --exclude "current" \
    --exclude "scripts" \
    "$PROJECT_ROOT/" \
    "$NEW_RELEASE/"

log "Updating current symlink"

ln -sfn "$NEW_RELEASE" "$CURRENT_LINK"

log "Restarting launchd service"

launchctl kickstart -k "gui/$(id -u)/$SERVICE_LABEL"

success "Deployment completed"

echo
echo "Current release:"
echo "  $CURRENT_LINK -> $NEW_RELEASE"
echo
echo "Deployment log:"
echo "  $LOG_FILE"
