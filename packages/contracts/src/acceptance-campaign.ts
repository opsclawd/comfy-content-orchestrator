import { sortKeysDeep } from "@cco/shared";
import { z } from "zod";
import { ReferenceRoleSchema } from "./reference-asset.js";
import {
  CameraMovementSchema,
  LightingStyleSchema,
  ShotPlanRoutingModeSchema
} from "./shot-plan.js";

/**
 * Deterministic fixture/campaign definition for the GPU-based H3 operator acceptance
 * campaign described in issue #373, prepared ahead of #354 (storyboard readability) and
 * #332 (final H3 multi-scene acceptance).
 *
 * This module is intentionally inert: it declares identity constants, a representative
 * 9-scene campaign shape, and coverage-requirement bookkeeping. It never fabricates a
 * ProductionAttempt, GenerationManifest, ShotPlan content/approval, certification result,
 * or accepted output — those remain exclusively human/operator-produced evidence on the
 * physical RTX 4090 render host.
 *
 * All asset slots below are pinned (by sha256) to REAL files already checked into
 * `certification/minimax-h3/minimax-ref2v-visual-qa-001/` — a forbidden-write path for
 * agents that this module only ever reads. Nothing here copies, rewrites, or re-derives
 * those files; the fixture carries the relative path and expected hash, and an
 * infrastructure adapter verifies the hash matches at install time (fail-closed).
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const ACCEPTANCE_CAMPAIGN_FIXTURE_ID = "ACCEPTANCE-H3-REPRESENTATIVE-V1" as const;
export const ACCEPTANCE_CAMPAIGN_FIXTURE_VERSION = 1 as const;

/** Repo-relative root of the read-only certification fixture this campaign is pinned to. */
export const ACCEPTANCE_CAMPAIGN_SOURCE_ROOT =
  "certification/minimax-h3/minimax-ref2v-visual-qa-001" as const;

/**
 * Fixed, synthetic identity constants so the fixture campaign is reconstructable without
 * operator bookkeeping — the same client and idempotency key resolve to the same campaign
 * shell on every install, exactly like `templates/provenance.json` pins workflow identity.
 * These are obviously-synthetic UUIDs (never a real client), chosen to make the fixture's
 * "deterministic/reconstructable" requirement (#373) hold by construction rather than by
 * operator discipline.
 */
export const ACCEPTANCE_CLIENT_ID = "aaaaaaaa-0000-4000-8000-000000000373" as const;
export const ACCEPTANCE_CAMPAIGN_IDEMPOTENCY_KEY = "bbbbbbbb-0000-4000-8000-000000000373" as const;

// ---------------------------------------------------------------------------
// Coverage requirements (R01-R21), mapped to #354 / #332
// ---------------------------------------------------------------------------

export const ACCEPTANCE_COVERAGE_SOURCE_ISSUES = [354, 332] as const;
export const AcceptanceCoverageSourceIssueSchema = z.union([z.literal(354), z.literal(332)]);
export type AcceptanceCoverageSourceIssue = z.infer<typeof AcceptanceCoverageSourceIssueSchema>;

export const ACCEPTANCE_COVERAGE_REQUIREMENT_IDS = [
  "R01",
  "R02",
  "R03",
  "R04",
  "R05",
  "R06",
  "R07",
  "R08",
  "R09",
  "R10",
  "R11",
  "R12",
  "R13",
  "R14",
  "R15",
  "R16",
  "R17",
  "R18",
  "R19",
  "R20",
  "R21",
  "R22",
  "R23",
  "R24",
  "R25",
  "R26",
  "R27"
] as const;
export const AcceptanceCoverageRequirementIdSchema = z.enum(ACCEPTANCE_COVERAGE_REQUIREMENT_IDS);
export type AcceptanceCoverageRequirementId = z.infer<typeof AcceptanceCoverageRequirementIdSchema>;

export const AcceptanceCoverageRequirementSchema = z.object({
  id: AcceptanceCoverageRequirementIdSchema,
  sourceIssue: AcceptanceCoverageSourceIssueSchema,
  description: z.string().min(1)
});
export type AcceptanceCoverageRequirement = z.infer<typeof AcceptanceCoverageRequirementSchema>;

