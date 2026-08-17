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

## 5. Target-Host Acceptance Status

> [!IMPORTANT]
> **The CLI has not yet been executed against the Trinidad render host.**

Everything documented above is verified by unit and cross-process tests only. GPU lease contention is exercised with spawned child processes against a real filesystem lock; **GPU inference is not exercised at all**.

Two acceptance criteria from #9 remain open because they require hardware:

- a real FLUX render completing through the full layer stack
- a real LTX run dispatched through this same path

Both are tracked in #32, which is executed by an operator on the Trinidad host and reports the verbatim CLI output, the produced output files with timestamps, and the ComfyUI commit at run time. #32 also records a live-hardware exclusivity check — starting a second render while a first is mid-inference — which the cross-process tests approximate but cannot reproduce against an actively executing GPU.

Until #32 completes, treat the exit codes and JSON contract in sections 3 and 4 as specified-and-unit-tested rather than field-verified.
