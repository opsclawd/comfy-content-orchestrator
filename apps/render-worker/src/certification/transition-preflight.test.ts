import { describe, expect, it, vi } from "vitest";
import type { CertificationProfile, CertificationProvenanceReport } from "@cco/infrastructure";
import { verifyTransitionGoldMasters, PreflightError } from "./transition-preflight.js";

function createValidFluxProfile(): CertificationProfile {
  return {
    id: "flux-schnell-draft",
    engine: "flux_schnell",
    workflowPath: "/home/gary/workflows/flux_schnell_draft_api.json",
    workflowRelativePath: "flux_schnell_draft_api.json",
    expectedWorkflowHash: "af8528239790f6536ce7f0733f92095501fecfd8e919084a9decdded59e6ecf5",
    source: {
      kind: "validated_host_export",
      uri: "https://github.com/comfyanonymous/ComfyUI",
      revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      license: "GPL-3.0"
    },
    baseline: {
      width: 1024,
      height: 1024,
      steps: 4
    },
    minFreeDiskGb: 0,
    runnerProfile: "dynamicvram-offload-v1",
    models: [
      {
        category: "diffusion_models",
        relativePath: "flux1-schnell.safetensors"
      },
      {
        category: "clip",
        relativePath: "t5xxl_fp8_e4m3fn.safetensors"
      },
      {
        category: "clip",
        relativePath: "clip_l.safetensors"
      },
      {
        category: "vae",
        relativePath: "ae.safetensors"
      }
    ],
    assertions: [
      {
        nodeId: "1",
        classType: "KSampler",
        input: "steps",
        equals: 4
      },
      {
        nodeId: "5",
        classType: "EmptyLatentImage",
        input: "width",
        equals: 1024
      },
      {
        nodeId: "5",
        classType: "EmptyLatentImage",
        input: "height",
        equals: 1024
      }
    ],
    renderProfileIdentity: null
  };
}

