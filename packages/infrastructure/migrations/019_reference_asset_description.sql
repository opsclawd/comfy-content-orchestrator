-- ---------------------------------------------------------------------------
-- REFERENCE ASSET DESCRIPTION
-- Issue #309 (304.5): Add optional nullable description to reference_assets
-- ---------------------------------------------------------------------------

ALTER TABLE reference_assets
  ADD COLUMN IF NOT EXISTS description TEXT;
