import { createHash, type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import {
  type H3CandidateExecutionSpecification,
  type H3CandidateProfile,
  type H3CandidateProvenanceReport,
  type H3CapabilityDecisionRow,
  type H3CandidateAuthorizationPayload,
  type H3CandidateAuthorizationGrant,
  type H3CapabilityMatrixEnvelope,
  computeH3CandidateSpecificationDigest,
  computeH3CandidateKey,
  computeModelHashesDigest,
  canonicalizeAuthorizationPayload,
  canonicalizeCapabilityMatrixPayload,
  MINIMAX_H3_720P_5S_REF2V_V1_INJECTION_TOPOLOGY
} from "../../../packages/contracts/src/index.ts";
import { hashWorkflow } from "../../../packages/infrastructure/src/comfyui/provenance/hasher.ts";

function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const value = (obj as Record<string, unknown>)[key];
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return obj as Readonly<T>;
}

export const SOURCE_MATRIX_ID = "h3-capability-matrix-ref2va-turbo-4-2026-10-24";
export const H3_VARIABLE_DURATION_SOURCE_MATRIX_ID = SOURCE_MATRIX_ID;
export const SOURCE_OPERATOR_IDENTITY = "opsclawd";
export const SOURCE_COMMENT_URL =
  "https://github.com/opsclawd/comfy-content-orchestrator/issues/425#issuecomment-6380534495";

export const SOURCE_HOSTNAME = "llama";
export const SOURCE_GPU_UUID = "GPU-89a53488-359c-4942-75ae-47ee8aa89f53";
export const SOURCE_CORE_REVISION = "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc";
export const SOURCE_PYTHON_EXECUTABLE = "/home/gpoontip/ComfyUI/venv/bin/python";

export const SOURCE_MODEL_HASHES = deepFreeze({
  checkpoint: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
  clip: "35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6",
  audioVae: "8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48",
  videoVae: "52a2c8c73583c86e4f41cdcce3a6ad0ea562987bc0bf3d60a0cef5f5c8e60c0e",
  turboLora: "5b9ab5ade15d0775676d01a907268a69a1468dc6033b3b0d3ded5502f3ebb84c"
});

export const SOURCE_MODEL_HASHES_DIGEST = computeModelHashesDigest({
  checkpoint: SOURCE_MODEL_HASHES.checkpoint,
  clip: SOURCE_MODEL_HASHES.clip,
  audioVae: SOURCE_MODEL_HASHES.audioVae,
  videoVae: SOURCE_MODEL_HASHES.videoVae,
  turboLora: SOURCE_MODEL_HASHES.turboLora,
  additionalModels: {}
});

export const SOURCE_SPEC_243F: H3CandidateExecutionSpecification = deepFreeze({
  version: 1,
  route: "ref2v",
  routingMode: "reference_directed",
  workflowHash: "e6084e4f9004a591291f94c24998d10f2b6c7e687bab375ef8e3af8b29bb6e4a",
  frames: 243,
  fps: 24,
  width: 1344,
  height: 768,
  sampler: "res_multistep",
  scheduler: "simple",
  steps: 4,
  cfg: 1,
  denoise: 1,
  modelHashes: {
    checkpoint: SOURCE_MODEL_HASHES.checkpoint,
    clip: SOURCE_MODEL_HASHES.clip,
    audioVae: SOURCE_MODEL_HASHES.audioVae,
    videoVae: SOURCE_MODEL_HASHES.videoVae,
    turboLora: SOURCE_MODEL_HASHES.turboLora,
    additionalModels: {}
  },
  attention: {
    backend: "comfy_native" as const,
    customNodeRevision: "none",
    customNodeSourceHash: "none",
    packageVersion: "none",
    sparsitySettings: {
      enabled: false as const,
      method: "none" as const,
      threshold: 0 as const
    }
  },
  customNodes: [],
  packageVersions: {
    torch: "2.13.0+cu130",
    comfyui: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
  },
  runnerSettings: {
    runnerProfile: "dynamicvram-offload-v1",
    offloadPolicy: "dynamicvram" as const,
    requiresModelOffloading: true,
    maxConcurrentGpuJobs: 1,
    minFreeDiskGb: 20
  },
  expectedCoreRevision: SOURCE_CORE_REVISION,
  expectedPythonExecutable: SOURCE_PYTHON_EXECUTABLE
});

