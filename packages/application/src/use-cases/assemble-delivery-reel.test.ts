import { describe, expect, it, vi } from "vitest";
import {
  computeAssemblyId,
  createAssemblyManifest,
  type AssemblyExecutionResult,
  type AssemblySpec
} from "@cco/contracts";
import {
  type GenerationManifestRepository,
  type MediaAssemblerPort,
  type ObjectLocator,
  type ObjectStoragePort,
  type PutObjectInput,
  ObjectAlreadyExistsError
} from "../ports/index.js";
import {
  AssembleDeliveryReel,
  AssemblyManifestPublicationError,
  AssemblyProvenanceConflictError,
  AssemblyVideoCommitError
} from "./assemble-delivery-reel.js";
import { EnforceLicenseRouting } from "./enforce-license-routing.js";
import { LicenseRoutingError } from "./license-routing-error.js";

describe("AssembleDeliveryReel use case", () => {
  const dummyExecutionResult: AssemblyExecutionResult = {
    assemblyId: "assembly-test-123",
    campaignId: "campaign-test-456",
    assemblyProfile: {
      key: "VERTICAL_REEL_1080X1920_V1",
      version: 1
    },
    executedInputs: {
      videoStems: [
        {
          sceneId: "scene-1",
          generationManifestId: "gen-1",
          order: 0,
          media: {
            bucket: "test-bucket",
            key: "scene-1.mp4",
            sha256: "a".repeat(64),
            contentType: "video/mp4"
          },
          actualDurationMs: 5000
        }
      ]
    },
    timeline: {
      totalDurationMs: 5000,
      stemDurationsMs: [5000]
    },
    layout: {
      mode: "fit_blurred_fill"
    },
    subtitleCuesSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    ffmpeg: {
      executable: "ffmpeg",
      version: "7.0",
      buildInfo: "ffmpeg version 7.0"
    },
    commandFingerprint: "b".repeat(64),
    encoding: {
      video: {
        codec: "libx264",
        pixelFormat: "yuv420p",
        crf: 23,
        preset: "veryfast"
      }
    },
    streams: {
      video: {
        codecName: "h264",
        pixelFormat: "yuv420p",
        width: 1080,
        height: 1920,
        frameRate: 30,
        durationMs: 5000
      }
    },
    output: {
      media: {
        bucket: "godzspeed-delivery",
        key: "campaigns/campaign-test-456/assemblies/assembly-test-123/output.mp4",
        sha256: "c".repeat(64),
        contentType: "video/mp4"
      },
      durationMs: 5000,
      width: 1080,
      height: 1920
    },
    stagingMedia: {
      bucket: "godzspeed-delivery",
      key: "campaigns/campaign-test-456/assemblies/assembly-test-123/.staging/output.mp4"
    },
    measuredFrameRate: 30,
    executionDurationMs: 1500
  };

  const validSpec: AssemblySpec = {
    campaignId: "campaign-test-456",
    assemblyProfile: {
      key: "VERTICAL_REEL_1080X1920_V1",
      version: 1
    },
    expectedTotalDurationMs: 5000,
    subtitleCues: [],
    videoStems: [
      {
        sceneId: "scene-1",
        generationManifestId: "gen-1",
        order: 0,
        media: {
          bucket: "test-bucket",
          key: "scene-1.mp4",
          sha256: "a".repeat(64),
          contentType: "video/mp4"
        },
        expectedDurationMs: 5000
      }
    ]
  };

  function createApprovedEnforceLicenseRouting(
    generateDecisionId?: () => string
  ): EnforceLicenseRouting {
    const registry = {
      getSnapshot: () => ({
        schemaVersion: 1 as const,
        registryRevision: "2026-08-29.1",
        generatedAt: "2026-08-29T12:00:00.000Z",
        entries: [
          {
            componentId: "ffmpeg",
            componentType: "runtime" as const,
            versionOrRevision: "n8.0.1",
            status: "approved" as const,
            licenseSource: "Sprint 3.5 Assembly & Governance Host Runtime Capture",
            reviewedAt: "2026-08-29T12:00:00.000Z",
            policyRevision: "2026-08-29.1"
          },
          {
            componentId: "elevenlabs-provider",
            componentType: "provider" as const,
            versionOrRevision: "v1",
            status: "approved" as const,
            licenseSource: "internal",
            reviewedAt: "2026-08-29T12:00:00.000Z",
            policyRevision: "2026-08-29.1"
          },
          {
            componentId: "elevenlabs-provider-blocked",
            componentType: "provider" as const,
            versionOrRevision: "v1",
            status: "blocked" as const,
            licenseSource: "internal",
            reviewedAt: "2026-08-29T12:00:00.000Z",
            policyRevision: "2026-08-29.1"
          },
          {
            componentId: "ltx-fake-profile",
            componentType: "model" as const,
            versionOrRevision: "1",
            status: "approved" as const,
            licenseSource: "internal",
            reviewedAt: "2026-08-29T12:00:00.000Z",
            policyRevision: "2026-08-29.1"
          }
        ]
      })
    };
    return new EnforceLicenseRouting({ registry, generateDecisionId });
  }

  const defaultRequiredComponents = [
    {
      componentId: "ffmpeg",
      componentType: "runtime" as const,
      versionOrRevision: "n8.0.1"
    }
  ];

  // By default every video stem's generationManifestId resolves to an
  // approved render profile — matches "ltx-fake-profile" v1 in the fake
  // registry above, so existing happy-path tests don't need to know about
  // generation-manifest resolution unless they're specifically testing it.
  function createApprovedGenerationManifestRepository(): GenerationManifestRepository {
    return {
      getComponentIdentityById: vi.fn(async () => ({
        renderProfile: "ltx-fake-profile",
        renderProfileVersion: 1
      }))
    };
  }

  it("assembles reel, creates manifest from executed state, and persists it with checksum", async () => {
    const putObjectCalls: PutObjectInput[] = [];
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(async (input: PutObjectInput): Promise<ObjectLocator> => {
        putObjectCalls.push(input);
        return { bucket: input.bucket, key: input.key };
      }),
      copyObject: vi.fn(async (_from, to) => to),
      getObject: vi.fn(async () => undefined)
    };

    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => dummyExecutionResult)
    };

    const enforceLicenseRouting = createApprovedEnforceLicenseRouting();
    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      generationManifestRepository: createApprovedGenerationManifestRepository()
    });

    const result = await useCase.assemble({
      spec: validSpec,
      requiredComponents: defaultRequiredComponents
    });

    expect(mockAssembler.assemble).toHaveBeenCalledWith(validSpec);
    expect(result.manifest.assemblyId).toBe("assembly-test-123");
    expect(result.manifest.governanceDecisionId).toMatch(/^gov-dec-[0-9a-f-]{36}$/);
    expect(result.manifest.generationManifestIds).toEqual(["gen-1"]);
    expect(result.manifest.output.media.bucket).toBe("godzspeed-delivery");

    expect(mockStorage.putObject).toHaveBeenCalledTimes(1);
    expect(putObjectCalls[0]?.bucket).toBe("godzspeed-delivery");
    expect(putObjectCalls[0]?.key).toBe(
      "campaigns/campaign-test-456/assemblies/assembly-test-123/manifest.json"
    );
    expect(putObjectCalls[0]?.contentType).toBe("application/json");
    expect(putObjectCalls[0]?.checksumSha256).toMatch(/^[0-9a-f]{64}$/);

    const storedJson = JSON.parse(new TextDecoder().decode(putObjectCalls[0]?.body));
    expect(storedJson.assemblyId).toBe("assembly-test-123");
    expect(storedJson.governanceDecisionId).toBe(result.manifest.governanceDecisionId);
  });

  it("rejects invalid spec before invoking media assembler or storage", async () => {
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(),
      copyObject: vi.fn(),
      getObject: vi.fn()
    };

    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn()
    };

    const enforceLicenseRouting = createApprovedEnforceLicenseRouting();
    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      generationManifestRepository: createApprovedGenerationManifestRepository()
    });

    const invalidSpec = {
      ...validSpec,
      campaignId: "" // invalid
    };

    await expect(
      useCase.assemble({
        spec: invalidSpec as unknown as AssemblySpec,
        requiredComponents: defaultRequiredComponents
      })
    ).rejects.toThrow("campaignId must not be empty");

    expect(mockAssembler.assemble).not.toHaveBeenCalled();
    expect(mockStorage.putObject).not.toHaveBeenCalled();
  });

  it("does not publish manifest if media assembler fails", async () => {
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(),
      copyObject: vi.fn(),
      getObject: vi.fn()
    };

    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => {
        throw new Error("FFmpeg encode failed");
      })
    };

    const enforceLicenseRouting = createApprovedEnforceLicenseRouting();
    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      generationManifestRepository: createApprovedGenerationManifestRepository()
    });

    await expect(
      useCase.assemble({
        spec: validSpec,
        requiredComponents: defaultRequiredComponents
      })
    ).rejects.toThrow("FFmpeg encode failed");

    expect(mockStorage.putObject).not.toHaveBeenCalled();
  });

  it("throws typed AssemblyManifestPublicationError with execution result when manifest persistence fails", async () => {
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(async (): Promise<ObjectLocator> => {
        throw new Error("S3 connection timed out");
      }),
      copyObject: vi.fn(),
      getObject: vi.fn()
    };

    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => dummyExecutionResult)
    };

    const enforceLicenseRouting = createApprovedEnforceLicenseRouting();
    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      generationManifestRepository: createApprovedGenerationManifestRepository()
    });

    let thrownError: unknown;
    try {
      await useCase.assemble({
        spec: validSpec,
        requiredComponents: defaultRequiredComponents
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(AssemblyManifestPublicationError);
    const pubErr = thrownError as AssemblyManifestPublicationError;
    expect(pubErr.name).toBe("AssemblyManifestPublicationError");
    expect(pubErr.executionResult).toEqual(dummyExecutionResult);
    expect(pubErr.manifest.assemblyId).toBe("assembly-test-123");
    expect(pubErr.manifest.governanceDecisionId).toMatch(/^gov-dec-[0-9a-f-]{36}$/);
  });

  it("does not call copyObject when manifest persistence fails (video never published to final key)", async () => {
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(async (): Promise<ObjectLocator> => {
        throw new Error("S3 connection timed out");
      }),
      copyObject: vi.fn(),
      getObject: vi.fn(),
      deleteObject: vi.fn()
    };

    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => dummyExecutionResult)
    };

    const enforceLicenseRouting = createApprovedEnforceLicenseRouting();
    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      generationManifestRepository: createApprovedGenerationManifestRepository()
    });

    await expect(
      useCase.assemble({
        spec: validSpec,
        requiredComponents: defaultRequiredComponents
      })
    ).rejects.toThrow(AssemblyManifestPublicationError);

    expect(mockStorage.copyObject).not.toHaveBeenCalled();
  });

  it("publishes manifest first, then copies staged video to final key and cleans up staging", async () => {
    const callOrder: string[] = [];
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(async (input: PutObjectInput) => {
        callOrder.push(`putObject:${input.key}`);
        return { bucket: input.bucket, key: input.key };
      }),
      copyObject: vi.fn(async (from: ObjectLocator, to: ObjectLocator) => {
        callOrder.push(`copyObject:${from.key}->${to.key}`);
        return { bucket: to.bucket, key: to.key };
      }),
      headObject: vi.fn(async () => undefined),
      getObject: vi.fn(async () => undefined),
      deleteObject: vi.fn(async (locator: ObjectLocator) => {
        callOrder.push(`deleteObject:${locator.key}`);
      })
    };

    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => dummyExecutionResult)
    };

    const enforceLicenseRouting = createApprovedEnforceLicenseRouting();
    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      generationManifestRepository: createApprovedGenerationManifestRepository()
    });

    const result = await useCase.assemble({
      spec: validSpec,
      requiredComponents: defaultRequiredComponents
    });

    expect(result.manifest.assemblyId).toBe("assembly-test-123");
    expect(callOrder).toEqual([
      "putObject:campaigns/campaign-test-456/assemblies/assembly-test-123/manifest.json",
      "copyObject:campaigns/campaign-test-456/assemblies/assembly-test-123/.staging/output.mp4->campaigns/campaign-test-456/assemblies/assembly-test-123/output.mp4",
      "deleteObject:campaigns/campaign-test-456/assemblies/assembly-test-123/.staging/output.mp4"
    ]);
  });

  it("throws AssemblyVideoCommitError when copyObject fails after manifest is published", async () => {
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(async (input: PutObjectInput) => ({ bucket: input.bucket, key: input.key })),
      copyObject: vi.fn(async () => {
        throw new Error("Disk full on copy");
      }),
      getObject: vi.fn(async () => undefined)
    };

    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => dummyExecutionResult)
    };

    const enforceLicenseRouting = createApprovedEnforceLicenseRouting();
    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      generationManifestRepository: createApprovedGenerationManifestRepository()
    });

    let thrownError: unknown;
    try {
      await useCase.assemble({
        spec: validSpec,
        requiredComponents: defaultRequiredComponents
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(AssemblyVideoCommitError);
    const commitErr = thrownError as AssemblyVideoCommitError;
    expect(commitErr.name).toBe("AssemblyVideoCommitError");
    expect(commitErr.message).toContain("Disk full on copy");
    expect(commitErr.manifest.assemblyId).toBe("assembly-test-123");
    expect(commitErr.executionResult).toEqual(dummyExecutionResult);
  });

  it("concurrent video-copy race resolves via checksum-equivalence and deletes staging", async () => {
    const deleteCalls: ObjectLocator[] = [];
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(async (input: PutObjectInput) => ({ bucket: input.bucket, key: input.key })),
      copyObject: vi.fn(async (_from, to) => {
        throw new ObjectAlreadyExistsError(to.bucket, to.key);
      }),
      headObject: vi.fn(async (locator: ObjectLocator) => {
        if (locator.key === dummyExecutionResult.output.media.key) {
          return {
            bucket: locator.bucket,
            key: locator.key,
            checksumSha256: dummyExecutionResult.output.media.sha256,
            contentType: "video/mp4"
          };
        }
        return undefined;
      }),
      getObject: vi.fn(async () => undefined),
      deleteObject: vi.fn(async (loc: ObjectLocator) => {
        deleteCalls.push(loc);
      })
    };

    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => dummyExecutionResult)
    };

    const enforceLicenseRouting = createApprovedEnforceLicenseRouting();
    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      generationManifestRepository: createApprovedGenerationManifestRepository()
    });

    const result = await useCase.assemble({
      spec: validSpec,
      requiredComponents: defaultRequiredComponents
    });

    expect(result.manifest.assemblyId).toBe("assembly-test-123");
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]?.key).toBe(dummyExecutionResult.stagingMedia!.key);
  });

  it("concurrent video-copy race with checksum mismatch throws AssemblyProvenanceConflictError", async () => {
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(async (input: PutObjectInput) => ({ bucket: input.bucket, key: input.key })),
      copyObject: vi.fn(async (_from, to) => {
        throw new ObjectAlreadyExistsError(to.bucket, to.key);
      }),
      headObject: vi.fn(async (locator: ObjectLocator) => {
        if (locator.key === dummyExecutionResult.output.media.key) {
          return {
            bucket: locator.bucket,
            key: locator.key,
            checksumSha256: "conflicting-hash-000000000000000000000000000000000000000000000000000",
            contentType: "video/mp4"
          };
        }
        return undefined;
      }),
      getObject: vi.fn(async () => undefined)
    };

    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => dummyExecutionResult)
    };

    const enforceLicenseRouting = createApprovedEnforceLicenseRouting();
    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      generationManifestRepository: createApprovedGenerationManifestRepository()
    });

    await expect(
      useCase.assemble({
        spec: validSpec,
        requiredComponents: defaultRequiredComponents
      })
    ).rejects.toThrow(AssemblyProvenanceConflictError);
  });

  it("deterministic race test: pauses both callers between final-key observation and promotion/cleanup, ensuring loser converges and cleans up its own staging", async () => {
    const stagingKeyA =
      "campaigns/campaign-test-456/assemblies/assembly-test-123/.staging/attempt-A/output.mp4";
    const stagingKeyB =
      "campaigns/campaign-test-456/assemblies/assembly-test-123/.staging/attempt-B/output.mp4";
    const finalMediaKey = dummyExecutionResult.output.media.key;
    const finalMediaBucket = dummyExecutionResult.output.media.bucket;

    const executionResultA: AssemblyExecutionResult = {
      ...dummyExecutionResult,
      stagingMedia: { bucket: finalMediaBucket, key: stagingKeyA }
    };
    const executionResultB: AssemblyExecutionResult = {
      ...dummyExecutionResult,
      stagingMedia: { bucket: finalMediaBucket, key: stagingKeyB }
    };

    let callerAObservedAbsent = false;
    let callerBObservedAbsent = false;
    let resolveBarrier: () => void;
    const barrier = new Promise<void>((r) => {
      resolveBarrier = r;
    });

    let finalCommitted = false;
    const deletedKeys: string[] = [];

    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(async (input: PutObjectInput) => ({ bucket: input.bucket, key: input.key })),
      headObject: vi.fn(async (loc: ObjectLocator) => {
        if (loc.key === finalMediaKey) {
          if (!finalCommitted) {
            return undefined;
          }
          return {
            bucket: loc.bucket,
            key: loc.key,
            checksumSha256: dummyExecutionResult.output.media.sha256,
            contentType: "video/mp4"
          };
        }
        return undefined;
      }),
      getObject: vi.fn(async () => undefined),
      copyObject: vi.fn(async (_from: ObjectLocator, to: ObjectLocator) => {
        if (to.key === finalMediaKey) {
          if (finalCommitted) {
            throw new ObjectAlreadyExistsError(to.bucket, to.key);
          }
          finalCommitted = true;
          return to;
        }
        return to;
      }),
      deleteObject: vi.fn(async (loc: ObjectLocator) => {
        deletedKeys.push(loc.key);
      })
    };

    const assemblerA: MediaAssemblerPort = {
      assemble: vi.fn(async () => executionResultA)
    };
    const assemblerB: MediaAssemblerPort = {
      assemble: vi.fn(async () => executionResultB)
    };

    // Synchronize the race:
    // Both callers must observe final key as absent before either promotes.
    const originalHeadObject = mockStorage.headObject!.bind(mockStorage);
    mockStorage.headObject = async (loc: ObjectLocator) => {
      if (loc.key === finalMediaKey && !finalCommitted) {
        if (!callerAObservedAbsent) {
          callerAObservedAbsent = true;
          await barrier;
          return undefined;
        } else if (!callerBObservedAbsent) {
          callerBObservedAbsent = true;
          resolveBarrier!();
          return undefined;
        }
      }
      return originalHeadObject(loc);
    };

    const enforceLicenseRouting = createApprovedEnforceLicenseRouting();
    const repo = createApprovedGenerationManifestRepository();

    const useCaseA = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: assemblerA,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      generationManifestRepository: repo
    });

    const useCaseB = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: assemblerB,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      generationManifestRepository: repo
    });

    const [resultA, resultB] = await Promise.all([
      useCaseA.assemble({ spec: validSpec, requiredComponents: defaultRequiredComponents }),
      useCaseB.assemble({ spec: validSpec, requiredComponents: defaultRequiredComponents })
    ]);

    expect(resultA.manifest.assemblyId).toBe("assembly-test-123");
    expect(resultB.manifest.assemblyId).toBe("assembly-test-123");
    expect(finalCommitted).toBe(true);
    expect(deletedKeys).toContain(stagingKeyA);
    expect(deletedKeys).toContain(stagingKeyB);
  });

  it("idempotent replay where a prior run published the manifest but crashed before committing the video: retry re-runs the encode, finds the equivalent manifest in Step 4a, and still calls copyObject to commit the video before returning success", async () => {
    const assemblyId = computeAssemblyId(validSpec);
    const existingExecutionResult: AssemblyExecutionResult = {
      ...dummyExecutionResult,
      assemblyId
    };
    const existingManifest = createAssemblyManifest({
      executionResult: existingExecutionResult,
      governanceDecisionId: "gov-dec-existing-001"
    });

    const manifestKey = `campaigns/${validSpec.campaignId}/assemblies/${assemblyId}/manifest.json`;
    const manifestBytes = Buffer.from(JSON.stringify(existingManifest), "utf-8");

    let videoCommitted = false;
    const copyCalls: { from: ObjectLocator; to: ObjectLocator }[] = [];

    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(),
      copyObject: vi.fn(async (from: ObjectLocator, to: ObjectLocator) => {
        copyCalls.push({ from, to });
        videoCommitted = true;
        return { bucket: to.bucket, key: to.key };
      }),
      headObject: vi.fn(async (locator: ObjectLocator) => {
        if (locator.key === existingManifest.output.media.key && videoCommitted) {
          return {
            bucket: locator.bucket,
            key: locator.key,
            checksumSha256: existingManifest.output.media.sha256,
            contentType: "video/mp4"
          };
        }
        return undefined;
      }),
      getObject: vi.fn(async ({ bucket, key }) => {
        if (bucket === "godzspeed-delivery" && key === manifestKey) {
          return { bucket, key, body: manifestBytes };
        }
        if (bucket === "godzspeed-delivery" && key === existingManifest.output.media.key) {
          if (videoCommitted) {
            return {
              bucket,
              key,
              body: new Uint8Array([1, 2, 3]),
              checksumSha256: existingManifest.output.media.sha256
            };
          }
          return undefined;
        }
        return undefined;
      }),
      deleteObject: vi.fn(async () => undefined)
    };

    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => ({ ...dummyExecutionResult, assemblyId }))
    };

    const enforceLicenseRouting = createApprovedEnforceLicenseRouting(() => "gov-dec-existing-001");
    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      generationManifestRepository: createApprovedGenerationManifestRepository()
    });

    const result = await useCase.assemble({
      spec: validSpec,
      requiredComponents: defaultRequiredComponents
    });

    expect(mockStorage.copyObject).toHaveBeenCalledTimes(1);
    expect(copyCalls[0]?.to.key).toBe(existingManifest.output.media.key);
    expect(videoCommitted).toBe(true);
    expect(result.manifest.assemblyId).toBe(existingManifest.assemblyId);
    expect(result.manifest.governanceDecisionId).toBe(existingManifest.governanceDecisionId);
    expect(mockAssembler.assemble).toHaveBeenCalledTimes(1);
  });

  it("manifest already exists with equivalent match at Step 4a and video is already committed: copyObject is not called again and staging is cleaned up", async () => {
    const assemblyId = computeAssemblyId(validSpec);
    const existingExecutionResult: AssemblyExecutionResult = {
      ...dummyExecutionResult,
      assemblyId
    };
    const existingManifest = createAssemblyManifest({
      executionResult: existingExecutionResult,
      governanceDecisionId: "gov-dec-existing-001"
    });

    const manifestKey = `campaigns/${validSpec.campaignId}/assemblies/${assemblyId}/manifest.json`;
    const manifestBytes = Buffer.from(JSON.stringify(existingManifest), "utf-8");
    const deletedLocators: ObjectLocator[] = [];

    let getObjectCallCount = 0;
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(),
      copyObject: vi.fn(),
      headObject: vi.fn(async (locator: ObjectLocator) => {
        if (locator.key === existingManifest.output.media.key) {
          return {
            bucket: locator.bucket,
            key: locator.key,
            checksumSha256: existingManifest.output.media.sha256,
            contentType: "video/mp4"
          };
        }
        return undefined;
      }),
      getObject: vi.fn(async ({ bucket, key }) => {
        if (bucket === "godzspeed-delivery" && key === manifestKey) {
          getObjectCallCount++;
          // Step 1 early check: return undefined so assembler runs
          if (getObjectCallCount === 1) {
            return undefined;
          }
          // Step 4a check: manifest now present
          return { bucket, key, body: manifestBytes };
        }
        return undefined;
      }),
      deleteObject: vi.fn(async (locator: ObjectLocator) => {
        deletedLocators.push(locator);
      })
    };

    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => ({ ...dummyExecutionResult, assemblyId }))
    };

    const enforceLicenseRouting = createApprovedEnforceLicenseRouting(() => "gov-dec-existing-001");
    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      generationManifestRepository: createApprovedGenerationManifestRepository()
    });

    const result = await useCase.assemble({
      spec: validSpec,
      requiredComponents: defaultRequiredComponents
    });

    expect(mockStorage.copyObject).not.toHaveBeenCalled();
    expect(deletedLocators).toHaveLength(1);
    expect(deletedLocators[0]?.key).toBe(dummyExecutionResult.stagingMedia!.key);
    expect(result.manifest.assemblyId).toBe(existingManifest.assemblyId);
  });

  it("concurrent-publication (ObjectAlreadyExistsError) branch resolves with video commit check", async () => {
    const assemblyId = computeAssemblyId(validSpec);
    const existingExecutionResult: AssemblyExecutionResult = {
      ...dummyExecutionResult,
      assemblyId
    };
    const concurrentManifest = createAssemblyManifest({
      executionResult: existingExecutionResult,
      governanceDecisionId: "gov-dec-concurrent-001"
    });
    const manifestKey = `campaigns/${validSpec.campaignId}/assemblies/${assemblyId}/manifest.json`;
    const manifestBytes = Buffer.from(JSON.stringify(concurrentManifest), "utf-8");

    const copyCalls: ObjectLocator[] = [];
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(async () => {
        throw new ObjectAlreadyExistsError("godzspeed-delivery", manifestKey);
      }),
      copyObject: vi.fn(async (_from, to) => {
        copyCalls.push(to);
        return { bucket: to.bucket, key: to.key };
      }),
      headObject: vi.fn(async () => undefined),
      getObject: vi.fn(async ({ bucket, key }) => {
        if (key === manifestKey) {
          return { bucket, key, body: manifestBytes };
        }
        return undefined;
      }),
      deleteObject: vi.fn(async () => undefined)
    };

    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => ({ ...dummyExecutionResult, assemblyId }))
    };

    const enforceLicenseRouting = createApprovedEnforceLicenseRouting(
      () => "gov-dec-concurrent-001"
    );
    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      generationManifestRepository: createApprovedGenerationManifestRepository()
    });

    const result = await useCase.assemble({
      spec: validSpec,
      requiredComponents: defaultRequiredComponents
    });

    expect(result.manifest.governanceDecisionId).toBe(concurrentManifest.governanceDecisionId);
    expect(copyCalls).toHaveLength(1);
    expect(copyCalls[0]?.key).toBe(concurrentManifest.output.media.key);
  });

  it("AssemblyExecutionResult reconstructed from an existing manifest (no stagingMedia) validates and short-circuits", async () => {
    const assemblyId = computeAssemblyId(validSpec);
    const existingExecutionResult: AssemblyExecutionResult = {
      ...dummyExecutionResult,
      assemblyId,
      stagingMedia: undefined
    };
    const existingManifest = createAssemblyManifest({
      executionResult: existingExecutionResult,
      governanceDecisionId: "gov-dec-existing-001"
    });

    const manifestKey = `campaigns/${validSpec.campaignId}/assemblies/${assemblyId}/manifest.json`;
    const manifestBytes = Buffer.from(JSON.stringify(existingManifest), "utf-8");

    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(),
      copyObject: vi.fn(),
      headObject: vi.fn(async (locator) => {
        if (locator.key === existingManifest.output.media.key) {
          return {
            bucket: locator.bucket,
            key: locator.key,
            checksumSha256: existingManifest.output.media.sha256,
            contentType: "video/mp4"
          };
        }
        return undefined;
      }),
      getObject: vi.fn(async ({ bucket, key }) => {
        if (key === manifestKey) {
          return { bucket, key, body: manifestBytes };
        }
        return undefined;
      })
    };

    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn()
    };

    const enforceLicenseRouting = createApprovedEnforceLicenseRouting();
    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      generationManifestRepository: createApprovedGenerationManifestRepository()
    });

    const result = await useCase.assemble({
      spec: validSpec,
      requiredComponents: defaultRequiredComponents
    });

    expect(mockAssembler.assemble).not.toHaveBeenCalled();
    expect(mockStorage.copyObject).not.toHaveBeenCalled();
    expect(result.executionResult.stagingMedia).toBeUndefined();
    expect(result.manifest.assemblyId).toBe(assemblyId);
  });

  it("denies assembly with zero ffmpeg spawn and zero storage put when required component is denied", async () => {
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(),
      copyObject: vi.fn(),
      getObject: vi.fn()
    };
    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => dummyExecutionResult)
    };
    const registry = {
      getSnapshot: () => ({
        schemaVersion: 1 as const,
        registryRevision: "2026-08-29.1",
        generatedAt: "2026-08-29T12:00:00.000Z",
        entries: [
          {
            componentId: "ffmpeg",
            componentType: "runtime" as const,
            versionOrRevision: "n8.0.1",
            status: "review_required" as const,
            licenseSource: "registry",
            reviewedAt: "2026-08-29T12:00:00.000Z",
            policyRevision: "1"
          }
        ]
      })
    };
    const enforceLicenseRouting = new EnforceLicenseRouting({ registry });
    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      generationManifestRepository: createApprovedGenerationManifestRepository()
    });

    await expect(
      useCase.assemble({
        spec: validSpec,
        requiredComponents: [
          {
            componentId: "ffmpeg",
            componentType: "runtime",
            versionOrRevision: "n8.0.1"
          }
        ]
      })
    ).rejects.toThrow(LicenseRoutingError);

    expect(mockAssembler.assemble).not.toHaveBeenCalled();
    expect(mockStorage.putObject).not.toHaveBeenCalled();
  });

  it("denies assembly with zero ffmpeg spawn when provider audio asset in spec is blocked or unapproved", async () => {
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(),
      copyObject: vi.fn(),
      getObject: vi.fn()
    };
    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => dummyExecutionResult)
    };

    const enforceLicenseRouting = createApprovedEnforceLicenseRouting();
    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      generationManifestRepository: createApprovedGenerationManifestRepository()
    });

    const specWithBlockedVoiceover: AssemblySpec = {
      ...validSpec,
      voiceover: {
        assetId: "vo-blocked",
        kind: "voiceover",
        media: {
          bucket: "test-bucket",
          key: "vo-blocked.mp3",
          sha256: "d".repeat(64),
          contentType: "audio/mpeg"
        },
        source: {
          kind: "provider",
          providerId: "elevenlabs-provider-blocked",
          modelId: "v1"
        },
        startMs: 0,
        expectedDurationMs: 5000
      }
    };

    await expect(
      useCase.assemble({
        spec: specWithBlockedVoiceover,
        requiredComponents: defaultRequiredComponents
      })
    ).rejects.toThrow(LicenseRoutingError);

    expect(mockAssembler.assemble).not.toHaveBeenCalled();
    expect(mockStorage.putObject).not.toHaveBeenCalled();
  });

  it("denies assembly with zero calls into the media assembler when the injected runtime identity is not approved, even if the caller omitted it from requiredComponents", async () => {
    // The whole point of injecting runtimeComponents is that a caller
    // cannot bypass the guard simply by not mentioning ffmpeg — the
    // assembler's own (already-resolved) identity must always be checked.
    // Critically, this must happen with ZERO calls into the media
    // assembler on denial: runtimeComponents is a plain injected value,
    // never fetched from mediaAssembler inside assemble() (see the
    // "resolves runtime identity once" test below for why).
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(),
      copyObject: vi.fn(),
      getObject: vi.fn()
    };
    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => dummyExecutionResult)
    };

    const enforceLicenseRouting = createApprovedEnforceLicenseRouting();
    const useCase = new AssembleDeliveryReel({
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      runtimeComponents: [
        {
          componentId: "ffmpeg",
          componentType: "runtime" as const,
          // Deliberately a different version than any registry entry —
          // simulates a real environment mismatch (e.g. a host running a
          // different ffmpeg build than whatever was last approved).
          versionOrRevision: "n6.1.1-unapproved"
        }
      ],
      generationManifestRepository: createApprovedGenerationManifestRepository()
    });

    await expect(
      useCase.assemble({
        spec: validSpec,
        // Caller supplies no ffmpeg reference at all.
        requiredComponents: []
      })
    ).rejects.toThrow(LicenseRoutingError);

    expect(mockAssembler.assemble).not.toHaveBeenCalled();
    expect(mockStorage.putObject).not.toHaveBeenCalled();
  });

  it("permits assembly using the injected runtime identity when the caller omitted it and the registry approves it", async () => {
    const putObjectCalls: PutObjectInput[] = [];
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(async (input: PutObjectInput): Promise<ObjectLocator> => {
        putObjectCalls.push(input);
        return { bucket: input.bucket, key: input.key };
      }),
      copyObject: vi.fn(async (_from, to) => to),
      getObject: vi.fn(async () => undefined)
    };
    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => dummyExecutionResult)
    };

    const enforceLicenseRouting = createApprovedEnforceLicenseRouting();
    const useCase = new AssembleDeliveryReel({
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      runtimeComponents: [
        {
          componentId: "ffmpeg",
          componentType: "runtime" as const,
          versionOrRevision: "n8.0.1"
        }
      ],
      generationManifestRepository: createApprovedGenerationManifestRepository()
    });

    const result = await useCase.assemble({
      spec: validSpec,
      requiredComponents: []
    });

    expect(mockAssembler.assemble).toHaveBeenCalledWith(validSpec);
    expect(result.manifest.assemblyId).toBe("assembly-test-123");
    expect(mockStorage.putObject).toHaveBeenCalledTimes(1);
  });

  it("permits assembly when runtimeComponents is supplied via dependencies and params.requiredComponents is omitted", async () => {
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(async (input: PutObjectInput): Promise<ObjectLocator> => ({
        bucket: input.bucket,
        key: input.key
      })),
      copyObject: vi.fn(async (_from, to) => to),
      getObject: vi.fn(async () => undefined)
    };
    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => dummyExecutionResult)
    };

    const enforceLicenseRouting = createApprovedEnforceLicenseRouting();
    const useCase = new AssembleDeliveryReel({
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      runtimeComponents: [
        {
          componentId: "ffmpeg",
          componentType: "runtime",
          versionOrRevision: "n8.0.1"
        }
      ],
      generationManifestRepository: createApprovedGenerationManifestRepository()
    });

    const result = await useCase.assemble({
      spec: validSpec
    });

    expect(mockAssembler.assemble).toHaveBeenCalledWith(validSpec);
    expect(result.manifest.assemblyId).toBe("assembly-test-123");
  });

  it("denies assembly when neither runtimeComponents dependency nor params.requiredComponents specifies a runtime component", async () => {
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(),
      copyObject: vi.fn(),
      getObject: vi.fn()
    };
    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => dummyExecutionResult)
    };

    const enforceLicenseRouting = createApprovedEnforceLicenseRouting();
    const useCase = new AssembleDeliveryReel({
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      generationManifestRepository: createApprovedGenerationManifestRepository(),
      runtimeComponents: []
    });

    await expect(
      useCase.assemble({
        spec: validSpec,
        requiredComponents: []
      })
    ).rejects.toThrow(LicenseRoutingError);

    expect(mockAssembler.assemble).not.toHaveBeenCalled();
    expect(mockStorage.putObject).not.toHaveBeenCalled();
  });

  it("does not fail when runtimeComponents is provided via params.requiredComponents", async () => {
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(async (input: PutObjectInput): Promise<ObjectLocator> => ({
        bucket: input.bucket,
        key: input.key
      })),
      copyObject: vi.fn(async (_from, to) => to),
      getObject: vi.fn(async () => undefined)
    };
    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => dummyExecutionResult)
    };

    const enforceLicenseRouting = createApprovedEnforceLicenseRouting();
    const useCase = new AssembleDeliveryReel({
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      generationManifestRepository: createApprovedGenerationManifestRepository(),
      runtimeComponents: []
    });

    const result = await useCase.assemble({
      spec: validSpec,
      requiredComponents: defaultRequiredComponents
    });

    expect(result.manifest.assemblyId).toBe("assembly-test-123");
  });

  it("resolves runtime identity once, outside assemble() — never calls mediaAssembler.getRuntimeComponents itself, regardless of outcome", async () => {
    // A denied assembly must produce zero calls into the media assembler
    // (there is an existing test enforcing this for provider-audio
    // denials). getRuntimeComponents spawns a real ffmpeg process in the
    // production adapter, so if assemble() called it per-request, a
    // denial would still trigger that spawn before the guard's decision —
    // violating the zero-calls guarantee even though it's lighter than a
    // full encode. Resolution must happen once, by whoever constructs this
    // use case, never from inside assemble() itself.
    const getRuntimeComponents = vi.fn(async () => [
      { componentId: "ffmpeg", componentType: "runtime" as const, versionOrRevision: "n8.0.1" }
    ]);
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(),
      copyObject: vi.fn(),
      getObject: vi.fn()
    };
    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => dummyExecutionResult),
      getRuntimeComponents
    };

    const enforceLicenseRouting = createApprovedEnforceLicenseRouting();
    const useCase = new AssembleDeliveryReel({
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      generationManifestRepository: createApprovedGenerationManifestRepository(),
      // runtimeComponents deliberately empty: mockAssembler.assemble is
      // approved via defaultRequiredComponents below, so this proves
      // getRuntimeComponents is never invoked even on a path that
      // otherwise succeeds.
      runtimeComponents: []
    });

    await useCase.assemble({
      spec: validSpec,
      requiredComponents: defaultRequiredComponents
    });

    expect(getRuntimeComponents).not.toHaveBeenCalled();
  });

  it("permits assembly and embeds generated governanceDecisionId when required components are approved", async () => {
    const putObjectCalls: PutObjectInput[] = [];
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(async (input: PutObjectInput) => {
        putObjectCalls.push(input);
        return { bucket: input.bucket, key: input.key };
      }),
      copyObject: vi.fn(async (_from, to) => to),
      getObject: vi.fn()
    };
    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => dummyExecutionResult)
    };
    const enforceLicenseRouting = createApprovedEnforceLicenseRouting();
    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      generationManifestRepository: createApprovedGenerationManifestRepository()
    });

    const result = await useCase.assemble({
      spec: validSpec,
      requiredComponents: defaultRequiredComponents
    });

    expect(mockAssembler.assemble).toHaveBeenCalledWith(validSpec);
    expect(mockStorage.putObject).toHaveBeenCalledTimes(1);
    expect(result.manifest.governanceDecisionId).toMatch(/^gov-dec-[0-9a-f-]{36}$/);
    const storedJson = JSON.parse(new TextDecoder().decode(putObjectCalls[0]?.body));
    expect(storedJson.governanceDecisionId).toBe(result.manifest.governanceDecisionId);
  });

  it("denies assembly with zero ffmpeg spawn when a video stem's generationManifestId does not resolve to any manifest", async () => {
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(),
      copyObject: vi.fn(),
      getObject: vi.fn()
    };
    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => dummyExecutionResult)
    };
    const enforceLicenseRouting = createApprovedEnforceLicenseRouting();
    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      // Every lookup misses — simulates a generationManifestId that
      // doesn't correspond to any row in generation_manifests (e.g. a
      // caller-fabricated or stale ID).
      generationManifestRepository: {
        getComponentIdentityById: async () => undefined
      }
    });

    await expect(
      useCase.assemble({
        spec: validSpec,
        requiredComponents: defaultRequiredComponents
      })
    ).rejects.toThrow(LicenseRoutingError);

    expect(mockAssembler.assemble).not.toHaveBeenCalled();
    expect(mockStorage.putObject).not.toHaveBeenCalled();
  });

  it("denies assembly when a video stem's generation manifest resolves to a render profile the registry does not approve", async () => {
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(),
      copyObject: vi.fn(),
      getObject: vi.fn()
    };
    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => dummyExecutionResult)
    };
    const enforceLicenseRouting = createApprovedEnforceLicenseRouting();
    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      generationManifestRepository: {
        getComponentIdentityById: async () => ({
          // Not "ltx-fake-profile" — not in the fake registry at all.
          renderProfile: "some-unregistered-profile",
          renderProfileVersion: 1
        })
      }
    });

    await expect(
      useCase.assemble({
        spec: validSpec,
        requiredComponents: defaultRequiredComponents
      })
    ).rejects.toThrow(LicenseRoutingError);

    expect(mockAssembler.assemble).not.toHaveBeenCalled();
    expect(mockStorage.putObject).not.toHaveBeenCalled();
  });

  it("permits assembly when every video stem's generation manifest resolves to an approved render profile", async () => {
    const putObjectCalls: PutObjectInput[] = [];
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(async (input: PutObjectInput): Promise<ObjectLocator> => {
        putObjectCalls.push(input);
        return { bucket: input.bucket, key: input.key };
      }),
      copyObject: vi.fn(async (_from, to) => to),
      getObject: vi.fn(async () => undefined)
    };
    const getComponentIdentityById = vi.fn(async (generationManifestId: string) => {
      expect(generationManifestId).toBe("gen-1");
      return { renderProfile: "ltx-fake-profile", renderProfileVersion: 1 };
    });
    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => dummyExecutionResult)
    };
    const enforceLicenseRouting = createApprovedEnforceLicenseRouting();
    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      generationManifestRepository: { getComponentIdentityById }
    });

    const result = await useCase.assemble({
      spec: validSpec,
      requiredComponents: defaultRequiredComponents
    });

    expect(getComponentIdentityById).toHaveBeenCalledTimes(1);
    expect(mockAssembler.assemble).toHaveBeenCalledWith(validSpec);
    expect(result.manifest.assemblyId).toBe("assembly-test-123");
    expect(mockStorage.putObject).toHaveBeenCalledTimes(1);
  });

  it("short-circuits and returns existing manifest without media assembly execution or storage put when matching manifest already exists", async () => {
    const assemblyId = computeAssemblyId(validSpec);
    const existingExecutionResult: AssemblyExecutionResult = {
      ...dummyExecutionResult,
      assemblyId
    };
    const existingManifest = createAssemblyManifest({
      executionResult: existingExecutionResult,
      governanceDecisionId: "gov-dec-existing-001"
    });

    const manifestKey = `campaigns/${validSpec.campaignId}/assemblies/${assemblyId}/manifest.json`;
    const manifestBytes = Buffer.from(JSON.stringify(existingManifest), "utf-8");

    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(),
      copyObject: vi.fn(),
      headObject: vi.fn(async (locator) => {
        if (locator.key === existingManifest.output.media.key) {
          return {
            bucket: locator.bucket,
            key: locator.key,
            checksumSha256: existingManifest.output.media.sha256,
            contentType: "video/mp4"
          };
        }
        return undefined;
      }),
      getObject: vi.fn(async ({ bucket, key }) => {
        if (bucket === "godzspeed-delivery" && key === manifestKey) {
          return { bucket, key, body: manifestBytes };
        }
        return undefined;
      })
    };

    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn()
    };

    const enforceLicenseRouting = createApprovedEnforceLicenseRouting();
    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      generationManifestRepository: createApprovedGenerationManifestRepository()
    });

    const result = await useCase.assemble({
      spec: validSpec,
      requiredComponents: defaultRequiredComponents
    });

    expect(mockAssembler.assemble).not.toHaveBeenCalled();
    expect(mockStorage.putObject).not.toHaveBeenCalled();
    expect(result.manifest).toEqual(existingManifest);
    expect(result.executionResult.assemblyId).toBe(assemblyId);
    expect(result.executionResult.campaignId).toBe(validSpec.campaignId);
  });

  it("denies with zero FFmpeg spawn even when a matching manifest already exists in storage — the license guard always runs before the existence short-circuit", async () => {
    // Regression test: a component approved when a manifest was originally
    // published can later be revoked (status flipped to review_required,
    // restricted, or blocked). The existence-check short-circuit must never
    // let a caller keep retrieving that manifest without the guard
    // re-evaluating current registry status on every call.
    const assemblyId = computeAssemblyId(validSpec);
    const existingExecutionResult: AssemblyExecutionResult = {
      ...dummyExecutionResult,
      assemblyId
    };
    const existingManifest = createAssemblyManifest({
      executionResult: existingExecutionResult,
      governanceDecisionId: "gov-dec-existing-001"
    });

    const manifestKey = `campaigns/${validSpec.campaignId}/assemblies/${assemblyId}/manifest.json`;
    const manifestBytes = Buffer.from(JSON.stringify(existingManifest), "utf-8");

    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(),
      copyObject: vi.fn(),
      getObject: vi.fn(async ({ bucket, key }) => {
        if (bucket === "godzspeed-delivery" && key === manifestKey) {
          return { bucket, key, body: manifestBytes };
        }
        return undefined;
      })
    };
    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => dummyExecutionResult)
    };

    // Component that was approved when the existing manifest was published
    // is now review_required -- the registry has changed since then.
    const registry = {
      getSnapshot: () => ({
        schemaVersion: 1 as const,
        registryRevision: "2026-08-29.2",
        generatedAt: "2026-08-29T12:00:00.000Z",
        entries: [
          {
            componentId: "ffmpeg",
            componentType: "runtime" as const,
            versionOrRevision: "n8.0.1",
            status: "review_required" as const,
            licenseSource: "registry",
            reviewedAt: "2026-08-29T12:00:00.000Z",
            policyRevision: "1"
          }
        ]
      })
    };
    const enforceLicenseRouting = new EnforceLicenseRouting({ registry });

    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage,
      enforceLicenseRouting,
      generationManifestRepository: createApprovedGenerationManifestRepository()
    });

    await expect(
      useCase.assemble({
        spec: validSpec,
        requiredComponents: [
          {
            componentId: "ffmpeg",
            componentType: "runtime",
            versionOrRevision: "n8.0.1"
          }
        ]
      })
    ).rejects.toThrow(LicenseRoutingError);

    expect(mockAssembler.assemble).not.toHaveBeenCalled();
    expect(mockStorage.putObject).not.toHaveBeenCalled();
  });
});
