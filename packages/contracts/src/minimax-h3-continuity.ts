import { z } from "zod";
import {
  canonicalizeJson,
  sha256Hex,
  MinimaxH3ExperimentRouteSchema,
  MinimaxH3ExperimentCandidateFramesSchema,
  PINNED_COMFYUI_CORE_REVISION
} from "./minimax-h3-experiment.js";
import { sha256HashSchema } from "./persistent-media.js";
import {
  MinimaxH3SourceEvidenceRefSchema,
  MinimaxH3AttentionVariantNameSchema
} from "./minimax-h3-attention.js";

// ---------------------------------------------------------------------------
// 1. Rubric Dimension Definitions (#421.11 / #444)
// ---------------------------------------------------------------------------

export const CONTINUITY_RUBRIC_DIMENSIONS = [
  "identity",
  "wardrobe",
  "backgroundLightingPersistence",
  "cameraFidelity",
  "subjectAnatomy",
  "faceAndHands",
  "unnaturalCuts",
  "temporalFlicker",
  "referenceFidelity",
  "motionCoherence",
  "sound",
  "overallAdUsability"
] as const;

export const ContinuityRubricDimensionNameSchema = z.enum(CONTINUITY_RUBRIC_DIMENSIONS);
export type ContinuityRubricDimensionName = z.infer<typeof ContinuityRubricDimensionNameSchema>;

export const ContinuityDimensionAssessmentSchema = z.enum([
  "pass",
  "defect",
  "fail",
  "not_assessable"
]);
export type ContinuityDimensionAssessment = z.infer<typeof ContinuityDimensionAssessmentSchema>;

export const ContinuitySeveritySchema = z.enum(["minor", "major", "critical"]);
export type ContinuitySeverity = z.infer<typeof ContinuitySeveritySchema>;

export const ContinuityTimeIntervalSchema = z
  .object({
    startSec: z.number().min(0),
    endSec: z.number().min(0),
    note: z.string().optional()
  })
  .strict()
  .refine((val) => val.endSec >= val.startSec, {
    message: "endSec must be greater than or equal to startSec"
  });
export type ContinuityTimeInterval = z.infer<typeof ContinuityTimeIntervalSchema>;

export const ContinuityRubricDimensionRecordSchema = z
  .object({
    assessment: ContinuityDimensionAssessmentSchema,
    rationale: z.string().min(1),
    fullClipAssessment: z.boolean().optional(),
    intervals: z.array(ContinuityTimeIntervalSchema).optional(),
    severity: ContinuitySeveritySchema.optional()
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.assessment === "not_assessable" && val.rationale.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Rationale is required when assessment is 'not_assessable'",
        path: ["rationale"]
      });
    }
    if (val.assessment === "pass" || val.assessment === "defect" || val.assessment === "fail") {
      if (val.assessment === "defect" || val.assessment === "fail") {
        if (!val.severity) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Severity is required when assessment is '${val.assessment}'`,
            path: ["severity"]
          });
        }
      }
      if (!val.fullClipAssessment && (!val.intervals || val.intervals.length === 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Assessment '${val.assessment}' requires either fullClipAssessment=true or at least one interval`,
          path: ["intervals"]
        });
      }
    }
  });
export type ContinuityRubricDimensionRecord = z.infer<typeof ContinuityRubricDimensionRecordSchema>;

export const SceneSubstitutionFindingSchema = z
  .object({
    detected: z.boolean(),
    intervals: z.array(ContinuityTimeIntervalSchema).optional(),
    severity: ContinuitySeveritySchema.optional(),
    rationale: z.string().optional()
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.detected) {
      if (!val.severity) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Severity is required when sceneSubstitution is detected",
          path: ["severity"]
        });
      }
      if (!val.rationale || val.rationale.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Rationale is required when sceneSubstitution is detected",
          path: ["rationale"]
        });
      }
      if (!val.intervals || val.intervals.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "At least one interval is required when sceneSubstitution is detected",
          path: ["intervals"]
        });
      }
    }
  });
export type SceneSubstitutionFinding = z.infer<typeof SceneSubstitutionFindingSchema>;

export const FirstFrameAdherenceSchema = z
  .object({
    status: z.enum(["pass", "defect", "fail", "not_applicable"]),
    rationale: z.string().min(1)
  })
  .strict();
export type FirstFrameAdherence = z.infer<typeof FirstFrameAdherenceSchema>;

export const LastFrameAdherenceSchema = z
  .object({
    status: z.enum(["pass", "defect", "fail", "not_applicable"]),
    rationale: z.string().min(1)
  })
  .strict();
export type LastFrameAdherence = z.infer<typeof LastFrameAdherenceSchema>;

export const DefectSpecificInspectionsSchema = z
  .object({
    wardrobe243fDepartureInspected: z.boolean(),
    yellowBackdrop243fDepartureInspected: z.boolean().optional(),
    environment362fBlackoutInspected: z.boolean(),
    environment362fRecoveryInspected: z.boolean().optional(),
    sceneSubstitution362fInspected: z.boolean().optional(),
    camera124fPushInspected: z.boolean(),
    notes: z.string().optional()
  })
  .strict();
export type DefectSpecificInspections = z.infer<typeof DefectSpecificInspectionsSchema>;

// ---------------------------------------------------------------------------
// 2. Canonical Rubric Definition & Digest
// ---------------------------------------------------------------------------

export const CONTINUITY_RUBRIC_SPEC = Object.freeze({
  rubricVersion: 1,
  name: "MiniMax-H3 Long-Shot Continuity and Conditioning Rubric",
  description:
    "Manual timestamped visual evaluation rubric isolating identity, wardrobe, background/lighting persistence, camera fidelity, anatomy, flicker, cuts, sound, reference fidelity, and ad usability under #421/#444.",
  dimensions: CONTINUITY_RUBRIC_DIMENSIONS,
  criticalFailureConditions: [
    "scene_substitution_detected",
    "background_blackout_or_collapse",
    "unrequested_wardrobe_departure",
    "unrequested_camera_push_exceeding_limit"
  ]
});

export function computeContinuityRubricDigest(): string {
  return sha256Hex(canonicalizeJson(CONTINUITY_RUBRIC_SPEC));
}

// ---------------------------------------------------------------------------
// 3. Continuity Review Sidecar Schema
// ---------------------------------------------------------------------------

