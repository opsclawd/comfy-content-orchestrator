import { z } from "zod";
import type {
  ShotPlanDocument,
  ShotPlanTemporalBeat,
  ShotPlanSubjectBlocking
} from "./shot-plan.js";
import type { ShotPlanReviewItem } from "./scene-review.js";
import {
  shotFramingLabel,
  cameraAngleLabel,
  cameraMovementLabel,
  movementSpeedLabel,
  blockingPositionLabel,
  lightingStyleLabel,
  blockingRoleLabel,
  routingModeLabel,
  frameAnchorTargetLabel,
  formatDurationSecondsLabel
} from "./shot-plan-labels.js";

// ============================================================================
// ShotPlanSemanticDiff — deterministic, read-only structured comparison of
// two same-scene ShotPlans (#371).
//
// This module performs NO input validation (no zod-parsing of the supplied
// ShotPlan values) and NEVER mutates its inputs. See design doc R1-R4:
//
// R1 — The Review Hub read-model backfills missing `structured_plan` keys
//   with values that can fall outside their declared zod enum (e.g.
//   `movementSpeed: "normal"`, which is not a member of MOVEMENT_SPEEDS).
//   Enum-typed fields are therefore always formatted through the tolerant
//   label accessors in ./shot-plan-labels.js (which fall back to
//   humanizeToken for unknown tokens) rather than a strict lookup, and this
//   module never zod-parses its inputs.
//
// R2 — `boundReferences` on ShotPlanReviewItem is scrubbed to `[]` for stale
//   (non-current) revisions by the read-model mapper. Diffing it directly
//   would report spurious removals purely because of staleness, not because
//   the director changed anything. We therefore compare only
//   `subjects[].referenceAssetId`, which is intrinsic to the ShotPlan
//   document itself and not scrubbed.
//
// Disposition (design D8) — human-readable enum labels (`Medium close-up`,
// `Slow`, `Warm practical`, …) are imported from ./shot-plan-labels.js and
// never re-declared here. Counterexample considered and rejected: inlining a
// second copy of the label maps in this module would be more locally
// convenient, but `apps/web/src/components/format-review-value.ts` already
// owns that vocabulary; two label maps for the same enums would drift out of
// sync as new tokens are added. This module therefore has exactly one label
// source of truth, and `format-review-value.ts` delegates to it.
// ============================================================================

export const SHOT_PLAN_DIFF_MODEL_VERSION = 1 as const;

export const SHOT_PLAN_DIFF_READ_ONLY_NOTICE =
  "SHOTPLAN COMPARISON — READ-ONLY PROJECTION, NOT APPROVAL AUTHORITY" as const;

// ----------------------------------------------------------------------------
// Types & schemas
// ----------------------------------------------------------------------------

export const SHOT_PLAN_DIFF_STATUSES = ["unchanged", "changed", "added", "removed"] as const;
export const ShotPlanDiffStatusSchema = z.enum(SHOT_PLAN_DIFF_STATUSES);
export type ShotPlanDiffStatus = z.infer<typeof ShotPlanDiffStatusSchema>;

export const SHOT_PLAN_DIFF_VALUE_KINDS = [
  "enum",
  "text",
  "number",
  "duration",
  "list",
  "absent"
] as const;
export const ShotPlanDiffValueKindSchema = z.enum(SHOT_PLAN_DIFF_VALUE_KINDS);
export type ShotPlanDiffValueKind = z.infer<typeof ShotPlanDiffValueKindSchema>;

export const ShotPlanDiffValueSchema = z.object({
  kind: ShotPlanDiffValueKindSchema,
  raw: z.union([z.string(), z.number(), z.array(z.string()), z.null()]),
  display: z.string().nullable()
});
export type ShotPlanDiffValue = z.infer<typeof ShotPlanDiffValueSchema>;

export const SHOT_PLAN_DIFF_GROUPS = [
  "framing_camera",
  "timing",
  "staging",
  "beats",
  "environment_lighting",
  "dialogue",
  "routing_continuity"
] as const;
export const ShotPlanDiffGroupSchema = z.enum(SHOT_PLAN_DIFF_GROUPS);
export type ShotPlanDiffGroup = z.infer<typeof ShotPlanDiffGroupSchema>;

export const ShotPlanDiffFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  group: ShotPlanDiffGroupSchema,
  status: ShotPlanDiffStatusSchema,
  before: ShotPlanDiffValueSchema,
  after: ShotPlanDiffValueSchema
});
export type ShotPlanDiffField = z.infer<typeof ShotPlanDiffFieldSchema>;

export const ShotPlanDiffCollectionEntrySchema = z.object({
  entryKey: z.string(),
  label: z.string(),
  status: ShotPlanDiffStatusSchema,
  fields: z.array(ShotPlanDiffFieldSchema)
});
export type ShotPlanDiffCollectionEntry = z.infer<typeof ShotPlanDiffCollectionEntrySchema>;

