import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { isAbsolute, normalize, resolve, sep } from "node:path";

export type ModelCategory =
  "checkpoints" | "diffusion_models" | "text_encoders" | "vae" | "loras" | "model_patches";

export const VALID_MODEL_CATEGORIES: readonly ModelCategory[] = Object.freeze([
  "checkpoints",
  "diffusion_models",
  "text_encoders",
  "vae",
  "loras",
  "model_patches"
]);

const VALID_MODEL_CATEGORY_SET: ReadonlySet<string> = new Set(VALID_MODEL_CATEGORIES);

export interface ModelFileSpec {
  readonly category: ModelCategory;
  readonly relativePath: string;
}

export interface ModelFileHash extends ModelFileSpec {
  readonly key: string;
  readonly bytes: number;
  readonly sha256: string;
}

export type ModelHashProgress = Readonly<{
  status: "started" | "completed";
  key: string;
}>;

function sortKeysRecursively(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sortKeysRecursively);
  }

  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const sortedObject: Record<string, unknown> = Object.create(null);

  for (const key of sortedKeys) {
    sortedObject[key] = sortKeysRecursively(record[key]);
  }

  return sortedObject;
}

export function canonicalizeWorkflow(jsonString: string): string {
  const parsed = JSON.parse(jsonString);
  const sorted = sortKeysRecursively(parsed);
  return JSON.stringify(sorted);
}

export function hashWorkflow(jsonString: string): string {
  const canonical = canonicalizeWorkflow(jsonString);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function resolveModelFilePath(comfyUiDir: string, spec: ModelFileSpec): string {
  if (!spec.category || !VALID_MODEL_CATEGORY_SET.has(spec.category)) {
    throw new Error(`Invalid model category: ${String(spec.category)}`);
  }

  if (!spec.relativePath || spec.relativePath.trim() === "") {
    throw new Error("Model relativePath must not be empty");
  }

  if (isAbsolute(spec.relativePath)) {
    throw new Error(`Absolute model paths are not permitted: ${spec.relativePath}`);
  }

  const normalizedWithForwardSlashes = spec.relativePath.replace(/\\/g, "/");
  if (normalizedWithForwardSlashes.startsWith("/")) {
    throw new Error(`Absolute model paths are not permitted: ${spec.relativePath}`);
  }

  const segments = normalizedWithForwardSlashes.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new Error(`Parent traversal segments ('..') are not permitted: ${spec.relativePath}`);
  }

  const normalized = normalize(spec.relativePath);
  if (normalized.startsWith("..") || isAbsolute(normalized)) {
    throw new Error(`Parent traversal or absolute paths are not permitted: ${spec.relativePath}`);
  }

  const baseCategoryDir = resolve(comfyUiDir, "models", spec.category);
  const targetPath = resolve(baseCategoryDir, spec.relativePath);

  if (!targetPath.startsWith(baseCategoryDir + sep) && targetPath !== baseCategoryDir) {
    throw new Error(`Model path escapes category directory: ${spec.relativePath}`);
  }

  return targetPath;
}

export async function hashFileStream(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath, { highWaterMark: 1024 * 1024 });

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

export async function hashModelFiles(
  comfyUiDir: string,
  specs: readonly ModelFileSpec[],
  onProgress?: (event: ModelHashProgress) => void
): Promise<readonly ModelFileHash[]> {
  const getModelKey = (spec: ModelFileSpec): string => {
    const normalizedPath = spec.relativePath.replace(/\\/g, "/");
    return `models/${spec.category}/${normalizedPath}`;
  };

  const sortedSpecs = [...specs].sort((a, b) => {
    const keyA = getModelKey(a);
    const keyB = getModelKey(b);
    if (keyA < keyB) return -1;
    if (keyA > keyB) return 1;
    return 0;
  });

  const results: ModelFileHash[] = [];

  for (const spec of sortedSpecs) {
    const key = getModelKey(spec);

    let targetPath: string;
    try {
      targetPath = resolveModelFilePath(comfyUiDir, spec);
    } catch (err) {
      throw new Error(`Failed to resolve path for model ${key}`, { cause: err });
    }

    onProgress?.({ status: "started", key });

    let preStat;
    try {
      preStat = await stat(targetPath);
    } catch (err) {
      throw new Error(`Failed to access model file for ${key}: ${(err as Error).message}`, {
        cause: err
      });
    }

    let sha256: string;
    try {
      sha256 = await hashFileStream(targetPath);
    } catch (err) {
      throw new Error(`Failed to hash model file for ${key}: ${(err as Error).message}`, {
        cause: err
      });
    }

    let postStat;
    try {
      postStat = await stat(targetPath);
    } catch (err) {
      throw new Error(
        `Failed to verify model file for ${key} after hashing: ${(err as Error).message}`,
        {
          cause: err
        }
      );
    }

    if (preStat.size !== postStat.size || preStat.mtimeMs !== postStat.mtimeMs) {
      throw new Error(
        `Model file for ${key} was modified during hashing (size or modification time changed)`
      );
    }

    onProgress?.({ status: "completed", key });

    results.push(
      Object.freeze({
        category: spec.category,
        relativePath: spec.relativePath,
        key,
        bytes: preStat.size,
        sha256
      })
    );
  }

  return Object.freeze(results);
}