export const MinimaxH3ContinuityReviewSidecarSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("continuity-review-sidecar"),
    reviewId: z.string().min(1),
    reviewRevision: z.number().int().positive(),
    reviewDigest: sha256HashSchema,
    rubricVersion: z.literal(1),
    rubricDigest: sha256HashSchema,
    studyId: z.string().min(1),
    cellId: z.string().min(1),
    runId: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, "Invalid runId format"),
    descriptorDigest: sha256HashSchema,
    route: MinimaxH3ExperimentRouteSchema,
    configuredFrames: MinimaxH3ExperimentCandidateFramesSchema,
    sourceOutputSha256: sha256HashSchema,
    reviewer: z.string().min(1),
    reviewedAt: z.string().datetime(),
    reviewCoverage: z
      .object({
        playbackExamined: z.boolean(),
        audioExamined: z.boolean(),
        fullClipExamined: z.boolean(),
        storyboardSampled: z.boolean()
      })
      .strict(),
    dimensions: z
      .object({
        identity: ContinuityRubricDimensionRecordSchema,
        wardrobe: ContinuityRubricDimensionRecordSchema,
        backgroundLightingPersistence: ContinuityRubricDimensionRecordSchema,
        cameraFidelity: ContinuityRubricDimensionRecordSchema,
        subjectAnatomy: ContinuityRubricDimensionRecordSchema,
        faceAndHands: ContinuityRubricDimensionRecordSchema,
        unnaturalCuts: ContinuityRubricDimensionRecordSchema,
        temporalFlicker: ContinuityRubricDimensionRecordSchema,
        referenceFidelity: ContinuityRubricDimensionRecordSchema,
        motionCoherence: ContinuityRubricDimensionRecordSchema,
        sound: ContinuityRubricDimensionRecordSchema,
        overallAdUsability: ContinuityRubricDimensionRecordSchema
      })
      .strict(),
    sceneSubstitution: SceneSubstitutionFindingSchema,
    firstFrameAdherence: FirstFrameAdherenceSchema,
    lastFrameAdherence: LastFrameAdherenceSchema,
    defectSpecificInspections: DefectSpecificInspectionsSchema,
    overallOutcome: z.enum(["pass", "defect", "fail", "inconclusive"]),
    operatorDisposition: z.enum(["admitted", "rejected"]).optional(),
    notes: z.string().nullable().optional()
  })
  .strict()
  .superRefine((val, ctx) => {
    // 0. Rubric digest check
    const expectedRubricDigest = computeContinuityRubricDigest();
    if (val.rubricDigest !== expectedRubricDigest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `rubricDigest mismatch: expected canonical rubric digest ${expectedRubricDigest}, got ${val.rubricDigest}`,
        path: ["rubricDigest"]
      });
    }

    // 0b. Review digest check
    const expectedReviewDigest = computeContinuityReviewDigest(val);
    if (val.reviewDigest !== expectedReviewDigest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `reviewDigest mismatch: expected ${expectedReviewDigest}, got ${val.reviewDigest}`,
        path: ["reviewDigest"]
      });
    }

    // 1. Scene substitution forces overallOutcome fail and overallAdUsability fail
    if (val.sceneSubstitution.detected) {
      if (val.overallOutcome !== "fail") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Scene substitution detected: overallOutcome cannot be 'pass' and must be 'fail' even if identity survives",
          path: ["overallOutcome"]
        });
      }
      if (val.dimensions.overallAdUsability.assessment !== "fail") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Scene substitution detected: overallAdUsability must be 'fail'",
          path: ["dimensions", "overallAdUsability", "assessment"]
        });
      }
    }

    // 2. Review coverage requirements for 'pass'
    if (val.overallOutcome === "pass") {
      if (
        !val.reviewCoverage.fullClipExamined ||
        !val.reviewCoverage.playbackExamined ||
        !val.reviewCoverage.audioExamined
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "overallOutcome 'pass' requires both fullClipExamined and playbackExamined, as well as audioExamined to be true",
          path: ["reviewCoverage"]
        });
      }
    }

    // 3. Audio examination and sound assessment
    if (!val.reviewCoverage.audioExamined && val.dimensions.sound.assessment === "pass") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "audioExamined is false: sound assessment cannot be 'pass' (must be 'not_assessable')",
        path: ["dimensions", "sound", "assessment"]
      });
    }

    // 4. Defect-specific inspections
    if (val.configuredFrames === 243) {
      if (!val.defectSpecificInspections.wardrobe243fDepartureInspected) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "243-frame review requires wardrobe243fDepartureInspected to be true",
          path: ["defectSpecificInspections", "wardrobe243fDepartureInspected"]
        });
      }
      if (!val.defectSpecificInspections.yellowBackdrop243fDepartureInspected) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "243-frame review requires yellowBackdrop243fDepartureInspected to be true",
          path: ["defectSpecificInspections", "yellowBackdrop243fDepartureInspected"]
        });
      }
    }
    if (val.configuredFrames === 362) {
      if (!val.defectSpecificInspections.environment362fBlackoutInspected) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "362-frame review requires environment362fBlackoutInspected to be true",
          path: ["defectSpecificInspections", "environment362fBlackoutInspected"]
        });
      }
      if (!val.defectSpecificInspections.environment362fRecoveryInspected) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "362-frame review requires environment362fRecoveryInspected to be true",
          path: ["defectSpecificInspections", "environment362fRecoveryInspected"]
        });
      }
      if (!val.defectSpecificInspections.sceneSubstitution362fInspected) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "362-frame review requires sceneSubstitution362fInspected to be true",
          path: ["defectSpecificInspections", "sceneSubstitution362fInspected"]
        });
      }
    }
    if (val.configuredFrames === 124 && !val.defectSpecificInspections.camera124fPushInspected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "124-frame review requires camera124fPushInspected to be true",
        path: ["defectSpecificInspections", "camera124fPushInspected"]
      });
    }

    // 5. First & last frame adherence: for i2v it must not be not_applicable
    if (val.route === "i2v") {
      if (val.firstFrameAdherence.status === "not_applicable") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "First-frame adherence is required for i2v route (cannot be not_applicable)",
          path: ["firstFrameAdherence", "status"]
        });
      }
      if (val.lastFrameAdherence.status === "not_applicable") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Last-frame adherence is required for i2v route (cannot be not_applicable)",
          path: ["lastFrameAdherence", "status"]
        });
      }
    }

    // 6. Sound dimension check: if not_assessable, must explain
    if (val.dimensions.sound.assessment === "not_assessable") {
      if (!val.dimensions.sound.rationale || val.dimensions.sound.rationale.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Sound assessment 'not_assessable' requires rationale",
          path: ["dimensions", "sound", "rationale"]
        });
      }
    }

    // 7. Inconsistent overall pass checks: 'pass' requires all assessed dimensions to pass
    if (val.overallOutcome === "pass") {
      for (const [dimKey, dim] of Object.entries(val.dimensions)) {
        if (dimKey === "sound" && dim.assessment === "not_assessable") {
          continue; // Sound on a silent video output can be not_assessable without precluding overall pass
        }
        if (dim.assessment !== "pass") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `overallOutcome 'pass' is inconsistent with dimension '${dimKey}' having assessment '${dim.assessment}'`,
            path: ["dimensions", dimKey, "assessment"]
          });
        }
      }
      if (val.route === "i2v") {
        if (val.firstFrameAdherence.status !== "pass") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `overallOutcome 'pass' is inconsistent with firstFrameAdherence status '${val.firstFrameAdherence.status}'`,
            path: ["firstFrameAdherence", "status"]
          });
        }
        if (val.lastFrameAdherence.status !== "pass") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `overallOutcome 'pass' is inconsistent with lastFrameAdherence status '${val.lastFrameAdherence.status}'`,
            path: ["lastFrameAdherence", "status"]
          });
        }
      } else {
        if (
          val.firstFrameAdherence.status !== "pass" &&
          val.firstFrameAdherence.status !== "not_applicable"
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `overallOutcome 'pass' is inconsistent with firstFrameAdherence status '${val.firstFrameAdherence.status}'`,
            path: ["firstFrameAdherence", "status"]
          });
        }
        if (
          val.lastFrameAdherence.status !== "pass" &&
          val.lastFrameAdherence.status !== "not_applicable"
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `overallOutcome 'pass' is inconsistent with lastFrameAdherence status '${val.lastFrameAdherence.status}'`,
            path: ["lastFrameAdherence", "status"]
          });
        }
      }
    }
  });
