import { createHash } from "node:crypto";
import {
  AssemblyManifestSchema,
  computeAssemblyId,
  createAssemblyManifest,
  type AssemblyExecutionResult,
  type AssemblyManifest,
  type AssemblySpec,
  type ComponentRef
} from "@cco/contracts";
import { validateAssemblySpec, AssemblySpecValidationError } from "../ports/assembly-spec.js";
import type { MediaAssemblerPort } from "../ports/media-assembler-port.js";
import { type ObjectStoragePort, ObjectAlreadyExistsError } from "../ports/object-storage-port.js";
import type {
  GenerationManifestRepository,
  GenerationManifestComponentIdentity
} from "../ports/generation-manifest-repository.js";
import type { EnforceLicenseRouting } from "./enforce-license-routing.js";
import { BUCKETS } from "@cco/shared";

export interface AssemblyManifestPublicationErrorContext {
  readonly executionResult: AssemblyExecutionResult;
  readonly manifest: AssemblyManifest;
  readonly cause?: Error | undefined;
}

export class AssemblyManifestPublicationError extends Error {
  override readonly name = "AssemblyManifestPublicationError";
  readonly executionResult: AssemblyExecutionResult;
  readonly manifest: AssemblyManifest;

  constructor(
    message: string,
    context: AssemblyManifestPublicationErrorContext,
    options?: ErrorOptions
  ) {
    super(message, options ?? (context.cause ? { cause: context.cause } : undefined));
    this.executionResult = context.executionResult;
    this.manifest = context.manifest;
  }
}

export class AssemblyProvenanceConflictError extends Error {
  override readonly name = "AssemblyProvenanceConflictError";
  readonly assemblyId: string;
  readonly existingManifest: AssemblyManifest;

  constructor(assemblyId: string, existingManifest: AssemblyManifest, options?: ErrorOptions) {
    super(
      `Assembly manifest for identity "${assemblyId}" already exists with conflicting provenance`,
      options
    );
    this.assemblyId = assemblyId;
    this.existingManifest = existingManifest;
  }
}

export interface AssembleDeliveryReelDependencies {
  readonly mediaAssembler: MediaAssemblerPort;
  readonly objectStorage: ObjectStoragePort;
  readonly enforceLicenseRouting: EnforceLicenseRouting;
  /**
   * Resolves each video stem's generationManifestId to the component
   * identity (render profile) that produced it, so the license guard can
   * evaluate generation-time provenance, not just assembly-time inputs.
   * Required, not optional: making this skippable would reproduce the
   * exact fail-open gap this guard exists to close — a composition root
   * that forgets to wire it up must not silently bypass the check.
   */
  readonly generationManifestRepository: GenerationManifestRepository;
  /**
   * The assembler's live-detected runtime dependencies (e.g. the actual
   * FFmpeg build), resolved once by the caller — typically via
   * `mediaAssembler.getRuntimeComponents()` at composition-root startup —
   * and injected here as an already-known value.
   *
   * This must NOT be resolved per-request inside assemble(): a denied
   * assembly is required to produce zero calls into the media assembler,
   * and probing FFmpeg's version (a real process spawn) before the license
   * guard runs would violate that even though it's a lighter operation
   * than a full encode. Resolving it once, ahead of any specific request,
   * keeps the guard's decision the very first thing that happens on the
   * assembler's behalf for a given request.
   *
   * Required, not optional: a composition root that forgets to resolve
   * and inject this must not silently fall back to an empty list, which
   * would let the guard evaluate assembly without ever having asked what
   * runtime actually produced the output.
   */
  readonly runtimeComponents: readonly ComponentRef[];
}

export interface AssembleDeliveryReelParams {
  readonly spec: AssemblySpec;
  readonly requiredComponents?: readonly ComponentRef[] | undefined;
}

export class AssembleDeliveryReel {
  constructor(private readonly deps: AssembleDeliveryReelDependencies) {}

