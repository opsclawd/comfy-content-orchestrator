-- ---------------------------------------------------------------------------
-- STORYBOARD COMPLETION PROOF
-- Issue #247 (217-D): Harden orchestration idempotency + committed storyboard admission identity
-- ---------------------------------------------------------------------------

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS storyboard_completion_hash_sha256 TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_campaigns_storyboard_completion_hash_sha256'
  ) THEN
    ALTER TABLE campaigns
      ADD CONSTRAINT chk_campaigns_storyboard_completion_hash_sha256
        CHECK (storyboard_completion_hash_sha256 IS NULL OR storyboard_completion_hash_sha256 ~ '^[0-9a-f]{64}$');
  END IF;
END $$;