export type MinimaxH3ContinuityReviewSidecar = z.infer<
  typeof MinimaxH3ContinuityReviewSidecarSchema
>;

export function computeContinuityReviewDigest(
  sidecar: Omit<MinimaxH3ContinuityReviewSidecar, "reviewDigest">
): string {
  const payload = {
    schemaVersion: sidecar.schemaVersion,
    kind: sidecar.kind,
    reviewId: sidecar.reviewId,
    reviewRevision: sidecar.reviewRevision,
    rubricVersion: sidecar.rubricVersion,
    rubricDigest: sidecar.rubricDigest,
    studyId: sidecar.studyId,
    cellId: sidecar.cellId,
    runId: sidecar.runId,
    descriptorDigest: sidecar.descriptorDigest,
    route: sidecar.route,
    configuredFrames: sidecar.configuredFrames,
    sourceOutputSha256: sidecar.sourceOutputSha256,
    reviewer: sidecar.reviewer,
    reviewedAt: sidecar.reviewedAt,
    reviewCoverage: sidecar.reviewCoverage,
    dimensions: sidecar.dimensions,
    sceneSubstitution: sidecar.sceneSubstitution,
    firstFrameAdherence: sidecar.firstFrameAdherence,
    lastFrameAdherence: sidecar.lastFrameAdherence,
    defectSpecificInspections: sidecar.defectSpecificInspections,
    overallOutcome: sidecar.overallOutcome,
    notes: sidecar.notes ?? null
  };
  return sha256Hex(canonicalizeJson(payload));
}

// ---------------------------------------------------------------------------
// 4. Conservative Mapping to Legacy Visual Review Findings
// ---------------------------------------------------------------------------

export function mapContinuityReviewToLegacyVisualReview(
  sidecar: MinimaxH3ContinuityReviewSidecar
): {
  continuity: "pass" | "defect" | "fail";
  identityFidelity: "pass" | "defect" | "fail";
  visualDegradation: "pass" | "defect" | "fail";
} {
  // If scene substitution occurred, continuity is FAIL regardless of identity
  if (sidecar.sceneSubstitution.detected) {
    const idDims = [
      sidecar.dimensions.identity,
      sidecar.dimensions.subjectAnatomy,
      sidecar.dimensions.faceAndHands
    ];
    let idResult: "pass" | "defect" | "fail" = "pass";
    if (idDims.some((d) => d.assessment === "fail")) {
      idResult = "fail";
    } else if (idDims.some((d) => d.assessment === "defect" || d.assessment === "not_assessable")) {
      idResult = "defect";
    }

    return {
      continuity: "fail",
      identityFidelity: idResult,
      visualDegradation: "fail"
    };
  }

  const continuityDimensions = [
    sidecar.dimensions.wardrobe,
    sidecar.dimensions.backgroundLightingPersistence,
    sidecar.dimensions.cameraFidelity,
    sidecar.dimensions.unnaturalCuts,
    sidecar.dimensions.temporalFlicker,
    sidecar.dimensions.motionCoherence,
    sidecar.dimensions.referenceFidelity
  ];

  let continuity: "pass" | "defect" | "fail" = "pass";
  if (continuityDimensions.some((d) => d.assessment === "fail")) {
    continuity = "fail";
  } else if (
    continuityDimensions.some(
      (d) => d.assessment === "defect" || d.assessment === "not_assessable"
    ) ||
    !continuityDimensions.every((d) => d.assessment === "pass") ||
    (sidecar.route === "i2v" && sidecar.firstFrameAdherence.status !== "pass") ||
    (sidecar.route === "i2v" && sidecar.lastFrameAdherence.status !== "pass")
  ) {
    if (
      sidecar.route === "i2v" &&
      (sidecar.firstFrameAdherence.status === "fail" ||
        sidecar.lastFrameAdherence.status === "fail")
    ) {
      continuity = "fail";
    } else {
      continuity = "defect";
    }
  }

  const identityDimensions = [
    sidecar.dimensions.identity,
    sidecar.dimensions.subjectAnatomy,
    sidecar.dimensions.faceAndHands
  ];

  let identityFidelity: "pass" | "defect" | "fail" = "pass";
  if (identityDimensions.some((d) => d.assessment === "fail")) {
    identityFidelity = "fail";
  } else if (
    identityDimensions.some(
      (d) => d.assessment === "defect" || d.assessment === "not_assessable"
    ) ||
    !identityDimensions.every((d) => d.assessment === "pass")
  ) {
    identityFidelity = "defect";
  }

  const degradationDimensions = [
    sidecar.dimensions.temporalFlicker,
    sidecar.dimensions.backgroundLightingPersistence,
    sidecar.dimensions.subjectAnatomy,
    sidecar.dimensions.faceAndHands
  ];

  let visualDegradation: "pass" | "defect" | "fail" = "pass";
  if (degradationDimensions.some((d) => d.assessment === "fail")) {
    visualDegradation = "fail";
  } else if (
    degradationDimensions.some(
      (d) => d.assessment === "defect" || d.assessment === "not_assessable"
    ) ||
    !degradationDimensions.every((d) => d.assessment === "pass")
  ) {
    visualDegradation = "defect";
  }

  // Sound dimension contributes to continuity
  if (sidecar.dimensions.sound.assessment === "fail") {
    continuity = "fail";
  } else if (
    sidecar.dimensions.sound.assessment === "defect" ||
    (sidecar.dimensions.sound.assessment === "not_assessable" &&
      !sidecar.reviewCoverage.audioExamined)
  ) {
    if (continuity === "pass") {
      continuity = "defect";
    }
  }

  // If all 12 dimensions are not_assessable, all three map to defect (F-ff9d0454)
  const allNotAssessable = Object.values(sidecar.dimensions).every(
    (d) => d.assessment === "not_assessable"
  );
  if (allNotAssessable) {
    continuity = "defect";
    identityFidelity = "defect";
    visualDegradation = "defect";
  }

  // Inconclusive review cannot produce a legacy pass
  if (sidecar.overallOutcome === "inconclusive") {
    if (continuity === "pass") continuity = "defect";
    if (identityFidelity === "pass") identityFidelity = "defect";
    if (visualDegradation === "pass") visualDegradation = "defect";
  }

  return { continuity, identityFidelity, visualDegradation };
}

