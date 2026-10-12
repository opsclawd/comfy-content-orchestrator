import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  DEFAULT_MINIMAX_H3_EXPERIMENT_TIMEOUTS,
  getMinimaxH3FrameDurationInfo,
  MinimaxH3ExperimentDescriptorSchema,
  MinimaxH3ExperimentResultSchema,
  MinimaxH3StopPolicySchema,
  MinimaxH3VisualReviewSidecarSchema,
  validateMinimaxH3ExperimentFrameCount,
  createEmptyMinimaxH3MeasurementTemplate,
  computeDescriptorDigest,
  computeComparisonKey,
  type MinimaxH3ExperimentDescriptor,
  type MinimaxH3ExperimentIntent,
  type MinimaxH3ExperimentReceipt,
  type MinimaxH3ExperimentResult,
  type MinimaxH3ProcessRecord,
  type MinimaxH3ReferenceDescriptor,
  type MinimaxH3TerminalEvidence
} from "@cco/contracts";
import type {
  MinimaxH3ComfyUiTransportPort,
  MinimaxH3ExperimentStorePort,
  MinimaxH3OutputProberPort,
  MinimaxH3OwnedProcess,
  MinimaxH3ProcessRunnerPort,
  MinimaxH3TargetPreflightPort,
  MinimaxH3TelemetrySamplerPort,
  PrepareMinimaxH3ExperimentOptions
} from "../ports/minimax-h3-experiment-ports.js";
import {
  analyzeStartupDiagnostics,
  PINNED_COMFYUI_CORE_REVISION,
  PINNED_COMFYUI_SOURCE_HASHES,
  validateRunnerVariantAndArgv
} from "./minimax-h3-cli-parser-semantics.js";

function sortKeysRecursively(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysRecursively);
  }
  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const sortedObject: Record<string, unknown> = Object.create(null);
  for (const key of sortedKeys) {
    sortedObject[key] = sortKeysRecursively(record[key]);
  }
  return sortedObject;
}

export function canonicalizeJson(value: unknown): string {
  const sorted = sortKeysRecursively(value);
  return JSON.stringify(sorted);
}

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export { computeComparisonKey };

export const SUPPORTED_RESOLUTION_VARIANTS: Record<string, { width: number; height: number }> = {
  "720p": { width: 1280, height: 720 },
  "576p": { width: 1024, height: 576 },
  "512p": { width: 896, height: 512 }
};

const FORBIDDEN_OUTPUT_PATH_SUBSTRINGS = ["certification/", "baseline/", "config/render-profiles/"];

export function assertSafeOutputPath(path: string, outputRoot: string): void {
  for (const forbidden of FORBIDDEN_OUTPUT_PATH_SUBSTRINGS) {
    if (path.includes(forbidden)) {
      throw new Error(
        `Path "${path}" violates governance rules: cannot write to forbidden directory "${forbidden}".`
      );
    }
  }
  if (!path.startsWith(outputRoot)) {
    throw new Error(
      `Path "${path}" escapes the designated experiment output root "${outputRoot}".`
    );
  }
}

export function findRepositoryRoot(startDir: string = process.cwd()): string {
  let curr = resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(curr, "pnpm-workspace.yaml"))) {
      return curr;
    }
    const parent = dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return resolve(startDir);
}

export function resolveProfilePath(baseProfileKey: string): string {
  const repoRoot = findRepositoryRoot();
  const searchRoots = [process.cwd()];
  if (process.env.INIT_CWD && !searchRoots.includes(process.env.INIT_CWD)) {
    searchRoots.push(process.env.INIT_CWD);
  }
  if (!searchRoots.includes(repoRoot)) {
    searchRoots.push(repoRoot);
  }
  for (const root of searchRoots) {
    let curr = root;
    for (let i = 0; i < 6; i++) {
      const candidate = resolve(curr, "config/render-profiles", `${baseProfileKey}.json`);
      if (existsSync(candidate)) {
        return candidate;
      }
      const parent = dirname(curr);
      if (parent === curr) break;
      curr = parent;
    }
  }
  return resolve(repoRoot, "config/render-profiles", `${baseProfileKey}.json`);
}

export function resolveTemplatesDir(configured?: string): string {
  if (configured && existsSync(configured) && existsSync(join(configured, "provenance.json"))) {
    return resolve(configured);
  }
  const repoRoot = findRepositoryRoot();
  const searchRoots = [process.cwd()];
  if (process.env.INIT_CWD && !searchRoots.includes(process.env.INIT_CWD)) {
    searchRoots.push(process.env.INIT_CWD);
  }
  if (!searchRoots.includes(repoRoot)) {
    searchRoots.push(repoRoot);
  }
  for (const root of searchRoots) {
    let curr = root;
    for (let i = 0; i < 6; i++) {
      const candidate = resolve(curr, configured ?? "templates");
      if (existsSync(candidate) && existsSync(join(candidate, "provenance.json"))) {
        return candidate;
      }
      const parent = dirname(curr);
      if (parent === curr) break;
      curr = parent;
    }
  }
  return resolve(repoRoot, configured ?? "templates");
}

export function deriveExperimentGraph({
  baseWorkflow,
  route,
  runId,
  seed,
  frames,
  width,
  height,
  prompt,
  references
}: {
  baseWorkflow: Record<string, unknown>;
  route: "i2v" | "ref2v";
  runId: string;
  seed: number;
  frames: number;
  width: number;
  height: number;
  prompt: string;
  references: readonly MinimaxH3ReferenceDescriptor[];
}): Record<string, unknown> {
  interface ComfyNode {
    inputs?: Record<string, unknown>;
    [key: string]: unknown;
  }
  const derivedGraph: Record<string, ComfyNode> = JSON.parse(JSON.stringify(baseWorkflow));

  // 1. SaveVideo run-local prefix (node 92)
  const saveVideoNodeId = "92";
  if (derivedGraph[saveVideoNodeId]?.inputs) {
    derivedGraph[saveVideoNodeId].inputs.filename_prefix = `minimax_h3_${route}_${runId}`;
  }

  // 2. RandomNoise seed (node 15)
  const randomNoiseNodeId = "15";
  if (derivedGraph[randomNoiseNodeId]?.inputs) {
    derivedGraph[randomNoiseNodeId].inputs.noise_seed = seed;
  }

  // 3. Route-specific wiring
  if (route === "i2v") {
    const i2vNodeId = "104";
    if (derivedGraph[i2vNodeId]?.inputs) {
      derivedGraph[i2vNodeId].inputs.length = frames;
      derivedGraph[i2vNodeId].inputs.width = width;
      derivedGraph[i2vNodeId].inputs.height = height;
      derivedGraph[i2vNodeId].inputs.prompt = prompt;
    }
    const loadImageNodeId = "20";
    if (derivedGraph[loadImageNodeId]?.inputs && references[0]) {
      derivedGraph[loadImageNodeId].inputs.image = references[0].stagedFilename;
    }
  } else {
    const ref2vNodeId = "105";
    const N = references.length;
    if (derivedGraph[ref2vNodeId]?.inputs) {
      derivedGraph[ref2vNodeId].inputs.length = frames;
      derivedGraph[ref2vNodeId].inputs.width = width;
      derivedGraph[ref2vNodeId].inputs.height = height;
      derivedGraph[ref2vNodeId].inputs.prompt = prompt;
      derivedGraph[ref2vNodeId].inputs.ref_image_size = N > 0 ? "max" : "match";

      for (let i = 0; i < N; i++) {
        const loadNodeId = String(201 + i);
        if (derivedGraph[loadNodeId]?.inputs) {
          derivedGraph[loadNodeId].inputs.image = references[i]!.stagedFilename;
        }
        derivedGraph[ref2vNodeId].inputs[`ref_images.ref_image_${i}`] = [loadNodeId, 0];
      }

      for (let i = N; i < 9; i++) {
        const unusedLoadNodeId = String(201 + i);
        delete derivedGraph[unusedLoadNodeId];
        delete derivedGraph[ref2vNodeId].inputs[`ref_images.ref_image_${i}`];
      }
    }
  }

  return derivedGraph;
}

export class MinimaxH3ExperimentService {
  constructor(
    private readonly store: MinimaxH3ExperimentStorePort,
    private readonly preflight?: MinimaxH3TargetPreflightPort,
    private readonly runner?: MinimaxH3ProcessRunnerPort,
    private readonly transport?: MinimaxH3ComfyUiTransportPort,
    private readonly telemetry?: MinimaxH3TelemetrySamplerPort,
    private readonly prober?: MinimaxH3OutputProberPort
  ) {}

