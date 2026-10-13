import { describe, expect, it } from "vitest";
import {
  MinimaxH3ExperimentDescriptorV2Schema,
  MinimaxH3ExperimentResultV2Schema,
  MinimaxH3AnyExperimentDescriptorSchema,
  MinimaxH3PhaseRecordSchema,
  MinimaxH3RequiredRuntimeManifestSchema,
  MinimaxH3ExperimentVariantSchema,
  createEmptyMinimaxH3MeasurementTemplateV2,
  computeInvariantProjectionKey,
  PINNED_H3_CHECKPOINTS,
  type MinimaxH3ExperimentDescriptorV2,
  type MinimaxH3FactorChange
} from "./minimax-h3-experiment-v2.js";
import { sha256Hex } from "./minimax-h3-experiment.js";

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
    it("accepts a legacy v1 descriptor in MinimaxH3AnyExperimentDescriptorSchema", () => {
      const v1Prompt = "prompt v1";
      const v1PromptDigest = sha256Hex(v1Prompt);
      const v1Desc = {
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

      const parsed = MinimaxH3AnyExperimentDescriptorSchema.parse(v1Desc);
      expect(parsed.schemaVersion).toBe(1);
    });

    it("accepts a v2 descriptor in MinimaxH3AnyExperimentDescriptorSchema", () => {
      const v2Desc = createValidDescriptorV2();
      const parsed = MinimaxH3AnyExperimentDescriptorSchema.parse(v2Desc);
      expect(parsed.schemaVersion).toBe(2);
    });
  });
});
