-- ---------------------------------------------------------------------------
-- SCENE PLANNING RUN LEASE AND FAILURE REASON
-- ---------------------------------------------------------------------------

ALTER TABLE storyboard_scenes
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS active_planning_run_id UUID,
  ADD COLUMN IF NOT EXISTS active_planning_expires_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_storyboard_scenes_planning_recovery
  ON storyboard_scenes(status, active_planning_expires_at)
  WHERE status = 'generating_candidates' AND active_planning_run_id IS NOT NULL;
