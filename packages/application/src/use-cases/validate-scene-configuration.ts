import { RenderProfileKeySchema, ScenePlannerResponseSchema } from "@cco/contracts";
import {
  assertReferenceAssetSelectable,
  ArchivedReferenceBindingError,
  type ReferenceAsset,
  type ReferenceAssetId,
  type SceneConfigurationInput,
  type SceneReferenceBindingInput
} from "@cco/domain";

export class SceneConfigurationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SceneConfigurationValidationError";
  }
}

export interface ValidateSceneConfigurationOptions {
  readonly maxDurationMs?: number | undefined;
  readonly targetDurationMs?: number | undefined;
  readonly campaignClientId?: string | undefined;
}

export function validateSceneConfiguration(
  candidate: unknown,
  resolvedReferenceAssets: readonly ReferenceAsset[],
  options?: ValidateSceneConfigurationOptions | number
): SceneConfigurationInput {
  const maxDurationMs = typeof options === "number" ? options : options?.maxDurationMs;
  const targetDurationMs =
    typeof options === "object" && options !== null ? options.targetDurationMs : undefined;
  const campaignClientId =
    typeof options === "object" && options !== null ? options.campaignClientId : undefined;

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

  // Reject prohibited planner-supplied fields
  if ("referenceIds" in record && record.referenceIds !== undefined) {
    throw new SceneConfigurationValidationError(
      "referenceIds is not permitted in planner response; use references array"
    );
  }
  if ("sceneId" in record && record.sceneId !== undefined) {
    throw new SceneConfigurationValidationError("sceneId cannot be supplied by planner");
  }
  if ("specRevision" in record && record.specRevision !== undefined) {
    throw new SceneConfigurationValidationError("specRevision cannot be supplied by planner");
  }

  // 1. Prompt validation
  if (typeof record.prompt !== "string" || record.prompt.trim().length === 0) {
    throw new SceneConfigurationValidationError("prompt must be a non-empty string");
  }
  const prompt = record.prompt.trim();

  // 2. Validate with canonical ScenePlannerResponseSchema
  const parsed = ScenePlannerResponseSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new SceneConfigurationValidationError(
      `Invalid planner response: ${issue?.path.join(".")} ${issue?.message}`
    );
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

  // 6. References validation and server-constructed bindings
  const allowedAssetsMap = new Map(
    resolvedReferenceAssets.map((asset) => [asset.id as string, asset])
  );

  const seenPairs = new Set<string>();
  const constructedBindings: SceneReferenceBindingInput[] = [];

  for (const rawRef of record.references as unknown[]) {
    if (typeof rawRef !== "object" || rawRef === null || Array.isArray(rawRef)) {
      throw new SceneConfigurationValidationError("Each reference assignment must be an object");
    }
    const refObj = rawRef as Record<string, unknown>;
    if (
      "sceneId" in refObj ||
      "specRevision" in refObj ||
      "weight" in refObj ||
      "hints" in refObj ||
      "archivedAt" in refObj
    ) {
      throw new SceneConfigurationValidationError(
        "Planner references cannot include sceneId, specRevision, weight, hints, or archivedAt"
      );
    }
  }

  for (const ref of parsed.data.references) {
    const pairKey = `${ref.referenceId}:${ref.role}`;
    if (seenPairs.has(pairKey)) {
      throw new SceneConfigurationValidationError(
        `Duplicate reference assignment: referenceId "${ref.referenceId}" with role "${ref.role}" is assigned more than once`
      );
    }
    seenPairs.add(pairKey);

    const asset = allowedAssetsMap.get(ref.referenceId);
    if (!asset) {
      throw new SceneConfigurationValidationError(
        `referenceId "${ref.referenceId}" is not present in resolved reference assets`
      );
    }
    if (campaignClientId !== undefined) {
      assertReferenceAssetSelectable(asset, campaignClientId);
    } else if (asset.archivedAt != null) {
      throw new ArchivedReferenceBindingError(asset.id);
    }

    constructedBindings.push({
      referenceAssetId: ref.referenceId as ReferenceAssetId,
      role: ref.role,
      weight: null,
      hints: null
    });
  }

  // Deterministically sort bindings by asset ID then role for canonical persistence
  const sortedBindings = [...constructedBindings].sort((a, b) => {
    const idComp = (a.referenceAssetId as string).localeCompare(b.referenceAssetId as string);
    if (idComp !== 0) return idComp;
    return a.role.localeCompare(b.role);
  });

  // Deterministic unique referenceIds projection derived from bindings
  const referenceIds = Object.freeze([...new Set(sortedBindings.map((b) => b.referenceAssetId))]);

  const validated: SceneConfigurationInput = {
    prompt,
    referenceIds,
    ...(sortedBindings.length > 0 ? { referenceBindings: Object.freeze(sortedBindings) } : {}),
    engineProfileId,
    durationMs,
    ...(loraConfigurationId !== undefined ? { loraConfigurationId } : {})
  };

  return Object.freeze(validated);
}
