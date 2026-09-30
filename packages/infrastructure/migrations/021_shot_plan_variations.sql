-- ---------------------------------------------------------------------------
-- DIRECTED SHOT PLAN VARIATIONS
-- Issue #361 (358.3): Create directed ShotPlan variations from a preferred variant
-- ---------------------------------------------------------------------------

ALTER TABLE shot_plans
  ADD COLUMN IF NOT EXISTS derived_from_shot_plan_id UUID
    REFERENCES shot_plans(shot_plan_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255),
  ADD COLUMN IF NOT EXISTS request_hash_sha256 VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_shot_plans_derived_from
  ON shot_plans(derived_from_shot_plan_id)
  WHERE derived_from_shot_plan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shot_plans_idempotency
  ON shot_plans(scene_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
