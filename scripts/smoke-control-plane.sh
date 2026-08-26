#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# smoke-control-plane.sh
# Teardown-safe local connectivity smoke harness for Control Plane:
# 1. Unconditional idempotent cleanup of containers, networks, and test volumes
# 2. Bounded health polling with explicit attempt budget and backoff intervals
# 3. Dependency connectivity proof (Control API health, database read, S3 readiness, Review Hub SSR)
# 4. Console-independent smoke success (MinIO console port 9001 absent from host)
# ==============================================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# ------------------------------------------------------------------------------
# Self-test hook: when invoked with CCO_SMOKE_SELFTEST_CLEANUP=1, create
# synthetic compose resources and exit immediately so the top-level trap
# performs the actual cleanup this script relies on.
# ------------------------------------------------------------------------------
if [ "${CCO_SMOKE_SELFTEST_CLEANUP:-}" = "1" ]; then
  SELFTEST_PROJECT="cco-smoke-selftest-$$-${RANDOM}"
  SELFTEST_DIR=$(mktemp -d "${TMPDIR:-/tmp}/cco-smoke-selftest-XXXXXX")

  cleanup_selftest() {
    local code=$?
    docker compose -p "$SELFTEST_PROJECT" -f - down -v --remove-orphans >/dev/null 2>&1 <<'EOF' || true
services:
  dummy:
    image: alpine:latest
    command: sleep 60
volumes:
  test_vol:
EOF
    if [ -d "$SELFTEST_DIR" ]; then
      rm -rf "$SELFTEST_DIR" >/dev/null 2>&1 || true
    fi
    exit "$code"
  }
  trap cleanup_selftest EXIT INT TERM HUP

  docker compose -p "$SELFTEST_PROJECT" -f - up -d >/dev/null 2>&1 <<'EOF'
services:
  dummy:
    image: alpine:latest
    command: sleep 60
volumes:
  test_vol:
EOF

  echo "$SELFTEST_PROJECT $SELFTEST_DIR"
  exit 42
fi

# ------------------------------------------------------------------------------
# Helpers: Port allocation & probing
# ------------------------------------------------------------------------------
find_free_port() {
  node -e '
    const net = require("net");
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      console.log(s.address().port);
      s.close();
    });
  '
}

is_port_listening() {
  local port="$1"
  node -e "
    const net = require('net');
    const client = net.connect({ host: '127.0.0.1', port: $port }, () => {
      client.destroy();
      process.exit(0);
    });
    client.on('error', () => process.exit(1));
    client.setTimeout(1000, () => {
      client.destroy();
      process.exit(1);
    });
  " >/dev/null 2>&1
}

# ------------------------------------------------------------------------------
# Helper: Bounded condition polling
# ------------------------------------------------------------------------------
wait_for_condition() {
  local label="$1"
  local timeout_seconds="$2"
  local interval_seconds="$3"
  shift 3

  local elapsed=0
  while [ "$elapsed" -lt "$timeout_seconds" ]; do
    if "$@" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$interval_seconds"
    elapsed=$((elapsed + interval_seconds))
  done

  echo "ERROR: Timed out waiting for '$label' after ${timeout_seconds}s" >&2
  return 1
}

# ------------------------------------------------------------------------------
# Setup Main Project and Temporary Sandbox Directory
# ------------------------------------------------------------------------------
PROJECT_NAME="cco-smoke-$$-${RANDOM}"
TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/cco-smoke-XXXXXX")
ENV_FILE="${TEMP_DIR}/.env"
OVERRIDE_FILE="${TEMP_DIR}/compose.override.yaml"
INIT_SQL_FILE="${TEMP_DIR}/01-init-app-role.sql"

