import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { compareMinimaxH3Experiments } from "./minimax-h3-comparator.js";
import {
  PINNED_H3_CHECKPOINTS,
  PINNED_H3_LORAS,
  createEmptyMinimaxH3MeasurementTemplateV2,
  computeAttentionRuntimeLockDigest,
  getSamplingRecipe,
  FASTH3_ISOLATED_CORE_REVISION,
  type MinimaxH3ExperimentDescriptorV2,
  type MinimaxH3ExperimentResultV2,
  type MinimaxH3PhaseAccountingEvent,
  type MinimaxH3TelemetrySample,
  type MinimaxH3ProcessRecord,
  type MinimaxH3TerminalEvidence,
  type MinimaxH3ExperimentIntent,
  type MinimaxH3ExperimentReceipt,
  type MinimaxH3ExperimentEvent,
  type MinimaxH3AnyExperimentDescriptor,
  type MinimaxH3AnyExperimentResult
} from "@cco/contracts";
import { sha256Hex, MinimaxH3ExperimentService } from "./minimax-h3-experiment-service.js";
import type { MinimaxH3ExperimentStorePort } from "../ports/minimax-h3-experiment-ports.js";

const DUMMY_HASH_1 = "1111111111111111111111111111111111111111111111111111111111111111";
const DUMMY_HASH_2 = "2222222222222222222222222222222222222222222222222222222222222222";
const DUMMY_HASH_3 = "3333333333333333333333333333333333333333333333333333333333333333";
const DUMMY_HASH_4 = "4444444444444444444444444444444444444444444444444444444444444444";

function createTestDescriptorV2(
  overrides: Partial<MinimaxH3ExperimentDescriptorV2> = {}
): MinimaxH3ExperimentDescriptorV2 {
  const prompt = "A cinematic shot of a sunset over the ocean";
  const promptDigest = sha256Hex(prompt);
  return {
    schemaVersion: 2,
    kind: "non-production-experiment",
    runId: "run-base-001",
    operatorLabel: "operator",
    route: "i2v",
    configuredFrames: 124,
    fps: 24,
    requestedDurationMs: 5167,
    requestedDurationSupplied: false,
    configuredDurationMs: 5167,
    width: 1344,
    height: 768,
    seed: 42,
    prompt,
    promptDigest,
    baseProfileKey: "MINIMAX_H3_720P_5S_I2V_V1",
    baseProfileVersion: 1,
    baseProfileFileDigest: DUMMY_HASH_1,
    provenanceManifestDigest: DUMMY_HASH_2,
    provenanceSource: "authored_from_spec",
    baseCanonicalWorkflowDigest: DUMMY_HASH_3,
    derivedWorkflowDigest: DUMMY_HASH_4,
    pinFileIdentities: {
      comfyuiCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      minimaxH3Revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1",
      modelDigests: {
        diffusion: PINNED_H3_CHECKPOINTS.ref2va.sha256
      }
    },
    resolvedModelPaths: {
      diffusion: {
        expectedHash: PINNED_H3_CHECKPOINTS.ref2va.sha256,
        resolvedPath: `/models/${PINNED_H3_CHECKPOINTS.ref2va.filename}`,
        sizeBytes: 20_000_000_000
      }
    },
    referenceSetId: "ref-set-01",
    references: [
      {
        slotIndex: 0,
        role: "reference",
        tag: "<Picture 1>",
        order: 0,
        assetPath: "/assets/ref.png",
        stagedFilename: "ref.png",
        sha256: DUMMY_HASH_1,
        width: 1344,
        height: 768,
        mimeType: "image/png"
      }
    ],
    requestedRunner: {
      variantName: "dynamicvram-offload-v1",
      variantReason: "baseline test",
      memoryPolicy: "dynamic_vram",
      offloadSettings: {
        modelOffload: true
      }
    },
    configuredRunner: {
      argv: ["--listen", "127.0.0.1"],
      env: {},
      predictedPolicy: "dynamic_vram",
      pinnedSourceIdentities: {
        cliArgsSha256: DUMMY_HASH_1,
        mainSha256: DUMMY_HASH_2,
        modelManagementSha256: DUMMY_HASH_3
      }
    },
    target: {
      hostname: "localhost",
      gpuUuid: "GPU-11111111-2222-3333-4444-555555555555",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      address: "127.0.0.1",
      port: 8188
    },
    collectionIntervalMs: 1000,
    timeouts: {
      startupTimeoutMs: 120_000,
      submissionTimeoutMs: 30_000,
      pollIntervalMs: 1_000,
      totalRenderTimeoutMs: 1_200_000,
      probeTimeoutMs: 60_000,
      settlementTimeoutMs: 10_000,
      shutdownTimeoutMs: 15_000
    },
    configDigest: DUMMY_HASH_1,
    comparisonKey: "cmp-key-001",
    experimentVariant: {
      variantName: "baseline-124f",
      variantReason: "baseline control",
      purpose: "performance",
      changedFactors: []
    },
    provenance: {
      canonicalTemplateHash: DUMMY_HASH_1,
      derivedWorkflowDigest: DUMMY_HASH_4,
      actualCheckpointHash: PINNED_H3_CHECKPOINTS.ref2va.sha256,
      loadedModelHashes: {
        unet: PINNED_H3_CHECKPOINTS.ref2va.sha256
      },
      comfyuiCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      sourceIdentities: {
        cliArgsSha256: DUMMY_HASH_1,
        mainSha256: DUMMY_HASH_2,
        modelManagementSha256: DUMMY_HASH_3
      },
      customNodeInventory: {
        status: "verified_empty",
        nodes: []
      },
      runtimeVersions: {
        pythonVersion: "3.11.9",
        pytorchVersion: "2.4.1+cu124",
        cudaBuildVersion: "12.4",
        cudaRuntimeVersion: "12.4",
        driverVersion: "560.35.03"
      },
      requestedAttentionBackend: "default",
      requestedMemoryPolicy: "dynamic_vram",
      samplerSettings: {
        sampler: "res_multistep",
        scheduler: "simple",
        steps: 20
      },
      sourceAssetDigests: [
        {
          role: "reference",
          slotIndex: 0,
          sha256: DUMMY_HASH_1
        }
      ],
      promptDigest,
      instrumentationProtocol: "v2-jsonl",
      collectorDigest: DUMMY_HASH_2,
      hookManifestDigest: DUMMY_HASH_3
    },
    compatibility: {
      state: "supported",
      relativeToRuntimeManifestDigest: DUMMY_HASH_1,
      scope: "i2v-124f-20steps",
      reasons: ["Verified on pinned ComfyUI core revision 55b6a9b1"],
      sources: []
    },
    requiredRuntime: {
      coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      sourceFileHashes: {
        "comfy/model_management.py": DUMMY_HASH_1
      },
      requiredNodes: [
        {
          name: "MiniMaxH3ImageToVideo",
          moduleHash: DUMMY_HASH_2
        }
      ],
      pythonPackages: [
        { name: "torch", version: "2.4.1" },
        { name: "torchaudio", version: "2.4.1" }
      ],
      pytorchBuild: "2.4.1+cu124",
      cudaBuild: "12.4",
      driverConstraints: [">=550.00.00"],
      attentionKernel: "sdpa",
      instrumentationProtocol: "v2-jsonl",
      collectorDigest: DUMMY_HASH_2,
      hookManifestDigest: DUMMY_HASH_3,
      hooks: [
        {
          name: "sampler_step_hook",
          modulePath: "comfy.samplers",
          callable: "sample",
          phase: "sampling_step"
        }
      ]
    },
    conditioning: {
      positivePrompt: {
        text: prompt,
        digest: promptDigest
      },
      negativePrompt: {
        status: "not_supported",
        text: null,
        digest: null
      },
      bindings: [
        {
          role: "first_frame",
          slotIndex: 0,
          kind: "first_frame",
          assetPath: "/assets/ref.png",
          sha256: DUMMY_HASH_1,
          targetNodeId: "20",
          targetInputName: "image"
        }
      ]
    },
    ...overrides
  };
}

function createCompletedResultV2(
  descriptor: MinimaxH3ExperimentDescriptorV2,
  overrides: Partial<MinimaxH3ExperimentResultV2> = {}
): MinimaxH3ExperimentResultV2 {
  const tpl = createEmptyMinimaxH3MeasurementTemplateV2(descriptor);
  return {
    ...tpl,
    execution: {
      status: "completed",
      promptId: "prompt-123",
      terminalEvidence: {
        source: "history",
        status: "success",
        runId: descriptor.runId,
        promptId: "prompt-123",
        serverAddress: "127.0.0.1",
        serverPort: 8188,
        outputFilename: "output.mp4",
        subfolder: null,
        outputType: "output",
        error: null,
        rawDetails: {}
      },
      engineError: null,
      latencyMs: 420000 // 7m
    },
    outputConformance: {
      status: "conformant",
      checks: {
        frameCountMatches: true,
        geometryMatches: true,
        fpsMatches: true,
        timingWithinTolerance: true
      },
      reasons: []
    },
    visualReview: {
      status: "reviewed",
      outputSha256: DUMMY_HASH_1,
      reviewedAt: new Date().toISOString(),
      reviewer: "operator",
      findings: {
        continuity: "pass",
        identityFidelity: "pass",
        visualDegradation: "pass"
      },
      notes: null,
      unavailableReason: null
    },
    phaseAccounting: {
      ...tpl.phaseAccounting,
      status: "complete",
      wholeAttemptWallMs: 420000,
      samplingWallTimeMs: 380000
    },
    attentionObservation:
      descriptor.attentionRequest?.attentionVariant === "dense" ||
      descriptor.samplingRecipe?.attentionTopology
        ? {
            status: "verified",
            actualBackend: descriptor.samplingRecipe?.attentionTopology?.backend ?? "torch_sdpa",
            dispatchImplementation: descriptor.samplingRecipe?.attentionTopology
              ? "block_sparse_triton"
              : "torch.nn.functional.scaled_dot_product_attention",
            acceleratedCallCount: descriptor.samplingRecipe?.attentionTopology ? 16 : 0,
            denseCallCount: descriptor.samplingRecipe?.attentionTopology ? 0 : 40,
            plannedDenseCallCount: 0,
            fallbackEvents: [],
            failureReason: null,
            missingKernelFailure: null,
            measurementCoverage: {
              samplingCallsRecorded: 1,
              attentionCallsRecorded: descriptor.samplingRecipe?.attentionTopology ? 16 : 40,
              complete: true
            },
            timings: {
              deviceElapsedMs: null,
              kernelElapsedMs: null
            }
          }
        : undefined,
    observedProvenance: {
      ...tpl.observedProvenance,
      observedSampling: {
        status: "verified",
        completedSteps: descriptor.samplingRecipe?.expectedSteps ?? descriptor.stepOverride ?? 20,
        expectedSteps: descriptor.samplingRecipe?.expectedSteps ?? descriptor.stepOverride ?? 20,
        samplerName: descriptor.samplingRecipe?.sampler ?? "res_multistep",
        schedulerName: descriptor.samplingRecipe?.scheduler ?? "simple"
      },
      observedConditioning: {
        status: "verified",
        nodeClass:
          descriptor.route === "i2v" ? "MiniMaxH3ImageToVideo" : "MiniMaxH3ReferenceToVideo",
        taskMode: descriptor.route,
        referenceCount: descriptor.references.length
      },
      ...overrides.observedProvenance
    },
    ...overrides
  };
}

