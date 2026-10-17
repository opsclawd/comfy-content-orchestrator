import { readFile, readlink, readdir } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  findRepositoryRoot,
  MinimaxH3ExperimentService,
  compareMinimaxH3Experiments,
  listAttentionCatalogEntries,
  listSamplingRecipes,
  validateRecipeRouteCompatibility,
  expandContinuityStudyPlan,
  prepareContinuityStudyCell,
  buildContinuityStoryboardPlan,
  buildContinuityReviewManifest,
  validateContinuityReview,
  validateSafetyBaselineLinks,
  validateStudyComparisonEdges,
  importContinuityReview,
  type ExpandContinuityStudyOptions,
  type MinimaxH3ComfyUiTransportPort,
  type MinimaxH3ExperimentStorePort,
  type MinimaxH3OutputProberPort,
  type MinimaxH3ProcessRunnerPort,
  type MinimaxH3TargetPreflightPort,
  type MinimaxH3TelemetrySamplerPort
} from "@cco/application";

function resolveCliPath(rawPath?: string): string | undefined {
  if (!rawPath) return undefined;
  if (isAbsolute(rawPath)) {
    return rawPath;
  }
  const baseDir = process.env.INIT_CWD || findRepositoryRoot();
  return resolve(baseDir, rawPath);
}
import {
  MinimaxH3MatrixRowSchema,
  MinimaxH3OperatorDecisionSidecarSchema,
  MinimaxH3VisualReviewSidecarSchema,
  MinimaxH3ContinuityReviewSidecarSchema,
  MinimaxH3ContinuityStudySpecSchema,
  MINIMAX_H3_SAMPLING_RECIPE_NAMES,
  type MinimaxH3SamplingRecipeName,
  type MinimaxH3ExperimentCandidateFrames,
  type MinimaxH3AnyExperimentDescriptor,
  type MinimaxH3ExperimentDescriptorV2,
  type MinimaxH3ExperimentResultV2,
  type MinimaxH3ProcessRecord,
  type MinimaxH3AttentionVariantName,
  type MinimaxH3ContinuityStudySpec,
  type MinimaxH3ContinuityReviewSidecar
} from "@cco/contracts";
import {
  MinimaxH3ComfyUiAdapter,
  MinimaxH3ExperimentStore,
  MinimaxH3OutputProber,
  MinimaxH3ProcessRunner,
  MinimaxH3TargetPreflight,
  MinimaxH3TelemetrySampler
} from "@cco/infrastructure";

const DEFAULT_OUTPUT_ROOT = ".ai-runs/minimax-h3-experiments";

export interface ExperimentCliDependencies {
  readonly store?: MinimaxH3ExperimentStorePort;
  readonly preflight?: MinimaxH3TargetPreflightPort;
  readonly runner?: MinimaxH3ProcessRunnerPort;
  readonly transport?: MinimaxH3ComfyUiTransportPort;
  readonly telemetry?: MinimaxH3TelemetrySamplerPort;
  readonly prober?: MinimaxH3OutputProberPort;
  readonly service?: MinimaxH3ExperimentService;
  readonly stdout?: (msg: string) => void;
  readonly stderr?: (msg: string) => void;
}

export function printHelp(stdout: (msg: string) => void): void {
  stdout(`
Isolated Variable-Frame MiniMax-H3 Feasibility Experiment Launcher

Usage:
  experiment:minimax-h3 <subcommand> [options]

Subcommands:
  catalog        List and inspect MiniMax-H3 attention optimization variants
  prepare        Create isolated experiment directory, derive workflow, and stage inputs
  validate       Dry-run offline validation of descriptor, graph hashes, and environment rules
  run            Execute isolated experiment on owned local ComfyUI child with telemetry
  reconcile      Reconstruct and persist result.json from durable records and server state
  compare        Compare completed baseline and candidate experiment runs under controlled protocol
  cleanup        Release GPU lock and clean up temporary files without mutating results
  import-sidecar Import visual or continuity review sidecar into an existing run result.json
  plan-study     Validate and summarize a controlled long-shot continuity study matrix
  prepare-study  Prepare an isolated experiment run for a single resolved study cell
  review-plan    Generate storyboard plan and side-by-side review manifest for study

Options for 'plan-study':
  --study <path>                 Continuity study specification JSON file path (required)
  --output <path>                Path to save compiled plan summary JSON (optional)
  --output-root <dir>            Experiment output root (default: ${DEFAULT_OUTPUT_ROOT})

Options for 'prepare-study':
  --study <path>                 Continuity study specification JSON file path (required)
  --cell <id>                    Study cell ID to prepare into an isolated run (required)
  --target-host <hostname>       Target host machine (default: localhost)
  --gpu-uuid <uuid>              Target physical NVIDIA GPU UUID (required)
  --comfyui-dir <path>           Pinned ComfyUI repository directory (required)
  --python <path>                Python interpreter path (required)
  --address <ip>                 Loopback listen address (default: 127.0.0.1)
  --port <port>                  Loopback listen port (default: 8199)
  --output-root <dir>            Root directory for experiment runs (default: ${DEFAULT_OUTPUT_ROOT})
  --templates-dir <path>         Path to workflow templates directory (optional)
  --prerequisite-reviews <path>  Path to JSON file containing prerequisite reviews for combined arm (optional)

Options for 'review-plan':
  --study <path>                 Continuity study specification JSON file path (required)
  --output <path>                Path to write review manifest JSON (optional)
  --runs <path>                  Path to runs manifest for media binding (optional)
  --output-root <dir>            Experiment output root (default: ${DEFAULT_OUTPUT_ROOT})

Options for 'catalog':
  --route <i2v|ref2v>            Filter catalog by generation route (optional)
  --variant <variant>            Filter catalog by attention variant name (optional)
  --matched-variant <variant>    Filter catalog by matched dense baseline variant (optional)
  --recipes                      List sampling recipes instead of attention catalog entries
  --type <attention|recipes>     Catalog type to inspect (default: attention)
  --json                         Output catalog as JSON (default)

Options for 'prepare':
  --route <i2v|ref2v>            Generation route (required)
  --frames <124|192|243|362>     Target frame count on the MiniMax-H3 grid (required)
  --seed <integer>               Random seed for noise generation (required)
  --inputs <path>                Input manifest JSON file path (required)
  --prompt <string>              Prompt text (or use --prompt-file)
  --prompt-file <path>           File containing prompt text
  --target-host <hostname>       Target host machine (required)
  --gpu-uuid <uuid>              Target physical NVIDIA GPU UUID (required)
  --comfyui-dir <path>           Pinned ComfyUI repository directory (required)
  --python <path>                Python interpreter path (required)
  --address <ip>                 Loopback listen address (default: 127.0.0.1)
  --port <port>                  Loopback listen port (default: 8199)
  --run-id <id>                  Unique run identifier (required)
  --output-root <dir>            Root directory for experiment runs (default: ${DEFAULT_OUTPUT_ROOT})
  --runner-variant <name>        Runner policy variant (default: dynamicvram-offload-v1)
  --variant-reason <reason>      Required if runner-variant != dynamicvram-offload-v1 or non-default resolution
  --width <pixels>               Video width (default: 1344)
  --height <pixels>              Video height (default: 768)
  --requested-duration-ms <ms>   Explicit operator duration intent in milliseconds
  --templates-dir <path>         Path to workflow templates directory (optional)
  --startup-timeout-ms <ms>      ComfyUI child readiness timeout (default: 120000, max: 600000)
  --submission-timeout-ms <ms>   Prompt submission HTTP timeout (default: 30000, max: 300000)
  --poll-interval-ms <ms>        History poll interval (default: 1000, max: 60000)
  --total-render-timeout-ms <ms> Max time to wait for render completion (default: 1200000, max: 3600000)
  --probe-timeout-ms <ms>        ffprobe output verification timeout (default: 60000, max: 300000)
  --settlement-timeout-ms <ms>   Post-completion settlement wait (default: 10000, max: 120000)
  --shutdown-timeout-ms <ms>     Child process graceful shutdown timeout (default: 15000, max: 120000)
  --step-override <steps>        Override scheduler step count (e.g. 10..30)
  --checkpoint-override <name>   Override diffusion checkpoint ('ref2va' or 'fl2va')
  --sampling-recipe <name>       Pre-configured distillation/Lightning sampling recipe
  --variant-purpose <purpose>    Variant purpose ('performance' | 'prompt_conditioning' | 'controlled_multifactor')
  --attention-variant <variant>  Attention variant ('dense' | 'sage' | 'native-sol-attn' | 'veda')
  --matched-variant <variant>    Matched dense control target variant ('sage' | 'native-sol-attn' | 'veda')
  --comfyui-core-revision <rev>  Override ComfyUI core revision for catalog lookup (e.g. for upgraded dense control)

Options for 'validate':
  --run-dir <path>               Prepared run directory path (required)
  --output-root <dir>            Experiment output root (default: ${DEFAULT_OUTPUT_ROOT})
  --templates-dir <path>         Path to workflow templates directory (optional)

Options for 'run':
  --run-dir <path>               Prepared run directory path (required)
  --stop-policy <path>           Stop policy JSON path (optional)
  --baseline-run-dir <path>      Completed 124-frame baseline run directory (required for escalation)
  --output-root <dir>            Experiment output root (default: ${DEFAULT_OUTPUT_ROOT})
  --templates-dir <path>         Path to workflow templates directory (optional)

Options for 'reconcile':
  --run-dir <path>               Experiment run directory to reconcile (required)
  --output-root <dir>            Experiment output root (default: ${DEFAULT_OUTPUT_ROOT})

Options for 'compare':
  --baseline <path>              Completed baseline run directory (required)
  --candidate <path>             Completed candidate run directory (or --variant) (required)
  --output-root <dir>            Experiment output root (default: ${DEFAULT_OUTPUT_ROOT})

Options for 'cleanup':
  --run-dir <path>               Experiment run directory to clean up (required)
  --output-root <dir>            Experiment output root (default: ${DEFAULT_OUTPUT_ROOT})
  --keep-outputs                 Explicitly retain output files (default behavior)
  --remove-outputs               Delete output video files in addition to temporary files

Options for 'import-sidecar':
  --run-dir <path>               Prepared or executed run directory path (required)
  --sidecar <path>               Visual review sidecar JSON file path (required)
  --output-root <dir>            Experiment output root (default: ${DEFAULT_OUTPUT_ROOT})

Options for 'catalog':
  --route <i2v|ref2v>            Filter catalog entries by route (optional)
  --attention-variant <variant>  Filter catalog entries by attention variant (optional)
`);
}

