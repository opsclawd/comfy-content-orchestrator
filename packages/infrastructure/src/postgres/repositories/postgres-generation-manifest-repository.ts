import {
  decodeGenerationManifestOutputs,
  extractPrimaryVideoStemMedia,
  IncompleteVideoStemSourceError,
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

    const payloadRecord = payload as Record<string, unknown>;
    const routingMode =
      typeof payloadRecord.routingMode === "string" ? payloadRecord.routingMode : undefined;
    const candidateSpecificationDigest =
      typeof payloadRecord.candidateSpecificationDigest === "string"
        ? payloadRecord.candidateSpecificationDigest
        : undefined;

    const route =
      payloadRecord.route === "ref2v" || payloadRecord.route === "i2v"
        ? (payloadRecord.route as "ref2v" | "i2v")
        : routingMode === "reference_directed"
          ? ("ref2v" as const)
          : routingMode === "frame_anchored"
            ? ("i2v" as const)
            : undefined;

    return {
      renderProfile: payload.renderProfile,
      renderProfileVersion:
        typeof payload.renderProfileVersion === "number" ? payload.renderProfileVersion : null,
      ...(outputChecksumsSha256.length > 0 ? { outputChecksumsSha256 } : {}),
      ...(route ? { route } : {}),
      ...(candidateSpecificationDigest ? { candidateSpecificationDigest } : {})
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

    if (
      row.job_execution_scope &&
      payload?.executionScope &&
      row.job_execution_scope !== payload.executionScope
    ) {
      throw new Error(
        `Contradictory executionScope in manifest "${row.manifest_id}": job_execution_scope "${row.job_execution_scope}" does not match manifest payload executionScope "${payload.executionScope}"`
      );
    }

    const executionScope: "production" | "staging" | undefined =
      (row.job_execution_scope as "production" | "staging" | null) ??
      (payload?.executionScope as "production" | "staging" | undefined) ??
      (isCandidateProfile ? "staging" : undefined);

    if (isCandidateProfile && executionScope === "production") {
      throw new Error(
        `Candidate generation manifest "${row.manifest_id}" cannot have production executionScope`
      );
    }

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

    const renderProfile =
      typeof payload?.renderProfile === "string" ? payload.renderProfile : undefined;
    const sceneId = typeof payload?.sceneId === "string" ? payload.sceneId : undefined;
    const candidateSpecificationDigest =
      typeof payload?.candidateSpecificationDigest === "string"
        ? payload.candidateSpecificationDigest
        : undefined;
    const specRevision =
      typeof payload?.specRevision === "number" ? payload.specRevision : undefined;
    const configuredMediaObj = payload?.configuredMedia as Record<string, unknown> | undefined;
    const frames =
      typeof payload?.frameCount === "number"
        ? payload.frameCount
        : typeof configuredMediaObj?.frameCount === "number"
          ? (configuredMediaObj.frameCount as number)
          : undefined;
    const fps =
      typeof payload?.fps === "number"
        ? payload.fps
        : typeof configuredMediaObj?.fps === "number"
          ? (configuredMediaObj.fps as number)
          : undefined;

    const payloadRoutingMode =
      typeof payload?.routingMode === "string" ? payload.routingMode : undefined;
    const route =
      payload?.route === "ref2v" || payload?.route === "i2v"
        ? (payload.route as "ref2v" | "i2v")
        : payloadRoutingMode === "reference_directed"
          ? ("ref2v" as const)
          : payloadRoutingMode === "frame_anchored"
            ? ("i2v" as const)
            : undefined;

    const outputChecksumsSha256: string[] = [];
    if (payload) {
      try {
        const outputs = decodeGenerationManifestOutputs(
          payload as Record<string, unknown>,
          row.manifest_id
        );
        for (const out of outputs) {
          outputChecksumsSha256.push(out.checksumSha256);
        }
      } catch (err) {
        throw new IncompleteVideoStemSourceError(
          jobId,
          `Failed to decode generation manifest outputs: ${(err as Error).message}`
        );
      }
    }

    return {
      generationManifestId: row.manifest_id,
      jobId,
      media,
      renderAttempt,
      ...(renderProfile ? { renderProfile } : {}),
      ...(route ? { route } : {}),
      ...(payloadRoutingMode ? { routingMode: payloadRoutingMode } : {}),
      ...(sceneId ? { sceneId } : {}),
      ...(candidateSpecificationDigest ? { candidateSpecificationDigest } : {}),
      ...(specRevision !== undefined ? { specRevision } : {}),
      ...(frames !== undefined ? { frames } : {}),
      ...(fps !== undefined ? { fps } : {}),
      ...(outputChecksumsSha256.length > 0 ? { outputChecksumsSha256 } : {}),
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
