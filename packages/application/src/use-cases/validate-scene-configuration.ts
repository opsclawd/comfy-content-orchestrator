import { RenderProfileKeySchema } from "@cco/contracts";
import type { ReferenceAsset, SceneConfiguration } from "@cco/domain";

export class SceneConfigurationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SceneConfigurationValidationError";
  }
}

export interface ValidateSceneConfigurationOptions {
  readonly maxDurationMs?: number | undefined;
  readonly targetDurationMs?: number | undefined;
}

export function validateSceneConfiguration(
  candidate: unknown,
  resolvedReferenceAssets: readonly ReferenceAsset[],
  options?: ValidateSceneConfigurationOptions | number
): SceneConfiguration {
  const maxDurationMs = typeof options === "number" ? options : options?.maxDurationMs;
  const targetDurationMs =
    typeof options === "object" && options !== null ? options.targetDurationMs : undefined;

  if (
    maxDurationMs !== undefined &&
    targetDurationMs !== undefined &&
    targetDurationMs > maxDurationMs
  ) {
    throw new SceneConfigurationValidationError(
      `targetDurationMs ${targetDurationMs} cannot exceed maxDurationMs ${maxDurationMs}`
    );
  }

  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw new SceneConfigurationValidationError("Candidate must be a plain object");
  }

  const record = candidate as Record<string, unknown>;

  // 1. Prompt validation
  if (typeof record.prompt !== "string" || record.prompt.trim().length === 0) {
    throw new SceneConfigurationValidationError("prompt must be a non-empty string");
  }
  const prompt = record.prompt.trim();

  // 2. Reference IDs validation
  if (!Array.isArray(record.referenceIds)) {
    throw new SceneConfigurationValidationError("referenceIds must be an array of strings");
  }

  const allowedAssetIds = new Set(resolvedReferenceAssets.map((asset) => asset.id as string));
  const referenceIds: string[] = [];

  for (const refId of record.referenceIds) {
    if (typeof refId !== "string") {
      throw new SceneConfigurationValidationError("All referenceIds entries must be strings");
    }
    if (!allowedAssetIds.has(refId)) {
      throw new SceneConfigurationValidationError(
        `referenceId "${refId}" is not present in resolved reference assets`
      );
    }
    referenceIds.push(refId);
  }

  // 3. Engine profile validation via canonical RenderProfileKeySchema
  const parsedProfile = RenderProfileKeySchema.safeParse(record.engineProfileId);
  if (!parsedProfile.success) {
    throw new SceneConfigurationValidationError(
      `engineProfileId "${String(record.engineProfileId)}" is not a certified profile`
    );
  }
  const engineProfileId = parsedProfile.data;

  // 4. Duration validation
  if (
    typeof record.durationMs !== "number" ||
    !Number.isInteger(record.durationMs) ||
    record.durationMs <= 0
  ) {
    throw new SceneConfigurationValidationError("durationMs must be a positive integer");
  }
  if (maxDurationMs !== undefined && record.durationMs > maxDurationMs) {
    throw new SceneConfigurationValidationError(
      `durationMs ${record.durationMs} exceeds maximum allowed duration of ${maxDurationMs}`
    );
  }
  if (targetDurationMs !== undefined && record.durationMs !== targetDurationMs) {
    throw new SceneConfigurationValidationError(
      `durationMs ${record.durationMs} does not match required targetDurationMs ${targetDurationMs}`
    );
  }
  const durationMs = record.durationMs;

  // 5. Optional loraConfigurationId validation
  let loraConfigurationId: string | null | undefined = undefined;
  if (record.loraConfigurationId !== undefined && record.loraConfigurationId !== null) {
    if (
      typeof record.loraConfigurationId !== "string" ||
      record.loraConfigurationId.trim().length === 0
    ) {
      throw new SceneConfigurationValidationError(
        "loraConfigurationId must be a non-empty string when provided"
      );
    }
    loraConfigurationId = record.loraConfigurationId.trim();
  } else if (record.loraConfigurationId === null) {
    loraConfigurationId = null;
  }

  const validated: SceneConfiguration = {
    prompt,
    referenceIds: Object.freeze(referenceIds),
    engineProfileId,
    durationMs,
    ...(loraConfigurationId !== undefined ? { loraConfigurationId } : {})
  };

  return Object.freeze(validated);
}
