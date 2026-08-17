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
  readonly runId: string;
  readonly profileId: string;
  readonly manifestPath: string;
  readonly gpuIndex: number;
  readonly outputRoot: string;
  readonly runnerMode: "dynamicvram" | "highvram";
  readonly highvram: boolean;
}

export type CertifyCliParsedArgs =
  Readonly<{ kind: "help" }> | Readonly<{ kind: "run"; options: CertifyCliOptions }>;

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
}

const DEFAULT_PROFILE_ID = "ltx-25-720p-97f";
const DEFAULT_REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../");
const DEFAULT_MANIFEST_PATH = resolve(DEFAULT_REPO_ROOT, "templates/provenance.json");
const RUN_ID_REGEX = /^[a-z0-9][a-z0-9._-]*$/;

const KNOWN_FLAGS: ReadonlySet<string> = new Set([
  "--comfyui-dir",
  "--comfyui-url",
  "--comfyui-pid",
  "--gold-master-provenance",
  "--run-id",
  "--profile",
  "--manifest",
  "--gpu-index",
  "--output-root",
  "--highvram",
  "--runner-mode",
  "--help",
  "-h"
]);

const VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--comfyui-dir",
  "--comfyui-url",
  "--comfyui-pid",
  "--gold-master-provenance",
  "--run-id",
  "--profile",
  "--manifest",
  "--gpu-index",
  "--output-root",
  "--runner-mode"
]);

export function getUsageHelp(): string {
  return `Usage: certify --comfyui-dir <path> --comfyui-url <url> --comfyui-pid <pid> --gold-master-provenance <path> --run-id <id> [options]

Run hardware certification against ComfyUI on NVIDIA RTX 4090.

Required flags:
  --comfyui-dir <path>             Path to ComfyUI installation directory
  --comfyui-url <url>              ComfyUI HTTP/WebSocket base URL (e.g. http://127.0.0.1:8188)
  --comfyui-pid <pid>              PID of the running ComfyUI process (positive integer)
  --gold-master-provenance <path>  Path to approved Gold Master provenance JSON
  --run-id <id>                    Unique certification run identifier (lowercase path-safe string)

Optional flags:
  --profile <profile-id>           Profile ID to certify (default: ltx-25-720p-97f)
  --manifest <path>                Path to certification profile manifest JSON (default: templates/provenance.json)
  --gpu-index <index>              Zero-based NVIDIA GPU device index (default: 0)
  --output-root <path>             Root directory for certification evidence (default: certification/<engine-folder>)
  --highvram                       Enable HighVRAM comparator mode (default: DynamicVRAM)
  --runner-mode <mode>             Memory runner mode: dynamicvram | highvram (default: dynamicvram)
  --help, -h                       Show this help message`;
}

function isFlag(arg: string | undefined): boolean {
  if (arg === undefined) return false;
  if (arg.startsWith("--")) return true;
  if (arg === "-h") return true;
  return false;
}

