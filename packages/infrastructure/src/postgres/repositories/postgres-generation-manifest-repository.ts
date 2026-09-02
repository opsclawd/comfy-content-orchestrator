import type {
  GenerationManifestComponentIdentity,
  GenerationManifestRepository
} from "@cco/application";
import type { Pool, PoolClient } from "pg";

interface GenerationManifestPayloadRow {
  manifest_payload: {
    readonly renderProfile?: unknown;
    readonly renderProfileVersion?: unknown;
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

    return {
      renderProfile: payload.renderProfile,
      renderProfileVersion:
        typeof payload.renderProfileVersion === "number" ? payload.renderProfileVersion : null
    };
  }
}
