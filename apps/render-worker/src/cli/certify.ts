import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  CertificationEnvironment,
  CertificationWorkloadIdentity,
  CertificationArtifact
} from "@cco/contracts";
import {
  collectCertificationProvenance,
  collectRunnerEnvironment,
  ComfyUiRenderEngineAdapter,
  LinuxHostTelemetryAdapter,
  loadCertificationProfile,
  NvidiaSmiTelemetryAdapter,
  type CertificationProfile,
  type CertificationProvenanceReport,
  type ComfyUiRenderEngineAdapterOptions
} from "@cco/infrastructure";
import {
  runCertification,
  TelemetrySampler,
  type RenderEnginePort,
  type TelemetrySamplerControl
} from "@cco/application";
import {
  classifyCertificationHardware,
  verifyComfyUiMemoryMode,
  verifyGoldMasterProvenance
} from "../certification/preflight.js";
import {
  writeCertificationArtifacts,
  type WriteCertificationArtifactsResult
} from "../certification/artifact-writer.js";

export { type TelemetrySamplerControl };

export interface CertifyCliOptions {
  readonly comfyUiDir: string;
  readonly comfyUiUrl: string;
  readonly comfyUiPid: number;
  readonly goldMasterProvenancePath: string;
  readonly profileId: string;
  readonly runId?: string | undefined;
  readonly manifestPath: string;
  readonly gpuIndex: number;
  readonly outputRoot?: string | undefined;
  readonly runnerMode: "dynamicvram" | "highvram";
}

export type CertifyCliParsedArgs =
  { readonly kind: "run"; readonly options: CertifyCliOptions } | { readonly kind: "help" };

export interface CertifyCliDependencies {
  readonly loadCertificationProfile?: typeof loadCertificationProfile;
  readonly readApprovedProvenance?: (filePath: string) => Promise<unknown>;
  readonly collectCertificationProvenance?: typeof collectCertificationProvenance;
  readonly collectRunnerEnvironment?: typeof collectRunnerEnvironment;
  readonly verifyGoldMasterProvenance?: typeof verifyGoldMasterProvenance;
  readonly classifyCertificationHardware?: typeof classifyCertificationHardware;
  readonly verifyComfyUiMemoryMode?: typeof verifyComfyUiMemoryMode;
  readonly readWorkflowFile?: (filePath: string) => Promise<string>;
  readonly createRenderEngine?: (options: ComfyUiRenderEngineAdapterOptions) => RenderEnginePort;
  readonly createTelemetrySampler?: (options: {
    readonly gpuIndex: number;
    readonly comfyUiPid: number;
    readonly sampleIntervalMs: number;
    readonly now?: () => Date;
  }) => TelemetrySamplerControl;
  readonly runCertification?: typeof runCertification;
  readonly writeCertificationArtifacts?: typeof writeCertificationArtifacts;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly stdout?: (msg: string) => void;
  readonly stderr?: (msg: string) => void;
}

const DEFAULT_PROFILE_ID = "ltx-25-720p-97f";
const DEFAULT_REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../../../../../");
const DEFAULT_MANIFEST_PATH = resolve(DEFAULT_REPO_ROOT, "templates/provenance.json");

export function getUsageHelp(): string {
  return `Usage: certify [options]

Executes a deterministic hardware certification run against a running ComfyUI instance.

Options:
  --comfyui-dir <path>             Path to ComfyUI installation directory (required)
  --comfyui-url <url>              Base HTTP URL of running ComfyUI instance (required)
  --comfyui-pid <pid>              Process ID of running ComfyUI process (required)
  --gold-master-provenance <path>  Path to approved Gold Master provenance JSON report (required)
  --profile <profile-id>           Profile ID to certify (default: ltx-25-720p-97f)
  --run-id <id>                    Run identifier for evidence directory (default: auto-generated)
  --manifest <path>                Path to templates/provenance.json (default: templates/provenance.json)
  --gpu-index <index>              Target GPU index for nvidia-smi telemetry (default: 0)
  --output-root <dir>              Directory to place run evidence directory in (default: certification/<engine-folder>)
  --runner-mode <mode>             Memory runner mode: dynamicvram | highvram (default: dynamicvram)
  --help, -h                       Display this help message
`;
}

