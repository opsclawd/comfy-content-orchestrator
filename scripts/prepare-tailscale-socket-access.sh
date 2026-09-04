#!/bin/bash
# ==============================================================================
# prepare-tailscale-socket-access.sh
# Idempotent host preparation script for Review Hub Tailscale socket access.
# Creates host group tailscale-ro (GID 9999) if absent, sets group ownership
# and rw permissions on /var/run/tailscale/tailscaled.sock, and installs a
# systemd drop-in to maintain socket permissions across tailscaled restarts.
# ==============================================================================
set -euo pipefail

SOCKET_PATH="${TAILSCALE_SOCKET_PATH:-/var/run/tailscale/tailscaled.sock}"
GROUP_NAME="tailscale-ro"
GROUP_GID="9999"
SYSTEMD_OVERRIDE_DIR="${SYSTEMD_OVERRIDE_DIR:-/etc/systemd/system/tailscaled.service.d}"
SKIP_SYSTEMD="${SKIP_SYSTEMD:-0}"
REVIEW_HUB_COMPOSE_FILE="${REVIEW_HUB_COMPOSE_FILE:-/opt/comfy-content-orchestrator/compose.yaml}"
REVIEW_HUB_SERVICE="${REVIEW_HUB_SERVICE:-review-hub}"

if [ "${EUID:-$(id -u)}" -ne 0 ] && [ "${ALLOW_NON_ROOT:-0}" -ne 1 ]; then
  echo "Error: This script must be run as root (or with sudo) to modify groups and socket permissions." >&2
  exit 1
fi

# 1. Bidirectional group-name and GID verification
existing_gid=$(getent group "$GROUP_NAME" 2>/dev/null | cut -d: -f3 || true)
if [ -n "$existing_gid" ] && [ "$existing_gid" != "$GROUP_GID" ]; then
  echo "Error: Group '${GROUP_NAME}' already exists with GID ${existing_gid}, expected GID ${GROUP_GID}." >&2
  exit 1
fi

existing_group_name=$(getent group "$GROUP_GID" 2>/dev/null | cut -d: -f1 || true)
if [ -n "$existing_group_name" ] && [ "$existing_group_name" != "$GROUP_NAME" ]; then
  echo "Error: GID ${GROUP_GID} is already occupied by group '${existing_group_name}', expected '${GROUP_NAME}'." >&2
  exit 1
fi

if [ -z "$existing_gid" ] && [ -z "$existing_group_name" ]; then
  echo "Creating group '${GROUP_NAME}' with GID ${GROUP_GID}..."
  groupadd -g "$GROUP_GID" "$GROUP_NAME"
else
  echo "Group '${GROUP_NAME}' with GID ${GROUP_GID} already exists."
fi

# Verify bidirectional mapping
resolved_gid=$(getent group "$GROUP_NAME" 2>/dev/null | cut -d: -f3 || true)
resolved_name=$(getent group "$GROUP_GID" 2>/dev/null | cut -d: -f1 || true)
if [ "$resolved_gid" != "$GROUP_GID" ] || [ "$resolved_name" != "$GROUP_NAME" ]; then
  echo "Error: Group verification failed: '${GROUP_NAME}' does not map bidirectionally to GID ${GROUP_GID}." >&2
  exit 1
fi

# 2. Socket existence and Unix domain socket check
if [ ! -e "$SOCKET_PATH" ]; then
  echo "Error: Socket path '${SOCKET_PATH}' does not exist. Ensure tailscaled is running." >&2
  exit 1
fi

if [ ! -S "$SOCKET_PATH" ]; then
  echo "Error: Path '${SOCKET_PATH}' exists but is not a Unix domain socket." >&2
  exit 1
fi

# 3. Configure permissions and verify numeric group ownership
echo "Setting group ownership to '${GROUP_NAME}' (${GROUP_GID}) and mode to g+rw on ${SOCKET_PATH}..."
chgrp "$GROUP_GID" "$SOCKET_PATH"
chmod g+rw "$SOCKET_PATH"

actual_socket_gid=$(stat -c '%g' "$SOCKET_PATH" 2>/dev/null || stat -f '%g' "$SOCKET_PATH" 2>/dev/null || true)
if [ "$actual_socket_gid" != "$GROUP_GID" ]; then
  echo "Error: Socket group ownership verification failed: got GID ${actual_socket_gid}, expected ${GROUP_GID}." >&2
  exit 1
fi

echo "Tailscale socket permissions successfully configured."

# 4. Lifecycle-aware systemd drop-in configuration
if [ "$SKIP_SYSTEMD" -ne 1 ]; then
  if [ -d "/etc/systemd/system" ] || [ -n "${SYSTEMD_OVERRIDE_DIR:-}" ]; then
    echo "Installing systemd drop-in for tailscaled socket permissions persistence..."
    mkdir -p "$SYSTEMD_OVERRIDE_DIR"
    cat > "${SYSTEMD_OVERRIDE_DIR}/10-socket-permissions.conf" <<EOF
[Service]
ExecStartPost=/bin/sh -c 'while [ ! -S ${SOCKET_PATH} ]; do sleep 0.1; done; chgrp ${GROUP_GID} ${SOCKET_PATH} && chmod g+rw ${SOCKET_PATH}'
ExecStartPost=-/usr/bin/docker compose -f ${REVIEW_HUB_COMPOSE_FILE} restart ${REVIEW_HUB_SERVICE}
EOF
    if command -v systemctl >/dev/null 2>&1; then
      systemctl daemon-reload || true
    fi
  fi
fi

echo "Acceptance gate command: docker compose exec -u node review-hub tailscale whois --json <a real connected tailnet peer ip>"