describe("MinimaxH3Comparator", () => {
  it("admits identical controlled runs with perfect ratio 1.0", () => {
    const baselineDesc = createTestDescriptorV2({ runId: "run-base" });
    const baselineResult = createCompletedResultV2(baselineDesc);

    const variantDesc = createTestDescriptorV2({ runId: "run-variant" });
    const variantResult = createCompletedResultV2(variantDesc, {
      execution: {
        ...baselineResult.execution,
        latencyMs: 400000
      },
      phaseAccounting: {
        ...baselineResult.phaseAccounting,
        wholeAttemptWallMs: 400000,
        samplingWallTimeMs: 360000
      }
    });

    const report = compareMinimaxH3Experiments({
      baselineDescriptor: baselineDesc,
      baselineResult,
      variantDescriptor: variantDesc,
      variantResult
    });

    expect(report.structuralAdmission.eligible).toBe(true);
    expect(report.structuralAdmission.reasons).toEqual([]);
    expect(report.metricEligibility.wallTimeEligible).toBe(true);
    expect(report.metricEligibility.samplingWallEligible).toBe(true);
    expect(report.metrics?.baselineWallTimeMs).toBe(420000);
    expect(report.metrics?.variantWallTimeMs).toBe(400000);
    expect(report.metrics?.wallTimeRatio).toBeCloseTo(0.9524, 3);
  });

  describe("Witness F1: Prompt-Conditioning Single-Variable Controlled Pair Admission & Counterexamples", () => {
    it("admits single-variable prompt variation when all controls (geometry, frames, seed, route, runner) are identical", () => {
      const baselineDesc = createTestDescriptorV2({
        runId: "run-prompt-base",
        prompt: "A cinematic shot of a quiet mountain village at sunrise"
      });
      const baselineResult = createCompletedResultV2(baselineDesc);

      const variantPrompt = "A cinematic shot of a bustling city center at dusk";
      const variantDesc = createTestDescriptorV2({
        runId: "run-prompt-variant",
        prompt: variantPrompt,
        promptDigest: sha256Hex(variantPrompt),
        experimentVariant: {
          variantName: "prompt-variation-test",
          variantReason: "Testing prompt conditioning sensitivity",
          purpose: "prompt_conditioning",
          changedFactors: [
            {
              path: "conditioning.positivePrompt",
              before: {
                text: baselineDesc.prompt,
                digest: baselineDesc.promptDigest
              },
              after: {
                text: variantPrompt,
                digest: sha256Hex(variantPrompt)
              },
              rationale: "Prompt variation hypothesis"
            }
          ]
        },
        conditioning: {
          ...baselineDesc.conditioning,
          positivePrompt: {
            text: variantPrompt,
            digest: sha256Hex(variantPrompt)
          }
        }
      });
      const variantResult = createCompletedResultV2(variantDesc);

      const report = compareMinimaxH3Experiments({
        baselineDescriptor: baselineDesc,
        baselineResult,
        variantDescriptor: variantDesc,
        variantResult,
        purpose: "prompt_conditioning"
      });

      expect(report.structuralAdmission.eligible).toBe(true);
      expect(report.structuralAdmission.reasons).toEqual([]);
      expect(report.metricEligibility.wallTimeEligible).toBe(true);
      expect(report.metricEligibility.samplingWallEligible).toBe(true);
      expect(report.metricEligibility.reasons.some((r) => r.includes("non_comparable"))).toBe(true);
    });

    it("rejects counterexample with differing geometry (1344x768 vs 1280x720)", () => {
      const baselineDesc = createTestDescriptorV2({ runId: "base-geo", width: 1344, height: 768 });
      const baselineResult = createCompletedResultV2(baselineDesc);

      const variantDesc = createTestDescriptorV2({
        runId: "variant-geo",
        width: 1280,
        height: 720,
        experimentVariant: {
          variantName: "prompt-geo-mismatch",
          variantReason: "Invalid prompt test with geometry mismatch",
          purpose: "prompt_conditioning",
          changedFactors: []
        }
      });
      const variantResult = createCompletedResultV2(variantDesc);

      const report = compareMinimaxH3Experiments({
        baselineDescriptor: baselineDesc,
        baselineResult,
        variantDescriptor: variantDesc,
        variantResult,
        purpose: "prompt_conditioning"
      });

      expect(report.structuralAdmission.eligible).toBe(false);
      expect(report.structuralAdmission.reasons.some((r) => r.includes("Geometry mismatch"))).toBe(
        true
      );
      expect(report.metricEligibility.wallTimeEligible).toBe(false);
    });

    it("rejects counterexample with differing frame counts (124 vs 243)", () => {
      const baselineDesc = createTestDescriptorV2({ runId: "base-frames", configuredFrames: 124 });
      const baselineResult = createCompletedResultV2(baselineDesc);

      const variantDesc = createTestDescriptorV2({
        runId: "variant-frames",
        configuredFrames: 243,
        experimentVariant: {
          variantName: "prompt-frame-mismatch",
          variantReason: "Invalid prompt test with frame mismatch",
          purpose: "prompt_conditioning",
          changedFactors: []
        }
      });
      const variantResult = createCompletedResultV2(variantDesc);

      const report = compareMinimaxH3Experiments({
        baselineDescriptor: baselineDesc,
        baselineResult,
        variantDescriptor: variantDesc,
        variantResult,
        purpose: "prompt_conditioning"
      });

      expect(report.structuralAdmission.eligible).toBe(false);
      expect(
        report.structuralAdmission.reasons.some((r) => r.includes("Frame count mismatch"))
      ).toBe(true);
    });

    it("rejects counterexample with differing seeds (42 vs 43) without declared seed factor", () => {
      const baselineDesc = createTestDescriptorV2({ runId: "base-seed", seed: 42 });
      const baselineResult = createCompletedResultV2(baselineDesc);

      const variantDesc = createTestDescriptorV2({
        runId: "variant-seed",
        seed: 43,
        experimentVariant: {
          variantName: "prompt-seed-mismatch",
          variantReason: "Invalid prompt test with undeclared seed change",
          purpose: "prompt_conditioning",
          changedFactors: []
        }
      });
      const variantResult = createCompletedResultV2(variantDesc);

      const report = compareMinimaxH3Experiments({
        baselineDescriptor: baselineDesc,
        baselineResult,
        variantDescriptor: variantDesc,
        variantResult,
        purpose: "prompt_conditioning"
      });

      expect(report.structuralAdmission.eligible).toBe(false);
      expect(report.structuralAdmission.reasons.some((r) => r.includes("Seed mismatch"))).toBe(
        true
      );
    });
  });

  describe("Witness F2: Isolated Runtime Compatibility Verification", () => {
    it("flags runtime conflict when variant has recorded runtime conflicts", () => {
      const baselineDesc = createTestDescriptorV2({ runId: "base-runtime" });
      const baselineResult = createCompletedResultV2(baselineDesc);

      const variantDesc = createTestDescriptorV2({ runId: "variant-conflict" });
      const variantResult = createCompletedResultV2(variantDesc, {
        observedProvenance: {
          ...baselineResult.observedProvenance,
          conflicts: ["Custom node conflict: incompatible patch in nodes_minimax_h3.py"]
        }
      });

      const report = compareMinimaxH3Experiments({
        baselineDescriptor: baselineDesc,
        baselineResult,
        variantDescriptor: variantDesc,
        variantResult
      });

      expect(report.structuralAdmission.eligible).toBe(false);
      expect(
        report.structuralAdmission.reasons.some((r) => r.includes("unresolved conflicts"))
      ).toBe(true);
    });
  });

  describe("Incomplete and Failed Run Handling", () => {
    it("marks wall time ineligible if variant execution failed", () => {
      const baselineDesc = createTestDescriptorV2({ runId: "base-pass" });
      const baselineResult = createCompletedResultV2(baselineDesc);

      const variantDesc = createTestDescriptorV2({ runId: "variant-fail" });
      const variantResult = createCompletedResultV2(variantDesc, {
        execution: {
          status: "failed",
          promptId: "prompt-failed",
          terminalEvidence: null,
          engineError: { message: "CUDA out of memory" },
          latencyMs: null
        }
      });

      const report = compareMinimaxH3Experiments({
        baselineDescriptor: baselineDesc,
        baselineResult,
        variantDescriptor: variantDesc,
        variantResult
      });

      expect(report.structuralAdmission.eligible).toBe(true);
      expect(report.metricEligibility.wallTimeEligible).toBe(false);
      expect(
        report.metricEligibility.reasons.some((r) => r.includes("did not complete successfully"))
      ).toBe(true);
      expect(report.metrics).toBeNull();
    });
  });

  describe("Attention Optimization Experiments & Invariants", () => {
    it("requires baseline to be dense control when comparing an accelerated attention variant", () => {
      const baselineDesc = createTestDescriptorV2({
        runId: "base-sage",
        attentionRequest: {
          attentionVariant: "sage",
          expectedBackend: "sage",
          expectedKernel: "sageattention.sageattn",
          topologyDigest: DUMMY_HASH_1,
          catalogDigest: DUMMY_HASH_1,
          patches: [],
          runtimeLockDigest: DUMMY_HASH_2,
          denseRegionPolicy: { allowPlannedDense: true, description: "policy" }
        }
      });
      const baselineResult = createCompletedResultV2(baselineDesc);

      const candidateDesc = createTestDescriptorV2({
        runId: "cand-sol-attn",
        attentionRequest: {
          attentionVariant: "native-sol-attn",
          expectedBackend: "sol_attn",
          expectedKernel: "sol_attn",
          topologyDigest: DUMMY_HASH_3,
          catalogDigest: DUMMY_HASH_3,
          patches: [],
          runtimeLockDigest: DUMMY_HASH_4,
          denseRegionPolicy: { allowPlannedDense: true, description: "policy" }
        }
      });
      const candidateResult = createCompletedResultV2(candidateDesc);

      const report = compareMinimaxH3Experiments({
        baselineDescriptor: baselineDesc,
        baselineResult,
        variantDescriptor: candidateDesc,
        variantResult: candidateResult
      });

      expect(report.structuralAdmission.eligible).toBe(false);
      expect(
        report.structuralAdmission.reasons.some((r) =>
          r.includes("require an untouched dense baseline control")
        )
      ).toBe(true);
    });

    it("disqualifies samplingWallEligible and kernelTimeEligible if candidate experienced fallback", () => {
      const baselineDesc = createTestDescriptorV2({
        runId: "base-dense",
        attentionRequest: {
          attentionVariant: "dense",
          expectedBackend: "torch_sdpa",
          expectedKernel: "torch.nn.functional.scaled_dot_product_attention",
          topologyDigest: DUMMY_HASH_1,
          catalogDigest: DUMMY_HASH_1,
          patches: [],
          runtimeLockDigest: DUMMY_HASH_2,
          denseRegionPolicy: { allowPlannedDense: true, description: "policy" }
        }
      });
      const baselineResult = createCompletedResultV2(baselineDesc);

      const candidateDesc = createTestDescriptorV2({
        runId: "cand-sage-fallback",
        attentionRequest: {
          attentionVariant: "sage",
          expectedBackend: "sage",
          expectedKernel: "sageattention.sageattn",
          topologyDigest: DUMMY_HASH_3,
          catalogDigest: DUMMY_HASH_3,
          patches: [],
          runtimeLockDigest: DUMMY_HASH_2,
          denseRegionPolicy: { allowPlannedDense: true, description: "policy" }
        }
      });
      const candidateResult = createCompletedResultV2(candidateDesc, {
        observedProvenance: {
          ...baselineResult.observedProvenance,
          observedAttentionBackend: {
            status: "fallback",
            effectiveBackend: "torch_sdpa",
            dispatchImplementation: "torch.nn.functional.scaled_dot_product_attention",
            unknownReason: "Mask unsupported"
          }
        },
        attentionObservation: {
          status: "fallback",
          actualBackend: "torch_sdpa",
          dispatchImplementation: "torch.nn.functional.scaled_dot_product_attention",
          acceleratedCallCount: 0,
          denseCallCount: 40,
          plannedDenseCallCount: 0,
          fallbackEvents: [
            {
              stepIndex: 0,
              layerIndex: null,
              requestedBackend: "sage",
              fallbackBackend: "torch_sdpa",
              reason: "Mask unsupported",
              monotonicMs: 1234.5
            }
          ],
          failureReason: "Fallback occurred",
          missingKernelFailure: null,
          measurementCoverage: {
            samplingCallsRecorded: 1,
            attentionCallsRecorded: 40,
            complete: true
          },
          timings: {
            deviceElapsedMs: null,
            kernelElapsedMs: null
          }
        }
      });

      const report = compareMinimaxH3Experiments({
        baselineDescriptor: baselineDesc,
        baselineResult,
        variantDescriptor: candidateDesc,
        variantResult: candidateResult
      });

      expect(report.metricEligibility.wallTimeEligible).toBe(false);
      expect(report.metricEligibility.samplingWallEligible).toBe(false);
      expect(report.metricEligibility.kernelTimeEligible).toBe(false);
      expect(report.metricEligibility.reasons.some((r) => r.includes("fallback"))).toBe(true);
      expect(report.metrics).toBeNull();
    });

    it("admits clean accelerated candidate against dense control baseline with matched runtime locks", () => {
      const baselineDesc = createTestDescriptorV2({
        runId: "base-dense-clean",
        attentionRequest: {
          attentionVariant: "dense",
          expectedBackend: "torch_sdpa",
          expectedKernel: "torch.nn.functional.scaled_dot_product_attention",
          topologyDigest: DUMMY_HASH_1,
          catalogDigest: DUMMY_HASH_1,
          patches: [],
          runtimeLockDigest: DUMMY_HASH_2,
          denseRegionPolicy: { allowPlannedDense: true, description: "policy" }
        }
      });
      const baselineResult = createCompletedResultV2(baselineDesc);

      const candidateDesc = createTestDescriptorV2({
        runId: "cand-sage-clean",
        attentionRequest: {
          attentionVariant: "sage",
          expectedBackend: "sage",
          expectedKernel: "sageattention.sageattn",
          topologyDigest: DUMMY_HASH_3,
          catalogDigest: DUMMY_HASH_3,
          patches: [],
          runtimeLockDigest: DUMMY_HASH_2,
          denseRegionPolicy: { allowPlannedDense: true, description: "policy" }
        }
      });
      const candidateResult = createCompletedResultV2(candidateDesc, {
        observedProvenance: {
          ...baselineResult.observedProvenance,
          observedAttentionBackend: {
            status: "verified",
            effectiveBackend: "sage",
            dispatchImplementation: "sageattention.sageattn"
          }
        },
        attentionObservation: {
          status: "verified",
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn",
          acceleratedCallCount: 40,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          failureReason: null,
          missingKernelFailure: null,
          measurementCoverage: {
            samplingCallsRecorded: 1,
            attentionCallsRecorded: 40,
            complete: true
          },
          timings: {
            deviceElapsedMs: null,
            kernelElapsedMs: null
          }
        }
      });

      const report = compareMinimaxH3Experiments({
        baselineDescriptor: baselineDesc,
        baselineResult,
        variantDescriptor: candidateDesc,
        variantResult: candidateResult
      });

      expect(report.structuralAdmission.eligible).toBe(true);
      expect(report.metricEligibility.wallTimeEligible).toBe(true);
      expect(report.metricEligibility.samplingWallEligible).toBe(true);
    });

    it("rejects attention comparison when runtimeLockDigest differs across pair", () => {
      const baselineDesc = createTestDescriptorV2({
        runId: "base-dense",
        attentionRequest: {
          attentionVariant: "dense",
          expectedBackend: "torch_sdpa",
          expectedKernel: "torch.nn.functional.scaled_dot_product_attention",
          topologyDigest: DUMMY_HASH_1,
          catalogDigest: DUMMY_HASH_1,
          patches: [],
          runtimeLockDigest: DUMMY_HASH_1,
          denseRegionPolicy: { allowPlannedDense: true, description: "policy" }
        }
      });
      const baselineResult = createCompletedResultV2(baselineDesc);

      const candidateDesc = createTestDescriptorV2({
        runId: "cand-sage",
        attentionRequest: {
          attentionVariant: "sage",
          expectedBackend: "sage",
          expectedKernel: "sageattention.sageattn",
          topologyDigest: DUMMY_HASH_2,
          catalogDigest: DUMMY_HASH_2,
          patches: [],
          runtimeLockDigest: DUMMY_HASH_3,
          denseRegionPolicy: { allowPlannedDense: true, description: "policy" }
        }
      });
      const candidateResult = createCompletedResultV2(candidateDesc);

      const report = compareMinimaxH3Experiments({
        baselineDescriptor: baselineDesc,
        baselineResult,
        variantDescriptor: candidateDesc,
        variantResult: candidateResult
      });

      expect(report.structuralAdmission.eligible).toBe(false);
      expect(
        report.structuralAdmission.reasons.some((r) => r.includes("Runtime lock digest mismatch"))
      ).toBe(true);
    });

    it("rejects attention comparison when coreRevision differs across pair", () => {
      const baseTemplate = createTestDescriptorV2();
      const baselineDesc = createTestDescriptorV2({
        runId: "base-dense-pinned",
        requiredRuntime: {
          ...baseTemplate.requiredRuntime,
          coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
        },
        attentionRequest: {
          attentionVariant: "dense",
          expectedBackend: "torch_sdpa",
          expectedKernel: "torch.nn.functional.scaled_dot_product_attention",
          topologyDigest: DUMMY_HASH_1,
          catalogDigest: DUMMY_HASH_1,
          patches: [],
          runtimeLockDigest: DUMMY_HASH_2,
          denseRegionPolicy: { allowPlannedDense: true, description: "policy" }
        }
      });
      const baselineResult = createCompletedResultV2(baselineDesc);

      const candidateDesc = createTestDescriptorV2({
        runId: "cand-sol-attn-upgraded",
        requiredRuntime: {
          ...baseTemplate.requiredRuntime,
          coreRevision: "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf"
        },
        attentionRequest: {
          attentionVariant: "native-sol-attn",
          expectedBackend: "sol_attn",
          expectedKernel: "sol_attn",
          topologyDigest: DUMMY_HASH_3,
          catalogDigest: DUMMY_HASH_3,
          patches: [],
          runtimeLockDigest: DUMMY_HASH_2,
          denseRegionPolicy: { allowPlannedDense: true, description: "policy" }
        }
      });
      const candidateResult = createCompletedResultV2(candidateDesc);

      const report = compareMinimaxH3Experiments({
        baselineDescriptor: baselineDesc,
        baselineResult,
        variantDescriptor: candidateDesc,
        variantResult: candidateResult
      });

      expect(report.structuralAdmission.eligible).toBe(false);
      expect(
        report.structuralAdmission.reasons.some((r) => r.includes("Core revision mismatch"))
      ).toBe(true);
    });

    it("disqualifies metrics when baseline has unverified attention observation", () => {
      const baselineDesc = createTestDescriptorV2({
        runId: "base-dense",
        attentionRequest: {
          attentionVariant: "dense",
          expectedBackend: "torch_sdpa",
          expectedKernel: "torch.nn.functional.scaled_dot_product_attention",
          topologyDigest: DUMMY_HASH_1,
          catalogDigest: DUMMY_HASH_1,
          patches: [],
          runtimeLockDigest: DUMMY_HASH_2,
          denseRegionPolicy: { allowPlannedDense: true, description: "policy" }
        }
      });
      const baselineResult = createCompletedResultV2(baselineDesc, {
        attentionObservation: {
          status: "unknown",
          actualBackend: null,
          dispatchImplementation: null,
          acceleratedCallCount: 0,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          failureReason: "No events",
          missingKernelFailure: null,
          measurementCoverage: {
            samplingCallsRecorded: 0,
            attentionCallsRecorded: 0,
            complete: false
          },
          timings: {
            deviceElapsedMs: null,
            kernelElapsedMs: null
          }
        }
      });

      const candidateDesc = createTestDescriptorV2({
        runId: "cand-sage-clean",
        attentionRequest: {
          attentionVariant: "sage",
          expectedBackend: "sage",
          expectedKernel: "sageattention.sageattn",
          topologyDigest: DUMMY_HASH_3,
          catalogDigest: DUMMY_HASH_3,
          patches: [],
          runtimeLockDigest: DUMMY_HASH_2,
          denseRegionPolicy: { allowPlannedDense: true, description: "policy" }
        }
      });
      const candidateResult = createCompletedResultV2(candidateDesc, {
        attentionObservation: {
          status: "verified",
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn",
          acceleratedCallCount: 40,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          failureReason: null,
          missingKernelFailure: null,
          measurementCoverage: {
            samplingCallsRecorded: 1,
            attentionCallsRecorded: 40,
            complete: true
          },
          timings: {
            deviceElapsedMs: null,
            kernelElapsedMs: null
          }
        }
      });

      const report = compareMinimaxH3Experiments({
        baselineDescriptor: baselineDesc,
        baselineResult,
        variantDescriptor: candidateDesc,
        variantResult: candidateResult
      });

      expect(report.structuralAdmission.eligible).toBe(true);
      expect(report.metricEligibility.wallTimeEligible).toBe(false);
      expect(
        report.metricEligibility.reasons.some((r) =>
          r.includes("Baseline dense control observation was not verified")
        )
      ).toBe(true);
    });

    it("disqualifies metrics when candidate experienced attention fallback", () => {
      const baselineDesc = createTestDescriptorV2({
        runId: "base-dense-valid",
        attentionRequest: {
          attentionVariant: "dense",
          expectedBackend: "torch_sdpa",
          expectedKernel: "torch.nn.functional.scaled_dot_product_attention",
          topologyDigest: DUMMY_HASH_1,
          catalogDigest: DUMMY_HASH_1,
          patches: [],
          runtimeLockDigest: DUMMY_HASH_2,
          denseRegionPolicy: { allowPlannedDense: true, description: "policy" }
        }
      });
      const baselineResult = createCompletedResultV2(baselineDesc, {
        attentionObservation: {
          status: "verified",
          actualBackend: "torch_sdpa",
          dispatchImplementation: "torch.nn.functional.scaled_dot_product_attention",
          acceleratedCallCount: 0,
          denseCallCount: 40,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          failureReason: null,
          missingKernelFailure: null,
          measurementCoverage: {
            samplingCallsRecorded: 1,
            attentionCallsRecorded: 40,
            complete: true
          },
          timings: { deviceElapsedMs: null, kernelElapsedMs: null }
        }
      });

      const candidateDesc = createTestDescriptorV2({
        runId: "cand-sage-fallback",
        attentionRequest: {
          attentionVariant: "sage",
          expectedBackend: "sage",
          expectedKernel: "sageattention.sageattn",
          topologyDigest: DUMMY_HASH_3,
          catalogDigest: DUMMY_HASH_3,
          patches: [],
          runtimeLockDigest: DUMMY_HASH_2,
          denseRegionPolicy: { allowPlannedDense: true, description: "policy" }
        }
      });
      const candidateResult = createCompletedResultV2(candidateDesc, {
        attentionObservation: {
          status: "fallback",
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn",
          acceleratedCallCount: 30,
          denseCallCount: 10,
          plannedDenseCallCount: 0,
          fallbackEvents: [
            {
              stepIndex: 5,
              layerIndex: 1,
              requestedBackend: "sage",
              fallbackBackend: "torch_sdpa",
              reason: "CUDA out of memory in Sage kernel",
              monotonicMs: 1000
            }
          ],
          failureReason: "attention_fallback_detected",
          missingKernelFailure: null,
          measurementCoverage: {
            samplingCallsRecorded: 1,
            attentionCallsRecorded: 40,
            complete: true
          },
          timings: { deviceElapsedMs: null, kernelElapsedMs: null }
        }
      });

      const report = compareMinimaxH3Experiments({
        baselineDescriptor: baselineDesc,
        baselineResult,
        variantDescriptor: candidateDesc,
        variantResult: candidateResult
      });

      expect(report.structuralAdmission.eligible).toBe(true);
      expect(report.metricEligibility.wallTimeEligible).toBe(false);
      expect(report.metricEligibility.samplingWallEligible).toBe(false);
      expect(report.metricEligibility.kernelTimeEligible).toBe(false);
      expect(report.metrics).toBeNull();
      expect(
        report.metricEligibility.reasons.some((r) => r.includes("experienced attention fallback"))
      ).toBe(true);
    });

    it("disqualifies metrics when candidate has missing kernel failure", () => {
      const baselineDesc = createTestDescriptorV2({
        runId: "base-dense-valid",
        attentionRequest: {
          attentionVariant: "dense",
          expectedBackend: "torch_sdpa",
          expectedKernel: "torch.nn.functional.scaled_dot_product_attention",
          topologyDigest: DUMMY_HASH_1,
          catalogDigest: DUMMY_HASH_1,
          patches: [],
          runtimeLockDigest: DUMMY_HASH_2,
          denseRegionPolicy: { allowPlannedDense: true, description: "policy" }
        }
      });
      const baselineResult = createCompletedResultV2(baselineDesc, {
        attentionObservation: {
          status: "verified",
          actualBackend: "torch_sdpa",
          dispatchImplementation: "torch.nn.functional.scaled_dot_product_attention",
          acceleratedCallCount: 0,
          denseCallCount: 40,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          failureReason: null,
          missingKernelFailure: null,
          measurementCoverage: {
            samplingCallsRecorded: 1,
            attentionCallsRecorded: 40,
            complete: true
          },
          timings: { deviceElapsedMs: null, kernelElapsedMs: null }
        }
      });

      const candidateDesc = createTestDescriptorV2({
        runId: "cand-sol-missing-kernel",
        attentionRequest: {
          attentionVariant: "native-sol-attn",
          expectedBackend: "sol_attn",
          expectedKernel: "sol_attn",
          topologyDigest: DUMMY_HASH_3,
          catalogDigest: DUMMY_HASH_3,
          patches: [],
          runtimeLockDigest: DUMMY_HASH_2,
          denseRegionPolicy: { allowPlannedDense: true, description: "policy" }
        }
      });
      const candidateResult = createCompletedResultV2(candidateDesc, {
        attentionObservation: {
          status: "failed",
          actualBackend: null,
          dispatchImplementation: null,
          acceleratedCallCount: 0,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          failureReason: "missing_kernel",
          missingKernelFailure: "sol_attn kernel not compiled",
          measurementCoverage: {
            samplingCallsRecorded: 0,
            attentionCallsRecorded: 0,
            complete: false
          },
          timings: { deviceElapsedMs: null, kernelElapsedMs: null }
        }
      });

      const report = compareMinimaxH3Experiments({
        baselineDescriptor: baselineDesc,
        baselineResult,
        variantDescriptor: candidateDesc,
        variantResult: candidateResult
      });

      expect(report.metricEligibility.wallTimeEligible).toBe(false);
      expect(report.metrics).toBeNull();
      expect(
        report.metricEligibility.reasons.some((r) => r.includes("missing kernel failure"))
      ).toBe(true);
    });

    it("disqualifies metrics when candidate observed dispatchImplementation does not match expectedKernel", () => {
      const baselineDesc = createTestDescriptorV2({
        runId: "base-dense-valid",
        attentionRequest: {
          attentionVariant: "dense",
          expectedBackend: "torch_sdpa",
          expectedKernel: "torch.nn.functional.scaled_dot_product_attention",
          topologyDigest: DUMMY_HASH_1,
          catalogDigest: DUMMY_HASH_1,
          patches: [],
          runtimeLockDigest: DUMMY_HASH_2,
          denseRegionPolicy: { allowPlannedDense: true, description: "policy" }
        }
      });
      const baselineResult = createCompletedResultV2(baselineDesc, {
        attentionObservation: {
          status: "verified",
          actualBackend: "torch_sdpa",
          dispatchImplementation: "torch.nn.functional.scaled_dot_product_attention",
          acceleratedCallCount: 0,
          denseCallCount: 40,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          failureReason: null,
          missingKernelFailure: null,
          measurementCoverage: {
            samplingCallsRecorded: 1,
            attentionCallsRecorded: 40,
            complete: true
          },
          timings: { deviceElapsedMs: null, kernelElapsedMs: null }
        }
      });

      const candidateDesc = createTestDescriptorV2({
        runId: "cand-sage-wrong-kernel",
        attentionRequest: {
          attentionVariant: "sage",
          expectedBackend: "sage",
          expectedKernel: "sageattention.sageattn",
          topologyDigest: DUMMY_HASH_3,
          catalogDigest: DUMMY_HASH_3,
          patches: [],
          runtimeLockDigest: DUMMY_HASH_2,
          denseRegionPolicy: { allowPlannedDense: true, description: "policy" }
        }
      });
      const candidateResult = createCompletedResultV2(candidateDesc, {
        attentionObservation: {
          status: "verified",
          actualBackend: "sage",
          dispatchImplementation: "unexpected.custom.kernel",
          acceleratedCallCount: 40,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          failureReason: null,
          missingKernelFailure: null,
          measurementCoverage: {
            samplingCallsRecorded: 1,
            attentionCallsRecorded: 40,
            complete: true
          },
          timings: { deviceElapsedMs: null, kernelElapsedMs: null }
        }
      });

      const report = compareMinimaxH3Experiments({
        baselineDescriptor: baselineDesc,
        baselineResult,
        variantDescriptor: candidateDesc,
        variantResult: candidateResult
      });

      expect(report.metricEligibility.wallTimeEligible).toBe(false);
      expect(report.metrics).toBeNull();
      expect(
        report.metricEligibility.reasons.some((r) =>
          r.includes("does not match requested expectedKernel")
        )
      ).toBe(true);
    });

    it("admits matched dense control vs SageAttention with identical runtimeLockDigest", () => {
      const sagePackages = [
        { name: "sageattention", version: "2.1.1", importModule: "sageattention" },
        { name: "torch", version: "2.5.1+cu124", importModule: "torch" }
      ];
      const sageRuntimeLock = computeAttentionRuntimeLockDigest({
        comfyuiCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        pythonPackages: sagePackages,
        cudaRequirement: ">=12.4",
        computeCapability: "sm_89"
      });

      const baselineDesc = createTestDescriptorV2({
        runId: "base-sage-matched-dense",
        requiredRuntime: {
          coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
          sourceFileHashes: {},
          requiredNodes: [{ name: "MiniMaxH3ImageToVideo" }],
          pythonPackages: sagePackages,
          pytorchBuild: "2.5.1+cu124",
          cudaBuild: "12.4",
          driverConstraints: [">=550.00"],
          attentionKernel: "torch_sdpa",
          instrumentationProtocol: "v2-jsonl",
          collectorDigest: DUMMY_HASH_1,
          hookManifestDigest: DUMMY_HASH_2,
          hooks: []
        },
        attentionRequest: {
          attentionVariant: "dense",
          expectedBackend: "torch_sdpa",
          expectedKernel: "torch.nn.functional.scaled_dot_product_attention",
          topologyDigest: DUMMY_HASH_1,
          catalogDigest: DUMMY_HASH_1,
          patches: [],
          runtimeLockDigest: sageRuntimeLock,
          denseRegionPolicy: { allowPlannedDense: true, description: "policy" }
        }
      });

      const baselineResult = createCompletedResultV2(baselineDesc, {
        attentionObservation: {
          status: "verified",
          actualBackend: "torch_sdpa",
          dispatchImplementation: "torch.nn.functional.scaled_dot_product_attention",
          acceleratedCallCount: 0,
          denseCallCount: 40,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          failureReason: null,
          missingKernelFailure: null,
          measurementCoverage: {
            samplingCallsRecorded: 1,
            attentionCallsRecorded: 40,
            complete: true
          },
          timings: { deviceElapsedMs: null, kernelElapsedMs: null }
        }
      });

      const candidateDesc = createTestDescriptorV2({
        runId: "cand-sage-matched",
        requiredRuntime: {
          coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
          sourceFileHashes: {},
          requiredNodes: [{ name: "MiniMaxH3ImageToVideo" }],
          pythonPackages: sagePackages,
          pytorchBuild: "2.5.1+cu124",
          cudaBuild: "12.4",
          driverConstraints: [">=550.00"],
          attentionKernel: "sageattention.sageattn",
          instrumentationProtocol: "v2-jsonl",
          collectorDigest: DUMMY_HASH_1,
          hookManifestDigest: DUMMY_HASH_2,
          hooks: []
        },
        attentionRequest: {
          attentionVariant: "sage",
          expectedBackend: "sage",
          expectedKernel: "sageattention.sageattn",
          topologyDigest: DUMMY_HASH_1,
          catalogDigest: DUMMY_HASH_3,
          patches: [],
          runtimeLockDigest: sageRuntimeLock,
          denseRegionPolicy: { allowPlannedDense: false, description: "policy" }
        }
      });

      const candidateResult = createCompletedResultV2(candidateDesc, {
        attentionObservation: {
          status: "verified",
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn",
          acceleratedCallCount: 40,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          failureReason: null,
          missingKernelFailure: null,
          measurementCoverage: {
            samplingCallsRecorded: 1,
            attentionCallsRecorded: 40,
            complete: true
          },
          timings: { deviceElapsedMs: null, kernelElapsedMs: null }
        }
      });

      const report = compareMinimaxH3Experiments({
        baselineDescriptor: baselineDesc,
        baselineResult,
        variantDescriptor: candidateDesc,
        variantResult: candidateResult
      });

      expect(report.structuralAdmission.eligible).toBe(true);
      expect(report.structuralAdmission.reasons).toHaveLength(0);
    });

    it("rejects comparison pair when baseline runtimeLockDigest does not match candidate runtimeLockDigest", () => {
      const pureTorchLock = computeAttentionRuntimeLockDigest({
        comfyuiCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        pythonPackages: [{ name: "torch", version: "2.5.1+cu124", importModule: "torch" }],
        cudaRequirement: ">=12.4",
        computeCapability: "sm_89"
      });
      const sageRuntimeLock = computeAttentionRuntimeLockDigest({
        comfyuiCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        pythonPackages: [
          { name: "sageattention", version: "2.1.1", importModule: "sageattention" },
          { name: "torch", version: "2.5.1+cu124", importModule: "torch" }
        ],
        cudaRequirement: ">=12.4",
        computeCapability: "sm_89"
      });

      const baselineDesc = createTestDescriptorV2({
        runId: "base-pure-torch-dense",
        attentionRequest: {
          attentionVariant: "dense",
          expectedBackend: "torch_sdpa",
          expectedKernel: "torch.nn.functional.scaled_dot_product_attention",
          topologyDigest: DUMMY_HASH_1,
          catalogDigest: DUMMY_HASH_1,
          patches: [],
          runtimeLockDigest: pureTorchLock,
          denseRegionPolicy: { allowPlannedDense: true, description: "policy" }
        }
      });
      const baselineResult = createCompletedResultV2(baselineDesc);

      const candidateDesc = createTestDescriptorV2({
        runId: "cand-sage-mismatched-lock",
        attentionRequest: {
          attentionVariant: "sage",
          expectedBackend: "sage",
          expectedKernel: "sageattention.sageattn",
          topologyDigest: DUMMY_HASH_1,
          catalogDigest: DUMMY_HASH_3,
          patches: [],
          runtimeLockDigest: sageRuntimeLock,
          denseRegionPolicy: { allowPlannedDense: false, description: "policy" }
        }
      });
      const candidateResult = createCompletedResultV2(candidateDesc);

      const report = compareMinimaxH3Experiments({
        baselineDescriptor: baselineDesc,
        baselineResult,
        variantDescriptor: candidateDesc,
        variantResult: candidateResult
      });

      expect(report.structuralAdmission.eligible).toBe(false);
      expect(
        report.structuralAdmission.reasons.some((r) =>
          r.includes("Runtime lock digest mismatch across attention comparison pair")
        )
      ).toBe(true);
    });
  });

  describe("Step-Reduction Sampling Recipe Controlled Pairs (Matched Pairs A, B, C)", () => {
    it("admits Matched Pair A: FL2VA 20-step baseline vs FL2VA Turbo 8-step", () => {
      const fl2vaRecipe = getSamplingRecipe("fl2va-turbo-8");
      const baselineDesc = createTestDescriptorV2({
        runId: "pair-a-baseline",
        route: "i2v",
        baseProfileKey: "MINIMAX_H3_720P_5S_I2V_V1",
        provenance: {
          ...createTestDescriptorV2().provenance,
          actualCheckpointHash: PINNED_H3_CHECKPOINTS.fl2va.sha256,
          samplerSettings: {
            sampler: "res_multistep",
            scheduler: "simple",
            steps: 20
          }
        },
        pinFileIdentities: {
          comfyuiCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
          minimaxH3Revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1",
          modelDigests: {
            diffusion: PINNED_H3_CHECKPOINTS.fl2va.sha256
          }
        }
      });
      const baselineResult = createCompletedResultV2(baselineDesc, {
        observedProvenance: {
          ...createCompletedResultV2(baselineDesc).observedProvenance,
          observedSampling: {
            status: "verified",
            completedSteps: 20,
            expectedSteps: 20,
            samplerName: "res_multistep",
            schedulerName: "simple"
          },
          observedConditioning: {
            status: "verified",
            nodeClass: "MiniMaxH3ImageToVideo",
            taskMode: "i2v",
            referenceCount: 1
          }
        }
      });

      const variantDesc = createTestDescriptorV2({
        runId: "pair-a-variant-turbo-8",
        route: "i2v",
        baseProfileKey: "MINIMAX_H3_720P_5S_I2V_V1",
        samplingRecipe: fl2vaRecipe,
        experimentVariant: {
          variantName: "fl2va-turbo-8",
          variantReason: "FL2VA Lightning 8-step step-reduction experiment",
          purpose: "performance",
          changedFactors: [
            {
              path: "sampling.settings",
              before: { sampler: "res_multistep", scheduler: "simple", steps: 20 },
              after: { sampler: "res_multistep", scheduler: "simple", steps: 8 },
              rationale: "FL2VA Lightning 8-step distillation"
            },
            {
              path: "models.auxiliary",
              before: [],
              after: [
                {
                  role: "lora",
                  name: fl2vaRecipe.lora!.filename,
                  hash: fl2vaRecipe.lora!.sha256,
                  strength: fl2vaRecipe.lora!.strengthModel,
                  order: 0
                }
              ],
              rationale: "FL2VA Lightning LoRA weights"
            }
          ]
        },
        provenance: {
          ...createTestDescriptorV2().provenance,
          actualCheckpointHash: PINNED_H3_CHECKPOINTS.fl2va.sha256,
          loadedModelHashes: {
            diffusion: PINNED_H3_CHECKPOINTS.fl2va.sha256,
            lora: fl2vaRecipe.lora!.sha256
          },
          samplerSettings: {
            sampler: "res_multistep",
            scheduler: "simple",
            steps: 8
          }
        }
      });

      const variantResult = createCompletedResultV2(variantDesc, {
        execution: {
          ...baselineResult.execution,
          latencyMs: 180000
        },
        phaseAccounting: {
          ...baselineResult.phaseAccounting,
          wholeAttemptWallMs: 180000,
          samplingWallTimeMs: 150000
        },
        observedProvenance: {
          ...createCompletedResultV2(variantDesc).observedProvenance,
          observedSampling: {
            status: "verified",
            completedSteps: 8,
            expectedSteps: 8,
            samplerName: "res_multistep",
            schedulerName: "simple"
          },
          observedConditioning: {
            status: "verified",
            nodeClass: "MiniMaxH3ImageToVideo",
            taskMode: "i2v",
            referenceCount: 1
          }
        }
      });

      const report = compareMinimaxH3Experiments({
        baselineDescriptor: baselineDesc,
        baselineResult,
        variantDescriptor: variantDesc,
        variantResult
      });

      expect(report.structuralAdmission.eligible).toBe(true);
      expect(report.structuralAdmission.reasons).toHaveLength(0);
      expect(report.metricEligibility.samplingWallEligible).toBe(true);
      expect(report.metricEligibility.wallTimeEligible).toBe(true);
      expect(report.metrics?.samplingWallTimeRatio).toBeCloseTo(150000 / 380000, 2);
    });

    it("disqualifies metrics for Matched Pair A if variant observed sampling has conflict", () => {
      const fl2vaRecipe = getSamplingRecipe("fl2va-turbo-8");
      const baselineDesc = createTestDescriptorV2({
        runId: "pair-a-base",
        route: "i2v",
        provenance: {
          ...createTestDescriptorV2().provenance,
          actualCheckpointHash: PINNED_H3_CHECKPOINTS.fl2va.sha256
        }
      });
      const baselineResult = createCompletedResultV2(baselineDesc);

      const variantDesc = createTestDescriptorV2({
        runId: "pair-a-conflict",
        route: "i2v",
        samplingRecipe: fl2vaRecipe,
        experimentVariant: {
          variantName: "fl2va-turbo-8",
          variantReason: "FL2VA Lightning 8-step step-reduction experiment",
          purpose: "performance",
          changedFactors: [
            {
              path: "sampling.settings",
              before: { sampler: "res_multistep", scheduler: "simple", steps: 20 },
              after: { sampler: "res_multistep", scheduler: "simple", steps: 8 },
              rationale: "FL2VA Lightning 8-step distillation"
            },
            {
              path: "models.auxiliary",
              before: [],
              after: [
                {
                  role: "lora",
                  name: fl2vaRecipe.lora!.filename,
                  hash: fl2vaRecipe.lora!.sha256,
                  strength: fl2vaRecipe.lora!.strengthModel,
                  order: 0
                }
              ],
              rationale: "FL2VA Lightning LoRA weights"
            }
          ]
        },
        provenance: {
          ...createTestDescriptorV2().provenance,
          actualCheckpointHash: PINNED_H3_CHECKPOINTS.fl2va.sha256,
          loadedModelHashes: {
            diffusion: PINNED_H3_CHECKPOINTS.fl2va.sha256,
            lora: fl2vaRecipe.lora!.sha256
          },
          samplerSettings: {
            sampler: "res_multistep",
            scheduler: "simple",
            steps: 8
          }
        }
      });

      const variantResult = createCompletedResultV2(variantDesc, {
        observedProvenance: {
          ...createCompletedResultV2(variantDesc).observedProvenance,
          observedSampling: {
            status: "conflict",
            completedSteps: 7,
            expectedSteps: 8,
            unknownReason: "step_mismatch"
          },
          observedConditioning: {
            status: "verified",
            nodeClass: "MiniMaxH3ImageToVideo",
            taskMode: "i2v",
            referenceCount: 1
          },
          conflicts: ["Observed steps 7 does not match expected steps 8"]
        }
      });

      const report = compareMinimaxH3Experiments({
        baselineDescriptor: baselineDesc,
        baselineResult,
        variantDescriptor: variantDesc,
        variantResult
      });

      expect(report.metricEligibility.samplingWallEligible).toBe(false);
      expect(
        report.metricEligibility.reasons.some((r) =>
          r.includes("Variant observed sampling was not verified")
        )
      ).toBe(true);
    });

    it("admits Matched Pair B: Ref2VA 20-step baseline vs Ref2VA Turbo 4-step", () => {
      const ref2vaRecipe = getSamplingRecipe("ref2va-turbo-4");
      const baselineDesc = createTestDescriptorV2({
        runId: "pair-b-baseline",
        route: "ref2v",
        baseProfileKey: "MINIMAX_H3_720P_5S_REF2V_V1",
        provenance: {
          ...createTestDescriptorV2().provenance,
          actualCheckpointHash: PINNED_H3_CHECKPOINTS.ref2va.sha256,
          samplerSettings: {
            sampler: "res_multistep",
            scheduler: "simple",
            steps: 20
          }
        }
      });
      const baselineResult = createCompletedResultV2(baselineDesc);

      const variantDesc = createTestDescriptorV2({
        runId: "pair-b-variant-turbo-4",
        route: "ref2v",
        baseProfileKey: "MINIMAX_H3_720P_5S_REF2V_V1",
        samplingRecipe: ref2vaRecipe,
        experimentVariant: {
          variantName: "ref2va-turbo-4",
          variantReason: "Ref2VA Turbo 4-step step-reduction experiment",
          purpose: "performance",
          changedFactors: [
            {
              path: "sampling.settings",
              before: { sampler: "res_multistep", scheduler: "simple", steps: 20 },
              after: { sampler: "res_multistep", scheduler: "simple", steps: 4 },
              rationale: "Ref2VA Turbo 4-step distillation"
            },
            {
              path: "models.auxiliary",
              before: [],
              after: [
                {
                  role: "lora",
                  name: ref2vaRecipe.lora!.filename,
                  hash: ref2vaRecipe.lora!.sha256,
                  strength: ref2vaRecipe.lora!.strengthModel,
                  order: 0
                }
              ],
              rationale: "Ref2VA Turbo LoRA weights"
            }
          ]
        },
        provenance: {
          ...createTestDescriptorV2().provenance,
          actualCheckpointHash: PINNED_H3_CHECKPOINTS.ref2va.sha256,
          loadedModelHashes: {
            diffusion: PINNED_H3_CHECKPOINTS.ref2va.sha256,
            lora: ref2vaRecipe.lora!.sha256
          },
          samplerSettings: {
            sampler: "res_multistep",
            scheduler: "simple",
            steps: 4
          }
        }
      });

      const variantResult = createCompletedResultV2(variantDesc, {
        phaseAccounting: {
          ...baselineResult.phaseAccounting,
          wholeAttemptWallMs: 120000,
          samplingWallTimeMs: 90000
        },
        observedProvenance: {
          ...createCompletedResultV2(variantDesc).observedProvenance,
          observedSampling: {
            status: "verified",
            completedSteps: 4,
            expectedSteps: 4,
            samplerName: "res_multistep",
            schedulerName: "simple"
          },
          observedConditioning: {
            status: "verified",
            nodeClass: "MiniMaxH3ReferenceToVideo",
            taskMode: "ref2v",
            referenceCount: 1
          }
        }
      });

      const report = compareMinimaxH3Experiments({
        baselineDescriptor: baselineDesc,
        baselineResult,
        variantDescriptor: variantDesc,
        variantResult
      });

      expect(report.structuralAdmission.eligible).toBe(true);
      expect(report.structuralAdmission.reasons).toHaveLength(0);
      expect(report.metricEligibility.samplingWallEligible).toBe(true);
    });

    it("admits Matched Pair C: FL2VA 20-step baseline vs FastH3 8-step with controlled multifactor", () => {
      const fastH3Recipe = getSamplingRecipe("fasth3-i2v-8");
      const baselineDesc = createTestDescriptorV2({
        runId: "pair-c-fl2va-baseline",
        route: "i2v",
        baseProfileKey: "MINIMAX_H3_720P_5S_I2V_V1",
        provenance: {
          ...createTestDescriptorV2().provenance,
          actualCheckpointHash: PINNED_H3_CHECKPOINTS.fl2va.sha256,
          requestedAttentionBackend: "default",
          samplerSettings: {
            sampler: "res_multistep",
            scheduler: "simple",
            steps: 20
          },
          comfyuiCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
        }
      });
      const baselineResult = createCompletedResultV2(baselineDesc);

      const variantDesc = createTestDescriptorV2({
        runId: "pair-c-fasth3-variant",
        route: "i2v",
        baseProfileKey: "MINIMAX_H3_720P_5S_I2V_V1",
        samplingRecipe: fastH3Recipe,
        experimentVariant: {
          variantName: "fasth3-i2v-8",
          variantReason: "FastH3 8-step distilled checkpoint comparator",
          purpose: "controlled_multifactor",
          changedFactors: [
            {
              path: "models.diffusion",
              before: {
                repository: "Comfy-Org/MiniMax-H3",
                revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1",
                filename: PINNED_H3_CHECKPOINTS.fl2va.filename,
                fileHash: PINNED_H3_CHECKPOINTS.fl2va.sha256,
                taskMode: "fl2va",
                licenseSourceRef: "https://huggingface.co/Comfy-Org/MiniMax-H3"
              },
              after: {
                repository: fastH3Recipe.diffusionModel.repository,
                revision: fastH3Recipe.diffusionModel.revision,
                filename: fastH3Recipe.diffusionModel.filename,
                fileHash: fastH3Recipe.diffusionModel.sha256,
                taskMode: fastH3Recipe.taskFamily,
                licenseSourceRef: fastH3Recipe.licensing.licenseSourceRef
              },
              rationale: "FastH3 8-step distilled checkpoint"
            },
            {
              path: "sampling.settings",
              before: { sampler: "res_multistep", scheduler: "simple", steps: 20 },
              after: { sampler: "euler", scheduler: "simple", steps: 8 },
              rationale: "Euler 8-step distilled sampling"
            },
            {
              path: "sampling.sigmaShift",
              before: { enabled: false, videoShift: 12.0, audioShift: 3.0 },
              after: {
                enabled: fastH3Recipe.sigmaShift!.enabled,
                videoShift: fastH3Recipe.sigmaShift!.videoShift,
                audioShift: fastH3Recipe.sigmaShift!.audioShift
              },
              rationale: "FastH3 sigma shift"
            },
            {
              path: "attention.configuration",
              before: { backend: "torch_sdpa", topologyDigest: DUMMY_HASH_1, patches: [] },
              after: {
                backend: fastH3Recipe.attentionTopology!.backend,
                topologyDigest: fastH3Recipe.attentionTopology!.topologyDigest,
                patches: []
              },
              rationale: "FastH3 VSA block sparse attention"
            },
            {
              path: "runtime.manifest",
              before: {
                runtimeManifestDigest: baselineDesc.compatibility.relativeToRuntimeManifestDigest,
                hookManifestDigest: DUMMY_HASH_3
              },
              after: {
                runtimeManifestDigest: DUMMY_HASH_4,
                hookManifestDigest: DUMMY_HASH_3
              },
              rationale: "FastH3 isolated ComfyUI core revision ee71d5c4"
            }
          ]
        },
        provenance: {
          ...createTestDescriptorV2().provenance,
          actualCheckpointHash: fastH3Recipe.diffusionModel.sha256,
          loadedModelHashes: {
            diffusion: fastH3Recipe.diffusionModel.sha256
          },
          requestedAttentionBackend: fastH3Recipe.attentionTopology!.backend,
          comfyuiCoreRevision: FASTH3_ISOLATED_CORE_REVISION,
          samplerSettings: {
            sampler: "euler",
            scheduler: "simple",
            steps: 8
          }
        },
        compatibility: {
          ...createTestDescriptorV2().compatibility,
          relativeToRuntimeManifestDigest: DUMMY_HASH_4
        },
        requiredRuntime: {
          ...createTestDescriptorV2().requiredRuntime,
          coreRevision: FASTH3_ISOLATED_CORE_REVISION
        }
      });

      const variantResult = createCompletedResultV2(variantDesc, {
        phaseAccounting: {
          ...baselineResult.phaseAccounting,
          wholeAttemptWallMs: 140000,
          samplingWallTimeMs: 110000
        },
        attentionObservation: {
          status: "verified",
          actualBackend: "vsa",
          dispatchImplementation: "block_sparse_attention",
          acceleratedCallCount: 16,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          failureReason: null,
          missingKernelFailure: null,
          measurementCoverage: {
            samplingCallsRecorded: 1,
            attentionCallsRecorded: 16,
            complete: true
          },
          timings: {
            deviceElapsedMs: null,
            kernelElapsedMs: null
          }
        },
        observedProvenance: {
          ...createCompletedResultV2(variantDesc).observedProvenance,
          observedSampling: {
            status: "verified",
            completedSteps: 8,
            expectedSteps: 8,
            samplerName: "euler",
            schedulerName: "simple"
          },
          observedConditioning: {
            status: "verified",
            nodeClass: "MiniMaxH3ImageToVideo",
            taskMode: "i2v",
            referenceCount: 1
          },
          observedAttentionBackend: {
            status: "verified",
            effectiveBackend: "vsa",
            dispatchImplementation: "block_sparse_attention"
          }
        }
      });

      const report = compareMinimaxH3Experiments({
        baselineDescriptor: baselineDesc,
        baselineResult,
        variantDescriptor: variantDesc,
        variantResult
      });

      expect(report.structuralAdmission.eligible).toBe(true);
      expect(report.structuralAdmission.reasons).toHaveLength(0);
      expect(report.metricEligibility.samplingWallEligible).toBe(true);
      expect(report.metrics?.samplingWallTimeRatio).toBeCloseTo(110000 / 380000, 2);
    });

    it("disqualifies metrics for Matched Pair C when observed attention backend is not verified", () => {
      const fastH3Recipe = getSamplingRecipe("fasth3-i2v-8");
      const baselineDesc = createTestDescriptorV2({
        runId: "pair-c-base",
        route: "i2v",
        provenance: {
          ...createTestDescriptorV2().provenance,
          actualCheckpointHash: PINNED_H3_CHECKPOINTS.fl2va.sha256
        }
      });
      const baselineResult = createCompletedResultV2(baselineDesc);

      const variantDesc = createTestDescriptorV2({
        runId: "pair-c-att-unverified",
        route: "i2v",
        samplingRecipe: fastH3Recipe,
        experimentVariant: {
          variantName: "fasth3-i2v-8",
          variantReason: "FastH3 8-step distilled checkpoint comparator",
          purpose: "controlled_multifactor",
          changedFactors: [
            {
              path: "models.diffusion",
              before: {
                repository: "Comfy-Org/MiniMax-H3",
                revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1",
                filename: PINNED_H3_CHECKPOINTS.fl2va.filename,
                fileHash: PINNED_H3_CHECKPOINTS.fl2va.sha256,
                taskMode: "fl2va",
                licenseSourceRef: "https://huggingface.co/Comfy-Org/MiniMax-H3"
              },
              after: {
                repository: fastH3Recipe.diffusionModel.repository,
                revision: fastH3Recipe.diffusionModel.revision,
                filename: fastH3Recipe.diffusionModel.filename,
                fileHash: fastH3Recipe.diffusionModel.sha256,
                taskMode: fastH3Recipe.taskFamily,
                licenseSourceRef: fastH3Recipe.licensing.licenseSourceRef
              },
              rationale: "FastH3 8-step distilled checkpoint"
            },
            {
              path: "sampling.settings",
              before: { sampler: "res_multistep", scheduler: "simple", steps: 20 },
              after: { sampler: "euler", scheduler: "simple", steps: 8 },
              rationale: "Euler 8-step distilled sampling"
            },
            {
              path: "sampling.sigmaShift",
              before: { enabled: false, videoShift: 12.0, audioShift: 3.0 },
              after: {
                enabled: fastH3Recipe.sigmaShift!.enabled,
                videoShift: fastH3Recipe.sigmaShift!.videoShift,
                audioShift: fastH3Recipe.sigmaShift!.audioShift
              },
              rationale: "FastH3 sigma shift"
            },
            {
              path: "attention.configuration",
              before: { backend: "torch_sdpa", topologyDigest: DUMMY_HASH_1, patches: [] },
              after: {
                backend: fastH3Recipe.attentionTopology!.backend,
                topologyDigest: fastH3Recipe.attentionTopology!.topologyDigest,
                patches: []
              },
              rationale: "FastH3 VSA block sparse attention"
            },
            {
              path: "runtime.manifest",
              before: {
                runtimeManifestDigest: baselineDesc.compatibility.relativeToRuntimeManifestDigest,
                hookManifestDigest: DUMMY_HASH_3
              },
              after: {
                runtimeManifestDigest: DUMMY_HASH_4,
                hookManifestDigest: DUMMY_HASH_3
              },
              rationale: "FastH3 isolated ComfyUI core revision ee71d5c4"
            }
          ]
        },
        provenance: {
          ...createTestDescriptorV2().provenance,
          actualCheckpointHash: fastH3Recipe.diffusionModel.sha256,
          loadedModelHashes: {
            diffusion: fastH3Recipe.diffusionModel.sha256
          },
          requestedAttentionBackend: fastH3Recipe.attentionTopology!.backend,
          comfyuiCoreRevision: FASTH3_ISOLATED_CORE_REVISION,
          samplerSettings: {
            sampler: "euler",
            scheduler: "simple",
            steps: 8
          }
        },
        compatibility: {
          ...createTestDescriptorV2().compatibility,
          relativeToRuntimeManifestDigest: DUMMY_HASH_4
        },
        requiredRuntime: {
          ...createTestDescriptorV2().requiredRuntime,
          coreRevision: FASTH3_ISOLATED_CORE_REVISION
        }
      });

      const variantResult = createCompletedResultV2(variantDesc, {
        attentionObservation: {
          status: "failed",
          actualBackend: null,
          dispatchImplementation: null,
          acceleratedCallCount: 0,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          failureReason: "Kernel missing",
          missingKernelFailure: "VSA kernel not installed",
          measurementCoverage: {
            samplingCallsRecorded: 1,
            attentionCallsRecorded: 0,
            complete: false
          },
          timings: {
            deviceElapsedMs: null,
            kernelElapsedMs: null
          }
        },
        observedProvenance: {
          ...createCompletedResultV2(variantDesc).observedProvenance,
          observedSampling: {
            status: "verified",
            completedSteps: 8,
            expectedSteps: 8
          },
          observedConditioning: {
            status: "verified",
            nodeClass: "MiniMaxH3ImageToVideo",
            taskMode: "i2v"
          },
          observedAttentionBackend: {
            status: "unknown",
            effectiveBackend: null,
            dispatchImplementation: null
          }
        }
      });

      const report = compareMinimaxH3Experiments({
        baselineDescriptor: baselineDesc,
        baselineResult,
        variantDescriptor: variantDesc,
        variantResult
      });

      expect(report.metricEligibility.samplingWallEligible).toBe(false);
      expect(
        report.metricEligibility.reasons.some((r) =>
          r.includes("Variant observed attention backend was not verified")
        )
      ).toBe(true);
    });
  });
});