/**
 * Catalog of the 21 coverage requirements this representative campaign must exercise,
 * sourced from #354 (storyboard readability framing/legibility concerns) and #332
 * (final H3 multi-scene acceptance). This is a GPU-free, human-readable checklist —
 * it does not itself constitute certification evidence.
 */
export const ACCEPTANCE_COVERAGE_REQUIREMENTS: readonly AcceptanceCoverageRequirement[] =
  Object.freeze([
    {
      id: "R01",
      sourceIssue: 354,
      description: "Wide establishing shot framing is legible at target aspect ratio."
    },
    {
      id: "R02",
      sourceIssue: 354,
      description: "Medium two-shot keeps both subjects readable without cropping."
    },
    {
      id: "R03",
      sourceIssue: 354,
      description: "Close-up dialogue framing preserves facial continuity cues."
    },
    {
      id: "R04",
      sourceIssue: 354,
      description: "Low-angle hero framing does not clip the subject's silhouette."
    },
    {
      id: "R05",
      sourceIssue: 354,
      description: "High-angle overview framing preserves environment legibility."
    },
    {
      id: "R06",
      sourceIssue: 354,
      description: "Subject/product interaction keeps product branding readable."
    },
    {
      id: "R07",
      sourceIssue: 354,
      description: "Multi-subject ensemble framing avoids subject occlusion."
    },
    {
      id: "R08",
      sourceIssue: 354,
      description:
        "Foreground/background depth layering reads as intended at storyboard review time."
    },
    {
      id: "R09",
      sourceIssue: 354,
      description: "Frame-anchored scene storyboard previs matches the anchor image composition."
    },
    {
      id: "R10",
      sourceIssue: 332,
      description:
        "Reference-directed routing mode is exercised across the representative scene set."
    },
    {
      id: "R11",
      sourceIssue: 332,
      description: "Frame-anchored routing mode is exercised by at least one representative scene."
    },
    {
      id: "R12",
      sourceIssue: 332,
      description: "subject_identity reference role is bound and conditions at least one scene."
    },
    {
      id: "R13",
      sourceIssue: 332,
      description: "product reference role is bound and conditions at least one scene."
    },
    {
      id: "R14",
      sourceIssue: 332,
      description: "location reference role is bound and conditions at least one scene."
    },
    {
      id: "R15",
      sourceIssue: 332,
      description: "style reference role is bound and conditions at least one scene."
    },
    {
      id: "R16",
      sourceIssue: 332,
      description: "composition reference role is bound and conditions at least one scene."
    },
    {
      id: "R17",
      sourceIssue: 332,
      description: "Every representative scene declares an explicit ShotPlanRoutingMode."
    },
    {
      id: "R18",
      sourceIssue: 332,
      description: "Campaign-level scene count matches the declared representative scene catalog."
    },
    {
      id: "R19",
      sourceIssue: 332,
      description:
        "Every asset slot referenced by a scene resolves to a hash-pinned, read-only fixture file."
    },
    {
      id: "R20",
      sourceIssue: 332,
      description: "Multi-scene acceptance run covers low-angle and high-angle camera variation."
    },
    {
      id: "R21",
      sourceIssue: 332,
      description:
        "Multi-scene acceptance run covers at least one multi-subject and one fg/bg depth case."
    },
    {
      id: "R22",
      sourceIssue: 332,
      description: "Static camera intent is exercised by at least one representative scene."
    },
    {
      id: "R23",
      sourceIssue: 332,
      description:
        "Dolly, pan, and tracking camera movement intent are each exercised by at least one representative scene."
    },
    {
      id: "R24",
      sourceIssue: 332,
      description: "Indoor environment intent is exercised by at least one representative scene."
    },
    {
      id: "R25",
      sourceIssue: 332,
      description: "Outdoor environment intent is exercised by at least one representative scene."
    },
    {
      id: "R26",
      sourceIssue: 332,
      description:
        "Lighter/commercial lighting intent is exercised by at least one representative scene."
    },
    {
      id: "R27",
      sourceIssue: 332,
      description:
        "Darker/dramatic lighting intent is exercised by at least one representative scene."
    }
  ]);

