import { describe, expect, it, vi } from "vitest";
import {
  computeH3CandidateKey,
  computeH3CandidateSpecificationDigest,
  computeModelHashesDigest,
  type H3CandidateProfile,
  type H3CandidateExecutionSpecification,
  type H3CandidateAuthorizationGrant
} from "@cco/contracts";
import {
  H3CandidateEligibilityService,
  createProductionH3CandidateEligibilityService
} from "./evaluate-h3-candidate-eligibility.js";
import type {
  H3CandidateAuthorizationPort,
  H3RuntimeObservationPort,
  H3ObservedRuntimeIdentity
} from "../ports/h3-candidate-ports.js";

function createValidSpec(
  overrides: Partial<H3CandidateExecutionSpecification> = {}
): H3CandidateExecutionSpecification {
  return {
    version: 1,
    route: "i2v",
    routingMode: "frame_anchored",
    width: 1344,
    height: 768,
    fps: 24,
    frames: 192, // (192 - 5) % 17 === 0
    workflowHash: "4d1aafd575ceecb6146b1b96d5c5b13f759fea5eb47f28aabfd92965765c142e",
    modelHashes: {
      checkpoint: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
      clip: "35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6",
      audioVae: "8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48",
      videoVae: "52a2c8c73583c86e4f41cdcce3a6ad0ea562987bc0bf3d60a0cef5f5c8e60c0e",
      turboLora: "none",
      additionalModels: {}
    },
    sampler: "euler",
    scheduler: "simple",
    steps: 20,
    cfg: 1.0,
    denoise: 1.0,
    attention: {
      backend: "sage_attn",
      customNodeRevision: "rev-1",
      customNodeSourceHash: "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      packageVersion: "0.2.1",
      sparsitySettings: {
        enabled: false,
        method: "none",
        threshold: 0
      }
    },
    runnerSettings: {
      runnerProfile: "dynamicvram-offload-v1",
      offloadPolicy: "dynamicvram",
      requiresModelOffloading: true,
      maxConcurrentGpuJobs: 1,
      minFreeDiskGb: 50
    },
    customNodes: [
      {
        name: "comfyui-sageattention",
        revision: "rev-1",
        sourceHash: "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd"
      }
    ],
    packageVersions: {
      torch: "2.5.1+cu124",
      sageattention: "0.2.1"
    },
    ...overrides
  };
}

function createSyntheticCandidate(
  specOverrides: Partial<H3CandidateExecutionSpecification> = {}
): H3CandidateProfile {
  const spec = createValidSpec(specOverrides);
  const digest = computeH3CandidateSpecificationDigest(spec);
  const key = computeH3CandidateKey(digest, 1);

  return {
    key,
    version: 1,
    specificationDigest: digest,
    specification: spec,
    topology: {
      prompt: { nodeId: "104", classType: "MiniMaxH3ImageToVideo", inputField: "prompt" },
      seed: { nodeId: "15", classType: "RandomNoise", inputField: "noise_seed" },
      frameCount: { nodeId: "104", classType: "MiniMaxH3ImageToVideo", inputField: "length" },
      referenceImage: { nodeId: "20", classType: "LoadImage", inputField: "image" },
      firstFrame: { nodeId: "20", classType: "LoadImage", inputField: "image" },
      width: { nodeId: "104", classType: "MiniMaxH3ImageToVideo", inputField: "width" },
      height: { nodeId: "104", classType: "MiniMaxH3ImageToVideo", inputField: "height" }
    },
    measurements: null,
    status: "candidate"
  };
}

function createValidObservedRuntime(
  target: { hostname: string; gpuUuid: string },
  spec: H3CandidateExecutionSpecification
): H3ObservedRuntimeIdentity {
  const customNodesRecord: Record<string, { revision: string; sourceHash: string }> = {};
  for (const n of spec.customNodes) {
    customNodesRecord[n.name] = { revision: n.revision, sourceHash: n.sourceHash };
  }

  return {
    hostname: target.hostname,
    gpuUuid: target.gpuUuid,
    pid: 12345,
    processStartTimeTicks: 987654321,
    pythonExecutable: "/opt/venv/bin/python3",
    comfyUiCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
    commandLineArgs: ["python3", "main.py", "--dynamicvram"],
    customNodes: customNodesRecord,
    packageVersions: { ...spec.packageVersions },
    observedAt: "2026-10-18T12:00:00.000Z"
  };
}

function createMockRuntimePort(
  overrides: Partial<H3RuntimeObservationPort> = {}
): H3RuntimeObservationPort {
  return {
    observeCurrentRuntime: vi.fn(),
    verifyProcessContinuity: vi.fn().mockResolvedValue({ continuous: true }),
    ...overrides
  };
}

