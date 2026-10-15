import { describe, expect, it } from "vitest";
import {
  MinimaxH3ExperimentDescriptorV2Schema,
  MinimaxH3ExperimentResultV2Schema,
  MinimaxH3AnyExperimentDescriptorSchema,
  MinimaxH3AnyExperimentResultSchema,
  MinimaxH3PhaseRecordSchema,
  MinimaxH3RequiredRuntimeManifestSchema,
  MinimaxH3ExperimentVariantSchema,
  createEmptyMinimaxH3MeasurementTemplateV2,
  computeInvariantProjectionKey,
  PINNED_H3_CHECKPOINTS,
  PINNED_H3_LORAS,
  PINNED_FASTH3_CHECKPOINT,
  PINNED_COMFYUI_NODES_PY_SHA256,
  PINNED_COMFYUI_NODES_MINIMAX_H3_PY_SHA256,
  FASTH3_COMFYUI_SOURCE_HASHES,
  MinimaxH3SamplingRecipeSchema,
  computeSamplingRecipeDigest,
  FactorChangeSigmaShiftSchema,
  getSamplingRecipe,
  getDerivedAttentionVerificationView,
  type MinimaxH3ExperimentDescriptorV2,
  type MinimaxH3FactorChange,
  type MinimaxH3SamplingRecipe
} from "./minimax-h3-experiment-v2.js";
import {
  sha256Hex,
  createEmptyMinimaxH3MeasurementTemplate,
  MinimaxH3ExperimentDescriptorSchema
} from "./minimax-h3-experiment.js";

const DUMMY_HASH_1 = "1111111111111111111111111111111111111111111111111111111111111111";
const DUMMY_HASH_2 = "2222222222222222222222222222222222222222222222222222222222222222";
const DUMMY_HASH_3 = "3333333333333333333333333333333333333333333333333333333333333333";
const DUMMY_HASH_4 = "4444444444444444444444444444444444444444444444444444444444444444";

function createValidDescriptorV2(
  overrides: Partial<MinimaxH3ExperimentDescriptorV2> = {}
): MinimaxH3ExperimentDescriptorV2 {
  const prompt = "A cinematic shot of a person smiling warmly";
  const promptDigest = sha256Hex(prompt);
  const base: MinimaxH3ExperimentDescriptorV2 = {
    schemaVersion: 2,
    kind: "non-production-experiment",
    runId: "run-h3-test-001",
    operatorLabel: "operator-test",
    route: "i2v",
    configuredFrames: 243,
    fps: 24,
    requestedDurationMs: 10125,
    requestedDurationSupplied: true,
    configuredDurationMs: 10125,
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
        resolvedPath: `/models/unet/${PINNED_H3_CHECKPOINTS.ref2va.filename}`,
        sizeBytes: 15_000_000_000
      }
    },
    referenceSetId: "ref-set-01",
    references: [
      {
        slotIndex: 0,
        role: "reference",
        tag: "<Picture 1>",
        order: 0,
        assetPath: "/assets/test.png",
        stagedFilename: "test.png",
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
      variantName: "baseline-243f",
      variantReason: "controlled 243f baseline",
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
      scope: "i2v-243f-20steps",
      reasons: ["Verified on pinned ComfyUI core revision 55b6a9b1"],
      sources: [
        {
          url: "https://github.com/comfyanonymous/ComfyUI/commit/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
          assertion: "Current pinned production commit"
        }
      ]
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
        {
          name: "torch",
          version: "2.4.1"
        },
        {
          name: "torchaudio",
          version: "2.4.1"
        }
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
          assetPath: "/assets/test.png",
          sha256: DUMMY_HASH_1,
          targetNodeId: "104",
          targetInputName: "first_frame"
        }
      ]
    }
  };

  return { ...base, ...overrides };
}

