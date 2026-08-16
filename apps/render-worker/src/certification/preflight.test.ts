import { describe, expect, it, vi } from "vitest";
import type { CertificationProfile, CertificationProvenanceReport } from "@cco/infrastructure";
import type { CertificationEnvironment } from "@cco/contracts";
import {
  verifyGoldMasterProvenance,
  classifyCertificationHardware,
  verifyComfyUiMemoryMode,
  PreflightError
} from "./preflight.js";

function createValidProfile(): CertificationProfile {
  return {
    id: "ltx-25-720p-97f",
    engine: "ltx_25",
    workflowPath: "/home/gary/workflows/ltx_25_720p_97f_api.json",
    workflowRelativePath: "ltx_25_720p_97f_api.json",
    expectedWorkflowHash: "e6ee75a1df0ac80e4c420eadd820028a9a389f5e680c3de6d89c37159d9f582a",
    source: {
      kind: "validated_host_export",
      uri: "https://github.com/Lightricks/LTX-2",
      revision: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      license: "LTX-2 Community License"
    },
    baseline: {
      width: 1280,
      height: 720,
      frames: 97,
      steps: 8,
      approximateDurationSeconds: 5
    },
    minFreeDiskGb: 100,
    runnerProfile: "dynamicvram-offload-v1",
    models: [
      {
        category: "diffusion_models",
        relativePath: "ltx-video-2b-v0.9.1.safetensors"
      },
      {
        category: "clip",
        relativePath: "t5xxl_fp16.safetensors"
      },
      {
        category: "vae",
        relativePath: "ltx-video-vae.safetensors"
      }
    ],
    assertions: [
      {
        nodeId: "1",
        classType: "KSampler",
        input: "steps",
        equals: 8
      },
      {
        nodeId: "5",
        classType: "EmptyLTXLatentVideo",
        input: "width",
        equals: 1280
      },
      {
        nodeId: "5",
        classType: "EmptyLTXLatentVideo",
        input: "height",
        equals: 720
      },
      {
        nodeId: "5",
        classType: "EmptyLTXLatentVideo",
        input: "length",
        equals: 97
      }
    ],
    renderProfileIdentity: {
      key: "LTX_25_720P_5S_V1",
      version: 1
    }
  };
}

function createValidApprovedReport(): CertificationProvenanceReport {
  return {
    version: 1,
    profileId: "ltx-25-720p-97f",
    generatedAt: "2026-08-15T12:00:00.000Z",
    workflow: {
      relativePath: "ltx_25_720p_97f_api.json",
      sha256: "e6ee75a1df0ac80e4c420eadd820028a9a389f5e680c3de6d89c37159d9f582a",
      source: {
        kind: "validated_host_export",
        uri: "https://github.com/Lightricks/LTX-2",
        revision: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
        license: "LTX-2 Community License"
      }
    },
    models: [
      {
        category: "diffusion_models",
        relativePath: "ltx-video-2b-v0.9.1.safetensors",
        key: "diffusion_models/ltx-video-2b-v0.9.1.safetensors",
        sha256: "111111111111111111111111111111111111111111111111111111111111aaaa"
      },
      {
        category: "clip",
        relativePath: "t5xxl_fp16.safetensors",
        key: "clip/t5xxl_fp16.safetensors",
        sha256: "222222222222222222222222222222222222222222222222222222222222bbbb"
      },
      {
        category: "vae",
        relativePath: "ltx-video-vae.safetensors",
        key: "vae/ltx-video-vae.safetensors",
        sha256: "333333333333333333333333333333333333333333333333333333333333cccc"
      }
    ],
    git: {
      comfyUiCommit: "4444444444444444444444444444444444444444",
      customNodes: []
    },
    disk: {
      modelFootprintBytes: 70000000000,
      availableBytes: 200000000000,
      requiredFreeBytes: 100000000000,
      modelFootprintGb: 70,
      availableGb: 200,
      minFreeDiskGb: 100,
      passes: true
    },
    renderProfileProvenance: {
      key: "LTX_25_720P_5S_V1",
      version: 1,
      engine: "ltx_25",
      workflowHash: "e6ee75a1df0ac80e4c420eadd820028a9a389f5e680c3de6d89c37159d9f582a",
      modelHashes: {
        "diffusion_models/ltx-video-2b-v0.9.1.safetensors":
          "111111111111111111111111111111111111111111111111111111111111aaaa",
        "clip/t5xxl_fp16.safetensors":
          "222222222222222222222222222222222222222222222222222222222222bbbb",
        "vae/ltx-video-vae.safetensors":
          "333333333333333333333333333333333333333333333333333333333333cccc"
      },
      frames: 97,
      steps: 8,
      runnerProfile: "dynamicvram-offload-v1",
      measuredDiskFootprintGb: 70,
      minFreeDiskGb: 100
    }
  };
}