// ---------------------------------------------------------------------------
// 5. Reference Manifest & Asset Items
// ---------------------------------------------------------------------------

export const ContinuityReferenceAssetSchema = z
  .object({
    slotIndex: z.number().int().nonnegative(),
    role: z.string().min(1),
    tag: z.string().optional(),
    sourceAssetPath: z.string().min(1),
    sourceSha256: sha256HashSchema,
    sourceSizeBytes: z.number().int().positive(),
    mimeType: z.enum(["image/jpeg", "image/png"]),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    derivation: z.string().optional()
  })
  .strict();
export type ContinuityReferenceAsset = z.infer<typeof ContinuityReferenceAssetSchema>;

export const ContinuityReferenceManifestSchema = z
  .object({
    referenceSetId: z.string().min(1),
    manifestDigest: sha256HashSchema,
    references: z.array(ContinuityReferenceAssetSchema).min(1).max(9)
  })
  .strict()
  .superRefine((val, ctx) => {
    // Validate slotIndex contiguity (0..n-1)
    const indices = val.references.map((r) => r.slotIndex).sort((a, b) => a - b);
    for (let i = 0; i < indices.length; i++) {
      if (indices[i] !== i) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Reference slot indices must be contiguous starting at 0; missing index ${i}`,
          path: ["references", String(i)]
        });
      }
    }

    const expectedDigest = computeContinuityReferenceManifestDigest(val);
    if (val.manifestDigest !== expectedDigest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `manifestDigest mismatch: expected ${expectedDigest}, got ${val.manifestDigest}`,
        path: ["manifestDigest"]
      });
    }
  });
export type ContinuityReferenceManifest = z.infer<typeof ContinuityReferenceManifestSchema>;

export function computeReferenceManifestDigest(manifest: {
  referenceSetId: string;
  references: readonly unknown[];
}): string {
  const payload = {
    referenceSetId: manifest.referenceSetId,
    references: manifest.references
  };
  return sha256Hex(canonicalizeJson(payload));
}
export const computeContinuityReferenceManifestDigest = computeReferenceManifestDigest;

// ---------------------------------------------------------------------------
// 6. Constrained Prompt & Scenario Definitions
// ---------------------------------------------------------------------------

export const ConstrainedPromptDefinitionSchema = z
  .object({
    promptId: z.string().min(1),
    label: z.string().min(1),
    text: z.string().min(1),
    digest: sha256HashSchema,
    constraintsApplied: z.array(z.string().min(1)).min(1)
  })
  .strict();
export type ConstrainedPromptDefinition = z.infer<typeof ConstrainedPromptDefinitionSchema>;

export interface CreateContinuityConstrainedPromptOptions {
  basePrompt: string;
  backdrop?: string;
  location?: string;
  subjectMotion?: "static" | "moving";
  cameraMotion?: string;
  keepWardrobe?: boolean;
}

/**
 * Conservatively appends positive continuity constraints to a baseline prompt
 * without altering subject/action/framing/camera intent or introducing unrequested movements.
 */
export function createContinuityConstrainedPrompt(
  options: CreateContinuityConstrainedPromptOptions
): string {
  const {
    basePrompt,
    backdrop,
    location,
    subjectMotion,
    cameraMotion,
    keepWardrobe = true
  } = options;

  const constraints: string[] = [];

  if (subjectMotion === "static") {
    constraints.push("Subject maintains an invariant stationary pose throughout.");
  }

  if (keepWardrobe) {
    constraints.push(
      "Initial identity, appearance, and wardrobe remain invariant throughout the shot."
    );
  }

  if (backdrop) {
    constraints.push(
      `Background remains an invariant ${backdrop} with stable illumination and zero blackout or dropouts.`
    );
  } else if (location) {
    constraints.push(
      `Background environment at ${location} remains steady and invariant throughout with constant lighting.`
    );
  } else {
    constraints.push(
      "Background and lighting remain stable throughout with zero blackout, dimming, or flicker."
    );
  }

  if (cameraMotion) {
    constraints.push(
      `Camera executes only the requested ${cameraMotion} without abrupt speed changes or unrequested push.`
    );
  } else {
    constraints.push(
      "Only requested camera movement is performed without abrupt speed changes or unrequested push."
    );
  }

  constraints.push(
    "Continuous single-take shot without unrequested cuts, fades, scene substitutions, or transitions."
  );

  return `${basePrompt.trim()} ${constraints.join(" ")}`.trim();
}

export const ContinuityScenarioRoleSchema = z.enum([
  "historical_baseline",
  "motion_variant",
  "illustrative_test"
]);
export type ContinuityScenarioRole = z.infer<typeof ContinuityScenarioRoleSchema>;

export const ContinuityScenarioSchema = z
  .object({
    scenarioId: z.string().min(1),
    scenarioRole: ContinuityScenarioRoleSchema.optional(),
    subjectMotionIntent: z.enum(["static", "moving"]),
    route: MinimaxH3ExperimentRouteSchema,
    conditioningMode: z.enum(["frame_anchored", "reference_directed"]),
    status: z.enum(["resolved", "pending_source"]),
    pendingReason: z.string().min(1).optional(),
    originalPrompt: z
      .object({
        text: z.string().min(1),
        digest: sha256HashSchema
      })
      .strict()
      .nullable(),
    constrainedPrompts: z.array(ConstrainedPromptDefinitionSchema).min(1).max(2),
    referenceManifest: ContinuityReferenceManifestSchema
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.status === "pending_source") {
      if (!val.pendingReason || val.pendingReason.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "pendingReason is required when scenario status is 'pending_source'",
          path: ["pendingReason"]
        });
      }
      if (val.originalPrompt !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "originalPrompt must be null when scenario status is 'pending_source'; no purported original prompt is permitted",
          path: ["originalPrompt"]
        });
      }
    }
    if (val.status === "resolved") {
      if (
        !val.originalPrompt ||
        !val.originalPrompt.text ||
        val.originalPrompt.text.trim().length === 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Resolved scenario requires a valid originalPrompt with non-empty text",
          path: ["originalPrompt"]
        });
      }
    }
    if (val.route === "i2v") {
      if (val.conditioningMode !== "frame_anchored") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "i2v route requires conditioningMode 'frame_anchored'",
          path: ["conditioningMode"]
        });
      }
      if (val.referenceManifest.references.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `i2v route requires exactly 1 reference (first_frame), got ${val.referenceManifest.references.length}`,
          path: ["referenceManifest", "references"]
        });
      } else {
        const ref0 = val.referenceManifest.references[0]!;
        if (ref0.role !== "first_frame") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `i2v reference must have role 'first_frame', got '${ref0.role}'`,
            path: ["referenceManifest", "references", "0", "role"]
          });
        }
        if (ref0.tag && ref0.tag !== "<Picture 1>") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `i2v reference tag must be '<Picture 1>', got '${ref0.tag}'`,
            path: ["referenceManifest", "references", "0", "tag"]
          });
        }
      }
    }
    if (val.route === "ref2v") {
      if (val.conditioningMode !== "reference_directed") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "ref2v route requires conditioningMode 'reference_directed'",
          path: ["conditioningMode"]
        });
      }
      for (let i = 0; i < val.referenceManifest.references.length; i++) {
        const ref = val.referenceManifest.references[i]!;
        if (ref.role === "first_frame") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `ref2v route cannot contain a 'first_frame' reference role at index ${i}; I2V start frames cannot be substituted into Ref2V`,
            path: ["referenceManifest", "references", String(i), "role"]
          });
        }
        const expectedTag = `<Picture ${i + 1}>`;
        if (ref.tag !== expectedTag) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `ref2v reference at slot ${i} must have tag '${expectedTag}', got '${ref.tag}'`,
            path: ["referenceManifest", "references", String(i), "tag"]
          });
        }
      }
    }
    // Verify prompt digests match sha256Hex of exact prompt text
    if (val.originalPrompt && val.originalPrompt.text) {
      const expectedDigest = sha256Hex(val.originalPrompt.text);
      if (val.originalPrompt.digest !== expectedDigest) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `originalPrompt digest mismatch: expected ${expectedDigest}, got ${val.originalPrompt.digest}`,
          path: ["originalPrompt", "digest"]
        });
      }
    }
    for (let i = 0; i < val.constrainedPrompts.length; i++) {
      const cp = val.constrainedPrompts[i]!;
      const expectedDigest = sha256Hex(cp.text);
      if (cp.digest !== expectedDigest) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `constrainedPrompts[${i}] digest mismatch: expected ${expectedDigest}, got ${cp.digest}`,
          path: ["constrainedPrompts", String(i), "digest"]
        });
      }
    }
  });
export type ContinuityScenario = z.infer<typeof ContinuityScenarioSchema>;

// ---------------------------------------------------------------------------
// 7. Study Cells and Factor Arms
// ---------------------------------------------------------------------------

export const CONTINUITY_STUDY_ARMS = [
  "baseline",
  "prompt_only",
  "checkpoint_only",
  "attention_only",
  "reduced_step_only",
  "combined"
] as const;
export const ContinuityStudyArmSchema = z.enum(CONTINUITY_STUDY_ARMS);
export type ContinuityStudyArm = z.infer<typeof ContinuityStudyArmSchema>;

export const ContinuityReviewPrerequisiteRecordSchema = z
  .object({
    cellId: z.string().min(1),
    runId: z.string().min(1),
    reviewId: z.string().min(1),
    reviewRevision: z.number().int().positive(),
    reviewDigest: sha256HashSchema,
    operatorDisposition: z.enum(["admitted", "rejected"])
  })
  .strict();
export type ContinuityReviewPrerequisiteRecord = z.infer<
  typeof ContinuityReviewPrerequisiteRecordSchema
>;

export const ContinuityStudyCellSchema = z
  .object({
    cellId: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, "Invalid cellId format"),
    scenarioId: z.string().min(1),
    frames: MinimaxH3ExperimentCandidateFramesSchema,
    arm: ContinuityStudyArmSchema,
    promptVariantId: z.string().min(1),
    prompt: z.string().nullable(),
    promptDigest: sha256HashSchema.nullable(),
    checkpointOverride: z.enum(["ref2va", "fl2va"]).nullable().optional(),
    stepOverride: z.number().int().positive().nullable().optional(),
    attentionVariant: MinimaxH3AttentionVariantNameSchema.nullable().optional(),
    matchedVariant: MinimaxH3AttentionVariantNameSchema.nullable().optional(),
    status: z.enum(["resolved", "pending_source"]),
    pendingReason: z.string().nullable().optional(),
    safetyBaseline124fCellId: z.string().nullable().optional(),
    prerequisiteCellIds: z.array(z.string()).optional(),
    prerequisiteReviews: z.array(ContinuityReviewPrerequisiteRecordSchema).optional()
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.status === "pending_source") {
      if (!val.pendingReason || val.pendingReason.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "pendingReason is required when cell status is 'pending_source'",
          path: ["pendingReason"]
        });
      }
      if (val.prompt !== null || val.promptDigest !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "pending_source cell must have prompt=null and promptDigest=null",
          path: ["prompt"]
        });
      }
    }
    if (val.status === "resolved") {
      if (!val.prompt || !val.promptDigest) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Resolved cell requires prompt and promptDigest",
          path: ["prompt"]
        });
      } else if (val.promptDigest !== sha256Hex(val.prompt)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `promptDigest mismatch: expected ${sha256Hex(val.prompt)}, got ${val.promptDigest}`,
          path: ["promptDigest"]
        });
      }
    }
  });
export type ContinuityStudyCell = z.infer<typeof ContinuityStudyCellSchema>;

export const ContinuityComparisonEdgeSchema = z
  .object({
    edgeId: z.string().min(1),
    frames: MinimaxH3ExperimentCandidateFramesSchema,
    scenarioId: z.string().min(1),
    arm: ContinuityStudyArmSchema,
    baselineCellId: z.string().min(1),
    candidateCellId: z.string().min(1),
    declaredFactorPaths: z.array(z.string().min(1)).min(1),
    status: z.enum(["resolved", "pending_source"]),
    pendingReason: z.string().nullable().optional(),
    independentReviewPrerequisites: z
      .object({
        baselineCellId: z.string().min(1),
        candidateCellId: z.string().min(1),
        requiredForPreparation: z.boolean(),
        prerequisiteReviews: z.array(ContinuityReviewPrerequisiteRecordSchema).optional()
      })
      .strict()
      .optional()
  })
  .strict();
export type ContinuityComparisonEdge = z.infer<typeof ContinuityComparisonEdgeSchema>;

// ---------------------------------------------------------------------------
// 8. Study Specification Schema
// ---------------------------------------------------------------------------

export const ContinuityStudyControlsSchema = z
  .object({
    width: z.number().int().positive().default(1344),
    height: z.number().int().positive().default(768),
    fps: z.number().int().positive().default(24),
    seed: z.number().int().min(0).default(42),
    runnerVariant: z.string().min(1).default("dynamicvram-offload-v1"),
    schedule: z
      .object({
        sampler: z.string().min(1),
        scheduler: z.string().min(1),
        steps: z.number().int().positive()
      })
      .strict(),
    candidateFrames: z.array(MinimaxH3ExperimentCandidateFramesSchema).min(4).max(4),
    runtimeCoreRevision: z.string().min(1).optional(),
    runtimeManifestDigest: sha256HashSchema.optional(),
    diffusionCheckpoint: z
      .object({
        repository: z.string().min(1),
        revision: z.string().min(1),
        filename: z.string().min(1),
        sha256: sha256HashSchema,
        taskMode: z.string().min(1).optional(),
        auditRef: z.string().min(1).optional()
      })
      .strict()
  })
  .strict()
  .superRefine((val, ctx) => {
    const required = [124, 192, 243, 362] as const;
    const frameSet = new Set(val.candidateFrames);
    if (frameSet.size !== 4 || !required.every((f) => frameSet.has(f))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "candidateFrames must contain exactly the 4 frame counts [124, 192, 243, 362] without duplicates",
        path: ["candidateFrames"]
      });
    }
  });
export type ContinuityStudyControls = z.infer<typeof ContinuityStudyControlsSchema>;

export const MinimaxH3ContinuityStudySpecSchema = z
  .object({
    schemaVersion: z.literal(1),
    studyId: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, "Invalid studyId format"),
    studyDigest: sha256HashSchema,
    rubricVersion: z.literal(1),
    rubricDigest: sha256HashSchema,
    sourceEvidenceReferences: z.array(MinimaxH3SourceEvidenceRefSchema).min(1),
    scenarios: z.array(ContinuityScenarioSchema).min(1),
    studyControls: ContinuityStudyControlsSchema,
    cells: z.array(ContinuityStudyCellSchema).min(1),
    comparisonEdges: z.array(ContinuityComparisonEdgeSchema)
  })
  .strict()
  .superRefine((val, ctx) => {
    // Verify studyDigest
    const expectedDigest = computeContinuityStudyDigest(val);
    if (val.studyDigest !== expectedDigest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `studyDigest mismatch: expected ${expectedDigest}, got ${val.studyDigest}`,
        path: ["studyDigest"]
      });
    }

    // Verify cellId uniqueness
    const cellIds = new Set<string>();
    for (const cell of val.cells) {
      if (cellIds.has(cell.cellId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate cellId '${cell.cellId}' in study cells`,
          path: ["cells"]
        });
      }
      cellIds.add(cell.cellId);
    }

    // Verify scenarioId references in cells and reconcile scenario readiness
    const scenarioMap = new Map(val.scenarios.map((s) => [s.scenarioId, s]));
    for (const cell of val.cells) {
      const scen = scenarioMap.get(cell.scenarioId);
      if (!scen) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Cell '${cell.cellId}' references unknown scenarioId '${cell.scenarioId}'`,
          path: ["cells"]
        });
      } else if (scen.status === "pending_source") {
        if (cell.status !== "pending_source") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Cell '${cell.cellId}' claims status '${cell.status}', but parent scenario '${cell.scenarioId}' is 'pending_source'. A pending scenario cannot have resolved cells.`,
            path: ["cells"]
          });
        }
        if (cell.prompt !== null || cell.promptDigest !== null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Cell '${cell.cellId}' has prompt text/digest, but parent scenario '${cell.scenarioId}' is 'pending_source'. Pending cells must have prompt=null.`,
            path: ["cells"]
          });
        }
      }
    }

    // Verify safety baseline links across all cells
    const cellMap = new Map(val.cells.map((c) => [c.cellId, c]));
    for (const cell of val.cells) {
      if (cell.frames > 124) {
        if (!cell.safetyBaseline124fCellId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Cell "${cell.cellId}" (${cell.frames}f) must define a safetyBaseline124fCellId`,
            path: ["cells"]
          });
          continue;
        }
        const safetyCell = cellMap.get(cell.safetyBaseline124fCellId);
        if (!safetyCell) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Cell "${cell.cellId}" references nonexistent safetyBaseline124fCellId "${cell.safetyBaseline124fCellId}"`,
            path: ["cells"]
          });
          continue;
        }
        if (safetyCell.frames !== 124) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Safety baseline cell "${safetyCell.cellId}" must have frames=124, got ${safetyCell.frames}`,
            path: ["cells"]
          });
        }
        if (safetyCell.scenarioId !== cell.scenarioId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Safety baseline cell "${safetyCell.cellId}" scenario "${safetyCell.scenarioId}" does not match cell scenario "${cell.scenarioId}"`,
            path: ["cells"]
          });
        }
        if (safetyCell.promptVariantId !== cell.promptVariantId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Safety baseline cell "${safetyCell.cellId}" promptVariantId "${safetyCell.promptVariantId}" does not match cell "${cell.promptVariantId}"`,
            path: ["cells"]
          });
        }
        if (safetyCell.arm !== cell.arm) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Safety baseline cell "${safetyCell.cellId}" arm "${safetyCell.arm}" does not match cell arm "${cell.arm}"`,
            path: ["cells"]
          });
        }
        if (safetyCell.checkpointOverride !== cell.checkpointOverride) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Safety baseline cell "${safetyCell.cellId}" checkpointOverride "${safetyCell.checkpointOverride ?? "default"}" does not match cell "${cell.checkpointOverride ?? "default"}"`,
            path: ["cells"]
          });
        }
        if (safetyCell.stepOverride !== cell.stepOverride) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Safety baseline cell "${safetyCell.cellId}" stepOverride "${safetyCell.stepOverride ?? "default"}" does not match cell "${cell.stepOverride ?? "default"}"`,
            path: ["cells"]
          });
        }
        if (safetyCell.attentionVariant !== cell.attentionVariant) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Safety baseline cell "${safetyCell.cellId}" attentionVariant "${safetyCell.attentionVariant ?? "default"}" does not match cell "${cell.attentionVariant ?? "default"}"`,
            path: ["cells"]
          });
        }
        if (safetyCell.matchedVariant !== cell.matchedVariant) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Safety baseline cell "${safetyCell.cellId}" matchedVariant "${safetyCell.matchedVariant ?? "default"}" does not match cell "${cell.matchedVariant ?? "default"}"`,
            path: ["cells"]
          });
        }
      } else {
        if (cell.safetyBaseline124fCellId != null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `124f cell "${cell.cellId}" must not define safetyBaseline124fCellId, got "${cell.safetyBaseline124fCellId}"`,
            path: ["cells"]
          });
        }
      }
    }

    // Verify comparison edges reference valid cellIds of identical frame counts, scenarios, and routes
    for (const edge of val.comparisonEdges) {
      const baseline = val.cells.find((c) => c.cellId === edge.baselineCellId);
      const candidate = val.cells.find((c) => c.cellId === edge.candidateCellId);
      if (!baseline) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Edge '${edge.edgeId}' references unknown baselineCellId '${edge.baselineCellId}'`,
          path: ["comparisonEdges"]
        });
      }
      if (!candidate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Edge '${edge.edgeId}' references unknown candidateCellId '${edge.candidateCellId}'`,
          path: ["comparisonEdges"]
        });
      }
      if (baseline && candidate) {
        if (baseline.frames !== candidate.frames || edge.frames !== baseline.frames) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Edge '${edge.edgeId}' frame mismatch: edge is ${edge.frames}, baseline is ${baseline.frames}, candidate is ${candidate.frames}; cross-frame comparison is prohibited`,
            path: ["comparisonEdges"]
          });
        }
        if (
          baseline.scenarioId !== candidate.scenarioId ||
          edge.scenarioId !== baseline.scenarioId
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Edge '${edge.edgeId}' scenario mismatch: edge is ${edge.scenarioId}, baseline is ${baseline.scenarioId}, candidate is ${candidate.scenarioId}; cross-scenario comparison is prohibited`,
            path: ["comparisonEdges"]
          });
        }
        const baseScen = scenarioMap.get(baseline.scenarioId);
        const candScen = scenarioMap.get(candidate.scenarioId);
        if (baseScen && candScen && baseScen.route !== candScen.route) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Edge '${edge.edgeId}' route mismatch: baseline is ${baseScen.route}, candidate is ${candScen.route}; cross-route comparison is prohibited`,
            path: ["comparisonEdges"]
          });
        }
        const scen = scenarioMap.get(edge.scenarioId);
        if (scen && scen.status === "pending_source" && edge.status !== "pending_source") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Edge '${edge.edgeId}' claims status '${edge.status}', but parent scenario '${edge.scenarioId}' is 'pending_source'.`,
            path: ["comparisonEdges"]
          });
        }
        if (edge.arm === "combined" && !edge.independentReviewPrerequisites) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Edge '${edge.edgeId}' for combined arm requires independentReviewPrerequisites to be declared.`,
            path: ["comparisonEdges"]
          });
        }
      }
    }
  });
