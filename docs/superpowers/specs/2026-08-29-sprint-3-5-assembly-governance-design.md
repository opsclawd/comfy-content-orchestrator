# Sprint 3.5 — Media Assembly, Audio, Subtitle & AssemblyManifest Contracts

**Date:** 2026-08-29  
**Status:** Approved design  
**PRD reference:** Sprint 3.5 Assembly & Governance, §9.5 FFmpeg Assembly Gate, §9.6 Governance  
**Supersedes:** None  
**Companion:** Sprint 2.5 spec (`docs/superpowers/specs/2026-08-26-sprint-2-5-dispatch-contract-design.md`); Sprint 3 spec (`docs/superpowers/specs/2026-08-27-sprint-3-candidate-generation-dispatch-design.md`).

---

## Purpose

Freeze the application and domain contracts for final audiovisual media assembly before any FFmpeg implementation lands.

Sprint 3.5 consumes generation outputs produced by Sprint 3; it does not redefine the render path. `LTX_25_720P_5S_V1` remains strictly video-only. Voiceover, soundbed, subtitles, and final delivery assembly are distinct assets and stages with their own independent provenance.

The frozen contracts enforce that it is impossible to confuse:
- scene-level audio intent with an LTX render input;
- requested inputs with assets that actually reached the FFmpeg assembly engine;
- transient presigned URLs or local scratch paths with persistent media identity;
- `GenerationManifest` provenance (single video render attempt) with `AssemblyManifest` provenance (multi-stem audiovisual packaging).

---

## What already exists

The codebase prior to Sprint 3.5 provides:

- **GenerationManifest & Single-Shot Video Renders** (`packages/application/src/use-cases/assemble-generation-manifest.ts`): Produces immutable evidence from successful diffusion renders, recording exact model hashes, workflow templates, and output SHA-256 values.
- **Video-Only Render Profile** (`packages/contracts/src/render-profile.ts`): `LTX_25_720P_5S_V1_PROFILE` produces 1280x720 landscape video, with `audioPrompt: null` explicitly declared in `LTX_25_720P_5S_V1_INJECTION_TOPOLOGY`.
- **Media Assembler Port Placeholder** (`packages/application/src/ports/media-assembler-port.ts`): Generic `MediaAssemblerPort<TInput, TOutput>` parameterized to `AssemblySpec` and `AssemblyExecutionResult`.
- **Object Storage & Hashing Ports** (`packages/application/src/ports/object-storage-port.ts`, `packages/application/src/ports/hash-bytes.ts`): Provide abstractions for byte-storage and SHA-256 calculation across layers.
- **License Registry Port** (`packages/application/src/ports/license-registry-repository.ts`): Component-level license resolution interface for governance checks.

---

## Decisions & Anchored Design

### 1. Stable Assembly Contracts

Contracts are partitioned strictly according to repository layering (`packages/contracts` for transport-safe serializable schemas and deeply readonly types, `packages/application` for ports and validation logic):

- **`PersistentMediaRef`** (`packages/contracts/src/persistent-media.ts`):
  ```ts
  interface PersistentMediaRef {
    readonly bucket: string;
    readonly key: string;
    readonly sha256: string; // 64-character lowercase hex hash
    readonly contentType: string;
  }
  ```
  *Rule:* Presigned URLs and transient filesystem paths are absent from persistent media identity schemas.

- **`VideoStemRef` & `ExecutedVideoStemRef`** (`packages/contracts/src/video-stem.ts`):
  ```ts
  interface VideoStemRef {
    readonly sceneId: string;
    readonly generationManifestId: string;
    readonly order: number; // Contiguous 0-indexed integer
    readonly media: PersistentMediaRef;
    readonly expectedDurationMs: number; // Positive integer
  }

  interface ExecutedVideoStemRef {
    readonly sceneId: string;
    readonly generationManifestId: string;
    readonly order: number; // Contiguous 0-indexed integer
    readonly media: PersistentMediaRef;
    readonly actualDurationMs: number; // Positive integer
  }
  ```

- **`AudioAssetKind` & `AudioAssetSource`** (`packages/contracts/src/audio-asset.ts`):
  ```ts
  type AudioAssetKind = "voiceover" | "soundbed";

  type AudioAssetSource =
    | { readonly kind: "local" }
    | { readonly kind: "uploaded" }
    | { readonly kind: "provider"; readonly providerId: string; readonly modelId?: string };
  ```
  *Rule:* Audio provenance distinguishes local, uploaded, and provider assets without importing third-party provider SDK types into the core contracts.

