# PRODUCT REQUIREMENTS DOCUMENT (PRD)

**Project Name:** Godzspeed Sovereign Content Orchestration Platform & Creative Review Hub  
**Repository:** `opsclawd/comfy-content-orchestrator`  
**Document Version:** 3.4.0 (Production Engineering & Empirically Certified Architectural Baseline)  
**Status:** Implementation Ready - Engineering Baseline (Post-Audit + LTX-2.5 Hardware Certification)  
**Runtime & Stack:** TypeScript / Node.js 24 LTS ("Krypton") | Next.js Review Hub | ComfyUI Headless | Tailscale (WireGuard Mesh) | PostgreSQL 18.6 | MinIO (S3-Compatible Review Media Store)  
**Hardware Profile:** AMD Ryzen 7 7700 (8C/16T) | 32GB DDR5-5600 RAM (64GB upgrade contingent on Sprint 1 host-memory certification) | NVIDIA RTX 4090 (24GB GDDR6X) | 2TB PCIe 4.0 NVMe SSD  
**Key Stakeholders:**
- **Creative Director:** Thomas Cumberbatch (Godzspeed Communications, Canada)
- **Technical Lead & Content Creator:** Agency Lead (Godzspeed Trinidad & Tobago Division)
- **Cloud Control Plane:** Hetzner Cloud CPX31 VPS (Falkenstein, Germany / Tailscale-only application access)

---

## 1. Executive Summary & Problem Space

### 1.1 Problem Statement

Boutique branding and digital marketing agencies targeting Caribbean and international markets face four core operational bottlenecks:

1. **High Turnaround & Team Overhead:** Traditional commercial agency production requires 4-6 specialized roles (cinematographers, copywriters, sound designers, colorists, and video editors) with turnaround times of 2 to 4 weeks per campaign.
2. **The "Spaghetti Node" Barrier:** In-house generative AI workflows in ComfyUI cannot scale when operated manually through a visual canvas. Manual node wiring takes 15-30 minutes per shot, introduces prompt drift, invites custom-node dependency rot, and lacks transactional reliability.
3. **The Cultural Representation Gap:** Generic foundation models exhibit Western bias. Prompting for Caribbean subjects can default to stereotypes; steelpan may render as oil drums, traditional Carnival Mas (Blue Devils, Moko Jumbies) can collapse into generic masquerade, and Caribbean skin tones can render with flat or waxy textures.
4. **Cross-Border Direction Friction:** Remote creative direction across Canada and Trinidad relying on fragmented messaging (WhatsApp/Drive) creates visual misalignment before heavy, time-consuming GPU rendering begins.

### 1.2 The Solution

The **Godzspeed Content Orchestration Platform** is an AI-native creative production engine built around a strict **Human-on-the-Loop Compute Gate**:

- **Decoupled Architecture:** ComfyUI operates as an isolated headless rendering service controlled by an asynchronous TypeScript/Node.js 24 orchestration daemon over REST and WebSockets.
- **Two-Tier Compute Sequencing:** High-level campaign briefs are expanded into rapid 4-step storyboard keyframes using FLUX.1 [schnell], producing 3 candidate variants across 6 scenes before expensive video generation begins.
- **Remote Director Gate:** Storyboard drafts, scripts, audio prompts, reference assets, and LoRA configuration are exposed through a private Next.js Review Hub over Tailscale. The Creative Director can review, edit, re-roll, tune, reject, and approve scenes from an iPad or Mac.
- **Deterministic Production Execution:** The Trinidad RTX 4090 executes pinned production workflows for FLUX.1 [schnell] stills, LTX 2.5 Distilled video, and headless FFmpeg assembly.
- **Controlled Cloud Cognition:** Planning, visual ranking, and voice synthesis use configured frontier APIs only when permitted by the client's external-processing policy.
- **Sovereign Render Plane:** Diffusion checkpoints, LoRAs, long-term masters, and generation execution remain on agency-controlled infrastructure.

### 1.3 Target Performance & Capacity Model

| Metric | Manual Agency Baseline | Orchestrator Target |
|---|---:|---:|
| **Monthly Video Production Capacity** | 4-6 client video reels | **40-60 commercial reels / month** |
| **Monthly Stills & Photography** | 20-30 edited stills | **150-200 4K brand assets / month** |
| **Draft Storyboard Latency (18 frames)** | 24-48 hours | **< 45 seconds** (3 candidates x 6 scenes) |
| **Draft Keyframe Render Speed** | N/A | **~1.9s / frame** (FLUX [schnell], measured target profile) |
| **Video Shot Render Speed (LTX 2.5)** | 1-2 hours manual animation | **46s measured end-to-end / 5s 720p, 97 frames, 8 steps** |
| **Full 30s Reel Turnaround** | 3-5 business days | **< 15-20 minutes** production batch target |
| **External Diffusion Compute Cost** | $15-$50 / asset via SaaS | **$0.00 marginal external diffusion cost** |
| **Security & Privacy Boundary** | Public third-party SaaS | **Private Render Plane + controlled external-processing policy** |

Performance values are operational targets unless explicitly marked as measured. The LTX-2.5 720p baseline below is an empirical measurement from the target RTX 4090 workstation and supersedes prior 20-30 second / ~14.2GB VRAM estimates.

---

## 2. Infrastructure Topology & Security Perimeter

The system uses a **hybrid split-plane topology** separating persistent control/review services from local GPU execution.

### 2.1 Deployment Plane Segmentation

#### A. Cloud Control Plane - Hetzner CPX31, Falkenstein

Responsibilities:

- PostgreSQL 18.6 relational state, workflow metadata, review history, and durable worker leases.
- Next.js Director Review Hub.
- MinIO S3-compatible object storage for **review proxies, temporary candidates, reference previews, and time-bounded delivery media**.
- Presigned URL issuance for browser media access.
- Durable job leasing with `SELECT ... FOR UPDATE SKIP LOCKED`.
- Prometheus-compatible application metrics.
- No ComfyUI inference workloads.

PostgreSQL 18 asynchronous I/O uses the platform default `io_method = 'worker'`. `io_workers` remains at the PostgreSQL default initially and is treated as a **deployment-tuning parameter**, not an architectural constant. Changes require representative load testing.

#### B. Local Compute Runner - Trinidad Inference Workstation

Responsibilities:

- ComfyUI headless daemon.
- TypeScript orchestration worker under Node.js 24 LTS.
- Local NVMe model checkpoint and cultural LoRA vault.
- Long-term generation master storage.
- FFmpeg media assembly.
- NVIDIA NVML health/VRAM telemetry.
- Upload of review proxies and explicitly selected delivery media to MinIO over Tailscale.

Network bindings:

- ComfyUI: `127.0.0.1:8188` and Tailscale interface only.
- Orchestrator control endpoint: Tailscale interface only.
- No public WAN listener.

#### C. Remote Review & Direction Plane - Ottawa, Canada

The Creative Director accesses:

`https://review.godzspeed-internal.ts.net`

through Tailscale/MagicDNS.

Supported director operations are defined by the canonical state machine in Section 4.

### 2.2 Network Overlay & Asset Distribution Security

- **Mesh Network:** Tailscale utilizing WireGuard-encrypted peer-to-peer tunnels.
- **Canonical Tailnet Namespace:** `godzspeed-internal.ts.net`.
- **Review Hub:** `review.godzspeed-internal.ts.net`.
- **Compute Runner:** `render-01.godzspeed-internal.ts.net`.
- **Control Plane:** `control-01.godzspeed-internal.ts.net`.
- **Access Control:** Zero public inbound application/database/ComfyUI ports. Administrative and application access is Tailscale-only.
- **Media Delivery:** Generated review media is uploaded from Trinidad to MinIO over Tailscale.
- **Browser Delivery:** The Review Hub generates short-lived presigned S3 URLs. Presigned URLs are **never persisted as canonical asset identifiers**.
- **Persistent Media Identity:** Database records store bucket/object keys plus content hashes. URLs are generated on demand.

