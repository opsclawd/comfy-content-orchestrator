import { LtxCertificationArtifactSchema, type LtxCertificationArtifact } from "@cco/contracts";
import { renderCertificationSummary } from "@cco/application";
import type { CertificationProfile, CertificationProvenanceReport } from "@cco/infrastructure";
import {
  publishArtifactPair,
  ArtifactWriterError,
  type ArtifactPublisherDependencies,
  type PublishedArtifactPairResult
} from "./atomic-artifact-publisher.js";

export { ArtifactWriterError };

export type ArtifactWriterDependencies = ArtifactPublisherDependencies;

export interface WriteCertificationArtifactsOptions {
  readonly outputRoot: string;
  readonly artifact: unknown;
  readonly repoRoot?: string | undefined;
  readonly dependencies?: ArtifactWriterDependencies | undefined;
  readonly liveProvenance?: CertificationProvenanceReport | undefined;
  readonly profile?: CertificationProfile | undefined;
}

export interface WriteCertificationArtifactsResult extends PublishedArtifactPairResult {
  readonly artifact: LtxCertificationArtifact;
}

function isOptionsObject(
  outputRootOrOptions: string | WriteCertificationArtifactsOptions
): outputRootOrOptions is WriteCertificationArtifactsOptions {
  return typeof outputRootOrOptions === "object" && outputRootOrOptions !== null;
}

export function buildApprovedProvenance(
  artifact: LtxCertificationArtifact,
  liveProvenance?: CertificationProvenanceReport | undefined,
  profile?: CertificationProfile | undefined
): Record<string, unknown> | null {
  if (artifact.status !== "passed") {
    return null;
  }

  if (liveProvenance && liveProvenance.renderProfileProvenance) {
    return {
      version: 1,
      profileId: liveProvenance.profileId,
      workflow: {
        sha256: liveProvenance.workflow.sha256,
        source: liveProvenance.workflow.source
      },
      renderProfileProvenance: {
        key: liveProvenance.renderProfileProvenance.key,
        version: liveProvenance.renderProfileProvenance.version,
        engine: liveProvenance.renderProfileProvenance.engine,
        frames: liveProvenance.renderProfileProvenance.frames,
        steps: liveProvenance.renderProfileProvenance.steps,
        workflowHash: liveProvenance.renderProfileProvenance.workflowHash,
        modelHashes: liveProvenance.renderProfileProvenance.modelHashes
      }
    };
  }

  if (profile && profile.source) {
    return {
      version: 1,
      profileId: artifact.identity.profileId,
      workflow: {
        sha256: artifact.identity.workflowSha256,
        source: profile.source
      },
      renderProfileProvenance: {
        key: artifact.identity.renderProfileKey,
        version: artifact.identity.renderProfileVersion,
        engine: artifact.identity.engine,
        frames: artifact.identity.frames,
        steps: artifact.identity.steps,
        workflowHash: artifact.identity.workflowSha256,
        modelHashes: artifact.identity.modelSha256
      }
    };
  }

  return null;
}

/**
 * Atomically writes JSON, Markdown, and approved provenance certification evidence to a run-scoped directory.
 *
 * Requirements:
 * 1. Validates artifact using LtxCertificationArtifactSchema before any write.
 * 2. Writes result.json with two-space formatting and a trailing newline.
 * 3. Writes summary.md rendered from the exact validated artifact with a trailing newline.
 * 4. Checks collision before writing; never overwrites or mutates an existing run directory.
 * 5. Writes to a sibling temporary directory first and atomically renames it on the same filesystem.
 * 6. Cleans up only the owned temporary directory on any write or rename failure.
 */
export async function writeCertificationArtifacts(
  options: WriteCertificationArtifactsOptions
): Promise<WriteCertificationArtifactsResult>;
export async function writeCertificationArtifacts(
  outputRoot: string,
  artifact: unknown
): Promise<WriteCertificationArtifactsResult>;
export async function writeCertificationArtifacts(
  outputRootOrOptions: string | WriteCertificationArtifactsOptions,
  artifactArg?: unknown
): Promise<WriteCertificationArtifactsResult> {
  let outputRoot: string;
  let rawArtifact: unknown;
  let repoRoot: string | undefined;
  let dependencies: ArtifactWriterDependencies | undefined;
  let liveProvenance: CertificationProvenanceReport | undefined;
  let profile: CertificationProfile | undefined;

  if (isOptionsObject(outputRootOrOptions)) {
    outputRoot = outputRootOrOptions.outputRoot;
    rawArtifact = outputRootOrOptions.artifact;
    repoRoot = outputRootOrOptions.repoRoot;
    dependencies = outputRootOrOptions.dependencies;
    liveProvenance = outputRootOrOptions.liveProvenance;
    profile = outputRootOrOptions.profile;
  } else {
    outputRoot = outputRootOrOptions;
    rawArtifact = artifactArg;
  }

  if (typeof outputRoot !== "string" || outputRoot.trim().length === 0) {
    throw new ArtifactWriterError("Output root directory must be a non-empty path string");
  }

  // 1. Validate artifact structure before any filesystem calls
  const parseResult = LtxCertificationArtifactSchema.safeParse(rawArtifact);
  if (!parseResult.success) {
    const formattedErrors = parseResult.error.issues
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    throw new ArtifactWriterError(`Artifact validation failed: ${formattedErrors}`);
  }

  const validatedArtifact = parseResult.data;

  // 2. Prepare formatted JSON, Markdown, and approved provenance contents
  const jsonContent = `${JSON.stringify(validatedArtifact, null, 2)}\n`;
  const summaryRaw = renderCertificationSummary(validatedArtifact);
  const markdownContent = summaryRaw.endsWith("\n") ? summaryRaw : `${summaryRaw}\n`;

  const approvedObj = buildApprovedProvenance(validatedArtifact, liveProvenance, profile);
  const approvedProvenanceContent = approvedObj
    ? `${JSON.stringify(approvedObj, null, 2)}\n`
    : undefined;

  // 3. Publish atomically through shared publisher
  const published = await publishArtifactPair({
    outputRoot,
    runId: validatedArtifact.runId,
    jsonContent,
    markdownContent,
    approvedProvenanceContent,
    repoRoot,
    dependencies
  });

  return {
    ...published,
    artifact: validatedArtifact
  };
}
