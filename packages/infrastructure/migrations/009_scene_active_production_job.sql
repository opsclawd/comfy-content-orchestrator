-- ---------------------------------------------------------------------------
-- SCENE ACTIVE PRODUCTION JOB COLUMN
-- ---------------------------------------------------------------------------

ALTER TABLE storyboard_scenes
  ADD COLUMN IF NOT EXISTS active_production_job_id UUID;
