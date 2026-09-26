-- ---------------------------------------------------------------------------
-- SHOT PLANS AND NON-AUTHORITATIVE PREVIS REVIEW
-- Issue #327 (325.2): Add structured ShotPlan variants and non-authoritative previs review
-- ---------------------------------------------------------------------------

ALTER TYPE review_action_enum ADD VALUE IF NOT EXISTS 'select_shotplan';
ALTER TYPE review_action_enum ADD VALUE IF NOT EXISTS 'approve_shotplan';
ALTER TYPE review_action_enum ADD VALUE IF NOT EXISTS 'reroll_shotplan';

-- ---------------------------------------------------------------------------
-- STORYBOARD SCENES SHOT PLAN POINTERS
-- ---------------------------------------------------------------------------

ALTER TABLE storyboard_scenes
  ADD COLUMN IF NOT EXISTS selected_shot_plan_id UUID,
  ADD COLUMN IF NOT EXISTS selected_shot_plan_revision INT,
  ADD COLUMN IF NOT EXISTS approved_shot_plan_id UUID,
  ADD COLUMN IF NOT EXISTS approved_shot_plan_revision INT,
  ADD COLUMN IF NOT EXISTS production_routing_mode VARCHAR(32) NOT NULL DEFAULT 'reference_directed';

ALTER TABLE storyboard_scenes
  ADD CONSTRAINT storyboard_scene_shot_plan_selection_pair
  CHECK (
    (selected_shot_plan_id IS NULL AND selected_shot_plan_revision IS NULL)
    OR
    (selected_shot_plan_id IS NOT NULL AND selected_shot_plan_revision IS NOT NULL)
  );

ALTER TABLE storyboard_scenes
  ADD CONSTRAINT storyboard_scene_selected_shot_plan_revision_current
  CHECK (
    selected_shot_plan_revision IS NULL
    OR selected_shot_plan_revision = spec_revision
  );

ALTER TABLE storyboard_scenes
  ADD CONSTRAINT storyboard_scene_shot_plan_approval_pair
  CHECK (
    (approved_shot_plan_id IS NULL AND approved_shot_plan_revision IS NULL)
    OR
    (approved_shot_plan_id IS NOT NULL AND approved_shot_plan_revision IS NOT NULL)
  );

ALTER TABLE storyboard_scenes
  ADD CONSTRAINT storyboard_scene_approved_shot_plan_revision_current
  CHECK (
    approved_shot_plan_revision IS NULL
    OR approved_shot_plan_revision = spec_revision
  );

-- ---------------------------------------------------------------------------
-- SHOT PLANS TABLE
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS shot_plans (
  shot_plan_id UUID PRIMARY KEY DEFAULT uuidv7(),
  scene_id UUID NOT NULL REFERENCES storyboard_scenes(scene_id) ON DELETE RESTRICT,
  spec_revision INT NOT NULL CHECK (spec_revision > 0),
  variant_ordinal INT NOT NULL CHECK (variant_ordinal > 0),
  status VARCHAR(32) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'superseded', 'rejected')),
  routing_mode VARCHAR(32) NOT NULL DEFAULT 'reference_directed'
    CHECK (routing_mode IN ('reference_directed', 'frame_anchored')),
  target_duration_ms INT NOT NULL CHECK (target_duration_ms > 0),
  target_frame_count INT NOT NULL CHECK (target_frame_count > 0),
  framing VARCHAR(64) NOT NULL,
  camera_angle VARCHAR(64) NOT NULL,
  camera_movement VARCHAR(64) NOT NULL,
  lighting_style VARCHAR(64) NOT NULL,
  previs_candidate_id UUID,
  structured_plan JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (scene_id, spec_revision, variant_ordinal),
  UNIQUE (shot_plan_id, scene_id, spec_revision),
  CONSTRAINT fk_shot_plan_previs_candidate
    FOREIGN KEY (previs_candidate_id, scene_id, spec_revision)
    REFERENCES storyboard_candidates(candidate_id, scene_id, scene_spec_revision)
    DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX IF NOT EXISTS idx_shot_plans_scene_revision
  ON shot_plans(scene_id, spec_revision, variant_ordinal);

-- ---------------------------------------------------------------------------
-- FOREIGN KEYS FROM STORYBOARD SCENES TO SHOT PLANS
-- ---------------------------------------------------------------------------

ALTER TABLE storyboard_scenes
  ADD CONSTRAINT fk_scene_selected_shot_plan_revision
  FOREIGN KEY (selected_shot_plan_id, scene_id, selected_shot_plan_revision)
  REFERENCES shot_plans(shot_plan_id, scene_id, spec_revision)
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE storyboard_scenes
  ADD CONSTRAINT fk_scene_approved_shot_plan_revision
  FOREIGN KEY (approved_shot_plan_id, scene_id, approved_shot_plan_revision)
  REFERENCES shot_plans(shot_plan_id, scene_id, spec_revision)
  DEFERRABLE INITIALLY IMMEDIATE;

-- ---------------------------------------------------------------------------
-- AUDIT ROLE PRIVILEGES
-- ---------------------------------------------------------------------------

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

    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON shot_plans TO %I', v_app_role);
    EXECUTE format('GRANT UPDATE ON storyboard_scenes TO %I', v_app_role);
  END IF;
END;
$$;
