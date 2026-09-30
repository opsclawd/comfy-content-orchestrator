import type { CampaignAnimaticQueries, ReviewMediaDeliveryPort } from "@cco/application";
import type {
  CampaignAnimaticReadModel,
  ShotPlanReviewItem,
  ShotPlanStatus,
  ShotPlanRoutingMode,
  CameraMovement,
  MovementSpeed,
  RawAnimaticSceneInput
} from "@cco/contracts";
import { compileCampaignAnimaticReadModel } from "@cco/contracts";
import type { CampaignId } from "@cco/domain";
import type { Pool, PoolClient } from "pg";

interface CampaignRow {
  campaign_id: string;
  title: string;
  status: string;
  updated_at: Date | string;
}

interface StoryboardSceneRow {
  scene_id: string;
  scene_order: number | string;
  spec_revision: number | string;
  duration_seconds: number | string;
  visual_description: string;
  status: string;
  selected_shot_plan_id: string | null;
  selected_shot_plan_revision: number | string | null;
  approved_shot_plan_id: string | null;
}

interface ShotPlanJoinedRow {
  shot_plan_id: string;
  scene_id: string;
  spec_revision: number | string;
  variant_ordinal: number | string;
  status: string;
  routing_mode: string;
  target_duration_ms: number | string;
  target_frame_count: number | string;
  framing: string;
  camera_angle: string;
  camera_movement: string;
  lighting_style: string;
  previs_candidate_id: string | null;
  structured_plan: Record<string, unknown> | string;
  created_at: Date | string;
  updated_at: Date | string;
  storage_bucket: string | null;
  storage_object_key: string | null;
  content_hash_sha256: string | null;
  derived_from_shot_plan_id?: string | null;
}

async function mapRowToShotPlanReviewItem(
  row: ShotPlanJoinedRow,
  mediaDelivery?: ReviewMediaDeliveryPort | undefined
): Promise<ShotPlanReviewItem> {
  const structured =
    typeof row.structured_plan === "string"
      ? (JSON.parse(row.structured_plan) as Record<string, unknown>)
      : (row.structured_plan ?? {});

  const previsCandidateId =
    row.previs_candidate_id ??
    (structured.previs as Record<string, unknown> | undefined)?.candidateId;

  let previsUrl: string | null = null;
  if (mediaDelivery && row.storage_bucket && row.storage_object_key && row.content_hash_sha256) {
    try {
      previsUrl = await mediaDelivery.generatePresignedReadUrl({
        bucket: row.storage_bucket,
        key: row.storage_object_key,
        contentHash: row.content_hash_sha256
      });
    } catch {
      previsUrl = null;
    }
  }

  const previs = previsCandidateId
    ? {
        candidateId: String(previsCandidateId),
        media: {
          available: Boolean(previsUrl),
          url: previsUrl ?? undefined
        },
        reviewNotes:
          (structured.previs as { reviewNotes?: string | null } | undefined)?.reviewNotes ?? null
      }
    : null;

  return {
    shotPlanId: row.shot_plan_id,
    sceneId: row.scene_id,
    specRevision: Number(row.spec_revision),
    variantOrdinal: Number(row.variant_ordinal),
    status: row.status as ShotPlanStatus,
    routingMode: row.routing_mode as ShotPlanRoutingMode,
    isCurrentRevision: true,
    targetDurationMs: Number(row.target_duration_ms),
    targetFrameCount: Number(row.target_frame_count),
    framing: row.framing as ShotPlanReviewItem["framing"],
    angle: row.camera_angle as ShotPlanReviewItem["angle"],
    cameraMovement: row.camera_movement as CameraMovement,
    movementSpeed: ((structured.movementSpeed as string) ?? "medium") as MovementSpeed,
    lensIntent: (structured.lensIntent as string) ?? "35mm standard",
    cameraPosition: (structured.cameraPosition as string) ?? "eye_level",
    cameraPromptDescription: (structured.cameraPromptDescription as string) ?? "",
    actionSummary: (structured.actionSummary as string) ?? "",
    lightingStyle: row.lighting_style as ShotPlanReviewItem["lightingStyle"],
    environmentDescription: (structured.environmentDescription as string) ?? "",
    colorPalette: Array.isArray(structured.colorPalette)
      ? (structured.colorPalette as string[])
      : [],
    atmosphere: (structured.atmosphere as string | null | undefined) ?? null,
    subjects: Array.isArray(structured.subjects)
      ? (structured.subjects as ShotPlanReviewItem["subjects"])
      : [],
    beats: Array.isArray(structured.beats) ? (structured.beats as ShotPlanReviewItem["beats"]) : [],
    dialogue: (structured.dialogue as ShotPlanReviewItem["dialogue"]) ?? null,
    continuity: (structured.continuity as ShotPlanReviewItem["continuity"]) ?? {
      persistentSubjectIds: [],
      frameAnchorTarget: "none"
    },
    previs,
    derivedFromShotPlanId:
      row.derived_from_shot_plan_id ??
      (structured.derivedFromShotPlanId as string | null | undefined) ??
      null,
    derivation: (structured.derivation as ShotPlanReviewItem["derivation"]) ?? null,
    boundReferences: [],
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at).toISOString()
  };
}

