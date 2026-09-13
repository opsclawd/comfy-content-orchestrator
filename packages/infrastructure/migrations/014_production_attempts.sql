-- ---------------------------------------------------------------------------
-- PRODUCTION ATTEMPTS & ATTEMPT FENCING
-- Issue #263 (215.3): Add attempt-fenced production Accept / Re-render commands
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS production_attempts (
  attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id UUID NOT NULL REFERENCES storyboard_scenes(scene_id),
  run_id UUID REFERENCES campaign_production_runs(run_id),
  ordinal INT NOT NULL,
  production_job_id UUID NOT NULL UNIQUE REFERENCES render_jobs(job_id),
  spec_revision INT NOT NULL,
  selected_candidate_id UUID,
  selected_candidate_revision INT,
  seed BIGINT NOT NULL,
  created_reason TEXT NOT NULL CHECK (
    created_reason IN ('initial_dispatch', 'failure_recovery', 'production_rerender')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scene_id, ordinal)
);

CREATE INDEX idx_production_attempts_run ON production_attempts (run_id);
CREATE INDEX idx_production_attempts_scene ON production_attempts (scene_id);

ALTER TABLE storyboard_scenes
  ADD COLUMN IF NOT EXISTS production_attempt_ordinal INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accepted_production_attempt_id UUID REFERENCES production_attempts(attempt_id);

ALTER TABLE campaign_production_run_scenes
  ADD COLUMN IF NOT EXISTS current_attempt_id UUID REFERENCES production_attempts(attempt_id),
  ADD COLUMN IF NOT EXISTS current_attempt_ordinal INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS accepted_attempt_id UUID REFERENCES production_attempts(attempt_id),
  ADD COLUMN IF NOT EXISTS accepted_production_job_id UUID REFERENCES render_jobs(job_id),
  ADD COLUMN IF NOT EXISTS accepted_attempt_ordinal INT;

ALTER TYPE review_action_enum ADD VALUE IF NOT EXISTS 'production_accept';
ALTER TYPE review_action_enum ADD VALUE IF NOT EXISTS 'production_rerender';

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

    EXECUTE format('GRANT UPDATE ON campaign_production_run_scenes TO %I', v_app_role);
    EXECUTE format('GRANT SELECT, INSERT ON production_attempts TO %I', v_app_role);
    EXECUTE format('GRANT UPDATE ON storyboard_scenes TO %I', v_app_role);
  END IF;
END;
$$;
