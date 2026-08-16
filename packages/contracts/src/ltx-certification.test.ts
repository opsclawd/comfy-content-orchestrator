import { describe, expect, it } from "vitest";
import {
  LtxCertificationArtifactSchema,
  type LtxCertificationArtifact
} from "./ltx-certification.js";

describe("LtxCertificationArtifactSchema", () => {
  const validPassedFixture: LtxCertificationArtifact = {
    version: 1,
    runId: "trinidad-rtx4090-dynamicvram-v1",
    generatedAt: "2026-08-15T20:00:00.000Z",
    status: "passed",
    runnerMode: "dynamicvram",
    identity: {
      profileId: "ltx-25-720p-97f",
      renderProfileKey: "LTX_25_720P_5S_V1",
      renderProfileVersion: 1,
      engine: "ltx_25",
      width: 1280,
      height: 720,
      frames: 97,
      steps: 8,
      workflowSha256: "a".repeat(64),
      modelSha256: {
        checkpoint: "b".repeat(64),
        textEncoder: "c".repeat(64),
        vae: "d".repeat(64)
      },
      comfyUiCommit: "e".repeat(40),
      customNodes: [
        {
          name: "ComfyUI-LTXVideo",
          commit: "f".repeat(40),
          status: "tracked"
        }
      ]
    },
    environment: {
      nodeVersion: "v24.0.0",
      platform: "linux",
      arch: "x64",
      osRelease: "6.8.0-40-generic",
      osVersion: "#40-Ubuntu SMP PREEMPT_DYNAMIC",
      cpuModel: "AMD Ryzen 9 7950X",
      cpuCount: 32,
      gpuName: "NVIDIA GeForce RTX 4090",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      gpuDriverVersion: "550.54.14",
      gpuTotalMemoryMb: 24564,
      cudaVersion: "12.4",
      comfyUiPid: 12345,
      comfyUiArgs: ["python3", "main.py", "--listen", "0.0.0.0", "--port", "8188"]
    },
    render: {
      executionId: "exec-123",
      status: "succeeded",
      outputObjectKeys: ["renders/scene-1/output.mp4"],
      startedAt: "2026-08-15T20:00:01.000Z",
      completedAt: "2026-08-15T20:00:47.000Z",
      totalDurationMs: 46000
    },
    telemetry: {
      sampleIntervalMs: 200,
      samples: [
        {
          measuredAt: "2026-08-15T20:00:01.000Z",
          phase: "pre_dispatch",
          gpu: {
            totalVramMb: 24564,
            usedVramMb: 1024,
            freeVramMb: 23540
          },
          host: {
            hostRamTotalMb: 64000,
            hostRamAvailableMb: 50000,
            hostRamUsedMb: 14000,
            swapTotalMb: 16000,
            swapUsedMb: 0,
            systemSwapInPages: 0,
            systemSwapOutPages: 0,
            systemMajorPageFaults: 100,
            systemMinorPageFaults: 5000,
            processPid: 12345,
            processStartTimeTicks: 100000,
            processRssMb: 1200,
            processMajorPageFaults: 10,
            processMinorPageFaults: 500
          }
        },
        {
          measuredAt: "2026-08-15T20:00:20.000Z",
          phase: "sampling",
          gpu: {
            totalVramMb: 24564,
            usedVramMb: 24028,
            freeVramMb: 536
          },
          host: {
            hostRamTotalMb: 64000,
            hostRamAvailableMb: 45000,
            hostRamUsedMb: 19000,
            swapTotalMb: 16000,
            swapUsedMb: 0,
            systemSwapInPages: 0,
            systemSwapOutPages: 0,
            systemMajorPageFaults: 105,
            systemMinorPageFaults: 6000,
            processPid: 12345,
            processStartTimeTicks: 100000,
            processRssMb: 4500,
            processMajorPageFaults: 12,
            processMinorPageFaults: 1200
          }
        },
        {
          measuredAt: "2026-08-15T20:00:52.000Z",
          phase: "post_unload",
          gpu: {
            totalVramMb: 24564,
            usedVramMb: 1024,
            freeVramMb: 23540
          },
          host: {
            hostRamTotalMb: 64000,
            hostRamAvailableMb: 49500,
            hostRamUsedMb: 14500,
            swapTotalMb: 16000,
            swapUsedMb: 0,
            systemSwapInPages: 0,
            systemSwapOutPages: 0,
            systemMajorPageFaults: 106,
            systemMinorPageFaults: 6200,
            processPid: 12345,
            processStartTimeTicks: 100000,
            processRssMb: 1300,
            processMajorPageFaults: 12,
            processMinorPageFaults: 1300
          }
        }
      ],
      samplingErrors: [],
      peakVramMb: 24028,
      peakHostRamUsedMb: 19000,
      peakProcessRssMb: 4500,
      swapUsedDeltaMb: 0,
      systemSwapInPageDelta: 0,
      systemSwapOutPageDelta: 0,
      systemMajorPageFaultDelta: 6,
      systemMinorPageFaultDelta: 1200,
      processMajorPageFaultDelta: 2,
      processMinorPageFaultDelta: 800,
      postUnloadUsedVramMb: 1024,
      postUnloadFreeVramMb: 23540
    },
    gate: {
      passed: true,
      maxDurationMs: 55000,
      checks: {
        renderSuccess: true,
        noOom: true,
        durationWithinLimit: true,
        telemetryComplete: true,
        postUnloadHeadroomObserved: true
      }
    },
    failure: null
  };

  const validFailedFixture: LtxCertificationArtifact = {
    ...validPassedFixture,
    status: "failed",
    render: {
      ...validPassedFixture.render,
      status: "failed",
      completedAt: "2026-08-15T20:00:25.000Z",
      totalDurationMs: 24000
    },
    telemetry: {
      ...validPassedFixture.telemetry,
      postUnloadUsedVramMb: null,
      postUnloadFreeVramMb: null
    },
    gate: {
      passed: false,
      maxDurationMs: 55000,
      checks: {
        renderSuccess: false,
        noOom: true,
        durationWithinLimit: true,
        telemetryComplete: true,
        postUnloadHeadroomObserved: false
      }
    },
    failure: {
      phase: "rendering",
      code: "render_failed",
      message: "ComfyUI execution error during sampling node 3",
      details: { nodeId: "3" }
    }
  };

  // Behavioral invariant: passed-artifact-is-complete
  it("accepts a complete passed DynamicVRAM certification artifact", () => {
    const result = LtxCertificationArtifactSchema.safeParse(validPassedFixture);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validPassedFixture);
    }
  });

  // Behavioral invariant: failed-artifact-keeps-evidence
  it("accepts a failed render artifact with partial measured evidence", () => {
    const result = LtxCertificationArtifactSchema.safeParse(validFailedFixture);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validFailedFixture);
      expect(result.data.failure?.code).toBe("render_failed");
      expect(result.data.gate.passed).toBe(false);
      expect(result.data.telemetry.postUnloadUsedVramMb).toBeNull();
      expect(result.data.telemetry.samples).toHaveLength(3);
    }
  });

  // Behavioral invariant: no-fabricated-success
  it("rejects a passed artifact when required measured evidence is missing", () => {
    // 1. Missing failure=null when status is passed
    const withFailureOnPassed = {
      ...validPassedFixture,
      failure: {
        phase: "rendering",
        code: "render_failed",
        message: "unexpected failure"
      }
    };
    const failRes1 = LtxCertificationArtifactSchema.safeParse(withFailureOnPassed);
    expect(failRes1.success).toBe(false);
    if (!failRes1.success) {
      const paths = failRes1.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("failure");
    }

    // 2. Render status failed on a passed artifact
    const withFailedRenderOnPassed = {
      ...validPassedFixture,
      render: { ...validPassedFixture.render, status: "failed" as const }
    };
    const failRes2 = LtxCertificationArtifactSchema.safeParse(withFailedRenderOnPassed);
    expect(failRes2.success).toBe(false);
    if (!failRes2.success) {
      const paths = failRes2.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("render.status");
    }

    // 3. Gate failed on a passed artifact
    const withFailedGateOnPassed = {
      ...validPassedFixture,
      gate: { ...validPassedFixture.gate, passed: false }
    };
    const failRes3 = LtxCertificationArtifactSchema.safeParse(withFailedGateOnPassed);
    expect(failRes3.success).toBe(false);
    if (!failRes3.success) {
      const paths = failRes3.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("gate.passed");
    }

    // 4. Missing raw samples on a passed artifact
    const withEmptySamples = {
      ...validPassedFixture,
      telemetry: { ...validPassedFixture.telemetry, samples: [] }
    };
    const failRes4 = LtxCertificationArtifactSchema.safeParse(withEmptySamples);
    expect(failRes4.success).toBe(false);
    if (!failRes4.success) {
      const paths = failRes4.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("telemetry.samples");
    }

    // 5. Missing peak VRAM on a passed artifact
    const withNullPeakVram = {
      ...validPassedFixture,
      telemetry: { ...validPassedFixture.telemetry, peakVramMb: null }
    };
    const failRes5 = LtxCertificationArtifactSchema.safeParse(withNullPeakVram);
    expect(failRes5.success).toBe(false);
    if (!failRes5.success) {
      const paths = failRes5.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("telemetry.peakVramMb");
    }

    // 6. Missing postUnloadUsedVramMb on a passed artifact
    const withNullPostUnload = {
      ...validPassedFixture,
      telemetry: { ...validPassedFixture.telemetry, postUnloadUsedVramMb: null }
    };
    const failRes6 = LtxCertificationArtifactSchema.safeParse(withNullPostUnload);
    expect(failRes6.success).toBe(false);
    if (!failRes6.success) {
      const paths = failRes6.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("telemetry.postUnloadUsedVramMb");
    }

    // 7. Sampling errors present on a passed artifact
    const withSamplingErrors = {
      ...validPassedFixture,
      telemetry: {
        ...validPassedFixture.telemetry,
        samplingErrors: [{ measuredAt: "2026-08-15T20:00:10.000Z", message: "nvidia-smi timeout" }]
      }
    };
    const failRes7 = LtxCertificationArtifactSchema.safeParse(withSamplingErrors);
    expect(failRes7.success).toBe(false);
    if (!failRes7.success) {
      const paths = failRes7.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("telemetry.samplingErrors");
    }

    // 8. Missing failure object on a failed artifact
    const failedWithoutFailureObject = {
      ...validFailedFixture,
      failure: null
    };
    const failRes8 = LtxCertificationArtifactSchema.safeParse(failedWithoutFailureObject);
    expect(failRes8.success).toBe(false);
    if (!failRes8.success) {
      const paths = failRes8.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("failure");
    }
  });

  // Behavioral invariant: workload-identity-is-pinned
  it("rejects an artifact for a different workload identity", () => {
    // 1. Invalid profileKey
    const badProfileKey = {
      ...validPassedFixture,
      identity: { ...validPassedFixture.identity, renderProfileKey: "OTHER_KEY" }
    };
    expect(LtxCertificationArtifactSchema.safeParse(badProfileKey).success).toBe(false);

    // 2. Invalid profileVersion
    const badProfileVersion = {
      ...validPassedFixture,
      identity: { ...validPassedFixture.identity, renderProfileVersion: 2 }
    };
    expect(LtxCertificationArtifactSchema.safeParse(badProfileVersion).success).toBe(false);

    // 3. Invalid engine
    const badEngine = {
      ...validPassedFixture,
      identity: { ...validPassedFixture.identity, engine: "flux" }
    };
    expect(LtxCertificationArtifactSchema.safeParse(badEngine).success).toBe(false);

    // 4. Invalid width
    const badWidth = {
      ...validPassedFixture,
      identity: { ...validPassedFixture.identity, width: 1920 }
    };
    expect(LtxCertificationArtifactSchema.safeParse(badWidth).success).toBe(false);

    // 5. Invalid height
    const badHeight = {
      ...validPassedFixture,
      identity: { ...validPassedFixture.identity, height: 1080 }
    };
    expect(LtxCertificationArtifactSchema.safeParse(badHeight).success).toBe(false);

    // 6. Invalid frames
    const badFrames = {
      ...validPassedFixture,
      identity: { ...validPassedFixture.identity, frames: 49 }
    };
    expect(LtxCertificationArtifactSchema.safeParse(badFrames).success).toBe(false);

    // 7. Invalid steps
    const badSteps = {
      ...validPassedFixture,
      identity: { ...validPassedFixture.identity, steps: 20 }
    };
    expect(LtxCertificationArtifactSchema.safeParse(badSteps).success).toBe(false);

    // 8. Invalid profileId
    const badProfileId = {
      ...validPassedFixture,
      identity: { ...validPassedFixture.identity, profileId: "flux-schnell" }
    };
    expect(LtxCertificationArtifactSchema.safeParse(badProfileId).success).toBe(false);
  });

  // Behavioral invariant: mode-is-explicit
  it("rejects invalid mode hashes intervals and counters", () => {
    // 1. Invalid runnerMode
    const badMode = {
      ...validPassedFixture,
      runnerMode: "lowvram"
    };
    expect(LtxCertificationArtifactSchema.safeParse(badMode).success).toBe(false);

    // 2. Invalid sampleIntervalMs
    const badInterval = {
      ...validPassedFixture,
      telemetry: { ...validPassedFixture.telemetry, sampleIntervalMs: 500 }
    };
    expect(LtxCertificationArtifactSchema.safeParse(badInterval).success).toBe(false);

    // 3. Invalid workflowSha256 (too short, uppercase, non-hex)
    expect(
      LtxCertificationArtifactSchema.safeParse({
        ...validPassedFixture,
        identity: { ...validPassedFixture.identity, workflowSha256: "short" }
      }).success
    ).toBe(false);
    expect(
      LtxCertificationArtifactSchema.safeParse({
        ...validPassedFixture,
        identity: { ...validPassedFixture.identity, workflowSha256: "A".repeat(64) }
      }).success
    ).toBe(false);
    expect(
      LtxCertificationArtifactSchema.safeParse({
        ...validPassedFixture,
        identity: { ...validPassedFixture.identity, workflowSha256: "z".repeat(64) }
      }).success
    ).toBe(false);

    // 4. Invalid modelSha256
    expect(
      LtxCertificationArtifactSchema.safeParse({
        ...validPassedFixture,
        identity: {
          ...validPassedFixture.identity,
          modelSha256: { checkpoint: "not-a-sha256" }
        }
      }).success
    ).toBe(false);

    // 5. Negative counter or memory metric in aggregates
    expect(
      LtxCertificationArtifactSchema.safeParse({
        ...validPassedFixture,
        telemetry: { ...validPassedFixture.telemetry, peakVramMb: -1 }
      }).success
    ).toBe(false);
    expect(
      LtxCertificationArtifactSchema.safeParse({
        ...validPassedFixture,
        telemetry: { ...validPassedFixture.telemetry, swapUsedDeltaMb: -10 }
      }).success
    ).toBe(false);
    expect(
      LtxCertificationArtifactSchema.safeParse({
        ...validPassedFixture,
        telemetry: { ...validPassedFixture.telemetry, processMajorPageFaultDelta: -5 }
      }).success
    ).toBe(false);

    // 6. Negative counter in sample
    const firstSample = validPassedFixture.telemetry.samples[0]!;
    const badSample = {
      ...validPassedFixture,
      telemetry: {
        ...validPassedFixture.telemetry,
        samples: [
          {
            ...firstSample,
            gpu: {
              ...firstSample.gpu,
              usedVramMb: -100
            }
          }
        ]
      }
    };
    expect(LtxCertificationArtifactSchema.safeParse(badSample).success).toBe(false);
  });
});
