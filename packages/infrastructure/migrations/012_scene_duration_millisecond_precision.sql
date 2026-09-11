-- ---------------------------------------------------------------------------
-- SCENE DURATION MILLISECOND PRECISION
-- Issue #220 (217-B): Preserve millisecond-exact duration in storyboard scenes
-- ---------------------------------------------------------------------------

ALTER TABLE storyboard_scenes
  ALTER COLUMN duration_seconds TYPE NUMERIC(8, 3),
  ALTER COLUMN duration_seconds SET DEFAULT 5.000;
