-- 032_acceptance_assembly_lifecycle.sql
-- Add candidate specification digest and plan ID to acceptance_run_scenes,
-- operator acceptance action receipts for idempotency,
-- and extended lineage and storage metadata to acceptance_assembly_manifests.

-- 1. Extend acceptance_run_scenes with specification digest and plan ID
ALTER TABLE acceptance_run_scenes
  ADD COLUMN IF NOT EXISTS candidate_specification_digest TEXT,
  ADD COLUMN IF NOT EXISTS plan_id UUID;

-- 2. Operator acceptance action receipts table for idempotency
CREATE TABLE IF NOT EXISTS operator_acceptance_action_receipts (
  action_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('begin', 'accept_scene', 'rerender_scene', 'assemble', 'complete')),
  run_or_campaign_id UUID NOT NULL,
  realm JSONB NOT NULL,
  request_hash TEXT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope, run_or_campaign_id, action_id)
);

CREATE INDEX IF NOT EXISTS idx_operator_acceptance_action_receipts_action_id
  ON operator_acceptance_action_receipts(action_id);

-- 3. Extend acceptance_assembly_manifests with realm, origin, plan, and storage metadata
ALTER TABLE acceptance_assembly_manifests
  ADD COLUMN IF NOT EXISTS realm JSONB,
  ADD COLUMN IF NOT EXISTS evidence_origin TEXT,
  ADD COLUMN IF NOT EXISTS plan_id UUID,
  ADD COLUMN IF NOT EXISTS accepted_attempt_ids JSONB,
  ADD COLUMN IF NOT EXISTS storage_bucket TEXT,
  ADD COLUMN IF NOT EXISTS storage_key TEXT,
  ADD COLUMN IF NOT EXISTS storage_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS manifest_storage_bucket TEXT,
  ADD COLUMN IF NOT EXISTS manifest_storage_key TEXT,
  ADD COLUMN IF NOT EXISTS manifest_storage_sha256 TEXT;

CREATE INDEX IF NOT EXISTS idx_acceptance_assembly_manifests_plan_id
  ON acceptance_assembly_manifests(plan_id);

-- 4. Grant table privileges to configured orchestrator.app_role
DO $$
DECLARE
  v_app_role text := nullif(trim(current_setting('orchestrator.app_role', true)), '');
  v_role_exists boolean;
BEGIN
  IF v_app_role IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname = v_app_role
    ) INTO v_role_exists;

    IF NOT v_role_exists THEN
      RAISE EXCEPTION 'Configured application role % does not exist in pg_roles', v_app_role;
    END IF;

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_duration_plans, scene_duration_bindings, deployment_enablement_state, operator_acceptance_runs, acceptance_run_scenes, acceptance_assembly_jobs, acceptance_assembly_manifests, replan_action_receipts, operator_acceptance_action_receipts TO %I', v_app_role);
  END IF;
END;
$$;

