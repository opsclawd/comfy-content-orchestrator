import {
  type FastH3OmniAuditSnapshot,
  type FastH3OmniBindingManifest,
  type FastH3OmniCampaignExportManifest,
  FastH3OmniCampaignExportManifestSchema,
  type FastH3OmniCapability,
  type FastH3OmniModelIdentity,
  type FastH3OmniPreparationSpec,
  FastH3OmniPreparationSpecSchema,
  type FastH3OmniReadinessStatus,
  type FastH3OmniRuntimeIdentity,
  computeFastH3OmniCommandDigest,
  computeFastH3OmniDescriptorDigest,
  createBlankFastH3OmniReport,
  createDefaultFastH3OmniAuditSnapshot,
  createDefaultFastH3OmniModelIdentity,
  createDefaultFastH3OmniRuntimeIdentity,
  createFastVideoSm89Capability
} from "@cco/contracts";
import type { FastH3OmniFilesystemPort } from "../ports/fasth3-omni-experiment-ports.js";
import { mapCampaignReferencesToFastH3OmniBindings } from "./fasth3-omni-reference-mapper.js";
import {
  type CompileFastH3OmniOptions,
  compileFastH3OmniSpecification,
  generateFastVideoYamlConfig
} from "./fasth3-omni-compiler.js";

const DEFAULT_EXPERIMENT_ROOT = ".ai-runs/fasth3-omni-experiments";

export interface FastH3OmniPrepareOptions {
  readonly runId: string;
  readonly manifestPath: string;
  readonly prompt?: string | undefined;
  readonly promptPath?: string | undefined;
  readonly frames: number;
  readonly seed: number;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly fps?: number | undefined;
  readonly outputRoot?: string | undefined;
  readonly capability?: FastH3OmniCapability | undefined;
  readonly auditSnapshot?: FastH3OmniAuditSnapshot | undefined;
  readonly modelIdentity?: FastH3OmniModelIdentity | undefined;
  readonly runtimeIdentity?: FastH3OmniRuntimeIdentity | undefined;
  readonly timeouts?: CompileFastH3OmniOptions["timeouts"];
  readonly upstreamRecipe?: CompileFastH3OmniOptions["upstreamRecipe"];
  readonly executionContext?:
    | {
        readonly hostGpuVerified?: boolean | undefined;
        readonly licenseApproved?: boolean | undefined;
        readonly weightsVerifiedLocally?: boolean | undefined;
      }
    | undefined;
}

export interface FastH3OmniValidationResult {
  readonly ok: boolean;
  readonly spec?: FastH3OmniPreparationSpec;
  readonly errors: string[];
  readonly isExecutable: boolean;
  readonly readinessStatus?: FastH3OmniReadinessStatus;
  readonly executionBlockers: string[];
}

export class FastH3OmniPreparationService {
  constructor(private readonly fs: FastH3OmniFilesystemPort) {}

