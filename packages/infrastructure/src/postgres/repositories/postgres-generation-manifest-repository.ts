import {
  decodeGenerationManifestOutputs,
  extractPrimaryVideoStemMedia,
  type GenerationManifestComponentIdentity,
  type GenerationManifestRepository
} from "@cco/application";
import type { PersistentMediaRef } from "@cco/contracts";
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

  async findVideoStemSourceByJobId(
    jobId: string
  ): Promise<
    { readonly generationManifestId: string; readonly media: PersistentMediaRef } | undefined
  > {
    const result = await this.client.query<{ manifest_id: string; manifest_payload: unknown }>(
      `SELECT manifest_id, manifest_payload FROM generation_manifests WHERE job_id = $1`,
      [jobId]
    );

    const row = result.rows[0];
    if (!row) {
      return undefined;
    }

    const media = extractPrimaryVideoStemMedia(row.manifest_payload, jobId);
    return {
      generationManifestId: row.manifest_id,
      media
    };
  }
}
