import { describe, expect, it } from "vitest";
import { canonicalizeJson } from "./minimax-h3-experiment.js";
import {
  FASTH3_OMNI_LOCAL_SUPPORTED_FRAMES,
  FASTH3_OMNI_FPS,
  REACTOR_HOSTED_DISCRETE_DURATIONS,
  FASTH3_OMNI_COMFY_INT8_CHECKPOINT,
  FastH3OmniAuditSnapshotSchema,
  FastH3OmniCapabilitySchema,
  FastH3OmniCampaignExportManifestSchema,
  FastH3OmniBindingManifestSchema,
  FastH3OmniModelIdentitySchema,
  FastH3OmniRuntimeIdentitySchema,
  FastH3OmniPreparationSpecSchema,
  FastH3OmniReportSchema,
  computeFastH3OmniAuditDigest,
  computeFastH3OmniBindingDigest,
  computeFastH3OmniCapabilityDigest,
  computeFastH3OmniDescriptorDigest,
  computeFastH3OmniCommandDigest,
  createFastVideoSm89Capability,
  createDefaultFastH3OmniModelIdentity,
  createDefaultFastH3OmniRuntimeIdentity,
  createBlankFastH3OmniReport,
  createDefaultFastH3OmniAuditSnapshot,
  listFastH3OmniIdentityGaps
} from "./fasth3-omni-experiment.js";

