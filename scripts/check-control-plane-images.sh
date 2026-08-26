#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# check-control-plane-images.sh
# Validates production container images for Control API and Review Hub:
# 1. Builds reproducible Node 24 images with unprivileged non-root runtime users
# 2. Excludes development dependencies, compiler tools, and git metadata from runtime
# 3. Packages complete standalone and workspace runtime closures
# 4. Guarantees trap-based cleanup of temporary inspection containers and images
# ==============================================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TAG_SUFFIX="check-$$-${RANDOM}"
CONTROL_API_IMG="cco-control-api:${TAG_SUFFIX}"
WEB_IMG="cco-web:${TAG_SUFFIX}"

TEMP_CONTAINERS=()
TEMP_IMAGES=("$CONTROL_API_IMG" "$WEB_IMG")
TEMP_DIRS=()

cleanup() {
  local exit_code=$?
  echo "==> Cleaning up temporary inspection resources..."

  for cid in "${TEMP_CONTAINERS[@]:-}"; do
    if [ -n "$cid" ]; then
      docker rm -f "$cid" >/dev/null 2>&1 || true
    fi
  done

  for img in "${TEMP_IMAGES[@]:-}"; do
    if [ -n "$img" ]; then
      docker rmi -f "$img" >/dev/null 2>&1 || true
    fi
  done

  for d in "${TEMP_DIRS[@]:-}"; do
    if [ -n "$d" ] && [ -d "$d" ]; then
      rm -rf "$d" >/dev/null 2>&1 || true
    fi
  done

  if [ "$exit_code" -eq 0 ]; then
    echo "==> Cleanup complete. All checks passed successfully."
  else
    echo "==> Cleanup complete after failure (exit code: $exit_code)."
  fi
  exit "$exit_code"
}

trap cleanup EXIT INT TERM HUP

echo "======================================================================"
echo "Starting Control-Plane Container Image Verification"
echo "======================================================================"

# ------------------------------------------------------------------------------
# Invariant 4: guarantees trap-based cleanup of temporary inspection containers and images
# ------------------------------------------------------------------------------
echo "==> TEST: guarantees trap-based cleanup of temporary inspection containers and images"

# Verify that the script's actual cleanup handler cleans up containers, images, and temp directories
TRAP_TEST_CONT="cco-trap-test-c-${TAG_SUFFIX}"
TRAP_TEST_IMG="cco-trap-test-i-${TAG_SUFFIX}"
TRAP_TEST_DIR=$(mktemp -d "${TMPDIR:-/tmp}/cco-trap-test-XXXXXX")

(
  # Register the script's actual cleanup handler on subshell exit
  trap cleanup EXIT
  TEMP_CONTAINERS+=("$TRAP_TEST_CONT")
  TEMP_IMAGES+=("$TRAP_TEST_IMG")
  TEMP_DIRS+=("$TRAP_TEST_DIR")

  docker create --name "$TRAP_TEST_CONT" node:24-alpine sleep 10 >/dev/null 2>&1
  docker tag node:24-alpine "$TRAP_TEST_IMG" >/dev/null 2>&1

  # Subshell exits, triggering the script's actual cleanup() handler
  exit 0
) >/dev/null 2>&1

# Assert that TRAP_TEST_CONT, TRAP_TEST_IMG, and TRAP_TEST_DIR were cleaned up by cleanup()
if docker inspect "$TRAP_TEST_CONT" >/dev/null 2>&1; then
  echo "FAIL: Trap did not clean up temporary container $TRAP_TEST_CONT"
  docker rm -f "$TRAP_TEST_CONT" >/dev/null 2>&1 || true
  exit 1
fi

if docker inspect "$TRAP_TEST_IMG" >/dev/null 2>&1; then
  echo "FAIL: Trap did not clean up temporary image $TRAP_TEST_IMG"
  docker rmi -f "$TRAP_TEST_IMG" >/dev/null 2>&1 || true
  exit 1
fi

if [ -d "$TRAP_TEST_DIR" ]; then
  echo "FAIL: Trap did not clean up temporary directory $TRAP_TEST_DIR"
  rm -rf "$TRAP_TEST_DIR" >/dev/null 2>&1 || true
  exit 1