  async prepareExperiment(
    options: FastH3OmniPrepareOptions
  ): Promise<{ ok: true; spec: FastH3OmniPreparationSpec; runDir: string }> {
    const outputRoot = options.outputRoot ?? DEFAULT_EXPERIMENT_ROOT;
    const runId = options.runId.trim();
    if (!runId || !/^[a-zA-Z0-9_-]+$/.test(runId)) {
      throw new Error(
        `Invalid runId "${runId}". Must be non-empty alphanumeric with hyphens/underscores.`
      );
    }

    const runDir = `${outputRoot}/${runId}`;
    this.fs.assertSafeContainment(runDir, outputRoot);

    const descriptorPath = `${runDir}/descriptor.json`;
    if (await this.fs.fileExists(descriptorPath)) {
      throw new Error(
        `Experiment run "${runId}" already exists at ${runDir}. Refusing to overwrite immutable preparation.`
      );
    }

    await this.fs.ensureDirectory(runDir);
    const inputsDir = `${runDir}/inputs`;
    await this.fs.ensureDirectory(inputsDir);

    // Read and parse campaign reference manifest
    const rawManifest = await this.fs.readJson<unknown>(options.manifestPath);
    const manifest: FastH3OmniCampaignExportManifest =
      FastH3OmniCampaignExportManifestSchema.parse(rawManifest);

    // Resolve prompt
    let prompt = options.prompt ?? "";
    if (options.promptPath) {
      prompt = await this.fs.readText(options.promptPath);
    }
    if (!prompt.trim()) {
      throw new Error("Prompt must be provided and non-empty.");
    }

    // Default identities and capabilities
    const capability = options.capability ?? createFastVideoSm89Capability();
    const auditSnapshot = options.auditSnapshot ?? createDefaultFastH3OmniAuditSnapshot();
    const modelIdentity = options.modelIdentity ?? createDefaultFastH3OmniModelIdentity();
    const runtimeIdentity = options.runtimeIdentity ?? createDefaultFastH3OmniRuntimeIdentity();

    // Stage inputs into isolated directory
    const stagedRefs = [];
    for (let i = 0; i < manifest.orderedReferences.length; i++) {
      const ref = manifest.orderedReferences[i]!;
      if (!ref.localPath) {
        throw new Error(
          `Reference asset ${ref.assetId} at index ${i} lacks required localPath for offline staging.`
        );
      }
      const ext = ref.mimeType === "image/jpeg" ? "jpg" : "png";
      const targetFileName = `ref_${i}_${ref.assetId.slice(0, 8)}.${ext}`;
      const targetStagedPath = `${inputsDir}/${targetFileName}`;

      await this.fs.stageInputFile(ref.localPath, targetStagedPath, ref.contentHashSha256);

      stagedRefs.push({
        ...ref,
        localPath: targetStagedPath
      });
    }

    const stagedManifest: FastH3OmniCampaignExportManifest = {
      ...manifest,
      orderedReferences: stagedRefs
    };

    // Run pure mapping
    const bindingManifest: FastH3OmniBindingManifest = mapCampaignReferencesToFastH3OmniBindings({
      manifest: stagedManifest,
      prompt,
      capability
    });

    // Run pure compiler
    const spec = compileFastH3OmniSpecification({
      runId,
      auditSnapshot,
      capability,
      modelIdentity,
      runtimeIdentity,
      bindingManifest,
      renderParams: {
        width: options.width ?? 832,
        height: options.height ?? 480,
        frames: options.frames,
        fps: options.fps ?? 24,
        seed: options.seed
      },
      ...(options.executionContext !== undefined
        ? { executionContext: options.executionContext }
        : {}),
      ...(options.timeouts !== undefined ? { timeouts: options.timeouts } : {}),
      ...(options.upstreamRecipe !== undefined ? { upstreamRecipe: options.upstreamRecipe } : {}),
      outputDir: runDir,
      stagedInputsDir: inputsDir
    });

    const yamlConfig = generateFastVideoYamlConfig(spec);
    const blankReport = createBlankFastH3OmniReport(runId, spec.descriptorDigest);

    // Write durable artifacts
    await this.fs.writeJson(descriptorPath, spec);
    if (yamlConfig !== null) {
      await this.fs.writeText(`${runDir}/config.yaml`, yamlConfig);
    }
    if (spec.commandSpec) {
      await this.fs.writeJson(`${runDir}/command.json`, spec.commandSpec);
    }
    await this.fs.writeJson(`${runDir}/blank-report.json`, blankReport);
    await this.fs.writeJson(`${runDir}/audit-snapshot.json`, auditSnapshot);
    await this.fs.writeJson(`${runDir}/binding-manifest.json`, bindingManifest);

    return { ok: true, spec, runDir };
  }