CLEANUP_CALLED=0
cleanup() {
  local exit_code=$?
  if [ "$CLEANUP_CALLED" -eq 1 ]; then
    return
  fi
  CLEANUP_CALLED=1

  echo "==> Cleaning up smoke harness resources (project: $PROJECT_NAME)..."

  if [ -f "$OVERRIDE_FILE" ] && [ -f "$ENV_FILE" ]; then
    docker compose -p "$PROJECT_NAME" --env-file "$ENV_FILE" -f compose.yaml -f "$OVERRIDE_FILE" down -v --remove-orphans >/dev/null 2>&1 || true
  else
    docker compose -p "$PROJECT_NAME" down -v --remove-orphans >/dev/null 2>&1 || true
  fi

  # Invariant: Scoped cleanup assertion
  local remaining
  remaining=$(docker compose -p "$PROJECT_NAME" ps -a -q 2>/dev/null || true)
  if [ -n "$remaining" ]; then
    echo "WARNING: Forcing removal of remaining containers: $remaining" >&2
    docker rm -f $remaining >/dev/null 2>&1 || true
  fi

  if [ -n "${TEMP_DIR:-}" ] && [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR" >/dev/null 2>&1 || true
  fi

  if [ "$exit_code" -eq 0 ]; then
    echo "==> Cleanup complete. All smoke checks succeeded."
  else
    echo "==> Cleanup complete after failure (exit code: $exit_code)."
  fi
  exit "$exit_code"
}

trap cleanup EXIT INT TERM HUP

echo "======================================================================"
echo "Starting Control-Plane Local Connectivity Smoke Harness"
echo "Project: $PROJECT_NAME"
echo "======================================================================"

# ------------------------------------------------------------------------------
# Invariant 1: unconditional idempotent cleanup
# ------------------------------------------------------------------------------
echo "==> TEST: tears down containers networks and named test volumes after success or failure"

SELFTEST_OUTPUT=$(CCO_SMOKE_SELFTEST_CLEANUP=1 bash "${BASH_SOURCE[0]}" 2>/dev/null || true)
read -r ST_PROJECT ST_DIR <<<"$SELFTEST_OUTPUT"

if [ -z "$ST_PROJECT" ] || [ -z "$ST_DIR" ]; then
  echo "FAIL: Self-test invocation did not return expected project identifiers"
  exit 1
fi

ST_CONTAINERS=$(docker compose -p "$ST_PROJECT" ps -a -q 2>/dev/null || true)
if [ -n "$ST_CONTAINERS" ]; then
  echo "FAIL: Self-test containers were not cleaned up by trap: $ST_CONTAINERS"
  exit 1
fi

ST_VOLUMES=$(docker volume ls -q -f "name=${ST_PROJECT}" 2>/dev/null || true)
if [ -n "$ST_VOLUMES" ]; then
  echo "FAIL: Self-test volumes were not cleaned up by trap: $ST_VOLUMES"
  exit 1
fi

ST_NETWORKS=$(docker network ls -q -f "name=${ST_PROJECT}" 2>/dev/null || true)
if [ -n "$ST_NETWORKS" ]; then
  echo "FAIL: Self-test networks were not cleaned up by trap: $ST_NETWORKS"
  exit 1
fi

if [ -d "$ST_DIR" ]; then
  echo "FAIL: Self-test temporary directory was not removed by trap: $ST_DIR"
  exit 1
fi

echo "  PASS: tears down containers networks and named test volumes after success or failure"

# ------------------------------------------------------------------------------
# Invariant 2: bounded health polling
# ------------------------------------------------------------------------------
echo "==> TEST: waits for health rather than fixed sleeps"

# Test 2a: verify early exit on success
MOCK_POLL_FILE="${TEMP_DIR}/mock_poll_count"
echo "0" > "$MOCK_POLL_FILE"

mock_file_early_success() {
  local count
  count=$(cat "$MOCK_POLL_FILE")
  count=$((count + 1))
  echo "$count" > "$MOCK_POLL_FILE"
  [ "$count" -ge 2 ]
}

START_TIME=$(date +%s)
wait_for_condition "mock early success" 60 1 mock_file_early_success
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

if [ "$DURATION" -ge 10 ]; then
  echo "FAIL: Early success polling waited $DURATION seconds instead of exiting early"
  exit 1
fi

# Test 2b: verify bounded timeout on persistent failure
mock_always_fail() {
  return 1
}

START_TIME=$(date +%s)
if wait_for_condition "mock timeout" 2 1 mock_always_fail 2>/dev/null; then
  echo "FAIL: wait_for_condition succeeded when condition always fails"
  exit 1
fi
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

if [ "$DURATION" -lt 2 ] || [ "$DURATION" -gt 6 ]; then
  echo "FAIL: Timeout took $DURATION seconds (expected ~2-3s)"
  exit 1
fi

echo "  PASS: waits for health rather than fixed sleeps"

# ------------------------------------------------------------------------------
# Build / Ensure Required Application Images
# ------------------------------------------------------------------------------
if ! docker image inspect cco-control-api:latest >/dev/null 2>&1; then
  echo "==> Building Control API image: cco-control-api:latest..."
  docker build -f apps/control-api/Dockerfile -t cco-control-api:latest .
fi

if ! docker image inspect cco-web:latest >/dev/null 2>&1; then
  echo "==> Building Review Hub image: cco-web:latest..."
  docker build -f apps/web/Dockerfile -t cco-web:latest .
fi

# ------------------------------------------------------------------------------
# Allocate Loopback Ports and Render Temporary Configuration
# ------------------------------------------------------------------------------
S3_PORT=$(find_free_port)
CONTROL_API_PORT=$(find_free_port)
REVIEW_HUB_PORT=$(find_free_port)
MINIO_CONSOLE_PORT=$(find_free_port)

SYNTHETIC_POSTGRES_PASS="synthetic_smoke_pg_pwd_$RANDOM"
SYNTHETIC_APP_PASS="synthetic_smoke_app_pwd_$RANDOM"
SYNTHETIC_MINIO_ADMIN_PASS="synthetic_smoke_minio_pwd_$RANDOM"

# Tailnet hostnames are read from .env.example rather than inlined here, so
# this fixture can never drift from the canonical configuration it is meant
# to validate, and so scripts/check-control-plane.js's hardcoded-hostname
# scanner (which allowlists .env.example but not this executable script)
# has nothing to flag.
read_env_example_value() {
  local var_name="$1"
  grep "^${var_name}=" "$ROOT_DIR/.env.example" | head -1 | cut -d= -f2-
}
REVIEW_HUB_HOSTNAME=$(read_env_example_value REVIEW_HUB_HOSTNAME)
CONTROL_API_HOSTNAME=$(read_env_example_value CONTROL_API_HOSTNAME)
STORAGE_HOSTNAME=$(read_env_example_value STORAGE_HOSTNAME)
CONTROL_API_URL=$(read_env_example_value CONTROL_API_URL)

cat <<EOF > "$INIT_SQL_FILE"
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'godzspeed_app') THEN
    CREATE ROLE godzspeed_app WITH LOGIN PASSWORD '${SYNTHETIC_APP_PASS}' NOSUPERUSER NOCREATEDB NOCREATEROLE;
    GRANT CONNECT ON DATABASE godzspeed_orchestrator TO godzspeed_app;
  END IF;