fi

echo "  PASS: guarantees trap-based cleanup of temporary inspection containers and images"

# ------------------------------------------------------------------------------
# Build images from repository root context
# ------------------------------------------------------------------------------
echo "==> Building Control API image: $CONTROL_API_IMG from apps/control-api/Dockerfile"
if [ ! -f "apps/control-api/Dockerfile" ]; then
  echo "FAIL: apps/control-api/Dockerfile does not exist"
  exit 1
fi
docker build -f apps/control-api/Dockerfile -t "$CONTROL_API_IMG" .

echo "==> Building Review Hub image: $WEB_IMG from apps/web/Dockerfile"
if [ ! -f "apps/web/Dockerfile" ]; then
  echo "FAIL: apps/web/Dockerfile does not exist"
  exit 1
fi
docker build -f apps/web/Dockerfile -t "$WEB_IMG" .

# ------------------------------------------------------------------------------
# Invariant 1: builds reproducible Node 24 images with unprivileged non-root runtime users
# ------------------------------------------------------------------------------
echo "==> TEST: builds reproducible Node 24 images with unprivileged non-root runtime users"

# Check Control API image user
API_USER=$(docker inspect --format '{{.Config.User}}' "$CONTROL_API_IMG")
if [ -z "$API_USER" ] || [ "$API_USER" = "root" ] || [ "$API_USER" = "0" ] || [ "$API_USER" = "0:0" ]; then
  echo "FAIL: Control API image .Config.User is '$API_USER' (expected non-root user like 'node')"
  exit 1
fi

# Check Web image user
WEB_USER=$(docker inspect --format '{{.Config.User}}' "$WEB_IMG")
if [ -z "$WEB_USER" ] || [ "$WEB_USER" = "root" ] || [ "$WEB_USER" = "0" ] || [ "$WEB_USER" = "0:0" ]; then
  echo "FAIL: Web image .Config.User is '$WEB_USER' (expected non-root user like 'node')"
  exit 1
fi

# Check Control API runtime UID and Node major version
API_UID_CHECK=$(docker run --rm "$CONTROL_API_IMG" id -u)
if [ "$API_UID_CHECK" = "0" ]; then
  echo "FAIL: Control API runtime UID is 0 (root)"
  exit 1
fi

API_NODE_VER=$(docker run --rm "$CONTROL_API_IMG" node -v)
if [[ ! "$API_NODE_VER" =~ ^v24\. ]]; then
  echo "FAIL: Control API Node version is '$API_NODE_VER' (expected major version 24)"
  exit 1
fi

# Check Web runtime UID and Node major version
WEB_UID_CHECK=$(docker run --rm "$WEB_IMG" id -u)
if [ "$WEB_UID_CHECK" = "0" ]; then
  echo "FAIL: Web runtime UID is 0 (root)"
  exit 1
fi

WEB_NODE_VER=$(docker run --rm "$WEB_IMG" node -v)
if [[ ! "$WEB_NODE_VER" =~ ^v24\. ]]; then
  echo "FAIL: Web Node version is '$WEB_NODE_VER' (expected major version 24)"
  exit 1
fi

echo "  PASS: builds reproducible Node 24 images with unprivileged non-root runtime users (Control API: user=$API_USER uid=$API_UID_CHECK node=$API_NODE_VER; Web: user=$WEB_USER uid=$WEB_UID_CHECK node=$WEB_NODE_VER)"

# ------------------------------------------------------------------------------
# Invariant 2: excludes development dependencies compiler tools and git metadata from runtime
# ------------------------------------------------------------------------------
echo "==> TEST: excludes development dependencies compiler tools and git metadata from runtime"

