# Render Worker CLI (`render`) Runbook & Specification

The `@cco/render-worker` CLI provides deterministic, single-host GPU-leased render execution for ComfyUI production and draft workloads. It coordinates preflight provenance verification, atomic host-local GPU leasing, GPU telemetry sampling, and render dispatch through the Clean Architecture application layer.

---

## 1. Overview & Canonical Automation Shape

The CLI runs as part of the Trinidad render-plane worker runtime. It dispatches a deterministic render profile through ComfyUI only after verifying live Git commit, model weights, and workflow hashes against an approved Gold Master provenance report.

### Canonical Automation Shape

Automation scripts and operators invoke the render command using environment variables rather than hard-coded machine paths:

```bash
pnpm --filter render-worker render -- \
  --profile ltx-25-720p-97f \
  --comfyui-dir "$CCO_COMFYUI_DIR" \
  --comfyui-url "$CCO_COMFYUI_URL" \
  --gold-master-provenance "$CCO_GOLD_MASTER_PROVENANCE"
```

For FLUX.1 [schnell] draft generation:

```bash
pnpm --filter render-worker render -- \
  --profile flux-schnell-draft \
  --comfyui-dir "$CCO_COMFYUI_DIR" \
  --comfyui-url "$CCO_COMFYUI_URL" \
  --gold-master-provenance "$CCO_FLUX_GOLD_MASTER_PROVENANCE"
```

---

## 2. CLI Flags & Options

### Required Flags

| Flag | Description |
|---|---|
| `--profile <profile-id>` | Profile ID from the manifest (e.g. `ltx-25-720p-97f` or `flux-schnell-draft`). Must be a lowercase path-safe string. |
| `--comfyui-dir <path>` | Filesystem path to the ComfyUI installation root. |
| `--comfyui-url <url>` | ComfyUI HTTP/WebSocket base URL (e.g. `http://127.0.0.1:8188`). |
| `--gold-master-provenance <path>` | Path to the approved Gold Master provenance JSON report. |

### Optional Flags

| Flag | Default | Description |
|---|---|---|
| `--manifest <path>` | `templates/provenance.json` | Path to profile manifest JSON. |
| `--gpu-index <index>` | `0` | Zero-based NVIDIA GPU device index. |
| `--lease-path <path>` | `<tmpdir>/comfy-content-orchestrator-gpu-<gpuIndex>.lock` | Local filesystem path for the GPU lease lockfile. Must reside on a local filesystem supporting atomic `O_EXCL` file creation and hardlinks. |
| `--render-timeout-ms <ms>` | `300000` (5 minutes) | Positive integer render timeout in milliseconds. |
| `--render-job-id <id>` | `cli-render-<profile-id>` | Identifier for the render job (lowercase path-safe string). |
| `--scene-id <id>` | `cli-scene-<profile-id>` | Identifier for the scene (lowercase path-safe string). |
| `--help`, `-h` | — | Print usage information and exit zero without constructing infrastructure. |

---

## 3. Exit Codes & JSON Output Contract

The CLI enforces a strict machine-readable standard: **stdout is reserved for successful JSON results**, while **stderr receives progress diagnostics and structured error JSON**.

### Exit Codes

| Exit Code | Classification | Meaning |
|---|---|---|
| `0` | **Success** | Preflight checks succeeded, GPU lease acquired, render dispatched and completed, GPU lease released cleanly. Exactly one JSON object is written to stdout. |
| `1` | **Failure** | Any preflight mismatch, lease contention, telemetry error, ComfyUI queue/execution failure, or cleanup error. Exactly one structured JSON error object is written to stderr. |

### Success Output (stdout)

On success (exit `0`), exactly one JSON line is emitted to stdout conforming to `ExecuteProfileRenderResult`:

```json
{
  "status": "succeeded",
  "promptId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "outputObjectKeys": [
    "output/scene_00001_.png"
  ],
  "durationMs": 46250,
  "profile": {
    "profileId": "ltx-25-720p-97f",
    "renderProfileKey": "LTX_25_720P_5S_V1",
    "renderProfileVersion": 1,
    "engine": "ltx_25",
    "workflowSha256": "94f397eee3ad8b0cee000036119e524e8c7a012b88d79d00b74172df9d9bf539",
    "modelSha256": {
      "models/diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors": "..."
    },
    "runnerProfile": "dynamicvram-offload-v1",
    "comfyUiCommit": "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
  },
  "preDispatchGpu": {
    "totalVramMb": 24576,
    "usedVramMb": 4096,
    "freeVramMb": 20480,
    "reservedVramMb": 512,
    "measuredAt": "2026-08-16T12:00:00.000Z"
  }
}
```

### Error Output (stderr)

On failure (exit `1`), exactly one structured JSON line is written to stderr:

```json
{
  "status": "failed",
  "stage": "lease_acquisition",
  "code": "gpu_lease_unavailable",
  "message": "GPU lease at /tmp/comfy-content-orchestrator-gpu-0.lock is currently held by live PID 12345",
  "holder": {
    "version": 1,
    "pid": 12345,
    "startedAt": "2026-08-16T12:00:00.000Z",
    "hostname": "trinidad",
    "leaseId": "f81d4fae-7dec-11d0-a765-00a0c91e6bf6"
  }
}
```

For aggregate failures (e.g. execution failure and release failure):

```json
{
  "status": "failed",
  "stage": "render_cleanup",
  "code": "aggregate_error",
  "message": "Render execution and GPU lease release both failed",
  "errors": [
    "ComfyUI prompt execution timed out after 300000 ms",
    "Cannot release GPU lease: lock file at /tmp/gpu.lock contains invalid metadata"
  ]
}
```

---

## 4. Local GPU Lease Semantics

The render plane operates under the core invariant: **at most one active diffusion generation may execute on an RTX 4090 at any time**. The lease adapter (`LocalFsGpuLeaseAdapter`) enforces this locally using filesystem locks.

### Filesystem Scope & Constraints

- **Local-only filesystem:** Lock paths must be located on local filesystems (e.g. `/tmp`, `/var/run`, or local ext4/xfs partitions). Network filesystems (NFS, SMB, CIFS) or per-container private mount namespaces violate mutual exclusion and are prohibited.
- **Atomic Creation:** Locks are created atomically using exclusive file creation (`O_CREAT | O_EXCL` / `wx`) into a unique PID-stamped temporary file and linked to the target lock path via POSIX `link(2)`.

### Lock Metadata Format

The lock file contains a JSON object conforming to `GpuLeaseHolder`:

```json
{
  "version": 1,
  "pid": 12345,
  "startedAt": "2026-08-16T12:00:00.000Z",
  "hostname": "trinidad",
  "leaseId": "f81d4fae-7dec-11d0-a765-00a0c91e6bf6"
}
```

### Contention & Recovery Policies

1. **Live-Holder Refusal:** If a lock file exists and its recorded `pid` is currently alive on the same `hostname` (probed via `kill(pid, 0)`), acquisition fails immediately with `GpuLeaseUnavailableError` and the holder metadata. It does not block or poll.
2. **Dead-Holder Guarded Recovery:** If the holding PID is dead (`ESRCH`), the reclaimer acquires a sibling reclaim guard (`<lockFilePath>.reclaim`) atomically before unlinking the stale lock. This prevents racing reclaimers from clobbering each other.
3. **Stale Reclaim-Guard Recovery:** The reclaim guard also carries PID and hostname metadata. If a reclaimer dies abruptly while holding the guard, a subsequent reclaimer probes the guard's PID; if dead (`ESRCH`), the orphaned guard is unlinked.
4. **Malformed Metadata Fail-Closed:** If a lock file or reclaim guard exists on disk but is empty, non-JSON, or missing required schema fields, recovery fails closed with `GpuLeaseUnavailableError`. Automatic unlinking of unverified files is prohibited to protect running GPU workloads.

### Manual Cleanup Rules

