-- ---------------------------------------------------------------------------
-- REFERENCE ASSET LIBRARY ROLE
-- Issue #308 (304.4): Add libraryRole classification to reference_assets
-- ---------------------------------------------------------------------------

ALTER TABLE reference_assets
  ADD COLUMN IF NOT EXISTS library_role VARCHAR(64)
    CHECK (library_role IS NULL OR library_role IN ('subject_identity', 'product', 'location', 'style', 'composition'));

CREATE INDEX IF NOT EXISTS idx_reference_assets_client_library_role
  ON reference_assets(client_id, library_role)
  WHERE archived_at IS NULL;