function parseStrictInt(str?: string): number | null {
  if (!str) return null;
  if (!/^-?\d+$/.test(str.trim())) return null;
  const num = Number(str.trim());
  return Number.isSafeInteger(num) ? num : null;
}

export function parseArgs(rawArgs: readonly string[]): {
  subcommand: string;
  flags: Record<string, string>;
  booleanFlags: Set<string>;
  unknownPositionalArgs: string[];
  duplicateFlags: string[];
} {
  const flags: Record<string, string> = {};
  const booleanFlags = new Set<string>();
  const seenFlags = new Set<string>();
  const duplicateFlags: string[] = [];
  const unknownPositionalArgs: string[] = [];
  let subcommand = "";

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]!;

    if (arg === "-h" || arg === "--help") {
      booleanFlags.add("help");
      continue;
    }

    if (!arg.startsWith("-")) {
      if (!subcommand) {
        subcommand = arg;
      } else {
        unknownPositionalArgs.push(arg);
      }
      continue;
    }

    if (arg === "--keep-outputs") {
      if (seenFlags.has("keep-outputs")) {
        duplicateFlags.push("keep-outputs");
      }
      seenFlags.add("keep-outputs");
      booleanFlags.add("keep-outputs");
      continue;
    }

    const isFlag = arg.startsWith("-");
    if (isFlag) {
      const body = arg.startsWith("--") ? arg.substring(2) : arg.substring(1);
      const eqIdx = body.indexOf("=");
      if (eqIdx !== -1) {
        const k = body.substring(0, eqIdx);
        const v = body.substring(eqIdx + 1);
        if (seenFlags.has(k)) {
          duplicateFlags.push(k);
        }
        seenFlags.add(k);
        flags[k] = v;
      } else {
        const next = rawArgs[i + 1];
        if (next && !next.startsWith("-")) {
          if (seenFlags.has(body)) {
            duplicateFlags.push(body);
          }
          seenFlags.add(body);
          flags[body] = next;
          i++;
        } else {
          if (seenFlags.has(body)) {
            duplicateFlags.push(body);
          }
          seenFlags.add(body);
          booleanFlags.add(body);
        }
      }
    }
  }

  return { subcommand, flags, booleanFlags, unknownPositionalArgs, duplicateFlags };
}

const ALLOWED_FLAGS_BY_SUBCOMMAND: Record<string, Set<string>> = {
  prepare: new Set([
    "route",
    "frames",
    "seed",
    "inputs",
    "prompt",
    "prompt-file",
    "target-host",
    "gpu-uuid",
    "comfyui-dir",
    "python",
    "address",
    "port",
    "run-id",
    "output-root",
    "runner-variant",
    "variant-reason",
    "width",
    "height",
    "requested-duration-ms",
    "operator-label",
    "templates-dir",
    "startup-timeout-ms",
    "submission-timeout-ms",
    "poll-interval-ms",
    "total-render-timeout-ms",
    "probe-timeout-ms",
    "settlement-timeout-ms",
    "shutdown-timeout-ms",
    "step-override",
    "checkpoint-override",
    "sampling-recipe",
    "variant-purpose",
    "attention-variant",
    "matched-variant",
    "comfyui-core-revision",
    "core-revision"
  ]),
  validate: new Set(["run-dir", "output-root", "templates-dir"]),
  run: new Set(["run-dir", "output-root", "stop-policy", "baseline-run-dir", "templates-dir"]),
  reconcile: new Set(["run-dir", "output-root"]),
  compare: new Set([
    "baseline",
    "baseline-run-dir",
    "candidate",
    "variant",
    "variant-run-dir",
    "output-root"
  ]),
  cleanup: new Set(["run-dir", "output-root", "keep-outputs", "remove-outputs", "delete-outputs"]),
  "import-sidecar": new Set(["run-dir", "output-root", "sidecar", "file"]),
  "validate-sidecar": new Set(["file", "sidecar", "run-dir", "output-root"]),
  catalog: new Set([
    "route",
    "attention-variant",
    "matched-variant",
    "variant",
    "output-root",
    "comfyui-core-revision",
    "core-revision",
    "recipes",
    "type"
  ]),
  "plan-study": new Set(["study", "file", "output", "output-root", "json"]),
  "prepare-study": new Set([
    "study",
    "file",
    "cell",
    "target-host",
    "gpu-uuid",
    "comfyui-dir",
    "python",
    "address",
    "port",
    "output-root",
    "templates-dir",
    "prerequisite-reviews"
  ]),
  "review-plan": new Set(["study", "file", "output", "runs", "output-root", "json"])
};

const VALUE_FLAGS = new Set([
  "route",
  "frames",
  "seed",
  "inputs",
  "prompt",
  "prompt-file",
  "target-host",
  "gpu-uuid",
  "comfyui-dir",
  "python",
  "address",
  "port",
  "run-id",
  "output-root",
  "runner-variant",
  "variant-reason",
  "width",
  "height",
  "requested-duration-ms",
  "operator-label",
  "templates-dir",
  "startup-timeout-ms",
  "submission-timeout-ms",
  "poll-interval-ms",
  "total-render-timeout-ms",
  "probe-timeout-ms",
  "settlement-timeout-ms",
  "shutdown-timeout-ms",
  "step-override",
  "checkpoint-override",
  "sampling-recipe",
  "variant-purpose",
  "attention-variant",
  "matched-variant",
  "comfyui-core-revision",
  "core-revision",
  "run-dir",
  "stop-policy",
  "baseline-run-dir",
  "baseline",
  "candidate",
  "variant",
  "variant-run-dir",
  "file",
  "sidecar",
  "type",
  "study",
  "cell",
  "runs",
  "output",
  "prerequisite-reviews"
]);