// ---------------------------------------------------------------------------
// Asset slots — hash-pinned to real, read-only certification fixture files
// ---------------------------------------------------------------------------

export const ACCEPTANCE_ASSET_SLOT_NAMES = [
  "subjectIdentityReference",
  "productReference",
  "locationReference",
  "styleReference",
  "compositionReference",
  "frameAnchorStart",
  "frameAnchorEnd"
] as const;
export const AcceptanceAssetSlotNameSchema = z.enum(ACCEPTANCE_ASSET_SLOT_NAMES);
export type AcceptanceAssetSlotName = z.infer<typeof AcceptanceAssetSlotNameSchema>;

/** Asset slot purpose: either a scene reference binding role, or a frame-anchor input. */
export const ACCEPTANCE_ASSET_SLOT_KINDS = ["reference_role", "frame_anchor"] as const;
export const AcceptanceAssetSlotKindSchema = z.enum(ACCEPTANCE_ASSET_SLOT_KINDS);
export type AcceptanceAssetSlotKind = z.infer<typeof AcceptanceAssetSlotKindSchema>;

export const AcceptanceAssetMimeTypeSchema = z.enum(["image/jpeg", "image/png"]);

export const AcceptanceAssetSlotSchema = z.object({
  name: AcceptanceAssetSlotNameSchema,
  kind: AcceptanceAssetSlotKindSchema,
  /** Populated only when kind === "reference_role". */
  role: ReferenceRoleSchema.optional(),
  required: z.boolean(),
  /** Path relative to the repository root. Read-only; never written or copied by agents. */
  sourcePath: z.string().min(1),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/, "Must be a lowercase 64-character hexadecimal SHA-256 hash"),
  mimeType: AcceptanceAssetMimeTypeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  note: z.string().min(1).optional()
});
export type AcceptanceAssetSlot = z.infer<typeof AcceptanceAssetSlotSchema>;

const slot = (
  name: AcceptanceAssetSlotName,
  kind: AcceptanceAssetSlotKind,
  required: boolean,
  relativeFile: string,
  sha256: string,
  mimeType: z.infer<typeof AcceptanceAssetMimeTypeSchema>,
  width: number,
  height: number,
  role?: z.infer<typeof ReferenceRoleSchema>,
  note?: string
): AcceptanceAssetSlot =>
  AcceptanceAssetSlotSchema.parse({
    name,
    kind,
    ...(role !== undefined ? { role } : {}),
    required,
    sourcePath: `${ACCEPTANCE_CAMPAIGN_SOURCE_ROOT}/${relativeFile}`,
    sha256,
    mimeType,
    width,
    height,
    ...(note !== undefined ? { note } : {})
  });

/**
 * 6 required + 1 optional asset slots. Two slots intentionally reuse the same real
 * `wide-shot-frame.png` file for two distinct, documented purposes (a composition
 * reference image, and an optional frame-anchor end frame) — this is deliberate reuse
 * of an existing approved still, not fabrication, since both slots resolve to the exact
 * same hash-pinned bytes already present in the certification fixture.
 */