for IMG in "$CONTROL_API_IMG" "$WEB_IMG"; do
  # Check absence of typescript package in node_modules
  TS_MODULES=$(docker run --rm "$IMG" sh -c "find /app/node_modules -name 'typescript' -type d -exec test -f '{}/package.json' \; -print 2>/dev/null" || true)
  if [ -n "$TS_MODULES" ]; then
    echo "FAIL: Found typescript package in $IMG runtime: $TS_MODULES"
    exit 1
  fi

  # Check absence of vitest package in node_modules
  VITEST_MODULES=$(docker run --rm "$IMG" sh -c "find /app/node_modules -name 'vitest' -type d -exec test -f '{}/package.json' \; -print 2>/dev/null" || true)
  if [ -n "$VITEST_MODULES" ]; then
    echo "FAIL: Found vitest package in $IMG runtime: $VITEST_MODULES"
    exit 1
  fi

  # Check absence of compiler/test binaries (tsc, vitest, eslint, prettier)
  COMPILERS=$(docker run --rm "$IMG" sh -c "which tsc vitest eslint prettier 2>/dev/null || find /app -name tsc -o -name vitest -o -name eslint -o -name prettier 2>/dev/null" || true)
  if [ -n "$COMPILERS" ]; then
    echo "FAIL: Found compiler/test binary in $IMG: $COMPILERS"
    exit 1
  fi

  # Check absence of .git and .githooks
  GIT_METADATA=$(docker run --rm "$IMG" sh -c "[ -d /app/.git ] || [ -d /app/.githooks ] && echo 'found' || true")
  if [ "$GIT_METADATA" = "found" ]; then
    echo "FAIL: Found .git or .githooks metadata in $IMG"
    exit 1
  fi

  # Check absence of source trees (src directories) outside node_modules
  SRC_DIRS=$(docker run --rm "$IMG" sh -c "find /app -not -path '*/node_modules/*' -type d -name 'src' 2>/dev/null" || true)
  if [ -n "$SRC_DIRS" ]; then
    echo "FAIL: Found src directory in $IMG runtime outside node_modules: $SRC_DIRS"
    exit 1
  fi

  # Check absence of uncompiled .ts source files (excluding .d.ts if any) outside node_modules
  TS_FILES=$(docker run --rm "$IMG" sh -c "find /app -not -path '*/node_modules/*' -type f -name '*.ts' ! -name '*.d.ts' 2>/dev/null" || true)
  if [ -n "$TS_FILES" ]; then
    echo "FAIL: Found uncompiled .ts files in $IMG runtime outside node_modules: $TS_FILES"
    exit 1
  fi

  # Check absence of tsbuildinfo files
  TSBUILDINFO=$(docker run --rm "$IMG" sh -c "find /app -type f -name '*.tsbuildinfo' 2>/dev/null" || true)
  if [ -n "$TSBUILDINFO" ]; then
    echo "FAIL: Found .tsbuildinfo files in $IMG runtime: $TSBUILDINFO"
    exit 1
  fi
done

echo "  PASS: excludes development dependencies compiler tools and git metadata from runtime"

# ------------------------------------------------------------------------------
# Invariant 3: packages complete standalone and workspace runtime closures
# ------------------------------------------------------------------------------
echo "==> TEST: packages complete standalone and workspace runtime closures"

# 1. Check Control API closure
# Verify dist/bootstrap.js exists
docker run --rm "$CONTROL_API_IMG" test -f /app/dist/bootstrap.js || {
  echo "FAIL: Control API missing /app/dist/bootstrap.js"
  exit 1
}

# Verify workspace packages exist
for pkg in application contracts domain infrastructure shared; do
  docker run --rm "$CONTROL_API_IMG" test -d "/app/node_modules/@cco/$pkg" || {
    echo "FAIL: Control API missing workspace dependency @cco/$pkg"
    exit 1
  }
done

# Verify migrations directory and migration files exist in infrastructure package
docker run --rm "$CONTROL_API_IMG" test -f /app/node_modules/@cco/infrastructure/migrations/001_baseline.sql || {
  echo "FAIL: Control API missing migrations in infrastructure package"
  exit 1
}

# Verify migration runner exists
docker run --rm "$CONTROL_API_IMG" test -f /app/node_modules/@cco/infrastructure/dist/postgres/migrate.js || {
  echo "FAIL: Control API missing migration runner"
  exit 1
}

