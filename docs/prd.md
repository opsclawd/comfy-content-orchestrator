# PRODUCT REQUIREMENTS DOCUMENT (PRD)

**Project Name:** Godzspeed Sovereign Content Orchestration Platform & Creative Review Hub  
**Repository:** `opsclawd/comfy-content-orchestrator`  
**Document Version:** 3.5.2 (GenerationManifest Provenance & Capability-Dependent Audio Reconciliation)  
**Status:** Implementation Ready — Sprint 1 Certified / Sprint 1.5 Ready  
**Runtime & Stack:** TypeScript / Node.js 24 LTS ("Krypton") | Next.js Review Hub | ComfyUI Headless | Tailscale (WireGuard Mesh) | PostgreSQL 18.6 | MinIO (S3-Compatible Review Media Store)  
**Hardware Profile:** AMD Ryzen 7 7700 (8C/16T) | 32GB DDR5-5600 RAM certified for the dedicated Phase 1 single-render workload | NVIDIA RTX 4090 (24GB GDDR6X) | 2TB PCIe 4.0 NVMe SSD  
**Key Stakeholders:**
- **Creative Director:** Thomas Cumberbatch (Godzspeed Communications, Canada)
- **Technical Lead & Content Creator:** Agency Lead (Godzspeed Trinidad & Tobago Division)
- **Cloud Control Plane:** Hetzner Cloud CPX31 VPS (Falkenstein, Germany / Tailscale-only application access)

## 0. Version 3.5.2 Change Summary

PRD v3.5.2 reconciles §5.5 Generation Manifest Contract with the certified physical capabilities of Phase 1 RenderProfiles (such as `LTX_25_720P_5S_V1` and `FLUX_SCHNELL_DRAFT_V1`) and enforces deterministic provenance derivation:

1. **Capability-Dependent Audio Prompt:** Explicitly defines `prompts/audio prompt` as capability-dependent rather than universally mandatory. Profiles lacking native audio generation capability (e.g. video-only `LTX_25_720P_5S_V1` or image-only `FLUX_SCHNELL_DRAFT_V1`) record `audioPrompt: null` in manifest provenance. Supplying an `audioPrompt` on a job targeted at a profile lacking audio capability is rejected before dispatch.
2. **Strict Post-Dispatch Workflow Provenance:** All sampling parameters and prompt fields in the manifest are authoritatively extracted directly from the post-injection finalized workflow dispatched to ComfyUI, eliminating any fallbacks to job queue injected payload values.
3. **Declarative Profile Injection Topology:** Render profiles declare their precise workflow injection node targets (`prompt`, `negativePrompt`, `seed`, `audioPrompt`) declaratively rather than relying on heuristic discovery.

Material changes carried forward from v3.5.1:

1. Reconciles Sprint 1 certification results with the committed `LTX_25_720P_5S_V1` RenderProfile.
2. Separates the exact certified Phase 1 execution model set from the broader point-in-time LTX-2.5 host inventory. The current inode-deduplicated host inventory is **72,026,403,347 bytes (72.03 GB decimal / 67.08 GiB)**; it is an inventory measurement, not part of the RenderProfile contract.
3. Records 32GB host RAM as supported for the dedicated Phase 1 single-render profile, with observed transient cold-page swap rather than sustained memory pressure.
4. Introduces a transitional **Sprint 1.5 — Review Plane Contract Closure** before Sprint 2.
5. Adds a first-class `StoryboardCandidate` model tied to `sceneId + SceneSpec revision` and requires database-enforced immutability, not application discipline alone.
6. Makes candidate selection explicit and auditable; approval of generated visual scenes requires a candidate from the current SceneSpec revision.
7. Defines browser/API optimistic concurrency, idempotency, reviewer authority, and stale-command behavior.
8. Moves runtime Scene/review-event transactional persistence into Sprint 1.5 so Sprint 2 does not build a UI over in-memory application services.
9. Clarifies Review Hub action semantics: `reject` is QA rejection; storyboard rejection/regeneration is `reroll`; `reorder` and `duplicate` are reserved but out of Phase 1 Review Hub scope.
10. Defines the canonical MinIO S3 endpoint and separates browser media delivery from MinIO administration.
11. Explicitly prohibits a temporary synchronous Review API -> ComfyUI render path. Durable candidate-generation dispatch is implemented with the PostgreSQL worker queue in Sprint 3.
12. Requires `storyboard_candidates` to reuse the repository's audit-protection pattern: database trigger enforcement plus fail-closed production-role privilege verification.
13. Adds a dedicated Candidate Immutability acceptance gate to Sprint 1.5.

These changes are contract, evidence, and sequencing corrections. They do not replace the Clean Architecture boundaries, PostgreSQL state store, MinIO review-store role, Tailscale perimeter, ComfyUI render plane, or certified RenderProfile architecture.

---

## 1. Executive Summary & Problem Space

### 1.1 Problem Statement

Boutique branding and digital marketing agencies targeting Caribbean and international markets face four core operational bottlenecks:

1. **High Turnaround & Team Overhead:** Traditional commercial agency production requires 4-6 specialized roles with turnaround times of 2 to 4 weeks per campaign.
2. **The "Spaghetti Node" Barrier:** In-house generative AI workflows in ComfyUI cannot scale when operated manually through a visual canvas. Manual node wiring introduces prompt drift, dependency rot, and no transactional execution boundary.
3. **The Cultural Representation Gap:** Generic foundation models can produce culturally inaccurate Caribbean imagery and require controlled references, prompts, LoRAs, review, and provenance.
4. **Cross-Border Direction Friction:** Remote creative direction across Canada and Trinidad using fragmented messaging creates visual misalignment before expensive GPU rendering begins.

### 1.2 The Solution

The **Godzspeed Content Orchestration Platform** is an AI-native creative production engine built around a strict **Human-on-the-Loop Compute Gate**:

- **Decoupled Architecture:** ComfyUI operates as an isolated headless rendering service controlled through application ports by TypeScript/Node.js orchestration.
- **Two-Tier Compute Sequencing:** Campaign briefs expand into fast FLUX.1 [schnell] storyboard candidates before expensive video generation.
- **Remote Director Gate:** Candidates, scripts, prompts, references, timing, engine selection, and LoRA configuration are reviewed through a private Next.js Review Hub over Tailscale.
- **Revision-Safe Approval:** A director approves a specific SceneSpec revision and, for generated visual scenes, a candidate belonging to that revision. Stale browser actions cannot approve a newer revision accidentally.
- **Deterministic Production Execution:** The Trinidad RTX 4090 executes pinned production workflows for FLUX.1 [schnell] stills, LTX 2.5 Distilled video, and headless FFmpeg assembly.
- **Controlled Cloud Cognition:** Planning, visual ranking, and voice synthesis use configured external APIs only when the client's external-processing policy permits them.
- **Sovereign Render Plane:** Diffusion checkpoints, LoRAs, long-term masters, and generation execution remain on agency-controlled infrastructure.

### 1.3 Target Performance & Capacity Model

| Metric | Manual Agency Baseline | Orchestrator Target |
|---|---:|---:|
| **Monthly Video Production Capacity** | 4-6 client video reels | **40-60 commercial reels / month** |
| **Monthly Stills & Photography** | 20-30 edited stills | **150-200 4K brand assets / month** |
| **Draft Storyboard Latency (18 frames)** | 24-48 hours | **< 45 seconds** (3 candidates x 6 scenes) |
| **Draft Keyframe Render Speed** | N/A | **~1.9s / frame** (FLUX [schnell] target profile) |
| **Video Shot Render Speed (LTX 2.5)** | 1-2 hours manual animation | **~45.6s certified median / 5s 720p, 97 frames, 8 steps** |
| **Full 30s Reel Turnaround** | 3-5 business days | **< 15-20 minutes** production batch target |
| **External Diffusion Compute Cost** | $15-$50 / asset via SaaS | **$0.00 marginal external diffusion cost** |
| **Security & Privacy Boundary** | Public third-party SaaS | **Private Render Plane + controlled external-processing policy** |

Performance values are operational targets unless explicitly marked as measured. Certified measurements are tied to exact workflow/model hashes and runner identity.

---

## 2. Infrastructure Topology & Security Perimeter

The system uses a **hybrid split-plane topology** separating persistent control/review services from local GPU execution.

### 2.1 Deployment Plane Segmentation

#### A. Cloud Control Plane — Hetzner CPX31, Falkenstein

Responsibilities:

- PostgreSQL 18.6 relational state, review history, and durable worker leases.
- Control API composition root.
- Next.js Director Review Hub.
- MinIO S3-compatible object storage for review proxies, storyboard candidates, reference previews, and time-bounded delivery media.
- Short-lived presigned browser media access.
- Prometheus-compatible application metrics.
- No ComfyUI inference workloads.

PostgreSQL 18 asynchronous I/O uses the platform default `io_method = 'worker'`. `io_workers` remains deployment-tuned rather than an architectural constant.

#### B. Local Compute Runner — Trinidad Inference Workstation

Responsibilities:

