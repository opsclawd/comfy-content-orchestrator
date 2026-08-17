-- ---------------------------------------------------------------------------
-- REVIEW ACTION ENUM ADDITION
-- ---------------------------------------------------------------------------

ALTER TYPE review_action_enum ADD VALUE 'candidate_select';

-- ---------------------------------------------------------------------------
-- STORYBOARD SCENES CANDIDATE SELECTION
-- ---------------------------------------------------------------------------

ALTER TABLE storyboard_scenes
  ADD COLUMN IF NOT EXISTS spec_revision INT NOT NULL DEFAULT 1
    CHECK (spec_revision > 0),
  ADD COLUMN IF NOT EXISTS selected_candidate_id UUID,
  ADD COLUMN IF NOT EXISTS selected_candidate_revision INT;

ALTER TABLE storyboard_scenes
  ADD CONSTRAINT storyboard_scene_candidate_selection_pair
  CHECK (
    (selected_candidate_id IS NULL AND selected_candidate_revision IS NULL)
    OR
    (selected_candidate_id IS NOT NULL AND selected_candidate_revision IS NOT NULL)
  );

ALTER TABLE storyboard_scenes
  ADD CONSTRAINT storyboard_scene_selected_revision_current
  CHECK (
    selected_candidate_revision IS NULL
    OR selected_candidate_revision = spec_revision
  );

-- ---------------------------------------------------------------------------
-- STORYBOARD CANDIDATES TABLE & AUDIT PROTECTIONS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS storyboard_candidates (
  candidate_id UUID PRIMARY KEY DEFAULT uuidv7(),
  scene_id UUID NOT NULL REFERENCES storyboard_scenes(scene_id) ON DELETE RESTRICT,
  scene_spec_revision INT NOT NULL CHECK (scene_spec_revision > 0),
  variant_ordinal INT NOT NULL CHECK (variant_ordinal > 0),
  storage_bucket VARCHAR(128) NOT NULL,
  storage_object_key TEXT NOT NULL,
  content_hash_sha256 VARCHAR(64) NOT NULL,
  generation_payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (scene_id, scene_spec_revision, variant_ordinal),
  UNIQUE (storage_bucket, storage_object_key),
  UNIQUE (candidate_id, scene_id, scene_spec_revision)
);

CREATE INDEX IF NOT EXISTS idx_storyboard_candidates_scene_revision
  ON storyboard_candidates(scene_id, scene_spec_revision, variant_ordinal);

ALTER TABLE storyboard_scenes
  ADD CONSTRAINT fk_scene_selected_candidate_revision
  FOREIGN KEY (selected_candidate_id, scene_id, selected_candidate_revision)
  REFERENCES storyboard_candidates(candidate_id, scene_id, scene_spec_revision)
  DEFERRABLE INITIALLY IMMEDIATE;

CREATE TRIGGER trg_storyboard_candidates_immutable
BEFORE UPDATE OR DELETE ON storyboard_candidates
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

-- ---------------------------------------------------------------------------
-- AUDIT ROLE PRIVILEGES FOR CANDIDATES
-- ---------------------------------------------------------------------------

REVOKE UPDATE, DELETE ON storyboard_candidates FROM PUBLIC;

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

    EXECUTE format('GRANT SELECT, INSERT ON storyboard_candidates TO %I', v_app_role);
    EXECUTE format('REVOKE UPDATE, DELETE ON storyboard_candidates FROM %I', v_app_role);

    IF has_table_privilege(v_app_role, 'storyboard_candidates', 'UPDATE') OR
       has_table_privilege(v_app_role, 'storyboard_candidates', 'DELETE') THEN
      RAISE EXCEPTION 'Application role % still has effective UPDATE or DELETE privilege on storyboard_candidates', v_app_role;
    END IF;
  END IF;
END;
$$;
