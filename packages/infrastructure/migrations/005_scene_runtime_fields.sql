-- ---------------------------------------------------------------------------
-- SCENE RUNTIME CONFIGURATION & RECONSTITUTION COLUMNS
-- ---------------------------------------------------------------------------

ALTER TABLE storyboard_scenes
  ADD COLUMN IF NOT EXISTS lora_configuration_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS approved_by VARCHAR(128),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS approved_revision INT,
  ADD COLUMN IF NOT EXISTS failed_from scene_status_enum;
