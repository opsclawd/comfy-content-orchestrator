import type {
  SceneReviewCandidateGroup,
  SceneReviewDetail,
  SceneReviewQueries
} from "@cco/application";
import type { CampaignReviewSummary, ReviewAction, SceneStatus } from "@cco/contracts";
import type {
  CampaignId,
  CandidateId,
  SceneConfiguration,
  SceneId,
  StoryboardCandidate
} from "@cco/domain";
import type { Pool, PoolClient } from "pg";

interface StoryboardSceneRow {
  scene_id: string;
  campaign_id: string;
  duration_seconds: string | number;
  visual_description: string;
  engine_assigned: string;
  status: string;
  spec_revision: number;
  selected_candidate_id: string | null;
  selected_candidate_revision: number | null;
  lora_configuration_id: string | null;
  approved_by: string | null;
  approved_at: Date | string | null;
  approved_revision: number | null;
  reference_asset_ids: string[] | null;
}

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

function mapRowToCandidate(row: StoryboardCandidateRow): StoryboardCandidate {
  return {
    id: row.candidate_id as CandidateId,
    sceneId: row.scene_id as SceneId,
    specRevision: Number(row.scene_spec_revision),
    variantOrdinal: Number(row.variant_ordinal),
    storageBucket: row.storage_bucket,
    storageObjectKey: row.storage_object_key,
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

function deriveAllowedActions(status: SceneStatus): readonly ReviewAction[] {
  switch (status) {
    case "draft_pending":
      return Object.freeze([
        "prompt_edit",
        "reference_change",
        "engine_change",
        "duration_change",
        "lora_tune",
        "cancel"
      ]);
    case "generating_candidates":
      return Object.freeze(["cancel"]);
    case "director_review":
      return Object.freeze([
        "approve",
        "reroll",
        "candidate_select",
        "prompt_edit",
        "reference_change",
        "engine_change",
        "duration_change",
        "lora_tune",
        "cancel"
      ]);
    case "approved":
      return Object.freeze([
        "prompt_edit",
        "reference_change",
        "engine_change",
        "duration_change",
        "lora_tune",
        "cancel"
      ]);
    case "queued":
    case "rendering":
    case "failed":
      return Object.freeze(["cancel"]);
    case "qa":
      return Object.freeze(["approve", "reject"]);
    case "completed":
    case "cancelled":
      return Object.freeze([]);
    default:
      return Object.freeze([]);
  }
}

export class PostgresSceneReviewQueries implements SceneReviewQueries {
  constructor(private readonly client: Pool | PoolClient) {}

  async getSceneReviewDetail(sceneId: SceneId): Promise<SceneReviewDetail | undefined> {
    const sceneResult = await this.client.query<StoryboardSceneRow>(
      `
      SELECT
        s.scene_id,
        s.campaign_id,
        s.duration_seconds,
        s.visual_description,
        s.engine_assigned,
        s.status,
        s.spec_revision,
        s.selected_candidate_id,
        s.selected_candidate_revision,
        s.lora_configuration_id,
        s.approved_by,
        s.approved_at,
        s.approved_revision,
        COALESCE(
          (
            SELECT array_agg(sra.asset_id::text ORDER BY sra.asset_id ASC)
            FROM scene_reference_assets sra
            WHERE sra.scene_id = s.scene_id
          ),
          '{}'
        ) AS reference_asset_ids
      FROM storyboard_scenes s
      WHERE s.scene_id = $1
      `,
      [sceneId]
    );

    const sceneRow = sceneResult.rows[0];
    if (!sceneRow) {
      return undefined;
    }

    const candidatesResult = await this.client.query<StoryboardCandidateRow>(
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
      WHERE scene_id = $1
      ORDER BY scene_spec_revision ASC, variant_ordinal ASC
      `,
      [sceneId]
    );

    const referenceIds = Object.freeze(
      Array.isArray(sceneRow.reference_asset_ids) ? sceneRow.reference_asset_ids : []
    );

    const durationSeconds =
      typeof sceneRow.duration_seconds === "number"
        ? sceneRow.duration_seconds
        : parseFloat(sceneRow.duration_seconds);
    const durationMs = Math.round(durationSeconds * 1000);

    const configuration: SceneConfiguration = {
      prompt: sceneRow.visual_description,
      referenceIds,
      engineProfileId: sceneRow.engine_assigned,
      durationMs,
      ...(sceneRow.lora_configuration_id
        ? { loraConfigurationId: sceneRow.lora_configuration_id }
        : {})
    };

    const approval =
      sceneRow.approved_by && sceneRow.approved_at && sceneRow.approved_revision != null
        ? {
            revision: Number(sceneRow.approved_revision),
            approvedBy: sceneRow.approved_by,
            approvedAt:
              sceneRow.approved_at instanceof Date
                ? sceneRow.approved_at.toISOString()
                : new Date(sceneRow.approved_at).toISOString()
          }
        : undefined;

    const candidateMap = new Map<number, StoryboardCandidate[]>();
    for (const row of candidatesResult.rows) {
      const candidate = mapRowToCandidate(row);
      const group = candidateMap.get(candidate.specRevision);
      if (group) {
        group.push(candidate);
      } else {
        candidateMap.set(candidate.specRevision, [candidate]);
      }
    }

    const candidatesByRevision: SceneReviewCandidateGroup[] = Array.from(
      candidateMap.entries()
    ).map(([specRevision, candidates]) => ({
      specRevision,
      candidates: Object.freeze(candidates)
    }));

    const status = sceneRow.status as SceneStatus;
    const allowedActions = deriveAllowedActions(status);

    return {
      sceneId: sceneRow.scene_id as SceneId,
      campaignId: sceneRow.campaign_id as CampaignId,
      status,
      specRevision: Number(sceneRow.spec_revision),
      configuration,
      ...(sceneRow.selected_candidate_id
        ? { selectedCandidateId: sceneRow.selected_candidate_id as CandidateId }
        : {}),
      ...(sceneRow.selected_candidate_revision != null
        ? { selectedCandidateRevision: Number(sceneRow.selected_candidate_revision) }
        : {}),
      ...(approval !== undefined ? { approval } : {}),
      candidatesByRevision: Object.freeze(candidatesByRevision),
      allowedActions
    };
  }

  async getCampaignReviewSummary(
    campaignId: CampaignId
  ): Promise<CampaignReviewSummary | undefined> {
    const campaignResult = await this.client.query<{
      campaign_id: string;
      title: string;
      updated_at: Date | string;
    }>(
      `SELECT campaign_id, title, updated_at FROM campaigns WHERE campaign_id = $1 AND archived_at IS NULL`,
      [campaignId]
    );
    const campaignRow = campaignResult.rows[0];
    if (!campaignRow) {
      return undefined;
    }

    const scenesResult = await this.client.query<{
      status: string;
      scene_count: string | number;
    }>(
      `
      SELECT status, COUNT(*)::int AS scene_count
      FROM storyboard_scenes
      WHERE campaign_id = $1 AND archived_at IS NULL
      GROUP BY status
      `,
      [campaignId]
    );

    const scenesByStatus: Record<string, number> = {};
    let totalScenes = 0;
    let pendingReviewCount = 0;
    let approvedCount = 0;
    let completedCount = 0;

    for (const row of scenesResult.rows) {
      const count = Number(row.scene_count);
      scenesByStatus[row.status] = count;
      totalScenes += count;
      if (row.status === "director_review") {
        pendingReviewCount += count;
      } else if (row.status === "approved") {
        approvedCount += count;
      } else if (row.status === "completed") {
        completedCount += count;
      }
    }

    const updatedAt =
      campaignRow.updated_at instanceof Date
        ? campaignRow.updated_at.toISOString()
        : new Date(campaignRow.updated_at).toISOString();

    return {
      campaignId: campaignRow.campaign_id,
      campaignName: campaignRow.title,
      totalScenes,
      scenesByStatus,
      pendingReviewCount,
      approvedCount,
      completedCount,
      updatedAt
    };
  }
}