END
\$\$;
EOF

cat <<EOF > "$ENV_FILE"
TAILNET_IP=127.0.0.1
OPERATOR_BIND_IP=127.0.0.1
CONTROL_API_PORT=${CONTROL_API_PORT}
REVIEW_HUB_PORT=${REVIEW_HUB_PORT}
S3_PORT=${S3_PORT}
MINIO_CONSOLE_PORT=${MINIO_CONSOLE_PORT}
REVIEW_HUB_HOSTNAME=${REVIEW_HUB_HOSTNAME}
CONTROL_API_HOSTNAME=${CONTROL_API_HOSTNAME}
STORAGE_HOSTNAME=${STORAGE_HOSTNAME}
POSTGRES_DB=godzspeed_orchestrator
POSTGRES_USER=postgres
POSTGRES_PASSWORD=${SYNTHETIC_POSTGRES_PASS}
DATABASE_MIGRATION_URL=postgresql://postgres:${SYNTHETIC_POSTGRES_PASS}@postgres:5432/godzspeed_orchestrator
DATABASE_APP_ROLE=godzspeed_app
DATABASE_APP_PASSWORD=${SYNTHETIC_APP_PASS}
DATABASE_URL=postgresql://godzspeed_app:${SYNTHETIC_APP_PASS}@postgres:5432/godzspeed_orchestrator
MINIO_ROOT_USER=synthetic_minio_admin
MINIO_ROOT_PASSWORD=${SYNTHETIC_MINIO_ADMIN_PASS}
S3_ACCESS_KEY_ID=synthetic_minio_admin
S3_SECRET_ACCESS_KEY=${SYNTHETIC_MINIO_ADMIN_PASS}
S3_STORAGE_ENDPOINT=http://minio:9000
S3_SIGNING_ENDPOINT=http://127.0.0.1:${S3_PORT}
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
S3_READINESS_BUCKET=godzspeed-review
S3_PRESIGNED_EXPIRY_SECONDS=300
CONTROL_API_HOST=0.0.0.0
CONTROL_API_URL=${CONTROL_API_URL}
CONTROL_API_TRUSTED_IDENTITY_PROXY_ADDRESSES=127.0.0.1
STORAGE_TELEMETRY_PATH=/var/lib/cco/storage-observation
NODE_ENV=production
POSTGRES_IMAGE=postgres:18.6
MINIO_IMAGE=minio/minio:RELEASE.2024-01-18T22-51-28Z
CONTROL_API_IMAGE=cco-control-api:latest
REVIEW_HUB_IMAGE=cco-web:latest
EOF

