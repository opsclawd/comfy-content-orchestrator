-- ---------------------------------------------------------------------------
-- REVIEW EVENTS IDEMPOTENCY & CONCURRENCY AUDIT COLUMNS
-- ---------------------------------------------------------------------------

ALTER TABLE review_events
  ADD COLUMN IF NOT EXISTS expected_spec_revision INT
    CHECK (expected_spec_revision > 0),
  ADD COLUMN IF NOT EXISTS resulting_spec_revision INT
    CHECK (resulting_spec_revision > 0),
  ADD COLUMN IF NOT EXISTS request_hash_sha256 VARCHAR(64);

ALTER TABLE review_events
  ADD CONSTRAINT uq_review_events_request_hash
  UNIQUE (scene_id, action, request_hash_sha256);
