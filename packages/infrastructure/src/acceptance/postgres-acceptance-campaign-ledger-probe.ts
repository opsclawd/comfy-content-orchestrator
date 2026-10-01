import type { Pool } from "pg";
import type {
  AcceptanceCampaignLedgerProbePort,
  AcceptanceCampaignLedgerProbeResult
} from "@cco/application";

export interface PostgresAcceptanceCampaignLedgerProbeOptions {
  readonly idempotencyKey: string;
  readonly expectedSceneCount: number;
}

/**
 * Read-only probe answering, directly against the real tables, two of #373's GPU-free
 * preflight requirements: "campaign/scenes can be created idempotently" (by comparing the
 * installed scene count for the fixture campaign against the fixture's declared scene
 * count — a mismatch means a prior install duplicated or dropped scenes) and "no fake
 * ProductionAttempt, GenerationManifest, certification result, or accepted output is
 * created" (by asserting the production ledgers are empty for those scenes). Never writes
 * to any table. If the fixture campaign has not yet been installed, this reports `ok: true,
 * installed: false` rather than a blocker — not-yet-installed is a legitimate pre-install
 * preflight state, not a defect.
 */
export class PostgresAcceptanceCampaignLedgerProbe implements AcceptanceCampaignLedgerProbePort {
  constructor(
    private readonly pool: Pool,
    private readonly options: PostgresAcceptanceCampaignLedgerProbeOptions
  ) {}

  async probe(): Promise<AcceptanceCampaignLedgerProbeResult> {
    const campaignResult = await this.pool.query<{ campaign_id: string }>(
      `SELECT campaign_id FROM campaigns WHERE idempotency_key = $1 AND archived_at IS NULL`,
      [this.options.idempotencyKey]
    );

    if (campaignResult.rows.length === 0) {
      return {
        ok: true,
        installed: false,
        sceneCount: 0,
        expectedSceneCount: this.options.expectedSceneCount,
        fabricationFree: true,
        detail:
          "Fixture campaign not yet installed; run `acceptance install` before operator handoff."
      };
    }

    const campaignId = campaignResult.rows[0]!.campaign_id;

    const sceneResult = await this.pool.query<{ scene_id: string }>(
      `SELECT scene_id FROM storyboard_scenes WHERE campaign_id = $1 AND archived_at IS NULL`,
      [campaignId]
    );
    const sceneIds = sceneResult.rows.map((row) => row.scene_id);
    const sceneCount = sceneIds.length;

    const productionRunsResult = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM campaign_production_runs WHERE campaign_id = $1`,
      [campaignId]
    );
    const productionRuns = Number(productionRunsResult.rows[0]?.count ?? 0);

    let shotPlans = 0;
    let candidates = 0;
    let reviewEvents = 0;
    if (sceneIds.length > 0) {
      const [shotPlansResult, candidatesResult, reviewEventsResult] = await Promise.all([
        this.pool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM shot_plans WHERE scene_id = ANY($1::uuid[])`,
          [sceneIds]
        ),
        this.pool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM storyboard_candidates WHERE scene_id = ANY($1::uuid[])`,
          [sceneIds]
        ),
        this.pool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM review_events WHERE scene_id = ANY($1::uuid[])`,
          [sceneIds]
        )
      ]);
      shotPlans = Number(shotPlansResult.rows[0]?.count ?? 0);
      candidates = Number(candidatesResult.rows[0]?.count ?? 0);
      reviewEvents = Number(reviewEventsResult.rows[0]?.count ?? 0);
    }

    const fabricationFree =
      productionRuns === 0 && shotPlans === 0 && candidates === 0 && reviewEvents === 0;
    const sceneCountMatches = sceneCount === this.options.expectedSceneCount;

    const issues: string[] = [];
    if (!sceneCountMatches) {
      issues.push(
        `Expected exactly ${this.options.expectedSceneCount} installed scenes, found ${sceneCount}.`
      );
    }
    if (!fabricationFree) {
      issues.push(
        "Preparation tooling must not have produced production-ledger rows: " +
          JSON.stringify({ shotPlans, candidates, reviewEvents, productionRuns })
      );
    }

    return {
      ok: sceneCountMatches && fabricationFree,
      installed: true,
      sceneCount,
      expectedSceneCount: this.options.expectedSceneCount,
      fabricationFree,
      detail: issues.length > 0 ? issues.join(" ") : undefined
    };
  }
}