export const SOURCE_SPEC_362F: H3CandidateExecutionSpecification = deepFreeze({
  version: 1,
  route: "ref2v",
  routingMode: "reference_directed",
  workflowHash: "6cedefbd4bc0bc26c60826d29cdb4c63b5e11b5ee2fdf9e5d89e02aaca6a0c85",
  frames: 362,
  fps: 24,
  width: 1344,
  height: 768,
  sampler: "res_multistep",
  scheduler: "simple",
  steps: 4,
  cfg: 1,
  denoise: 1,
  modelHashes: {
    checkpoint: SOURCE_MODEL_HASHES.checkpoint,
    clip: SOURCE_MODEL_HASHES.clip,
    audioVae: SOURCE_MODEL_HASHES.audioVae,
    videoVae: SOURCE_MODEL_HASHES.videoVae,
    turboLora: SOURCE_MODEL_HASHES.turboLora,
    additionalModels: {}
  },
  attention: {
    backend: "comfy_native" as const,
    customNodeRevision: "none",
    customNodeSourceHash: "none",
    packageVersion: "none",
    sparsitySettings: {
      enabled: false as const,
      method: "none" as const,
      threshold: 0 as const
    }
  },
  customNodes: [],
  packageVersions: {
    torch: "2.13.0+cu130",
    comfyui: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
  },
  runnerSettings: {
    runnerProfile: "dynamicvram-offload-v1",
    offloadPolicy: "dynamicvram" as const,
    requiresModelOffloading: true,
    maxConcurrentGpuJobs: 1,
    minFreeDiskGb: 20
  },
  expectedCoreRevision: SOURCE_CORE_REVISION,
  expectedPythonExecutable: SOURCE_PYTHON_EXECUTABLE
});

export const SPEC_DIGEST_243F = "da62255eb7245c2cc0ac588325ccd3d3518f5ac93e6e6775a21be5777eeaf0e7";
export const SPEC_DIGEST_362F = "3d9a04081e1aee13dc08df76720ff5576b1c5bc04c047b2752e8af56d1637ddd";

export const SOURCE_ROW_243F: H3CapabilityDecisionRow = deepFreeze({
  specification: SOURCE_SPEC_243F,
  specificationDigest: SPEC_DIGEST_243F,
  speedVerdict: "pass",
  qualityVerdict: "pass",
  overallVerdict: "pass",
  evidenceDigests: ["a4f0df4b421e9e02a9cb1435083acf2e2e370d59e8aa2342909a3f9c96da791e"],
  operatorIdentity: SOURCE_OPERATOR_IDENTITY,
  decidedAt: "2026-10-24T00:00:00.000Z",
  notes:
    "CONDITIONAL GO (rough-draft / preview-only). Known defects: content-dependent dimming, limb corruption, blackout defects."
});

export const SOURCE_ROW_362F: H3CapabilityDecisionRow = deepFreeze({
  specification: SOURCE_SPEC_362F,
  specificationDigest: SPEC_DIGEST_362F,
  speedVerdict: "pass",
  qualityVerdict: "pass",
  overallVerdict: "pass",
  evidenceDigests: ["1c55132c518bddde0f4ded7de69ad2b993159fd732039b3fdcea09c47eeb252c"],
  operatorIdentity: SOURCE_OPERATOR_IDENTITY,
  decidedAt: "2026-10-24T00:00:00.000Z",
  notes:
    "CONDITIONAL GO (rough-draft / preview-only). Boundary candidate for scene ceiling testing. Known defects: content-dependent dimming, backdrop/limb corruption, and continuity/blackout defects. Exceeds MAX_SCENE_DURATION_MS."
});

export const RAW_SOURCE_ENVELOPE = deepFreeze({
  version: 1,
  matrixId: SOURCE_MATRIX_ID,
  rows: [SOURCE_ROW_243F, SOURCE_ROW_362F],
  signedBy: "placeholder-operator-opsclawd",
  signedAt: "2026-10-24T00:00:00.000Z"
});

export const SOURCE_CANONICAL_PAYLOAD = canonicalizeCapabilityMatrixPayload(RAW_SOURCE_ENVELOPE);
export const SOURCE_CONTENT_DIGEST = createHash("sha256")
  .update(SOURCE_CANONICAL_PAYLOAD)
  .digest("hex");

