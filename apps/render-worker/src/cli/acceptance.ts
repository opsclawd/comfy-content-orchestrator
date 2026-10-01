import process from "node:process";
import { pathToFileURL } from "node:url";
import pg from "pg";
const { Pool } = pg;
import {
  ACCEPTANCE_CAMPAIGN_IDEMPOTENCY_KEY,
  ACCEPTANCE_CLIENT_ID,
  ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN,
  verifyAcceptanceCoverage,
  computeAcceptanceCampaignFingerprint
} from "@cco/contracts";
import {
  CreateCampaignShellUseCase,
  CreateSceneUseCase,
  EvaluateAcceptancePreflightUseCase,
  InstallAcceptanceCampaignFixtureUseCase,
  UploadReferenceAssetUseCase
} from "@cco/application";
import {
  FsAcceptanceFixtureAssetSource,
  FsEvidenceTemplateProbe,
  FsProfileIdentityProbe,
  PostgresAcceptanceCampaignLedgerProbe,
  PostgresAcceptanceReadinessProbe,
  PostgresReferenceAssetRepository,
  PostgresUnitOfWork,
  S3AcceptanceReadinessProbe,
  S3ObjectStorage,
  SharpImageInspectionAdapter
} from "@cco/infrastructure";
import { BUCKETS } from "@cco/shared";

export class AcceptanceCliError extends Error {
  override readonly name = "AcceptanceCliError";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export type AcceptanceSubcommand = "install" | "verify" | "preflight" | "help";

export interface AcceptanceCliArgs {
  readonly subcommand: AcceptanceSubcommand;
  readonly clientId?: string | undefined;
  readonly idempotencyKey?: string | undefined;
}

const KNOWN_SUBCOMMANDS: ReadonlySet<string> = new Set(["install", "verify", "preflight", "help"]);

export function parseAcceptanceCliArgs(argv: readonly string[]): AcceptanceCliArgs {
  const [rawSubcommand, ...rest] = argv;
  const subcommand = rawSubcommand ?? "help";

  if (!KNOWN_SUBCOMMANDS.has(subcommand)) {
    throw new AcceptanceCliError(
      `Unknown subcommand "${subcommand}". Expected one of: install, verify, preflight, help.`
    );
  }

  let clientId: string | undefined;
  let idempotencyKey: string | undefined;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--client-id") {
      clientId = rest[i + 1];
      i++;
    } else if (arg === "--idempotency-key") {
      idempotencyKey = rest[i + 1];
      i++;
    } else {
      throw new AcceptanceCliError(`Unknown flag: ${arg}`);
    }
  }

  return {
    subcommand: subcommand as AcceptanceSubcommand,
    clientId,
    idempotencyKey
  };
}