### 2.3 MinIO Object Lifecycle & Capacity Controls

The CPX31 system disk is not treated as an unlimited media archive. MinIO is a **review/distribution layer**, while long-term generation masters remain in the Trinidad asset vault and backup system.

#### Bucket Classes

| Bucket / Class | Purpose | Default Retention |
|---|---|---|
| `godzspeed-temp` | rejected candidates, transient intermediates, temporary render stems | **14 days** |
| `godzspeed-review` | WebP keyframes, proxy MP4s, review audio | **60 days** |
| `godzspeed-reference` | active client logos, reference previews, compact brand assets | **while client is active** |
| `godzspeed-delivery` | approved delivery copies awaiting client handoff | **90 days after campaign completion** |

Retention is enforced by S3 lifecycle rules. Client contracts may override defaults.

#### Capacity Watermarks

- **70% disk usage:** warning; emit alert and accelerate eligible lifecycle cleanup.
- **85% disk usage:** degraded mode; stop nonessential candidate/proxy uploads and run cleanup.
- **92% disk usage:** critical mode; stop new MinIO media sync and prevent new campaigns from entering production until capacity is restored.

If media usage remains above 60% of CPX31 disk capacity for 14 consecutive days, migrate MinIO data to a dedicated storage volume/service rather than increasing local retention pressure.

Required metrics:

- `godzspeed_object_storage_bytes`
- `godzspeed_storage_free_bytes`
- `godzspeed_storage_watermark_state`

### 2.4 MinIO Component Governance

MinIO Object Store is tracked as an infrastructure software dependency under **GNU AGPLv3**.

Agency policy:

- Deploy MinIO as a separate, unmodified S3-compatible service.
- Do not embed MinIO server code into proprietary application binaries.
- Record the deployed MinIO version, license source, and review date in the component license registry.
- Require OSS/legal review before modifying MinIO, redistributing it, or creating a derivative integration that could alter source-availability obligations.
- A future commercial or alternative S3-compatible backend may replace MinIO without changing application-domain contracts.

---

## 3. Compute Isolation, Model Lifecycle & Resilience

### 3.1 Strict Compute Isolation & VRAM Lifecycle Management

The RTX 4090 is reserved for diffusion execution. Cognitive cloud workloads consume no local VRAM when external processing is permitted.

#### ComfyUI Startup Profile

The empirical LTX-2.5 benchmark demonstrated that the official 720p workflow succeeds on the RTX 4090 by cycling the large text encoder and diffusion transformer through GPU memory rather than keeping the entire working set resident simultaneously. Therefore, the **initial production baseline is ComfyUI default DynamicVRAM / workflow-managed offloading**.

Baseline startup:

```bash
python main.py --listen 100.x.y.z --port 8188
```

`--gpu-only` is prohibited for the Phase 1 production profile. `--highvram` remains an experimental comparator only and is adopted only if the Sprint 1 certification suite proves equal-or-better stability, memory headroom, and repeated transition behavior. Mutually exclusive VRAM flags are never combined.

The exact ComfyUI commit, startup arguments, workflow loader behavior, and selected memory mode are persisted as the certified `runnerProfile`.

#### VRAM Unload & Transition Protocol

When changing model families, for example FLUX -> LTX:

1. The orchestrator requests model unloading:

```http
POST http://127.0.0.1:8188/free
Content-Type: application/json

{
  "free_memory": true,
  "unload_models": true
}
```

2. The ComfyUI Python process performs its own model unload / garbage-collection / cache-reclamation behavior.
3. The Node.js orchestrator **does not claim to directly execute Python `gc.collect()` or `torch.cuda.empty_cache()`**.
4. The orchestrator polls NVML VRAM telemetry until configured headroom is reached.
5. The next model family is not dispatched until headroom is satisfied or the cleanup timeout expires.
6. Failure to reclaim sufficient VRAM marks the worker `degraded`, records an error, and prevents the next heavyweight render from starting.

Initial transition thresholds are configuration values, not PRD constants.

#### 3.1.1 Empirical LTX-2.5 Hardware Certification Baseline

The following measurements were collected on the target Trinidad inference workstation using the accepted Hugging Face `Lightricks/LTX-2.5` repository and the official ComfyUI LTX-2.5 template for a single 5-second 720p render. These measurements are the current Phase 1 source of truth and replace earlier speculative resource estimates.

**Measured local model footprint:**

| Model directory | Measured size |
|---|---:|
| `diffusion_models` | **41 GB** |
| `text_encoders` | **15 GB** |
| `vae` | **4.5 GB** |
| `loras` | **8.3 GB** |
| `model_patches` | **3.7 MB** |
| **Total downloaded LTX-2.5 family** | **~68.8 GB** |

**Certified test workload:**

| Property | Measured value |
|---|---:|
| Resolution | **720p** |
| Frames | **97** |
| Approximate clip duration | **5 seconds** |
| DiT sampling steps | **8** |
| Peak GPU memory reported by `nvidia-smi` | **24,028 MB** |
| Approximate RTX 4090 memory utilization | **97.8%** |
| Core DiT sampling duration | **~12 seconds** |
| Total execution time | **46 seconds** |
| OOM result | **None - render completed successfully** |

Observed execution behavior showed ComfyUI cycling the large text-encoding and diffusion components through the RTX 4090 rather than keeping the full working set resident concurrently. Operationally, LTX-2.5 **fits on the RTX 4090 through controlled offloading**; it must not be described as fitting entirely in 24GB VRAM.

The benchmark establishes single-render compatibility, not production soak stability. Sprint 1 must additionally measure host RAM, peak RSS, swap activity, page faults, repeated FLUX <-> LTX transitions, and post-unload VRAM reclamation.

#### 3.1.2 Phase 1 GPU Concurrency Invariant

A Trinidad RTX 4090 Render Worker executes **at most one active diffusion generation at a time**. LTX-2.5 reached approximately 97.8% measured VRAM utilization in the certified workload; concurrent FLUX/LTX or LTX/LTX generation on one GPU is therefore prohibited.

CPU-side uploads, database operations, cloud API calls, and media metadata processing may overlap with GPU inference, but a second diffusion job cannot enter GPU execution until the active job releases the worker's GPU lease and the required VRAM headroom is verified.

#### 3.1.3 Phase 1 Host RAM Decision Gate

The current workstation remains at 32GB DDR5 until Sprint 1 measures the host-memory envelope under the same certified LTX workload. The 64GB upgrade remains a Phase 2 assumption **unless** Phase 1 testing demonstrates any of the following:

- sustained swap activity during normal LTX generation;
- insufficient operating-system / worker headroom;
- repeated-render RSS growth or memory leakage;
- materially degraded render latency caused by host-memory pressure;
- OOM or worker instability during the FLUX <-> LTX soak test.

If any condition is observed, 64GB system RAM becomes a **Phase 1 production prerequisite** rather than a Phase 2 enhancement.

### 3.2 Cloud API Failover, Rate Limiting & Error Classification

Provider/model names are configuration values and are not compiled into workflow business logic.

| Planning Task | Primary | Secondary Fallback | Retry Strategy | Cache |
|---|---|---|---|---|
| **Scene Script & SceneSpec Generation** | Anthropic Claude 5 Sonnet | OpenAI GPT-5.6 Sol | 3 retryable attempts, exponential 1s/2s/4s, then fallback | system prompt + approved brand context |
| **Candidate Keyframe Ranking (QA)** | Google Gemini 3.7 Flash | OpenAI GPT-5.6 Luna | 3 retryable attempts, exponential 1s/2s/4s, then fallback | visual assessment rubric |
| **Voiceover Synthesis** | ElevenLabs Multilingual v2 | Azure Neural Speech / configured OpenAI TTS model | 2 retryable attempts, linear 2s, then fallback | text-hash keyed |