  async prepareExperiment(
    options: PrepareMinimaxH3ExperimentOptions
  ): Promise<{ descriptor: MinimaxH3ExperimentDescriptor; runDir: string }> {
    const {
      route,
      frames,
      seed,
      prompt,
      operatorLabel,
      runId,
      outputRoot,
      targetHost,
      gpuUuid,
      comfyUiDir,
      pythonPath,
      address = "127.0.0.1",
      port = 8199,
      width = 1344,
      height = 768,
      runnerVariant = "dynamicvram-offload-v1",
      variantReason = null,
      inputManifestPath,
      requestedDurationMs
    } = options;

    const validatedFrames = validateMinimaxH3ExperimentFrameCount(frames);
    const durationInfo = getMinimaxH3FrameDurationInfo(validatedFrames);

    const isNonDefaultGeometry = width !== 1344 || height !== 768;
    if (isNonDefaultGeometry) {
      const matchingVariant = Object.entries(SUPPORTED_RESOLUTION_VARIANTS).find(
        ([, dims]) => dims.width === width && dims.height === height
      );
      if (!matchingVariant) {
        throw new Error(
          `Non-default resolution (${width}x${height}) is not a supported named resolution variant. Supported variants: 720p (1280x720), 576p (1024x576), 512p (896x512).`
        );
      }
      if (!variantReason || variantReason.trim().length === 0) {
        throw new Error(
          `Non-default resolution variant "${matchingVariant[0]}" (${width}x${height}) requires an explicit operator --variant-reason.`
        );
      }
    }

    const { requestedPolicy, generatedArgv, predictedPolicy } = validateRunnerVariantAndArgv({
      variantName: runnerVariant,
      variantReason
    });

    const runDir = `${outputRoot}/${runId}`;
    assertSafeOutputPath(runDir, outputRoot);

    // Exclusive run directory creation (fails if runDir already exists)
    await this.store.createRunDirectory(runDir);

    // Read templates & base files
    const templatesDir = resolveTemplatesDir(options.templatesDir);
    const templateFileName =
      route === "i2v" ? "minimax_h3_720p_i2v_124f_api.json" : "minimax_h3_720p_ref2v_124f_api.json";
    const templateFilePath = `${templatesDir}/${templateFileName}`;
    const baseWorkflowRaw = await this.store.readTextFile(templateFilePath);
    const baseWorkflowParsed = JSON.parse(baseWorkflowRaw) as Record<string, unknown>;
    const baseCanonicalWorkflowDigest = sha256Hex(canonicalizeJson(baseWorkflowParsed));

    // Read provenance manifest
    const provenanceManifestPath = `${templatesDir}/provenance.json`;
    const provenanceRaw = await this.store.readTextFile(provenanceManifestPath);
    const provenanceDigest = sha256Hex(provenanceRaw);
    const provenanceSource =
      route === "i2v" ? ("authored_from_spec" as const) : ("validated_host_export" as const);

    try {
      const provenanceParsed = JSON.parse(provenanceRaw) as {
        profiles?: Array<{ workflowRelativePath?: string; expectedWorkflowHash?: string }>;
      };
      const matchingProfile = provenanceParsed.profiles?.find(
        (p) => p.workflowRelativePath === templateFileName
      );
      if (matchingProfile?.expectedWorkflowHash) {
        if (baseCanonicalWorkflowDigest !== matchingProfile.expectedWorkflowHash) {
          throw new Error(
            `Base template ${templateFileName} canonical hash (${baseCanonicalWorkflowDigest}) does not match provenance expectedWorkflowHash (${matchingProfile.expectedWorkflowHash})`
          );
        }
      }
    } catch (err) {
      if ((err as Error).message.includes("does not match provenance expectedWorkflowHash")) {
        throw err;
      }
    }

    // Read input manifest
    const resolvedInputManifestPath = inputManifestPath;
    const inputManifest = (await this.store.readJsonFile(resolvedInputManifestPath)) as {
      referenceSetId?: string;
      references?: Array<{
        assetPath: string;
        stagedFilename: string;
        role?: string;
        tag?: string;
        order?: number;
      }>;
    };

    const referenceSetId = inputManifest.referenceSetId ?? "default-ref-set";
    const rawRefs = inputManifest.references ?? [];

    if (route === "i2v") {
      if (rawRefs.length !== 1) {
        throw new Error(
          `Route "i2v" requires exactly 1 input reference image, received ${rawRefs.length}.`
        );
      }
    } else {
      if (rawRefs.length > 9) {
        throw new Error(
          `Route "ref2v" accepts at most 9 reference images, received ${rawRefs.length}.`
        );
      }
      if (rawRefs.length === 0 && runnerVariant === "dynamicvram-offload-v1") {
        throw new Error(
          `Route "ref2v" with N=0 references is allowed only as an explicit variant with --variant-reason.`
        );
      }
    }

    // Validate staged filenames: unique, no directory traversal
    const stagedFilenames = new Set<string>();
    for (const ref of rawRefs) {
      const name = ref.stagedFilename;
      if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
        throw new Error(
          `Invalid staged filename "${name}". Must be a simple basename without path separators or traversal.`
        );
      }
      if (stagedFilenames.has(name)) {
        throw new Error(
          `Duplicate staged filename "${name}" detected in input manifest references.`
        );
      }
      stagedFilenames.add(name);
    }

    const manifestDir = dirname(resolvedInputManifestPath);
    const processedReferences: MinimaxH3ReferenceDescriptor[] = [];
    for (let i = 0; i < rawRefs.length; i++) {
      const ref = rawRefs[i]!;
      const expectedTag = `<Picture ${i + 1}>`;
      if (ref.tag && ref.tag !== expectedTag) {
        throw new Error(
          `Reference at index ${i} has invalid tag "${ref.tag}". Expected "${expectedTag}".`
        );
      }
      if (ref.order !== undefined && ref.order !== i) {
        throw new Error(`Reference at index ${i} has invalid order ${ref.order}. Expected ${i}.`);
      }
      const expectedRole = route === "i2v" ? "first_frame" : (ref.role ?? "reference");
      if (route === "i2v" && ref.role && ref.role !== "first_frame") {
        throw new Error(
          `Route "i2v" reference at index ${i} must have role "first_frame", got "${ref.role}".`
        );
      }
      const resolvedAsset = resolve(
        !ref.assetPath.startsWith("/") ? resolve(manifestDir, ref.assetPath) : ref.assetPath
      );
      const hashInfo = await this.store.hashFile(resolvedAsset);
      const assetInspection = await this.store.inspectAsset(resolvedAsset);
      processedReferences.push({
        slotIndex: i,
        role: ref.role ?? expectedRole,
        tag: ref.tag ?? expectedTag,
        order: ref.order ?? i,
        assetPath: resolvedAsset,
        stagedFilename: ref.stagedFilename,
        sha256: hashInfo.sha256,
        width: assetInspection.width,
        height: assetInspection.height,
        mimeType: assetInspection.mimeType
      });
    }

    // Aspect ratio check for I2V first frame based on actual inspected dimensions
    if (route === "i2v" && processedReferences.length === 1) {
      const firstRef = processedReferences[0]!;
      const canvasRatio = width / height;
      const refRatio = firstRef.width / firstRef.height;
      const deviation = Math.abs(refRatio - canvasRatio) / canvasRatio;
      if (deviation > 0.05) {
        throw new Error(
          `First-frame aspect ratio (${refRatio.toFixed(3)}) deviates by ${(deviation * 100).toFixed(1)}% from canvas aspect ratio (${canvasRatio.toFixed(3)}), exceeding 5% limit.`
        );
      }
    }

    // Ref2V tag check: prompt must not refer to absent slots
    if (route === "ref2v") {
      const tagMatches = prompt.match(/<Picture \d+>/g) || [];
      for (const t of tagMatches) {
        const slotNum = parseInt(t.replace(/<Picture |>/g, ""), 10);
        if (slotNum < 1 || slotNum > processedReferences.length) {
          throw new Error(
            `Prompt references tag "${t}" but only ${processedReferences.length} reference images were supplied.`
          );
        }
      }
    }

    // Derive deterministic workflow graph
    const derivedGraph = deriveExperimentGraph({
      baseWorkflow: baseWorkflowParsed,
      route,
      runId,
      seed,
      frames: validatedFrames,
      width,
      height,
      prompt,
      references: processedReferences
    });

    const derivedWorkflowCanonical = canonicalizeJson(derivedGraph);
    const derivedWorkflowDigest = sha256Hex(derivedWorkflowCanonical);
    const configDigest = derivedWorkflowDigest;

    const promptDigest = sha256Hex(prompt);
    const comparisonKey = computeComparisonKey({
      route,
      frames: validatedFrames,
      requestedDurationMs: requestedDurationMs ?? durationInfo.configuredDurationMs,
      width,
      height,
      promptDigest,
      seed,
      references: processedReferences.map((r) => ({
        slotIndex: r.slotIndex,
        role: r.role,
        tag: r.tag,
        order: r.order,
        sha256: r.sha256
      })),
      referenceHashes: processedReferences.map((r) => r.sha256),
      runnerVariant,
      memoryPolicy: requestedPolicy,
      modelDigests: {
        "diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors":
          "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
        "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors":
          "35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6",
        "vae/minimax_h3_video_vae_int8_convrot.safetensors":
          "52a2c8c73583c86e4f41cdcce3a6ad0ea562987bc0bf3d60a0cef5f5c8e60c0e",
        "vae/minimax_h3_audio_vae_fp32.safetensors":
          "8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48"
      },
      target: {
        hostname: targetHost,
        gpuUuid
      }
    });

    const baseProfileKey =
      route === "i2v"
        ? ("MINIMAX_H3_720P_5S_I2V_V1" as const)
        : ("MINIMAX_H3_720P_5S_REF2V_V1" as const);
    const profilePath = resolveProfilePath(baseProfileKey);
    if (!existsSync(profilePath)) {
      throw new Error(`Base profile file not found at ${profilePath}`);
    }
    let profileRaw: string;
    try {
      profileRaw = await this.store.readTextFile(profilePath);
    } catch {
      profileRaw = await readFile(profilePath, "utf8");
    }
    const baseProfileFileDigest = sha256Hex(profileRaw);

