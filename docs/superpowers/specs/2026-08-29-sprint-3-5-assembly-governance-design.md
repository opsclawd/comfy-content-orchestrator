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
    readonly startMs: number; // Requested start offset in ms (non-negative integer)
    readonly actualDurationMs: number; // Measured raw source asset duration in ms (positive integer)
    readonly effectiveStartMs: number; // Output timeline position in ms where audio playback begins (non-negative integer)
    readonly effectiveDurationMs: number; // Total duration of executed audio stream on timeline (positive integer)
    readonly trimStartMs: number; // Source start offset in ms to begin playback (0 <= trimStartMs < trimEndMs)
    readonly trimEndMs?: number; // Optional source end offset in ms (trimStartMs < trimEndMs <= actualDurationMs; defaults to actualDurationMs)
    readonly loopCount: number; // Number of full repeat iterations of the consumed source slice (integer >= 0)
    readonly partialLoopDurationMs?: number; // Optional trailing partial loop duration in ms (0 <= partialLoopDurationMs < sliceDurationMs)
    readonly padLeadingMs: number; // Silence duration in ms prepended before audio begins (non-negative integer)
    readonly padTrailingMs: number; // Silence duration in ms appended after audio/loops finish (non-negative integer)
    readonly gainDb: number; // Net normalization gain adjustment in decibels (finite number)
  }

  interface ExecutedSoundbedRef {
    readonly assetId: string;
    readonly kind: "soundbed";
    readonly media: PersistentMediaRef;
    readonly source: AudioAssetSource;
    readonly startMs: number; // Requested start offset in ms (non-negative integer)
    readonly actualDurationMs: number; // Measured raw source asset duration in ms (positive integer)
    readonly effectiveStartMs: number; // Output timeline position in ms where audio playback begins (non-negative integer)
    readonly effectiveDurationMs: number; // Total duration of executed audio stream on timeline (positive integer)
    readonly trimStartMs: number; // Source start offset in ms to begin playback (0 <= trimStartMs < trimEndMs)
    readonly trimEndMs?: number; // Optional source end offset in ms (trimStartMs < trimEndMs <= actualDurationMs; defaults to actualDurationMs)
    readonly loopCount: number; // Number of full repeat iterations of the consumed source slice (integer >= 0)
    readonly partialLoopDurationMs?: number; // Optional trailing partial loop duration in ms (0 <= partialLoopDurationMs < sliceDurationMs)
    readonly padLeadingMs: number; // Silence duration in ms prepended before audio begins (non-negative integer)
    readonly padTrailingMs: number; // Silence duration in ms appended after audio/loops finish (non-negative integer)
    readonly gainDb: number; // Base normalization gain adjustment in decibels (finite number)
    readonly duckingDb: number; // Sidechain ducking attenuation in decibels applied during VO (non-positive finite number <= 0 dB, 0 = no ducking)
  }

  type ExecutedAudioAssetRef = ExecutedVoiceoverRef | ExecutedSoundbedRef;
  ```

  **Audio Transformation & Normalization/Mix Semantics:**
  Every executed audio transformation decision is explicitly recorded without schema defaults:
  - `actualDurationMs`: Measured source audio asset duration in milliseconds before any trimming, looping, or padding.
  - `trimStartMs`: Offset in milliseconds from the start of the source audio asset to begin playback (`0 <= trimStartMs < trimEndMs`).
  - `trimEndMs`: Optional offset in milliseconds marking the end of the source slice (`trimStartMs < trimEndMs <= actualDurationMs`, default `actualDurationMs`).
  - `loopCount`: Number of complete full iterations of the source slice (`sliceDurationMs = (trimEndMs ?? actualDurationMs) - trimStartMs`).
  - `partialLoopDurationMs`: Optional duration of any final partial iteration (`0 <= partialLoopDurationMs < sliceDurationMs`, default 0).
  - `padLeadingMs` / `padTrailingMs`: Milliseconds of silence prepended / appended around the audio stream.
  - `gainDb`: Applied gain adjustment in decibels for normalization and level balancing.
  - `duckingDb` (soundbed only): Sidechain attenuation in decibels applied to the soundbed track while voiceover audio is active (non-positive number $\le 0\text{ dB}$; `0` if no ducking is applied).
  - **Duration Equation:** `effectiveDurationMs === padLeadingMs + (sliceDurationMs * loopCount + partialLoopDurationMs) + padTrailingMs`. Contradictory values fail validation.

- **`SubtitleCue`** (`packages/contracts/src/subtitle-cue.ts`):
  ```ts
  interface SubtitleCue {
    readonly startMs: number; // Non-negative integer
    readonly endMs: number; // Strictly greater than startMs
    readonly text: string;
  }
  ```
  Includes `validateSubtitleTimeline(cues, totalDurationMs)` to reject negative offsets, `endMs <= startMs`, and cues overflowing the timeline, as well as deterministic synchronous hashing via `hashSubtitleCues(cues)` and explicit constant `EMPTY_SUBTITLE_CUES_SHA256` / `NO_SUBTITLE_CUES_SHA256` for empty or omitted cue payloads. Both `AssemblyExecutionResultSchema` and `AssemblyManifestSchema` bind `subtitleCuesSha256` to the deterministic canonical hash of `subtitleCues` (matching `NO_SUBTITLE_CUES_SHA256` when cues are empty or omitted). Whenever `subtitleCues` are present (`subtitleCues.length > 0`), `subtitleStyleProfile` is mandatory.

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

The layout mode is explicitly recorded in `AssemblyProfile` and validated in `AssemblyManifest` and `AssemblyExecutionResult`. For `VERTICAL_REEL_1080X1920_V1`, `fit_blurred_fill` is mandatory; `direct_fit` is rejected. Output dimensions (1080x1920), content type (`video/mp4`), and measured frame rate (30 fps) are also strictly validated against the profile.

### 5. Executed Input Contract, Encoding & Stream Provenance (`AssemblyExecutionResult`)

`AssemblyExecutionResult` (`packages/contracts/src/assembly-execution.ts`) defines what FFmpeg actually executed and returned to `MediaAssemblerPort`:

```ts
interface VideoEncodingExecution {
  readonly codec: string; // e.g. "libx264"
  readonly pixelFormat: string; // e.g. "yuv420p"
  readonly crf?: number;
  readonly preset?: string;
}