  async assemble(params: AssembleDeliveryReelParams): Promise<{
    readonly manifest: AssemblyManifest;
    readonly executionResult: AssemblyExecutionResult;
  }> {
    const { spec } = params;

    // Step 0: Extract provider-originated audio components from AssemblySpec if present
    const specComponents: ComponentRef[] = [];
    if (spec.voiceover?.source.kind === "provider") {
      specComponents.push({
        componentId: spec.voiceover.source.providerId,
        componentType: "provider",
        versionOrRevision: spec.voiceover.source.modelId ?? "1"
      });
    }
    if (spec.soundbed?.source.kind === "provider") {
      specComponents.push({
        componentId: spec.soundbed.source.providerId,
        componentType: "provider",
        versionOrRevision: spec.soundbed.source.modelId ?? "1"
      });
    }

    // Resolve each video stem's generationManifestId to the component
    // (render profile) that actually produced it — the same
    // (componentId, versionOrRevision) pair execute-profile-render.ts
    // already checks at generation time. A missing or malformed manifest
    // must fail closed, not be silently skipped: substitute a component
    // reference that cannot match any real registry entry, so the existing
    // evaluator denies it as "unknown_component" via its normal path
    // rather than needing a separate error type here.
    const resolvedIdentities = new Map<string, GenerationManifestComponentIdentity | undefined>();
    const generationComponents: ComponentRef[] = await Promise.all(
      spec.videoStems.map(async (stem): Promise<ComponentRef> => {
        let identity: GenerationManifestComponentIdentity | undefined;
        try {
          identity = await this.deps.generationManifestRepository.getComponentIdentityById(
            stem.generationManifestId
          );
        } catch {
          identity = undefined;
        }
        resolvedIdentities.set(stem.generationManifestId, identity);
        if (!identity) {
          return {
            componentId: `unresolved-generation-manifest:${stem.generationManifestId}`,
            componentType: "model",
            versionOrRevision: "unresolved"
          };
        }
        if (
          identity.outputChecksumsSha256 &&
          identity.outputChecksumsSha256.length > 0 &&
          !identity.outputChecksumsSha256.includes(stem.media.sha256)
        ) {
          return {
            componentId: `inconsistent-generation-manifest:${stem.generationManifestId}`,
            componentType: "model",
            versionOrRevision: "unresolved"
          };
        }
        return {
          componentId: identity.renderProfile,
          componentType: "model",
          versionOrRevision:
            identity.renderProfileVersion !== null
              ? String(identity.renderProfileVersion)
              : "unresolved"
        };
      })
    );

    // The assembler's live-detected runtime dependencies (e.g. the actual
    // FFmpeg build) must also be checked — the caller-supplied
    // requiredComponents can't know these in advance, and trusting an
    // unverified/static claim instead of the assembler's real identity is
    // exactly the fail-open gap this guard exists to prevent. This value
    // must already be resolved (see AssembleDeliveryReelDependencies) —
    // never fetched here, so a denied request never causes a probe.
    const runtimeComponents = [...this.deps.runtimeComponents];
    const callerComponents = params.requiredComponents ?? [];
    const hasRuntimeComponent =
      runtimeComponents.some((c) => c.componentType === "runtime") ||
      callerComponents.some((c) => c.componentType === "runtime");

    if (!hasRuntimeComponent) {
      runtimeComponents.push({
        componentId: "unresolved-assembler-runtime",
        componentType: "runtime",
        versionOrRevision: "unresolved"
      });
    }

    const allRequiredComponents = [
      ...callerComponents,
      ...specComponents,
      ...runtimeComponents,
      ...generationComponents
    ];

    // Step 1: Enforce license routing policy before validation or media assembly dispatch
    const decision = this.deps.enforceLicenseRouting.enforce({
      requiredComponents: allRequiredComponents,
      operation: {
        kind: "assembly",
        campaignId: spec.campaignId
      }
    });
    const governanceDecisionId = decision.decisionId;

    // Existence check: if a matching manifest already exists for this
    // assemblyId, short-circuit to avoid a redundant FFmpeg encode. This
    // runs AFTER the license guard, not before it: the guard must always be
    // the first thing evaluated in assemble() with no exceptions, so that a
    // component whose approval is later revoked can never keep being served
    // indefinitely through this short-circuit for a spec that was
    // legitimately assembled once under a now-stale approval. The check
    // itself is still cheap (an object-storage read) and still happens
    // before any FFmpeg spawn or storage write, so the redundant-encode
    // avoidance this exists for is fully preserved.
    const assemblyId = computeAssemblyId(spec);
    const earlyManifestKey = `campaigns/${spec.campaignId}/assemblies/${assemblyId}/manifest.json`;
    try {
      const existingManifestObj = await this.deps.objectStorage.getObject({
        bucket: BUCKETS.DELIVERY,
        key: earlyManifestKey
      });
      if (existingManifestObj) {
        const existingManifest = AssemblyManifestSchema.parse(
          JSON.parse(new TextDecoder().decode(existingManifestObj.body))
        );
        if (existingManifest.assemblyId === assemblyId) {
          const executionResult: AssemblyExecutionResult = {
            assemblyId: existingManifest.assemblyId,
            campaignId: existingManifest.campaignId,
            assemblyProfile: existingManifest.assemblyProfile,
            executedInputs: existingManifest.inputs,
            timeline: existingManifest.timeline,
            layout: existingManifest.layout,
            subtitleCuesSha256: existingManifest.subtitleCuesSha256,
            ...(existingManifest.subtitleCues !== undefined
              ? { subtitleCues: existingManifest.subtitleCues }
              : {}),
            ...(existingManifest.subtitleStyleProfile !== undefined
              ? { subtitleStyleProfile: existingManifest.subtitleStyleProfile }
              : {}),
            ffmpeg: existingManifest.ffmpeg,
            commandFingerprint: existingManifest.commandFingerprint,
            encoding: existingManifest.encoding,
            streams: existingManifest.streams,
            output: existingManifest.output,
            measuredFrameRate: existingManifest.measuredFrameRate,
            executionDurationMs: existingManifest.executionDurationMs
          };
          return {
            manifest: existingManifest,
            executionResult
          };
        }
      }
    } catch {
      // Ignore errors in the existence check (e.g. object not found,
      // unparseable manifest) and proceed with a full assembly.
    }

    // Step 2: Validate AssemblySpec and verify GenerationManifest consistency before dispatch
    validateAssemblySpec(spec);

    for (const stem of spec.videoStems) {
      const identity = resolvedIdentities.get(stem.generationManifestId);
      if (!identity) {
        throw new AssemblySpecValidationError(
          `Video stem with order ${stem.order} references unresolvable generation manifest "${stem.generationManifestId}"`
        );
      }
      if (
        identity.outputChecksumsSha256 &&
        identity.outputChecksumsSha256.length > 0 &&
        !identity.outputChecksumsSha256.includes(stem.media.sha256)
      ) {
        throw new AssemblySpecValidationError(
          `Video stem with order ${stem.order} references generation manifest "${stem.generationManifestId}" with inconsistent output checksum (expected one of [${identity.outputChecksumsSha256.join(", ")}], got "${stem.media.sha256}")`
        );
      }
    }

    // Step 3: Invoke MediaAssemblerPort for execution & media persistence
    let executionResult: AssemblyExecutionResult;
    try {
      executionResult = await this.deps.mediaAssembler.assemble(spec);
    } catch (err) {
      if (
        err instanceof Error &&
        "code" in err &&
        (err as { code?: string }).code === "ASSEMBLY_PROVENANCE_CONFLICT"
      ) {
        const assemblyId =
          (err as { context?: { assemblyId?: string } }).context?.assemblyId ?? "unknown";
        const manifestKey = `campaigns/${spec.campaignId}/assemblies/${assemblyId}/manifest.json`;
        let existingManifest: AssemblyManifest | undefined;
        try {
          const existingManifestObj = await this.deps.objectStorage.getObject({
            bucket: BUCKETS.DELIVERY,
            key: manifestKey
          });
          if (existingManifestObj) {
            existingManifest = AssemblyManifestSchema.parse(
              JSON.parse(new TextDecoder().decode(existingManifestObj.body))
            );
          }
        } catch {
          // ignore manifest retrieval error
        }
        throw new AssemblyProvenanceConflictError(
          assemblyId,
          existingManifest ?? ({} as AssemblyManifest),
          { cause: err }
        );
      }
      throw err;
    }

    // Step 4: Construct immutable AssemblyManifest from exact executed state
    const manifest = createAssemblyManifest({
      executionResult,
      governanceDecisionId
    });

    // Step 4: Persist manifest beside the media output
    const manifestJson = JSON.stringify(manifest, null, 2);
    const manifestBytes = Buffer.from(manifestJson, "utf-8");
    const checksumSha256 = createHash("sha256").update(manifestBytes).digest("hex");
    const manifestKey = `campaigns/${executionResult.campaignId}/assemblies/${executionResult.assemblyId}/manifest.json`;

    // Step 4a: Check if an AssemblyManifest already exists for this identity (idempotency & conflict prevention)
    const existingManifestObj = await this.deps.objectStorage.getObject({
      bucket: executionResult.output.media.bucket,
      key: manifestKey
    });

    if (existingManifestObj) {
      let existingManifest: AssemblyManifest;
      try {
        existingManifest = AssemblyManifestSchema.parse(
          JSON.parse(new TextDecoder().decode(existingManifestObj.body))
        );
      } catch (err) {
        throw new AssemblyProvenanceConflictError(executionResult.assemblyId, manifest, {
          cause: err as Error
        });
      }

      if (this.isManifestEquivalent(existingManifest, manifest)) {
        // Idempotent replay: return existing manifest without overwriting media or manifest
        return {
          manifest: existingManifest,
          executionResult
        };
      }

      // Reused identity with conflicting provenance: raise typed conflict WITHOUT deleting or overwriting the existing delivery
      throw new AssemblyProvenanceConflictError(executionResult.assemblyId, existingManifest);
    }

    try {
      await this.deps.objectStorage.putObject({
        bucket: executionResult.output.media.bucket,
        key: manifestKey,
        body: manifestBytes,
        contentType: "application/json",
        checksumSha256,
        ifNoneMatch: "*"
      });
    } catch (err) {
      if (err instanceof AssemblyProvenanceConflictError) {
        throw err;
      }
      if (err instanceof ObjectAlreadyExistsError) {
        // Concurrent publication: retrieve published manifest and verify equivalence
        const concurrentManifestObj = await this.deps.objectStorage.getObject({
          bucket: executionResult.output.media.bucket,
          key: manifestKey
        });
        if (concurrentManifestObj) {
          let concurrentManifest: AssemblyManifest;
          try {
            concurrentManifest = AssemblyManifestSchema.parse(
              JSON.parse(new TextDecoder().decode(concurrentManifestObj.body))
            );
          } catch (parseErr) {
            throw new AssemblyProvenanceConflictError(executionResult.assemblyId, manifest, {
              cause: parseErr as Error
            });
          }
          if (this.isManifestEquivalent(concurrentManifest, manifest)) {
            return {
              manifest: concurrentManifest,
              executionResult
            };
          }
          throw new AssemblyProvenanceConflictError(executionResult.assemblyId, concurrentManifest);
        }
        throw new AssemblyProvenanceConflictError(executionResult.assemblyId, manifest, {
          cause: err as Error
        });
      }

      // Best-effort rollback: the media output was already published in
      // Step 2 before the manifest write failed here, so without this the
      // delivery bucket ends up with an orphaned video that has no manifest
      // beside it — directly contradicting the "every delivered video has
      // an immutable manifest" invariant this use case exists to guarantee.
      // This does not make the publish atomic (the delete can itself fail,
      // and objectStorage.deleteObject is optional — adapters that don't
      // implement it simply can't be rolled back), but it closes the gap
      // for the common case without a larger two-phase-publish redesign.
      try {
        await this.deps.objectStorage.deleteObject?.(executionResult.output.media);
      } catch {
        // Swallow: the original manifest-publication error is what the
        // caller needs to see and act on; a failed rollback attempt must
        // not mask it.
      }
      throw new AssemblyManifestPublicationError(
        `Failed to persist assembly manifest to ${executionResult.output.media.bucket}/${manifestKey}: ${(err as Error).message}`,
        {
          executionResult,
          manifest,
          cause: err as Error
        }
      );
    }

    return {
      manifest,
      executionResult
    };
  }