    const descriptorWithoutDigest = {
      schemaVersion: 1 as const,
      kind: "non-production-experiment" as const,
      runId,
      operatorLabel,
      route,
      configuredFrames: validatedFrames,
      fps: 24 as const,
      requestedDurationMs: requestedDurationMs ?? durationInfo.configuredDurationMs,
      requestedDurationSupplied: requestedDurationMs !== undefined,
      configuredDurationMs: durationInfo.configuredDurationMs,
      width,
      height,
      seed,
      prompt,
      promptDigest,
      baseProfileKey,
      baseProfileVersion: 1 as const,
      baseProfileFileDigest,
      provenanceManifestDigest: provenanceDigest,
      provenanceSource,
      baseCanonicalWorkflowDigest,
      derivedWorkflowDigest,
      pinFileIdentities: {
        comfyuiCoreRevision: PINNED_COMFYUI_CORE_REVISION,
        minimaxH3Revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1",
        modelDigests: {
          "diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors":
            "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
          "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors":
            "35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6",
          "vae/minimax_h3_video_vae_int8_convrot.safetensors":
            "52a2c8c73583c86e4f41cdcce3a6ad0ea562987bc0bf3d60a0cef5f5c8e60c0e",
          "vae/minimax_h3_audio_vae_fp32.safetensors":
            "8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48"
        }
      },
      resolvedModelPaths: {
        "diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors": {
          expectedHash: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
          resolvedPath: `${comfyUiDir}/models/diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors`,
          sizeBytes: 20970379616
        },
        "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors": {
          expectedHash: "35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6",
          resolvedPath: `${comfyUiDir}/models/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`,
          sizeBytes: 15687142551
        },
        "vae/minimax_h3_video_vae_int8_convrot.safetensors": {
          expectedHash: "52a2c8c73583c86e4f41cdcce3a6ad0ea562987bc0bf3d60a0cef5f5c8e60c0e",
          resolvedPath: `${comfyUiDir}/models/vae/minimax_h3_video_vae_int8_convrot.safetensors`,
          sizeBytes: 2811065184
        },
        "vae/minimax_h3_audio_vae_fp32.safetensors": {
          expectedHash: "8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48",
          resolvedPath: `${comfyUiDir}/models/vae/minimax_h3_audio_vae_fp32.safetensors`,
          sizeBytes: 605254808
        }
      },
      referenceSetId,
      references: processedReferences,
      refImageSize:
        route === "ref2v"
          ? rawRefs.length > 0
            ? ("max" as const)
            : ("match" as const)
          : undefined,
      requestedRunner: {
        variantName: runnerVariant,
        variantReason,
        memoryPolicy: requestedPolicy,
        offloadSettings: {
          modelOffload: true
        }
      },
      configuredRunner: {
        argv: generatedArgv as string[],
        env: {
          CUDA_VISIBLE_DEVICES: gpuUuid
        },
        predictedPolicy,
        pinnedSourceIdentities: PINNED_COMFYUI_SOURCE_HASHES
      },
      target: {
        hostname: targetHost,
        gpuUuid,
        comfyUiDir,
        pythonPath,
        address,
        port
      },
      collectionIntervalMs: 1000,
      timeouts: DEFAULT_MINIMAX_H3_EXPERIMENT_TIMEOUTS,
      configDigest,
      comparisonKey
    };

    const descriptorDigest = computeDescriptorDigest(
      descriptorWithoutDigest as Record<string, unknown>
    );
    const descriptor: MinimaxH3ExperimentDescriptor = {
      ...descriptorWithoutDigest,
      descriptorDigest
    };

    // Validate descriptor schema
    MinimaxH3ExperimentDescriptorSchema.parse(descriptor);

    // Persist records
    await this.store.writeDescriptor(runDir, descriptor);
    await this.store.writeConfig(runDir, derivedGraph);
    await this.store.writeInputManifest(runDir, inputManifest);
    const template = createEmptyMinimaxH3MeasurementTemplate(descriptor);
    await this.store.writeMeasurementTemplate(runDir, template);

    // Stage inputs
    for (const ref of processedReferences) {
      await this.store.stageInputFile(ref.assetPath, `${runDir}/inputs/${ref.stagedFilename}`);
    }

