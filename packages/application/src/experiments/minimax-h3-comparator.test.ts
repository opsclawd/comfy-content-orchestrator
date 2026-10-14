import { describe, expect, it } from "vitest";
import { compareMinimaxH3Experiments } from "./minimax-h3-comparator.js";
import {
  PINNED_H3_CHECKPOINTS,
  createEmptyMinimaxH3MeasurementTemplateV2,
  computeAttentionRuntimeLockDigest,
  type MinimaxH3ExperimentDescriptorV2,
  type MinimaxH3ExperimentResultV2
} from "@cco/contracts";
import { sha256Hex } from "./minimax-h3-experiment-service.js";

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
      descriptor.attentionRequest?.attentionVariant === "dense"
        ? {
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
            timings: {
              deviceElapsedMs: null,
              kernelElapsedMs: null
            }
          }
        : undefined,
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
});