function createValidLtxProfile(): CertificationProfile {
  return {
    id: "ltx-25-720p-97f",
    engine: "ltx_25",
    workflowPath: "/home/gary/workflows/ltx_25_720p_97f_api.json",
    workflowRelativePath: "ltx_25_720p_97f_api.json",
    expectedWorkflowHash: "94f397eee3ad8b0cee000036119e524e8c7a012b88d79d00b74172df9d9bf539",
    source: {
      kind: "validated_host_export",
      uri: "https://github.com/comfyanonymous/ComfyUI",
      revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      license: "GPL-3.0"
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
        relativePath: "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors"
      },
      {
        category: "clip",
        relativePath: "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors"
      },
      {
        category: "vae",
        relativePath: "ltx-2.5-video-vae-conv-bf16.safetensors"
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
        classType: "EmptyLTXVLatentVideo",
        input: "width",
        equals: 1280
      },
      {
        nodeId: "5",
        classType: "EmptyLTXVLatentVideo",
        input: "height",
        equals: 720
      },
      {
        nodeId: "5",
        classType: "EmptyLTXVLatentVideo",
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

function createValidFluxApprovedReport(): CertificationProvenanceReport {
  return {
    version: 1,
    profileId: "flux-schnell-draft",
    generatedAt: "2026-08-15T12:00:00.000Z",
    workflow: {
      relativePath: "flux_schnell_draft_api.json",
      sha256: "af8528239790f6536ce7f0733f92095501fecfd8e919084a9decdded59e6ecf5",
      source: {
        kind: "validated_host_export",
        uri: "https://github.com/comfyanonymous/ComfyUI",
        revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        license: "GPL-3.0"
      }
    },
    models: [
      {
        category: "diffusion_models",
        relativePath: "flux1-schnell.safetensors",
        key: "diffusion_models/flux1-schnell.safetensors",
        bytes: 23800000000,
        sha256: "1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        category: "clip",
        relativePath: "t5xxl_fp8_e4m3fn.safetensors",
        key: "clip/t5xxl_fp8_e4m3fn.safetensors",
        bytes: 4900000000,
        sha256: "2222222222222222222222222222222222222222222222222222222222222222"
      },
      {
        category: "clip",
        relativePath: "clip_l.safetensors",
        key: "clip/clip_l.safetensors",
        bytes: 246000000,
        sha256: "3333333333333333333333333333333333333333333333333333333333333333"
      },
      {
        category: "vae",
        relativePath: "ae.safetensors",
        key: "vae/ae.safetensors",
        bytes: 335000000,
        sha256: "4444444444444444444444444444444444444444444444444444444444444444"
      }
    ],
    git: {
      comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      customNodes: []
    },
    disk: {
      modelFootprintBytes: 29281000000,
      availableBytes: 200000000000,
      requiredFreeBytes: 0,
      modelFootprintGb: 29.28,
      availableGb: 200,
      minFreeDiskGb: 0,
      passes: true
    },
    renderProfileProvenance: null
  };
}

function createValidLtxApprovedReport(): CertificationProvenanceReport {
  return {
    version: 1,
    profileId: "ltx-25-720p-97f",
    generatedAt: "2026-08-15T12:00:00.000Z",
    workflow: {
      relativePath: "ltx_25_720p_97f_api.json",
      sha256: "94f397eee3ad8b0cee000036119e524e8c7a012b88d79d00b74172df9d9bf539",
      source: {
        kind: "validated_host_export",
        uri: "https://github.com/comfyanonymous/ComfyUI",
        revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        license: "GPL-3.0"
      }
    },
    models: [
      {
        category: "diffusion_models",
        relativePath: "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
        key: "diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
        bytes: 23800000000,
        sha256: "5555555555555555555555555555555555555555555555555555555555555555"
      },
      {
        category: "clip",
        relativePath: "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
        key: "clip/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
        bytes: 14000000000,
        sha256: "6666666666666666666666666666666666666666666666666666666666666666"
      },
      {
        category: "vae",
        relativePath: "ltx-2.5-video-vae-conv-bf16.safetensors",
        key: "vae/ltx-2.5-video-vae-conv-bf16.safetensors",
        bytes: 335000000,
        sha256: "7777777777777777777777777777777777777777777777777777777777777777"
      }
    ],
    git: {
      comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      customNodes: []
    },
    disk: {
      modelFootprintBytes: 38135000000,
      availableBytes: 200000000000,
      requiredFreeBytes: 100000000000,
      modelFootprintGb: 38.14,
      availableGb: 200,
      minFreeDiskGb: 100,
      passes: true
    },
    renderProfileProvenance: {
      key: "LTX_25_720P_5S_V1",
      version: 1,
      engine: "ltx_25",
      workflowHash: "94f397eee3ad8b0cee000036119e524e8c7a012b88d79d00b74172df9d9bf539",
      modelHashes: {
        "diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors":
          "5555555555555555555555555555555555555555555555555555555555555555",
        "clip/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors":
          "6666666666666666666666666666666666666666666666666666666666666666",
        "vae/ltx-2.5-video-vae-conv-bf16.safetensors":
          "7777777777777777777777777777777777777777777777777777777777777777"
      },
      frames: 97,
      steps: 8,
      runnerProfile: "dynamicvram-offload-v1",
      measuredDiskFootprintGb: 38.14,
      minFreeDiskGb: 100
    }
  };
}

function createValidFluxLiveReport(): CertificationProvenanceReport {
  return createValidFluxApprovedReport();
}

function createValidLtxLiveReport(): CertificationProvenanceReport {
  return createValidLtxApprovedReport();
}

describe("apps/render-worker/src/certification/transition-preflight", () => {
  describe("both-families-required", () => {
    it("accepts pinned live and approved provenance for both families", () => {
      const fluxProfile = createValidFluxProfile();
      const ltxProfile = createValidLtxProfile();
      const fluxApproved = createValidFluxApprovedReport();
      const ltxApproved = createValidLtxApprovedReport();
      const fluxLive = createValidFluxLiveReport();
      const ltxLive = createValidLtxLiveReport();

      // Form 1: keyed by family (flux, ltx)
      expect(() =>
        verifyTransitionGoldMasters({
          profiles: { flux: fluxProfile, ltx: ltxProfile },
          approved: { flux: fluxApproved, ltx: ltxApproved },
          live: { flux: fluxLive, ltx: ltxLive }
        })
      ).not.toThrow();

      // Form 2: keyed by profile ID
      expect(() =>
        verifyTransitionGoldMasters({
          profiles: {
            "flux-schnell-draft": fluxProfile,
            "ltx-25-720p-97f": ltxProfile
          },
          approved: {
            "flux-schnell-draft": fluxApproved,
            "ltx-25-720p-97f": ltxApproved
          },
          live: {
            "flux-schnell-draft": fluxLive,
            "ltx-25-720p-97f": ltxLive
          }
        })
      ).not.toThrow();

      // Form 3: array form
      expect(() =>
        verifyTransitionGoldMasters({
          profiles: [fluxProfile, ltxProfile],
          approved: [fluxApproved, ltxApproved],
          live: [fluxLive, ltxLive]
        })
      ).not.toThrow();
    });
  });

  describe("flux-blocker-fails-closed", () => {
    it("rejects an absent or authored FLUX profile before dispatch", () => {
      const sideEffect = vi.fn();
      const validLtxProfile = createValidLtxProfile();
      const validLtxApproved = createValidLtxApprovedReport();
      const validLtxLive = createValidLtxLiveReport();

      // Case 1: FLUX profile is absent
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { ltx: validLtxProfile } as unknown as {
            flux: CertificationProfile;
            ltx: CertificationProfile;
          },
          approved: { flux: createValidFluxApprovedReport(), ltx: validLtxApproved },
          live: { flux: createValidFluxLiveReport(), ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(PreflightError);
      expect(sideEffect).not.toHaveBeenCalled();

      // Case 2: FLUX approved report is absent
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: createValidFluxProfile(), ltx: validLtxProfile },
          approved: { ltx: validLtxApproved } as unknown as {
            flux: unknown;
            ltx: unknown;
          },
          live: { flux: createValidFluxLiveReport(), ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(PreflightError);
      expect(sideEffect).not.toHaveBeenCalled();

      // Case 3: FLUX live report is absent
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: createValidFluxProfile(), ltx: validLtxProfile },
          approved: { flux: createValidFluxApprovedReport(), ltx: validLtxApproved },
          live: { ltx: validLtxLive } as unknown as {
            flux: CertificationProvenanceReport;
            ltx: CertificationProvenanceReport;
          }
        });
        sideEffect();
      }).toThrow(PreflightError);
      expect(sideEffect).not.toHaveBeenCalled();

      // Case 4: FLUX profile source is "authored_from_spec"
      const authoredFluxProfile: CertificationProfile = {
        ...createValidFluxProfile(),
        source: {
          kind: "authored_from_spec",
          uri: "https://github.com/comfyanonymous/ComfyUI",
          revision: "unpinned",
          license: "GPL-3.0"
        }
      };
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: authoredFluxProfile, ltx: validLtxProfile },
          approved: { flux: createValidFluxApprovedReport(), ltx: validLtxApproved },
          live: { flux: createValidFluxLiveReport(), ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(/validated_host_export|source\.kind|authored/i);
      expect(sideEffect).not.toHaveBeenCalled();

      // Case 5: FLUX profile source is "official_upstream"
      const upstreamFluxProfile: CertificationProfile = {
        ...createValidFluxProfile(),
        source: {
          kind: "official_upstream",
          uri: "https://github.com/comfyanonymous/ComfyUI",
          revision: "main",
          license: "GPL-3.0"
        }
      };
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: upstreamFluxProfile, ltx: validLtxProfile },
          approved: { flux: createValidFluxApprovedReport(), ltx: validLtxApproved },
          live: { flux: createValidFluxLiveReport(), ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(/validated_host_export|source\.kind/i);
      expect(sideEffect).not.toHaveBeenCalled();

      // Case 6: FLUX profile revision is "unpinned"
      const unpinnedFluxProfile: CertificationProfile = {
        ...createValidFluxProfile(),
        source: {
          kind: "validated_host_export",
          uri: "https://github.com/comfyanonymous/ComfyUI",
          revision: "unpinned",
          license: "GPL-3.0"
        }
      };
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: unpinnedFluxProfile, ltx: validLtxProfile },
          approved: { flux: createValidFluxApprovedReport(), ltx: validLtxApproved },
          live: { flux: createValidFluxLiveReport(), ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(/unpinned|immutable|revision/i);
      expect(sideEffect).not.toHaveBeenCalled();
    });
  });

  describe("drift-rejection", () => {
    it("rejects workflow model or ComfyUI revision drift for either family", () => {
      const sideEffect = vi.fn();
      const validFluxProfile = createValidFluxProfile();
      const validLtxProfile = createValidLtxProfile();
      const validFluxApproved = createValidFluxApprovedReport();
      const validLtxApproved = createValidLtxApprovedReport();

      const driftCases: Array<{
        name: string;
        fluxLive: CertificationProvenanceReport;
        ltxLive: CertificationProvenanceReport;
        expectedError: RegExp;
      }> = [
        // Workflow drift FLUX
        {
          name: "FLUX workflow hash drift",
          fluxLive: {
            ...createValidFluxLiveReport(),
            workflow: {
              ...createValidFluxLiveReport().workflow,
              sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            }
          },
          ltxLive: createValidLtxLiveReport(),
          expectedError: /workflow.*hash/i
        },
        // Workflow drift LTX
        {
          name: "LTX workflow hash drift",
          fluxLive: createValidFluxLiveReport(),
          ltxLive: {
            ...createValidLtxLiveReport(),
            workflow: {
              ...createValidLtxLiveReport().workflow,
              sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
            }
          },
          expectedError: /workflow.*hash/i
        },
        // Model drift FLUX
        {
          name: "FLUX model hash modified",
          fluxLive: {
            ...createValidFluxLiveReport(),
            models: createValidFluxLiveReport().models.map((m) =>
              m.key === "diffusion_models/flux1-schnell.safetensors"
                ? {
                    ...m,
                    sha256: "9999999999999999999999999999999999999999999999999999999999999999"
                  }
                : m
            )
          },
          ltxLive: createValidLtxLiveReport(),
          expectedError: /model.*hash/i
        },
        // Model drift LTX
        {
          name: "LTX model hash modified",
          fluxLive: createValidFluxLiveReport(),
          ltxLive: {
            ...createValidLtxLiveReport(),
            models: createValidLtxLiveReport().models.map((m) =>
              m.key === "vae/ltx-2.5-video-vae-conv-bf16.safetensors"
                ? {
                    ...m,
                    sha256: "9999999999999999999999999999999999999999999999999999999999999999"
                  }
                : m
            )
          },
          expectedError: /model.*hash/i
        },
        // Missing model in FLUX live
        {
          name: "FLUX missing model in live",
          fluxLive: {
            ...createValidFluxLiveReport(),
            models: createValidFluxLiveReport().models.filter((m) => m.key !== "vae/ae.safetensors")
          },
          ltxLive: createValidLtxLiveReport(),
          expectedError: /missing.*model|model.*hash/i
        },
        // Extra model in LTX live
        {
          name: "LTX extra model in live",
          fluxLive: createValidFluxLiveReport(),
          ltxLive: {
            ...createValidLtxLiveReport(),
            models: [
              ...createValidLtxLiveReport().models,
              {
                category: "loras",
                relativePath: "extra.safetensors",
                key: "loras/extra.safetensors",
                bytes: 1000,
                sha256: "8888888888888888888888888888888888888888888888888888888888888888"
              }
            ]
          },
          expectedError: /extra.*model|model.*hash/i
        },
        // ComfyUI commit drift FLUX live vs approved
        {
          name: "FLUX ComfyUI commit drift",
          fluxLive: {
            ...createValidFluxLiveReport(),
            git: {
              ...createValidFluxLiveReport().git,
              comfyUiCommit: "9999999999999999999999999999999999999999"
            }
          },
          ltxLive: createValidLtxLiveReport(),
          expectedError: /comfyui.*commit|revision/i
        },
        // ComfyUI commit drift LTX live vs approved
        {
          name: "LTX ComfyUI commit drift",
          fluxLive: createValidFluxLiveReport(),
          ltxLive: {
            ...createValidLtxLiveReport(),
            git: {
              ...createValidLtxLiveReport().git,
              comfyUiCommit: "9999999999999999999999999999999999999999"
            }
          },
          expectedError: /comfyui.*commit|revision/i
        },
        // Custom node drift in live
        {
          name: "Custom node mismatch",
          fluxLive: {
            ...createValidFluxLiveReport(),
            git: {
              ...createValidFluxLiveReport().git,
              customNodes: [
                {
                  name: "ComfyUI-Manager",
                  commit: "1111111111111111111111111111111111111111",
                  status: "tracked"
                }
              ]
            }
          },
          ltxLive: createValidLtxLiveReport(),
          expectedError: /custom.*node/i
        }
      ];

      for (const { name, fluxLive, ltxLive, expectedError } of driftCases) {
        expect(() => {
          verifyTransitionGoldMasters({
            profiles: { flux: validFluxProfile, ltx: validLtxProfile },
            approved: { flux: validFluxApproved, ltx: validLtxApproved },
            live: { flux: fluxLive, ltx: ltxLive }
          });
          sideEffect();
        }, `Failed drift case: ${name}`).toThrow(expectedError);
        expect(sideEffect).not.toHaveBeenCalled();
      }
    });
  });

  describe("runner-profile-requirement", () => {
    it("requires dynamicvram-offload-v1 on both profiles", () => {
      const sideEffect = vi.fn();
      const validFluxProfile = createValidFluxProfile();
      const validLtxProfile = createValidLtxProfile();
      const validFluxApproved = createValidFluxApprovedReport();
      const validLtxApproved = createValidLtxApprovedReport();
      const validFluxLive = createValidFluxLiveReport();
      const validLtxLive = createValidLtxLiveReport();

      // FLUX profile with non-dynamicvram runnerProfile
      const invalidFluxProfile: CertificationProfile = {
        ...validFluxProfile,
        runnerProfile: "highvram-v1"
      };
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: invalidFluxProfile, ltx: validLtxProfile },
          approved: { flux: validFluxApproved, ltx: validLtxApproved },
          live: { flux: validFluxLive, ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(/dynamicvram-offload-v1|runnerProfile/i);
      expect(sideEffect).not.toHaveBeenCalled();

      // LTX profile with non-dynamicvram runnerProfile
      const invalidLtxProfile: CertificationProfile = {
        ...validLtxProfile,
        runnerProfile: "default"
      };
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: validFluxProfile, ltx: invalidLtxProfile },
          approved: { flux: validFluxApproved, ltx: validLtxApproved },
          live: { flux: validFluxLive, ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(/dynamicvram-offload-v1|runnerProfile/i);
      expect(sideEffect).not.toHaveBeenCalled();

      // LTX approved report with non-dynamicvram runnerProfile in renderProfileProvenance
      const invalidLtxApproved: CertificationProvenanceReport = {
        ...validLtxApproved,
        renderProfileProvenance: validLtxApproved.renderProfileProvenance
          ? {
              ...validLtxApproved.renderProfileProvenance,
              runnerProfile: "highvram-v1"
            }
          : null
      };
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: validFluxProfile, ltx: validLtxProfile },
          approved: { flux: validFluxApproved, ltx: invalidLtxApproved },
          live: { flux: validFluxLive, ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(/dynamicvram-offload-v1|runnerProfile/i);
      expect(sideEffect).not.toHaveBeenCalled();
    });
  });

  describe("profile-identity-rules", () => {
    it("accepts FLUX null render profile identity while requiring the LTX identity", () => {
      const sideEffect = vi.fn();
      const validFluxProfile = createValidFluxProfile();
      const validLtxProfile = createValidLtxProfile();
      const validFluxApproved = createValidFluxApprovedReport();
      const validLtxApproved = createValidLtxApprovedReport();
      const validFluxLive = createValidFluxLiveReport();
      const validLtxLive = createValidLtxLiveReport();

      // Invariant: FLUX retains null renderProfileIdentity and passes
      expect(validFluxProfile.renderProfileIdentity).toBeNull();
      expect(validFluxApproved.renderProfileProvenance).toBeNull();
      expect(validFluxLive.renderProfileProvenance).toBeNull();
      expect(() =>
        verifyTransitionGoldMasters({
          profiles: { flux: validFluxProfile, ltx: validLtxProfile },
          approved: { flux: validFluxApproved, ltx: validLtxApproved },
          live: { flux: validFluxLive, ltx: validLtxLive }
        })
      ).not.toThrow();

      // If FLUX has a non-null renderProfileIdentity -> reject
      const invalidFluxProfile: CertificationProfile = {
        ...validFluxProfile,
        renderProfileIdentity: {
          key: "LTX_25_720P_5S_V1",
          version: 1
        }
      };
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: invalidFluxProfile, ltx: validLtxProfile },
          approved: { flux: validFluxApproved, ltx: validLtxApproved },
          live: { flux: validFluxLive, ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(/renderProfileIdentity|null/i);
      expect(sideEffect).not.toHaveBeenCalled();

      // If LTX has null renderProfileIdentity -> reject
      const invalidLtxProfileNullIdentity: CertificationProfile = {
        ...validLtxProfile,
        renderProfileIdentity: null
      };
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: validFluxProfile, ltx: invalidLtxProfileNullIdentity },
          approved: { flux: validFluxApproved, ltx: validLtxApproved },
          live: { flux: validFluxLive, ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(/renderProfileIdentity|LTX_25_720P_5S_V1/i);
      expect(sideEffect).not.toHaveBeenCalled();

      // If LTX has wrong renderProfileIdentity version -> reject
      const invalidLtxProfileWrongVersion: CertificationProfile = {
        ...validLtxProfile,
        renderProfileIdentity: {
          key: "LTX_25_720P_5S_V1",
          version: 2 as unknown as 1
        }
      };
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: validFluxProfile, ltx: invalidLtxProfileWrongVersion },
          approved: { flux: validFluxApproved, ltx: validLtxApproved },
          live: { flux: validFluxLive, ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(/version/i);
      expect(sideEffect).not.toHaveBeenCalled();

      // If LTX approved report is missing renderProfileProvenance -> reject
      const invalidLtxApprovedMissingRpp: CertificationProvenanceReport = {
        ...validLtxApproved,
        renderProfileProvenance: null
      };
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: validFluxProfile, ltx: validLtxProfile },
          approved: { flux: validFluxApproved, ltx: invalidLtxApprovedMissingRpp },
          live: { flux: validFluxLive, ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(/renderProfileProvenance/i);
      expect(sideEffect).not.toHaveBeenCalled();
    });
  });

  describe("cross-family-host-consistency", () => {
    it("rejects when FLUX and LTX have divergent live ComfyUI commit revisions even if intra-family matches", () => {
      const sideEffect = vi.fn();
      const fluxProfile = createValidFluxProfile();
      const ltxProfile = createValidLtxProfile();

      const fluxCommit = "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc";
      const ltxCommit = "66c7b9b11dffecdd65a3ccd5eb6a1b3a178c96ef";

      const fluxApproved: CertificationProvenanceReport = {
        ...createValidFluxApprovedReport(),
        git: { comfyUiCommit: fluxCommit, customNodes: [] }
      };
      const fluxLive: CertificationProvenanceReport = {
        ...createValidFluxLiveReport(),
        git: { comfyUiCommit: fluxCommit, customNodes: [] }
      };

      const ltxApproved: CertificationProvenanceReport = {
        ...createValidLtxApprovedReport(),
        git: { comfyUiCommit: ltxCommit, customNodes: [] }
      };
      const ltxLive: CertificationProvenanceReport = {
        ...createValidLtxLiveReport(),
        git: { comfyUiCommit: ltxCommit, customNodes: [] }
      };

      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: fluxProfile, ltx: ltxProfile },
          approved: { flux: fluxApproved, ltx: ltxApproved },
          live: { flux: fluxLive, ltx: ltxLive }
        });
        sideEffect();
      }).toThrow(/Live ComfyUI commit mismatch across families/i);
      expect(sideEffect).not.toHaveBeenCalled();
    });
  });

  describe("profile-baseline-and-structural-validation", () => {
    it("rejects malformed or mismatched profile baseline attributes", () => {
      const sideEffect = vi.fn();
      const validFluxProfile = createValidFluxProfile();
      const validLtxProfile = createValidLtxProfile();
      const validFluxApproved = createValidFluxApprovedReport();
      const validLtxApproved = createValidLtxApprovedReport();
      const validFluxLive = createValidFluxLiveReport();
      const validLtxLive = createValidLtxLiveReport();

      // Case 1: FLUX profile baseline is not an object
      const invalidFluxBaselineObj: CertificationProfile = {
        ...validFluxProfile,
        baseline: null as unknown as { width: number; height: number; steps: number }
      };
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: invalidFluxBaselineObj, ltx: validLtxProfile },
          approved: { flux: validFluxApproved, ltx: validLtxApproved },
          live: { flux: validFluxLive, ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(/baseline must be a valid object/i);
      expect(sideEffect).not.toHaveBeenCalled();

      // Case 2: FLUX baseline width mismatch
      const invalidFluxWidth: CertificationProfile = {
        ...validFluxProfile,
        baseline: { ...validFluxProfile.baseline, width: 512 }
      };
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: invalidFluxWidth, ltx: validLtxProfile },
          approved: { flux: validFluxApproved, ltx: validLtxApproved },
          live: { flux: validFluxLive, ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(/baseline width/i);
      expect(sideEffect).not.toHaveBeenCalled();

      // Case 3: FLUX baseline height mismatch
      const invalidFluxHeight: CertificationProfile = {
        ...validFluxProfile,
        baseline: { ...validFluxProfile.baseline, height: 768 }
      };
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: invalidFluxHeight, ltx: validLtxProfile },
          approved: { flux: validFluxApproved, ltx: validLtxApproved },
          live: { flux: validFluxLive, ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(/baseline height/i);
      expect(sideEffect).not.toHaveBeenCalled();

      // Case 4: FLUX baseline steps mismatch
      const invalidFluxSteps: CertificationProfile = {
        ...validFluxProfile,
        baseline: { ...validFluxProfile.baseline, steps: 8 }
      };
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: invalidFluxSteps, ltx: validLtxProfile },
          approved: { flux: validFluxApproved, ltx: validLtxApproved },
          live: { flux: validFluxLive, ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(/baseline steps/i);
      expect(sideEffect).not.toHaveBeenCalled();

      // Case 5: LTX profile baseline is not an object
      const invalidLtxBaselineObj: CertificationProfile = {
        ...validLtxProfile,
        baseline: undefined as unknown as typeof validLtxProfile.baseline
      };
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: validFluxProfile, ltx: invalidLtxBaselineObj },
          approved: { flux: validFluxApproved, ltx: validLtxApproved },
          live: { flux: validFluxLive, ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(/baseline must be a valid object/i);
      expect(sideEffect).not.toHaveBeenCalled();

      // Case 6: LTX baseline width mismatch
      const invalidLtxWidth: CertificationProfile = {
        ...validLtxProfile,
        baseline: { ...validLtxProfile.baseline, width: 1920 }
      };
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: validFluxProfile, ltx: invalidLtxWidth },
          approved: { flux: validFluxApproved, ltx: validLtxApproved },
          live: { flux: validFluxLive, ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(/baseline width/i);
      expect(sideEffect).not.toHaveBeenCalled();

      // Case 7: LTX baseline height mismatch
      const invalidLtxHeight: CertificationProfile = {
        ...validLtxProfile,
        baseline: { ...validLtxProfile.baseline, height: 1080 }
      };
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: validFluxProfile, ltx: invalidLtxHeight },
          approved: { flux: validFluxApproved, ltx: validLtxApproved },
          live: { flux: validFluxLive, ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(/baseline height/i);
      expect(sideEffect).not.toHaveBeenCalled();

      // Case 8: LTX baseline frames mismatch
      const invalidLtxFrames: CertificationProfile = {
        ...validLtxProfile,
        baseline: { ...validLtxProfile.baseline, frames: 49 }
      };
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: validFluxProfile, ltx: invalidLtxFrames },
          approved: { flux: validFluxApproved, ltx: validLtxApproved },
          live: { flux: validFluxLive, ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(/baseline frames/i);
      expect(sideEffect).not.toHaveBeenCalled();

      // Case 9: LTX baseline steps mismatch
      const invalidLtxSteps: CertificationProfile = {
        ...validLtxProfile,
        baseline: { ...validLtxProfile.baseline, steps: 4 }
      };
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: validFluxProfile, ltx: invalidLtxSteps },
          approved: { flux: validFluxApproved, ltx: validLtxApproved },
          live: { flux: validFluxLive, ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(/baseline steps/i);
      expect(sideEffect).not.toHaveBeenCalled();
    });
  });

  describe("report-structural-validation", () => {
    it("rejects non-object or structurally invalid approved and live reports", () => {
      const sideEffect = vi.fn();
      const validFluxProfile = createValidFluxProfile();
      const validLtxProfile = createValidLtxProfile();
      const validFluxApproved = createValidFluxApprovedReport();
      const validLtxApproved = createValidLtxApprovedReport();
      const validFluxLive = createValidFluxLiveReport();
      const validLtxLive = createValidLtxLiveReport();

      // Case 1: Approved report is primitive/null
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: validFluxProfile, ltx: validLtxProfile },
          approved: { flux: null, ltx: validLtxApproved },
          live: { flux: validFluxLive, ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(/valid JSON object|valid object/i);
      expect(sideEffect).not.toHaveBeenCalled();

      // Case 2: Live report is primitive/string
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: validFluxProfile, ltx: validLtxProfile },
          approved: { flux: validFluxApproved, ltx: validLtxApproved },
          live: { flux: "invalid" as unknown as CertificationProvenanceReport, ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(/valid JSON object|valid object/i);
      expect(sideEffect).not.toHaveBeenCalled();

      // Case 3: Live report missing workflow object
      const invalidLiveWorkflow: CertificationProvenanceReport = {
        ...validFluxLive,
        workflow: null as unknown as typeof validFluxLive.workflow
      };
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: validFluxProfile, ltx: validLtxProfile },
          approved: { flux: validFluxApproved, ltx: validLtxApproved },
          live: { flux: invalidLiveWorkflow, ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(/missing workflow metadata/i);
      expect(sideEffect).not.toHaveBeenCalled();

      // Case 4: Approved report missing models array
      const invalidApprovedModels: CertificationProvenanceReport = {
        ...validFluxApproved,
        models: []
      };
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: validFluxProfile, ltx: validLtxProfile },
          approved: { flux: invalidApprovedModels, ltx: validLtxApproved },
          live: { flux: validFluxLive, ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(/non-empty models array/i);
      expect(sideEffect).not.toHaveBeenCalled();

      // Case 5: Live report with malformed model entry
      const invalidLiveModelEntry: CertificationProvenanceReport = {
        ...validFluxLive,
        models: [
          {
            category: "diffusion_models",
            relativePath: "model.safetensors",
            key: "",
            bytes: 100,
            sha256: "111"
          }
        ]
      };
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: validFluxProfile, ltx: validLtxProfile },
          approved: { flux: validFluxApproved, ltx: validLtxApproved },
          live: { flux: invalidLiveModelEntry, ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(/invalid model entry/i);
      expect(sideEffect).not.toHaveBeenCalled();

      // Case 6: Approved report missing git metadata
      const invalidApprovedGit: CertificationProvenanceReport = {
        ...validFluxApproved,
        git: null as unknown as typeof validFluxApproved.git
      };
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: validFluxProfile, ltx: validLtxProfile },
          approved: { flux: invalidApprovedGit, ltx: validLtxApproved },
          live: { flux: validFluxLive, ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(/missing git provenance/i);
      expect(sideEffect).not.toHaveBeenCalled();

      // Case 7: Live report with non-array customNodes
      const invalidLiveCustomNodes: CertificationProvenanceReport = {
        ...validFluxLive,
        git: {
          ...validFluxLive.git,
          customNodes: null as unknown as []
        }
      };
      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: validFluxProfile, ltx: validLtxProfile },
          approved: { flux: validFluxApproved, ltx: validLtxApproved },
          live: { flux: invalidLiveCustomNodes, ltx: validLtxLive }
        });
        sideEffect();
      }).toThrow(/customNodes must be an array/i);
      expect(sideEffect).not.toHaveBeenCalled();
    });
  });

  describe("ltx-render-profile-model-hash-set-equality", () => {
    it("rejects when LTX live renderProfileProvenance.modelHashes has extra or missing keys", () => {
      const sideEffect = vi.fn();
      const validFluxProfile = createValidFluxProfile();
      const validLtxProfile = createValidLtxProfile();
      const validFluxApproved = createValidFluxApprovedReport();
      const validLtxApproved = createValidLtxApprovedReport();
      const validFluxLive = createValidFluxLiveReport();

      // Case 1: LTX live renderProfileProvenance.modelHashes has an extra key
      const extraKeyLtxLive: CertificationProvenanceReport = {
        ...createValidLtxLiveReport(),
        renderProfileProvenance: {
          ...createValidLtxLiveReport().renderProfileProvenance!,
          modelHashes: {
            ...createValidLtxLiveReport().renderProfileProvenance!.modelHashes,
            "diffusion_models/unapproved-extra.safetensors":
              "8888888888888888888888888888888888888888888888888888888888888888"
          }
        }
      };

      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: validFluxProfile, ltx: validLtxProfile },
          approved: { flux: validFluxApproved, ltx: validLtxApproved },
          live: { flux: validFluxLive, ltx: extraKeyLtxLive }
        });
        sideEffect();
      }).toThrow(/Render profile model hash count mismatch|unexpected extra model hash/i);
      expect(sideEffect).not.toHaveBeenCalled();

      // Case 2: LTX live renderProfileProvenance.modelHashes is missing a key
      const missingKeyModelHashes = {
        ...createValidLtxLiveReport().renderProfileProvenance!.modelHashes
      };
      delete (missingKeyModelHashes as Record<string, string>)[
        "vae/ltx-2.5-video-vae-conv-bf16.safetensors"
      ];

      const missingKeyLtxLive: CertificationProvenanceReport = {
        ...createValidLtxLiveReport(),
        renderProfileProvenance: {
          ...createValidLtxLiveReport().renderProfileProvenance!,
          modelHashes: missingKeyModelHashes
        }
      };

      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: validFluxProfile, ltx: validLtxProfile },
          approved: { flux: validFluxApproved, ltx: validLtxApproved },
          live: { flux: validFluxLive, ltx: missingKeyLtxLive }
        });
        sideEffect();
      }).toThrow(/Render profile model hash count mismatch|missing model hash/i);
      expect(sideEffect).not.toHaveBeenCalled();

      // Case 3: LTX live renderProfileProvenance.modelHashes has a hash mismatch
      const mismatchedHashLtxLive: CertificationProvenanceReport = {
        ...createValidLtxLiveReport(),
        renderProfileProvenance: {
          ...createValidLtxLiveReport().renderProfileProvenance!,
          modelHashes: {
            ...createValidLtxLiveReport().renderProfileProvenance!.modelHashes,
            "vae/ltx-2.5-video-vae-conv-bf16.safetensors":
              "9999999999999999999999999999999999999999999999999999999999999999"
          }
        }
      };

      expect(() => {
        verifyTransitionGoldMasters({
          profiles: { flux: validFluxProfile, ltx: validLtxProfile },
          approved: { flux: validFluxApproved, ltx: validLtxApproved },
          live: { flux: validFluxLive, ltx: mismatchedHashLtxLive }
        });
        sideEffect();
      }).toThrow(/Render profile model hash mismatch/i);
      expect(sideEffect).not.toHaveBeenCalled();
    });
  });
});
