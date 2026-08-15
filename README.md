# Comfy Content Orchestrator

AI-native content-production orchestration for Godzspeed Communications. The platform turns campaign briefs into reviewable storyboard candidates, routes approved scenes into deterministic ComfyUI production workflows, and keeps creative direction, rendering, audit history, and model governance explicit.

## Status

**PRD:** v3.4.0 — Implementation Ready Engineering Baseline with empirical LTX-2.5 hardware certification.

Implementation is beginning with **Sprint 1: Core Runtime, Domain Boundaries & Hardware Certification**. Sprint issues are intentionally bounded so they can be executed independently by the `opsclawd/automation` orchestrator.

## What this system is

The platform uses a split-plane architecture:

- **Hetzner control plane:** PostgreSQL state, Next.js Review Hub, MinIO review media, API/control services.
- **Trinidad render plane:** RTX 4090, ComfyUI headless, model/LoRA vault, render worker, FFmpeg, NVML telemetry.
- **Ottawa review plane:** Creative Director reviews, edits, rerolls, tunes, rejects, and approves scenes over Tailscale.

The product is built around a human-on-the-loop compute gate: cheap storyboard candidates first, expensive production rendering only after scene approval.

## Empirical LTX-2.5 baseline

The Phase 1 LTX baseline has been measured on the target RTX 4090 workstation:

| Property | Measured value |
|---|---:|
| Local LTX-2.5 model-family footprint | ~68.8 GB |
| Certified workload | 720p / 97 frames / ~5 s / 8 DiT steps |
| Peak VRAM | 24,028 MB (~97.8%) |
| Core DiT sampling | ~12 s |
| End-to-end execution | 46 s |
| OOM | None |

The workflow succeeds through ComfyUI DynamicVRAM / workflow-managed offloading. It does **not** keep the entire LTX working set resident in VRAM. Sprint 1 will certify host-RAM usage, repeated FLUX↔LTX transitions, post-unload VRAM reclamation, and the final runner profile.

## Architecture

Clean Architecture and DDD are hard constraints, carried forward from `opsclawd/automation`:

```text
apps/
  control-api/       # Hetzner composition root
  render-worker/     # Trinidad composition root
  web/               # Next.js Review Hub
packages/
  domain/            # pure business model and invariants
  application/       # use cases, orchestration, ports
  infrastructure/    # PostgreSQL, ComfyUI, MinIO, AI APIs, FFmpeg, NVML
  contracts/         # stable API/event schemas
  shared/            # pure cross-cutting primitives
docs/
  adr/
  CONTEXT.md
  prd.md
```

Dependency direction is enforced in CI:

- `domain` → `shared` only
- `application` → `domain`, `contracts`, `shared`; never infrastructure
- `infrastructure` implements application ports; it does not own orchestration policy
- `web` consumes stable contracts/presentation-safe types, not server infrastructure
- cross-layer wiring occurs only in the composition roots
- circular dependencies fail CI

`Scene` is the principal aggregate for creative-review and production lifecycle invariants. Provider adapters execute requests; application orchestration owns routing, retries, fallback, policy, and state progression.

## Core Phase 1 invariants

- One RTX 4090 executes at most one active diffusion generation at a time.
- LTX-2.5 production uses a versioned, empirically certified `RenderProfile`.
- Scene state transitions occur through domain/application behavior, never raw status assignment from routes or persistence adapters.
- Generation manifests and review events are immutable/append-only audit data.
- External cloud processing is subject to client policy and provider allow-lists.
- Model/component license state is a runtime governance input and fails closed when not approved.

## Documentation

- [Product Requirements Document](docs/prd.md)
- [Database Migrations & Operations Runbook](docs/database-migrations.md)
- ADRs will live under `docs/adr/` as implementation decisions are made.
- `docs/CONTEXT.md` will define the project's ubiquitous language and invariants during Sprint 1 bootstrap.

## Automation execution discipline

Sprint issues are written for the AI SDLC orchestrator and should be executed **one issue per Run**.

For every implementation issue:

1. Read `docs/prd.md`, `docs/CONTEXT.md` when present, and relevant ADRs before changing code.
2. Preserve Clean Architecture dependency direction.
3. Do not broaden issue scope to adjacent Sprint work.
4. Add tests that prove the stated invariant or behavior, not merely code coverage.
5. Do not invent benchmark results, workflow hashes, model hashes, or hardware measurements. Persist only observed values.
6. Treat hardware-dependent acceptance criteria as integration/certification work on the Trinidad render host.
7. If implementation requires an architectural decision that contradicts the PRD, stop and surface the conflict rather than silently changing the architecture.

## Target runtime

- Node.js 24 LTS (`Krypton`)
- TypeScript
- pnpm workspace
- PostgreSQL 18.6
- ComfyUI headless
- NVIDIA RTX 4090 24 GB
- Next.js
- MinIO
- Tailscale / WireGuard

## Security boundary

ComfyUI, PostgreSQL, MinIO administration, control APIs, and worker control endpoints are not intended for public WAN exposure. Private service communication is scoped to the Tailscale mesh.

## Optional ComfyUI smoke test

An opt-in smoke test is available for validating live connectivity and execution against a running ComfyUI instance. This test triggers a real GPU render and unloads models upon completion.

Operational constraints:
- Must run only on the authorized Trinidad host with an operator-reviewed API-format workflow.
- It is intentionally absent from CI and generic test runs.
- Does not claim certification or measured performance from this smoke.

Run command:

```bash
COMFYUI_URL=http://127.0.0.1:8188 COMFYUI_WORKFLOW_PATH=./path/to/reviewed-workflow.json pnpm --filter @cco/infrastructure test:comfyui
```

An optional timeout override in milliseconds may be supplied via `COMFYUI_TIMEOUT_MS` (default: `600000` ms):

```bash
COMFYUI_URL=http://127.0.0.1:8188 COMFYUI_WORKFLOW_PATH=./path/to/reviewed-workflow.json COMFYUI_TIMEOUT_MS=600000 pnpm --filter @cco/infrastructure test:comfyui
```

## License note

Foundation-model and infrastructure licenses are operational dependencies. The PRD defines a versioned license registry and fail-closed production routing. License terms must be re-reviewed when model versions, deployment territories, revenue thresholds, or infrastructure distribution models change.
