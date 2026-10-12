import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MINIMAX_H3_EXPERIMENT_CANDIDATE_FRAMES,
  isGridValidMinimaxH3FrameCount,
  validateMinimaxH3ExperimentFrameCount,
  getMinimaxH3FrameDurationInfo,
  createEmptyMinimaxH3MeasurementTemplate,
  MinimaxH3ExperimentDescriptorSchema,
  MinimaxH3ExperimentResultSchema,
  MinimaxH3MatrixRowSchema,
  MinimaxH3OperatorDecisionSidecarSchema,
  MinimaxH3VisualReviewSidecarSchema,
  DEFAULT_MINIMAX_H3_STOP_POLICY,
  MinimaxH3StopPolicySchema,
  sha256Hex,
  type MinimaxH3ExperimentDescriptor,
  type MinimaxH3ExperimentResult
} from "./minimax-h3-experiment.js";

const sampleDigest = "a".repeat(64);
const sampleDigest2 = "b".repeat(64);

const validDescriptor: MinimaxH3ExperimentDescriptor = {
  schemaVersion: 1,
  kind: "non-production-experiment",
  runId: "exp-i2v-124-001",
  operatorLabel: "operator-test",
  route: "i2v",
  configuredFrames: 124,
  fps: 24,
  requestedDurationMs: 5167,
  requestedDurationSupplied: false,
  configuredDurationMs: 5167,
  width: 1344,
  height: 768,
  seed: 42,
  prompt: "A cinematic shot of a sunset",
  promptDigest: sha256Hex("A cinematic shot of a sunset"),
  baseProfileKey: "MINIMAX_H3_720P_5S_I2V_V1",
  baseProfileVersion: 1,
  baseProfileFileDigest: sampleDigest,
  provenanceManifestDigest: sampleDigest,
  provenanceSource: "authored_from_spec",
  baseCanonicalWorkflowDigest: sampleDigest,
  derivedWorkflowDigest: sampleDigest2,
  pinFileIdentities: {
    comfyuiCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
    minimaxH3Revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1",
    modelDigests: {
      "models/diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors": sampleDigest
    }
  },
  resolvedModelPaths: {
    "models/diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors": {
      expectedHash: sampleDigest,
      resolvedPath: "/path/to/model",
      sizeBytes: 20970379616
    }
  },
  referenceSetId: "ref-set-1",
  references: [
    {
      slotIndex: 0,
      role: "first_frame",
      tag: "<Picture 1>",
      order: 0,
      assetPath: "/path/to/frame.png",
      stagedFilename: "frame_0.png",
      sha256: sampleDigest,
      width: 1344,
      height: 768,
      mimeType: "image/png"
    }
  ],
  requestedRunner: {
    variantName: "dynamicvram-offload-v1",
    variantReason: null,
    memoryPolicy: "dynamic_vram",
    offloadSettings: {
      modelOffload: true
    }
  },
  configuredRunner: {
    argv: ["--listen", "127.0.0.1", "--port", "8199"],
    env: { CUDA_VISIBLE_DEVICES: "GPU-12345678-1234-1234-1234-123456789abc" },
    predictedPolicy: "dynamic_vram",
    pinnedSourceIdentities: {
      cliArgsSha256: sampleDigest,
      mainSha256: sampleDigest,
      modelManagementSha256: sampleDigest
    }
  },
  target: {
    hostname: "render-worker-01",
    gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
    comfyUiDir: "/opt/comfyui",
    pythonPath: "/opt/venv/bin/python3",
    address: "127.0.0.1",
    port: 8199
  },
  collectionIntervalMs: 1000,
  timeouts: {
    startupTimeoutMs: 60000,
    submissionTimeoutMs: 30000,
    pollIntervalMs: 1000,
    totalRenderTimeoutMs: 600000,
    probeTimeoutMs: 30000,
    settlementTimeoutMs: 5000,
    shutdownTimeoutMs: 10000
  },
  configDigest: sampleDigest2,
  comparisonKey: "cmp-key-1"
};

