import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  CertificationEnvironment,
  CertificationWorkloadIdentity,
  LtxCertificationArtifact
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

export interface CertifyLtxCliOptions {
  readonly comfyUiDir: string;
  readonly comfyUiUrl: string;
  readonly comfyUiPid: number;
  readonly goldMasterProvenancePath: string;
  readonly runId: string;
  readonly manifestPath: string;
  readonly gpuIndex: number;
  readonly outputRoot: string;
  readonly highvram: boolean;
  readonly runnerMode: "dynamicvram" | "highvram";
}

export interface CertifyLtxCliDependencies {
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
    gpuIndex: number;
    comfyUiPid: number;
    sampleIntervalMs: number;
    now?: () => Date;
  }) => TelemetrySamplerControl;
  readonly runCertification?: typeof runCertification;
  readonly writeCertificationArtifacts?: typeof writeCertificationArtifacts;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../");
const DEFAULT_MANIFEST_PATH = resolve(DEFAULT_REPO_ROOT, "templates/provenance.json");
const DEFAULT_OUTPUT_ROOT = resolve(DEFAULT_REPO_ROOT, "certification/ltx-25");
const CERTIFICATION_PROFILE_ID = "ltx-25-720p-97f";
const RUN_ID_REGEX = /^[a-z0-9][a-z0-9._-]*$/;

const KNOWN_FLAGS: ReadonlySet<string> = new Set([
  "--comfyui-dir",
  "--comfyui-url",
  "--comfyui-pid",
  "--gold-master-provenance",
  "--run-id",
  "--manifest",
  "--gpu-index",
  "--output-root",
  "--highvram",
  "--help",
  "-h"
]);

const VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--comfyui-dir",
  "--comfyui-url",
  "--comfyui-pid",
  "--gold-master-provenance",
  "--run-id",
  "--manifest",
  "--gpu-index",
  "--output-root"
]);

function getUsageHelp(): string {
  return `Usage: certify:ltx --comfyui-dir <path> --comfyui-url <url> --comfyui-pid <pid> --gold-master-provenance <path> --run-id <id> [options]

Run LTX 2.5 hardware certification against ComfyUI on NVIDIA RTX 4090.

Required flags:
  --comfyui-dir <path>             Path to ComfyUI installation directory
  --comfyui-url <url>              ComfyUI HTTP/WebSocket base URL (e.g. http://127.0.0.1:8188)
  --comfyui-pid <pid>              PID of the running ComfyUI process (positive integer)
  --gold-master-provenance <path>  Path to approved Gold Master provenance JSON
  --run-id <id>                    Unique certification run identifier (lowercase path-safe string)

Optional flags:
  --manifest <path>                Path to certification profile manifest JSON (default: templates/provenance.json)
  --gpu-index <index>              Zero-based NVIDIA GPU device index (default: 0)
  --output-root <path>             Root directory for certification evidence (default: certification/ltx-25)
  --highvram                       Enable HighVRAM comparator mode (default: DynamicVRAM)
  --help, -h                       Show this help message`;
}

function isFlag(arg: string | undefined): boolean {
  if (arg === undefined) return false;
  if (arg.startsWith("--")) return true;
  if (arg === "-h") return true;
  return false;
}

export function parseCertifyLtxCliArgs(
  argv: readonly string[]
): Readonly<{ kind: "help" }> | Readonly<{ kind: "run"; options: CertifyLtxCliOptions }> {
  if (argv.includes("--help") || argv.includes("-h")) {
    return Object.freeze({ kind: "help" });
  }

  let comfyUiDir: string | undefined;
  let comfyUiUrl: string | undefined;
  let comfyUiPid: number | undefined;
  let goldMasterProvenancePath: string | undefined;
  let runId: string | undefined;
  let manifestPath: string | undefined;
  let gpuIndex: number | undefined;
  let outputRoot: string | undefined;
  let highvram = false;

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

  const runnerMode: "dynamicvram" | "highvram" = highvram ? "highvram" : "dynamicvram";

  const options: CertifyLtxCliOptions = Object.freeze({
    comfyUiDir,
    comfyUiUrl,
    comfyUiPid,
    goldMasterProvenancePath,
    runId,
    manifestPath: manifestPath ?? DEFAULT_MANIFEST_PATH,
    gpuIndex: gpuIndex ?? 0,
    outputRoot: outputRoot ?? DEFAULT_OUTPUT_ROOT,
    highvram,
    runnerMode
  });

  return Object.freeze({
    kind: "run",
    options
  });
}