/**
 * Builds an unoptimized baseline I2V workflow graph for the historical 362f sample.
 */
export function buildUnoptimizedI2vWorkflow(frames = 362): Record<string, unknown> {
  return {
    "6": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: "minimax_h3.safetensors",
        weight_dtype: "default"
      }
    },
    "9": {
      class_type: "BasicScheduler",
      inputs: {
        model: ["6", 0],
        scheduler: "simple",
        steps: 20,
        denoise: 1
      }
    },
    "10": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["14", 0],
        vae: ["11", 0]
      }
    },
    "11": {
      class_type: "VAELoader",
      inputs: {
        vae_name: "video_vae.safetensors"
      }
    },
    "13": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "clip.safetensors",
        type: "minimax",
        device: "default"
      }
    },
    "14": {
      class_type: "KSampler",
      inputs: {
        model: ["6", 0],
        seed: 42,
        steps: 20,
        cfg: 1,
        sampler_name: "res_multistep",
        scheduler: "simple",
        positive: ["104", 0],
        negative: ["104", 1],
        latent_image: ["104", 2],
        denoise: 1
      }
    },
    "104": {
      class_type: "MiniMaxH3ImageToVideo",
      inputs: {
        clip: ["13", 0],
        vae: ["11", 0],
        prompt: "historical unoptimized prompt",
        width: 1344,
        height: 768,
        length: frames,
        image: ["20", 0]
      }
    },
    "20": {
      class_type: "LoadImage",
      inputs: {
        image: "start_frame.png",
        upload: "image"
      }
    },
    "92": {
      class_type: "SaveVideo",
      inputs: {
        video: ["10", 0],
        filename_prefix: "H3_I2V_362F_Output"
      }
    }
  };
}

export const HISTORICAL_NO_GO_WORKFLOW = buildUnoptimizedI2vWorkflow(362);
export const HISTORICAL_NO_GO_WORKFLOW_HASH = hashWorkflow(
  JSON.stringify(HISTORICAL_NO_GO_WORKFLOW)
);

/**
 * Historical NO_GO sample: An unoptimized 362f I2V candidate from #423 continuity studies.
 * This has its own distinct specification, unoptimized 20 steps, route "i2v", routingMode "frame_anchored",
 * no turboLora, and distinct digests. Neither later pass rows nor byte probe format validity overturns
 * this visual quality rejection.
 */
export const HISTORICAL_NO_GO_SPEC_362F: H3CandidateExecutionSpecification = deepFreeze({
  version: 1,
  route: "i2v",
  routingMode: "frame_anchored",
  workflowHash: HISTORICAL_NO_GO_WORKFLOW_HASH,
  frames: 362,
  fps: 24,
  width: 1344,
  height: 768,
  sampler: "res_multistep",
  scheduler: "simple",
  steps: 20,
  cfg: 1,
  denoise: 1,
  modelHashes: {
    checkpoint: SOURCE_MODEL_HASHES.checkpoint,
    clip: SOURCE_MODEL_HASHES.clip,
    audioVae: SOURCE_MODEL_HASHES.audioVae,
    videoVae: SOURCE_MODEL_HASHES.videoVae,
    turboLora: "none",
    additionalModels: {}
  },
  attention: {
    backend: "comfy_native" as const,
    customNodeRevision: "none",
    customNodeSourceHash: "none",
    packageVersion: "none",
    sparsitySettings: {
      enabled: false as const,
      method: "none" as const,
      threshold: 0 as const
    }
  },
  customNodes: [],
  packageVersions: {
    torch: "2.13.0+cu130",
    comfyui: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
  },
  runnerSettings: {
    runnerProfile: "dynamicvram-offload-v1",
    offloadPolicy: "dynamicvram" as const,
    requiresModelOffloading: true,
    maxConcurrentGpuJobs: 1,
    minFreeDiskGb: 20
  },
  expectedCoreRevision: SOURCE_CORE_REVISION,
  expectedPythonExecutable: SOURCE_PYTHON_EXECUTABLE
});

export const HISTORICAL_NO_GO_SPEC_DIGEST_362F = computeH3CandidateSpecificationDigest(
  HISTORICAL_NO_GO_SPEC_362F
);

