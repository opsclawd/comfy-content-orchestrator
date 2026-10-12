import { readFile, readlink } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  findRepositoryRoot,
  MinimaxH3ExperimentService,
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
  type MinimaxH3ExperimentCandidateFrames,
  type MinimaxH3ExperimentDescriptor,
  type MinimaxH3ProcessRecord
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
  prepare        Create isolated experiment directory, derive workflow, and stage inputs
  validate       Dry-run offline validation of descriptor, graph hashes, and environment rules
  run            Execute isolated experiment on owned local ComfyUI child with telemetry
  reconcile      Reconstruct and persist result.json from durable records and server state
  cleanup        Release GPU lock and clean up temporary files without mutating results
  import-sidecar Import visual review sidecar into an existing run result.json

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

Options for 'cleanup':
  --run-dir <path>               Experiment run directory to clean up (required)
  --output-root <dir>            Experiment output root (default: ${DEFAULT_OUTPUT_ROOT})
  --keep-outputs                 Explicitly retain output files (default behavior)
  --remove-outputs               Delete output video files in addition to temporary files

Options for 'import-sidecar':
  --run-dir <path>               Prepared or executed run directory path (required)
  --sidecar <path>               Visual review sidecar JSON file path (required)
  --output-root <dir>            Experiment output root (default: ${DEFAULT_OUTPUT_ROOT})
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
    "templates-dir"
  ]),
  validate: new Set(["run-dir", "output-root", "templates-dir"]),
  run: new Set(["run-dir", "output-root", "stop-policy", "baseline-run-dir", "templates-dir"]),
  reconcile: new Set(["run-dir", "output-root"]),
  cleanup: new Set(["run-dir", "output-root", "keep-outputs", "remove-outputs", "delete-outputs"]),
  "import-sidecar": new Set(["run-dir", "output-root", "sidecar", "file"]),
  "validate-sidecar": new Set(["file", "sidecar", "run-dir", "output-root"])
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
  "run-dir",
  "stop-policy",
  "baseline-run-dir",
  "file",
  "sidecar"
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
          ...(typeof requestedDurationMs === "number" ? { requestedDurationMs } : {})
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
              comparisonKey: result.descriptor.comparisonKey
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

        let sidecarType: "visual_review" | "operator_decision" | "matrix_row";
        let sidecar: unknown;

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
                `Error: File does not match MinimaxH3VisualReviewSidecarSchema, MinimaxH3OperatorDecisionSidecarSchema, or MinimaxH3MatrixRowSchema:\nVisual review errors: ${visualCheck.error.message}\nOperator decision errors: ${decisionCheck.error.message}\nMatrix row errors: ${matrixCheck.error.message}`
              );
              return 1;
            }
          }
        }

        // If --run-dir is provided, cross-validate against run descriptor/result
        const runDir = flags["run-dir"];
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

            if (sidecarType === "visual_review") {
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

        let sidecar;
        try {
          sidecar = MinimaxH3VisualReviewSidecarSchema.parse(sidecarRaw);
        } catch (err) {
          stderr(`Error: Invalid visual review sidecar schema: ${(err as Error).message}`);
          return 1;
        }

        let descriptor: MinimaxH3ExperimentDescriptor;
        try {
          descriptor = await store.readDescriptor(runDir);
        } catch (err) {
          stderr(`Error: Failed to read descriptor from "${runDir}": ${(err as Error).message}`);
          return 1;
        }

        if (sidecar.runId !== descriptor.runId) {
          stderr(
            `Error: Sidecar runId "${sidecar.runId}" does not match run descriptor "${descriptor.runId}"`
          );
          return 1;
        }

        const result = await store.readResult(runDir);
        if (!result) {
          stderr(`Error: No result.json found in run directory "${runDir}" to import sidecar into`);
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
            {
              status: "imported",
              runId: descriptor.runId,
              visualReviewStatus: sidecar.status
            },
            null,
            2
          )
        );
        return 0;
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

        let descriptor: MinimaxH3ExperimentDescriptor;
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