# Test that bootstrap fails closed on missing env without MODULE_NOT_FOUND
API_BOOTSTRAP_OUTPUT=$(docker run --rm "$CONTROL_API_IMG" node dist/bootstrap.js 2>&1 || true)
if echo "$API_BOOTSTRAP_OUTPUT" | grep -q -E "MODULE_NOT_FOUND|Cannot find module|SyntaxError"; then
  echo "FAIL: Control API bootstrap crashed with module resolution error: $API_BOOTSTRAP_OUTPUT"
  exit 1
fi
if ! echo "$API_BOOTSTRAP_OUTPUT" | grep -q -E "DATABASE_URL|DATABASE_APP_ROLE|S3_STORAGE_ENDPOINT|S3_ACCESS_KEY|Configuration error"; then
  echo "FAIL: Control API bootstrap did not fail closed with expected configuration error: $API_BOOTSTRAP_OUTPUT"
  exit 1
fi

# Test that migration runner fails closed on missing DATABASE_URL without MODULE_NOT_FOUND
API_MIGRATE_OUTPUT=$(docker run --rm "$CONTROL_API_IMG" node node_modules/@cco/infrastructure/dist/postgres/migrate.js 2>&1 || true)
if echo "$API_MIGRATE_OUTPUT" | grep -q -E "MODULE_NOT_FOUND|Cannot find module|SyntaxError"; then
  echo "FAIL: Migration runner crashed with module resolution error: $API_MIGRATE_OUTPUT"
  exit 1
fi
if ! echo "$API_MIGRATE_OUTPUT" | grep -q "DATABASE_URL environment variable is required"; then
  echo "FAIL: Migration runner did not fail closed with DATABASE_URL error: $API_MIGRATE_OUTPUT"
  exit 1
fi

# 2. Check Review Hub (Web) standalone closure
# Verify server.js exists
docker run --rm "$WEB_IMG" sh -c "[ -f /app/apps/web/server.js ] || [ -f /app/server.js ]" || {
  echo "FAIL: Review Hub missing standalone server.js"
  exit 1
}

# Verify .next/static exists and contains chunks
docker run --rm "$WEB_IMG" sh -c "[ -d /app/apps/web/.next/static ] || [ -d /app/.next/static ]" || {
  echo "FAIL: Review Hub missing .next/static"
  exit 1
}

# Verify public directory is present
docker run --rm "$WEB_IMG" sh -c "[ -d /app/apps/web/public ] || [ -d /app/public ]" || {
  echo "FAIL: Review Hub missing public directory"
  exit 1
}

# Test that Review Hub container executes CMD and serves HTTP traffic without immediate startup crashes
WEB_TEST_CONT="cco-web-test-${TAG_SUFFIX}"
TEMP_CONTAINERS+=("$WEB_TEST_CONT")
docker run -d --name "$WEB_TEST_CONT" "$WEB_IMG" >/dev/null

READY=false
for _ in {1..20}; do
  if ! docker ps -q --no-trunc | grep -q "$(docker inspect --format '{{.Id}}' "$WEB_TEST_CONT" 2>/dev/null)"; then
    WEB_LOGS=$(docker logs "$WEB_TEST_CONT" 2>&1 || true)
    echo "FAIL: Review Hub container crashed immediately on startup: $WEB_LOGS"
    exit 1
  fi

  if docker exec "$WEB_TEST_CONT" wget -q -O /dev/null http://127.0.0.1:3000/ 2>/dev/null; then
    READY=true
    break
  fi
  sleep 0.5
done

if [ "$READY" != "true" ]; then
  WEB_LOGS=$(docker logs "$WEB_TEST_CONT" 2>&1 || true)
  echo "FAIL: Review Hub container failed to start and respond within timeout: $WEB_LOGS"
  exit 1
fi

docker rm -f "$WEB_TEST_CONT" >/dev/null 2>&1 || true

echo "  PASS: packages complete standalone and workspace runtime closures"

echo "======================================================================"
echo "All Control-Plane Container Image Checks Passed!"
echo "======================================================================"
