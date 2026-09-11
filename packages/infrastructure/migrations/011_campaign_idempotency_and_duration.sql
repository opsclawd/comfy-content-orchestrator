-- ---------------------------------------------------------------------------
-- CAMPAIGN IDEMPOTENCY AND DURATION
-- Issue #219 (217-A): Durable creation/idempotency + scene-count admission contract
-- ---------------------------------------------------------------------------

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS target_total_duration_ms INTEGER,
  ADD COLUMN IF NOT EXISTS request_hash_sha256 TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_campaigns_idempotency_key'
  ) THEN
    ALTER TABLE campaigns
      ADD CONSTRAINT uq_campaigns_idempotency_key UNIQUE (idempotency_key);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_campaigns_target_total_duration_ms'
  ) THEN
    ALTER TABLE campaigns
      ADD CONSTRAINT chk_campaigns_target_total_duration_ms
        CHECK (target_total_duration_ms IS NULL OR target_total_duration_ms > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_campaigns_request_hash_sha256'
  ) THEN
    ALTER TABLE campaigns
      ADD CONSTRAINT chk_campaigns_request_hash_sha256
        CHECK (request_hash_sha256 IS NULL OR request_hash_sha256 ~ '^[0-9a-f]{64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_campaigns_operation_identity'
  ) THEN
    ALTER TABLE campaigns
      ADD CONSTRAINT chk_campaigns_operation_identity
        CHECK (
          (idempotency_key IS NULL AND target_total_duration_ms IS NULL AND request_hash_sha256 IS NULL) OR
          (idempotency_key IS NOT NULL AND target_total_duration_ms IS NOT NULL AND request_hash_sha256 IS NOT NULL)
        );
  END IF;
END $$;