    return { descriptor, runDir };
  }

  async validateExperiment(
    runDir: string,
    options?: { templatesDir?: string; outputRoot?: string }
  ): Promise<
    | {
        ok: true;
        descriptor: MinimaxH3ExperimentDescriptor;
        errors: string[];
        validatedGraph: Record<string, unknown>;
      }
    | {
        ok: false;
        descriptor?: MinimaxH3ExperimentDescriptor;
        errors: string[];
        validatedGraph?: Record<string, unknown>;
      }
  > {
    const errors: string[] = [];
    const outputRoot = options?.outputRoot ?? ".ai-runs/minimax-h3-experiments";
    assertSafeOutputPath(runDir, outputRoot);

    let descriptor: MinimaxH3ExperimentDescriptor;
    try {
      descriptor = await this.store.readDescriptor(runDir);
      MinimaxH3ExperimentDescriptorSchema.parse(descriptor);
    } catch (err) {
      return {
        ok: false,
        errors: [`Descriptor validation failed: ${(err as Error).message}`]
      };
    }

    let config: Record<string, unknown>;
    try {
      config = await this.store.readConfig(runDir);
    } catch (err) {
      return {
        ok: false,
        descriptor,
        errors: [`Config read failed: ${(err as Error).message}`]
      };
    }

    // Verify config canonical digest matches descriptor
    const actualConfigDigest = sha256Hex(canonicalizeJson(config));
    if (actualConfigDigest !== descriptor.configDigest) {
      errors.push(
        `Config digest mismatch: expected ${descriptor.configDigest}, got ${actualConfigDigest}`
      );
    }
    if (actualConfigDigest !== descriptor.derivedWorkflowDigest) {
      errors.push(
        `Derived workflow digest mismatch: expected ${descriptor.derivedWorkflowDigest}, got ${actualConfigDigest}`
      );
    }

    // Verify SaveVideo prefix
    const saveVideoNode = config["92"] as { inputs?: { filename_prefix?: string } } | undefined;
    const expectedPrefix = `minimax_h3_${descriptor.route}_${descriptor.runId}`;
    if (saveVideoNode?.inputs?.filename_prefix !== expectedPrefix) {
      errors.push(
        `SaveVideo prefix tampered: expected "${expectedPrefix}", got "${String(saveVideoNode?.inputs?.filename_prefix)}"`
      );
    }

    // Reconstruct expected graph from base template and verify full equality
    const templatesDir = resolveTemplatesDir(options?.templatesDir);
    const templateFileName =
      descriptor.route === "i2v"
        ? "minimax_h3_720p_i2v_124f_api.json"
        : "minimax_h3_720p_ref2v_124f_api.json";
    const templateFilePath = `${templatesDir}/${templateFileName}`;

    let expectedGraph: Record<string, unknown> | undefined;
    try {
      const baseWorkflowRaw = await this.store.readTextFile(templateFilePath);
      const baseWorkflowParsed = JSON.parse(baseWorkflowRaw) as Record<string, unknown>;
      const baseCanonical = sha256Hex(canonicalizeJson(baseWorkflowParsed));
      if (baseCanonical !== descriptor.baseCanonicalWorkflowDigest) {
        errors.push(
          `Base workflow digest mismatch: expected ${descriptor.baseCanonicalWorkflowDigest}, got ${baseCanonical}`
        );
      }

      expectedGraph = deriveExperimentGraph({
        baseWorkflow: baseWorkflowParsed,
        route: descriptor.route,
        runId: descriptor.runId,
        seed: descriptor.seed,
        frames: descriptor.configuredFrames,
        width: descriptor.width,
        height: descriptor.height,
        prompt: descriptor.prompt,
        references: descriptor.references
      });

      const expectedCanonical = canonicalizeJson(expectedGraph);
      const actualCanonical = canonicalizeJson(config);
      if (expectedCanonical !== actualCanonical) {
        errors.push(
          "Config.json on disk does not match the reconstructed workflow graph derived from base template and descriptor."
        );
      }
    } catch (err) {
      errors.push(
        `Failed to verify base workflow template or reconstruct graph: ${(err as Error).message}`
      );
    }

    // Verify staged input assets
    for (const ref of descriptor.references) {
      const stagedPath = `${runDir}/inputs/${ref.stagedFilename}`;
      try {
        const hashInfo = await this.store.hashFile(stagedPath);
        if (hashInfo.sha256 !== ref.sha256) {
          errors.push(
            `Staged asset hash mismatch for "${ref.stagedFilename}": expected ${ref.sha256}, got ${hashInfo.sha256}`
          );
        }
        const inspected = await this.store.inspectAsset(stagedPath);
        if (inspected.width !== ref.width || inspected.height !== ref.height) {
          errors.push(
            `Staged asset dimension mismatch for "${ref.stagedFilename}": expected ${ref.width}x${ref.height}, got ${inspected.width}x${inspected.height}`
          );
        }
        if (inspected.mimeType !== ref.mimeType) {
          errors.push(
            `Staged asset MIME mismatch for "${ref.stagedFilename}": expected "${ref.mimeType}", got "${inspected.mimeType}"`
          );
        }
      } catch (err) {
        errors.push(
          `Staged asset "${ref.stagedFilename}" missing or unreadable: ${(err as Error).message}`
        );
      }
    }

    // Cross-check input-manifest.json
    try {
      const inputManifest = (await this.store.readInputManifest(runDir)) as {
        referenceSetId?: string;
        references?: Array<{ assetPath: string; stagedFilename: string }>;
      };
      if (!inputManifest) {
        errors.push("input-manifest.json missing from run directory");
      } else {
        const refs = inputManifest.references ?? [];
        if (refs.length !== descriptor.references.length) {
          errors.push(
            `Input manifest reference count mismatch: expected ${descriptor.references.length}, got ${refs.length}`
          );
        }
        for (let i = 0; i < Math.min(refs.length, descriptor.references.length); i++) {
          if (refs[i]?.stagedFilename !== descriptor.references[i]?.stagedFilename) {
            errors.push(
              `Input manifest reference ${i} stagedFilename mismatch: expected "${descriptor.references[i]?.stagedFilename}", got "${refs[i]?.stagedFilename}"`
            );
          }
        }
      }
    } catch (err) {
      errors.push(`Failed to read input-manifest.json: ${(err as Error).message}`);
    }

    // Verify measurement template
    try {
      const measurementTemplate = await this.store.readMeasurementTemplate(runDir);
      if (!measurementTemplate) {
        errors.push("measurement-template.json missing from run directory");
      } else {
        MinimaxH3ExperimentResultSchema.parse(measurementTemplate);
        if (measurementTemplate.runId !== descriptor.runId) {
          errors.push(
            `Measurement template runId mismatch: expected "${descriptor.runId}", got "${measurementTemplate.runId}"`
          );
        }
        const expectedDescDigest =
          descriptor.descriptorDigest ??
          computeDescriptorDigest(descriptor as unknown as Record<string, unknown>);
        if (measurementTemplate.descriptorDigest !== expectedDescDigest) {
          errors.push(
            `Measurement template descriptorDigest mismatch: expected "${expectedDescDigest}", got "${measurementTemplate.descriptorDigest}"`
          );
        }
        if (measurementTemplate.execution.status !== "not_started") {
          errors.push("measurement-template.json must have execution status 'not_started'");
        }
        if (
          measurementTemplate.observedRunner.pid !== null ||
          measurementTemplate.observedRunner.effectiveMode.status !== "unknown" ||
          measurementTemplate.observedRunner.effectiveMode.value !== null ||
          measurementTemplate.collection.status !== "not_started" ||
          measurementTemplate.collection.sampleCount.attempted !== 0 ||
          measurementTemplate.collection.metrics.gpuPeakUsedVramMb !== null ||
          measurementTemplate.probe.status !== "not_started" ||
          measurementTemplate.probe.outputFile !== null ||
          measurementTemplate.probe.outputSha256 !== null ||
          measurementTemplate.outputConformance.status !== "unknown"
        ) {
          errors.push(
            "Measurement template must be blank and unpopulated (dry-run requires zero readings and unstarted probes)"
          );
        }
      }
    } catch (err) {
      errors.push(`Invalid measurement-template.json: ${(err as Error).message}`);
    }

    // Verify runner policy flags
    try {
      validateRunnerVariantAndArgv({
        variantName: descriptor.requestedRunner.variantName,
        variantReason: descriptor.requestedRunner.variantReason,
        customArgv: descriptor.configuredRunner.argv
      });
    } catch (err) {
      errors.push(`Runner configuration invalid: ${(err as Error).message}`);
    }

    // Verify provenance manifest and base template hash
    const provenanceManifestPath = `${templatesDir}/provenance.json`;
    try {
      const provenanceRaw = await this.store.readTextFile(provenanceManifestPath);
      const provenanceDigest = sha256Hex(provenanceRaw);
      if (provenanceDigest !== descriptor.provenanceManifestDigest) {
        errors.push(
          `Provenance manifest digest mismatch: expected ${descriptor.provenanceManifestDigest}, got ${provenanceDigest}`
        );
      }
      const provenanceParsed = JSON.parse(provenanceRaw) as {
        profiles?: Array<{ workflowRelativePath?: string; expectedWorkflowHash?: string }>;
      };
      const matchingProfile = provenanceParsed.profiles?.find(
        (p) => p.workflowRelativePath === templateFileName
      );
      if (matchingProfile?.expectedWorkflowHash) {
        if (descriptor.baseCanonicalWorkflowDigest !== matchingProfile.expectedWorkflowHash) {
          errors.push(
            `Base canonical workflow digest in descriptor (${descriptor.baseCanonicalWorkflowDigest}) does not match provenance expectedWorkflowHash (${matchingProfile.expectedWorkflowHash})`
          );
        }
      }
    } catch (err) {
      errors.push(`Failed to verify provenance.json: ${(err as Error).message}`);
    }

    // Verify slot references consistency and prompt-slot relationships
    for (let i = 0; i < descriptor.references.length; i++) {
      const ref = descriptor.references[i]!;
      if (ref.slotIndex !== i) {
        errors.push(
          `Reference slotIndex mismatch at index ${i}: expected ${i}, got ${ref.slotIndex}`
        );
      }
      if (ref.order !== i) {
        errors.push(`Reference order mismatch at index ${i}: expected ${i}, got ${ref.order}`);
      }
      const expectedTag = `<Picture ${i + 1}>`;
      if (ref.tag !== expectedTag) {
        errors.push(
          `Reference tag mismatch at index ${i}: expected "${expectedTag}", got "${ref.tag}"`
        );
      }
      if (descriptor.route === "i2v" && ref.role !== "first_frame") {
        errors.push(
          `Reference role mismatch at index ${i}: expected "first_frame", got "${ref.role}"`
        );
      }
    }

    if (descriptor.route === "ref2v") {
      const tagMatches = descriptor.prompt.match(/<Picture \d+>/g) || [];
      for (const t of tagMatches) {
        const slotNum = parseInt(t.replace(/<Picture |>/g, ""), 10);
        if (slotNum < 1 || slotNum > descriptor.references.length) {
          errors.push(
            `Prompt references tag "${t}" but only ${descriptor.references.length} reference images were supplied.`
          );
        }
      }
    }

    // Verify base profile file digest
    try {
      const profilePath = resolveProfilePath(descriptor.baseProfileKey);
      if (existsSync(profilePath)) {
        let profileRaw: string;
        try {
          profileRaw = await this.store.readTextFile(profilePath);
        } catch {
          profileRaw = await readFile(profilePath, "utf8");
        }
        const profileDigest = sha256Hex(profileRaw);
        if (profileDigest !== descriptor.baseProfileFileDigest) {
          errors.push(
            `Base profile file digest mismatch: expected ${descriptor.baseProfileFileDigest}, got ${profileDigest}`
          );
        }
      }
    } catch (err) {
      errors.push(`Failed to verify base profile file: ${(err as Error).message}`);
    }

    // Verify recomputed comparisonKey matches descriptor
    const recomputedComparisonKey = computeComparisonKey({
      route: descriptor.route,
      frames: descriptor.configuredFrames,
      requestedDurationMs: descriptor.requestedDurationMs,
      width: descriptor.width,
      height: descriptor.height,
      promptDigest: descriptor.promptDigest,
      seed: descriptor.seed,
      references: descriptor.references.map((r) => ({
        slotIndex: r.slotIndex,
        role: r.role,
        tag: r.tag,
        order: r.order,
        sha256: r.sha256
      })),
      referenceHashes: descriptor.references.map((r) => r.sha256),
      runnerVariant: descriptor.requestedRunner.variantName,
      memoryPolicy: descriptor.requestedRunner.memoryPolicy,
      modelDigests: descriptor.pinFileIdentities.modelDigests,
      target: {
        hostname: descriptor.target.hostname,
        gpuUuid: descriptor.target.gpuUuid
      }
    });
    if (descriptor.comparisonKey !== recomputedComparisonKey) {
      errors.push(
        `Comparison key mismatch: expected "${recomputedComparisonKey}", got "${descriptor.comparisonKey}"`
      );
    }

    if (errors.length === 0 && expectedGraph) {
      return {
        ok: true,
        descriptor,
        errors,
        validatedGraph: expectedGraph
      };
    }

    return {
      ok: false,
      descriptor,
      errors,
      ...(expectedGraph ? { validatedGraph: expectedGraph } : {})
    };
  }

  async reconcileExperiment(
    runDir: string,
    options?: { outputRoot?: string }
  ): Promise<MinimaxH3ExperimentResult> {
    const outputRoot = options?.outputRoot ?? ".ai-runs/minimax-h3-experiments";
    assertSafeOutputPath(runDir, outputRoot);

    const descriptor = await this.store.readDescriptor(runDir);
    const existingResult = await this.store.readResult(runDir);
    const intent = await this.store.readIntent(runDir);
    const receipt = await this.store.readReceipt(runDir);
    const storedTerminalEvidence = await this.store.readTerminalEvidence(runDir);
    const storedProcessRecord = await this.store.readProcessRecord(runDir);
    const telemetrySamples = await this.store.readTelemetry(runDir);

    const baseResult = existingResult ?? createEmptyMinimaxH3MeasurementTemplate(descriptor);
    let promptId = receipt?.promptId ?? baseResult.execution.promptId;

    let isChildVerifiedLive = true;
    if (storedProcessRecord) {
      try {
        const statContent = await readFile(`/proc/${storedProcessRecord.pid}/stat`, "utf8");
        const lastParenIndex = statContent.lastIndexOf(")");
        if (lastParenIndex !== -1) {
          const fields = statContent
            .substring(lastParenIndex + 1)
            .trim()
            .split(/\s+/);
          const ticks = parseInt(fields[19] || "", 10);
          isChildVerifiedLive = ticks === storedProcessRecord.startTimeTicks;
        } else {
          isChildVerifiedLive = false;
        }
      } catch {
        isChildVerifiedLive = false;
      }
    }

    // If promptId missing, try to search queue/history if transport available and child is verified live
    if (!promptId && intent && this.transport && isChildVerifiedLive) {
      try {
        const found = await this.transport.findPromptByWorkflowDigestOrClient(
          `http://${descriptor.target.address}:${descriptor.target.port}`,
          intent.clientId
        );
        if (found?.promptId) {
          promptId = found.promptId;
        }
      } catch {
        // server may be offline
      }
    }

    // Determine execution status & terminal evidence
    let executionStatus = baseResult.execution.status;
    let terminalEvidence: MinimaxH3TerminalEvidence | null =
      storedTerminalEvidence ?? baseResult.execution.terminalEvidence;
    let engineError = baseResult.execution.engineError;
    let outputFilename: string | null = baseResult.probe.outputFile;

    if (promptId && this.transport && isChildVerifiedLive) {
      try {
        const historyRes = await this.transport.pollPromptHistory(
          `http://${descriptor.target.address}:${descriptor.target.port}`,
          promptId,
          5000,
          1000
        );
        if (historyRes.status === "completed") {
          executionStatus = "completed";
          terminalEvidence = {
            source: "history",
            status: "success",
            runId: descriptor.runId,
            promptId,
            serverAddress: descriptor.target.address,
            serverPort: descriptor.target.port,
            outputFilename: historyRes.outputFilename ?? outputFilename,
            rawDetails: historyRes.rawHistory ?? { status: "completed" }
          };
          outputFilename = historyRes.outputFilename ?? outputFilename;
        } else if (historyRes.status === "failed") {
          executionStatus = "failed";
          terminalEvidence = {
            source: "history",
            status: "error",
            runId: descriptor.runId,
            promptId,
            serverAddress: descriptor.target.address,
            serverPort: descriptor.target.port,
            rawDetails: historyRes.rawHistory ?? { status: "failed", error: historyRes.error }
          };
          engineError = { message: historyRes.error ?? "ComfyUI engine reported failure" };
        }
      } catch {
        // history unavailable via network
      }
    }

    if (storedTerminalEvidence) {
      terminalEvidence = storedTerminalEvidence;
      const rawObj = storedTerminalEvidence.rawDetails as Record<string, unknown> | undefined;
      const entryObj =
        rawObj && typeof rawObj === "object"
          ? ((promptId && typeof rawObj[promptId] === "object" && rawObj[promptId] !== null
              ? (rawObj[promptId] as Record<string, unknown>)
              : rawObj) as Record<string, unknown>)
          : undefined;

      const statusObj =
        typeof entryObj?.status === "object" && entryObj.status !== null
          ? (entryObj.status as Record<string, unknown>)
          : undefined;
      const statusStr =
        typeof entryObj?.status === "string"
          ? entryObj.status
          : (statusObj?.status_str as string | undefined);
      const explicitStatus = storedTerminalEvidence.status ?? statusStr;

      let explicitError =
        storedTerminalEvidence.error?.message ??
        (typeof entryObj?.error === "string" ? entryObj.error : undefined);

      let hasExecutionError = false;
      let hasInterruption = false;

      if (Array.isArray(statusObj?.messages)) {
        for (const m of statusObj.messages) {
          if (Array.isArray(m)) {
            if (m[0] === "execution_error") {
              hasExecutionError = true;
              const errDetails = m[1] as Record<string, unknown> | undefined;
              if (!explicitError) {
                explicitError =
                  typeof errDetails?.exception_message === "string"
                    ? `${errDetails.exception_type || "ExecutionError"}: ${errDetails.exception_message} (node ${errDetails.node_id || "?"})`
                    : JSON.stringify(m[1] ?? m);
              }
            } else if (m[0] === "execution_interrupted") {
              hasInterruption = true;
              if (!explicitError) {
                explicitError = "ComfyUI execution interrupted";
              }
            }
          }
        }
      }

      if (
        storedTerminalEvidence.status === "error" ||
        explicitStatus === "failed" ||
        explicitStatus === "error" ||
        statusStr === "error" ||
        hasExecutionError
      ) {
        executionStatus = "failed";
        if (!engineError) {
          engineError = { message: explicitError ?? "ComfyUI reported execution error" };
        }
        outputFilename = null;
      } else if (storedTerminalEvidence.status === "timeout" || explicitStatus === "timeout") {
        executionStatus = "unknown";
        outputFilename = null;
      } else if (
        storedTerminalEvidence.status === "interrupted" ||
        statusStr === "interrupted" ||
        hasInterruption
      ) {
        executionStatus = "unknown";
        outputFilename = null;
      } else if (
        storedTerminalEvidence.status === "success" ||
        statusStr === "success" ||
        (typeof entryObj?.status === "string" && entryObj.status === "success")
      ) {
        executionStatus = "completed";
      } else {
        executionStatus = "unknown";
      }

      if (!outputFilename && executionStatus === "completed") {
        outputFilename = storedTerminalEvidence.outputFilename ?? null;
        const outputsObj =
          (entryObj?.outputs as Record<string, unknown> | undefined) ??
          (rawObj?.outputs as Record<string, unknown> | undefined);
        if (!outputFilename && outputsObj && typeof outputsObj === "object") {
          const n92 = outputsObj["92"] as
            | {
                images?: Array<{ filename?: string; subfolder?: string; type?: string }>;
                videos?: Array<{ filename?: string; subfolder?: string; type?: string }>;
              }
            | undefined;
          const mediaList = Array.isArray(n92?.images)
            ? n92.images
            : Array.isArray(n92?.videos)
              ? n92.videos
              : null;
          if (mediaList && mediaList.length === 1) {
            const item = mediaList[0];
            const rawFilename = item?.filename;
            const subfolder = item?.subfolder ?? "";
            const outputType = item?.type ?? "output";
            if (
              rawFilename &&
              !rawFilename.includes("..") &&
              !rawFilename.includes("/") &&
              !rawFilename.includes("\\") &&
              !subfolder.includes("..") &&
              (outputType === "output" || outputType === "temp")
            ) {
              outputFilename = rawFilename;
            }
          }
        }
      }

      // Reject path traversal on outputFilename
      if (outputFilename) {
        const cleanBase = basename(outputFilename);
        if (
          cleanBase !== outputFilename ||
          outputFilename.includes("..") ||
          outputFilename.includes("/") ||
          outputFilename.includes("\\")
        ) {
          outputFilename = null;
        }
      }
    }

    if (executionStatus === "not_started" && intent) {
      executionStatus = promptId ? "running" : "unknown";
    }

    // Compute collection metrics
    let collectionStatus = baseResult.collection.status;
    const errors: Array<{ timestamp: string; message: string; phase?: string | undefined }> = [
      ...baseResult.collection.errors
    ];
    let beforeCoverage = false;
    let duringCoverage = false;
    let afterCoverage = false;
    let peakVram: number | null = null;
    let allocatableVram: number | null = null;
    let peakHostRam: number | null = null;
    let peakRss: number | null = null;
    let peakSwap: number | null = null;
    let beforeSwap: number | null = null;
    let afterSwap: number | null = null;
    let sampleSuccesses = 0;
    let sampleFailures = 0;

    for (const sample of telemetrySamples) {
      if (sample.phase === "before") beforeCoverage = true;
      if (sample.phase === "during") duringCoverage = true;
      if (sample.phase === "after") afterCoverage = true;

      const isSampleSuccess = !sample.error && sample.gpu !== null && sample.host !== null;

      if (!isSampleSuccess) {
        sampleFailures++;
        if (sample.error) {
          errors.push({ timestamp: sample.timestamp, message: sample.error, phase: sample.phase });
        } else {
          errors.push({
            timestamp: sample.timestamp,
            message: `Missing telemetry facts in sample (gpu: ${sample.gpu ? "ok" : "null"}, host: ${sample.host ? "ok" : "null"})`,
            phase: sample.phase
          });
        }
      } else {
        sampleSuccesses++;
      }

      if (sample.gpu) {
        if (peakVram === null || sample.gpu.usedVramMb > peakVram) {
          peakVram = sample.gpu.usedVramMb;
        }
        if (sample.gpu.allocatableVramMb > 0) {
          allocatableVram = sample.gpu.allocatableVramMb;
        }
      }
      if (sample.host) {
        if (peakHostRam === null || sample.host.usedRamMb > peakHostRam) {
          peakHostRam = sample.host.usedRamMb;
        }
        if (peakRss === null || sample.host.processRssMb > peakRss) {
          peakRss = sample.host.processRssMb;
        }
        if (peakSwap === null || sample.host.swapUsedMb > peakSwap) {
          peakSwap = sample.host.swapUsedMb;
        }
        if (sample.phase === "before") {
          beforeSwap = sample.host.swapUsedMb;
        } else if (sample.phase === "after") {
          afterSwap = sample.host.swapUsedMb;
        }
      }
    }

    const hostSwapDeltaMb =
      beforeSwap !== null && afterSwap !== null ? afterSwap - beforeSwap : null;

    // Deduplicate errors by timestamp and message
    const seenErrors = new Set<string>();
    const uniqueErrors: Array<{ timestamp: string; message: string; phase?: string | undefined }> =
      [];
    for (const err of errors) {
      const key = `${err.timestamp}|${err.message}`;
      if (!seenErrors.has(key)) {
        seenErrors.add(key);
        uniqueErrors.push(err);
      }
    }

    const totalSamples = sampleSuccesses + sampleFailures;
    if (totalSamples > 0) {
      const hasAllRequiredMetrics =
        peakVram !== null &&
        peakHostRam !== null &&
        peakRss !== null &&
        peakSwap !== null &&
        hostSwapDeltaMb !== null;
      if (
        beforeCoverage &&
        duringCoverage &&
        afterCoverage &&
        sampleFailures === 0 &&
        uniqueErrors.length === 0 &&
        hasAllRequiredMetrics
      ) {
        collectionStatus = "complete";
      } else if (sampleSuccesses > 0) {
        collectionStatus = "partial";
      } else {
        collectionStatus = "failed";
      }
    }

    // Probe output if file found and prober available
    let probeResult = baseResult.probe;
    if (outputFilename && this.prober && probeResult.status === "not_started") {
      try {
        const fullOutputPath = `${runDir}/outputs/${outputFilename}`;
        probeResult = await this.prober.probeOutput(fullOutputPath, 60000);
      } catch (err) {
        probeResult = {
          ...probeResult,
          status: "failed",
          errors: [{ message: (err as Error).message }]
        };
      }
    }

    // Output conformance checks
    const conformanceChecks = {
      frameCountMatches:
        probeResult.measuredFacts.measuredFrames !== null
          ? probeResult.measuredFacts.measuredFrames === descriptor.configuredFrames
          : null,
      geometryMatches:
        probeResult.measuredFacts.width !== null && probeResult.measuredFacts.height !== null
          ? probeResult.measuredFacts.width === descriptor.width &&
            probeResult.measuredFacts.height === descriptor.height
          : null,
      fpsMatches:
        probeResult.measuredFacts.fps !== null
          ? probeResult.measuredFacts.fps === descriptor.fps
          : null,
      timingWithinTolerance:
        probeResult.measuredFacts.measuredVideoDurationMs !== null
          ? Math.abs(
              probeResult.measuredFacts.measuredVideoDurationMs - descriptor.configuredDurationMs
            ) <= 200 &&
            (probeResult.measuredFacts.measuredContainerDurationMs === null ||
              Math.abs(
                probeResult.measuredFacts.measuredContainerDurationMs -
                  descriptor.configuredDurationMs
              ) <= 200)
          : null
    };

    let conformanceStatus: "unknown" | "conformant" | "nonconformant" = "unknown";
    const conformanceReasons: string[] = [];

    if (probeResult.status === "succeeded") {
      const hasAllRequiredFacts =
        probeResult.measuredFacts.measuredFrames !== null &&
        probeResult.measuredFacts.width !== null &&
        probeResult.measuredFacts.height !== null &&
        probeResult.measuredFacts.fps !== null &&
        probeResult.measuredFacts.measuredVideoDurationMs !== null;

      if (!hasAllRequiredFacts) {
        conformanceStatus = "unknown";
        conformanceReasons.push("missing_measured_facts");
      } else if (
        conformanceChecks.frameCountMatches &&
        conformanceChecks.geometryMatches &&
        conformanceChecks.fpsMatches &&
        conformanceChecks.timingWithinTolerance &&
        probeResult.discrepancyFlags.length === 0
      ) {
        conformanceStatus = "conformant";
      } else {
        conformanceStatus = "nonconformant";
        if (!conformanceChecks.frameCountMatches) conformanceReasons.push("frame_count_mismatch");
        if (!conformanceChecks.geometryMatches) conformanceReasons.push("geometry_mismatch");
        if (!conformanceChecks.fpsMatches) conformanceReasons.push("fps_mismatch");
        if (!conformanceChecks.timingWithinTolerance) conformanceReasons.push("duration_mismatch");
        if (probeResult.discrepancyFlags.length > 0) {
          for (const flag of probeResult.discrepancyFlags) {
            conformanceReasons.push(`discrepancy_${flag}`);
          }
        }
      }
    } else {
      conformanceStatus = "unknown";
      conformanceReasons.push("probe_not_succeeded");
    }

    // Lifecycle determination
    let lifecycle = baseResult.lifecycle;
    if (executionStatus === "completed") {
      lifecycle = "completed";
    } else if (
      terminalEvidence?.status === "interrupted" ||
      (terminalEvidence?.rawDetails &&
        typeof terminalEvidence.rawDetails === "object" &&
        (terminalEvidence.rawDetails as Record<string, unknown>).interrupted === true)
    ) {
      lifecycle = promptId ? "interrupted" : "submission_unknown";
    } else if (executionStatus === "failed") {
      lifecycle = "failed";
    } else if (!promptId && intent) {
      lifecycle = "submission_unknown";
    }

    // Stop recommendation
    const events = await this.store.readEvents(runDir).catch(() => []);
    const stopReasons: string[] = [];
    for (const evt of events) {
      if (evt.event === "stop_threshold_crossed") {
        const details = evt.details as Record<string, unknown> | undefined;
        const metric = typeof details?.metric === "string" ? details.metric : "threshold";
        stopReasons.push(`stop_threshold_crossed_${metric}`);
      }
    }
    if (collectionStatus === "failed" || collectionStatus === "partial") {
      stopReasons.push(`incomplete_telemetry_${collectionStatus}`);
    }
    if (probeResult.status === "failed") {
      stopReasons.push("output_probe_failed");
    }
    if (conformanceStatus === "nonconformant") {
      stopReasons.push("output_nonconformant");
    }

    let baselineRunId: string | null | undefined = baseResult.baselineRunId ?? null;
    let baselineResultDigest: string | null | undefined = baseResult.baselineResultDigest ?? null;
    if (!baselineRunId) {
      try {
        const link = (await this.store.readJsonFile(`${runDir}/baseline-link.json`)) as {
          baselineRunId?: string;
          baselineResultDigest?: string;
        };
        baselineRunId = link.baselineRunId ?? null;
        baselineResultDigest = link.baselineResultDigest ?? null;
      } catch {
        // ignore
      }
    }

    let policyDigest: string | undefined = baseResult.policyDigest;
    if (!policyDigest) {
      try {
        const sp = await this.store.readJsonFile(`${runDir}/stop-policy.json`);
        policyDigest = sha256Hex(canonicalizeJson(sp));
      } catch {
        // ignore
      }
    }

    const reconstructedResult: MinimaxH3ExperimentResult = {
      schemaVersion: 1,
      runId: descriptor.runId,
      descriptorDigest:
        descriptor.descriptorDigest ??
        computeDescriptorDigest(descriptor as unknown as Record<string, unknown>),
      configDigest: descriptor.configDigest,
      comparisonKey: descriptor.comparisonKey,
      lifecycle,
      observedRunner: {
        ...baseResult.observedRunner,
        ...(storedProcessRecord
          ? {
              pid: storedProcessRecord.pid,
              processStartTimeTicks: storedProcessRecord.startTimeTicks,
              targetGpuUuid: storedProcessRecord.gpuUuid,
              effectiveMode:
                storedProcessRecord.effectiveMode ?? baseResult.observedRunner.effectiveMode,
              ...(storedProcessRecord.argv ? { argv: storedProcessRecord.argv } : {}),
              ...(storedProcessRecord.env ? { env: storedProcessRecord.env } : {})
            }
          : {})
      },
      ...(policyDigest ? { policyDigest } : {}),
      ...(baselineRunId !== undefined ? { baselineRunId } : {}),
      ...(baselineResultDigest !== undefined ? { baselineResultDigest } : {}),
      timestamps: {
        preparedAt: baseResult.timestamps.preparedAt,
        startedAt: baseResult.timestamps.startedAt ?? intent?.timestamp ?? null,
        submittedAt: intent?.timestamp ?? null,
        terminatedAt: baseResult.timestamps.terminatedAt ?? new Date().toISOString()
      },
      execution: {
        status: executionStatus,
        promptId,
        terminalEvidence,
        engineError,
        latencyMs: baseResult.execution.latencyMs
      },
      collection: {
        status: collectionStatus,
        phaseCoverage: {
          before: beforeCoverage,
          during: duringCoverage,
          after: afterCoverage
        },
        sampleCount: {
          attempted: totalSamples,
          succeeded: sampleSuccesses,
          failed: sampleFailures
        },
        metrics: {
          gpuPeakUsedVramMb: peakVram,
          gpuAllocatableVramMb: allocatableVram,
          hostPeakRamUsedMb: peakHostRam,
          processPeakRssMb: peakRss,
          hostSwapUsedMb: peakSwap,
          hostSwapDeltaMb
        },
        errors: uniqueErrors
      },
      probe: probeResult,
      outputConformance: {
        status: conformanceStatus,
        checks: conformanceChecks,
        reasons: conformanceReasons
      },
      visualReview: baseResult.visualReview,
      operatorDecision: baseResult.operatorDecision,
      stopRecommendation: {
        recommended: stopReasons.length > 0,
        reasons: Array.from(new Set(stopReasons))
      }
    };

    // Validate result against strict schema
    MinimaxH3ExperimentResultSchema.parse(reconstructedResult);

    // Durably write reconstructed result
    await this.store.writeResult(runDir, reconstructedResult);
    return reconstructedResult;
  }

  async executeExperiment(
    runDir: string,
    options?: {
      stopPolicyPath?: string;
      baselineRunDir?: string;
      outputRoot?: string;
      abortSignal?: AbortSignal;
      templatesDir?: string;
    }
  ): Promise<MinimaxH3ExperimentResult> {
    const outputRoot = options?.outputRoot ?? ".ai-runs/minimax-h3-experiments";
    assertSafeOutputPath(runDir, outputRoot);

    if (options?.abortSignal?.aborted) {
      throw new Error("Experiment execution cancelled by operator signal before launch");
    }

    // Guard against re-run: if intent.json exists, reject live execution and direct operator to reconcile
    const existingIntent = await this.store.readIntent(runDir);
    if (existingIntent) {
      throw new Error(
        `Run directory "${runDir}" has already been submitted (intent.json exists). Refusing to re-submit. To inspect or reconstruct facts, use the reconcile command.`
      );
    }

    // 1. Dry offline validation first
    const validation = await this.validateExperiment(runDir, options);
    if (!validation.ok || !validation.validatedGraph) {
      throw new Error(`Experiment validation failed:\n${validation.errors.join("\n")}`);
    }
    const descriptor = validation.descriptor;
    const validatedGraph = validation.validatedGraph;

    // 2. Validate stop policy if provided
    if (!options?.stopPolicyPath) {
      throw new Error("Execution requires an operator-authored, versioned --stop-policy file.");
    }
    const rawPolicy = await this.store.readJsonFile(options.stopPolicyPath);
    const stopPolicy = MinimaxH3StopPolicySchema.parse(rawPolicy);
    await this.store.writeDurableJson(`${runDir}/stop-policy.json`, stopPolicy);

    // 3. Staged escalation rule: candidate frame counts > 124 require a verified baseline run
    if (descriptor.configuredFrames > 124) {
      if (!options?.baselineRunDir) {
        throw new Error(
          `Candidate frame count ${descriptor.configuredFrames} > 124 requires a successful 124-frame baseline run via --baseline-run-dir before escalating.`
        );
      }
      const baselineDescriptor = await this.store.readDescriptor(options.baselineRunDir);
      if (baselineDescriptor.configuredFrames !== 124) {
        throw new Error(
          `Baseline run must have configuredFrames = 124, got ${baselineDescriptor.configuredFrames}`
        );
      }
      if (baselineDescriptor.route !== descriptor.route) {
        throw new Error(
          `Baseline route mismatch: expected "${descriptor.route}", got "${baselineDescriptor.route}"`
        );
      }
      if (
        baselineDescriptor.width !== descriptor.width ||
        baselineDescriptor.height !== descriptor.height
      ) {
        throw new Error(
          `Baseline geometry mismatch: expected ${descriptor.width}x${descriptor.height}, got ${baselineDescriptor.width}x${baselineDescriptor.height}`
        );
      }
      if (baselineDescriptor.seed !== descriptor.seed) {
        throw new Error(
          `Baseline seed mismatch: expected ${descriptor.seed}, got ${baselineDescriptor.seed}`
        );
      }
      if (
        baselineDescriptor.requestedRunner.variantName !== descriptor.requestedRunner.variantName
      ) {
        throw new Error(
          `Baseline runner variant mismatch: expected "${descriptor.requestedRunner.variantName}", got "${baselineDescriptor.requestedRunner.variantName}"`
        );
      }
      if (baselineDescriptor.prompt !== descriptor.prompt) {
        throw new Error(
          `Baseline prompt mismatch: expected "${descriptor.prompt}", got "${baselineDescriptor.prompt}"`
        );
      }
      if (baselineDescriptor.references.length !== descriptor.references.length) {
        throw new Error(
          `Baseline references count mismatch: expected ${descriptor.references.length}, got ${baselineDescriptor.references.length}`
        );
      }
      for (let i = 0; i < descriptor.references.length; i++) {
        if (baselineDescriptor.references[i]?.sha256 !== descriptor.references[i]?.sha256) {
          throw new Error(
            `Baseline reference ${i} sha256 mismatch: expected ${descriptor.references[i]?.sha256}, got ${baselineDescriptor.references[i]?.sha256}`
          );
        }
        if (baselineDescriptor.references[i]?.role !== descriptor.references[i]?.role) {
          throw new Error(
            `Baseline reference ${i} role mismatch: expected "${descriptor.references[i]?.role}", got "${baselineDescriptor.references[i]?.role}"`
          );
        }
        if (baselineDescriptor.references[i]?.tag !== descriptor.references[i]?.tag) {
          throw new Error(
            `Baseline reference ${i} tag mismatch: expected "${descriptor.references[i]?.tag}", got "${baselineDescriptor.references[i]?.tag}"`
          );
        }
      }
      const baselineResult = await this.store.readResult(options.baselineRunDir);
      if (!baselineResult || baselineResult.execution.status !== "completed") {
        throw new Error(
          `Baseline run at ${options.baselineRunDir} has not completed successfully; cannot escalate candidate run.`
        );
      }
      if (baselineResult.observedRunner.effectiveMode.status !== "verified") {
        throw new Error(
          `Baseline run effective mode is not "verified" (status: ${baselineResult.observedRunner.effectiveMode.status}).`
        );
      }
      if (
        baselineResult.observedRunner.effectiveMode.value !==
        descriptor.requestedRunner.memoryPolicy
      ) {
        throw new Error(
          `Baseline run effective mode value "${baselineResult.observedRunner.effectiveMode.value}" does not match requested memory policy "${descriptor.requestedRunner.memoryPolicy}".`
        );
      }
      if (baselineResult.collection.status !== "complete") {
        throw new Error(
          `Baseline run collection status is "${baselineResult.collection.status}", must be "complete".`
        );
      }
      if (baselineResult.outputConformance.status !== "conformant") {
        throw new Error(
          `Baseline run output conformance is "${baselineResult.outputConformance.status}", must be "conformant".`
        );
      }
      let baselineVisualStatus = baselineResult.visualReview.status;
      if (baselineVisualStatus !== "reviewed") {
        const sidecarPath = `${options.baselineRunDir}/visual-review.json`;
        try {
          const sidecar = await this.store.readJsonFile(sidecarPath);
          const parsed = MinimaxH3VisualReviewSidecarSchema.parse(sidecar);
          if (parsed.runId === baselineDescriptor.runId && parsed.status === "reviewed") {
            baselineVisualStatus = "reviewed";
          }
        } catch {
          // ignore missing or invalid sidecar
        }
      }
      if (baselineVisualStatus !== "reviewed") {
        throw new Error(
          `Baseline run visual review status is "${baselineVisualStatus}", must be "reviewed".`
        );
      }

      await this.store.writeDurableJson(`${runDir}/baseline-link.json`, {
        baselineRunId: baselineDescriptor.runId,
        baselineResultDigest: sha256Hex(canonicalizeJson(baselineResult))
      });
    }

    if (!this.preflight || !this.runner || !this.transport || !this.telemetry) {
      throw new Error("Live execution requires preflight, runner, transport, and telemetry ports.");
    }

    const writePreflightBlocker = async (blockerMessage: string | undefined, phase: string) => {
      const msg = blockerMessage ?? `${phase} failed`;
      try {
        await this.store.appendEvent(runDir, {
          timestamp: new Date().toISOString(),
          event: "preflight_failure",
          details: { phase, blocker: msg }
        });
        await this.store.writeTerminalEvidence(runDir, {
          source: "process",
          status: "error",
          runId: descriptor.runId,
          serverAddress: descriptor.target.address,
          serverPort: descriptor.target.port,
          error: { message: msg },
          rawDetails: { phase, preflightFailure: true, blocker: msg }
        });
      } catch {
        // ignore secondary failure
      }
    };

    // 4. Preflight checks
    const hostCheck = await this.preflight.checkTargetHost(descriptor.target);
    if (!hostCheck.ok) {
      await writePreflightBlocker(hostCheck.blocker, "checkTargetHost");
      throw new Error(`Preflight target host check failed: ${hostCheck.blocker}`);
    }

    const portCheck = await this.preflight.checkPortAvailable(
      descriptor.target.address,
      descriptor.target.port
    );
    if (!portCheck.ok) {
      await writePreflightBlocker(portCheck.blocker, "checkPortAvailable");
      throw new Error(`Preflight port check failed: ${portCheck.blocker}`);
    }

    const checkoutCheck = await this.preflight.verifyCheckout(descriptor.target.comfyUiDir);
    if (!checkoutCheck.ok) {
      await writePreflightBlocker(checkoutCheck.blocker, "verifyCheckout");
      throw new Error(`Preflight checkout check failed: ${checkoutCheck.blocker}`);
    }

    if (this.preflight.verifyEnvironmentTools) {
      const toolsCheck = await this.preflight.verifyEnvironmentTools(descriptor.target.pythonPath);
      if (!toolsCheck.ok) {
        await writePreflightBlocker(toolsCheck.blocker, "verifyEnvironmentTools");
        throw new Error(`Environment tools verification failed: ${toolsCheck.blocker}`);
      }
    }

    const modelsCheck = await this.preflight.verifyModels(
      descriptor.target.comfyUiDir,
      descriptor.resolvedModelPaths
    );
    if (!modelsCheck.ok) {
      await writePreflightBlocker(modelsCheck.blocker, "verifyModels");
      throw new Error(`Preflight model verification failed: ${modelsCheck.blocker}`);
    }

    const diskCheck = await this.preflight.verifyDiskSpace(runDir, 50);
    if (!diskCheck.ok) {
      await writePreflightBlocker(diskCheck.blocker, "verifyDiskSpace");
      throw new Error(`Preflight disk space check failed: ${diskCheck.blocker}`);
    }

    const lock = await this.preflight.acquireGpuLock(
      outputRoot,
      descriptor.target.gpuUuid,
      process.pid
    );
    if (!lock.acquired) {
      await writePreflightBlocker(lock.blocker, "acquireGpuLock");
      throw new Error(`Preflight GPU lock acquisition failed: ${lock.blocker}`);
    }

    let ownedChild: MinimaxH3OwnedProcess | null = null;
    let telemetryControl: {
      stop: () => Promise<void>;
      setPhase: (phase: "before" | "during" | "after") => void;
    } | null = null;
    let executeError: Error | null = null;

    try {
      // 5. Spawn owned child with absolute paths and clean environment
      ownedChild = await this.runner.spawnChild({
        pythonPath: descriptor.target.pythonPath,
        comfyUiDir: descriptor.target.comfyUiDir,
        address: descriptor.target.address,
        port: descriptor.target.port,
        dirs: {
          inputDir: `${runDir}/inputs`,
          outputDir: `${runDir}/outputs`,
          tempDir: `${runDir}/temp`,
          userDir: `${runDir}/user`
        },
        argv: descriptor.configuredRunner.argv,
        env: descriptor.configuredRunner.env,
        gpuUuid: descriptor.target.gpuUuid
      });

      let actualArgv = descriptor.configuredRunner.argv;
      let actualEnv = descriptor.configuredRunner.env;
      let actualCommandLine = [
        descriptor.target.pythonPath,
        "main.py",
        ...descriptor.configuredRunner.argv
      ].join(" ");

      if (typeof ownedChild.readActualProcessInfo === "function") {
        try {
          const procInfo = await ownedChild.readActualProcessInfo();
          if (procInfo.argv && procInfo.argv.length > 0) {
            actualArgv = procInfo.argv;
          }
          if (procInfo.env && Object.keys(procInfo.env).length > 0) {
            actualEnv = procInfo.env;
          }
          if (procInfo.commandLine) {
            actualCommandLine = procInfo.commandLine;
          }
        } catch {
          // ignore
        }
      }

      // Write process record immediately. launcherPid/launcherStartTimeTicks/
      // gpuLockToken identify the lock holder (this harness process), which
      // is distinct from the spawned ComfyUI child (pid/startTimeTicks
      // above) — a later, separate `cleanup` CLI invocation needs the
      // launcher's identity, not the child's, to release this GPU lock.
      const processRecord: MinimaxH3ProcessRecord = {
        pid: ownedChild.pid,
        startTimeTicks: ownedChild.startTimeTicks,
        address: descriptor.target.address,
        port: descriptor.target.port,
        gpuUuid: descriptor.target.gpuUuid,
        commandLine: actualCommandLine,
        startedAt: new Date().toISOString(),
        argv: [...actualArgv],
        env: { ...actualEnv },
        ...(lock.lockToken !== undefined ? { gpuLockToken: lock.lockToken } : {}),
        launcherPid: process.pid,
        launcherStartTimeTicks: lock.processStartTimeTicks ?? null
      };
      await this.store.writeProcessRecord(runDir, processRecord);

      const baseUrl = `http://${descriptor.target.address}:${descriptor.target.port}`;

      // 6. Wait for readiness
      const readyCheck = await this.transport.waitForReadiness(
        baseUrl,
        descriptor.timeouts.startupTimeoutMs,
        options?.abortSignal
      );
      if (!readyCheck.ok) {
        throw new Error(`ComfyUI child failed to become ready: ${readyCheck.blocker}`);
      }

      // 7. Verify socket ownership and environment
      const socketOwnership = await ownedChild.verifySocketOwnership();
      if (!socketOwnership.ok) {
        throw new Error(`Socket ownership verification failed: ${socketOwnership.reason}`);
      }

      const envVerification = await ownedChild.verifyChildEnvironment();
      if (!envVerification.ok) {
        throw new Error(`Child environment verification failed: ${envVerification.reason}`);
      }

      // Verify queue is idle
      const initialQueue = await this.transport.getQueue(baseUrl);
      if (initialQueue.running.length > 0 || initialQueue.pending.length > 0) {
        throw new Error(
          `ComfyUI queue is not idle before prompt submission: ${initialQueue.running.length} running, ${initialQueue.pending.length} pending.`
        );
      }

      // 8. Analyze startup diagnostics
      const startupLogs = ownedChild.getStdout() + "\n" + ownedChild.getStderr();
      const effectiveMode = analyzeStartupDiagnostics(
        startupLogs,
        descriptor.requestedRunner.memoryPolicy
      );
      if (effectiveMode.status !== "verified") {
        throw new Error(
          `Memory policy verification failed before POST: ${effectiveMode.unknownReason}`
        );
      }

      // Update process record with verified effective mode
      const updatedProcessRecord: MinimaxH3ProcessRecord = {
        ...processRecord,
        effectiveMode
      };
      await this.store.writeProcessRecord(runDir, updatedProcessRecord);

      // 9. Start telemetry sampler
      let stopTriggered = false;
      let initialSampleSwap: number | null = null;
      const stopAbortController = new AbortController();

      telemetryControl = this.telemetry.start({
        targetGpuUuid: descriptor.target.gpuUuid,
        pid: ownedChild.pid,
        processStartTimeTicks: ownedChild.startTimeTicks,
        intervalMs: descriptor.collectionIntervalMs,
        onSample: async (sample) => {
          await this.store.appendTelemetry(runDir, sample);

          // Evaluate stop policy thresholds
          if (sample.host && initialSampleSwap === null) {
            initialSampleSwap = sample.host.swapUsedMb;
          }
          if (sample.gpu && sample.gpu.usedVramMb > stopPolicy.maxPeakVramMb) {
            stopTriggered = true;
            stopAbortController.abort();
            await this.store.appendEvent(runDir, {
              timestamp: new Date().toISOString(),
              event: "stop_threshold_crossed",
              details: {
                metric: "gpuPeakUsedVramMb",
                value: sample.gpu.usedVramMb,
                threshold: stopPolicy.maxPeakVramMb
              }
            });
          }
          if (sample.host && sample.host.usedRamMb > stopPolicy.maxHostRamMb) {
            stopTriggered = true;
            stopAbortController.abort();
            await this.store.appendEvent(runDir, {
              timestamp: new Date().toISOString(),
              event: "stop_threshold_crossed",
              details: {
                metric: "hostPeakRamUsedMb",
                value: sample.host.usedRamMb,
                threshold: stopPolicy.maxHostRamMb
              }
            });
          }
          if (sample.host && sample.host.swapUsedMb > stopPolicy.maxSwapUsedMb) {
            stopTriggered = true;
            stopAbortController.abort();
            await this.store.appendEvent(runDir, {
              timestamp: new Date().toISOString(),
              event: "stop_threshold_crossed",
              details: {
                metric: "hostSwapUsedMb",
                value: sample.host.swapUsedMb,
                threshold: stopPolicy.maxSwapUsedMb
              }
            });
          }
          if (
            sample.host &&
            initialSampleSwap !== null &&
            sample.host.swapUsedMb - initialSampleSwap > stopPolicy.maxSwapDeltaMb
          ) {
            stopTriggered = true;
            stopAbortController.abort();
            await this.store.appendEvent(runDir, {
              timestamp: new Date().toISOString(),
              event: "stop_threshold_crossed",
              details: {
                metric: "hostSwapDeltaMb",
                value: sample.host.swapUsedMb - initialSampleSwap,
                threshold: stopPolicy.maxSwapDeltaMb
              }
            });
          }
        }
      });
      telemetryControl.setPhase("before");
      await new Promise((r) => setTimeout(r, 1000));

      if (options?.abortSignal?.aborted || stopAbortController.signal.aborted) {
        throw new Error("Experiment execution cancelled by operator signal before POST");
      }

      // Re-verify child socket, environment, staged assets, and config.json before POST
      const prePostSocket = await ownedChild.verifySocketOwnership();
      if (!prePostSocket.ok) {
        throw new Error(`Socket ownership check before POST failed: ${prePostSocket.reason}`);
      }
      const prePostEnv = await ownedChild.verifyChildEnvironment();
      if (!prePostEnv.ok) {
        throw new Error(`Child environment check before POST failed: ${prePostEnv.reason}`);
      }
      for (const ref of descriptor.references) {
        const stagedPath = `${runDir}/inputs/${ref.stagedFilename}`;
        const hashInfo = await this.store.hashFile(stagedPath);
        if (hashInfo.sha256 !== ref.sha256) {
          throw new Error(`Staged input asset tampered before POST: ${ref.stagedFilename}`);
        }
      }
      const onDiskConfig = await this.store.readConfig(runDir);
      const onDiskCanonical = canonicalizeJson(onDiskConfig);
      const validatedCanonical = canonicalizeJson(validatedGraph);
      if (onDiskCanonical !== validatedCanonical) {
        throw new Error("config.json on disk was modified or tampered before POST");
      }

      // 10. Write intent
      const clientId = `client-${descriptor.runId}`;
      const intent: MinimaxH3ExperimentIntent = {
        runId: descriptor.runId,
        clientId,
        workflowDigest: descriptor.derivedWorkflowDigest,
        requestFingerprint: sha256Hex(descriptor.runId + descriptor.derivedWorkflowDigest),
        timestamp: new Date().toISOString()
      };
      await this.store.writeIntent(runDir, intent);

      if (options?.abortSignal?.aborted || stopAbortController.signal.aborted) {
        throw new Error("Experiment execution cancelled by operator signal after intent");
      }

      // 11. Submit prompt using validated in-memory graph (never unverified disk file)
      telemetryControl.setPhase("during");
      let submitRes;
      try {
        submitRes = await this.transport.submitPrompt(
          baseUrl,
          validatedGraph,
          clientId,
          descriptor.timeouts.submissionTimeoutMs,
          options?.abortSignal
        );
      } catch (submitErr) {
        await this.store.writeTerminalEvidence(runDir, {
          source: "process",
          status: "unknown",
          runId: descriptor.runId,
          serverAddress: descriptor.target.address,
          serverPort: descriptor.target.port,
          error: { message: (submitErr as Error).message },
          rawDetails: {
            ambiguousSubmission: true,
            error: (submitErr as Error).message,
            phase: "prompt_submission"
          }
        });
        throw submitErr;
      }

      if (!submitRes.ok || !submitRes.promptId) {
        await this.store.writeTerminalEvidence(runDir, {
          source: "process",
          status: "error",
          runId: descriptor.runId,
          serverAddress: descriptor.target.address,
          serverPort: descriptor.target.port,
          error: { message: submitRes.error ?? "Prompt submission rejected" },
          rawDetails: {
            ambiguousSubmission: false,
            error: submitRes.error,
            phase: "prompt_submission"
          }
        });
        throw new Error(`ComfyUI prompt submission failed: ${submitRes.error}`);
      }

      // 12. Write receipt
      const receipt: MinimaxH3ExperimentReceipt = {
        runId: descriptor.runId,
        promptId: submitRes.promptId,
        acceptedAt: new Date().toISOString()
      };
      await this.store.writeReceipt(runDir, receipt);

      // 13. Poll execution with stop policy checking
      const effectiveRenderTimeoutMs = Math.min(
        descriptor.timeouts.totalRenderTimeoutMs,
        stopPolicy.maxExecutionDurationMs
      );

      const combinedAbortController = new AbortController();
      if (options?.abortSignal) {
        if (options.abortSignal.aborted) {
          combinedAbortController.abort();
        } else {
          options.abortSignal.addEventListener("abort", () => combinedAbortController.abort(), {
            once: true
          });
        }
      }
      stopAbortController.signal.addEventListener("abort", () => combinedAbortController.abort(), {
        once: true
      });

      const pollRes = await this.transport.pollPromptHistory(
        baseUrl,
        receipt.promptId,
        effectiveRenderTimeoutMs,
        descriptor.timeouts.pollIntervalMs,
        combinedAbortController.signal
      );

      // Persist terminal evidence BEFORE process teardown!
      const terminalStatus =
        pollRes.status === "completed"
          ? "success"
          : pollRes.status === "failed"
            ? "error"
            : pollRes.status === "timeout"
              ? "timeout"
              : "error";

      const terminalEvidence: MinimaxH3TerminalEvidence = {
        source: "history",
        status: terminalStatus,
        runId: descriptor.runId,
        promptId: receipt.promptId,
        serverAddress: descriptor.target.address,
        serverPort: descriptor.target.port,
        outputFilename: pollRes.outputFilename,
        error: pollRes.error ? { message: pollRes.error } : null,
        rawDetails: pollRes.rawHistory ?? {
          status: pollRes.status,
          error: pollRes.error,
          stopTriggered
        }
      };
      await this.store.writeTerminalEvidence(runDir, terminalEvidence);

      telemetryControl.setPhase("after");
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      executeError = err as Error;
      // Record terminal evidence for the exception if not already recorded
      try {
        const existingEvidence = await this.store.readTerminalEvidence(runDir);
        if (!existingEvidence) {
          const isInterrupted = options?.abortSignal?.aborted ?? false;
          await this.store.writeTerminalEvidence(runDir, {
            source: "process",
            status: isInterrupted ? "interrupted" : "error",
            runId: descriptor.runId,
            serverAddress: descriptor.target.address,
            serverPort: descriptor.target.port,
            error: { message: (err as Error).message },
            rawDetails: { exception: (err as Error).message, interrupted: isInterrupted }
          });
        }
      } catch {
        // ignore secondary write error
      }
    } finally {
      if (telemetryControl) {
        try {
          await telemetryControl.stop();
        } catch {
          // ignore
        }
      }
      if (ownedChild) {
        try {
          const stdoutLogs = ownedChild.getStdout();
          const stderrLogs = ownedChild.getStderr();
          if (stdoutLogs) {
            await this.store.writeTextFile(`${runDir}/comfyui.stdout.log`, stdoutLogs);
          }
          if (stderrLogs) {
            await this.store.writeTextFile(`${runDir}/comfyui.stderr.log`, stderrLogs);
          }
        } catch {
          // ignore log write failure
        }
        try {
          await ownedChild.stop(descriptor.timeouts.shutdownTimeoutMs);
        } catch (stopErr) {
          executeError = executeError ?? (stopErr as Error);
        }
      }
      if (lock) {
        try {
          const isRunning = ownedChild ? ownedChild.isRunning() : false;
          if (!isRunning) {
            await lock.release();
          }
        } catch {
          // ignore
        }
      }
    }

    // 14. Always reconcile final facts and write result.json
    const reconciledResult = await this.reconcileExperiment(runDir, options);
    if (executeError) {
      throw executeError;
    }
    return reconciledResult;
  }
}