describe("MiniMax-H3 Experiment Contracts", () => {
  describe("Frame grid and candidate admission", () => {
    it("admits all 4 candidate frame counts and computes correct duration facts", () => {
      expect(MINIMAX_H3_EXPERIMENT_CANDIDATE_FRAMES).toEqual([124, 192, 243, 362]);

      const f124 = validateMinimaxH3ExperimentFrameCount(124);
      expect(f124).toBe(124);
      const info124 = getMinimaxH3FrameDurationInfo(124);
      expect(info124.k).toBe(7);
      expect(info124.rationalDurationSeconds).toBe("31/6");
      expect(info124.configuredDurationMs).toBe(5167);

      const f192 = validateMinimaxH3ExperimentFrameCount(192);
      expect(f192).toBe(192);
      const info192 = getMinimaxH3FrameDurationInfo(192);
      expect(info192.k).toBe(11);
      expect(info192.rationalDurationSeconds).toBe("8");
      expect(info192.configuredDurationMs).toBe(8000);

      const f243 = validateMinimaxH3ExperimentFrameCount(243);
      expect(f243).toBe(243);
      const info243 = getMinimaxH3FrameDurationInfo(243);
      expect(info243.k).toBe(14);
      expect(info243.rationalDurationSeconds).toBe("81/8");
      expect(info243.configuredDurationMs).toBe(10125);

      const f362 = validateMinimaxH3ExperimentFrameCount(362);
      expect(f362).toBe(362);
      const info362 = getMinimaxH3FrameDurationInfo(362);
      expect(info362.k).toBe(21);
      expect(info362.rationalDurationSeconds).toBe("181/12");
      expect(info362.configuredDurationMs).toBe(15083);
    });

    it("verifies the grid formula (frames - 5) % 17 === 0", () => {
      expect(isGridValidMinimaxH3FrameCount(124)).toBe(true);
      expect(isGridValidMinimaxH3FrameCount(192)).toBe(true);
      expect(isGridValidMinimaxH3FrameCount(243)).toBe(true);
      expect(isGridValidMinimaxH3FrameCount(362)).toBe(true);

      // Other on-grid numbers
      expect(isGridValidMinimaxH3FrameCount(5)).toBe(true);
      expect(isGridValidMinimaxH3FrameCount(22)).toBe(true);
      expect(isGridValidMinimaxH3FrameCount(39)).toBe(true);
      expect(isGridValidMinimaxH3FrameCount(141)).toBe(true);

      // Off-grid numbers
      expect(isGridValidMinimaxH3FrameCount(120)).toBe(false);
      expect(isGridValidMinimaxH3FrameCount(125)).toBe(false);
      expect(isGridValidMinimaxH3FrameCount(200)).toBe(false);
      expect(isGridValidMinimaxH3FrameCount(0)).toBe(false);
      expect(isGridValidMinimaxH3FrameCount(-124)).toBe(false);
      expect(isGridValidMinimaxH3FrameCount(124.5)).toBe(false);
    });

    it("rejects non-integer, negative, NaN, Infinity, and string values", () => {
      expect(() => validateMinimaxH3ExperimentFrameCount("124")).toThrow(/safe positive integer/);
      expect(() => validateMinimaxH3ExperimentFrameCount(124.5)).toThrow(/safe positive integer/);
      expect(() => validateMinimaxH3ExperimentFrameCount(-124)).toThrow(/safe positive integer/);
      expect(() => validateMinimaxH3ExperimentFrameCount(NaN)).toThrow(/safe positive integer/);
      expect(() => validateMinimaxH3ExperimentFrameCount(Infinity)).toThrow(
        /safe positive integer/
      );
      expect(() => validateMinimaxH3ExperimentFrameCount(null)).toThrow(/safe positive integer/);
    });

    it("rejects off-grid numbers with a grid rule error", () => {
      expect(() => validateMinimaxH3ExperimentFrameCount(125)).toThrow(
        /violates the MiniMax-H3 grid rule/
      );
      expect(() => validateMinimaxH3ExperimentFrameCount(120)).toThrow(
        /violates the MiniMax-H3 grid rule/
      );
    });

    it("rejects other on-grid numbers that are out-of-scope for the experiment", () => {
      // 5, 22, 39, 141 are on grid, but not in {124, 192, 243, 362}
      expect(() => validateMinimaxH3ExperimentFrameCount(5)).toThrow(/out-of-scope/);
      expect(() => validateMinimaxH3ExperimentFrameCount(22)).toThrow(/out-of-scope/);
      expect(() => validateMinimaxH3ExperimentFrameCount(141)).toThrow(/out-of-scope/);
    });
  });

  describe("Descriptor schema", () => {
    it("parses and validates a complete valid descriptor", () => {
      const parsed = MinimaxH3ExperimentDescriptorSchema.parse(validDescriptor);
      expect(parsed.runId).toBe("exp-i2v-124-001");
      expect(parsed.configuredFrames).toBe(124);
      expect(parsed.fps).toBe(24);
    });

    it("rejects invalid descriptor fields", () => {
      expect(() =>
        MinimaxH3ExperimentDescriptorSchema.parse({
          ...validDescriptor,
          configuredFrames: 125 // off-grid
        })
      ).toThrow();

      expect(() =>
        MinimaxH3ExperimentDescriptorSchema.parse({
          ...validDescriptor,
          target: {
            ...validDescriptor.target,
            gpuUuid: "invalid-uuid"
          }
        })
      ).toThrow();
    });
  });

  describe("Measurement template and result schema invariants", () => {
    it("creates a valid empty measurement template from a descriptor", () => {
      const template = createEmptyMinimaxH3MeasurementTemplate(validDescriptor);
      const parsed = MinimaxH3ExperimentResultSchema.parse(template);
      expect(parsed.runId).toBe(validDescriptor.runId);
      expect(parsed.lifecycle).toBe("prepared");
      expect(parsed.execution.status).toBe("not_started");
      expect(parsed.collection.status).toBe("not_started");
      expect(parsed.probe.status).toBe("not_started");
      expect(parsed.outputConformance.status).toBe("unknown");
      expect(parsed.visualReview.status).toBe("pending");
      expect(parsed.operatorDecision.status).toBe("pending");
      expect(parsed.stopRecommendation.recommended).toBe(false);
    });

    it("witness test: confirmed engine success, all telemetry fails, probe times out is a VALID schema result", () => {
      const template = createEmptyMinimaxH3MeasurementTemplate(validDescriptor);
      const witnessResult: MinimaxH3ExperimentResult = {
        ...template,
        lifecycle: "completed",
        timestamps: {
          ...template.timestamps,
          startedAt: "2026-10-12T10:00:00.000Z",
          submittedAt: "2026-10-12T10:01:00.000Z",
          terminatedAt: "2026-10-12T10:08:00.000Z"
        },
        execution: {
          status: "completed",
          promptId: "prompt-12345",
          terminalEvidence: {
            source: "history",
            rawDetails: { status: "success" }
          },
          engineError: null,
          latencyMs: 420000
        },
        collection: {
          status: "failed",
          phaseCoverage: {
            before: false,
            during: false,
            after: false
          },
          sampleCount: {
            attempted: 5,
            succeeded: 0,
            failed: 5
          },
          metrics: {
            gpuPeakUsedVramMb: null,
            gpuAllocatableVramMb: null,
            hostPeakRamUsedMb: null,
            processPeakRssMb: null,
            hostSwapUsedMb: null,
            hostSwapDeltaMb: null
          },
          errors: [
            {
              timestamp: "2026-10-12T10:01:05.000Z",
              message: "nvidia-smi timeout after 500ms"
            }
          ]
        },
        probe: {
          status: "failed",
          outputFile: null,
          outputSha256: null,
          outputSizeBytes: null,
          measuredFacts: {
            measuredFrames: null,
            countedFramesSource: null,
            declaredNbFrames: null,
            measuredVideoDurationMs: null,
            measuredContainerDurationMs: null,
            width: null,
            height: null,
            fps: null,
            rFrameRate: null,
            avgFrameRate: null,
            videoCodec: null,
            audioCodec: null,
            audioChannels: null,
            audioSampleRate: null
          },
          discrepancyFlags: ["probe_timed_out"],
          toolIdentity: {
            ffprobePath: "/usr/bin/ffprobe",
            version: "7.0.2-static"
          },
          errors: [
            {
              message: "ffprobe command timed out after 60000ms"
            }
          ]
        },
        outputConformance: {
          status: "unknown",
          checks: {
            frameCountMatches: null,
            geometryMatches: null,
            fpsMatches: null,
            timingWithinTolerance: null
          },
          reasons: ["probe_failed_timeout"]
        },
        visualReview: {
          status: "pending",
          reviewedAt: null,
          reviewer: null,
          findings: null,
          notes: null,
          unavailableReason: null
        },
        operatorDecision: {
          status: "pending",
          operator: null,
          decidedAt: null,
          comparisonKey: validDescriptor.comparisonKey,
          reason: null
        },
        stopRecommendation: {
          recommended: true,
          reasons: ["telemetry_collection_failed", "output_probe_failed"]
        }
      };

      const parsed = MinimaxH3ExperimentResultSchema.parse(witnessResult);
      expect(parsed.execution.status).toBe("completed");
      expect(parsed.collection.status).toBe("failed");
      expect(parsed.probe.status).toBe("failed");
      expect(parsed.stopRecommendation.recommended).toBe(true);
    });

    it("rejects execution status 'completed' when promptId or terminalEvidence is missing", () => {
      const template = createEmptyMinimaxH3MeasurementTemplate(validDescriptor);
      expect(() =>
        MinimaxH3ExperimentResultSchema.parse({
          ...template,
          execution: {
            status: "completed",
            promptId: null,
            terminalEvidence: { source: "history" },
            engineError: null,
            latencyMs: 100
          }
        })
      ).toThrow(/requires a non-null promptId/);

      expect(() =>
        MinimaxH3ExperimentResultSchema.parse({
          ...template,
          execution: {
            status: "completed",
            promptId: "prompt-1",
            terminalEvidence: null,
            engineError: null,
            latencyMs: 100
          }
        })
      ).toThrow(/requires terminalEvidence/);
    });

    it("rejects collection status 'complete' when coverage is incomplete or errors exist", () => {
      const template = createEmptyMinimaxH3MeasurementTemplate(validDescriptor);
      expect(() =>
        MinimaxH3ExperimentResultSchema.parse({
          ...template,
          collection: {
            status: "complete",
            phaseCoverage: { before: true, during: true, after: false }, // missing after
            sampleCount: { attempted: 10, succeeded: 10, failed: 0 },
            metrics: {
              gpuPeakUsedVramMb: 20000,
              gpuAllocatableVramMb: 24000,
              hostPeakRamUsedMb: 16000,
              processPeakRssMb: 12000,
              hostSwapUsedMb: 0,
              hostSwapDeltaMb: 0
            },
            errors: []
          }
        })
      ).toThrow(/requires before, during, and after phase coverage/);

      expect(() =>
        MinimaxH3ExperimentResultSchema.parse({
          ...template,
          collection: {
            status: "complete",
            phaseCoverage: { before: true, during: true, after: true },
            sampleCount: { attempted: 10, succeeded: 9, failed: 1 }, // failed > 0
            metrics: {
              gpuPeakUsedVramMb: 20000,
              gpuAllocatableVramMb: 24000,
              hostPeakRamUsedMb: 16000,
              processPeakRssMb: 12000,
              hostSwapUsedMb: 0,
              hostSwapDeltaMb: 0
            },
            errors: []
          }
        })
      ).toThrow(/forbids any failed samples/);
    });

    it("rejects operator approval without complete evidence and pass visual findings", () => {
      const template = createEmptyMinimaxH3MeasurementTemplate(validDescriptor);
      expect(() =>
        MinimaxH3ExperimentResultSchema.parse({
          ...template,
          operatorDecision: {
            status: "approve_candidate",
            operator: "alice",
            decidedAt: "2026-10-12T11:00:00.000Z",
            comparisonKey: validDescriptor.comparisonKey,
            reason: "Looks good"
          }
        })
      ).toThrow(/Operator approval requires execution status 'completed'/);
    });

    it("validates downstream matrix row schema and stop policy schema", () => {
      const stopPolicy = MinimaxH3StopPolicySchema.parse(DEFAULT_MINIMAX_H3_STOP_POLICY);
      expect(stopPolicy.policyId).toBe("rtx-4090-minimax-h3-default-stop-v1");

      const matrixRow = MinimaxH3MatrixRowSchema.parse({
        schemaVersion: 1,
        route: "i2v",
        configuredFrames: 124,
        requestedDurationMs: 5167,
        configuredDurationMs: 5167,
        width: 1344,
        height: 768,
        promptDigest: sampleDigest,
        referenceSetId: "ref-1",
        seed: 42,
        requestedRunnerVariant: "dynamicvram-offload-v1",
        configuredRunnerVariant: "dynamicvram-offload-v1",
        effectiveRunnerMode: "dynamic_vram",
        descriptorDigest: sampleDigest,
        configDigest: sampleDigest,
        comparisonKey: "cmp-key-1",
        runId: "run-001",
        baselineRunId: null,
        attemptStatus: "attempted",
        blockReason: null,
        executionStatus: "completed",
        collectionStatus: "complete",
        probeStatus: "succeeded",
        outputConformanceStatus: "conformant",
        visualReviewStatus: "reviewed",
        stopRecommendation: false,
        operatorDecision: "approve_candidate",
        operatorDecisionDetails: {
          operator: "alice",
          decidedAt: "2026-10-12T11:00:00.000Z",
          reason: "Candidate meets all criteria"
        },
        measuredPeakVramMb: 23950,
        measuredHostRamMb: 30000,
        measuredSwapDeltaMb: 0,
        measuredDurationMs: 5167,
        measuredFrames: 124
      });
      expect(matrixRow.configuredFrames).toBe(124);
      expect(matrixRow.operatorDecision).toBe("approve_candidate");
    });

    it("enforces blocked/unattempted invariants and rejects unknown fields", () => {
      // Valid blocked matrix row
      const blockedRow = MinimaxH3MatrixRowSchema.parse({
        schemaVersion: 1,
        route: "ref2v",
        configuredFrames: 192,
        requestedDurationMs: 8000,
        configuredDurationMs: 8000,
        width: 1344,
        height: 768,
        promptDigest: sampleDigest,
        referenceSetId: "ref-1",
        seed: 42,
        requestedRunnerVariant: "dynamicvram-offload-v1",
        configuredRunnerVariant: "dynamicvram-offload-v1",
        effectiveRunnerMode: "unknown",
        descriptorDigest: sampleDigest,
        configDigest: sampleDigest,
        comparisonKey: "cmp-key-2",
        runId: null,
        baselineRunId: null,
        attemptStatus: "blocked",
        blockReason: "Ref2V conditioning assets not provided for candidate run",
        executionStatus: null,
        collectionStatus: null,
        probeStatus: null,
        outputConformanceStatus: null,
        visualReviewStatus: null,
        stopRecommendation: null,
        operatorDecision: null,
        measuredPeakVramMb: null,
        measuredHostRamMb: null,
        measuredSwapDeltaMb: null,
        measuredDurationMs: null,
        measuredFrames: null
      });
      expect(blockedRow.attemptStatus).toBe("blocked");
      expect(blockedRow.blockReason).toContain("Ref2V");

      // Rejects blocked row without reason
      expect(() =>
        MinimaxH3MatrixRowSchema.parse({
          schemaVersion: 1,
          route: "ref2v",
          configuredFrames: 192,
          requestedDurationMs: 8000,
          configuredDurationMs: 8000,
          width: 1344,
          height: 768,
          promptDigest: sampleDigest,
          referenceSetId: "ref-1",
          seed: 42,
          requestedRunnerVariant: "dynamicvram-offload-v1",
          configuredRunnerVariant: "dynamicvram-offload-v1",
          effectiveRunnerMode: "unknown",
          descriptorDigest: sampleDigest,
          configDigest: sampleDigest,
          comparisonKey: "cmp-key-2",
          runId: null,
          baselineRunId: null,
          attemptStatus: "blocked",
          blockReason: null,
          executionStatus: null,
          collectionStatus: null,
          probeStatus: null,
          outputConformanceStatus: null,
          visualReviewStatus: null,
          stopRecommendation: null,
          operatorDecision: null,
          measuredPeakVramMb: null,
          measuredHostRamMb: null,
          measuredSwapDeltaMb: null,
          measuredDurationMs: null,
          measuredFrames: null
        })
      ).toThrow(/Blocked matrix row requires a non-empty blockReason/);

      // Rejects blocked row claiming approval
      expect(() =>
        MinimaxH3MatrixRowSchema.parse({
          schemaVersion: 1,
          route: "ref2v",
          configuredFrames: 192,
          requestedDurationMs: 8000,
          configuredDurationMs: 8000,
          width: 1344,
          height: 768,
          promptDigest: sampleDigest,
          referenceSetId: "ref-1",
          seed: 42,
          requestedRunnerVariant: "dynamicvram-offload-v1",
          configuredRunnerVariant: "dynamicvram-offload-v1",
          effectiveRunnerMode: "unknown",
          descriptorDigest: sampleDigest,
          configDigest: sampleDigest,
          comparisonKey: "cmp-key-2",
          runId: null,
          baselineRunId: null,
          attemptStatus: "blocked",
          blockReason: "blocked",
          executionStatus: null,
          collectionStatus: null,
          probeStatus: null,
          outputConformanceStatus: null,
          visualReviewStatus: null,
          stopRecommendation: null,
          operatorDecision: "approve_candidate",
          measuredPeakVramMb: null,
          measuredHostRamMb: null,
          measuredSwapDeltaMb: null,
          measuredDurationMs: null,
          measuredFrames: null
        })
      ).toThrow(/blocked matrix row cannot be approved/);

      // Rejects unattempted row claiming reviewed visual status or non-unknown effective mode
      expect(() =>
        MinimaxH3MatrixRowSchema.parse({
          schemaVersion: 1,
          route: "ref2v",
          configuredFrames: 243,
          requestedDurationMs: 10125,
          configuredDurationMs: 10125,
          width: 1344,
          height: 768,
          promptDigest: sampleDigest,
          referenceSetId: "ref-1",
          seed: 42,
          requestedRunnerVariant: "dynamicvram-offload-v1",
          configuredRunnerVariant: "dynamicvram-offload-v1",
          effectiveRunnerMode: "dynamic_vram", // invalid for unattempted
          descriptorDigest: sampleDigest,
          configDigest: sampleDigest,
          comparisonKey: "cmp-key-3",
          runId: null,
          baselineRunId: null,
          attemptStatus: "unattempted",
          blockReason: "Candidate run unattempted pending earlier stage",
          executionStatus: null,
          collectionStatus: null,
          probeStatus: null,
          outputConformanceStatus: null,
          visualReviewStatus: "reviewed", // invalid for unattempted
          stopRecommendation: null,
          operatorDecision: null,
          measuredPeakVramMb: null,
          measuredHostRamMb: null,
          measuredSwapDeltaMb: null,
          measuredDurationMs: null,
          measuredFrames: null
        })
      ).toThrow();
    });

    it("ensures documentation markdown templates in docs/minimax-h3-variable-frame-experiments.md conform strictly to Zod schemas", () => {
      const candidates = [
        "docs/minimax-h3-variable-frame-experiments.md",
        resolve(process.cwd(), "docs/minimax-h3-variable-frame-experiments.md"),
        resolve(process.env.INIT_CWD ?? "", "docs/minimax-h3-variable-frame-experiments.md")
      ];
      const docPath = candidates.find((p) => p && existsSync(p));
      expect(docPath).toBeDefined();
      const content = readFileSync(docPath!, "utf8");

      const section8Start = content.indexOf("## 8. Blank Observation Templates");
      expect(section8Start).toBeGreaterThan(0);
      const section8 = content.slice(section8Start);
      const jsonBlocks = [...section8.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]);

      expect(jsonBlocks.length).toBeGreaterThanOrEqual(4);

      // 8.1 Stop Policy
      const stopPolicyJson = JSON.parse(
        jsonBlocks[0]!
          .replaceAll('"<operator-defined positive integer>"', "1")
          .replace('"<operator-defined-policy-id>"', '"test-policy"')
      );
      const parsedStopPolicy = MinimaxH3StopPolicySchema.parse(stopPolicyJson);
      expect(parsedStopPolicy.policyId).toBe("test-policy");

      // 8.2 Visual Review Sidecar
      const visualReviewJson = JSON.parse(jsonBlocks[1]!);
      const parsedVisualReview = MinimaxH3VisualReviewSidecarSchema.parse(visualReviewJson);
      expect(parsedVisualReview.status).toBe("pending");

      // 8.3 Decision Sidecar
      const decisionJson = JSON.parse(jsonBlocks[2]!);
      const parsedDecision = MinimaxH3OperatorDecisionSidecarSchema.parse(decisionJson);
      expect(parsedDecision.status).toBe("pending");

      // 8.4 Matrix Row
      const matrixRowJson = JSON.parse(jsonBlocks[3]!);
      const parsedMatrixRow = MinimaxH3MatrixRowSchema.parse(matrixRowJson);
      expect(parsedMatrixRow.attemptStatus).toBe("unattempted");
    });
  });
});
