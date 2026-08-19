-- ---------------------------------------------------------------------------
-- DROP OVER-SPECIFIED UNIQUE CONSTRAINT ON review_events.request_hash_sha256
-- ---------------------------------------------------------------------------
--
-- The constraint uq_review_events_request_hash (scene_id, action, request_hash_sha256)
-- is over-specified: it forbids the same command content from being issued twice
-- across *different* events, even when both have distinct action IDs.
--
-- Re-selecting a candidate at the same specRevision is a legitimate director
-- action that produces an identical hash. The true idempotency key is event_id
-- (UUID PRIMARY KEY). Content-mismatch detection (same action ID, different
-- payload) is handled by prepareReviewExecution in the application layer.
--
-- This migration removes the constraint so same-revision re-selections succeed.
-- ---------------------------------------------------------------------------

ALTER TABLE review_events DROP CONSTRAINT IF EXISTS uq_review_events_request_hash;