export async function runCertificationCli(
  argv: readonly string[],
  io?: Readonly<{ stdout?: (line: string) => void; stderr?: (line: string) => void }>,
  dependencies?: CertifyLtxCliDependencies
): Promise<number> {
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
  let parsed: ReturnType<typeof parseCertifyLtxCliArgs>;
  try {
    parsed = parseCertifyLtxCliArgs(argv);
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
    manifestPath,
    gpuIndex,
    outputRoot,
    runnerMode
  } = parsed.options;

  // Phase 2: Preflight validation
  let profile: CertificationProfile;
  try {
    profile = await loadCertificationProfileFn(manifestPath, CERTIFICATION_PROFILE_ID);
  } catch (err) {
    stderr(`[certify:ltx] Failed to load profile: ${(err as Error).message}`);
    return 1;
  }

  let approvedProvenance: unknown;
  try {
    approvedProvenance = await readApprovedProvenanceFn(goldMasterProvenancePath);
  } catch (err) {
    stderr(
      `[certify:ltx] Failed to read approved Gold Master provenance at "${goldMasterProvenancePath}": ${(err as Error).message}`
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
        stderr(`[certify:ltx:provenance] ${event.phase}: ${event.status}${detail}`);
      }
    });
  } catch (err) {
    stderr(`[certify:ltx] Live provenance collection failed: ${(err as Error).message}`);
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
    stderr(`[certify:ltx] Hardware unsupported: ${hwResult.reason}`);
    return 77;
  }
  if (hwResult.status === "refused") {
    stderr(`[certify:ltx] Preflight refused: ${hwResult.reason}`);
    return 1;
  }

  if (envError !== undefined || !environment) {
    stderr(
      `[certify:ltx] Failed to collect runner environment: ${
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
    stderr(`[certify:ltx] Gold Master verification failed: ${(err as Error).message}`);
    return 1;
  }

  try {
    verifyComfyUiMemoryModeFn({
      runnerMode,
      comfyUiArgs: environment.comfyUiArgs
    });
  } catch (err) {
    stderr(`[certify:ltx] ComfyUI memory mode verification failed: ${(err as Error).message}`);
    return 1;
  }

  let parsedWorkflow: Readonly<Record<string, unknown>>;
  try {
    const rawWorkflow = await readWorkflowFileFn(profile.workflowPath);
    const parsed: unknown = JSON.parse(rawWorkflow);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      stderr(`[certify:ltx] Workflow at "${profile.workflowPath}" must be a JSON object`);
      return 1;
    }
    parsedWorkflow = parsed as Readonly<Record<string, unknown>>;
  } catch (err) {
    stderr(`[certify:ltx] Failed to read workflow file: ${(err as Error).message}`);
    return 1;
  }

  // Phase 3: Construct adapters, sampler, workload identity, and render input
  const workloadIdentity: CertificationWorkloadIdentity = {
    profileId: "ltx-25-720p-97f",
    renderProfileKey: profile.renderProfileIdentity!.key,
    renderProfileVersion: profile.renderProfileIdentity!.version,
    engine: "ltx_25",
    width: (profile.baseline.width ?? 1280) as 1280,
    height: (profile.baseline.height ?? 720) as 720,
    frames: (profile.baseline.frames ?? 97) as 97,
    steps: (profile.baseline.steps ?? 8) as 8,
    workflowSha256: liveProvenance.workflow.sha256,
    modelSha256: liveProvenance.renderProfileProvenance?.modelHashes ?? {},
    comfyUiCommit: liveProvenance.git.comfyUiCommit,
    customNodes: liveProvenance.git.customNodes.map((node) => ({
      name: node.name,
      commit: node.commit,
      status: node.status
    }))
  };

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
        gpuTelemetryPort: new NvidiaSmiTelemetryAdapter({ gpuIndex }),
        hostTelemetryPort: new LinuxHostTelemetryAdapter({ pid: comfyUiPid }),
        intervalMs: 200,
        now
      });

  // Phase 4: Execute certification run
  let artifact: LtxCertificationArtifact;
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
        renderProfileKey: profile.renderProfileIdentity!.key,
        workflow: parsedWorkflow
      },
      maxDurationMs: 55000,
      settleDurationMs: 5000,
      now,
      sleep,
      onPhaseChange: (phase) => {
        stderr(`[certify:ltx:phase] ${phase}`);
      }
    });
  } catch (err) {
    stderr(
      `[certify:ltx] Certification execution threw an unexpected error: ${(err as Error).message}`
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
    stderr(`[certify:ltx] Failed to write certification artifacts: ${(err as Error).message}`);
    return 1;
  }

  stdout(
    `[certify:ltx] Certification run "${runId}" completed with status: ${artifact.status.toUpperCase()}`
  );
  stdout(`[certify:ltx] Result JSON: ${writeResult.resultJsonPath}`);
  stdout(`[certify:ltx] Summary Markdown: ${writeResult.summaryMdPath}`);

  if (artifact.status === "failed") {
    if (artifact.failure) {
      stderr(
        `[certify:ltx] Failure: [${artifact.failure.phase}] ${artifact.failure.code} - ${artifact.failure.message}`
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
