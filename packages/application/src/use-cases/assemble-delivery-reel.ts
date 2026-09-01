import { createHash } from "node:crypto";
import {
  createAssemblyManifest,
  type AssemblyExecutionResult,
  type AssemblyManifest,
  type AssemblySpec
} from "@cco/contracts";
import { validateAssemblySpec } from "../ports/assembly-spec.js";
import type { MediaAssemblerPort } from "../ports/media-assembler-port.js";
import type { ObjectStoragePort } from "../ports/object-storage-port.js";

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
}

export interface AssembleDeliveryReelParams {
  readonly spec: AssemblySpec;
  readonly governanceDecisionId: string;
}

export class AssembleDeliveryReel {
  constructor(private readonly deps: AssembleDeliveryReelDependencies) {}

  async assemble(params: AssembleDeliveryReelParams): Promise<{
    readonly manifest: AssemblyManifest;
    readonly executionResult: AssemblyExecutionResult;
  }> {
    const { spec, governanceDecisionId } = params;

    // Step 1: Validate AssemblySpec before dispatch
    validateAssemblySpec(spec);

    // Step 2: Invoke MediaAssemblerPort for execution & media persistence
    const executionResult = await this.deps.mediaAssembler.assemble(spec);

    // Step 3: Construct immutable AssemblyManifest from exact executed state
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