- **Role-Specific Audio Asset Refs** (`packages/contracts/src/audio-asset.ts`):
  ```ts
  interface VoiceoverAssetRef {
    readonly assetId: string;
    readonly kind: "voiceover";
    readonly media: PersistentMediaRef;
    readonly source: AudioAssetSource;
    readonly startMs: number; // Non-negative integer
    readonly expectedDurationMs: number; // Positive integer
  }

  interface SoundbedAssetRef {
    readonly assetId: string;
    readonly kind: "soundbed";
    readonly media: PersistentMediaRef;
    readonly source: AudioAssetSource;
    readonly startMs: number; // Non-negative integer
    readonly expectedDurationMs: number; // Positive integer
  }

  type AudioAssetRef = VoiceoverAssetRef | SoundbedAssetRef;

  interface ExecutedVoiceoverRef {
    readonly assetId: string;
    readonly kind: "voiceover";
    readonly media: PersistentMediaRef;
    readonly source: AudioAssetSource;
    readonly startMs: number;
    readonly actualDurationMs: number;
  }

  interface ExecutedSoundbedRef {
    readonly assetId: string;
    readonly kind: "soundbed";
    readonly media: PersistentMediaRef;
    readonly source: AudioAssetSource;
    readonly startMs: number;
    readonly actualDurationMs: number;
  }

  type ExecutedAudioAssetRef = ExecutedVoiceoverRef | ExecutedSoundbedRef;
  ```

- **`SubtitleCue`** (`packages/contracts/src/subtitle-cue.ts`):
  ```ts
  interface SubtitleCue {
    readonly startMs: number; // Non-negative integer
    readonly endMs: number; // Strictly greater than startMs
    readonly text: string;
  }
  ```
  Includes `validateSubtitleTimeline(cues, totalDurationMs)` to reject negative offsets, `endMs <= startMs`, and cues overflowing the timeline, as well as deterministic synchronous hashing via `hashSubtitleCues(cues)` and explicit constant `EMPTY_SUBTITLE_CUES_SHA256` / `NO_SUBTITLE_CUES_SHA256` for empty or omitted cue payloads. Both `AssemblyExecutionResultSchema` and `AssemblyManifestSchema` bind `subtitleCuesSha256` to the deterministic canonical hash of `subtitleCues` (matching `NO_SUBTITLE_CUES_SHA256` when cues are empty or omitted).

### 2. AssemblySpec (Application Input Model)

`AssemblySpec` (`packages/application/src/ports/assembly-spec.ts` and `packages/contracts/src/assembly-spec.ts`) models **resolved assets** ready for assembly:

- Ordered video stems (`0..n-1` contiguous without duplicates or gaps);
- Optional voiceover asset (`VoiceoverAssetRef`);
- Optional stereo soundbed asset (`SoundbedAssetRef`);
- Subtitle cues (`readonly SubtitleCue[]`);
- Assembly profile identity (`AssemblyProfileIdentity`);
- Authoritative `expectedTotalDurationMs` (verified against stem durations and audio/subtitle bounds).

*Rule:* No external provider calls or prompt synthesis occur in this contract. Provider-generated audio exists only as an immutable `AudioAssetRef` prior to assembly.

### 3. Vertical Delivery Profile: `VERTICAL_REEL_1080X1920_V1`

The Phase 1 observable delivery media contract is frozen as `VERTICAL_REEL_1080X1920_V1_PROFILE` (`packages/contracts/src/assembly-profile.ts`):

- **Key:** `VERTICAL_REEL_1080X1920_V1`
- **Version:** `1` (literal)
- **Container:** MP4
- **Width:** 1080
- **Height:** 1920
- **Target Frame Rate:** 30 fps
- **Video Codec Family:** H.264 compatible
- **Pixel Format Family:** yuv420p compatible
- **Audio Codec Family:** AAC compatible stereo (2 channels) at 48,000 Hz (48 kHz)
- **Layout Mode:** `fit_blurred_fill`

### 4. Landscape-to-Vertical Normalization Policy

The Phase 1 LTX profile generates 1280x720 landscape video, while PRD §9.5 mandates a 1080x1920 vertical MP4.

*Policy:* Do **not** silently center-crop the landscape frame. The normalization policy is explicitly modeled as `fit_blurred_fill`:
1. Background layer scales the source video to cover 1080x1920, center-crops, and applies Gaussian blur.
2. Foreground layer preserves the complete source frame aspect ratio, scales to fit within 1080 width, and is vertically centered.
3. Future native-vertical profiles will declare `direct_fit` without blurred fill.

The layout mode is explicitly recorded in `AssemblyProfile` and validated in `AssemblyManifest`. For `VERTICAL_REEL_1080X1920_V1`, `fit_blurred_fill` is mandatory; `direct_fit` is rejected.

### 5. Executed Input Contract & `AssemblyExecutionResult`

`AssemblyExecutionResult` (`packages/contracts/src/assembly-execution.ts`) defines what FFmpeg actually executed and returned to `MediaAssemblerPort`:

```ts
interface AssemblyExecutionResult {
  readonly assemblyId: string;
  readonly campaignId: string;
  readonly assemblyProfile: AssemblyProfileIdentity;
  readonly executedInputs: {
    readonly videoStems: readonly ExecutedVideoStemRef[];
    readonly voiceover?: ExecutedVoiceoverRef;
    readonly soundbed?: ExecutedSoundbedRef;
  };
  readonly timeline: {
    readonly totalDurationMs: number;
    readonly stemDurationsMs: readonly number[];
  };
  readonly layout: {
    readonly mode: AssemblyLayoutMode;
  };
  readonly subtitleCuesSha256: string;
  readonly subtitleCues?: readonly SubtitleCue[];
  readonly ffmpeg: {
    readonly executable: string;
    readonly version: string;
    readonly buildInfo: string;
  };
  readonly commandFingerprint: string;
  readonly output: {
    readonly media: PersistentMediaRef;
    readonly durationMs: number;
    readonly width: number;
    readonly height: number;
  };
}
```

### 6. AssemblyManifest Contract

`AssemblyManifest` (`packages/contracts/src/assembly-manifest.ts`) defines the immutable record of completed media assembly:

```ts
interface AssemblyManifest {
  readonly assemblyId: string;
  readonly createdAt: string; // ISO 8601 UTC
  readonly campaignId: string;
  readonly assemblyProfile: AssemblyProfileIdentity;
  readonly generationManifestIds: readonly string[]; // Ordered list matching inputs.videoStems
  readonly inputs: {
    readonly videoStems: readonly ExecutedVideoStemRef[];
    readonly voiceover?: ExecutedVoiceoverRef;
    readonly soundbed?: ExecutedSoundbedRef;
  };
  readonly subtitleCuesSha256: string; // SHA-256 of canonical cue payload
  readonly subtitleCues?: readonly SubtitleCue[];
  readonly layout: {
    readonly mode: AssemblyLayoutMode;
  };
  readonly ffmpeg: {
    readonly executable: string;
    readonly version: string;
    readonly buildInfo: string;
  };
  readonly commandFingerprint: string; // SHA-256 of normalized filter-graph/command
  readonly output: {
    readonly media: PersistentMediaRef;
    readonly durationMs: number;
    readonly width: number;
    readonly height: number;
  };
  readonly governanceDecisionId: string;
}
```

*Rule:* Manifest persistence is an immutable JSON document saved directly beside the delivery media in the delivery object store. No secondary relational database table is introduced.

### 7. Provenance Invariant

Assembly provenance describes **what FFmpeg actually consumed**.

It is forbidden to reconstruct input hashes from a stale request object after assembly if the staged or executed asset set differed. Manifest construction is performed via `createAssemblyManifest({ executionResult, governanceDecisionId })`, which consumes `AssemblyExecutionResult` rather than `AssemblySpec`, and verifies that `subtitleCuesSha256` strictly matches the canonical hash of `executionResult.subtitleCues` (or `NO_SUBTITLE_CUES_SHA256` when omitted/empty).

---

## Explicit Traps / Non-goals

- **DO NOT** add audio nodes to `LTX_25_720P_5S_V1`.
- **DO NOT** make `audioPrompt` an assembly input; assembly consumes audio assets.
- **DO NOT** call ElevenLabs, Azure, or OpenAI SDKs in contract definitions.
- **DO NOT** store presigned URLs in assembly contracts or manifests.
- **DO NOT** encode filesystem paths as persistent media identity.
- **DO NOT** invent a synchronous Review API -> FFmpeg route.
- **DO NOT** make the UI responsible for FFmpeg filter construction.
- **DO NOT** silently crop landscape LTX stems to vertical without declaring the layout mode.

---

## Sprint 3.5 Issue Decomposition (Handoff to Issues 2–5)

1. **Issue 1 (#121 — This Issue): Freeze assembly, audio, subtitle & AssemblyManifest contracts**
   - Types and schemas in `@cco/contracts` and `@cco/application`.
   - Unit tests covering all validation rules, ordering, hashes, profile constants, and deep immutability.
   - Frozen design specification.
2. **Issue 2: FFmpeg adapter & MediaAssemblerPort implementation**
   - Concrete adapter implementing `MediaAssemblerPort<AssemblySpec, AssemblyExecutionResult>`.
   - Filter-graph generation for `fit_blurred_fill` (scale cover + blur + scale fit overlay) and AAC stereo audio mixing.
   - Command fingerprinting excluding secrets and temporary paths.
3. **Issue 3: Local/uploaded audio asset fixture loader & subtitle cue parser**
   - Staging local and uploaded audio fixtures into `PersistentMediaRef`s.
   - Subtitle cue parsing and canonical SHA-256 hashing.
4. **Issue 4: Governance routing guard & license verification**
   - Routing guard validating license terms across video stems, VO, and soundbed before assembly.
   - Generation of immutable `governanceDecisionId`.
5. **Issue 5: End-to-end assembly pipeline & delivery persistence**
   - Assembly execution pipeline writing final MP4 and `AssemblyManifest` JSON to delivery storage.
   - End-to-end verification against the §9.5 FFmpeg Assembly Gate.