export const HISTORICAL_NO_GO_EVIDENCE_BYTES = Buffer.from(
  JSON.stringify({
    issue: 423,
    scenario: "unoptimized-i2v-362f-continuity-exploration",
    frames: 362,
    fps: 24,
    route: "i2v",
    steps: 20,
    observationBeats: {
      "3.3s": "Start of background collapse",
      "6.7s": "Deepest phase of total blackout window",
      "8.3s": "Lighting and background partial recovery"
    },
    verdict: "NO_GO",
    reason:
      "Severe environmental collapse: background and lighting collapsed into total blackness between ~3.3s and 6.7s."
  }),
  "utf8"
);

export const HISTORICAL_NO_GO_EVIDENCE_DIGEST = createHash("sha256")
  .update(HISTORICAL_NO_GO_EVIDENCE_BYTES)
  .digest("hex");

export const HISTORICAL_NO_GO_ROW_362F: H3CapabilityDecisionRow = deepFreeze({
  specification: HISTORICAL_NO_GO_SPEC_362F,
  specificationDigest: HISTORICAL_NO_GO_SPEC_DIGEST_362F,
  speedVerdict: "pass",
  qualityVerdict: "fail",
  overallVerdict: "fail",
  evidenceDigests: [HISTORICAL_NO_GO_EVIDENCE_DIGEST],
  operatorIdentity: SOURCE_OPERATOR_IDENTITY,
  decidedAt: "2026-10-23T18:00:00.000Z",
  notes:
    "REJECTED: #423 unoptimized I2V 362f variant. Severe limb distortion and backdrop blackout between ~3.3s and 6.7s. Recorded NO_GO visual decision."
});

/**
 * Builds a connected executable Ref2V Turbo-4 graph with model, LoRA loader,
 * reference image conditioning (MiniMaxH3ReferenceToVideo), sampler, and video decode/save nodes.
 */
export function buildConnectedRef2vTurbo4Workflow(frames = 243): Record<string, unknown> {
  return {
    "6": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: "minimax_h3.safetensors",
        weight_dtype: "default"
      }
    },
    "7": {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        model: ["6", 0],
        lora_name: "turbo_lora.safetensors",
        strength_model: 1
      }
    },
    "9": {
      class_type: "BasicScheduler",
      inputs: {
        model: ["7", 0],
        scheduler: "simple",
        steps: 4,
        denoise: 1
      }
    },
    "10": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["14", 0],
        vae: ["11", 0]
      }
    },
    "11": {
      class_type: "VAELoader",
      inputs: {
        vae_name: "video_vae.safetensors"
      }
    },
    "13": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "clip.safetensors",
        type: "minimax",
        device: "default"
      }
    },
    "14": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["15", 0],
        guider: ["16", 0],
        sampler: ["17", 0],
        sigmas: ["9", 0],
        latent_image: ["105", 1]
      }
    },
    "15": {
      class_type: "RandomNoise",
      inputs: {
        noise_seed: 42
      }
    },
    "16": {
      class_type: "BasicGuider",
      inputs: {
        model: ["7", 0],
        conditioning: ["105", 0]
      }
    },
    "17": {
      class_type: "KSamplerSelect",
      inputs: {
        sampler_name: "res_multistep"
      }
    },
    "23": {
      class_type: "VAEDecodeAudio",
      inputs: {
        samples: ["14", 0],
        vae: ["24", 0]
      }
    },
    "24": {
      class_type: "VAELoader",
      inputs: {
        vae_name: "audio_vae.safetensors"
      }
    },
    "91": {
      class_type: "CreateVideo",
      inputs: {
        images: ["10", 0],
        audio: ["23", 0],
        fps: 24
      }
    },
    "92": {
      class_type: "SaveVideo",
      inputs: {
        video: ["91", 0],
        filename_prefix: "H3_Ref2V_Output",
        format: "auto",
        codec: "auto"
      }
    },
    "60": {
      // Required whenever candidate.specification.attention.backend !== "standard"
      // (see validateCandidateGraph's hasAttentionNode check) — SOURCE_SPEC_243F
      // declares backend "comfy_native".
      class_type: "AttentionBackendSelector",
      inputs: {
        attention_backend: "comfy_native"
      }
    },
    "105": {
      class_type: "MiniMaxH3ReferenceToVideo",
      inputs: {
        clip: ["13", 0],
        vae: ["11", 0],
        audio_vae: ["24", 0],
        prompt: "cinematic positive prompt",
        width: 1344,
        height: 768,
        length: frames,
        ref_image_size: "max",
        // MINIMAX_H3_720P_5S_REF2V_V1_INJECTION_TOPOLOGY.referenceImages always
        // declares all 9 reference-image slots (nodes 201-209), regardless of
        // how many are actually bound for a given scene — validateDeclaredTopology
        // checks every declared slot exists in the workflow graph.
        ...Object.fromEntries(
          Array.from({ length: 9 }, (_, slot) => [
            `ref_images.ref_image_${slot}`,
            [String(201 + slot), 0]
          ])
        )
      }
    },
    ...Object.fromEntries(
      Array.from({ length: 9 }, (_, slot) => [
        String(201 + slot),
        {
          class_type: "LoadImage",
          inputs: {
            image: `reference_${slot}.png`,
            upload: "image"
          }
        }
      ])
    )
  };
}