export type MinimaxH3ContinuityStudySpec = z.infer<typeof MinimaxH3ContinuityStudySpecSchema>;

export function computeContinuityStudyDigest(
  spec: Omit<MinimaxH3ContinuityStudySpec, "studyDigest">
): string {
  const payload = {
    schemaVersion: spec.schemaVersion,
    studyId: spec.studyId,
    rubricVersion: spec.rubricVersion,
    rubricDigest: spec.rubricDigest,
    sourceEvidenceReferences: spec.sourceEvidenceReferences,
    scenarios: spec.scenarios.map((s) => ({
      ...s,
      scenarioRole: s.scenarioRole ?? "historical_baseline"
    })),
    studyControls: {
      ...spec.studyControls,
      runtimeCoreRevision: spec.studyControls.runtimeCoreRevision ?? PINNED_COMFYUI_CORE_REVISION,
      runtimeManifestDigest:
        spec.studyControls.runtimeManifestDigest ??
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      diffusionCheckpoint: {
        ...spec.studyControls.diffusionCheckpoint,
        taskMode: spec.studyControls.diffusionCheckpoint.taskMode ?? "ref2va",
        auditRef:
          spec.studyControls.diffusionCheckpoint.auditRef ??
          "docs/minimax-h3-checkpoint-conditioning-audit.md"
      }
    },
    cells: spec.cells,
    comparisonEdges: spec.comparisonEdges
  };
  return sha256Hex(canonicalizeJson(payload));
}