  async validateExperiment(
    runDir: string,
    options?: { outputRoot?: string }
  ): Promise<FastH3OmniValidationResult> {
    const outputRoot = options?.outputRoot ?? DEFAULT_EXPERIMENT_ROOT;
    const errors: string[] = [];

    try {
      this.fs.assertSafeContainment(runDir, outputRoot);
    } catch (err) {
      return {
        ok: false,
        errors: [(err as Error).message],
        isExecutable: false,
        executionBlockers: ["Path containment violation"]
      };
    }

    const descriptorPath = `${runDir}/descriptor.json`;
    if (!(await this.fs.fileExists(descriptorPath))) {
      return {
        ok: false,
        errors: [`Descriptor file not found at ${descriptorPath}`],
        isExecutable: false,
        executionBlockers: ["Missing descriptor.json"]
      };
    }

    let spec: FastH3OmniPreparationSpec;
    try {
      const rawDescriptor = await this.fs.readJson<unknown>(descriptorPath);
      spec = FastH3OmniPreparationSpecSchema.parse(rawDescriptor);
    } catch (err) {
      return {
        ok: false,
        errors: [`Descriptor validation failed: ${(err as Error).message}`],
        isExecutable: false,
        executionBlockers: ["Corrupt or schema-invalid descriptor.json"]
      };
    }

    // Verify descriptor digest integrity
    const recomputedDescriptorDigest = computeFastH3OmniDescriptorDigest(spec);
    if (recomputedDescriptorDigest !== spec.descriptorDigest) {
      errors.push(
        `Descriptor digest mismatch: recorded "${spec.descriptorDigest}", computed "${recomputedDescriptorDigest}"`
      );
    }

    // Verify config file existence
    const configPath = `${runDir}/config.yaml`;
    if (spec.commandSpec && !(await this.fs.fileExists(configPath))) {
      errors.push(`Configuration file not found at ${configPath}`);
    }

    // Verify command spec integrity if present
    if (spec.commandSpec) {
      const commandPath = `${runDir}/command.json`;
      if (!(await this.fs.fileExists(commandPath))) {
        errors.push(`Command file not found at ${commandPath}`);
      } else {
        const rawCmd = await this.fs.readJson<Record<string, unknown>>(commandPath);
        const recomputedCmdDigest = computeFastH3OmniCommandDigest(rawCmd);
        if (recomputedCmdDigest !== spec.commandSpec.commandDigest) {
          errors.push(
            `Command digest mismatch: recorded "${spec.commandSpec.commandDigest}", computed "${recomputedCmdDigest}"`
          );
        }
      }
    }

    // Re-verify staged inputs
    const inputsDir = `${runDir}/inputs`;
    if (!(await this.fs.directoryExists(inputsDir))) {
      errors.push(`Staged inputs directory not found at ${inputsDir}`);
    } else {
      for (const binding of spec.bindingManifest.orderedBindings) {
        const expectedPattern = `ref_${binding.slotIndex}_${binding.assetId.slice(0, 8)}`;
        // Check for matching file
        let matchedFile: string | null = null;
        for (const candidateExt of ["png", "jpg", "jpeg"]) {
          const candidatePath = `${inputsDir}/${expectedPattern}.${candidateExt}`;
          if (await this.fs.fileExists(candidatePath)) {
            matchedFile = candidatePath;
            break;
          }
        }

        if (!matchedFile) {
          errors.push(
            `Staged asset file missing for slot ${binding.slotIndex} (asset ${binding.assetId})`
          );
        } else {
          const actualHash = await this.fs.computeFileSha256(matchedFile);
          if (actualHash !== binding.contentHashSha256) {
            errors.push(
              `Staged asset hash mismatch for slot ${binding.slotIndex}: expected ${binding.contentHashSha256}, got ${actualHash}`
            );
          }
        }
      }
    }

    const isOk = errors.length === 0;
    return {
      ok: isOk,
      spec,
      errors,
      isExecutable: spec.isExecutable,
      readinessStatus: spec.readinessStatus,
      executionBlockers: spec.executionBlockers
    };
  }
}