#### Error Classification

**Retryable:**

- HTTP 429 rate limit.
- HTTP 5xx provider failure.
- Network timeout / connection reset / transient DNS failure.

**Non-retryable:**

- HTTP 400 request/schema error.
- HTTP 401 authentication failure.
- HTTP 403 authorization failure.
- Deterministic local validation failure.

**Safety/policy rejection:**

- Do not blindly retry.
- Do not use cross-provider fallback to circumvent a provider safety refusal.
- Route to human review or a policy-specific handling path.

Fallback providers are usable only when:

1. the provider exists in the client's `allowedProviders`;
2. the task-specific external-processing boolean is true;
3. the payload passes sensitive-data masking/redaction policy.

### 3.3 External Processing Degraded Modes

External-processing controls are functional behavior, not documentation-only flags.

| Policy | `true` behavior | `false` behavior |
|---|---|---|
| `allowCloudPlanning` | configured cloud planner generates SceneSpec | creator manually authors/edits SceneSpec; automated cloud decomposition disabled |
| `allowCloudVisualQA` | configured VLM ranks candidate frames | Review Hub presents candidates unranked for human selection |
| `allowCloudVoice` | configured cloud TTS generates VO | human/local audio upload required; cloud VO disabled |
| `sensitiveDataMasking` | policy engine masks configured textual identifiers before cloud calls | raw payload may only be sent when explicitly permitted by client policy |

### 3.4 Phased Generative Engine Architecture

Given the workstation's current 32GB DDR5 system RAM, engine deployment remains phased.

#### Phase 1 - Core Production Engines

**FLUX.1 [schnell] (FP8 / Apache 2.0)**

- Role: storyboard drafts and commercial brand stills.
- Observed target: ~1.9s per draft frame on RTX 4090.
- Approximate peak VRAM profile: ~9.2GB.
- Default Phase 1 still-image engine.

**LTX 2.5 Distilled / Official ComfyUI LTX-2.5 Workflow / LTX-2 Community License**

- Role: social video production and rapid camera motion.
- **Measured local model-family footprint:** ~68.8GB.
- **Operational free-space reservation:** >=100GB for model family, cache, and safe update headroom.
- **Measured certified workload:** 720p, 97 frames, ~5 seconds, 8 DiT steps.
- **Measured peak VRAM:** 24,028MB (~97.8% utilization on the target RTX 4090).
- **Measured total execution:** 46 seconds cold-load-through-decode.
- **Measured core DiT sampling:** ~12 seconds.
- Execution relies on ComfyUI DynamicVRAM / workflow-managed offloading; the full working set does not reside in VRAM simultaneously.
- Initial production performance acceptance target: **<=55 seconds** for the certified 720p/97-frame workflow, subject to the runner profile and model hashes being unchanged.
- One active diffusion render per RTX 4090 worker.

#### Phase 2 - Heavy Diffusion Engines

Requires 64GB+ host RAM and separate acceptance testing.

**Wan 2.1 14B (GGUF Q4_K_M / Apache 2.0)**

- Role: cinematic hero motion and human shots.
- Approximate peak VRAM target: ~21.5GB.
- Requires verified host-memory headroom.

**MiniMax H3**

- Role: architectural walkthroughs and native audiovisual generation.
- Heavy working set; Phase 2 only.
- Territory and commercial-use controls are mandatory before routing any production job.

### 3.5 Model & Component Licensing Governance

Licensing is enforced through a versioned **license registry**, not a static prose table alone.

| Component | License / Source Position | Key Conditions | Internal Policy |
|---|---|---|---|
| **FLUX.1 [schnell]** | Apache 2.0 | commercial use permitted under license | **Approved** for commercial stills/storyboards |
| **FLUX.1 [dev]** | FLUX.1-dev Non-Commercial License | commercial deployment requires appropriate BFL commercial licensing | **Restricted** unless a valid commercial agreement is recorded |
| **LTX 2.5** | LTX-2 Community License Agreement, license date Jan. 5, 2026 | current agency use subject to license terms including the applicable revenue threshold | **Approved conditionally** while license registry status remains current |
| **Wan 2.1 14B** | Apache 2.0 | use subject to Apache 2.0 | **Approved - Phase 2** after hardware validation |
| **MiniMax H3** | MiniMax H3 Community License, Aug. 2, 2026 | applicable territory excludes EU, UK, Republic of Korea, and USA; prior written authorization above US$20M yearly commercial-product/service revenue; UI display obligation for commercial products/services using H3; outputs/results may not be used/distributed outside applicable territory | **Approved - Phase 2 only** for Canada/T&T workflows that satisfy license controls |
| **MinIO Object Store** | GNU AGPLv3 | OSS obligations must be reviewed for deployment/modification/distribution model | **Conditionally approved** as isolated unmodified S3 service |

#### License Registry Required Fields

Every routed model or governed infrastructure component stores:

- `component_key`
- `component_type` (`model`, `software`, `service`)
- `license_name`
- `license_version`
- `license_date`
- `source_url`
- `territory_policy`
- `revenue_threshold_usd`
- `attribution_requirements`
- `output_distribution_restrictions`
- `reviewed_at`
- `approved_by`
- `status` (`approved`, `restricted`, `blocked`, `review_required`)

Production routing **fails closed** when a required component's license status is not `approved`.

### 3.6 Clean Architecture & Domain-Driven Design Constraints

