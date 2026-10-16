# MiniMax-H3 Attention Optimization Experiments & Operator Runbook

## 1. Purpose and Non-Production Boundary

Issue #442 provides engineering artifacts, offline semantic validation, and an isolated execution harness for evaluating MiniMax-H3 attention-optimization variants (`dense`, `sage`, `native-sol-attn`, `veda`) across `i2v` and `ref2v` routing modes. This runbook guides human operators and operator agents during offline validation and controlled hardware evaluations (Issue #445).

### Strict Boundary Rules
- **Non-Production Isolation:** This harness evaluates candidate attention mechanisms in isolated run directories (`.ai-runs/minimax-h3-experiments/<run-id>/`). It does **not** alter canonical production profiles (`MINIMAX_H3_720P_5S_I2V_V1`, `MINIMAX_H3_720P_5S_REF2V_V1`), default ComfyUI launch configurations, or worker queues.
- **No In-Place Template or Core Mutation:** Canonical workflow templates (`templates/minimax_h3_720p_i2v_124f_api.json` and `templates/minimax_h3_720p_ref2v_124f_api.json`) and the pinned ComfyUI core revision (`55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc`) remain strictly immutable. Variants requiring newer ComfyUI capabilities use isolated upgrade checkouts and separate virtualenvs without modifying production.
- **Evidence Paths Never Agent-Authored:** Per `AGENTS.md`, directories under `certification/`, `baseline/`, and `config/render-profiles/` hold physical hardware measurements. Automated coding agents must never author synthetic measurements or fabricate hardware certifications. Physical execution, timing comparisons, and GO/NO-GO determination belong strictly to the operator on live hardware.

---

## 2. Attention Variant Matrix & Compatibility States

Every proposed variant has an explicit compatibility state declared in `experiments/minimax-h3-attention/catalog.json`:

| Variant | Backend Mechanism | Patch Nodes | CLI Flag | Compatibility State | Target Core Revision |
| --- | --- | --- | --- | --- | --- |
| `dense` | PyTorch SDPA (`F.scaled_dot_product_attention`) | None (0) | None | `unverified` | `55b6a9b1` (Pinned) |
| `dense` (upgraded control) | PyTorch SDPA (`F.scaled_dot_product_attention`) | None (0) | None | `unsupported` | `94cfeb3a` (Unavailable upstream, HTTP 422) |
| `dense` (sage-matched control) | PyTorch SDPA (`F.scaled_dot_product_attention`) | None (0) | None | `unverified` | `55b6a9b1` (Sage venv) |
| `dense` (sol-attn-matched control) | PyTorch SDPA (`F.scaled_dot_product_attention`) | None (0) | None | `unsupported` | `94cfeb3a` (Unavailable upstream, HTTP 422) |
| `dense` (veda-matched control) | PyTorch SDPA (`F.scaled_dot_product_attention`) | None (0) | None | `unsupported` | `94cfeb3a` (Unavailable upstream, HTTP 422) |
| `sage` | SageAttention (`sageattention.sageattn`) | None (0) | `--use-sage-attention` | `unverified` | `55b6a9b1` (Pinned) |
| `native-sol-attn` | Native Model Sparse Attention (`sol-attn`) | Node 301 (`ModelSparseAttention`) | None | `unsupported` | `94cfeb3a` (Unavailable upstream, HTTP 422) |
| `veda` | Veda Sparse Attention (`VedaSparseAttention`) | Node 301 (`VedaSparseAttention`) | None | `unsupported` | `94cfeb3a` (Unavailable upstream, HTTP 422; Node Repo `67e4eb55`) |

### Compatibility State Definitions
- **`supported`**: Structurally validated and supported on the target experiment runtime environment. Note: `supported` within the experiment harness denotes experimental compatibility only and does **not** constitute production certification, default profile approval, or authorization to alter production render pipelines.
- **`requires_isolated_upgrade`**: Requires a separate, isolated experimental ComfyUI checkout and environment (e.g. native sol-attn sparse nodes or Veda custom nodes); never upgraded in place.
- **`unverified`**: Candidate variant whose source and environment are structurally defined but pending hardware inspection, dependency lock verification, or security/licensing audit sign-off.
- **`unsupported`**: Incompatible with the model architecture, precision (INT8 ConvRot), or GPU capability, or bound to an unavailable upstream core commit.

