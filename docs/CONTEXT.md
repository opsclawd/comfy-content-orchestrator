# Context & Ubiquitous Language

## Ubiquitous Language (Domain Concepts)

- **Campaign:** Campaign identity and high-level completion/progress rules.
- **Scene:** SceneSpec, references, LoRA configuration, assigned engine, approval validity, and canonical lifecycle transitions.
- **SceneSpec:** Structured creative specification containing the script, generation prompts, reference bindings, timing, and engine parameters for a scene revision.
- **RenderJob:** Durable production work, retry limits, worker ownership, and completion semantics.
- **RenderWorker:** Dedicated execution node / host process that holds GPU capacity, claims render leases, and runs diffusion/media generation workloads.
- **RenderLease:** Exclusive GPU-worker execution right for one diffusion job.
- **ReferenceAsset:** Continuity/provenance identity.
- **GenerationManifest:** Immutable evidence from a successful render; not a mutable aggregate.
- **ReviewEvent:** Append-only audit event.
- **RenderProfile:** Versioned certified execution configuration for an engine/workflow/hardware envelope.

## Canonical Scene Lifecycle States

- **DRAFT_PENDING**
- **GENERATING_CANDIDATES**
- **DIRECTOR_REVIEW**
- **APPROVED**
- **QUEUED**
- **RENDERING**
- **QA**
- **COMPLETED**
- **FAILED**
- **CANCELLED**
