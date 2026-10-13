-- ---------------------------------------------------------------------------
-- BEAT-INDEXED PREVIS DATA MODEL
-- Issue #389: Store one previs frame per ShotPlan beat
-- ---------------------------------------------------------------------------

-- 1. Extend storyboard_candidates with positive beat_index (defaulting to 1 for legacy compatibility)
ALTER TABLE storyboard_candidates
  ADD COLUMN IF NOT EXISTS beat_index INT NOT NULL DEFAULT 1 CHECK (beat_index > 0);

-- 2. Update candidate variant uniqueness to include beat_index
-- Drop legacy 3-column uniqueness constraint by constrained columns or generated name
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'storyboard_candidates'
      AND c.contype = 'u'
      AND (
        SELECT array_agg(a.attname::text ORDER BY k.ord)
        FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      ) = ARRAY['scene_id', 'scene_spec_revision', 'variant_ordinal']
  LOOP
    EXECUTE format('ALTER TABLE storyboard_candidates DROP CONSTRAINT %I', r.conname);
  END LOOP;
END;
$$;

ALTER TABLE storyboard_candidates
  DROP CONSTRAINT IF EXISTS storyboard_candidates_scene_id_scene_spec_revision_variant__key;

ALTER TABLE storyboard_candidates
  DROP CONSTRAINT IF EXISTS storyboard_candidates_scene_id_scene_spec_revision_variant_ord;

ALTER TABLE storyboard_candidates
  DROP CONSTRAINT IF EXISTS storyboard_candidates_scene_id_scene_spec_revision_variant_ordi;

ALTER TABLE storyboard_candidates
  DROP CONSTRAINT IF EXISTS storyboard_candidates_scene_id_scene_spec_revision_variant_ordinal_key;

ALTER TABLE storyboard_candidates
  ADD CONSTRAINT uq_storyboard_candidates_variant_beat
  UNIQUE (scene_id, scene_spec_revision, variant_ordinal, beat_index);

CREATE INDEX IF NOT EXISTS idx_storyboard_candidates_scene_revision_beat
  ON storyboard_candidates(scene_id, scene_spec_revision, variant_ordinal, beat_index);

-- 3. Normalized per-beat previs association table for ShotPlans
CREATE TABLE IF NOT EXISTS shot_plan_previs_associations (
  shot_plan_id UUID NOT NULL,
  beat_index INT NOT NULL CHECK (beat_index > 0),
  candidate_id UUID NOT NULL,
  scene_id UUID NOT NULL,
  spec_revision INT NOT NULL CHECK (spec_revision > 0),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (shot_plan_id, beat_index),
  CONSTRAINT fk_shot_plan_previs_associations_plan
    FOREIGN KEY (shot_plan_id, scene_id, spec_revision)
    REFERENCES shot_plans(shot_plan_id, scene_id, spec_revision)
    ON DELETE CASCADE
    DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT fk_shot_plan_previs_associations_candidate
    FOREIGN KEY (candidate_id, scene_id, spec_revision)
    REFERENCES storyboard_candidates(candidate_id, scene_id, scene_spec_revision)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX IF NOT EXISTS idx_shot_plan_previs_associations_candidate
  ON shot_plan_previs_associations(candidate_id);

CREATE INDEX IF NOT EXISTS idx_shot_plan_previs_associations_scene_revision
  ON shot_plan_previs_associations(scene_id, spec_revision);

-- 4. Backfill associations from existing scalar previs links (deterministic legacy beat 1)
INSERT INTO shot_plan_previs_associations (
  shot_plan_id,
  beat_index,
  candidate_id,
  scene_id,
  spec_revision,
  created_at,
  updated_at
)
SELECT
  sp.shot_plan_id,
  1 AS beat_index,
  sp.previs_candidate_id,
  sp.scene_id,
  sp.spec_revision,
  sp.updated_at,
  sp.updated_at
FROM shot_plans sp
WHERE sp.previs_candidate_id IS NOT NULL
ON CONFLICT (shot_plan_id, beat_index) DO NOTHING;

-- 5. Application role privileges
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

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON shot_plan_previs_associations TO %I', v_app_role);
  END IF;
END;
$$;