If a lock file contains corrupted metadata or an operator must intervene:

1. Confirm no active ComfyUI generation or worker process is running:
   ```bash
   ps aux | grep render
   nvidia-smi
   ```
2. Inspect the lockfile contents:
   ```bash
   cat /tmp/comfy-content-orchestrator-gpu-0.lock
   ```
3. If and only if the process is verified dead and no GPU workload is active, remove the lock and any orphan reclaim guard:
   ```bash
   rm -f /tmp/comfy-content-orchestrator-gpu-0.lock /tmp/comfy-content-orchestrator-gpu-0.lock.reclaim
   ```

---

## 5. Execution Scopes & Candidate Staging (#425)

The render worker supports explicit execution scope isolation between ordinary production and operator-controlled variable-duration candidate staging.

### Execution Scope Configuration

- **`WORKER_ALLOWED_EXECUTION_SCOPES`**: Environment variable specifying a comma-separated list of allowed scopes (`production`, `staging`). Defaults to `production` when omitted.
- **Server-Side Enforcement**: Control API enforces that workers may only claim jobs matching their authorized execution scopes. Workers not configured with `staging` will never receive candidate staging jobs.

Candidate staging workers also require all four deployment snapshot settings: `H3_CANDIDATE_PROFILES_FILE`, `H3_CAPABILITY_MATRIX_FILE`, `H3_TRUSTED_KEYS_FILE`, and `H3_EVIDENCE_DIRECTORY`. The worker verifies the signed capability matrix and resolves each evidence digest from that directory before admitting a profile. If any setting is absent, the worker stays on the empty built-in catalog and rejects candidate jobs. Set `H3_CANDIDATE_PROVENANCE_PATH` to the trusted candidate provenance report. Use deployment controlled files and keys, matching those used by the staging command.

```bash
# Production-only worker (default)
WORKER_ALLOWED_EXECUTION_SCOPES=production pnpm --filter render-worker start

# Staging-enabled worker (operator-controlled staging host)
WORKER_ALLOWED_EXECUTION_SCOPES=staging,production pnpm --filter render-worker start
```

### Preflight Signed Operator Grant Verification

Before dispatching any candidate profile execution to ComfyUI/GPU, the worker enforces:
1. **Execution Scope Gate**: The job's durable `executionScope` must be `"staging"`. Any candidate profile job encountered on an ordinary production queue immediately throws `CandidateProfileProductionDisabledError`.
2. **Signed Grant Verification**: Injected payload must contain an `authorizationGrant` conforming to `H3CandidateAuthorizationGrantSchema`.
3. **Cryptographic Verification**: `H3OperatorSignatureVerifier` verifies the detached cryptographic signature against deployment-owned trusted public keys, validating:
   - Grant payload version is `1`.
   - Signer key ID is trusted and valid.
   - Candidate profile key and specification digest match exactly.
   - Gold-master workflow hash and model hashes match candidate specification.
   - Target hostname and target GPU UUID match the executing node.
   - Current time falls within `[issuedAt, expiresAt]`.
   - Purpose is `"staging"`.
4. **Graph & LoRA Integrity**:
   - Generator node matches route (`MiniMaxH3ImageToVideo` for I2V; `MiniMaxH3ReferenceToVideo` for Ref2V).
   - Sampling parameters (`steps`, `sampler`, `scheduler`, `cfg`, `denoise`) match candidate specification.
   - Detects and rejects silent dense-attention fallback.
   - Enforces Turbo LoRA route invariants; rejects LoRA nodes if `turboLora === "none"`.
   - Validates reference image headers, hashes, dimensions, and path traversal safety.

### Duration Semantics & Timeline Invariants

Execution preserves strict separation across three duration concepts:
- **`requestedDurationMs`**: The duration requested by the ShotPlan or Scene configuration (e.g. 8000ms, 10000ms).
- **`nominalDurationMs`**: The exact configured duration derived from grid-valid candidate frames: `Math.round((specification.frames / specification.fps) * 1000)`.
- **`measuredMedia`**: Post-render physical media facts probed via `ffprobe` (`frameCount`, `fps`, `durationMs`, `container`, `video.codecName`).