describe("FastH3-Omni Experiment Contracts", () => {
  describe("Duration and Frame Invariants", () => {
    it("pins the authentic discrete frame counts for local FastVideo", () => {
      expect(FASTH3_OMNI_LOCAL_SUPPORTED_FRAMES).toEqual([124, 243, 362]);
      expect(FASTH3_OMNI_FPS).toBe(24);
      // 243 frames at 24fps = 10.125s (overlapping discrete duration with hosted schema)
      expect(243 / FASTH3_OMNI_FPS).toBe(10.125);
    });

    it("pins the discrete durations for Reactor hosted API", () => {
      expect(REACTOR_HOSTED_DISCRETE_DURATIONS).toEqual([5.875, 8.0, 10.125, 12.25, 14.375]);
      // 124 frames (5.1666...s) is NOT in the hosted discrete duration set
      expect(REACTOR_HOSTED_DISCRETE_DURATIONS).not.toContain(124 / 24);
    });

    it("pins published INT8 checkpoint digest and size", () => {
      expect(FASTH3_OMNI_COMFY_INT8_CHECKPOINT.sha256).toBe(
        "851b2dc9670ed864b7f1e951ac9da047d83b1c04ded9bfcc1a9e5bba0ee33f80"
      );
      expect(FASTH3_OMNI_COMFY_INT8_CHECKPOINT.sizeBytes).toBe(22213723064);
    });
  });

  describe("Canonical JSON & Hashing", () => {
    it("canonicalizes JSON deterministically regardless of key order", () => {
      const obj1 = { b: 2, a: 1, c: { z: 10, y: 20 } };
      const obj2 = { c: { y: 20, z: 10 }, a: 1, b: 2 };
      expect(canonicalizeJson(obj1)).toBe(canonicalizeJson(obj2));
      expect(canonicalizeJson(obj1)).toBe('{"a":1,"b":2,"c":{"y":20,"z":10}}');
    });

    it("computes descriptor digest excluding descriptorDigest field", () => {
      const spec = {
        runId: "run-001",
        readinessStatus: "offline_validated",
        descriptorDigest: "will-be-ignored"
      };
      const d1 = computeFastH3OmniDescriptorDigest(spec);
      const spec2 = {
        ...spec,
        descriptorDigest: "different-placeholder"
      };
      const d2 = computeFastH3OmniDescriptorDigest(spec2);
      expect(d1).toBe(d2);

      const modifiedSpec = { ...spec, runId: "run-002" };
      expect(computeFastH3OmniDescriptorDigest(modifiedSpec)).not.toBe(d1);
    });

    it("computes binding digest excluding bindingDigest field", () => {
      const manifest = {
        campaignId: "00000000-0000-0000-0000-000000000001",
        bindingDigest: "ignore-me"
      };
      const d1 = computeFastH3OmniBindingDigest(manifest);
      const d2 = computeFastH3OmniBindingDigest({
        ...manifest,
        bindingDigest: "other-digest"
      });
      expect(d1).toBe(d2);
    });

    it("computes command digest excluding commandDigest field", () => {
      const cmd = {
        argv: ["python", "-m", "fastvideo.inference"],
        commandDigest: "ignore-me"
      };
      const d1 = computeFastH3OmniCommandDigest(cmd);
      const d2 = computeFastH3OmniCommandDigest({
        ...cmd,
        commandDigest: "other-digest"
      });
      expect(d1).toBe(d2);
    });
  });

  describe("Audit Snapshot Schema", () => {
    it("validates the default audit snapshot successfully", () => {
      const snapshot = createDefaultFastH3OmniAuditSnapshot();
      const parsed = FastH3OmniAuditSnapshotSchema.parse(snapshot);
      expect(parsed.upstreamReleaseStatus).toBe("released");
      expect(parsed.claims.length).toBeGreaterThan(3);
      expect(parsed.rejectedCandidates.length).toBeGreaterThan(0);
      expect(parsed.auditDigest).toBe(computeFastH3OmniAuditDigest(snapshot));
    });

    it("rejects an invalid verification status", () => {
      const snapshot = createDefaultFastH3OmniAuditSnapshot();
      const invalidSnapshot = {
        ...snapshot,
        claims: [
          {
            ...snapshot.claims[0],
            status: "non_existent_status"
          }
        ]
      };
      expect(() => FastH3OmniAuditSnapshotSchema.parse(invalidSnapshot)).toThrow();
    });
  });

  describe("Capability Schema", () => {
    it("validates SM89 capability correctly", () => {
      const cap = createFastVideoSm89Capability();
      const parsed = FastH3OmniCapabilitySchema.parse(cap);
      expect(parsed.lane).toBe("isolated_fastvideo_sm89");
      expect(parsed.route).toBe("ref2va");
      expect(parsed.supportedFrames).toEqual([124, 243, 362]);
      expect(parsed.maxReferenceImages).toBe(9);
      expect(parsed.supportsKeyframes).toBe(false);
      expect(parsed.capabilityDigest).toBe(computeFastH3OmniCapabilityDigest(cap));
    });

    it("rejects empty supported frames", () => {
      const cap = {
        ...createFastVideoSm89Capability(),
        supportedFrames: []
      };
      expect(() => FastH3OmniCapabilitySchema.parse(cap)).toThrow();
    });
  });

  describe("Model and Runtime Identity Schemas", () => {
    it("validates default model identity", () => {
      const model = createDefaultFastH3OmniModelIdentity();
      const parsed = FastH3OmniModelIdentitySchema.parse(model);
      expect(parsed.modelFamily).toBe("FastH3-Omni");
      expect(parsed.scheduler.steps).toBe(8);
      expect(parsed.textEncoder.revision).toBeNull();
      expect(parsed.adalnTable).toBeNull();
      expect(
        listFastH3OmniIdentityGaps(parsed, createDefaultFastH3OmniRuntimeIdentity()).length
      ).toBeGreaterThan(0);
    });

    it("validates default runtime identity", () => {
      const runtime = createDefaultFastH3OmniRuntimeIdentity();
      const parsed = FastH3OmniRuntimeIdentitySchema.parse(runtime);
      expect(parsed.computeCapability).toBe("8.9");
      expect(parsed.layerwiseStreaming).toBe(true);
      expect(parsed.residentBlocks).toBeNull();
      expect(parsed.pythonVersion).toBeNull();
    });
  });

  describe("Audit evidence integrity", () => {
    it("never carries a padded or fabricated evidence digest", () => {
      const snapshot = createDefaultFastH3OmniAuditSnapshot();
      for (const claim of snapshot.claims) {
        expect(claim.evidenceDigest ?? null).toBeNull();
        if (claim.status === "verified") {
          expect(claim.upstreamLfsSha256).toBeTruthy();
        }
      }
    });

    it("rejects a verified claim without any digest", () => {
      const snapshot = createDefaultFastH3OmniAuditSnapshot();
      const bad = {
        ...snapshot,
        claims: [{ ...snapshot.claims[0]!, status: "verified" as const }]
      };
      expect(FastH3OmniAuditSnapshotSchema.safeParse(bad).success).toBe(false);
    });
  });

  describe("Campaign Export Manifest Schema", () => {
    it("validates campaign export manifest with 3 references", () => {
      const manifest = {
        campaignId: "11111111-1111-1111-1111-111111111111",
        sceneId: "22222222-2222-2222-2222-222222222222",
        specRevision: 1,
        referenceSetId: "33333333-3333-3333-3333-333333333333",
        exportDigest: "a".repeat(64),
        createdAt: "2026-10-29T10:00:00Z",
        orderedReferences: [
          {
            assetId: "44444444-4444-4444-4444-444444444444",
            contentHashSha256: "b".repeat(64),
            mimeType: "image/png" as const,
            width: 1024,
            height: 1024,
            semanticPurposes: ["subject_identity" as const]
          },
          {
            assetId: "55555555-5555-5555-5555-555555555555",
            contentHashSha256: "c".repeat(64),
            mimeType: "image/png" as const,
            width: 1024,
            height: 1024,
            semanticPurposes: ["wardrobe" as const]
          },
          {
            assetId: "66666666-6666-6666-6666-666666666666",
            contentHashSha256: "d".repeat(64),
            mimeType: "image/jpeg" as const,
            width: 1024,
            height: 1024,
            semanticPurposes: ["product" as const]
          }
        ]
      };
      const parsed = FastH3OmniCampaignExportManifestSchema.parse(manifest);
      expect(parsed.orderedReferences).toHaveLength(3);
    });

    it("rejects unsupported MIME types in references", () => {
      const manifest = {
        campaignId: "11111111-1111-1111-1111-111111111111",
        sceneId: "22222222-2222-2222-2222-222222222222",
        specRevision: 1,
        referenceSetId: "33333333-3333-3333-3333-333333333333",
        exportDigest: "a".repeat(64),
        createdAt: "2026-10-29T10:00:00Z",
        orderedReferences: [
          {
            assetId: "44444444-4444-4444-4444-444444444444",
            contentHashSha256: "b".repeat(64),
            mimeType: "application/pdf",
            width: 1024,
            height: 1024,
            semanticPurposes: ["subject_identity" as const]
          }
        ]
      };
      expect(() => FastH3OmniCampaignExportManifestSchema.parse(manifest)).toThrow();
    });
  });

  describe("Binding Manifest Schema", () => {
    it("validates slot bindings with strict <Picture N> tag syntax", () => {
      const bindingManifest = {
        schemaVersion: 1 as const,
        bindingDigest: "e".repeat(64),
        campaignId: "11111111-1111-1111-1111-111111111111",
        sceneId: "22222222-2222-2222-2222-222222222222",
        specRevision: 1,
        referenceSetId: "33333333-3333-3333-3333-333333333333",
        orderedBindings: [
          {
            slotIndex: 0,
            tag: "<Picture 1>",
            assetId: "44444444-4444-4444-4444-444444444444",
            contentHashSha256: "b".repeat(64),
            semanticPurposes: ["subject_identity" as const],
            boundOrder: 0
          }
        ],
        sourcePrompt: "A portrait of <Picture 1>",
        renderedPrompt: "A portrait of <Picture 1>",
        promptDigest: "f".repeat(64)
      };
      const parsed = FastH3OmniBindingManifestSchema.parse(bindingManifest);
      expect(parsed.orderedBindings[0]?.tag).toBe("<Picture 1>");
    });

    it("rejects invalid picture tag format", () => {
      const bindingManifest = {
        schemaVersion: 1 as const,
        bindingDigest: "e".repeat(64),
        campaignId: "11111111-1111-1111-1111-111111111111",
        sceneId: "22222222-2222-2222-2222-222222222222",
        specRevision: 1,
        referenceSetId: "33333333-3333-3333-3333-333333333333",
        orderedBindings: [
          {
            slotIndex: 0,
            tag: "Picture 1", // Missing < >
            assetId: "44444444-4444-4444-4444-444444444444",
            contentHashSha256: "b".repeat(64),
            semanticPurposes: ["subject_identity" as const],
            boundOrder: 0
          }
        ],
        sourcePrompt: "A portrait of <Picture 1>",
        renderedPrompt: "A portrait of <Picture 1>",
        promptDigest: "f".repeat(64)
      };
      expect(() => FastH3OmniBindingManifestSchema.parse(bindingManifest)).toThrow();
    });
  });

  describe("Preparation Spec & Blank Report Schemas", () => {
    it("validates a prepared offline specification with privacy fences", () => {
      const spec = {
        schemaVersion: 1 as const,
        runId: "omni-run-001",
        descriptorDigest: "1".repeat(64),
        readinessStatus: "offline_validated" as const,
        isExecutable: false,
        executionBlockers: ["Runtime unverified on target host", "License review required"],
        auditSnapshot: createDefaultFastH3OmniAuditSnapshot(),
        capability: createFastVideoSm89Capability(),
        modelIdentity: createDefaultFastH3OmniModelIdentity(),
        runtimeIdentity: createDefaultFastH3OmniRuntimeIdentity(),
        bindingManifest: {
          schemaVersion: 1 as const,
          bindingDigest: "2".repeat(64),
          campaignId: "11111111-1111-1111-1111-111111111111",
          sceneId: "22222222-2222-2222-2222-222222222222",
          specRevision: 1,
          referenceSetId: "33333333-3333-3333-3333-333333333333",
          orderedBindings: [
            {
              slotIndex: 0,
              tag: "<Picture 1>",
              assetId: "44444444-4444-4444-4444-444444444444",
              contentHashSha256: "b".repeat(64),
              semanticPurposes: ["subject_identity" as const],
              boundOrder: 0
            }
          ],
          sourcePrompt: "A video of <Picture 1>",
          renderedPrompt: "A video of <Picture 1>",
          promptDigest: "3".repeat(64)
        },
        renderParams: {
          width: 832,
          height: 480,
          frames: 124,
          fps: 24,
          seed: 42
        },
        commandSpec: {
          argv: ["python", "-m", "fastvideo.inference"],
          environment: { CUDA_VISIBLE_DEVICES: "0" },
          configFilePath: "/path/to/config.yaml",
          commandDigest: "4".repeat(64)
        },
        timeouts: {
          startupTimeoutMs: 120000,
          renderTimeoutMs: 600000,
          probeTimeoutMs: 30000,
          shutdownTimeoutMs: 30000
        },
        privacyPolicy: {
          allowRemoteAssetUpload: false as const,
          containmentRoot: ".ai-runs/fasth3-omni-experiments"
        }
      };

      const parsed = FastH3OmniPreparationSpecSchema.parse(spec);
      expect(parsed.privacyPolicy.allowRemoteAssetUpload).toBe(false);
      expect(parsed.isExecutable).toBe(false);
    });

    it("rejects a preparation spec attempting to allow remote asset uploads", () => {
      const spec = {
        schemaVersion: 1 as const,
        runId: "omni-run-001",
        descriptorDigest: "1".repeat(64),
        readinessStatus: "offline_validated" as const,
        isExecutable: false,
        executionBlockers: [],
        auditSnapshot: createDefaultFastH3OmniAuditSnapshot(),
        capability: createFastVideoSm89Capability(),
        modelIdentity: createDefaultFastH3OmniModelIdentity(),
        runtimeIdentity: createDefaultFastH3OmniRuntimeIdentity(),
        bindingManifest: {
          schemaVersion: 1 as const,
          bindingDigest: "2".repeat(64),
          campaignId: "11111111-1111-1111-1111-111111111111",
          sceneId: "22222222-2222-2222-2222-222222222222",
          specRevision: 1,
          referenceSetId: "33333333-3333-3333-3333-333333333333",
          orderedBindings: [
            {
              slotIndex: 0,
              tag: "<Picture 1>",
              assetId: "44444444-4444-4444-4444-444444444444",
              contentHashSha256: "b".repeat(64),
              semanticPurposes: ["subject_identity" as const],
              boundOrder: 0
            }
          ],
          sourcePrompt: "A video of <Picture 1>",
          renderedPrompt: "A video of <Picture 1>",
          promptDigest: "3".repeat(64)
        },
        renderParams: {
          width: 832,
          height: 480,
          frames: 124,
          fps: 24,
          seed: 42
        },
        timeouts: {
          startupTimeoutMs: 120000,
          renderTimeoutMs: 600000,
          probeTimeoutMs: 30000,
          shutdownTimeoutMs: 30000
        },
        privacyPolicy: {
          allowRemoteAssetUpload: true as unknown as false, // Violation!
          containmentRoot: ".ai-runs/fasth3-omni-experiments"
        }
      };

      expect(() => FastH3OmniPreparationSpecSchema.parse(spec)).toThrow();
    });

    it("creates a blank report satisfying governance exit-gate boundary", () => {
      const blankReport = createBlankFastH3OmniReport("run-001", "a".repeat(64));
      const parsed = FastH3OmniReportSchema.parse(blankReport);
      expect(parsed.evaluationStatus).toBe("PENDING");
      expect(parsed.speedSignOff).toBe("PENDING");
      expect(parsed.aestheticSignOff).toBe("PENDING");
      expect(parsed.operatorDisposition).toBe("PENDING");
      expect(parsed.metrics.totalWallTimeMs).toBeNull();
      expect(parsed.probe.fileSha256).toBeNull();
      expect(parsed.aesthetic.referenceFidelityScore).toBeNull();
    });
  });
});