cat <<EOF > "$OVERRIDE_FILE"
services:
  postgres:
    environment:
      PGDATA: /var/lib/postgresql/data
    volumes:
      - ${INIT_SQL_FILE}:/docker-entrypoint-initdb.d/01-init-app-role.sql:ro
  minio:
    ports: !reset
      - mode: host
        protocol: tcp
        published: "${S3_PORT}"
        target: 9000
        host_ip: "127.0.0.1"
EOF

# ------------------------------------------------------------------------------
# Start Base Storage & Relational Services
# ------------------------------------------------------------------------------
echo "==> Starting PostgreSQL and MinIO services..."
docker compose -p "$PROJECT_NAME" --env-file "$ENV_FILE" -f compose.yaml -f "$OVERRIDE_FILE" up -d postgres minio

check_postgres_health() {
  local cid
  cid=$(docker compose -p "$PROJECT_NAME" --env-file "$ENV_FILE" -f compose.yaml -f "$OVERRIDE_FILE" ps -q postgres 2>/dev/null || true)
  [ -n "$cid" ] && [ "$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null)" = "healthy" ]
}

check_minio_health() {
  local cid
  cid=$(docker compose -p "$PROJECT_NAME" --env-file "$ENV_FILE" -f compose.yaml -f "$OVERRIDE_FILE" ps -q minio 2>/dev/null || true)
  [ -n "$cid" ] && [ "$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null)" = "healthy" ]
}

wait_for_condition "PostgreSQL container healthy" 60 1 check_postgres_health
wait_for_condition "MinIO container healthy" 60 1 check_minio_health

# Provision readiness bucket in MinIO
echo "==> Initializing S3 readiness bucket in MinIO..."
docker compose -p "$PROJECT_NAME" --env-file "$ENV_FILE" -f compose.yaml -f "$OVERRIDE_FILE" exec -T minio \
  mc alias set local http://127.0.0.1:9000 synthetic_minio_admin "$SYNTHETIC_MINIO_ADMIN_PASS" >/dev/null 2>&1
docker compose -p "$PROJECT_NAME" --env-file "$ENV_FILE" -f compose.yaml -f "$OVERRIDE_FILE" exec -T minio \
  mc mb -p local/godzspeed-review >/dev/null 2>&1

# ------------------------------------------------------------------------------
# Start Migration, Control API, and Review Hub
# ------------------------------------------------------------------------------
echo "==> Starting migrate, Control API, and Review Hub..."
docker compose -p "$PROJECT_NAME" --env-file "$ENV_FILE" -f compose.yaml -f "$OVERRIDE_FILE" up -d migrate control-api review-hub

