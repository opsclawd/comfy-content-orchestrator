import type { CampaignDurationPlanRepository, ReplanActionReceipt } from "@cco/application";
import {
  type CampaignDurationPlan,
  type SceneDurationBinding,
  CampaignDurationPlanSchema,
  SceneDurationBindingSchema
} from "@cco/contracts";
import type { Pool, PoolClient } from "pg";

interface DurationPlanRow {
  plan_id: string;
  campaign_id: string;
  revision: number;
  predecessor_plan_id: string | null;
  realm: unknown;
  scope: string;
  requested_total_duration_ms: number;
  scene_count_override: number | null;
  selected_profile_key: string;
  allowed_duration_profile_keys: unknown;
  allocations: unknown;
  envelope: unknown;
  final_edit_policy: string;
  total_nominal_duration_ms: number;
  exact_rational_total_duration_ms: number;
  semantic_digest: string;
  created_at: Date | string;
}

interface SceneDurationBindingRow {
  binding_id: string;
  campaign_id: string;
  plan_id: string;
  plan_revision: number;
  allocation_id: string;
  scene_id: string;
  spec_revision: number;
  ordinal: number;
  binding_digest: string;
  created_at: Date | string;
}

function parseJsonField<T>(val: unknown): T {
  if (typeof val === "string") {
    return JSON.parse(val) as T;
  }
  return val as T;
}

function mapRowToPlan(row: DurationPlanRow): CampaignDurationPlan {
  const raw = {
    planId: row.plan_id,
    campaignId: row.campaign_id,
    revision: row.revision,
    predecessorPlanId: row.predecessor_plan_id,
    realm: parseJsonField(row.realm),
    scope: row.scope,
    requestedTotalDurationMs: row.requested_total_duration_ms,
    ...(row.scene_count_override != null ? { sceneCountOverride: row.scene_count_override } : {}),
    selectedProfileKey: row.selected_profile_key,
    allowedDurationProfileKeys: parseJsonField(row.allowed_duration_profile_keys),
    allocations: parseJsonField(row.allocations),
    envelope: parseJsonField(row.envelope),
    finalEditPolicy: row.final_edit_policy,
    totalNominalDurationMs: row.total_nominal_duration_ms,
    exactRationalTotalDurationMs: Number(row.exact_rational_total_duration_ms),
    semanticDigest: row.semantic_digest,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString()
  };
  return CampaignDurationPlanSchema.parse(raw);
}

function mapRowToBinding(row: SceneDurationBindingRow): SceneDurationBinding {
  const raw = {
    bindingId: row.binding_id,
    campaignId: row.campaign_id,
    planId: row.plan_id,
    planRevision: row.plan_revision,
    allocationId: row.allocation_id,
    sceneId: row.scene_id,
    specRevision: row.spec_revision,
    ordinal: row.ordinal,
    bindingDigest: row.binding_digest,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString()
  };
  return SceneDurationBindingSchema.parse(raw);
}

export class PostgresCampaignDurationPlanRepository implements CampaignDurationPlanRepository {
  constructor(private readonly client: Pool | PoolClient) {}

  async savePlan(plan: CampaignDurationPlan): Promise<void> {
    const query = `
      INSERT INTO campaign_duration_plans (
        plan_id,
        campaign_id,
        revision,
        predecessor_plan_id,
        realm,
        scope,
        requested_total_duration_ms,
        scene_count_override,
        selected_profile_key,
        allowed_duration_profile_keys,
        allocations,
        envelope,
        final_edit_policy,
        total_nominal_duration_ms,
        exact_rational_total_duration_ms,
        semantic_digest,
        created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
      );
    `;

    await this.client.query(query, [
      plan.planId,
      plan.campaignId,
      plan.revision,
      plan.predecessorPlanId,
      JSON.stringify(plan.realm),
      plan.scope,
      plan.requestedTotalDurationMs,
      plan.sceneCountOverride ?? null,
      plan.selectedProfileKey,
      JSON.stringify(plan.allowedDurationProfileKeys),
      JSON.stringify(plan.allocations),
      JSON.stringify(plan.envelope),
      plan.finalEditPolicy,
      plan.totalNominalDurationMs,
      plan.exactRationalTotalDurationMs,
      plan.semanticDigest,
      plan.createdAt
    ]);
  }

  async findCurrentPlanByCampaignId(campaignId: string): Promise<CampaignDurationPlan | undefined> {
    const query = `
      SELECT * FROM campaign_duration_plans
      WHERE campaign_id = $1
      ORDER BY revision DESC
      LIMIT 1;
    `;
    const res = await this.client.query<DurationPlanRow>(query, [campaignId]);
    if (res.rows.length === 0) {
      return undefined;
    }
    return mapRowToPlan(res.rows[0]!);
  }

