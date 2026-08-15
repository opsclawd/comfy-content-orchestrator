import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { collectCertificationProvenance, type CertificationProvenanceReport } from "./collector.js";
import { loadCertificationProfile, type CertificationProfile } from "./profile-manifest.js";

export interface ProvenanceCliOptions {
  readonly comfyUiDir: string;
  readonly profileId: string;
  readonly manifestPath: string;
}

export interface ProvenanceCliDependencies {
  readonly loadCertificationProfile?: typeof loadCertificationProfile;
  readonly collectCertificationProvenance?: typeof collectCertificationProvenance;
}

const DEFAULT_MANIFEST_PATH = fileURLToPath(
  new URL("../../../../../templates/provenance.json", import.meta.url)
);

function getUsageHelp(): string {
  return `Usage: provenance --comfyui-dir <path> --profile <id> [--manifest <path>]

Collect ComfyUI provenance and output a JSON certification report.

Required flags:
  --comfyui-dir <path>   Path to the ComfyUI installation directory
  --profile <id>         Profile ID to certify (e.g. ltx-25-720p-97f)

Optional flags:
  --manifest <path>      Path to the certification manifest JSON (default: templates/provenance.json)
  --help, -h             Show this help message`;
}

const KNOWN_FLAGS: ReadonlySet<string> = new Set(["--comfyui-dir", "--profile", "--manifest"]);

export function parseCliArgs(
  argv: readonly string[]
): Readonly<{ kind: "help" }> | Readonly<{ kind: "run"; options: ProvenanceCliOptions }> {
  if (argv.includes("--help") || argv.includes("-h")) {
    return Object.freeze({ kind: "help" });
  }

  let comfyUiDir: string | undefined;
  let profileId: string | undefined;
  let manifestPath: string | undefined;

  const seenFlags = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--") {
      continue;
    }

    if (arg.startsWith("--")) {
      const equalsIndex = arg.indexOf("=");
      let flag: string;
      let value: string | undefined;

      if (equalsIndex !== -1) {
        flag = arg.slice(0, equalsIndex);
        value = arg.slice(equalsIndex + 1);
      } else {
        flag = arg;
        const nextArg = argv[i + 1];
        if (nextArg !== undefined && !nextArg.startsWith("-")) {
          value = nextArg;
          i++;
        }
      }

      if (!KNOWN_FLAGS.has(flag)) {
        throw new Error(`Unknown flag: ${flag}`);
      }

      if (seenFlags.has(flag)) {
        throw new Error(`Duplicate flag: ${flag}`);
      }
      seenFlags.add(flag);

      if (value === undefined || value.trim() === "") {
        throw new Error(`Flag "${flag}" requires a value`);
      }

      switch (flag) {
        case "--comfyui-dir":
          comfyUiDir = value;
          break;
        case "--profile":
          profileId = value;
          break;
        case "--manifest":
          manifestPath = value;
          break;
      }
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!comfyUiDir || comfyUiDir.trim() === "") {
    throw new Error("Missing required flag: --comfyui-dir");
  }

  if (!profileId || profileId.trim() === "") {
    throw new Error("Missing required flag: --profile");
  }

  const options: ProvenanceCliOptions = Object.freeze({
    comfyUiDir,
    profileId,
    manifestPath: manifestPath ?? DEFAULT_MANIFEST_PATH
  });

  return Object.freeze({
    kind: "run",
    options
  });
}

export async function runCli(
  argv: readonly string[],
  io?: Readonly<{ stdout: (line: string) => void; stderr: (line: string) => void }>,
  dependencies?: ProvenanceCliDependencies
): Promise<number> {
  const stdout = io?.stdout ?? ((line: string) => console.log(line));
  const stderr = io?.stderr ?? ((line: string) => console.error(line));
  const loadCertificationProfileFn =
    dependencies?.loadCertificationProfile ?? loadCertificationProfile;
  const collectCertificationProvenanceFn =
    dependencies?.collectCertificationProvenance ?? collectCertificationProvenance;

  let parsed: ReturnType<typeof parseCliArgs>;
  try {
    parsed = parseCliArgs(argv);
  } catch (err) {
    stderr((err as Error).message);
    return 1;
  }

  if (parsed.kind === "help") {
    stdout(getUsageHelp());
    return 0;
  }

  const { comfyUiDir, profileId, manifestPath } = parsed.options;

  try {
    const profile: CertificationProfile = await loadCertificationProfileFn(manifestPath, profileId);
    const report: CertificationProvenanceReport = await collectCertificationProvenanceFn({
      comfyUiDir,
      profile,
      onProgress: (event) => {
        const detail = event.detail ? ` (${event.detail})` : "";
        stderr(`[provenance] ${event.phase}: ${event.status}${detail}`);
      }
    });
    stdout(JSON.stringify(report));
    return 0;
  } catch (err) {
    stderr((err as Error).message);
    return 1;
  }
}

function isDirectExecution(): boolean {
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
  void runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
