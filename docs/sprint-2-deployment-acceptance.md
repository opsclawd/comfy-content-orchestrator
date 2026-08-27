# Sprint 2 Real-Environment Deployment Acceptance Runbook

## Overview

This runbook specifies the operator verification procedure required to accept Sprint 2 deployment onto live infrastructure (Hetzner CPX31 Cloud Control Plane, Trinidad Inference Workstation, and Tailscale mesh).

> **CRITICAL RULE:** Deployment acceptance requires execution against the **real, deployed environment**. Automated tests in this repository execute against PostgreSQL 18 in Testcontainers with deterministic fakes; they do **not** simulate or certify Hetzner, Tailscale DNS, MinIO storage, or physical device network perimeters. Never commit fabricated passing evidence.

---

## 1. Pre-Deployment Artifact Verification

Before deploying to live infrastructure, verify all deployment artifacts locally using the repository verification commands:

```bash
# 1. Topology model and configuration contract validation
pnpm check:control-plane

# 2. Container image builds, non-root user, and clean dependency closure validation
pnpm check:control-plane-images

# 3. Teardown-safe local stack connectivity smoke test (PostgreSQL, MinIO, Control API, Review Hub)
pnpm smoke:control-plane
```

---

## 2. Environment Preparation (`.env.example` -> `.env`)

On the Hetzner CPX31 Control Plane host:

1. Copy `.env.example` to create the real deployment configuration file `.env`:
   ```bash
   cp .env.example .env
   chmod 600 .env
   ```
2. Populate `.env` with production secrets, explicit Tailscale IP addresses, and operator binding IP addresses. Never use wildcard bindings (`0.0.0.0` or `::`).

### Distinct Database Roles & Least-Privilege Separation

The control plane configuration enforces distinct database roles:

- **Migration Owner Role** (`POSTGRES_USER`, `DATABASE_MIGRATION_URL`): Superuser / schema owner used exclusively by the one-shot `migrate` service to execute DDL schema migrations.
- **Application Least-Privilege Role** (`DATABASE_APP_ROLE`, `DATABASE_APP_USER`, `DATABASE_APP_PASSWORD`, `DATABASE_URL`): Restricted non-superuser role used exclusively by the long-running `control-api` service with DML-only permissions (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) and no schema alteration privileges.

### Single Hostname, Port-Differentiated Service URLs

The deployment runs on a single control-plane host and exposes all three services on distinct ports over the Tailscale tailnet. Per the decisions recorded in issue #87, the earlier scheme of per-service DNS names (`review`, `control-01`, `storage-01`, `render-01`) under a custom `godzspeed-internal.ts.net` suffix is **not implementable** as written: Tailscale MagicDNS assigns exactly one DNS name per device and does not support aliases or arbitrary records. Tailnet rename to `godzspeed-internal.ts.net` was also declined; the real, currently-assigned tailnet suffix is `taild802ae.ts.net`.

Services are therefore addressed by **control-plane host MagicDNS name plus port**:

- **Review Hub**: `<control-plane-host>.taild802ae.ts.net:<REVIEW_HUB_PORT>` (port from `.env`).
- **Control API**: `<control-plane-host>.taild802ae.ts.net:<CONTROL_API_PORT>`.
- **S3 / storage**: `<control-plane-host>.taild802ae.ts.net:<S3_PORT>`.

The `REVIEW_HUB_HOSTNAME`, `CONTROL_API_HOSTNAME`, and `STORAGE_HOSTNAME` env vars remain in `.env.example` as **container-identity labels only** — they identify each service to the others inside the Docker network and to logs/observability tooling; they are not used for DNS resolution or routing. Internal container access to MinIO uses `S3_STORAGE_ENDPOINT=http://minio:9000` (Docker service DNS). Tailnet access uses `S3_SIGNING_ENDPOINT=http://<control-plane-host>.taild802ae.ts.net:<S3_PORT>`.

---

## 3. Deployment & Migration Procedure (`compose.yaml`)

Deploy the control plane stack using `compose.yaml`:

```bash
docker compose --env-file .env -f compose.yaml up -d
```

### Migration & Service Startup Ordering

`compose.yaml` enforces strict dependency and health gating:

1. **`postgres`**: Starts and initializes PostgreSQL 18.6 with `io_method=worker`. Waits until healthy (`pg_isready`).
2. **`migrate`**: One-shot container starts after `postgres` is healthy, connects via `DATABASE_MIGRATION_URL` (migration owner role), executes `node_modules/@cco/infrastructure/dist/postgres/migrate.js`, and exits with code 0.
3. **`minio`**: Starts upstream MinIO server. Waits until healthy (`mc ready local`).
4. **`control-api`**: Starts only after `postgres` is healthy, `minio` is healthy, and `migrate` completes successfully (`condition: service_completed_successfully`). Connects via `DATABASE_URL` (application role).
5. **`review-hub`**: Starts after `control-api` starts. Communicates with Control API via `CONTROL_API_URL` with no dependency on or access to the MinIO console port (9001).

---

## 4. Teardown Procedure

To stop and remove running control plane containers, networks, and services cleanly:

```bash
# Graceful shutdown of all services
docker compose --env-file .env -f compose.yaml down

# Teardown with volume destruction (WARNING: permanently deletes postgres_data and minio_data)
docker compose --env-file .env -f compose.yaml down -v
```

---

## Acceptance Verification Procedures

### 1. Zero Public Exposure Audit

**Objective:** Verify that no application, database, ComfyUI, S3, or MinIO admin surfaces are reachable from the public WAN.

**Execution:**
From an external host outside the Tailscale network (e.g. standard residential/commercial internet):
```bash
# Scan public Hetzner IPv4 and IPv6
nmap -Pn -p 80,443,3000,5432,8188,9000,9001 <HETZNER_PUBLIC_IP>
```

**Pass Criteria:**
- Port 22 (SSH) is either restricted or hardened.
- Ports 80, 443, 3000 (Control API / Web), 5432 (PostgreSQL), 8188 (ComfyUI), 9000 (MinIO S3), and 9001 (MinIO Console) are **filtered** or **closed**.
- Public HTTP/HTTPS requests to `http://<HETZNER_PUBLIC_IP>:3000` or `http://<HETZNER_PUBLIC_IP>:9000` fail with connection timeout or connection refused.

---

### 2. Endpoint Reachability over the Tailnet

**Objective:** Verify that the control-plane host's MagicDNS name resolves to its tailnet IP from authorized tailnet nodes, and that each canonical service (Control API, Review Hub, S3) is reachable on its configured port. Supersedes the earlier "MagicDNS Resolution under `godzspeed-internal.ts.net`" gate, which specified four per-service DNS names that are not implementable on a single host (see PRD §2.2 and the decisions recorded in issue #87).

**Execution:**
From an authorized tailnet node (e.g. Trinidad host or Creative Director device):
```bash
# 1. Resolve the single control-plane MagicDNS name
tailscale ping <control-plane-host>.taild802ae.ts.net

# 2. Probe each canonical service on its configured port
curl -fsS https://<control-plane-host>.taild802ae.ts.net:<CONTROL_API_PORT>/api/health
curl -fsSI https://<control-plane-host>.taild802ae.ts.net:<REVIEW_HUB_PORT>/
curl -fsSI https://<control-plane-host>.taild802ae.ts.net:<S3_PORT>/

# 3. Confirm the MinIO console port is refused over the tailnet
curl -I http://<control-plane-host>.taild802ae.ts.net:9001
```

**Pass Criteria:**
- `<control-plane-host>.taild802ae.ts.net` resolves to a 100.x.y.z CGNAT address belonging to the Hetzner control-plane node.
- The Control API `/api/health` endpoint returns HTTP 200 with a schema-conforming health response.
- The Review Hub root URL returns HTTP 200 (after TLS is in place — see Gate 3) without mixed-content or connection errors.
- The S3 endpoint responds with an S3-shaped response (`Server: MinIO` or AWS S3 error XML, not a connection refusal).
- The MinIO console port 9001 is **refused or filtered** for tailnet clients; it is reachable only on loopback (`127.0.0.1:9001`) on the Hetzner host itself.

---

### 3. Review Hub Browser Access from Creative Director Device

**Objective:** Verify human browser access from the designated Creative Director device in Ottawa, Canada.

