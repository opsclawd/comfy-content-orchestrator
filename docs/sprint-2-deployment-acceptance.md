# Sprint 2 Real-Environment Deployment Acceptance Runbook

## Overview

This runbook specifies the operator verification procedure required to accept Sprint 2 deployment onto live infrastructure (Hetzner CPX31 Cloud Control Plane, Trinidad Inference Workstation, and Tailscale mesh).

> **CRITICAL RULE:** Deployment acceptance requires execution against the **real, deployed environment**. Automated tests in this repository execute against PostgreSQL 18 in Testcontainers with deterministic fakes; they do **not** simulate or certify Hetzner, Tailscale DNS, MinIO storage, or physical device network perimeters. Never commit fabricated passing evidence.

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

### 2. MagicDNS Resolution under `godzspeed-internal.ts.net`

**Objective:** Verify MagicDNS hostnames resolve correctly to tailnet 100.x.y.z CGNAT addresses from authorized tailnet nodes.

**Execution:**
From an authorized tailnet node (e.g. Trinidad host or Creative Director device):
```bash
tailscale ping review.godzspeed-internal.ts.net
tailscale ping control-01.godzspeed-internal.ts.net
tailscale ping render-01.godzspeed-internal.ts.net
tailscale ping storage-01.godzspeed-internal.ts.net
```

**Pass Criteria:**
- `review.godzspeed-internal.ts.net` resolves to the Hetzner node's Tailscale IP.
- `control-01.godzspeed-internal.ts.net` resolves to the Hetzner node's Tailscale IP.
- `render-01.godzspeed-internal.ts.net` resolves to the Trinidad workstation's Tailscale IP.
- `storage-01.godzspeed-internal.ts.net` resolves to the Hetzner node's Tailscale IP.

---

### 3. Review Hub Browser Access from Creative Director Device

**Objective:** Verify human browser access from the designated Creative Director device in Ottawa, Canada.

**Execution:**
1. Connect Creative Director device to Tailscale tailnet `godzspeed-internal.ts.net`.
2. Open browser and navigate to `https://review.godzspeed-internal.ts.net`.
3. Log in / verify session authentication.
4. Load campaign review page and inspect candidate gallery.

**Pass Criteria:**
- TLS certificate is valid for `review.godzspeed-internal.ts.net`.
- Application loads without mixed-content or connection errors.
- Candidate WebP/MP4 proxies render in the browser.

---

### 4. Short-Lived Presigned S3 Media Access & Expiry

**Objective:** Prove that browser media access uses time-bounded presigned URLs that expire deterministically, and that database records persist only canonical bucket + object keys.

**Execution:**
```bash
# 1. Request presigned URL from Control API
PRESIGNED_URL=$(curl -s -H "Authorization: Bearer $TOKEN" \
  https://control-01.godzspeed-internal.ts.net/api/scenes/<SCENE_ID>/review | jq -r '.candidatesByRevision[0].candidates[0].media.previewUrl')

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
curl -s https://control-01.godzspeed-internal.ts.net/metrics | grep godzspeed_storage
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
curl -I http://storage-01.godzspeed-internal.ts.net:9001
```

**Pass Criteria:**
- MinIO API on `storage-01.godzspeed-internal.ts.net:9000` (or standard HTTPS 443) responds to S3 requests.
- MinIO Console port 9001 is refused or filtered for general tailnet clients.
