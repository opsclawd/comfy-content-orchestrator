import { createHash } from "node:crypto";
import {
  createAssemblyManifest,
  type AssemblyExecutionResult,
  type AssemblyManifest,
  type AssemblySpec,
  type ComponentRef
} from "@cco/contracts";
import { validateAssemblySpec } from "../ports/assembly-spec.js";
import type { MediaAssemblerPort } from "../ports/media-assembler-port.js";
import type { ObjectStoragePort } from "../ports/object-storage-port.js";
import type { GenerationManifestRepository } from "../ports/generation-manifest-repository.js";
import type { EnforceLicenseRouting } from "./enforce-license-routing.js";

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
    const generationComponents: ComponentRef[] = await Promise.all(
      spec.videoStems.map(async (stem): Promise<ComponentRef> => {
        let identity;
        try {
          identity = await this.deps.generationManifestRepository.getComponentIdentityById(
            stem.generationManifestId
          );
        } catch {
          identity = undefined;
        }
        if (!identity) {
          return {
            componentId: `unresolved-generation-manifest:${stem.generationManifestId}`,
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

    // Step 2: Validate AssemblySpec before dispatch
    validateAssemblySpec(spec);

    // Step 3: Invoke MediaAssemblerPort for execution & media persistence
    const executionResult = await this.deps.mediaAssembler.assemble(spec);

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

    try {
      await this.deps.objectStorage.putObject({
        bucket: executionResult.output.media.bucket,
        key: manifestKey,
        body: manifestBytes,
        contentType: "application/json",
        checksumSha256
      });
    } catch (err) {
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
}
