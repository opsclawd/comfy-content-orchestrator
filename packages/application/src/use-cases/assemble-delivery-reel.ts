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
