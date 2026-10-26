#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import pg from "pg";
const { Pool } = pg;
import { StageH3CandidateRenderUseCase, type StageH3CandidateRenderResult } from "@cco/application";
import {
  H3CandidateAuthorizationGrantSchema,
  type H3CandidateAuthorizationGrant,
  type H3CandidateProfile,
  type H3CapabilityMatrixEnvelope
} from "@cco/contracts";
import {
  H3OperatorSignatureVerifier,
  H3TrustedCandidateRegistryReader,
  PostgresUnitOfWork
} from "@cco/infrastructure";

export interface StageCandidateRenderCliArgs {
  readonly sceneId: string;
  readonly candidateProfileKey: string;
  readonly grantPath: string;
  readonly requestId?: string | undefined;
  readonly dryRun?: boolean | undefined;
  readonly databaseUrl?: string | undefined;
  readonly candidateProfilesPath?: string | undefined;
  readonly capabilityMatrixPath?: string | undefined;
  readonly trustedPublicKeysPath?: string | undefined;
  readonly evidenceDirectory?: string | undefined;
  readonly help?: boolean | undefined;
}

export function parseStageCandidateCliArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): StageCandidateRenderCliArgs {
  let sceneId = env.SCENE_ID ?? "";
  let candidateProfileKey = env.CANDIDATE_PROFILE_KEY ?? "";
  let grantPath = env.H3_AUTHORIZATION_GRANT_FILE ?? env.GRANT_PATH ?? "";
  let requestId = env.STAGING_REQUEST_ID ?? undefined;
  let dryRun = env.STAGING_DRY_RUN === "true" || env.STAGING_DRY_RUN === "1";
  let databaseUrl = env.DATABASE_URL ?? env.CONTROL_API_DATABASE_URL ?? undefined;
  let candidateProfilesPath = env.H3_CANDIDATE_PROFILES_FILE ?? undefined;
  let capabilityMatrixPath = env.H3_CAPABILITY_MATRIX_FILE ?? undefined;
  let trustedPublicKeysPath = env.H3_TRUSTED_KEYS_FILE ?? undefined;
  let evidenceDirectory = env.H3_EVIDENCE_DIRECTORY ?? undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg.startsWith("--scene-id=")) {
      sceneId = arg.slice("--scene-id=".length);
    } else if (arg === "--scene-id" && i + 1 < argv.length) {
      sceneId = argv[++i]!;
    } else if (arg.startsWith("--candidate-profile-key=")) {
      candidateProfileKey = arg.slice("--candidate-profile-key=".length);
    } else if (arg === "--candidate-profile-key" && i + 1 < argv.length) {
      candidateProfileKey = argv[++i]!;
    } else if (arg.startsWith("--grant-path=")) {
      grantPath = arg.slice("--grant-path=".length);
    } else if (arg === "--grant-path" && i + 1 < argv.length) {
      grantPath = argv[++i]!;
    } else if (arg.startsWith("--request-id=")) {
      requestId = arg.slice("--request-id=".length);
    } else if (arg === "--request-id" && i + 1 < argv.length) {
      requestId = argv[++i]!;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("--database-url=")) {
      databaseUrl = arg.slice("--database-url=".length);
    } else if (arg === "--database-url" && i + 1 < argv.length) {
      databaseUrl = argv[++i]!;
    } else if (arg.startsWith("--candidate-profiles-path=")) {
      candidateProfilesPath = arg.slice("--candidate-profiles-path=".length);
    } else if (arg === "--candidate-profiles-path" && i + 1 < argv.length) {
      candidateProfilesPath = argv[++i]!;
    } else if (arg.startsWith("--capability-matrix-path=")) {
      capabilityMatrixPath = arg.slice("--capability-matrix-path=".length);
    } else if (arg === "--capability-matrix-path" && i + 1 < argv.length) {
      capabilityMatrixPath = argv[++i]!;
    } else if (arg.startsWith("--trusted-keys-path=")) {
      trustedPublicKeysPath = arg.slice("--trusted-keys-path=".length);
    } else if (arg === "--trusted-keys-path" && i + 1 < argv.length) {
      trustedPublicKeysPath = argv[++i]!;
    } else if (arg.startsWith("--evidence-directory=")) {
      evidenceDirectory = arg.slice("--evidence-directory=".length);
    } else if (arg === "--evidence-directory" && i + 1 < argv.length) {
      evidenceDirectory = argv[++i]!;
    }
  }

  return {
    sceneId: sceneId.trim(),
    candidateProfileKey: candidateProfileKey.trim(),
    grantPath: grantPath.trim(),
    requestId: requestId?.trim(),
    dryRun,
    databaseUrl: databaseUrl?.trim(),
    candidateProfilesPath: candidateProfilesPath?.trim(),
    capabilityMatrixPath: capabilityMatrixPath?.trim(),
    trustedPublicKeysPath: trustedPublicKeysPath?.trim(),
    evidenceDirectory: evidenceDirectory?.trim(),
    help
  };
}

