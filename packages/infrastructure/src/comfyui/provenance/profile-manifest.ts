import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, normalize, resolve, sep } from "node:path";
import { VALID_MODEL_CATEGORIES, type ModelCategory, type ModelFileSpec } from "./hasher.js";

const VALID_MODEL_CATEGORY_SET: ReadonlySet<string> = new Set(VALID_MODEL_CATEGORIES);
const SHA256_REGEX = /^[0-9a-f]{64}$/;

export interface WorkflowNodeAssertion {
  readonly nodeId: string;
  readonly classType: string;
  readonly input: string;
  readonly equals: string | number | boolean;
}

export interface CertificationProfile {
  readonly id: string;
  readonly engine: string;
  readonly workflowPath: string;
  readonly workflowRelativePath: string;
  readonly expectedWorkflowHash: string;
  readonly source: Readonly<{
    kind: "official_upstream" | "validated_host_export";
    uri: string;
    revision: string;
    license: string;
  }>;
  readonly baseline: Readonly<{
    width?: number;
    height?: number;
    frames?: number;
    steps: number;
    approximateDurationSeconds?: number;
  }>;
  readonly minFreeDiskGb: number;
  readonly runnerProfile: string;
  readonly models: readonly ModelFileSpec[];
  readonly assertions: readonly WorkflowNodeAssertion[];
  readonly renderProfileIdentity: Readonly<{
    key: "LTX_25_720P_5S_V1";
    version: 1;
  }> | null;
}

function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const value = (obj as Record<string, unknown>)[key];
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return obj;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolveWorkflowPath(manifestDir: string, relativePath: string, profileId: string): string {
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    throw new Error(`Profile "${profileId}": workflowRelativePath must not be empty`);
  }

  if (isAbsolute(relativePath)) {
    throw new Error(
      `Profile "${profileId}": Absolute workflow paths outside manifest directory are not permitted: ${relativePath}`
    );
  }

  const normalizedSlashes = relativePath.replace(/\\/g, "/");
  if (normalizedSlashes.startsWith("/")) {
    throw new Error(
      `Profile "${profileId}": Absolute workflow paths outside manifest directory are not permitted: ${relativePath}`
    );
  }

  const segments = normalizedSlashes.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new Error(
      `Profile "${profileId}": Parent traversal segments ('..') outside manifest directory are not permitted in workflowRelativePath: ${relativePath}`
    );
  }

  const normalized = normalize(relativePath);
  if (normalized.startsWith("..") || isAbsolute(normalized)) {
    throw new Error(
      `Profile "${profileId}": Parent traversal or absolute paths outside manifest directory are not permitted: ${relativePath}`
    );
  }

  const targetPath = resolve(manifestDir, relativePath);
  if (!targetPath.startsWith(manifestDir + sep)) {
    throw new Error(
      `Profile "${profileId}": Workflow path escapes manifest directory: ${relativePath}`
    );
  }

  return targetPath;
}

function validateSource(source: unknown, profileId: string): CertificationProfile["source"] {
  if (!isRecord(source)) {
    throw new Error(`Profile "${profileId}": source must be an object`);
  }

  const { kind, uri, revision, license } = source;

  if (kind !== "official_upstream" && kind !== "validated_host_export") {
    throw new Error(
      `Profile "${profileId}": source.kind must be "official_upstream" or "validated_host_export", received: ${String(kind)}`
    );
  }

  if (typeof uri !== "string" || uri.trim() === "") {
    throw new Error(`Profile "${profileId}": source.uri must be a non-empty string`);
  }

  if (typeof revision !== "string" || revision.trim() === "") {
    throw new Error(`Profile "${profileId}": source.revision must be a non-empty string`);
  }

  if (typeof license !== "string" || license.trim() === "") {
    throw new Error(`Profile "${profileId}": source.license must be a non-empty string`);
  }

  return {
    kind,
    uri,
    revision,
    license
  };
}

