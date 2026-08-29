import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
const { Pool } = pg;
import {
  AssembleGenerationManifest,
  ExecuteProfileRenderUseCase,
  GpuLeaseOwnershipLostError,
  GpuLeaseUnavailableError,
  ProfileRenderExecutionError,
  type ExecuteProfileRenderInput,
  type ExecuteProfileRenderResult,
  type GpuExecutionLeasePort,
  type GpuLeaseHolder,
  type GpuTelemetryPort,
  type HashBytesPort,
  type ProfileRenderIdentity,
  type ReferenceAssetRepository,
  type RenderEnginePort,
  type RenderWorkflow,
  type SceneRepository,
  type StoryboardCandidateRepository
} from "@cco/application";
import {
  collectCertificationProvenance,
  ComfyUiRenderEngineAdapter,
  hashWorkflow,
  loadCertificationProfile,
  LocalFsGpuLeaseAdapter,
  NvidiaSmiTelemetryAdapter,
  PostgresReferenceAssetRepository,
  PostgresSceneRepository,
  PostgresStoryboardCandidateRepository,
  type CertificationProfile,
  type CertificationProvenanceReport,
  type ComfyUiRenderEngineAdapterOptions,
  type LocalFsGpuLeaseAdapterOptions,
  type NvidiaSmiTelemetryAdapterOptions
} from "@cco/infrastructure";
import { PreflightError, verifyGoldMasterProvenance } from "../certification/preflight.js";
import type {
  AssembleProductionManifestInput,
  ProductionManifestAssembler
} from "../render-job-executor.js";
import {
  getRenderUsageHelp,
  parseRenderCliArgs,
  type RenderCliOptions,
  type RenderCliParsedArgs
} from "./render-options.js";

export type { RenderCliOptions, RenderCliParsedArgs };

export function createProductionManifestAssembler(deps?: {
  readonly pool?: pg.Pool | pg.PoolClient | undefined;
  readonly sceneRepository?: SceneRepository | undefined;
  readonly storyboardCandidateRepository?: StoryboardCandidateRepository | undefined;
  readonly referenceAssetRepository?: ReferenceAssetRepository | undefined;
  readonly hashBytes?: HashBytesPort | undefined;
  readonly databaseUrl?: string | undefined;
}): ProductionManifestAssembler {
  const hashBytes: HashBytesPort = deps?.hashBytes ?? {
    hashBytes: async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
  };
  const pool =
    deps?.pool ??
    (deps?.databaseUrl ? new Pool({ connectionString: deps.databaseUrl }) : undefined);

  const sceneRepository =
    deps?.sceneRepository ?? (pool ? new PostgresSceneRepository(pool) : undefined);
  const storyboardCandidateRepository =
    deps?.storyboardCandidateRepository ??
    (pool ? new PostgresStoryboardCandidateRepository(pool) : undefined);
  const referenceAssetRepository =
    deps?.referenceAssetRepository ??
    (pool ? new PostgresReferenceAssetRepository(pool) : undefined);

  if (!sceneRepository || !storyboardCandidateRepository || !referenceAssetRepository) {
    throw new Error(
      "Cannot construct AssembleGenerationManifest: database connection or repository dependencies are missing"
    );
  }

  const manifestAssembler = new AssembleGenerationManifest({
    hashBytes,
    sceneRepository,
    storyboardCandidateRepository,
    referenceAssetRepository
  });

  return async (input: AssembleProductionManifestInput) => {
    const res = await manifestAssembler.assemble(input);
    return res.manifestPayload;
  };
}

export interface RenderCliDependencies {
  readonly loadCertificationProfile?: typeof loadCertificationProfile;
  readonly readApprovedProvenance?: (filePath: string) => Promise<unknown>;
  readonly collectCertificationProvenance?: typeof collectCertificationProvenance;
  readonly verifyGoldMasterProvenance?: typeof verifyGoldMasterProvenance;
  readonly readWorkflowFile?: (filePath: string) => Promise<string>;
  readonly hashWorkflow?: typeof hashWorkflow;
  readonly createRenderEngine?: (options: ComfyUiRenderEngineAdapterOptions) => RenderEnginePort;
  readonly createGpuLease?: (options: LocalFsGpuLeaseAdapterOptions) => GpuExecutionLeasePort;
  readonly createGpuTelemetry?: (options: NvidiaSmiTelemetryAdapterOptions) => GpuTelemetryPort;
  readonly createUseCase?: (
    renderEngine: RenderEnginePort,
    gpuLease: GpuExecutionLeasePort,
    gpuTelemetry: GpuTelemetryPort
  ) => {
    execute: (input: ExecuteProfileRenderInput) => Promise<ExecuteProfileRenderResult>;
  };
  readonly now?: () => Date;
}

export interface RenderCliIo {
  readonly stdout?: (line: string) => void;
  readonly stderr?: (line: string) => void;
}

export interface RenderCliErrorOutput {
  readonly status: "failed";
  readonly stage: string;
  readonly code: string;
  readonly message: string;
  readonly holder?: GpuLeaseHolder;
  readonly promptId?: string;
  readonly errors?: readonly string[];
}