export const ACCEPTANCE_CAMPAIGN_ASSET_SLOTS: readonly AcceptanceAssetSlot[] = Object.freeze([
  slot(
    "subjectIdentityReference",
    "reference_role",
    true,
    "reference-images/trinidad_subject.jpg",
    "9a1e9bc51b93b80a6169c69bbcb6630788e2fb6dd2244ace4b6c2c9fd5bd2589",
    "image/jpeg",
    1024,
    819,
    "subject_identity"
  ),
  slot(
    "productReference",
    "reference_role",
    true,
    "reference-images/trinidad_product.jpg",
    "f4dbb845aa086287da85b07d239b14dccf7b40aedb68367ec885c0913c1c79ab",
    "image/jpeg",
    1024,
    679,
    "product"
  ),
  slot(
    "locationReference",
    "reference_role",
    true,
    "reference-images/trinidad_location.jpg",
    "39a494e9cbf204f3b8d45a8f18c5e8e05f8f652fc6fe7e24746519ba2110b7ee",
    "image/jpeg",
    1024,
    576,
    "location"
  ),
  slot(
    "styleReference",
    "reference_role",
    true,
    "reference-images/trinidad_style.jpg",
    "182b70c25d93acbe62ebf59489114587456104ab1bd8ac3051ce0cdd95f1da5d",
    "image/jpeg",
    1024,
    768,
    "style"
  ),
  slot(
    "compositionReference",
    "reference_role",
    true,
    "wide-shot-frame.png",
    "5143e1ab6aab7cb22f15293121e8984afa6311e60a39c95b5b319c52f9e48ccc",
    "image/png",
    1344,
    768,
    "composition",
    "Reuses the approved wide-shot still as the composition/framing reference role."
  ),
  slot(
    "frameAnchorStart",
    "frame_anchor",
    true,
    "output-frame.png",
    "f8c9635fb8c486d1c1b76f6c685e989e311b123ca7971246e0a036e62583b2f5",
    "image/png",
    1344,
    768,
    undefined,
    "Start-frame anchor for the single frame_anchored representative scene."
  ),
  slot(
    "frameAnchorEnd",
    "frame_anchor",
    false,
    "wide-shot-frame.png",
    "5143e1ab6aab7cb22f15293121e8984afa6311e60a39c95b5b319c52f9e48ccc",
    "image/png",
    1344,
    768,
    undefined,
    "Optional end-frame anchor reusing the approved wide-shot still."
  )
]);

// ---------------------------------------------------------------------------
// Representative scene catalog (9 scenes)
// ---------------------------------------------------------------------------

export const ACCEPTANCE_SCENE_CASE_IDS = [
  "wide_establishing",
  "medium_two_shot",
  "closeup_dialogue",
  "low_angle_hero",
  "high_angle_overview",
  "subject_product_interaction",
  "multi_subject_ensemble",
  "fg_bg_depth_layering",
  "frame_anchored_continuity"
] as const;
export const AcceptanceSceneCaseIdSchema = z.enum(ACCEPTANCE_SCENE_CASE_IDS);
export type AcceptanceSceneCaseId = z.infer<typeof AcceptanceSceneCaseIdSchema>;

export const ACCEPTANCE_SCENE_ENGINE_PROFILE_IDS = [
  "MINIMAX_H3_720P_5S_REF2V_V1",
  "MINIMAX_H3_720P_5S_I2V_V1"
] as const;
export const AcceptanceSceneEngineProfileIdSchema = z.enum(ACCEPTANCE_SCENE_ENGINE_PROFILE_IDS);

export const AcceptanceSceneReferenceSlotSchema = z.object({
  slotName: AcceptanceAssetSlotNameSchema,
  role: ReferenceRoleSchema
});
export type AcceptanceSceneReferenceSlot = z.infer<typeof AcceptanceSceneReferenceSlotSchema>;

/**
 * Indoor/outdoor environment intent. Not part of the live ShotPlan contract's own enums
 * (`shot-plan.ts` has no environment-kind field), so it is declared locally here, scoped
 * to this fixture's coverage bookkeeping only.
 */
export const ACCEPTANCE_ENVIRONMENT_KINDS = ["indoor", "outdoor"] as const;
export const AcceptanceEnvironmentKindSchema = z.enum(ACCEPTANCE_ENVIRONMENT_KINDS);
export type AcceptanceEnvironmentKind = z.infer<typeof AcceptanceEnvironmentKindSchema>;

