import { describe, expect, it } from "vitest";
import {
  H3CandidateExecutionSpecificationSchema,
  H3CandidateProfileSchema,
  computeH3CandidateKey,
  computeH3CandidateSpecificationDigest,
  canonicalizeH3CandidateSpecification,
  H3CandidateProfileKeySchema,
  type H3CandidateExecutionSpecification,
  type H3CandidateProfile
} from "./h3-candidate-profile.js";
import {
  getH3CandidateProfile,
  listH3CandidateProfiles,
  isH3CandidateProfileKey,
  resolveH3ProfileFrameCapabilities,
  isFrameCountAllowedForH3Profile
} from "./h3-candidate-registry.js";
import { createIsolatedH3CandidateRegistry } from "./testing/h3-candidate-test-registry.js";
import * as contractsBarrel from "./index.js";

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
    frames: 124, // (124 - 5) % 17 === 0
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
      customNodeRevision: "v1.0.0",
      customNodeSourceHash: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
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
        revision: "git-commit-abc123",
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

function createValidCandidateProfile(
  specOverrides: Partial<H3CandidateExecutionSpecification> = {}
): H3CandidateProfile {
  const spec = createValidSpec(specOverrides);
  const specDigest = computeH3CandidateSpecificationDigest(spec);
  const key = computeH3CandidateKey(specDigest, 1);

  return {
    key,
    version: 1,
    specificationDigest: specDigest,
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

describe("H3CandidateProfile Contracts", () => {
  it("accepts a fully compliant H3 candidate specification", () => {
    const spec = createValidSpec();
    const parsed = H3CandidateExecutionSpecificationSchema.safeParse(spec);
    expect(parsed.success).toBe(true);
  });

  it("enforces route and routingMode invariant", () => {
    // i2v with reference_directed must fail
    const invalidI2v = createValidSpec({
      route: "i2v",
      routingMode: "reference_directed"
    });
    expect(H3CandidateExecutionSpecificationSchema.safeParse(invalidI2v).success).toBe(false);

    // ref2v with frame_anchored must fail
    const invalidRef2v = createValidSpec({
      route: "ref2v",
      routingMode: "frame_anchored"
    });
    expect(H3CandidateExecutionSpecificationSchema.safeParse(invalidRef2v).success).toBe(false);

    // ref2v with reference_directed succeeds
    const validRef2v = createValidSpec({
      route: "ref2v",
      routingMode: "reference_directed"
    });
    expect(H3CandidateExecutionSpecificationSchema.safeParse(validRef2v).success).toBe(true);
  });

  it("enforces MiniMax-H3 temporal grid: (frames - 5) % 17 === 0", () => {
    // 124: (124 - 5) % 17 = 119 % 17 = 0 -> PASS
    expect(
      H3CandidateExecutionSpecificationSchema.safeParse(createValidSpec({ frames: 124 })).success
    ).toBe(true);

    // 192: (192 - 5) % 17 = 187 % 17 = 0 -> PASS
    expect(
      H3CandidateExecutionSpecificationSchema.safeParse(createValidSpec({ frames: 192 })).success
    ).toBe(true);

    // 243: (243 - 5) % 17 = 238 % 17 = 0 -> PASS
    expect(
      H3CandidateExecutionSpecificationSchema.safeParse(createValidSpec({ frames: 243 })).success
    ).toBe(true);

    // 362: (362 - 5) % 17 = 357 % 17 = 0 -> PASS
    expect(
      H3CandidateExecutionSpecificationSchema.safeParse(createValidSpec({ frames: 362 })).success
    ).toBe(true);

    // Off-grid frames fail
    expect(
      H3CandidateExecutionSpecificationSchema.safeParse(createValidSpec({ frames: 120 })).success
    ).toBe(false);
    expect(
      H3CandidateExecutionSpecificationSchema.safeParse(createValidSpec({ frames: 125 })).success
    ).toBe(false);
    expect(
      H3CandidateExecutionSpecificationSchema.safeParse(createValidSpec({ frames: 200 })).success
    ).toBe(false);
  });

  it("rejects empty or malformed model hashes", () => {
    const specWithEmptyHash = createValidSpec();
    (specWithEmptyHash.modelHashes as unknown as Record<string, string>).checkpoint = "";
    expect(H3CandidateExecutionSpecificationSchema.safeParse(specWithEmptyHash).success).toBe(
      false
    );

    const specWithWhitespace = createValidSpec();
    (specWithWhitespace.modelHashes as unknown as Record<string, string>).checkpoint =
      " 9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779 ";
    expect(H3CandidateExecutionSpecificationSchema.safeParse(specWithWhitespace).success).toBe(
      false
    );

    const specWithUppercase = createValidSpec();
    (specWithUppercase.modelHashes as unknown as Record<string, string>).checkpoint =
      "9255F52B6677845AD238F20DFAAFA94727053694127AB7F255C048F0F9365779";
    expect(H3CandidateExecutionSpecificationSchema.safeParse(specWithUppercase).success).toBe(
      false
    );
  });

  it("rejects duplicate customNodes", () => {
    const specWithDupes = createValidSpec({
      customNodes: [
        {
          name: "comfyui-sageattention",
          revision: "rev-1",
          sourceHash: "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd"
        },
        {
          name: "comfyui-sageattention",
          revision: "rev-2",
          sourceHash: "1234561234561234561234561234561234561234561234561234561234561234"
        }
      ]
    });
    expect(H3CandidateExecutionSpecificationSchema.safeParse(specWithDupes).success).toBe(false);
  });

  it("computes deterministic canonical JSON and specificationDigest independent of key ordering", () => {
    const specA = createValidSpec();
    // Create specB with identical values but reverse key insertion order in modelHashes and packageVersions
    const specB = createValidSpec({
      modelHashes: {
        additionalModels: {},
        turboLora: "none",
        videoVae: specA.modelHashes.videoVae,
        audioVae: specA.modelHashes.audioVae,
        clip: specA.modelHashes.clip,
        checkpoint: specA.modelHashes.checkpoint
      },
      packageVersions: {
        sageattention: "0.2.1",
        torch: "2.5.1+cu124"
      }
    });

    const canonicalA = canonicalizeH3CandidateSpecification(specA);
    const canonicalB = canonicalizeH3CandidateSpecification(specB);
    expect(canonicalA).toBe(canonicalB);

    const digestA = computeH3CandidateSpecificationDigest(specA);
    const digestB = computeH3CandidateSpecificationDigest(specB);
    expect(digestA).toBe(digestB);
    expect(digestA).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces candidate keys in reserved namespace matching regex", () => {
    const spec = createValidSpec();
    const digest = computeH3CandidateSpecificationDigest(spec);
    const key = computeH3CandidateKey(digest, 1);

    expect(key).toBe(`H3_CANDIDATE_${digest.slice(0, 32)}_V1`);
    expect(H3CandidateProfileKeySchema.safeParse(key).success).toBe(true);
    // Must never collide with legacy key format
    expect(key.startsWith("MINIMAX_H3_")).toBe(false);
  });

  it("validates compliant candidate profile and rejects mismatched digest/key", () => {
    const profile = createValidCandidateProfile();
    expect(H3CandidateProfileSchema.safeParse(profile).success).toBe(true);

    // Tampered digest
    const tamperedDigest = {
      ...profile,
      specificationDigest: "0000000000000000000000000000000000000000000000000000000000000000"
    };
    expect(H3CandidateProfileSchema.safeParse(tamperedDigest).success).toBe(false);

    // Tampered key
    const tamperedKey = {
      ...profile,
      key: "H3_CANDIDATE_00000000000000000000000000000000_V1"
    };
    expect(H3CandidateProfileSchema.safeParse(tamperedKey).success).toBe(false);
  });

  it("enforces topology requirements for I2V vs Ref2V", () => {
    // I2V missing referenceImage & firstFrame fails
    const i2vProfile = createValidCandidateProfile({ route: "i2v", routingMode: "frame_anchored" });
    const invalidI2v = {
      ...i2vProfile,
      topology: {
        ...i2vProfile.topology,
        referenceImage: undefined,
        firstFrame: undefined
      }
    };
    expect(H3CandidateProfileSchema.safeParse(invalidI2v).success).toBe(false);

    // Ref2V candidate
    const ref2vSpec = createValidSpec({
      route: "ref2v",
      routingMode: "reference_directed",
      frames: 192
    });
    const ref2vDigest = computeH3CandidateSpecificationDigest(ref2vSpec);
    const ref2vKey = computeH3CandidateKey(ref2vDigest, 1);

    const ref2vProfile: H3CandidateProfile = {
      key: ref2vKey,
      version: 1,
      specificationDigest: ref2vDigest,
      specification: ref2vSpec,
      topology: {
        prompt: { nodeId: "105", classType: "MiniMaxH3ReferenceToVideo", inputField: "prompt" },
        seed: { nodeId: "15", classType: "RandomNoise", inputField: "noise_seed" },
        frameCount: { nodeId: "105", classType: "MiniMaxH3ReferenceToVideo", inputField: "length" },
        width: { nodeId: "105", classType: "MiniMaxH3ReferenceToVideo", inputField: "width" },
        height: { nodeId: "105", classType: "MiniMaxH3ReferenceToVideo", inputField: "height" },
        refImageSize: {
          nodeId: "105",
          classType: "MiniMaxH3ReferenceToVideo",
          inputField: "ref_image_size"
        },
        referenceNode: {
          nodeId: "105",
          classType: "MiniMaxH3ReferenceToVideo",
          inputField: "ref_images"
        },
        referenceImages: [{ nodeId: "201", classType: "LoadImage", inputField: "image" }],
        referenceSlotFields: ["ref_images.ref_image_0"]
      },
      measurements: null,
      status: "candidate"
    };
    expect(H3CandidateProfileSchema.safeParse(ref2vProfile).success).toBe(true);

    // Ref2V missing referenceImages fails
    const invalidRef2v = {
      ...ref2vProfile,
      topology: {
        ...ref2vProfile.topology,
        referenceImages: []
      }
    };
    expect(H3CandidateProfileSchema.safeParse(invalidRef2v).success).toBe(false);
  });
});

describe("H3 Candidate Registry & Production Isolation", () => {
  it("production catalog is strictly EMPTY initially", () => {
    expect(listH3CandidateProfiles()).toEqual([]);
    expect(listH3CandidateProfiles().length).toBe(0);
    expect(getH3CandidateProfile("H3_CANDIDATE_nonexistent_V1")).toBeUndefined();
    expect(isH3CandidateProfileKey("H3_CANDIDATE_nonexistent_V1")).toBe(false);
  });

  it("barrel export does not export any candidate registration function, synthetic flag, or test helper", () => {
    const exports = Object.keys(contractsBarrel);
    expect(exports).not.toContain("createIsolatedH3CandidateRegistry");
    expect(exports).not.toContain("registerCandidateProfile");
    expect(exports).not.toContain("registerH3CandidateProfile");
    expect(exports).not.toContain("allowSynthetic");
    expect(exports).not.toContain("setCandidateProfile");
  });

  it("isolated test registry stores synthetic candidate without affecting production catalog", () => {
    const candidate = createValidCandidateProfile({ frames: 192 });
    const testRegistry = createIsolatedH3CandidateRegistry([candidate]);

    // Test registry recognizes candidate
    expect(testRegistry.isCandidateProfileKey(candidate.key)).toBe(true);
    expect(testRegistry.getCandidateProfile(candidate.key)?.key).toBe(candidate.key);
    expect(testRegistry.listCandidateProfiles().length).toBe(1);

    // Shared production catalog remains strictly EMPTY
    expect(isH3CandidateProfileKey(candidate.key)).toBe(false);
    expect(getH3CandidateProfile(candidate.key)).toBeUndefined();
    expect(listH3CandidateProfiles().length).toBe(0);
  });

  it("isolated test registry deep-freezes returned entries", () => {
    const candidate = createValidCandidateProfile();
    const testRegistry = createIsolatedH3CandidateRegistry([candidate]);
    const retrieved = testRegistry.getCandidateProfile(candidate.key);
    expect(retrieved).toBeDefined();
    expect(Object.isFrozen(retrieved)).toBe(true);
    expect(Object.isFrozen(retrieved!.specification)).toBe(true);
  });

  it("isolated test registry rejects duplicate candidate keys", () => {
    const candidate = createValidCandidateProfile();
    expect(() => createIsolatedH3CandidateRegistry([candidate, candidate])).toThrow(
      /Duplicate candidate key in test registry/
    );
  });
});

describe("Profile-Scoped Frame Capabilities", () => {
  it("resolves legacy I2V profile and aliases strictly to [124]", () => {
    const keys = [
      "MINIMAX_H3_720P_5S_I2V_V1",
      "minimax-h3-720p-5s-i2v-v1",
      "minimax-h3-720p-124f-i2v",
      "minimax_h3_i2v",
      "minimax-h3"
    ];
    for (const key of keys) {
      const cap = resolveH3ProfileFrameCapabilities(key);
      expect(cap).toBeDefined();
      expect(cap!.allowedFrameCounts).toEqual([124]);
      expect(cap!.isAllowedFrameCount(124)).toBe(true);
      expect(cap!.isAllowedFrameCount(192)).toBe(false);
      expect(cap!.route).toBe("i2v");
      expect(cap!.routingMode).toBe("frame_anchored");
      expect(cap!.width).toBe(1344);
      expect(cap!.height).toBe(768);
      expect(cap!.fps).toBe(24);
      expect(isFrameCountAllowedForH3Profile(key, 124)).toBe(true);
      expect(isFrameCountAllowedForH3Profile(key, 192)).toBe(false);
    }
  });

  it("resolves legacy Ref2V profile and aliases strictly to [124]", () => {
    const keys = [
      "MINIMAX_H3_720P_5S_REF2V_V1",
      "minimax-h3-720p-5s-ref2v-v1",
      "minimax-h3-720p-124f-ref2v",
      "minimax_h3_ref2v",
      "minimax-h3-ref2v"
    ];
    for (const key of keys) {
      const cap = resolveH3ProfileFrameCapabilities(key);
      expect(cap).toBeDefined();
      expect(cap!.allowedFrameCounts).toEqual([124]);
      expect(cap!.isAllowedFrameCount(124)).toBe(true);
      expect(cap!.isAllowedFrameCount(192)).toBe(false);
      expect(cap!.route).toBe("ref2v");
      expect(cap!.routingMode).toBe("reference_directed");
      expect(isFrameCountAllowedForH3Profile(key, 124)).toBe(true);
      expect(isFrameCountAllowedForH3Profile(key, 243)).toBe(false);
    }
  });

  it("returns undefined for unknown or unaccepted candidates in production", () => {
    expect(resolveH3ProfileFrameCapabilities("UNKNOWN_PROFILE")).toBeUndefined();
    expect(isFrameCountAllowedForH3Profile("UNKNOWN_PROFILE", 124)).toBe(false);

    // Unaccepted candidate key returns undefined in production
    const candidate = createValidCandidateProfile({ frames: 192 });
    expect(resolveH3ProfileFrameCapabilities(candidate.key)).toBeUndefined();
    expect(isFrameCountAllowedForH3Profile(candidate.key, 192)).toBe(false);
  });

  it("resolves exact candidate frames on isolated test registry", () => {
    const candidate = createValidCandidateProfile({ frames: 192 });
    const testRegistry = createIsolatedH3CandidateRegistry([candidate]);

    const cap = testRegistry.resolveH3ProfileFrameCapabilities(candidate.key);
    expect(cap).toBeDefined();
    expect(cap!.allowedFrameCounts).toEqual([192]);
    expect(cap!.isAllowedFrameCount(192)).toBe(true);
    expect(cap!.isAllowedFrameCount(124)).toBe(false);
    expect(cap!.isAllowedFrameCount(243)).toBe(false);
    expect(testRegistry.isFrameCountAllowedForH3Profile(candidate.key, 192)).toBe(true);
    expect(testRegistry.isFrameCountAllowedForH3Profile(candidate.key, 124)).toBe(false);
  });

  describe("Negative Schema Refinements", () => {
    it("rejects non-safe integer geometry and frame counts", () => {
      expect(
        H3CandidateExecutionSpecificationSchema.safeParse(createValidSpec({ width: 1e20 })).success
      ).toBe(false);
      expect(
        H3CandidateExecutionSpecificationSchema.safeParse(createValidSpec({ height: 1e20 })).success
      ).toBe(false);
    });

    it("rejects reserved key collisions in additionalModels", () => {
      const spec = createValidSpec();
      (spec.modelHashes.additionalModels as Record<string, string>)["checkpoint"] =
        "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779";
      expect(H3CandidateExecutionSpecificationSchema.safeParse(spec).success).toBe(false);
    });

    it("constrains H3CandidateProfileKeySchema strictly to 32 lowercase hex characters", () => {
      // 32 chars: valid
      expect(
        H3CandidateProfileKeySchema.safeParse("H3_CANDIDATE_1234567890abcdef1234567890abcdef_V1")
          .success
      ).toBe(true);
      // 16 chars: rejected
      expect(
        H3CandidateProfileKeySchema.safeParse("H3_CANDIDATE_1234567890abcdef_V1").success
      ).toBe(false);
      // 64 chars: rejected
      expect(
        H3CandidateProfileKeySchema.safeParse(
          "H3_CANDIDATE_1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef_V1"
        ).success
      ).toBe(false);
      // Uppercase: rejected
      expect(
        H3CandidateProfileKeySchema.safeParse("H3_CANDIDATE_1234567890ABCDEF1234567890ABCDEF_V1")
          .success
      ).toBe(false);
    });

    it("enforces customNodeRevision === 'none' iff customNodeSourceHash === 'none'", () => {
      const specMismatch1 = createValidSpec({
        attention: {
          backend: "sage_attn",
          customNodeRevision: "none",
          customNodeSourceHash: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          packageVersion: "0.2.1",
          sparsitySettings: { enabled: false, method: "none", threshold: 0 }
        }
      });
      expect(H3CandidateExecutionSpecificationSchema.safeParse(specMismatch1).success).toBe(false);

      const specMismatch2 = createValidSpec({
        attention: {
          backend: "sage_attn",
          customNodeRevision: "v1.0.0",
          customNodeSourceHash: "none",
          packageVersion: "0.2.1",
          sparsitySettings: { enabled: false, method: "none", threshold: 0 }
        }
      });
      expect(H3CandidateExecutionSpecificationSchema.safeParse(specMismatch2).success).toBe(false);
    });

    it("rejects candidate profile topology missing width or height targets", () => {
      const profile = createValidCandidateProfile();
      const noWidth = {
        ...profile,
        topology: { ...profile.topology, width: undefined }
      };
      expect(H3CandidateProfileSchema.safeParse(noWidth).success).toBe(false);

      const noHeight = {
        ...profile,
        topology: { ...profile.topology, height: undefined }
      };
      expect(H3CandidateProfileSchema.safeParse(noHeight).success).toBe(false);
    });

    it("rejects i2v candidate topology defining contradictory ref2v conditioning", () => {
      const profile = createValidCandidateProfile({ route: "i2v", routingMode: "frame_anchored" });
      const contradictory = {
        ...profile,
        topology: {
          ...profile.topology,
          referenceNode: {
            nodeId: "105",
            classType: "MiniMaxH3ReferenceToVideo",
            inputField: "ref_images"
          }
        }
      };
      expect(H3CandidateProfileSchema.safeParse(contradictory).success).toBe(false);
    });

    it("rejects ref2v candidate topology defining contradictory frame anchors or duplicate slots", () => {
      const ref2vSpec = createValidSpec({
        route: "ref2v",
        routingMode: "reference_directed",
        frames: 192
      });
      const digest = computeH3CandidateSpecificationDigest(ref2vSpec);
      const key = computeH3CandidateKey(digest, 1);

      const baseRef2v: H3CandidateProfile = {
        key,
        version: 1,
        specificationDigest: digest,
        specification: ref2vSpec,
        topology: {
          prompt: { nodeId: "105", classType: "MiniMaxH3ReferenceToVideo", inputField: "prompt" },
          seed: { nodeId: "15", classType: "RandomNoise", inputField: "noise_seed" },
          frameCount: {
            nodeId: "105",
            classType: "MiniMaxH3ReferenceToVideo",
            inputField: "length"
          },
          width: { nodeId: "105", classType: "MiniMaxH3ReferenceToVideo", inputField: "width" },
          height: { nodeId: "105", classType: "MiniMaxH3ReferenceToVideo", inputField: "height" },
          refImageSize: {
            nodeId: "105",
            classType: "MiniMaxH3ReferenceToVideo",
            inputField: "ref_image_size"
          },
          referenceNode: {
            nodeId: "105",
            classType: "MiniMaxH3ReferenceToVideo",
            inputField: "ref_images"
          },
          referenceImages: [{ nodeId: "201", classType: "LoadImage", inputField: "image" }],
          referenceSlotFields: ["ref_images.ref_image_0"]
        },
        measurements: null,
        status: "candidate"
      };

      // Contradictory anchor: firstFrame present on ref2v
      const withAnchor = {
        ...baseRef2v,
        topology: {
          ...baseRef2v.topology,
          firstFrame: { nodeId: "201", classType: "LoadImage", inputField: "image" }
        }
      };
      expect(H3CandidateProfileSchema.safeParse(withAnchor).success).toBe(false);

      // Mismatched referenceSlotFields length vs referenceImages length
      const lengthMismatch = {
        ...baseRef2v,
        topology: {
          ...baseRef2v.topology,
          referenceSlotFields: ["ref_images.ref_image_0", "ref_images.ref_image_1"]
        }
      };
      expect(H3CandidateProfileSchema.safeParse(lengthMismatch).success).toBe(false);

      // Duplicate reference slot fields
      const duplicateSlots = {
        ...baseRef2v,
        topology: {
          ...baseRef2v.topology,
          referenceImages: [
            { nodeId: "201", classType: "LoadImage", inputField: "image" },
            { nodeId: "202", classType: "LoadImage", inputField: "image" }
          ],
          referenceSlotFields: ["ref_images.ref_image_0", "ref_images.ref_image_0"]
        }
      };
      expect(H3CandidateProfileSchema.safeParse(duplicateSlots).success).toBe(false);
    });
  });
});
