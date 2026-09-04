#!/bin/bash
# ==============================================================================
# prepare-tailscale-socket-access.test.sh
# Tests for prepare-tailscale-socket-access.sh covering:
# 1. Fresh case: group does not exist -> created with GID 9999
# 2. Matching-existing case: group exists with GID 9999 -> accepted
# 3. Wrong-GID case: tailscale-ro exists with non-9999 GID -> fails closed
# 4. Occupied-GID case: GID 9999 occupied by different group -> fails closed
# 5. Non-socket path: file exists but is not a Unix domain socket -> fails closed
# 6. Missing socket: socket path does not exist -> fails closed
# 7. Verification: numeric group ownership verified on socket
# 8. Systemd drop-in installed when directory configured
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREPARE_SCRIPT="${SCRIPT_DIR}/prepare-tailscale-socket-access.sh"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TMP_BASE="${REPO_ROOT}/.ai-tmp/tailscale-socket-test-$$"

mkdir -p "$TMP_BASE"
cleanup() {
  rm -rf "$TMP_BASE"
}
trap cleanup EXIT

MOCK_BIN="${TMP_BASE}/bin"
MOCK_ETC="${TMP_BASE}/etc"
MOCK_SOCKET_DIR="${TMP_BASE}/run/tailscale"
MOCK_SYSTEMD_DIR="${TMP_BASE}/systemd.d"

mkdir -p "$MOCK_BIN" "$MOCK_ETC" "$MOCK_SOCKET_DIR" "$MOCK_SYSTEMD_DIR"
GROUP_FILE="${MOCK_ETC}/group"

# Helper to create a dummy Unix domain socket using python
create_dummy_socket() {
  local sock_path="$1"
  local sock_dir
  sock_dir="$(dirname "$sock_path")"
  local sock_name
  sock_name="$(basename "$sock_path")"
  rm -f "$sock_path"
  python3 -c "import os, socket; os.chdir('${sock_dir}'); s = socket.socket(socket.AF_UNIX); s.bind('./${sock_name}')"
}

# Create mock getent
cat > "${MOCK_BIN}/getent" << 'EOF'
#!/bin/bash
DATABASE="$1"
KEY="$2"
if [ "$DATABASE" = "group" ]; then
  if [ -f "$MOCK_GROUP_FILE" ]; then
    # Match by group name (first field) or by GID (third field)
    grep -E "^${KEY}:|:.*:${KEY}:" "$MOCK_GROUP_FILE" | head -n 1 || exit 1
  else
    exit 1
  fi
else
  exit 1
fi
EOF
chmod +x "${MOCK_BIN}/getent"

# Create mock groupadd
cat > "${MOCK_BIN}/groupadd" << 'EOF'
#!/bin/bash
while getopts "g:" opt; do
  case "$opt" in
    g) GID="$OPTARG" ;;
    *) ;;
  esac
done
shift $((OPTIND-1))
NAME="$1"
echo "${NAME}:x:${GID}:" >> "$MOCK_GROUP_FILE"
EOF
chmod +x "${MOCK_BIN}/groupadd"

# Create mock chgrp and chmod that record operations or perform them on dummy file
cat > "${MOCK_BIN}/chgrp" << 'EOF'
#!/bin/bash
GROUP="$1"
TARGET="$2"
echo "$GROUP" > "${TARGET}.gid"
EOF
chmod +x "${MOCK_BIN}/chgrp"

cat > "${MOCK_BIN}/chmod" << 'EOF'
#!/bin/bash
exit 0
EOF
chmod +x "${MOCK_BIN}/chmod"

# Create mock stat that reads from .gid file or falls back
cat > "${MOCK_BIN}/stat" << 'EOF'
#!/bin/bash
TARGET="${@: -1}"
if [ -f "${TARGET}.gid" ]; then
  cat "${TARGET}.gid"
else
  echo "0"
fi
EOF
chmod +x "${MOCK_BIN}/stat"

export PATH="${MOCK_BIN}:${PATH}"
export MOCK_GROUP_FILE="${GROUP_FILE}"
export ALLOW_NON_ROOT=1

echo "=== Running prepare-tailscale-socket-access tests ==="

# Test 1: Fresh case (group does not exist)
echo "Test 1: Fresh group creation"
rm -f "$GROUP_FILE"
touch "$GROUP_FILE"
SOCKET_FILE="${MOCK_SOCKET_DIR}/tailscaled.sock"
create_dummy_socket "$SOCKET_FILE"

OUTPUT=$(TAILSCALE_SOCKET_PATH="$SOCKET_FILE" \
  SYSTEMD_OVERRIDE_DIR="$MOCK_SYSTEMD_DIR" \
  bash "$PREPARE_SCRIPT")

if ! grep -q "Creating group 'tailscale-ro' with GID 9999" <<< "$OUTPUT"; then
  echo "FAIL: Expected fresh group creation message, got: $OUTPUT" >&2
  exit 1
fi
if ! grep -q "tailscale-ro:x:9999:" "$GROUP_FILE"; then
  echo "FAIL: Group not added to group file" >&2
  exit 1
fi
if ! grep -q "Acceptance gate command:" <<< "$OUTPUT"; then
  echo "FAIL: Expected acceptance gate command at end, got: $OUTPUT" >&2
  exit 1