- ComfyUI headless daemon.
- TypeScript render worker under Node.js 24 LTS.
- Local NVMe model checkpoint and cultural LoRA vault.
- Long-term generation master storage.
- FFmpeg media assembly.
- NVIDIA NVML health/VRAM telemetry.
- Upload of review proxies and explicitly selected delivery media to MinIO over Tailscale.

Network bindings:

- ComfyUI: loopback and explicitly authorized Tailscale interface only.
- Render-worker control surface: Tailscale interface only when remotely required.
- No public WAN listener.

#### C. Remote Review & Direction Plane — Ottawa, Canada

The Creative Director accesses the Review Hub on the control-plane host's MagicDNS name and Review Hub port (see §2.2), through Tailscale/MagicDNS.

The browser talks only to the Review Hub / Control API contracts. It never imports or invokes application/infrastructure implementations directly.

### 2.2 Network Overlay & Asset Distribution Security

Canonical tailnet namespace: the tailnet's Tailscale-assigned MagicDNS suffix. Services are addressed by **host MagicDNS name plus port**, not by per-service DNS names.

**Why not per-service names.** An earlier revision of this document specified four distinct names (`review`, `control-01`, `render-01`, `storage-01`) under a custom `godzspeed-internal.ts.net` suffix. That scheme is not implementable as written: the Review Hub, Control API, and S3 endpoint all run on a **single** control-plane host, and Tailscale MagicDNS assigns exactly one DNS name per device — it does not support aliases or arbitrary records ("It's not possible to add arbitrary records to MagicDNS," Tailscale DNS documentation). Producing three distinct names for one machine would require operating a separate split-DNS nameserver, which is disproportionate infrastructure for a naming convenience. Port-based addressing is therefore the canonical scheme.

Canonical application endpoints:

| Service | Address | Exposure |
|---|---|---|
| **Review Hub** | `<control-plane-host>.<tailnet-suffix>:<REVIEW_HUB_PORT>` | Tailscale interface only |
| **Control API** | `<control-plane-host>.<tailnet-suffix>:<CONTROL_API_PORT>` | Tailscale interface only |
| **S3 Review Media Endpoint** | `<control-plane-host>.<tailnet-suffix>:<S3_PORT>` | Tailscale interface only |
| **MinIO Administrative Console** | `127.0.0.1:<MINIO_CONSOLE_PORT>` | Loopback only — never published to the tailnet |
| **Compute Runner** | render-worker host's own MagicDNS name | Tailscale interface only |

The Compute Runner is a genuinely separate device and therefore keeps its own MagicDNS name with no aliasing required.

All host, port, and endpoint values are supplied as configuration (see `.env.example`); no hostname or port literal is hardcoded in application code.

If the tailnet is later renamed, or if storage or render surfaces move to genuinely separate hosts, per-service MagicDNS names become available for those hosts at no extra cost — this scheme does not preclude that.

Rules:

- Application, PostgreSQL, ComfyUI, and MinIO endpoints have zero public inbound exposure.
- Browser media is delivered using short-lived presigned URLs targeting the tailnet-only S3 endpoint.
- Presigned URLs are never persisted as canonical asset identifiers.
- Database records store bucket/object keys and content hashes.
- The MinIO administrative console is not a Review Hub dependency and is restricted to operator access through tailnet ACLs and/or local administrative binding.
- Review browser access to S3 does not imply MinIO administrative access.
- Final deployment acceptance requires a real public-WAN exposure audit; configuration files alone do not satisfy the gate.

### 2.3 MinIO Object Lifecycle & Capacity Controls

The CPX31 system disk is not an unlimited archive. MinIO is a **review/distribution layer**; long-term generation masters remain in the Trinidad asset vault and backup system.

#### Bucket Classes

| Bucket / Class | Purpose | Default Retention |
|---|---|---|
| `godzspeed-temp` | rejected candidates, transient intermediates, temporary render stems | **14 days** |
| `godzspeed-review` | storyboard candidates, WebP keyframes, proxy MP4s, review audio | **60 days** |
| `godzspeed-reference` | active client logos, reference previews, compact brand assets | **while client is active** |
| `godzspeed-delivery` | approved delivery copies awaiting client handoff | **90 days after campaign completion** |

Retention is enforced by S3 lifecycle rules. Client contracts may override defaults.

#### Capacity Watermarks

- **<70%:** normal operation.
- **70% warning:** emit alert and accelerate cleanup of lifecycle-eligible temporary/review objects. Do not block normal work solely at this threshold.
- **85% degraded:** stop admission of new nonessential candidate/proxy uploads and new candidate-generation work requiring additional review storage; continue cleanup and explicitly approved delivery operations where capacity permits.
- **92% critical:** block new media writes except cleanup/repair operations, prevent campaigns from entering candidate-generation or production states requiring new media, and require operator capacity recovery.

Watermark policy is application-visible. The generic object-storage adapter does not decide business admission policy itself.

If media usage remains above 60% of CPX31 disk capacity for 14 consecutive days, migrate MinIO data to a dedicated storage volume/service rather than increasing local retention pressure.

Required metrics:

- `object_storage_bytes{bucket}`
- `storage_free_bytes`
- `storage_watermark_state`

### 2.4 MinIO Component Governance

MinIO Object Store is tracked as an infrastructure dependency under GNU AGPLv3.

Agency policy:

- Deploy MinIO as a separate, unmodified S3-compatible service.
- Do not embed MinIO server code into proprietary application binaries.
- Record deployed version, license source, and review date in the component license registry.
- Require OSS/legal review before modifying MinIO, redistributing it, or creating a derivative integration that could alter source-availability obligations.
- A future S3-compatible backend may replace MinIO without changing application-domain contracts.

### 2.5 Review Plane Transport Security & Reviewer Authentication

**Status: reviewer authentication resolved (ADR-0002). TLS still required; tracked in issue #90 (rescoped to TLS-only).**

The tailnet is the current access-control boundary: reaching the Review Hub at all requires being an authorized device on the tailnet, and reviewer identity is derived from the Tailscale-layer connection rather than a browser-supplied value (§6, `TailscaleReviewerIdentityResolver`). That is sufficient for internal operation, and the Review Hub runs over plain HTTP on the tailnet today.

**Reviewer authentication is resolved.** Per ADR-0002, Tailscale device identity *is* the authentication boundary. `TailscaleReviewerIdentityResolver` is the single source of reviewer identity for all audit-bearing actions. No separate username/password or session/login layer will be built for the Review Hub. The previously-flagged "open product decision" is closed; the decision is documented, the trade-offs are recorded, and the trigger condition for revisiting (shared devices equating to shared audit identity) is explicit in the ADR.

**Transport security (TLS) is deliberately deferred, not built.** *Updated 2026-09-04:* issue #90 was closed "not planned" — given the tailnet is already the access-control boundary (WireGuard-encrypted transport, zero public exposure per §2.2), a separate application-level TLS certificate was judged not load-bearing for the actual threat model. The Review Hub continues to run over plain HTTP on the tailnet. This decision mirrors the same "deferred by decision, not pending work" pattern already established for the MagicDNS naming gap (issue #87). Revisit if a future browser API requirement genuinely needs a secure context (this already happened once — see the `crypto.randomUUID()` fix, issue #182 — and was resolved in-place rather than reopening the TLS decision).

---

## 3. Compute Isolation, Model Lifecycle & Resilience

### 3.1 Strict Compute Isolation & VRAM Lifecycle Management

The RTX 4090 is reserved for diffusion execution. Cognitive cloud workloads consume no local VRAM when external processing is permitted.

#### ComfyUI Startup Profile

The Phase 1 production baseline is ComfyUI default DynamicVRAM / workflow-managed offloading.

`--gpu-only` is prohibited for the certified LTX Phase 1 profile. `--highvram` remains experimental unless separately certified. Mutually exclusive VRAM flags are never combined.

The exact ComfyUI commit, startup arguments, workflow identity, model hashes, and selected memory mode are persisted with the certified runner profile.

#### VRAM Unload & Transition Protocol

When changing model families, for example FLUX -> LTX:

1. The orchestrator requests ComfyUI model unload using `/free` with `free_memory` and `unload_models`.
2. ComfyUI performs its own Python/model reclamation behavior.
3. The Node.js orchestrator does not claim to call Python `gc.collect()` or `torch.cuda.empty_cache()` directly.
4. The orchestrator polls NVML telemetry until configured headroom is reached.
5. The next heavyweight model family is not dispatched until headroom is satisfied or cleanup times out.
6. Failure to reclaim sufficient VRAM marks the worker degraded and prevents the next heavyweight render from starting.

### 3.1.1 Certified LTX-2.5 Phase 1 Baseline

Two different disk measurements exist and **must not be conflated or assigned equal provenance**:

- **Current locally downloaded LTX-2.5 family inventory on the Trinidad host:** **72,026,403,347 bytes = 72.03 GB decimal = 67.08 GiB**, measured with inode deduplication across the downloaded model-family material. This is a **point-in-time host inventory measurement**, not a RenderProfile field or production execution requirement; it may change as optional LTX-family files are added or removed.
- **Exact certified execution model set used by `LTX_25_720P_5S_V1`:** **38,329,275,932 bytes = 38.329275932 GB decimal** for the pinned text encoder, diffusion transformer, and VAE. This value is tied to exact file hashes and is part of the certified production execution profile.