interface AudioEncodingExecution {
  readonly codec: string; // e.g. "aac"
  readonly bitrateKbps: number; // e.g. 192
  readonly sampleRateHz: number; // e.g. 48000
  readonly channels: number; // e.g. 2
}

interface AssemblyEncodingExecution {
  readonly video: VideoEncodingExecution;
  readonly audio?: AudioEncodingExecution;
}

interface MeasuredVideoStream {
  readonly codecName: string; // e.g. "h264"
  readonly pixelFormat: string; // e.g. "yuv420p"
  readonly width: number; // e.g. 1080
  readonly height: number; // e.g. 1920
  readonly frameRate: number; // e.g. 30
  readonly durationMs: number;
}

interface MeasuredAudioStream {
  readonly codecName: string; // e.g. "aac"
  readonly sampleRateHz: number; // e.g. 48000
  readonly channels: number; // e.g. 2
  readonly durationMs: number;
  readonly bitrateKbps?: number;
}

interface MeasuredOutputStreams {
  readonly video: MeasuredVideoStream;
  readonly audio?: MeasuredAudioStream;
}

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
  readonly subtitleStyleProfile?: string;
  readonly ffmpeg: {
    readonly executable: string;
    readonly version: string;
    readonly buildInfo: string;
  };
  readonly commandFingerprint: string;
  readonly encoding: AssemblyEncodingExecution;
  readonly streams: MeasuredOutputStreams;
  readonly output: {
    readonly media: PersistentMediaRef;
    readonly durationMs: number;
    readonly width: number;
    readonly height: number;
  };
  readonly measuredFrameRate: number;
  readonly executionDurationMs: number;
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
  readonly timeline: {
    readonly totalDurationMs: number;
    readonly stemDurationsMs: readonly number[];
  };
  readonly subtitleCuesSha256: string; // SHA-256 of canonical cue payload
  readonly subtitleCues?: readonly SubtitleCue[];
  readonly subtitleStyleProfile?: string;
  readonly layout: {
    readonly mode: AssemblyLayoutMode;
  };
  readonly ffmpeg: {
    readonly executable: string;
    readonly version: string;
    readonly buildInfo: string;
  };
  readonly commandFingerprint: string; // SHA-256 of normalized filter-graph/command
  readonly encoding: AssemblyEncodingExecution;
  readonly streams: MeasuredOutputStreams;
  readonly output: {
    readonly media: PersistentMediaRef;
    readonly durationMs: number;
    readonly width: number;
    readonly height: number;
  };
  readonly measuredFrameRate: number;
  readonly executionDurationMs: number;
  readonly governanceDecisionId: string;
}
```

*Rule:* Manifest persistence is an immutable JSON document saved directly beside the delivery media in the delivery object store. No secondary relational database table is introduced.

### 7. Provenance Invariant

Assembly provenance describes **what FFmpeg actually consumed**.

It is forbidden to reconstruct input hashes from a stale request object after assembly if the staged or executed asset set differed. Manifest construction is performed via `createAssemblyManifest({ executionResult, governanceDecisionId })`, which consumes `AssemblyExecutionResult` rather than `AssemblySpec`, copies timeline decisions, encoding parameters, and measured stream results directly without re-derivation, and verifies that `subtitleCuesSha256` strictly matches the canonical hash of `executionResult.subtitleCues` (or `NO_SUBTITLE_CUES_SHA256` when omitted/empty).

### 7a. Executed-state Cross-Validation & Invariants

Both `AssemblyExecutionResultSchema` and `AssemblyManifestSchema` enforce identical executed-state invariants via `validateExecutedAssemblyInvariants()` (`packages/contracts/src/assembly-execution-invariants.ts`):

1. **Stem Duration Equality:** For every executed stem `s` in `videoStems`, `timeline.stemDurationsMs[s.order] === s.actualDurationMs`. Contradictory stem durations fail validation.
2. **Phase 1 Composition Rule:** For simple concatenation with no modeled overlap/transition, `timeline.totalDurationMs === sum(timeline.stemDurationsMs)`.
3. **Output Duration Tolerance:** `Math.abs(output.durationMs - timeline.totalDurationMs) <= ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS` where `ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS = 250`. This explicit 250ms tolerance accommodates container/codec timing variations (e.g. keyframe rounding at 30fps) without masking composition errors.
4. **Subtitle Timeline Bounds & Style Profile Requirement:** Subtitle cues must remain valid against the executed timeline (`validateSubtitleTimeline(cues, timeline.totalDurationMs)`). When subtitle cues are present (`subtitleCues.length > 0`), `subtitleStyleProfile` is required.
5. **Executed Audio Transformation Invariants:** For any executed voiceover or soundbed:
   - `trimStartMs < trimEndMs <= actualDurationMs`: Playback start offset must be strictly within slice and source bounds.
   - `partialLoopDurationMs < sliceDurationMs`: Partial loop duration must be strictly less than the consumed slice duration.
   - `effectiveDurationMs === padLeadingMs + (sliceDurationMs * loopCount + partialLoopDurationMs) + padTrailingMs`: Executed duration must strictly equal the deterministic result of slice, loop, and pad decisions.
   - `effectiveStartMs + effectiveDurationMs <= timeline.totalDurationMs + ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS`: Audio track must not overflow the final executed timeline.
   - `duckingDb <= 0`: Soundbed ducking attenuation must be non-positive.
6. **Measured Streams Cross-Validation:** Measured video and audio stream durations must match the timeline within tolerance ($\le 250\text{ ms}$), video dimensions must match output width/height, and measured frame rate must match `measuredFrameRate`.


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
4. **Issue 4 (#124 — Implemented): Versioned component-license registry & fail-closed routing guard**
   - Machine-readable JSON component-license registry schema (`ComponentLicenseRegistrySchema`) versioned in `config/component-license-registry.json`.
   - Pure routing evaluator (`evaluateLicenseRouting`) enforcing §9.6 policy statuses: `approved` is dispatchable; `restricted`, `review_required`, `blocked`, and unregistered components fail closed.
   - Application port (`LicenseRegistryPort`) and use case (`EnforceLicenseRouting`) throwing structured `LicenseRoutingError`.
   - Infrastructure loader (`loadComponentLicenseRegistry`) with duplicate key detection and freeze immutability.
   - Generation dispatch integration in `ExecuteProfileRenderUseCase` and `render` CLI (zero ComfyUI queue / zero GPU lease on denial).
   - Assembly pipeline integration in `AssembleDeliveryReel` (zero FFmpeg spawn / zero storage put on denial, embedding `governanceDecisionId` in `AssemblyManifest`).
   - Render worker retry semantics: `LicenseRoutingError` falls through to permanent `failWithRetry` (never deferred).
5. **Issue 5: End-to-end assembly pipeline & delivery persistence**
   - Assembly execution pipeline writing final MP4 and `AssemblyManifest` JSON to delivery storage.
   - End-to-end verification against the §9.5 FFmpeg Assembly Gate.