export const ShotPlanDiffGroupResultSchema = z.object({
  group: ShotPlanDiffGroupSchema,
  label: z.string(),
  fields: z.array(ShotPlanDiffFieldSchema),
  collections: z.array(ShotPlanDiffCollectionEntrySchema)
});
export type ShotPlanDiffGroupResult = z.infer<typeof ShotPlanDiffGroupResultSchema>;

export const ShotPlanDiffSideSchema = z.object({
  shotPlanId: z.string(),
  sceneId: z.string(),
  variantOrdinal: z.number().int().positive(),
  specRevision: z.number().int().positive(),
  status: z.string(),
  isCurrentRevision: z.boolean()
});
export type ShotPlanDiffSide = z.infer<typeof ShotPlanDiffSideSchema>;

export const SHOT_PLAN_DIFF_LINEAGE_RESOLUTIONS = [
  "derivation_provenance",
  "derived_from_id",
  "unresolved"
] as const;
export const ShotPlanDiffLineageResolutionSchema = z.enum(SHOT_PLAN_DIFF_LINEAGE_RESOLUTIONS);
export type ShotPlanDiffLineageResolution = z.infer<typeof ShotPlanDiffLineageResolutionSchema>;

export const ShotPlanDiffLineageSchema = z.object({
  resolution: ShotPlanDiffLineageResolutionSchema,
  sourceShotPlanId: z.string().nullable(),
  sourcePlan: z.unknown().nullable(),
  expectedSourceVariantOrdinal: z.number().int().positive().nullable(),
  lineageOrdinalMismatch: z.boolean()
});
export interface ShotPlanDiffLineage {
  readonly resolution: ShotPlanDiffLineageResolution;
  readonly sourceShotPlanId: string | null;
  readonly sourcePlan: ShotPlanDocument | ShotPlanReviewItem | null;
  readonly expectedSourceVariantOrdinal: number | null;
  readonly lineageOrdinalMismatch: boolean;
}

export const SHOT_PLAN_COMPARISON_SCOPES = ["current", "historical"] as const;
export const ShotPlanComparisonScopeSchema = z.enum(SHOT_PLAN_COMPARISON_SCOPES);
export type ShotPlanComparisonScope = z.infer<typeof ShotPlanComparisonScopeSchema>;

export const ShotPlanComparabilitySchema = z.object({
  eligible: z.boolean(),
  scope: ShotPlanComparisonScopeSchema,
  rejectionCode: z.string().nullable(),
  revisionMismatch: z.boolean(),
  staleSource: z.boolean(),
  staleTarget: z.boolean()
});
export type ShotPlanComparability = z.infer<typeof ShotPlanComparabilitySchema>;

export const ShotPlanSemanticDiffSchema = z.object({
  diffModelVersion: z.literal(SHOT_PLAN_DIFF_MODEL_VERSION),
  sceneId: z.string(),
  comparisonScope: ShotPlanComparisonScopeSchema,
  source: ShotPlanDiffSideSchema,
  target: ShotPlanDiffSideSchema,
  lineage: ShotPlanDiffLineageSchema,
  groups: z.array(ShotPlanDiffGroupResultSchema),
  changedFieldCount: z.number().int().nonnegative(),
  unchangedFieldCount: z.number().int().nonnegative(),
  hasMaterialChanges: z.boolean(),
  readOnlyNotice: z.string()
});
export interface ShotPlanSemanticDiff {
  readonly diffModelVersion: typeof SHOT_PLAN_DIFF_MODEL_VERSION;
  readonly sceneId: string;
  readonly comparisonScope: ShotPlanComparisonScope;
  readonly source: ShotPlanDiffSide;
  readonly target: ShotPlanDiffSide;
  readonly lineage: ShotPlanDiffLineage;
  readonly groups: readonly ShotPlanDiffGroupResult[];
  readonly changedFieldCount: number;
  readonly unchangedFieldCount: number;
  readonly hasMaterialChanges: boolean;
  readonly readOnlyNotice: string;
}

export class ShotPlanComparisonRejectedError extends Error {
  readonly code: "CROSS_SCENE_COMPARISON" | "SAME_SHOT_PLAN";

  constructor(code: "CROSS_SCENE_COMPARISON" | "SAME_SHOT_PLAN", message: string) {
    super(message);
    this.name = "ShotPlanComparisonRejectedError";
    this.code = code;
  }
}

// ----------------------------------------------------------------------------
// Normalization — accepts ShotPlanDocument | ShotPlanReviewItem interchangeably
// ----------------------------------------------------------------------------

type AnyShotPlan = ShotPlanDocument | ShotPlanReviewItem;

