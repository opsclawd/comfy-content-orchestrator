import { describe, expect, it } from "vitest";
import {
  CertificationArtifactSchema,
  type LtxCertificationArtifact,
  type CertificationArtifact
} from "./ltx-certification.js";

describe("CertificationArtifactSchema", () => {
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
            freeVramMb: 23540,
            reservedVramMb: 0
          },
          host: {
            hostRamTotalMb: 64000,
            hostRamAvailableMb: 50000,
            hostRamUsedMb: 14000,
            swapTotalMb: 16000,
            swapUsedMb: 0,
            systemSwapInPages: 0,
            systemSwapOutPages: 0,
            systemMajorPageFaults: 0,
            systemMinorPageFaults: 100,
            processPid: 12345,
            processStartTimeTicks: 5000,
            processRssMb: 1000,
            processMajorPageFaults: 0,
            processMinorPageFaults: 50
          }
        },
        {
          measuredAt: "2026-08-15T20:00:48.000Z",
          phase: "post_unload",
          gpu: {
            totalVramMb: 24564,
            usedVramMb: 1024,
            freeVramMb: 23540,
            reservedVramMb: 0
          },
          host: {
            hostRamTotalMb: 64000,
            hostRamAvailableMb: 50000,
            hostRamUsedMb: 14000,
            swapTotalMb: 16000,
            swapUsedMb: 0,
            systemSwapInPages: 0,
            systemSwapOutPages: 0,
            systemMajorPageFaults: 0,
            systemMinorPageFaults: 100,
            processPid: 12345,
            processStartTimeTicks: 5000,
            processRssMb: 1000,
            processMajorPageFaults: 0,
            processMinorPageFaults: 50
          }
        }
      ],
      samplingErrors: [],
      peakVramMb: 24028,
      reservedVramMb: 0,
      peakHostRamUsedMb: 14000,
      peakProcessRssMb: 1000,
      swapUsedDeltaMb: 0,
      systemSwapInPageDelta: 0,
      systemSwapOutPageDelta: 0,
      systemMajorPageFaultDelta: 0,
      systemMinorPageFaultDelta: 100,
      processMajorPageFaultDelta: 0,
      processMinorPageFaultDelta: 50,
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

  const validFluxPassedFixture: CertificationArtifact = {
    ...validPassedFixture,
    runId: "flux-schnell-cert-run-001",
    identity: {
      profileId: "flux-schnell-draft",
      renderProfileKey: "FLUX_SCHNELL_DRAFT_V1",
      renderProfileVersion: 1,
      engine: "flux_schnell",
      width: 1024,
      height: 1024,
      frames: 1,
      steps: 4,
      workflowSha256: "a".repeat(64),
      modelSha256: {
        clip1: "b".repeat(64),
        clip2: "c".repeat(64),
        diffusion: "d".repeat(64),
        vae: "e".repeat(64)
      },
      comfyUiCommit: "e".repeat(40),
      customNodes: []
    }
  };

  const validFailedFixture: LtxCertificationArtifact = {
    ...validPassedFixture,
    status: "failed",
    gate: {
      passed: false,
      maxDurationMs: 55000,
      checks: {
        renderSuccess: false,
        noOom: true,
        durationWithinLimit: false,
        telemetryComplete: true,
        postUnloadHeadroomObserved: true
      }
    },
    failure: {
      phase: "rendering",
      code: "render_failed",
      message: "Render failed with non-zero exit code",
      details: {
        nodeErrors: ["KSampler: CUDA error"]
      }
    }
  };

  it("accepts a fully compliant passed LTX certification artifact", () => {
    const result = CertificationArtifactSchema.safeParse(validPassedFixture);
    expect(result.success).toBe(true);
  });

  it("accepts a fully compliant passed FLUX certification artifact", () => {
    const result = CertificationArtifactSchema.safeParse(validFluxPassedFixture);
    expect(result.success).toBe(true);
  });

  it("accepts a fully compliant failed certification artifact", () => {
    const result = CertificationArtifactSchema.safeParse(validFailedFixture);
    expect(result.success).toBe(true);
  });

  describe("discriminated union workload identity validation", () => {
    it("rejects an artifact whose engine disagrees with its dimensions or profile", () => {
      // FLUX engine with LTX dimensions
      const fluxBadDims = {
        ...validFluxPassedFixture,
        identity: {
          ...validFluxPassedFixture.identity,
          width: 1280,
          height: 720
        }
      };
      expect(CertificationArtifactSchema.safeParse(fluxBadDims).success).toBe(false);

      // FLUX engine with LTX steps
      const fluxBadSteps = {
        ...validFluxPassedFixture,
        identity: {
          ...validFluxPassedFixture.identity,
          steps: 8
        }
      };
      expect(CertificationArtifactSchema.safeParse(fluxBadSteps).success).toBe(false);

      // FLUX engine with LTX frames
      const fluxBadFrames = {
        ...validFluxPassedFixture,
        identity: {
          ...validFluxPassedFixture.identity,
          frames: 97
        }
      };
      expect(CertificationArtifactSchema.safeParse(fluxBadFrames).success).toBe(false);

      // LTX engine with FLUX dimensions
      const ltxBadDims = {
        ...validPassedFixture,
        identity: {
          ...validPassedFixture.identity,
          width: 1024,
          height: 1024
        }
      };
      expect(CertificationArtifactSchema.safeParse(ltxBadDims).success).toBe(false);

      // LTX engine with FLUX steps
      const ltxBadSteps = {
        ...validPassedFixture,
        identity: {
          ...validPassedFixture.identity,
          steps: 4
        }
      };
      expect(CertificationArtifactSchema.safeParse(ltxBadSteps).success).toBe(false);

      // Mismatched profileId and engine
      const mismatchProfile = {
        ...validPassedFixture,
        identity: {
          ...validPassedFixture.identity,
          profileId: "flux-schnell-draft"
        }
      };
      expect(CertificationArtifactSchema.safeParse(mismatchProfile).success).toBe(false);
    });
  });

  describe("superRefine passed invariants", () => {
    it("rejects passed artifact if failure is not null", () => {
      const withFailureOnPassed = {
        ...validPassedFixture,
        failure: {
          phase: "rendering",
          code: "oom",
          message: "something"
        }
      };
      const failRes = CertificationArtifactSchema.safeParse(withFailureOnPassed);
      expect(failRes.success).toBe(false);
    });

    it("rejects passed artifact if render.status is not succeeded", () => {
      const withFailedRenderOnPassed = {
        ...validPassedFixture,
        render: {
          ...validPassedFixture.render,
          status: "failed" as const
        }
      };
      const failRes = CertificationArtifactSchema.safeParse(withFailedRenderOnPassed);
      expect(failRes.success).toBe(false);
    });

    it("rejects passed artifact if gate.passed is false", () => {
      const withFailedGateOnPassed = {
        ...validPassedFixture,
        gate: {
          ...validPassedFixture.gate,
          passed: false
        }
      };
      const failRes = CertificationArtifactSchema.safeParse(withFailedGateOnPassed);
      expect(failRes.success).toBe(false);
    });

    it("rejects passed artifact if samples are empty", () => {
      const withEmptySamples = {
        ...validPassedFixture,
        telemetry: {
          ...validPassedFixture.telemetry,
          samples: []
        }
      };
      const failRes = CertificationArtifactSchema.safeParse(withEmptySamples);
      expect(failRes.success).toBe(false);
    });

    it("rejects passed artifact if peakVramMb is null", () => {
      const withNullPeakVram = {
        ...validPassedFixture,
        telemetry: {
          ...validPassedFixture.telemetry,
          peakVramMb: null
        }
      };
      const failRes = CertificationArtifactSchema.safeParse(withNullPeakVram);
      expect(failRes.success).toBe(false);
    });
  });

  describe("superRefine failed invariants", () => {
    it("rejects failed artifact without failure object", () => {
      const failedWithoutFailureObject = {
        ...validFailedFixture,
        failure: null
      };
      const failRes = CertificationArtifactSchema.safeParse(failedWithoutFailureObject);
      expect(failRes.success).toBe(false);
    });
  });
});