function validateBaseline(baseline: unknown, profileId: string): CertificationProfile["baseline"] {
  if (!isRecord(baseline)) {
    throw new Error(`Profile "${profileId}": baseline must be an object`);
  }

  const { steps, width, height, frames, approximateDurationSeconds } = baseline;

  if (typeof steps !== "number" || !Number.isInteger(steps) || steps <= 0) {
    throw new Error(`Profile "${profileId}": baseline.steps must be a positive integer`);
  }

  if (width !== undefined) {
    if (typeof width !== "number" || !Number.isInteger(width) || width <= 0) {
      throw new Error(`Profile "${profileId}": baseline.width must be a positive integer`);
    }
  }

  if (height !== undefined) {
    if (typeof height !== "number" || !Number.isInteger(height) || height <= 0) {
      throw new Error(`Profile "${profileId}": baseline.height must be a positive integer`);
    }
  }

  if (frames !== undefined) {
    if (typeof frames !== "number" || !Number.isInteger(frames) || frames <= 0) {
      throw new Error(`Profile "${profileId}": baseline.frames must be a positive integer`);
    }
  }

  if (approximateDurationSeconds !== undefined) {
    if (
      typeof approximateDurationSeconds !== "number" ||
      !Number.isFinite(approximateDurationSeconds) ||
      approximateDurationSeconds <= 0
    ) {
      throw new Error(
        `Profile "${profileId}": baseline.approximateDurationSeconds must be a positive finite number`
      );
    }
  }

  return {
    steps,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(frames !== undefined ? { frames } : {}),
    ...(approximateDurationSeconds !== undefined ? { approximateDurationSeconds } : {})
  };
}

function validateModels(models: unknown, profileId: string): readonly ModelFileSpec[] {
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error(`Profile "${profileId}": models must be a non-empty array`);
  }

  const modelKeys = new Set<string>();
  const validatedModels: ModelFileSpec[] = [];

  for (let i = 0; i < models.length; i++) {
    const item = models[i];
    if (!isRecord(item)) {
      throw new Error(`Profile "${profileId}": models[${i}] must be an object`);
    }

    const { category, relativePath } = item;

    if (typeof category !== "string" || !VALID_MODEL_CATEGORY_SET.has(category)) {
      throw new Error(
        `Profile "${profileId}": models[${i}].category must be a valid model category, received: ${String(category)}`
      );
    }

    if (typeof relativePath !== "string" || relativePath.trim() === "") {
      throw new Error(
        `Profile "${profileId}": models[${i}].relativePath must be a non-empty string`
      );
    }

    const normalizedPath = relativePath.replace(/\\/g, "/");
    const modelKey = `${category}/${normalizedPath}`;
    if (modelKeys.has(modelKey)) {
      throw new Error(`Profile "${profileId}": duplicate model identity found: ${modelKey}`);
    }
    modelKeys.add(modelKey);

    validatedModels.push({
      category: category as ModelCategory,
      relativePath
    });
  }

  return validatedModels;
}

function validateAssertions(
  assertions: unknown,
  profileId: string
): readonly WorkflowNodeAssertion[] {
  if (!Array.isArray(assertions) || assertions.length === 0) {
    throw new Error(`Profile "${profileId}": assertions must be a non-empty array`);
  }

  const validatedAssertions: WorkflowNodeAssertion[] = [];

  for (let i = 0; i < assertions.length; i++) {
    const item = assertions[i];
    if (!isRecord(item)) {
      throw new Error(`Profile "${profileId}": assertions[${i}] must be an object`);
    }

    const { nodeId, classType, input, equals } = item;

    if (typeof nodeId !== "string" || nodeId.trim() === "") {
      throw new Error(`Profile "${profileId}": assertions[${i}].nodeId must be a non-empty string`);
    }

    if (typeof classType !== "string" || classType.trim() === "") {
      throw new Error(
        `Profile "${profileId}": assertions[${i}].classType must be a non-empty string`
      );
    }

    if (typeof input !== "string" || input.trim() === "") {
      throw new Error(`Profile "${profileId}": assertions[${i}].input must be a non-empty string`);
    }

    const isEqualsValid =
      typeof equals === "string" ||
      (typeof equals === "number" && Number.isFinite(equals)) ||
      typeof equals === "boolean";

    if (!isEqualsValid) {
      throw new Error(
        `Profile "${profileId}": assertions[${i}].equals must be a string, finite number, or boolean`
      );
    }

    validatedAssertions.push({
      nodeId,
      classType,
      input,
      equals: equals as string | number | boolean
    });
  }

  return validatedAssertions;
}

function validateRenderProfileIdentity(
  identity: unknown,
  profileId: string
): CertificationProfile["renderProfileIdentity"] {
  if (identity === null) {
    return null;
  }

  if (!isRecord(identity)) {
    throw new Error(
      `Profile "${profileId}": renderProfileIdentity must be null or an object with key and version`
    );
  }

  const { key, version } = identity;

  if (key !== "LTX_25_720P_5S_V1" || version !== 1) {
    throw new Error(
      `Profile "${profileId}": invalid renderProfileIdentity. Only key "LTX_25_720P_5S_V1" with version 1 or null is supported, received: ${JSON.stringify(identity)}`
    );
  }

  return {
    key: "LTX_25_720P_5S_V1",
    version: 1
  };
}

