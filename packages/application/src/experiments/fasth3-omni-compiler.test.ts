import { describe, expect, it } from "vitest";
import {
  computeFastH3OmniAuditDigest,
  createDefaultFastH3OmniAuditSnapshot,
  createDefaultFastH3OmniModelIdentity,
  createDefaultFastH3OmniRuntimeIdentity,
  createFastVideoSm89Capability
} from "@cco/contracts";
import { mapCampaignReferencesToFastH3OmniBindings } from "./fasth3-omni-reference-mapper.js";
import {
  compileFastH3OmniSpecification,
  generateFastVideoYamlConfig
} from "./fasth3-omni-compiler.js";

describe("FastH3-Omni Compiler", () => {
  const capability = createFastVideoSm89Capability();
  const auditSnapshot = createDefaultFastH3OmniAuditSnapshot();
  const modelIdentity = createDefaultFastH3OmniModelIdentity();
  const runtimeIdentity = createDefaultFastH3OmniRuntimeIdentity();

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

  const prompt =
    "A shot of <Picture 1> wearing <Picture 2> holding <Picture 3> in the morning light";
  const bindingManifest = mapCampaignReferencesToFastH3OmniBindings({
    manifest,
    prompt,
    capability
  });

  it("compiles valid offline specification for 124 frames (832x480, 24fps)", () => {
    const spec = compileFastH3OmniSpecification({
      runId: "run-omni-001",
      auditSnapshot,
      capability,
      modelIdentity,
      runtimeIdentity,
      bindingManifest,
      renderParams: {
        width: 832,
        height: 480,
        frames: 124,
        fps: 24,
        seed: 42
      }
    });

    expect(spec.runId).toBe("run-omni-001");
    expect(spec.readinessStatus).toBe("blocked_license_review");
    expect(spec.isExecutable).toBe(false);
    expect(spec.executionBlockers.length).toBeGreaterThan(0);
    expect(spec.commandSpec ?? null).toBeNull();
    expect(spec.upstreamRecipe ?? null).toBeNull();
    expect(spec.timeouts.startupTimeoutMs).toBeNull();
    expect(spec.descriptorDigest).toBeDefined();
    expect(spec.privacyPolicy.allowRemoteAssetUpload).toBe(false);
  });

  it("compiles valid offline specification for 243 frames (10.125s, 832x480)", () => {
    const spec = compileFastH3OmniSpecification({
      runId: "run-omni-002",
      auditSnapshot,
      capability,
      modelIdentity,
      runtimeIdentity,
      bindingManifest,
      renderParams: {
        width: 832,
        height: 480,
        frames: 243,
        fps: 24,
        seed: 12345
      }
    });

    expect(spec.renderParams.frames).toBe(243);
    expect(spec.renderParams.frames / spec.renderParams.fps).toBe(10.125);
  });

  it("rejects off-grid frame count (e.g. 192 frames)", () => {
    expect(() =>
      compileFastH3OmniSpecification({
        runId: "run-omni-003",
        auditSnapshot,
        capability,
        modelIdentity,
        runtimeIdentity,
        bindingManifest,
        renderParams: {
          width: 832,
          height: 480,
          frames: 192, // Not in [124, 243, 362]
          fps: 24,
          seed: 42
        }
      })
    ).toThrow(/Requested frame count 192 is not in supported discrete frame set/);
  });

  it("rejects unsupported FPS (e.g. 30 FPS)", () => {
    expect(() =>
      compileFastH3OmniSpecification({
        runId: "run-omni-004",
        auditSnapshot,
        capability,
        modelIdentity,
        runtimeIdentity,
        bindingManifest,
        renderParams: {
          width: 832,
          height: 480,
          frames: 124,
          fps: 30, // Capability requires 24
          seed: 42
        }
      })
    ).toThrow(/does not match supported FPS 24/);
  });

  it("rejects unsupported resolution", () => {
    expect(() =>
      compileFastH3OmniSpecification({
        runId: "run-omni-005",
        auditSnapshot,
        capability,
        modelIdentity,
        runtimeIdentity,
        bindingManifest,
        renderParams: {
          width: 1920,
          height: 1080,
          frames: 124,
          fps: 24,
          seed: 42
        }
      })
    ).toThrow(/Requested resolution 1920x1080 is not supported/);
  });

  it("rejects incompatible compute capability (e.g. SM80)", () => {
    const invalidRuntime = {
      ...runtimeIdentity,
      computeCapability: "8.0"
    };
    expect(() =>
      compileFastH3OmniSpecification({
        runId: "run-omni-006",
        auditSnapshot,
        capability,
        modelIdentity,
        runtimeIdentity: invalidRuntime,
        bindingManifest,
        renderParams: {
          width: 832,
          height: 480,
          frames: 124,
          fps: 24,
          seed: 42
        }
      })
    ).toThrow(/requires SM89/);
  });

  it("rejects NVFP4 precision on SM89 (Blackwell requirement fence)", () => {
    const invalidModel = {
      ...modelIdentity,
      textEncoder: {
        ...modelIdentity.textEncoder,
        precision: "nvfp4"
      }
    };
    expect(() =>
      compileFastH3OmniSpecification({
        runId: "run-omni-007",
        auditSnapshot,
        capability,
        modelIdentity: invalidModel,
        runtimeIdentity,
        bindingManifest,
        renderParams: {
          width: 832,
          height: 480,
          frames: 124,
          fps: 24,
          seed: 42
        }
      })
    ).toThrow(/NVFP4 precision requires NVIDIA Blackwell/);
  });

  it("rejects when layerwise streaming is disabled", () => {
    const invalidRuntime = {
      ...runtimeIdentity,
      layerwiseStreaming: false
    };
    expect(() =>
      compileFastH3OmniSpecification({
        runId: "run-omni-008",
        auditSnapshot,
        capability,
        modelIdentity,
        runtimeIdentity: invalidRuntime,
        bindingManifest,
        renderParams: {
          width: 832,
          height: 480,
          frames: 124,
          fps: 24,
          seed: 42
        }
      })
    ).toThrow(/Layerwise FP8 streaming is mandatory/);
  });

  it("generates deterministic FastVideo YAML configuration", () => {
    const spec = compileFastH3OmniSpecification({
      runId: "run-omni-yaml",
      auditSnapshot,
      capability,
      modelIdentity,
      runtimeIdentity,
      bindingManifest,
      renderParams: {
        width: 832,
        height: 480,
        frames: 124,
        fps: 24,
        seed: 42
      }
    });

    expect(generateFastVideoYamlConfig(spec)).toBeNull();
  });

  const completeModel = {
    ...modelIdentity,
    diffusionShards: [
      { filename: "synthetic-shard-0.safetensors", sha256: "c".repeat(64), sizeBytes: 10 }
    ],
    diffusionShardIndexSha256: "d".repeat(64),
    quantization: "synthetic",
    textEncoder: { repository: "synthetic/enc", revision: "e".repeat(40), precision: "bf16" },
    visionTower: { repository: "synthetic/vis", revision: "f".repeat(40), precision: "bf16" },
    videoVae: { repository: "synthetic/vae", revision: "1".repeat(40) },
    audioVae: { repository: "synthetic/avae", revision: "2".repeat(40) },
    adalnTable: {
      filename: "synthetic.pt",
      sha256: "3".repeat(64),
      generationCommandDigest: "4".repeat(64)
    },
    dependencyLockSha256: "5".repeat(64)
  };
  const completeRuntime = {
    ...runtimeIdentity,
    pythonVersion: "synthetic",
    pytorchVersion: "synthetic",
    cudaVersion: "synthetic",
    attentionKernel: "synthetic",
    residentBlocks: 16
  };
  // Synthetic audit without the license-review claim, so only identity/limit gating is exercised.
  const noLicenseAudit = (() => {
    const base = {
      schemaVersion: 1 as const,
      retrievedAt: auditSnapshot.retrievedAt,
      upstreamReleaseStatus: auditSnapshot.upstreamReleaseStatus,
      claims: auditSnapshot.claims.filter((c) => c.status !== "review_required"),
      rejectedCandidates: auditSnapshot.rejectedCandidates
    };
    return { ...base, auditDigest: computeFastH3OmniAuditDigest(base) };
  })();
  const baseRender = { width: 832, height: 480, frames: 124, fps: 24, seed: 42 };
  const limits = {
    startupTimeoutMs: 1,
    renderTimeoutMs: 1,
    probeTimeoutMs: 1,
    shutdownTimeoutMs: 1,
    maxVramMb: 1,
    maxHostRamMb: 1,
    maxSwapMb: 0
  };
  const syntheticRecipe = {
    sourceUrl: "https://example.invalid/synthetic-recipe.yaml",
    sourceCommit: "synthetic",
    sourceSha256: "6".repeat(64),
    configText: "synthetic: true\n",
    derivation: "verbatim copy (synthetic test fixture)",
    argv: ["synthetic-runner"],
    environment: {}
  };

  it("blocks and emits no argv when identity components are unaudited", () => {
    for (const model of [
      { ...completeModel, adalnTable: null },
      { ...completeModel, textEncoder: { ...completeModel.textEncoder, revision: null } }
    ]) {
      const spec = compileFastH3OmniSpecification({
        runId: "run-gap",
        auditSnapshot: noLicenseAudit,
        capability,
        modelIdentity: model,
        runtimeIdentity: completeRuntime,
        bindingManifest,
        renderParams: baseRender,
        executionContext: {
          licenseApproved: true,
          hostGpuVerified: true,
          weightsVerifiedLocally: true
        },
        timeouts: limits,
        upstreamRecipe: syntheticRecipe
      } as never);
      expect(spec.readinessStatus).toBe("blocked_unverified_runtime");
      expect(spec.commandSpec ?? null).toBeNull();
    }
  });

  it("blocks when operator limits or the upstream recipe are missing", () => {
    const common = {
      runId: "run-limits",
      auditSnapshot: noLicenseAudit,
      capability,
      modelIdentity: completeModel,
      runtimeIdentity: completeRuntime,
      bindingManifest,
      renderParams: baseRender
    };
    const noLimits = compileFastH3OmniSpecification({
      ...common,
      upstreamRecipe: syntheticRecipe
    } as never);
    expect(noLimits.readinessStatus).toBe("blocked_unverified_runtime");
    expect(noLimits.commandSpec ?? null).toBeNull();
    const noRecipe = compileFastH3OmniSpecification({ ...common, timeouts: limits } as never);
    expect(noRecipe.readinessStatus).toBe("blocked_unverified_runtime");
    expect(noRecipe.commandSpec ?? null).toBeNull();
  });

  it("reaches offline_validated only with a complete identity, limits and captured recipe", () => {
    const spec = compileFastH3OmniSpecification({
      runId: "run-ok",
      auditSnapshot: noLicenseAudit,
      capability,
      modelIdentity: completeModel,
      runtimeIdentity: completeRuntime,
      bindingManifest,
      renderParams: baseRender,
      timeouts: limits,
      upstreamRecipe: syntheticRecipe
    } as never);
    expect(spec.readinessStatus).toBe("offline_validated");
    expect(spec.isExecutable).toBe(false);
    expect(spec.commandSpec?.argv[0]).toBe("synthetic-runner");
    expect(generateFastVideoYamlConfig(spec)).toBe(syntheticRecipe.configText);
  });

  it("changes descriptor digest when seed or prompt changes", () => {
    const spec1 = compileFastH3OmniSpecification({
      runId: "run-omni-diff",
      auditSnapshot,
      capability,
      modelIdentity,
      runtimeIdentity,
      bindingManifest,
      renderParams: {
        width: 832,
        height: 480,
        frames: 124,
        fps: 24,
        seed: 42
      }
    });

    const spec2 = compileFastH3OmniSpecification({
      runId: "run-omni-diff",
      auditSnapshot,
      capability,
      modelIdentity,
      runtimeIdentity,
      bindingManifest,
      renderParams: {
        width: 832,
        height: 480,
        frames: 124,
        fps: 24,
        seed: 43 // Different seed
      }
    });

    expect(spec1.descriptorDigest).not.toBe(spec2.descriptorDigest);
  });
});
