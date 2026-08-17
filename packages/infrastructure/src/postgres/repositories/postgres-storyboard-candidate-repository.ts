import type { StoryboardCandidateRepository } from "@cco/application";
import type { CandidateId, SceneId, StoryboardCandidate } from "@cco/domain";
import type { Pool, PoolClient } from "pg";

interface StoryboardCandidateRow {
  candidate_id: string;
  scene_id: string;
  scene_spec_revision: number;
  variant_ordinal: number;
  storage_bucket: string;
  storage_object_key: string;
  content_hash_sha256: string;
  generation_payload: Record<string, unknown> | string;
  created_at: Date | string;
}

function splitLocator(locator: string): { bucket: string; key: string } {
  const clean = locator.replace(/^[a-z]+:\/\//i, "");
  const slashIndex = clean.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(`Invalid locator format: '${locator}'. Expected 'bucket/key'`);
  }
  const bucket = clean.slice(0, slashIndex);
  const key = clean.slice(slashIndex + 1);
  if (!bucket || !key) {
    throw new Error(`Invalid locator format: '${locator}'. Bucket and key must be non-empty`);
  }
  return { bucket, key };
}

function mapRowToCandidate(row: StoryboardCandidateRow): StoryboardCandidate {
  return {
    id: row.candidate_id as CandidateId,
    sceneId: row.scene_id as SceneId,
    specRevision: Number(row.scene_spec_revision),
    variantOrdinal: Number(row.variant_ordinal),
    locator: `${row.storage_bucket}/${row.storage_object_key}`,
    contentHash: row.content_hash_sha256,
    generationMetadata:
      typeof row.generation_payload === "string"
        ? (JSON.parse(row.generation_payload) as Record<string, unknown>)
        : (row.generation_payload ?? {}),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString()
  };
}

export class PostgresStoryboardCandidateRepository implements StoryboardCandidateRepository {
  constructor(private readonly client: Pool | PoolClient) {}

  async findById(candidateId: CandidateId): Promise<StoryboardCandidate | undefined> {
    const result = await this.client.query<StoryboardCandidateRow>(
      `
      SELECT
        candidate_id,
        scene_id,
        scene_spec_revision,
        variant_ordinal,
        storage_bucket,
        storage_object_key,
        content_hash_sha256,
        generation_payload,
        created_at
      FROM storyboard_candidates
      WHERE candidate_id = $1
      `,
      [candidateId]
    );

    const row = result.rows[0];
    if (!row) {
      return undefined;
    }

    return mapRowToCandidate(row);
  }

  async insert(candidate: StoryboardCandidate): Promise<void> {
    const { bucket, key } = splitLocator(candidate.locator);
    const createdAt = candidate.createdAt ? new Date(candidate.createdAt) : new Date();
    const generationPayload = candidate.generationMetadata ?? {};

    await this.client.query(
      `
      INSERT INTO storyboard_candidates (
        candidate_id,
        scene_id,
        scene_spec_revision,
        variant_ordinal,
        storage_bucket,
        storage_object_key,
        content_hash_sha256,
        generation_payload,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        candidate.id,
        candidate.sceneId,
        candidate.specRevision,
        candidate.variantOrdinal,
        bucket,
        key,
        candidate.contentHash,
        JSON.stringify(generationPayload),
        createdAt
      ]
    );
  }

  async listBySceneAndRevision(
    sceneId: SceneId,
    specRevision: number
  ): Promise<readonly StoryboardCandidate[]> {
    const result = await this.client.query<StoryboardCandidateRow>(
      `
      SELECT
        candidate_id,
        scene_id,
        scene_spec_revision,
        variant_ordinal,
        storage_bucket,
        storage_object_key,
        content_hash_sha256,
        generation_payload,
        created_at
      FROM storyboard_candidates
      WHERE scene_id = $1 AND scene_spec_revision = $2
      ORDER BY variant_ordinal ASC
      `,
      [sceneId, specRevision]
    );

    return Object.freeze(result.rows.map(mapRowToCandidate));
  }
}