  async findByCampaignIdAndRevision(
    campaignId: string,
    revision: number
  ): Promise<CampaignDurationPlan | undefined> {
    const query = `
      SELECT * FROM campaign_duration_plans
      WHERE campaign_id = $1 AND revision = $2;
    `;
    const res = await this.client.query<DurationPlanRow>(query, [campaignId, revision]);
    if (res.rows.length === 0) {
      return undefined;
    }
    return mapRowToPlan(res.rows[0]!);
  }

  async saveBindings(bindings: readonly SceneDurationBinding[]): Promise<void> {
    if (bindings.length === 0) return;

    for (const b of bindings) {
      const query = `
        INSERT INTO scene_duration_bindings (
          binding_id,
          campaign_id,
          plan_id,
          plan_revision,
          allocation_id,
          scene_id,
          spec_revision,
          ordinal,
          binding_digest,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (binding_id) DO UPDATE SET
          spec_revision = EXCLUDED.spec_revision,
          binding_digest = EXCLUDED.binding_digest;
      `;
      await this.client.query(query, [
        b.bindingId,
        b.campaignId,
        b.planId,
        b.planRevision,
        b.allocationId,
        b.sceneId,
        b.specRevision,
        b.ordinal,
        b.bindingDigest,
        b.createdAt
      ]);
    }
  }

  async findBindingsByPlanId(planId: string): Promise<readonly SceneDurationBinding[]> {
    const query = `
      SELECT * FROM scene_duration_bindings
      WHERE plan_id = $1
      ORDER BY ordinal ASC;
    `;
    const res = await this.client.query<SceneDurationBindingRow>(query, [planId]);
    return res.rows.map(mapRowToBinding);
  }

  async findBindingBySceneId(sceneId: string): Promise<SceneDurationBinding | undefined> {
    const query = `
      SELECT * FROM scene_duration_bindings
      WHERE scene_id = $1
      ORDER BY plan_revision DESC
      LIMIT 1;
    `;
    const res = await this.client.query<SceneDurationBindingRow>(query, [sceneId]);
    if (res.rows.length === 0) {
      return undefined;
    }
    return mapRowToBinding(res.rows[0]!);
  }

  async saveReceipt(receipt: ReplanActionReceipt): Promise<void> {
    const query = `
      INSERT INTO replan_action_receipts (
        action_id,
        campaign_id,
        realm,
        request_hash,
        response,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (campaign_id, action_id) DO NOTHING;
    `;
    await this.client.query(query, [
      receipt.actionId,
      receipt.campaignId,
      JSON.stringify(receipt.realm ?? { kind: "deployed", deploymentId: "default" }),
      receipt.requestHash ?? "",
      JSON.stringify(receipt.response),
      receipt.createdAt
    ]);
  }

  async findReceipt(params: {
    readonly campaignId: string;
    readonly actionId: string;
  }): Promise<ReplanActionReceipt | undefined> {
    const query = `
      SELECT action_id, campaign_id, realm, request_hash, response, created_at
      FROM replan_action_receipts
      WHERE campaign_id = $1 AND action_id = $2;
    `;
    const res = await this.client.query<{
      action_id: string;
      campaign_id: string;
      realm: unknown;
      request_hash: string;
      response: unknown;
      created_at: Date | string;
    }>(query, [params.campaignId, params.actionId]);
    if (res.rows.length === 0) return undefined;
    const row = res.rows[0]!;
    return {
      actionId: row.action_id,
      campaignId: row.campaign_id,
      realm: parseJsonField(row.realm),
      requestHash: row.request_hash,
      response: parseJsonField(row.response),
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : new Date(row.created_at).toISOString()
    };
  }

  async findReceiptByActionId(
    actionId: string,
    campaignId?: string
  ): Promise<ReplanActionReceipt | undefined> {
    if (campaignId) {
      return this.findReceipt({ campaignId, actionId });
    }
    const query = `
      SELECT action_id, campaign_id, realm, request_hash, response, created_at
      FROM replan_action_receipts
      WHERE action_id = $1;
    `;
    const res = await this.client.query<{
      action_id: string;
      campaign_id: string;
      realm: unknown;
      request_hash: string;
      response: unknown;
      created_at: Date | string;
    }>(query, [actionId]);
    if (res.rows.length === 0) return undefined;
    const row = res.rows[0]!;
    return {
      actionId: row.action_id,
      campaignId: row.campaign_id,
      realm: parseJsonField(row.realm),
      requestHash: row.request_hash,
      response: parseJsonField(row.response),
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : new Date(row.created_at).toISOString()
    };
  }
}
