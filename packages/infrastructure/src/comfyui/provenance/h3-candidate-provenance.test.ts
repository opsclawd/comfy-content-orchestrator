import { describe, expect, it } from "vitest";
import {
  resolveCandidateProvenanceFromCollection,
  H3CandidateProvenanceResolutionError,
  type H3CandidateProvenanceReport
} from "./h3-candidate-provenance.js";

function createValidProvenanceReport(candidateKey: string): H3CandidateProvenanceReport {
  return {
    version: 1,
    candidateKey,
    generatedAt: "2026-10-18T10:00:00.000Z",
    workflow: {
      relativePath: "templates/minimax_h3_720p_i2v_192f_api.json",
      sha256: "4d1aafd575ceecb6146b1b96d5c5b13f759fea5eb47f28aabfd92965765c142e"
    },
    models: [
      {
        key: "models/diffusion_models/checkpoint.safetensors",
        category: "diffusion_models",
        relativePath: "models/diffusion_models/checkpoint.safetensors",
        sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
        bytes: 1000000000
      }
    ],
    renderProfileProvenance: {
      candidateKey,
      version: 1,
      route: "i2v",
      routingMode: "frame_anchored",
      width: 1344,
      height: 768,
      fps: 24,
      frames: 192,
      steps: 20,
      workflowHash: "4d1aafd575ceecb6146b1b96d5c5b13f759fea5eb47f28aabfd92965765c142e",
      modelHashes: {
        checkpoint: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779"
      },
      optimizerFingerprint: {
        attentionBackend: "sage_attn",
        customNodeRevision: "rev-1",
        customNodeSourceHash: "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        packageVersion: "0.2.1",
        sparsity: null,
        customNodes: [],
        packageVersions: { torch: "2.5.1" }
      },
      runnerProfile: "dynamicvram-offload-v1",
      measuredDiskFootprintGb: 40.0,
      minFreeDiskGb: 50
    },
    observedRuntime: {
      hostname: "render-node-01",
      gpuUuid: "GPU-1234",
      pid: 1000,
      processStartTimeTicks: 123456,
      pythonExecutable: "/bin/python3",
      comfyUiCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      commandLineArgs: ["python3", "main.py"],
      customNodes: {},
      packageVersions: {},
      observedAt: "2026-10-18T10:00:00.000Z"
    },
    operatorAuthorization: {
      signerKeyId: "op-428-key-1",
      payloadDigest: "5555555555555555555555555555555555555555555555555555555555555555",
      scope: "staging"
    }
  };
}

describe("resolveCandidateProvenanceFromCollection", () => {
  const keyA = "H3_CANDIDATE_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_V1";
  const keyB = "H3_CANDIDATE_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb_V1";

  it("resolves single candidate report format and deep-freezes it", () => {
    const report = createValidProvenanceReport(keyA);
    const resolved = resolveCandidateProvenanceFromCollection(report, keyA);
    expect(resolved.candidateKey).toBe(keyA);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.renderProfileProvenance)).toBe(true);
  });

  it("throws when candidateKey mismatches single report", () => {
    const report = createValidProvenanceReport(keyA);
    expect(() => resolveCandidateProvenanceFromCollection(report, keyB)).toThrow(
      H3CandidateProvenanceResolutionError
    );
  });

  it("resolves selected candidate from multi-candidate collection format", () => {
    const reportA = createValidProvenanceReport(keyA);
    const reportB = createValidProvenanceReport(keyB);
    const collection = {
      version: 1,
      candidates: [reportA, reportB]
    };

    const resolvedA = resolveCandidateProvenanceFromCollection(collection, keyA);
    expect(resolvedA.candidateKey).toBe(keyA);
    expect(Object.isFrozen(resolvedA)).toBe(true);

    const resolvedB = resolveCandidateProvenanceFromCollection(collection, keyB);
    expect(resolvedB.candidateKey).toBe(keyB);
  });

  it("throws when collection has no entry for requested candidateKey", () => {
    const reportA = createValidProvenanceReport(keyA);
    const collection = {
      version: 1,
      candidates: [reportA]
    };

    expect(() => resolveCandidateProvenanceFromCollection(collection, keyB)).toThrow(
      /has no entry for candidateKey.*available: H3_CANDIDATE_aaaa/i
    );
  });

  it("throws when collection has ambiguous duplicate entries for requested key", () => {
    const reportA1 = createValidProvenanceReport(keyA);
    const reportA2 = createValidProvenanceReport(keyA);
    const collection = {
      version: 1,
      candidates: [reportA1, reportA2]
    };

    expect(() => resolveCandidateProvenanceFromCollection(collection, keyA)).toThrow(
      /has 2 ambiguous entries for candidateKey/i
    );
  });

  it("throws when collection version is unsupported", () => {
    const reportA = createValidProvenanceReport(keyA);
    const collection = {
      version: 2,
      candidates: [reportA]
    };

    expect(() => resolveCandidateProvenanceFromCollection(collection, keyA)).toThrow(
      /unsupported version: 2/i
    );
  });

  it("throws when report version is unsupported", () => {
    const reportA = { ...createValidProvenanceReport(keyA), version: 999 };
    expect(() => resolveCandidateProvenanceFromCollection(reportA, keyA)).toThrow(
      H3CandidateProvenanceResolutionError
    );
  });

  it("throws when required fields are missing or empty", () => {
    const reportA = createValidProvenanceReport(keyA);
    const missingWorkflow = { ...reportA, workflow: undefined };
    expect(() => resolveCandidateProvenanceFromCollection(missingWorkflow, keyA)).toThrow(
      H3CandidateProvenanceResolutionError
    );

    const emptyModels = { ...reportA, models: [] };
    expect(() => resolveCandidateProvenanceFromCollection(emptyModels, keyA)).toThrow(
      H3CandidateProvenanceResolutionError
    );
  });

  it("throws when inner renderProfileProvenance is swapped or mismatched", () => {
    const reportA = createValidProvenanceReport(keyA);
    // Swapped inner candidateKey
    const swappedKey = {
      ...reportA,
      renderProfileProvenance: {
        ...reportA.renderProfileProvenance,
        candidateKey: keyB
      }
    };
    expect(() => resolveCandidateProvenanceFromCollection(swappedKey, keyA)).toThrow(
      /Inner renderProfileProvenance\.candidateKey.*does not match/i
    );

    // Mismatched workflow hash
    const swappedWorkflow = {
      ...reportA,
      renderProfileProvenance: {
        ...reportA.renderProfileProvenance,
        workflowHash: "0000000000000000000000000000000000000000000000000000000000000000"
      }
    };
    expect(() => resolveCandidateProvenanceFromCollection(swappedWorkflow, keyA)).toThrow(
      /Inner renderProfileProvenance\.workflowHash.*does not match/i
    );
  });

  it("throws when modelHashes contains empty or invalid hash", () => {
    const reportA = createValidProvenanceReport(keyA);
    const emptyModelHash = {
      ...reportA,
      renderProfileProvenance: {
        ...reportA.renderProfileProvenance,
        modelHashes: { checkpoint: "" }
      }
    };
    expect(() => resolveCandidateProvenanceFromCollection(emptyModelHash, keyA)).toThrow(
      H3CandidateProvenanceResolutionError
    );
  });
});