interface NormalizedShotPlan {
  readonly shotPlanId: string;
  readonly sceneId: string;
  readonly specRevision: number;
  readonly variantOrdinal: number;
  readonly status: string;
  readonly isCurrentRevision: boolean;
  readonly routingMode: string;
  readonly framing: string;
  readonly angle: string;
  readonly lensIntent: string;
  readonly cameraPosition: string;
  readonly cameraMovement: string;
  readonly movementSpeed: string;
  readonly cameraPromptDescription: string;
  readonly targetDurationMs: number;
  readonly targetFrameCount: number;
  readonly subjects: readonly ShotPlanSubjectBlocking[];
  readonly actionSummary: string;
  readonly beats: readonly ShotPlanTemporalBeat[];
  readonly lightingStyle: string;
  readonly environmentDescription: string;
  readonly colorPalette: readonly string[];
  readonly atmosphere: string | null;
  readonly dialogue: {
    readonly speaker: string | null;
    readonly line: string | null;
    readonly voiceoverCue: string | null;
    readonly audioFxPrompt: string | null;
    readonly deliveryEmotion: string | null;
  } | null;
  readonly routingContinuity: {
    readonly frameAnchorTarget: string;
    readonly anchorCandidateId: string | null;
    readonly persistentSubjectIds: readonly string[];
    readonly lightingContinuityNote: string | null;
    readonly incomingContinuityFromSceneId: string | null;
  };
  readonly derivedFromShotPlanId: string | null;
  readonly derivationSourceShotPlanId: string | null;
  readonly derivationSourceVariantOrdinal: number | null;
}

function normalizeShotPlan(plan: AnyShotPlan): NormalizedShotPlan {
  const shotPlanId =
    "shotPlanId" in plan && typeof plan.shotPlanId === "string"
      ? plan.shotPlanId
      : (plan as ShotPlanDocument).id;

  const isCurrentRevision =
    "isCurrentRevision" in plan && typeof plan.isCurrentRevision === "boolean"
      ? plan.isCurrentRevision
      : true;

  const continuity = plan.continuity;

  return {
    shotPlanId,
    sceneId: plan.sceneId,
    specRevision: plan.specRevision,
    variantOrdinal: plan.variantOrdinal ?? 1,
    status: plan.status,
    isCurrentRevision,
    routingMode: plan.routingMode,
    framing: plan.framing,
    angle: plan.angle,
    lensIntent: plan.lensIntent,
    cameraPosition: plan.cameraPosition,
    cameraMovement: plan.cameraMovement,
    movementSpeed: plan.movementSpeed,
    cameraPromptDescription: plan.cameraPromptDescription,
    targetDurationMs: plan.targetDurationMs,
    targetFrameCount: plan.targetFrameCount,
    subjects: plan.subjects ?? [],
    actionSummary: plan.actionSummary,
    beats: plan.beats ?? [],
    lightingStyle: plan.lightingStyle,
    environmentDescription: plan.environmentDescription,
    colorPalette: plan.colorPalette ?? [],
    atmosphere: plan.atmosphere ?? null,
    dialogue:
      plan.dialogue &&
      (plan.dialogue.speaker ||
        plan.dialogue.line ||
        plan.dialogue.voiceoverCue ||
        plan.dialogue.audioFxPrompt ||
        plan.dialogue.deliveryEmotion)
        ? {
            speaker: plan.dialogue.speaker ?? null,
            line: plan.dialogue.line ?? null,
            voiceoverCue: plan.dialogue.voiceoverCue ?? null,
            audioFxPrompt: plan.dialogue.audioFxPrompt ?? null,
            deliveryEmotion: plan.dialogue.deliveryEmotion ?? null
          }
        : null,
    routingContinuity: {
      frameAnchorTarget: continuity?.frameAnchorTarget ?? "none",
      anchorCandidateId: continuity?.anchorCandidateId ?? null,
      persistentSubjectIds: continuity?.persistentSubjectIds ?? [],
      lightingContinuityNote: continuity?.lightingContinuityNote ?? null,
      incomingContinuityFromSceneId: continuity?.incomingContinuityFromSceneId ?? null
    },
    derivedFromShotPlanId: plan.derivedFromShotPlanId ?? null,
    derivationSourceShotPlanId: plan.derivation?.sourceShotPlanId ?? null,
    derivationSourceVariantOrdinal: plan.derivation?.sourceVariantOrdinal ?? null
  };
}

function toDiffSide(plan: NormalizedShotPlan): ShotPlanDiffSide {
  return {
    shotPlanId: plan.shotPlanId,
    sceneId: plan.sceneId,
    variantOrdinal: plan.variantOrdinal,
    specRevision: plan.specRevision,
    status: plan.status,
    isCurrentRevision: plan.isCurrentRevision
  };
}

// ----------------------------------------------------------------------------
// Scalar field diffing — static, declaration-ordered field spec table
// ----------------------------------------------------------------------------