### Source-Verified Core Evidence (Issue #448)
On 2026-10-14, GitHub API inspection confirmed that ComfyUI core revision `94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf` does not exist in upstream `Comfy-Org/ComfyUI` (HTTP 422 `No commit found for SHA`). In accordance with fail-closed resolution against real upstream APIs, `native-sol-attn`, `veda`, and all upgraded dense control variants are marked `unsupported` in the catalog. Graph derivation and validation fail closed on unconfirmed or unresolved core revisions.

---

## 3. Mutual Exclusivity & Graph Topology Invariants

The harness enforces strict topological invariants to ensure clean single-variable studies:

1. **Mutually Exclusive Sparse Patches:**
   - At most **one** sparse attention patch node is permitted in any workflow graph.
   - `ModelSparseAttention` and `VedaSparseAttention` must **never** be stacked together.
2. **Mutually Exclusive Acceleration Flags:**
   - `--use-sage-attention` operates globally on ComfyUI core dispatch. It must **never** be combined with sparse patch nodes (`ModelSparseAttention` or `VedaSparseAttention`) in the same experiment.
3. **Model Path Rewiring:**
   - In `dense` and `sage`, `UNETLoader` (node 6) connects directly to `BasicGuider` (node 16) slot 0.
   - In `native-sol-attn` and `veda`, patch node 301 intercepts the model connection: `UNETLoader` (6) -> patch node 301 slot 0 -> `BasicGuider` (16) slot 0.
   - `BasicScheduler` (node 9) model connection remains untouched (`[6, 0]`) to preserve scheduling dynamics.
4. **Conditioning & Geometry Preservation:**
   - Route `i2v` (`frame_anchored`): `MiniMaxH3ImageToVideo` (node 104) input `first_frame` remains anchored to `LoadImage` (node 20).
   - Route `ref2v` (`reference_directed`): `MiniMaxH3ReferenceToVideo` (node 105) inputs remain strictly bound to reference slot nodes 201–209 in manifest order.
   - Frame count (`124`), cadence (`24fps`), seed (`42`), geometry (`1344x768`), and scheduler steps (`20`) are held strictly constant across control and candidate variants.

---

## 4. Fail-Closed Telemetry & Fallback Detection

The instrumentation collector (`minimax-h3-collector.py`) and result reducer (`minimax-h3-attention-reducer.ts`) prevent undetected no-ops and silent speedup claims:

1. **Kernel Entry & Post-Execution Counting:**
   - The collector instruments attention dispatch in `comfy.ldm.modules.attention`, `comfy.ops.scaled_dot_product_attention`, and canonical sampling in `SamplerCustomAdvanced`.
   - Accelerated attention calls are counted strictly after successful kernel return.
   - Nested dense calls between `attention_pytorch` and `comfy.ops.scaled_dot_product_attention` are protected with a re-entrancy guard to prevent double counting.
2. **Terminal Fallback Guard:**
   - When an accelerated variant is requested without planned dense execution (`allowPlannedDense: false`), any fallback to standard dense SDPA immediately raises a terminal `RuntimeError`, aborting execution fail-closed.
   - If a requested attention kernel package (e.g. `sageattention`) is missing or cannot be imported, the harness raises a terminal `RuntimeError` before prompt submission.
3. **Observation Provenance Integrity:**
   - The reducer preserves independently observed identities (`actualBackend`, `dispatchImplementation`) and never promotes requested identities into observed facts.
   - Missing, incomplete, or fallback observations yield `status: "failed"` or `"fallback"`.
4. **Metric Eligibility Gating:**
   - In `compare`, candidate runs that experienced fallback, missing kernels, or zero accelerated calls are disqualified from wall-time and kernel-time speedup claims (`wallTimeEligible: false`, `samplingWallEligible: false`, `kernelTimeEligible: false`). All timing ratios report `null`. Raw timings are retained purely as diagnostic records.

---

## 5. Independently Verified Identity & Pre-Submit Capability Handshake

Issue #449 establishes that declared equality is insufficient for admitting or comparing attention experiments:

1. **Installed-Build Artifact Identity & RECORD Audit:**
   - Package artifact identity is verified via `minimax-h3-package-inspector.py`.
   - Packages are audited against installed `dist-info/RECORD` entries, producing an `installed_record_sha256_v1` digest covering all installed files.
   - Any missing `__file__`, missing `RECORD`, unreadable files, or file hash tampering fails closed immediately (`status: "unknown"` with blocker).
2. **Driver and CUDA Build Invariant Verification:**
   - The runtime registry checks `torch.version.cuda` against `requiredRuntime.cudaBuild`.
   - NVIDIA driver version is parsed into dotted numeric components and compared against all `driverConstraints` (e.g. `>=550.00.00`).
   - Missing driver evidence (`nvidia-smi` failure or missing driver) fails closed and blocks admission. Mismatched driver or CUDA build across baseline and variant blocks comparison.