// ---------------------------------------------------------------------------
// 9. Storyboard Plan & Review Manifest Schemas
// ---------------------------------------------------------------------------

export const PlaybackAlignmentSchema = z
  .object({
    timeZeroAligned: z.literal(true),
    notes: z.string().min(1)
  })
  .strict();
export type PlaybackAlignment = z.infer<typeof PlaybackAlignmentSchema>;

export const StoryboardDerivativeSchema = z
  .object({
    sourceOutputSha256: sha256HashSchema,
    sampleFrame: z.number().int().nonnegative(),
    sampleTimeSec: z.number().min(0),
    extractionTool: z
      .object({
        name: z.string().min(1),
        version: z.string().min(1),
        configDigest: sha256HashSchema
      })
      .strict(),
    derivativeSha256: sha256HashSchema,
    extractedAt: z.string().datetime()
  })
  .strict();
export type StoryboardDerivative = z.infer<typeof StoryboardDerivativeSchema>;

export const PlannedSamplePointSchema = z
  .object({
    targetFrame: z.number().int().nonnegative(),
    targetTimeSec: z.number().min(0),
    sampleReason: z.enum([
      "first_frame",
      "last_frame",
      "camera_beat",
      "action_beat",
      "362f_collapse_window",
      "362f_recovery",
      "regular_interval",
      "user_specified"
    ]),
    inRange: z.boolean()
  })
  .strict();