export class WorkflowHashMismatchError extends Error {
  override readonly name = "WorkflowHashMismatchError";
  constructor(message: string) {
    super(message);
  }
}

function formatErrorOutput(err: unknown, currentStage: string): RenderCliErrorOutput {
  if (err instanceof GpuLeaseUnavailableError) {
    return {
      status: "failed",
      stage: "lease_acquisition",
      code: "gpu_lease_unavailable",
      message: err.message,
      ...(err.holder ? { holder: err.holder } : {})
    };
  }

  if (err instanceof GpuLeaseOwnershipLostError) {
    return {
      status: "failed",
      stage: "lease_release",
      code: "gpu_lease_ownership_lost",
      message: err.message
    };
  }

  if (err instanceof ProfileRenderExecutionError) {
    return {
      status: "failed",
      stage: "render_execution",
      code: err.code,
      message: err.message,
      ...(err.promptId ? { promptId: err.promptId } : {})
    };
  }

  if (err instanceof PreflightError) {
    return {
      status: "failed",
      stage: "preflight",
      code: "preflight_failed",
      message: err.message
    };
  }

  if (err instanceof WorkflowHashMismatchError) {
    return {
      status: "failed",
      stage: "preflight",
      code: "workflow_hash_mismatch",
      message: err.message
    };
  }

  if (err instanceof AggregateError) {
    const flattenedErrors = err.errors
      .slice(0, 10)
      .map((e: unknown) => (e instanceof Error ? e.message : String(e)));
    return {
      status: "failed",
      stage: "render_cleanup",
      code: "aggregate_error",
      message: err.message,
      errors: flattenedErrors
    };
  }

  const errorMessage = err instanceof Error ? err.message : String(err);
  const errorName = err instanceof Error ? err.name : "";

  if (
    errorName === "NvidiaSmiTelemetryError" ||
    errorMessage.toLowerCase().includes("nvidia-smi") ||
    currentStage === "telemetry"
  ) {
    return {
      status: "failed",
      stage: "telemetry",
      code: "telemetry_failed",
      message: errorMessage
    };
  }

  if (currentStage === "argument_parsing") {
    return {
      status: "failed",
      stage: "argument_parsing",
      code: "invalid_arguments",
      message: errorMessage
    };
  }

  if (currentStage === "preflight") {
    return {
      status: "failed",
      stage: "preflight",
      code: "preflight_failed",
      message: errorMessage
    };
  }

  if (
    errorMessage.toLowerCase().includes("queue") ||
    errorMessage.toLowerCase().includes("comfyui")
  ) {
    return {
      status: "failed",
      stage: "render_execution",
      code: (err as { code?: string })?.code ?? "render_queue_failed",
      message: errorMessage
    };
  }

  return {
    status: "failed",
    stage: currentStage || "render_execution",
    code: (err as { code?: string })?.code ?? "render_failed",
    message: errorMessage
  };
}