describe("MiniMax-H3 Experiment V2 Contracts", () => {
  describe("Descriptor and Result V2 Schema Validation", () => {
    it("parses and validates a complete valid v2 descriptor", () => {
      const desc = createValidDescriptorV2();
      const parsed = MinimaxH3ExperimentDescriptorV2Schema.parse(desc);
      expect(parsed.schemaVersion).toBe(2);
      expect(parsed.configuredFrames).toBe(243);
      expect(parsed.experimentVariant.variantName).toBe("baseline-243f");
      expect(parsed.compatibility.state).toBe("supported");
    });

    it("creates a valid empty v2 measurement template", () => {
      const desc = createValidDescriptorV2();
      const template = createEmptyMinimaxH3MeasurementTemplateV2(desc);
      const parsed = MinimaxH3ExperimentResultV2Schema.parse(template);
      expect(parsed.schemaVersion).toBe(2);
      expect(parsed.lifecycle).toBe("prepared");
      expect(parsed.phaseAccounting.phases.sampling!.status).toBe("unknown");
      expect(parsed.phaseAccounting.phases.sampling!.durationMs).toBeNull();
      expect(parsed.phaseAccounting.phases.sampling!.unknownReason).toBe("not_started");
    });

    it("enforces phase record invariants: measured requires non-null durations and start <= end", () => {
      expect(() => {
        MinimaxH3PhaseRecordSchema.parse({
          phase: "sampling",
          status: "measured",
          durationMs: null,
          startMs: 100,
          endMs: 200,
          boundarySource: "child_bootstrap",
          clockDomain: "mono_child",
          unknownReason: null
        });
      }).toThrow(/requires non-null durationMs/);

      expect(() => {
        MinimaxH3PhaseRecordSchema.parse({
          phase: "sampling",
          status: "measured",
          durationMs: 100,
          startMs: 250,
          endMs: 150,
          boundarySource: "child_bootstrap",
          clockDomain: "mono_child",
          unknownReason: null
        });
      }).toThrow(/cannot be less than startMs/);
    });

    it("enforces phase record invariants: unknown forbids durationMs and requires unknownReason", () => {
      expect(() => {
        MinimaxH3PhaseRecordSchema.parse({
          phase: "model_loading",
          status: "unknown",
          durationMs: 500, // forbidden!
          startMs: null,
          endMs: null,
          boundarySource: "child_bootstrap",
          clockDomain: "mono_child",
          unknownReason: "skipped"
        });
      }).toThrow(/requires null durationMs/);

      expect(() => {
        MinimaxH3PhaseRecordSchema.parse({
          phase: "model_loading",
          status: "unknown",
          durationMs: null,
          startMs: null,
          endMs: null,
          boundarySource: "child_bootstrap",
          clockDomain: "mono_child",
          unknownReason: null // missing reason!
        });
      }).toThrow(/requires an unknownReason/);
    });
  });

  describe("Witness F1: Prompt-Conditioning Pair Admission & Counterexamples", () => {
    it("admits synthetic 243f I2V prompt pair with purpose=prompt_conditioning and single factor change", () => {
      const origPrompt = "A cinematic shot of a person smiling warmly, original prompt";
      const tightPrompt = "A cinematic shot of a person smiling warmly, tight prompt";
      const origDigest = sha256Hex(origPrompt);
      const tightDigest = sha256Hex(tightPrompt);

      const baselineDesc = createValidDescriptorV2({
        runId: "run-f1-baseline-243f",
        prompt: origPrompt,
        promptDigest: origDigest,
        conditioning: {
          positivePrompt: { text: origPrompt, digest: origDigest },
          negativePrompt: { status: "not_supported", text: null, digest: null },
          bindings: [
            {
              role: "first_frame",
              slotIndex: 0,
              kind: "first_frame",
              assetPath: "/assets/test.png",
              sha256: DUMMY_HASH_1,
              targetNodeId: "104",
              targetInputName: "first_frame"
            }
          ]
        },
        experimentVariant: {
          variantName: "baseline-orig-prompt",
          variantReason: "243f baseline with original prompt",
          purpose: "prompt_conditioning",
          changedFactors: [
            {
              path: "conditioning.positivePrompt",
              before: { text: origPrompt, digest: origDigest },
              after: { text: origPrompt, digest: origDigest },
              rationale: "Self-identity baseline"
            }
          ]
        }
      });

      const promptFactor: MinimaxH3FactorChange = {
        path: "conditioning.positivePrompt",
        before: { text: origPrompt, digest: origDigest },
        after: { text: tightPrompt, digest: tightDigest },
        rationale: "Test prompt tightness impact on 243f continuity"
      };

      const variantDesc = createValidDescriptorV2({
        runId: "run-f1-variant-243f",
        prompt: tightPrompt,
        promptDigest: tightDigest,
        conditioning: {
          positivePrompt: { text: tightPrompt, digest: tightDigest },
          negativePrompt: { status: "not_supported", text: null, digest: null },
          bindings: [
            {
              role: "first_frame",
              slotIndex: 0,
              kind: "first_frame",
              assetPath: "/assets/test.png",
              sha256: DUMMY_HASH_1,
              targetNodeId: "104",
              targetInputName: "first_frame"
            }
          ]
        },
        experimentVariant: {
          variantName: "variant-tight-prompt",
          variantReason: "243f variant with tight prompt",
          purpose: "prompt_conditioning",
          changedFactors: [promptFactor]
        }
      });

      expect(MinimaxH3ExperimentDescriptorV2Schema.parse(baselineDesc)).toBeDefined();
      expect(MinimaxH3ExperimentDescriptorV2Schema.parse(variantDesc)).toBeDefined();

      // Equal invariant projections prove controlled pair admission
      const baselineProjKey = computeInvariantProjectionKey({
        route: baselineDesc.route,
        frames: baselineDesc.configuredFrames,
        width: baselineDesc.width,
        height: baselineDesc.height,
        fps: baselineDesc.fps,
        seed: baselineDesc.seed,
        baseProfileKey: baselineDesc.baseProfileKey,
        declaredPaths: ["conditioning.positivePrompt"],
        positivePromptText: baselineDesc.prompt,
        references: baselineDesc.references,
        diffusionModelFileHash: baselineDesc.provenance.actualCheckpointHash,
        samplerSettings: baselineDesc.provenance.samplerSettings,
        memoryPolicy: baselineDesc.requestedRunner.memoryPolicy
      });

      const variantProjKey = computeInvariantProjectionKey({
        route: variantDesc.route,
        frames: variantDesc.configuredFrames,
        width: variantDesc.width,
        height: variantDesc.height,
        fps: variantDesc.fps,
        seed: variantDesc.seed,
        baseProfileKey: variantDesc.baseProfileKey,
        declaredPaths: ["conditioning.positivePrompt"],
        positivePromptText: variantDesc.prompt,
        references: variantDesc.references,
        diffusionModelFileHash: variantDesc.provenance.actualCheckpointHash,
        samplerSettings: variantDesc.provenance.samplerSettings,
        memoryPolicy: variantDesc.requestedRunner.memoryPolicy
      });

      expect(baselineProjKey).toBe(variantProjKey);
    });

    it("rejects prompt changes when purpose is performance", () => {
      expect(() => {
        MinimaxH3ExperimentVariantSchema.parse({
          variantName: "invalid-performance-prompt-change",
          variantReason: "should fail",
          purpose: "performance",
          changedFactors: [
            {
              path: "conditioning.positivePrompt",
              before: { text: "old prompt", digest: DUMMY_HASH_1 },
              after: { text: "new prompt", digest: DUMMY_HASH_2 },
              rationale: "Prompt changed under performance purpose"
            }
          ]
        });
      }).toThrow(/forbids conditioning or prompt factor changes/);
    });

    it("rejects prompt_conditioning with multiple changed factors (requires single-variable study)", () => {
      expect(() => {
        MinimaxH3ExperimentVariantSchema.parse({
          variantName: "invalid-multifactor-prompt-study",
          variantReason: "should fail",
          purpose: "prompt_conditioning",
          changedFactors: [
            {
              path: "conditioning.positivePrompt",
              before: { text: "old", digest: DUMMY_HASH_1 },
              after: { text: "new", digest: DUMMY_HASH_2 },
              rationale: "prompt change"
            },
            {
              path: "sampling.settings",
              before: { sampler: "res_multistep", scheduler: "simple", steps: 20 },
              after: { sampler: "res_multistep", scheduler: "simple", steps: 15 },
              rationale: "step change"
            }
          ]
        });
      }).toThrow(/admits only prompt or conditioning factor changes/);
    });
  });

  describe("Witness F2: Isolated-Runtime Compatibility States & Manifests", () => {
    it("validates all 4 compatibility states", () => {
      const states = [
        "supported",
        "requires_isolated_upgrade",
        "unsupported",
        "unverified"
      ] as const;
      for (const state of states) {
        const desc = createValidDescriptorV2({
          compatibility: {
            state,
            relativeToRuntimeManifestDigest: DUMMY_HASH_1,
            scope: `test-${state}`,
            reasons: [`Reason for ${state}`],
            sources: [
              {
                url: "https://example.com/audit",
                assertion: `Structural evidence for ${state}`
              }
            ]
          }
        });
        const parsed = MinimaxH3ExperimentDescriptorV2Schema.parse(desc);
        expect(parsed.compatibility.state).toBe(state);
      }
    });

    it("rejects duplicate python packages in requiredRuntime manifest", () => {
      expect(() => {
        MinimaxH3RequiredRuntimeManifestSchema.parse({
          coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
          sourceFileHashes: {},
          requiredNodes: [],
          pythonPackages: [
            { name: "torch", version: "2.4.1" },
            { name: "torch", version: "2.5.0" } // duplicate!
          ],
          pytorchBuild: "2.4.1",
          cudaBuild: "12.4",
          driverConstraints: [">=550.00"],
          attentionKernel: "sdpa",
          instrumentationProtocol: "v2-jsonl",
          collectorDigest: DUMMY_HASH_1,
          hookManifestDigest: DUMMY_HASH_2,
          hooks: []
        });
      }).toThrow(/Duplicate package name 'torch'/);
    });

    it("accepts synthetic native sparse requires_isolated_upgrade manifest", () => {
      const manifest = {
        coreRevision: "e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2",
        sourceFileHashes: {
          "comfy/ldm/minimax/sparse.py": DUMMY_HASH_3
        },
        requiredNodes: [
          {
            name: "NativeSparseMiniMaxH3",
            moduleHash: DUMMY_HASH_4
          }
        ],
        pythonPackages: [
          { name: "flash-attn", version: "2.6.3" },
          { name: "torch", version: "2.5.1" }
        ],
        pytorchBuild: "2.5.1+cu124",
        cudaBuild: "12.4",
        driverConstraints: [">=550.00"],
        attentionKernel: "native_sparse",
        instrumentationProtocol: "v2-jsonl",
        collectorDigest: DUMMY_HASH_1,
        hookManifestDigest: DUMMY_HASH_2,
        hooks: [
          {
            name: "sparse_attention_hook",
            modulePath: "comfy.ldm.minimax.sparse",
            callable: "apply_sparse_attention",
            phase: "sampling" as const
          }
        ]
      };
      const parsed = MinimaxH3RequiredRuntimeManifestSchema.parse(manifest);
      expect(parsed.attentionKernel).toBe("native_sparse");
    });
  });

  describe("Witness W3: Candidate Frames and Routes", () => {
    it("admits candidate frames 124, 192, 243, 362 on i2v and ref2v", () => {
      const candidateFrames = [124, 192, 243, 362] as const;
      for (const frames of candidateFrames) {
        const descI2V = createValidDescriptorV2({ configuredFrames: frames });
        expect(MinimaxH3ExperimentDescriptorV2Schema.parse(descI2V)).toBeDefined();

        const descRef2V = createValidDescriptorV2({
          route: "ref2v",
          baseProfileKey: "MINIMAX_H3_720P_5S_REF2V_V1",
          configuredFrames: frames,
          references: [
            {
              slotIndex: 0,
              role: "subject",
              tag: "<Picture 1>",
              order: 0,
              assetPath: "/assets/sub.png",
              stagedFilename: "sub.png",
              sha256: DUMMY_HASH_1,
              width: 1344,
              height: 768,
              mimeType: "image/png"
            },
            {
              slotIndex: 1,
              role: "style",
              tag: "<Picture 2>",
              order: 1,
              assetPath: "/assets/style.png",
              stagedFilename: "style.png",
              sha256: DUMMY_HASH_2,
              width: 1344,
              height: 768,
              mimeType: "image/png"
            }
          ]
        });
        expect(MinimaxH3ExperimentDescriptorV2Schema.parse(descRef2V)).toBeDefined();
      }
    });

    it("rejects off-grid frames in v2 descriptor", () => {
      expect(() => {
        const desc = createValidDescriptorV2({
          configuredFrames: 100 as unknown as 124
        });
        MinimaxH3ExperimentDescriptorV2Schema.parse(desc);
      }).toThrow();
    });
  });

  describe("Backward Compatibility: V1 and Any Dispatch", () => {
    function createValidDescriptorV1() {
      const v1Prompt = "prompt v1";
      const v1PromptDigest = sha256Hex(v1Prompt);
      return {
        schemaVersion: 1 as const,
        kind: "non-production-experiment" as const,
        runId: "v1-run-001",
        operatorLabel: "op-v1",
        route: "i2v" as const,
        configuredFrames: 124 as const,
        fps: 24 as const,
        requestedDurationMs: 5167,
        requestedDurationSupplied: false,
        configuredDurationMs: 5167,
        width: 1344,
        height: 768,
        seed: 42,
        prompt: v1Prompt,
        promptDigest: v1PromptDigest,
        baseProfileKey: "MINIMAX_H3_720P_5S_I2V_V1" as const,
        baseProfileVersion: 1 as const,
        baseProfileFileDigest: DUMMY_HASH_1,
        provenanceManifestDigest: DUMMY_HASH_2,
        provenanceSource: "authored_from_spec" as const,
        baseCanonicalWorkflowDigest: DUMMY_HASH_3,
        derivedWorkflowDigest: DUMMY_HASH_4,
        pinFileIdentities: {
          comfyuiCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
          minimaxH3Revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1",
          modelDigests: { d: DUMMY_HASH_1 }
        },
        resolvedModelPaths: {
          d: { expectedHash: DUMMY_HASH_1, resolvedPath: "/path", sizeBytes: 100 }
        },
        referenceSetId: "ref-1",
        references: [
          {
            slotIndex: 0,
            role: "reference",
            tag: "<Picture 1>",
            order: 0,
            assetPath: "/path",
            stagedFilename: "ref.png",
            sha256: DUMMY_HASH_1,
            width: 1344,
            height: 768,
            mimeType: "image/png"
          }
        ],
        requestedRunner: {
          variantName: "v1",
          variantReason: null,
          memoryPolicy: "dynamic_vram" as const,
          offloadSettings: { modelOffload: true }
        },
        configuredRunner: {
          argv: [],
          env: {},
          predictedPolicy: "dynamic_vram" as const,
          pinnedSourceIdentities: {
            cliArgsSha256: DUMMY_HASH_1,
            mainSha256: DUMMY_HASH_2,
            modelManagementSha256: DUMMY_HASH_3
          }
        },
        target: {
          hostname: "localhost",
          gpuUuid: "GPU-11111111-2222-3333-4444-555555555555",
          comfyUiDir: "/comfy",
          pythonPath: "/python",
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
        comparisonKey: "cmp-key-1"
      };
    }

    it("accepts a legacy v1 descriptor in MinimaxH3AnyExperimentDescriptorSchema", () => {
      const v1Desc = createValidDescriptorV1();
      const parsed = MinimaxH3AnyExperimentDescriptorSchema.parse(v1Desc);
      expect(parsed.schemaVersion).toBe(1);
    });

    it("accepts a v2 descriptor in MinimaxH3AnyExperimentDescriptorSchema", () => {
      const v2Desc = createValidDescriptorV2();
      const parsed = MinimaxH3AnyExperimentDescriptorSchema.parse(v2Desc);
      expect(parsed.schemaVersion).toBe(2);
    });

    it("accepts a legacy v1 result in MinimaxH3AnyExperimentResultSchema", () => {
      const v1Desc = MinimaxH3ExperimentDescriptorSchema.parse(createValidDescriptorV1());
      const v1Result = createEmptyMinimaxH3MeasurementTemplate(v1Desc);
      const parsed = MinimaxH3AnyExperimentResultSchema.parse(v1Result);
      expect(parsed.schemaVersion).toBe(1);
    });

    it("accepts a v2 result in MinimaxH3AnyExperimentResultSchema", () => {
      const v2Desc = createValidDescriptorV2();
      const v2Result = createEmptyMinimaxH3MeasurementTemplateV2(v2Desc);
      const parsed = MinimaxH3AnyExperimentResultSchema.parse(v2Result);
      expect(parsed.schemaVersion).toBe(2);
    });
  });

  describe("Step Reduction & Distillation Sampling Recipes", () => {
    function createSyntheticFl2vaTurboRecipe(): MinimaxH3SamplingRecipe {
      const partial = {
        name: "fl2va-turbo-8" as const,
        recipeVersion: 1 as const,
        taskFamily: "i2v" as const,
        compatibleRoute: "i2v" as const,
        diffusionModel: {
          filename: PINNED_H3_CHECKPOINTS.fl2va.filename,
          sha256: PINNED_H3_CHECKPOINTS.fl2va.sha256,
          sizeBytes: 20970379616,
          quantization: "int8_convrot",
          repository: "Comfy-Org/MiniMax-H3",
          revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1"
        },
        lora: {
          filename: PINNED_H3_LORAS.fl2vaTurbo8.filename,
          sha256: PINNED_H3_LORAS.fl2vaTurbo8.sha256,
          sizeBytes: PINNED_H3_LORAS.fl2vaTurbo8.sizeBytes,
          strengthModel: 1.0,
          repository: "lightx2v/Minimax-h3-Turbo",
          revision: "3ec17a324ced54151364f24f8b5fb6bf7e26414f"
        },
        expectedSteps: 8,
        sampler: "res_multistep",
        scheduler: "simple",
        denoise: 1.0,
        sigmaShift: null,
        conditioningMode: "frame_anchored" as const,
        requiredRuntimeRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        licensing: {
          status: "review_required" as const,
          licenseSourceRef: "https://huggingface.co/lightx2v/Minimax-h3-Turbo"
        },
        sourceReferences: [
          {
            url: "https://github.com/Comfy-Org/docs/blob/main/tutorials/video/minimax/minimax-h3.mdx",
            assertion: "Official FL2VA 8-step Turbo LoRA documentation"
          }
        ]
      };
      return {
        ...partial,
        recipeDigest: computeSamplingRecipeDigest(partial)
      };
    }

    function createSyntheticFastH3Recipe(): MinimaxH3SamplingRecipe {
      const partial = {
        name: "fasth3-i2v-8" as const,
        recipeVersion: 1 as const,
        taskFamily: "i2v" as const,
        compatibleRoute: "i2v" as const,
        diffusionModel: {
          filename: PINNED_FASTH3_CHECKPOINT.filename,
          sha256: PINNED_FASTH3_CHECKPOINT.sha256,
          sizeBytes: PINNED_FASTH3_CHECKPOINT.sizeBytes,
          quantization: "int8_convrot",
          repository: "FastVideo/FastVideo-FastH3-Comfy",
          revision: "ec1e3aa374a91c57b0b94a1623b7e657c0498cf2"
        },
        lora: null,
        expectedSteps: 8,
        sampler: "res_multistep",
        scheduler: "simple",
        denoise: 1.0,
        sigmaShift: {
          enabled: true,
          videoShift: 10,
          audioShift: 3
        },
        conditioningMode: "frame_anchored" as const,
        requiredRuntimeRevision: "ee71d5c4993f29086b27fde1629a945ae48425bf",
        licensing: {
          status: "restricted" as const,
          licenseSourceRef: "https://huggingface.co/FastVideo/FastVideo-FastH3-Comfy"
        },
        sourceReferences: [
          {
            url: "https://github.com/Comfy-Org/workflow_templates/blob/main/templates/video_fastvideo_fasth3_i2v.json",
            assertion: "Official FastH3 I2V workflow template"
          }
        ]
      };
      return {
        ...partial,
        recipeDigest: computeSamplingRecipeDigest(partial)
      };
    }

    it("validates sampling recipe schema and computed digest against authoritative catalog", () => {
      const recipe = getSamplingRecipe("fl2va-turbo-8");
      expect(MinimaxH3SamplingRecipeSchema.parse(recipe)).toBeDefined();

      const corruptDigest = { ...recipe, recipeDigest: DUMMY_HASH_4 };
      expect(() => MinimaxH3SamplingRecipeSchema.parse(corruptDigest)).toThrow(
        /samplingRecipe recipeDigest mismatch/
      );

      const tamperedSteps = {
        ...recipe,
        expectedSteps: 4,
        recipeDigest: computeSamplingRecipeDigest({ ...recipe, expectedSteps: 4 })
      };
      expect(() => MinimaxH3SamplingRecipeSchema.parse(tamperedSteps)).toThrow(
        /samplingRecipe expectedSteps mismatch/
      );
    });

    it("parses FactorChangeSigmaShiftSchema in MinimaxH3FactorChangeSchema", () => {
      const shiftFactor = {
        path: "sampling.sigmaShift" as const,
        before: { enabled: false, videoShift: 12, audioShift: 3 },
        after: { enabled: true, videoShift: 10, audioShift: 3 },
        rationale: "FastH3 8-step recipe video flow shift 10, audio shift 3"
      };
      const parsed = FactorChangeSigmaShiftSchema.parse(shiftFactor);
      expect(parsed.path).toBe("sampling.sigmaShift");
    });

    it("admits valid fl2va-turbo-8 recipe on I2V route with 8 steps", () => {
      const recipe = getSamplingRecipe("fl2va-turbo-8");
      const desc = createValidDescriptorV2({
        route: "i2v",
        samplingRecipe: recipe,
        stepOverride: 8,
        pinFileIdentities: {
          comfyuiCoreRevision: recipe.requiredRuntimeRevision,
          minimaxH3Revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1",
          modelDigests: {
            diffusion: recipe.diffusionModel.sha256,
            lora: recipe.lora!.sha256
          }
        },
        resolvedModelPaths: {
          diffusion: {
            expectedHash: recipe.diffusionModel.sha256,
            resolvedPath: `/models/diffusion_models/${recipe.diffusionModel.filename}`,
            sizeBytes: recipe.diffusionModel.sizeBytes
          },
          lora: {
            expectedHash: recipe.lora!.sha256,
            resolvedPath: `/models/loras/${recipe.lora!.filename}`,
            sizeBytes: recipe.lora!.sizeBytes
          }
        },
        requiredRuntime: {
          ...createValidDescriptorV2().requiredRuntime,
          coreRevision: recipe.requiredRuntimeRevision,
          requiredNodes: [{ name: "MiniMaxH3ImageToVideo" }, { name: "LoraLoaderModelOnly" }],
          sourceFileHashes: {
            "nodes.py": PINNED_COMFYUI_NODES_PY_SHA256,
            "comfy_extras/nodes_minimax_h3.py": PINNED_COMFYUI_NODES_MINIMAX_H3_PY_SHA256
          }
        },
        provenance: {
          ...createValidDescriptorV2().provenance,
          actualCheckpointHash: recipe.diffusionModel.sha256,
          loadedModelHashes: {
            diffusion: recipe.diffusionModel.sha256,
            lora: recipe.lora!.sha256
          },
          samplerSettings: {
            sampler: recipe.sampler,
            scheduler: recipe.scheduler,
            steps: 8
          },
          comfyuiCoreRevision: recipe.requiredRuntimeRevision
        }
      });
      expect(MinimaxH3ExperimentDescriptorV2Schema.parse(desc)).toBeDefined();
    });

    it("rejects fasth3-i2v-8 on Ref2V route", () => {
      const recipe = createSyntheticFastH3Recipe();
      const desc = createValidDescriptorV2({
        route: "ref2v",
        baseProfileKey: "MINIMAX_H3_720P_5S_REF2V_V1",
        references: [
          {
            slotIndex: 0,
            role: "reference",
            tag: "<Picture 1>",
            order: 0,
            assetPath: "/assets/ref0.png",
            stagedFilename: "ref0.png",
            sha256: DUMMY_HASH_1,
            width: 1344,
            height: 768,
            mimeType: "image/png"
          }
        ],
        samplingRecipe: recipe
      });
      expect(() => MinimaxH3ExperimentDescriptorV2Schema.parse(desc)).toThrow(
        /FastH3 8-step is strictly restricted to I2V/
      );
    });

    it("rejects fl2va-turbo-8 on Ref2V route", () => {
      const recipe = createSyntheticFl2vaTurboRecipe();
      const desc = createValidDescriptorV2({
        route: "ref2v",
        baseProfileKey: "MINIMAX_H3_720P_5S_REF2V_V1",
        references: [
          {
            slotIndex: 0,
            role: "reference",
            tag: "<Picture 1>",
            order: 0,
            assetPath: "/assets/ref0.png",
            stagedFilename: "ref0.png",
            sha256: DUMMY_HASH_1,
            width: 1344,
            height: 768,
            mimeType: "image/png"
          }
        ],
        samplingRecipe: recipe
      });
      expect(() => MinimaxH3ExperimentDescriptorV2Schema.parse(desc)).toThrow(
        /FL2VA Turbo 8-step LoRA is strictly restricted to I2V route/
      );
    });

    it("rejects stepOverride that conflicts with recipe expectedSteps", () => {
      const recipe = createSyntheticFl2vaTurboRecipe();
      const desc = createValidDescriptorV2({
        route: "i2v",
        samplingRecipe: recipe,
        stepOverride: 20 // conflicts with recipe's 8 steps
      });
      expect(() => MinimaxH3ExperimentDescriptorV2Schema.parse(desc)).toThrow(
        /stepOverride \(20\) conflicts with sampling recipe expectedSteps \(8\)/
      );
    });

    it("rejects recipeDigest mismatch in descriptor", () => {
      const recipe = { ...createSyntheticFl2vaTurboRecipe(), recipeDigest: DUMMY_HASH_4 };
      const desc = createValidDescriptorV2({
        route: "i2v",
        samplingRecipe: recipe
      });
      expect(() => MinimaxH3ExperimentDescriptorV2Schema.parse(desc)).toThrow(
        /samplingRecipe recipeDigest mismatch/
      );
    });

    it("proves computeInvariantProjectionKey detects undeclared auxiliary model (LoRA) variations", () => {
      const optionsBase = {
        route: "i2v",
        frames: 124,
        width: 1344,
        height: 768,
        fps: 24,
        seed: 42,
        baseProfileKey: "MINIMAX_H3_720P_5S_I2V_V1",
        declaredPaths: [],
        positivePromptText: "A person smiling warmly",
        references: [{ slotIndex: 0, role: "first_frame", sha256: DUMMY_HASH_1 }],
        diffusionModelFileHash: PINNED_H3_CHECKPOINTS.fl2va.sha256,
        samplerSettings: { sampler: "res_multistep", scheduler: "simple", steps: 20 },
        memoryPolicy: "dynamic_vram"
      };

      const keyWithoutLora = computeInvariantProjectionKey({
        ...optionsBase,
        auxiliaryModels: []
      });

      const keyWithTurboLora = computeInvariantProjectionKey({
        ...optionsBase,
        auxiliaryModels: [
          {
            name: PINNED_H3_LORAS.fl2vaTurbo8.filename,
            hash: PINNED_H3_LORAS.fl2vaTurbo8.sha256,
            strength: 1.0,
            role: "lora",
            order: 0
          }
        ]
      });

      // Without declaring models.auxiliary, keys must NOT match (fail closed)
      expect(keyWithoutLora).not.toBe(keyWithTurboLora);

      // When declared, both project to the placeholder and match
      const keyWithoutLoraDeclared = computeInvariantProjectionKey({
        ...optionsBase,
        declaredPaths: ["models.auxiliary"],
        auxiliaryModels: []
      });

      const keyWithTurboLoraDeclared = computeInvariantProjectionKey({
        ...optionsBase,
        declaredPaths: ["models.auxiliary"],
        auxiliaryModels: [
          {
            name: PINNED_H3_LORAS.fl2vaTurbo8.filename,
            hash: PINNED_H3_LORAS.fl2vaTurbo8.sha256,
            strength: 1.0,
            role: "lora",
            order: 0
          }
        ]
      });

      expect(keyWithoutLoraDeclared).toBe(keyWithTurboLoraDeclared);
    });

    it("proves computeInvariantProjectionKey detects undeclared sigmaShift variations", () => {
      const optionsBase = {
        route: "i2v",
        frames: 124,
        width: 1344,
        height: 768,
        fps: 24,
        seed: 42,
        baseProfileKey: "MINIMAX_H3_720P_5S_I2V_V1",
        declaredPaths: [],
        positivePromptText: "A person smiling warmly",
        references: [{ slotIndex: 0, role: "first_frame", sha256: DUMMY_HASH_1 }],
        diffusionModelFileHash: PINNED_H3_CHECKPOINTS.fl2va.sha256,
        samplerSettings: { sampler: "res_multistep", scheduler: "simple", steps: 20 },
        memoryPolicy: "dynamic_vram"
      };

      const keyDefaultShift = computeInvariantProjectionKey({
        ...optionsBase,
        sigmaShift: { enabled: false, videoShift: 12, audioShift: 3 }
      });

      const keyFastH3Shift = computeInvariantProjectionKey({
        ...optionsBase,
        sigmaShift: { enabled: true, videoShift: 10, audioShift: 3 }
      });

      expect(keyDefaultShift).not.toBe(keyFastH3Shift);

      const keyDefaultShiftDeclared = computeInvariantProjectionKey({
        ...optionsBase,
        declaredPaths: ["sampling.sigmaShift"],
        sigmaShift: { enabled: false, videoShift: 12, audioShift: 3 }
      });

      const keyFastH3ShiftDeclared = computeInvariantProjectionKey({
        ...optionsBase,
        declaredPaths: ["sampling.sigmaShift"],
        sigmaShift: { enabled: true, videoShift: 10, audioShift: 3 }
      });

      expect(keyDefaultShiftDeclared).toBe(keyFastH3ShiftDeclared);
    });

    it("proves computeInvariantProjectionKey detects undeclared coreRevision differences", () => {
      const optionsBase = {
        route: "i2v" as const,
        frames: 124,
        width: 1344,
        height: 768,
        fps: 24,
        seed: 42,
        baseProfileKey: "MINIMAX_H3_720P_5S_I2V_V1" as const,
        declaredPaths: [],
        positivePromptText: "A person smiling warmly",
        references: [{ slotIndex: 0, role: "first_frame" as const, sha256: DUMMY_HASH_1 }],
        diffusionModelFileHash: PINNED_H3_CHECKPOINTS.fl2va.sha256,
        samplerSettings: { sampler: "res_multistep", scheduler: "simple", steps: 20 },
        memoryPolicy: "dynamic_vram" as const
      };

      const keyPinCore = computeInvariantProjectionKey({
        ...optionsBase,
        coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
      });

      const keyFastH3Core = computeInvariantProjectionKey({
        ...optionsBase,
        coreRevision: "ee71d5c4993f29086b27fde1629a945ae48425bf"
      });

      expect(keyPinCore).not.toBe(keyFastH3Core);

      const keyPinCoreDeclared = computeInvariantProjectionKey({
        ...optionsBase,
        declaredPaths: ["runtime.manifest"],
        coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
      });

      const keyFastH3CoreDeclared = computeInvariantProjectionKey({
        ...optionsBase,
        declaredPaths: ["runtime.manifest"],
        coreRevision: "ee71d5c4993f29086b27fde1629a945ae48425bf"
      });

      expect(keyPinCoreDeclared).toBe(keyFastH3CoreDeclared);
    });

    it("superRefine rejects rehashed tampered sampling recipes against authoritative catalog", () => {
      const validDesc = createValidDescriptorV2();
      const genuineTurbo = getSamplingRecipe("fl2va-turbo-8");
      const validTurboRecipe = genuineTurbo;

      // 1. Adversarial tamper: change expectedSteps to 20 and recompute recipeDigest
      const tamperedSteps = { ...genuineTurbo, expectedSteps: 20 };
      const rehashedSteps = {
        ...tamperedSteps,
        recipeDigest: computeSamplingRecipeDigest(tamperedSteps)
      };
      expect(() =>
        MinimaxH3ExperimentDescriptorV2Schema.parse({
          ...validDesc,
          samplingRecipe: rehashedSteps
        })
      ).toThrow(/samplingRecipe expectedSteps mismatch/);

      // 2. Adversarial tamper: swap diffusionModel to ref2va and recompute recipeDigest
      const tamperedModel = {
        ...genuineTurbo,
        diffusionModel: {
          ...genuineTurbo.diffusionModel,
          filename: PINNED_H3_CHECKPOINTS.ref2va.filename,
          sha256: PINNED_H3_CHECKPOINTS.ref2va.sha256
        }
      };
      const rehashedModel = {
        ...tamperedModel,
        recipeDigest: computeSamplingRecipeDigest(tamperedModel)
      };
      expect(() =>
        MinimaxH3ExperimentDescriptorV2Schema.parse({
          ...validDesc,
          samplingRecipe: rehashedModel
        })
      ).toThrow(/samplingRecipe diffusionModel mismatch/);

      // 3. Adversarial tamper: set lora to null and recompute recipeDigest
      const tamperedLora = { ...genuineTurbo, lora: null };
      const rehashedLora = {
        ...tamperedLora,
        recipeDigest: computeSamplingRecipeDigest(tamperedLora)
      };
      expect(() =>
        MinimaxH3ExperimentDescriptorV2Schema.parse({
          ...validDesc,
          samplingRecipe: rehashedLora
        })
      ).toThrow(/samplingRecipe lora mismatch/);

      // 4. Adversarial tamper: set wrong LoRA (ref2va turbo 4) and recompute recipeDigest
      const tamperedWrongLora = {
        ...genuineTurbo,
        lora: {
          filename: PINNED_H3_LORAS.ref2vaTurbo4.filename,
          sha256: PINNED_H3_LORAS.ref2vaTurbo4.sha256,
          sizeBytes: PINNED_H3_LORAS.ref2vaTurbo4.sizeBytes,
          strengthModel: 1.0,
          repository: "lightx2v/Minimax-h3-Turbo",
          revision: "3ec17a324ced54151364f24f8b5fb6bf7e26414f"
        }
      };
      const rehashedWrongLora = {
        ...tamperedWrongLora,
        recipeDigest: computeSamplingRecipeDigest(tamperedWrongLora)
      };
      expect(() =>
        MinimaxH3ExperimentDescriptorV2Schema.parse({
          ...validDesc,
          samplingRecipe: rehashedWrongLora
        })
      ).toThrow(/samplingRecipe lora mismatch/);

      // Direct MinimaxH3SamplingRecipeSchema validation against tampering
      expect(() => MinimaxH3SamplingRecipeSchema.parse(rehashedSteps)).toThrow(
        /samplingRecipe expectedSteps mismatch/
      );
      expect(() => MinimaxH3SamplingRecipeSchema.parse(rehashedModel)).toThrow(
        /samplingRecipe diffusionModel mismatch/
      );
      expect(() => MinimaxH3SamplingRecipeSchema.parse(rehashedLora)).toThrow(
        /samplingRecipe lora mismatch/
      );
      expect(() => MinimaxH3SamplingRecipeSchema.parse(rehashedWrongLora)).toThrow(
        /samplingRecipe lora mismatch/
      );

      const tamperedScheduler = { ...genuineTurbo, scheduler: "karras" as const };
      const rehashedScheduler = {
        ...tamperedScheduler,
        recipeDigest: computeSamplingRecipeDigest(tamperedScheduler)
      };
      expect(() => MinimaxH3SamplingRecipeSchema.parse(rehashedScheduler)).toThrow(
        /samplingRecipe sampler\/scheduler\/denoise mismatch/
      );

      const tamperedShift = {
        ...genuineTurbo,
        sigmaShift: { enabled: true, videoShift: 10, audioShift: 3 }
      };
      const rehashedShift = {
        ...tamperedShift,
        recipeDigest: computeSamplingRecipeDigest(tamperedShift)
      };
      expect(() => MinimaxH3SamplingRecipeSchema.parse(rehashedShift)).toThrow(
        /samplingRecipe sigmaShift must be null or omitted/
      );

      // Adversarial tamper: LoRA strength modified (1.0 -> 0.5) and recomputed recipeDigest
      const tamperedStrength = {
        ...genuineTurbo,
        lora: { ...genuineTurbo.lora!, strengthModel: 0.5 }
      };
      const rehashedStrength = {
        ...tamperedStrength,
        recipeDigest: computeSamplingRecipeDigest(tamperedStrength)
      };
      expect(() =>
        MinimaxH3ExperimentDescriptorV2Schema.parse({
          ...validDesc,
          samplingRecipe: rehashedStrength
        })
      ).toThrow(/samplingRecipe lora mismatch/);
      expect(() => MinimaxH3SamplingRecipeSchema.parse(rehashedStrength)).toThrow(
        /samplingRecipe lora mismatch/
      );

      // Adversarial tamper: conditioningMode modified (frame_anchored -> reference_directed) and recomputed recipeDigest
      const tamperedCond = {
        ...genuineTurbo,
        conditioningMode: "reference_directed" as const
      };
      const rehashedCond = {
        ...tamperedCond,
        recipeDigest: computeSamplingRecipeDigest(tamperedCond)
      };
      expect(() =>
        MinimaxH3ExperimentDescriptorV2Schema.parse({
          ...validDesc,
          samplingRecipe: rehashedCond
        })
      ).toThrow(/samplingRecipe conditioningMode mismatch/);
      expect(() => MinimaxH3SamplingRecipeSchema.parse(rehashedCond)).toThrow(
        /samplingRecipe conditioningMode mismatch/
      );

      // Adversarial tamper on FastH3: sigmaShift modified and recomputed recipeDigest
      const fastH3ForTamperTest = getSamplingRecipe("fasth3-i2v-8");
      const tamperedFastH3Sigma = {
        ...fastH3ForTamperTest,
        sigmaShift: { enabled: true, videoShift: 15.0, audioShift: 5.0 }
      };
      const rehashedFastH3Sigma = {
        ...tamperedFastH3Sigma,
        recipeDigest: computeSamplingRecipeDigest(tamperedFastH3Sigma)
      };
      expect(() =>
        MinimaxH3ExperimentDescriptorV2Schema.parse({
          ...validDesc,
          samplingRecipe: rehashedFastH3Sigma
        })
      ).toThrow(/samplingRecipe sigmaShift mismatch/);
      expect(() => MinimaxH3SamplingRecipeSchema.parse(rehashedFastH3Sigma)).toThrow(
        /samplingRecipe sigmaShift mismatch/
      );

      // 5. Valid recipe parses cleanly
      const descWithValidRecipe = {
        ...validDesc,
        samplingRecipe: validTurboRecipe,
        stepOverride: 8,
        pinFileIdentities: {
          comfyuiCoreRevision: validTurboRecipe.requiredRuntimeRevision,
          minimaxH3Revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1",
          modelDigests: {
            diffusion: validTurboRecipe.diffusionModel.sha256,
            lora: validTurboRecipe.lora!.sha256
          }
        },
        resolvedModelPaths: {
          diffusion: {
            expectedHash: validTurboRecipe.diffusionModel.sha256,
            resolvedPath: `/models/diffusion_models/${validTurboRecipe.diffusionModel.filename}`,
            sizeBytes: validTurboRecipe.diffusionModel.sizeBytes
          },
          lora: {
            expectedHash: validTurboRecipe.lora!.sha256,
            resolvedPath: `/models/loras/${validTurboRecipe.lora!.filename}`,
            sizeBytes: validTurboRecipe.lora!.sizeBytes
          }
        },
        requiredRuntime: {
          ...validDesc.requiredRuntime,
          coreRevision: validTurboRecipe.requiredRuntimeRevision,
          requiredNodes: [{ name: "MiniMaxH3ImageToVideo" }, { name: "LoraLoaderModelOnly" }],
          sourceFileHashes: {
            "nodes.py": PINNED_COMFYUI_NODES_PY_SHA256,
            "comfy_extras/nodes_minimax_h3.py": PINNED_COMFYUI_NODES_MINIMAX_H3_PY_SHA256
          }
        },
        provenance: {
          ...validDesc.provenance,
          actualCheckpointHash: validTurboRecipe.diffusionModel.sha256,
          loadedModelHashes: {
            diffusion: validTurboRecipe.diffusionModel.sha256,
            lora: validTurboRecipe.lora!.sha256
          },
          samplerSettings: {
            sampler: validTurboRecipe.sampler,
            scheduler: validTurboRecipe.scheduler,
            steps: 8
          },
          comfyuiCoreRevision: validTurboRecipe.requiredRuntimeRevision
        }
      };
      expect(() => MinimaxH3ExperimentDescriptorV2Schema.parse(descWithValidRecipe)).not.toThrow();

      // 6. Adversarial tamper: mismatch in samplerSettings steps
      expect(() =>
        MinimaxH3ExperimentDescriptorV2Schema.parse({
          ...descWithValidRecipe,
          provenance: {
            ...descWithValidRecipe.provenance,
            samplerSettings: {
              ...descWithValidRecipe.provenance.samplerSettings,
              steps: 20
            }
          }
        })
      ).toThrow(/provenance.samplerSettings/);

      // 7. Adversarial tamper: missing LoraLoaderModelOnly in requiredNodes
      expect(() =>
        MinimaxH3ExperimentDescriptorV2Schema.parse({
          ...descWithValidRecipe,
          requiredRuntime: {
            ...descWithValidRecipe.requiredRuntime,
            requiredNodes: [{ name: "MiniMaxH3ImageToVideo" }]
          }
        })
      ).toThrow(/requires.*LoraLoaderModelOnly/);

      // 8. Adversarial tamper: wrong nodes.py hash in sourceFileHashes
      expect(() =>
        MinimaxH3ExperimentDescriptorV2Schema.parse({
          ...descWithValidRecipe,
          requiredRuntime: {
            ...descWithValidRecipe.requiredRuntime,
            sourceFileHashes: {
              "nodes.py": DUMMY_HASH_1,
              "comfy_extras/nodes_minimax_h3.py": PINNED_COMFYUI_NODES_MINIMAX_H3_PY_SHA256
            }
          }
        })
      ).toThrow(/Turbo recipe requires nodes\.py hash to match/);

      // Adversarial tamper: wrong comfy_extras/nodes_minimax_h3.py hash
      expect(() =>
        MinimaxH3ExperimentDescriptorV2Schema.parse({
          ...descWithValidRecipe,
          requiredRuntime: {
            ...descWithValidRecipe.requiredRuntime,
            sourceFileHashes: {
              "nodes.py": PINNED_COMFYUI_NODES_PY_SHA256,
              "comfy_extras/nodes_minimax_h3.py": DUMMY_HASH_1
            }
          }
        })
      ).toThrow(/Turbo recipe requires comfy_extras\/nodes_minimax_h3\.py hash to match/);

      // 9. FastH3 descriptor validation: requires block_sparse_triton, comfy-kitchen 0.2.34, torch, sigma shift, and all source hashes
      const genuineFastH3 = getSamplingRecipe("fasth3-i2v-8");
      const validFastH3Desc = {
        ...validDesc,
        samplingRecipe: genuineFastH3,
        stepOverride: 8,
        pinFileIdentities: {
          comfyuiCoreRevision: genuineFastH3.requiredRuntimeRevision,
          minimaxH3Revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1",
          modelDigests: {
            diffusion: genuineFastH3.diffusionModel.sha256
          }
        },
        resolvedModelPaths: {
          diffusion: {
            expectedHash: genuineFastH3.diffusionModel.sha256,
            resolvedPath: `/models/diffusion_models/${genuineFastH3.diffusionModel.filename}`,
            sizeBytes: genuineFastH3.diffusionModel.sizeBytes
          }
        },
        requiredRuntime: {
          ...validDesc.requiredRuntime,
          coreRevision: genuineFastH3.requiredRuntimeRevision,
          attentionKernel: "block_sparse_triton",
          sourceFileHashes: { ...FASTH3_COMFYUI_SOURCE_HASHES },
          requiredNodes: [
            { name: "MiniMaxH3ImageToVideo" },
            { name: "BlockSparseAttention" },
            { name: "ModelAttentionBackend" },
            { name: "MiniMaxH3SigmaShift" }
          ],
          pythonPackages: [
            { name: "torch", version: "2.5.1+cu124" },
            { name: "comfy-kitchen", version: "0.2.34" }
          ],
          pytorchBuild: "2.5.1+cu124"
        },
        provenance: {
          ...validDesc.provenance,
          actualCheckpointHash: genuineFastH3.diffusionModel.sha256,
          loadedModelHashes: {
            diffusion: genuineFastH3.diffusionModel.sha256
          },
          samplerSettings: {
            sampler: genuineFastH3.sampler,
            scheduler: genuineFastH3.scheduler,
            steps: 8
          },
          comfyuiCoreRevision: genuineFastH3.requiredRuntimeRevision
        }
      };
      expect(() => MinimaxH3ExperimentDescriptorV2Schema.parse(validFastH3Desc)).not.toThrow();

      // FastH3 with wrong attentionKernel is rejected
      expect(() =>
        MinimaxH3ExperimentDescriptorV2Schema.parse({
          ...validFastH3Desc,
          requiredRuntime: {
            ...validFastH3Desc.requiredRuntime,
            attentionKernel: "torch_sdpa"
          }
        })
      ).toThrow(/FastH3 recipe requires attentionKernel.*block_sparse_triton/);

      // FastH3 with wrong comfy-kitchen version is rejected
      expect(() =>
        MinimaxH3ExperimentDescriptorV2Schema.parse({
          ...validFastH3Desc,
          requiredRuntime: {
            ...validFastH3Desc.requiredRuntime,
            pythonPackages: [{ name: "comfy-kitchen", version: "0.2.7" }]
          }
        })
      ).toThrow(/FastH3 recipe requires pythonPackage.*comfy-kitchen.*0\.2\.34/);

      // FastH3 missing MiniMaxH3SigmaShift node is rejected
      expect(() =>
        MinimaxH3ExperimentDescriptorV2Schema.parse({
          ...validFastH3Desc,
          requiredRuntime: {
            ...validFastH3Desc.requiredRuntime,
            requiredNodes: [
              { name: "MiniMaxH3ImageToVideo" },
              { name: "BlockSparseAttention" },
              { name: "ModelAttentionBackend" }
            ]
          }
        })
      ).toThrow(/FastH3 recipe requires node .*MiniMaxH3SigmaShift/);

      // FastH3 with mismatched source file hash is rejected
      expect(() =>
        MinimaxH3ExperimentDescriptorV2Schema.parse({
          ...validFastH3Desc,
          requiredRuntime: {
            ...validFastH3Desc.requiredRuntime,
            sourceFileHashes: {
              ...FASTH3_COMFYUI_SOURCE_HASHES,
              "main.py": DUMMY_HASH_1
            }
          }
        })
      ).toThrow(/FastH3 recipe requires sourceFileHashes/);
    });
  });

  describe("Historical Artifact Readability and Derived Verification View", () => {
    it("parses historical v2 descriptor with non-default attention backend without attentionRequest", () => {
      const baseDesc = createValidDescriptorV2();
      const desc = {
        ...baseDesc,
        provenance: {
          ...baseDesc.provenance,
          requestedAttentionBackend: "sage"
        },
        experimentVariant: {
          variantName: "sage-test",
          variantReason: "historical test",
          purpose: "performance" as const,
          changedFactors: [
            {
              path: "attention.configuration" as const,
              before: {
                backend: "torch_sdpa",
                topologyDigest: DUMMY_HASH_1,
                patches: []
              },
              after: {
                backend: "sage",
                topologyDigest: DUMMY_HASH_2,
                patches: []
              },
              rationale: "Historical Sage comparison"
            }
          ]
        }
      };
      // Ensure attentionRequest is undefined
      delete (desc as Record<string, unknown>).attentionRequest;

      const parsed = MinimaxH3ExperimentDescriptorV2Schema.parse(desc);
      expect(parsed.provenance.requestedAttentionBackend).toBe("sage");
      expect(parsed.attentionRequest).toBeUndefined();
    });

    it("parses historical v2 completed result with non-default observed backend without attentionObservation", () => {
      const baseDesc = createValidDescriptorV2();
      const desc = {
        ...baseDesc,
        provenance: {
          ...baseDesc.provenance,
          requestedAttentionBackend: "sage"
        }
      };
      delete (desc as Record<string, unknown>).attentionRequest;

      const template = createEmptyMinimaxH3MeasurementTemplateV2(desc);
      const promptId = "prompt-001";
      const completedResult = {
        ...template,
        lifecycle: "completed" as const,
        execution: {
          status: "completed" as const,
          promptId,
          terminalEvidence: {
            source: "history" as const,
            status: "success",
            rawDetails: { [promptId]: { status: "success" } }
          },
          engineError: null,
          latencyMs: 5000
        },
        observedProvenance: {
          ...template.observedProvenance,
          observedAttentionBackend: {
            status: "verified" as const,
            effectiveBackend: "sage",
            dispatchImplementation: "sageattention.sageattn"
          }
        }
      };
      // Ensure attentionObservation is undefined
      delete (completedResult as Record<string, unknown>).attentionObservation;

      const parsed = MinimaxH3ExperimentResultV2Schema.parse(completedResult);
      expect(parsed.observedProvenance.observedAttentionBackend?.effectiveBackend).toBe("sage");
      expect(parsed.attentionObservation).toBeUndefined();

      // Derived verification view maps absent observation to status: "unknown"
      const view = getDerivedAttentionVerificationView(desc, parsed);
      expect(view.status).toBe("unknown");
      expect(view.actualBackend).toBe("sage");
      expect(view.dispatchImplementation).toBe("sageattention.sageattn");
      expect(view.acceleratedCallCount).toBe(0);
      expect(view.timings.timingUnavailableReason).toContain("Historical artifact");
    });

    it("preserves modern attentionObservation in getDerivedAttentionVerificationView", () => {
      const observation = {
        status: "verified" as const,
        actualBackend: "sage",
        dispatchImplementation: "sageattention.sageattn",
        acceleratedCallCount: 20,
        denseCallCount: 0,
        plannedDenseCallCount: 0,
        fallbackEvents: [],
        stepRecords: [],
        failureReason: null,
        missingKernelFailure: null,
        dtypeLayoutDiagnostics: null,
        measurementCoverage: {
          samplingCallsRecorded: 20,
          attentionCallsRecorded: 20,
          complete: true
        },
        timings: {
          deviceElapsedMs: 1200,
          kernelElapsedMs: 1100
        }
      };

      const view = getDerivedAttentionVerificationView(null, {
        observedProvenance: null,
        attentionObservation: observation
      });
      expect(view).toBe(observation);
      expect(view.status).toBe("verified");
      expect(view.acceleratedCallCount).toBe(20);
    });
  });
});