**Execution:**
1. Connect Creative Director device to Tailscale tailnet `taild802ae.ts.net` (the real, currently-assigned tailnet suffix; per the decisions recorded in issue #87, the earlier `godzspeed-internal.ts.net` rename was declined and per-service names are not implementable on a single host).
2. Open browser and navigate to `https://<control-plane-host>.taild802ae.ts.net:<REVIEW_HUB_PORT>` (port from `.env`).
3. Verify reviewer identity: load a review action that produces a `ReviewEvent` (e.g. approve a candidate or `candidate_select` a storyboard candidate) and confirm the recorded `approvedBy` / reviewer identity matches the Tailscale user logged into the device. Per ADR-0002, Tailscale device identity *is* the Review Hub authentication boundary; there is no separate login step.
4. Load campaign review page and inspect candidate gallery.

**Pass Criteria:**
- TLS certificate is valid for the resolved hostname (a Tailscale-issued certificate for the tailnet MagicDNS name; not self-signed).
- Application loads without mixed-content or connection errors.
- Candidate WebP/MP4 proxies render in the browser.
- The `ReviewEvent` row written during step 3 carries a `reviewer_name` that matches the Tailscale user logged into the device, and the row was inserted with zero client-supplied identity overrides (i.e. the server-derived value was authoritative, per the `Server-Authoritative Reviewer Identity & Timestamp` invariant in `docs/CONTEXT.md`).

---

### 4. Short-Lived Presigned S3 Media Access & Expiry

**Objective:** Prove that browser media access uses time-bounded presigned URLs that expire deterministically, and that database records persist only canonical bucket + object keys.

**Execution:**
```bash
# 1. Request presigned URL from Control API
PRESIGNED_URL=$(curl -s -H "Authorization: Bearer $TOKEN" \
  https://<control-plane-host>.taild802ae.ts.net:<CONTROL_API_PORT>/api/scenes/<SCENE_ID>/review | jq -r '.candidatesByRevision[0].candidates[0].media.previewUrl')

# 2. Fetch immediately over tailnet
curl -I "$PRESIGNED_URL"

# 3. Wait past configured expiry (e.g., 900 seconds)
sleep 905

# 4. Attempt fetch with expired URL
curl -I "$PRESIGNED_URL"
```

**Pass Criteria:**
- Initial fetch returns HTTP 200 with appropriate `Content-Type: image/webp` or `video/mp4`.
- Expired fetch returns HTTP 403 Forbidden with S3 `RequestHasExpired` XML response.
- Querying PostgreSQL `storyboard_candidates` confirms `storage_bucket` and `storage_object_key` are stored without presigned query tokens.

---

### 5. MinIO Object Lifecycle & Deletion Eligibility

**Objective:** Verify that MinIO bucket lifecycle policies are configured and operational according to PRD Section 2.3 and `docs/component-governance.md`.

**Execution:**
From the Hetzner control plane node:
```bash
mc alias set local-minio http://127.0.0.1:9000 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD
mc ilm rule list local-minio/godzspeed-temp
mc ilm rule list local-minio/godzspeed-review
mc ilm rule list local-minio/godzspeed-reference
mc ilm rule list local-minio/godzspeed-delivery
```

**Pass Criteria:**
- `godzspeed-temp`: Expiration rule set to **14 days** (`godzspeed-temp-retention-14d`).
- `godzspeed-review`: Expiration rule set to **60 days** (`godzspeed-review-retention-60d`).
- `godzspeed-reference`: **No automated expiration rule** (retained while client is active).
- `godzspeed-delivery`: **No automated upload-age expiration rule** (retained 90 days after campaign completion; lifecycle gap documented in `docs/component-governance.md`).

---

### 6. Storage Watermark Behavior (70%, 85%, 92%)

**Objective:** Verify application telemetry and admission control at configured storage capacity thresholds.

**Execution:**
1. Query storage metrics endpoint:
```bash
curl -s https://<control-plane-host>.taild802ae.ts.net:<CONTROL_API_PORT>/metrics | grep godzspeed_storage
```
2. Verify watermark state transitions:
- **< 70%:** `godzspeed_storage_watermark_state{state="normal"} 1`
- **70% Warning:** Emit warning alert; trigger lifecycle cleanup.
- **85% Degraded:** `godzspeed_storage_watermark_state{state="degraded"} 1`; candidate generation admission blocked.
- **92% Critical:** `godzspeed_storage_watermark_state{state="critical"} 1`; all new media writes blocked.

**Pass Criteria:**
- Metrics expose accurate free disk bytes and current watermark enum state.
- Control API returns 507 Insufficient Storage or 429 when write admission is blocked in degraded/critical state.

---

### 7. Separation of MinIO S3 Endpoint from Admin Console

**Objective:** Verify that the MinIO administrative console is inaccessible to general review clients and bound only to loopback or operator tailnet ACLs.

**Execution:**
```bash
# Attempt to access MinIO Console port from general client
curl -I http://<control-plane-host>.taild802ae.ts.net:9001
```

**Pass Criteria:**
- MinIO API on `<control-plane-host>.taild802ae.ts.net:<S3_PORT>` responds to S3 requests.
- MinIO Console port 9001 is refused or filtered for general tailnet clients.