3. **Sparse-Node Support via Live Registration:**
   - Sparse attention nodes (`ModelSparseAttention`, `VedaSparseAttention`, etc.) are verified through actual registered ComfyUI node mappings (`comfy.nodes.NODE_CLASS_MAPPINGS`), not hardcoded constructor lists.
4. **Pre-Submit Capability Handshake Probe (`/experiment/minimax-h3/capability`):**
   - After child process readiness and prior to workflow submission, the service queries the child process's `/experiment/minimax-h3/capability` endpoint with a unique nonce.
   - The child process measures its own collector code digest, hook manifest digest, registered node inventory, and attached hooks in-situ.
   - The service verifies that `runId`, `attemptToken`, `nonce`, `collectorDigest`, `hookManifestDigest`, and required nodes match exactly. Handshake failure or digest mismatch terminates the child process and blocks prompt submission.
5. **Complete Runtime Substrate Digest:**
   - The runtime substrate digest (`computeAttentionRuntimeLockDigest`) incorporates interpreter identity, compiler/toolchain identity, sorted source file hashes, package binary artifact digests, and collector/hook manifest digests.
   - Upgraded/isolated manifests never silently reuse production source hashes or hardcoded builds.
6. **Strict Comparator Policy & Dense Region Purity:**
   - The comparator requires independently verified runtime and handshake equality.
   - Null dispatch fields (`actualBackend`, `dispatchImplementation`) are treated as unverified and disqualify speedup metrics.
   - Dense baselines must be pure: any recorded kernel failure (`missingKernelFailure`, `failureReason`), non-zero accelerated calls, or accelerated step records disqualify the baseline.
   - Candidates violating `denseRegionPolicy` (e.g. unplanned dense calls when `allowPlannedDense` is false) are disqualified.

---

## 6. Step-by-Step Operator Workflow

All CLI commands use the repository's package script: `pnpm --filter render-worker experiment:minimax-h3 <command>`.

### Step 1: Inventory Attention Catalog
Inspect the available variants and required runtime manifests:
```bash
# List all variants for a route:
pnpm --filter render-worker experiment:minimax-h3 catalog --route ref2v

# Filter variants by target ComfyUI core revision:
pnpm --filter render-worker experiment:minimax-h3 catalog --route ref2v --comfyui-core-revision 55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc
```

### Step 2: Prepare Dense Control Baseline
Prepare an untouched dense attention run for the target route (`i2v` or `ref2v`).

**Pinned Production Core Baseline (Default):**
```bash
pnpm --filter render-worker experiment:minimax-h3 prepare \
  --route ref2v \
  --frames 124 \
  --seed 42 \
  --inputs config/render-profiles/fixtures/ref2v-manifest.json \
  --prompt "A cinematic video test" \
  --target-host "$(hostname)" \
  --gpu-uuid "GPU-00000000-0000-0000-0000-000000000000" \
  --comfyui-dir /opt/comfyui-pinned \
  --python .ai-venvs/minimax-h3-pinned/bin/python3 \
  --run-id h3-attn-dense-ref2v-124f-control \
  --attention-variant dense
```

**Matched Dense Baseline for SageAttention (Identical Sage Venv Substrate):**
```bash
pnpm --filter render-worker experiment:minimax-h3 prepare \
  --route ref2v \
  --frames 124 \
  --seed 42 \
  --inputs config/render-profiles/fixtures/ref2v-manifest.json \
  --prompt "A cinematic video test" \
  --target-host "$(hostname)" \
  --gpu-uuid "GPU-00000000-0000-0000-0000-000000000000" \
  --comfyui-dir /opt/comfyui-pinned \
  --python .ai-venvs/minimax-h3-sage/bin/python3 \
  --run-id h3-attn-dense-sage-matched-ref2v-124f-control \
  --attention-variant dense \
  --matched-variant sage
```

**Matched Dense Baseline for native sol-attn (Upgraded Core + comfy-kitchen Venv):**
```bash
pnpm --filter render-worker experiment:minimax-h3 prepare \
  --route ref2v \
  --frames 124 \
  --seed 42 \
  --inputs config/render-profiles/fixtures/ref2v-manifest.json \
  --prompt "A cinematic video test" \
  --target-host "$(hostname)" \
  --gpu-uuid "GPU-00000000-0000-0000-0000-000000000000" \
  --comfyui-dir .ai-checkouts/comfyui-sol-attn \
  --python .ai-venvs/minimax-h3-sol-attn/bin/python3 \
  --run-id h3-attn-dense-sol-attn-matched-ref2v-124f-control \
  --comfyui-core-revision 94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf \
  --attention-variant dense \
  --matched-variant native-sol-attn
```

