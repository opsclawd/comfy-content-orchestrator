import { CreativeBriefSchema, type CreativeBrief } from "@cco/contracts";

export class CampaignBeatSheetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignBeatSheetValidationError";
  }
}

export const BEAT_SHEET_DURATION_TOLERANCE_MS = 0;

export interface CampaignBeat {
  readonly ordinal: number;
  readonly brief: CreativeBrief;
  readonly targetDurationMs: number;
}

export interface ValidatedCampaignBeatSheet {
  readonly beats: readonly CampaignBeat[];
}

export interface ValidateCampaignBeatSheetParams {
  readonly totalScenes: number;
  readonly targetTotalDurationMs: number;
}

export function validateCampaignBeatSheet(
  candidate: unknown,
  params: ValidateCampaignBeatSheetParams
): ValidatedCampaignBeatSheet {
  if (typeof candidate !== "object" || candidate === null) {
    throw new CampaignBeatSheetValidationError("Candidate must be an object");
  }

  const rawBeats = Array.isArray(candidate)
    ? candidate
    : (candidate as Record<string, unknown>).beats;

  if (!Array.isArray(rawBeats)) {
    throw new CampaignBeatSheetValidationError("Candidate must contain a 'beats' array");
  }

  if (rawBeats.length !== params.totalScenes) {
    throw new CampaignBeatSheetValidationError(
      `beats array must contain exactly ${params.totalScenes} beats, got ${rawBeats.length}`
    );
  }

  const validatedBeats: CampaignBeat[] = [];
  const seenOrdinals = new Set<number>();

  for (let i = 0; i < rawBeats.length; i++) {
    const rawBeat = rawBeats[i];
    if (typeof rawBeat !== "object" || rawBeat === null || Array.isArray(rawBeat)) {
      throw new CampaignBeatSheetValidationError(`Beat at index ${i} must be a plain object`);
    }

    const beatRecord = rawBeat as Record<string, unknown>;

    // 1. Ordinal validation
    if (
      typeof beatRecord.ordinal !== "number" ||
      !Number.isInteger(beatRecord.ordinal) ||
      beatRecord.ordinal <= 0
    ) {
      throw new CampaignBeatSheetValidationError(
        `Beat at index ${i} must have an ordinal that is a positive integer`
      );
    }
    const ordinal = beatRecord.ordinal;

    if (ordinal < 1 || ordinal > params.totalScenes) {
      throw new CampaignBeatSheetValidationError(
        `Beat ordinal ${ordinal} is out of range 1..${params.totalScenes}`
      );
    }

    if (seenOrdinals.has(ordinal)) {
      throw new CampaignBeatSheetValidationError(`Duplicate beat ordinal ${ordinal}`);
    }
    seenOrdinals.add(ordinal);

    // 2. Creative brief validation
    const parsedBrief = CreativeBriefSchema.safeParse(beatRecord.brief);
    if (!parsedBrief.success) {
      const issues = parsedBrief.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(", ");
      throw new CampaignBeatSheetValidationError(
        `Beat ${ordinal} brief failed validation: ${issues}`
      );
    }
    const brief = parsedBrief.data;

    // 3. Duration validation
    if (
      typeof beatRecord.targetDurationMs !== "number" ||
      !Number.isInteger(beatRecord.targetDurationMs) ||
      beatRecord.targetDurationMs <= 0
    ) {
      throw new CampaignBeatSheetValidationError(
        `Beat ${ordinal} targetDurationMs must be a positive integer`
      );
    }
    const targetDurationMs = beatRecord.targetDurationMs;

    validatedBeats.push({
      ordinal,
      brief,
      targetDurationMs
    });
  }

  // Ensure all ordinals 1..totalScenes are present
  for (let ord = 1; ord <= params.totalScenes; ord++) {
    if (!seenOrdinals.has(ord)) {
      throw new CampaignBeatSheetValidationError(
        `Missing beat ordinal ${ord}; all ordinals 1..${params.totalScenes} must be present`
      );
    }
  }

  // 4. Total duration sum validation
  const totalDurationMs = validatedBeats.reduce((sum, b) => sum + b.targetDurationMs, 0);
  if (Math.abs(totalDurationMs - params.targetTotalDurationMs) > BEAT_SHEET_DURATION_TOLERANCE_MS) {
    throw new CampaignBeatSheetValidationError(
      `sum of beat durations (${totalDurationMs}ms) does not match targetTotalDurationMs (${params.targetTotalDurationMs}ms)`
    );
  }

  // Sort beats by ordinal
  validatedBeats.sort((a, b) => a.ordinal - b.ordinal);

  return Object.freeze({
    beats: Object.freeze(validatedBeats.map((beat) => Object.freeze(beat)))
  });
}
