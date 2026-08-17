import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface RenderCliOptions {
  readonly profileId: string;
  readonly comfyUiDir: string;
  readonly comfyUiUrl: string;
  readonly goldMasterProvenancePath: string;
  readonly manifestPath: string;
  readonly gpuIndex: number;
  readonly leasePath: string;
  readonly renderTimeoutMs: number;
  readonly renderJobId: string;
  readonly sceneId: string;
}

export type RenderCliParsedArgs =
  Readonly<{ kind: "help" }> | Readonly<{ kind: "run"; options: RenderCliOptions }>;

const DEFAULT_REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../");
const DEFAULT_MANIFEST_PATH = resolve(DEFAULT_REPO_ROOT, "templates/provenance.json");
const DEFAULT_GPU_INDEX = 0;
const DEFAULT_RENDER_TIMEOUT_MS = 300_000;
const PATH_SAFE_ID_REGEX = /^[a-z0-9][a-z0-9._-]*$/;

const KNOWN_FLAGS: ReadonlySet<string> = new Set([
  "--profile",
  "--comfyui-dir",
  "--comfyui-url",
  "--gold-master-provenance",
  "--manifest",
  "--gpu-index",
  "--lease-path",
  "--render-timeout-ms",
  "--render-job-id",
  "--scene-id",
  "--help",
  "-h"
]);

const VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--profile",
  "--comfyui-dir",
  "--comfyui-url",
  "--gold-master-provenance",
  "--manifest",
  "--gpu-index",
  "--lease-path",
  "--render-timeout-ms",
  "--render-job-id",
  "--scene-id"
]);

export function getRenderUsageHelp(): string {
  return `Usage: render --profile <profile-id> --comfyui-dir <path> --comfyui-url <url> --gold-master-provenance <path> [options]

Render a deterministic profile through ComfyUI.

Required flags:
  --profile <profile-id>           Profile ID from the manifest (path-safe lowercase ID)
  --comfyui-dir <path>             Path to ComfyUI installation directory
  --comfyui-url <url>              ComfyUI HTTP/WebSocket base URL (e.g. http://127.0.0.1:8188)
  --gold-master-provenance <path>  Path to approved Gold Master provenance JSON

Optional flags:
  --manifest <path>                Path to the profile manifest JSON (default: templates/provenance.json)
  --gpu-index <index>              Zero-based NVIDIA GPU device index (default: 0)
  --lease-path <path>               Local filesystem lock path (default: host temp directory GPU lock)
  --render-timeout-ms <ms>          Positive render timeout in milliseconds (default: 300000)
  --render-job-id <id>             Render job ID (default: cli-render-<profile-id>)
  --scene-id <id>                  Scene ID (default: cli-scene-<profile-id>)
  --help, -h                       Show this help message

The lock path must be on a local filesystem. Lease contention returns non-zero immediately.`;
}

function isFlag(arg: string | undefined): boolean {
  if (arg === undefined) return false;
  if (arg.startsWith("--")) return true;
  if (arg === "-h") return true;
  return false;
}

function validatePathSafeId(flag: string, value: string): string {
  const trimmedValue = value.trim();
  if (
    !PATH_SAFE_ID_REGEX.test(trimmedValue) ||
    trimmedValue.includes("..") ||
    trimmedValue.includes("/") ||
    trimmedValue.includes("\\")
  ) {
    throw new Error(
      `Invalid ${flag} "${value}": must be a lowercase path-safe string matching ^[a-z0-9][a-z0-9._-]*$`
    );
  }
  return trimmedValue;
}

function parseInteger(
  flag: string,
  value: string,
  predicate: (number: number) => boolean,
  description: string
): number {
  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || !predicate(parsedValue)) {
    throw new Error(`${flag} must be a ${description}, received: "${value}"`);
  }
  return parsedValue;
}

export function parseRenderCliArgs(argv: readonly string[]): RenderCliParsedArgs {
  if (argv.includes("--help") || argv.includes("-h")) {
    return Object.freeze({ kind: "help" });
  }

  let profileId: string | undefined;
  let comfyUiDir: string | undefined;
  let comfyUiUrl: string | undefined;
  let goldMasterProvenancePath: string | undefined;
  let manifestPath: string | undefined;
  let gpuIndex: number | undefined;
  let leasePath: string | undefined;
  let renderTimeoutMs: number | undefined;
  let renderJobId: string | undefined;
  let sceneId: string | undefined;

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

      if (VALUE_FLAGS.has(flag) && (value === undefined || value.trim() === "")) {
        throw new Error(`Flag "${flag}" requires a value`);
      }

      switch (flag) {
        case "--profile":
          profileId = validatePathSafeId(flag, value!);
          break;
        case "--comfyui-dir":
          comfyUiDir = value;
          break;
        case "--comfyui-url":
          comfyUiUrl = value;
          break;
        case "--gold-master-provenance":
          goldMasterProvenancePath = value;
          break;
        case "--manifest":
          manifestPath = value;
          break;
        case "--gpu-index":
          gpuIndex = parseInteger(
            flag,
            value!,
            (parsedValue) => parsedValue >= 0,
            "non-negative integer"
          );
          break;
        case "--lease-path":
          leasePath = value;
          break;
        case "--render-timeout-ms":
          renderTimeoutMs = parseInteger(
            flag,
            value!,
            (parsedValue) => parsedValue > 0,
            "positive integer"
          );
          break;
        case "--render-job-id":
          renderJobId = validatePathSafeId(flag, value!);
          break;
        case "--scene-id":
          sceneId = validatePathSafeId(flag, value!);
          break;
      }
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!profileId || profileId.trim() === "") {
    throw new Error("Missing required flag: --profile");
  }

  if (!comfyUiDir || comfyUiDir.trim() === "") {
    throw new Error("Missing required flag: --comfyui-dir");
  }

  if (!comfyUiUrl || comfyUiUrl.trim() === "") {
    throw new Error("Missing required flag: --comfyui-url");
  }

  if (!goldMasterProvenancePath || goldMasterProvenancePath.trim() === "") {
    throw new Error("Missing required flag: --gold-master-provenance");
  }

  const effectiveGpuIndex = gpuIndex ?? DEFAULT_GPU_INDEX;

  return Object.freeze({
    kind: "run" as const,
    options: Object.freeze({
      profileId,
      comfyUiDir,
      comfyUiUrl,
      goldMasterProvenancePath,
      manifestPath: manifestPath ?? DEFAULT_MANIFEST_PATH,
      gpuIndex: effectiveGpuIndex,
      leasePath:
        leasePath ?? join(tmpdir(), `comfy-content-orchestrator-gpu-${effectiveGpuIndex}.lock`),
      renderTimeoutMs: renderTimeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS,
      renderJobId: renderJobId ?? `cli-render-${profileId}`,
      sceneId: sceneId ?? `cli-scene-${profileId}`
    })
  });
}