export function getStageCandidateUsage(): string {
  return `
Usage: pnpm --filter render-worker stage [options]

Stages an approved scene for operator-controlled variable-duration H3 candidate render execution.

Required Options:
  --scene-id <UUID>                 Scene identifier to stage
  --candidate-profile-key <KEY>     Admitted candidate profile key (e.g. H3_CANDIDATE_..._V1)
  --grant-path <FILE>               Path to signed operator authorization grant JSON file

Additional Options:
  --request-id <UUID>               Idempotency request ID (defaults to new random UUID)
  --dry-run                         Validate admission and graph compatibility without enqueuing
  --database-url <URL>              Postgres connection string (or DATABASE_URL env var)
  --candidate-profiles-path <FILE>  Candidate profiles JSON file
  --capability-matrix-path <FILE>   #445 Capability matrix envelope JSON file
  --trusted-keys-path <FILE>        JSON file containing trusted operator public keys map
  --evidence-directory <DIR>        Directory with evidence files named by SHA-256 digest
  --help, -h                        Show this help message

Environment Variables:
  SCENE_ID                          Alternative to --scene-id
  CANDIDATE_PROFILE_KEY             Alternative to --candidate-profile-key
  H3_AUTHORIZATION_GRANT_FILE       Alternative to --grant-path
  DATABASE_URL                      PostgreSQL connection string
`.trim();
}

export async function stageCandidateRenderCli(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const parsed = parseStageCandidateCliArgs(argv, env);

  if (parsed.help) {
    console.log(getStageCandidateUsage());
    return 0;
  }

  if (!parsed.sceneId) {
    console.error("Error: --scene-id is required");
    return 1;
  }
  if (!parsed.candidateProfileKey) {
    console.error("Error: --candidate-profile-key is required");
    return 1;
  }
  if (!parsed.grantPath) {
    console.error("Error: --grant-path is required");
    return 1;
  }
  if (!parsed.databaseUrl) {
    console.error("Error: DATABASE_URL or --database-url is required");
    return 1;
  }

  let grantContent: string;
  try {
    grantContent = await readFile(resolve(parsed.grantPath), "utf8");
  } catch (err) {
    console.error(`Error reading grant file "${parsed.grantPath}": ${(err as Error).message}`);
    return 1;
  }

  let rawGrant: unknown;
  try {
    rawGrant = JSON.parse(grantContent);
  } catch (err) {
    console.error(`Error parsing grant JSON: ${(err as Error).message}`);
    return 1;
  }

  const parseResult = H3CandidateAuthorizationGrantSchema.safeParse(rawGrant);
  if (!parseResult.success) {
    console.error(`Error: Invalid authorization grant schema:\n${parseResult.error.message}`);
    return 1;
  }
  const grant: H3CandidateAuthorizationGrant = parseResult.data;

  // Load candidate profiles and capability matrix if specified
  let candidateProfiles: H3CandidateProfile[] = [];
  if (parsed.candidateProfilesPath) {
    const raw = await readFile(resolve(parsed.candidateProfilesPath), "utf8");
    candidateProfiles = JSON.parse(raw);
  }

  let decisionEnvelope: H3CapabilityMatrixEnvelope | undefined;
  if (parsed.capabilityMatrixPath) {
    const raw = await readFile(resolve(parsed.capabilityMatrixPath), "utf8");
    decisionEnvelope = JSON.parse(raw);
  }

  let trustedKeysMap = new Map<string, string>();
  if (parsed.trustedPublicKeysPath) {
    const raw = await readFile(resolve(parsed.trustedPublicKeysPath), "utf8");
    const parsedKeys = JSON.parse(raw) as Record<string, string>;
    trustedKeysMap = new Map(Object.entries(parsedKeys));
  }
  if (!parsed.evidenceDirectory) {
    console.error("Error: H3_EVIDENCE_DIRECTORY or --evidence-directory is required");
    return 1;
  }

  const pool = new Pool({ connectionString: parsed.databaseUrl });
  try {
    const uow = new PostgresUnitOfWork(pool);

    const registryReader = new H3TrustedCandidateRegistryReader({
      candidateProfiles,
      decisionEnvelope: decisionEnvelope ?? {
        version: 1,
        matrixId: "bootstrap-empty",
        rows: [],
        signedBy: "bootstrap",
        signatureHex: "00",
        signedAt: new Date().toISOString()
      },
      trustedPublicKeys: trustedKeysMap,
      evidenceResolver: (digest) => {
        if (!/^[0-9a-f]{64}$/.test(digest)) return undefined;
        try {
          return readFileSync(resolve(parsed.evidenceDirectory!, digest));
        } catch {
          return undefined;
        }
      }
    });

    const authorizationPort = new H3OperatorSignatureVerifier({
      trustedPublicKeys: trustedKeysMap
    });

    const useCase = new StageH3CandidateRenderUseCase({
      uow,
      registryReader,
      authorizationPort
    });

    const requestId = parsed.requestId ?? randomUUID();
    const result: StageH3CandidateRenderResult = await useCase.execute({
      sceneId: parsed.sceneId,
      candidateProfileKey: parsed.candidateProfileKey,
      grant,
      requestId,
      ...(parsed.dryRun !== undefined ? { dryRun: parsed.dryRun } : {})
    });

    console.log(
      JSON.stringify(
        {
          success: true,
          jobId: result.job.jobId,
          sceneId: result.scene.id,
          attemptId: result.attemptId,
          executionScope: result.job.executionScope,
          idempotentReplay: result.idempotentReplay ?? false,
          inspection: {
            route: result.inspection.route,
            frames: result.inspection.route.targetFrameCount,
            nominalDurationMs: result.inspection.route.nominalDurationMs
          }
        },
        null,
        2
      )
    );
    return 0;
  } catch (err) {
    console.error(`Staging failed: ${(err as Error).message}`);
    return 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  stageCandidateRenderCli().then((code) => {
    if (code !== 0) {
      process.exit(code);
    }
  });
}