check_migrate_completed() {
  local cid
  cid=$(docker compose -p "$PROJECT_NAME" --env-file "$ENV_FILE" -f compose.yaml -f "$OVERRIDE_FILE" ps -a -q migrate 2>/dev/null || true)
  if [ -n "$cid" ]; then
    local status
    status=$(docker inspect --format='{{.State.Status}}' "$cid" 2>/dev/null || true)
    local exit_code
    exit_code=$(docker inspect --format='{{.State.ExitCode}}' "$cid" 2>/dev/null || true)
    [ "$status" = "exited" ] && [ "$exit_code" = "0" ]
  else
    return 1
  fi
}

check_control_api_http() {
  curl -s -f "http://127.0.0.1:${CONTROL_API_PORT}/api/health" 2>/dev/null | grep -q '"status":"ok"'
}

check_review_hub_http() {
  curl -s -f "http://127.0.0.1:${REVIEW_HUB_PORT}/" 2>/dev/null | grep -q 'Director Review Hub'
}

wait_for_condition "Migration service completion" 60 1 check_migrate_completed
wait_for_condition "Control API HTTP readiness" 60 1 check_control_api_http
wait_for_condition "Review Hub HTTP readiness" 60 1 check_review_hub_http

# ------------------------------------------------------------------------------
# Seed Minimum Database Review Fixture
# ------------------------------------------------------------------------------
echo "==> Seeding minimum database review fixture..."
FIXTURE_CLIENT_ID="00000000-0000-0000-0000-000000000001"
FIXTURE_CAMPAIGN_ID="00000000-0000-0000-0000-000000000002"
FIXTURE_SCENE_ID="00000000-0000-0000-0000-000000000003"
FIXTURE_CANDIDATE_ID="00000000-0000-0000-0000-000000000004"

docker compose -p "$PROJECT_NAME" --env-file "$ENV_FILE" -f compose.yaml -f "$OVERRIDE_FILE" exec -T postgres \
  psql -U postgres -d godzspeed_orchestrator >/dev/null 2>&1 <<EOF
INSERT INTO clients (client_id, company_name, brand_bible_json, default_aspect_ratio, external_processing_policy)
VALUES ('${FIXTURE_CLIENT_ID}', 'Godzspeed Smoke Client Inc.', '{}', '9:16', '{}');

INSERT INTO campaigns (campaign_id, client_id, title, target_platform, status, total_scenes, approved_scenes)
VALUES ('${FIXTURE_CAMPAIGN_ID}', '${FIXTURE_CLIENT_ID}', 'Carnival 2026 Smoke Campaign', 'instagram_reels', 'drafting', 1, 0);

INSERT INTO storyboard_scenes (scene_id, campaign_id, scene_order, duration_seconds, shot_type, visual_description, engine_assigned, status, spec_revision)
VALUES ('${FIXTURE_SCENE_ID}', '${FIXTURE_CAMPAIGN_ID}', 1, 5.0, 'wide_establishing', 'Dawn over Port of Spain steelpan rehearsal', 'flux_schnell', 'draft_pending', 1);

INSERT INTO storyboard_candidates (candidate_id, scene_id, scene_spec_revision, variant_ordinal, storage_bucket, storage_object_key, content_hash_sha256, generation_payload)
VALUES ('${FIXTURE_CANDIDATE_ID}', '${FIXTURE_SCENE_ID}', 1, 1, 'godzspeed-review', 'smoke/candidate_01.png', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '{"seed":42}');
EOF

# ------------------------------------------------------------------------------
# Invariant 3: dependency connectivity proof
# ------------------------------------------------------------------------------
echo "==> TEST: proves dependency connectivity instead of process liveness"

# 1. Assert Control API health response
API_HEALTH_RESP=$(curl -s -f "http://127.0.0.1:${CONTROL_API_PORT}/api/health")
if ! echo "$API_HEALTH_RESP" | grep -q '"status":"ok"'; then
  echo "FAIL: Control API health probe failed: $API_HEALTH_RESP"
  exit 1
fi

