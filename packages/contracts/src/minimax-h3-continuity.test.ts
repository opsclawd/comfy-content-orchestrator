import { describe, expect, it } from "vitest";
import {
  MinimaxH3ContinuityReviewSidecarSchema,
  MinimaxH3ContinuityStudySpecSchema,
  MinimaxH3StoryboardPlanSchema,
  MinimaxH3ReviewManifestSchema,
  MinimaxH3DiagnosticReportSchema,
  ContinuityReferenceManifestSchema,
  computeContinuityStudyDigest,
  computeContinuityRubricDigest,
  computeReferenceManifestDigest,
  computeStoryboardPlanDigest,
  computeReviewManifestDigest,
  computeContinuityReviewDigest,
  mapContinuityReviewToLegacyVisualReview,
  createContinuityConstrainedPrompt,
  ContinuityReviewPrerequisiteRecordSchema,
  CONTINUITY_RUBRIC_DIMENSIONS,
  type MinimaxH3ContinuityReviewSidecar,
  type MinimaxH3ContinuityStudySpec
} from "./minimax-h3-continuity.js";
import { sha256Hex } from "./minimax-h3-experiment.js";

const DUMMY_SHA = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const DUMMY_OUTPUT_SHA = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

function createValidContinuitySidecar(
  overrides?: Partial<MinimaxH3ContinuityReviewSidecar>
): MinimaxH3ContinuityReviewSidecar {
  const rubricDigest = computeContinuityRubricDigest();
  const baseDraft = {
    schemaVersion: 1 as const,
    kind: "continuity-review-sidecar" as const,
    reviewId: "rev-001",
    reviewRevision: 1,
    rubricVersion: 1 as const,
    rubricDigest,
    studyId: "study-001",
    cellId: "cell-i2v-243f-orig",
    runId: "run-i2v-243f-001",
    descriptorDigest: DUMMY_SHA,
    route: "i2v" as const,
    configuredFrames: 243 as const,
    sourceOutputSha256: DUMMY_OUTPUT_SHA,
    reviewer: "operator-alice",
    reviewedAt: "2026-10-14T12:00:00.000Z",
    reviewCoverage: {
      playbackExamined: true,
      audioExamined: true,
      fullClipExamined: true,
      storyboardSampled: true
    },
    dimensions: {
      identity: {
        assessment: "pass" as const,
        fullClipAssessment: true,
        rationale: "Subject facial structure and dreadlocks remain persistent throughout."
      },
      wardrobe: {
        assessment: "pass" as const,
        fullClipAssessment: true,
        rationale: "Jacket and shirt remain consistent with start frame."
      },
      backgroundLightingPersistence: {
        assessment: "pass" as const,
        fullClipAssessment: true,
        rationale: "Yellow backdrop and key lighting remain stable across all frames."
      },
      cameraFidelity: {
        assessment: "pass" as const,
        fullClipAssessment: true,
        rationale: "Smooth push-in matches requested camera trajectory."
      },
      subjectAnatomy: {
        assessment: "pass" as const,
        fullClipAssessment: true,
        rationale: "Anatomical integrity maintained with natural posture."
      },
      faceAndHands: {
        assessment: "pass" as const,
        fullClipAssessment: true,
        rationale: "Facial expressions and visible hands remain coherent."
      },
      unnaturalCuts: {
        assessment: "pass" as const,
        fullClipAssessment: true,
        rationale: "No unexpected cuts, transitions or camera jumps."
      },
      temporalFlicker: {
        assessment: "pass" as const,
        fullClipAssessment: true,
        rationale: "Smooth temporal continuity without high-frequency flicker."
      },
      referenceFidelity: {
        assessment: "pass" as const,
        fullClipAssessment: true,
        rationale: "High fidelity to Trinidad subject reference photo."
      },
      motionCoherence: {
        assessment: "pass" as const,
        fullClipAssessment: true,
        rationale: "Natural facial movement and subtle breathing motion."
      },
      sound: {
        assessment: "not_assessable" as const,
        rationale: "Silent video output; audio track not synthesized in this route."
      },
      overallAdUsability: {
        assessment: "pass" as const,
        fullClipAssessment: true,
        rationale: "Asset meets commercial advertising delivery standards."
      }
    },
    sceneSubstitution: {
      detected: false
    },
    firstFrameAdherence: {
      status: "pass" as const,
      rationale: "Initial output frame matches the center-cropped start frame exactly."
    },
    lastFrameAdherence: {
      status: "pass" as const,
      rationale: "Final output frame adheres to expected camera framing."
    },
    defectSpecificInspections: {
      wardrobe243fDepartureInspected: true,
      yellowBackdrop243fDepartureInspected: true,
      environment362fBlackoutInspected: false,
      environment362fRecoveryInspected: false,
      sceneSubstitution362fInspected: false,
      camera124fPushInspected: false,
      notes: "Carefully checked frame 120-180 for any clothing departure."
    },
    overallOutcome: "pass" as const,
    notes: "High quality 243f continuity result."
  };

  const combined = { ...baseDraft, ...overrides };
  const reviewDigest =
    overrides?.reviewDigest ??
    computeContinuityReviewDigest(
      combined as Omit<MinimaxH3ContinuityReviewSidecar, "reviewDigest">
    );
  return { ...combined, reviewDigest };
}