export function createDerivedSimulation243fFixture(): {
  readonly candidate: H3CandidateProfile;
  readonly rawWorkflow: Record<string, unknown>;
  readonly workflowHash: string;
  readonly specificationDigest: string;
  readonly provenanceReport: H3CandidateProvenanceReport;
  readonly evidenceDigest: string;
  readonly evidenceBytes: Buffer;
  readonly decisionRow: H3CapabilityDecisionRow;
  readonly sourceMapping: {
    readonly sourceMatrixId: string;
    readonly sourceSpecificationDigest: string;
    readonly sourceWorkflowHash: string;
    readonly graphTransformation: string;
  };
} {
  const rawWorkflow = buildConnectedRef2vTurbo4Workflow(243);
  const workflowHash = hashWorkflow(JSON.stringify(rawWorkflow));

  const spec: H3CandidateExecutionSpecification = {
    ...SOURCE_SPEC_243F,
    workflowHash
  };

  const specificationDigest = computeH3CandidateSpecificationDigest(spec);
  const key = computeH3CandidateKey(specificationDigest, 1);

  const candidate: H3CandidateProfile = {
    key,
    version: 1,
    specificationDigest,
    specification: spec,
    topology: {
      ...MINIMAX_H3_720P_5S_REF2V_V1_INJECTION_TOPOLOGY,
      referenceImages: MINIMAX_H3_720P_5S_REF2V_V1_INJECTION_TOPOLOGY.referenceImages
        ? [...MINIMAX_H3_720P_5S_REF2V_V1_INJECTION_TOPOLOGY.referenceImages]
        : undefined,
      referenceSlotFields: MINIMAX_H3_720P_5S_REF2V_V1_INJECTION_TOPOLOGY.referenceSlotFields
        ? [...MINIMAX_H3_720P_5S_REF2V_V1_INJECTION_TOPOLOGY.referenceSlotFields]
        : undefined
    },
    status: "candidate"
  };

  const provenanceReport: H3CandidateProvenanceReport = {
    version: 1,
    candidateKey: key,
    generatedAt: "2026-10-24T00:00:00.000Z",
    workflow: {
      relativePath: "workflows/h3_ref2v_turbo4_243f_sim.json",
      sha256: workflowHash
    },
    models: [
      {
        key: "checkpoint",
        relativePath: "models/checkpoints/minimax_h3.safetensors",
        category: "checkpoints",
        sha256: SOURCE_MODEL_HASHES.checkpoint
      },
      {
        key: "clip",
        relativePath: "models/clip/clip.safetensors",
        category: "clip",
        sha256: SOURCE_MODEL_HASHES.clip
      },
      {
        key: "audioVae",
        relativePath: "models/vae/audio_vae.safetensors",
        category: "vae",
        sha256: SOURCE_MODEL_HASHES.audioVae
      },
      {
        key: "videoVae",
        relativePath: "models/vae/video_vae.safetensors",
        category: "vae",
        sha256: SOURCE_MODEL_HASHES.videoVae
      },
      {
        key: "turboLora",
        relativePath: "models/loras/turbo_lora.safetensors",
        category: "loras",
        sha256: SOURCE_MODEL_HASHES.turboLora
      }
    ],
    renderProfileProvenance: {
      candidateKey: key,
      version: 1,
      route: "ref2v",
      routingMode: "reference_directed",
      width: 1344,
      height: 768,
      fps: 24,
      frames: 243,
      steps: 4,
      workflowHash,
      modelHashes: {
        checkpoint: SOURCE_MODEL_HASHES.checkpoint,
        clip: SOURCE_MODEL_HASHES.clip,
        audioVae: SOURCE_MODEL_HASHES.audioVae,
        videoVae: SOURCE_MODEL_HASHES.videoVae,
        turboLora: SOURCE_MODEL_HASHES.turboLora
      },
      optimizerFingerprint: {
        attentionBackend: "comfy_native",
        customNodeRevision: "none",
        customNodeSourceHash: "none",
        packageVersion: "none",
        sparsity: null,
        customNodes: [],
        packageVersions: {
          torch: SOURCE_SPEC_243F.packageVersions["torch"] ?? "2.13.0+cu130",
          comfyui:
            SOURCE_SPEC_243F.packageVersions["comfyui"] ??
            "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
        }
      },
      runnerProfile: "dynamicvram-offload-v1",
      measuredDiskFootprintGb: 15,
      minFreeDiskGb: 20
    },
    observedRuntime: {
      hostname: SOURCE_HOSTNAME,
      gpuUuid: SOURCE_GPU_UUID,
      pid: 1234,
      processStartTimeTicks: 1000,
      pythonExecutable: SOURCE_PYTHON_EXECUTABLE,
      comfyUiCoreRevision: SOURCE_CORE_REVISION,
      commandLineArgs: ["main.py", "--listen"],
      customNodes: {},
      packageVersions: {
        torch: SOURCE_SPEC_243F.packageVersions["torch"] ?? "2.13.0+cu130",
        comfyui:
          SOURCE_SPEC_243F.packageVersions["comfyui"] ?? "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
      },
      observedAt: "2026-10-24T00:00:00.000Z"
    },
    operatorAuthorization: {
      signerKeyId: "test-operator-key-1",
      payloadDigest: "e".repeat(64),
      scope: "staging"
    }
  };

  const evidenceBytes = Buffer.from(
    JSON.stringify({
      scenario: "h3-243f-simulation-test",
      nominalDurationMs: 10125,
      frames: 243,
      fps: 24,
      route: "ref2v"
    }),
    "utf8"
  );
  const evidenceDigest = createHash("sha256").update(evidenceBytes).digest("hex");

  const decisionRow: H3CapabilityDecisionRow = {
    specification: spec,
    specificationDigest,
    speedVerdict: "pass",
    qualityVerdict: "pass",
    overallVerdict: "pass",
    evidenceDigests: [evidenceDigest],
    operatorIdentity: "test-harness",
    decidedAt: "2026-10-24T00:00:00.000Z",
    notes: "Simulation test authorization derived from #445 243f candidate tuple."
  };

  const sourceMapping = {
    sourceMatrixId: SOURCE_MATRIX_ID,
    sourceSpecificationDigest: SPEC_DIGEST_243F,
    sourceWorkflowHash: SOURCE_SPEC_243F.workflowHash,
    graphTransformation: "connected_ref2va_turbo4_with_lora_and_sampler_pipeline"
  };

  return {
    candidate,
    rawWorkflow,
    workflowHash,
    specificationDigest,
    provenanceReport,
    evidenceDigest,
    evidenceBytes,
    decisionRow,
    sourceMapping
  };
}