export async function loadCertificationProfile(
  manifestPath: string,
  profileId: string
): Promise<CertificationProfile> {
  let content: string;
  try {
    content = await readFile(manifestPath, "utf8");
  } catch (err) {
    throw new Error(
      `Failed to read certification manifest at "${manifestPath}": ${(err as Error).message}`,
      {
        cause: err
      }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(
      `Failed to parse certification manifest JSON at "${manifestPath}": ${(err as Error).message}`,
      {
        cause: err
      }
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(`Certification manifest at "${manifestPath}" must be a JSON object`);
  }

  if (parsed.version !== 1) {
    throw new Error(
      `Certification manifest at "${manifestPath}" has unsupported version: ${String(parsed.version)}. Expected version 1.`
    );
  }

  if (!Array.isArray(parsed.profiles) || parsed.profiles.length === 0) {
    throw new Error(
      `Certification manifest at "${manifestPath}" must contain a non-empty "profiles" array`
    );
  }

  const manifestDir = dirname(resolve(manifestPath));
  const seenProfileIds = new Set<string>();
  const validatedProfiles: CertificationProfile[] = [];

  for (let i = 0; i < parsed.profiles.length; i++) {
    const rawProfile = parsed.profiles[i];
    if (!isRecord(rawProfile)) {
      throw new Error(`Manifest profile at index ${i} must be an object`);
    }

    const currentId = rawProfile.id;
    if (typeof currentId !== "string" || currentId.trim() === "") {
      throw new Error(`Manifest profile at index ${i} has missing or empty id`);
    }

    if (seenProfileIds.has(currentId)) {
      throw new Error(`Duplicate profile id in manifest: "${currentId}"`);
    }
    seenProfileIds.add(currentId);

    const { engine, workflowRelativePath, expectedWorkflowHash, minFreeDiskGb, runnerProfile } =
      rawProfile;

    if (typeof engine !== "string" || engine.trim() === "") {
      throw new Error(`Profile "${currentId}": engine must be a non-empty string`);
    }

    if (typeof workflowRelativePath !== "string" || workflowRelativePath.trim() === "") {
      throw new Error(`Profile "${currentId}": workflowRelativePath must be a non-empty string`);
    }

    const workflowPath = resolveWorkflowPath(manifestDir, workflowRelativePath, currentId);

    if (typeof expectedWorkflowHash !== "string" || !SHA256_REGEX.test(expectedWorkflowHash)) {
      throw new Error(
        `Profile "${currentId}": expectedWorkflowHash must be a lowercase 64-character hex SHA-256 hash, received: ${String(expectedWorkflowHash)}`
      );
    }

    const source = validateSource(rawProfile.source, currentId);
    const baseline = validateBaseline(rawProfile.baseline, currentId);

    if (typeof minFreeDiskGb !== "number" || !Number.isFinite(minFreeDiskGb) || minFreeDiskGb < 0) {
      throw new Error(
        `Profile "${currentId}": minFreeDiskGb must be a non-negative finite number, received: ${String(minFreeDiskGb)}`
      );
    }

    if (typeof runnerProfile !== "string" || runnerProfile.trim() === "") {
      throw new Error(`Profile "${currentId}": runnerProfile must be a non-empty string`);
    }

    const models = validateModels(rawProfile.models, currentId);
    const assertions = validateAssertions(rawProfile.assertions, currentId);
    const renderProfileIdentity = validateRenderProfileIdentity(
      rawProfile.renderProfileIdentity,
      currentId
    );

    const profile: CertificationProfile = {
      id: currentId,
      engine,
      workflowPath,
      workflowRelativePath,
      expectedWorkflowHash,
      source,
      baseline,
      minFreeDiskGb,
      runnerProfile,
      models,
      assertions,
      renderProfileIdentity
    };

    validatedProfiles.push(profile);
  }

  const selected = validatedProfiles.find((p) => p.id === profileId);
  if (!selected) {
    const availableIds = validatedProfiles.map((p) => `"${p.id}"`).join(", ");
    throw new Error(
      `Profile "${profileId}" not found in manifest "${manifestPath}". Available profiles: ${availableIds}`
    );
  }

  return deepFreeze(selected);
}