function parseNumberArg(val: string, argName: string): number {
  const num = parseInt(val, 10);
  if (isNaN(num) || !Number.isInteger(num) || num < 0) {
    throw new Error(`Invalid value for ${argName}: "${val}". Must be a non-negative integer.`);
  }
  return num;
}

function parseRunnerModeArg(val: string): "dynamicvram" | "highvram" {
  if (val === "dynamicvram" || val === "highvram") {
    return val;
  }
  throw new Error(`Invalid --runner-mode: "${val}". Must be "dynamicvram" or "highvram".`);
}

export function parseCertifyCliArgs(argv: readonly string[]): CertifyCliParsedArgs {
  let comfyUiDir: string | undefined;
  let comfyUiUrl: string | undefined;
  let comfyUiPid: number | undefined;
  let goldMasterProvenancePath: string | undefined;
  let profileId: string = DEFAULT_PROFILE_ID;
  let runId: string | undefined;
  let manifestPath: string = DEFAULT_MANIFEST_PATH;
  let gpuIndex = 0;
  let outputRoot: string | undefined;
  let runnerMode: "dynamicvram" | "highvram" = "dynamicvram";

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === undefined) {
      break;
    }
    if (arg === "--help" || arg === "-h") {
      return { kind: "help" };
    }

    if (arg === "--comfyui-dir") {
      i++;
      const nextArg = argv[i];
      if (nextArg === undefined || nextArg.startsWith("--")) {
        throw new Error("Missing value for --comfyui-dir");
      }
      comfyUiDir = nextArg;
    } else if (arg.startsWith("--comfyui-dir=")) {
      comfyUiDir = arg.slice("--comfyui-dir=".length);
    } else if (arg === "--comfyui-url") {
      i++;
      const nextArg = argv[i];
      if (nextArg === undefined || nextArg.startsWith("--")) {
        throw new Error("Missing value for --comfyui-url");
      }
      comfyUiUrl = nextArg;
    } else if (arg.startsWith("--comfyui-url=")) {
      comfyUiUrl = arg.slice("--comfyui-url=".length);
    } else if (arg === "--comfyui-pid") {
      i++;
      const nextArg = argv[i];
      if (nextArg === undefined || nextArg.startsWith("--")) {
        throw new Error("Missing value for --comfyui-pid");
      }
      comfyUiPid = parseNumberArg(nextArg, "--comfyui-pid");
    } else if (arg.startsWith("--comfyui-pid=")) {
      comfyUiPid = parseNumberArg(arg.slice("--comfyui-pid=".length), "--comfyui-pid");
    } else if (arg === "--gold-master-provenance") {
      i++;
      const nextArg = argv[i];
      if (nextArg === undefined || nextArg.startsWith("--")) {
        throw new Error("Missing value for --gold-master-provenance");
      }
      goldMasterProvenancePath = nextArg;
    } else if (arg.startsWith("--gold-master-provenance=")) {
      goldMasterProvenancePath = arg.slice("--gold-master-provenance=".length);
    } else if (arg === "--profile") {
      i++;
      const nextArg = argv[i];
      if (nextArg === undefined || nextArg.startsWith("--")) {
        throw new Error("Missing value for --profile");
      }
      profileId = nextArg;
    } else if (arg.startsWith("--profile=")) {
      profileId = arg.slice("--profile=".length);
    } else if (arg === "--run-id") {
      i++;
      const nextArg = argv[i];
      if (nextArg === undefined || nextArg.startsWith("--")) {
        throw new Error("Missing value for --run-id");
      }
      runId = nextArg;
    } else if (arg.startsWith("--run-id=")) {
      runId = arg.slice("--run-id=".length);
    } else if (arg === "--manifest") {
      i++;
      const nextArg = argv[i];
      if (nextArg === undefined || nextArg.startsWith("--")) {
        throw new Error("Missing value for --manifest");
      }
      manifestPath = nextArg;
    } else if (arg.startsWith("--manifest=")) {
      manifestPath = arg.slice("--manifest=".length);
    } else if (arg === "--gpu-index") {
      i++;
      const nextArg = argv[i];
      if (nextArg === undefined || nextArg.startsWith("--")) {
        throw new Error("Missing value for --gpu-index");
      }
      gpuIndex = parseNumberArg(nextArg, "--gpu-index");
    } else if (arg.startsWith("--gpu-index=")) {
      gpuIndex = parseNumberArg(arg.slice("--gpu-index=".length), "--gpu-index");
    } else if (arg === "--output-root") {
      i++;
      const nextArg = argv[i];
      if (nextArg === undefined || nextArg.startsWith("--")) {
        throw new Error("Missing value for --output-root");
      }
      outputRoot = nextArg;
    } else if (arg.startsWith("--output-root=")) {
      outputRoot = arg.slice("--output-root=".length);
    } else if (arg === "--runner-mode") {
      i++;
      const nextArg = argv[i];
      if (nextArg === undefined || nextArg.startsWith("--")) {
        throw new Error("Missing value for --runner-mode");
      }
      runnerMode = parseRunnerModeArg(nextArg);
    } else if (arg.startsWith("--runner-mode=")) {
      runnerMode = parseRunnerModeArg(arg.slice("--runner-mode=".length));
    } else {
      throw new Error(`Unknown option: "${arg}". Run with --help to see valid options.`);
    }
    i++;
  }

  const missing: string[] = [];
  if (!comfyUiDir) missing.push("--comfyui-dir");
  if (!comfyUiUrl) missing.push("--comfyui-url");
  if (comfyUiPid === undefined) missing.push("--comfyui-pid");
  if (!goldMasterProvenancePath) missing.push("--gold-master-provenance");

  if (missing.length > 0) {
    throw new Error(`Missing required option(s): ${missing.join(", ")}`);
  }

  return {
    kind: "run",
    options: {
      comfyUiDir: comfyUiDir!,
      comfyUiUrl: comfyUiUrl!,
      comfyUiPid: comfyUiPid!,
      goldMasterProvenancePath: goldMasterProvenancePath!,
      profileId,
      runId,
      manifestPath,
      gpuIndex,
      outputRoot,
      runnerMode
    }
  };
}