export type PlannedSamplePoint = z.infer<typeof PlannedSamplePointSchema>;

export const MediaBindingRecordSchema = z
  .object({
    runId: z.string().nullable().optional(),
    descriptorDigest: sha256HashSchema.nullable().optional(),
    resultDigest: sha256HashSchema.nullable().optional(),
    outputSha256: sha256HashSchema.nullable().optional(),
    outputSizeBytes: z.number().int().positive().nullable().optional(),
    outputRelativePath: z.string().nullable().optional(),
    measuredFps: z.number().nullable().optional(),
    measuredFrames: z.number().int().positive().nullable().optional(),
    collectionStatus: z.enum(["pending", "available", "unavailable", "failed"])
  })
  .strict();
export type MediaBindingRecord = z.infer<typeof MediaBindingRecordSchema>;

export const StoryboardPanelSchema = z
  .object({
    panelId: z.string().min(1),
    cellId: z.string().min(1),
    scenarioId: z.string().min(1),
    route: MinimaxH3ExperimentRouteSchema,
    conditioningMode: z.enum(["frame_anchored", "reference_directed"]),
    frames: MinimaxH3ExperimentCandidateFramesSchema,
    durationSec: z.number().positive(),
    checkpointSha: sha256HashSchema,
    seed: z.number().int().min(0),
    promptVariantId: z.string().min(1),
    promptDigest: sha256HashSchema.nullable(),
    promptText: z.string().nullable(),
    requestedAttention: z.string().min(1),
    observedAttention: z.string().nullable().optional(),
    sampler: z.string().min(1),
    scheduler: z.string().min(1),
    steps: z.number().int().positive(),
    runtimeCoreRevision: z.string().min(1),
    alignedPlayback: PlaybackAlignmentSchema.optional(),
    actionAndCameraBeats: z.array(z.string()).optional(),
    fullClipInspectionRequired: z.boolean().optional(),
    inspectionInstructions: z.array(z.string()).optional(),
    plannedSamples: z.array(PlannedSamplePointSchema).min(1),
    mediaBinding: MediaBindingRecordSchema,
    derivatives: z.array(StoryboardDerivativeSchema).optional()
  })
  .strict();