export function generateTestOperatorKeyPair(): {
  readonly publicKey: KeyObject;
  readonly publicKeyPem: string;
  readonly privateKey: KeyObject;
} {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  return { publicKey, publicKeyPem, privateKey };
}

export interface CreateSignedTestCapabilityEnvelopeOptions {
  readonly rows: readonly H3CapabilityDecisionRow[];
  readonly privateKey: KeyObject;
  readonly signedBy?: string;
  readonly matrixId?: string;
}

export function createSignedTestCapabilityEnvelope(
  optionsOrRows: CreateSignedTestCapabilityEnvelopeOptions | readonly H3CapabilityDecisionRow[],
  legacyPrivateKey?: KeyObject,
  legacySignedBy = "operator-opsclawd",
  legacyMatrixId = SOURCE_MATRIX_ID
): H3CapabilityMatrixEnvelope {
  let rows: readonly H3CapabilityDecisionRow[];
  let privateKey: KeyObject;
  let signedBy: string;
  let matrixId: string;

  if (Array.isArray(optionsOrRows)) {
    rows = optionsOrRows;
    privateKey = legacyPrivateKey!;
    signedBy = legacySignedBy;
    matrixId = legacyMatrixId;
  } else {
    const opts = optionsOrRows as CreateSignedTestCapabilityEnvelopeOptions;
    rows = opts.rows;
    privateKey = opts.privateKey;
    signedBy = opts.signedBy ?? "operator-opsclawd";
    matrixId = opts.matrixId ?? SOURCE_MATRIX_ID;
  }

  const envelopeWithoutSig: Omit<H3CapabilityMatrixEnvelope, "signatureHex"> = {
    version: 1,
    matrixId,
    rows: [...rows],
    signedBy,
    signedAt: "2026-10-24T00:00:00.000Z"
  };

  const canonical = canonicalizeCapabilityMatrixPayload(envelopeWithoutSig);
  const signatureHex = sign(null, Buffer.from(canonical, "utf8"), privateKey).toString("hex");

  return {
    ...envelopeWithoutSig,
    signatureHex
  };
}

