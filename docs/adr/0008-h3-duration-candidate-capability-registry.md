# 8. Versioned MiniMax-H3 Duration-Capability Registry and Candidate Profile Contracts

Date: 2026-10-18

## Status

Accepted

## Context

In commercial generative video production, the MiniMax-H3 model was initially certified exclusively for a single 5-second duration (124 frames at 24 fps) across two production profiles:
- `MINIMAX_H3_720P_5S_I2V_V1` (`frame_anchored` / I2V)
- `MINIMAX_H3_720P_5S_REF2V_V1` (`reference_directed` / Ref2V)

Both profiles execute on native 1344x768 geometry (nominal 720p) at 20 steps with dynamic VRAM offloading (`dynamicvram-offload-v1`) on dedicated NVIDIA RTX 4090 hardware.

To support variable-duration video generation (Issue #421, #424), candidate durations (such as 8s / 192f, 10s / 243f, 15s / 362f) have been proposed. However:
1. **Empirical Continuity and Quality Gates (#423, #445):** In initial continuity testing (#423), 362-frame I2V suffered visual blackout / NO-GO, while Ref2V extended durations remained untested. #445 (operator speed and continuity optimization) is required to evaluate exact execution configurations across checkpoints, attention backends (e.g. SageAttention), Turbo LoRAs, and step counts.
2. **Separation of Research Viability from Production Certification (#428):** Research viability determined by #445 does not constitute production certification. Final production certification rests solely with operator #428, requiring signed gold-master provenance, exact artifact hashes, and repeatable host execution.
3. **No Premature Broadening:** Model-wide advertised frame ranges must never imply certification. Off-grid, uncertified, wrong-geometry, wrong-route, or wrong-host candidates must fail closed.
4. **Governance Boundary:** Autonomous agents must never author synthetic or fabricated measurements, approval records, or gold-master artifacts in `certification/`, `baseline/`, or `config/render-profiles/`.

Parent: #421 (MiniMax-H3 variable duration capability)
Issue: #424 (Add versioned H3 duration-capability registry and candidate profile contracts)
Prerequisite: #445 (Research viability decision matrix)
Release Authority: #428 (Staging grant and production certification)

---

## Decision

We establish the foundational candidate-capability and governance architecture for MiniMax-H3 duration expansion:

> **"Candidate profiles are distinct, immutable, versioned execution specifications that must remain non-dispatchable for general production until explicitly qualified by #445 research evidence and signed by #428 operator authority. In the absence of an operator-accepted decision matrix, the accepted candidate catalog is strictly EMPTY. No unknown or pending entries are ever treated as approved."**

---

### 1. Immutable Candidate Specification and Identity

A candidate profile cannot be identified by frame count alone. It is uniquely and immutably bound to an **exact execution specification**:

```text
H3CandidateExecutionSpecification:
  - version: 1
  - route: "i2v" | "ref2v"
  - routingMode: "frame_anchored" | "reference_directed"
    (Invariant: i2v <-> frame_anchored; ref2v <-> reference_directed)
  - width: positive safe integer (e.g. 1344)
  - height: positive safe integer (e.g. 768)
  - fps: 24
  - frames: exact positive integer satisfying (frames - 5) % 17 === 0
  - workflowHash: lowercase 64-char hex SHA-256
  - modelHashes: complete keyed map of required models:
      checkpoint: SHA-256
      clip: SHA-256
      audioVae: SHA-256
      videoVae: SHA-256
      turboLora: SHA-256 | "none"
      additionalModels: Record<string, SHA-256>
  - sampler: non-empty trimmed string (e.g. "euler")
  - scheduler: non-empty trimmed string (e.g. "simple")
  - steps: positive integer (e.g. 20, 8, 4)
  - cfg: positive finite number
  - denoise: positive finite number (0 < denoise <= 1)
  - attention:
      backend: "flash_attn" | "sage_attn" | "sdpa" | "standard" | "comfy_native"
      customNodeRevision: non-empty string | "none"
      customNodeSourceHash: SHA-256 | "none"
      packageVersion: non-empty string | "none"
      sparsitySettings: { enabled: boolean; method: string; threshold: number }
  - runnerSettings:
      runnerProfile: non-empty string
      offloadPolicy: "dynamicvram" | "highvram" | "cpu_offload" | "none"
      requiresModelOffloading: boolean
      maxConcurrentGpuJobs: positive integer
      minFreeDiskGb: positive finite number
  - customNodes: array of { name: string; revision: string; sourceHash: SHA-256 }
  - packageVersions: Record<string, string>
```

#### Canonical Digest and Candidate Key
- The specification is serialized via recursive key sorting (`canonicalizeJson`) and hashed via SHA-256 to produce `specificationDigest`.
- Any change to any field produces a different `specificationDigest`, establishing immutable identity.
- Candidate keys use the reserved namespace:
  `H3_CANDIDATE_<32-char-digest>_V<version>`
  Candidate keys cannot collide with legacy production keys (`MINIMAX_H3_720P_5S_I2V_V1`).

---

### 2. Catalog State: Empty by Default

1. **Initial Zero State:** The production candidate catalog contains **zero accepted candidates**.
2. **Recognition Semantics:** `getH3CandidateProfile(key)` returns `undefined` for all candidate keys until #445 evidence is signed and admitted.
3. **No Production Mutation or Bypass:** No registration function, mutable backing map, or synthetic bypass flag (e.g. `allowSynthetic`) is exported from `@cco/contracts` or reachable in production.
4. **Test Isolation:** Testing harnesses construct local, deep-frozen candidate registries disconnected from the shared production catalog. Test registries are instantiated only inside test suites via non-exported test helpers.

---

### 3. Signed Capability Decision Matrix (#445)

Research viability is recorded in a versioned decision matrix:

```typescript
export interface H3CapabilityDecisionRow {
  readonly specification: H3CandidateExecutionSpecification;
  readonly specificationDigest: string;
  readonly speedVerdict: "pass" | "fail" | "unknown";
  readonly qualityVerdict: "pass" | "fail" | "unknown";
  readonly overallVerdict: "pass" | "fail" | "unknown";
  readonly evidenceDigests: readonly string[];
  readonly operatorIdentity: string;
  readonly decidedAt: string;
  readonly notes?: string;
}

export interface H3CapabilityMatrixEnvelope {
  readonly version: 1;
  readonly matrixId: string;
  readonly rows: readonly H3CapabilityDecisionRow[];
  readonly signedBy: string;
  readonly signatureHex: string;
  readonly signedAt: string;
}
```

- Only an authenticated exact-tuple with `overallVerdict: "pass"` and complete backing evidence digests can be admitted into the accepted catalog in a subsequent issue.
- `fail` and `unknown` verdicts remain recorded for audit but can never enter the accepted catalog.
- Absence of an entry is denial.

---

### 4. Release Fence: Staging vs Production Authority (#428)

Research acceptance (#445) is distinct from authorization to execute. We distinguish two explicit authorization scopes:

1. **Staging Authorization Grant:**
   - Authorizes execution of an accepted candidate strictly for staging/benchmarking purposes on a designated host.
   - Binds candidate key, specification digest, target hostname, target GPU UUID, and validity window.
   - Does NOT permit general production dispatch.
2. **Production Certification Grant:**
   - Final #428 operator certification for general production dispatch.
   - Binds gold-master workflow hash, model hashes, verified measurements, and target hardware profile.

#### Trust Store and Verification
- Authorization grants are verified via the `H3CandidateAuthorizationPort`.
- Verification uses cryptographic detached signatures against a deployment-owned operator trust key store.
- **Fail-Closed Authorization Rule:** Caller-supplied authorization claims or fingerprints are never accepted as a substitute for the authorization port. If the authorization port denies or is absent, candidate execution is denied.

---

### 5. Profile-Scoped Frame Validity

We deprecate the single global `MINIMAX_H3_SUPPORTED_FRAME_RANGE` [124, 124] in favor of **profile-scoped capabilities**:

- `resolveH3ProfileFrameCapabilities(profileKeyOrId)`:
  - Legacy `MINIMAX_H3_720P_5S_I2V_V1` (and aliases) resolves to `allowedFrameCounts: [124]`.
  - Legacy `MINIMAX_H3_720P_5S_REF2V_V1` (and aliases) resolves to `allowedFrameCounts: [124]`.
  - Future accepted candidates resolve strictly to `[specification.frames]`.
  - Unknown or unaccepted profiles resolve to `undefined` (disallowing all frames).
- Frame count validation must check membership in the profile's allowed set and enforce `(frames - 5) % 17 === 0`.
- No interpolation, model advertising, or range expansion is permitted.

---

### 6. Live Runtime Observation Invariant

Candidate eligibility evaluation does not rely on declared configuration or comparing two configured strings. It must **actually observe** the live runtime state:

1. Local hostname matching `os.hostname()`.
2. Physical GPU UUID verified against live `nvidia-smi`. Missing `nvidia-smi` or non-matching GPU fails closed (no ENOENT tolerance).
3. Live process binding: target ComfyUI socket/PID, process start time ticks, and python interpreter executable.
4. Git revision and custom-node source hashes verified against live files.
5. Installed package versions verified against live runtime environment.
6. **Anti-Drift Verification:** Process PID and process start time ticks are re-observed at the completion of verification. If the target process restarted or drifted during checks, eligibility is denied.

---

## Consequences

### Positive
- Legacy 5s profiles remain byte-for-byte semantically unchanged.
- Candidate profiles cannot leak into general production dispatch without explicit, multi-tier operator sign-offs.
- The empty initial catalog prevents accidental dispatch of untested 192f/243f/362f configurations.
- Test suites can safely test synthetic candidate pipelines in complete isolation without affecting production state.

### Negative / Trade-offs
- Adding new duration candidates requires a multi-step operator pipeline: #445 empirical matrix -> candidate profile registration -> #428 staging/production signing.