export const parseCertifyLtxCliArgs = parseCertifyCliArgs;
export type CertifyLtxCliOptions = CertifyCliOptions;
export type CertifyLtxCliParsedArgs = CertifyCliParsedArgs;
export type CertifyLtxCliDependencies = CertifyCliDependencies;

function generateDefaultRunId(profile: CertificationProfile, now: () => Date): string {
  const ts = now().toISOString().replace(/[:.]/g, "-").toLowerCase();
  return `${profile.id}-cert-${ts}`;
}

export async function runCertificationCli(
  argv: readonly string[],
  dependencies?: CertifyCliDependencies
): Promise<number> {
  const stdout = dependencies?.stdout ?? ((msg: string) => console.log(msg));
  const stderr = dependencies?.stderr ?? ((msg: string) => console.error(msg));
  const loadCertificationProfileFn =
    dependencies?.loadCertificationProfile ?? loadCertificationProfile;
  const readApprovedProvenanceFn =
    dependencies?.readApprovedProvenance ??
    (async (filePath: string) => JSON.parse(await readFile(filePath, "utf8")));
  const collectCertificationProvenanceFn =
    dependencies?.collectCertificationProvenance ?? collectCertificationProvenance;
  const collectRunnerEnvironmentFn =
    dependencies?.collectRunnerEnvironment ?? collectRunnerEnvironment;
  const verifyGoldMasterProvenanceFn =
    dependencies?.verifyGoldMasterProvenance ?? verifyGoldMasterProvenance;
  const classifyCertificationHardwareFn =
    dependencies?.classifyCertificationHardware ?? classifyCertificationHardware;
  const verifyComfyUiMemoryModeFn =
    dependencies?.verifyComfyUiMemoryMode ?? verifyComfyUiMemoryMode;
  const readWorkflowFileFn =
    dependencies?.readWorkflowFile ?? ((filePath: string) => readFile(filePath, "utf8"));
  const runCertificationFn = dependencies?.runCertification ?? runCertification;
  const writeCertificationArtifactsFn =
    dependencies?.writeCertificationArtifacts ?? writeCertificationArtifacts;
  const now = dependencies?.now ?? (() => new Date());
  const sleep = dependencies?.sleep ?? ((ms: number) => new Promise((res) => setTimeout(res, ms)));

  // Phase 1: Parse arguments
  let parsed: ReturnType<typeof parseCertifyCliArgs>;
  try {
    parsed = parseCertifyCliArgs(argv);
  } catch (err) {
    stderr((err as Error).message);
    return 1;
  }

  if (parsed.kind === "help") {
    stdout(getUsageHelp());
    return 0;
  }

  const {
    comfyUiDir,
    comfyUiUrl,
    comfyUiPid,
    goldMasterProvenancePath,
    profileId,
    manifestPath,
    gpuIndex,
    runnerMode
  } = parsed.options;

  // Phase 2: Preflight validation
  let profile: CertificationProfile;
  try {
    profile = await loadCertificationProfileFn(manifestPath, profileId);
  } catch (err) {
    stderr(`[certify] Failed to load profile: ${(err as Error).message}`);
    return 1;
  }

  const runId = parsed.options.runId ?? generateDefaultRunId(profile, now);
  const defaultOutputRoot =
    profile.engine === "flux_schnell"
      ? resolve(DEFAULT_REPO_ROOT, "certification/flux-schnell")
      : resolve(DEFAULT_REPO_ROOT, "certification/ltx-25");
  const outputRoot = parsed.options.outputRoot ?? defaultOutputRoot;

  let approvedProvenance: unknown;
  try {
    approvedProvenance = await readApprovedProvenanceFn(goldMasterProvenancePath);
  } catch (err) {
    stderr(
      `[certify] Failed to read approved Gold Master provenance at "${goldMasterProvenancePath}": ${(err as Error).message}`
    );
    return 1;
  }

  let liveProvenance: CertificationProvenanceReport;
  try {
    liveProvenance = await collectCertificationProvenanceFn({
      comfyUiDir,
      profile,
      now,
      onProgress: (event) => {
        const detail = event.detail ? ` (${event.detail})` : "";
        stderr(`[certify:provenance] ${event.phase}: ${event.status}${detail}`);
      }
    });
  } catch (err) {
    stderr(`[certify] Live provenance collection failed: ${(err as Error).message}`);
    return 1;
  }

  let environment: CertificationEnvironment | undefined;
  let envError: unknown;
  try {
    environment = await collectRunnerEnvironmentFn({
      comfyUiPid,
      gpuIndex
    });
  } catch (err) {
    envError = err;
  }

  // Classify hardware support before proceeding
  const hwResult = classifyCertificationHardwareFn(envError ?? environment);
  if (hwResult.status === "unsupported") {
    stderr(`[certify] Hardware unsupported: ${hwResult.reason}`);
    return 77;
  }
  if (hwResult.status === "refused") {
    stderr(`[certify] Preflight refused: ${hwResult.reason}`);
    return 1;
  }

  if (envError !== undefined || !environment) {
    stderr(
      `[certify] Failed to collect runner environment: ${
        envError instanceof Error ? envError.message : String(envError)
      }`
    );
    return 1;
  }

  try {
    verifyGoldMasterProvenanceFn({
      approved: approvedProvenance,
      live: liveProvenance,
      profile
    });
  } catch (err) {
    stderr(`[certify] Gold Master verification failed: ${(err as Error).message}`);
    return 1;
  }

  try {
    verifyComfyUiMemoryModeFn({
      runnerMode,
      comfyUiArgs: environment.comfyUiArgs
    });
  } catch (err) {
    stderr(`[certify] ComfyUI memory mode verification failed: ${(err as Error).message}`);
    return 1;
  }

  let parsedWorkflow: Readonly<Record<string, unknown>>;
  try {
    const rawWorkflow = await readWorkflowFileFn(profile.workflowPath);
    const parsedJson: unknown = JSON.parse(rawWorkflow);
    if (typeof parsedJson !== "object" || parsedJson === null || Array.isArray(parsedJson)) {
      stderr(`[certify] Workflow at "${profile.workflowPath}" must be a JSON object`);
      return 1;
    }
    parsedWorkflow = parsedJson as Readonly<Record<string, unknown>>;
  } catch (err) {
    stderr(`[certify] Failed to read workflow file: ${(err as Error).message}`);
    return 1;
  }

  // Phase 3: Construct adapters, sampler, workload identity, and render input
  let workloadIdentity: CertificationWorkloadIdentity;
  const customNodes = liveProvenance.git.customNodes.map((node) => ({
    name: node.name,
    commit: node.commit,
    status: node.status
  }));

  const modelSha256Map =
    liveProvenance.renderProfileProvenance?.modelHashes ??
    Object.fromEntries(liveProvenance.models.map((m) => [m.key, m.sha256]));

  if (profile.engine === "ltx_25") {
    workloadIdentity = {
      profileId: "ltx-25-720p-97f",
      renderProfileKey: (profile.renderProfileIdentity?.key ??
        "LTX_25_720P_5S_V1") as "LTX_25_720P_5S_V1",
      renderProfileVersion: 1,
      engine: "ltx_25",
      width: 1280,
      height: 720,
      frames: 97,
      steps: 8,
      workflowSha256: liveProvenance.workflow.sha256,
      modelSha256: modelSha256Map,
      comfyUiCommit: liveProvenance.git.comfyUiCommit,
      customNodes
    };
  } else if (profile.engine === "flux_schnell") {
    workloadIdentity = {
      profileId: "flux-schnell-draft",
      renderProfileKey: (profile.renderProfileIdentity?.key ??
        "FLUX_SCHNELL_DRAFT_V1") as "FLUX_SCHNELL_DRAFT_V1",
      renderProfileVersion: 1,
      engine: "flux_schnell",
      width: 1024,
      height: 1024,
      frames: 1,
      steps: 4,
      workflowSha256: liveProvenance.workflow.sha256,
      modelSha256: modelSha256Map,
      comfyUiCommit: liveProvenance.git.comfyUiCommit,
      customNodes
    };
  } else {
    stderr(`[certify] Unsupported certification profile engine: "${profile.engine}"`);
    return 1;
  }

  const renderEngine = dependencies?.createRenderEngine
    ? dependencies.createRenderEngine({
        baseUrl: comfyUiUrl,
        timeoutMs: 300_000
      })
    : new ComfyUiRenderEngineAdapter({
        baseUrl: comfyUiUrl,
        timeoutMs: 300_000
      });

  const telemetrySampler = dependencies?.createTelemetrySampler
    ? dependencies.createTelemetrySampler({
        gpuIndex,
        comfyUiPid,
        sampleIntervalMs: 200,
        now
      })
    : new TelemetrySampler({
        gpuTelemetryPort: new NvidiaSmiTelemetryAdapter({ gpuIndex, now }),
        hostTelemetryPort: new LinuxHostTelemetryAdapter({ pid: comfyUiPid, now }),
        intervalMs: 200,
        now
      });

  const maxDurationMs = profile.engine === "flux_schnell" ? 30000 : 55000;

  // Phase 4: Execute certification run
  let artifact: CertificationArtifact;
  try {
    artifact = await runCertificationFn({
      runId,
      runnerMode,
      identity: workloadIdentity,
      environment,
      renderEngine,
      telemetrySampler,
      renderInput: {
        renderJobId: `certification-${runId}`,
        sceneId: `certification-${profile.id}`,
        renderProfileKey: workloadIdentity.renderProfileKey,
        workflow: parsedWorkflow
      },
      maxDurationMs,
      settleDurationMs: 5000,
      now,
      sleep,
      onPhaseChange: (phase) => {
        stderr(`[certify:phase] ${phase}`);
      }
    });
  } catch (err) {
    stderr(
      `[certify] Certification execution threw an unexpected error: ${(err as Error).message}`
    );
    return 1;
  }

  // Phase 5: Publish artifacts atomically
  let writeResult: WriteCertificationArtifactsResult;
  try {
    writeResult = await writeCertificationArtifactsFn({
      outputRoot,
      artifact,
      repoRoot: DEFAULT_REPO_ROOT
    });
  } catch (err) {
    stderr(`[certify] Failed to write certification artifacts: ${(err as Error).message}`);
    return 1;
  }

  stdout(
    `[certify] Certification run "${runId}" completed with status: ${artifact.status.toUpperCase()}`
  );
  stdout(`[certify] Result JSON: ${writeResult.resultJsonPath}`);
  stdout(`[certify] Summary Markdown: ${writeResult.summaryMdPath}`);

  if (artifact.status === "failed") {
    if (artifact.failure) {
      stderr(
        `[certify] Failure: [${artifact.failure.phase}] ${artifact.failure.code} - ${artifact.failure.message}`
      );
    }
    return 1;
  }

  return 0;
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
  void runCertificationCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
