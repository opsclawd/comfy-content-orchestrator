import { describe, expect, it } from "vitest";
import {
  MinimaxH3AttentionVariantNameSchema,
  MinimaxH3AttentionCatalogEntrySchema,
  MinimaxH3AttentionObservationSchema,
  MinimaxH3AttentionStepRecordSchema,
  MinimaxH3AttentionExclusionMetadataSchema,
  computeAttentionTopologyDigest,
  computeAttentionCatalogDigest,
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
});
