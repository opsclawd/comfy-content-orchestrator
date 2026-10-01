import type { CampaignReadinessQueries } from "@cco/application";
import type {
  CampaignPreProductionReadinessReadModel,
  RawReadinessSceneInput,
  ShotPlanRoutingMode
} from "@cco/contracts";
import { compileCampaignPreProductionReadiness } from "@cco/contracts";
import type { CampaignId } from "@cco/domain";
import type { Pool, PoolClient } from "pg";

interface CampaignRow {
  campaign_id: string;
  title: string;
  updated_at: Date | string;
}

interface StoryboardSceneRow {
  scene_id: string;
  scene_order: number | string;
  spec_revision: number | string;
  production_routing_mode: string;
  selected_shot_plan_id: string | null;
  selected_shot_plan_revision: number | string | null;
  approved_shot_plan_id: string | null;
  approved_shot_plan_revision: number | string | null;
  selected_candidate_id: string | null;
  selected_candidate_revision: number | string | null;
  updated_at: Date | string;
}

interface ShotPlanAggregateRow {
  scene_id: string;
  current_revision_count: number | string;
  superseded_count: number | string;
  last_planned_spec_revision: number | string | null;
  selected_shot_plan_spec_revision: number | string | null;
  selected_shot_plan_status: string | null;
  selected_shot_plan_previs_candidate_id: string | null;
  previs_available: boolean;
}

