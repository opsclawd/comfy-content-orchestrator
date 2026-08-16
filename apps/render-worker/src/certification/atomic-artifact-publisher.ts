import * as fsPromises from "node:fs/promises";
import * as path from "node:path";

export class ArtifactWriterError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ArtifactWriterError";
  }
}

export interface ArtifactPublisherDependencies {
  readonly mkdir?: typeof fsPromises.mkdir | undefined;
  readonly writeFile?: typeof fsPromises.writeFile | undefined;
  readonly rename?: typeof fsPromises.rename | undefined;
  readonly rm?: typeof fsPromises.rm | undefined;
  readonly stat?: typeof fsPromises.stat | undefined;
  readonly mkdtemp?: typeof fsPromises.mkdtemp | undefined;
}

export interface PublishArtifactPairOptions {
  readonly outputRoot: string;
  readonly runId: string;
  readonly jsonContent: string;
  readonly markdownContent: string;
  readonly repoRoot?: string | undefined;
  readonly dependencies?: ArtifactPublisherDependencies | undefined;
}

export interface PublishedArtifactPairResult {
  readonly runId: string;
  readonly outputDirectory: string;
  readonly resultJsonPath: string;
  readonly summaryMdPath: string;
  readonly relativeOutputDirectory: string;
  readonly relativeResultJsonPath: string;
  readonly relativeSummaryMdPath: string;
}

const RUN_ID_REGEX = /^[a-z0-9][a-z0-9._-]*$/;

export function validateRunId(runId: unknown): string {
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

/**
 * Atomically writes a JSON and Markdown artifact pair into a run-scoped directory.
 *
 * Requirements:
 * 1. Checks run ID safety rules (lowercase, safe directory name, no path traversal).
 * 2. Formats and writes result.json and summary.md with trailing newlines.
 * 3. Checks collision before writing; never overwrites an existing directory.
 * 4. Writes to a sibling temporary directory first and atomically renames it.
 * 5. Cleans up only the owned temporary directory on any write or rename failure.
 */
export async function publishArtifactPair(
  options: PublishArtifactPairOptions
): Promise<PublishedArtifactPairResult> {
  const {
    outputRoot,
    runId: rawRunId,
    jsonContent,
    markdownContent,
    repoRoot,
    dependencies
  } = options;

  if (typeof outputRoot !== "string" || outputRoot.trim().length === 0) {
    throw new ArtifactWriterError("Output root directory must be a non-empty path string");
  }

  const runId = validateRunId(rawRunId);

  const finalJson = jsonContent.endsWith("\n") ? jsonContent : `${jsonContent}\n`;
  const finalMd = markdownContent.endsWith("\n") ? markdownContent : `${markdownContent}\n`;

  const resolvedOutputRoot = path.resolve(outputRoot);
  const finalDir = path.join(resolvedOutputRoot, runId);

  const mkdirFn = dependencies?.mkdir ?? fsPromises.mkdir;
  const writeFileFn = dependencies?.writeFile ?? fsPromises.writeFile;
  const renameFn = dependencies?.rename ?? fsPromises.rename;
  const rmFn = dependencies?.rm ?? fsPromises.rm;
  const statFn = dependencies?.stat ?? fsPromises.stat;
  const mkdtempFn = dependencies?.mkdtemp ?? fsPromises.mkdtemp;

  // Refuses to overwrite an existing final directory
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

  // Create sibling temporary directory on the same filesystem
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

  // Write files into temp directory and atomically rename to final path
  try {
    const tempResultJsonPath = path.join(tempDir, "result.json");
    const tempSummaryMdPath = path.join(tempDir, "summary.md");

    await writeFileFn(tempResultJsonPath, finalJson, "utf8");
    await writeFileFn(tempSummaryMdPath, finalMd, "utf8");

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
    // On any write or rename failure, clean up ONLY the temporary directory
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

  // Construct and return result with absolute and relative paths
  const finalResultJsonPath = path.join(finalDir, "result.json");
  const finalSummaryMdPath = path.join(finalDir, "summary.md");
  const resolvedRepoRoot = path.resolve(repoRoot ?? process.cwd());

  return {
    runId,
    outputDirectory: finalDir,
    resultJsonPath: finalResultJsonPath,
    summaryMdPath: finalSummaryMdPath,
    relativeOutputDirectory: path.relative(resolvedRepoRoot, finalDir),
    relativeResultJsonPath: path.relative(resolvedRepoRoot, finalResultJsonPath),
    relativeSummaryMdPath: path.relative(resolvedRepoRoot, finalSummaryMdPath)
  };
}
