import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  TransitionFamilyBaselineSchema,
  type CertificationEnvironment,
  type TransitionFamily,
  type TransitionFamilyBaseline,
  type TransitionSoakArtifact,
  type TransitionSoakThresholds,
  type TransitionWorkloadIdentity
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
  runTransitionSoak,
  TelemetrySampler,
  type RenderEnginePort,
  type TelemetrySamplerControl
} from "@cco/application";
import {
  classifyCertificationHardware,
  verifyComfyUiMemoryMode
} from "../certification/preflight.js";
import { verifyTransitionGoldMasters } from "../certification/transition-preflight.js";
import {
  writeTransitionSoakArtifacts,
  type WriteTransitionSoakArtifactsResult
} from "../certification/transition-artifact-writer.js";

export { type TelemetrySamplerControl };

export interface CertifyTransitionSoakCliOptions {
  readonly comfyUiDir: string;
  readonly comfyUiUrl: string;
  readonly comfyUiPid: number;
  readonly fluxGoldMasterProvenancePath: string;
  readonly ltxGoldMasterProvenancePath: string;
  readonly runId: string;
  readonly manifestPath: string;
  readonly gpuIndex: number;
  readonly outputRoot: string;
  readonly transitionCount: number;
  readonly fluxBaselinePath: string;
  readonly ltxBaselinePath: string;
  readonly thresholds: TransitionSoakThresholds;
}

export interface CertifyTransitionSoakCliDependencies {
  readonly loadCertificationProfile?: typeof loadCertificationProfile;
  readonly readApprovedProvenance?: (filePath: string) => Promise<unknown>;
  readonly readBaselineArtifact?: (filePath: string) => Promise<unknown>;
  readonly collectCertificationProvenance?: typeof collectCertificationProvenance;
  readonly collectRunnerEnvironment?: typeof collectRunnerEnvironment;
  readonly verifyTransitionGoldMasters?: typeof verifyTransitionGoldMasters;
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
  readonly runTransitionSoak?: typeof runTransitionSoak;
  readonly writeTransitionSoakArtifacts?: typeof writeTransitionSoakArtifacts;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_REPO_ROOT = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../../"
);
export const DEFAULT_MANIFEST_PATH = resolve(DEFAULT_REPO_ROOT, "templates/provenance.json");
export const DEFAULT_OUTPUT_ROOT = resolve(DEFAULT_REPO_ROOT, "certification/transition-soak");
export const DEFAULT_FLUX_BASELINE_PATH = resolve(
  DEFAULT_REPO_ROOT,
  "baseline/flux-schnell/result.json"
);
export const DEFAULT_LTX_BASELINE_PATH = resolve(
  DEFAULT_REPO_ROOT,
  "certification/ltx-25/ltx-cert-run-002/result.json"
);
export const DEFAULT_TRANSITION_COUNT = 10;

export const DEFAULT_THRESHOLDS: TransitionSoakThresholds = Object.freeze({
  minPostUnloadFreeVramMb: 23000,
  minHostAvailableMb: 1024,
  maxVramGrowthMb: 256,
  maxHostGrowthMb: 256,
  maxLatencyDegradationPercent: 20,
  cleanupTimeoutMs: 30000,
  cleanupPollIntervalMs: 500
});

const FLUX_PROFILE_ID = "flux-schnell-draft";
const LTX_PROFILE_ID = "ltx-25-720p-97f";
const RUN_ID_REGEX = /^[a-z0-9][a-z0-9._-]*$/;

const KNOWN_FLAGS: ReadonlySet<string> = new Set([
  "--comfyui-dir",
  "--comfyui-url",
  "--comfyui-pid",
  "--flux-gold-master-provenance",
  "--ltx-gold-master-provenance",
  "--run-id",
  "--manifest",
  "--gpu-index",
  "--output-root",
  "--transition-count",
  "--flux-baseline",
  "--ltx-baseline",
  "--min-post-unload-free-vram-mb",
  "--min-host-available-mb",
  "--max-vram-growth-mb",
  "--max-host-growth-mb",
  "--max-latency-degradation-percent",
  "--cleanup-timeout-ms",
  "--cleanup-poll-interval-ms",
  "--highvram",
  "--help",
  "-h"
]);

const VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--comfyui-dir",
  "--comfyui-url",
  "--comfyui-pid",
  "--flux-gold-master-provenance",
  "--ltx-gold-master-provenance",
  "--run-id",
  "--manifest",
  "--gpu-index",
  "--output-root",
  "--transition-count",
  "--flux-baseline",
  "--ltx-baseline",
  "--min-post-unload-free-vram-mb",
  "--min-host-available-mb",
  "--max-vram-growth-mb",
  "--max-host-growth-mb",
  "--max-latency-degradation-percent",
  "--cleanup-timeout-ms",
  "--cleanup-poll-interval-ms"
]);

function getUsageHelp(): string {
  return `Usage: certify:transition-soak --comfyui-dir <path> --comfyui-url <url> --comfyui-pid <pid> --flux-gold-master-provenance <path> --ltx-gold-master-provenance <path> --run-id <id> [options]

Run alternating FLUX <-> LTX transition soak certification against ComfyUI on NVIDIA RTX 4090.

Required flags:
  --comfyui-dir <path>                   Path to ComfyUI installation directory
  --comfyui-url <url>                    ComfyUI HTTP/WebSocket base URL (e.g. http://127.0.0.1:8188)
  --comfyui-pid <pid>                    PID of the running ComfyUI process (positive integer)
  --flux-gold-master-provenance <path>   Path to approved FLUX Gold Master provenance JSON
  --ltx-gold-master-provenance <path>    Path to approved LTX Gold Master provenance JSON
  --run-id <id>                          Unique certification run identifier (lowercase path-safe string)

Optional flags:
  --manifest <path>                      Path to certification profile manifest JSON (default: templates/provenance.json)
  --gpu-index <index>                    Zero-based NVIDIA GPU device index (default: 0)
  --output-root <path>                   Root directory for transition soak evidence (default: certification/transition-soak)
  --transition-count <count>             Number of transitions to execute (integer >= 10, default: 10)
  --flux-baseline <path>                 Path to baseline FLUX single-family artifact JSON
  --ltx-baseline <path>                  Path to baseline LTX single-family artifact JSON
  --min-post-unload-free-vram-mb <mb>    Minimum free VRAM required after unload (default: 23000)
  --min-host-available-mb <mb>           Minimum host RAM available required after unload (default: 1024)
  --max-vram-growth-mb <mb>              Maximum progressive peak VRAM growth allowed (default: 256)
  --max-host-growth-mb <mb>              Maximum progressive peak host RAM growth allowed (default: 256)
  --max-latency-degradation-percent <pct> Maximum median latency degradation allowed (default: 20)
  --cleanup-timeout-ms <ms>              Maximum duration for memory reclaim cleanup polling (default: 30000)
  --cleanup-poll-interval-ms <ms>        Polling interval for memory reclaim cleanup (default: 500)
  --help, -h                             Show this help message`;
}

function isFlag(arg: string | undefined): boolean {
  if (arg === undefined) return false;
  if (arg.startsWith("--")) return true;
  if (arg === "-h") return true;
  return false;
}