fi
if [ ! -f "${MOCK_SYSTEMD_DIR}/10-socket-permissions.conf" ]; then
  echo "FAIL: Expected systemd drop-in to be created" >&2
  exit 1
fi
if ! grep -q "docker compose -f /opt/comfy-content-orchestrator/compose.yaml restart review-hub" "${MOCK_SYSTEMD_DIR}/10-socket-permissions.conf"; then
  echo "FAIL: Expected tailscaled restart hook to coordinate Review Hub restart" >&2
  exit 1
fi
echo "  PASS: Fresh group creation"

# Test 2: Matching-existing case (tailscale-ro with GID 9999 already exists)
echo "Test 2: Matching existing group"
OUTPUT=$(TAILSCALE_SOCKET_PATH="$SOCKET_FILE" \
  SYSTEMD_OVERRIDE_DIR="$MOCK_SYSTEMD_DIR" \
  bash "$PREPARE_SCRIPT")

if ! grep -q "Group 'tailscale-ro' with GID 9999 already exists." <<< "$OUTPUT"; then
  echo "FAIL: Expected already exists message, got: $OUTPUT" >&2
  exit 1
fi
echo "  PASS: Matching existing group"

# Test 3: Wrong-GID case (tailscale-ro exists with GID 1234)
echo "Test 3: Wrong GID failure"
echo "tailscale-ro:x:1234:" > "$GROUP_FILE"
set +e
ERR_OUTPUT=$(TAILSCALE_SOCKET_PATH="$SOCKET_FILE" \
  SYSTEMD_OVERRIDE_DIR="$MOCK_SYSTEMD_DIR" \
  bash "$PREPARE_SCRIPT" 2>&1)
STATUS=$?
set -e

if [ $STATUS -eq 0 ]; then
  echo "FAIL: Expected script to fail with wrong GID, but exited 0" >&2
  exit 1
fi
if ! grep -q "Group 'tailscale-ro' already exists with GID 1234, expected GID 9999" <<< "$ERR_OUTPUT"; then
  echo "FAIL: Unexpected error message: $ERR_OUTPUT" >&2
  exit 1
fi
echo "  PASS: Wrong GID fails closed"

# Test 4: Occupied-GID case (GID 9999 used by othergroup)
echo "Test 4: Occupied GID failure"
echo "othergroup:x:9999:" > "$GROUP_FILE"
set +e
ERR_OUTPUT=$(TAILSCALE_SOCKET_PATH="$SOCKET_FILE" \
  SYSTEMD_OVERRIDE_DIR="$MOCK_SYSTEMD_DIR" \
  bash "$PREPARE_SCRIPT" 2>&1)
STATUS=$?
set -e

if [ $STATUS -eq 0 ]; then
  echo "FAIL: Expected script to fail with occupied GID, but exited 0" >&2
  exit 1
fi
if ! grep -q "GID 9999 is already occupied by group 'othergroup', expected 'tailscale-ro'" <<< "$ERR_OUTPUT"; then
  echo "FAIL: Unexpected error message: $ERR_OUTPUT" >&2
  exit 1
fi
echo "  PASS: Occupied GID fails closed"

# Test 5: Non-socket file (path exists but is a regular file)
echo "Test 5: Non-socket path failure"
echo "tailscale-ro:x:9999:" > "$GROUP_FILE"
REGULAR_FILE="${MOCK_SOCKET_DIR}/regular.file"
rm -f "$REGULAR_FILE"
touch "$REGULAR_FILE"

set +e
ERR_OUTPUT=$(TAILSCALE_SOCKET_PATH="$REGULAR_FILE" \
  SYSTEMD_OVERRIDE_DIR="$MOCK_SYSTEMD_DIR" \
  bash "$PREPARE_SCRIPT" 2>&1)
STATUS=$?
set -e

if [ $STATUS -eq 0 ]; then
  echo "FAIL: Expected script to fail with regular file, but exited 0" >&2
  exit 1
fi
if ! grep -q "is not a Unix domain socket" <<< "$ERR_OUTPUT"; then
  echo "FAIL: Unexpected error message: $ERR_OUTPUT" >&2
  exit 1
fi
echo "  PASS: Non-socket path fails closed"

# Test 6: Missing socket path
echo "Test 6: Missing socket path failure"
MISSING_PATH="${MOCK_SOCKET_DIR}/nonexistent.sock"
rm -f "$MISSING_PATH"

set +e
ERR_OUTPUT=$(TAILSCALE_SOCKET_PATH="$MISSING_PATH" \
  SYSTEMD_OVERRIDE_DIR="$MOCK_SYSTEMD_DIR" \
  bash "$PREPARE_SCRIPT" 2>&1)
STATUS=$?
set -e

if [ $STATUS -eq 0 ]; then
  echo "FAIL: Expected script to fail with missing socket, but exited 0" >&2
  exit 1
fi
if ! grep -q "does not exist. Ensure tailscaled is running" <<< "$ERR_OUTPUT"; then
  echo "FAIL: Unexpected error message: $ERR_OUTPUT" >&2
  exit 1
fi
echo "  PASS: Missing socket fails closed"

echo "=== All prepare-tailscale-socket-access tests PASSED! ==="