export function getAcceptanceUsageHelp(): string {
  return `Usage: acceptance <subcommand> [options]

Preparation-only tooling for the H3 operator acceptance campaign (#373). Never produces
certification evidence or GPU render output itself.

Subcommands:
  verify                              Pure, offline coverage check of the representative
                                       campaign fixture (no DB/S3/filesystem access beyond
                                       the fixture's own in-memory definition).
  preflight                           GPU-free readiness report: fixture coverage, MiniMax-H3
                                       profile identity, evidence-template emptiness, and
                                       read-only database/object-storage reachability.
  install [--client-id <uuid>] [--idempotency-key <uuid>]
                                       Installs (idempotently) the representative campaign,
                                       its 9 scenes, and its reference-asset library rows.
                                       Defaults to the fixed, synthetic ACCEPTANCE_CLIENT_ID /
                                       ACCEPTANCE_CAMPAIGN_IDEMPOTENCY_KEY constants so the
                                       fixture is reconstructable without operator bookkeeping;
                                       pass --client-id/--idempotency-key only to target a
                                       different non-production client.

Environment variables (install/preflight only):
  DATABASE_URL           PostgreSQL connection string
  S3_STORAGE_ENDPOINT    S3/MinIO endpoint URL
  AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
  S3_REGION              Default: us-east-1
  S3_FORCE_PATH_STYLE    Default: true
  S3_REFERENCE_BUCKET    Default: the platform's reference-asset bucket`;
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value || value.trim() === "") {
    throw new AcceptanceCliError(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

async function runInstall(args: AcceptanceCliArgs, env: NodeJS.ProcessEnv): Promise<number> {
  const clientId = args.clientId ?? ACCEPTANCE_CLIENT_ID;
  const idempotencyKey = args.idempotencyKey ?? ACCEPTANCE_CAMPAIGN_IDEMPOTENCY_KEY;

  const databaseUrl = requireEnv(env, "DATABASE_URL");
  const s3Endpoint = requireEnv(env, "S3_STORAGE_ENDPOINT");
  const accessKeyId = requireEnv(env, "AWS_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv(env, "AWS_SECRET_ACCESS_KEY");
  const region = env.S3_REGION?.trim() || "us-east-1";
  const forcePathStyle = (env.S3_FORCE_PATH_STYLE ?? "true").trim().toLowerCase() !== "false";

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const uow = new PostgresUnitOfWork(pool);
    const referenceAssetRepository = new PostgresReferenceAssetRepository(pool);
    const objectStorage = new S3ObjectStorage({
      endpoint: s3Endpoint,
      region,
      forcePathStyle,
      credentials: { accessKeyId, secretAccessKey }
    });
    const imageValidator = new SharpImageInspectionAdapter();

    const installUseCase = new InstallAcceptanceCampaignFixtureUseCase({
      uow,
      createCampaignShellUseCase: new CreateCampaignShellUseCase(uow),
      createSceneUseCase: new CreateSceneUseCase(uow),
      uploadReferenceAssetUseCase: new UploadReferenceAssetUseCase({
        referenceAssetRepository,
        objectStorage,
        imageValidator
      }),
      assetSource: new FsAcceptanceFixtureAssetSource()
    });

    const result = await installUseCase.execute({ clientId, idempotencyKey });

    console.log(
      JSON.stringify(
        {
          fixtureId: result.fixtureId,
          campaignId: result.campaign.id,
          isIdempotentReplay: result.isIdempotentReplay,
          sceneCount: result.scenes.length,
          referenceAssetCount: result.referenceAssetsBySlot.size
        },
        null,
        2
      )
    );
    return 0;
  } finally {
    await pool.end();
  }
}

function runVerify(): number {
  const coverage = verifyAcceptanceCoverage(ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN);
  const fingerprint = computeAcceptanceCampaignFingerprint(ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN);

  console.log(
    JSON.stringify(
      {
        fixtureId: ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN.fixtureId,
        fixtureFingerprint: fingerprint,
        satisfied: coverage.satisfied,
        missing: coverage.missing,
        assetSlotErrors: coverage.assetSlotErrors
      },
      null,
      2
    )
  );

  return coverage.satisfied ? 0 : 1;
}

async function runPreflight(env: NodeJS.ProcessEnv): Promise<number> {
  const databaseUrl = requireEnv(env, "DATABASE_URL");
  const s3Endpoint = requireEnv(env, "S3_STORAGE_ENDPOINT");
  const accessKeyId = requireEnv(env, "AWS_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv(env, "AWS_SECRET_ACCESS_KEY");
  const region = env.S3_REGION?.trim() || "us-east-1";
  const forcePathStyle = (env.S3_FORCE_PATH_STYLE ?? "true").trim().toLowerCase() !== "false";
  const referenceBucket = env.S3_REFERENCE_BUCKET?.trim() || BUCKETS.REFERENCE;

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const useCase = new EvaluateAcceptancePreflightUseCase({
      profileIdentityProbe: new FsProfileIdentityProbe(),
      evidenceTemplateProbe: new FsEvidenceTemplateProbe(),
      databaseReadinessProbe: new PostgresAcceptanceReadinessProbe(pool),
      objectStorageReadinessProbe: new S3AcceptanceReadinessProbe({
        bucket: referenceBucket,
        clientConfig: {
          endpoint: s3Endpoint,
          region,
          forcePathStyle,
          credentials: { accessKeyId, secretAccessKey }
        }
      }),
      assetSource: new FsAcceptanceFixtureAssetSource(),
      campaignLedgerProbe: new PostgresAcceptanceCampaignLedgerProbe(pool, {
        idempotencyKey: ACCEPTANCE_CAMPAIGN_IDEMPOTENCY_KEY,
        expectedSceneCount: ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN.scenes.length
      })
    });

    const report = await useCase.execute();
    console.log(JSON.stringify(report, null, 2));
    return report.readyForOperatorHandoff ? 0 : 1;
  } finally {
    await pool.end();
  }
}

export async function runAcceptanceCli(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  let args: AcceptanceCliArgs;
  try {
    args = parseAcceptanceCliArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error("");
    console.error(getAcceptanceUsageHelp());
    return 1;
  }

  if (args.subcommand === "help") {
    console.log(getAcceptanceUsageHelp());
    return 0;
  }

  try {
    if (args.subcommand === "verify") {
      return runVerify();
    }
    if (args.subcommand === "preflight") {
      return await runPreflight(env);
    }
    if (args.subcommand === "install") {
      return await runInstall(args, env);
    }
    return 1;
  } catch (err) {
    console.error(
      `acceptance ${args.subcommand} failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return 1;
  }
}

export function isDirectExecution(): boolean {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  void runAcceptanceCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