class InMemoryStore implements MinimaxH3ExperimentStorePort {
  public files = new Map<string, string>();
  public staged = new Map<string, string>();
  public descriptor: MinimaxH3AnyExperimentDescriptor | null = null;
  public config: Record<string, unknown> | null = null;
  public inputManifest: unknown = null;
  public measurementTemplate: MinimaxH3AnyExperimentResult | null = null;
  public intent: MinimaxH3ExperimentIntent | null = null;
  public receipt: MinimaxH3ExperimentReceipt | null = null;
  public events: MinimaxH3ExperimentEvent[] = [];
  public telemetry: MinimaxH3TelemetrySample[] = [];
  public result: MinimaxH3AnyExperimentResult | null = null;
  public phaseEvents: MinimaxH3PhaseAccountingEvent[] = [];
  public processRecord: MinimaxH3ProcessRecord | null = null;
  public terminalEvidence: MinimaxH3TerminalEvidence | null = null;

  async createRunDirectory(_runDir: string): Promise<void> {}
  async ensureRunSubdirectories(_runDir: string): Promise<void> {}
  async writeDescriptor(_runDir: string, d: MinimaxH3AnyExperimentDescriptor): Promise<void> {
    this.descriptor = d;
  }
  async readDescriptor(_runDir: string): Promise<MinimaxH3AnyExperimentDescriptor> {
    if (!this.descriptor) throw new Error("Descriptor not found");
    return this.descriptor;
  }
  async writeConfig(_runDir: string, c: Record<string, unknown>): Promise<string> {
    this.config = c;
    return sha256Hex(JSON.stringify(c));
  }
  async readConfig(_runDir: string): Promise<Record<string, unknown>> {
    if (!this.config) throw new Error("Config not found");
    return this.config;
  }
  async writeInputManifest(_runDir: string, m: unknown): Promise<void> {
    this.inputManifest = m;
  }
  async readInputManifest(_runDir: string): Promise<unknown> {
    return this.inputManifest;
  }
  async writeMeasurementTemplate(_runDir: string, t: MinimaxH3AnyExperimentResult): Promise<void> {
    this.measurementTemplate = t;
  }
  async readMeasurementTemplate(_runDir: string): Promise<MinimaxH3AnyExperimentResult | null> {
    return this.measurementTemplate;
  }
  async writeIntent(_runDir: string, i: MinimaxH3ExperimentIntent): Promise<void> {
    this.intent = i;
  }
  async readIntent(_runDir: string): Promise<MinimaxH3ExperimentIntent | null> {
    return this.intent;
  }
  async writeReceipt(_runDir: string, r: MinimaxH3ExperimentReceipt): Promise<void> {
    this.receipt = r;
  }
  async readReceipt(_runDir: string): Promise<MinimaxH3ExperimentReceipt | null> {
    return this.receipt;
  }
  async appendEvent(_runDir: string, e: MinimaxH3ExperimentEvent): Promise<void> {
    this.events.push(e);
  }
  async readEvents(_runDir: string): Promise<MinimaxH3ExperimentEvent[]> {
    return this.events;
  }
  async appendPhaseEvent(_runDir: string, e: MinimaxH3PhaseAccountingEvent): Promise<void> {
    this.phaseEvents.push(e);
  }
  async readPhaseEvents(_runDir: string): Promise<MinimaxH3PhaseAccountingEvent[]> {
    return this.phaseEvents;
  }
  async appendTelemetry(_runDir: string, s: MinimaxH3TelemetrySample): Promise<void> {
    this.telemetry.push(s);
  }
  async readTelemetry(_runDir: string): Promise<MinimaxH3TelemetrySample[]> {
    return this.telemetry;
  }
  async writeResult(_runDir: string, r: MinimaxH3AnyExperimentResult): Promise<void> {
    this.result = r;
  }
  async readResult(_runDir: string): Promise<MinimaxH3AnyExperimentResult | null> {
    return this.result;
  }
  async writeProcessRecord(_runDir: string, r: MinimaxH3ProcessRecord): Promise<void> {
    this.processRecord = r;
  }
  async readProcessRecord(_runDir: string): Promise<MinimaxH3ProcessRecord | null> {
    return this.processRecord;
  }
  async writeTerminalEvidence(_runDir: string, e: MinimaxH3TerminalEvidence): Promise<void> {
    this.terminalEvidence = e;
  }
  async readTerminalEvidence(_runDir: string): Promise<MinimaxH3TerminalEvidence | null> {
    return this.terminalEvidence;
  }
  verifyContainment(targetPath: string, rootDir: string): boolean {
    return targetPath.startsWith(rootDir);
  }
  async stageInputFile(sourcePath: string, destPath: string): Promise<void> {
    this.staged.set(destPath, sourcePath);
  }
  async hashFile(_filePath: string): Promise<{ sha256: string; sizeBytes: number }> {
    return { sha256: "0".repeat(64), sizeBytes: 1024 };
  }
  async inspectAsset(
    _filePath: string
  ): Promise<{ width: number; height: number; mimeType: string }> {
    return { width: 1344, height: 768, mimeType: "image/png" };
  }
  async readJsonFile<T = unknown>(filePath: string): Promise<T> {
    const content =
      this.files.get(filePath) ??
      this.files.get(basename(filePath)) ??
      this.files.get(`templates/${basename(filePath)}`);
    if (!content) throw new Error(`File not found: ${filePath}`);
    return JSON.parse(content) as T;
  }
  async readTextFile(filePath: string): Promise<string> {
    const content =
      this.files.get(filePath) ??
      this.files.get(basename(filePath)) ??
      this.files.get(`templates/${basename(filePath)}`);
    if (!content) throw new Error(`File not found: ${filePath}`);
    return content;
  }
  async writeTextFile(filePath: string, content: string): Promise<void> {
    this.files.set(filePath, content);
  }
  async writeDurableJson(filePath: string, content: unknown): Promise<void> {
    this.files.set(filePath, JSON.stringify(content));
  }
  async deleteRunFiles(_runDir: string, _removeOutputs?: boolean): Promise<void> {}
}