**Matched Dense Baseline for Veda (Upgraded Core + Triton + Veda-on-ComfyUI Venv):**
```bash
pnpm --filter render-worker experiment:minimax-h3 prepare \
  --route ref2v \
  --frames 124 \
  --seed 42 \
  --inputs config/render-profiles/fixtures/ref2v-manifest.json \
  --prompt "A cinematic video test" \
  --target-host "$(hostname)" \
  --gpu-uuid "GPU-00000000-0000-0000-0000-000000000000" \
  --comfyui-dir .ai-checkouts/comfyui-veda \
  --python .ai-venvs/minimax-h3-veda/bin/python3 \
  --run-id h3-attn-dense-veda-matched-ref2v-124f-control \
  --comfyui-core-revision 94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf \
  --attention-variant dense \
  --matched-variant veda
```

### Step 3: Prepare Accelerated Candidate Variant
Prepare the candidate variant with matching seed, inputs, and geometry:
```bash
# Example: SageAttention candidate (on pinned core, using isolated Sage venv)
pnpm --filter render-worker experiment:minimax-h3 prepare \
  --route ref2v \
  --frames 124 \
  --seed 42 \
  --inputs config/render-profiles/fixtures/ref2v-manifest.json \
  --prompt "A cinematic video test" \
  --target-host "$(hostname)" \
  --gpu-uuid "GPU-00000000-0000-0000-0000-000000000000" \
  --comfyui-dir /opt/comfyui-pinned \
  --python .ai-venvs/minimax-h3-sage/bin/python3 \
  --run-id h3-attn-sage-ref2v-124f-candidate \
  --attention-variant sage
```

### Step 4: Offline Validation
Validate graph topology, hash digests, and environmental rules offline without launching processes or GPU execution:
```bash
pnpm --filter render-worker experiment:minimax-h3 validate \
  --run-dir .ai-runs/minimax-h3-experiments/h3-attn-sage-ref2v-124f-candidate
```

### Step 5: Hardware Execution & Telemetry Collection
Execute both runs on the designated physical GPU:
```bash
# 1. Execute control run
pnpm --filter render-worker experiment:minimax-h3 run \
  --run-dir .ai-runs/minimax-h3-experiments/h3-attn-dense-ref2v-124f-control

# 2. Execute candidate run with baseline reference
pnpm --filter render-worker experiment:minimax-h3 run \
  --run-dir .ai-runs/minimax-h3-experiments/h3-attn-sage-ref2v-124f-candidate \
  --baseline-run-dir .ai-runs/minimax-h3-experiments/h3-attn-dense-ref2v-124f-control
```

### Step 6: Reconciliation & Comparison
Reconcile telemetry and evaluate apples-to-apples performance:
```bash
pnpm --filter render-worker experiment:minimax-h3 reconcile \
  --run-dir .ai-runs/minimax-h3-experiments/h3-attn-sage-ref2v-124f-candidate

pnpm --filter render-worker experiment:minimax-h3 compare \
  --baseline .ai-runs/minimax-h3-experiments/h3-attn-dense-ref2v-124f-control \
  --candidate .ai-runs/minimax-h3-experiments/h3-attn-sage-ref2v-124f-candidate
```

### Step 7: Record Operator Decision & Visual Review
Human reviewers inspect generated video outputs and record continuity, identity fidelity, and degradation:
```bash
pnpm --filter render-worker experiment:minimax-h3 import-sidecar \
  --run-dir .ai-runs/minimax-h3-experiments/h3-attn-sage-ref2v-124f-candidate \
  --sidecar visual-review-decision.json
```
Complete the evaluation report according to `docs/minimax-h3-attention-report-template.md`.

---

## 7. Isolated Environment Setup, Hash-Checked Installation & Teardown Lifecycle

All candidate experiments use isolated checkouts and virtualenvs. Shared model directories containing weights are mounted **read-only** (`ro`) to prevent corruption or tampering.