interface FieldSpec {
  readonly key: string;
  readonly label: string;
  readonly group: ShotPlanDiffGroup;
  readonly kind: ShotPlanDiffValueKind;
  readonly read: (plan: NormalizedShotPlan) => string | number | readonly string[] | null;
  readonly display: (raw: string | number | readonly string[] | null) => string | null;
}

function textDisplay(raw: string | number | readonly string[] | null): string | null {
  return raw === null ? null : String(raw);
}

// Disposition (design D6/A4): list-kind fields (`colorPalette`,
// `continuity.persistentSubjectIds`) are compared order-sensitively via
// `rawEquals` below and displayed with `join(", ")`. Counterexample
// considered and rejected: sorting both sides before comparing would make a
// reordered `colorPalette` report `unchanged`, but palette order is creative
// intent and `persistentSubjectIds` order is exactly how the planner emitted
// it — silently ignoring a reorder would hide a real planner change from the
// director. Order differences therefore always yield `changed`.
function listDisplay(raw: string | number | readonly string[] | null): string | null {
  if (raw === null) return null;
  const list = raw as readonly string[];
  return list.length > 0 ? list.join(", ") : null;
}

const SHOT_PLAN_DIFF_FIELD_SPECS: readonly FieldSpec[] = [
  {
    key: "framing",
    label: "Framing",
    group: "framing_camera",
    kind: "enum",
    read: (p) => p.framing,
    display: (raw) => (raw === null ? null : shotFramingLabel(String(raw)))
  },
  {
    key: "angle",
    label: "Angle",
    group: "framing_camera",
    kind: "enum",
    read: (p) => p.angle,
    display: (raw) => (raw === null ? null : cameraAngleLabel(String(raw)))
  },
  {
    key: "lensIntent",
    label: "Lens",
    group: "framing_camera",
    kind: "text",
    read: (p) => p.lensIntent,
    display: textDisplay
  },
  {
    key: "cameraPosition",
    label: "Camera Position",
    group: "framing_camera",
    kind: "text",
    read: (p) => p.cameraPosition,
    display: textDisplay
  },
  {
    key: "cameraMovement",
    label: "Camera",
    group: "framing_camera",
    kind: "enum",
    read: (p) => p.cameraMovement,
    display: (raw) => (raw === null ? null : cameraMovementLabel(String(raw)))
  },
  {
    key: "movementSpeed",
    label: "Movement Speed",
    group: "framing_camera",
    kind: "enum",
    read: (p) => p.movementSpeed,
    display: (raw) => (raw === null ? null : movementSpeedLabel(String(raw)))
  },
  {
    key: "cameraPromptDescription",
    label: "Camera Prompt",
    group: "framing_camera",
    kind: "text",
    read: (p) => p.cameraPromptDescription,
    display: textDisplay
  },
  {
    key: "targetDurationMs",
    label: "Duration",
    group: "timing",
    kind: "duration",
    read: (p) => p.targetDurationMs,
    display: (raw) => (raw === null ? null : formatDurationSecondsLabel(Number(raw)))
  },
  {
    key: "targetFrameCount",
    label: "Frame Count",
    group: "timing",
    kind: "number",
    read: (p) => p.targetFrameCount,
    display: textDisplay
  },
  {
    key: "subjects.count",
    label: "Subject Count",
    group: "staging",
    kind: "number",
    read: (p) => p.subjects.length,
    display: textDisplay
  },
  {
    key: "actionSummary",
    label: "Action",
    group: "staging",
    kind: "text",
    read: (p) => p.actionSummary,
    display: textDisplay
  },
  {
    key: "beats.count",
    label: "Beat Count",
    group: "beats",
    kind: "number",
    read: (p) => p.beats.length,
    display: textDisplay
  },
  {
    key: "lightingStyle",
    label: "Lighting",
    group: "environment_lighting",
    kind: "enum",
    read: (p) => p.lightingStyle,
    display: (raw) => (raw === null ? null : lightingStyleLabel(String(raw)))
  },
  {
    key: "environmentDescription",
    label: "Environment",
    group: "environment_lighting",
    kind: "text",
    read: (p) => p.environmentDescription,
    display: textDisplay
  },
  {
    key: "colorPalette",
    label: "Palette",
    group: "environment_lighting",
    kind: "list",
    read: (p) => p.colorPalette,
    display: listDisplay
  },
  {
    key: "atmosphere",
    label: "Atmosphere",
    group: "environment_lighting",
    kind: "text",
    read: (p) => p.atmosphere,
    display: textDisplay
  },
  {
    key: "dialogue.speaker",
    label: "Speaker",
    group: "dialogue",
    kind: "text",
    read: (p) => p.dialogue?.speaker ?? null,
    display: textDisplay
  },
  {
    key: "dialogue.line",
    label: "Line",
    group: "dialogue",
    kind: "text",
    read: (p) => p.dialogue?.line ?? null,
    display: textDisplay
  },
  {
    key: "dialogue.voiceoverCue",
    label: "Voiceover Cue",
    group: "dialogue",
    kind: "text",
    read: (p) => p.dialogue?.voiceoverCue ?? null,
    display: textDisplay
  },
  {
    key: "dialogue.audioFxPrompt",
    label: "Audio FX",
    group: "dialogue",
    kind: "text",
    read: (p) => p.dialogue?.audioFxPrompt ?? null,
    display: textDisplay
  },
  {
    key: "dialogue.deliveryEmotion",
    label: "Delivery Emotion",
    group: "dialogue",
    kind: "text",
    read: (p) => p.dialogue?.deliveryEmotion ?? null,
    display: textDisplay
  },
  {
    key: "routingMode",
    label: "Routing Mode",
    group: "routing_continuity",
    kind: "enum",
    read: (p) => p.routingMode,
    display: (raw) => (raw === null ? null : routingModeLabel(String(raw)))
  },
  {
    key: "continuity.frameAnchorTarget",
    label: "Frame Anchor Target",
    group: "routing_continuity",
    kind: "enum",
    read: (p) => p.routingContinuity.frameAnchorTarget,
    display: (raw) => (raw === null ? null : frameAnchorTargetLabel(String(raw)))
  },
  {
    key: "continuity.anchorCandidateId",
    label: "Anchor Candidate",
    group: "routing_continuity",
    kind: "text",
    read: (p) => p.routingContinuity.anchorCandidateId,
    display: textDisplay
  },
  {
    key: "continuity.persistentSubjectIds",
    label: "Persistent Subjects",
    group: "routing_continuity",
    kind: "list",
    read: (p) => p.routingContinuity.persistentSubjectIds,
    display: listDisplay
  },
  {
    key: "continuity.lightingContinuityNote",
    label: "Lighting Continuity Note",
    group: "routing_continuity",
    kind: "text",
    read: (p) => p.routingContinuity.lightingContinuityNote,
    display: textDisplay
  },
  {
    key: "continuity.incomingContinuityFromSceneId",
    label: "Incoming Continuity Scene",
    group: "routing_continuity",
    kind: "text",
    read: (p) => p.routingContinuity.incomingContinuityFromSceneId,
    display: textDisplay
  }
];

