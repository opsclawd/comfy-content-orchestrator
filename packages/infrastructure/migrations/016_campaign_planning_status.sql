-- ---------------------------------------------------------------------------
-- CAMPAIGN PLANNING STATUS
-- Issue #286: Decouple storyboard planning into asynchronous job with 202 Accepted
-- ---------------------------------------------------------------------------

ALTER TYPE campaign_status_enum ADD VALUE IF NOT EXISTS 'planning' BEFORE 'drafting';
