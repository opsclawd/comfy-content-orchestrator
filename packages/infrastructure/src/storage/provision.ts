import { S3Client } from "@aws-sdk/client-s3";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { provisionStorageBuckets, type StorageProvisioningSummary } from "./provisioner.js";

export interface StorageProvisionCliOptions {
  readonly endpoint: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region: string;
  readonly forcePathStyle: boolean;
}

export interface ProvisionCliDependencies {
  readonly provisionStorageBucketsFn?: typeof provisionStorageBuckets;
}

function getUsageHelp(): string {
  return `Usage: pnpm storage:provision [options]

Provision S3/MinIO bucket classes and lifecycle configurations.

Options:
  --endpoint <url>          S3 endpoint URL (or S3_ENDPOINT env)
  --access-key <key>        AWS/MinIO Access Key (or AWS_ACCESS_KEY_ID / MINIO_ROOT_USER)
  --secret-key <key>        AWS/MinIO Secret Key (or AWS_SECRET_ACCESS_KEY / MINIO_ROOT_PASSWORD)
  --region <region>         AWS Region (default: us-east-1)
  --force-path-style <bool> Use path-style S3 URLs (default: true)
  --help, -h                Show this help message`;
}

export function parseProvisionCliArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): Readonly<{ kind: "help" }> | Readonly<{ kind: "run"; options: StorageProvisionCliOptions }> {
  if (argv.includes("--help") || argv.includes("-h")) {
    return Object.freeze({ kind: "help" });
  }

  let endpoint = env.S3_ENDPOINT?.trim();
  let accessKeyId = (env.AWS_ACCESS_KEY_ID ?? env.MINIO_ROOT_USER)?.trim();
  let secretAccessKey = (env.AWS_SECRET_ACCESS_KEY ?? env.MINIO_ROOT_PASSWORD)?.trim();
  let region = (env.AWS_REGION ?? env.S3_REGION ?? "us-east-1").trim();
  let forcePathStyle = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (arg === "--endpoint" && argv[i + 1] !== undefined) {
      endpoint = argv[++i]?.trim();
    } else if (arg.startsWith("--endpoint=")) {
      endpoint = arg.slice("--endpoint=".length).trim();
    } else if (arg === "--access-key" && argv[i + 1] !== undefined) {
      accessKeyId = argv[++i]?.trim();
    } else if (arg.startsWith("--access-key=")) {
      accessKeyId = arg.slice("--access-key=".length).trim();
    } else if (arg === "--secret-key" && argv[i + 1] !== undefined) {
      secretAccessKey = argv[++i]?.trim();
    } else if (arg.startsWith("--secret-key=")) {
      secretAccessKey = arg.slice("--secret-key=".length).trim();
    } else if (arg === "--region" && argv[i + 1] !== undefined) {
      region = argv[++i]?.trim() ?? "us-east-1";
    } else if (arg.startsWith("--region=")) {
      region = arg.slice("--region=".length).trim();
    } else if (
      arg === "--force-path-style" &&
      argv[i + 1] !== undefined &&
      !argv[i + 1]?.startsWith("-")
    ) {
      forcePathStyle = argv[++i]?.trim() !== "false";
    } else if (arg.startsWith("--force-path-style=")) {
      forcePathStyle = arg.slice("--force-path-style=".length).trim() !== "false";
    }
  }

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing required configuration. Provide --endpoint, --access-key, --secret-key flags or set S3_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY environment variables."
    );
  }

  return Object.freeze({
    kind: "run",
    options: Object.freeze({
      endpoint,
      accessKeyId,
      secretAccessKey,
      region: region || "us-east-1",
      forcePathStyle
    })
  });
}

export async function runProvisionCli(
  argv: readonly string[],
  io?: Readonly<{ stdout: (line: string) => void; stderr: (line: string) => void }>,
  dependencies?: ProvisionCliDependencies,
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const stdout = io?.stdout ?? ((line: string) => console.log(line));
  const stderr = io?.stderr ?? ((line: string) => console.error(line));
  const provisionFn = dependencies?.provisionStorageBucketsFn ?? provisionStorageBuckets;

  let parsed: ReturnType<typeof parseProvisionCliArgs>;
  try {
    parsed = parseProvisionCliArgs(argv, env);
  } catch (err) {
    stderr((err as Error).message);
    return 1;
  }

  if (parsed.kind === "help") {
    stdout(getUsageHelp());
    return 0;
  }

  const { endpoint, accessKeyId, secretAccessKey, region, forcePathStyle } = parsed.options;

  const client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle
  });

  try {
    stdout(`[provision] Connecting to S3 endpoint: ${endpoint} (region: ${region})`);
    const summary: StorageProvisioningSummary = await provisionFn({
      client,
      logger: stdout
    });

    stdout("\n--- Provisioning Summary ---");
    stdout(`Total buckets: ${summary.results.length}`);
    stdout(`Created: ${summary.createdCount}`);
    stdout(`Already existing: ${summary.alreadyExistsCount}`);
    stdout(`Lifecycle rules applied: ${summary.lifecycleAppliedCount}`);
    stdout(`Lifecycle rules skipped: ${summary.lifecycleSkippedCount}`);
    return 0;
  } catch (err) {
    stderr(`[provision] Failed: ${(err as Error).message}`);
    return 1;
  } finally {
    client.destroy();
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
  void runProvisionCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
