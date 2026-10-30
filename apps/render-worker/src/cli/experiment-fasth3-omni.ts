import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { FastH3OmniPreparationService } from "@cco/application";
import { FastH3OmniFilesystemAdapter } from "@cco/infrastructure";

const DEFAULT_EXPERIMENT_ROOT = ".ai-runs/fasth3-omni-experiments";

function resolveCliPath(rawPath?: string): string | undefined {
  if (!rawPath) return undefined;
  if (isAbsolute(rawPath)) {
    return rawPath;
  }
  return resolve(process.cwd(), rawPath);
}

function parseStrictInt(str?: string): number | null {
  if (!str) return null;
  if (!/^-?\d+$/.test(str.trim())) return null;
  const num = Number(str.trim());
  return Number.isSafeInteger(num) ? num : null;
}

export interface ExperimentFastH3OmniCliDependencies {
  readonly service?: FastH3OmniPreparationService;
  readonly stdout?: (msg: string) => void;
  readonly stderr?: (msg: string) => void;
}

export function printHelp(stdout: (msg: string) => void): void {
  stdout(`
Isolated FastH3-Omni Multi-Reference Candidate Experiment Launcher (Phase A)

Usage:
  experiment:fasth3-omni <subcommand> [options]

Subcommands:
  prepare        Create isolated run directory, stage immutable references, and compile FastVideo SM89 config
  validate       Dry-run offline validation of descriptor, reference bindings, and hardware fences

Options for 'prepare':
  --run-id <id>                  Alphanumeric experiment run identifier (required)
  --manifest <path>              Campaign reference export JSON manifest path (required)
  --prompt <string>              Prompt string containing <Picture N> binding tags
  --prompt-file <path>           File path containing prompt text
  --frames <count>               Discrete frame count: 124, 243, or 362 (required)
  --seed <int>                   Non-negative integer seed (required)
  --width <int>                  Render width in pixels (default: 832)
  --height <int>                 Render height in pixels (default: 480)
  --fps <int>                    Frames per second (default: 24)
  --output-root <dir>            Root directory for isolated runs (default: ${DEFAULT_EXPERIMENT_ROOT})

Options for 'validate':
  --run-dir <dir>                Path to prepared experiment run directory (required)
  --output-root <dir>            Root directory for isolated runs (default: ${DEFAULT_EXPERIMENT_ROOT})
  --strict-readiness             Exit non-zero if execution readiness is blocked

Note on Physical Execution ('run'):
  Execution is forbidden in Phase A offline candidate exploration.
  Physical RTX 4090 benchmarking belongs to Phase B under human operator authority.
  See docs/fasth3-omni-experiments.md for the operator runbook.
`);
}

export function parseArgs(rawArgs: readonly string[]): {
  subcommand: string;
  flags: Record<string, string>;
  booleanFlags: Set<string>;
  unknownPositionalArgs: string[];
} {
  const flags: Record<string, string> = {};
  const booleanFlags = new Set<string>();
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

    if (arg === "--strict-readiness") {
      booleanFlags.add("strict-readiness");
      continue;
    }

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const nextArg = rawArgs[i + 1];
      if (nextArg !== undefined && !nextArg.startsWith("-")) {
        flags[key] = nextArg;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }

  return { subcommand, flags, booleanFlags, unknownPositionalArgs };
}

