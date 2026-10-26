import {
  decodeGenerationManifestOutputs,
  extractPrimaryVideoStemMedia,
  type GenerationManifestComponentIdentity,
  type GenerationManifestRepository,
  type VideoStemSourceRecord
} from "@cco/application";
import {
  type ManifestMeasuredMedia,
  ManifestMeasuredMediaSchema,
  type ExecutionRealm,
  type EvidenceOrigin,
  type OwnerKind,
  type SimulationDescriptor
} from "@cco/contracts";
import type { Pool, PoolClient } from "pg";

interface GenerationManifestPayloadRow {
  manifest_payload: {
    readonly renderProfile?: unknown;
    readonly renderProfileVersion?: unknown;
    readonly outputs?: unknown;
  };
}

export class PostgresGenerationManifestRepository implements GenerationManifestRepository {
  constructor(private readonly client: Pool | PoolClient) {}

  async getComponentIdentityById(
    generationManifestId: string
  ): Promise<GenerationManifestComponentIdentity | undefined> {
    const result = await this.client.query<GenerationManifestPayloadRow>(
      `SELECT manifest_payload FROM generation_manifests WHERE manifest_id = $1`,
      [generationManifestId]
    );

    const row = result.rows[0];
    if (!row) {
      return undefined;
    }

    const payload = row.manifest_payload;
    if (typeof payload.renderProfile !== "string" || payload.renderProfile.length === 0) {
      // Malformed/incomplete payload — treat the same as "not found" so the
      // caller fails closed rather than trusting a partial record.
      return undefined;
    }

    const outputChecksumsSha256: string[] = [];
    try {
      const outputs = decodeGenerationManifestOutputs(payload, generationManifestId);
      for (const out of outputs) {
        outputChecksumsSha256.push(out.checksumSha256);
      }
    } catch {
      // If outputs are not present or malformed, outputChecksumsSha256 remains empty
    }

    return {
      renderProfile: payload.renderProfile,
      renderProfileVersion:
        typeof payload.renderProfileVersion === "number" ? payload.renderProfileVersion : null,
      ...(outputChecksumsSha256.length > 0 ? { outputChecksumsSha256 } : {})
    };
  }

  async findVideoStemSourceByJobId(jobId: string): Promise<VideoStemSourceRecord | undefined> {
    const result = await this.client.query<{
      manifest_id: string;
      render_attempt: number;
      manifest_payload: unknown;
      job_execution_scope: string | null;
      owner_kind: string | null;
      acceptance_run_id: string | null;
      run_id: string | null;
    }>(
      `SELECT
         gm.manifest_id,
         gm.render_attempt,
         gm.manifest_payload,
         rj.execution_scope AS job_execution_scope,
         pa.owner_kind,
         pa.acceptance_run_id,
         pa.run_id
       FROM generation_manifests gm
       LEFT JOIN render_jobs rj ON rj.job_id = gm.job_id
       LEFT JOIN production_attempts pa ON pa.production_job_id = gm.job_id
       WHERE gm.job_id = $1`,
      [jobId]
    );

    const row = result.rows[0];
    if (!row) {
      return undefined;
    }

    const media = extractPrimaryVideoStemMedia(row.manifest_payload, jobId);
    const payload = row.manifest_payload as Record<string, unknown> | null;
    const renderAttempt =
      typeof row.render_attempt === "number"
        ? row.render_attempt
        : typeof payload?.renderAttempt === "number"
          ? (payload.renderAttempt as number)
          : 1;

    const isCandidateProfile =
      typeof payload?.renderProfile === "string" &&
      /^H3_CANDIDATE_[0-9a-f]{32}_V[1-9]\d*$/.test(payload.renderProfile);

    const executionScope: "production" | "staging" | undefined =
      row.job_execution_scope === "staging" ||
      payload?.executionScope === "staging" ||
      isCandidateProfile
        ? "staging"
        : row.job_execution_scope === "production" || payload?.executionScope === "production"
          ? "production"
          : undefined;

    let measuredMedia: ManifestMeasuredMedia | undefined;
    if (payload?.measuredMedia) {
      const parsed = ManifestMeasuredMediaSchema.safeParse(payload.measuredMedia);
      if (!parsed.success) {
        throw new Error(
          `Invalid measuredMedia in generation manifest "${row.manifest_id}": ${parsed.error.message}`
        );
      }
      if (parsed.data.checksumSha256 !== media.sha256) {
        throw new Error(
          `measuredMedia checksumSha256 mismatch in manifest "${row.manifest_id}": expected "${media.sha256}", got "${parsed.data.checksumSha256}"`
        );
      }
      measuredMedia = parsed.data;
    }

    if (isCandidateProfile && !measuredMedia) {
      throw new Error(
        `Candidate generation manifest "${row.manifest_id}" is missing required measuredMedia`
      );
    }

    const ownerKind = (row.owner_kind ??
      payload?.ownerKind ??
      (row.run_id ? "production_run" : undefined)) as OwnerKind | undefined;
    const acceptanceRunId = (row.acceptance_run_id ?? payload?.acceptanceRunId) as
      string | undefined;
    const runId = (row.run_id ?? payload?.runId) as string | undefined;
    const realm = payload?.realm as ExecutionRealm | undefined;
    const evidenceOrigin = payload?.evidenceOrigin as EvidenceOrigin | undefined;
    const simulationDescriptor = payload?.simulationDescriptor as SimulationDescriptor | undefined;

    return {
      generationManifestId: row.manifest_id,
      media,
      renderAttempt,
      ...(executionScope ? { executionScope } : {}),
      ...(measuredMedia ? { measuredMedia } : {}),
      ...(realm ? { realm } : {}),
      ...(evidenceOrigin ? { evidenceOrigin } : {}),
      ...(ownerKind ? { ownerKind } : {}),
      ...(acceptanceRunId ? { acceptanceRunId } : {}),
      ...(runId ? { runId } : {}),
      ...(simulationDescriptor ? { simulationDescriptor } : {})
    };
  }
}