function setupServiceWithTemplates(): MinimaxH3ExperimentService {
  const store = new InMemoryStore();
  store.files.set(
    "templates/minimax_h3_720p_i2v_124f_api.json",
    readFileSync("templates/minimax_h3_720p_i2v_124f_api.json", "utf-8")
  );
  store.files.set(
    "templates/minimax_h3_720p_ref2v_124f_api.json",
    readFileSync("templates/minimax_h3_720p_ref2v_124f_api.json", "utf-8")
  );
  store.files.set("templates/provenance.json", readFileSync("templates/provenance.json", "utf-8"));
  store.files.set(
    "manifest-i2v.json",
    JSON.stringify({
      referenceSetId: "ref-set-i2v",
      references: [
        {
          assetPath: "/tmp/ref1.png",
          stagedFilename: "ref1.png",
          role: "first_frame",
          tag: "<Picture 1>",
          order: 0
        }
      ]
    })
  );
  store.files.set(
    "manifest-ref2v.json",
    JSON.stringify({
      referenceSetId: "ref-set-ref2v",
      references: [
        {
          assetPath: "/tmp/ref1.png",
          stagedFilename: "ref1.png",
          role: "reference",
          tag: "<Picture 1>",
          order: 0
        }
      ]
    })
  );
  return new MinimaxH3ExperimentService(store);
}