The >=100GB free-disk reservation remains mandatory to provide model/cache/update headroom and is not reduced to either measured byte sum.

Certified profile: `config/render-profiles/LTX_25_720P_5S_V1.json`.

| Property | Certified value |
|---|---:|
| Resolution | **1280x720** |
| Frames | **97** |
| Approximate duration | **5 seconds** |
| DiT steps | **8** |
| Runner profile | **dynamicvram-offload-v1** |
| Peak VRAM under FLUX/LTX transition load | **24,038MB** |
| Median total duration across LTX soak iterations | **45,632ms** |
| Peak host RAM used | **29,384MB** |
| Peak process RSS | **27,043MB** |
| Maximum LTX swap delta | **89MB** |
| Major page faults observed | **1,009** |
| Certified execution model set | **38.329275932GB** |
| Minimum free disk reservation | **100GB** |
| Concurrent GPU jobs | **1** |
| Requires model offloading | **true** |

The original transition-soak binary `noSwapActivity` predicate failed because Linux performed limited cold-page swap during early iterations. The committed certification assessment records that swap ceased, headroom remained stable, there was no progressive VRAM/RAM leak, no OOM, and no ComfyUI restart. The dedicated 32GB Phase 1 single-generation profile is therefore certified with that limitation documented rather than hidden.

### 3.1.2 Phase 1 GPU Concurrency Invariant

A Trinidad RTX 4090 Render Worker executes **at most one active diffusion generation at a time**.

CPU-side uploads, database operations, cloud API calls, and metadata processing may overlap with GPU inference. A second diffusion job cannot enter GPU execution until the active job releases the local GPU execution lease and the required VRAM headroom is verified.

### 3.1.3 Phase 1 Host RAM Decision

**32GB remains supported for Phase 1** only for the certified dedicated-host operating profile: one active diffusion generation, pinned DynamicVRAM/offloading behavior, and the certified workflow/model set.

64GB remains required for Phase 2 heavy-engine certification and becomes a Phase 1 upgrade requirement if future regression testing shows:

- sustained or growing swap pressure rather than bounded cold-page behavior;
- inadequate OS/worker headroom;
- repeated-render RSS growth or memory leakage;
- materially degraded render latency caused by host-memory pressure;
- OOM or instability under the certified workload.

### 3.2 Cloud API Failover, Rate Limiting & Error Classification

Provider/model names are configuration values and are not compiled into workflow business logic.

| Planning Task | Primary | Secondary Fallback | Retry Strategy |
|---|---|---|---|
| **Scene Script & SceneSpec Generation** | Anthropic Claude 5 Sonnet | OpenAI GPT-5.6 Sol | retry transient failures, then permitted fallback |
| **Candidate Keyframe Ranking (QA)** | Google Gemini 3.7 Flash | OpenAI GPT-5.6 Luna | retry transient failures, then permitted fallback |
| **Voiceover Synthesis** | ElevenLabs Multilingual v2 | Azure Neural Speech / configured OpenAI TTS model | bounded retry, then permitted fallback |

Retryable classes: HTTP 429, HTTP 5xx, network timeout/reset/transient DNS.

Non-retryable classes: HTTP 400, HTTP 401, HTTP 403, deterministic local validation failure.

Safety/policy rejection:

- do not blindly retry;
- do not use cross-provider fallback to circumvent a safety refusal;
- route to human/policy-specific handling.

Fallback is permitted only when the client policy authorizes the provider, task-specific external processing is enabled, and masking/redaction requirements are satisfied.

### 3.3 External Processing Degraded Modes

| Policy | `true` behavior | `false` behavior |
|---|---|---|
| `allowCloudPlanning` | configured cloud planner generates SceneSpec | creator manually authors/edits SceneSpec |
| `allowCloudVisualQA` | configured VLM ranks candidate frames | Review Hub presents candidates unranked for human selection |
| `allowCloudVoice` | configured cloud TTS generates VO | human/local audio upload required |
| `sensitiveDataMasking` | configured identifiers are masked before permitted cloud calls | raw payload is sent only when explicitly permitted by policy |

### 3.4 Phased Generative Engine Architecture

#### Phase 1 — Core Production Engines

**FLUX.1 [schnell]**

- Role: storyboard drafts and commercial brand stills.
- Default Phase 1 still-image / storyboard engine.
- Fast draft-generation target around the measured ~1.9s/frame profile.

**LTX 2.5 Distilled / Official ComfyUI LTX-2.5 Workflow**

- Role: social video production and rapid camera motion.
- Certified workload: 720p / 97 frames / ~5 seconds / 8 DiT steps.
- Certified runner: `dynamicvram-offload-v1`.
- One active diffusion render per RTX 4090 worker.

#### Phase 2 — Heavy Diffusion Engines

Requires 64GB+ host RAM and separate acceptance testing.

- **Wan 2.1 14B:** cinematic hero motion and human shots after host-memory validation.
- **MiniMax H3:** architectural/native audiovisual workflows only after territory and commercial-use controls pass.

### 3.5 Model & Component Licensing Governance

Licensing is enforced through a versioned license registry, not static prose alone.

| Component | Internal Policy |
|---|---|
| FLUX.1 [schnell] | approved for commercial Phase 1 use subject to current license registry |
| FLUX.1 [dev] | restricted without applicable commercial licensing |
| LTX 2.5 | conditionally approved while registry terms remain current |
| Wan 2.1 14B | Phase 2 after hardware validation |
| MiniMax H3 | Phase 2 only where territory/output restrictions are satisfied |
| MinIO Object Store | conditionally approved as isolated unmodified S3 service |

Required registry fields include component key/type, license identity/date/source, territory policy, revenue threshold, attribution/output restrictions, review metadata, approver, and status.

Production routing fails closed when a required component is not `approved`.

### 3.6 Clean Architecture & Domain-Driven Design Constraints

The Clean Architecture / DDD discipline is an architectural constraint enforced mechanically in CI.

#### 3.6.1 Repository Structure

```text
opsclawd/comfy-content-orchestrator/
|-- apps/
|   |-- control-api/          # Hetzner API composition root
|   |-- render-worker/        # Trinidad worker composition root
|   `-- web/                  # Next.js Review Hub
|-- packages/
|   |-- domain/               # Pure domain model and invariants
|   |-- application/          # Use cases, orchestration, ports
|   |-- infrastructure/       # PostgreSQL, ComfyUI, MinIO, AI APIs, FFmpeg, NVML
|   |-- contracts/            # Stable API/event schemas shared across processes
|   `-- shared/               # Pure cross-cutting primitives only
|-- config/render-profiles/
|-- certification/
|-- docs/
|   |-- adr/
|   |-- CONTEXT.md
|   `-- prd.md
`-- .dependency-cruiser.cjs
```

#### 3.6.2 Dependency Rules

- `domain` may depend only on `shared`.
- `application` depends on `domain`, `contracts`, and `shared`; it never imports infrastructure.
- `infrastructure` implements application ports and may import domain types/application port contracts, not application use cases.
- `web` consumes contracts and presentation-safe shared/domain types only; it never imports server application/infrastructure packages.
- Cross-layer wiring occurs only in composition roots.
- Circular dependencies are forbidden.
- Dependency Cruiser or equivalent CI tooling fails the build on boundary violations.

#### 3.6.3 Domain Model Boundaries

`Scene` remains the principal aggregate root for creative-review and production lifecycle invariants. A `Campaign` coordinates scenes but does not become one large transaction boundary.

Primary concepts:

- `Campaign` — campaign identity and high-level progress.
- `Scene` — SceneSpec revision, references, LoRA configuration identity, assigned engine/profile, candidate selection identity, approval validity, and canonical lifecycle.
- `StoryboardCandidate` — immutable generated review artifact tied to one `Scene` and one SceneSpec revision. It is not the Scene aggregate and does not mutate when later revisions are created.
- `RenderJob` — durable production/candidate work, retries, ownership, and completion semantics.
- `RenderLease` — exclusive GPU-worker execution right for one diffusion job.
- `ReferenceAsset` — continuity/provenance identity.
- `GenerationManifest` — immutable evidence from a successful production render.
- `ReviewEvent` — append-only audit event.
- `RenderProfile` — versioned certified execution configuration.

A candidate is identified independently from its presigned URL. Old candidate records remain immutable and addressable for audit/history even after a reroll or SceneSpec mutation makes them ineligible for current approval. Object-storage lifecycle may later remove candidate media bytes; that retention event does not authorize mutation or deletion of the relational candidate provenance row.

#### 3.6.4 Application Ports

Application orchestration depends on focused ports such as:

- `RenderEnginePort`
- `GpuExecutionLeasePort`
- `GpuTelemetryPort`
- `HostTelemetryPort`
- `SceneRepository`
- `StoryboardCandidateRepository`
- `CampaignRepository`
- `RenderJobRepository`
- `ManifestRepository`
- `ReviewEventStore`
- `LicenseRegistryRepository`
- `UnitOfWork`
- `PlannerPort`
- `CandidateRankerPort`
- `VoiceSynthesisPort`
- `MediaAssemblerPort`
- `ObjectStoragePort`
- `ReviewMediaDeliveryPort`

`ObjectStoragePort` owns persistent object operations using bucket/key identity. `ReviewMediaDeliveryPort` owns creation of short-lived browser read URLs. Lifecycle administration and disk-watermark enforcement are infrastructure/deployment capabilities and business admission policy, not methods on one giant object-storage interface.

#### 3.6.5 RenderProfile Contract

`LTX_25_720P_5S_V1` is the initial certified Phase 1 production profile. The committed JSON configuration is authoritative for its exact hashes and measured values.

Render Profiles may evolve without changing Scene/Campaign domain invariants. Material workflow/model/runner changes require re-certification and a new/updated versioned profile rather than silent mutation.

#### 3.6.6 Review API & Optimistic-Concurrency Contract

The browser communicates with `apps/control-api` through schemas in `packages/contracts`.

Minimum read models:

- campaign review summary;
- Scene review detail;
- current SceneSpec revision and configuration;
- candidate list grouped by SceneSpec revision;
- selected candidate identity;
- approval metadata;
- state/action availability;
- short-lived media URLs generated on demand.

Minimum review command envelope:

```typescript
{
  actionId: string;              // UUID; idempotency/audit identity
  sceneId: string;
  expectedSpecRevision: number;  // optimistic concurrency guard
  action: ReviewAction;
  payload: unknown;
  directorNotes?: string;
}
```

Authority rules:

- the request body does **not** supply authoritative reviewer identity;
- the server resolves reviewer identity from trusted server-side access context/configuration;
- the server generates the authoritative occurrence timestamp;
- UI clients never set raw `status` values;
- stale `expectedSpecRevision` commands fail with a conflict and perform no mutation;
- an invalid domain transition performs no write;
- the same `actionId` with the same normalized request is idempotent and does not create duplicate review events;
- reusing one `actionId` for a materially different request is a conflict;
- Scene mutation and the corresponding ReviewEvent commit in one `UnitOfWork` transaction.

Recommended transport mapping:

- `404` — Scene/campaign not found;
- `409` — stale revision or idempotency conflict;
- `422` — domain transition/mutation rejected;
- `2xx` — successful or safely replayed idempotent command.

#### 3.6.7 Runtime Persistence Boundary

Sprint 1 migrations created the relational baseline. Sprint 1.5 must provide the runtime adapters required by the Review Hub vertical slice:

- PostgreSQL `SceneRepository`;
- PostgreSQL `StoryboardCandidateRepository`;
- PostgreSQL `ReviewEventStore`;
- PostgreSQL-backed transactional `UnitOfWork`;
- read/query adapter(s) for Review Hub read models.

The Review Hub is not allowed to ship against in-memory repositories masquerading as production persistence.

---

## 4. Canonical Product State Machine & Review Hub Contract

The scene state machine is authoritative for the Review Hub, queue, database status, and tests.

### 4.1 Scene Lifecycle

```text
DRAFT_PENDING
    |
    v
GENERATING_CANDIDATES
    | candidate batch persisted
    v
DIRECTOR_REVIEW
    |---- reroll ------------------------------------------> GENERATING_CANDIDATES
    |---- SceneSpec mutation --> current candidate selection becomes stale/cleared
    |
    | candidate_select (same state; current revision only)
    |
    | approve (requires current-revision selection for generated visual scenes)
    v
APPROVED
    |
    | production authorization
    v
QUEUED
    |
    | worker lease
    v
RENDERING
    |
    | render + upload success
    v
QA
    |---- reject ------------------------------------------> DIRECTOR_REVIEW
    |
    | approve
    v
COMPLETED
```

Any permitted non-terminal production state may transition to `FAILED` or `CANCELLED` according to the transition matrix.

### 4.2 Allowed State Transitions

| Current State | Allowed Next State(s) | Primary Trigger |
|---|---|---|
| `draft_pending` | `generating_candidates`, `cancelled` | generation admission / cancellation |
| `generating_candidates` | `director_review`, `failed`, `cancelled` | candidate batch success/failure |
| `director_review` | `generating_candidates`, `approved`, `cancelled` | reroll, approval, cancellation |
| `approved` | `queued`, `director_review`, `cancelled` | production authorization, approval invalidation/revocation, cancel |
| `queued` | `rendering`, `failed`, `cancelled` | worker lease, dispatch failure, cancel |
| `rendering` | `qa`, `failed`, `cancelled` | render completion/error |
| `qa` | `completed`, `director_review`, `failed` | QA approval/rejection/post-process failure |
| `completed` | terminal | final output accepted |
| `failed` | `queued`, `director_review`, `cancelled` | explicit retry or corrective review |
| `cancelled` | terminal | explicit cancellation |

Candidate selection is an audited mutation that normally leaves the Scene in `director_review`; it is not represented as a separate Scene status.

### 4.3 Storyboard Candidate Semantics

Each generation batch produces up to three immutable candidate records per scene/revision in the Phase 1 default flow.

A `StoryboardCandidate` contains at minimum:

- `candidateId`;
- `sceneId`;
- `sceneSpecRevision`;
- `variantOrdinal`;
- persistent `storageBucket` / `storageObjectKey`;
- `contentHashSha256`;
- generation/provenance metadata sufficient to identify the draft render input;
- creation timestamp.

Rules:

- candidates from older revisions remain immutable history;
- a candidate is eligible for selection only when `candidate.sceneId` matches the Scene and `candidate.sceneSpecRevision` equals the current SceneSpec revision;
- SceneSpec mutation clears/invalidate the current selected candidate;
- reroll clears/invalidate the current selection and transitions to `generating_candidates`;
- approval of a generated visual scene requires a selected candidate belonging to the current revision;
- candidate media URLs are generated on demand and are not candidate identity;
- S3 lifecycle deletion of candidate media does not delete or mutate the `StoryboardCandidate` database record; provenance survives media retention expiry.

### 4.4 Review Hub Action Semantics

Phase 1 actions:

- `candidate_select` — select a candidate from the current SceneSpec revision; leaves Scene in `director_review`.
- `approve` — `director_review -> approved`; requires current revision and eligible candidate selection for generated visual scenes.
- `reroll` — `director_review -> generating_candidates`; clears selection; means storyboard rejection/regeneration.
- `prompt_edit` — mutate prompt/SceneSpec, increment revision, invalidate approval and current candidate selection.
- `reference_change` — mutate references, increment revision, invalidate approval and current candidate selection.
- `engine_change` — mutate assigned engine/profile, increment revision, invalidate approval and current candidate selection.
- `duration_change` — mutate duration, increment revision, invalidate approval and current candidate selection.
- `lora_tune` — select/change the versioned `loraConfigurationId`; this does not mean editing model files from the browser. It increments revision and invalidates approval/selection.
- `cancel` — explicit cancellation where allowed.
- `reject` — **QA rejection only** (`qa -> director_review`). It is not the storyboard-review rejection command.

Reserved but out of Phase 1 Review Hub scope:

- `reorder`
- `duplicate`

These values may remain reserved in persistence for forward compatibility, but Sprint 1.5/Sprint 2 must not invent semantics or expose working UI commands for them.

Every successful review action creates one append-only ReviewEvent in the same transaction as the mutable Scene/candidate-selection update.

### 4.5 Approval Semantics

- Approval applies to one exact SceneSpec revision.
- Approval of generated visual scenes also applies to one selected `StoryboardCandidate` from that revision.
- Prompt/reference/engine/duration/LoRA mutation after approval invalidates approval and current selection.
- A production job may be created only from a valid `approved` Scene.
- Production manifests record the exact SceneSpec/workflow/reference/sampling inputs and approved candidate identity where applicable.
- QA rejection does not overwrite render history; it creates new review history and subsequent render attempts/jobs.

### 4.6 Reroll Execution Boundary

The Review API does **not** synchronously call ComfyUI when a director presses reroll.

Sprint 2 behavior:

1. validate the command/revision;
2. commit `director_review -> generating_candidates`, selection invalidation, and ReviewEvent transactionally;
3. return the updated pending state to the browser.

Durable candidate-generation admission/claim/dispatch is implemented with the PostgreSQL worker queue in Sprint 3. No temporary HTTP-request-held-open render architecture is permitted.

---

## 5. Data Contracts & Relational Persistence

### 5.1 PostgreSQL 18.6 Baseline

PostgreSQL 18.6 uses native UUID support including `uuidv7()` for new primary keys.

The Sprint 1 schema remains the baseline; Sprint 1.5 adds candidate/revision/idempotency support through forward migrations rather than rewriting applied migration history.

Required resulting shape:

```sql
-- Scene additions / normalized revision state
ALTER TABLE storyboard_scenes
  ADD COLUMN IF NOT EXISTS spec_revision INT NOT NULL DEFAULT 1
    CHECK (spec_revision > 0),
  ADD COLUMN IF NOT EXISTS selected_candidate_id UUID,
  ADD COLUMN IF NOT EXISTS selected_candidate_revision INT;

ALTER TABLE storyboard_scenes
  ADD CONSTRAINT storyboard_scene_candidate_selection_pair
  CHECK (
    (selected_candidate_id IS NULL AND selected_candidate_revision IS NULL)
    OR
    (selected_candidate_id IS NOT NULL AND selected_candidate_revision IS NOT NULL)
  );

ALTER TABLE storyboard_scenes
  ADD CONSTRAINT storyboard_scene_selected_revision_current
  CHECK (
    selected_candidate_revision IS NULL
    OR selected_candidate_revision = spec_revision
  );

CREATE TABLE storyboard_candidates (
  candidate_id UUID PRIMARY KEY DEFAULT uuidv7(),
  scene_id UUID NOT NULL REFERENCES storyboard_scenes(scene_id) ON DELETE RESTRICT,
  scene_spec_revision INT NOT NULL CHECK (scene_spec_revision > 0),
  variant_ordinal INT NOT NULL CHECK (variant_ordinal > 0),
  storage_bucket VARCHAR(128) NOT NULL,
  storage_object_key TEXT NOT NULL,
  content_hash_sha256 VARCHAR(64) NOT NULL,
  generation_payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (scene_id, scene_spec_revision, variant_ordinal),
  UNIQUE (storage_bucket, storage_object_key),
  UNIQUE (candidate_id, scene_id, scene_spec_revision)
);

CREATE INDEX idx_storyboard_candidates_scene_revision
  ON storyboard_candidates(scene_id, scene_spec_revision, variant_ordinal);

ALTER TABLE storyboard_scenes
  ADD CONSTRAINT fk_scene_selected_candidate_revision
  FOREIGN KEY (selected_candidate_id, scene_id, selected_candidate_revision)
  REFERENCES storyboard_candidates(candidate_id, scene_id, scene_spec_revision)
  DEFERRABLE INITIALLY IMMEDIATE;

-- Reuse the Sprint 1 reject_audit_mutation() function from
-- 002_audit_protections.sql so candidate immutability is structural.
CREATE TRIGGER trg_storyboard_candidates_immutable
BEFORE UPDATE OR DELETE ON storyboard_candidates
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
```

`StoryboardCandidate` immutability is a database invariant. Sprint 1.5 must also apply the same fail-closed privilege pattern already used by `002_audit_protections.sql`:

- the production application role may receive the minimum `SELECT` / `INSERT` privileges required for candidate persistence and review reads;
- the production application role must not retain `UPDATE` or `DELETE` privileges on `storyboard_candidates`;
- the forward migration/integration test must assert those privileges and fail closed if mutation privilege is present;
- direct SQL `UPDATE` or `DELETE` attempts must still fail because of `trg_storyboard_candidates_immutable`, even if a future role is accidentally over-granted.

This defense-in-depth rule matches the existing `generation_manifests` and `review_events` audit-protection pattern rather than relying on repository methods or application conventions.

`storyboard_scenes.draft_storage_bucket` / `draft_storage_object_key` are legacy single-draft fields and must not remain the canonical representation of a multi-candidate storyboard. New Review Hub behavior reads from `storyboard_candidates`. Legacy columns may be retained temporarily for migration compatibility and deprecated explicitly.

Candidate-row retention is independent from MinIO object retention. When lifecycle policy eventually removes media bytes, the immutable row, content hash, Scene/revision identity, and generation provenance remain historical evidence. A missing/expired media object must be represented as availability state at read time, not by rewriting candidate history.

Review events require enough information for safe idempotent replay/conflict detection:

```sql
-- Existing review_action_enum gains candidate_select.
-- reorder/duplicate remain reserved values, not Phase 1 commands.

ALTER TABLE review_events
  ADD COLUMN IF NOT EXISTS expected_spec_revision INT,
  ADD COLUMN IF NOT EXISTS resulting_spec_revision INT,
  ADD COLUMN IF NOT EXISTS request_hash_sha256 VARCHAR(64);
```

For new review events:

- `event_id` is the canonical `actionId` and remains unique;
- `reviewer_name` is supplied by trusted server-side identity resolution, not directly trusted from browser input;
- `created_at` is server/database authoritative;
- `request_hash_sha256` distinguishes an idempotent replay from reuse of the same action ID with different content.

Append-only/immutable audit triggers remain in force. Production application roles do not receive UPDATE/DELETE permission on `review_events` or `generation_manifests`.

### 5.2 Storyboard Candidate Contract

```typescript
import { z } from "zod";

export const StoryboardCandidateSchema = z.object({
  candidateId: z.string().uuid(),
  sceneId: z.string().uuid(),
  sceneSpecRevision: z.number().int().positive(),
  variantOrdinal: z.number().int().positive(),
  storageBucket: z.string().min(1),
  storageObjectKey: z.string().min(1),
  contentHashSha256: z.string().length(64),
  generationMetadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().datetime(),
});
```

Browser read models may include a short-lived `mediaUrl`, but that field is presentation data and is not persisted candidate identity.

### 5.3 Reference Asset Contract

Persistent references use object locators, not expiring URLs.

```typescript
export interface AssetRef {
  assetId: string;
  assetType:
    | "product_packshot"
    | "character_face"
    | "environment_anchor"
    | "brand_logo"
    | "audio_voice_sample";
  storageBucket: string;
  storageObjectKey: string;
  contentHashSha256: string;
  controlnetType: "canny" | "depth" | "openpose" | "ipadapter_face" | "none";
  strength: number;
}
```

### 5.4 Scene State & Review Contracts

Canonical Scene states remain:

```text
draft_pending
generating_candidates
director_review
approved
queued
rendering
qa
completed
failed
cancelled
```

Phase 1 Review actions:

```text
candidate_select
approve
reroll
prompt_edit
reference_change
engine_change
duration_change
lora_tune
cancel
reject   # QA only
```

Reserved values:

```text
reorder
duplicate
```

Representative command schema:

```typescript
export interface ReviewCommand<TPayload = unknown> {
  actionId: string;
  sceneId: string;
  expectedSpecRevision: number;
  action: ReviewAction;
  payload: TPayload;
  directorNotes?: string;
}
```

Representative response contains:

- `sceneId`;
- resulting `status`;
- resulting `specRevision`;
- `selectedCandidateId` if present;
- approval metadata if present;
- whether the response was an idempotent replay.

### 5.5 Generation Manifest Contract

A successful production job creates exactly one immutable GenerationManifest containing at minimum:

- manifest/job/campaign/scene identity;
- render attempt and timestamp;
- engine and RenderProfile identity;
- exact model/checkpoint/VAE/text-encoder names and SHA-256 hashes;
- exact workflow template identity/hash;
- LoRA identities/strengths;
- sampling seed/steps/CFG/sampler/scheduler/denoise;
- dimensions/frame count/FPS;
- prompts/audio prompt (capability-dependent: explicitly null when the RenderProfile lacks audio generation capability);
- persistent ReferenceAsset identities;
- approved StoryboardCandidate identity/hash where applicable;
- ComfyUI commit/custom-node environment;
- runner profile and relevant runtime metadata;
- governance/license/policy identity;
- output filenames/hashes/review object keys/execution duration.

Manifest persistence remains Sprint 3 work.

### 5.6 External Processing Governance Contract

Client policy includes:

- `allowCloudPlanning`;
- `allowCloudVisualQA`;
- `allowCloudVoice`;
- `allowedProviders`;
- `sensitiveDataMasking`.

Provider routing checks policy before external calls and fails closed when a provider/task is not authorized.

---

## 6. Production ComfyUI Execution Client

The existing production execution adapter remains behind `RenderEnginePort` and must provide:

- queue submission;
- WebSocket completion monitoring;
- timeout handling;
- `execution_error` handling;
- interruption handling;
- final `/history` verification;
- output subfolder preservation;
- explicit model-unload requests;
- no reliance on browser/GUI state.

VRAM transition orchestration wraps model unloading with telemetry/headroom polling. It is not embedded as Scene business logic and it is not invoked synchronously by the Review Hub HTTP request path.

---

## 7. Telemetry, Observability & Health Monitoring

### 7.1 Health Endpoint — `/healthz`

Health state should expose at least:

- service status;
- GPU VRAM free where applicable;
- ComfyUI connectivity on render workers;
- Tailscale connectivity;
- queue backlog/oldest job;
- storage free bytes/watermark state;
- active engine where applicable.

### 7.2 Prometheus Metrics — `/metrics`

**Naming convention.** Metric names carry no product or partner prefix. This is deliberate and applies to the whole metric namespace: metric names are expensive to change once dashboards, recording rules, and alert rules depend on them, so they are kept independent of branding that may change. Other identifiers (bucket names, database and role names) are unaffected by this convention.

Required metrics include:

- `render_duration_seconds{engine,scene_type}`;
- `vram_allocated_bytes`;
- `job_retries_total{engine,error_class}`;
- `api_failovers_total{task,from_provider,to_provider}`;
- `queue_oldest_job_seconds`;
- `render_failures_total{engine,error_class}`;
- `object_storage_bytes{bucket}`;
- `storage_free_bytes`;
- `storage_watermark_state`;
- `invalid_state_transitions_total`;
- `review_conflicts_total{reason}`;
- `review_idempotent_replays_total`.

### 7.3 Operational Alerts

Minimum alerts:

- queue oldest job exceeds SLA;
- render failure rate exceeds threshold;
- storage reaches 70/85/92% watermark;
- ComfyUI unreachable for >2 minutes;
- Tailscale disconnected;
- VRAM cleanup threshold not reached within timeout;
- enabled routing references a license-registry component in `review_required`/`blocked` state.

---

## 8. Implementation Roadmap

### Sprint 1 — Core Runtime, Domain Boundaries & Hardware Certification — COMPLETE

Delivered baseline includes:

- monorepo boundaries and mechanical dependency enforcement;
- authoritative Scene state behavior and application use cases;
- PostgreSQL baseline migrations and audit immutability protections;
- pinned Gold Master FLUX/LTX workflow provenance;
- ComfyUI adapter behind `RenderEnginePort`;
- GPU/host telemetry and hardware certification tooling;
- real target-host LTX certification and FLUX/LTX transition soak evidence;
- certified `LTX_25_720P_5S_V1` RenderProfile;
- 32GB Phase 1 host-RAM decision with documented transient swap behavior;
- exclusive local GPU execution lease;
- end-to-end render-worker architectural slice.

### Sprint 1.5 — Review Plane Contract Closure — TRANSITION BEFORE SPRINT 2

Purpose: eliminate contract/persistence/API ambiguity before the autonomous orchestrator plans UI/deployment work.

Required outcomes:

1. **StoryboardCandidate domain/data contract**
   - add candidate persistence tied to SceneSpec revision;
   - enforce candidate immutability structurally with `trg_storyboard_candidates_immutable` reusing `reject_audit_mutation()`;
   - deny production application-role UPDATE/DELETE and add a fail-closed privilege assertion consistent with `002_audit_protections.sql`;
   - implement current-revision candidate selection and invalidation rules;
   - preserve relational candidate provenance independently from MinIO lifecycle deletion;
   - deprecate single-draft fields as canonical storyboard representation.

2. **Review action semantics**
   - add `candidate_select`;
   - define `reject` as QA-only;
   - define `reroll` as storyboard rejection/regeneration;
   - define `lora_tune` as versioned LoRA configuration selection/change;
   - keep `reorder`/`duplicate` reserved and unsupported in Phase 1.

3. **Review API contracts**
   - stable read models in `packages/contracts`;
   - command envelope with `actionId` and `expectedSpecRevision`;
   - deterministic error/conflict response contracts.

4. **Runtime PostgreSQL adapters**
   - `SceneRepository`;
   - `StoryboardCandidateRepository`;
   - `ReviewEventStore`;
   - transactional `UnitOfWork`;
   - Review Hub read/query adapter(s).

5. **Control API HTTP boundary**
   - real HTTP server/routes in `apps/control-api`;
   - server-derived reviewer identity and timestamp;
   - stale-revision protection;
   - idempotent action handling;
   - no raw Scene-status endpoint.

6. **Storage delivery contract**
   - persistent object locators remain separate from presigned browser URLs;
   - add `ReviewMediaDeliveryPort`/equivalent;
   - define the S3 review-media endpoint and its administrative separation (addressing scheme subsequently revised — see §2.2);
   - define exact 70/85/92% behavior.

7. **Deployment acceptance contract**
   - distinguish code/config completion from real Hetzner/Tailscale/MinIO environment acceptance;
   - require operator evidence for public exposure, MagicDNS, lifecycle, and watermark gates.

Sprint 1.5 is a contract-closure sprint. It must not introduce a new queue, synchronous render-over-HTTP path, new object-store architecture, or unrelated UI scope.

### Sprint 2 — Director Review Hub & Private Review Plane — SUBSTANTIALLY COMPLETE