function createValidLiveReport(): CertificationProvenanceReport {
  return createValidApprovedReport();
}

function createValidEnvironment(): CertificationEnvironment {
  return {
    nodeVersion: "v24.0.0",
    platform: "linux",
    arch: "x64",
    osRelease: "6.8.0-40-generic",
    osVersion: "#40-Ubuntu SMP PREEMPT_DYNAMIC",
    cpuModel: "AMD Ryzen 7 7700",
    cpuCount: 16,
    gpuName: "NVIDIA GeForce RTX 4090",
    gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
    gpuDriverVersion: "550.54.14",
    gpuTotalMemoryMb: 24564,
    cudaVersion: "12.4",
    comfyUiPid: 12345,
    comfyUiArgs: ["python3", "main.py", "--listen", "0.0.0.0", "--port", "8188"]
  };
}

describe("apps/render-worker/src/certification/preflight", () => {
  describe("approved-and-live-identities-match", () => {
    it("accepts identical approved and live LTX provenance", () => {
      const profile = createValidProfile();
      const approved = createValidApprovedReport();
      const live = createValidLiveReport();

      expect(() => verifyGoldMasterProvenance({ approved, live, profile })).not.toThrow();
    });
  });

  describe("certified-workload-is-exact", () => {
    it("rejects a profile that is not the pinned 720p 97-frame 8-step workload", () => {
      const validApproved = createValidApprovedReport();
      const validLive = createValidLiveReport();

      const invalidWorkloads: Array<{
        name: string;
        mutate: (p: CertificationProfile) => CertificationProfile;
        expectedError: RegExp;
      }> = [
        {
          name: "wrong engine",
          mutate: (p) => ({ ...p, engine: "flux_schnell" }),
          expectedError: /engine/i
        },
        {
          name: "wrong width",
          mutate: (p) => ({
            ...p,
            baseline: { ...p.baseline, width: 1920 }
          }),
          expectedError: /width/i
        },
        {
          name: "wrong height",
          mutate: (p) => ({
            ...p,
            baseline: { ...p.baseline, height: 1080 }
          }),
          expectedError: /height/i
        },
        {
          name: "wrong frames",
          mutate: (p) => ({
            ...p,
            baseline: { ...p.baseline, frames: 121 }
          }),
          expectedError: /frame/i
        },
        {
          name: "wrong steps",
          mutate: (p) => ({
            ...p,
            baseline: { ...p.baseline, steps: 20 }
          }),
          expectedError: /step/i
        },
        {
          name: "wrong profile id",
          mutate: (p) => ({ ...p, id: "flux-schnell-draft" }),
          expectedError: /profile/i
        },
        {
          name: "null renderProfileIdentity",
          mutate: (p) => ({ ...p, renderProfileIdentity: null }),
          expectedError: /renderProfileIdentity/i
        },
        {
          name: "missing step assertion in workflow assertions",
          mutate: (p) => ({
            ...p,
            assertions: p.assertions.filter((a) => a.input !== "steps")
          }),
          expectedError: /assertion/i
        },
        {
          name: "wrong step value in workflow assertion",
          mutate: (p) => ({
            ...p,
            assertions: p.assertions.map((a) => (a.input === "steps" ? { ...a, equals: 4 } : a))
          }),
          expectedError: /assertion/i
        },
        {
          name: "missing width assertion in workflow assertions",
          mutate: (p) => ({
            ...p,
            assertions: p.assertions.filter((a) => a.input !== "width")
          }),
          expectedError: /assertion/i
        },
        {
          name: "missing height assertion in workflow assertions",
          mutate: (p) => ({
            ...p,
            assertions: p.assertions.filter((a) => a.input !== "height")
          }),
          expectedError: /assertion/i
        },
        {
          name: "missing frames/length assertion in workflow assertions",
          mutate: (p) => ({
            ...p,
            assertions: p.assertions.filter((a) => a.input !== "length" && a.input !== "frames")
          }),
          expectedError: /assertion/i
        }
      ];

      for (const { name, mutate, expectedError } of invalidWorkloads) {
        const invalidProfile = mutate(createValidProfile());
        expect(
          () =>
            verifyGoldMasterProvenance({
              approved: validApproved,
              live: validLive,
              profile: invalidProfile
            }),
          `Failed case: ${name}`
        ).toThrow(expectedError);
      }
    });
  });

  describe("any-drift-refuses-dispatch", () => {
    it("rejects workflow or model hash drift before dispatch", () => {
      const renderMock = vi.fn();
      const profile = createValidProfile();

      const driftCases: Array<{
        name: string;
        mutateLive: (l: CertificationProvenanceReport) => CertificationProvenanceReport;
        expectedError: RegExp;
      }> = [
        {
          name: "workflow hash mismatch between live and approved",
          mutateLive: (live) => ({
            ...live,
            workflow: {
              ...live.workflow,
              sha256: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
            },
            renderProfileProvenance: live.renderProfileProvenance
              ? {
                  ...live.renderProfileProvenance,
                  workflowHash: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
                }
              : null
          }),
          expectedError: /workflow.*hash/i
        },
        {
          name: "model hash modified in live",
          mutateLive: (live) => ({
            ...live,
            renderProfileProvenance: live.renderProfileProvenance
              ? {
                  ...live.renderProfileProvenance,
                  modelHashes: {
                    ...live.renderProfileProvenance.modelHashes,
                    "diffusion_models/ltx-video-2b-v0.9.1.safetensors":
                      "9999999999999999999999999999999999999999999999999999999999999999"
                  }
                }
              : null
          }),
          expectedError: /model.*hash/i
        },
        {
          name: "extra model hash in live",
          mutateLive: (live) => ({
            ...live,
            renderProfileProvenance: live.renderProfileProvenance
              ? {
                  ...live.renderProfileProvenance,
                  modelHashes: {
                    ...live.renderProfileProvenance.modelHashes,
                    "loras/extra_adapter.safetensors":
                      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                  }
                }
              : null
          }),
          expectedError: /model.*hash|extra/i
        },
        {
          name: "missing model hash in live",
          mutateLive: (live) => {
            const copy = { ...live.renderProfileProvenance?.modelHashes };
            delete copy["vae/ltx-video-vae.safetensors"];
            return {
              ...live,
              renderProfileProvenance: live.renderProfileProvenance
                ? {
                    ...live.renderProfileProvenance,
                    modelHashes: copy
                  }
                : null
            };
          },
          expectedError: /model.*hash|missing/i
        },
        {
          name: "uppercase hash drift in live (no normalization)",
          mutateLive: (live) => ({
            ...live,
            renderProfileProvenance: live.renderProfileProvenance
              ? {
                  ...live.renderProfileProvenance,
                  modelHashes: {
                    ...live.renderProfileProvenance.modelHashes,
                    "clip/t5xxl_fp16.safetensors":
                      "222222222222222222222222222222222222222222222222222222222222bbbb".toUpperCase()
                  }
                }
              : null
          }),
          expectedError: /model.*hash/i
        },
        {
          name: "render profile key drift",
          mutateLive: (live) => ({
            ...live,
            renderProfileProvenance: live.renderProfileProvenance
              ? {
                  ...live.renderProfileProvenance,
                  key: "FLUX_1_SCHNELL_V1" as unknown as "LTX_25_720P_5S_V1"
                }
              : null
          }),
          expectedError: /render.*profile.*key/i
        },
        {
          name: "render profile version drift",
          mutateLive: (live) => ({
            ...live,
            renderProfileProvenance: live.renderProfileProvenance
              ? {
                  ...live.renderProfileProvenance,
                  version: 2 as unknown as 1
                }
              : null
          }),
          expectedError: /version/i
        }
      ];

      for (const { name, mutateLive, expectedError } of driftCases) {
        const approved = createValidApprovedReport();
        const live = mutateLive(createValidLiveReport());

        expect(
          () =>
            (() => {
              verifyGoldMasterProvenance({ approved, live, profile });
              // Side effect that must never be called on failure
              renderMock();
            })(),
          `Failed drift case: ${name}`
        ).toThrow(expectedError);

        // Invariant check: Render dependency was never touched on preflight failure
        expect(renderMock).not.toHaveBeenCalled();
      }
    });
  });

  describe("approved-source-is-host-validated", () => {
    it("rejects provenance that is not an immutable validated host export", () => {
      const profile = createValidProfile();
      const live = createValidLiveReport();

      const invalidApprovedCases: Array<{
        name: string;
        approved: unknown;
        expectedError: RegExp;
      }> = [
        {
          name: "authored_from_spec source kind",
          approved: {
            ...createValidApprovedReport(),
            workflow: {
              ...createValidApprovedReport().workflow,
              source: {
                kind: "authored_from_spec",
                uri: "https://github.com/Lightricks/LTX-2",
                revision: "unpinned",
                license: "LTX-2 Community License"
              }
            }
          },
          expectedError: /validated_host_export|source\.kind/i
        },
        {
          name: "official_upstream source kind",
          approved: {
            ...createValidApprovedReport(),
            workflow: {
              ...createValidApprovedReport().workflow,
              source: {
                kind: "official_upstream",
                uri: "https://github.com/Lightricks/LTX-2",
                revision: "main",
                license: "LTX-2 Community License"
              }
            }
          },
          expectedError: /validated_host_export|source\.kind/i
        },
        {
          name: "unpinned revision",
          approved: {
            ...createValidApprovedReport(),
            workflow: {
              ...createValidApprovedReport().workflow,
              source: {
                kind: "validated_host_export",
                uri: "https://github.com/Lightricks/LTX-2",
                revision: "unpinned",
                license: "LTX-2 Community License"
              }
            }
          },
          expectedError: /unpinned|immutable|revision/i
        },
        {
          name: "empty revision",
          approved: {
            ...createValidApprovedReport(),
            workflow: {
              ...createValidApprovedReport().workflow,
              source: {
                kind: "validated_host_export",
                uri: "https://github.com/Lightricks/LTX-2",
                revision: "   ",
                license: "LTX-2 Community License"
              }
            }
          },
          expectedError: /revision/i
        },
        {
          name: "wrong profileId in approved report",
          approved: {
            ...createValidApprovedReport(),
            profileId: "flux-schnell-draft"
          },
          expectedError: /profileId/i
        },
        {
          name: "null renderProfileProvenance in approved report",
          approved: {
            ...createValidApprovedReport(),
            renderProfileProvenance: null
          },
          expectedError: /renderProfileProvenance/i
        },
        {
          name: "malformed approved JSON (array instead of object)",
          approved: [],
          expectedError: /object|malformed/i
        },
        {
          name: "malformed approved JSON (primitive)",
          approved: "invalid json string",
          expectedError: /object|malformed/i
        },
        {
          name: "missing workflow in approved report",
          approved: {
            version: 1,
            profileId: "ltx-25-720p-97f"
          },
          expectedError: /workflow/i
        }
      ];

      for (const { name, approved, expectedError } of invalidApprovedCases) {
        expect(
          () =>
            verifyGoldMasterProvenance({
              approved,
              live,
              profile
            }),
          `Failed approved source case: ${name}`
        ).toThrow(expectedError);
      }
    });
  });

  describe("target-gpu-is-exact", () => {
    it("classifies missing or non-RTX-4090 hardware as unsupported", () => {
      // 1. Valid RTX 4090 on Linux -> ready
      const validEnv = createValidEnvironment();
      const readyResult = classifyCertificationHardware(validEnv);
      expect(readyResult).toEqual({
        status: "ready",
        gpuName: "NVIDIA GeForce RTX 4090"
      });

      // 2. Non-RTX-4090 GPU (e.g. RTX 3090, A100, etc.) -> unsupported
      const otherGpuCases = [
        "NVIDIA GeForce RTX 3090",
        "NVIDIA A100-SXM4-80GB",
        "NVIDIA RTX A6000",
        "NVIDIA GeForce RTX 4080",
        "Apple M2 Max",
        "AMD Radeon RX 7900 XTX",
        "Tesla T4"
      ];

      for (const gpuName of otherGpuCases) {
        const env = { ...validEnv, gpuName };
        const result = classifyCertificationHardware(env);
        expect(result.status, `Testing GPU ${gpuName}`).toBe("unsupported");
        if (result.status === "unsupported") {
          expect(result.reason).toMatch(/NVIDIA GeForce RTX 4090/);
        }
      }

      // 3. Missing GPU identity / null / undefined -> unsupported
      expect(classifyCertificationHardware(null).status).toBe("unsupported");
      expect(classifyCertificationHardware(undefined).status).toBe("unsupported");
      expect(classifyCertificationHardware({ ...validEnv, gpuName: "" }).status).toBe(
        "unsupported"
      );

      // 4. Missing NVIDIA tooling error / exec error -> unsupported
      const toolingErrors = [
        new Error("spawn nvidia-smi ENOENT"),
        new Error("Failed to collect GPU identity from nvidia-smi: command not found"),
        new Error("nvidia-smi: not found"),
        new Error("GPU identity query did not return GPU index 0")
      ];

      for (const err of toolingErrors) {
        const result = classifyCertificationHardware(err);
        expect(result.status).toBe("unsupported");
      }

      // 5. Non-Linux platform -> unsupported
      const macEnv = { ...validEnv, platform: "darwin" };
      expect(classifyCertificationHardware(macEnv).status).toBe("unsupported");

      const winEnv = { ...validEnv, platform: "win32" };
      expect(classifyCertificationHardware(winEnv).status).toBe("unsupported");

      // 6. Malformed environment / invalid configuration -> refused
      const invalidEnv = { ...validEnv, comfyUiPid: -1 };
      const refusedResult = classifyCertificationHardware(invalidEnv);
      expect(refusedResult.status).toBe("refused");
    });
  });

  describe("memory-flags-are-exclusive", () => {
    it("enforces DynamicVRAM default and exclusive highvram comparator arguments", () => {
      // Table-driven test for ComfyUI argument combinations
      const cases: Array<{
        mode: "dynamicvram" | "highvram";
        args: string[];
        shouldPass: boolean;
        expectedError?: RegExp;
      }> = [
        // --- DynamicVRAM Mode Tests ---
        {
          mode: "dynamicvram",
          args: ["python3", "main.py", "--listen", "0.0.0.0", "--port", "8188"],
          shouldPass: true
        },
        {
          mode: "dynamicvram",
          args: ["python3", "main.py", "--port", "8188", "--preview-method", "auto"],
          shouldPass: true
        },
        {
          mode: "dynamicvram",
          args: ["python3", "main.py", "--highvram"],
          shouldPass: false,
          expectedError: /--highvram/i
        },
        {
          mode: "dynamicvram",
          args: ["python3", "main.py", "--lowvram"],
          shouldPass: false,
          expectedError: /--lowvram/i
        },
        {
          mode: "dynamicvram",
          args: ["python3", "main.py", "--novram"],
          shouldPass: false,
          expectedError: /--novram/i
        },
        {
          mode: "dynamicvram",
          args: ["python3", "main.py", "--gpu-only"],
          shouldPass: false,
          expectedError: /--gpu-only/i
        },
        {
          mode: "dynamicvram",
          args: ["python3", "main.py", "--normalvram"],
          shouldPass: false,
          expectedError: /--normalvram/i
        },
        {
          mode: "dynamicvram",
          args: ["python3", "main.py", "--cpu"],
          shouldPass: false,
          expectedError: /--cpu/i
        },
        {
          mode: "dynamicvram",
          args: ["python3", "main.py", "--highvram", "--gpu-only"],
          shouldPass: false,
          expectedError: /--highvram|--gpu-only/i
        },

        // --- HighVRAM Comparator Mode Tests ---
        {
          mode: "highvram",
          args: ["python3", "main.py", "--highvram", "--listen", "0.0.0.0"],
          shouldPass: true
        },
        {
          mode: "highvram",
          args: ["python3", "main.py", "--listen", "0.0.0.0"],
          shouldPass: false,
          expectedError: /requires.*--highvram/i
        },
        {
          mode: "highvram",
          args: ["python3", "main.py", "--highvram", "--lowvram"],
          shouldPass: false,
          expectedError: /conflict|exclusive|--lowvram/i
        },
        {
          mode: "highvram",
          args: ["python3", "main.py", "--highvram", "--gpu-only"],
          shouldPass: false,
          expectedError: /conflict|exclusive|--gpu-only/i
        },
        {
          mode: "highvram",
          args: ["python3", "main.py", "--highvram", "--novram"],
          shouldPass: false,
          expectedError: /conflict|exclusive|--novram/i
        },
        {
          mode: "highvram",
          args: ["python3", "main.py", "--highvram", "--cpu"],
          shouldPass: false,
          expectedError: /conflict|exclusive|--cpu/i
        },
        {
          mode: "highvram",
          args: ["python3", "main.py", "--highvram", "--normalvram"],
          shouldPass: false,
          expectedError: /conflict|exclusive|--normalvram/i
        },
        // Flags with equals syntax (--flag=value)
        {
          mode: "dynamicvram",
          args: ["python3", "main.py", "--highvram=1"],
          shouldPass: false,
          expectedError: /--highvram/i
        },
        {
          mode: "dynamicvram",
          args: ["python3", "main.py", "--lowvram=true"],
          shouldPass: false,
          expectedError: /--lowvram/i
        },
        {
          mode: "highvram",
          args: ["python3", "main.py", "--highvram=true"],
          shouldPass: true
        },
        {
          mode: "highvram",
          args: ["python3", "main.py", "--highvram", "--gpu-only=1"],
          shouldPass: false,
          expectedError: /--gpu-only/i
        }
      ];

      for (const { mode, args, shouldPass, expectedError } of cases) {
        if (shouldPass) {
          expect(
            () => verifyComfyUiMemoryMode(mode, args),
            `Mode ${mode} with args [${args.join(" ")}] should pass`
          ).not.toThrow();

          // Also test options object form
          expect(
            () =>
              verifyComfyUiMemoryMode({
                runnerMode: mode,
                comfyUiArgs: args
              }),
            `Mode ${mode} options object form should pass`
          ).not.toThrow();
        } else {
          expect(
            () => verifyComfyUiMemoryMode(mode, args),
            `Mode ${mode} with args [${args.join(" ")}] should fail`
          ).toThrow(expectedError);

          // Also test options object form
          expect(
            () =>
              verifyComfyUiMemoryMode({
                runnerMode: mode,
                comfyUiArgs: args
              }),
            `Mode ${mode} options object form should fail`
          ).toThrow(expectedError);
        }
      }
    });

    it("rejects unsupported runner modes", () => {
      expect(() => verifyComfyUiMemoryMode("invalid_mode" as unknown as "dynamicvram", [])).toThrow(
        /unsupported runner mode/i
      );
    });

    it("supports positional argument invocation for verifyGoldMasterProvenance", () => {
      const profile = createValidProfile();
      const approved = createValidApprovedReport();
      const live = createValidLiveReport();

      expect(() => verifyGoldMasterProvenance(approved, live, profile)).not.toThrow();
    });

    it("throws PreflightError instances on verification failure", () => {
      const profile = createValidProfile();
      const live = createValidLiveReport();

      expect.assertions(3);
      try {
        verifyGoldMasterProvenance({
          approved: null,
          live,
          profile
        });
      } catch (err) {
        expect(err).toBeInstanceOf(PreflightError);
        expect((err as PreflightError).name).toBe("PreflightError");
        expect((err as PreflightError).message).toMatch(/object/i);
      }
    });
  });
});