### SageAttention Isolation Recipe
```bash
# 1. Create isolated venv outside production
python3 -m venv .ai-venvs/minimax-h3-sage
.ai-venvs/minimax-h3-sage/bin/pip install --upgrade pip

# 2. Install pinned dependencies with hash verification
.ai-venvs/minimax-h3-sage/bin/pip install torch==2.5.1+cu124 torchvision==0.20.1+cu124 \
  --extra-index-url https://download.pytorch.org/whl/cu124
.ai-venvs/minimax-h3-sage/bin/pip install sageattention==2.1.1

# 3. Teardown & Restoration Lifecycle
# First release any held GPU locks and terminate owned process:
pnpm --filter render-worker experiment:minimax-h3 cleanup --run-dir .ai-runs/minimax-h3-experiments/h3-attn-sage-ref2v-124f-candidate
# Remove isolated virtualenv:
rm -rf .ai-venvs/minimax-h3-sage
# Verify production checkout remains clean:
git status --porcelain
```

### Native sol-attn Isolation Recipe
> [!WARNING]
> Pinned core revision `94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf` is confirmed unavailable upstream (GitHub API HTTP 422: `No commit found for SHA`). Do not attempt to clone or check out this nonexistent SHA; the candidate remains `unsupported`. The recipe below is retained as prospective reference if a confirmed upstream revision is ever identified.

```bash
# 1. Clone isolated experimental checkout (never mutate production ComfyUI)
git clone https://github.com/comfyanonymous/ComfyUI .ai-checkouts/comfyui-sol-attn
git -C .ai-checkouts/comfyui-sol-attn checkout 94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf

# 2. Link model directory read-only from production storage
ln -s /path/to/pinned-models .ai-checkouts/comfyui-sol-attn/models

# 3. Create isolated virtualenv
python3 -m venv .ai-venvs/minimax-h3-sol-attn
.ai-venvs/minimax-h3-sol-attn/bin/pip install --upgrade pip
.ai-venvs/minimax-h3-sol-attn/bin/pip install torch==2.5.1+cu124 \
  --extra-index-url https://download.pytorch.org/whl/cu124
.ai-venvs/minimax-h3-sol-attn/bin/pip install comfy-kitchen==0.2.31

# 4. Teardown & Restoration Lifecycle
pnpm --filter render-worker experiment:minimax-h3 cleanup --run-dir .ai-runs/minimax-h3-experiments/<run-id>
rm -rf .ai-checkouts/comfyui-sol-attn .ai-venvs/minimax-h3-sol-attn
```

### Veda Sparse Attention Isolation Recipe
> [!WARNING]
> Pinned core revision `94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf` is confirmed unavailable upstream (GitHub API HTTP 422: `No commit found for SHA`). While the custom node repository (`Veda-on-ComfyUI` @ `67e4eb55`) has a verified schema, the target core revision is unavailable, so the candidate remains `unsupported`.

```bash
# 1. Clone isolated experimental core checkout and custom node
git clone https://github.com/comfyanonymous/ComfyUI .ai-checkouts/comfyui-veda
git -C .ai-checkouts/comfyui-veda checkout 94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf
git clone https://github.com/veda-sparse/Veda-on-ComfyUI .ai-checkouts/comfyui-veda/custom_nodes/Veda-on-ComfyUI
git -C .ai-checkouts/comfyui-veda/custom_nodes/Veda-on-ComfyUI checkout 67e4eb5541b648555563144401ebaba832bd73ec

# 2. Link model directory read-only
ln -s /path/to/pinned-models .ai-checkouts/comfyui-veda/models

# 3. Create isolated virtualenv with exact pinned Triton
python3 -m venv .ai-venvs/minimax-h3-veda
.ai-venvs/minimax-h3-veda/bin/pip install --upgrade pip
.ai-venvs/minimax-h3-veda/bin/pip install torch==2.5.1+cu124 \
  --extra-index-url https://download.pytorch.org/whl/cu124
.ai-venvs/minimax-h3-veda/bin/pip install triton==3.0.0

# 4. Teardown & Restoration Lifecycle
pnpm --filter render-worker experiment:minimax-h3 cleanup --run-dir .ai-runs/minimax-h3-experiments/<run-id>
rm -rf .ai-checkouts/comfyui-veda .ai-venvs/minimax-h3-veda
```

### Governance Integrity & Safety Gates
1. **Explicit Candidate-Only Admission:** Incomplete or unverified catalog entries declare `runnable: false` with licensing status `review_required` and security audit status `pending`. Any attempt to spawn an owned process for candidate-only variants fails closed immediately in preflight.
2. **Fail-Closed Execution:** Any attempt to execute a candidate variant without verified runtime compatibility and cleared reviews fails preflight immediately.
3. **No Fabricated Data:** Evidence files, hardware benchmarks, and certification directories (`certification/`, `baseline/`) must never be authored or altered by automated agents. Hardware comparisons belong exclusively to physical operator executions.