The implementation carries forward the proven Clean Architecture / DDD discipline from the agency's existing automation orchestrator. This is an **architectural constraint**, not a style preference. Dependency direction is enforced mechanically in CI.

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
|-- docs/
|   |-- adr/
|   |-- CONTEXT.md
|   `-- prd.md
`-- .dependency-cruiser.cjs
```

#### 3.6.2 Dependency Rules

- `domain` may depend only on `shared`; it contains no PostgreSQL, HTTP, ComfyUI, MinIO, provider SDK, FFmpeg, filesystem, or Tailscale code.
- `application` depends on `domain`, `contracts`, and `shared`; it must not import infrastructure adapters.
- `infrastructure` implements application ports and may import domain types plus application port contracts, not application use cases.
- `web` consumes `contracts` and presentation-safe shared/domain types only; it does not import server application or infrastructure packages.
- Cross-layer wiring occurs only in `apps/control-api` and `apps/render-worker` composition roots.
- Circular dependencies are forbidden.
- Dependency Cruiser or equivalent CI tooling fails the build on boundary violations.

#### 3.6.3 Domain Model Boundaries

`Scene` is the principal aggregate root for creative-review and production lifecycle invariants. A `Campaign` coordinates scenes but does not become a single large transactional aggregate, allowing independent scene review/render progress.

Primary aggregates / domain concepts:

- `Campaign` - campaign identity, high-level completion/progress rules.
- `Scene` - SceneSpec, references, LoRA configuration, assigned engine, approval validity, and canonical lifecycle transitions.
- `RenderJob` - durable production work, retry limits, worker ownership, and completion semantics.
- `RenderLease` - exclusive GPU-worker execution right for one diffusion job.
- `ReferenceAsset` - continuity/provenance identity.
- `GenerationManifest` - immutable evidence from a successful render; not a mutable aggregate.
- `ReviewEvent` - append-only audit event.
- `RenderProfile` - versioned certified execution configuration for an engine/workflow/hardware envelope.

Domain state changes are expressed through behavior (`approve`, `requestReroll`, `queueForProduction`, `startRendering`, `submitForQa`, `fail`, `cancel`) rather than direct status assignment in HTTP routes or persistence code.

#### 3.6.4 Application Ports

Application orchestration depends on ports such as:

- `RenderEnginePort`
- `PlannerPort`
- `CandidateRankerPort`
- `VoiceSynthesisPort`
- `MediaAssemblerPort`
- `ObjectStoragePort`
- `GpuTelemetryPort`
- `SceneRepository`
- `CampaignRepository`
- `RenderJobRepository`
- `ManifestRepository`
- `ReviewEventStore`
- `LicenseRegistryRepository`
- `UnitOfWork`

Infrastructure adapters include ComfyUI, PostgreSQL, MinIO, Anthropic, OpenAI, Google, ElevenLabs/Azure, FFmpeg, and NVML. Provider adapters execute requests only; **application routing owns retry, fallback, policy, and provider selection**. A Gemini adapter never decides to call OpenAI itself, and a ComfyUI adapter never decides scene progression or retry policy.

#### 3.6.5 RenderProfile Contract

The empirically certified engine envelope is represented as versioned configuration rather than hard-coded domain behavior. Initial LTX profile concept:

```text
LTX_25_720P_5S_V1 (config/render-profiles/LTX_25_720P_5S_V1.json)
  engine: ltx_25
  workflowHash: 94f397eee3ad8b0cee000036119e524e8c7a012b88d79d00b74172df9d9bf539
  modelHashes:
    clip: 09a89e084de1a149c3de60cfe9dfd3e5161967eb09eea39e806fcdeffdd568de (15.37 GB)
    unet: c4279eeff115cbeaca494bd2183e7d768c38fe85a184dc6afbb7159157c44334 (21.50 GB)
    vae:  685b06ee3d9b2039647698fc4ea33175112462fc374e2777312c907897dfce8d (1.45 GB)
  frames: 97
  steps: 8
  runnerProfile: dynamicvram-offload-v1
  measuredPeakVramMb: 24038 (transition soak peak)
  measuredTotalDurationMs: 45632 (soak median duration)
  measuredSamplingDurationMs: null
  measuredDiskFootprintGb: 38.329275932 (exact byte sum: 38,329,275,932 bytes)
  measuredPeakHostRamMb: 29384 (soak peak host RAM)
  measuredPeakProcessRssMb: 27043 (soak peak process RSS)
  measuredSwapUsedMb: 89 (soak max LTX swap delta)
  measuredMajorPageFaults: 1009 (soak max LTX major page faults)
  minFreeDiskGb: 100
  maxConcurrentGpuJobs: 1
  requiresModelOffloading: true
```

Host RAM measurements are populated after Sprint 1 certification. Render Profiles may evolve without changing Scene/Campaign domain invariants.

---

## 4. Canonical Product State Machine & Review Hub Contract

The scene state machine is the authoritative contract for the Review Hub, queue, orchestrator, database enums, and automated tests.

### 4.1 Scene Lifecycle

```text
DRAFT_PENDING
    |
    v
GENERATING_CANDIDATES
    | success
    v
DIRECTOR_REVIEW
    |---- reroll / edit / reference change / LoRA tune ----|
    |                                                       |
    |<------------------------------------------------------|
    |
    | approve
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
    |---------------- reject ----------------> DIRECTOR_REVIEW
    |
    | approve
    v
COMPLETED

Any non-terminal production state may transition to FAILED or CANCELLED
according to the transition matrix below.
```

### 4.2 Allowed State Transitions

| Current State | Allowed Next State(s) | Primary Trigger |
|---|---|---|
| `draft_pending` | `generating_candidates`, `cancelled` | scene creation / campaign cancellation |
| `generating_candidates` | `director_review`, `failed`, `cancelled` | draft batch success/failure |
| `director_review` | `generating_candidates`, `approved`, `cancelled` | reroll/edit requiring regeneration, approve, cancel |
| `approved` | `queued`, `director_review`, `cancelled` | production authorization, approval revoked, cancel |
| `queued` | `rendering`, `failed`, `cancelled` | worker lease, dispatch failure, cancel |
| `rendering` | `qa`, `failed`, `cancelled` | production render completion/error |
| `qa` | `completed`, `director_review`, `failed` | QA approval/rejection/post-process failure |
| `completed` | terminal | final output accepted |
| `failed` | `queued`, `director_review`, `cancelled` | explicit retry or corrective review |
| `cancelled` | terminal | explicit cancellation |

State mutation occurs transactionally through the orchestration service. UI clients do not write raw scene status values.

### 4.3 Review Hub Director Actions

Supported actions:

- `approve`
- `reject`
- `reroll`
- `prompt_edit`
- `reference_change`
- `engine_change`
- `duration_change`
- `lora_tune`
- `reorder`
- `duplicate`
- `cancel`

Every action creates an append-only `review_events` record before or in the same transaction as the resulting mutable scene-state update.

### 4.4 Approval Semantics

- Approval applies to a specific current SceneSpec revision.
- Any prompt/reference/engine/duration/LoRA mutation after approval invalidates that approval and returns the scene to `director_review` or `generating_candidates`.
- A production job may be created only from `approved`.
- A production render manifest records the exact SceneSpec/workflow inputs used by the job.
- QA rejection never overwrites the completed render history; it creates new review events and subsequent render jobs.

---

## 5. Data Contracts & Relational Persistence

### 5.1 PostgreSQL 18.6 Baseline

PostgreSQL 18.6 uses core UUID generation. No `uuid-ossp` extension is required.

New primary keys use native `uuidv7()` for approximately time-ordered UUIDs and improved index locality while preserving UUID semantics.

```sql
-- Database: godzspeed_orchestrator
-- PostgreSQL 18.6
-- Initial AIO policy: PostgreSQL defaults.
-- io_method defaults to 'worker'; io_workers is deployment-tuned only after load testing.

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------

CREATE TYPE license_status_enum AS ENUM (
  'approved',
  'restricted',
  'blocked',
  'review_required'
);

CREATE TYPE campaign_status_enum AS ENUM (
  'drafting',
  'pending_director_review',
  'partially_approved',
  'queued',
  'rendering',
  'qa',
  'completed',
  'failed',
  'cancelled'
);

CREATE TYPE scene_status_enum AS ENUM (
  'draft_pending',
  'generating_candidates',
  'director_review',
  'approved',
  'queued',
  'rendering',
  'qa',
  'completed',
  'failed',
  'cancelled'
);

CREATE TYPE job_status_enum AS ENUM (
  'queued',
  'leased',
  'rendering',
  'completed',
  'failed',
  'cancelled'
);

CREATE TYPE review_action_enum AS ENUM (
  'approve',
  'reject',
  'reroll',
  'prompt_edit',
  'reference_change',
  'engine_change',
  'duration_change',
  'lora_tune',
  'reorder',
  'duplicate',
  'cancel'
);

-- ---------------------------------------------------------------------------
-- LICENSE REGISTRY
-- ---------------------------------------------------------------------------

CREATE TABLE license_registry (
  component_key VARCHAR(128) PRIMARY KEY,
  component_type VARCHAR(32) NOT NULL,
  license_name VARCHAR(255) NOT NULL,
  license_version VARCHAR(128),
  license_date DATE,
  source_url TEXT NOT NULL,
  territory_policy JSONB NOT NULL DEFAULT '{}',
  revenue_threshold_usd NUMERIC(16, 2),
  attribution_requirements TEXT,
  output_distribution_restrictions TEXT,
  reviewed_at TIMESTAMP WITH TIME ZONE NOT NULL,
  approved_by VARCHAR(128) NOT NULL,
  status license_status_enum NOT NULL DEFAULT 'review_required',
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- CLIENTS & GOVERNANCE
-- ---------------------------------------------------------------------------

CREATE TABLE clients (
  client_id UUID PRIMARY KEY DEFAULT uuidv7(),
  company_name VARCHAR(255) NOT NULL,
  brand_bible_json JSONB NOT NULL DEFAULT '{}',
  default_aspect_ratio VARCHAR(16) NOT NULL DEFAULT '9:16',
  external_processing_policy JSONB NOT NULL DEFAULT '{
    "allowCloudPlanning": true,
    "allowCloudVisualQA": true,
    "allowCloudVoice": true,
    "allowedProviders": ["Anthropic", "OpenAI", "Google", "ElevenLabs"],
    "sensitiveDataMasking": true
  }',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMP WITH TIME ZONE
);