describe("H3CandidateEligibilityService", () => {
  it("fails closed with candidate_unrecognized when candidate is not in accepted registry", async () => {
    const authPort: H3CandidateAuthorizationPort = {
      verifyCandidateAuthorization: vi.fn()
    };
    const runtimePort = createMockRuntimePort();

    const service = new H3CandidateEligibilityService({
      authorizationPort: authPort,
      runtimeObservationPort: runtimePort
      // Uses default shared empty registry
    });

    const decision = await service.evaluateEligibility({
      candidateKey: "H3_CANDIDATE_unregistered_key_V1",
      target: { hostname: "render-01", gpuUuid: "GPU-1234" },
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: "4d1aafd575ceecb6146b1b96d5c5b13f759fea5eb47f28aabfd92965765c142e",
        modelHashes: {}
      },
      goldMasterProvenance: {
        workflowHash: "4d1aafd575ceecb6146b1b96d5c5b13f759fea5eb47f28aabfd92965765c142e",
        modelHashes: {}
      },
      purpose: "staging"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("candidate_unrecognized");
    }
    expect(authPort.verifyCandidateAuthorization).not.toHaveBeenCalled();
    expect(runtimePort.observeCurrentRuntime).not.toHaveBeenCalled();
  });

  it("fails closed on route or geometry mismatch", async () => {
    const candidate = createSyntheticCandidate();
    const candidateMap = new Map([[candidate.key, candidate]]);
    const authPort: H3CandidateAuthorizationPort = { verifyCandidateAuthorization: vi.fn() };
    const runtimePort = createMockRuntimePort();

    const service = new H3CandidateEligibilityService({
      authorizationPort: authPort,
      runtimeObservationPort: runtimePort,
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target: { hostname: "render-01", gpuUuid: "GPU-1234" },
      executionContext: {
        route: "ref2v", // Mismatch! Spec is i2v
        routingMode: "reference_directed",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {}
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {}
      },
      purpose: "staging"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("route_or_geometry_mismatch");
    }
  });

  it("fails closed on off-grid frames", async () => {
    const candidate = createSyntheticCandidate();
    const candidateMap = new Map([[candidate.key, candidate]]);
    const service = new H3CandidateEligibilityService({
      authorizationPort: { verifyCandidateAuthorization: vi.fn() },
      runtimeObservationPort: createMockRuntimePort(),
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target: { hostname: "render-01", gpuUuid: "GPU-1234" },
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 190, // (190 - 5) % 17 !== 0
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {}
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {}
      },
      purpose: "staging"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("off_grid_frames");
    }
  });

  it("fails closed when model hash is empty string", async () => {
    const candidate = createSyntheticCandidate();
    const candidateMap = new Map([[candidate.key, candidate]]);
    const service = new H3CandidateEligibilityService({
      authorizationPort: { verifyCandidateAuthorization: vi.fn() },
      runtimeObservationPort: createMockRuntimePort(),
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target: { hostname: "render-01", gpuUuid: "GPU-1234" },
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: "", // Empty string model hash!
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      purpose: "staging"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("model_hash_invalid");
    }
  });

  it("fails closed when observed host identity does not match target", async () => {
    const candidate = createSyntheticCandidate();
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    const runtimePort = createMockRuntimePort({
      observeCurrentRuntime: vi.fn().mockResolvedValue({
        ok: true,
        observation: {
          ...createValidObservedRuntime(target, candidate.specification),
          hostname: "rogue-host" // Observed hostname differs!
        }
      })
    });

    const service = new H3CandidateEligibilityService({
      authorizationPort: { verifyCandidateAuthorization: vi.fn() },
      runtimeObservationPort: runtimePort,
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      purpose: "staging"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("host_identity_mismatch");
    }
  });

  it("does not accept caller-supplied authorization as substitute for authorization port", async () => {
    const candidate = createSyntheticCandidate();
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    // Authorization port DENIES
    const authPort: H3CandidateAuthorizationPort = {
      verifyCandidateAuthorization: vi.fn().mockResolvedValue({
        authorized: false,
        blocker: "Signer key revoked"
      })
    };

    const runtimePort = createMockRuntimePort({
      observeCurrentRuntime: vi.fn().mockResolvedValue({
        ok: true,
        observation: createValidObservedRuntime(target, candidate.specification)
      })
    });

    const service = new H3CandidateEligibilityService({
      authorizationPort: authPort,
      runtimeObservationPort: runtimePort,
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const gmModelHashes = {
      checkpoint: candidate.specification.modelHashes.checkpoint,
      clip: candidate.specification.modelHashes.clip,
      audioVae: candidate.specification.modelHashes.audioVae,
      videoVae: candidate.specification.modelHashes.videoVae
    };

    const grant: H3CandidateAuthorizationGrant = {
      payload: {
        version: 1,
        candidateKey: candidate.key,
        specificationDigest: candidate.specificationDigest,
        goldMasterWorkflowHash: candidate.specification.workflowHash,
        goldMasterModelHashesDigest: computeModelHashesDigest(gmModelHashes),
        targetHostname: target.hostname,
        targetGpuUuid: target.gpuUuid,
        purpose: "staging",
        scope: "staging",
        issuedAt: "2026-10-18T10:00:00.000Z",
        expiresAt: "2026-10-18T20:00:00.000Z",
        operatorId: "operator-428"
      },
      signature: "0123456789abcdef",
      signerKeyId: "key-1"
    };

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: gmModelHashes
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: gmModelHashes
      },
      authorizationGrant: grant,
      purpose: "staging",
      // Caller attempts to supply pre-approved authorization claim
      callerSuppliedAuthorization: {
        authorized: true,
        scope: "production",
        signedBy: "admin"
      }
    });

    // CRITICAL: The policy must deny despite callerSuppliedAuthorization
    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("authorization_denied");
      expect(decision.message).toContain("Signer key revoked");
    }
    // Port was actually consulted
    expect(authPort.verifyCandidateAuthorization).toHaveBeenCalledTimes(1);
  });

  it("fails closed when staging grant is used for production purpose", async () => {
    const candidate = createSyntheticCandidate();
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    const authPort: H3CandidateAuthorizationPort = {
      verifyCandidateAuthorization: vi.fn().mockResolvedValue({
        authorized: true,
        scope: "staging" // Only staging scope!
      })
    };

    const runtimePort = createMockRuntimePort({
      observeCurrentRuntime: vi.fn().mockResolvedValue({
        ok: true,
        observation: createValidObservedRuntime(target, candidate.specification)
      })
    });

    const service = new H3CandidateEligibilityService({
      authorizationPort: authPort,
      runtimeObservationPort: runtimePort,
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const grant: H3CandidateAuthorizationGrant = {
      payload: {
        version: 1,
        candidateKey: candidate.key,
        specificationDigest: candidate.specificationDigest,
        goldMasterWorkflowHash: candidate.specification.workflowHash,
        goldMasterModelHashesDigest: computeModelHashesDigest(candidate.specification.modelHashes),
        targetHostname: target.hostname,
        targetGpuUuid: target.gpuUuid,
        purpose: "staging",
        scope: "staging",
        issuedAt: "2026-10-18T10:00:00.000Z",
        expiresAt: "2026-10-18T20:00:00.000Z",
        operatorId: "operator-428"
      },
      signature: "0123456789abcdef",
      signerKeyId: "key-1"
    };

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      authorizationGrant: grant,
      purpose: "production" // Requesting production!
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("scope_insufficient_for_purpose");
    }
  });

  it("approves fully compliant synthetic candidate with authorized staging grant", async () => {
    const candidate = createSyntheticCandidate();
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    const authPort: H3CandidateAuthorizationPort = {
      verifyCandidateAuthorization: vi.fn().mockResolvedValue({
        authorized: true,
        scope: "staging"
      })
    };

    const runtimePort: H3RuntimeObservationPort = {
      observeCurrentRuntime: vi.fn().mockResolvedValue({
        ok: true,
        observation: createValidObservedRuntime(target, candidate.specification)
      }),
      verifyProcessContinuity: vi.fn().mockResolvedValue({ continuous: true })
    };

    const service = new H3CandidateEligibilityService({
      authorizationPort: authPort,
      runtimeObservationPort: runtimePort,
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const gmModelHashes = {
      checkpoint: candidate.specification.modelHashes.checkpoint,
      clip: candidate.specification.modelHashes.clip,
      audioVae: candidate.specification.modelHashes.audioVae,
      videoVae: candidate.specification.modelHashes.videoVae
    };

    const grant: H3CandidateAuthorizationGrant = {
      payload: {
        version: 1,
        candidateKey: candidate.key,
        specificationDigest: candidate.specificationDigest,
        goldMasterWorkflowHash: candidate.specification.workflowHash,
        goldMasterModelHashesDigest: computeModelHashesDigest(gmModelHashes),
        targetHostname: target.hostname,
        targetGpuUuid: target.gpuUuid,
        purpose: "staging",
        scope: "staging",
        issuedAt: "2026-10-18T10:00:00.000Z",
        expiresAt: "2026-10-18T20:00:00.000Z",
        operatorId: "operator-428"
      },
      signature: "0123456789abcdef",
      signerKeyId: "key-1"
    };

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: gmModelHashes
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: gmModelHashes
      },
      authorizationGrant: grant,
      purpose: "staging"
    });

    expect(decision.eligible).toBe(true);
    if (decision.eligible) {
      expect(decision.candidateKey).toBe(candidate.key);
      expect(decision.scope).toBe("staging");
      expect(decision.specificationDigest).toBe(candidate.specificationDigest);
    }
  });

  it("production factory closes over immutable empty catalog", async () => {
    const prodService = createProductionH3CandidateEligibilityService({
      authorizationPort: { verifyCandidateAuthorization: vi.fn() },
      runtimeObservationPort: createMockRuntimePort()
    });

    const decision = await prodService.evaluateEligibility({
      candidateKey: "H3_CANDIDATE_any_key_V1",
      target: { hostname: "node", gpuUuid: "GPU-1" },
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 124,
        workflowHash: "4d1aafd575ceecb6146b1b96d5c5b13f759fea5eb47f28aabfd92965765c142e",
        modelHashes: {}
      },
      goldMasterProvenance: {
        workflowHash: "4d1aafd575ceecb6146b1b96d5c5b13f759fea5eb47f28aabfd92965765c142e",
        modelHashes: {}
      },
      purpose: "staging"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("candidate_unrecognized");
    }
  });

  it("fails closed when executionContext contains unexpected extra model keys", async () => {
    const candidate = createSyntheticCandidate();
    const candidateMap = new Map([[candidate.key, candidate]]);
    const service = new H3CandidateEligibilityService({
      authorizationPort: { verifyCandidateAuthorization: vi.fn() },
      runtimeObservationPort: createMockRuntimePort(),
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target: { hostname: "render-01", gpuUuid: "GPU-1234" },
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae,
          maliciousExtraModel: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        }
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      purpose: "staging"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("model_hash_invalid");
      expect(decision.message).toMatch(/Unexpected model hash key "maliciousExtraModel"/i);
    }
  });

  it("fails closed when goldMasterProvenance contains unexpected extra model keys", async () => {
    const candidate = createSyntheticCandidate();
    const candidateMap = new Map([[candidate.key, candidate]]);
    const service = new H3CandidateEligibilityService({
      authorizationPort: { verifyCandidateAuthorization: vi.fn() },
      runtimeObservationPort: createMockRuntimePort(),
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target: { hostname: "render-01", gpuUuid: "GPU-1234" },
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae,
          unexpectedBackdoor: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        }
      },
      purpose: "staging"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("gold_master_mismatch");
      expect(decision.message).toMatch(/Unexpected model hash key "unexpectedBackdoor"/i);
    }
  });

  it("fails closed when observed ComfyUI core revision does not match pinned revision", async () => {
    const candidate = createSyntheticCandidate();
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    const runtimePort = createMockRuntimePort({
      observeCurrentRuntime: vi.fn().mockResolvedValue({
        ok: true,
        observation: {
          ...createValidObservedRuntime(target, candidate.specification),
          comfyUiCoreRevision: "unpinned_unauthorized_revision_hash"
        }
      })
    });

    const service = new H3CandidateEligibilityService({
      authorizationPort: { verifyCandidateAuthorization: vi.fn() },
      runtimeObservationPort: runtimePort,
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      purpose: "staging"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("runtime_optimizer_mismatch");
      expect(decision.message).toMatch(/does not match pinned core revision/i);
    }
  });

  it("fails closed when candidate requires model offloading but commandLineArgs specifies highvram", async () => {
    const candidate = createSyntheticCandidate();
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    const runtimePort = createMockRuntimePort({
      observeCurrentRuntime: vi.fn().mockResolvedValue({
        ok: true,
        observation: {
          ...createValidObservedRuntime(target, candidate.specification),
          commandLineArgs: ["python3", "main.py", "--highvram"]
        }
      })
    });

    const service = new H3CandidateEligibilityService({
      authorizationPort: { verifyCandidateAuthorization: vi.fn() },
      runtimeObservationPort: runtimePort,
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      purpose: "staging"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("runtime_optimizer_mismatch");
      expect(decision.message).toMatch(
        /Candidate requires model offloading, but commandLineArgs specifies "--highvram"/i
      );
    }
  });

  it("fails closed when post-authorization process continuity is lost (process drift/restart)", async () => {
    const candidate = createSyntheticCandidate();
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    const authPort: H3CandidateAuthorizationPort = {
      verifyCandidateAuthorization: vi.fn().mockResolvedValue({
        authorized: true,
        scope: "staging"
      })
    };

    const runtimePort = createMockRuntimePort({
      observeCurrentRuntime: vi.fn().mockResolvedValue({
        ok: true,
        observation: createValidObservedRuntime(target, candidate.specification)
      }),
      // Continuity fails after authorization
      verifyProcessContinuity: vi.fn().mockResolvedValue({
        continuous: false,
        blocker: "Process 12345 terminated or restarted during evaluation"
      })
    });

    const service = new H3CandidateEligibilityService({
      authorizationPort: authPort,
      runtimeObservationPort: runtimePort,
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const gmModelHashes = {
      checkpoint: candidate.specification.modelHashes.checkpoint,
      clip: candidate.specification.modelHashes.clip,
      audioVae: candidate.specification.modelHashes.audioVae,
      videoVae: candidate.specification.modelHashes.videoVae
    };

    const grant: H3CandidateAuthorizationGrant = {
      payload: {
        version: 1,
        candidateKey: candidate.key,
        specificationDigest: candidate.specificationDigest,
        goldMasterWorkflowHash: candidate.specification.workflowHash,
        goldMasterModelHashesDigest: computeModelHashesDigest(gmModelHashes),
        targetHostname: target.hostname,
        targetGpuUuid: target.gpuUuid,
        purpose: "staging",
        scope: "staging",
        issuedAt: "2026-10-18T10:00:00.000Z",
        expiresAt: "2026-10-18T20:00:00.000Z",
        operatorId: "operator-428"
      },
      signature: "0123456789abcdef",
      signerKeyId: "key-1"
    };

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: gmModelHashes
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: gmModelHashes
      },
      authorizationGrant: grant,
      purpose: "staging"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("process_continuity_lost");
    }
    // Authorization was verified before continuity check
    expect(authPort.verifyCandidateAuthorization).toHaveBeenCalledTimes(1);
    expect(runtimePort.verifyProcessContinuity).toHaveBeenCalledTimes(1);
  });

  it("fails closed when requesting production purpose for candidate with null measurements", async () => {
    const candidate = createSyntheticCandidate(); // candidate.measurements is null
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    const service = new H3CandidateEligibilityService({
      authorizationPort: { verifyCandidateAuthorization: vi.fn() },
      runtimeObservationPort: createMockRuntimePort(),
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      purpose: "production"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("scope_insufficient_for_purpose");
      expect(decision.message).toMatch(
        /lacks operator measurements required for production purpose/i
      );
    }
  });

  it("fails closed when observed pythonExecutable is not a valid Python interpreter", async () => {
    const candidate = createSyntheticCandidate();
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    const runtimePort = createMockRuntimePort({
      observeCurrentRuntime: vi.fn().mockResolvedValue({
        ok: true,
        observation: {
          ...createValidObservedRuntime(target, candidate.specification),
          pythonExecutable: "/bin/bash"
        }
      })
    });

    const service = new H3CandidateEligibilityService({
      authorizationPort: { verifyCandidateAuthorization: vi.fn() },
      runtimeObservationPort: runtimePort,
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      purpose: "staging"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("runtime_optimizer_mismatch");
      expect(decision.message).toMatch(/not a valid Python interpreter/i);
    }
  });

  it("fails closed on offload policy drift: highvram spec with dynamicvram commandLineArgs", async () => {
    const candidate = createSyntheticCandidate({
      runnerSettings: {
        runnerProfile: "highvram-v1",
        offloadPolicy: "highvram",
        requiresModelOffloading: false,
        maxConcurrentGpuJobs: 1,
        minFreeDiskGb: 50
      }
    });
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    const runtimePort = createMockRuntimePort({
      observeCurrentRuntime: vi.fn().mockResolvedValue({
        ok: true,
        observation: {
          ...createValidObservedRuntime(target, candidate.specification),
          commandLineArgs: ["python3", "main.py", "--dynamicvram"]
        }
      })
    });

    const service = new H3CandidateEligibilityService({
      authorizationPort: { verifyCandidateAuthorization: vi.fn() },
      runtimeObservationPort: runtimePort,
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      purpose: "staging"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("runtime_optimizer_mismatch");
      expect(decision.message).toMatch(
        /Candidate specifies "highvram" offload policy, but commandLineArgs specifies dynamic\/low VRAM mode/i
      );
    }
  });

  it("fails closed on offload policy drift: cpu_offload spec with highvram commandLineArgs", async () => {
    const candidate = createSyntheticCandidate({
      runnerSettings: {
        runnerProfile: "cpu-offload-v1",
        offloadPolicy: "cpu_offload",
        requiresModelOffloading: true,
        maxConcurrentGpuJobs: 1,
        minFreeDiskGb: 50
      }
    });
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    const runtimePort = createMockRuntimePort({
      observeCurrentRuntime: vi.fn().mockResolvedValue({
        ok: true,
        observation: {
          ...createValidObservedRuntime(target, candidate.specification),
          commandLineArgs: ["python3", "main.py", "--highvram"]
        }
      })
    });

    const service = new H3CandidateEligibilityService({
      authorizationPort: { verifyCandidateAuthorization: vi.fn() },
      runtimeObservationPort: runtimePort,
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      purpose: "staging"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("runtime_optimizer_mismatch");
      expect(decision.message).toMatch(
        /Candidate requires model offloading, but commandLineArgs specifies "--highvram"/i
      );
    }
  });

  it("fails closed when attention package version in observed runtime does not match spec", async () => {
    const candidate = createSyntheticCandidate();
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    const runtimePort = createMockRuntimePort({
      observeCurrentRuntime: vi.fn().mockResolvedValue({
        ok: true,
        observation: {
          ...createValidObservedRuntime(target, candidate.specification),
          packageVersions: {
            torch: "2.5.1+cu124",
            sageattention: "0.1.9"
          }
        }
      })
    });

    const service = new H3CandidateEligibilityService({
      authorizationPort: { verifyCandidateAuthorization: vi.fn() },
      runtimeObservationPort: runtimePort,
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      purpose: "staging"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("runtime_optimizer_mismatch");
      expect(decision.message).toMatch(
        /Attention package "sageattention" version mismatch: expected "0.2.1", observed "0.1.9"/i
      );
    }
  });

  it("fails closed when attention custom node revision does not match spec", async () => {
    const candidate = createSyntheticCandidate();
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    const validObs = createValidObservedRuntime(target, candidate.specification);
    const runtimePort = createMockRuntimePort({
      observeCurrentRuntime: vi.fn().mockResolvedValue({
        ok: true,
        observation: {
          ...validObs,
          customNodes: {
            "comfyui-sageattention": {
              revision: "rev-2",
              sourceHash: candidate.specification.customNodes[0]!.sourceHash
            }
          }
        }
      })
    });

    const service = new H3CandidateEligibilityService({
      authorizationPort: { verifyCandidateAuthorization: vi.fn() },
      runtimeObservationPort: runtimePort,
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      purpose: "staging"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("runtime_optimizer_mismatch");
      expect(decision.message).toMatch(
        /Attention custom node with revision "rev-1" not found in observed runtime custom nodes/i
      );
    }
  });

  it("fails closed when attention custom node sourceHash does not match spec", async () => {
    const candidate = createSyntheticCandidate();
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    const validObs = createValidObservedRuntime(target, candidate.specification);
    const runtimePort = createMockRuntimePort({
      observeCurrentRuntime: vi.fn().mockResolvedValue({
        ok: true,
        observation: {
          ...validObs,
          customNodes: {
            "comfyui-sageattention": {
              revision: "rev-1",
              sourceHash: "0000000000000000000000000000000000000000000000000000000000000000"
            }
          }
        }
      })
    });

    const service = new H3CandidateEligibilityService({
      authorizationPort: { verifyCandidateAuthorization: vi.fn() },
      runtimeObservationPort: runtimePort,
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      purpose: "staging"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("runtime_optimizer_mismatch");
      expect(decision.message).toMatch(/Attention custom node sourceHash mismatch/i);
    }
  });

  it("fails closed when attention sparsity is enabled in spec but not observed in runtime", async () => {
    const candidate = createSyntheticCandidate({
      attention: {
        backend: "sage_attn",
        customNodeRevision: "rev-1",
        customNodeSourceHash: "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        packageVersion: "0.2.1",
        sparsitySettings: {
          enabled: true,
          method: "sparse_sample",
          threshold: 0.1
        }
      }
    });
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    const runtimePort = createMockRuntimePort({
      observeCurrentRuntime: vi.fn().mockResolvedValue({
        ok: true,
        observation: createValidObservedRuntime(target, candidate.specification)
      })
    });

    const service = new H3CandidateEligibilityService({
      authorizationPort: { verifyCandidateAuthorization: vi.fn() },
      runtimeObservationPort: runtimePort,
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      purpose: "staging"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("runtime_optimizer_mismatch");
      expect(decision.message).toMatch(
        /Required attention sparsity method "sparse_sample" is not reflected in observed runtime/i
      );
    }
  });

  it("fails closed when attention sparsity is disabled in spec but commandLineArgs contains sparsity flags", async () => {
    const candidate = createSyntheticCandidate();
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    const runtimePort = createMockRuntimePort({
      observeCurrentRuntime: vi.fn().mockResolvedValue({
        ok: true,
        observation: {
          ...createValidObservedRuntime(target, candidate.specification),
          commandLineArgs: ["python3", "main.py", "--dynamicvram", "--sparse"]
        }
      })
    });

    const service = new H3CandidateEligibilityService({
      authorizationPort: { verifyCandidateAuthorization: vi.fn() },
      runtimeObservationPort: runtimePort,
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      purpose: "staging"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("runtime_optimizer_mismatch");
      expect(decision.message).toMatch(
        /Candidate specifies sparsity disabled, but observed commandLineArgs contains sparsity flags/i
      );
    }
  });

  it("fails closed on sampling drift: steps, sampler, or scheduler mismatch in execution context", async () => {
    const candidate = createSyntheticCandidate();
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    const service = new H3CandidateEligibilityService({
      authorizationPort: { verifyCandidateAuthorization: vi.fn() },
      runtimeObservationPort: createMockRuntimePort({
        observeCurrentRuntime: vi.fn().mockResolvedValue({
          ok: true,
          observation: createValidObservedRuntime(target, candidate.specification)
        })
      }),
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const baseCtx = {
      route: "i2v" as const,
      routingMode: "frame_anchored" as const,
      width: 1344,
      height: 768,
      frames: 192,
      workflowHash: candidate.specification.workflowHash,
      modelHashes: {
        checkpoint: candidate.specification.modelHashes.checkpoint,
        clip: candidate.specification.modelHashes.clip,
        audioVae: candidate.specification.modelHashes.audioVae,
        videoVae: candidate.specification.modelHashes.videoVae
      }
    };
    const gmProvenance = {
      workflowHash: candidate.specification.workflowHash,
      modelHashes: baseCtx.modelHashes
    };

    // Steps mismatch
    const stepsDecision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: { ...baseCtx, steps: 30 },
      goldMasterProvenance: gmProvenance,
      purpose: "staging"
    });
    expect(stepsDecision.eligible).toBe(false);
    if (!stepsDecision.eligible) {
      expect(stepsDecision.blockerCode).toBe("runtime_optimizer_mismatch");
      expect(stepsDecision.message).toMatch(/Sampling steps mismatch: expected 20, got 30/i);
    }

    // Sampler mismatch
    const samplerDecision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: { ...baseCtx, sampler: "dpmpp_2m" },
      goldMasterProvenance: gmProvenance,
      purpose: "staging"
    });
    expect(samplerDecision.eligible).toBe(false);
    if (!samplerDecision.eligible) {
      expect(samplerDecision.blockerCode).toBe("runtime_optimizer_mismatch");
      expect(samplerDecision.message).toMatch(
        /Sampler mismatch: expected "euler", got "dpmpp_2m"/i
      );
    }

    // Scheduler mismatch
    const schedulerDecision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: { ...baseCtx, scheduler: "karras" },
      goldMasterProvenance: gmProvenance,
      purpose: "staging"
    });
    expect(schedulerDecision.eligible).toBe(false);
    if (!schedulerDecision.eligible) {
      expect(schedulerDecision.blockerCode).toBe("runtime_optimizer_mismatch");
      expect(schedulerDecision.message).toMatch(
        /Scheduler mismatch: expected "simple", got "karras"/i
      );
    }
  });

  it("fails closed when spec additionalModels attempts to overwrite reserved model key", async () => {
    const candidate = createSyntheticCandidate({
      modelHashes: {
        checkpoint: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
        clip: "35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6",
        audioVae: "8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48",
        videoVae: "52a2c8c73583c86e4f41cdcce3a6ad0ea562987bc0bf3d60a0cef5f5c8e60c0e",
        turboLora: "none",
        additionalModels: {
          checkpoint: "1111111111111111111111111111111111111111111111111111111111111111"
        }
      }
    });
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    const service = new H3CandidateEligibilityService({
      authorizationPort: { verifyCandidateAuthorization: vi.fn() },
      runtimeObservationPort: createMockRuntimePort(),
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: {
          checkpoint: candidate.specification.modelHashes.checkpoint,
          clip: candidate.specification.modelHashes.clip,
          audioVae: candidate.specification.modelHashes.audioVae,
          videoVae: candidate.specification.modelHashes.videoVae
        }
      },
      purpose: "staging"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("model_hash_invalid");
      expect(decision.message).toMatch(
        /additionalModels cannot overwrite required model key "checkpoint"/i
      );
    }
  });

  it("fails closed on grant payload drift: purpose, workflowHash, or modelHashesDigest mismatch", async () => {
    const candidate = createSyntheticCandidate();
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    const authPort: H3CandidateAuthorizationPort = {
      verifyCandidateAuthorization: vi.fn().mockResolvedValue({
        authorized: true,
        scope: "staging"
      })
    };
    const runtimePort = createMockRuntimePort({
      observeCurrentRuntime: vi.fn().mockResolvedValue({
        ok: true,
        observation: createValidObservedRuntime(target, candidate.specification)
      })
    });

    const service = new H3CandidateEligibilityService({
      authorizationPort: authPort,
      runtimeObservationPort: runtimePort,
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const gmModelHashes = {
      checkpoint: candidate.specification.modelHashes.checkpoint,
      clip: candidate.specification.modelHashes.clip,
      audioVae: candidate.specification.modelHashes.audioVae,
      videoVae: candidate.specification.modelHashes.videoVae
    };

    const baseGrantPayload = {
      version: 1 as const,
      candidateKey: candidate.key,
      specificationDigest: candidate.specificationDigest,
      goldMasterWorkflowHash: candidate.specification.workflowHash,
      goldMasterModelHashesDigest: computeModelHashesDigest(gmModelHashes),
      targetHostname: target.hostname,
      targetGpuUuid: target.gpuUuid,
      purpose: "staging" as const,
      scope: "staging" as const,
      issuedAt: "2026-10-18T10:00:00.000Z",
      expiresAt: "2026-10-18T20:00:00.000Z",
      operatorId: "operator-428"
    };

    const baseReq = {
      candidateKey: candidate.key,
      target,
      executionContext: {
        route: "i2v" as const,
        routingMode: "frame_anchored" as const,
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: gmModelHashes
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: gmModelHashes
      },
      purpose: "staging" as const
    };

    // 1. Grant purpose mismatch with request purpose
    const purposeDriftGrant: H3CandidateAuthorizationGrant = {
      payload: { ...baseGrantPayload, purpose: "production" },
      signature: "0123456789abcdef",
      signerKeyId: "key-1"
    };
    const purposeDecision = await service.evaluateEligibility({
      ...baseReq,
      authorizationGrant: purposeDriftGrant
    });
    expect(purposeDecision.eligible).toBe(false);
    if (!purposeDecision.eligible) {
      expect(purposeDecision.blockerCode).toBe("scope_insufficient_for_purpose");
      expect(purposeDecision.message).toMatch(
        /Grant purpose "production" does not match requested purpose "staging"/i
      );
    }

    // 2. Grant goldMasterWorkflowHash mismatch with gold master provenance
    const wfDriftGrant: H3CandidateAuthorizationGrant = {
      payload: {
        ...baseGrantPayload,
        goldMasterWorkflowHash: "0000000000000000000000000000000000000000000000000000000000000000"
      },
      signature: "0123456789abcdef",
      signerKeyId: "key-1"
    };
    const wfDecision = await service.evaluateEligibility({
      ...baseReq,
      authorizationGrant: wfDriftGrant
    });
    expect(wfDecision.eligible).toBe(false);
    if (!wfDecision.eligible) {
      expect(wfDecision.blockerCode).toBe("gold_master_mismatch");
      expect(wfDecision.message).toMatch(
        /Grant goldMasterWorkflowHash .* does not match gold master workflow hash/i
      );
    }

    // 3. Grant goldMasterModelHashesDigest mismatch with computed digest
    const modelDigestDriftGrant: H3CandidateAuthorizationGrant = {
      payload: {
        ...baseGrantPayload,
        goldMasterModelHashesDigest:
          "0000000000000000000000000000000000000000000000000000000000000000"
      },
      signature: "0123456789abcdef",
      signerKeyId: "key-1"
    };
    const modelDigestDecision = await service.evaluateEligibility({
      ...baseReq,
      authorizationGrant: modelDigestDriftGrant
    });
    expect(modelDigestDecision.eligible).toBe(false);
    if (!modelDigestDecision.eligible) {
      expect(modelDigestDecision.blockerCode).toBe("gold_master_mismatch");
      expect(modelDigestDecision.message).toMatch(
        /Grant goldMasterModelHashesDigest .* does not match computed gold master model hashes digest/i
      );
    }
  });

  it("fails closed on workflow hash drift: executionContext workflowHash differs from candidate specification", async () => {
    const candidate = createSyntheticCandidate();
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    const service = new H3CandidateEligibilityService({
      authorizationPort: { verifyCandidateAuthorization: vi.fn() },
      runtimeObservationPort: createMockRuntimePort(),
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const gmModelHashes = {
      checkpoint: candidate.specification.modelHashes.checkpoint,
      clip: candidate.specification.modelHashes.clip,
      audioVae: candidate.specification.modelHashes.audioVae,
      videoVae: candidate.specification.modelHashes.videoVae
    };

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: "0000000000000000000000000000000000000000000000000000000000000000",
        modelHashes: gmModelHashes
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: gmModelHashes
      },
      purpose: "staging"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("workflow_hash_mismatch");
      expect(decision.message).toMatch(/Workflow hash mismatch/i);
    }
  });

  it("fails closed on model hash drift: executionContext model hash differs from candidate specification", async () => {
    const candidate = createSyntheticCandidate();
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    const service = new H3CandidateEligibilityService({
      authorizationPort: { verifyCandidateAuthorization: vi.fn() },
      runtimeObservationPort: createMockRuntimePort(),
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const gmModelHashes = {
      checkpoint: candidate.specification.modelHashes.checkpoint,
      clip: candidate.specification.modelHashes.clip,
      audioVae: candidate.specification.modelHashes.audioVae,
      videoVae: candidate.specification.modelHashes.videoVae
    };

    const driftedModelHashes = {
      ...gmModelHashes,
      checkpoint: "0000000000000000000000000000000000000000000000000000000000000000"
    };

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: driftedModelHashes
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: gmModelHashes
      },
      purpose: "staging"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("model_hash_mismatch");
      expect(decision.message).toMatch(/Model hash mismatch for "checkpoint"/i);
    }
  });

  it("fails closed on gold master workflow hash drift: goldMasterProvenance workflowHash differs from candidate specification", async () => {
    const candidate = createSyntheticCandidate();
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    const service = new H3CandidateEligibilityService({
      authorizationPort: { verifyCandidateAuthorization: vi.fn() },
      runtimeObservationPort: createMockRuntimePort(),
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const gmModelHashes = {
      checkpoint: candidate.specification.modelHashes.checkpoint,
      clip: candidate.specification.modelHashes.clip,
      audioVae: candidate.specification.modelHashes.audioVae,
      videoVae: candidate.specification.modelHashes.videoVae
    };

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: gmModelHashes
      },
      goldMasterProvenance: {
        workflowHash: "0000000000000000000000000000000000000000000000000000000000000000",
        modelHashes: gmModelHashes
      },
      purpose: "staging"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("gold_master_mismatch");
      expect(decision.message).toMatch(/Gold master workflow hash mismatch/i);
    }
  });

  it("fails closed on gold master model hash drift: goldMasterProvenance model hash differs from candidate specification", async () => {
    const candidate = createSyntheticCandidate();
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    const service = new H3CandidateEligibilityService({
      authorizationPort: { verifyCandidateAuthorization: vi.fn() },
      runtimeObservationPort: createMockRuntimePort(),
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const gmModelHashes = {
      checkpoint: candidate.specification.modelHashes.checkpoint,
      clip: candidate.specification.modelHashes.clip,
      audioVae: candidate.specification.modelHashes.audioVae,
      videoVae: candidate.specification.modelHashes.videoVae
    };

    const driftedGmModelHashes = {
      ...gmModelHashes,
      videoVae: "0000000000000000000000000000000000000000000000000000000000000000"
    };

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: gmModelHashes
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: driftedGmModelHashes
      },
      purpose: "staging"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("gold_master_mismatch");
      expect(decision.message).toMatch(
        /Gold master model hash for "videoVae" is invalid or does not match/i
      );
    }
  });

  it("fails closed on runner profile, cfg, or denoise drift in execution context", async () => {
    const candidate = createSyntheticCandidate();
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    const runtimePort = createMockRuntimePort({
      observeCurrentRuntime: vi.fn().mockResolvedValue({
        ok: true,
        observation: createValidObservedRuntime(target, candidate.specification)
      })
    });

    const service = new H3CandidateEligibilityService({
      authorizationPort: { verifyCandidateAuthorization: vi.fn() },
      runtimeObservationPort: runtimePort,
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const gmModelHashes = {
      checkpoint: candidate.specification.modelHashes.checkpoint,
      clip: candidate.specification.modelHashes.clip,
      audioVae: candidate.specification.modelHashes.audioVae,
      videoVae: candidate.specification.modelHashes.videoVae
    };

    const baseExec = {
      route: "i2v" as const,
      routingMode: "frame_anchored" as const,
      width: 1344,
      height: 768,
      frames: 192,
      workflowHash: candidate.specification.workflowHash,
      modelHashes: gmModelHashes
    };

    // Runner profile drift
    const runnerDecision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: { ...baseExec, runnerProfile: "wrong-runner-profile" },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: gmModelHashes
      },
      purpose: "staging"
    });
    expect(runnerDecision.eligible).toBe(false);
    if (!runnerDecision.eligible) {
      expect(runnerDecision.blockerCode).toBe("runtime_optimizer_mismatch");
      expect(runnerDecision.message).toMatch(/Runner profile mismatch/i);
    }

    // CFG drift
    const cfgDecision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: { ...baseExec, cfg: 9.9 },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: gmModelHashes
      },
      purpose: "staging"
    });
    expect(cfgDecision.eligible).toBe(false);
    if (!cfgDecision.eligible) {
      expect(cfgDecision.blockerCode).toBe("runtime_optimizer_mismatch");
      expect(cfgDecision.message).toMatch(/CFG mismatch/i);
    }

    // Denoise drift
    const denoiseDecision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: { ...baseExec, denoise: 0.5 },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: gmModelHashes
      },
      purpose: "staging"
    });
    expect(denoiseDecision.eligible).toBe(false);
    if (!denoiseDecision.eligible) {
      expect(denoiseDecision.blockerCode).toBe("runtime_optimizer_mismatch");
      expect(denoiseDecision.message).toMatch(/Denoise mismatch/i);
    }
  });

  it("fails closed when grant candidateKey, specificationDigest, targetHostname, or targetGpuUuid mismatches", async () => {
    const candidate = createSyntheticCandidate();
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    const runtimePort = createMockRuntimePort({
      observeCurrentRuntime: vi.fn().mockResolvedValue({
        ok: true,
        observation: createValidObservedRuntime(target, candidate.specification)
      })
    });

    const service = new H3CandidateEligibilityService({
      authorizationPort: { verifyCandidateAuthorization: vi.fn() },
      runtimeObservationPort: runtimePort,
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const gmModelHashes = {
      checkpoint: candidate.specification.modelHashes.checkpoint,
      clip: candidate.specification.modelHashes.clip,
      audioVae: candidate.specification.modelHashes.audioVae,
      videoVae: candidate.specification.modelHashes.videoVae
    };

    const baseGrantPayload = {
      version: 1 as const,
      candidateKey: candidate.key,
      specificationDigest: candidate.specificationDigest,
      goldMasterWorkflowHash: candidate.specification.workflowHash,
      goldMasterModelHashesDigest: computeModelHashesDigest(gmModelHashes),
      targetHostname: target.hostname,
      targetGpuUuid: target.gpuUuid,
      purpose: "staging" as const,
      scope: "staging" as const,
      issuedAt: "2026-10-18T10:00:00.000Z",
      expiresAt: "2026-10-18T20:00:00.000Z",
      operatorId: "operator-428"
    };

    const baseReq = {
      candidateKey: candidate.key,
      target,
      executionContext: {
        route: "i2v" as const,
        routingMode: "frame_anchored" as const,
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: gmModelHashes
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: gmModelHashes
      },
      purpose: "staging" as const
    };

    // Candidate key mismatch
    const keyDecision = await service.evaluateEligibility({
      ...baseReq,
      authorizationGrant: {
        payload: {
          ...baseGrantPayload,
          candidateKey: "H3_CANDIDATE_00000000000000000000000000000000_V1"
        },
        signature: "1234",
        signerKeyId: "key-1"
      }
    });
    expect(keyDecision.eligible).toBe(false);
    if (!keyDecision.eligible) {
      expect(keyDecision.blockerCode).toBe("candidate_unrecognized");
    }

    // Specification digest mismatch
    const digestDecision = await service.evaluateEligibility({
      ...baseReq,
      authorizationGrant: {
        payload: {
          ...baseGrantPayload,
          specificationDigest: "0000000000000000000000000000000000000000000000000000000000000000"
        },
        signature: "1234",
        signerKeyId: "key-1"
      }
    });
    expect(digestDecision.eligible).toBe(false);
    if (!digestDecision.eligible) {
      expect(digestDecision.blockerCode).toBe("runtime_optimizer_mismatch");
    }

    // Target hostname mismatch
    const hostDecision = await service.evaluateEligibility({
      ...baseReq,
      authorizationGrant: {
        payload: { ...baseGrantPayload, targetHostname: "different-host-99" },
        signature: "1234",
        signerKeyId: "key-1"
      }
    });
    expect(hostDecision.eligible).toBe(false);
    if (!hostDecision.eligible) {
      expect(hostDecision.blockerCode).toBe("host_identity_mismatch");
    }

    // Target GPU UUID mismatch
    const gpuDecision = await service.evaluateEligibility({
      ...baseReq,
      authorizationGrant: {
        payload: { ...baseGrantPayload, targetGpuUuid: "GPU-different-gpu-99" },
        signature: "1234",
        signerKeyId: "key-1"
      }
    });
    expect(gpuDecision.eligible).toBe(false);
    if (!gpuDecision.eligible) {
      expect(gpuDecision.blockerCode).toBe("gpu_uuid_mismatch");
    }
  });

  it("fails closed when process restarts while authorization is pending", async () => {
    const candidate = createSyntheticCandidate();
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    let authorizationCompleted = false;
    const authPort: H3CandidateAuthorizationPort = {
      verifyCandidateAuthorization: vi.fn().mockImplementation(async () => {
        // Simulate async authorization verification
        await new Promise((r) => setTimeout(r, 10));
        authorizationCompleted = true;
        return { authorized: true, scope: "staging" };
      })
    };

    const runtimePort = createMockRuntimePort({
      observeCurrentRuntime: vi.fn().mockResolvedValue({
        ok: true,
        observation: createValidObservedRuntime(target, candidate.specification)
      }),
      // Process restarts while authorization was in-flight
      verifyProcessContinuity: vi.fn().mockImplementation(async () => {
        expect(authorizationCompleted).toBe(true);
        return {
          continuous: false,
          blocker: "PID 12345 start time changed (process restarted during authorization)"
        };
      })
    });

    const service = new H3CandidateEligibilityService({
      authorizationPort: authPort,
      runtimeObservationPort: runtimePort,
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const gmModelHashes = {
      checkpoint: candidate.specification.modelHashes.checkpoint,
      clip: candidate.specification.modelHashes.clip,
      audioVae: candidate.specification.modelHashes.audioVae,
      videoVae: candidate.specification.modelHashes.videoVae
    };

    const grant: H3CandidateAuthorizationGrant = {
      payload: {
        version: 1,
        candidateKey: candidate.key,
        specificationDigest: candidate.specificationDigest,
        goldMasterWorkflowHash: candidate.specification.workflowHash,
        goldMasterModelHashesDigest: computeModelHashesDigest(gmModelHashes),
        targetHostname: target.hostname,
        targetGpuUuid: target.gpuUuid,
        purpose: "staging",
        scope: "staging",
        issuedAt: "2026-10-18T10:00:00.000Z",
        expiresAt: "2026-10-18T20:00:00.000Z",
        operatorId: "operator-428"
      },
      signature: "0123456789abcdef",
      signerKeyId: "key-1"
    };

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: gmModelHashes
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: gmModelHashes
      },
      authorizationGrant: grant,
      purpose: "staging"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("process_continuity_lost");
      expect(decision.message).toMatch(/process restarted during authorization/i);
    }
  });

  it("fails closed when spec expectedCoreRevision or expectedPythonExecutable does not match observed runtime", async () => {
    const candidate = createSyntheticCandidate({
      expectedCoreRevision: "custom_core_revision_12345",
      expectedPythonExecutable: "/opt/custom-venv/bin/python3"
    });
    const candidateMap = new Map([[candidate.key, candidate]]);
    const target = { hostname: "render-node-01", gpuUuid: "GPU-1234" };

    const runtimePort = createMockRuntimePort({
      observeCurrentRuntime: vi.fn().mockResolvedValue({
        ok: true,
        observation: createValidObservedRuntime(target, candidate.specification)
      })
    });

    const service = new H3CandidateEligibilityService({
      authorizationPort: { verifyCandidateAuthorization: vi.fn() },
      runtimeObservationPort: runtimePort,
      registryReader: {
        getCandidateProfile: (k) => (k ? candidateMap.get(k) : undefined),
        listCandidateProfiles: () => Array.from(candidateMap.values())
      }
    });

    const gmModelHashes = {
      checkpoint: candidate.specification.modelHashes.checkpoint,
      clip: candidate.specification.modelHashes.clip,
      audioVae: candidate.specification.modelHashes.audioVae,
      videoVae: candidate.specification.modelHashes.videoVae
    };

    const decision = await service.evaluateEligibility({
      candidateKey: candidate.key,
      target,
      executionContext: {
        route: "i2v",
        routingMode: "frame_anchored",
        width: 1344,
        height: 768,
        frames: 192,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: gmModelHashes
      },
      goldMasterProvenance: {
        workflowHash: candidate.specification.workflowHash,
        modelHashes: gmModelHashes
      },
      purpose: "staging"
    });

    expect(decision.eligible).toBe(false);
    if (!decision.eligible) {
      expect(decision.blockerCode).toBe("runtime_optimizer_mismatch");
      expect(decision.message).toMatch(
        /Observed ComfyUI core revision.*does not match pinned core revision "custom_core_revision_12345"/i
      );
    }
  });
});
