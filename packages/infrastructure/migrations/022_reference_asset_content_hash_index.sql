-- ---------------------------------------------------------------------------
-- REFERENCE ASSET CONTENT HASH INDEX
-- Issue #394: Index for reference asset lookup by content hash
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_reference_assets_content_hash
  ON reference_assets(content_hash_sha256);