export interface CreateSignedTestCandidateGrantOptions {
  readonly candidate: H3CandidateProfile;
  readonly privateKey: KeyObject;
  readonly signerKeyId?: string;
  readonly purpose?: "staging" | "production";
  readonly scope?: "staging" | "production";
}

export function createSignedTestCandidateGrant(
  optionsOrKey: CreateSignedTestCandidateGrantOptions | string,
  legacySpecDigest?: string,
  legacyWorkflowHash?: string,
  legacyModelHashesDigest?: string,
  legacyPrivateKey?: KeyObject,
  legacySignerKeyId = "test-operator-key-1",
  legacyPurpose: "staging" | "production" = "staging",
  legacyScope: "staging" | "production" = "staging"
): H3CandidateAuthorizationGrant {
  let candidateKey: string;
  let specificationDigest: string;
  let workflowHash: string;
  let modelHashesDigest: string;
  let privateKey: KeyObject;
  let signerKeyId: string;
  let purpose: "staging" | "production";
  let scope: "staging" | "production";

  if (typeof optionsOrKey === "object") {
    candidateKey = optionsOrKey.candidate.key;
    specificationDigest = optionsOrKey.candidate.specificationDigest;
    workflowHash = optionsOrKey.candidate.specification.workflowHash;
    modelHashesDigest = computeModelHashesDigest(optionsOrKey.candidate.specification.modelHashes);
    privateKey = optionsOrKey.privateKey;
    signerKeyId = optionsOrKey.signerKeyId ?? "test-operator-key-1";
    purpose = optionsOrKey.purpose ?? "staging";
    scope = optionsOrKey.scope ?? "staging";
  } else {
    candidateKey = optionsOrKey;
    specificationDigest = legacySpecDigest!;
    workflowHash = legacyWorkflowHash!;
    modelHashesDigest = legacyModelHashesDigest!;
    privateKey = legacyPrivateKey!;
    signerKeyId = legacySignerKeyId;
    purpose = legacyPurpose;
    scope = legacyScope;
  }

  const payload: H3CandidateAuthorizationPayload = {
    version: 1,
    candidateKey,
    specificationDigest,
    goldMasterWorkflowHash: workflowHash,
    goldMasterModelHashesDigest: modelHashesDigest,
    targetHostname: SOURCE_HOSTNAME,
    targetGpuUuid: SOURCE_GPU_UUID,
    purpose,
    scope,
    issuedAt: "2026-10-24T00:00:00.000Z",
    expiresAt: "2026-10-25T00:00:00.000Z",
    operatorId: "operator-opsclawd"
  };

  const canonical = canonicalizeAuthorizationPayload(payload);
  const signature = sign(null, Buffer.from(canonical, "utf8"), privateKey).toString("hex");

  return {
    signerKeyId,
    payload,
    signature
  };
}
