import { describe, expect, it } from "vitest";
import {
  MinimaxH3AttentionVariantNameSchema,
  MinimaxH3AttentionCatalogEntrySchema,
  MinimaxH3AttentionObservationSchema,
  MinimaxH3AttentionStepRecordSchema,
  MinimaxH3AttentionExclusionMetadataSchema,
  computeAttentionTopologyDigest,
  computeAttentionCatalogDigest,
  computeAttentionRuntimeLockDigest,
  MinimaxH3CapabilityHandshakeSchema,
  compareDottedVersions,
  satisfiesDriverConstraint,
  type MinimaxH3AttentionCatalogEntry,
  type MinimaxH3AttentionPatchNode
} from "./minimax-h3-attention.js";
import { MinimaxH3PhaseAccountingEventSchema } from "./minimax-h3-experiment-v2.js";

describe("MiniMax-H3 Attention Contracts", () => {
  describe("MinimaxH3AttentionVariantNameSchema", () => {
    it("admits valid variant names", () => {
      expect(MinimaxH3AttentionVariantNameSchema.parse("dense")).toBe("dense");
      expect(MinimaxH3AttentionVariantNameSchema.parse("sage")).toBe("sage");
      expect(MinimaxH3AttentionVariantNameSchema.parse("native-sol-attn")).toBe("native-sol-attn");
      expect(MinimaxH3AttentionVariantNameSchema.parse("veda")).toBe("veda");
    });

    it("rejects unknown variant names", () => {
      expect(() => MinimaxH3AttentionVariantNameSchema.parse("flash-attn")).toThrow();
      expect(() => MinimaxH3AttentionVariantNameSchema.parse("xformers")).toThrow();
      expect(() => MinimaxH3AttentionVariantNameSchema.parse("")).toThrow();
    });
  });

  describe("computeAttentionTopologyDigest", () => {
    it("computes deterministic digest for empty patches (dense / sage)", () => {
      const digest1 = computeAttentionTopologyDigest([]);
      const digest2 = computeAttentionTopologyDigest([]);
      expect(digest1).toBe(digest2);
      expect(digest1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("computes different digests for different patches", () => {
      const patch1: MinimaxH3AttentionPatchNode = {
        nodeId: "301",
        classType: "ModelSparseAttention",
        inputs: { sparse_type: "sol-attn" }
      };
      const patch2: MinimaxH3AttentionPatchNode = {
        nodeId: "301",
        classType: "VedaSparseAttention",
        inputs: { predictor: "minimax_h3_ref2v_veda_predictor.safetensors" }
      };

      const digestEmpty = computeAttentionTopologyDigest([]);
      const digestSolAttn = computeAttentionTopologyDigest([patch1]);
      const digestVeda = computeAttentionTopologyDigest([patch2]);

      expect(digestSolAttn).not.toBe(digestEmpty);
      expect(digestVeda).not.toBe(digestEmpty);
      expect(digestSolAttn).not.toBe(digestVeda);
    });
  });

  describe("MinimaxH3AttentionCatalogEntrySchema & Digest", () => {
    const entryWithoutDigest: Omit<MinimaxH3AttentionCatalogEntry, "catalogDigest"> = {
      variantName: "native-sol-attn",
      route: "ref2v",
      compatibilityState: "requires_isolated_upgrade",
      scope: "native-sol-attn-ref2v",
      comfyuiCoreRevision: "94cfeb3a0efdb9d6d7be76f2d48c8b6b2fa983eb",
      runnable: false,
      backend: "sol_attn",
      kernel: "sol_attn",
      requiredNodes: [
        {
          name: "ModelSparseAttention",
          classType: "ModelSparseAttention"
        }
      ],
      pythonPackages: [
        {
          name: "torch",
          version: ">=2.4.0",
          importModule: "torch"
        }
      ],
      cudaRequirement: ">=12.4",
      computeCapability: "sm_89",
      supportedDtypes: ["bfloat16"],
      checkpointCompatibility: {
        filename: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
        sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
        taskMode: "ref2va_pruned_int8"
      },
      licensing: {
        status: "review_required",
        licenseSourceRef: "https://github.com/Comfy-Org/ComfyUI/blob/master/LICENSE",
        securityReviewStatus: "pending"
      },
      denseRegionPolicy: {
        allowPlannedDense: true,
        description: "Standard sparse attention policy"
      },
      isolationInstructions: {
        venvSetup: "venv",
        installRecipe: "recipe",
        teardownRecipe: "teardown"
      },
      blockers: ["Requires isolated ComfyUI checkout"],
      evidence: [
        {
          url: "https://github.com/Comfy-Org/ComfyUI",
          revision: "94cfeb3a0efdb9d6d7be76f2d48c8b6b2fa983eb",
          assertion: "ModelSparseAttention native node available"
        }
      ]
    };

    const catalogDigest = computeAttentionCatalogDigest(entryWithoutDigest);
    const validEntry: MinimaxH3AttentionCatalogEntry = {
      ...entryWithoutDigest,
      catalogDigest
    };

    it("parses valid catalog entry", () => {
      const parsed = MinimaxH3AttentionCatalogEntrySchema.parse(validEntry);
      expect(parsed.variantName).toBe("native-sol-attn");
      expect(parsed.compatibilityState).toBe("requires_isolated_upgrade");
    });

    it("computes deterministic catalog digest", () => {
      const digest = computeAttentionCatalogDigest(entryWithoutDigest);
      expect(digest).toBe(catalogDigest);
      expect(digest).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("MinimaxH3AttentionObservationSchema", () => {
    it("validates verified observation", () => {
      const obs = MinimaxH3AttentionObservationSchema.parse({
        status: "verified",
        actualBackend: "sage",
        dispatchImplementation: "sageattention.sageattn",
        acceleratedCallCount: 40,
        denseCallCount: 0,
        plannedDenseCallCount: 0,
        fallbackEvents: [],
        missingKernelFailure: null,
        failureReason: null,
        measurementCoverage: {
          samplingCallsRecorded: 1,
          attentionCallsRecorded: 40,
          complete: true
        },
        timings: {
          deviceElapsedMs: null,
          kernelElapsedMs: null,
          timingUnavailableReason: "GPU profiler not attached"
        }
      });
      expect(obs.status).toBe("verified");
      expect(obs.acceleratedCallCount).toBe(40);
    });

    it("validates fallback observation with fallback events", () => {
      const obs = MinimaxH3AttentionObservationSchema.parse({
        status: "fallback",
        actualBackend: "torch_sdpa",
        dispatchImplementation: "torch.nn.functional.scaled_dot_product_attention",
        acceleratedCallCount: 0,
        denseCallCount: 40,
        plannedDenseCallCount: 0,
        fallbackEvents: [
          {
            stepIndex: 0,
            layerIndex: 1,
            requestedBackend: "sage",
            fallbackBackend: "torch_sdpa",
            reason: "Mask layout unsupported",
            monotonicMs: 12345.67
          }
        ],
        missingKernelFailure: null,
        failureReason: "Fallback occurred on layer 1",
        measurementCoverage: {
          samplingCallsRecorded: 1,
          attentionCallsRecorded: 40,
          complete: true
        },
        timings: {
          deviceElapsedMs: null,
          kernelElapsedMs: null
        }
      });
      expect(obs.status).toBe("fallback");
      expect(obs.fallbackEvents).toHaveLength(1);
    });
  });

  describe("MinimaxH3AttentionStepRecordSchema & Metadata", () => {
    it("admits step record without metadata", () => {
      const parsed = MinimaxH3AttentionStepRecordSchema.parse({
        stepIndex: 2,
        layerIndex: 4,
        backend: "torch_sdpa",
        implementation: "torch.nn.functional.scaled_dot_product_attention",
        callType: "dense",
        monotonicMs: 1234.56
      });
      expect(parsed.stepIndex).toBe(2);
      expect(parsed.callType).toBe("dense");
      expect(parsed.metadata).toBeUndefined();
    });

    it("admits planned_dense step record with verified exclusion metadata", () => {
      const meta = MinimaxH3AttentionExclusionMetadataSchema.parse({
        patchClass: "VedaSparseAttention",
        hook: "forward",
        decisionMethod: "_dense_reason",
        reason: "full-attention layer",
        layer: 0,
        step: null
      });
      expect(meta.reason).toBe("full-attention layer");

      const record = MinimaxH3AttentionStepRecordSchema.parse({
        stepIndex: 0,
        layerIndex: 0,
        backend: "torch_sdpa",
        implementation: "torch.nn.functional.scaled_dot_product_attention",
        callType: "planned_dense",
        monotonicMs: 4567.89,
        metadata: {
          patchClass: "VedaSparseAttention",
          hook: "forward",
          decisionMethod: "_dense_reason",
          reason: "full-attention layer",
          layer: 0
        }
      });
      expect(record.callType).toBe("planned_dense");
      expect(record.metadata?.reason).toBe("full-attention layer");
      expect(record.metadata?.patchClass).toBe("VedaSparseAttention");
    });

    it("parses phase accounting event containing planned dense step records with metadata", () => {
      const event = MinimaxH3PhaseAccountingEventSchema.parse({
        protocolVersion: "v2-jsonl",
        sequence: 1,
        runId: "run-01",
        attemptToken: "tok-01",
        spanId: "span-01",
        phase: "sampling",
        type: "point_event",
        boundarySource: "child_bootstrap",
        clockDomain: "mono_child",
        monotonicMs: 1234.5,
        metadata: {
          attentionEvent: "step_record",
          attentionCall: "planned_dense",
          attentionStepRecord: {
            stepIndex: 1,
            layerIndex: 0,
            backend: "torch_sdpa",
            implementation: "torch.nn.functional.scaled_dot_product_attention",
            callType: "planned_dense",
            monotonicMs: 123.45,
            metadata: {
              reason: "full-attention step",
              decisionMethod: "_block_reason",
              step: 1
            }
          },
          stepRecords: [
            {
              stepIndex: 1,
              layerIndex: 0,
              backend: "torch_sdpa",
              implementation: "torch.nn.functional.scaled_dot_product_attention",
              callType: "planned_dense",
              monotonicMs: 123.45,
              metadata: {
                reason: "full-attention step",
                decisionMethod: "_block_reason",
                step: 1
              }
            }
          ]
        }
      });
      expect(event.phase).toBe("sampling");
      expect(event.metadata?.attentionCall).toBe("planned_dense");
      expect(event.metadata?.attentionStepRecord?.metadata?.reason).toBe("full-attention step");
      expect(event.metadata?.stepRecords?.[0]?.metadata?.reason).toBe("full-attention step");
    });
  });

  describe("computeAttentionRuntimeLockDigest (Substrate Projection)", () => {
    const baseManifest = {
      comfyuiCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      sourceFileHashes: {
        "comfy/model_management.py":
          "1111111111111111111111111111111111111111111111111111111111111111",
        "main.py": "2222222222222222222222222222222222222222222222222222222222222222",
        "comfy/cli_args.py": "3333333333333333333333333333333333333333333333333333333333333333"
      },
      interpreter: {
        pythonVersion: "3.11.9",
        pythonExecutableHash: "4444444444444444444444444444444444444444444444444444444444444444",
        pythonAbi: "cpython-311-x86_64-linux-gnu",
        pythonCompiler: "GCC 11.4.0"
      },
      pytorchBuild: "2.5.1+cu124",
      cudaBuild: "12.4",
      driverConstraints: [">=550.00.00"],
      pythonPackages: [
        {
          name: "torch",
          version: "2.5.1+cu124",
          artifactHash: "5555555555555555555555555555555555555555555555555555555555555555",
          artifactMethod: "installed_record_sha256_v1"
        },
        {
          name: "sageattention",
          version: "2.1.1",
          artifactHash: "6666666666666666666666666666666666666666666666666666666666666666",
          artifactMethod: "installed_record_sha256_v1"
        }
      ],
      cudaRequirement: ">=12.4",
      computeCapability: "sm_89",
      instrumentationProtocol: "v2-jsonl",
      collectorDigest: "7777777777777777777777777777777777777777777777777777777777777777",
      hookManifestDigest: "8888888888888888888888888888888888888888888888888888888888888888",
      hooks: [
        {
          name: "sampler_hook",
          modulePath: "comfy.samplers",
          callable: "sample",
          phase: "sampling_step"
        }
      ]
    };

    it("computes deterministic digest and is insensitive to package or source key ordering", () => {
      const digest1 = computeAttentionRuntimeLockDigest(baseManifest);
      const reorderedManifest = {
        ...baseManifest,
        pythonPackages: [...baseManifest.pythonPackages].reverse(),
        sourceFileHashes: {
          "main.py": "2222222222222222222222222222222222222222222222222222222222222222",
          "comfy/cli_args.py": "3333333333333333333333333333333333333333333333333333333333333333",
          "comfy/model_management.py":
            "1111111111111111111111111111111111111111111111111111111111111111"
        }
      };
      const digest2 = computeAttentionRuntimeLockDigest(reorderedManifest);
      expect(digest1).toBe(digest2);
      expect(digest1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("normalizes computeCapability so sm_89 and 8.9 produce identical lock digests", () => {
      const digestSm = computeAttentionRuntimeLockDigest({
        ...baseManifest,
        computeCapability: "sm_89"
      });
      const digestDotted = computeAttentionRuntimeLockDigest({
        ...baseManifest,
        computeCapability: "8.9"
      });
      expect(digestSm).toBe(digestDotted);
    });

    it("projects packages to canonical identity, ignoring uncanonical fields like importModule", () => {
      const digestWithoutImport = computeAttentionRuntimeLockDigest(baseManifest);
      const digestWithImport = computeAttentionRuntimeLockDigest({
        ...baseManifest,
        pythonPackages: baseManifest.pythonPackages.map((p) => ({
          ...p,
          importModule: p.name === "torch" ? "torch" : "sageattention"
        }))
      });
      expect(digestWithImport).toBe(digestWithoutImport);
    });

    it("changes digest when any interpreter, toolchain, source file, package, or hook changes", () => {
      const baseDigest = computeAttentionRuntimeLockDigest(baseManifest);

      // Interpreter changed
      const changedPy = computeAttentionRuntimeLockDigest({
        ...baseManifest,
        interpreter: { ...baseManifest.interpreter, pythonVersion: "3.12.0" }
      });
      expect(changedPy).not.toBe(baseDigest);

      // Toolchain pytorchBuild changed
      const changedPt = computeAttentionRuntimeLockDigest({
        ...baseManifest,
        pytorchBuild: "2.6.0+cu124"
      });
      expect(changedPt).not.toBe(baseDigest);

      // cudaBuild changed
      const changedCuda = computeAttentionRuntimeLockDigest({
        ...baseManifest,
        cudaBuild: "12.6"
      });
      expect(changedCuda).not.toBe(baseDigest);

      // Source file hash changed
      const changedSrc = computeAttentionRuntimeLockDigest({
        ...baseManifest,
        sourceFileHashes: {
          ...baseManifest.sourceFileHashes,
          "main.py": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        }
      });
      expect(changedSrc).not.toBe(baseDigest);

      // Package artifact changed
      const changedPkg = computeAttentionRuntimeLockDigest({
        ...baseManifest,
        pythonPackages: [
          baseManifest.pythonPackages[0]!,
          {
            ...baseManifest.pythonPackages[1]!,
            artifactHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
          }
        ]
      });
      expect(changedPkg).not.toBe(baseDigest);

      // Collector changed
      const changedCollector = computeAttentionRuntimeLockDigest({
        ...baseManifest,
        collectorDigest: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      });
      expect(changedCollector).not.toBe(baseDigest);

      // Hook changed
      const changedHook = computeAttentionRuntimeLockDigest({
        ...baseManifest,
        hookManifestDigest: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
      });
      expect(changedHook).not.toBe(baseDigest);
    });

    it("rejects duplicate package identities or duplicate hooks", () => {
      expect(() =>
        computeAttentionRuntimeLockDigest({
          ...baseManifest,
          pythonPackages: [baseManifest.pythonPackages[0]!, baseManifest.pythonPackages[0]!]
        })
      ).toThrow(/Duplicate package identity/);

      expect(() =>
        computeAttentionRuntimeLockDigest({
          ...baseManifest,
          hooks: [baseManifest.hooks[0]!, baseManifest.hooks[0]!]
        })
      ).toThrow(/Duplicate hook identity/);
    });
  });

  describe("MinimaxH3CapabilityHandshakeSchema", () => {
    it("validates valid capability handshake payload", () => {
      const valid = {
        protocol: "v2-jsonl",
        protocolVersion: "v2-jsonl",
        runId: "run-001",
        attemptToken: "attempt-1",
        pid: 12345,
        nonce: "test-nonce-123",
        collectorDigest: "1111111111111111111111111111111111111111111111111111111111111111",
        hookManifestDigest: "2222222222222222222222222222222222222222222222222222222222222222",
        installedHooks: [
          {
            name: "sampler_hook",
            modulePath: "comfy.samplers",
            callable: "sample",
            phase: "sampling_step",
            attached: true
          }
        ],
        registeredNodes: {
          MiniMaxH3ImageToVideo: {
            className: "MiniMaxH3ImageToVideo",
            module: "comfy_extras.nodes_minimax_h3"
          }
        }
      };
      const parsed = MinimaxH3CapabilityHandshakeSchema.parse(valid);
      expect(parsed.runId).toBe("run-001");
      expect(parsed.registeredNodes.MiniMaxH3ImageToVideo?.className).toBe("MiniMaxH3ImageToVideo");
    });
  });

  describe("compareDottedVersions & satisfiesDriverConstraint (F-780279b3)", () => {
    it("compares valid dotted-numeric versions", () => {
      expect(compareDottedVersions("560.35.03", "550.00.00")).toBe(1);
      expect(compareDottedVersions("550.00.00", "560.35.03")).toBe(-1);
      expect(compareDottedVersions("550.00", "550.0.0")).toBe(0);
      expect(compareDottedVersions("12.4", "12.4.1")).toBe(-1);
      expect(compareDottedVersions("12.4.1", "12.4")).toBe(1);
    });

    it("rejects invalid dotted-numeric version formats in compareDottedVersions", () => {
      // Leading dot
      expect(() => compareDottedVersions(".550.00", "550.00")).toThrow(/Invalid dotted-numeric/);
      expect(() => compareDottedVersions("550.00", ".550.00")).toThrow(/Invalid dotted-numeric/);
      // Trailing dot
      expect(() => compareDottedVersions("550.00.", "550.00")).toThrow(/Invalid dotted-numeric/);
      expect(() => compareDottedVersions("550.00", "550.00.")).toThrow(/Invalid dotted-numeric/);
      // Doubled dot
      expect(() => compareDottedVersions("560..35.03", "550.00")).toThrow(/Invalid dotted-numeric/);
      expect(() => compareDottedVersions("550.00", "560..35.03")).toThrow(/Invalid dotted-numeric/);
      // Dot only
      expect(() => compareDottedVersions("...", "550.00")).toThrow(/Invalid dotted-numeric/);
      expect(() => compareDottedVersions(".", "550.00")).toThrow(/Invalid dotted-numeric/);
      // Empty string
      expect(() => compareDottedVersions("", "550.00")).toThrow(/Invalid dotted-numeric/);
      // Non-numeric
      expect(() => compareDottedVersions("550.00a", "550.00")).toThrow(/Invalid dotted-numeric/);
    });

    it("evaluates valid driver constraints", () => {
      expect(satisfiesDriverConstraint("560.35.03", ">=550.00.00").satisfied).toBe(true);
      expect(satisfiesDriverConstraint("540.35.03", ">=550.00.00").satisfied).toBe(false);
      expect(satisfiesDriverConstraint("550.00.00", "==550.00.00").satisfied).toBe(true);
      expect(satisfiesDriverConstraint("550.00.01", "<550.00.00").satisfied).toBe(false);
    });

    it("fails closed on malformed driver versions in satisfiesDriverConstraint", () => {
      expect(satisfiesDriverConstraint("560..35.03", ">=550.00.00").satisfied).toBe(false);
      expect(satisfiesDriverConstraint(".560.35.03", ">=550.00.00").satisfied).toBe(false);
      expect(satisfiesDriverConstraint("560.35.03.", ">=550.00.00").satisfied).toBe(false);
      expect(satisfiesDriverConstraint("...", ">=550.00.00").satisfied).toBe(false);
      expect(satisfiesDriverConstraint(".", ">=550.00.00").satisfied).toBe(false);
      expect(satisfiesDriverConstraint("", ">=550.00.00").satisfied).toBe(false);
    });

    it("fails closed on malformed driver constraints in satisfiesDriverConstraint", () => {
      expect(satisfiesDriverConstraint("560.35.03", ">=550..00").satisfied).toBe(false);
      expect(satisfiesDriverConstraint("560.35.03", ">=.550.00").satisfied).toBe(false);
      expect(satisfiesDriverConstraint("560.35.03", ">=550.00.").satisfied).toBe(false);
      expect(satisfiesDriverConstraint("560.35.03", ">=...").satisfied).toBe(false);
      expect(satisfiesDriverConstraint("560.35.03", ">=.").satisfied).toBe(false);
      expect(satisfiesDriverConstraint("560.35.03", ">=").satisfied).toBe(false);
      expect(satisfiesDriverConstraint("560.35.03", "").satisfied).toBe(false);
    });
  });
});
