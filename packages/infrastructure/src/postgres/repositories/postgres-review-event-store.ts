import type { ReviewEventStore } from "@cco/application";
import { type ReviewEvent, ReviewEventSchema } from "@cco/contracts";
import type { Pool, PoolClient } from "pg";

interface ReviewEventRow {
  event_id: string;
  scene_id: string;
  reviewer_name: string;
  action: string;
  director_notes: string | null;
  mutation_payload: Record<string, unknown> | string;
  prior_scene_status: string;
  resulting_scene_status: string;
  expected_spec_revision: number | null;
  resulting_spec_revision: number | null;
  request_hash_sha256: string | null;
  created_at: Date | string;
}

function mapRowToReviewEvent(row: ReviewEventRow): ReviewEvent {
  const raw: Record<string, unknown> = {
    eventId: row.event_id,
    sceneId: row.scene_id,
    reviewerName: row.reviewer_name,
    action: row.action,
    mutationPayload:
      typeof row.mutation_payload === "string"
        ? (JSON.parse(row.mutation_payload) as Record<string, unknown>)
        : (row.mutation_payload ?? {}),
    priorSceneStatus: row.prior_scene_status,
    resultingSceneStatus: row.resulting_scene_status,
    occurredAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString()
  };

  if (row.director_notes !== null && row.director_notes !== undefined) {
    raw.directorNotes = row.director_notes;
  }
  if (row.expected_spec_revision !== null && row.expected_spec_revision !== undefined) {
    raw.expectedSpecRevision = Number(row.expected_spec_revision);
  }
  if (row.resulting_spec_revision !== null && row.resulting_spec_revision !== undefined) {
    raw.resultingSpecRevision = Number(row.resulting_spec_revision);
  }
  if (row.request_hash_sha256 !== null && row.request_hash_sha256 !== undefined) {
    raw.requestHashSha256 = row.request_hash_sha256;
  }

  return ReviewEventSchema.parse(raw);
}

export class PostgresReviewEventStore implements ReviewEventStore {
  constructor(private readonly client: Pool | PoolClient) {}

  async append(event: ReviewEvent): Promise<void> {
    const validated = ReviewEventSchema.parse(event);
    const createdAt = validated.occurredAt ? new Date(validated.occurredAt) : new Date();

    await this.client.query(
      `
      INSERT INTO review_events (
        event_id,
        scene_id,
        reviewer_name,
        action,
        director_notes,
        mutation_payload,
        prior_scene_status,
        resulting_scene_status,
        expected_spec_revision,
        resulting_spec_revision,
        request_hash_sha256,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
      [
        validated.eventId,
        validated.sceneId,
        validated.reviewerName,
        validated.action,
        validated.directorNotes ?? null,
        JSON.stringify(validated.mutationPayload ?? {}),
        validated.priorSceneStatus,
        validated.resultingSceneStatus,
        validated.expectedSpecRevision ?? null,
        validated.resultingSpecRevision ?? null,
        validated.requestHashSha256 ?? null,
        createdAt
      ]
    );
  }

  async findById(eventId: string): Promise<ReviewEvent | undefined> {
    const result = await this.client.query<ReviewEventRow>(
      `
      SELECT
        event_id,
        scene_id,
        reviewer_name,
        action,
        director_notes,
        mutation_payload,
        prior_scene_status,
        resulting_scene_status,
        expected_spec_revision,
        resulting_spec_revision,
        request_hash_sha256,
        created_at
      FROM review_events
      WHERE event_id = $1
      `,
      [eventId]
    );

    const row = result.rows[0];
    if (!row) {
      return undefined;
    }

    return mapRowToReviewEvent(row);
  }
}