interface ReferenceBindingRow {
  scene_id: string;
  binding_count: number | string;
  roles: (string | null)[] | null;
  has_archived: boolean;
  has_cross_client: boolean;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toNullableNumber(value: number | string | null): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export class PostgresCampaignReadinessQueries implements CampaignReadinessQueries {
  constructor(private readonly client: Pool | PoolClient) {}

  async getCampaignPreProductionReadiness(
    campaignId: CampaignId | string
  ): Promise<CampaignPreProductionReadinessReadModel | undefined> {
    const campaignResult = await this.client.query<CampaignRow>(
      `SELECT campaign_id, title, updated_at
       FROM campaigns
       WHERE campaign_id = $1 AND archived_at IS NULL`,
      [campaignId]
    );

    const campaignRow = campaignResult.rows[0];
    if (!campaignRow) {
      return undefined;
    }

    const [scenesResult, shotPlanAggregateResult, bindingResult] = await Promise.all([
      this.client.query<StoryboardSceneRow>(
        `SELECT
           scene_id,
           scene_order,
           spec_revision,
           production_routing_mode,
           selected_shot_plan_id,
           selected_shot_plan_revision,
           approved_shot_plan_id,
           approved_shot_plan_revision,
           selected_candidate_id,
           selected_candidate_revision,
           updated_at
         FROM storyboard_scenes
         WHERE campaign_id = $1 AND archived_at IS NULL
         ORDER BY scene_order ASC`,
        [campaignId]
      ),
      this.client.query<ShotPlanAggregateRow>(
        `SELECT
           s.scene_id AS scene_id,
           COUNT(sp.shot_plan_id) FILTER (WHERE sp.spec_revision = s.spec_revision) AS current_revision_count,
           COUNT(sp.shot_plan_id) FILTER (WHERE sp.spec_revision < s.spec_revision) AS superseded_count,
           MAX(sp.spec_revision) AS last_planned_spec_revision,
           sel.spec_revision AS selected_shot_plan_spec_revision,
           sel.status AS selected_shot_plan_status,
           sel.previs_candidate_id AS selected_shot_plan_previs_candidate_id,
           (cand.candidate_id IS NOT NULL) AS previs_available
         FROM storyboard_scenes s
         LEFT JOIN shot_plans sp ON sp.scene_id = s.scene_id
         LEFT JOIN shot_plans sel ON sel.shot_plan_id = s.selected_shot_plan_id
         LEFT JOIN storyboard_candidates cand
           ON cand.candidate_id = sel.previs_candidate_id
           AND cand.scene_id = s.scene_id
           AND cand.scene_spec_revision = s.spec_revision
         WHERE s.campaign_id = $1 AND s.archived_at IS NULL
         GROUP BY s.scene_id, sel.spec_revision, sel.status, sel.previs_candidate_id, cand.candidate_id`,
        [campaignId]
      ),
      this.client.query<ReferenceBindingRow>(
        `SELECT
           s.scene_id AS scene_id,
           COUNT(sra.asset_id) AS binding_count,
           array_agg(sra.role ORDER BY sra.role) FILTER (WHERE sra.role IS NOT NULL) AS roles,
           COALESCE(bool_or(ra.archived_at IS NOT NULL), false) AS has_archived,
           COALESCE(bool_or(ra.client_id <> c.client_id), false) AS has_cross_client
         FROM storyboard_scenes s
         JOIN campaigns c ON c.campaign_id = s.campaign_id
         LEFT JOIN scene_reference_assets sra
           ON sra.scene_id = s.scene_id
           AND sra.spec_revision = s.spec_revision
           AND sra.archived_at IS NULL
         LEFT JOIN reference_assets ra ON ra.asset_id = sra.asset_id
         WHERE s.campaign_id = $1 AND s.archived_at IS NULL
         GROUP BY s.scene_id`,
        [campaignId]
      )
    ]);

    const shotPlanAggregateByScene = new Map<string, ShotPlanAggregateRow>();
    for (const row of shotPlanAggregateResult.rows) {
      shotPlanAggregateByScene.set(row.scene_id, row);
    }

    const bindingByScene = new Map<string, ReferenceBindingRow>();
    for (const row of bindingResult.rows) {
      bindingByScene.set(row.scene_id, row);
    }

    const rawScenes: RawReadinessSceneInput[] = scenesResult.rows.map((row) => {
      const aggregate = shotPlanAggregateByScene.get(row.scene_id);
      const binding = bindingByScene.get(row.scene_id);

      return {
        sceneId: row.scene_id,
        sceneOrder: Number(row.scene_order),
        specRevision: Number(row.spec_revision),
        sceneUpdatedAt: toIso(row.updated_at),
        routingMode: row.production_routing_mode as ShotPlanRoutingMode,
        selectedShotPlanId: row.selected_shot_plan_id,
        selectedShotPlanRevision: toNullableNumber(row.selected_shot_plan_revision),
        approvedShotPlanId: row.approved_shot_plan_id,
        approvedShotPlanRevision: toNullableNumber(row.approved_shot_plan_revision),
        selectedCandidateId: row.selected_candidate_id,
        selectedCandidateRevision: toNullableNumber(row.selected_candidate_revision),
        selectedShotPlanSpecRevision: aggregate
          ? toNullableNumber(aggregate.selected_shot_plan_spec_revision)
          : null,
        selectedShotPlanStatus: aggregate?.selected_shot_plan_status ?? null,
        selectedShotPlanPrevisCandidateId:
          aggregate?.selected_shot_plan_previs_candidate_id ?? null,
        currentRevisionShotPlanCount: aggregate ? Number(aggregate.current_revision_count) : 0,
        supersededShotPlanCount: aggregate ? Number(aggregate.superseded_count) : 0,
        lastPlannedSpecRevision: aggregate
          ? toNullableNumber(aggregate.last_planned_spec_revision)
          : null,
        currentRevisionBindingCount: binding ? Number(binding.binding_count) : 0,
        currentRevisionBindingRoles: binding?.roles
          ? binding.roles.filter((r): r is string => r !== null)
          : [],
        hasArchivedBinding: binding?.has_archived ?? false,
        hasCrossClientBinding: binding?.has_cross_client ?? false,
        currentRevisionPrevisAvailable: aggregate?.previs_available ?? false,
        currentRevisionPrevisCandidateId: aggregate?.previs_available
          ? (aggregate.selected_shot_plan_previs_candidate_id ?? null)
          : null
      };
    });

    return compileCampaignPreProductionReadiness({
      campaignId: campaignRow.campaign_id,
      campaignName: campaignRow.title,
      campaignUpdatedAt: toIso(campaignRow.updated_at),
      scenes: rawScenes
    });
  }
}