export const AcceptanceSceneDefinitionSchema = z.object({
  caseId: AcceptanceSceneCaseIdSchema,
  sequenceIndex: z.number().int().positive(),
  title: z.string().min(1),
  prompt: z.string().min(1),
  routingMode: ShotPlanRoutingModeSchema,
  engineProfileId: AcceptanceSceneEngineProfileIdSchema,
  durationMs: z.number().int().positive(),
  /** ShotPlan-intent camera movement this case represents (static/dolly/pan/tracking/...). */
  cameraMovement: CameraMovementSchema,
  /** ShotPlan-intent lighting style this case represents (commercial vs dramatic, etc). */
  lightingStyle: LightingStyleSchema,
  /** Indoor/outdoor environment this case represents. */
  environmentKind: AcceptanceEnvironmentKindSchema,
  referenceSlots: z.array(AcceptanceSceneReferenceSlotSchema).min(1),
  frameAnchorSlots: z
    .object({
      start: AcceptanceAssetSlotNameSchema.optional(),
      end: AcceptanceAssetSlotNameSchema.optional()
    })
    .optional(),
  coverageRequirementIds: z.array(AcceptanceCoverageRequirementIdSchema).min(1)
});
export type AcceptanceSceneDefinition = z.infer<typeof AcceptanceSceneDefinitionSchema>;

const REFERENCE_DIRECTED_FULL_REFERENCE_SET: AcceptanceSceneReferenceSlot[] = [
  { slotName: "subjectIdentityReference", role: "subject_identity" },
  { slotName: "productReference", role: "product" },
  { slotName: "locationReference", role: "location" },
  { slotName: "styleReference", role: "style" },
  { slotName: "compositionReference", role: "composition" }
];