export type StoryboardPanel = z.infer<typeof StoryboardPanelSchema>;

export const MinimaxH3StoryboardPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("storyboard-plan"),
    planDigest: sha256HashSchema,
    studyId: z.string().min(1),
    studyDigest: sha256HashSchema,
    generatedAt: z.string().datetime(),
    panels: z.array(StoryboardPanelSchema).min(1)
  })
  .strict();
export type MinimaxH3StoryboardPlan = z.infer<typeof MinimaxH3StoryboardPlanSchema>;

export function computeStoryboardPlanDigest(
  plan: Omit<MinimaxH3StoryboardPlan, "planDigest">
): string {
  const payload = {
    schemaVersion: plan.schemaVersion,
    kind: plan.kind,
    studyId: plan.studyId,
    studyDigest: plan.studyDigest,
    generatedAt: plan.generatedAt,
    panels: plan.panels
  };
  return sha256Hex(canonicalizeJson(payload));
}

export const ReviewManifestComparisonPairSchema = z
  .object({
    pairId: z.string().min(1),
    edgeId: z.string().min(1),
    frames: MinimaxH3ExperimentCandidateFramesSchema,
    scenarioId: z.string().min(1),
    arm: ContinuityStudyArmSchema,
    baselinePanelId: z.string().min(1),
    candidatePanelId: z.string().min(1),
    declaredFactorPaths: z.array(z.string().min(1)).min(1),
    status: z.enum(["resolved", "pending_source"])
  })
  .strict();
export type ReviewManifestComparisonPair = z.infer<typeof ReviewManifestComparisonPairSchema>;

export const MinimaxH3ReviewManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("review-manifest"),
    manifestDigest: sha256HashSchema,
    studyId: z.string().min(1),
    studyDigest: sha256HashSchema,
    generatedAt: z.string().datetime(),
    panels: z.array(StoryboardPanelSchema).min(1),
    comparisonPairs: z.array(ReviewManifestComparisonPairSchema)
  })
  .strict();
export type MinimaxH3ReviewManifest = z.infer<typeof MinimaxH3ReviewManifestSchema>;

export function computeReviewManifestDigest(
  manifest: Omit<MinimaxH3ReviewManifest, "manifestDigest">
): string {
  const payload = {
    schemaVersion: manifest.schemaVersion,
    kind: manifest.kind,
    studyId: manifest.studyId,
    studyDigest: manifest.studyDigest,
    generatedAt: manifest.generatedAt,
    panels: manifest.panels,
    comparisonPairs: manifest.comparisonPairs
  };
  return sha256Hex(canonicalizeJson(payload));
}

// ---------------------------------------------------------------------------
// 10. Non-Authoritative Diagnostic Proxy Schemas
// ---------------------------------------------------------------------------

export const DiagnosticMetricNameSchema = z.enum([
  "scene_cut_proxy",
  "brightness_shift_proxy",
  "segmentation_proxy",
  "temporal_difference_proxy"
]);
export type DiagnosticMetricName = z.infer<typeof DiagnosticMetricNameSchema>;

export const MinimaxH3DiagnosticSampleSchema = z
  .object({
    metricName: DiagnosticMetricNameSchema,
    sampleFrame: z.number().int().nonnegative(),
    sampleTimeSec: z.number().min(0),
    numericValue: z.number().nullable(),
    unit: z.string().min(1),
    analysisTimestamp: z.string().datetime(),
    unavailableReason: z.string().nullable().optional()
  })
  .strict();
export type MinimaxH3DiagnosticSample = z.infer<typeof MinimaxH3DiagnosticSampleSchema>;

const FORBIDDEN_ACCEPTANCE_WORDS = [
  "acceptance",
  "accept",
  "approved",
  "verdict",
  "qualityScore",
  "creativePass",
  "humanSignoff"
];

export const MinimaxH3DiagnosticReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("diagnostic-proxy-report"),
    sourceFileSha256: sha256HashSchema,
    sourceFilePath: z.string().min(1),
    analyzedAt: z.string().datetime(),
    tool: z
      .object({
        name: z.string().min(1),
        version: z.string().min(1),
        configDigest: sha256HashSchema
      })
      .strict(),
    samples: z.array(MinimaxH3DiagnosticSampleSchema)
  })
  .passthrough()
  .superRefine((val, ctx) => {
    // Non-authoritative proxy: strictly forbids creative acceptance claims
    const jsonStr = JSON.stringify(val).toLowerCase();
    for (const word of FORBIDDEN_ACCEPTANCE_WORDS) {
      if (jsonStr.includes(`"${word.toLowerCase()}"`)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Diagnostic proxies must not claim creative acceptance: forbidden field '${word}' found`,
          path: []
        });
      }
    }
    const allowedKeys = new Set([
      "schemaVersion",
      "kind",
      "sourceFileSha256",
      "sourceFilePath",
      "analyzedAt",
      "tool",
      "samples"
    ]);
    for (const k of Object.keys(val)) {
      if (!allowedKeys.has(k)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unrecognized key '${k}' in diagnostic report`,
          path: [k]
        });
      }
    }
  });
export type MinimaxH3DiagnosticReport = z.infer<typeof MinimaxH3DiagnosticReportSchema>;
