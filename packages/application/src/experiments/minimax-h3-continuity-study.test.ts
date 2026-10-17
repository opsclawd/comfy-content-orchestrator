import { describe, expect, it } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
import {
  expandContinuityStudyPlan,
  admitContinuityPair,
  prepareContinuityStudyCell,
  buildContinuityStoryboardPlan,
  buildContinuityReviewManifest,
  validateContinuityReview,
  importContinuityReview,
  validateSafetyBaselineLinks,
  validateSafetyChainDescriptor,
  validateStudyComparisonEdges
} from "./minimax-h3-continuity-study.js";
import {
  computeReferenceManifestDigest,
  computeContinuityRubricDigest,
  computeContinuityReviewDigest,
  PINNED_H3_CHECKPOINTS,
  PINNED_COMFYUI_CORE_REVISION,
  type ContinuityScenario,
  type MinimaxH3ContinuityReviewSidecar,
  type MinimaxH3ProcessRecord,
  type MinimaxH3TerminalEvidence,
  type MinimaxH3AnyExperimentResult,
  type MinimaxH3AnyExperimentDescriptor,
  type MinimaxH3ExperimentDescriptorV2,
  sha256Hex
} from "@cco/contracts";
import type {
  MinimaxH3ExperimentStorePort,
  MinimaxH3TargetPreflightPort
} from "../ports/minimax-h3-experiment-ports.js";

const DUMMY_SHA = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const DUMMY_OUTPUT_SHA = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

class MockStore implements MinimaxH3ExperimentStorePort {
  public files = new Map<string, unknown>();
  public descriptors = new Map<string, MinimaxH3AnyExperimentDescriptor>();
  public results = new Map<string, MinimaxH3AnyExperimentResult>();
  public customFileHashes = new Map<string, { sha256: string; sizeBytes: number }>();
  public writeResultFault = false;
  public readJsonFileFault: Error | null = null;

  async createRunDirectory(_runDir: string): Promise<void> {}
  async ensureRunSubdirectories(_runDir: string): Promise<void> {}
  async writeDescriptor(
    runDir: string,
    descriptor: MinimaxH3AnyExperimentDescriptor
  ): Promise<void> {
    this.descriptors.set(runDir, descriptor);
  }
  async readDescriptor(runDir: string): Promise<MinimaxH3AnyExperimentDescriptor> {
    const desc = this.descriptors.get(runDir);
    if (!desc) throw new Error(`Descriptor not found in ${runDir}`);
    return desc;
  }
  async writeConfig(runDir: string, config: Record<string, unknown>): Promise<string> {
    this.files.set(`${runDir}/config.json`, config);
    return DUMMY_SHA;
  }
  async readConfig(): Promise<Record<string, unknown>> {
    return {};
  }
  async writeIntent(): Promise<void> {}
  async readIntent(): Promise<null> {
    return null;
  }
  async writeReceipt(): Promise<void> {}
  async readReceipt(): Promise<null> {
    return null;
  }
  async appendEvent(): Promise<void> {}
  async readEvents(): Promise<never[]> {
    return [];
  }
  async appendTelemetry(): Promise<void> {}
  async readTelemetry(): Promise<never[]> {
    return [];
  }
  async writeResult(runDir: string, result: MinimaxH3AnyExperimentResult): Promise<void> {
    if (this.writeResultFault) {
      throw new Error("Simulated I/O disk error writing result.json");
    }
    this.results.set(runDir, result);
  }
  async readResult(runDir: string): Promise<MinimaxH3AnyExperimentResult | null> {
    return this.results.get(runDir) ?? null;
  }
  async writeProcessRecord(): Promise<void> {}
  async readProcessRecord(): Promise<MinimaxH3ProcessRecord | null> {
    return null;
  }
  async writeTerminalEvidence(): Promise<void> {}
  async readTerminalEvidence(): Promise<MinimaxH3TerminalEvidence | null> {
    return null;
  }
  async writeInputManifest(): Promise<void> {}
  async readInputManifest(): Promise<Record<string, unknown> | null> {
    return null;
  }
  async writeMeasurementTemplate(): Promise<void> {}
  async readMeasurementTemplate(): Promise<null> {
    return null;
  }
  verifyContainment(): boolean {
    return true;
  }
  async stageInputFile(): Promise<void> {}
  async hashFile(filePath: string): Promise<{ sha256: string; sizeBytes: number }> {
    for (const [key, val] of this.customFileHashes.entries()) {
      if (filePath.includes(key)) {
        return val;
      }
    }
    if (filePath.includes("trinidad_subject_16x9.jpg")) {
      return {
        sha256: "776145851c2bd2dba5a29fd0f45e222f5b09ee016b2371ed013582e1d41f6eb8",
        sizeBytes: 122528
      };
    }
    if (filePath.includes("output")) {
      return {
        sha256: DUMMY_OUTPUT_SHA,
        sizeBytes: 1048576
      };
    }
    return { sha256: DUMMY_SHA, sizeBytes: 12345 };
  }
  customDimensions = new Map<string, { width: number; height: number; mimeType: string }>();
  async inspectAsset(
    filePath: string
  ): Promise<{ width: number; height: number; mimeType: string }> {
    for (const [key, val] of this.customDimensions.entries()) {
      if (filePath.includes(key)) {
        return val;
      }
    }
    return { width: 1024, height: 585, mimeType: "image/jpeg" };
  }
  async readJsonFile<T = unknown>(filePath: string): Promise<T> {
    if (this.readJsonFileFault) {
      throw this.readJsonFileFault;
    }
    const val = this.files.get(filePath);
    if (!val) {
      const err = new Error(`File not found: ${filePath}`);
      (err as { code?: string }).code = "ENOENT";
      throw err;
    }
    return val as T;
  }
  async readTextFile(filePath: string): Promise<string> {
    const val = this.files.get(filePath);
    if (val !== undefined) {
      return typeof val === "string" ? val : JSON.stringify(val);
    }
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf8");
    }
    const err = new Error(`File not found: ${filePath}`);
    (err as { code?: string }).code = "ENOENT";
    throw err;
  }
  async writeTextFile(filePath: string, content: string): Promise<void> {
    this.files.set(filePath, content);
  }
  async deleteRunFiles(): Promise<void> {}
  async writeDurableJson(filePath: string, content: unknown): Promise<void> {
    this.files.set(filePath, content);
  }
}

class MockPreflight implements MinimaxH3TargetPreflightPort {
  async checkTargetHost(): Promise<{ ok: boolean }> {
    return { ok: true };
  }
  async acquireGpuLock(): Promise<{ acquired: boolean; release: () => Promise<void> }> {
    return { acquired: true, release: async () => {} };
  }
  async checkPortAvailable(): Promise<{ ok: boolean }> {
    return { ok: true };
  }
  async verifyCheckout(): Promise<{
    ok: boolean;
    revision: string;
    nodesPresent: boolean;
    cleanTree: boolean;
    sourceHashes: { cliArgsSha256: string; mainSha256: string; modelManagementSha256: string };
  }> {
    return {
      ok: true,
      revision: PINNED_COMFYUI_CORE_REVISION,
      nodesPresent: true,
      cleanTree: true,
      sourceHashes: {
        cliArgsSha256: DUMMY_SHA,
        mainSha256: DUMMY_SHA,
        modelManagementSha256: DUMMY_SHA
      }
    };
  }
  async verifyModels(): Promise<{
    ok: boolean;
    resolvedPaths: Record<
      string,
      { expectedHash: string; resolvedPath: string; sizeBytes: number }
    >;
  }> {
    return {
      ok: true,
      resolvedPaths: {
        diffusion: {
          expectedHash: PINNED_H3_CHECKPOINTS.ref2va.sha256,
          resolvedPath: `/models/unet/${PINNED_H3_CHECKPOINTS.ref2va.filename}`,
          sizeBytes: 20_000_000_000
        }
      }
    };
  }
  async verifyDiskSpace(): Promise<{ ok: boolean; freeGb: number }> {
    return { ok: true, freeGb: 250 };
  }
}

function createSyntheticScenario(id: string, motion: "static" | "moving"): ContinuityScenario {
  const origText = `Subject in studio, ${motion} motion, smiling warmly`;
  const tightText = `Subject in studio, ${motion} motion, smiling warmly, yellow backdrop fixed, wardrobe fixed, camera push only`;
  const origDigest = sha256Hex(origText);
  const tightDigest = sha256Hex(tightText);

  const refManifest = {
    referenceSetId: `${id}-refset`,
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
        derivation: "center-cropped from 1024x819 to 1024x585"
      }
    ]
  };
  refManifest.manifestDigest = computeReferenceManifestDigest(refManifest);

  return {
    scenarioId: id,
    subjectMotionIntent: motion,
    scenarioRole: "historical_baseline",
    route: "i2v",
    conditioningMode: "frame_anchored",
    status: "resolved",
    originalPrompt: { text: origText, digest: origDigest },
    constrainedPrompts: [
      {
        promptId: "tight-v1",
        label: "Continuity constrained prompt",
        text: tightText,
        digest: tightDigest,
        constraintsApplied: [
          "fixed_yellow_backdrop",
          "fixed_lighting",
          "fixed_wardrobe",
          "camera_push_only"
        ]
      }
    ],
    referenceManifest: refManifest
  };
}

