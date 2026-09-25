-- ---------------------------------------------------------------------------
-- REFERENCE ASSET HARDENING, GROUPS, ROLES & SCENE BINDINGS
-- Issue #306 (304.2): Harden ReferenceAsset contracts, grouping, roles, and scene bindings
-- ---------------------------------------------------------------------------

-- 1. Reference Groups Table
CREATE TABLE IF NOT EXISTS reference_groups (
  group_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  campaign_id UUID REFERENCES campaigns(campaign_id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reference_groups_client
  ON reference_groups(client_id)
  WHERE archived_at IS NULL;

-- 2. Harden reference_assets
ALTER TABLE reference_assets
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES reference_groups(group_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS width INT,
  ADD COLUMN IF NOT EXISTS height INT,
  ADD COLUMN IF NOT EXISTS mime_type VARCHAR(64) DEFAULT 'image/png',
  ADD COLUMN IF NOT EXISTS display_name VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_reference_assets_group
  ON reference_assets(group_id)
  WHERE archived_at IS NULL;

-- 3. Harden scene_reference_assets for revisioned role bindings
ALTER TABLE scene_reference_assets
  ADD COLUMN IF NOT EXISTS spec_revision INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS role VARCHAR(64) NOT NULL DEFAULT 'style'
    CHECK (role IN ('subject_identity', 'product', 'location', 'style', 'composition')),
  ADD COLUMN IF NOT EXISTS weight NUMERIC(3, 2)
    CHECK (weight IS NULL OR (weight >= 0 AND weight <= 1)),
  ADD COLUMN IF NOT EXISTS hints JSONB,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Backfill weight from existing override_strength
UPDATE scene_reference_assets
  SET weight = override_strength
  WHERE weight IS NULL AND override_strength IS NOT NULL;

-- Update primary key from (scene_id, asset_id) to (scene_id, spec_revision, asset_id, role)
ALTER TABLE scene_reference_assets DROP CONSTRAINT IF EXISTS scene_reference_assets_pkey;
ALTER TABLE scene_reference_assets
  ADD PRIMARY KEY (scene_id, spec_revision, asset_id, role);

CREATE INDEX IF NOT EXISTS idx_scene_reference_assets_scene_rev
  ON scene_reference_assets(scene_id, spec_revision)
  WHERE archived_at IS NULL;

-- 4. Role Grants
DO $$
DECLARE
  v_app_role text := nullif(trim(current_setting('orchestrator.app_role', true)), '');
  v_role_exists boolean;
BEGIN
  IF v_app_role IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_app_role) INTO v_role_exists;
    IF NOT v_role_exists THEN
      RAISE EXCEPTION 'Configured application role % does not exist in pg_roles', v_app_role;
    END IF;

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON reference_groups TO %I', v_app_role);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON reference_assets TO %I', v_app_role);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON scene_reference_assets TO %I', v_app_role);
  END IF;
END;
$$;