The worker rejects any duration discrepancy exceeding tolerance:
- **No silent fallback**: Requested durations never secretly snap to the 5000ms canonical 124-frame profile.
- **CFR Invariant**: Non-constant frame rate (`fps: null` from ffprobe) triggers immediate rejection.
- **Tolerance Gate**: Probed output duration cannot diverge from `nominalDurationMs` by more than 355ms (roughly ±8.5 frames at 24fps).
- **Assembly Timeline Invariant**: Downstream accepted-run assembly validates that individual probed stem durations and aggregate run durations match planned durations within tolerances before enqueuing reels.

### Operator Staging CLI Invocation

Operators stage an approved scene for candidate execution using `pnpm --filter render-worker stage`:

```bash
pnpm --filter render-worker stage -- \
  --scene-id "<scene-uuid>" \
  --candidate-profile-key "H3_CANDIDATE_<32-hex-digest>_V1" \
  --grant-path "/path/to/signed-operator-grant.json" \
  --database-url "$DATABASE_URL" \
  --request-id "<idempotency-key-uuid>"
```

CLI options:
| Option | Description |
|---|---|
| `--scene-id <uuid>` | Approved Scene UUID to stage. Scene must have an approved ShotPlan matching the candidate route. |
| `--candidate-profile-key <key>` | Candidate profile key (e.g. `H3_CANDIDATE_..._V1`). Must exist in the accepted candidate catalog. |
| `--grant-path <path>` | Path to signed operator authorization grant JSON file (`H3CandidateAuthorizationGrant`). |
| `--database-url <url>` | PostgreSQL connection string. Defaults to `DATABASE_URL` environment variable. |
| `--request-id <uuid>` | Optional client-supplied idempotency key. Defaults to a deterministic v5 or random v4 UUID. |
| `--dry-run` | When present, validates preflight admission and constructs the job without mutating database or queue. |

### Signed Grant Prerequisites

An operator authorization grant JSON file must contain:
1. `payload.version`: Always `1`.
2. `payload.candidateKey`: Matches `--candidate-profile-key`.
3. `payload.specificationDigest`: Exact SHA-256 digest of candidate specification.
4. `payload.goldMasterWorkflowHash`: Matches workflow SHA-256 in candidate specification.
5. `payload.goldMasterModelHashesDigest`: Digest of required model hashes map.
6. `payload.targetHostname`: Target execution machine hostname (`os.hostname()`).
7. `payload.targetGpuUuid`: Dedicated NVIDIA RTX 4090 GPU UUID (e.g. from `nvidia-smi -L`).
8. `payload.purpose`: Must be `"staging"`.
9. `payload.scope`: Must be `"staging"`.
10. `payload.issuedAt` / `payload.expiresAt`: ISO 8601 UTC timestamps encompassing the execution window.
11. `signerKeyId` & `signature`: Cryptographic signature verifiable against operator trust store keys.

### Denial Diagnostics Guide

When candidate admission or execution rejects, fail-closed diagnostics identify the root cause:

| Blocker / Diagnostic Message | Meaning | Recovery / Operator Action |
|---|---|---|
| `Candidate profile production execution is disabled` | Candidate job claimed by a worker with ordinary production queue scope. | Configure worker with `WORKER_ALLOWED_EXECUTION_SCOPES=staging,production`. |
| `Candidate authorization denied: OPERATOR_KEY_REVOKED` | Grant signer key ID has been revoked or expired in the deployment trust store. | Re-sign the grant using an active, trusted operator key. |
| `Detected silent dense-attention fallback: candidate profile requires ...` | Workflow node configured `standard` or `dense` attention instead of candidate's required backend (e.g. `flash_attn` or `sage_attn`). | Fix workflow template node to use the specified attention backend and pass `fail_on_fallback: true`. |
| `Unknown effective attention backend: ...` | Live runtime environment has unknown or unsupported attention implementation. | Verify CUDA, PyTorch, and attention packages (e.g. `flash_attn`, `sageattention`) match candidate specification. |
| `Ref2VA Turbo LoRA is strictly restricted to Ref2V route` | Workflow wired a reference-directed Turbo LoRA into an I2V candidate execution graph. | Use the route-appropriate Turbo LoRA (FL2VA for I2V, Ref2VA for Ref2V) or `"none"`. |
| `Attention package version mismatch` | Live python environment has package version differing from candidate spec. | Update the environment virtualenv to match pinned package versions. |
| `Observed host/GPU does not match target` | Grant was issued for a different physical node or GPU device. | Re-issue grant binding the correct target hostname and GPU UUID. |
| `Probed output frame count X does not match candidate specification Y` | ComfyUI rendered fewer or more frames than specified by candidate. | Check ComfyUI latent frame count inputs; ComfyUI node may have truncated generation. |
| `Probed output fps null does not match candidate specification fps 24` | Video container is variable frame rate (VFR). | Ensure ComfyUI video export node enforces constant frame rate (CFR) MP4. |

### Rollback & Quarantine Procedure

If an operator needs to abort a staging candidate execution or revert a host to production-only:

1. **Revert Worker Scope:**
   ```bash
   # Remove staging scope from worker environment
   export WORKER_ALLOWED_EXECUTION_SCOPES=production
   # Restart render worker process
   pnpm --filter render-worker start
   ```
2. **Quarantine or Cancel In-Flight Staging Jobs:**
   ```sql
   -- Mark any pending or in-flight staging jobs as cancelled
   UPDATE render_jobs
   SET status = 'cancelled', error_trace = 'Cancelled by operator staging rollback'
   WHERE execution_scope = 'staging' AND status IN ('queued', 'rendering');
   ```
3. **Reset Scene Status:**
   If a scene was queued for staging and needs to return to `approved` state for normal production:
   ```sql
   UPDATE scenes
   SET status = 'approved'
   WHERE id = '<scene-uuid>' AND status = 'queued';
   ```
4. **Clear Staged Reference Artifacts:**
   Remove temporary reference files from ComfyUI input staging:
   ```bash
   rm -f "$CCO_COMFYUI_DIR/input/stage_"*
   ```

---

## 6. Target-Host Acceptance Status

> [!NOTE]
> **Live hardware acceptance is complete on the Trinidad RTX 4090 host (Issue #32).**

All target-host acceptance criteria defined in #9 and executed in #32 have been verified against ComfyUI commit `55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc`:

1. **Real FLUX Render (Full Layer Stack):**
   - Dispatched `flux-schnell-draft` through `render.ts` with host-validated gold master provenance.
   - Succeeded with exit code `0` in `10,965 ms`, producing `flux_schnell_draft_00012_.png` (`892,846 bytes`) at timestamp `08:00:49`.
2. **Real LTX-2.5 Render (Full Layer Stack):**
   - Dispatched `ltx-25-720p-97f` through `render.ts` with host-validated gold master provenance.
   - Succeeded with exit code `0` in `45,186 ms`, producing `ltx_25_720p_97f_00008_.webp` (`8,997,052 bytes`) at timestamp `08:02:10`.
3. **Live Hardware GPU Lease Exclusivity:**
   - Initiated an in-flight LTX render holding lock `/tmp/comfy-content-orchestrator-gpu-0.lock`.
   - Concurrent FLUX render attempt was immediately refused with `GpuLeaseUnavailableError` (exit code `1`, structured JSON error identifying holding PID on hostname `llama`), never touching GPU inference.
   - The primary render completed unhindered in `46,706 ms`, producing `ltx_25_720p_97f_00009_.webp` at `08:03:38`, releasing the lease cleanly.

Exit codes `0` and `1` (lease refusal) are field-verified by the runs above. The remaining exit codes in section 3 are specified and unit-tested but have not been observed on hardware.
