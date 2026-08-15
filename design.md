# Design Document: Application Ports, Scene Use Cases, and RenderProfile Contracts

## 1. The Problem Being Solved and Why It Matters

The domain layer (from Sprint 1, Issue 2) has successfully defined the pure business rules, entities, and state transitions for the Godzspeed Content Orchestration Platform (e.g., the `Scene` aggregate). However, there is no connective tissue to wire these pure domain rules to the outside world—such as databases, headless ComfyUI runners, the Next.js Review Hub, and VRAM telemetry.

We need to define the **application layer**, which provides the use cases (the system's verbs) that load aggregates, invoke their business logic, and save the state transactionally. Without an application layer leveraging ports (inversion of control), domain logic would leak into infrastructure handlers, violating the Clean Architecture requirement. Additionally, we need a concrete representation of the `RenderProfile`—the empirically certified hardware/workflow envelope—so the orchestration engine can safely dispatch tasks to the RTX 4090 without leaking ComfyUI details into the pure domain.

## 2. Proposed Approach with Rationale

Following Clean Architecture and DDD principles, the application layer will orchestrate the flow of data to and from the domain without knowing how data is persisted or how external services operate.

### Application Ports
Create TypeScript interfaces inside `packages/application/src/ports/`.
- **Repositories:** `SceneRepository`, `CampaignRepository`, `RenderJobRepository`, `ManifestRepository`, `ReviewEventStore`, `LicenseRegistryRepository`. These will load and persist aggregates.
- **Integrations:** `RenderEnginePort` (for queuing renders and unloading models via headless ComfyUI), `GpuTelemetryPort` (for VRAM checks via NVML).
- **Placeholders:** `PlannerPort`, `CandidateRankerPort`, `VoiceSynthesisPort`, `MediaAssemblerPort`, `ObjectStoragePort`.
- **Unit of Work:** A `UnitOfWork` interface to execute functions within a transactional boundary. This is crucial for coordinating `Scene` state updates with `ReviewEvent` appends.

### Application Use Cases
Implement service classes or functions in `packages/application/src/use-cases/`.
Each use case will follow a strict pattern:
1. Accept input DTOs (primitive types, not domain entities).
2. Start a transaction via `UnitOfWork` (for state-mutating operations).
3. Load the `Scene` aggregate from the `SceneRepository`.
4. Call the corresponding domain transition method (e.g., `scene.approve(...)`, `scene.requestReroll()`, `scene.updatePrompt(...)`).
5. For review-related actions, create and append a `ReviewEvent` to the `ReviewEventStore`.
6. Save the mutated `Scene` back to the `SceneRepository`.
7. Commit the transaction and return an output DTO or void result.

### RenderProfile Contract
Define the `RenderProfile` data structure in `packages/contracts/src/render-profile.ts` so it is accessible to both the orchestrator and the execution workers, without polluting the core domain. This will capture the `LTX_25_720P_5S_V1` profile empirically tested on the RTX 4090.

### Shared Transport Schemas
Place DTOs, API payloads, and `RenderProfile` in `packages/contracts/src/` to ensure safe IPC/HTTP boundary serialization without leaking `infrastructure` details or internal `domain` entity classes across process boundaries.

## 3. Key Design Decisions and Trade-offs Considered

**Decision 1: UnitOfWork Interface vs. Implicit Transactions**
*Trade-off:* Relying on implicit database transactions or passing a PostgreSQL client directly into the application layer would violate the `application` -> `infrastructure` dependency rule.
*Decision:* Define an abstract `UnitOfWork` port. Application use cases will wrap operations in `uow.execute(async (ctx) => { ... })`, keeping PostgreSQL semantics strictly in the infrastructure layer while guaranteeing that `Scene` mutations and `ReviewEvent` writes remain atomic.

**Decision 2: Location of RenderProfile**
*Trade-off:* Defining `RenderProfile` in the domain layer elevates it to a core business concept, but it represents low-level execution configuration that is heavily tied to hardware envelopes and needs to be shared across process boundaries.
*Decision:* Place `RenderProfile` in `packages/contracts/`. It acts as a stable transport contract for the runner envelope, isolating the pure domain from ComfyUI/LTX-specific runtime metadata.

**Decision 3: Fakes for Application Tests**
*Trade-off:* Writing robust tests for use cases requires either heavy mocking (e.g., Jest/Vitest `vi.mock`) or stateful fakes.
*Decision:* We will implement in-memory repository and UoW fakes in an application test support folder. This ensures tests are fast, deterministic, and verify the correct orchestration of domain state transitions without relying on a real database or infrastructure adapter.

## 4. Assumptions Made

- The existing `Scene` domain entity (`packages/domain/src/scene.ts`) provides all necessary pure transition methods (`approve`, `queueForProduction`, `startRendering`, `submitForQA`, etc.), and no further domain invariant changes are required.
- The `UnitOfWork` pattern can effectively inject the necessary repository instances (or transaction context) to the application services without exposing the underlying ORM or SQL client.
- `packages/contracts` does not yet exist or requires scaffolding. We will set it up as a pure TypeScript package that exports interfaces.
- The Next.js Review Hub will eventually consume the definitions in `packages/contracts`, so these contracts must remain pure interfaces/types (containing no Node.js-specific imports or business logic).

## 5. What is in Scope

- Defining interfaces for `RenderEnginePort`, `GpuTelemetryPort`, `SceneRepository`, `CampaignRepository`, `RenderJobRepository`, `ManifestRepository`, `ReviewEventStore`, `LicenseRegistryRepository`, and `UnitOfWork` in `packages/application/src/ports/`.
- Defining placeholder interfaces for `PlannerPort`, `CandidateRankerPort`, `VoiceSynthesisPort`, `MediaAssemblerPort`, and `ObjectStoragePort`.
- Implementing the explicit Scene transition application use cases:
  - approve Scene
  - request reroll / return to candidate generation
  - mutate SceneSpec/configuration with approval invalidation
  - queue approved Scene for production
  - mark rendering started
  - submit render for QA
  - QA approve/reject
  - fail/cancel
- Appending review events transactionally during review-action use cases.
- Defining the `RenderProfile` data structure and static schema validation logic in `packages/contracts/`.
- Writing unit tests for the application use cases using in-memory fakes.

## 6. What is Explicitly Out of Scope

- Implementing concrete infrastructure adapters (i.e., no actual PostgreSQL queries, ComfyUI WebSocket/REST clients, MinIO SDK usage, or Tailscale code).
- Implementing provider fallback or retry routing policies (this is slated for later orchestration sprint work).
- Modifying the existing pure `domain` rules.
- Executing actual diffusion benchmarks (the LTX-2.5 benchmark values from the PRD are used exactly as written).

## 7. Risks or Concerns Identified from Code Analysis

- **Transactional Consistency across Ports:** The `UnitOfWork` must correctly coordinate `SceneRepository` and `ReviewEventStore`. The application layer must be cautious not to trigger external side-effects (like calling `RenderEnginePort`) *inside* the UoW transaction block, as that could block the transaction or leave it hanging if the external call fails.
- **Dependency Cruiser Drift:** Introducing `packages/contracts` means we must ensure that `application` and `infrastructure` depend on it properly without creating circular dependencies. The `.dependency-cruiser.cjs` rules and `pnpm-workspace.yaml` will govern this.
- **ComfyUI Abstraction Leak:** Keeping `RenderEnginePort` sufficiently abstract will be difficult, as it needs to handle model unloading and queue execution. Care must be taken not to expose ComfyUI node graphs or raw JSON structures directly in the application use cases, relying instead on the abstract `RenderProfile` and `Scene` aggregate state.