describe("Service-generated Matched Pairs Admission and Comparison", () => {
  it("admits service-generated Matched Pair A: FL2VA 20-step baseline vs FL2VA Turbo 8-step", async () => {
    const service = setupServiceWithTemplates();
    const prompt = "A cinematic shot of a sunset over the ocean";

    const { descriptor: baseDesc } = await service.prepareExperiment({
      route: "i2v",
      frames: 124,
      seed: 42,
      prompt,
      operatorLabel: "operator",
      runId: "pair-a-service-base",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      checkpointOverride: "fl2va",
      inputManifestPath: "manifest-i2v.json"
    });

    const { descriptor: varDesc } = await service.prepareExperiment({
      route: "i2v",
      frames: 124,
      seed: 42,
      prompt,
      operatorLabel: "operator",
      runId: "pair-a-service-var",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      samplingRecipe: "fl2va-turbo-8",
      inputManifestPath: "manifest-i2v.json"
    });

    const baseResult = createCompletedResultV2(baseDesc as MinimaxH3ExperimentDescriptorV2, {
      phaseAccounting: {
        ...createCompletedResultV2(baseDesc as MinimaxH3ExperimentDescriptorV2).phaseAccounting,
        status: "complete",
        wholeAttemptWallMs: 380000,
        samplingWallTimeMs: 350000,
        gpuKernelTimeMs: null
      },
      observedProvenance: {
        ...createCompletedResultV2(baseDesc as MinimaxH3ExperimentDescriptorV2).observedProvenance,
        observedSampling: {
          status: "verified",
          completedSteps: 20,
          expectedSteps: 20,
          samplerName: "res_multistep",
          schedulerName: "simple"
        },
        observedConditioning: {
          status: "verified",
          nodeClass: "MiniMaxH3ImageToVideo",
          taskMode: "i2v",
          referenceCount: 1
        }
      }
    });

    const varResult = createCompletedResultV2(varDesc as MinimaxH3ExperimentDescriptorV2, {
      phaseAccounting: {
        ...createCompletedResultV2(varDesc as MinimaxH3ExperimentDescriptorV2).phaseAccounting,
        status: "complete",
        wholeAttemptWallMs: 160000,
        samplingWallTimeMs: 140000,
        gpuKernelTimeMs: null
      },
      observedProvenance: {
        ...createCompletedResultV2(varDesc as MinimaxH3ExperimentDescriptorV2).observedProvenance,
        observedSampling: {
          status: "verified",
          completedSteps: 8,
          expectedSteps: 8,
          samplerName: "res_multistep",
          schedulerName: "simple"
        },
        observedConditioning: {
          status: "verified",
          nodeClass: "MiniMaxH3ImageToVideo",
          taskMode: "i2v",
          referenceCount: 1
        }
      }
    });

    const report = compareMinimaxH3Experiments({
      baselineDescriptor: baseDesc,
      baselineResult: baseResult,
      variantDescriptor: varDesc,
      variantResult: varResult
    });

    expect(report.structuralAdmission.eligible).toBe(true);
    expect(report.structuralAdmission.reasons).toHaveLength(0);
    expect(report.metricEligibility.samplingWallEligible).toBe(true);
    expect(report.metrics?.samplingWallTimeRatio).toBeCloseTo(140000 / 350000, 2);
  });

  it("admits service-generated Matched Pair B: Ref2VA 20-step baseline vs Ref2VA Turbo 4-step", async () => {
    const service = setupServiceWithTemplates();
    const prompt = "A cinematic shot of a sunset over the ocean <Picture 1>";

    const { descriptor: baseDesc } = await service.prepareExperiment({
      route: "ref2v",
      schemaVersion: 2,
      frames: 124,
      seed: 42,
      prompt,
      operatorLabel: "operator",
      runId: "pair-b-service-base",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      inputManifestPath: "manifest-ref2v.json"
    });

    const { descriptor: varDesc } = await service.prepareExperiment({
      route: "ref2v",
      frames: 124,
      seed: 42,
      prompt,
      operatorLabel: "operator",
      runId: "pair-b-service-var",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      samplingRecipe: "ref2va-turbo-4",
      inputManifestPath: "manifest-ref2v.json"
    });

    const baseResult = createCompletedResultV2(baseDesc as MinimaxH3ExperimentDescriptorV2, {
      phaseAccounting: {
        ...createCompletedResultV2(baseDesc as MinimaxH3ExperimentDescriptorV2).phaseAccounting,
        status: "complete",
        wholeAttemptWallMs: 400000,
        samplingWallTimeMs: 370000,
        gpuKernelTimeMs: null
      },
      observedProvenance: {
        ...createCompletedResultV2(baseDesc as MinimaxH3ExperimentDescriptorV2).observedProvenance,
        observedSampling: {
          status: "verified",
          completedSteps: 20,
          expectedSteps: 20,
          samplerName: "res_multistep",
          schedulerName: "simple"
        },
        observedConditioning: {
          status: "verified",
          nodeClass: "MiniMaxH3ReferenceToVideo",
          taskMode: "ref2v",
          referenceCount: 1
        }
      }
    });

    const varResult = createCompletedResultV2(varDesc as MinimaxH3ExperimentDescriptorV2, {
      phaseAccounting: {
        ...createCompletedResultV2(varDesc as MinimaxH3ExperimentDescriptorV2).phaseAccounting,
        status: "complete",
        wholeAttemptWallMs: 110000,
        samplingWallTimeMs: 90000,
        gpuKernelTimeMs: null
      },
      observedProvenance: {
        ...createCompletedResultV2(varDesc as MinimaxH3ExperimentDescriptorV2).observedProvenance,
        observedSampling: {
          status: "verified",
          completedSteps: 4,
          expectedSteps: 4,
          samplerName: "res_multistep",
          schedulerName: "simple"
        },
        observedConditioning: {
          status: "verified",
          nodeClass: "MiniMaxH3ReferenceToVideo",
          taskMode: "ref2v",
          referenceCount: 1
        }
      }
    });

    const report = compareMinimaxH3Experiments({
      baselineDescriptor: baseDesc,
      baselineResult: baseResult,
      variantDescriptor: varDesc,
      variantResult: varResult
    });

    expect(report.structuralAdmission.eligible).toBe(true);
    expect(report.structuralAdmission.reasons).toHaveLength(0);
    expect(report.metricEligibility.samplingWallEligible).toBe(true);
    expect(report.metrics?.samplingWallTimeRatio).toBeCloseTo(90000 / 370000, 2);
  });

  it("admits service-generated Matched Pair C: FL2VA 20-step baseline vs FastH3 8-step", async () => {
    const service = setupServiceWithTemplates();
    const prompt = "A cinematic shot of a sunset over the ocean";

    const { descriptor: baseDesc } = await service.prepareExperiment({
      route: "i2v",
      frames: 124,
      seed: 42,
      prompt,
      operatorLabel: "operator",
      runId: "pair-c-service-base",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      checkpointOverride: "fl2va",
      inputManifestPath: "manifest-i2v.json"
    });

    const { descriptor: varDesc } = await service.prepareExperiment({
      route: "i2v",
      frames: 124,
      seed: 42,
      prompt,
      operatorLabel: "operator",
      runId: "pair-c-service-var",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui-fasth3",
      pythonPath: "/usr/bin/python3",
      samplingRecipe: "fasth3-i2v-8",
      inputManifestPath: "manifest-i2v.json"
    });

    const baseResult = createCompletedResultV2(baseDesc as MinimaxH3ExperimentDescriptorV2, {
      phaseAccounting: {
        ...createCompletedResultV2(baseDesc as MinimaxH3ExperimentDescriptorV2).phaseAccounting,
        status: "complete",
        wholeAttemptWallMs: 380000,
        samplingWallTimeMs: 350000,
        gpuKernelTimeMs: null
      },
      observedProvenance: {
        ...createCompletedResultV2(baseDesc as MinimaxH3ExperimentDescriptorV2).observedProvenance,
        observedSampling: {
          status: "verified",
          completedSteps: 20,
          expectedSteps: 20,
          samplerName: "res_multistep",
          schedulerName: "simple"
        },
        observedConditioning: {
          status: "verified",
          nodeClass: "MiniMaxH3ImageToVideo",
          taskMode: "i2v",
          referenceCount: 1
        }
      }
    });

    const varResult = createCompletedResultV2(varDesc as MinimaxH3ExperimentDescriptorV2, {
      phaseAccounting: {
        ...createCompletedResultV2(varDesc as MinimaxH3ExperimentDescriptorV2).phaseAccounting,
        status: "complete",
        wholeAttemptWallMs: 140000,
        samplingWallTimeMs: 110000,
        gpuKernelTimeMs: null
      },
      observedProvenance: {
        ...createCompletedResultV2(varDesc as MinimaxH3ExperimentDescriptorV2).observedProvenance,
        observedSampling: {
          status: "verified",
          completedSteps: 8,
          expectedSteps: 8,
          samplerName: "euler",
          schedulerName: "simple"
        },
        observedConditioning: {
          status: "verified",
          nodeClass: "MiniMaxH3ImageToVideo",
          taskMode: "i2v",
          referenceCount: 1
        },
        observedAttentionBackend: {
          status: "verified",
          effectiveBackend: "comfy kitchen attention",
          dispatchImplementation: "block_sparse_triton"
        }
      }
    });

    const report = compareMinimaxH3Experiments({
      baselineDescriptor: baseDesc,
      baselineResult: baseResult,
      variantDescriptor: varDesc,
      variantResult: varResult
    });

    expect(report.structuralAdmission.eligible).toBe(true);
    expect(report.structuralAdmission.reasons).toHaveLength(0);
    expect(report.metricEligibility.samplingWallEligible).toBe(true);
    expect(report.metrics?.samplingWallTimeRatio).toBeCloseTo(110000 / 350000, 2);
  });

  describe("Sampling Recipe Option Exclusivity and Metric Disqualification", () => {
    it("rejects invalid prepare option combinations when samplingRecipe is specified", async () => {
      const service = setupServiceWithTemplates();
      const baseOptions = {
        route: "i2v" as const,
        frames: 124 as const,
        seed: 42,
        prompt: "A cinematic shot of a sunset over the ocean",
        operatorLabel: "operator",
        runId: "opt-excl-test",
        outputRoot: ".ai-runs/minimax-h3-experiments",
        targetHost: "render-worker-01",
        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
        comfyUiDir: "/opt/comfyui",
        pythonPath: "/usr/bin/python3",
        samplingRecipe: "fl2va-turbo-8" as const,
        inputManifestPath: "manifest-i2v.json"
      };

      // 1. stepOverride with samplingRecipe
      await expect(
        service.prepareExperiment({
          ...baseOptions,
          stepOverride: 10
        })
      ).rejects.toThrow(/Cannot specify stepOverride when using samplingRecipe/);

      // 2. checkpointOverride with samplingRecipe
      await expect(
        service.prepareExperiment({
          ...baseOptions,
          checkpointOverride: "ref2va"
        })
      ).rejects.toThrow(/Cannot specify checkpointOverride when using samplingRecipe/);

      // 3. attentionVariant with samplingRecipe
      await expect(
        service.prepareExperiment({
          ...baseOptions,
          attentionVariant: "sage"
        })
      ).rejects.toThrow(/Cannot specify attentionVariant when using samplingRecipe/);

      // 4. coreRevision with samplingRecipe
      await expect(
        service.prepareExperiment({
          ...baseOptions,
          coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
        })
      ).rejects.toThrow(/Cannot specify coreRevision when using samplingRecipe/);

      // 5. matchedVariant with samplingRecipe
      await expect(
        service.prepareExperiment({
          ...baseOptions,
          matchedVariant: "dense"
        })
      ).rejects.toThrow(/Cannot specify matchedVariant when using samplingRecipe/);

      // 6. FastH3 with purpose "performance"
      await expect(
        service.prepareExperiment({
          ...baseOptions,
          samplingRecipe: "fasth3-i2v-8",
          variantPurpose: "performance"
        })
      ).rejects.toThrow(/variantPurpose must be "controlled_multifactor"/);
    });

    it("disqualifies metrics when FastH3 variant attentionObservation has fallback or failure", async () => {
      const service = setupServiceWithTemplates();
      const prompt = "A cinematic shot of a sunset over the ocean";

      const { descriptor: baseDesc } = await service.prepareExperiment({
        route: "i2v",
        frames: 124,
        seed: 42,
        prompt,
        operatorLabel: "operator",
        runId: "pair-c-disqual-base",
        outputRoot: ".ai-runs/minimax-h3-experiments",
        targetHost: "render-worker-01",
        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
        comfyUiDir: "/opt/comfyui",
        pythonPath: "/usr/bin/python3",
        checkpointOverride: "fl2va",
        inputManifestPath: "manifest-i2v.json"
      });

      const { descriptor: varDesc } = await service.prepareExperiment({
        route: "i2v",
        frames: 124,
        seed: 42,
        prompt,
        operatorLabel: "operator",
        runId: "pair-c-disqual-var",
        outputRoot: ".ai-runs/minimax-h3-experiments",
        targetHost: "render-worker-01",
        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
        comfyUiDir: "/opt/comfyui-fasth3",
        pythonPath: "/usr/bin/python3",
        samplingRecipe: "fasth3-i2v-8",
        inputManifestPath: "manifest-i2v.json"
      });

      const baseResult = createCompletedResultV2(baseDesc as MinimaxH3ExperimentDescriptorV2);
      const varResult = createCompletedResultV2(varDesc as MinimaxH3ExperimentDescriptorV2, {
        observedProvenance: {
          ...createCompletedResultV2(varDesc as MinimaxH3ExperimentDescriptorV2).observedProvenance,
          observedAttentionBackend: {
            status: "fallback",
            effectiveBackend: "torch_sdpa",
            dispatchImplementation: "sdpa"
          }
        },
        attentionObservation: {
          status: "fallback",
          actualBackend: "torch_sdpa",
          dispatchImplementation: "sdpa",
          acceleratedCallCount: 0,
          denseCallCount: 40,
          plannedDenseCallCount: 0,
          fallbackEvents: [
            {
              stepIndex: 0,
              layerIndex: 0,
              requestedBackend: "triton_block_sparse",
              fallbackBackend: "torch_sdpa",
              reason: "sparse kernel missing",
              monotonicMs: 12345
            }
          ],
          failureReason: "sparse kernel missing, fell back to sdpa",
          missingKernelFailure: null,
          measurementCoverage: {
            samplingCallsRecorded: 1,
            attentionCallsRecorded: 40,
            complete: true
          },
          timings: {
            deviceElapsedMs: null,
            kernelElapsedMs: null
          },
          dtypeLayoutDiagnostics: null
        }
      });

      const report = compareMinimaxH3Experiments({
        baselineDescriptor: baseDesc,
        baselineResult: baseResult,
        variantDescriptor: varDesc,
        variantResult: varResult
      });

      expect(report.metricEligibility.samplingWallEligible).toBe(false);
      expect(report.metricEligibility.wallTimeEligible).toBe(false);
      expect(report.metricEligibility.reasons.some((r) => r.includes("attention"))).toBe(true);
    });

    it("rejects structural admission when FastH3 variant omits attention.configuration or runtime.manifest factor declarations", async () => {
      const service = setupServiceWithTemplates();
      const prompt = "A cinematic shot of a sunset over the ocean";

      const { descriptor: baseDesc } = await service.prepareExperiment({
        route: "i2v",
        frames: 124,
        seed: 42,
        prompt,
        operatorLabel: "operator",
        runId: "pair-c-omit-base",
        outputRoot: ".ai-runs/minimax-h3-experiments",
        targetHost: "render-worker-01",
        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
        samplingRecipe: "fl2va-base-20",
        comfyUiDir: "/opt/comfyui",
        pythonPath: "/usr/bin/python3",
        inputManifestPath: "manifest-i2v.json"
      });

      const { descriptor: varDesc } = await service.prepareExperiment({
        route: "i2v",
        frames: 124,
        seed: 42,
        prompt,
        operatorLabel: "operator",
        runId: "pair-c-omit-var",
        outputRoot: ".ai-runs/minimax-h3-experiments",
        targetHost: "render-worker-01",
        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
        samplingRecipe: "fasth3-i2v-8",
        variantPurpose: "controlled_multifactor",
        comfyUiDir: "/opt/comfyui",
        pythonPath: "/usr/bin/python3",
        inputManifestPath: "manifest-i2v.json"
      });

      const fullVarDesc = varDesc as MinimaxH3ExperimentDescriptorV2;

      // Tamper variant descriptor to omit attention.configuration and runtime.manifest from changedFactors
      const incompleteVarDesc: MinimaxH3ExperimentDescriptorV2 = {
        ...fullVarDesc,
        experimentVariant: {
          ...fullVarDesc.experimentVariant,
          changedFactors: fullVarDesc.experimentVariant.changedFactors.filter(
            (f) => f.path !== "attention.configuration" && f.path !== "runtime.manifest"
          )
        }
      };

      const baseResult = createCompletedResultV2(baseDesc as MinimaxH3ExperimentDescriptorV2);
      const varResult = createCompletedResultV2(incompleteVarDesc);

      const report = compareMinimaxH3Experiments({
        baselineDescriptor: baseDesc,
        baselineResult: baseResult,
        variantDescriptor: incompleteVarDesc,
        variantResult: varResult
      });

      expect(report.structuralAdmission.eligible).toBe(false);
      expect(
        report.structuralAdmission.reasons.some((r) =>
          r.includes("Invariant projection keys do not match")
        )
      ).toBe(true);
    });

    it("rejects structural admission when models.auxiliary factor has mismatched LoRA attributes or extra entries", async () => {
      const service = setupServiceWithTemplates();
      const prompt = "A cinematic shot of a sunset over the ocean";

      const { descriptor: baseDesc } = await service.prepareExperiment({
        route: "i2v",
        frames: 124,
        seed: 42,
        prompt,
        operatorLabel: "operator",
        runId: "pair-a-aux-base",
        outputRoot: ".ai-runs/minimax-h3-experiments",
        targetHost: "render-worker-01",
        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
        samplingRecipe: "fl2va-base-20",
        comfyUiDir: "/opt/comfyui",
        pythonPath: "/usr/bin/python3",
        inputManifestPath: "manifest-i2v.json"
      });

      const { descriptor: varDesc } = await service.prepareExperiment({
        route: "i2v",
        frames: 124,
        seed: 42,
        prompt,
        operatorLabel: "operator",
        runId: "pair-a-aux-var",
        outputRoot: ".ai-runs/minimax-h3-experiments",
        targetHost: "render-worker-01",
        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
        samplingRecipe: "fl2va-turbo-8",
        comfyUiDir: "/opt/comfyui",
        pythonPath: "/usr/bin/python3",
        inputManifestPath: "manifest-i2v.json"
      });

      const fullVarDesc = varDesc as MinimaxH3ExperimentDescriptorV2;

      // Tamper variant changedFactors to have wrong strength on LoRA
      const tamperedVarDesc: MinimaxH3ExperimentDescriptorV2 = {
        ...fullVarDesc,
        experimentVariant: {
          ...fullVarDesc.experimentVariant,
          changedFactors: fullVarDesc.experimentVariant.changedFactors.map((f) =>
            f.path === "models.auxiliary"
              ? {
                  ...f,
                  after: [
                    {
                      name: "fl2va_turbo_8.safetensors",
                      hash: PINNED_H3_LORAS.fl2vaTurbo8.sha256,
                      strength: 0.5, // Recipe specifies 1.0!
                      role: "lora",
                      order: 0
                    }
                  ]
                }
              : f
          )
        }
      };

      const baseResult = createCompletedResultV2(baseDesc as MinimaxH3ExperimentDescriptorV2);
      const varResult = createCompletedResultV2(tamperedVarDesc);

      const report = compareMinimaxH3Experiments({
        baselineDescriptor: baseDesc,
        baselineResult: baseResult,
        variantDescriptor: tamperedVarDesc,
        variantResult: varResult
      });

      expect(report.structuralAdmission.eligible).toBe(false);
      expect(
        report.structuralAdmission.reasons.some((r) =>
          r.includes('Declared factor "models.auxiliary"')
        )
      ).toBe(true);
    });
  });
});