export async function runRenderCli(
  argv: readonly string[],
  ioOrDeps?: RenderCliIo | RenderCliDependencies,
  dependenciesArg?: RenderCliDependencies
): Promise<number> {
  let io: RenderCliIo | undefined;
  let dependencies: RenderCliDependencies | undefined;

  if (
    ioOrDeps &&
    ("loadCertificationProfile" in ioOrDeps ||
      "readApprovedProvenance" in ioOrDeps ||
      "collectCertificationProvenance" in ioOrDeps ||
      "createRenderEngine" in ioOrDeps ||
      "createGpuLease" in ioOrDeps ||
      "createGpuTelemetry" in ioOrDeps ||
      "createUseCase" in ioOrDeps)
  ) {
    dependencies = ioOrDeps as RenderCliDependencies;
  } else {
    io = ioOrDeps as RenderCliIo | undefined;
    dependencies = dependenciesArg;
  }

  const stdout = io?.stdout ?? ((line: string) => console.log(line));
  const stderr = io?.stderr ?? ((line: string) => console.error(line));

  const loadCertificationProfileFn =
    dependencies?.loadCertificationProfile ?? loadCertificationProfile;
  const readApprovedProvenanceFn =
    dependencies?.readApprovedProvenance ??
    (async (filePath: string) => {
      const content = await readFile(filePath, "utf8");
      return JSON.parse(content);
    });
  const collectCertificationProvenanceFn =
    dependencies?.collectCertificationProvenance ?? collectCertificationProvenance;
  const verifyGoldMasterProvenanceFn =
    dependencies?.verifyGoldMasterProvenance ?? verifyGoldMasterProvenance;
  const readWorkflowFileFn =
    dependencies?.readWorkflowFile ?? ((filePath: string) => readFile(filePath, "utf8"));
  const hashWorkflowFn = dependencies?.hashWorkflow ?? hashWorkflow;
  const now = dependencies?.now ?? (() => new Date());

  let currentStage = "argument_parsing";

  try {
    let parsed: RenderCliParsedArgs;
    try {
      parsed = parseRenderCliArgs(argv);
    } catch (err) {
      const errorOutput = formatErrorOutput(err, currentStage);
      stderr(JSON.stringify(errorOutput));
      return 1;
    }

    if (parsed.kind === "help") {
      stdout(getRenderUsageHelp());
      return 0;
    }

    const { options } = parsed;

    // Phase: Provenance Preflight
    currentStage = "preflight";

    const profile: CertificationProfile = await loadCertificationProfileFn(
      options.manifestPath,
      options.profileId
    );

    if (profile.renderProfileIdentity === null || profile.renderProfileIdentity === undefined) {
      throw new PreflightError(
        `Profile "${profile.id}" does not define renderProfileIdentity in manifest`
      );
    }

    const approvedProvenance: unknown = await readApprovedProvenanceFn(
      options.goldMasterProvenancePath
    );

    const liveProvenance: CertificationProvenanceReport = await collectCertificationProvenanceFn({
      comfyUiDir: options.comfyUiDir,
      profile,
      now,
      onProgress: (event) => {
        const detail = event.detail ? ` (${event.detail})` : "";
        stderr(`[render:provenance] ${event.phase}: ${event.status}${detail}`);
      }
    });

    verifyGoldMasterProvenanceFn({
      approved: approvedProvenance,
      live: liveProvenance,
      profile
    });

    const rawWorkflow = await readWorkflowFileFn(profile.workflowPath);
    const recheckedWorkflowHash = hashWorkflowFn(rawWorkflow);

    if (
      recheckedWorkflowHash !== liveProvenance.workflow.sha256 ||
      recheckedWorkflowHash !== profile.expectedWorkflowHash
    ) {
      throw new WorkflowHashMismatchError(
        `Workflow hash mismatch after collection: rechecked "${recheckedWorkflowHash}", live "${liveProvenance.workflow.sha256}", expected "${profile.expectedWorkflowHash}"`
      );
    }

    let parsedWorkflow: RenderWorkflow;
    try {
      const parsedJson: unknown = JSON.parse(rawWorkflow);
      if (
        typeof parsedJson !== "object" ||
        parsedJson === null ||
        Array.isArray(parsedJson) ||
        Object.keys(parsedJson).length === 0
      ) {
        throw new Error("Workflow must be a non-empty JSON object");
      }
      parsedWorkflow = parsedJson as RenderWorkflow;
    } catch (err) {
      throw new PreflightError(
        `Workflow at "${profile.workflowPath}" must be a valid non-empty JSON object: ${(err as Error).message}`
      );
    }

    if (!liveProvenance.renderProfileProvenance) {
      throw new PreflightError(
        `Live provenance for profile "${profile.id}" is missing renderProfileProvenance`
      );
    }

    const identity: ProfileRenderIdentity = Object.freeze({
      profileId: profile.id,
      renderProfileKey: profile.renderProfileIdentity.key,
      renderProfileVersion: profile.renderProfileIdentity.version,
      engine: profile.engine as "ltx_25" | "flux_schnell",
      workflowSha256: recheckedWorkflowHash,
      modelSha256: liveProvenance.renderProfileProvenance.modelHashes,
      runnerProfile: profile.runnerProfile,
      comfyUiCommit: liveProvenance.git.comfyUiCommit
    });

    // Phase: Adapter Wiring and Use Case Execution
    currentStage = "render_dispatch";

    const renderEngine = dependencies?.createRenderEngine
      ? dependencies.createRenderEngine({
          baseUrl: options.comfyUiUrl,
          timeoutMs: options.renderTimeoutMs
        })
      : new ComfyUiRenderEngineAdapter({
          baseUrl: options.comfyUiUrl,
          timeoutMs: options.renderTimeoutMs
        });

    const gpuLease = dependencies?.createGpuLease
      ? dependencies.createGpuLease({
          lockFilePath: options.leasePath
        })
      : new LocalFsGpuLeaseAdapter({
          lockFilePath: options.leasePath
        });

    const gpuTelemetry = dependencies?.createGpuTelemetry
      ? dependencies.createGpuTelemetry({
          gpuIndex: options.gpuIndex,
          now
        })
      : new NvidiaSmiTelemetryAdapter({
          gpuIndex: options.gpuIndex,
          now
        });

    const useCase = dependencies?.createUseCase
      ? dependencies.createUseCase(renderEngine, gpuLease, gpuTelemetry)
      : new ExecuteProfileRenderUseCase(renderEngine, gpuLease, gpuTelemetry, now);

    const result = await useCase.execute({
      renderJobId: options.renderJobId,
      sceneId: options.sceneId,
      workflow: parsedWorkflow,
      identity
    });

    stdout(JSON.stringify(result));
    return 0;
  } catch (err) {
    const errorOutput = formatErrorOutput(err, currentStage);
    stderr(JSON.stringify(errorOutput));
    return 1;
  }
}

export function isDirectExecution(): boolean {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  void runRenderCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
