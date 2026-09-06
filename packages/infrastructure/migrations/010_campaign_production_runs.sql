-- ---------------------------------------------------------------------------
-- CAMPAIGN PRODUCTION RUNS & RUN SCENES
-- Sprint 4: Campaign-level production dispatch and gating (#197)
-- ---------------------------------------------------------------------------

CREATE TYPE run_status_enum AS ENUM ('dispatched', 'assembling', 'completed', 'failed');

CREATE TABLE campaign_production_runs (
  run_id UUID PRIMARY KEY DEFAULT uuidv7(),
  campaign_id UUID NOT NULL REFERENCES campaigns(campaign_id) ON DELETE RESTRICT,
  fingerprint TEXT NOT NULL,
  status run_status_enum NOT NULL DEFAULT 'dispatched',
  expected_total_duration_ms INT NOT NULL CHECK (expected_total_duration_ms > 0),
  assembly_job_id UUID REFERENCES delivery_assembly_jobs(job_id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (campaign_id, fingerprint)
);

CREATE INDEX idx_campaign_production_runs_assembly_job
  ON campaign_production_runs (assembly_job_id);

CREATE TABLE campaign_production_run_scenes (
  run_id UUID NOT NULL REFERENCES campaign_production_runs(run_id) ON DELETE CASCADE,
  scene_id UUID NOT NULL REFERENCES storyboard_scenes(scene_id) ON DELETE RESTRICT,
  spec_revision INT NOT NULL,
  sequence_index INT NOT NULL CHECK (sequence_index > 0),
  expected_duration_ms INT NOT NULL CHECK (expected_duration_ms > 0),
  production_job_id UUID REFERENCES render_jobs(job_id),
  PRIMARY KEY (run_id, scene_id),
  UNIQUE (run_id, sequence_index)
);

CREATE INDEX idx_campaign_production_run_scenes_job
  ON campaign_production_run_scenes (production_job_id);

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

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_production_runs TO %I', v_app_role);
    EXECUTE format('GRANT SELECT, INSERT ON campaign_production_run_scenes TO %I', v_app_role);
  END IF;

END;
$$;
