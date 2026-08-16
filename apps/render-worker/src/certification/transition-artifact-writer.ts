import { TransitionSoakArtifactSchema, type TransitionSoakArtifact } from "@cco/contracts";
import { renderTransitionSoakSummary } from "@cco/application";
import {
  publishArtifactPair,
  ArtifactWriterError,
  type ArtifactPublisherDependencies,
  type PublishedArtifactPairResult
} from "./atomic-artifact-publisher.js";

export { ArtifactWriterError };
export type TransitionArtifactWriterDependencies = ArtifactPublisherDependencies;

export interface WriteTransitionSoakArtifactsOptions {
  readonly outputRoot: string;
  readonly artifact: unknown;
  readonly repoRoot?: string | undefined;
  readonly dependencies?: ArtifactPublisherDependencies | undefined;
}

export interface WriteTransitionSoakArtifactsResult extends PublishedArtifactPairResult {
  readonly artifact: TransitionSoakArtifact;
}

function isOptionsObject(
  outputRootOrOptions: string | WriteTransitionSoakArtifactsOptions
): outputRootOrOptions is WriteTransitionSoakArtifactsOptions {
  return typeof outputRootOrOptions === "object" && outputRootOrOptions !== null;
}

/**
 * Atomically writes JSON and Markdown transition soak evidence to a run-scoped directory.
 *
 * Requirements:
 * 1. Validates artifact using TransitionSoakArtifactSchema before any write.
 * 2. Writes result.json with two-space formatting and a trailing newline.
 * 3. Writes summary.md rendered with renderTransitionSoakSummary from the exact validated artifact.
 * 4. Checks collision before writing; never overwrites or mutates an existing run directory.
 * 5. Writes to a sibling temporary directory first and atomically renames it.
 * 6. Cleans up only the owned temporary directory on any write or rename failure.
 */
export async function writeTransitionSoakArtifacts(
  options: WriteTransitionSoakArtifactsOptions
): Promise<WriteTransitionSoakArtifactsResult>;
export async function writeTransitionSoakArtifacts(
  outputRoot: string,
  artifact: unknown
): Promise<WriteTransitionSoakArtifactsResult>;
export async function writeTransitionSoakArtifacts(
  outputRootOrOptions: string | WriteTransitionSoakArtifactsOptions,
  artifactArg?: unknown
): Promise<WriteTransitionSoakArtifactsResult> {
  let outputRoot: string;
  let rawArtifact: unknown;
  let repoRoot: string | undefined;
  let dependencies: ArtifactPublisherDependencies | undefined;

  if (isOptionsObject(outputRootOrOptions)) {
    outputRoot = outputRootOrOptions.outputRoot;
    rawArtifact = outputRootOrOptions.artifact;
    repoRoot = outputRootOrOptions.repoRoot;
    dependencies = outputRootOrOptions.dependencies;
  } else {
    outputRoot = outputRootOrOptions;
    rawArtifact = artifactArg;
  }

  if (typeof outputRoot !== "string" || outputRoot.trim().length === 0) {
    throw new ArtifactWriterError("Output root directory must be a non-empty path string");
  }

  // 1. Validate artifact structure before any filesystem calls
  const parseResult = TransitionSoakArtifactSchema.safeParse(rawArtifact);
  if (!parseResult.success) {
    const formattedErrors = parseResult.error.issues
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    throw new ArtifactWriterError(`Artifact validation failed: ${formattedErrors}`);
  }

  const validatedArtifact = parseResult.data;

  // 2. Prepare formatted JSON and Markdown contents
  const jsonContent = `${JSON.stringify(validatedArtifact, null, 2)}\n`;
  const summaryRaw = renderTransitionSoakSummary(validatedArtifact);
  const markdownContent = summaryRaw.endsWith("\n") ? summaryRaw : `${summaryRaw}\n`;

  // 3. Delegate atomic publication to the shared publisher
  const published = await publishArtifactPair({
    outputRoot,
    runId: validatedArtifact.runId,
    jsonContent,
    markdownContent,
    repoRoot,
    dependencies
  });

  return {
    ...published,
    artifact: validatedArtifact
  };
}