export async function main(
  args: readonly string[],
  deps: ExperimentFastH3OmniCliDependencies = {}
): Promise<number> {
  const stdout = deps.stdout ?? ((msg: string) => console.log(msg));
  const stderr = deps.stderr ?? ((msg: string) => console.error(msg));
  const service =
    deps.service ?? new FastH3OmniPreparationService(new FastH3OmniFilesystemAdapter());

  const { subcommand, flags, booleanFlags, unknownPositionalArgs } = parseArgs(args);

  if (booleanFlags.has("help") || subcommand === "help" || (!subcommand && args.length === 0)) {
    printHelp(stdout);
    return 0;
  }

  if (unknownPositionalArgs.length > 0) {
    stderr(`Error: Unexpected positional arguments: ${unknownPositionalArgs.join(", ")}`);
    return 1;
  }

  switch (subcommand) {
    case "run": {
      stderr(
        "Error: Execution ('run') is forbidden in Phase A offline candidate exploration.\n" +
          "Hardware benchmarking on RTX 4090 requires operator-driven Phase B execution with verified weights and legal sign-off.\n" +
          "See docs/fasth3-omni-experiments.md for the operator runbook."
      );
      return 1;
    }

    case "prepare": {
      const runId = flags["run-id"];
      const manifestPath = resolveCliPath(flags["manifest"]);
      const prompt = flags["prompt"];
      const promptFile = resolveCliPath(flags["prompt-file"]);
      const frames = parseStrictInt(flags["frames"]);
      const seed = parseStrictInt(flags["seed"]);
      const width = flags["width"] ? parseStrictInt(flags["width"]) : 832;
      const height = flags["height"] ? parseStrictInt(flags["height"]) : 480;
      const fps = flags["fps"] ? parseStrictInt(flags["fps"]) : 24;
      const outputRoot = resolveCliPath(flags["output-root"]) ?? DEFAULT_EXPERIMENT_ROOT;

      if (!runId || !manifestPath || frames === null || seed === null) {
        stderr(
          "Error: Missing required flags for 'prepare'. Requires --run-id, --manifest, --frames, --seed."
        );
        return 1;
      }

      if (!prompt && !promptFile) {
        stderr("Error: Either --prompt or --prompt-file must be provided for 'prepare'.");
        return 1;
      }

      try {
        const prep = await service.prepareExperiment({
          runId,
          manifestPath,
          prompt,
          promptPath: promptFile,
          frames,
          seed,
          width: width ?? 832,
          height: height ?? 480,
          fps: fps ?? 24,
          outputRoot
        });

        stdout(`Successfully prepared FastH3-Omni experiment at: ${prep.runDir}`);
        stdout(`Descriptor Digest: ${prep.spec.descriptorDigest}`);
        stdout(`Readiness Status: ${prep.spec.readinessStatus}`);
        stdout(`Executable: ${prep.spec.isExecutable}`);
        if (prep.spec.executionBlockers.length > 0) {
          stdout("Execution Blockers:");
          for (const b of prep.spec.executionBlockers) {
            stdout(`  - ${b}`);
          }
        }
        return 0;
      } catch (err) {
        stderr(`Error preparing experiment: ${(err as Error).message}`);
        return 1;
      }
    }

    case "validate": {
      const runDir = resolveCliPath(flags["run-dir"]);
      const outputRoot = resolveCliPath(flags["output-root"]) ?? DEFAULT_EXPERIMENT_ROOT;
      const strictReadiness = booleanFlags.has("strict-readiness");

      if (!runDir) {
        stderr("Error: --run-dir is required for 'validate'.");
        return 1;
      }

      try {
        const result = await service.validateExperiment(runDir, { outputRoot });
        if (!result.ok) {
          stderr("Experiment validation FAILED:");
          for (const err of result.errors) {
            stderr(`  - ${err}`);
          }
          return 1;
        }

        stdout(`Validation PASSED for ${runDir}`);
        stdout(`Readiness Status: ${result.readinessStatus}`);
        stdout(`Is Executable: ${result.isExecutable}`);
        if (result.executionBlockers.length > 0) {
          stdout("Execution Blockers (Operator Preflight Required):");
          for (const b of result.executionBlockers) {
            stdout(`  - ${b}`);
          }
        }

        if (
          strictReadiness &&
          (!result.isExecutable || result.readinessStatus !== "offline_validated")
        ) {
          stderr("Strict readiness check failed: run is not executable on target hardware.");
          return 1;
        }

        return 0;
      } catch (err) {
        stderr(`Validation error: ${(err as Error).message}`);
        return 1;
      }
    }

    default: {
      stderr(`Error: Unknown subcommand "${subcommand}". See --help for available commands.`);
      return 1;
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