const GROUP_LABELS: Record<ShotPlanDiffGroup, string> = {
  framing_camera: "Framing & Camera",
  timing: "Timing",
  staging: "Staging & Blocking",
  beats: "Temporal Beats",
  environment_lighting: "Environment & Lighting",
  dialogue: "Dialogue / VO",
  routing_continuity: "Routing & Continuity"
};

function isListRaw(raw: string | number | readonly string[] | null): raw is readonly string[] {
  return Array.isArray(raw);
}

function rawEquals(
  a: string | number | readonly string[] | null,
  b: string | number | readonly string[] | null
): boolean {
  if (isListRaw(a) && isListRaw(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

function buildScalarValue(
  kind: ShotPlanDiffValueKind,
  raw: string | number | readonly string[] | null,
  display: string | null
): ShotPlanDiffValue {
  if (raw === null) {
    return { kind: "absent", raw: null, display: null };
  }
  const normalizedRaw: string | number | string[] = Array.isArray(raw)
    ? [...(raw as readonly string[])]
    : (raw as string | number);
  return { kind, raw: normalizedRaw, display };
}

function diffScalarFields(
  source: NormalizedShotPlan,
  target: NormalizedShotPlan
): ShotPlanDiffField[] {
  return SHOT_PLAN_DIFF_FIELD_SPECS.map((spec) => {
    const sourceRaw = spec.read(source);
    const targetRaw = spec.read(target);
    const before = buildScalarValue(spec.kind, sourceRaw, spec.display(sourceRaw));
    const after = buildScalarValue(spec.kind, targetRaw, spec.display(targetRaw));

    let status: ShotPlanDiffStatus;
    if (sourceRaw === null && targetRaw !== null) {
      status = "added";
    } else if (sourceRaw !== null && targetRaw === null) {
      status = "removed";
    } else if (rawEquals(sourceRaw, targetRaw)) {
      status = "unchanged";
    } else {
      status = "changed";
    }

    return {
      key: spec.key,
      label: spec.label,
      group: spec.group,
      status,
      before,
      after
    };
  });
}

// ----------------------------------------------------------------------------
// Collection diffing — subjects (identity-keyed by subjectId + occurrence)
// ----------------------------------------------------------------------------

interface KeyedSubject {
  readonly entryKey: string;
  readonly label: string;
  readonly subject: ShotPlanSubjectBlocking;
}

function keySubjects(subjects: readonly ShotPlanSubjectBlocking[]): KeyedSubject[] {
  const seen = new Map<string, number>();
  return subjects.map((subject) => {
    const count = (seen.get(subject.subjectId) ?? 0) + 1;
    seen.set(subject.subjectId, count);
    const entryKey = count === 1 ? subject.subjectId : `${subject.subjectId}#${count}`;
    const rolePrefix = blockingRoleLabel(subject.role);
    return {
      entryKey,
      label: `${rolePrefix}: ${subject.subjectId}`,
      subject
    };
  });
}

function diffSubjectFields(
  before: ShotPlanSubjectBlocking | null,
  after: ShotPlanSubjectBlocking | null
): ShotPlanDiffField[] {
  const fieldDefs: ReadonlyArray<{
    key: string;
    label: string;
    read: (s: ShotPlanSubjectBlocking) => string | null;
    kind: ShotPlanDiffValueKind;
    display: (raw: string | null) => string | null;
  }> = [
    {
      key: "role",
      label: "Role",
      read: (s) => s.role,
      kind: "enum",
      display: (r) => (r === null ? null : blockingRoleLabel(r))
    },
    {
      key: "initialPosition",
      label: "Position",
      read: (s) => s.initialPosition,
      kind: "enum",
      display: (r) => (r === null ? null : blockingPositionLabel(r))
    },
    {
      key: "movementTrajectory",
      label: "Trajectory",
      read: (s) => s.movementTrajectory,
      kind: "text",
      display: (r) => r
    },
    {
      key: "interactionSummary",
      label: "Interaction",
      read: (s) => s.interactionSummary ?? null,
      kind: "text",
      display: (r) => r
    },
    {
      key: "referenceAssetId",
      label: "Reference Asset",
      read: (s) => s.referenceAssetId ?? null,
      kind: "text",
      display: (r) => r
    }
  ];

  return fieldDefs.map((def) => {
    const sourceRaw = before ? def.read(before) : null;
    const targetRaw = after ? def.read(after) : null;
    const status: ShotPlanDiffStatus =
      sourceRaw === null && targetRaw !== null
        ? "added"
        : sourceRaw !== null && targetRaw === null
          ? "removed"
          : sourceRaw === targetRaw
            ? "unchanged"
            : "changed";
    return {
      key: `subjects.${def.key}`,
      label: def.label,
      group: "staging" as const,
      status,
      before: buildScalarValue(def.kind, sourceRaw, def.display(sourceRaw)),
      after: buildScalarValue(def.kind, targetRaw, def.display(targetRaw))
    };
  });
}

function diffSubjects(
  source: readonly ShotPlanSubjectBlocking[],
  target: readonly ShotPlanSubjectBlocking[]
): ShotPlanDiffCollectionEntry[] {
  const sourceKeyed = keySubjects(source);
  const targetKeyed = keySubjects(target);
  const targetByKey = new Map(targetKeyed.map((t) => [t.entryKey, t]));
  const sourceByKey = new Map(sourceKeyed.map((s) => [s.entryKey, s]));

  const entries: ShotPlanDiffCollectionEntry[] = [];

  for (const s of sourceKeyed) {
    const t = targetByKey.get(s.entryKey);
    const fields = diffSubjectFields(s.subject, t?.subject ?? null);
    const status: ShotPlanDiffStatus = t
      ? fields.some((f) => f.status !== "unchanged")
        ? "changed"
        : "unchanged"
      : "removed";
    entries.push({
      entryKey: s.entryKey,
      label: t ? t.label : s.label,
      status,
      fields
    });
  }

  for (const t of targetKeyed) {
    if (!sourceByKey.has(t.entryKey)) {
      entries.push({
        entryKey: t.entryKey,
        label: t.label,
        status: "added",
        fields: diffSubjectFields(null, t.subject)
      });
    }
  }

  return entries;
}

// ----------------------------------------------------------------------------
// Collection diffing — temporal beats (identity-keyed by beatIndex)
// ----------------------------------------------------------------------------

function diffBeatFields(
  before: ShotPlanTemporalBeat | null,
  after: ShotPlanTemporalBeat | null
): ShotPlanDiffField[] {
  const fieldDefs: ReadonlyArray<{
    key: string;
    label: string;
    kind: ShotPlanDiffValueKind;
    read: (b: ShotPlanTemporalBeat) => string | number | null;
  }> = [
    { key: "startMs", label: "Start", kind: "number", read: (b) => b.startMs },
    { key: "endMs", label: "End", kind: "number", read: (b) => b.endMs },
    { key: "description", label: "Description", kind: "text", read: (b) => b.description },
    { key: "cameraAction", label: "Camera Action", kind: "text", read: (b) => b.cameraAction },
    { key: "subjectAction", label: "Subject Action", kind: "text", read: (b) => b.subjectAction }
  ];

  const isTimingKey = (key: string) => key === "startMs" || key === "endMs";

  return fieldDefs.map((def) => {
    const sourceRaw = before ? def.read(before) : null;
    const targetRaw = after ? def.read(after) : null;
    const status: ShotPlanDiffStatus =
      sourceRaw === null && targetRaw !== null
        ? "added"
        : sourceRaw !== null && targetRaw === null
          ? "removed"
          : sourceRaw === targetRaw
            ? "unchanged"
            : "changed";

    let afterDisplay = targetRaw === null ? null : String(targetRaw);
    if (
      status === "changed" &&
      isTimingKey(def.key) &&
      typeof sourceRaw === "number" &&
      typeof targetRaw === "number"
    ) {
      const deltaMs = targetRaw - sourceRaw;
      const sign = deltaMs > 0 ? "+" : "";
      afterDisplay = `${targetRaw} (${sign}${deltaMs}ms)`;
    }

    return {
      key: `beats.${def.key}`,
      label: def.label,
      group: "beats" as const,
      status,
      before: buildScalarValue(def.kind, sourceRaw, sourceRaw === null ? null : String(sourceRaw)),
      after: buildScalarValue(def.kind, targetRaw, afterDisplay)
    };
  });
}

function diffBeats(
  source: readonly ShotPlanTemporalBeat[],
  target: readonly ShotPlanTemporalBeat[]
): ShotPlanDiffCollectionEntry[] {
  const sourceByIndex = new Map(source.map((b) => [b.beatIndex, b]));
  const targetByIndex = new Map(target.map((b) => [b.beatIndex, b]));
  const allIndices = Array.from(new Set([...sourceByIndex.keys(), ...targetByIndex.keys()])).sort(
    (a, b) => a - b
  );

  return allIndices.map((beatIndex) => {
    const before = sourceByIndex.get(beatIndex) ?? null;
    const after = targetByIndex.get(beatIndex) ?? null;
    const fields = diffBeatFields(before, after);
    const status: ShotPlanDiffStatus = !before
      ? "added"
      : !after
        ? "removed"
        : fields.some((f) => f.status !== "unchanged")
          ? "changed"
          : "unchanged";

    return {
      entryKey: String(beatIndex),
      label: `Beat ${beatIndex}`,
      status,
      fields
    };
  });
}

// ----------------------------------------------------------------------------
// Group assembly
// ----------------------------------------------------------------------------

function buildGroups(
  source: NormalizedShotPlan,
  target: NormalizedShotPlan
): ShotPlanDiffGroupResult[] {
  const scalarFields = diffScalarFields(source, target);
  const subjectEntries = diffSubjects(source.subjects, target.subjects);
  const beatEntries = diffBeats(source.beats, target.beats);

  return SHOT_PLAN_DIFF_GROUPS.map((group) => ({
    group,
    label: GROUP_LABELS[group],
    fields: scalarFields.filter((f) => f.group === group),
    collections: group === "staging" ? subjectEntries : group === "beats" ? beatEntries : []
  }));
}

function countFields(groups: readonly ShotPlanDiffGroupResult[]): {
  changed: number;
  unchanged: number;
} {
  let changed = 0;
  let unchanged = 0;

  for (const group of groups) {
    for (const field of group.fields) {
      if (field.status === "unchanged") {
        unchanged += 1;
      } else {
        changed += 1;
      }
    }
    for (const entry of group.collections) {
      for (const field of entry.fields) {
        if (field.status === "unchanged") {
          unchanged += 1;
        } else {
          changed += 1;
        }
      }
    }
  }

  return { changed, unchanged };
}

// ----------------------------------------------------------------------------
// Comparability evaluation
// ----------------------------------------------------------------------------

export function evaluateShotPlanComparability(
  source: AnyShotPlan,
  target: AnyShotPlan,
  currentSpecRevision: number
): ShotPlanComparability {
  const s = normalizeShotPlan(source);
  const t = normalizeShotPlan(target);

  if (s.sceneId !== t.sceneId) {
    return {
      eligible: false,
      scope: "historical",
      rejectionCode: "CROSS_SCENE_COMPARISON",
      revisionMismatch: true,
      staleSource: true,
      staleTarget: true
    };
  }

  if (s.shotPlanId === t.shotPlanId) {
    return {
      eligible: false,
      scope: "historical",
      rejectionCode: "SAME_SHOT_PLAN",
      revisionMismatch: false,
      staleSource: false,
      staleTarget: false
    };
  }

  const staleSource = !s.isCurrentRevision || s.specRevision !== currentSpecRevision;
  const staleTarget = !t.isCurrentRevision || t.specRevision !== currentSpecRevision;
  const revisionMismatch = s.specRevision !== t.specRevision;
  const scope: ShotPlanComparisonScope =
    staleSource || staleTarget || revisionMismatch ? "historical" : "current";

  return {
    eligible: true,
    scope,
    rejectionCode: null,
    revisionMismatch,
    staleSource,
    staleTarget
  };
}

// ----------------------------------------------------------------------------
// Public compute entrypoint
// ----------------------------------------------------------------------------

export interface ComputeShotPlanSemanticDiffOptions {
  readonly currentSpecRevision: number;
}

export function computeShotPlanSemanticDiff(
  source: AnyShotPlan,
  target: AnyShotPlan,
  options: ComputeShotPlanSemanticDiffOptions
): ShotPlanSemanticDiff {
  const comparability = evaluateShotPlanComparability(source, target, options.currentSpecRevision);

  if (!comparability.eligible) {
    if (comparability.rejectionCode === "CROSS_SCENE_COMPARISON") {
      throw new ShotPlanComparisonRejectedError(
        "CROSS_SCENE_COMPARISON",
        "Cannot compare ShotPlans belonging to different scenes."
      );
    }
    throw new ShotPlanComparisonRejectedError(
      "SAME_SHOT_PLAN",
      "Cannot compare a ShotPlan against itself."
    );
  }

  const normalizedSource = normalizeShotPlan(source);
  const normalizedTarget = normalizeShotPlan(target);

  const groups = buildGroups(normalizedSource, normalizedTarget);
  const { changed, unchanged } = countFields(groups);

  const lineage = resolveShotPlanDiffSource(target, [source, target]);

  return {
    diffModelVersion: SHOT_PLAN_DIFF_MODEL_VERSION,
    sceneId: normalizedTarget.sceneId,
    comparisonScope: comparability.scope,
    source: toDiffSide(normalizedSource),
    target: toDiffSide(normalizedTarget),
    lineage,
    groups,
    changedFieldCount: changed,
    unchangedFieldCount: unchanged,
    hasMaterialChanges: changed > 0,
    readOnlyNotice: SHOT_PLAN_DIFF_READ_ONLY_NOTICE
  };
}

// ----------------------------------------------------------------------------
// Lineage resolution
// ----------------------------------------------------------------------------

export function resolveShotPlanDiffSource(
  target: AnyShotPlan,
  candidates: readonly AnyShotPlan[]
): ShotPlanDiffLineage {
  const t = normalizeShotPlan(target);

  const findById = (id: string | null): AnyShotPlan | null => {
    if (!id) return null;
    return (
      candidates.find((c) => {
        const normalized = normalizeShotPlan(c);
        return normalized.shotPlanId === id;
      }) ?? null
    );
  };

  if (t.derivationSourceShotPlanId) {
    const sourcePlan = findById(t.derivationSourceShotPlanId);
    const expectedOrdinal = t.derivationSourceVariantOrdinal;
    const lineageOrdinalMismatch = Boolean(
      sourcePlan &&
      expectedOrdinal !== null &&
      normalizeShotPlan(sourcePlan).variantOrdinal !== expectedOrdinal
    );
    return {
      resolution: sourcePlan ? "derivation_provenance" : "unresolved",
      sourceShotPlanId: t.derivationSourceShotPlanId,
      sourcePlan,
      expectedSourceVariantOrdinal: expectedOrdinal,
      lineageOrdinalMismatch
    };
  }

  if (t.derivedFromShotPlanId) {
    const sourcePlan = findById(t.derivedFromShotPlanId);
    return {
      resolution: sourcePlan ? "derived_from_id" : "unresolved",
      sourceShotPlanId: t.derivedFromShotPlanId,
      sourcePlan,
      expectedSourceVariantOrdinal: null,
      lineageOrdinalMismatch: false
    };
  }

  return {
    resolution: "unresolved",
    sourceShotPlanId: null,
    sourcePlan: null,
    expectedSourceVariantOrdinal: null,
    lineageOrdinalMismatch: false
  };
}

// ----------------------------------------------------------------------------
// Summary helper for compact rendering
// ----------------------------------------------------------------------------

export interface ShotPlanDiffSummaryRow {
  readonly key: string;
  readonly label: string;
  readonly group: ShotPlanDiffGroup;
  readonly status: ShotPlanDiffStatus;
  readonly beforeDisplay: string | null;
  readonly afterDisplay: string | null;
}

export function summarizeShotPlanDiff(diff: ShotPlanSemanticDiff): ShotPlanDiffSummaryRow[] {
  const rows: ShotPlanDiffSummaryRow[] = [];
  for (const group of diff.groups) {
    for (const field of group.fields) {
      if (field.status !== "unchanged") {
        rows.push({
          key: field.key,
          label: field.label,
          group: group.group,
          status: field.status,
          beforeDisplay: field.before.display,
          afterDisplay: field.after.display
        });
      }
    }
    for (const entry of group.collections) {
      for (const field of entry.fields) {
        if (field.status !== "unchanged") {
          rows.push({
            key: `${entry.entryKey}.${field.key}`,
            label: `${entry.label} — ${field.label}`,
            group: group.group,
            status: field.status,
            beforeDisplay: field.before.display,
            afterDisplay: field.after.display
          });
        }
      }
    }
  }
  return rows;
}