- [x] Convert `apps/web` from the scaffold package into the actual Next.js Review Hub.
- [x] Consume only `packages/contracts` / presentation-safe types from the web app.
- [x] Implement campaign/scene review pages and candidate gallery.
- [x] Implement current-revision candidate selection.
- [x] Implement approve, reroll, prompt edit, reference change, engine change, duration change, LoRA configuration change, cancel, and QA rejection where applicable.
- [x] Surface stale revision conflicts explicitly; never auto-retry a stale human approval against a newer revision.
- [x] Deploy Control API + Review Hub to the Hetzner control plane.
- [x] Normalize private service addressing (§2.2). *Delivered as host-plus-port addressing rather than per-service DNS names; the original four-name scheme is not implementable on a single host — see §2.2.*
- [x] Deploy MinIO as a separate S3-compatible service.
- [x] Implement bucket lifecycle/retention rules and storage watermark telemetry. *Admission behavior deferred to Sprint 3 — it has no write path to gate until durable dispatch exists (issue #89).*
- [x] Implement object-key persistence and on-demand presigned URL generation.
- [ ] Verify real Tailscale access from the Creative Director device. *Blocked on §2.5 (transport security and reviewer authentication), deliberately deprioritized — issue #90.*
- [x] Reroll commits the pending `generating_candidates` state only; it does not synchronously execute ComfyUI from the HTTP request.

Two items carry forward by explicit decision rather than oversight: reviewer-facing TLS/authentication (§2.5, issue #90) and storage-watermark admission enforcement (Sprint 3, issue #89).

### Sprint 2.5 — Generation Dispatch Contract Closure — TRANSITION BEFORE SPRINT 3

Purpose: eliminate job/lease/dispatch contract ambiguity before implementation begins, following the same pattern as Sprint 1.5.

This sprint exists because the durable generation queue is, at time of writing, specified by a single roadmap bullet ("PostgreSQL durable worker leasing with `SELECT ... FOR UPDATE SKIP LOCKED`") with no defined job lifecycle, lease semantics, or dispatch protocol — while §9.2's Durable Lease Recovery Gate demands deterministic reassignment with no duplicate completed manifests. That is a hard concurrency-correctness property, and it is not safe to let the contract be invented during implementation. By contrast, `GenerationManifest` already has a table, audit-immutability protections, and a specified minimum content set (§6.4); it does not need re-litigating here.

Required outcomes:

1. **Job and lease persistence contract**
   - job table shape, identity, and its relationship to Scene and SceneSpec revision;
   - job lifecycle states and the legal transitions between them;
   - lease acquisition, ownership, renewal, expiry, and reclaim semantics;
   - the exact `SELECT ... FOR UPDATE SKIP LOCKED` claim query and the invariant it guarantees.

2. **Exactly-once manifest invariant**
   - how a reclaimed or retried job is prevented from producing a second manifest;
   - what constitutes job completion, and where that boundary is enforced.

3. **Dispatch protocol to the render worker**
   - how a claimed job reaches the Compute Runner, and what the runner returns;
   - failure, timeout, and cancellation semantics;
   - behavior when no render worker is currently reachable.

4. **Storage-admission integration point**
   - where watermark admission (§2.3, issue #89) is evaluated in the claim/dispatch path, and what a blocked admission does to the job's state.

5. **Ports and boundaries**
   - which contracts live in `packages/application` versus `packages/infrastructure`, consistent with §4's layering rules.

Sprint 2.5 is a contract-closure sprint. It must not implement the queue, build the FFmpeg pipeline, introduce a new object-store architecture, or add unrelated UI scope.

### Sprint 3 — Continuity, Durable Generation & Manifests

- Implement/complete `ReferenceAsset` continuity behavior.
- Implement PostgreSQL durable worker leasing per the Sprint 2.5 contract.
- Implement durable candidate-generation admission/claim/dispatch for scenes in `generating_candidates`, including storage-watermark admission enforcement (issue #89).
- Persist generated StoryboardCandidates before `generating_candidates -> director_review`.
- Implement immutable GenerationManifest creation with exactly one final manifest per successful production job.
- Extend health and Prometheus telemetry (§7.2) with render, queue-depth, and failure-classification metrics. *The `/metrics` endpoint, registry, and Prometheus exposition format already exist from Sprint 2's storage-watermark work — extend them rather than rebuilding.*

Runtime ReviewEvent persistence is no longer deferred to Sprint 3; it is required by Sprint 1.5.

**Prerequisite:** Sprint 3's dispatch work cannot be verified end to end without a reachable render worker on the tailnet. Confirm Compute Runner availability before planning execution; the queue and lease logic can be built and unit-tested against fakes, but the Durable Lease Recovery Gate (§9.2) requires real hardware.

### Sprint 3.5 — Assembly & Governance

Separated from Sprint 3 because it is a distinct subsystem with different dependencies: it consumes generation *output* rather than participating in the generation path, and its verification needs FFmpeg and audio fixtures rather than GPU time. It must land before Sprint 4's commercial proof of concept, which cannot deliver a finished video without it.

- Build FFmpeg concatenation, VO muxing, soundbed, and subtitle pipeline.
- Implement model/component license registry and fail-closed routing guard.

### Sprint 4 — API Resilience & Commercial PoC

- Integrate configured planning-provider failover.
- Integrate configured candidate-ranking failover.
- Implement retry/error classification and policy-aware fallback.
- Integrate cloud voice-provider fallback.
- Execute Tobago Vacation Villa commercial proof of concept.
- Pass all remaining pre-flight engineering acceptance gates.
- Re-freeze certified workflow templates, model hashes, environment metadata, and runner profile before commercial production.

---

## 9. Pre-Flight Engineering Acceptance Gates

No paying production campaign may be onboarded until all required gates pass.

### 9.1 Core Rendering & Hardware Certification

- [x] **FLUX Smoke Test Gate:** headless FLUX workflow executes programmatically on the target architecture.
- [x] **LTX Compatibility Benchmark:** official LTX-2.5 720p / 97-frame / 8-step workload completes on RTX 4090 without OOM.
- [x] **LTX Resource Envelope Gate:** pinned certified workload records GPU/host/swap/page-fault/post-unload evidence and remains under the <=55s Phase 1 threshold.
- [x] **ComfyUI Memory Profile Gate:** `dynamicvram-offload-v1` is the Phase 1 certified profile; mutually exclusive VRAM flags are not combined.
- [x] **Host RAM Gate:** 32GB is supported for the dedicated Phase 1 profile with documented transient cold-page swap and no progressive leak/OOM.
- [x] **Model Transition Soak Gate:** repeated FLUX/LTX transitions complete without progressive VRAM/RAM growth, OOM, or ComfyUI restart; original binary no-swap predicate is documented and operationally re-evaluated rather than hidden.
- [x] **Single-GPU Concurrency Gate:** exclusive local GPU execution lease prevents concurrent diffusion entry on one RTX 4090 worker.

### 9.2 Failure & Queue Semantics

- [x] **ComfyUI Error Path Gate:** adapter handles execution error/interruption/timeout without hanging the worker process.
- [ ] **Durable Lease Recovery Gate:** kill a PostgreSQL-leased worker and verify deterministic reassignment without duplicate completed manifests. *Application-level lease-recovery evidence is covered by `tests/integration/render-worker.integration.test.ts` ("recovers an expired rendering lease and persists exactly one production manifest"), using real Postgres and MinIO via Testcontainers: worker A is suspended mid-render, its lease is expired directly in Postgres, worker B reclaims and completes through the real claim path, exactly one manifest is asserted, and worker A's stale completion is fenced. The queue-layer half is additionally covered by `packages/infrastructure/src/postgres/repositories/postgres-job-queue.integration.test.ts`. The required production acceptance — killing `run-worker` mid-render against real ComfyUI/GPU hardware, allowing natural lease expiry, and verifying reassignment with exactly one durable manifest and output — remains operator-only and is tracked under issue #68.*
- [x] **API Failure Classification Gate:** confirm transient retry classes, immediate non-retryable classes, and no safety-refusal bypass. *Verified 2026-09-05: classification scheme implemented in shared module `packages/shared/src/api-failure-classification.ts` and verified by `packages/shared/src/api-failure-classification.test.ts` (transient retry classes for 429/5xx and network failures, immediate non-retryable classes for 4xx and local validation, unconditional safety-refusal override including 429/500 responses with structured refusal evidence). Refactored provider adapters `AnthropicPlanningModelClient` and `OpenAiPlanningModelClient` consume this scheme with two evidence tiers (tier 1 exact structured discriminator across all statuses, tier 2 keyword heuristic scoped to 403), verified by `packages/infrastructure/src/planning/anthropic-planning-model-client.test.ts` and `packages/infrastructure/src/planning/openai-planning-model-client.test.ts` including 429/500 structured-discriminator tests and body-read timeout routing tests. End-to-end consumer behavior verified in `packages/application/src/use-cases/plan-scene-configuration.test.ts` ("Anthropic safety_refusal on attempt 1 with non-403 status... terminates immediately and never calls OpenAI" and "Anthropic permanent_failure on attempt 1 immediately falls back to OpenAI without retrying Anthropic"), proving non-403 structured refusals reach terminal_safety_refusal without provider failover or retry. Covers the failure classification scheme; the broader configured-failover framework remains out of scope.*

### 9.3 Product State, Review & Audit Integrity

- [x] **State Machine Gate:** domain tests cover permitted transitions and representative forbidden paths.
- [x] **Approval Invalidation Gate:** prompt/reference/engine/duration/LoRA changes invalidate approval.
- [x] **Audit Immutability Schema Gate:** database protections reject UPDATE/DELETE on immutable audit tables.
- [x] **Candidate Immutability Gate:** `storyboard_candidates` rejects direct UPDATE/DELETE through the database trigger; the production application role lacks UPDATE/DELETE; the migration/integration privilege assertion fails closed if mutation privileges are present. *Verified 2026-09-03 against real Postgres: `packages/infrastructure/src/postgres/audit-protections.integration.test.ts` (10/10 passed) — trigger `trg_storyboard_candidates_immutable` and `REVOKE UPDATE, DELETE ... FROM PUBLIC` in `packages/infrastructure/migrations/003_candidate_selection.sql`.*
- [x] **Candidate Revision Integrity Gate:** candidate selection/approval cannot reference another Scene or stale SceneSpec revision. *Verified 2026-09-03: `packages/application/src/use-cases/review-scene.test.ts` ("rejects when candidate belongs to a different scene", "...outdated revision") — 19/19 passed.*
- [x] **Candidate Invalidation Gate:** SceneSpec mutation or reroll clears current candidate selection while retaining historical candidate rows. *Verified 2026-09-03: `review-scene.test.ts` ("storyboard rejection maps to requestReroll: clears candidate selection and emits reroll event") — passed in the same 19/19 run above.*
- [x] **Stale Review Command Gate:** outdated `expectedSpecRevision` returns conflict and performs zero writes. *Verified 2026-09-03: `packages/application/src/use-cases/review-scene-idempotency.test.ts` ("throws StaleRevisionConflictError...", asserts zero saved scenes/events) — 12/12 passed.*
- [x] **Review Idempotency Gate:** repeated identical `actionId` produces one event/mutation; same ID with different request content conflicts. *Verified 2026-09-03: `review-scene-idempotency.test.ts` (matching-hash replay returns `isIdempotentReplay: true`; mismatched-hash replay throws `IdempotencyConflictError`) — passed in the same 12/12 run.*
- [x] **Reviewer Authority Gate:** browser-supplied identity/timestamp cannot become authoritative audit metadata. *Verified 2026-09-03: `apps/control-api/src/http/routes/review-command-routes.ts` resolves reviewer identity/timestamp server-side via `ReviewerIdentityResolver`/`clock`, never from the request body; `TailscaleReviewerIdentityResolver` rejects forged headers from untrusted peers. `reviewer-identity.test.ts` + `reviewer-identity-defaults.test.ts` + `review-command-routes.test.ts` — 35/35 passed.*
- [x] **Transactional Review Gate:** ReviewEvent and mutable Scene/candidate-selection update commit or rollback together. *Verified 2026-09-03 against real Postgres: `packages/infrastructure/src/postgres/uow/postgres-unit-of-work.integration.test.ts` ("commits Scene mutation and ReviewEvent append atomically", plus rollback cases) — 5/5 passed.*
- [x] **One-Job-One-Manifest Gate:** a completed production job produces exactly one immutable manifest referencing its job ID. *Verified 2026-09-03: `audit-protections.integration.test.ts` ("rejects a second generation manifest for the same render job"), backed by the DB `UNIQUE` constraint on `generation_manifests.job_id` — passed in the same 10/10 run above.*

### 9.4 Network & Storage

First real-environment execution of these gates was performed against the live Hetzner control plane on 2026-08-26 (see issue #68 for full recorded evidence). Gates 3 and 6 (Review Hub Browser Access, Storage Watermark) were the two real gaps found at that time; both closed later — Gate 6 via issues #88/#89 (2026-09-03), Gate 3 via issues #175/#184/#185 (2026-09-04). All 7 gates are now either passed with real evidence or resolved by explicit, recorded decision (Gate 2/MagicDNS via #87, TLS/auth via #90/#152).

- [x] **Zero Public Exposure Audit:** application, database, ComfyUI, S3 and MinIO administrative surfaces are unreachable from public WAN as intended. *Verified 2026-08-26: all of 80/443/3000/5432/8188/9000/9001 unreachable from an external (non-tailnet) vantage point; port 22 confirmed reachable as a control, proving the probe methodology. Enforcement is Tailscale's `ts-input` chain.*
- [x] **Endpoint Reachability Gate:** each canonical service endpoint in §2.2 resolves and is reachable from an authorized tailnet node, and the MinIO administrative console is **not** reachable over the tailnet. *(Supersedes the former "MagicDNS Consistency Gate," which specified four per-service DNS names that are not implementable on a single host — see §2.2. Verified 2026-08-26: control-plane host MagicDNS name resolves to its tailnet IP and serves Control API, Review Hub, and S3 on their configured ports; console port refused over tailnet, reachable on loopback only.)*
- [x] **Presigned Media Gate:** authorized browser can read short-lived media through the tailnet S3 endpoint; expired URL fails; no presigned URL is persisted as canonical identity. *Verified 2026-08-26 against real MinIO and real database rows: immediate GET returned 200 with the real object; the same URL returned 403 `AccessDenied` / "Request has expired" after its 300s expiry; database stores only `storage_bucket`/`storage_object_key`.*
- [x] **Storage Lifecycle Gate:** test objects demonstrate configured lifecycle/deletion eligibility. *Verified 2026-08-26 via direct `GetBucketLifecycleConfiguration` calls against live MinIO: temp 14d, review 60d, reference and delivery no automated expiration — matching §2.3.*
- [x] **Storage Watermark Gate:** simulate 70%, 85%, and 92% and verify exact warning/degraded/critical admission behavior. *Verified 2026-09-03: admission-blocking half (issue #89) is now genuinely implemented — `EnforceStorageAdmission` is a hard dependency (not optional telemetry) in `apps/render-worker/src/worker.ts` and `apps/control-api/src/http/routes/job-routes.ts`. Exact-boundary thresholds (`WARNING_RATIO 0.7 / DEGRADED_RATIO 0.85 / CRITICAL_RATIO 0.92`) in `packages/domain/src/storage-admission.ts`. `storage-admission.test.ts`, `enforce-storage-admission.test.ts`, `storage-aware-job-admission-gate.test.ts`, `worker.test.ts`, `job-routes.test.ts` — 121/121 passed.*
- [x] **Review Hub Browser Access Gate:** the Creative Director completes a real review action end to end from the remote review plane. *Verified 2026-09-04, real end-to-end, from a real tailnet device against the live deployment: created a real client/campaign/scene, triggered `/generation-admission`, real candidates generated on real GPU hardware, scene auto-transitioned to `director_review`, and a real review action (`cancel`, scene `31cb1f0a-3071-4206-bb3a-016afd473ea9`) succeeded with `HTTP 200`. Confirmed the audit trail recorded the genuine Tailscale-resolved reviewer identity (`review_events.reviewer_name = 'gpoontip@gmail.com'`), not a placeholder or fallback value — proving `TailscaleReviewerIdentityResolver`'s real identity chain (issue #184/#185) works end-to-end, including the `tailscale whois`-based resolution added to close the gap where Tailscale Serve headers were never actually being injected. TLS and reviewer authentication were both resolved by decision beforehand (deferred, not built — see issue #90, closed "not planned," and issue #152).*

### 9.5 Performance & Reconstruction

- [ ] **Candidate Draft Batch Latency:** generate, persist, and sync 18 draft keyframes (3 candidates x 6 scenes) in <45 seconds total. *Genuinely unbuilt as of 2026-09-03 — no campaign/scene creation path exists yet to generate a real candidate batch against. See issues #154, #155.*
- [x] **Manifest Reconstruction Gate:** reconstruct exact approved render inputs, including approved candidate identity where applicable. *Verified 2026-09-03 with pinned FFmpeg 7.0.2-static: `packages/infrastructure/src/ffmpeg/ffmpeg-media-assembler-adapter.integration.test.ts` ("proves semantic execution inputs are reconstructable given only persisted AssemblyManifest and referenced media objects") — passed, 22991ms.*
- [x] **FFmpeg Assembly Gate:** assemble six 5-second stems, stereo soundbed, VO, and vertical subtitles into 1080x1920 MP4 in <30 seconds. *Verified 2026-09-03: `ffmpeg-media-assembler-adapter.integration.test.ts` ("assembles six MP4 stems with voiceover, soundbed, and subtitles...") measured `executionDurationMs: 21044ms` (pinned FFmpeg 7.0.2-static) and 19797-25088ms across independent runs including system ffmpeg n8.0.1 — consistently under the 30s threshold, though not by a huge margin; worth re-measuring on production/CI hardware rather than assuming today's numbers hold indefinitely.*

### 9.6 Governance

- [x] **License Routing Gate:** restricted/blocked/review-required components cannot be dispatched. *Verified 2026-09-03: `packages/infrastructure/src/ffmpeg/license-routing-assembly.integration.test.ts` parameterized `deniedStatuses` coverage (`restricted`, `review_required`, `blocked`, `unregistered` — each asserts zero FFmpeg spawns, zero storage writes) — 9/9 passed using the pinned FFmpeg 7.0.2-static build matching `config/component-license-registry.json` revision "2026-08-29.4". Note: this pass is conditional on the runtime FFmpeg build matching the registry's pinned version — the gate correctly fails closed against an unregistered build (e.g. system ffmpeg n8.0.1), which is intended behavior, not flakiness.*
- [ ] **External Processing Policy Gate:** disabling each cloud-processing flag prevents prohibited provider calls and produces documented degraded/manual behavior. *Genuinely unbuilt as of 2026-09-03 — `allowCloudPlanning`/`allowCloudVisualQA`/`allowCloudVoice` only exist as a default value inside a test-fixture builder (`packages/infrastructure/src/postgres/test-support/records.ts`); no application/domain code reads or enforces them. Expected, since the underlying providers themselves don't exist yet either — see issues #157-#163, #165.*
- [ ] **H3 Territory Gate (Phase 2):** H3 cannot be routed or distributed outside allowed territory/policy.

---

## 10. Engineering Baseline Rules

After PRD v3.5.1 is approved:

1. **Stop architecture churn.** Material architectural changes require an ADR rather than silent PRD edits.
2. **Close ambiguity before automation.** Autonomous issue execution must not invent domain semantics omitted by the PRD/contracts.
3. **Pin execution dependencies.** Gold Master workflows, ComfyUI/custom-node commits, model hashes, and runner profile are versioned.
4. **Treat provider models as configuration.** Provider/model identifiers do not alter domain-state invariants.
5. **Treat licenses as runtime governance.** Routing depends on current license-registry state.
6. **Treat audit data as immutable.** Corrections are new records/events, never history rewrites.
7. **Treat candidate history as immutable at the database layer.** A new SceneSpec revision, reroll, or media-retention event does not rewrite/delete prior candidate evidence; enforcement uses trigger plus production-role privilege restrictions.
8. **Treat presigned URLs as ephemeral delivery data.** Persistent identity is bucket/key + content hash.
9. **Treat MinIO as review/distribution storage.** It is not the long-term master archive.
10. **One GPU, one active diffusion job.** A Render Worker must hold an exclusive GPU execution lease before inference.
11. **No synchronous Review API -> ComfyUI rendering.** Human HTTP requests commit intent/state; durable generation workers execute GPU jobs.
12. **Treat empirical RenderProfiles as versioned configuration.** Re-benchmark after material workflow/model/runner changes.
13. **Separate host inventory from certified execution identity.** Point-in-time disk inventory measurements may change and must not be promoted into RenderProfile requirements unless the exact files/hashes are part of the certified execution set.
14. **Enforce Clean Architecture mechanically.** Boundary violations fail CI.
15. **Use ADRs for major decisions.** Examples: replacing object store/PostgreSQL queueing, adding a second GPU worker, changing certified memory mode, moving diffusion compute to cloud, or introducing a materially different identity/security model.

---

## 11. Primary Technical & Licensing References

Primary sources should be revalidated before major version upgrades or license/model changes.

### Runtime & Database

- Node.js release documentation
- PostgreSQL resource configuration documentation
- PostgreSQL UUID / `uuidv7()` documentation

### ComfyUI

- ComfyUI repository and CLI/VRAM-mode source
- Pinned ComfyUI commit recorded by certification artifacts

### Networking

- Tailscale MagicDNS documentation
- Tailscale/WireGuard architecture documentation

### Empirical Hardware Baseline

Repository evidence includes:

- `config/render-profiles/LTX_25_720P_5S_V1.json`
- `config/render-profiles/README.md`
- `certification/ltx-25/`
- `certification/transition-soak/`
- pinned workflow/model provenance under repository templates/certification artifacts

The certified profile is the source of truth for production execution values. Historical one-off benchmark figures remain useful context but do not override the frozen profile.

The broader downloaded LTX-2.5 family inventory is tracked separately from the RenderProfile. The current Trinidad-host inventory measurement is **72,026,403,347 bytes (72.03 GB decimal / 67.08 GiB), inode-deduplicated**. It is point-in-time operational inventory evidence and may change independently of the pinned execution profile.

### Foundation Models / Components

- Black Forest Labs FLUX official repository/license mapping
- Lightricks LTX official repository/license material
- Wan official repository/license
- MiniMax H3 official model/community license
- provider model/API documentation for configured cloud providers
- MinIO official repository and AGPLv3 license

---

*End of PRD v3.5.1 — Sprint 1 Certified / Sprint 1.5 Review Plane Contract Closure Baseline.*