# 2. Assert database-backed review read requests
CAMPAIGN_SUMMARY_RESP=$(curl -s -f "http://127.0.0.1:${CONTROL_API_PORT}/api/campaigns/${FIXTURE_CAMPAIGN_ID}/review-summary")
if ! echo "$CAMPAIGN_SUMMARY_RESP" | grep -q "Carnival 2026 Smoke Campaign"; then
  echo "FAIL: Database-backed campaign review summary read failed: $CAMPAIGN_SUMMARY_RESP"
  exit 1
fi

SCENE_DETAIL_RESP=$(curl -s -f "http://127.0.0.1:${CONTROL_API_PORT}/api/scenes/${FIXTURE_SCENE_ID}/review")
if ! echo "$SCENE_DETAIL_RESP" | grep -q "Dawn over Port of Spain steelpan rehearsal"; then
  echo "FAIL: Database-backed scene review detail read failed: $SCENE_DETAIL_RESP"
  exit 1
fi
if ! echo "$SCENE_DETAIL_RESP" | grep -q "$FIXTURE_CANDIDATE_ID"; then
  echo "FAIL: Scene detail response did not include candidate ID $FIXTURE_CANDIDATE_ID: $SCENE_DETAIL_RESP"
  exit 1
fi

# 3. Assert MinIO S3 bootstrap readiness
API_CID=$(docker compose -p "$PROJECT_NAME" --env-file "$ENV_FILE" -f compose.yaml -f "$OVERRIDE_FILE" ps -q control-api)
API_LOGS=$(docker logs "$API_CID" 2>&1 || true)
if ! echo "$API_LOGS" | grep -q "Probing S3 readiness on bucket 'godzspeed-review'"; then
  echo "FAIL: Control API did not execute S3 readiness probe on startup: $API_LOGS"
  exit 1
fi
if ! echo "$API_LOGS" | grep -q "Control API server listening on"; then
  echo "FAIL: Control API did not successfully reach listening state: $API_LOGS"
  exit 1
fi

# 4. Assert rendered Review Hub SSR response
REVIEW_HUB_HOME_HTML=$(curl -s -f "http://127.0.0.1:${REVIEW_HUB_PORT}/")
if ! echo "$REVIEW_HUB_HOME_HTML" | grep -q 'Director Review Hub'; then
  echo "FAIL: Review Hub did not render home page title: $REVIEW_HUB_HOME_HTML"
  exit 1
fi
if ! echo "$REVIEW_HUB_HOME_HTML" | grep -q 'data-testid="health-status"'; then
  echo "FAIL: Review Hub did not render health status element: $REVIEW_HUB_HOME_HTML"
  exit 1
fi
if echo "$REVIEW_HUB_HOME_HTML" | grep -q 'data-testid="health-error"'; then
  echo "FAIL: Review Hub rendered health error state: $REVIEW_HUB_HOME_HTML"
  exit 1
fi

REVIEW_HUB_SCENE_HTML=$(curl -s -f "http://127.0.0.1:${REVIEW_HUB_PORT}/scenes/${FIXTURE_SCENE_ID}")
if ! echo "$REVIEW_HUB_SCENE_HTML" | grep -q "$FIXTURE_CANDIDATE_ID"; then
  echo "FAIL: Review Hub did not render scene candidate details: $REVIEW_HUB_SCENE_HTML"
  exit 1
fi

echo "  PASS: proves dependency connectivity instead of process liveness"

# ------------------------------------------------------------------------------
# Invariant 4: console-independent smoke success
# ------------------------------------------------------------------------------
echo "==> TEST: proves the Review Hub does not require the MinIO console"

# Assert MinIO console port is not listening on host loopback
if is_port_listening 9001 || is_port_listening "$MINIO_CONSOLE_PORT"; then
  echo "FAIL: MinIO console port is unexpectedly reachable on host loopback"
  exit 1
fi

echo "  PASS: proves the Review Hub does not require the MinIO console"

echo "======================================================================"
echo "All Control-Plane Smoke Verification Checks Passed Successfully!"
echo "======================================================================"
