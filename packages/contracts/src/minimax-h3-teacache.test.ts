import { describe, it, expect } from "vitest";
import {
  MinimaxH3TeaCacheModeSchema,
  MinimaxH3TeaCacheRequestSchema,
  MinimaxH3TeaCacheObservationSchema,
  normalizeTeaCacheWindow,
  validateTeaCacheParameters,
  computeTeaCacheTopologyDigest,
  computeTeaCacheConfigDigest,
  createEmptyTeaCacheObservation,
  TEACACHE_UPSTREAM_COMMIT,
  TEACACHE_ADAPTER_VERSION,
  TEACACHE_NODE_KEY,
  type MinimaxH3TeaCacheRequest
} from "./minimax-h3-teacache.js";
import { MinimaxH3FactorChangeSchema } from "./minimax-h3-experiment-v2.js";

describe("MiniMax-H3 TeaCache Contracts", () => {
  describe("MinimaxH3TeaCacheModeSchema", () => {
    it("admits valid mode values", () => {
      expect(MinimaxH3TeaCacheModeSchema.parse("off")).toBe("off");
      expect(MinimaxH3TeaCacheModeSchema.parse("raw-l1-v1")).toBe("raw-l1-v1");
    });

    it("rejects unknown modes", () => {
      expect(() => MinimaxH3TeaCacheModeSchema.parse("taylor-v1")).toThrow();
      expect(() => MinimaxH3TeaCacheModeSchema.parse("residual-v2")).toThrow();
    });
  });

  describe("normalizeTeaCacheWindow & validateTeaCacheParameters", () => {
    it("normalizes negative endStep relative to totalSteps", () => {
      const res = normalizeTeaCacheWindow({
        startStep: 2,
        endStep: -2,
        totalSteps: 20
      });
      expect(res.normalizedStartStep).toBe(2);
      expect(res.normalizedEndStep).toBe(18);
      expect(res.totalSteps).toBe(20);
    });

    it("normalizes explicit positive endStep", () => {
      const res = normalizeTeaCacheWindow({
        startStep: 4,
        endStep: 16,
        totalSteps: 20
      });
      expect(res.normalizedStartStep).toBe(4);
      expect(res.normalizedEndStep).toBe(16);
    });

    it("rejects startStep < 2 to protect initial forward passes", () => {
      expect(() =>
        normalizeTeaCacheWindow({
          startStep: 0,
          endStep: 18,
          totalSteps: 20
        })
      ).toThrow(/startStep must be >= 2/);

      expect(() =>
        normalizeTeaCacheWindow({
          startStep: 1,
          endStep: 18,
          totalSteps: 20
        })
      ).toThrow(/startStep must be >= 2/);
    });

    it("rejects effectiveEnd > 18 to protect final refinement steps", () => {
      expect(() =>
        normalizeTeaCacheWindow({
          startStep: 2,
          endStep: 19,
          totalSteps: 20
        })
      ).toThrow(/effective endStep must be <= 18/);

      expect(() =>
        normalizeTeaCacheWindow({
          startStep: 2,
          endStep: -1,
          totalSteps: 20
        })
      ).toThrow(/effective endStep must be <= 18/);
    });

    it("rejects empty or inverted window", () => {
      expect(() =>
        normalizeTeaCacheWindow({
          startStep: 10,
          endStep: 10,
          totalSteps: 20
        })
      ).toThrow(/empty or inverted/);

      expect(() =>
        normalizeTeaCacheWindow({
          startStep: 12,
          endStep: 8,
          totalSteps: 20
        })
      ).toThrow(/empty or inverted/);
    });

    it("rejects totalSteps other than 20", () => {
      expect(() =>
        normalizeTeaCacheWindow({
          startStep: 2,
          endStep: 18,
          totalSteps: 8
        })
      ).toThrow(/total_steps to be exactly 20/);
    });

    it("validates parameters and bounds relL1Thresh", () => {
      const valid = validateTeaCacheParameters({
        relL1Thresh: 0.15,
        startStep: 2,
        endStep: -2,
        totalSteps: 20
      });
      expect(valid.relL1Thresh).toBe(0.15);
      expect(valid.normalizedStartStep).toBe(2);
      expect(valid.normalizedEndStep).toBe(18);

      expect(() =>
        validateTeaCacheParameters({
          relL1Thresh: 0,
          startStep: 2,
          endStep: -2,
          totalSteps: 20
        })
      ).toThrow(/rel_l1_thresh must be one of/);

      expect(() =>
        validateTeaCacheParameters({
          relL1Thresh: 0.6,
          startStep: 2,
          endStep: -2,
          totalSteps: 20
        })
      ).toThrow(/rel_l1_thresh must be one of/);

      expect(() =>
        validateTeaCacheParameters({
          relL1Thresh: 0.12,
          startStep: 2,
          endStep: -2,
          totalSteps: 20
        })
      ).toThrow(/rel_l1_thresh must be one of/);

      expect(() =>
        validateTeaCacheParameters({
          relL1Thresh: Number.NaN,
          startStep: 2,
          endStep: -2,
          totalSteps: 20
        })
      ).toThrow(/must be a finite number/);
    });
  });

  describe("MinimaxH3TeaCacheRequestSchema", () => {
    it("parses valid TeaCache request", () => {
      const req: MinimaxH3TeaCacheRequest = {
        mode: "raw-l1-v1",
        relL1Thresh: 0.15,
        startStep: 2,
        endStep: -2,
        totalSteps: 20,
        normalizedStartStep: 2,
        normalizedEndStep: 18,
        upstreamCommit: TEACACHE_UPSTREAM_COMMIT,
        adapterVersion: TEACACHE_ADAPTER_VERSION,
        adapterDigest: "a".repeat(64),
        catalogDigest: "b".repeat(64),
        topologyDigest: "c".repeat(64),
        patchNode: {
          nodeId: "401",
          classType: TEACACHE_NODE_KEY,
          inputs: {
            model: ["6", 0],
            rel_l1_thresh: 0.15,
            start_step: 2,
            end_step: -2,
            total_steps: 20
          }
        }
      };

      const parsed = MinimaxH3TeaCacheRequestSchema.parse(req);
      expect(parsed.mode).toBe("raw-l1-v1");
      expect(parsed.patchNode?.nodeId).toBe("401");
      expect(parsed.patchNode?.classType).toBe("CCOMiniMaxH3TeaCache");
    });
  });

  describe("MinimaxH3TeaCacheObservationSchema", () => {
    it("parses verified observation", () => {
      const obs = {
        status: "verified" as const,
        mode: "raw-l1-v1" as const,
        requestedConfig: {
          mode: "raw-l1-v1" as const,
          relL1Thresh: 0.15,
          startStep: 2,
          endStep: -2,
          totalSteps: 20 as const,
          normalizedStartStep: 2,
          normalizedEndStep: 18
        },
        effectiveConfig: {
          mode: "raw-l1-v1" as const,
          relL1Thresh: 0.15,
          startStep: 2,
          endStep: -2,
          totalSteps: 20 as const,
          normalizedStartStep: 2,
          normalizedEndStep: 18
        },
        totalSteps: 20,
        forwardCallsRecorded: 12,
        cacheHitsRecorded: 8,
        nestedForwardsOnHits: 0,
        coverage: {
          samplingCallsRecorded: 1,
          modelForwardsRecorded: 12,
          complete: true
        },
        timings: {
          samplingWallMs: 42100,
          modelForwardElapsedMs: 38200,
          decisionOverheadMs: 120,
          timingUnavailableReason: null
        },
        failureReason: null
      };

      const parsed = MinimaxH3TeaCacheObservationSchema.parse(obs);
      expect(parsed.status).toBe("verified");
      expect(parsed.forwardCallsRecorded).toBe(12);
      expect(parsed.cacheHitsRecorded).toBe(8);
    });

    it("parses no_op observation with zero hits", () => {
      const obs = {
        status: "no_op" as const,
        mode: "raw-l1-v1" as const,
        requestedConfig: null,
        effectiveConfig: null,
        totalSteps: 20,
        forwardCallsRecorded: 20,
        cacheHitsRecorded: 0,
        coverage: {
          samplingCallsRecorded: 1,
          modelForwardsRecorded: 20,
          complete: true
        },
        timings: {
          samplingWallMs: 58000,
          modelForwardElapsedMs: 56000,
          decisionOverheadMs: 150
        }
      };

      const parsed = MinimaxH3TeaCacheObservationSchema.parse(obs);
      expect(parsed.status).toBe("no_op");
      expect(parsed.cacheHitsRecorded).toBe(0);
    });
  });

  describe("FactorChangeCachingConfigSchema in MinimaxH3FactorChangeSchema", () => {
    it("parses caching.configuration factor change", () => {
      const factor = {
        path: "caching.configuration",
        before: {
          mode: "off",
          relL1Thresh: null,
          startStep: null,
          endStep: null,
          totalSteps: null,
          topologyDigest: "0".repeat(64),
          adapterVersion: null
        },
        after: {
          mode: "raw-l1-v1",
          relL1Thresh: 0.15,
          startStep: 2,
          endStep: -2,
          totalSteps: 20,
          topologyDigest: "1".repeat(64),
          adapterVersion: TEACACHE_ADAPTER_VERSION
        },
        rationale: "TeaCache timestep caching experiment"
      };

      const parsed = MinimaxH3FactorChangeSchema.parse(factor);
      expect(parsed.path).toBe("caching.configuration");
    });
  });

  describe("computeTeaCacheTopologyDigest & computeTeaCacheConfigDigest", () => {
    it("computes deterministic digests", () => {
      const patch = {
        nodeId: "401",
        classType: TEACACHE_NODE_KEY as typeof TEACACHE_NODE_KEY,
        inputs: {
          model: ["6", 0] as [string, number],
          rel_l1_thresh: 0.15,
          start_step: 2,
          end_step: -2,
          total_steps: 20
        }
      };

      const d1 = computeTeaCacheTopologyDigest(patch);
      const d2 = computeTeaCacheTopologyDigest(patch);
      expect(d1).toBe(d2);
      expect(d1).toMatch(/^[0-9a-f]{64}$/);

      const dNull = computeTeaCacheTopologyDigest(null);
      expect(dNull).not.toBe(d1);

      const cfgDigest = computeTeaCacheConfigDigest({
        workflowDigest: "a".repeat(64),
        argv: ["--listen"],
        teacacheConfig: {
          mode: "raw-l1-v1",
          relL1Thresh: 0.15,
          startStep: 2,
          endStep: -2,
          totalSteps: 20,
          normalizedStartStep: 2,
          normalizedEndStep: 18
        }
      });
      expect(cfgDigest).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("createEmptyTeaCacheObservation", () => {
    it("initializes empty observation with requested config and unknown timings", () => {
      const req: MinimaxH3TeaCacheRequest = {
        mode: "raw-l1-v1",
        relL1Thresh: 0.1,
        startStep: 2,
        endStep: 18,
        totalSteps: 20,
        normalizedStartStep: 2,
        normalizedEndStep: 18,
        upstreamCommit: TEACACHE_UPSTREAM_COMMIT,
        adapterVersion: TEACACHE_ADAPTER_VERSION,
        adapterDigest: "a".repeat(64),
        catalogDigest: "b".repeat(64),
        topologyDigest: "c".repeat(64),
        patchNode: {
          nodeId: "401",
          classType: TEACACHE_NODE_KEY,
          inputs: {
            model: ["6", 0],
            rel_l1_thresh: 0.1,
            start_step: 2,
            end_step: 18,
            total_steps: 20
          }
        }
      };

      const empty = createEmptyTeaCacheObservation(req);
      expect(empty.status).toBe("unknown");
      expect(empty.mode).toBe("raw-l1-v1");
      expect(empty.requestedConfig?.relL1Thresh).toBe(0.1);
      expect(empty.forwardCallsRecorded).toBeNull();
      expect(empty.cacheHitsRecorded).toBeNull();
      expect(empty.coverage.complete).toBe(false);
      expect(empty.timings.timingUnavailableReason).toBe("Prior to execution");
    });
  });
});
