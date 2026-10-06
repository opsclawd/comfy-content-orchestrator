-- ---------------------------------------------------------------------------
-- CAMPAIGN REFERENCE BIBLES AND AUDIT CHANGES
-- Issue #397 (Slice 4): Campaign-level cast and location bible shared across scenes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS campaign_reference_bibles (
  campaign_id UUID NOT NULL REFERENCES campaigns(campaign_id) ON DELETE RESTRICT,
  reference_asset_id UUID NOT NULL REFERENCES reference_assets(asset_id) ON DELETE RESTRICT,
  role VARCHAR(32) NOT NULL CHECK (role IN ('subject_identity', 'location')),
  description TEXT NOT NULL CHECK (trim(description) != ''),
  bible_prompt_tag VARCHAR(32) NOT NULL CHECK (bible_prompt_tag ~ '^<Picture [1-9][0-9]*>$'),
  source_content_hash_sha256 VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, reference_asset_id),
  CONSTRAINT uq_campaign_reference_bibles_tag UNIQUE (campaign_id, bible_prompt_tag)
);

CREATE INDEX IF NOT EXISTS idx_campaign_reference_bibles_campaign
  ON campaign_reference_bibles(campaign_id);

CREATE TABLE IF NOT EXISTS campaign_reference_bible_changes (
  change_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(campaign_id) ON DELETE RESTRICT,
  reference_asset_id UUID NOT NULL REFERENCES reference_assets(asset_id) ON DELETE RESTRICT,
  old_role VARCHAR(32) CHECK (old_role IS NULL OR old_role IN ('subject_identity', 'location')),
  new_role VARCHAR(32) CHECK (new_role IS NULL OR new_role IN ('subject_identity', 'location')),
  old_description TEXT,
  new_description TEXT,
  old_bible_prompt_tag VARCHAR(32),
  new_bible_prompt_tag VARCHAR(32),
  old_source_content_hash_sha256 VARCHAR(64),
  new_source_content_hash_sha256 VARCHAR(64),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  change_reason TEXT NOT NULL,
  source_scene_id UUID NOT NULL REFERENCES storyboard_scenes(scene_id) ON DELETE RESTRICT,
  source_spec_revision INT NOT NULL,
  source_binding_id TEXT NOT NULL,
  actor_kind VARCHAR(64) NOT NULL,
  actor_id VARCHAR(128),
  CONSTRAINT chk_campaign_ref_bible_changes_diff CHECK (
    old_role IS DISTINCT FROM new_role OR
    old_description IS DISTINCT FROM new_description OR
    old_bible_prompt_tag IS DISTINCT FROM new_bible_prompt_tag OR
    old_source_content_hash_sha256 IS DISTINCT FROM new_source_content_hash_sha256
  )
);

CREATE INDEX IF NOT EXISTS idx_campaign_ref_bible_changes_lookup
  ON campaign_reference_bible_changes (campaign_id, reference_asset_id, changed_at);

CREATE INDEX IF NOT EXISTS idx_campaign_ref_bible_changes_scene
  ON campaign_reference_bible_changes (source_scene_id);

-- Append-only trigger protection
CREATE TRIGGER trg_campaign_reference_bible_changes_immutable
BEFORE UPDATE OR DELETE ON campaign_reference_bible_changes
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

-- Least privilege audit role grants & revokes
REVOKE UPDATE, DELETE ON campaign_reference_bible_changes FROM PUBLIC;

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

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_reference_bibles TO %I', v_app_role);
    EXECUTE format('GRANT SELECT, INSERT ON campaign_reference_bible_changes TO %I', v_app_role);
    EXECUTE format('REVOKE UPDATE, DELETE ON campaign_reference_bible_changes FROM %I', v_app_role);
  END IF;
END;
$$;