describe("MiniMax-H3 Continuity Contracts", () => {
  describe("Continuity Review Sidecar Schema", () => {
    it("validates a fully conformant 243f continuity review sidecar", () => {
      const sidecar = createValidContinuitySidecar();
      const parsed = MinimaxH3ContinuityReviewSidecarSchema.parse(sidecar);
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.overallOutcome).toBe("pass");
      expect(parsed.dimensions.wardrobe.assessment).toBe("pass");
    });

    it("requires defect-specific inspections matching configuredFrames", () => {
      // 243f requires wardrobe243fDepartureInspected
      const sidecar243 = createValidContinuitySidecar({
        configuredFrames: 243,
        defectSpecificInspections: {
          wardrobe243fDepartureInspected: false,
          environment362fBlackoutInspected: false,
          camera124fPushInspected: false
        }
      });
      expect(() => MinimaxH3ContinuityReviewSidecarSchema.parse(sidecar243)).toThrow(
        /wardrobe243fDepartureInspected/
      );

      // 362f requires environment362fBlackoutInspected
      const sidecar362 = createValidContinuitySidecar({
        configuredFrames: 362,
        defectSpecificInspections: {
          wardrobe243fDepartureInspected: false,
          environment362fBlackoutInspected: false,
          camera124fPushInspected: false
        }
      });
      expect(() => MinimaxH3ContinuityReviewSidecarSchema.parse(sidecar362)).toThrow(
        /environment362fBlackoutInspected/
      );

      // 124f requires camera124fPushInspected
      const sidecar124 = createValidContinuitySidecar({
        configuredFrames: 124,
        defectSpecificInspections: {
          wardrobe243fDepartureInspected: false,
          environment362fBlackoutInspected: false,
          camera124fPushInspected: false
        }
      });
      expect(() => MinimaxH3ContinuityReviewSidecarSchema.parse(sidecar124)).toThrow(
        /camera124fPushInspected/
      );
    });

    it("rejects overallOutcome 'pass' when sceneSubstitution is detected even if identity passes", () => {
      const sidecar = createValidContinuitySidecar({
        sceneSubstitution: {
          detected: true,
          severity: "critical",
          rationale: "Complete background blackout and subject replacement at 3.5s",
          intervals: [{ startSec: 3.3, endSec: 6.7, note: "Near-black collapse" }]
        },
        overallOutcome: "pass"
      });
      expect(() => MinimaxH3ContinuityReviewSidecarSchema.parse(sidecar)).toThrow(
        /Scene substitution detected: overallOutcome cannot be 'pass'/
      );
    });

    it("rejects overallOutcome 'pass' if review coverage is incomplete", () => {
      const sidecar = createValidContinuitySidecar({
        reviewCoverage: {
          playbackExamined: false,
          audioExamined: false,
          fullClipExamined: false,
          storyboardSampled: true
        }
      });
      expect(() => MinimaxH3ContinuityReviewSidecarSchema.parse(sidecar)).toThrow(
        /requires both fullClipExamined and playbackExamined/
      );
    });

    it("rejects overallOutcome 'pass' if audioExamined is false (AC-24)", () => {
      const sidecar = createValidContinuitySidecar({
        overallOutcome: "pass",
        reviewCoverage: {
          playbackExamined: true,
          audioExamined: false,
          fullClipExamined: true,
          storyboardSampled: true
        }
      });
      expect(() => MinimaxH3ContinuityReviewSidecarSchema.parse(sidecar)).toThrow(
        /audioExamined to be true/
      );
    });

    it("requires rationale when dimension assessment is not_assessable", () => {
      const sidecar = createValidContinuitySidecar();
      sidecar.dimensions.sound = {
        assessment: "not_assessable",
        rationale: ""
      };
      expect(() => MinimaxH3ContinuityReviewSidecarSchema.parse(sidecar)).toThrow(
        /Rationale is required/
      );
    });

    it("enforces startSec <= endSec on interval records", () => {
      const sidecar = createValidContinuitySidecar();
      sidecar.dimensions.backgroundLightingPersistence = {
        assessment: "defect",
        severity: "major",
        rationale: "Lighting collapse observed",
        intervals: [{ startSec: 6.7, endSec: 3.3, note: "Invalid interval order" }]
      };
      expect(() => MinimaxH3ContinuityReviewSidecarSchema.parse(sidecar)).toThrow(
        /endSec must be greater than or equal to startSec/
      );
    });
  });

  describe("Conservative Mapping to Legacy Visual Review", () => {
    it("maps all-pass continuity review to all-pass legacy findings", () => {
      const sidecar = createValidContinuitySidecar();
      const legacy = mapContinuityReviewToLegacyVisualReview(sidecar);
      expect(legacy.continuity).toBe("pass");
      expect(legacy.identityFidelity).toBe("pass");
      expect(legacy.visualDegradation).toBe("pass");
    });

    it("maps 243f wardrobe defect to continuity defect", () => {
      const sidecar = createValidContinuitySidecar({
        overallOutcome: "defect"
      });
      sidecar.dimensions.wardrobe = {
        assessment: "defect",
        severity: "major",
        rationale: "Jacket shifted color temporarily from blue to green at 5.0s",
        intervals: [{ startSec: 4.8, endSec: 6.2 }]
      };
      const legacy = mapContinuityReviewToLegacyVisualReview(sidecar);
      expect(legacy.continuity).toBe("defect");
      expect(legacy.identityFidelity).toBe("pass");
    });

    it("maps 362f background collapse to continuity fail and visualDegradation fail", () => {
      const sidecar = createValidContinuitySidecar({
        configuredFrames: 362,
        overallOutcome: "fail",
        defectSpecificInspections: {
          wardrobe243fDepartureInspected: false,
          environment362fBlackoutInspected: true,
          camera124fPushInspected: false
        }
      });
      sidecar.dimensions.backgroundLightingPersistence = {
        assessment: "fail",
        severity: "critical",
        rationale: "Near-black collapse from 3.3s to 6.7s",
        intervals: [{ startSec: 3.3, endSec: 6.7 }]
      };
      const legacy = mapContinuityReviewToLegacyVisualReview(sidecar);
      expect(legacy.continuity).toBe("fail");
      expect(legacy.visualDegradation).toBe("fail");
      expect(legacy.identityFidelity).toBe("pass");
    });

    it("forces continuity fail when scene substitution is detected even if identity passes", () => {
      const sidecar = createValidContinuitySidecar({
        overallOutcome: "fail",
        sceneSubstitution: {
          detected: true,
          severity: "critical",
          rationale: "Replaced background and shot with different scene",
          intervals: [{ startSec: 2.0, endSec: 5.0 }]
        }
      });
      sidecar.dimensions.overallAdUsability = {
        assessment: "fail",
        severity: "critical",
        rationale: "Scene substitution renders footage unusable."
      };
      const legacy = mapContinuityReviewToLegacyVisualReview(sidecar);
      expect(legacy.continuity).toBe("fail");
      expect(legacy.identityFidelity).toBe("pass");
      expect(legacy.visualDegradation).toBe("fail");
    });

    it("maps all-not_assessable dimensions conservatively to defect (never pass) (F-ff9d0454)", () => {
      const sidecar = createValidContinuitySidecar();
      for (const dimKey of CONTINUITY_RUBRIC_DIMENSIONS) {
        sidecar.dimensions[dimKey] = {
          assessment: "not_assessable",
          rationale: "Dimension could not be evaluated due to camera angle"
        };
      }
      sidecar.overallOutcome = "inconclusive";
      const legacy = mapContinuityReviewToLegacyVisualReview(sidecar);
      expect(legacy.continuity).toBe("defect");
      expect(legacy.identityFidelity).toBe("defect");
      expect(legacy.visualDegradation).toBe("defect");
    });
  });

  describe("Reference Manifest Schema", () => {
    it("validates a contiguous reference manifest", () => {
      const manifest = {
        referenceSetId: "trinidad-ref2v",
        manifestDigest: DUMMY_SHA,
        references: [
          {
            slotIndex: 0,
            role: "subject_identity",
            tag: "<Picture 1>",
            sourceAssetPath: "certification/minimax-h3/reference-images/trinidad_subject.jpg",
            sourceSha256: "9a1e9bc51b93b80a6169c69bbcb6630788e2fb6dd2244ace4b6c2c9fd5bd2589",
            sourceSizeBytes: 90286,
            mimeType: "image/jpeg" as const,
            width: 1024,
            height: 819
          },
          {
            slotIndex: 1,
            role: "product",
            tag: "<Picture 2>",
            sourceAssetPath: "certification/minimax-h3/reference-images/trinidad_product.jpg",
            sourceSha256: "f4dbb845aa086287da85b07d239b14dccf7b40aedb68367ec885c0913c1c79ab",
            sourceSizeBytes: 107963,
            mimeType: "image/jpeg" as const,
            width: 1024,
            height: 679
          }
        ]
      };
      const digest = computeReferenceManifestDigest(manifest);
      manifest.manifestDigest = digest;
      const parsed = ContinuityReferenceManifestSchema.parse(manifest);
      expect(parsed.references.length).toBe(2);
    });

    it("rejects non-contiguous slot indices", () => {
      const manifest = {
        referenceSetId: "trinidad-ref2v",
        manifestDigest: DUMMY_SHA,
        references: [
          {
            slotIndex: 0,
            role: "subject_identity",
            sourceAssetPath: "a.jpg",
            sourceSha256: DUMMY_SHA,
            sourceSizeBytes: 100,
            mimeType: "image/jpeg" as const,
            width: 100,
            height: 100
          },
          {
            slotIndex: 2, // gap: missing index 1
            role: "product",
            sourceAssetPath: "b.jpg",
            sourceSha256: DUMMY_SHA,
            sourceSizeBytes: 100,
            mimeType: "image/jpeg" as const,
            width: 100,
            height: 100
          }
        ]
      };
      expect(() => ContinuityReferenceManifestSchema.parse(manifest)).toThrow(
        /Reference slot indices must be contiguous/
      );
    });
  });

  describe("Continuity Study Specification Schema", () => {
    it("validates a complete 16-cell study spec and checks digest and comparisons", () => {
      const origPrompt = "A cinematic shot of a person smiling warmly, original prompt";
      const tightPrompt =
        "A cinematic shot of a person smiling warmly, tight prompt with yellow backdrop and wardrobe fixed";
      const origDigest = sha256Hex(origPrompt);
      const tightDigest = sha256Hex(tightPrompt);

      const refManifest = {
        referenceSetId: "i2v-start-frame",
        manifestDigest: DUMMY_SHA,
        references: [
          {
            slotIndex: 0,
            role: "first_frame",
            tag: "<Picture 1>",
            sourceAssetPath: "test-assets/trinidad_subject_16x9.jpg",
            sourceSha256: "776145851c2bd2dba5a29fd0f45e222f5b09ee016b2371ed013582e1d41f6eb8",
            sourceSizeBytes: 122528,
            mimeType: "image/jpeg" as const,
            width: 1024,
            height: 585,
            derivation: "center_cropped from 1024x819 to 1024x585"
          }
        ]
      };
      refManifest.manifestDigest = computeReferenceManifestDigest(refManifest);

      const scenarios = [
        {
          scenarioId: "i2v-static-yellow",
          subjectMotionIntent: "static" as const,
          route: "i2v" as const,
          conditioningMode: "frame_anchored" as const,
          status: "resolved" as const,
          originalPrompt: { text: origPrompt, digest: origDigest },
          constrainedPrompts: [
            {
              promptId: "tight-v1",
              label: "Continuity constrained prompt",
              text: tightPrompt,
              digest: tightDigest,
              constraintsApplied: [
                "fixed_yellow_backdrop",
                "fixed_lighting",
                "fixed_wardrobe",
                "camera_push_only",
                "continuous_shot"
              ]
            }
          ],
          referenceManifest: refManifest
        }
      ];

      const framesList = [124, 192, 243, 362] as const;
      const cells = [];
      const comparisonEdges = [];

      for (const frames of framesList) {
        const baseId = `cell-static-${frames}f-base`;
        const tightId = `cell-static-${frames}f-tight`;

        cells.push({
          cellId: baseId,
          scenarioId: "i2v-static-yellow",
          frames,
          arm: "baseline" as const,
          promptVariantId: "original",
          prompt: origPrompt,
          promptDigest: origDigest,
          status: "resolved" as const,
          safetyBaseline124fCellId: frames > 124 ? "cell-static-124f-base" : null
        });

        cells.push({
          cellId: tightId,
          scenarioId: "i2v-static-yellow",
          frames,
          arm: "prompt_only" as const,
          promptVariantId: "tight-v1",
          prompt: tightPrompt,
          promptDigest: tightDigest,
          status: "resolved" as const,
          safetyBaseline124fCellId: frames > 124 ? "cell-static-124f-tight" : null
        });

        comparisonEdges.push({
          edgeId: `cmp-static-${frames}f`,
          frames,
          scenarioId: "i2v-static-yellow",
          arm: "prompt_only" as const,
          baselineCellId: baseId,
          candidateCellId: tightId,
          declaredFactorPaths: ["conditioning.positivePrompt"],
          status: "resolved" as const
        });
      }

      const specDraft = {
        schemaVersion: 1 as const,
        studyId: "study-continuity-screening-001",
        rubricVersion: 1 as const,
        rubricDigest: computeContinuityRubricDigest(),
        sourceEvidenceReferences: [
          {
            url: "https://github.com/org/repo/issues/423",
            assertion: "Operator feasibility findings for 124f, 243f, 362f continuity"
          }
        ],
        scenarios,
        studyControls: {
          width: 1344 as const,
          height: 768 as const,
          fps: 24 as const,
          seed: 42,
          runnerVariant: "dynamicvram-offload-v1" as const,
          schedule: {
            sampler: "res_multistep" as const,
            scheduler: "simple" as const,
            steps: 20 as const
          },
          candidateFrames: [124, 192, 243, 362] as [124, 192, 243, 362],
          diffusionCheckpoint: {
            repository: "Comfy-Org/MiniMax-H3",
            revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1",
            filename: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
            sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779"
          }
        },
        cells,
        comparisonEdges
      };

      const studyDigest = computeContinuityStudyDigest(specDraft);
      const fullSpec: MinimaxH3ContinuityStudySpec = {
        ...specDraft,
        studyDigest
      };

      const parsed = MinimaxH3ContinuityStudySpecSchema.parse(fullSpec);
      expect(parsed.cells.length).toBe(8);
      expect(parsed.comparisonEdges.length).toBe(4);
    });

    it("rejects cross-frame comparison edges", () => {
      const invalidEdgeSpec = {
        schemaVersion: 1 as const,
        studyId: "study-invalid-edge",
        studyDigest: "",
        rubricVersion: 1 as const,
        rubricDigest: computeContinuityRubricDigest(),
        sourceEvidenceReferences: [{ url: "https://example.com", assertion: "Test assertion" }],
        scenarios: [
          {
            scenarioId: "sc-01",
            subjectMotionIntent: "static" as const,
            route: "i2v" as const,
            conditioningMode: "frame_anchored" as const,
            status: "pending_source" as const,
            originalPrompt: null,
            constrainedPrompts: [
              {
                promptId: "t1",
                label: "Tight",
                text: "text",
                digest: sha256Hex("text"),
                constraintsApplied: ["fixed_lighting"]
              }
            ],
            referenceManifest: {
              referenceSetId: "ref-01",
              manifestDigest: DUMMY_SHA,
              references: [
                {
                  slotIndex: 0,
                  role: "first_frame",
                  sourceAssetPath: "a.jpg",
                  sourceSha256: DUMMY_SHA,
                  sourceSizeBytes: 100,
                  mimeType: "image/jpeg" as const,
                  width: 100,
                  height: 100
                }
              ]
            }
          }
        ],
        studyControls: {
          width: 1344 as const,
          height: 768 as const,
          fps: 24 as const,
          seed: 42,
          runnerVariant: "dynamicvram-offload-v1" as const,
          schedule: {
            sampler: "res_multistep" as const,
            scheduler: "simple" as const,
            steps: 20 as const
          },
          candidateFrames: [124, 192, 243, 362] as [124, 192, 243, 362],
          diffusionCheckpoint: {
            repository: "Comfy-Org/MiniMax-H3",
            revision: "rev",
            filename: "model.safetensors",
            sha256: DUMMY_SHA
          }
        },
        cells: [
          {
            cellId: "cell-124f",
            scenarioId: "sc-01",
            frames: 124 as const,
            arm: "baseline" as const,
            promptVariantId: "original",
            prompt: null,
            promptDigest: null,
            status: "pending_source" as const
          },
          {
            cellId: "cell-243f",
            scenarioId: "sc-01",
            frames: 243 as const,
            arm: "prompt_only" as const,
            promptVariantId: "t1",
            prompt: "text",
            promptDigest: sha256Hex("text"),
            status: "pending_source" as const
          }
        ],
        comparisonEdges: [
          {
            edgeId: "edge-cross-frame",
            frames: 124 as const,
            scenarioId: "sc-01",
            arm: "prompt_only" as const,
            baselineCellId: "cell-124f",
            candidateCellId: "cell-243f", // Different frames! Cross-frame comparison invalid!
            declaredFactorPaths: ["conditioning.positivePrompt"],
            status: "pending_source" as const
          }
        ]
      };

      invalidEdgeSpec.studyDigest = computeContinuityStudyDigest(invalidEdgeSpec);
      expect(() => MinimaxH3ContinuityStudySpecSchema.parse(invalidEdgeSpec)).toThrow(
        /cross-frame comparison is prohibited/
      );
    });
  });

  describe("Storyboard Plan & Review Manifest", () => {
    it("validates a storyboard plan with correctly clamped/flagged sample points", () => {
      const plan = {
        schemaVersion: 1 as const,
        kind: "storyboard-plan" as const,
        planDigest: DUMMY_SHA,
        studyId: "study-001",
        studyDigest: DUMMY_SHA,
        generatedAt: "2026-10-14T12:00:00.000Z",
        panels: [
          {
            panelId: "panel-124f-base",
            cellId: "cell-124f-base",
            scenarioId: "sc-01",
            route: "i2v" as const,
            conditioningMode: "frame_anchored" as const,
            frames: 124 as const,
            durationSec: 124 / 24, // 5.167s
            checkpointSha: DUMMY_SHA,
            seed: 42,
            promptVariantId: "orig",
            promptDigest: DUMMY_SHA,
            promptText: "original prompt",
            requestedAttention: "default",
            sampler: "res_multistep",
            scheduler: "simple",
            steps: 20,
            runtimeCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
            plannedSamples: [
              {
                targetFrame: 0,
                targetTimeSec: 0,
                sampleReason: "first_frame" as const,
                inRange: true
              },
              {
                targetFrame: 79,
                targetTimeSec: 3.3,
                sampleReason: "362f_collapse_window" as const,
                inRange: true
              },
              {
                targetFrame: 123,
                targetTimeSec: 123 / 24,
                sampleReason: "last_frame" as const,
                inRange: true
              },
              // 8.3s is beyond 5.167s duration of 124f clip:
              {
                targetFrame: 199,
                targetTimeSec: 8.3,
                sampleReason: "362f_recovery" as const,
                inRange: false
              }
            ],
            mediaBinding: {
              collectionStatus: "pending" as const
            }
          }
        ]
      };

      plan.planDigest = computeStoryboardPlanDigest(plan);
      const parsed = MinimaxH3StoryboardPlanSchema.parse(plan);
      expect(parsed.panels[0]!.plannedSamples[3]!.inRange).toBe(false);
    });

    it("validates a review manifest with comparison pairs", () => {
      const manifest = {
        schemaVersion: 1 as const,
        kind: "review-manifest" as const,
        manifestDigest: DUMMY_SHA,
        studyId: "study-001",
        studyDigest: DUMMY_SHA,
        generatedAt: "2026-10-14T12:00:00.000Z",
        panels: [
          {
            panelId: "p1",
            cellId: "c1",
            scenarioId: "sc-01",
            route: "i2v" as const,
            conditioningMode: "frame_anchored" as const,
            frames: 243 as const,
            durationSec: 243 / 24,
            checkpointSha: DUMMY_SHA,
            seed: 42,
            promptVariantId: "orig",
            promptDigest: DUMMY_SHA,
            promptText: "orig",
            requestedAttention: "default",
            sampler: "res_multistep",
            scheduler: "simple",
            steps: 20,
            runtimeCoreRevision: "rev",
            plannedSamples: [
              {
                targetFrame: 0,
                targetTimeSec: 0,
                sampleReason: "first_frame" as const,
                inRange: true
              }
            ],
            mediaBinding: {
              collectionStatus: "pending" as const
            }
          },
          {
            panelId: "p2",
            cellId: "c2",
            scenarioId: "sc-01",
            route: "i2v" as const,
            conditioningMode: "frame_anchored" as const,
            frames: 243 as const,
            durationSec: 243 / 24,
            checkpointSha: DUMMY_SHA,
            seed: 42,
            promptVariantId: "tight",
            promptDigest: DUMMY_SHA,
            promptText: "tight",
            requestedAttention: "default",
            sampler: "res_multistep",
            scheduler: "simple",
            steps: 20,
            runtimeCoreRevision: "rev",
            plannedSamples: [
              {
                targetFrame: 0,
                targetTimeSec: 0,
                sampleReason: "first_frame" as const,
                inRange: true
              }
            ],
            mediaBinding: {
              collectionStatus: "pending" as const
            }
          }
        ],
        comparisonPairs: [
          {
            pairId: "pair-243f",
            edgeId: "edge-243f",
            frames: 243 as const,
            scenarioId: "sc-01",
            arm: "prompt_only" as const,
            baselinePanelId: "p1",
            candidatePanelId: "p2",
            declaredFactorPaths: ["conditioning.positivePrompt"],
            status: "resolved" as const
          }
        ]
      };

      manifest.manifestDigest = computeReviewManifestDigest(manifest);
      const parsed = MinimaxH3ReviewManifestSchema.parse(manifest);
      expect(parsed.comparisonPairs.length).toBe(1);
    });
  });

  describe("Non-Authoritative Diagnostic Report Schema", () => {
    it("validates a diagnostic report containing proxy samples", () => {
      const report = {
        schemaVersion: 1 as const,
        kind: "diagnostic-proxy-report" as const,
        sourceFileSha256: DUMMY_OUTPUT_SHA,
        sourceFilePath: "/runs/run-01/output.mp4",
        analyzedAt: "2026-10-14T12:00:00.000Z",
        tool: {
          name: "ffmpeg-scene-detect",
          version: "7.0.2-static",
          configDigest: DUMMY_SHA
        },
        samples: [
          {
            metricName: "scene_cut_proxy" as const,
            sampleFrame: 60,
            sampleTimeSec: 2.5,
            numericValue: 0.042,
            unit: "scene_score",
            analysisTimestamp: "2026-10-14T12:00:00.000Z"
          },
          {
            metricName: "brightness_shift_proxy" as const,
            sampleFrame: 80,
            sampleTimeSec: 3.33,
            numericValue: -0.85,
            unit: "mean_luma_delta",
            analysisTimestamp: "2026-10-14T12:00:00.000Z"
          }
        ]
      };

      const parsed = MinimaxH3DiagnosticReportSchema.parse(report);
      expect(parsed.samples.length).toBe(2);
    });

    it("rejects diagnostic reports that attempt to claim creative acceptance", () => {
      const reportWithAcceptance = {
        schemaVersion: 1 as const,
        kind: "diagnostic-proxy-report" as const,
        sourceFileSha256: DUMMY_OUTPUT_SHA,
        sourceFilePath: "/runs/run-01/output.mp4",
        analyzedAt: "2026-10-14T12:00:00.000Z",
        tool: {
          name: "ffmpeg-scene-detect",
          version: "7.0.2-static",
          configDigest: DUMMY_SHA
        },
        samples: [],
        acceptance: "approved" // Forbidden!
      };

      expect(() => MinimaxH3DiagnosticReportSchema.parse(reportWithAcceptance)).toThrow(
        /must not claim creative acceptance/
      );
    });
  });

  describe("createContinuityConstrainedPrompt & Prerequisite Records (AC-9, AC-27)", () => {
    it("creates conservative continuity-constrained prompt preserving base intent", () => {
      const promptText = createContinuityConstrainedPrompt({
        basePrompt: "Subject dancing in studio",
        cameraMotion: "gentle forward push",
        backdrop: "bright yellow seamless backdrop",
        keepWardrobe: true
      });

      expect(promptText).toContain("Subject dancing in studio");
      expect(promptText).toContain("bright yellow seamless backdrop");
      expect(promptText).toContain("gentle forward push");
      expect(promptText).toContain("Continuous single-take shot without unrequested cuts");
    });

    it("validates valid ContinuityReviewPrerequisiteRecordSchema with admitted disposition", () => {
      const record = {
        cellId: "cell-01",
        runId: "run-01",
        reviewId: "rev-01",
        reviewRevision: 1,
        reviewDigest: DUMMY_SHA,
        operatorDisposition: "admitted" as const
      };

      const parsed = ContinuityReviewPrerequisiteRecordSchema.parse(record);
      expect(parsed.operatorDisposition).toBe("admitted");

      expect(() =>
        ContinuityReviewPrerequisiteRecordSchema.parse({
          ...record,
          operatorDisposition: "pass" // Invalid disposition
        })
      ).toThrow();
    });
  });
});