describe("MiniMax-H3 Continuity Study Planning & Admission", () => {
  describe("expandContinuityStudyPlan", () => {
    it("expands 2 scenarios × 4 frames into 16 planned cells and 8 comparison edges", () => {
      const scenarios = [
        createSyntheticScenario("sc-static", "static"),
        createSyntheticScenario("sc-moving", "moving")
      ];

      const study = expandContinuityStudyPlan({
        studyId: "study-matrix-16",
        sourceEvidenceReferences: [
          { url: "https://example.com/issue/423", assertion: "Historical continuity observation" }
        ],
        scenarios
      });

      expect(study.cells.length).toBe(16); // 2 scenarios * 4 frames * (1 base + 1 tight)
      expect(study.comparisonEdges.length).toBe(8); // 2 scenarios * 4 frames

      // Verify safety baseline links
      const cell243f = study.cells.find((c) => c.scenarioId === "sc-static" && c.frames === 243);
      expect(cell243f?.safetyBaseline124fCellId).toBe("cell-sc-static-124f-base");

      // Frame 124f baseline itself has null safety link
      const cell124f = study.cells.find((c) => c.scenarioId === "sc-static" && c.frames === 124);
      expect(cell124f?.safetyBaseline124fCellId).toBeNull();

      // Validate safety baseline links passes
      const safetyCheck = validateSafetyBaselineLinks(study);
      expect(safetyCheck.valid).toBe(true);
    });

    it("supports optional isolated arms (checkpoint, step reduction, attention, combined)", () => {
      const scenarios = [createSyntheticScenario("sc-static", "static")];

      const study = expandContinuityStudyPlan({
        studyId: "study-all-arms",
        sourceEvidenceReferences: [
          { url: "https://example.com/audit", assertion: "Checkpoint audit" }
        ],
        scenarios,
        includeCheckpointArms: true,
        includeReducedStepArms: true,
        includeAttentionArms: true,
        includeCombinedArms: true
      });

      // Representative block on frames [124, 243]: 2 frames * 7 cells + 2 non-rep frames * 2 cells = 18 cells
      expect(study.cells.length).toBe(18);
      // Combined cells remain pending_source by default
      const combinedCell = study.cells.find((c) => c.arm === "combined");
      expect(combinedCell?.status).toBe("pending_source");
      expect(combinedCell?.pendingReason).toContain("independent human reviews");
    });
  });

  describe("validateStudyComparisonEdges", () => {
    it("validates comparison edges in a standard expanded study", () => {
      const scenarios = [createSyntheticScenario("sc-edge-valid", "static")];
      const study = expandContinuityStudyPlan({
        studyId: "study-edge-valid",
        sourceEvidenceReferences: [{ url: "https://example.com", assertion: "Test" }],
        scenarios
      });

      const res = validateStudyComparisonEdges(study);
      expect(res.valid).toBe(true);
      expect(res.errors).toEqual([]);
    });

    it("rejects comparison edge referencing nonexistent baseline or candidate cell", () => {
      const scenarios = [createSyntheticScenario("sc-edge-missing", "static")];
      const study = expandContinuityStudyPlan({
        studyId: "study-edge-missing",
        sourceEvidenceReferences: [{ url: "https://example.com", assertion: "Test" }],
        scenarios
      });

      const studyBaseMissing = {
        ...study,
        comparisonEdges: [
          {
            ...study.comparisonEdges[0]!,
            baselineCellId: "nonexistent-cell-id"
          }
        ]
      };
      const resBase = validateStudyComparisonEdges(studyBaseMissing);
      expect(resBase.valid).toBe(false);
      expect(resBase.errors.some((e) => e.includes("nonexistent baselineCellId"))).toBe(true);

      const studyCandMissing = {
        ...study,
        comparisonEdges: [
          {
            ...study.comparisonEdges[0]!,
            candidateCellId: "nonexistent-cand-id"
          }
        ]
      };
      const resCand = validateStudyComparisonEdges(studyCandMissing);
      expect(resCand.valid).toBe(false);
      expect(resCand.errors.some((e) => e.includes("nonexistent candidateCellId"))).toBe(true);
    });

    it("rejects comparison edge with cross-frame counts", () => {
      const scenarios = [createSyntheticScenario("sc-edge-cross-frames", "static")];
      const study = expandContinuityStudyPlan({
        studyId: "study-edge-cross-frames",
        sourceEvidenceReferences: [{ url: "https://example.com", assertion: "Test" }],
        scenarios
      });

      const cell124 = study.cells.find((c) => c.frames === 124 && c.arm === "baseline")!;
      const cell243 = study.cells.find((c) => c.frames === 243 && c.arm === "prompt_only")!;

      const studyCross = {
        ...study,
        comparisonEdges: [
          {
            edgeId: "cross-frame-edge",
            scenarioId: cell124.scenarioId,
            frames: 124 as const,
            status: "resolved" as const,
            baselineCellId: cell124.cellId,
            candidateCellId: cell243.cellId,
            arm: "prompt_only" as const,
            declaredFactorPaths: ["conditioning.positivePrompt"]
          }
        ]
      };

      const res = validateStudyComparisonEdges(studyCross);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("crosses frame counts"))).toBe(true);
    });

    it("rejects comparison edge crossing scenarios", () => {
      const sc1 = createSyntheticScenario("sc-edge-s1", "static");
      const sc2 = createSyntheticScenario("sc-edge-s2", "moving");
      const study = expandContinuityStudyPlan({
        studyId: "study-edge-cross-scenarios",
        sourceEvidenceReferences: [{ url: "https://example.com", assertion: "Test" }],
        scenarios: [sc1, sc2]
      });

      const cellS1 = study.cells.find(
        (c) => c.scenarioId === "sc-edge-s1" && c.frames === 124 && c.arm === "baseline"
      )!;
      const cellS2 = study.cells.find(
        (c) => c.scenarioId === "sc-edge-s2" && c.frames === 124 && c.arm === "prompt_only"
      )!;

      const studyCrossScen = {
        ...study,
        comparisonEdges: [
          {
            edgeId: "cross-scenario-edge",
            scenarioId: "sc-edge-s1",
            frames: 124 as const,
            status: "resolved" as const,
            baselineCellId: cellS1.cellId,
            candidateCellId: cellS2.cellId,
            arm: "prompt_only" as const,
            declaredFactorPaths: ["conditioning.positivePrompt"]
          }
        ]
      };

      const res = validateStudyComparisonEdges(studyCrossScen);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("crosses scenarios"))).toBe(true);
    });

    it("rejects comparison edge with candidate arm mismatch or wrong factor path", () => {
      const scenarios = [createSyntheticScenario("sc-edge-arm-check", "static")];
      const study = expandContinuityStudyPlan({
        studyId: "study-edge-arm-check",
        sourceEvidenceReferences: [{ url: "https://example.com", assertion: "Test" }],
        scenarios
      });

      const edge0 = study.comparisonEdges[0]!;
      const studyArmMismatch = {
        ...study,
        comparisonEdges: [
          {
            ...edge0,
            arm: "checkpoint_only" as const,
            declaredFactorPaths: ["models.diffusion"]
          }
        ]
      };

      const resMismatch = validateStudyComparisonEdges(studyArmMismatch);
      expect(resMismatch.valid).toBe(false);
      expect(resMismatch.errors.some((e) => e.includes("arm mismatch"))).toBe(true);

      const studyWrongFactors = {
        ...study,
        comparisonEdges: [
          {
            ...edge0,
            declaredFactorPaths: ["wrong.factor.path"]
          }
        ]
      };

      const resFactors = validateStudyComparisonEdges(studyWrongFactors);
      expect(resFactors.valid).toBe(false);
      expect(resFactors.errors.some((e) => e.includes("must declare exactly"))).toBe(true);
    });
  });

  describe("admitContinuityPair", () => {
    it("admits matching-frame single-variable prompt pair", () => {
      const origText = "original text";
      const tightText = "tight text";
      const origDigest = sha256Hex(origText);
      const tightDigest = sha256Hex(tightText);

      const baseDesc = {
        route: "i2v",
        configuredFrames: 243,
        width: 1344,
        height: 768,
        fps: 24,
        seed: 42,
        prompt: origText,
        promptDigest: origDigest,
        references: [],
        baseProfileKey: "h3-default",
        requestedRunner: { memoryPolicy: "high" },
        provenance: {
          actualCheckpointHash: PINNED_H3_CHECKPOINTS.ref2va.sha256
        },
        experimentVariant: {
          variantName: "base",
          purpose: "performance",
          changedFactors: []
        }
      } as unknown as MinimaxH3ExperimentDescriptorV2;

      const candDesc = {
        route: "i2v",
        configuredFrames: 243,
        width: 1344,
        height: 768,
        fps: 24,
        seed: 42,
        prompt: tightText,
        promptDigest: tightDigest,
        references: [],
        baseProfileKey: "h3-default",
        requestedRunner: { memoryPolicy: "high" },
        provenance: {
          actualCheckpointHash: PINNED_H3_CHECKPOINTS.ref2va.sha256
        },
        experimentVariant: {
          variantName: "tight",
          purpose: "prompt_conditioning",
          changedFactors: [
            {
              path: "conditioning.positivePrompt",
              before: { text: origText, digest: origDigest },
              after: { text: tightText, digest: tightDigest },
              rationale: "Tight prompt"
            }
          ]
        }
      } as unknown as MinimaxH3ExperimentDescriptorV2;

      const result = admitContinuityPair(baseDesc, candDesc, "prompt_only");
      expect(result.admitted).toBe(true);
      expect(result.reasons.length).toBe(0);
    });

    it("rejects frame count mismatch in comparison pair", () => {
      const baseDesc = {
        route: "i2v",
        configuredFrames: 124, // 124f
        width: 1344,
        height: 768,
        fps: 24,
        seed: 42,
        prompt: "p1",
        promptDigest: sha256Hex("p1"),
        references: [],
        baseProfileKey: "h3-default",
        requestedRunner: { memoryPolicy: "high" },
        provenance: { actualCheckpointHash: DUMMY_SHA },
        experimentVariant: { purpose: "performance", changedFactors: [] }
      } as unknown as MinimaxH3ExperimentDescriptorV2;

      const candDesc = {
        route: "i2v",
        configuredFrames: 243, // 243f!
        width: 1344,
        height: 768,
        fps: 24,
        seed: 42,
        prompt: "p2",
        promptDigest: sha256Hex("p2"),
        references: [],
        baseProfileKey: "h3-default",
        requestedRunner: { memoryPolicy: "high" },
        provenance: { actualCheckpointHash: DUMMY_SHA },
        experimentVariant: {
          purpose: "prompt_conditioning",
          changedFactors: [
            {
              path: "conditioning.positivePrompt",
              before: { text: "p1", digest: sha256Hex("p1") },
              after: { text: "p2", digest: sha256Hex("p2") },
              rationale: "r"
            }
          ]
        }
      } as unknown as MinimaxH3ExperimentDescriptorV2;

      const result = admitContinuityPair(baseDesc, candDesc, "prompt_only");
      expect(result.admitted).toBe(false);
      expect(result.reasons[0]).toContain("Cross-frame comparison is strictly prohibited");
    });

    it("rejects undeclared checkpoint variation in prompt_only arm", () => {
      const origText = "p1";
      const tightText = "p2";
      const baseDesc = {
        route: "i2v",
        configuredFrames: 243,
        width: 1344,
        height: 768,
        fps: 24,
        seed: 42,
        prompt: origText,
        promptDigest: sha256Hex(origText),
        references: [],
        baseProfileKey: "h3-default",
        requestedRunner: { memoryPolicy: "high" },
        provenance: { actualCheckpointHash: PINNED_H3_CHECKPOINTS.ref2va.sha256 },
        experimentVariant: { purpose: "performance", changedFactors: [] }
      } as unknown as MinimaxH3ExperimentDescriptorV2;

      const candDesc = {
        route: "i2v",
        configuredFrames: 243,
        width: 1344,
        height: 768,
        fps: 24,
        seed: 42,
        prompt: tightText,
        promptDigest: sha256Hex(tightText),
        references: [],
        baseProfileKey: "h3-default",
        requestedRunner: { memoryPolicy: "high" },
        provenance: { actualCheckpointHash: PINNED_H3_CHECKPOINTS.fl2va.sha256 }, // Differs!
        experimentVariant: {
          purpose: "prompt_conditioning",
          changedFactors: [
            {
              path: "conditioning.positivePrompt",
              before: { text: origText, digest: sha256Hex(origText) },
              after: { text: tightText, digest: sha256Hex(tightText) },
              rationale: "Tight prompt"
            }
          ]
        }
      } as unknown as MinimaxH3ExperimentDescriptorV2;

      const result = admitContinuityPair(baseDesc, candDesc, "prompt_only");
      expect(result.admitted).toBe(false);
      expect(result.reasons).toContain("Undeclared checkpoint change in prompt_only arm");
    });

    it("rejects adversarial prompt pair with changed references or runtime (F-15b90456)", () => {
      const origText = "original text";
      const tightText = "tight text";
      const origDigest = sha256Hex(origText);
      const tightDigest = sha256Hex(tightText);

      const baseDesc = {
        route: "i2v",
        configuredFrames: 243,
        width: 1344,
        height: 768,
        fps: 24,
        seed: 42,
        prompt: origText,
        promptDigest: origDigest,
        references: [],
        baseProfileKey: "h3-default",
        requestedRunner: { memoryPolicy: "high" },
        provenance: {
          actualCheckpointHash: PINNED_H3_CHECKPOINTS.ref2va.sha256,
          comfyuiCoreRevision: PINNED_COMFYUI_CORE_REVISION
        },
        requiredRuntime: {
          coreRevision: PINNED_COMFYUI_CORE_REVISION
        },
        experimentVariant: {
          variantName: "base",
          purpose: "performance",
          changedFactors: []
        }
      } as unknown as MinimaxH3ExperimentDescriptorV2;

      const candDesc = {
        ...baseDesc,
        prompt: tightText,
        promptDigest: tightDigest,
        references: [
          {
            slotIndex: 0,
            role: "first_frame",
            tag: "<Picture 1>",
            sourceAssetPath: "test-assets/different.jpg",
            sourceSha256: DUMMY_SHA
          }
        ],
        experimentVariant: {
          variantName: "tight",
          purpose: "prompt_conditioning",
          changedFactors: [
            {
              path: "conditioning.positivePrompt",
              before: { text: origText, digest: origDigest },
              after: { text: tightText, digest: tightDigest },
              rationale: "Tight prompt"
            }
          ]
        }
      } as unknown as MinimaxH3ExperimentDescriptorV2;

      const result = admitContinuityPair(baseDesc, candDesc, "prompt_only");
      expect(result.admitted).toBe(false);
      expect(result.reasons.some((r) => r.toLowerCase().includes("reference"))).toBe(true);
    });

    it("admits matched dense attention pair against matched dense baseline (AC-14, F-d30ab0b4)", () => {
      const promptText = "studio scene";
      const promptDigest = sha256Hex(promptText);

      const baseDesc = {
        route: "i2v",
        configuredFrames: 243,
        width: 1344,
        height: 768,
        fps: 24,
        seed: 42,
        prompt: promptText,
        promptDigest,
        references: [],
        baseProfileKey: "h3-default",
        requestedRunner: { memoryPolicy: "high" },
        provenance: {
          actualCheckpointHash: PINNED_H3_CHECKPOINTS.ref2va.sha256,
          comfyuiCoreRevision: PINNED_COMFYUI_CORE_REVISION,
          requestedAttentionBackend: "dense"
        },
        attentionRequest: {
          attentionVariant: "dense"
        },
        requiredRuntime: {
          coreRevision: PINNED_COMFYUI_CORE_REVISION
        },
        experimentVariant: {
          variantName: "base-dense-control",
          purpose: "performance",
          changedFactors: []
        }
      } as unknown as MinimaxH3ExperimentDescriptorV2;

      const candDesc = {
        ...baseDesc,
        provenance: {
          ...baseDesc.provenance,
          requestedAttentionBackend: "native-sol-attn"
        },
        attentionRequest: {
          attentionVariant: "native-sol-attn"
        },
        experimentVariant: {
          variantName: "solattn",
          purpose: "performance",
          changedFactors: [
            {
              path: "attention.configuration",
              before: "dense",
              after: "native-sol-attn",
              rationale: "Isolated attention experiment against matched dense control"
            }
          ]
        }
      } as unknown as MinimaxH3ExperimentDescriptorV2;

      const result = admitContinuityPair(baseDesc, candDesc, "attention_only");
      expect(result.admitted).toBe(true);
      expect(result.reasons.length).toBe(0);
    });

    it("rejects no-op checkpoint change where hashes are identical", () => {
      const promptText = "studio scene";
      const baseDesc = {
        route: "i2v",
        configuredFrames: 124,
        width: 1344,
        height: 768,
        fps: 24,
        seed: 42,
        prompt: promptText,
        promptDigest: sha256Hex(promptText),
        references: [],
        baseProfileKey: "h3-default",
        requestedRunner: { memoryPolicy: "high" },
        checkpointOverride: "fl2va",
        provenance: {
          actualCheckpointHash: PINNED_H3_CHECKPOINTS.fl2va.sha256,
          comfyuiCoreRevision: PINNED_COMFYUI_CORE_REVISION
        },
        requiredRuntime: { coreRevision: PINNED_COMFYUI_CORE_REVISION },
        experimentVariant: {
          variantName: "base",
          purpose: "performance",
          changedFactors: []
        }
      } as unknown as MinimaxH3ExperimentDescriptorV2;

      const candDesc = {
        ...baseDesc,
        experimentVariant: {
          variantName: "cand",
          purpose: "performance",
          changedFactors: [
            {
              path: "models.diffusion",
              before: { fileHash: PINNED_H3_CHECKPOINTS.fl2va.sha256 },
              after: { fileHash: PINNED_H3_CHECKPOINTS.fl2va.sha256 },
              rationale: "No-op checkpoint"
            }
          ]
        }
      } as unknown as MinimaxH3ExperimentDescriptorV2;

      const result = admitContinuityPair(baseDesc, candDesc, "checkpoint_only");
      expect(result.admitted).toBe(false);
      expect(result.reasons.some((r) => r.includes("identical") || r.includes("no-op"))).toBe(true);
    });

    it("rejects FL2VA checkpoint when route is ref2v", () => {
      const promptText = "studio scene";
      const baseDesc = {
        route: "ref2v",
        configuredFrames: 124,
        width: 1344,
        height: 768,
        fps: 24,
        seed: 42,
        prompt: promptText,
        promptDigest: sha256Hex(promptText),
        references: [],
        baseProfileKey: "h3-default",
        requestedRunner: { memoryPolicy: "high" },
        checkpointOverride: "ref2va",
        provenance: {
          actualCheckpointHash: PINNED_H3_CHECKPOINTS.ref2va.sha256,
          comfyuiCoreRevision: PINNED_COMFYUI_CORE_REVISION
        },
        requiredRuntime: { coreRevision: PINNED_COMFYUI_CORE_REVISION },
        experimentVariant: {
          variantName: "base",
          purpose: "performance",
          changedFactors: []
        }
      } as unknown as MinimaxH3ExperimentDescriptorV2;

      const candDesc = {
        ...baseDesc,
        checkpointOverride: "fl2va",
        provenance: {
          actualCheckpointHash: PINNED_H3_CHECKPOINTS.fl2va.sha256,
          comfyuiCoreRevision: PINNED_COMFYUI_CORE_REVISION
        },
        experimentVariant: {
          variantName: "fl2va",
          purpose: "performance",
          changedFactors: [
            {
              path: "models.diffusion",
              before: { fileHash: PINNED_H3_CHECKPOINTS.ref2va.sha256 },
              after: { fileHash: PINNED_H3_CHECKPOINTS.fl2va.sha256 },
              rationale: "Incompatible checkpoint"
            }
          ]
        }
      } as unknown as MinimaxH3ExperimentDescriptorV2;

      const result = admitContinuityPair(baseDesc, candDesc, "checkpoint_only");
      expect(result.admitted).toBe(false);
      expect(result.reasons.some((r) => r.includes("incompatible"))).toBe(true);
    });

    it("rejects runnerVariant mismatch between baseline and candidate (AC-16)", () => {
      const promptText = "subject in studio";
      const promptDigest = sha256Hex(promptText);

      const baseDesc = {
        route: "i2v",
        configuredFrames: 243,
        width: 1344,
        height: 768,
        fps: 24,
        seed: 42,
        prompt: promptText,
        promptDigest,
        references: [],
        baseProfileKey: "h3-default",
        requestedRunner: { variantName: "dynamicvram-offload-v1", memoryPolicy: "high" },
        provenance: {
          actualCheckpointHash: PINNED_H3_CHECKPOINTS.ref2va.sha256,
          comfyuiCoreRevision: PINNED_COMFYUI_CORE_REVISION
        },
        requiredRuntime: { coreRevision: PINNED_COMFYUI_CORE_REVISION },
        experimentVariant: {
          variantName: "base",
          purpose: "performance",
          changedFactors: []
        }
      } as unknown as MinimaxH3ExperimentDescriptorV2;

      const candDesc = {
        ...baseDesc,
        requestedRunner: { variantName: "other-runner-variant", memoryPolicy: "high" }
      } as unknown as MinimaxH3ExperimentDescriptorV2;

      const result = admitContinuityPair(baseDesc, candDesc, "prompt_only");
      expect(result.admitted).toBe(false);
      expect(result.reasons.some((r) => r.includes("Runner variant mismatch"))).toBe(true);
    });

    it("rejects checkpoint_only arm when runtime.manifest is declared (AC-13)", () => {
      const promptText = "subject in studio";
      const promptDigest = sha256Hex(promptText);

      const baseDesc = {
        route: "i2v",
        configuredFrames: 243,
        width: 1344,
        height: 768,
        fps: 24,
        seed: 42,
        prompt: promptText,
        promptDigest,
        references: [],
        baseProfileKey: "h3-default",
        requestedRunner: { variantName: "dynamicvram-offload-v1", memoryPolicy: "high" },
        provenance: {
          actualCheckpointHash: PINNED_H3_CHECKPOINTS.ref2va.sha256,
          comfyuiCoreRevision: PINNED_COMFYUI_CORE_REVISION
        },
        requiredRuntime: { coreRevision: PINNED_COMFYUI_CORE_REVISION },
        experimentVariant: {
          variantName: "base",
          purpose: "performance",
          changedFactors: []
        }
      } as unknown as MinimaxH3ExperimentDescriptorV2;

      const candDesc = {
        ...baseDesc,
        checkpointOverride: "fl2va",
        provenance: {
          actualCheckpointHash: PINNED_H3_CHECKPOINTS.fl2va.sha256,
          comfyuiCoreRevision: PINNED_COMFYUI_CORE_REVISION
        },
        experimentVariant: {
          variantName: "fl2va-bundle",
          purpose: "performance",
          changedFactors: [
            {
              path: "models.diffusion",
              before: { fileHash: PINNED_H3_CHECKPOINTS.ref2va.sha256 },
              after: { fileHash: PINNED_H3_CHECKPOINTS.fl2va.sha256 }
            },
            {
              path: "runtime.manifest",
              before: { digest: "d1" },
              after: { digest: "d2" }
            }
          ]
        }
      } as unknown as MinimaxH3ExperimentDescriptorV2;

      const result = admitContinuityPair(baseDesc, candDesc, "checkpoint_only");
      expect(result.admitted).toBe(false);
      expect(result.reasons.some((r) => r.includes("must not declare runtime.manifest"))).toBe(
        true
      );
    });
  });

  describe("validateSafetyChainDescriptor", () => {
    it("validates compliant 124f safety baseline and long-shot descriptor pair (AC-18)", () => {
      const promptText = "subject in studio";
      const promptDigest = sha256Hex(promptText);

      const safetyBaseDesc = {
        route: "i2v",
        configuredFrames: 124,
        prompt: promptText,
        promptDigest,
        seed: 42,
        baseProfileKey: "h3-default",
        requestedRunner: { variantName: "dynamicvram-offload-v1", memoryPolicy: "high" },
        references: [{ sha256: DUMMY_SHA, role: "first_frame" }],
        checkpointOverride: "ref2va",
        stepOverride: 20,
        attentionRequest: { attentionVariant: "dense" },
        requiredRuntime: { coreRevision: PINNED_COMFYUI_CORE_REVISION }
      } as unknown as MinimaxH3ExperimentDescriptorV2;

      const longShotDesc = {
        ...safetyBaseDesc,
        configuredFrames: 243
      } as unknown as MinimaxH3ExperimentDescriptorV2;

      const res = validateSafetyChainDescriptor(safetyBaseDesc, longShotDesc);
      expect(res.valid).toBe(true);
      expect(res.errors.length).toBe(0);

      // Rejects if prompt mismatches
      const mismatchPromptDesc = {
        ...longShotDesc,
        prompt: "different prompt",
        promptDigest: sha256Hex("different prompt")
      } as unknown as MinimaxH3ExperimentDescriptorV2;
      const mismatchRes = validateSafetyChainDescriptor(safetyBaseDesc, mismatchPromptDesc);
      expect(mismatchRes.valid).toBe(false);
      expect(mismatchRes.errors.some((e) => e.includes("prompt mismatch"))).toBe(true);

      // Rejects if runner variant mismatches
      const mismatchRunnerDesc = {
        ...longShotDesc,
        requestedRunner: { variantName: "other-runner", memoryPolicy: "high" }
      } as unknown as MinimaxH3ExperimentDescriptorV2;
      const runnerRes = validateSafetyChainDescriptor(safetyBaseDesc, mismatchRunnerDesc);
      expect(runnerRes.valid).toBe(false);
      expect(runnerRes.errors.some((e) => e.includes("runner variant mismatch"))).toBe(true);
    });
  });

  describe("Storyboard Plan & Review Manifest Builder", () => {
    it("builds storyboard plan with clamped 8.3s sample for short clips", () => {
      const scenarios = [createSyntheticScenario("sc-static", "static")];
      const study = expandContinuityStudyPlan({
        studyId: "study-sb-test",
        sourceEvidenceReferences: [{ url: "https://example.com", assertion: "Test" }],
        scenarios
      });

      const plan = buildContinuityStoryboardPlan({ study });
      expect(plan.panels.length).toBe(8);

      // 124f panel (duration ~5.167s)
      const p124 = plan.panels.find((p) => p.frames === 124);
      expect(p124).toBeDefined();
      const sample83 = p124!.plannedSamples.find((s) => s.sampleReason === "362f_recovery");
      expect(sample83?.inRange).toBe(false);

      // 243f panel (duration ~10.125s)
      const p243 = plan.panels.find((p) => p.frames === 243);
      expect(p243).toBeDefined();
      const sample83_243 = p243!.plannedSamples.find((s) => s.sampleReason === "362f_recovery");
      expect(sample83_243?.inRange).toBe(true);

      // Verify inspectionInstructions for defect-specific beats (F-eb29bb34)
      expect(p124?.inspectionInstructions?.[0]).toContain("camera push");
      expect(p243?.inspectionInstructions?.[0]).toContain("wardrobe");
      const p362 = plan.panels.find((p) => p.frames === 362);
      expect(p362?.inspectionInstructions?.[0]).toContain("blackout window");

      const reviewManifest = buildContinuityReviewManifest(study, plan);
      expect(reviewManifest.comparisonPairs.length).toBe(4);
    });
  });

  function createValidSidecar(
    overrides?: Partial<MinimaxH3ContinuityReviewSidecar>
  ): MinimaxH3ContinuityReviewSidecar {
    const draft = {
      schemaVersion: 1 as const,
      kind: "continuity-review-sidecar" as const,
      reviewId: "rev-01",
      reviewRevision: 1,
      rubricVersion: 1 as const,
      rubricDigest: computeContinuityRubricDigest(),
      studyId: "study-01",
      cellId: "cell-sc-static-243f-base",
      runId: "run-test-01",
      descriptorDigest: DUMMY_SHA,
      route: "i2v" as const,
      configuredFrames: 243 as const,
      sourceOutputSha256: DUMMY_OUTPUT_SHA,
      reviewer: "alice",
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
          rationale: "Consistent face"
        },
        wardrobe: {
          assessment: "pass" as const,
          fullClipAssessment: true,
          rationale: "Stable clothing"
        },
        backgroundLightingPersistence: {
          assessment: "pass" as const,
          fullClipAssessment: true,
          rationale: "Stable background"
        },
        cameraFidelity: {
          assessment: "pass" as const,
          fullClipAssessment: true,
          rationale: "Smooth push"
        },
        subjectAnatomy: {
          assessment: "pass" as const,
          fullClipAssessment: true,
          rationale: "Natural anatomy"
        },
        faceAndHands: {
          assessment: "pass" as const,
          fullClipAssessment: true,
          rationale: "Coherent features"
        },
        unnaturalCuts: {
          assessment: "pass" as const,
          fullClipAssessment: true,
          rationale: "No cuts"
        },
        temporalFlicker: {
          assessment: "pass" as const,
          fullClipAssessment: true,
          rationale: "No flicker"
        },
        referenceFidelity: {
          assessment: "pass" as const,
          fullClipAssessment: true,
          rationale: "Faithful to input"
        },
        motionCoherence: {
          assessment: "pass" as const,
          fullClipAssessment: true,
          rationale: "Smooth motion"
        },
        sound: { assessment: "not_assessable" as const, rationale: "Silent route" },
        overallAdUsability: {
          assessment: "pass" as const,
          fullClipAssessment: true,
          rationale: "Commercial ready"
        }
      },
      sceneSubstitution: { detected: false },
      firstFrameAdherence: { status: "pass" as const, rationale: "Exact match" },
      lastFrameAdherence: { status: "pass" as const, rationale: "Natural ending" },
      defectSpecificInspections: {
        wardrobe243fDepartureInspected: true,
        yellowBackdrop243fDepartureInspected: true,
        environment362fBlackoutInspected: false,
        camera124fPushInspected: false
      },
      overallOutcome: "pass" as const,
      ...overrides
    };
    const reviewDigest = computeContinuityReviewDigest(draft);
    return {
      ...draft,
      reviewDigest
    };
  }

  describe("Sidecar Validation & Import", () => {
    it("validates and imports continuity review into result.json", async () => {
      const store = new MockStore();
      const runDir = "/runs/run-test-01";

      const descriptor = {
        schemaVersion: 2,
        runId: "run-test-01",
        route: "i2v",
        configuredFrames: 243,
        descriptorDigest: DUMMY_SHA
      } as unknown as MinimaxH3AnyExperimentDescriptor;
      await store.writeDescriptor(runDir, descriptor);

      const result = {
        schemaVersion: 2,
        runId: "run-test-01",
        probe: {
          status: "succeeded",
          outputFile: "output.mp4",
          outputSha256: DUMMY_OUTPUT_SHA,
          measuredFacts: {
            fps: 24,
            measuredFrames: 243,
            measuredVideoDurationMs: 10125
          }
        },
        execution: { status: "completed" },
        visualReview: { status: "pending" }
      } as unknown as MinimaxH3AnyExperimentResult;
      await store.writeResult(runDir, result);

      const sidecar = createValidSidecar();

      const importResult = await importContinuityReview({ runDir, sidecar, store });
      expect(importResult.imported).toBe(true);
      expect(importResult.idempotent).toBe(false);

      // Re-importing identical sidecar is idempotent
      const secondImport = await importContinuityReview({ runDir, sidecar, store });
      expect(secondImport.imported).toBe(true);
      expect(secondImport.idempotent).toBe(true);

      const updated = await store.readResult(runDir);
      expect(updated?.visualReview.findings?.continuity).toBe("pass");
    });

    it("reconciles result.json on retry after an interrupted first import (F-ab949498)", async () => {
      const store = new MockStore();
      const runDir = "/runs/run-test-01";

      const descriptor = {
        schemaVersion: 2,
        runId: "run-test-01",
        route: "i2v",
        configuredFrames: 243,
        descriptorDigest: DUMMY_SHA
      } as unknown as MinimaxH3AnyExperimentDescriptor;
      await store.writeDescriptor(runDir, descriptor);

      const initialResult = {
        schemaVersion: 2,
        runId: "run-test-01",
        probe: {
          status: "succeeded",
          outputFile: "output.mp4",
          outputSha256: DUMMY_OUTPUT_SHA,
          measuredFacts: {
            fps: 24,
            measuredFrames: 243,
            measuredVideoDurationMs: 10125
          }
        },
        execution: { status: "completed" },
        visualReview: { status: "pending" }
      } as unknown as MinimaxH3AnyExperimentResult;
      await store.writeResult(runDir, initialResult);

      const sidecar = createValidSidecar();

      // Inject fault into writeResult
      store.writeResultFault = true;
      await expect(importContinuityReview({ runDir, sidecar, store })).rejects.toThrow(
        /Simulated I\/O disk error/
      );

      // Sidecar file was persisted, but result.visualReview remained pending!
      const interimResult = await store.readResult(runDir);
      expect(interimResult?.visualReview.status).toBe("pending");

      // Repair fault and retry import with identical sidecar
      store.writeResultFault = false;
      const retryResult = await importContinuityReview({ runDir, sidecar, store });
      expect(retryResult.imported).toBe(true);
      expect(retryResult.idempotent).toBe(true);

      // Reconciled result.json has now been updated to "reviewed"
      const finalResult = await store.readResult(runDir);
      expect(finalResult?.visualReview.status).toBe("reviewed");
      expect(finalResult?.visualReview.outputSha256).toBe(DUMMY_OUTPUT_SHA);
    });

    it("propagates SyntaxError and non-ENOENT read failures (F-1e8802d1)", async () => {
      const store = new MockStore();
      const runDir = "/runs/run-test-01";

      const descriptor = {
        schemaVersion: 2,
        runId: "run-test-01",
        route: "i2v",
        configuredFrames: 243,
        descriptorDigest: DUMMY_SHA
      } as unknown as MinimaxH3AnyExperimentDescriptor;
      await store.writeDescriptor(runDir, descriptor);

      const result = {
        schemaVersion: 2,
        runId: "run-test-01",
        probe: {
          status: "succeeded",
          outputFile: "output.mp4",
          outputSha256: DUMMY_OUTPUT_SHA,
          measuredFacts: { fps: 24, measuredFrames: 243, measuredVideoDurationMs: 10125 }
        },
        execution: { status: "completed" }
      } as unknown as MinimaxH3AnyExperimentResult;
      await store.writeResult(runDir, result);

      const sidecar = createValidSidecar();

      // Inject malformed JSON SyntaxError on existing review read
      store.readJsonFileFault = new SyntaxError("Unexpected token in JSON at position 0");
      await expect(importContinuityReview({ runDir, sidecar, store })).rejects.toThrow(SyntaxError);
    });

    it("rejects review with mismatched runId or descriptorDigest", () => {
      const sidecar = createValidSidecar({ runId: "run-wrong-id" });

      const descriptor = {
        runId: "run-expected-id",
        route: "i2v",
        configuredFrames: 243,
        descriptorDigest: DUMMY_SHA
      } as unknown as MinimaxH3AnyExperimentDescriptor;

      const validation = validateContinuityReview({ sidecarRaw: sidecar, descriptor });
      expect(validation.valid).toBe(false);
      expect(validation.errors[0]).toContain("does not match descriptor runId");
    });

    it("rejects intervals exceeding probed clip duration (AC-26, F-2f5ba47d)", () => {
      const sidecar = createValidSidecar();
      sidecar.dimensions.wardrobe = {
        assessment: "defect",
        severity: "major",
        rationale: "Wardrobe shift",
        intervals: [{ startSec: 5.0, endSec: 25.0 }] // Exceeds 10.125s clip!
      };
      sidecar.overallOutcome = "defect";
      sidecar.reviewDigest = computeContinuityReviewDigest(sidecar);

      const result = {
        schemaVersion: 2,
        runId: "run-test-01",
        probe: {
          status: "succeeded",
          outputFile: "output.mp4",
          outputSha256: DUMMY_OUTPUT_SHA,
          measuredFacts: { fps: 24, measuredFrames: 243, measuredVideoDurationMs: 10125 }
        },
        execution: { status: "completed" }
      } as unknown as MinimaxH3AnyExperimentResult;

      const validation = validateContinuityReview({ sidecarRaw: sidecar, result });
      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes("exceeds clip duration"))).toBe(true);
    });

    it("rejects review validation when result probe is failed or incomplete (AC-26, F-2f5ba47d)", () => {
      const sidecar = createValidSidecar();
      const failedResult = {
        schemaVersion: 2,
        runId: "run-test-01",
        execution: { status: "failed" },
        probe: { status: "failed", outputSha256: null }
      } as unknown as MinimaxH3AnyExperimentResult;

      const validation = validateContinuityReview({ sidecarRaw: sidecar, result: failedResult });
      expect(validation.valid).toBe(false);
      expect(
        validation.errors.some((e) => e.includes("completed") || e.includes("succeeded"))
      ).toBe(true);
    });

    it("rejects sound dimension pass when audioExamined is false (AC-24)", () => {
      const sidecar = createValidSidecar();
      sidecar.dimensions.sound = {
        assessment: "pass",
        rationale: "Clean audio"
      };
      sidecar.reviewCoverage.audioExamined = false; // Audio was not examined!
      sidecar.reviewDigest = computeContinuityReviewDigest(sidecar);

      const validation = validateContinuityReview({ sidecarRaw: sidecar });
      expect(validation.valid).toBe(false);
      expect(
        validation.errors.some(
          (e) =>
            e.includes("sound assessment cannot be 'pass'") || e.includes("audioExamined is false")
        )
      ).toBe(true);
    });

    it("archives prior review when importing incremented review revision (F-65a2473d)", async () => {
      const store = new MockStore();
      const runDir = "/runs/run-test-01";

      const descriptor = {
        schemaVersion: 2,
        runId: "run-test-01",
        route: "i2v",
        configuredFrames: 243,
        descriptorDigest: DUMMY_SHA
      } as unknown as MinimaxH3AnyExperimentDescriptor;
      await store.writeDescriptor(runDir, descriptor);

      const result = {
        schemaVersion: 2,
        runId: "run-test-01",
        probe: {
          status: "succeeded",
          outputFile: "output.mp4",
          outputSha256: DUMMY_OUTPUT_SHA,
          measuredFacts: { fps: 24, measuredFrames: 243, measuredVideoDurationMs: 10125 }
        },
        execution: { status: "completed" }
      } as unknown as MinimaxH3AnyExperimentResult;
      await store.writeResult(runDir, result);

      const reviewRev1 = createValidSidecar({ reviewRevision: 1, reviewer: "alice" });
      const firstImport = await importContinuityReview({ runDir, sidecar: reviewRev1, store });
      expect(firstImport.imported).toBe(true);

      // Now import rev 2 with differing reviewer
      const reviewRev2 = createValidSidecar({ reviewRevision: 2, reviewer: "bob" });
      const secondImport = await importContinuityReview({ runDir, sidecar: reviewRev2, store });
      expect(secondImport.imported).toBe(true);
      expect(secondImport.idempotent).toBe(false);

      // Verify that prior_reviews directory contains the archived rev 1
      const archivedFiles = [...store.files.keys()].filter((k) =>
        k.includes("/prior_reviews/continuity_review_rev-01_rev1_")
      );
      expect(archivedFiles.length).toBe(1);
    });

    it("rejects differing review if reviewRevision is not bumped", async () => {
      const store = new MockStore();
      const runDir = "/runs/run-test-01";

      const descriptor = {
        schemaVersion: 2,
        runId: "run-test-01",
        route: "i2v",
        configuredFrames: 243,
        descriptorDigest: DUMMY_SHA
      } as unknown as MinimaxH3AnyExperimentDescriptor;
      await store.writeDescriptor(runDir, descriptor);

      const result = {
        schemaVersion: 2,
        runId: "run-test-01",
        probe: {
          status: "succeeded",
          outputFile: "output.mp4",
          outputSha256: DUMMY_OUTPUT_SHA,
          measuredFacts: { fps: 24, measuredFrames: 243, measuredVideoDurationMs: 10125 }
        },
        execution: { status: "completed" }
      } as unknown as MinimaxH3AnyExperimentResult;
      await store.writeResult(runDir, result);

      const reviewRev1 = createValidSidecar({ reviewRevision: 1, reviewer: "alice" });
      await importContinuityReview({ runDir, sidecar: reviewRev1, store });

      // Attempt to overwrite with differing review without bumping revision
      const conflictingReview = createValidSidecar({ reviewRevision: 1, reviewer: "mallory" });
      await expect(
        importContinuityReview({ runDir, sidecar: conflictingReview, store })
      ).rejects.toThrow(/Modify reviewRevision or provide a new reviewId/);
    });

    it("serializes concurrent review imports so both survive (F-65a2473d)", async () => {
      const store = new MockStore();
      const runDir = "/runs/run-test-concurrent";

      const descriptor = {
        schemaVersion: 2,
        runId: "run-test-concurrent",
        route: "i2v",
        configuredFrames: 243,
        descriptorDigest: DUMMY_SHA
      } as unknown as MinimaxH3AnyExperimentDescriptor;
      await store.writeDescriptor(runDir, descriptor);

      const result = {
        schemaVersion: 2,
        runId: "run-test-concurrent",
        probe: {
          status: "succeeded",
          outputFile: "output.mp4",
          outputSha256: DUMMY_OUTPUT_SHA,
          measuredFacts: { fps: 24, measuredFrames: 243, measuredVideoDurationMs: 10125 }
        },
        execution: { status: "completed" }
      } as unknown as MinimaxH3AnyExperimentResult;
      await store.writeResult(runDir, result);

      const rev1 = createValidSidecar({
        runId: "run-test-concurrent",
        reviewRevision: 1,
        reviewer: "operator-alice"
      });
      const rev2 = createValidSidecar({
        runId: "run-test-concurrent",
        reviewRevision: 2,
        reviewer: "operator-bob"
      });

      // Run both concurrently
      const [res1, res2] = await Promise.all([
        importContinuityReview({ runDir, sidecar: rev1, store }),
        importContinuityReview({ runDir, sidecar: rev2, store })
      ]);

      expect(res1.imported).toBe(true);
      expect(res2.imported).toBe(true);

      // Verify that continuity_review.json is present AND that prior_reviews has the archived review
      const currentReview = await store.readJsonFile<MinimaxH3ContinuityReviewSidecar>(
        `${runDir}/continuity_review.json`
      );
      expect(currentReview).toBeDefined();

      const archivedFiles = [...store.files.keys()].filter((k) => k.includes("/prior_reviews/"));
      expect(archivedFiles.length).toBe(1);
    });

    it("rejects import when result probe outputFile is missing or hash mismatches (AC-26)", async () => {
      const store = new MockStore();
      const runDir = "/runs/run-test-output-check";

      const descriptor = {
        schemaVersion: 2,
        runId: "run-test-output-check",
        route: "i2v",
        configuredFrames: 243,
        descriptorDigest: DUMMY_SHA
      } as unknown as MinimaxH3AnyExperimentDescriptor;
      await store.writeDescriptor(runDir, descriptor);

      // Probe without outputFile
      const resultNoOutput = {
        schemaVersion: 2,
        runId: "run-test-output-check",
        probe: {
          status: "succeeded",
          outputSha256: DUMMY_OUTPUT_SHA,
          measuredFacts: { fps: 24, measuredFrames: 243, measuredVideoDurationMs: 10125 }
        },
        execution: { status: "completed" }
      } as unknown as MinimaxH3AnyExperimentResult;
      await store.writeResult(runDir, resultNoOutput);

      const sidecar = createValidSidecar({ runId: "run-test-output-check" });
      const resNoOutput = await importContinuityReview({ runDir, sidecar, store });
      expect(resNoOutput.imported).toBe(false);
      expect(resNoOutput.reason).toContain("outputFile");

      // Probe with outputFile but hash mismatch
      const resultWithOutput = {
        ...resultNoOutput,
        probe: {
          ...resultNoOutput.probe,
          outputFile: "output.mp4"
        }
      };
      await store.writeResult(runDir, resultWithOutput);
      store.customFileHashes.set("output.mp4", {
        sha256: "9999999999999999999999999999999999999999999999999999999999999999",
        sizeBytes: 1234
      });

      const resMismatch = await importContinuityReview({ runDir, sidecar, store });
      expect(resMismatch.imported).toBe(false);
      expect(resMismatch.reason).toContain("does not match");
    });

    it("propagates ENOENT when hashFile throws during importContinuityReview", async () => {
      const store = new MockStore();
      const runDir = "/runs/run-test-enoent";

      const descriptor = {
        schemaVersion: 2,
        runId: "run-test-enoent",
        route: "i2v",
        configuredFrames: 243,
        descriptorDigest: DUMMY_SHA
      } as unknown as MinimaxH3AnyExperimentDescriptor;
      await store.writeDescriptor(runDir, descriptor);

      const result = {
        schemaVersion: 2,
        runId: "run-test-enoent",
        probe: {
          status: "succeeded",
          outputFile: "missing_file.mp4",
          outputSha256: DUMMY_OUTPUT_SHA,
          measuredFacts: { fps: 24, measuredFrames: 243, measuredVideoDurationMs: 10125 }
        },
        execution: { status: "completed" }
      } as unknown as MinimaxH3AnyExperimentResult;
      await store.writeResult(runDir, result);

      store.hashFile = async () => {
        const err = new Error("ENOENT: no such file or directory");
        (err as unknown as { code: string }).code = "ENOENT";
        throw err;
      };

      const sidecar = createValidSidecar({ runId: "run-test-enoent" });
      await expect(importContinuityReview({ runDir, sidecar, store })).rejects.toThrow(/ENOENT/);
    });

    it("reconciles result.visualReview on retry after writeResult failure (F-ab949498)", async () => {
      const store = new MockStore();
      const runDir = "/runs/run-test-retry-fault";

      const descriptor = {
        schemaVersion: 2,
        runId: "run-test-retry-fault",
        route: "i2v",
        configuredFrames: 243,
        descriptorDigest: DUMMY_SHA
      } as unknown as MinimaxH3AnyExperimentDescriptor;
      await store.writeDescriptor(runDir, descriptor);

      const result = {
        schemaVersion: 2,
        runId: "run-test-retry-fault",
        probe: {
          status: "succeeded",
          outputFile: "output.mp4",
          outputSha256: DUMMY_OUTPUT_SHA,
          measuredFacts: { fps: 24, measuredFrames: 243, measuredVideoDurationMs: 10125 }
        },
        execution: { status: "completed" }
      } as unknown as MinimaxH3AnyExperimentResult;
      await store.writeResult(runDir, result);

      const sidecar = createValidSidecar({ runId: "run-test-retry-fault" });

      // Inject fault on writeResult: sidecar write will succeed, but result write will throw
      store.writeResultFault = true;
      await expect(importContinuityReview({ runDir, sidecar, store })).rejects.toThrow(
        /Simulated I\/O disk error/
      );

      // Verify sidecar was written, but result.visualReview is still not updated
      const rawSidecar = await store.readJsonFile(`${runDir}/continuity_review.json`);
      expect(rawSidecar).toBeDefined();
      const intermediateResult = await store.readResult(runDir);
      expect(intermediateResult?.visualReview).toBeUndefined();

      // Clear the fault and retry
      store.writeResultFault = false;
      const retryResult = await importContinuityReview({ runDir, sidecar, store });
      expect(retryResult.imported).toBe(true);
      expect(retryResult.idempotent).toBe(true);

      // Verify result.visualReview was reconciled
      const finalResult = await store.readResult(runDir);
      expect(finalResult?.visualReview?.status).toBe("reviewed");
      expect(finalResult?.visualReview?.outputSha256).toBe(DUMMY_OUTPUT_SHA);
    });

    it("reconciles replacement review from pass to fail on idempotent retry (F-944dbf37)", async () => {
      const store = new MockStore();
      const runDir = "/runs/run-test-replacement-retry";

      const descriptor = {
        schemaVersion: 2,
        runId: "run-test-replacement-retry",
        route: "i2v",
        configuredFrames: 243,
        descriptorDigest: DUMMY_SHA
      } as unknown as MinimaxH3AnyExperimentDescriptor;
      await store.writeDescriptor(runDir, descriptor);

      const result = {
        schemaVersion: 2,
        runId: "run-test-replacement-retry",
        probe: {
          status: "succeeded",
          outputFile: "output.mp4",
          outputSha256: DUMMY_OUTPUT_SHA,
          measuredFacts: { fps: 24, measuredFrames: 243, measuredVideoDurationMs: 10125 }
        },
        execution: { status: "completed" }
      } as unknown as MinimaxH3AnyExperimentResult;
      await store.writeResult(runDir, result);

      // 1. Initial pass review import
      const passSidecar = createValidSidecar({
        runId: "run-test-replacement-retry",
        reviewId: "rev-pass",
        reviewRevision: 1,
        overallOutcome: "pass"
      });
      await importContinuityReview({ runDir, sidecar: passSidecar, store });
      const resultAfterPass = await store.readResult(runDir);
      expect(resultAfterPass?.visualReview?.findings?.continuity).toBe("pass");

      // 2. Replacement fail review with revision 2
      const failSidecar = createValidSidecar({
        runId: "run-test-replacement-retry",
        reviewId: "rev-fail",
        reviewRevision: 2,
        overallOutcome: "fail"
      });
      failSidecar.dimensions.wardrobe = {
        assessment: "fail",
        severity: "critical",
        fullClipAssessment: true,
        rationale: "Wardrobe vanished completely"
      };
      failSidecar.reviewDigest = computeContinuityReviewDigest(failSidecar);

      // Fault on writeResult during replacement
      store.writeResultFault = true;
      await expect(importContinuityReview({ runDir, sidecar: failSidecar, store })).rejects.toThrow(
        /Simulated I\/O disk error/
      );

      // result.json still has old pass findings
      const staleResult = await store.readResult(runDir);
      expect(staleResult?.visualReview?.findings?.continuity).toBe("pass");

      // 3. Retry importing the same fail sidecar: must reconcile mapped findings to fail!
      store.writeResultFault = false;
      const retryRes = await importContinuityReview({ runDir, sidecar: failSidecar, store });
      expect(retryRes.imported).toBe(true);
      expect(retryRes.idempotent).toBe(true);

      const reconciledResult = await store.readResult(runDir);
      expect(reconciledResult?.visualReview?.findings?.continuity).toBe("fail");
    });
  });

  describe("prepareContinuityStudyCell", () => {
    it("rejects preparing a cell whose status is pending_source", async () => {
      const store = new MockStore();
      const preflight = new MockPreflight();
      const scenario = createSyntheticScenario("sc-pending", "static");
      scenario.status = "pending_source";
      scenario.pendingReason = "Awaiting original prompt text";
      scenario.originalPrompt = null;

      const study = expandContinuityStudyPlan({
        studyId: "study-pending-test",
        sourceEvidenceReferences: [{ url: "https://example.com", assertion: "Test" }],
        scenarios: [scenario]
      });

      await expect(
        prepareContinuityStudyCell({
          study,
          cellId: "cell-sc-pending-243f-base",
          outputRoot: "/tmp/runs",
          targetHost: "localhost",
          gpuUuid: "GPU-1234",
          comfyUiDir: "/opt/comfyui",
          pythonPath: "/usr/bin/python3",
          store,
          preflight
        })
      ).rejects.toThrow(/status is 'pending_source'/);
    });

    it("verifies pinned input asset SHA and size before staging (F-37aee15c)", async () => {
      const store = new MockStore();
      const preflight = new MockPreflight();
      const scenario = createSyntheticScenario("sc-corrupted-asset", "static");

      const study = expandContinuityStudyPlan({
        studyId: "study-asset-check",
        sourceEvidenceReferences: [{ url: "https://example.com", assertion: "Test" }],
        scenarios: [scenario]
      });

      // Inject wrong SHA into file hash lookup
      store.customFileHashes.set("test-assets/trinidad_subject_16x9.jpg", {
        sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        sizeBytes: 122528
      });

      await expect(
        prepareContinuityStudyCell({
          study,
          cellId: "cell-sc-corrupted-asset-124f-base",
          outputRoot: "/tmp/runs",
          targetHost: "localhost",
          gpuUuid: "GPU-1234",
          comfyUiDir: "/opt/comfyui",
          pythonPath: "/usr/bin/python3",
          store,
          preflight
        })
      ).rejects.toThrow(/SHA-256 mismatch/);
    });

    it("rejects combined arm cell without referenced independent human reviews", async () => {
      const store = new MockStore();
      const preflight = new MockPreflight();
      const scenario = createSyntheticScenario("sc-resolved", "static");

      const study = expandContinuityStudyPlan({
        studyId: "study-combined-guard",
        sourceEvidenceReferences: [{ url: "https://example.com", assertion: "Test" }],
        scenarios: [scenario],
        includeCombinedArms: true
      });

      const combinedCell = study.cells.find((c) => c.arm === "combined")!;
      combinedCell.status = "resolved";
      combinedCell.prompt = scenario.constrainedPrompts[0]!.text;
      combinedCell.promptDigest = scenario.constrainedPrompts[0]!.digest;

      await expect(
        prepareContinuityStudyCell({
          study,
          cellId: combinedCell.cellId,
          outputRoot: "/tmp/runs",
          targetHost: "localhost",
          gpuUuid: "GPU-1234",
          comfyUiDir: "/opt/comfyui",
          pythonPath: "/usr/bin/python3",
          store,
          preflight
        })
      ).rejects.toThrow(/independent single-variable arms must be reviewed by a human operator/);
    });

    it("successfully prepares a resolved Ref2V cell with 4 campaign references", async () => {
      const store = new MockStore();
      const preflight = new MockPreflight();

      const campaignRefManifest = {
        referenceSetId: "trinidad-campaign-4ref",
        manifestDigest: DUMMY_SHA,
        references: [
          {
            slotIndex: 0,
            role: "subject_identity",
            tag: "<Picture 1>",
            sourceAssetPath: "test-assets/trinidad_subject.jpg",
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
            sourceAssetPath: "test-assets/trinidad_product.jpg",
            sourceSha256: "f4dbb845aa086287da85b07d239b14dccf7b40aedb68367ec885c0913c1c79ab",
            sourceSizeBytes: 107963,
            mimeType: "image/jpeg" as const,
            width: 1024,
            height: 679
          },
          {
            slotIndex: 2,
            role: "location",
            tag: "<Picture 3>",
            sourceAssetPath: "test-assets/trinidad_location.jpg",
            sourceSha256: "39a494e9cbf204f3b8d45a8f18c5e8e05f8f652fc6fe7e24746519ba2110b7ee",
            sourceSizeBytes: 181597,
            mimeType: "image/jpeg" as const,
            width: 1024,
            height: 576
          },
          {
            slotIndex: 3,
            role: "style",
            tag: "<Picture 4>",
            sourceAssetPath: "test-assets/trinidad_style.jpg",
            sourceSha256: "182b70c25d93acbe62ebf59489114587456104ab1bd8ac3051ce0cdd95f1da5d",
            sourceSizeBytes: 159383,
            mimeType: "image/jpeg" as const,
            width: 1024,
            height: 768
          }
        ]
      };
      campaignRefManifest.manifestDigest = computeReferenceManifestDigest(campaignRefManifest);

      for (const ref of campaignRefManifest.references) {
        store.customFileHashes.set(ref.sourceAssetPath, {
          sha256: ref.sourceSha256,
          sizeBytes: ref.sourceSizeBytes
        });
        store.customDimensions.set(ref.sourceAssetPath, {
          width: ref.width,
          height: ref.height,
          mimeType: ref.mimeType
        });
      }

      const promptText =
        "In the style of <Picture 4>, shot of <Picture 1> with <Picture 2> at <Picture 3>";
      const promptDigest = sha256Hex(promptText);

      const scenario: ContinuityScenario = {
        scenarioId: "sc-ref2v-real",
        scenarioRole: "illustrative_test",
        subjectMotionIntent: "moving",
        route: "ref2v",
        conditioningMode: "reference_directed",
        status: "resolved",
        originalPrompt: { text: promptText, digest: promptDigest },
        constrainedPrompts: [
          {
            promptId: "tight-ref2v",
            label: "Tight Ref2V",
            text: promptText,
            digest: promptDigest,
            constraintsApplied: ["fixed_lighting"]
          }
        ],
        referenceManifest: campaignRefManifest
      };

      const study = expandContinuityStudyPlan({
        studyId: "study-ref2v-prep",
        sourceEvidenceReferences: [{ url: "https://example.com/ref2v", assertion: "Ref2V QA" }],
        scenarios: [scenario]
      });

      const prepResult = await prepareContinuityStudyCell({
        study,
        cellId: "cell-sc-ref2v-real-124f-base",
        outputRoot: "/tmp/runs",
        targetHost: "localhost",
        gpuUuid: "GPU-1234",
        comfyUiDir: "/opt/comfyui",
        pythonPath: "/usr/bin/python3",
        store,
        preflight
      });

      expect(prepResult.descriptor.runId).toBeDefined();
      expect(prepResult.descriptor.route).toBe("ref2v");
      expect(prepResult.descriptor.references.length).toBe(4);
    });

    it("rejects preparing cell when asset dimensions do not match pinned reference manifest", async () => {
      const store = new MockStore();
      const preflight = new MockPreflight();
      const scenario = createSyntheticScenario("sc-wrong-dimensions", "static");

      const study = expandContinuityStudyPlan({
        studyId: "study-dim-check",
        sourceEvidenceReferences: [{ url: "https://example.com", assertion: "Test" }],
        scenarios: [scenario]
      });

      // Override inspectAsset to return wrong dimensions for the asset
      store.customDimensions.set("test-assets/trinidad_subject_16x9.jpg", {
        width: 800,
        height: 600,
        mimeType: "image/jpeg"
      });

      await expect(
        prepareContinuityStudyCell({
          study,
          cellId: "cell-sc-wrong-dimensions-124f-base",
          outputRoot: "/tmp/runs",
          targetHost: "localhost",
          gpuUuid: "GPU-1234",
          comfyUiDir: "/opt/comfyui",
          pythonPath: "/usr/bin/python3",
          store,
          preflight
        })
      ).rejects.toThrow(/dimension mismatch/);
    });

    it("prepares combined cell when all independent review prerequisites are verified and admitted (AC-27)", async () => {
      const store = new MockStore();
      const preflight = new MockPreflight();
      const scenario = createSyntheticScenario("sc-resolved-combined", "static");

      const study = expandContinuityStudyPlan({
        studyId: "study-combined-admitted",
        sourceEvidenceReferences: [{ url: "https://example.com", assertion: "Test" }],
        scenarios: [scenario],
        includeCombinedArms: true
      });

      const combinedCell = study.cells.find((c) => c.arm === "combined")!;
      combinedCell.status = "resolved";
      combinedCell.prompt = scenario.constrainedPrompts[0]!.text;
      combinedCell.promptDigest = scenario.constrainedPrompts[0]!.digest;

      // Create valid human reviews for prerequisite cells
      const prereqReviews: MinimaxH3ContinuityReviewSidecar[] = (
        combinedCell.prerequisiteCellIds ?? []
      ).map((cid) => {
        return createValidSidecar({
          studyId: study.studyId,
          cellId: cid,
          runId: `run-${cid}`,
          operatorDisposition: "admitted",
          overallOutcome: "pass"
        });
      });

      const prepResult = await prepareContinuityStudyCell({
        study,
        cellId: combinedCell.cellId,
        outputRoot: "/tmp/runs",
        targetHost: "localhost",
        gpuUuid: "GPU-1234",
        comfyUiDir: "/opt/comfyui",
        pythonPath: "/usr/bin/python3",
        store,
        preflight,
        humanReviewsForCombinedPrerequisites: prereqReviews
      });

      expect(prepResult.descriptor.runId).toBeDefined();
      expect(prepResult.descriptor.experimentVariant.purpose).toBe("controlled_multifactor");
    });

    it("persists full pin contract into staged legacy format manifest (F-f9eed3c4)", async () => {
      const store = new MockStore();
      const preflight = new MockPreflight();
      const scenario = createSyntheticScenario("sc-pins", "static");

      const study = expandContinuityStudyPlan({
        studyId: "study-pin-check",
        sourceEvidenceReferences: [{ url: "https://example.com", assertion: "Test" }],
        scenarios: [scenario]
      });

      await prepareContinuityStudyCell({
        study,
        cellId: "cell-sc-pins-124f-base",
        outputRoot: "/tmp/runs",
        targetHost: "localhost",
        gpuUuid: "GPU-1234",
        comfyUiDir: "/opt/comfyui",
        pythonPath: "/usr/bin/python3",
        store,
        preflight
      });

      const manifestPath = "/tmp/runs/staged_manifests/study-pin-check_sc-pins.json";
      const stagedManifest = store.files.get(manifestPath) as {
        referenceSetId: string;
        references: Array<Record<string, unknown>>;
      };
      expect(stagedManifest).toBeDefined();
      expect(stagedManifest.references.length).toBe(1);

      const ref0 = stagedManifest.references[0]!;
      expect(ref0.sha256).toBe("776145851c2bd2dba5a29fd0f45e222f5b09ee016b2371ed013582e1d41f6eb8");
      expect(ref0.sizeBytes).toBe(122528);
      expect(ref0.width).toBe(1024);
      expect(ref0.height).toBe(585);
      expect(ref0.sourceAssetPath).toBe("test-assets/trinidad_subject_16x9.jpg");
      expect(ref0.derivation).toBe("center-cropped from 1024x819 to 1024x585");
    });

    it("validates pair admission against baseline descriptor when baseline is in outputRoot (AC-16)", async () => {
      const store = new MockStore();
      const preflight = new MockPreflight();
      const scenario = createSyntheticScenario("sc-baseline-check", "static");

      const study = expandContinuityStudyPlan({
        studyId: "study-base-adm",
        sourceEvidenceReferences: [{ url: "https://example.com", assertion: "Test" }],
        scenarios: [scenario]
      });

      // 1. Prepare baseline cell
      const baseResult = await prepareContinuityStudyCell({
        study,
        cellId: "cell-sc-baseline-check-124f-base",
        outputRoot: "/tmp/runs",
        targetHost: "localhost",
        gpuUuid: "GPU-1234",
        comfyUiDir: "/opt/comfyui",
        pythonPath: "/usr/bin/python3",
        store,
        preflight
      });
      expect(baseResult.descriptor.runId).toBeDefined();

      // 2. Prepare candidate cell (tight-v1) - should admit successfully
      const candResult = await prepareContinuityStudyCell({
        study,
        cellId: "cell-sc-baseline-check-124f-tight-v1",
        outputRoot: "/tmp/runs",
        targetHost: "localhost",
        gpuUuid: "GPU-1234",
        comfyUiDir: "/opt/comfyui",
        pythonPath: "/usr/bin/python3",
        store,
        preflight
      });
      expect(candResult.descriptor.runId).toBeDefined();
    });

    it("honors studyControls.diffusionCheckpoint on baseline cell when specified (AC-3, F-e077f31a)", async () => {
      const store = new MockStore();
      const preflight = new MockPreflight();
      const scenario = createSyntheticScenario("sc-fl2va-base", "static");

      const study = expandContinuityStudyPlan({
        studyId: "study-fl2va-ctrl",
        sourceEvidenceReferences: [{ url: "https://example.com", assertion: "Test" }],
        scenarios: [scenario]
      });

      study.studyControls.diffusionCheckpoint = {
        repository: "Comfy-Org/MiniMax-H3",
        revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1",
        filename: PINNED_H3_CHECKPOINTS.fl2va.filename,
        sha256: PINNED_H3_CHECKPOINTS.fl2va.sha256,
        taskMode: "fl2va",
        auditRef: "https://huggingface.co/Comfy-Org/MiniMax-H3"
      };

      const baseResult = await prepareContinuityStudyCell({
        study,
        cellId: "cell-sc-fl2va-base-124f-base",
        outputRoot: "/tmp/runs",
        targetHost: "localhost",
        gpuUuid: "GPU-1234",
        comfyUiDir: "/opt/comfyui",
        pythonPath: "/usr/bin/python3",
        store,
        preflight
      });

      expect(baseResult.descriptor.checkpointOverride).toBe("fl2va");
      expect(baseResult.descriptor.provenance.actualCheckpointHash).toBe(
        PINNED_H3_CHECKPOINTS.fl2va.sha256
      );
    });

    it("verifies real on-disk pinned asset against test-assets/ (F-37aee15c, F-f9eed3c4)", async () => {
      const store = new MockStore();
      const preflight = new MockPreflight();
      const scenario = createSyntheticScenario("sc-disk-asset", "static");

      // Delegate hashFile to actual filesystem for real on-disk verification
      const realAssetPath = "test-assets/trinidad_subject_16x9.jpg";
      const fileBytes = fs.readFileSync(realAssetPath);
      const expectedSha = crypto.createHash("sha256").update(fileBytes).digest("hex");
      expect(expectedSha).toBe("776145851c2bd2dba5a29fd0f45e222f5b09ee016b2371ed013582e1d41f6eb8");

      const study = expandContinuityStudyPlan({
        studyId: "study-disk-verify",
        sourceEvidenceReferences: [{ url: "https://example.com", assertion: "Test" }],
        scenarios: [scenario]
      });

      // Prepare cell with real asset and valid store hashes matching disk
      const prepResult = await prepareContinuityStudyCell({
        study,
        cellId: "cell-sc-disk-asset-124f-base",
        outputRoot: "/tmp/runs",
        targetHost: "localhost",
        gpuUuid: "GPU-1234",
        comfyUiDir: "/opt/comfyui",
        pythonPath: "/usr/bin/python3",
        store,
        preflight
      });
      expect(prepResult.descriptor.runId).toBeDefined();

      // If on-disk file hash is corrupted, it must throw
      store.customFileHashes.set(realAssetPath, {
        sha256: "corruptedsha256000000000000000000000000000000000000000000000000000",
        sizeBytes: fileBytes.length
      });

      await expect(
        prepareContinuityStudyCell({
          study,
          cellId: "cell-sc-disk-asset-124f-base",
          outputRoot: "/tmp/runs",
          targetHost: "localhost",
          gpuUuid: "GPU-1234",
          comfyUiDir: "/opt/comfyui",
          pythonPath: "/usr/bin/python3",
          store,
          preflight
        })
      ).rejects.toThrow(/SHA-256 mismatch/);
    });
  });
});