export async function runExperimentCli(
  rawArgs: readonly string[],
  deps?: ExperimentCliDependencies
): Promise<number> {
  const stdout = deps?.stdout ?? ((msg: string) => console.log(msg));
  const stderr = deps?.stderr ?? ((msg: string) => console.error(msg));

  const { subcommand, flags, booleanFlags, unknownPositionalArgs, duplicateFlags } =
    parseArgs(rawArgs);

  if (booleanFlags.has("help") || !subcommand || subcommand === "help") {
    printHelp(stdout);
    return 0;
  }

  if (unknownPositionalArgs.length > 0) {
    stderr(`Error: Unexpected positional argument(s): ${unknownPositionalArgs.join(", ")}`);
    return 1;
  }

  if (duplicateFlags.length > 0) {
    stderr(`Error: Duplicate flag(s) specified: ${duplicateFlags.map((f) => `--${f}`).join(", ")}`);
    return 1;
  }

  const allowedFlags = ALLOWED_FLAGS_BY_SUBCOMMAND[subcommand];
  if (!allowedFlags) {
    stderr(`Unknown subcommand "${subcommand}". See --help for usage.`);
    return 1;
  }

  // Reject unsupported / unknown flags (e.g. --trim, --loop)
  const allSuppliedKeys = [...Object.keys(flags), ...Array.from(booleanFlags)];
  for (const key of allSuppliedKeys) {
    if (key === "help") continue;
    if (!allowedFlags.has(key)) {
      stderr(`Error: Unknown or unsupported flag "--${key}" for subcommand "${subcommand}".`);
      return 1;
    }
  }

  for (const key of booleanFlags) {
    if (VALUE_FLAGS.has(key)) {
      stderr(`Error: Flag "--${key}" requires a value.`);
      return 1;
    }
  }

  if (flags["prompt"] && flags["prompt-file"]) {
    stderr("Error: Cannot specify both --prompt and --prompt-file.");
    return 1;
  }

  const rawOutputRoot =
    flags["output-root"] ?? (subcommand === "prepare" ? undefined : DEFAULT_OUTPUT_ROOT);
  if (!rawOutputRoot || rawOutputRoot.trim().length === 0) {
    stderr("Error: --output-root is required.");
    return 1;
  }
  const outputRoot = resolveCliPath(rawOutputRoot)!;

  const store = deps?.store ?? new MinimaxH3ExperimentStore(outputRoot);
  const preflight = deps?.preflight ?? new MinimaxH3TargetPreflight();
  const runner = deps?.runner ?? new MinimaxH3ProcessRunner();
  const transport = deps?.transport ?? new MinimaxH3ComfyUiAdapter();
  const telemetry = deps?.telemetry ?? new MinimaxH3TelemetrySampler();
  const prober = deps?.prober ?? new MinimaxH3OutputProber();
  const service =
    deps?.service ??
    new MinimaxH3ExperimentService(store, preflight, runner, transport, telemetry, prober);

  try {
    switch (subcommand) {
      case "prepare": {
        const route = flags["route"] as "i2v" | "ref2v";
        if (route !== "i2v" && route !== "ref2v") {
          stderr("Error: --route must be 'i2v' or 'ref2v'");
          return 1;
        }

        const frames = parseStrictInt(flags["frames"]) as MinimaxH3ExperimentCandidateFrames;
        const seed = parseStrictInt(flags["seed"]);
        const inputs = resolveCliPath(flags["inputs"]);
        const runId = flags["run-id"];
        const targetHost = flags["target-host"];
        const gpuUuid = flags["gpu-uuid"];
        const comfyuiDir = resolveCliPath(flags["comfyui-dir"]);
        const python = resolveCliPath(flags["python"]);

        if (
          frames === null ||
          seed === null ||
          !inputs ||
          !runId ||
          !targetHost ||
          !gpuUuid ||
          !comfyuiDir ||
          !python
        ) {
          stderr(
            "Error: Missing or invalid required flags for 'prepare'. See --help for required parameters."
          );
          return 1;
        }

        if (seed < 0 || seed > Number.MAX_SAFE_INTEGER) {
          stderr("Error: --seed must be a valid non-negative integer.");
          return 1;
        }

        let prompt = flags["prompt"] || "";
        if (flags["prompt-file"]) {
          const resolvedPromptFile = resolveCliPath(flags["prompt-file"])!;
          prompt = await readFile(resolvedPromptFile, "utf8");
        }
        if (!prompt || prompt.trim().length === 0) {
          stderr("Error: Either --prompt or --prompt-file must be provided and non-empty.");
          return 1;
        }

        const width = flags["width"] ? parseStrictInt(flags["width"]) : 1344;
        const height = flags["height"] ? parseStrictInt(flags["height"]) : 768;
        if (width === null || height === null || width <= 0 || height <= 0) {
          stderr("Error: --width and --height must be positive integers.");
          return 1;
        }

        const address = flags["address"] ?? "127.0.0.1";
        const loopbackRegex = /^(?:127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}|::1)$/;
        if (!loopbackRegex.test(address)) {
          stderr(
            `Error: --address "${address}" must be a numeric loopback address (127.x.y.z or ::1).`
          );
          return 1;
        }

        const port = flags["port"] ? parseStrictInt(flags["port"]) : 8199;
        if (port === null || port < 1 || port > 65535) {
          stderr("Error: --port must be a valid port number between 1 and 65535.");
          return 1;
        }

        const runnerVariant = flags["runner-variant"] ?? "dynamicvram-offload-v1";
        const variantReason = flags["variant-reason"] ?? null;
        let requestedDurationMs: number | undefined;
        if (flags["requested-duration-ms"] !== undefined) {
          const parsed = parseStrictInt(flags["requested-duration-ms"]);
          if (parsed === null || parsed <= 0) {
            stderr("Error: --requested-duration-ms must be a positive integer.");
            return 1;
          }
          requestedDurationMs = parsed;
        }

        // Schema's own bounds exist specifically "to allow operator
        // tuning" of these timeouts above their defaults (e.g. a longer
        // render budget for a higher frame count) -- but until now no
        // caller had a way to actually supply one.
        const timeoutFlagNames = [
          ["startup-timeout-ms", "startupTimeoutMs"],
          ["submission-timeout-ms", "submissionTimeoutMs"],
          ["poll-interval-ms", "pollIntervalMs"],
          ["total-render-timeout-ms", "totalRenderTimeoutMs"],
          ["probe-timeout-ms", "probeTimeoutMs"],
          ["settlement-timeout-ms", "settlementTimeoutMs"],
          ["shutdown-timeout-ms", "shutdownTimeoutMs"]
        ] as const;
        const timeoutsOverride: Record<string, number> = {};
        for (const [flagName, field] of timeoutFlagNames) {
          if (flags[flagName] !== undefined) {
            const parsed = parseStrictInt(flags[flagName]);
            if (parsed === null || parsed <= 0) {
              stderr(`Error: --${flagName} must be a positive integer.`);
              return 1;
            }
            timeoutsOverride[field] = parsed;
          }
        }

        let stepOverride: number | undefined;
        if (flags["step-override"] !== undefined) {
          const parsed = parseStrictInt(flags["step-override"]);
          if (parsed === null || parsed <= 0) {
            stderr("Error: --step-override must be a positive integer.");
            return 1;
          }
          stepOverride = parsed;
        }

        let checkpointOverride: "ref2va" | "fl2va" | undefined;
        if (flags["checkpoint-override"] !== undefined) {
          const cp = flags["checkpoint-override"].toLowerCase();
          if (cp !== "ref2va" && cp !== "fl2va") {
            stderr("Error: --checkpoint-override must be 'ref2va' or 'fl2va'.");
            return 1;
          }
          checkpointOverride = cp as "ref2va" | "fl2va";
        }

        let variantPurpose:
          "performance" | "prompt_conditioning" | "controlled_multifactor" | undefined;
        if (flags["variant-purpose"] !== undefined) {
          const p = flags["variant-purpose"];
          if (
            p !== "performance" &&
            p !== "prompt_conditioning" &&
            p !== "controlled_multifactor"
          ) {
            stderr(
              "Error: --variant-purpose must be 'performance', 'prompt_conditioning', or 'controlled_multifactor'."
            );
            return 1;
          }
          variantPurpose = p;
        }

        let attentionVariant: "dense" | "sage" | "native-sol-attn" | "veda" | undefined;
        if (flags["attention-variant"] !== undefined) {
          const av = flags["attention-variant"].toLowerCase();
          if (av !== "dense" && av !== "sage" && av !== "native-sol-attn" && av !== "veda") {
            stderr(
              "Error: --attention-variant must be 'dense', 'sage', 'native-sol-attn', or 'veda'."
            );
            return 1;
          }
          attentionVariant = av as "dense" | "sage" | "native-sol-attn" | "veda";
        }

        let matchedVariant: "dense" | "sage" | "native-sol-attn" | "veda" | undefined;
        if (flags["matched-variant"] !== undefined) {
          const mv = flags["matched-variant"].toLowerCase();
          if (mv !== "dense" && mv !== "sage" && mv !== "native-sol-attn" && mv !== "veda") {
            stderr(
              "Error: --matched-variant must be 'dense', 'sage', 'native-sol-attn', or 'veda'."
            );
            return 1;
          }
          matchedVariant = mv as "dense" | "sage" | "native-sol-attn" | "veda";
        }

        let samplingRecipe: MinimaxH3SamplingRecipeName | undefined;
        if (flags["sampling-recipe"] !== undefined) {
          const sr = flags["sampling-recipe"].toLowerCase();
          if (!MINIMAX_H3_SAMPLING_RECIPE_NAMES.includes(sr as MinimaxH3SamplingRecipeName)) {
            stderr(
              `Error: Unknown --sampling-recipe "${flags["sampling-recipe"]}". Supported recipes: ${MINIMAX_H3_SAMPLING_RECIPE_NAMES.join(", ")}.`
            );
            return 1;
          }
          if (stepOverride !== undefined) {
            stderr(
              "Error: Cannot specify --step-override when using a distillation --sampling-recipe."
            );
            return 1;
          }
          if (checkpointOverride !== undefined) {
            stderr(
              "Error: Cannot specify --checkpoint-override when using a distillation --sampling-recipe."
            );
            return 1;
          }
          if (attentionVariant !== undefined) {
            stderr("Error: Cannot specify --attention-variant when using --sampling-recipe.");
            return 1;
          }
          try {
            validateRecipeRouteCompatibility(sr as MinimaxH3SamplingRecipeName, route);
          } catch (routeErr) {
            stderr(`Error: ${(routeErr as Error).message}`);
            return 1;
          }
          samplingRecipe = sr as MinimaxH3SamplingRecipeName;
        }

        const coreRevision = flags["comfyui-core-revision"] ?? flags["core-revision"];

        const resolvedTemplatesDir = resolveCliPath(flags["templates-dir"]);
        const prepared = await service.prepareExperiment({
          route,
          frames,
          seed,
          prompt,
          operatorLabel: flags["operator-label"] ?? "operator",
          runId,
          outputRoot,
          targetHost,
          gpuUuid,
          comfyUiDir: comfyuiDir,
          pythonPath: python,
          address,
          port,
          width,
          height,
          runnerVariant,
          variantReason,
          inputManifestPath: inputs,
          ...(resolvedTemplatesDir !== undefined ? { templatesDir: resolvedTemplatesDir } : {}),
          ...(typeof requestedDurationMs === "number" ? { requestedDurationMs } : {}),
          ...(Object.keys(timeoutsOverride).length > 0 ? { timeouts: timeoutsOverride } : {}),
          ...(stepOverride !== undefined ? { stepOverride } : {}),
          ...(checkpointOverride !== undefined ? { checkpointOverride } : {}),
          ...(variantPurpose !== undefined ? { variantPurpose } : {}),
          ...(attentionVariant !== undefined ? { attentionVariant } : {}),
          ...(matchedVariant !== undefined ? { matchedVariant } : {}),
          ...(coreRevision !== undefined ? { coreRevision } : {}),
          ...(samplingRecipe !== undefined ? { samplingRecipe } : {})
        });

        stdout(
          JSON.stringify(
            {
              status: "prepared",
              runId: prepared.descriptor.runId,
              runDir: prepared.runDir,
              configuredFrames: prepared.descriptor.configuredFrames,
              derivedWorkflowDigest: prepared.descriptor.derivedWorkflowDigest,
              configDigest: prepared.descriptor.configDigest,
              comparisonKey: prepared.descriptor.comparisonKey
            },
            null,
            2
          )
        );
        return 0;
      }

      case "validate": {
        const runDir = resolveCliPath(flags["run-dir"]);
        if (!runDir) {
          stderr("Error: --run-dir is required for 'validate'");
          return 1;
        }

        const validateTemplatesDir = resolveCliPath(flags["templates-dir"]);
        const result = await service.validateExperiment(runDir, {
          outputRoot,
          ...(validateTemplatesDir !== undefined ? { templatesDir: validateTemplatesDir } : {})
        });
        if (!result.ok) {
          stderr(
            `Validation failed with ${result.errors.length} error(s):\n${result.errors.join("\n")}`
          );
          return 1;
        }

        stdout(
          JSON.stringify(
            {
              status: "valid",
              runId: result.descriptor.runId,
              runDir,
              route: result.descriptor.route,
              configuredFrames: result.descriptor.configuredFrames,
              configDigest: result.descriptor.configDigest,
              comparisonKey: result.descriptor.comparisonKey,
              graphValid: result.graphValid ?? true,
              executionBlocked: result.executionBlocked ?? false,
              executionBlockers: result.executionBlockers ?? []
            },
            null,
            2
          )
        );
        return 0;
      }

      case "run": {
        const runDir = resolveCliPath(flags["run-dir"]);
        if (!runDir) {
          stderr("Error: --run-dir is required for 'run'");
          return 1;
        }

        const stopPolicyPath = resolveCliPath(flags["stop-policy"]);
        if (!stopPolicyPath) {
          stderr(
            "Error: --stop-policy is required; supply operator-authored thresholds before execution."
          );
          return 1;
        }
        const baselineRunDir = resolveCliPath(flags["baseline-run-dir"]);
        const runTemplatesDir = resolveCliPath(flags["templates-dir"]);

        const abortController = new AbortController();
        const signalHandler = () => {
          abortController.abort();
        };
        process.once("SIGINT", signalHandler);
        process.once("SIGTERM", signalHandler);

        try {
          const result = await service.executeExperiment(runDir, {
            ...(stopPolicyPath !== undefined ? { stopPolicyPath } : {}),
            ...(baselineRunDir !== undefined ? { baselineRunDir } : {}),
            ...(runTemplatesDir !== undefined ? { templatesDir: runTemplatesDir } : {}),
            outputRoot,
            abortSignal: abortController.signal
          });

          stdout(JSON.stringify(result, null, 2));
          return result.execution.status === "completed" ? 0 : 1;
        } finally {
          process.removeListener("SIGINT", signalHandler);
          process.removeListener("SIGTERM", signalHandler);
        }
      }

      case "reconcile": {
        const runDir = resolveCliPath(flags["run-dir"]);
        if (!runDir) {
          stderr("Error: --run-dir is required for 'reconcile'");
          return 1;
        }

        const result = await service.reconcileExperiment(runDir, { outputRoot });
        stdout(JSON.stringify(result, null, 2));
        return 0;
      }

      case "compare": {
        const rawBaseline = flags["baseline"] ?? flags["baseline-run-dir"];
        const rawCandidate = flags["candidate"] ?? flags["variant"] ?? flags["variant-run-dir"];
        const baselineDir = resolveCliPath(rawBaseline);
        const candidateDir = resolveCliPath(rawCandidate);
        if (!baselineDir || !candidateDir) {
          stderr(
            "Error: 'compare' requires both a baseline directory (--baseline or --baseline-run-dir) and a candidate directory (--candidate, --variant, or --variant-run-dir)."
          );
          return 1;
        }

        const baselineResult = await store.readResult(baselineDir);
        if (!baselineResult) {
          stderr(`Error: Could not read result.json from baseline run directory: ${baselineDir}`);
          return 1;
        }

        const candidateResult = await store.readResult(candidateDir);
        if (!candidateResult) {
          stderr(`Error: Could not read result.json from candidate run directory: ${candidateDir}`);
          return 1;
        }

        const baselineDescriptor = await store.readDescriptor(baselineDir);
        const candidateDescriptor = await store.readDescriptor(candidateDir);

        const report = compareMinimaxH3Experiments({
          baselineDescriptor,
          baselineResult,
          variantDescriptor: candidateDescriptor,
          variantResult: candidateResult
        });
        stdout(JSON.stringify(report, null, 2));
        return report.structuralAdmission.eligible ? 0 : 1;
      }

      case "validate-sidecar": {
        const filePath = resolveCliPath(flags["file"] ?? flags["sidecar"]);
        if (!filePath) {
          stderr("Error: --file (or --sidecar) is required for 'validate-sidecar'");
          return 1;
        }

        let rawContent: string;
        try {
          rawContent = await store.readTextFile(filePath);
        } catch {
          rawContent = await readFile(filePath, "utf8");
        }
        const parsed = JSON.parse(rawContent);

        let sidecarType: "visual_review" | "operator_decision" | "matrix_row" | "continuity_review";
        let sidecar: unknown;

        const continuityCheck = MinimaxH3ContinuityReviewSidecarSchema.safeParse(parsed);
        if (continuityCheck.success) {
          sidecarType = "continuity_review";
          sidecar = continuityCheck.data;
        } else {
          const visualCheck = MinimaxH3VisualReviewSidecarSchema.safeParse(parsed);
          if (visualCheck.success) {
            sidecarType = "visual_review";
            sidecar = visualCheck.data;
          } else {
            const decisionCheck = MinimaxH3OperatorDecisionSidecarSchema.safeParse(parsed);
            if (decisionCheck.success) {
              sidecarType = "operator_decision";
              sidecar = decisionCheck.data;
            } else {
              const matrixCheck = MinimaxH3MatrixRowSchema.safeParse(parsed);
              if (matrixCheck.success) {
                sidecarType = "matrix_row";
                sidecar = matrixCheck.data;
              } else {
                stderr(
                  `Error: File does not match MinimaxH3ContinuityReviewSidecarSchema, MinimaxH3VisualReviewSidecarSchema, MinimaxH3OperatorDecisionSidecarSchema, or MinimaxH3MatrixRowSchema:\nContinuity review errors: ${continuityCheck.error.message}\nVisual review errors: ${visualCheck.error.message}\nOperator decision errors: ${decisionCheck.error.message}\nMatrix row errors: ${matrixCheck.error.message}`
                );
                return 1;
              }
            }
          }
        }

        // If --run-dir is provided, cross-validate against run descriptor/result
        const runDir = flags["run-dir"];
        if (sidecarType === "continuity_review" && !runDir) {
          stderr("Error: --run-dir is required when validating a continuity_review sidecar");
          return 1;
        }
        if (runDir) {
          const descriptor = await store.readDescriptor(runDir);
          if (sidecarType === "matrix_row") {
            const m = sidecar as {
              comparisonKey: string;
              route: string;
              configuredFrames: number;
            };
            if (m.route !== descriptor.route) {
              stderr(
                `Error: Matrix row route "${m.route}" does not match descriptor route "${descriptor.route}"`
              );
              return 1;
            }
            if (m.configuredFrames !== descriptor.configuredFrames) {
              stderr(
                `Error: Matrix row configuredFrames ${m.configuredFrames} does not match descriptor configuredFrames ${descriptor.configuredFrames}`
              );
              return 1;
            }
            if (m.comparisonKey !== descriptor.comparisonKey) {
              stderr(
                `Error: Matrix row comparisonKey "${m.comparisonKey}" does not match descriptor comparisonKey "${descriptor.comparisonKey}"`
              );
              return 1;
            }
          } else {
            const s = sidecar as { runId: string; route: string; configuredFrames: number };
            if (s.runId !== descriptor.runId) {
              stderr(
                `Error: Sidecar runId "${s.runId}" does not match descriptor runId "${descriptor.runId}"`
              );
              return 1;
            }
            if (s.route !== descriptor.route) {
              stderr(
                `Error: Sidecar route "${s.route}" does not match descriptor route "${descriptor.route}"`
              );
              return 1;
            }
            if (s.configuredFrames !== descriptor.configuredFrames) {
              stderr(
                `Error: Sidecar configuredFrames ${s.configuredFrames} does not match descriptor configuredFrames ${descriptor.configuredFrames}`
              );
              return 1;
            }

            if (sidecarType === "continuity_review") {
              const result = await store.readResult(runDir);
              if (!result) {
                stderr(`Error: No result.json found in run directory "${runDir}"`);
                return 1;
              }
              if (result.execution?.status !== "completed") {
                stderr(
                  `Error: Run execution status is "${result.execution?.status}", expected "completed"`
                );
                return 1;
              }
              if (!result.probe || result.probe.status !== "succeeded") {
                stderr(
                  `Error: Run probe status is "${result.probe?.status}", expected "succeeded"`
                );
                return 1;
              }
              if (!result.probe.outputFile) {
                stderr("Error: Run probe outputFile is missing");
                return 1;
              }
              const outputFilePath = resolve(runDir, result.probe.outputFile);
              try {
                const hashInfo = await store.hashFile(outputFilePath);
                const sidecarObj = sidecar as { sourceOutputSha256: string };
                if (hashInfo.sha256 !== sidecarObj.sourceOutputSha256) {
                  stderr(
                    `Error: Output file on disk SHA-256 "${hashInfo.sha256}" does not match sidecar sourceOutputSha256 "${sidecarObj.sourceOutputSha256}"`
                  );
                  return 1;
                }
              } catch (hashErr) {
                stderr(
                  `Error: Failed to hash output file "${outputFilePath}": ${(hashErr as Error).message}`
                );
                return 1;
              }
              const val = validateContinuityReview({
                sidecarRaw: sidecar,
                descriptor,
                result
              });
              if (!val.valid) {
                stderr(`Error: Continuity review validation failed:\n${val.errors.join("\n")}`);
                return 1;
              }
            } else if (sidecarType === "visual_review") {
              const v = sidecar as { outputSha256: string };
              const result = await store.readResult(runDir);
              if (result?.probe.outputSha256 && v.outputSha256 !== result.probe.outputSha256) {
                stderr(
                  `Error: Sidecar outputSha256 "${v.outputSha256}" does not match probed outputSha256 "${result.probe.outputSha256}"`
                );
                return 1;
              }
            } else if (sidecarType === "operator_decision") {
              const d = sidecar as { comparisonKey: string; status: string };
              if (d.comparisonKey !== descriptor.comparisonKey) {
                stderr(
                  `Error: Sidecar comparisonKey "${d.comparisonKey}" does not match descriptor comparisonKey "${descriptor.comparisonKey}"`
                );
                return 1;
              }
              // The sidecar schema only requires a non-empty evidenceBundle
              // of arbitrary strings -- it has no way to verify those
              // strings are true. An "approve_candidate" claim must be
              // checked against the run's own persisted result using the
              // exact same prerequisites the embedded operatorDecision
              // field enforces (see MinimaxH3ExperimentResultSchema's
              // superRefine), not trusted on the sidecar author's word.
              if (d.status === "approve_candidate") {
                const result = await store.readResult(runDir);
                const prereqFailures: string[] = [];
                if (!result) {
                  prereqFailures.push("no result.json exists for this run");
                } else {
                  if (result.execution.status !== "completed") {
                    prereqFailures.push(
                      `execution status is "${result.execution.status}", not "completed"`
                    );
                  }
                  if (
                    result.observedRunner.effectiveMode.status !== "verified" ||
                    !result.observedRunner.effectiveMode.value
                  ) {
                    prereqFailures.push("observedRunner.effectiveMode is not verified");
                  } else if (
                    result.observedRunner.effectiveMode.value !==
                    descriptor.requestedRunner.memoryPolicy
                  ) {
                    prereqFailures.push(
                      `observedRunner.effectiveMode.value "${result.observedRunner.effectiveMode.value}" does not match the requested memory policy "${descriptor.requestedRunner.memoryPolicy}"`
                    );
                  }
                  if (result.collection.status !== "complete") {
                    prereqFailures.push(
                      `collection status is "${result.collection.status}", not "complete"`
                    );
                  }
                  if (result.outputConformance.status !== "conformant") {
                    prereqFailures.push(
                      `outputConformance status is "${result.outputConformance.status}", not "conformant"`
                    );
                  }
                  if (
                    result.visualReview.status !== "reviewed" ||
                    result.visualReview.findings?.continuity !== "pass" ||
                    result.visualReview.findings?.identityFidelity !== "pass" ||
                    result.visualReview.findings?.visualDegradation !== "pass"
                  ) {
                    prereqFailures.push("visualReview is not 'reviewed' with all findings 'pass'");
                  }
                }
                if (prereqFailures.length > 0) {
                  stderr(
                    `Error: Sidecar claims status "approve_candidate" but the run's actual result does not meet the prerequisites: ${prereqFailures.join("; ")}`
                  );
                  return 1;
                }
              }
            }
          }
        }

        stdout(
          JSON.stringify(
            {
              status: "valid",
              sidecarType,
              filePath,
              ...(runDir ? { runDir } : {})
            },
            null,
            2
          )
        );
        return 0;
      }

      case "import-sidecar": {
        const runDir = resolveCliPath(flags["run-dir"]);
        if (!runDir) {
          stderr("Error: --run-dir is required for 'import-sidecar'");
          return 1;
        }
        const sidecarFile = flags["sidecar"] || flags["file"];
        if (!sidecarFile) {
          stderr("Error: --sidecar is required for 'import-sidecar'");
          return 1;
        }
        const resolvedSidecarPath = resolveCliPath(sidecarFile)!;
        let sidecarRaw: unknown;
        try {
          sidecarRaw = await store.readJsonFile(resolvedSidecarPath);
        } catch (err) {
          stderr(`Error: Failed to read sidecar file "${sidecarFile}": ${(err as Error).message}`);
          return 1;
        }

        // Visual review was the only importable sidecar type; an
        // operator_decision sidecar had no way to reach result.json at
        // all except by hand-editing it, bypassing every check below.
        const continuityCheck = MinimaxH3ContinuityReviewSidecarSchema.safeParse(sidecarRaw);
        const visualCheck = continuityCheck.success
          ? null
          : MinimaxH3VisualReviewSidecarSchema.safeParse(sidecarRaw);
        const decisionCheck =
          continuityCheck.success || visualCheck?.success
            ? null
            : MinimaxH3OperatorDecisionSidecarSchema.safeParse(sidecarRaw);

        let descriptor: MinimaxH3AnyExperimentDescriptor;
        try {
          descriptor = await store.readDescriptor(runDir);
        } catch (err) {
          stderr(`Error: Failed to read descriptor from "${runDir}": ${(err as Error).message}`);
          return 1;
        }

        const result = await store.readResult(runDir);
        if (!result) {
          stderr(`Error: No result.json found in run directory "${runDir}" to import sidecar into`);
          return 1;
        }

        if (continuityCheck.success) {
          const sidecar = continuityCheck.data;
          try {
            const importRes = await importContinuityReview({
              runDir,
              sidecar,
              store
            });
            if (!importRes.imported) {
              stderr(`Error: Failed to import continuity review: ${importRes.reason}`);
              return 1;
            }
            stdout(
              JSON.stringify(
                {
                  status: "imported",
                  sidecarType: "continuity_review",
                  runId: sidecar.runId,
                  rubricVersion: sidecar.rubricVersion,
                  overallAdUsability: sidecar.dimensions.overallAdUsability.assessment,
                  idempotent: importRes.idempotent
                },
                null,
                2
              )
            );
            return 0;
          } catch (importErr) {
            stderr(`Error: Failed to import continuity review: ${(importErr as Error).message}`);
            return 1;
          }
        }

        if (visualCheck?.success) {
          const sidecar = visualCheck.data;
          if (sidecar.runId !== descriptor.runId) {
            stderr(
              `Error: Sidecar runId "${sidecar.runId}" does not match run descriptor "${descriptor.runId}"`
            );
            return 1;
          }
          if (result.probe.outputSha256 && sidecar.outputSha256 !== result.probe.outputSha256) {
            stderr(
              `Error: Sidecar outputSha256 "${sidecar.outputSha256}" does not match result probe outputSha256 "${result.probe.outputSha256}"`
            );
            return 1;
          }

          const updatedResult = {
            ...result,
            visualReview: {
              status: sidecar.status,
              outputSha256: sidecar.outputSha256,
              reviewedAt: sidecar.reviewedAt,
              reviewer: sidecar.reviewer,
              findings: sidecar.findings,
              notes: sidecar.notes,
              unavailableReason: sidecar.unavailableReason
            }
          };

          await store.writeResult(runDir, updatedResult);
          stdout(
            JSON.stringify(
              { status: "imported", runId: descriptor.runId, visualReviewStatus: sidecar.status },
              null,
              2
            )
          );
          return 0;
        }

        if (decisionCheck?.success) {
          const sidecar = decisionCheck.data;
          if (sidecar.runId !== descriptor.runId) {
            stderr(
              `Error: Sidecar runId "${sidecar.runId}" does not match run descriptor "${descriptor.runId}"`
            );
            return 1;
          }
          if (sidecar.comparisonKey !== descriptor.comparisonKey) {
            stderr(
              `Error: Sidecar comparisonKey "${sidecar.comparisonKey}" does not match descriptor comparisonKey "${descriptor.comparisonKey}"`
            );
            return 1;
          }
          // Mirror validate-sidecar's approve_candidate check exactly:
          // a non-empty evidenceBundle of arbitrary strings is not proof
          // of anything on its own -- the run's own persisted result
          // must actually satisfy the prerequisites before this import
          // can grant approve_candidate.
          if (sidecar.status === "approve_candidate") {
            const prereqFailures: string[] = [];
            if (result.execution.status !== "completed") {
              prereqFailures.push(
                `execution status is "${result.execution.status}", not "completed"`
              );
            }
            if (
              result.observedRunner.effectiveMode.status !== "verified" ||
              !result.observedRunner.effectiveMode.value
            ) {
              prereqFailures.push("observedRunner.effectiveMode is not verified");
            } else if (
              result.observedRunner.effectiveMode.value !== descriptor.requestedRunner.memoryPolicy
            ) {
              prereqFailures.push(
                `observedRunner.effectiveMode.value "${result.observedRunner.effectiveMode.value}" does not match the requested memory policy "${descriptor.requestedRunner.memoryPolicy}"`
              );
            }
            if (result.collection.status !== "complete") {
              prereqFailures.push(
                `collection status is "${result.collection.status}", not "complete"`
              );
            }
            if (result.outputConformance.status !== "conformant") {
              prereqFailures.push(
                `outputConformance status is "${result.outputConformance.status}", not "conformant"`
              );
            }
            if (
              result.visualReview.status !== "reviewed" ||
              result.visualReview.findings?.continuity !== "pass" ||
              result.visualReview.findings?.identityFidelity !== "pass" ||
              result.visualReview.findings?.visualDegradation !== "pass"
            ) {
              prereqFailures.push("visualReview is not 'reviewed' with all findings 'pass'");
            }
            if (prereqFailures.length > 0) {
              stderr(
                `Error: Sidecar claims status "approve_candidate" but the run's actual result does not meet the prerequisites: ${prereqFailures.join("; ")}`
              );
              return 1;
            }
          }

          const updatedResult = {
            ...result,
            operatorDecision: {
              status: sidecar.status,
              operator: sidecar.operator,
              decidedAt: sidecar.decidedAt,
              comparisonKey: sidecar.comparisonKey,
              reason: sidecar.reason
            }
          };

          await store.writeResult(runDir, updatedResult);
          stdout(
            JSON.stringify(
              {
                status: "imported",
                runId: descriptor.runId,
                operatorDecisionStatus: sidecar.status
              },
              null,
              2
            )
          );
          return 0;
        }

        stderr(
          `Error: File does not match MinimaxH3ContinuityReviewSidecarSchema, MinimaxH3VisualReviewSidecarSchema, or MinimaxH3OperatorDecisionSidecarSchema:\nContinuity review errors: ${continuityCheck.error.message}\nVisual review errors: ${visualCheck?.error.message}\nOperator decision errors: ${decisionCheck?.error.message}`
        );
        return 1;
      }

      case "cleanup": {
        const runDir = resolveCliPath(flags["run-dir"]);
        if (!runDir) {
          stderr("Error: --run-dir is required for 'cleanup'");
          return 1;
        }

        const resolvedRunDir = resolve(runDir);
        const resolvedOutputRoot = resolve(outputRoot);
        if (resolvedRunDir === resolvedOutputRoot) {
          stderr(`Error: --run-dir cannot be the output root ("${runDir}")`);
          return 1;
        }

        if (!store.verifyContainment(runDir, outputRoot)) {
          stderr(
            `Error: --run-dir "${runDir}" violates containment within output root "${outputRoot}"`
          );
          return 1;
        }

        let descriptor: MinimaxH3AnyExperimentDescriptor;
        try {
          descriptor = await store.readDescriptor(runDir);
        } catch (err) {
          stderr(
            `Error: Cannot clean up run directory with missing or unreadable descriptor: ${(err as Error).message}`
          );
          return 1;
        }

        if (basename(resolvedRunDir) !== descriptor.runId) {
          stderr(
            `Error: Run directory basename "${basename(resolvedRunDir)}" does not match descriptor runId "${descriptor.runId}"`
          );
          return 1;
        }

        // Terminate any active child process registered for this run after verifying identity
        let processRecord: MinimaxH3ProcessRecord | null = null;
        try {
          processRecord = await store.readProcessRecord(runDir);
        } catch (err) {
          stderr(
            `Error: Failed to read process record from run directory: ${(err as Error).message}`
          );
          return 1;
        }

        if (processRecord) {
          let isAlive = false;
          try {
            process.kill(processRecord.pid, 0);
            isAlive = true;
          } catch (killErr) {
            if ((killErr as NodeJS.ErrnoException).code === "ESRCH") {
              isAlive = false;
            } else {
              stderr(
                `Error: Process ${processRecord.pid} cannot be queried: ${(killErr as Error).message}`
              );
              return 1;
            }
          }

          if (isAlive) {
            let isVerifiedChild = false;
            try {
              const statContent = await readFile(`/proc/${processRecord.pid}/stat`, "utf8");
              const lastParenIndex = statContent.lastIndexOf(")");
              let ticks = -1;
              if (lastParenIndex !== -1) {
                const fields = statContent
                  .substring(lastParenIndex + 1)
                  .trim()
                  .split(/\s+/);
                ticks = parseInt(fields[19] || "", 10);
              }
              const ticksMatch = ticks === processRecord.startTimeTicks;

              const exePath = await readlink(`/proc/${processRecord.pid}/exe`);
              const exeMatch = exePath.toLowerCase().includes("python");

              const cwdPath = await readlink(`/proc/${processRecord.pid}/cwd`);
              const expectedCwd = resolve(descriptor.target.comfyUiDir);
              const cwdMatch = resolve(cwdPath) === expectedCwd;

              const environContent = await readFile(`/proc/${processRecord.pid}/environ`, "utf8");
              const gpuMatch = environContent.includes(
                `CUDA_VISIBLE_DEVICES=${processRecord.gpuUuid}`
              );

              if (ticksMatch && exeMatch && cwdMatch && gpuMatch) {
                isVerifiedChild = true;
              }
            } catch (err) {
              stderr(
                `Error: Could not verify process identity for active PID ${processRecord.pid}: ${(err as Error).message}`
              );
              return 1;
            }

            if (!isVerifiedChild) {
              stderr(
                `Error: Active process PID ${processRecord.pid} does not match recorded child process settings (possible PID reuse). Refusing to terminate.`
              );
              return 1;
            }

            // Signal verified child with bounded escalation
            try {
              process.kill(processRecord.pid, "SIGTERM");
              let killed = false;
              for (let i = 0; i < 20; i++) {
                await new Promise((r) => setTimeout(r, 200));
                try {
                  process.kill(processRecord.pid, 0);
                } catch {
                  killed = true;
                  break;
                }
              }
              if (!killed) {
                // Re-verify ticks before SIGKILL
                let stillChild = false;
                try {
                  const statContent = await readFile(`/proc/${processRecord.pid}/stat`, "utf8");
                  const lastParenIndex = statContent.lastIndexOf(")");
                  if (lastParenIndex !== -1) {
                    const fields = statContent
                      .substring(lastParenIndex + 1)
                      .trim()
                      .split(/\s+/);
                    const ticks = parseInt(fields[19] || "", 10);
                    if (ticks === processRecord.startTimeTicks) {
                      stillChild = true;
                    }
                  }
                } catch {
                  stillChild = false;
                }

                if (stillChild) {
                  process.kill(processRecord.pid, "SIGKILL");
                  for (let i = 0; i < 10; i++) {
                    await new Promise((r) => setTimeout(r, 200));
                    try {
                      process.kill(processRecord.pid, 0);
                    } catch {
                      killed = true;
                      break;
                    }
                  }
                }
              }

              let stillAlive = false;
              try {
                process.kill(processRecord.pid, 0);
                stillAlive = true;
              } catch {
                stillAlive = false;
              }

              if (stillAlive) {
                stderr(
                  `Error: Process PID ${processRecord.pid} could not be terminated. Cleanup aborted.`
                );
                return 1;
              }
            } catch (kErr) {
              stderr(
                `Error signaling process PID ${processRecord.pid}: ${(kErr as Error).message}`
              );
              return 1;
            }
          }
        }

        // Release lock. The GPU lock is keyed on the *launcher* process that
        // called acquireGpuLock, not the spawned ComfyUI child
        // (processRecord.pid) — passing the child's identity here would
        // never match the lock record, silently leaking the lock on every
        // cleanup. Use the launcher identity persisted alongside the
        // process record instead.
        try {
          if (preflight.releaseGpuLock) {
            const releaseResult = await preflight.releaseGpuLock(
              descriptor.target.gpuUuid,
              processRecord?.launcherPid,
              processRecord?.launcherStartTimeTicks ?? undefined,
              processRecord?.gpuLockToken
            );
            if (!releaseResult.released) {
              stderr(
                `Warning: GPU lock for "${descriptor.target.gpuUuid}" was not released: ${releaseResult.reason ?? "unknown reason"}. The lock may require manual recovery.`
              );
            }
          } else {
            const lockResult = await preflight.acquireGpuLock(
              outputRoot,
              descriptor.target.gpuUuid,
              process.pid
            );
            if (lockResult.acquired) {
              await lockResult.release();
            }
          }
        } catch (releaseErr) {
          stderr(
            `Warning: GPU lock release for "${descriptor.target.gpuUuid}" raised an error: ${(releaseErr as Error).message}. The lock may require manual recovery.`
          );
        }

        const removeOutputs =
          (booleanFlags.has("remove-outputs") || booleanFlags.has("delete-outputs")) &&
          !booleanFlags.has("keep-outputs");
        await store.deleteRunFiles(runDir, removeOutputs);

        stdout(
          JSON.stringify(
            {
              status: "cleaned",
              runDir
            },
            null,
            2
          )
        );
        return 0;
      }

      case "catalog": {
        const routeFilter = flags["route"] as "i2v" | "ref2v" | undefined;
        if (routeFilter && routeFilter !== "i2v" && routeFilter !== "ref2v") {
          stderr(`Invalid --route "${routeFilter}". Must be "i2v" or "ref2v".`);
          return 1;
        }

        if (booleanFlags.has("recipes") || flags["type"] === "recipes") {
          let recipes = listSamplingRecipes();
          if (routeFilter) {
            recipes = recipes.filter((r) => r.compatibleRoute === routeFilter);
          }
          stdout(JSON.stringify(recipes, null, 2));
          return 0;
        }

        const variantFilter = (flags["attention-variant"] ?? flags["variant"]) as
          MinimaxH3AttentionVariantName | undefined;

        const coreRevision = flags["comfyui-core-revision"] ?? flags["core-revision"];
        const matchedVariantFilter = flags["matched-variant"]?.toLowerCase();

        let entries = listAttentionCatalogEntries({
          ...(routeFilter !== undefined ? { route: routeFilter } : {}),
          ...(variantFilter !== undefined ? { variantName: variantFilter } : {}),
          ...(coreRevision !== undefined ? { coreRevision } : {})
        });

        if (matchedVariantFilter) {
          entries = entries.filter(
            (e) =>
              e.scope.startsWith(`${matchedVariantFilter}-matched`) ||
              (matchedVariantFilter === "native-sol-attn" && e.scope.startsWith("sol-attn-matched"))
          );
        }

        stdout(JSON.stringify(entries, null, 2));
        return 0;
      }

      case "plan-study": {
        const studyPath = flags["study"] ?? flags["file"];
        if (!studyPath) {
          stderr("Error: --study (or --file) is required for 'plan-study'");
          return 1;
        }
        const resolvedStudyPath = resolveCliPath(studyPath)!;
        let studyRaw: unknown;
        try {
          studyRaw = await store.readJsonFile(resolvedStudyPath);
        } catch (err) {
          stderr(`Error: Failed to read study spec file "${studyPath}": ${(err as Error).message}`);
          return 1;
        }
        let study: MinimaxH3ContinuityStudySpec;
        const studyParse = MinimaxH3ContinuityStudySpecSchema.safeParse(studyRaw);
        if (studyParse.success) {
          study = studyParse.data;
        } else {
          try {
            study = expandContinuityStudyPlan(studyRaw as unknown as ExpandContinuityStudyOptions);
          } catch (expandErr) {
            stderr(
              `Error: Study spec does not match MinimaxH3ContinuityStudySpecSchema:\nSpec errors: ${studyParse.error.message}\nExpansion error: ${(expandErr as Error).message}`
            );
            return 1;
          }
        }

        const safetyCheck = validateSafetyBaselineLinks(study);
        if (!safetyCheck.valid) {
          stderr(
            `Error: Study plan violates safety baseline links:\n${safetyCheck.errors.join("\n")}`
          );
          return 1;
        }

        const edgesCheck = validateStudyComparisonEdges(study);
        if (!edgesCheck.valid) {
          stderr(
            `Error: Study plan violates comparison edge invariants:\n${edgesCheck.errors.join("\n")}`
          );
          return 1;
        }

        const outputPath = flags["output"];
        if (outputPath) {
          const resolvedOutputPath = resolveCliPath(outputPath)!;
          await store.writeDurableJson(resolvedOutputPath, study);
        }

        stdout(JSON.stringify(study, null, 2));
        return 0;
      }

      case "prepare-study": {
        const studyPath = flags["study"] ?? flags["file"];
        if (!studyPath) {
          stderr("Error: --study (or --file) is required for 'prepare-study'");
          return 1;
        }
        const targetHost = flags["target-host"];
        const gpuUuid = flags["gpu-uuid"];
        const comfyuiDir = resolveCliPath(flags["comfyui-dir"]);
        const python = resolveCliPath(flags["python"]);

        if (!targetHost || !gpuUuid || !comfyuiDir || !python) {
          stderr(
            "Error: Missing required target flags (--target-host, --gpu-uuid, --comfyui-dir, --python) for 'prepare-study'"
          );
          return 1;
        }

        const targetCellId = flags["cell"];
        if (!targetCellId) {
          stderr(
            "Error: --cell is required for 'prepare-study'. Whole-study batch preparation is not permitted; prepare cells individually."
          );
          return 1;
        }

        const resolvedStudyPath = resolveCliPath(studyPath)!;
        let studyRaw: unknown;
        try {
          studyRaw = await store.readJsonFile(resolvedStudyPath);
        } catch (err) {
          stderr(`Error: Failed to read study spec file "${studyPath}": ${(err as Error).message}`);
          return 1;
        }

        let study: MinimaxH3ContinuityStudySpec;
        const studyParse = MinimaxH3ContinuityStudySpecSchema.safeParse(studyRaw);
        if (studyParse.success) {
          study = studyParse.data;
        } else {
          try {
            study = expandContinuityStudyPlan(studyRaw as unknown as ExpandContinuityStudyOptions);
          } catch (expandErr) {
            stderr(
              `Error: Study spec does not match MinimaxH3ContinuityStudySpecSchema:\nSpec errors: ${studyParse.error.message}\nExpansion error: ${(expandErr as Error).message}`
            );
            return 1;
          }
        }

        const found = study.cells.find((c) => c.cellId === targetCellId);
        if (!found) {
          stderr(
            `Error: Cell "${targetCellId}" not found in study plan. Available cells: ${study.cells.map((c) => c.cellId).join(", ")}`
          );
          return 1;
        }

        if (found.status === "pending_source") {
          stderr(
            `Error: Cannot prepare cell "${found.cellId}": status is 'pending_source' (${found.pendingReason ?? "missing source"})`
          );
          return 1;
        }

        let humanReviewsForCombinedPrerequisites: MinimaxH3ContinuityReviewSidecar[] | undefined;
        if (flags["prerequisite-reviews"]) {
          const prereqPath = resolveCliPath(flags["prerequisite-reviews"])!;
          let rawData: unknown;
          try {
            rawData = await store.readJsonFile(prereqPath);
          } catch {
            rawData = JSON.parse(await readFile(prereqPath, "utf8"));
          }
          const reviewsArray = Array.isArray(rawData) ? rawData : [rawData];
          humanReviewsForCombinedPrerequisites = [];
          for (const item of reviewsArray) {
            const parsed = MinimaxH3ContinuityReviewSidecarSchema.safeParse(item);
            if (!parsed.success) {
              stderr(
                `Error: Prerequisite review does not match MinimaxH3ContinuityReviewSidecarSchema: ${parsed.error.message}`
              );
              return 1;
            }
            humanReviewsForCombinedPrerequisites.push(parsed.data);
          }
        }

        if (
          found.arm === "combined" &&
          (!humanReviewsForCombinedPrerequisites ||
            humanReviewsForCombinedPrerequisites.length === 0)
        ) {
          stderr(
            `Error: Cannot prepare combined arm cell "${found.cellId}" without independent evaluations; specify --prerequisite-reviews`
          );
          return 1;
        }

        const address = flags["address"] ?? "127.0.0.1";
        const port = flags["port"] ? parseStrictInt(flags["port"]) : 8188;
        if (port === null) {
          stderr(`Error: Invalid --port "${flags["port"]}"`);
          return 1;
        }
        const templatesDir = flags["templates-dir"]
          ? resolveCliPath(flags["templates-dir"])
          : undefined;

        try {
          const res = await prepareContinuityStudyCell({
            study,
            cellId: found.cellId,
            outputRoot,
            targetHost,
            gpuUuid,
            comfyUiDir: comfyuiDir,
            pythonPath: python,
            address,
            port,
            ...(templatesDir !== undefined ? { templatesDir } : {}),
            ...(humanReviewsForCombinedPrerequisites !== undefined
              ? { humanReviewsForCombinedPrerequisites }
              : {}),
            sourceBaseDir: process.cwd(),
            store,
            service,
            preflight
          });
          stdout(
            JSON.stringify(
              {
                status: "prepared",
                studyId: study.studyId,
                preparedCount: 1,
                skippedCount: 0,
                receipts: [
                  {
                    cellId: found.cellId,
                    runId: res.descriptor.runId,
                    runDir: `${outputRoot}/${res.descriptor.runId}`,
                    descriptorDigest: res.descriptor.descriptorDigest ?? null
                  }
                ]
              },
              null,
              2
            )
          );
          return 0;
        } catch (prepErr) {
          stderr(`Error preparing cell "${found.cellId}": ${(prepErr as Error).message}`);
          return 1;
        }
      }

      case "review-plan": {
        const studyPath = flags["study"] ?? flags["file"];
        if (!studyPath) {
          stderr("Error: --study (or --file) is required for 'review-plan'");
          return 1;
        }
        const resolvedStudyPath = resolveCliPath(studyPath)!;
        let studyRaw: unknown;
        try {
          studyRaw = await store.readJsonFile(resolvedStudyPath);
        } catch (err) {
          stderr(`Error: Failed to read study spec file "${studyPath}": ${(err as Error).message}`);
          return 1;
        }
        const studyParse = MinimaxH3ContinuityStudySpecSchema.safeParse(studyRaw);
        if (!studyParse.success) {
          stderr(
            `Error: Study spec does not match MinimaxH3ContinuityStudySpecSchema: ${studyParse.error.message}`
          );
          return 1;
        }
        const study = studyParse.data;

        const runsArg = flags["runs"];
        const runResults = new Map<
          string,
          {
            descriptor: MinimaxH3ExperimentDescriptorV2;
            result?: MinimaxH3ExperimentResultV2 | null;
            outputSha256?: string | null;
            outputSizeBytes?: number | null;
            outputRelativePath?: string | null;
            collectionStatus?: "pending" | "available" | "unavailable" | "failed";
          }
        >();

        if (runsArg) {
          const candidateDirs: string[] = [];
          const entries = runsArg
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          for (const entry of entries) {
            const resolvedPath = resolveCliPath(entry)!;
            candidateDirs.push(resolvedPath);
            if (resolvedPath.endsWith(".json")) {
              try {
                let jsonContent: unknown;
                try {
                  jsonContent = await store.readJsonFile(resolvedPath);
                } catch {
                  jsonContent = JSON.parse(await readFile(resolvedPath, "utf8"));
                }
                const runsList = Array.isArray(jsonContent)
                  ? jsonContent
                  : jsonContent &&
                      typeof jsonContent === "object" &&
                      Array.isArray((jsonContent as { runs?: unknown[] }).runs)
                    ? (jsonContent as { runs: unknown[] }).runs
                    : null;
                if (runsList) {
                  for (const item of runsList) {
                    if (typeof item === "string") {
                      candidateDirs.push(resolveCliPath(item)!);
                    } else if (
                      item &&
                      typeof item === "object" &&
                      typeof (item as { runDir?: string }).runDir === "string"
                    ) {
                      candidateDirs.push(resolveCliPath((item as { runDir: string }).runDir)!);
                    }
                  }
                }
              } catch {
                // Not a valid json runs file
              }
            }
            try {
              const subEntries = await readdir(resolvedPath, { withFileTypes: true });
              for (const dirent of subEntries) {
                if (dirent.isDirectory()) {
                  candidateDirs.push(`${resolvedPath}/${dirent.name}`);
                }
              }
            } catch {
              // Not a local directory or using mock store
            }
            const candidateStore = store as { files?: unknown };
            if (candidateStore.files instanceof Map) {
              const mockFiles = candidateStore.files as Map<string, string>;
              for (const key of mockFiles.keys()) {
                if (key.startsWith(entry) || key.startsWith(resolvedPath)) {
                  const parts = key.split("/");
                  if (parts.length > 1) {
                    const dir = parts.slice(0, -1).join("/");
                    if (!candidateDirs.includes(dir)) {
                      candidateDirs.push(dir);
                    }
                  }
                }
              }
            }
          }

          for (const runDir of candidateDirs) {
            let descriptor: MinimaxH3ExperimentDescriptorV2 | null = null;
            try {
              descriptor = (await store.readDescriptor(runDir)) as MinimaxH3ExperimentDescriptorV2;
            } catch {
              try {
                descriptor = (await store.readJsonFile(
                  `${runDir}/descriptor.json`
                )) as MinimaxH3ExperimentDescriptorV2;
              } catch {
                continue;
              }
            }
            if (!descriptor) continue;

            let cellId: string | null = null;
            try {
              const studyLink = await store.readJsonFile<{ studyId?: string; cellId?: string }>(
                `${runDir}/study_link.json`
              );
              if (studyLink?.cellId) {
                if (!studyLink.studyId || studyLink.studyId === study.studyId) {
                  cellId = studyLink.cellId;
                }
              }
            } catch {
              // ignore
            }

            if (!cellId && descriptor.operatorLabel) {
              const prefix = `${study.studyId}:`;
              if (descriptor.operatorLabel.startsWith(prefix)) {
                cellId = descriptor.operatorLabel.slice(prefix.length);
              }
            }

            if (!cellId) {
              for (const c of study.cells) {
                const expectedRunId = `${study.studyId}-${c.cellId}`
                  .toLowerCase()
                  .replace(/[^a-z0-9._-]/g, "-");
                if (descriptor.runId === expectedRunId) {
                  cellId = c.cellId;
                  break;
                }
              }
            }

            if (!cellId) continue;

            let result: MinimaxH3ExperimentResultV2 | null = null;
            try {
              result = (await store.readResult(runDir)) as MinimaxH3ExperimentResultV2 | null;
            } catch {
              try {
                result = (await store.readJsonFile(
                  `${runDir}/result.json`
                )) as MinimaxH3ExperimentResultV2 | null;
              } catch {
                result = null;
              }
            }

            let outputSha256: string | null = null;
            let outputSizeBytes: number | null = null;
            let outputRelativePath: string | null = null;
            let collectionStatus: "pending" | "available" | "unavailable" | "failed" = "pending";

            if (result) {
              if (result.execution?.status === "failed") {
                collectionStatus = "failed";
              } else if (result.probe?.outputFile) {
                outputRelativePath = result.probe.outputFile;
                const outputFilePath = resolve(runDir, result.probe.outputFile);
                try {
                  const hashInfo = await store.hashFile(outputFilePath);
                  if (result.probe.outputSha256 && hashInfo.sha256 !== result.probe.outputSha256) {
                    collectionStatus = "unavailable";
                  } else {
                    collectionStatus = "available";
                    outputSha256 = hashInfo.sha256;
                    outputSizeBytes = hashInfo.sizeBytes;
                  }
                } catch {
                  collectionStatus = "unavailable";
                }
              } else {
                collectionStatus = "unavailable";
              }
            }

            runResults.set(cellId, {
              descriptor,
              result,
              outputSha256,
              outputSizeBytes,
              outputRelativePath,
              collectionStatus
            });
          }
        }

        const storyboardPlan = buildContinuityStoryboardPlan({ study, runResults });
        const reviewManifest = buildContinuityReviewManifest(study, storyboardPlan);

        const combinedReviewPlan = {
          studyId: study.studyId,
          studyDigest: study.studyDigest,
          storyboardPlan,
          reviewManifest
        };

        const outputPath = flags["output"];
        if (outputPath) {
          const resolvedOutputPath = resolveCliPath(outputPath)!;
          await store.writeDurableJson(resolvedOutputPath, combinedReviewPlan);
        }

        stdout(JSON.stringify(combinedReviewPlan, null, 2));
        return 0;
      }

      default:
        stderr(`Unknown subcommand "${subcommand}". See --help for usage.`);
        return 1;
    }
  } catch (err) {
    stderr(`Error executing "${subcommand}": ${(err as Error).message}`);
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
  void runExperimentCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