  private isManifestEquivalent(
    existingManifest: AssemblyManifest,
    newManifest: AssemblyManifest
  ): boolean {
    return (
      computeManifestProvenanceFingerprint(existingManifest) ===
      computeManifestProvenanceFingerprint(newManifest)
    );
  }
}

/**
 * Derives a canonical provenance fingerprint covering every semantic field of an AssemblyManifest.
 * Any divergence in inputs, timeline, audio timing/looping, layout, encoding, streams, ffmpeg runtime,
 * command fingerprint, or governance decision produces a distinct fingerprint.
 */
export function computeManifestProvenanceFingerprint(manifest: AssemblyManifest): string {
  const canonical = {
    assemblyId: manifest.assemblyId,
    campaignId: manifest.campaignId,
    assemblyProfile: {
      key: manifest.assemblyProfile.key,
      version: manifest.assemblyProfile.version
    },
    generationManifestIds: [...manifest.generationManifestIds],
    inputs: {
      videoStems: manifest.inputs.videoStems.map((s) => ({
        sceneId: s.sceneId,
        generationManifestId: s.generationManifestId,
        order: s.order,
        actualDurationMs: s.actualDurationMs,
        media: {
          bucket: s.media.bucket,
          key: s.media.key,
          sha256: s.media.sha256,
          contentType: s.media.contentType
        }
      })),
      voiceover: manifest.inputs.voiceover
        ? {
            assetId: manifest.inputs.voiceover.assetId,
            effectiveStartMs: manifest.inputs.voiceover.effectiveStartMs,
            effectiveDurationMs: manifest.inputs.voiceover.effectiveDurationMs,
            source: manifest.inputs.voiceover.source,
            media: {
              bucket: manifest.inputs.voiceover.media.bucket,
              key: manifest.inputs.voiceover.media.key,
              sha256: manifest.inputs.voiceover.media.sha256,
              contentType: manifest.inputs.voiceover.media.contentType
            }
          }
        : null,
      soundbed: manifest.inputs.soundbed
        ? {
            assetId: manifest.inputs.soundbed.assetId,
            effectiveStartMs: manifest.inputs.soundbed.effectiveStartMs,
            effectiveDurationMs: manifest.inputs.soundbed.effectiveDurationMs,
            loopCount: manifest.inputs.soundbed.loopCount,
            source: manifest.inputs.soundbed.source,
            media: {
              bucket: manifest.inputs.soundbed.media.bucket,
              key: manifest.inputs.soundbed.media.key,
              sha256: manifest.inputs.soundbed.media.sha256,
              contentType: manifest.inputs.soundbed.media.contentType
            }
          }
        : null
    },
    timeline: {
      totalDurationMs: manifest.timeline.totalDurationMs,
      stemDurationsMs: [...manifest.timeline.stemDurationsMs]
    },
    subtitleCuesSha256: manifest.subtitleCuesSha256,
    subtitleStyleProfile: manifest.subtitleStyleProfile ?? null,
    subtitleCues: manifest.subtitleCues ?? null,
    layout: {
      mode: manifest.layout.mode
    },
    ffmpeg: {
      executable: manifest.ffmpeg.executable,
      version: manifest.ffmpeg.version,
      buildInfo: manifest.ffmpeg.buildInfo
    },
    commandFingerprint: manifest.commandFingerprint,
    encoding: manifest.encoding,
    streams: manifest.streams,
    output: {
      durationMs: manifest.output.durationMs,
      width: manifest.output.width,
      height: manifest.output.height,
      media: {
        bucket: manifest.output.media.bucket,
        key: manifest.output.media.key,
        sha256: manifest.output.media.sha256,
        contentType: manifest.output.media.contentType
      }
    },
    measuredFrameRate: manifest.measuredFrameRate,
    governanceDecisionId: manifest.governanceDecisionId
  };

  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
