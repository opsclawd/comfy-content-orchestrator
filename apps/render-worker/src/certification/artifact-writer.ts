import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { LtxCertificationArtifactSchema, type LtxCertificationArtifact } from "@cco/contracts";
import { renderCertificationSummary } from "@cco/application";

export class ArtifactWriterError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ArtifactWriterError";
  }
}

export interface ArtifactWriterDependencies {
  readonly mkdir?: typeof fsPromises.mkdir;
  readonly writeFile?: typeof fsPromises.writeFile;
  readonly rename?: typeof fsPromises.rename;
  readonly rm?: typeof fsPromises.rm;
  readonly stat?: typeof fsPromises.stat;
  readonly mkdtemp?: typeof fsPromises.mkdtemp;
}

export interface WriteCertificationArtifactsOptions {
  readonly outputRoot: string;
  readonly artifact: unknown;
  readonly repoRoot?: string;
  readonly dependencies?: ArtifactWriterDependencies;
}

export interface WriteCertificationArtifactsResult {
  readonly runId: string;
  readonly outputDirectory: string;
  readonly resultJsonPath: string;
  readonly summaryMdPath: string;
  readonly relativeOutputDirectory: string;
  readonly relativeResultJsonPath: string;
  readonly relativeSummaryMdPath: string;
  readonly artifact: LtxCertificationArtifact;
}

const RUN_ID_REGEX = /^[a-z0-9][a-z0-9._-]*$/;

function validateRunId(runId: unknown): string {
  if (typeof runId !== "string" || runId.length === 0) {
    throw new ArtifactWriterError("Certification run ID must be a non-empty string");
  }
  if (!RUN_ID_REGEX.test(runId)) {
    throw new ArtifactWriterError(
      `Invalid certification run ID "${runId}": must match pattern ^[a-z0-9][a-z0-9._-]*$`
    );
  }
  if (runId.includes("..") || runId.includes("/") || runId.includes("\\")) {
    throw new ArtifactWriterError(
      `Unsafe certification run ID "${runId}": path separators and traversal are forbidden`
    );
  }
  if (path.basename(runId) !== runId) {
    throw new ArtifactWriterError(
      `Unsafe certification run ID "${runId}": must be a simple directory name`
    );
  }
  return runId;
}

function isOptionsObject(
  outputRootOrOptions: string | WriteCertificationArtifactsOptions
): outputRootOrOptions is WriteCertificationArtifactsOptions {
  return typeof outputRootOrOptions === "object" && outputRootOrOptions !== null;
}

/**
 * Atomically writes JSON and Markdown certification evidence to a run-scoped directory.
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
  let repoRoot: string;
  let dependencies: ArtifactWriterDependencies | undefined;

  if (isOptionsObject(outputRootOrOptions)) {
    outputRoot = outputRootOrOptions.outputRoot;
    rawArtifact = outputRootOrOptions.artifact;
    repoRoot = outputRootOrOptions.repoRoot ?? process.cwd();
    dependencies = outputRootOrOptions.dependencies;
  } else {
    outputRoot = outputRootOrOptions;
    rawArtifact = artifactArg;
    repoRoot = process.cwd();
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

  // 2. Validate run ID constraints
  const runId = validateRunId(validatedArtifact.runId);

  // 3. Prepare formatted JSON and Markdown contents
  const jsonContent = `${JSON.stringify(validatedArtifact, null, 2)}\n`;
  const summaryRaw = renderCertificationSummary(validatedArtifact);
  const markdownContent = summaryRaw.endsWith("\n") ? summaryRaw : `${summaryRaw}\n`;

  const resolvedOutputRoot = path.resolve(outputRoot);
  const finalDir = path.join(resolvedOutputRoot, runId);

  const mkdirFn = dependencies?.mkdir ?? fsPromises.mkdir;
  const writeFileFn = dependencies?.writeFile ?? fsPromises.writeFile;
  const renameFn = dependencies?.rename ?? fsPromises.rename;
  const rmFn = dependencies?.rm ?? fsPromises.rm;
  const statFn = dependencies?.stat ?? fsPromises.stat;
  const mkdtempFn = dependencies?.mkdtemp ?? fsPromises.mkdtemp;

  // 4. Pre-check: refuses to overwrite an existing final run directory
  let existingDirFound = false;
  try {
    await statFn(finalDir);
    existingDirFound = true;
  } catch {
    existingDirFound = false;
  }

  if (existingDirFound) {
    throw new ArtifactWriterError(
      `Refusing to overwrite existing certification run directory: "${finalDir}"`
    );
  }

  // Ensure outputRoot directory exists
  await mkdirFn(resolvedOutputRoot, { recursive: true });

  // 5. Create sibling temporary directory on the same filesystem
  const tempPrefix = path.join(resolvedOutputRoot, `.${runId}.tmp-`);
  let tempDir: string;
  try {
    tempDir = await mkdtempFn(tempPrefix);
  } catch (error) {
    throw new ArtifactWriterError(
      `Failed to create temporary directory for artifact publication: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }

  // 6. Write files into temp directory and atomically rename to final path
  try {
    const tempResultJsonPath = path.join(tempDir, "result.json");
    const tempSummaryMdPath = path.join(tempDir, "summary.md");

    await writeFileFn(tempResultJsonPath, jsonContent, "utf8");
    await writeFileFn(tempSummaryMdPath, markdownContent, "utf8");

    // Double-check collision before rename
    let collisionDetected = false;
    try {
      await statFn(finalDir);
      collisionDetected = true;
    } catch {
      collisionDetected = false;
    }

    if (collisionDetected) {
      throw new ArtifactWriterError(
        `Refusing to overwrite existing certification run directory: "${finalDir}"`
      );
    }

    await renameFn(tempDir, finalDir);
  } catch (error) {
    // On any write, validation, or rename failure, clean up ONLY the temporary directory
    try {
      await rmFn(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore errors during temp cleanup
    }

    if (error instanceof ArtifactWriterError) {
      throw error;
    }

    throw new ArtifactWriterError(
      `Failed to publish certification artifacts: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }

  // 7. Construct and return result with absolute and relative paths
  const finalResultJsonPath = path.join(finalDir, "result.json");
  const finalSummaryMdPath = path.join(finalDir, "summary.md");
  const resolvedRepoRoot = path.resolve(repoRoot);

  return {
    runId,
    outputDirectory: finalDir,
    resultJsonPath: finalResultJsonPath,
    summaryMdPath: finalSummaryMdPath,
    relativeOutputDirectory: path.relative(resolvedRepoRoot, finalDir),
    relativeResultJsonPath: path.relative(resolvedRepoRoot, finalResultJsonPath),
    relativeSummaryMdPath: path.relative(resolvedRepoRoot, finalSummaryMdPath),
    artifact: validatedArtifact
  };
}
