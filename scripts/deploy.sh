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

PLIST="$HOME/Library/LaunchAgents/${SERVICE_LABEL}.plist"
GUI_DOMAIN="gui/$(id -u)"

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
    --delete \
    --exclude ".git" \
    --exclude ".DS_Store" \
    --exclude "releases" \
    --exclude "current" \
    --exclude "scripts" \
    --exclude "test" \
    --exclude "README.md" \
    "$PROJECT_ROOT/" \
    "$NEW_RELEASE/"

log "Updating current symlink"

ln -sfn "$NEW_RELEASE" "$CURRENT_LINK"

###############################################################################
# Restart launchd service
###############################################################################

log "Starting / restarting launchd service"

if [[ ! -f "$PLIST" ]]; then
    error "LaunchAgent plist not found:"
    error "  $PLIST"
    exit 1
fi

# Is the job already loaded?
if launchctl list | awk '{print $3}' | grep -Fxq "$SERVICE_LABEL"; then
    log "Service already loaded"

    launchctl kickstart -kp "$GUI_DOMAIN/$SERVICE_LABEL"

else
    log "Service not loaded"

    launchctl bootstrap "$GUI_DOMAIN" "$PLIST"

    launchctl kickstart -kp "$GUI_DOMAIN/$SERVICE_LABEL"
fi

success "Launch agent running"

###############################################################################
# Done
###############################################################################

success "Deployment completed"

echo
echo "Current release:"
echo "  $CURRENT_LINK -> $NEW_RELEASE"
echo
echo "Deployment log:"
echo "  $LOG_FILE"