export class PostgresCampaignAnimaticQueries implements CampaignAnimaticQueries {
  constructor(
    private readonly client: Pool | PoolClient,
    private readonly mediaDelivery?: ReviewMediaDeliveryPort | undefined
  ) {}

  async getCampaignAnimatic(
    campaignId: CampaignId | string
  ): Promise<CampaignAnimaticReadModel | undefined> {
    const campaignResult = await this.client.query<CampaignRow>(
      `SELECT campaign_id, title, status, updated_at
       FROM campaigns
       WHERE campaign_id = $1 AND archived_at IS NULL`,
      [campaignId]
    );

    const campaignRow = campaignResult.rows[0];
    if (!campaignRow) {
      return undefined;
    }

    const scenesResult = await this.client.query<StoryboardSceneRow>(
      `SELECT
         scene_id,
         scene_order,
         spec_revision,
         duration_seconds,
         visual_description,
         status,
         selected_shot_plan_id,
         selected_shot_plan_revision,
         approved_shot_plan_id
       FROM storyboard_scenes
       WHERE campaign_id = $1 AND archived_at IS NULL
       ORDER BY scene_order ASC`,
      [campaignId]
    );

    const shotPlansResult = await this.client.query<ShotPlanJoinedRow>(
      `SELECT
         sp.shot_plan_id,
         sp.scene_id,
         sp.spec_revision,
         sp.variant_ordinal,
         sp.status,
         sp.routing_mode,
         sp.target_duration_ms,
         sp.target_frame_count,
         sp.framing,
         sp.camera_angle,
         sp.camera_movement,
         sp.lighting_style,
         sp.previs_candidate_id,
         sp.structured_plan,
         sp.created_at,
         sp.updated_at,
         sp.derived_from_shot_plan_id,
         sc.storage_bucket,
         sc.storage_object_key,
         sc.content_hash_sha256
       FROM shot_plans sp
       JOIN storyboard_scenes s ON s.scene_id = sp.scene_id
       LEFT JOIN storyboard_candidates sc ON sc.candidate_id = sp.previs_candidate_id
       WHERE s.campaign_id = $1 AND s.archived_at IS NULL
       ORDER BY sp.scene_id ASC, sp.spec_revision ASC, sp.variant_ordinal ASC`,
      [campaignId]
    );

    const shotPlanMap = new Map<string, ShotPlanReviewItem>();
    for (const row of shotPlansResult.rows) {
      const item = await mapRowToShotPlanReviewItem(row, this.mediaDelivery);
      shotPlanMap.set(item.shotPlanId, item);
    }

    const rawScenes: RawAnimaticSceneInput[] = scenesResult.rows.map((row) => {
      const selectedShotPlan = row.selected_shot_plan_id
        ? (shotPlanMap.get(row.selected_shot_plan_id) ?? null)
        : null;

      return {
        sceneId: row.scene_id,
        sceneOrder: Number(row.scene_order),
        specRevision: Number(row.spec_revision),
        durationSeconds:
          typeof row.duration_seconds === "number"
            ? row.duration_seconds
            : parseFloat(row.duration_seconds),
        selectedShotPlanId: row.selected_shot_plan_id,
        selectedShotPlanRevision:
          row.selected_shot_plan_revision !== null && row.selected_shot_plan_revision !== undefined
            ? Number(row.selected_shot_plan_revision)
            : null,
        approvedShotPlanId: row.approved_shot_plan_id,
        selectedShotPlan
      };
    });

    const campaignUpdatedAt =
      campaignRow.updated_at instanceof Date
        ? campaignRow.updated_at.toISOString()
        : new Date(campaignRow.updated_at).toISOString();

    return compileCampaignAnimaticReadModel({
      campaignId: campaignRow.campaign_id,
      campaignName: campaignRow.title,
      campaignUpdatedAt,
      scenes: rawScenes
    });
  }
}