export const ACCEPTANCE_CAMPAIGN_SCENES: readonly AcceptanceSceneDefinition[] = Object.freeze([
  {
    caseId: "wide_establishing",
    sequenceIndex: 1,
    title: "Wide establishing shot",
    prompt:
      "Wide establishing shot of the location with the subject and product visible at environmental scale.",
    routingMode: "reference_directed",
    engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1",
    durationMs: 5000,
    cameraMovement: "static",
    lightingStyle: "natural_golden_hour",
    environmentKind: "outdoor",
    referenceSlots: REFERENCE_DIRECTED_FULL_REFERENCE_SET,
    coverageRequirementIds: [
      "R01",
      "R10",
      "R12",
      "R13",
      "R14",
      "R15",
      "R16",
      "R17",
      "R18",
      "R19",
      "R22",
      "R25",
      "R26"
    ]
  },
  {
    caseId: "medium_two_shot",
    sequenceIndex: 2,
    title: "Medium two-shot",
    prompt: "Medium two-shot framing keeping both the subject and a second figure fully in frame.",
    routingMode: "reference_directed",
    engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1",
    durationMs: 5000,
    cameraMovement: "dolly_in",
    lightingStyle: "practical_interior",
    environmentKind: "indoor",
    referenceSlots: REFERENCE_DIRECTED_FULL_REFERENCE_SET,
    coverageRequirementIds: ["R02", "R10", "R17", "R18", "R19", "R23", "R24"]
  },
  {
    caseId: "closeup_dialogue",
    sequenceIndex: 3,
    title: "Close-up dialogue",
    prompt: "Close-up dialogue framing on the subject's face, preserving identity continuity cues.",
    routingMode: "reference_directed",
    engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1",
    durationMs: 5000,
    cameraMovement: "static",
    lightingStyle: "high_key_commercial",
    environmentKind: "indoor",
    referenceSlots: REFERENCE_DIRECTED_FULL_REFERENCE_SET,
    coverageRequirementIds: ["R03", "R10", "R12", "R17", "R18", "R19", "R26"]
  },
  {
    caseId: "low_angle_hero",
    sequenceIndex: 4,
    title: "Low-angle hero shot",
    prompt:
      "Low-angle hero framing of the subject against the location without silhouette clipping.",
    routingMode: "reference_directed",
    engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1",
    durationMs: 5000,
    cameraMovement: "tracking",
    lightingStyle: "low_key_dramatic",
    environmentKind: "outdoor",
    referenceSlots: REFERENCE_DIRECTED_FULL_REFERENCE_SET,
    coverageRequirementIds: ["R04", "R10", "R17", "R18", "R19", "R20", "R23", "R27"]
  },
  {
    caseId: "high_angle_overview",
    sequenceIndex: 5,
    title: "High-angle overview",
    prompt: "High-angle overview framing of the location preserving environmental legibility.",
    routingMode: "reference_directed",
    engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1",
    durationMs: 5000,
    cameraMovement: "pan_left",
    lightingStyle: "overcast_diffused",
    environmentKind: "outdoor",
    referenceSlots: REFERENCE_DIRECTED_FULL_REFERENCE_SET,
    coverageRequirementIds: ["R05", "R10", "R17", "R18", "R19", "R20", "R23"]
  },
  {
    caseId: "subject_product_interaction",
    sequenceIndex: 6,
    title: "Subject/product interaction",
    prompt: "Subject interacting with the product, keeping product branding legible in frame.",
    routingMode: "reference_directed",
    engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1",
    durationMs: 5000,
    cameraMovement: "tracking",
    lightingStyle: "softbox_studio",
    environmentKind: "indoor",
    referenceSlots: REFERENCE_DIRECTED_FULL_REFERENCE_SET,
    coverageRequirementIds: ["R06", "R10", "R13", "R17", "R18", "R19", "R23"]
  },
  {
    caseId: "multi_subject_ensemble",
    sequenceIndex: 7,
    title: "Multi-subject ensemble",
    prompt: "Multi-subject ensemble framing avoiding occlusion between figures.",
    routingMode: "reference_directed",
    engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1",
    durationMs: 5000,
    cameraMovement: "static",
    lightingStyle: "high_key_commercial",
    environmentKind: "indoor",
    referenceSlots: REFERENCE_DIRECTED_FULL_REFERENCE_SET,
    coverageRequirementIds: ["R07", "R10", "R17", "R18", "R19", "R21", "R26"]
  },
  {
    caseId: "fg_bg_depth_layering",
    sequenceIndex: 8,
    title: "Foreground/background depth layering",
    prompt: "Foreground subject against a distinct background layer, reading as intended depth.",
    routingMode: "reference_directed",
    engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1",
    durationMs: 5000,
    cameraMovement: "dolly_out",
    lightingStyle: "natural_golden_hour",
    environmentKind: "outdoor",
    referenceSlots: REFERENCE_DIRECTED_FULL_REFERENCE_SET,
    coverageRequirementIds: ["R08", "R10", "R17", "R18", "R19", "R21", "R23", "R25"]
  },
  {
    caseId: "frame_anchored_continuity",
    sequenceIndex: 9,
    title: "Frame-anchored continuity",
    prompt: "Frame-anchored continuity scene conditioned on the approved start/end anchor frames.",
    routingMode: "frame_anchored",
    engineProfileId: "MINIMAX_H3_720P_5S_I2V_V1",
    durationMs: 5000,
    cameraMovement: "static",
    lightingStyle: "natural_golden_hour",
    environmentKind: "outdoor",
    referenceSlots: [{ slotName: "compositionReference", role: "composition" }],
    frameAnchorSlots: { start: "frameAnchorStart", end: "frameAnchorEnd" },
    coverageRequirementIds: ["R09", "R11", "R16", "R17", "R18", "R19"]
  }
]);

export const AcceptanceCampaignFixtureSchema = z.object({
  fixtureId: z.literal(ACCEPTANCE_CAMPAIGN_FIXTURE_ID),
  fixtureVersion: z.literal(ACCEPTANCE_CAMPAIGN_FIXTURE_VERSION),
  title: z.string().min(1),
  sourceRoot: z.literal(ACCEPTANCE_CAMPAIGN_SOURCE_ROOT),
  assetSlots: z.array(AcceptanceAssetSlotSchema).min(1),
  scenes: z.array(AcceptanceSceneDefinitionSchema).min(1),
  coverageRequirements: z.array(AcceptanceCoverageRequirementSchema).min(1)
});
export type AcceptanceCampaignFixture = z.infer<typeof AcceptanceCampaignFixtureSchema>;

