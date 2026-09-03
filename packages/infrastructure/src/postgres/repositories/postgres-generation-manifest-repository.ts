import type {
  GenerationManifestComponentIdentity,
  GenerationManifestRepository
} from "@cco/application";
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
    if (Array.isArray(payload.outputs)) {
      for (const out of payload.outputs) {
        if (
          out &&
          typeof out === "object" &&
          typeof (out as { checksumSha256?: unknown }).checksumSha256 === "string"
        ) {
          outputChecksumsSha256.push((out as { checksumSha256: string }).checksumSha256);
        }
      }
    }

    return {
      renderProfile: payload.renderProfile,
      renderProfileVersion:
        typeof payload.renderProfileVersion === "number" ? payload.renderProfileVersion : null,
      ...(outputChecksumsSha256.length > 0 ? { outputChecksumsSha256 } : {})
    };
  }
}
