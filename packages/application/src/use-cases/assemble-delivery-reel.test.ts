import { describe, expect, it, vi } from "vitest";
import type { AssemblyExecutionResult, AssemblySpec } from "@cco/contracts";
import type {
  MediaAssemblerPort,
  ObjectLocator,
  ObjectStoragePort,
  PutObjectInput
} from "../ports/index.js";
import {
  AssembleDeliveryReel,
  AssemblyManifestPublicationError
} from "./assemble-delivery-reel.js";

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

  it("assembles reel, creates manifest from executed state, and persists it with checksum", async () => {
    const putObjectCalls: PutObjectInput[] = [];
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(async (input: PutObjectInput): Promise<ObjectLocator> => {
        putObjectCalls.push(input);
        return { bucket: input.bucket, key: input.key };
      }),
      getObject: vi.fn(async () => undefined)
    };

    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => dummyExecutionResult)
    };

    const useCase = new AssembleDeliveryReel({
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage
    });

    const result = await useCase.assemble({
      spec: validSpec,
      governanceDecisionId: "gov-decision-xyz-789"
    });

    expect(mockAssembler.assemble).toHaveBeenCalledWith(validSpec);
    expect(result.manifest.assemblyId).toBe("assembly-test-123");
    expect(result.manifest.governanceDecisionId).toBe("gov-decision-xyz-789");
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
    expect(storedJson.governanceDecisionId).toBe("gov-decision-xyz-789");
  });

  it("rejects invalid spec before invoking media assembler or storage", async () => {
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(),
      getObject: vi.fn()
    };

    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn()
    };

    const useCase = new AssembleDeliveryReel({
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage
    });

    const invalidSpec = {
      ...validSpec,
      campaignId: "" // invalid
    };

    await expect(
      useCase.assemble({
        spec: invalidSpec as unknown as AssemblySpec,
        governanceDecisionId: "gov-1"
      })
    ).rejects.toThrow("campaignId must not be empty");

    expect(mockAssembler.assemble).not.toHaveBeenCalled();
    expect(mockStorage.putObject).not.toHaveBeenCalled();
  });

  it("does not publish manifest if media assembler fails", async () => {
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(),
      getObject: vi.fn()
    };

    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => {
        throw new Error("FFmpeg encode failed");
      })
    };

    const useCase = new AssembleDeliveryReel({
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage
    });

    await expect(
      useCase.assemble({
        spec: validSpec,
        governanceDecisionId: "gov-1"
      })
    ).rejects.toThrow("FFmpeg encode failed");

    expect(mockStorage.putObject).not.toHaveBeenCalled();
  });

  it("throws typed AssemblyManifestPublicationError with execution result when manifest persistence fails", async () => {
    const mockStorage: ObjectStoragePort = {
      putObject: vi.fn(async (): Promise<ObjectLocator> => {
        throw new Error("S3 connection timed out");
      }),
      getObject: vi.fn()
    };

    const mockAssembler: MediaAssemblerPort = {
      assemble: vi.fn(async () => dummyExecutionResult)
    };

    const useCase = new AssembleDeliveryReel({
      mediaAssembler: mockAssembler,
      objectStorage: mockStorage
    });

    let thrownError: unknown;
    try {
      await useCase.assemble({
        spec: validSpec,
        governanceDecisionId: "gov-1"
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(AssemblyManifestPublicationError);
    const pubErr = thrownError as AssemblyManifestPublicationError;
    expect(pubErr.name).toBe("AssemblyManifestPublicationError");
    expect(pubErr.executionResult).toEqual(dummyExecutionResult);
    expect(pubErr.manifest.assemblyId).toBe("assembly-test-123");
    expect(pubErr.manifest.governanceDecisionId).toBe("gov-1");
  });
});