export const ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN: AcceptanceCampaignFixture =
  AcceptanceCampaignFixtureSchema.parse({
    fixtureId: ACCEPTANCE_CAMPAIGN_FIXTURE_ID,
    fixtureVersion: ACCEPTANCE_CAMPAIGN_FIXTURE_VERSION,
    title: "H3 Operator Acceptance Campaign — Representative Set",
    sourceRoot: ACCEPTANCE_CAMPAIGN_SOURCE_ROOT,
    assetSlots: ACCEPTANCE_CAMPAIGN_ASSET_SLOTS,
    scenes: ACCEPTANCE_CAMPAIGN_SCENES,
    coverageRequirements: ACCEPTANCE_COVERAGE_REQUIREMENTS
  });

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

export interface AcceptanceCoverageResult {
  readonly satisfied: boolean;
  readonly covered: readonly AcceptanceCoverageRequirementId[];
  readonly missing: readonly AcceptanceCoverageRequirementId[];
  /** Asset-slot cross-reference errors, e.g. a scene referencing an unknown or non-required slot. */
  readonly assetSlotErrors: readonly string[];
}

/**
 * Pure, deterministic coverage check: every declared requirement id must be covered by
 * at least one scene's `coverageRequirementIds`, and every slot name referenced by a
 * scene (directly or via frameAnchorSlots) must resolve to a declared asset slot.
 * Never touches the filesystem, network, or any repository.
 */
export function verifyAcceptanceCoverage(
  campaign: AcceptanceCampaignFixture
): AcceptanceCoverageResult {
  const slotNames = new Set(campaign.assetSlots.map((s) => s.name));
  const assetSlotErrors: string[] = [];

  const covered = new Set<AcceptanceCoverageRequirementId>();
  for (const scene of campaign.scenes) {
    for (const reqId of scene.coverageRequirementIds) {
      covered.add(reqId);
    }
    for (const ref of scene.referenceSlots) {
      if (!slotNames.has(ref.slotName)) {
        assetSlotErrors.push(
          `Scene "${scene.caseId}" references unknown asset slot "${ref.slotName}"`
        );
      }
    }
    if (scene.frameAnchorSlots?.start && !slotNames.has(scene.frameAnchorSlots.start)) {
      assetSlotErrors.push(
        `Scene "${scene.caseId}" references unknown frame-anchor start slot "${scene.frameAnchorSlots.start}"`
      );
    }
    if (scene.frameAnchorSlots?.end && !slotNames.has(scene.frameAnchorSlots.end)) {
      assetSlotErrors.push(
        `Scene "${scene.caseId}" references unknown frame-anchor end slot "${scene.frameAnchorSlots.end}"`
      );
    }
  }

  const allIds = campaign.coverageRequirements.map((r) => r.id);
  const missing = allIds.filter((id) => !covered.has(id));

  return {
    satisfied: missing.length === 0 && assetSlotErrors.length === 0,
    covered: allIds.filter((id) => covered.has(id)),
    missing,
    assetSlotErrors
  };
}

/**
 * Deterministic sha256 fingerprint over the canonical (key-sorted) JSON representation of
 * the campaign fixture's identity, asset slots, and scenes. Pure function: no I/O, no
 * randomness, no wall-clock dependency. Two installs of the same fixture definition always
 * produce the same fingerprint, and any drift in the fixture shape changes it.
 *
 * Uses WebCrypto (globalThis.crypto.subtle) rather than node:crypto so this module stays
 * importable by apps/web client components: node:crypto cannot be bundled by webpack.
 */
export async function computeAcceptanceCampaignFingerprint(
  campaign: AcceptanceCampaignFixture
): Promise<string> {
  const canonical = sortKeysDeep({
    fixtureId: campaign.fixtureId,
    fixtureVersion: campaign.fixtureVersion,
    sourceRoot: campaign.sourceRoot,
    assetSlots: campaign.assetSlots,
    scenes: campaign.scenes,
    coverageRequirements: campaign.coverageRequirements
  });
  const data = new TextEncoder().encode(JSON.stringify(canonical));
  const buffer = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