export function parseCertifyCliArgs(
  argv: readonly string[]
): Readonly<{ kind: "help" }> | Readonly<{ kind: "run"; options: CertifyCliOptions }> {
  if (argv.includes("--help") || argv.includes("-h")) {
    return Object.freeze({ kind: "help" });
  }

  let comfyUiDir: string | undefined;
  let comfyUiUrl: string | undefined;
  let comfyUiPid: number | undefined;
  let goldMasterProvenancePath: string | undefined;
  let runId: string | undefined;
  let profileId: string = DEFAULT_PROFILE_ID;
  let manifestPath: string | undefined;
  let gpuIndex: number | undefined;
  let outputRoot: string | undefined;
  let highvram = false;
  let runnerMode: "dynamicvram" | "highvram" | undefined;

  const seenFlags = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined || arg === "--") {
      continue;
    }

    if (arg.startsWith("--") || arg.startsWith("-")) {
      const equalsIndex = arg.indexOf("=");
      let flag: string;
      let value: string | undefined;

      if (equalsIndex !== -1) {
        flag = arg.slice(0, equalsIndex);
        value = arg.slice(equalsIndex + 1);
      } else {
        flag = arg;
        if (VALUE_FLAGS.has(flag)) {
          const nextArg = argv[i + 1];
          if (nextArg !== undefined && !isFlag(nextArg)) {
            value = nextArg;
            i++;
          }
        }
      }

      if (!KNOWN_FLAGS.has(flag)) {
        throw new Error(`Unknown flag: ${flag}`);
      }

      if (seenFlags.has(flag)) {
        throw new Error(`Duplicate flag: ${flag}`);
      }
      seenFlags.add(flag);

      if (VALUE_FLAGS.has(flag)) {
        if (value === undefined || value.trim() === "") {
          throw new Error(`Flag "${flag}" requires a value`);
        }
      }

      switch (flag) {
        case "--comfyui-dir":
          comfyUiDir = value;
          break;
        case "--comfyui-url":
          comfyUiUrl = value;
          break;
        case "--comfyui-pid": {
          const parsedPid = Number(value);
          if (!Number.isInteger(parsedPid) || parsedPid <= 0) {
            throw new Error(`--comfyui-pid must be a positive integer, received: "${value}"`);
          }
          comfyUiPid = parsedPid;
          break;
        }
        case "--gold-master-provenance":
          goldMasterProvenancePath = value;
          break;
        case "--run-id": {
          const trimmedRunId = value!.trim();
          if (
            !RUN_ID_REGEX.test(trimmedRunId) ||
            trimmedRunId.includes("..") ||
            trimmedRunId.includes("/") ||
            trimmedRunId.includes("\\")
          ) {
            throw new Error(
              `Invalid --run-id "${value}": must be a lowercase path-safe string matching ^[a-z0-9][a-z0-9._-]*$`
            );
          }
          runId = trimmedRunId;
          break;
        }
        case "--profile":
          profileId = value!;
          break;
        case "--manifest":
          manifestPath = value;
          break;
        case "--gpu-index": {
          const parsedIndex = Number(value);
          if (!Number.isInteger(parsedIndex) || parsedIndex < 0) {
            throw new Error(`--gpu-index must be a non-negative integer, received: "${value}"`);
          }
          gpuIndex = parsedIndex;
          break;
        }
        case "--output-root":
          outputRoot = value;
          break;
        case "--highvram":
          highvram = true;
          break;
        case "--runner-mode":
          if (value === "dynamicvram" || value === "highvram") {
            runnerMode = value;
          } else {
            throw new Error(
              `Invalid --runner-mode: "${value}". Must be "dynamicvram" or "highvram".`
            );
          }
          break;
      }
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!comfyUiDir || comfyUiDir.trim() === "") {
    throw new Error("Missing required flag: --comfyui-dir");
  }

  if (!comfyUiUrl || comfyUiUrl.trim() === "") {
    throw new Error("Missing required flag: --comfyui-url");
  }

  if (comfyUiPid === undefined) {
    throw new Error("Missing required flag: --comfyui-pid");
  }

  if (!goldMasterProvenancePath || goldMasterProvenancePath.trim() === "") {
    throw new Error("Missing required flag: --gold-master-provenance");
  }

  if (!runId || runId.trim() === "") {
    throw new Error("Missing required flag: --run-id");
  }

  const effectiveRunnerMode: "dynamicvram" | "highvram" =
    runnerMode ?? (highvram ? "highvram" : "dynamicvram");

  const effectiveOutputRoot =
    outputRoot ??
    (profileId === "flux-schnell-draft"
      ? resolve(DEFAULT_REPO_ROOT, "certification/flux-schnell")
      : resolve(DEFAULT_REPO_ROOT, "certification/ltx-25"));

  return Object.freeze({
    kind: "run" as const,
    options: Object.freeze({
      comfyUiDir,
      comfyUiUrl,
      comfyUiPid,
      goldMasterProvenancePath,
      runId,
      profileId,
      manifestPath: manifestPath ?? DEFAULT_MANIFEST_PATH,
      gpuIndex: gpuIndex ?? 0,
      outputRoot: effectiveOutputRoot,
      runnerMode: effectiveRunnerMode,
      highvram: effectiveRunnerMode === "highvram"
    })
  });
}

export const parseCertifyLtxCliArgs = parseCertifyCliArgs;
export type CertifyLtxCliOptions = CertifyCliOptions;
export type CertifyLtxCliParsedArgs = CertifyCliParsedArgs;
export type CertifyLtxCliDependencies = CertifyCliDependencies;

export async function runCertificationCli(
  argv: readonly string[],
  ioOrDeps?:
    | Readonly<{ stdout?: (line: string) => void; stderr?: (line: string) => void }>
    | CertifyCliDependencies,
  dependenciesArg?: CertifyCliDependencies
): Promise<number> {
  let io:
    Readonly<{ stdout?: (line: string) => void; stderr?: (line: string) => void }> | undefined;
  let dependencies: CertifyCliDependencies | undefined;

  if (
    ioOrDeps &&
    ("loadCertificationProfile" in ioOrDeps ||
      "runCertification" in ioOrDeps ||
      "collectRunnerEnvironment" in ioOrDeps)
  ) {
    dependencies = ioOrDeps as CertifyCliDependencies;
  } else {
    io = ioOrDeps as
      Readonly<{ stdout?: (line: string) => void; stderr?: (line: string) => void }> | undefined;
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
  let parsed: CertifyCliParsedArgs;
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
    runId,
    profileId,
    manifestPath,
    gpuIndex,
    outputRoot,
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