-- ---------------------------------------------------------------------------
-- REFERENCE ASSETS
-- ---------------------------------------------------------------------------

CREATE TABLE reference_assets (
  asset_id UUID PRIMARY KEY DEFAULT uuidv7(),
  client_id UUID NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  asset_type VARCHAR(64) NOT NULL,
  storage_bucket VARCHAR(128) NOT NULL,
  storage_object_key TEXT NOT NULL,
  content_hash_sha256 VARCHAR(64) NOT NULL,
  controlnet_type VARCHAR(64) NOT NULL DEFAULT 'none',
  default_strength NUMERIC(3, 2) NOT NULL DEFAULT 0.85
    CHECK (default_strength >= 0 AND default_strength <= 1),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMP WITH TIME ZONE,
  UNIQUE (storage_bucket, storage_object_key)
);

CREATE INDEX idx_reference_assets_client
  ON reference_assets(client_id, asset_type)
  WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- CAMPAIGNS
-- ---------------------------------------------------------------------------

CREATE TABLE campaigns (
  campaign_id UUID PRIMARY KEY DEFAULT uuidv7(),
  client_id UUID NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  title VARCHAR(255) NOT NULL,
  target_platform VARCHAR(64) NOT NULL DEFAULT 'instagram_reels',
  status campaign_status_enum NOT NULL DEFAULT 'drafting',
  total_scenes INT NOT NULL DEFAULT 1 CHECK (total_scenes > 0),
  approved_scenes INT NOT NULL DEFAULT 0 CHECK (approved_scenes >= 0),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_campaigns_client_status
  ON campaigns(client_id, status)
  WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- STORYBOARD SCENES
-- ---------------------------------------------------------------------------

CREATE TABLE storyboard_scenes (
  scene_id UUID PRIMARY KEY DEFAULT uuidv7(),
  campaign_id UUID NOT NULL REFERENCES campaigns(campaign_id) ON DELETE RESTRICT,
  scene_order INT NOT NULL CHECK (scene_order > 0),
  duration_seconds NUMERIC(6, 2) NOT NULL DEFAULT 5.00 CHECK (duration_seconds > 0),
  shot_type VARCHAR(64) NOT NULL,
  visual_description TEXT NOT NULL,
  voiceover_copy TEXT,
  audio_fx_prompt TEXT,
  engine_assigned VARCHAR(64) NOT NULL DEFAULT 'ltx_25',
  status scene_status_enum NOT NULL DEFAULT 'draft_pending',
  draft_storage_bucket VARCHAR(128),
  draft_storage_object_key TEXT,
  director_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT unique_campaign_scene_order UNIQUE (campaign_id, scene_order)
);

CREATE INDEX idx_storyboard_scenes_campaign
  ON storyboard_scenes(campaign_id, status)
  WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- SCENE REFERENCE ASSOCIATIONS
-- ---------------------------------------------------------------------------

CREATE TABLE scene_reference_assets (
  scene_id UUID NOT NULL REFERENCES storyboard_scenes(scene_id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES reference_assets(asset_id) ON DELETE RESTRICT,
  override_strength NUMERIC(3, 2)
    CHECK (override_strength IS NULL OR (override_strength >= 0 AND override_strength <= 1)),
  PRIMARY KEY (scene_id, asset_id)
);

-- ---------------------------------------------------------------------------
-- DURABLE RENDER QUEUE
-- ---------------------------------------------------------------------------

CREATE TABLE render_jobs (
  job_id UUID PRIMARY KEY DEFAULT uuidv7(),
  scene_id UUID NOT NULL REFERENCES storyboard_scenes(scene_id) ON DELETE RESTRICT,
  workflow_template VARCHAR(128) NOT NULL,
  injected_payload JSONB NOT NULL,
  status job_status_enum NOT NULL DEFAULT 'queued',
  worker_id VARCHAR(128),
  lease_expires_at TIMESTAMP WITH TIME ZONE,
  retry_count INT NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  max_retries INT NOT NULL DEFAULT 3 CHECK (max_retries >= 0),
  error_trace TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (retry_count <= max_retries)
);

CREATE INDEX idx_render_jobs_queue
  ON render_jobs(status, lease_expires_at)
  WHERE status IN ('queued', 'leased');

CREATE INDEX idx_render_jobs_scene
  ON render_jobs(scene_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- IMMUTABLE GENERATION MANIFESTS
-- Exactly one final manifest per successful render job.
-- ---------------------------------------------------------------------------

CREATE TABLE generation_manifests (
  manifest_id UUID PRIMARY KEY DEFAULT uuidv7(),
  job_id UUID NOT NULL UNIQUE REFERENCES render_jobs(job_id) ON DELETE RESTRICT,
  prompt_id_comfy VARCHAR(128) NOT NULL,
  campaign_id UUID NOT NULL REFERENCES campaigns(campaign_id) ON DELETE RESTRICT,
  scene_id UUID NOT NULL REFERENCES storyboard_scenes(scene_id) ON DELETE RESTRICT,
  render_attempt INT NOT NULL DEFAULT 1 CHECK (render_attempt > 0),
  manifest_payload JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_manifests_scene_attempt
  ON generation_manifests(scene_id, render_attempt);

-- ---------------------------------------------------------------------------
-- APPEND-ONLY DIRECTOR REVIEW EVENTS
-- ---------------------------------------------------------------------------

CREATE TABLE review_events (
  event_id UUID PRIMARY KEY DEFAULT uuidv7(),
  scene_id UUID NOT NULL REFERENCES storyboard_scenes(scene_id) ON DELETE RESTRICT,
  reviewer_name VARCHAR(128) NOT NULL DEFAULT 'Thomas Cumberbatch',
  action review_action_enum NOT NULL,
  director_notes TEXT,
  mutation_payload JSONB NOT NULL DEFAULT '{}',
  prior_scene_status scene_status_enum,
  resulting_scene_status scene_status_enum,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_review_events_scene
  ON review_events(scene_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- ENFORCE IMMUTABILITY / APPEND-ONLY AUDIT SEMANTICS
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only/immutable; % is not permitted',
    TG_TABLE_NAME, TG_OP;
END;
$$;

CREATE TRIGGER trg_generation_manifests_immutable
BEFORE UPDATE OR DELETE ON generation_manifests
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

CREATE TRIGGER trg_review_events_append_only
BEFORE UPDATE OR DELETE ON review_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
```

Production application roles receive `SELECT`/`INSERT` permissions on audit tables but no `UPDATE`/`DELETE`. Production campaigns/scenes use `archived_at` rather than destructive deletion after audit history exists.

### 5.2 TypeScript Reference Asset Contract

Persistent references use object locators, not expiring URLs.

```typescript
// src/schemas/reference.ts
import { z } from "zod";

export const AssetRefSchema = z.object({
  assetId: z.string().uuid(),
  assetType: z.enum([
    "product_packshot",
    "character_face",
    "environment_anchor",
    "brand_logo",
    "audio_voice_sample",
  ]),
  storageBucket: z.string().min(1),
  storageObjectKey: z.string().min(1),
  contentHashSha256: z.string().length(64),
  controlnetType: z
    .enum(["canny", "depth", "openpose", "ipadapter_face", "none"])
    .default("none"),
  strength: z.number().min(0).max(1).default(0.85),
});

export type AssetRef = z.infer<typeof AssetRefSchema>;
```

### 5.3 Scene State & Review Action Contracts

```typescript
// src/schemas/sceneState.ts
import { z } from "zod";

export const SceneStatusSchema = z.enum([
  "draft_pending",
  "generating_candidates",
  "director_review",
  "approved",
  "queued",
  "rendering",
  "qa",
  "completed",
  "failed",
  "cancelled",
]);

export const ReviewActionSchema = z.enum([
  "approve",
  "reject",
  "reroll",
  "prompt_edit",
  "reference_change",
  "engine_change",
  "duration_change",
  "lora_tune",
  "reorder",
  "duplicate",
  "cancel",
]);

export type SceneStatus = z.infer<typeof SceneStatusSchema>;
export type ReviewAction = z.infer<typeof ReviewActionSchema>;
```

The orchestration service maintains an explicit transition map and rejects invalid transitions before opening a database transaction.

### 5.4 Generation Manifest Contract

```typescript
// src/schemas/manifest.ts
import { z } from "zod";
import { AssetRefSchema } from "./reference";

export const GenerationManifestSchema = z.object({
  manifestId: z.string().uuid(),
  jobId: z.string().uuid(),
  promptIdComfy: z.string(),
  campaignId: z.string().uuid(),
  sceneId: z.string().uuid(),
  renderAttempt: z.number().int().positive(),
  timestamp: z.string().datetime(),

  engine: z.enum([
    "flux_schnell",
    "flux_dev",
    "ltx_25",
    "wan_21",
    "minimax_h3",
  ]),

  models: z.object({
    checkpointName: z.string(),
    checkpointSha256: z.string().length(64),
    vaeName: z.string(),
    vaeSha256: z.string().length(64),
    textEncoderName: z.string(),
    textEncoderSha256: z.string().length(64),
  }),

  workflow: z.object({
    templateName: z.string(),
    templateSha256: z.string().length(64),
  }),

  loras: z.array(
    z.object({
      loraName: z.string(),
      loraSha256: z.string().length(64),
      modelStrength: z.number(),
      clipStrength: z.number(),
    }),
  ),

  sampling: z.object({
    seed: z.number().int(),
    steps: z.number().int().positive(),
    cfg: z.number(),
    samplerName: z.string(),
    scheduler: z.string(),
    denoise: z.number().min(0).max(1).default(1.0),
  }),

  dimensions: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    frameCount: z.number().int().positive(),
    fps: z.number().int().positive(),
  }),

  prompts: z.object({
    positive: z.string(),
    negative: z.string(),
    audioPrompt: z.string().optional(),
  }),

  references: z.array(AssetRefSchema),

  environment: z.object({
    comfyGitCommit: z.string(),
    customNodes: z.record(z.string(), z.string()),
    cudaDriverVersion: z.string(),
    nodeVersion: z.string(),
    runnerProfile: z.string(), // e.g. "dynamicvram-offload-v1"
  }),

  governance: z.object({
    modelLicenseKey: z.string(),
    modelLicenseReviewedAt: z.string().datetime(),
    externalProcessingPolicyHash: z.string().length(64),
  }),

  output: z.object({
    localAssetFilenames: z.array(z.string()),
    assetHashesSha256: z.array(z.string().length(64)),
    reviewObjectKeys: z.array(z.string()).default([]),
    executionDurationMs: z.number().int().nonnegative(),
  }),
});

export type GenerationManifest = z.infer<typeof GenerationManifestSchema>;
```

### 5.5 External Processing Governance Contract

```typescript
// src/schemas/policy.ts
import { z } from "zod";

export const ExternalProcessingPolicySchema = z.object({
  clientId: z.string().uuid(),
  allowCloudPlanning: z.boolean().default(true),
  allowCloudVisualQA: z.boolean().default(true),
  allowCloudVoice: z.boolean().default(true),
  allowedProviders: z
    .array(z.enum(["Anthropic", "OpenAI", "Google", "ElevenLabs", "Azure"]))
    .default(["Anthropic", "OpenAI", "Google", "ElevenLabs"]),
  sensitiveDataMasking: z.boolean().default(true),
});

export type ExternalProcessingPolicy = z.infer<
  typeof ExternalProcessingPolicySchema
>;
```

---

## 6. Production ComfyUI Execution Client

The execution client must provide:

- queue submission;
- WebSocket completion monitoring;
- timeout handling;
- `execution_error` handling;
- interruption handling;
- final `/history` verification;
- output subfolder preservation;
- explicit model-unload requests;
- no reliance on browser/GUI state.

Representative implementation:

```typescript
// src/client/comfyClient.ts
import WebSocket from "ws";
import crypto from "crypto";

export interface ExecutionResult {
  promptId: string;
  outputFiles: string[];
  durationMs: number;
}

export class ComfyClient {
  private serverAddress: string;
  private clientId: string;

  constructor(serverAddress = "127.0.0.1:8188") {
    this.serverAddress = serverAddress;
    this.clientId = crypto.randomUUID();
  }

  async queuePrompt(
    workflow: Record<string, unknown>,
  ): Promise<{ prompt_id: string }> {
    const res = await fetch(`http://${this.serverAddress}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: workflow,
        client_id: this.clientId,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`ComfyUI Queue Error [${res.status}]: ${err}`);
    }

    return res.json() as Promise<{ prompt_id: string }>;
  }

  async freeVram(): Promise<void> {
    const res = await fetch(`http://${this.serverAddress}/free`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        free_memory: true,
        unload_models: true,
      }),
    });

    if (!res.ok) {
      throw new Error(`ComfyUI VRAM unload request failed [${res.status}]`);
    }
  }

  async getHistory(promptId: string): Promise<any> {
    const res = await fetch(
      `http://${this.serverAddress}/history/${promptId}`,
    );

    if (!res.ok) {
      throw new Error(`ComfyUI History Error [${res.status}]`);
    }

    const data = await res.json();
    return data[promptId] || null;
  }

  async generateAndWait(
    workflow: Record<string, unknown>,
    timeoutMs = 300_000,
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const wsUrl =
        `ws://${this.serverAddress}/ws?clientId=${this.clientId}`;
      const ws = new WebSocket(wsUrl);

      let targetPromptId = "";
      let isSettled = false;

      const timer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          ws.close();
          reject(
            new Error(
              `ComfyUI render timed out after ${timeoutMs / 1000}s ` +
              `(Prompt: ${targetPromptId})`,
            ),
          );
        }
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);

        if (
          ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING
        ) {
          ws.close();
        }
      };

      ws.on("open", async () => {
        try {
          const queueRes = await this.queuePrompt(workflow);
          targetPromptId = queueRes.prompt_id;
        } catch (err) {
          if (!isSettled) {
            isSettled = true;
            cleanup();
            reject(err);
          }
        }
      });

      ws.on("message", (data: WebSocket.RawData) => {
        if (isSettled) return;

        try {
          const msg = JSON.parse(data.toString());

          if (msg.type === "progress") {
            const { value, max } = msg.data;
            process.stdout.write(
              `    [Inference] Step ${value}/${max}\r`,
            );
          }

          if (
            msg.type === "execution_error" &&
            msg.data.prompt_id === targetPromptId
          ) {
            isSettled = true;
            cleanup();
            reject(
              new Error(
                `ComfyUI Node Execution Error: ` +
                `${JSON.stringify(msg.data)}`,
              ),
            );
          }

          if (
            msg.type === "execution_interrupted" &&
            msg.data.prompt_id === targetPromptId
          ) {
            isSettled = true;
            cleanup();
            reject(
              new Error("ComfyUI Execution Interrupted by Server"),
            );
          }

          if (
            msg.type === "executing" &&
            msg.data.node === null &&
            msg.data.prompt_id === targetPromptId
          ) {
            cleanup();
          }
        } catch {
          // Ignore non-JSON/binary frames.
        }
      });

      ws.on("close", async () => {
        if (isSettled || !targetPromptId) return;

        try {
          const history = await this.getHistory(targetPromptId);

          if (!history) {
            throw new Error(
              `Job history not found for prompt: ${targetPromptId}`,
            );
          }

          const statusStr = history.status?.status_str;

          if (statusStr !== "success") {
            throw new Error(
              `ComfyUI render ended with status '${statusStr}': ` +
              `${JSON.stringify(history.status)}`,
            );
          }

          const outputFiles: string[] = [];

          if (history.outputs) {
            for (const nodeId of Object.keys(history.outputs)) {
              const nodeOut = history.outputs[nodeId];

              for (const img of nodeOut.images ?? []) {
                outputFiles.push(
                  img.subfolder
                    ? `${img.subfolder}/${img.filename}`
                    : img.filename,
                );
              }

              for (const vid of nodeOut.videos ?? []) {
                outputFiles.push(
                  vid.subfolder
                    ? `${vid.subfolder}/${vid.filename}`
                    : vid.filename,
                );
              }
            }
          }

          isSettled = true;
          resolve({
            promptId: targetPromptId,
            outputFiles,
            durationMs: Date.now() - startTime,
          });
        } catch (err) {
          if (!isSettled) {
            isSettled = true;
            reject(err);
          }
        }
      });

      ws.on("error", (err) => {
        if (!isSettled) {
          isSettled = true;
          cleanup();
          reject(
            new Error(
              `ComfyUI WebSocket Connection Failed: ${err.message}`,
            ),
          );
        }
      });
    });
  }
}
```

VRAM transition orchestration wraps `freeVram()` with NVML polling; it is not embedded in `ComfyClient` itself.

---

## 7. Telemetry, Observability & Health Monitoring

### 7.1 Daemon Health Endpoint - `/healthz`

HTTP 200 is returned only for `ok` or intentionally `degraded` states.

Response schema:

```json
{
  "status": "ok",
  "gpu_vram_free_mb": 18742,
  "comfy_online": true,
  "tailscale_connected": true,
  "queue_backlog_count": 0,
  "queue_oldest_job_seconds": 0,
  "storage_free_bytes": 128849018880,
  "storage_watermark_state": "normal",
  "active_engine": null
}
```

`status` values:

- `ok`
- `degraded`
- `error`

### 7.2 Prometheus Metrics - `/metrics`

Required metrics:

- `godzspeed_render_duration_seconds{engine,scene_type}` - histogram
- `godzspeed_vram_allocated_bytes` - gauge
- `godzspeed_job_retries_total{engine,error_class}` - counter
- `godzspeed_api_failovers_total{task,from_provider,to_provider}` - counter
- `godzspeed_queue_oldest_job_seconds` - gauge
- `godzspeed_render_failures_total{engine,error_class}` - counter
- `godzspeed_object_storage_bytes{bucket}` - gauge
- `godzspeed_storage_free_bytes` - gauge
- `godzspeed_storage_watermark_state` - numeric/enum-compatible gauge
- `godzspeed_invalid_state_transitions_total` - counter

### 7.3 Operational Alerts

Minimum alerts:

- queue oldest job exceeds configured SLA;
- render failure rate exceeds threshold;
- storage reaches 70/85/92% watermark;
- ComfyUI unreachable for > 2 minutes;
- Tailscale disconnected;
- VRAM cleanup threshold not reached within timeout;
- license registry contains a `review_required`/`blocked` component referenced by an enabled routing profile.

---

## 8. Implementation Roadmap

### Sprint 1 - Core Runtime, Domain Boundaries & Hardware Certification (Week 1)

- Scaffold the monorepo with `domain`, `application`, `infrastructure`, `contracts`, `shared`, `control-api`, `render-worker`, and `web` boundaries.
- Port the automation-repo Clean Architecture dependency rules into Dependency Cruiser and CI before feature implementation.
- Implement authoritative Scene state behavior and application transition services with unit tests.
- Create PostgreSQL 18.6 migrations using UUIDv7 and audit immutability triggers.
- Export and hash Gold Master API templates for FLUX.1 [schnell] and the official LTX-2.5 720p workflow.
- Deploy `ComfyClient` with timeout/error traps and `/free` support behind `RenderEnginePort`.
- Freeze the empirical LTX baseline input: 720p, 97 frames, ~5 seconds, 8 DiT steps.
- Record LTX model-family disk footprint (~68.8GB) and require >=100GB free-space reservation.
- Benchmark **default DynamicVRAM/workflow offloading first**; test `--highvram` only as an experimental comparator.
- Measure total latency, core sampling latency, peak VRAM, peak process RSS/system RAM, swap usage, major page faults, and post-unload VRAM.
- Certify one versioned `RenderProfile` / `runnerProfile` with workflow/model hashes.
- Execute a 10-20 transition soak sequence alternating FLUX and LTX; verify no progressive VRAM/RAM growth, no OOM, and no ComfyUI restart.
- Decide from measured evidence whether 32GB host RAM remains supported or 64GB becomes a Phase 1 prerequisite.
- Execute end-to-end CLI render through the application port and infrastructure adapter stack.

### Sprint 2 - Next.js Review Hub, Tailscale & MinIO Review Plane (Week 2)

- Deploy Next.js Review Hub.
- Normalize all private hostnames under `godzspeed-internal.ts.net`.
- Deploy MinIO as separate S3-compatible service.
- Implement bucket lifecycle/retention rules and storage watermarks.
- Implement object-key persistence and on-demand presigned URL generation.
- Implement director actions and state transition UI.
- Test scene approval, rejection, prompt edits, reference changes, LoRA tuning, and re-roll over Tailscale.

### Sprint 3 - Continuity, Manifests, Audit & Assembly (Week 3)

- Implement `ReferenceAsset` continuity layer.
- Implement immutable `GenerationManifest` creation with one manifest per successful job.
- Implement append-only review-event persistence.
- Implement model/component license registry and fail-closed routing guard.
- Implement PostgreSQL durable leases with `SELECT ... FOR UPDATE SKIP LOCKED`.
- Build FFmpeg concatenation, VO muxing, soundbed, and subtitle pipeline.
- Add health and Prometheus telemetry.

### Sprint 4 - API Resilience & Commercial PoC (Week 4)

- Integrate Claude 5 Sonnet -> GPT-5.6 Sol planning failover.
- Integrate Gemini 3.7 Flash -> GPT-5.6 Luna candidate-ranking failover.
- Implement retry/error classification and policy-aware fallback.
- Integrate cloud voice provider fallback.
- Execute Tobago Vacation Villa commercial proof of concept.
- Pass all pre-flight engineering acceptance gates.
- Freeze certified workflow templates, model hashes, environment metadata, and runner profile.

---

## 9. Pre-Flight Engineering Acceptance Gates

No paying production campaign may be onboarded until all required gates pass.

### 9.1 Core Rendering & Hardware Certification

- [x] **FLUX Smoke Test Gate:** Headless ComfyUI accepts programmatic WebSocket payloads and executes 4-step FLUX [schnell] sampling in < 2.0 seconds on the validated draft workflow.
- [x] **LTX Compatibility Benchmark:** Official LTX-2.5 720p / 97-frame / 8-step workflow completes on the target RTX 4090 without OOM; measured baseline is 46s total execution and 24,028MB peak VRAM.
- [ ] **LTX Resource Envelope Gate:** Repeat the certified workflow with pinned hashes and verify <=55s total execution while recording peak VRAM, peak host RAM/RSS, swap, page faults, and post-unload VRAM.
- [ ] **ComfyUI Memory Profile Gate:** Certify default DynamicVRAM/workflow offloading as baseline; `--highvram` may replace it only if repeated tests show equal-or-better stability and resource headroom. Verify no mutually exclusive VRAM flags are combined.
- [ ] **Host RAM Gate:** 32GB passes only if the certified workflow and transition soak show no sustained swap, no OOM, adequate OS/worker headroom, and no progressive RAM growth. Otherwise 64GB becomes a Phase 1 prerequisite.
- [ ] **Model Transition Soak Gate:** Execute at least 10 sequential FLUX <-> LTX family transitions using `/free` plus NVML headroom validation; require zero OOMs, zero ComfyUI restarts, and no progressive VRAM/RAM leak.
- [ ] **Single-GPU Concurrency Gate:** Attempt to dispatch a second diffusion job while one owns the RenderLease; verify it remains queued and cannot enter GPU execution.

### 9.2 Failure & Queue Semantics

- [ ] **Error Path Recovery Gate:** Intentionally malformed workflow causes `execution_error`, rejects within 2 seconds, and records `error_trace` without process hang.
- [ ] **Lease Recovery Gate:** Kill a worker after leasing a job; verify lease expiry permits deterministic reassignment without duplicate completed manifests.
- [ ] **API Failure Classification Gate:** Confirm 429/5xx/timeouts retry; 400/401/403 fail immediately; safety rejection does not trigger policy-bypass fallback.

### 9.3 Product State & Audit Integrity

- [ ] **State Machine Gate:** Unit/integration test every permitted transition and reject every unpermitted transition.
- [ ] **Approval Invalidation Gate:** Mutating prompt/reference/engine/duration/LoRA after approval invalidates approval and returns the scene to review/regeneration.
- [ ] **Audit Immutability Gate:** Application role cannot `UPDATE` or `DELETE` `generation_manifests` or `review_events`; database triggers reject direct mutation attempts.
- [ ] **One-Job-One-Manifest Gate:** A completed production job produces exactly one immutable manifest referencing its `job_id`.

### 9.4 Network & Storage

- [ ] **Zero Public Exposure Audit:** Port scan confirms application/database/ComfyUI/MinIO administrative ports are unreachable from public WAN.
- [ ] **MagicDNS Consistency Gate:** `review`, `control-01`, and `render-01` resolve under `godzspeed-internal.ts.net` from authorized nodes.
- [ ] **Storage Lifecycle Gate:** Create test objects in temporary/review classes and verify lifecycle configuration plus deletion eligibility.
- [ ] **Storage Watermark Gate:** Simulate 70%, 85%, and 92% states; verify warning, degraded upload behavior, and production hold.

### 9.5 Performance & Reconstruction

- [ ] **Candidate Draft Batch Latency:** Generate and sync 18 draft keyframes (3 candidates x 6 scenes) in < 45 seconds total.
- [ ] **Manifest Reconstruction Gate:** Reconstruct an approved scene's exact model/workflow/reference/sampling inputs from the immutable manifest and verify parameter parity.
- [ ] **FFmpeg Assembly Gate:** Compile six 5-second video stems, stereo soundbed, VO, and vertical subtitles into a 1080x1920 MP4 in < 30 seconds.

### 9.6 Governance

- [ ] **License Routing Gate:** A model/component with `restricted`, `blocked`, or `review_required` status cannot be dispatched.
- [ ] **External Processing Policy Gate:** Disabling each cloud-processing flag produces the documented degraded/manual behavior and prevents prohibited provider calls.
- [ ] **H3 Territory Gate (Phase 2):** MiniMax H3 cannot be routed for excluded-territory use or output distribution.

---

## 10. Engineering Baseline Rules

After PRD v3.4.0 is approved:

1. **Stop architecture churn.** Material architectural changes require an ADR rather than silent PRD edits.
2. **Pin execution dependencies.** Gold Master workflow JSONs, ComfyUI commit, custom-node commits, checkpoint hashes, VAE hashes, encoder hashes, and runner profile are versioned.
3. **Treat provider models as configuration.** Cloud model identifiers can be updated without modifying domain state-machine logic.
4. **Treat licenses as runtime governance.** Routing depends on current license-registry state.
5. **Treat audit data as immutable.** Corrections are new records/events, never history rewrites.
6. **Treat MinIO as review/distribution storage.** It is not the long-term master archive.
7. **One GPU, one active diffusion job.** A Render Worker must hold an exclusive RenderLease before entering GPU inference; CPU/network work may overlap but diffusion generations may not.
8. **Treat empirical Render Profiles as versioned configuration.** Performance/resource claims are tied to workflow/model hashes and runner profile; re-benchmark after material changes.
9. **Enforce Clean Architecture mechanically.** Domain/application/infrastructure/web boundary violations fail CI.
10. **Use ADRs for major decisions.** Example: changing object store, replacing PostgreSQL queueing, adding a second GPU worker, changing the certified memory mode, or moving diffusion compute into cloud infrastructure.

---

## 11. Primary Technical & Licensing References

Primary sources should be revalidated before major version upgrades or model/license changes.

### Runtime & Database

- Node.js Releases / Node 24 LTS "Krypton":  
  https://nodejs.org/en/about/previous-releases
- PostgreSQL 18 Resource Consumption / asynchronous I/O settings:  
  https://www.postgresql.org/docs/current/runtime-config-resource.html
- PostgreSQL 18 UUID functions (`uuidv7()`):  
  https://www.postgresql.org/docs/current/functions-uuid.html
- PostgreSQL 18 UUID type:  
  https://www.postgresql.org/docs/current/datatype-uuid.html

### ComfyUI

- ComfyUI CLI arguments / VRAM modes:  
  https://github.com/comfyanonymous/ComfyUI/blob/master/comfy/cli_args.py
- ComfyUI repository:  
  https://github.com/comfyanonymous/ComfyUI

### Networking

- Tailscale MagicDNS:  
  https://tailscale.com/docs/features/magicdns
- Tailscale / WireGuard architecture:  
  https://tailscale.com/docs/concepts/wireguard

### Empirical Hardware Baseline

- **Agency RTX 4090 LTX-2.5 benchmark (August 14, 2026):** Hugging Face `Lightricks/LTX-2.5` local model-family footprint ~68.8GB; official ComfyUI template at 720p / 97 frames / 8 steps; 24,028MB peak VRAM; ~12s DiT sampling; 46s total execution; completed without OOM. Host RAM/swap certification remains a Sprint 1 gate.

### Foundation Models

- Black Forest Labs FLUX official repository and model license mapping:  
  https://github.com/black-forest-labs/flux
- FLUX.1 [schnell] Apache 2.0 license:  
  https://github.com/black-forest-labs/flux/blob/main/model_licenses/LICENSE-FLUX1-schnell
- Wan 2.1 official repository/license:  
  https://github.com/Wan-Video/Wan2.1
- LTX-2 official repository/license:  
  https://github.com/Lightricks/LTX-2
- MiniMax H3 official model and Community License:  
  https://huggingface.co/MiniMaxAI/MiniMax-H3  
  https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE
- Google Gemini API model documentation:  
  https://ai.google.dev/gemini-api/docs/models
- Anthropic API/model documentation:  
  https://docs.anthropic.com/
- OpenAI model documentation:  
  https://developers.openai.com/api/docs/models

### Object Storage

- MinIO official repository:  
  https://github.com/minio/minio
- MinIO AGPLv3 license:  
  https://github.com/minio/minio/blob/master/LICENSE

---

*End of PRD v3.4.0 - Implementation Ready Engineering Baseline with Empirical LTX-2.5 Hardware Certification.*