export function parseCertifyTransitionSoakCliArgs(
  argv: readonly string[]
):
  Readonly<{ kind: "help" }> | Readonly<{ kind: "run"; options: CertifyTransitionSoakCliOptions }> {
  if (argv.includes("--help") || argv.includes("-h")) {
    return Object.freeze({ kind: "help" });
  }

  let comfyUiDir: string | undefined;
  let comfyUiUrl: string | undefined;
  let comfyUiPid: number | undefined;
  let fluxGoldMasterProvenancePath: string | undefined;
  let ltxGoldMasterProvenancePath: string | undefined;
  let runId: string | undefined;
  let manifestPath: string | undefined;
  let gpuIndex: number | undefined;
  let outputRoot: string | undefined;
  let transitionCount: number | undefined;
  let fluxBaselinePath: string | undefined;
  let ltxBaselinePath: string | undefined;
  let minPostUnloadFreeVramMb: number | undefined;
  let minHostAvailableMb: number | undefined;
  let maxVramGrowthMb: number | undefined;
  let maxHostGrowthMb: number | undefined;
  let maxLatencyDegradationPercent: number | undefined;
  let cleanupTimeoutMs: number | undefined;
  let cleanupPollIntervalMs: number | undefined;

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

      if (flag === "--highvram") {
        throw new Error(
          "Transition soak certification only supports DynamicVRAM mode; --highvram is not supported"
        );
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
        case "--flux-gold-master-provenance":
          fluxGoldMasterProvenancePath = value;
          break;
        case "--ltx-gold-master-provenance":
          ltxGoldMasterProvenancePath = value;
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
        case "--transition-count": {
          const parsedCount = Number(value);
          if (!Number.isInteger(parsedCount) || parsedCount < 10) {
            throw new Error(`--transition-count must be an integer >= 10, received: "${value}"`);
          }
          transitionCount = parsedCount;
          break;
        }
        case "--flux-baseline":
          fluxBaselinePath = value;
          break;
        case "--ltx-baseline":
          ltxBaselinePath = value;
          break;
        case "--min-post-unload-free-vram-mb": {
          const val = Number(value);
          if (!Number.isInteger(val) || val < 0) {
            throw new Error(
              `--min-post-unload-free-vram-mb must be a non-negative integer, received: "${value}"`
            );
          }
          minPostUnloadFreeVramMb = val;
          break;
        }
        case "--min-host-available-mb": {
          const val = Number(value);
          if (!Number.isInteger(val) || val < 0) {
            throw new Error(
              `--min-host-available-mb must be a non-negative integer, received: "${value}"`
            );
          }
          minHostAvailableMb = val;
          break;
        }
        case "--max-vram-growth-mb": {
          const val = Number(value);
          if (!Number.isInteger(val) || val < 0) {
            throw new Error(
              `--max-vram-growth-mb must be a non-negative integer, received: "${value}"`
            );
          }
          maxVramGrowthMb = val;
          break;
        }
        case "--max-host-growth-mb": {
          const val = Number(value);
          if (!Number.isInteger(val) || val < 0) {
            throw new Error(
              `--max-host-growth-mb must be a non-negative integer, received: "${value}"`
            );
          }
          maxHostGrowthMb = val;
          break;
        }
        case "--max-latency-degradation-percent": {
          const val = Number(value);
          if (Number.isNaN(val) || !Number.isFinite(val) || val < 0) {
            throw new Error(
              `--max-latency-degradation-percent must be a non-negative number, received: "${value}"`
            );
          }
          maxLatencyDegradationPercent = val;
          break;
        }
        case "--cleanup-timeout-ms": {
          const val = Number(value);
          if (!Number.isInteger(val) || val <= 0) {
            throw new Error(
              `--cleanup-timeout-ms must be a positive integer, received: "${value}"`
            );
          }
          cleanupTimeoutMs = val;
          break;
        }
        case "--cleanup-poll-interval-ms": {
          const val = Number(value);
          if (!Number.isInteger(val) || val <= 0) {
            throw new Error(
              `--cleanup-poll-interval-ms must be a positive integer, received: "${value}"`
            );
          }
          cleanupPollIntervalMs = val;
          break;
        }
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

  if (!fluxGoldMasterProvenancePath || fluxGoldMasterProvenancePath.trim() === "") {
    throw new Error("Missing required flag: --flux-gold-master-provenance");
  }

  if (!ltxGoldMasterProvenancePath || ltxGoldMasterProvenancePath.trim() === "") {
    throw new Error("Missing required flag: --ltx-gold-master-provenance");
  }

  if (!runId || runId.trim() === "") {
    throw new Error("Missing required flag: --run-id");
  }

  const thresholds: TransitionSoakThresholds = Object.freeze({
    minPostUnloadFreeVramMb: minPostUnloadFreeVramMb ?? DEFAULT_THRESHOLDS.minPostUnloadFreeVramMb,
    minHostAvailableMb: minHostAvailableMb ?? DEFAULT_THRESHOLDS.minHostAvailableMb,
    maxVramGrowthMb: maxVramGrowthMb ?? DEFAULT_THRESHOLDS.maxVramGrowthMb,
    maxHostGrowthMb: maxHostGrowthMb ?? DEFAULT_THRESHOLDS.maxHostGrowthMb,
    maxLatencyDegradationPercent:
      maxLatencyDegradationPercent ?? DEFAULT_THRESHOLDS.maxLatencyDegradationPercent,
    cleanupTimeoutMs: cleanupTimeoutMs ?? DEFAULT_THRESHOLDS.cleanupTimeoutMs,
    cleanupPollIntervalMs: cleanupPollIntervalMs ?? DEFAULT_THRESHOLDS.cleanupPollIntervalMs
  });

  const options: CertifyTransitionSoakCliOptions = Object.freeze({
    comfyUiDir,
    comfyUiUrl,
    comfyUiPid,
    fluxGoldMasterProvenancePath,
    ltxGoldMasterProvenancePath,
    runId,
    manifestPath: manifestPath ?? DEFAULT_MANIFEST_PATH,
    gpuIndex: gpuIndex ?? 0,
    outputRoot: outputRoot ?? DEFAULT_OUTPUT_ROOT,
    transitionCount: transitionCount ?? DEFAULT_TRANSITION_COUNT,
    fluxBaselinePath: fluxBaselinePath ?? DEFAULT_FLUX_BASELINE_PATH,
    ltxBaselinePath: ltxBaselinePath ?? DEFAULT_LTX_BASELINE_PATH,
    thresholds
  });

  return Object.freeze({
    kind: "run",
    options
  });
}

export function parseBaselineArtifact(
  raw: unknown,
  expectedProfileId: string
): TransitionFamilyBaseline {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Baseline artifact for "${expectedProfileId}" must be a JSON object`);
  }

  const obj = raw as Record<string, unknown>;
  const profileId =
    typeof obj["profileId"] === "string"
      ? obj["profileId"]
      : typeof (obj["identity"] as Record<string, unknown> | undefined)?.["profileId"] === "string"
        ? ((obj["identity"] as Record<string, unknown>)["profileId"] as string)
        : undefined;

  if (profileId !== expectedProfileId) {
    throw new Error(
      `Baseline artifact profileId mismatch: expected "${expectedProfileId}", got "${String(profileId)}"`
    );
  }

  const renderObj = obj["render"] as Record<string, unknown> | undefined;
  const telemetryObj = obj["telemetry"] as Record<string, unknown> | undefined;

  const baselineDurationMs =
    typeof obj["baselineDurationMs"] === "number"
      ? obj["baselineDurationMs"]
      : typeof renderObj?.["totalDurationMs"] === "number"
        ? renderObj["totalDurationMs"]
        : undefined;

  const peakVramMb =
    typeof obj["peakVramMb"] === "number"
      ? obj["peakVramMb"]
      : typeof telemetryObj?.["peakVramMb"] === "number"
        ? telemetryObj["peakVramMb"]
        : undefined;

  const peakHostRamUsedMb =
    typeof obj["peakHostRamUsedMb"] === "number"
      ? obj["peakHostRamUsedMb"]
      : typeof telemetryObj?.["peakHostRamUsedMb"] === "number"
        ? telemetryObj["peakHostRamUsedMb"]
        : undefined;

  const peakProcessRssMb =
    typeof obj["peakProcessRssMb"] === "number"
      ? obj["peakProcessRssMb"]
      : typeof telemetryObj?.["peakProcessRssMb"] === "number"
        ? telemetryObj["peakProcessRssMb"]
        : undefined;

  const postUnloadFreeVramMb =
    typeof obj["postUnloadFreeVramMb"] === "number"
      ? obj["postUnloadFreeVramMb"]
      : typeof telemetryObj?.["postUnloadFreeVramMb"] === "number"
        ? telemetryObj["postUnloadFreeVramMb"]
        : undefined;

  const parseResult = TransitionFamilyBaselineSchema.safeParse({
    profileId,
    baselineDurationMs,
    peakVramMb,
    peakHostRamUsedMb,
    peakProcessRssMb,
    postUnloadFreeVramMb
  });

  if (!parseResult.success) {
    throw new Error(
      `Invalid baseline artifact for "${expectedProfileId}": ${parseResult.error.issues.map((i) => i.message).join(", ")}`
    );
  }

  return parseResult.data;
}

export async function runTransitionSoakCli(
  argv: readonly string[],
  io?: Readonly<{ stdout?: (line: string) => void; stderr?: (line: string) => void }>,
  dependencies?: CertifyTransitionSoakCliDependencies
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
  const readBaselineArtifactFn =
    dependencies?.readBaselineArtifact ??
    (async (filePath: string) => {
      const content = await readFile(filePath, "utf8");
      return JSON.parse(content);
    });
  const collectCertificationProvenanceFn =
    dependencies?.collectCertificationProvenance ?? collectCertificationProvenance;
  const collectRunnerEnvironmentFn =
    dependencies?.collectRunnerEnvironment ?? collectRunnerEnvironment;
  const verifyTransitionGoldMastersFn =
    dependencies?.verifyTransitionGoldMasters ?? verifyTransitionGoldMasters;
  const classifyCertificationHardwareFn =
    dependencies?.classifyCertificationHardware ?? classifyCertificationHardware;
  const verifyComfyUiMemoryModeFn =
    dependencies?.verifyComfyUiMemoryMode ?? verifyComfyUiMemoryMode;
  const readWorkflowFileFn =
    dependencies?.readWorkflowFile ?? ((filePath: string) => readFile(filePath, "utf8"));
  const runTransitionSoakFn = dependencies?.runTransitionSoak ?? runTransitionSoak;
  const writeTransitionSoakArtifactsFn =
    dependencies?.writeTransitionSoakArtifacts ?? writeTransitionSoakArtifacts;
  const now = dependencies?.now ?? (() => new Date());
  const sleep = dependencies?.sleep ?? ((ms: number) => new Promise((res) => setTimeout(res, ms)));

  // Phase 1: Parse arguments
  let parsed: ReturnType<typeof parseCertifyTransitionSoakCliArgs>;
  try {
    parsed = parseCertifyTransitionSoakCliArgs(argv);
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
    fluxGoldMasterProvenancePath,
    ltxGoldMasterProvenancePath,
    runId,
    manifestPath,
    gpuIndex,
    outputRoot,
    transitionCount,
    fluxBaselinePath,
    ltxBaselinePath,
    thresholds
  } = parsed.options;

  // Phase 2: Preflight validation
  let fluxProfile: CertificationProfile;
  let ltxProfile: CertificationProfile;
  try {
    fluxProfile = await loadCertificationProfileFn(manifestPath, FLUX_PROFILE_ID);
    ltxProfile = await loadCertificationProfileFn(manifestPath, LTX_PROFILE_ID);
  } catch (err) {
    stderr(
      `[certify:transition-soak] Failed to load certification profiles: ${(err as Error).message}`
    );
    return 1;
  }

  let approvedFluxProvenance: unknown;
  let approvedLtxProvenance: unknown;
  try {
    approvedFluxProvenance = await readApprovedProvenanceFn(fluxGoldMasterProvenancePath);
  } catch (err) {
    stderr(
      `[certify:transition-soak] Failed to read approved FLUX Gold Master provenance at "${fluxGoldMasterProvenancePath}": ${(err as Error).message}`
    );
    return 1;
  }

  try {
    approvedLtxProvenance = await readApprovedProvenanceFn(ltxGoldMasterProvenancePath);
  } catch (err) {
    stderr(
      `[certify:transition-soak] Failed to read approved LTX Gold Master provenance at "${ltxGoldMasterProvenancePath}": ${(err as Error).message}`
    );
    return 1;
  }

  let fluxBaseline: TransitionFamilyBaseline;
  let ltxBaseline: TransitionFamilyBaseline;
  try {
    const rawFluxBaseline = await readBaselineArtifactFn(fluxBaselinePath);
    fluxBaseline = parseBaselineArtifact(rawFluxBaseline, FLUX_PROFILE_ID);
  } catch (err) {
    stderr(
      `[certify:transition-soak] Failed to read or parse FLUX baseline artifact at "${fluxBaselinePath}": ${(err as Error).message}`
    );
    return 1;
  }

  try {
    const rawLtxBaseline = await readBaselineArtifactFn(ltxBaselinePath);
    ltxBaseline = parseBaselineArtifact(rawLtxBaseline, LTX_PROFILE_ID);
  } catch (err) {
    stderr(
      `[certify:transition-soak] Failed to read or parse LTX baseline artifact at "${ltxBaselinePath}": ${(err as Error).message}`
    );
    return 1;
  }

  let liveFluxProvenance: CertificationProvenanceReport;
  let liveLtxProvenance: CertificationProvenanceReport;
  try {
    liveFluxProvenance = await collectCertificationProvenanceFn({
      comfyUiDir,
      profile: fluxProfile,
      now,
      onProgress: (event) => {
        const detail = event.detail ? ` (${event.detail})` : "";
        stderr(
          `[certify:transition-soak:flux:provenance] ${event.phase}: ${event.status}${detail}`
        );
      }
    });
    liveLtxProvenance = await collectCertificationProvenanceFn({
      comfyUiDir,
      profile: ltxProfile,
      now,
      onProgress: (event) => {
        const detail = event.detail ? ` (${event.detail})` : "";
        stderr(`[certify:transition-soak:ltx:provenance] ${event.phase}: ${event.status}${detail}`);
      }
    });
  } catch (err) {
    stderr(
      `[certify:transition-soak] Live provenance collection failed: ${(err as Error).message}`
    );
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
    stderr(`[certify:transition-soak] Hardware unsupported: ${hwResult.reason}`);
    return 77;
  }
  if (hwResult.status === "refused") {
    stderr(`[certify:transition-soak] Preflight refused: ${hwResult.reason}`);
    return 1;
  }

  if (envError !== undefined || !environment) {
    stderr(
      `[certify:transition-soak] Failed to collect runner environment: ${
        envError instanceof Error ? envError.message : String(envError)
      }`
    );
    return 1;
  }

  try {
    verifyTransitionGoldMastersFn({
      profiles: {
        flux: fluxProfile,
        ltx: ltxProfile
      },
      approved: {
        flux: approvedFluxProvenance,
        ltx: approvedLtxProvenance
      },
      live: {
        flux: liveFluxProvenance,
        ltx: liveLtxProvenance
      }
    });
  } catch (err) {
    stderr(`[certify:transition-soak] Gold Master verification failed: ${(err as Error).message}`);
    return 1;
  }

  try {
    verifyComfyUiMemoryModeFn({
      runnerMode: "dynamicvram",
      comfyUiArgs: environment.comfyUiArgs
    });
  } catch (err) {
    stderr(
      `[certify:transition-soak] ComfyUI memory mode verification failed: ${(err as Error).message}`
    );
    return 1;
  }

  let parsedFluxWorkflow: Readonly<Record<string, unknown>>;
  let parsedLtxWorkflow: Readonly<Record<string, unknown>>;
  try {
    const rawFluxWorkflow = await readWorkflowFileFn(fluxProfile.workflowPath);
    const parsedFlux: unknown = JSON.parse(rawFluxWorkflow);
    if (typeof parsedFlux !== "object" || parsedFlux === null || Array.isArray(parsedFlux)) {
      stderr(
        `[certify:transition-soak] Workflow at "${fluxProfile.workflowPath}" must be a JSON object`
      );
      return 1;
    }
    parsedFluxWorkflow = parsedFlux as Readonly<Record<string, unknown>>;

    const rawLtxWorkflow = await readWorkflowFileFn(ltxProfile.workflowPath);
    const parsedLtx: unknown = JSON.parse(rawLtxWorkflow);
    if (typeof parsedLtx !== "object" || parsedLtx === null || Array.isArray(parsedLtx)) {
      stderr(
        `[certify:transition-soak] Workflow at "${ltxProfile.workflowPath}" must be a JSON object`
      );
      return 1;
    }
    parsedLtxWorkflow = parsedLtx as Readonly<Record<string, unknown>>;
  } catch (err) {
    stderr(`[certify:transition-soak] Failed to read workflow file: ${(err as Error).message}`);
    return 1;
  }

  // Phase 3: Construct workload identities
  const fluxIdentity: TransitionWorkloadIdentity = {
    profileId: "flux-schnell-draft",
    engine: "flux_schnell",
    renderProfileKey: fluxProfile.renderProfileIdentity?.key ?? null,
    renderProfileVersion: fluxProfile.renderProfileIdentity?.version ?? null,
    width: fluxProfile.baseline.width ?? 1024,
    height: fluxProfile.baseline.height ?? 1024,
    frames: fluxProfile.baseline.frames ?? 1,
    steps: fluxProfile.baseline.steps ?? 4,
    workflowSha256: liveFluxProvenance.workflow.sha256,
    modelSha256:
      liveFluxProvenance.renderProfileProvenance?.modelHashes ??
      Object.fromEntries(liveFluxProvenance.models.map((m) => [m.key, m.sha256])),
    comfyUiCommit: liveFluxProvenance.git.comfyUiCommit,
    customNodes: liveFluxProvenance.git.customNodes.map((node) => ({
      name: node.name,
      commit: node.commit,
      status: node.status
    })),
    measuredDiskFootprintGb: liveFluxProvenance.disk.modelFootprintGb,
    minFreeDiskGb: fluxProfile.minFreeDiskGb
  };

  const ltxIdentity: TransitionWorkloadIdentity = {
    profileId: "ltx-25-720p-97f",
    engine: "ltx_25",
    renderProfileKey: ltxProfile.renderProfileIdentity?.key ?? "LTX_25_720P_5S_V1",
    renderProfileVersion: ltxProfile.renderProfileIdentity?.version ?? 1,
    width: ltxProfile.baseline.width ?? 1280,
    height: ltxProfile.baseline.height ?? 720,
    frames: ltxProfile.baseline.frames ?? 97,
    steps: ltxProfile.baseline.steps ?? 8,
    workflowSha256: liveLtxProvenance.workflow.sha256,
    modelSha256:
      liveLtxProvenance.renderProfileProvenance?.modelHashes ??
      Object.fromEntries(liveLtxProvenance.models.map((m) => [m.key, m.sha256])),
    comfyUiCommit: liveLtxProvenance.git.comfyUiCommit,
    customNodes: liveLtxProvenance.git.customNodes.map((node) => ({
      name: node.name,
      commit: node.commit,
      status: node.status
    })),
    measuredDiskFootprintGb: liveLtxProvenance.disk.modelFootprintGb,
    minFreeDiskGb: ltxProfile.minFreeDiskGb
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

  // Phase 4: Execute transition soak run
  let artifact: TransitionSoakArtifact;
  try {
    artifact = await runTransitionSoakFn({
      runId,
      runnerProfile: "dynamicvram-offload-v1",
      requestedTransitionCount: transitionCount,
      environment,
      identities: {
        flux: fluxIdentity,
        ltx: ltxIdentity
      },
      baselines: {
        flux: fluxBaseline,
        ltx: ltxBaseline
      },
      workflows: {
        flux: parsedFluxWorkflow,
        ltx: parsedLtxWorkflow
      },
      renderEngine,
      createTelemetrySampler: (_renderIndex: number, _family: TransitionFamily) => {
        return dependencies?.createTelemetrySampler
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
      },
      thresholds,
      sleep,
      now,
      onPhaseChange: (phase, context) => {
        const ctx = context ? ` [render ${context.renderIndex}: ${context.family}]` : "";
        stderr(`[certify:transition-soak:phase] ${phase}${ctx}`);
      }
    });
  } catch (err) {
    stderr(
      `[certify:transition-soak] Transition soak execution threw an unexpected error: ${(err as Error).message}`
    );
    return 1;
  }

  // Phase 5: Publish artifacts atomically
  let writeResult: WriteTransitionSoakArtifactsResult;
  try {
    writeResult = await writeTransitionSoakArtifactsFn({
      outputRoot,
      artifact,
      repoRoot: DEFAULT_REPO_ROOT
    });
  } catch (err) {
    stderr(
      `[certify:transition-soak] Failed to write transition soak artifacts: ${(err as Error).message}`
    );
    return 1;
  }

  stdout(
    `[certify:transition-soak] Transition soak run "${runId}" completed with status: ${artifact.status.toUpperCase()}`
  );
  stdout(
    `[certify:transition-soak] Result JSON: ${writeResult.relativeResultJsonPath ?? writeResult.resultJsonPath}`
  );
  stdout(
    `[certify:transition-soak] Summary Markdown: ${writeResult.relativeSummaryMdPath ?? writeResult.summaryMdPath}`
  );

  if (artifact.status === "failed") {
    if (artifact.failure) {
      stderr(
        `[certify:transition-soak] Failure: [${artifact.failure.phase}] ${artifact.failure.code} - ${artifact.failure.message}`
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
  void runTransitionSoakCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
