-- ---------------------------------------------------------------------------
-- CAMPAIGN PRODUCTION RUN REVIEW STATE
-- Issue #262: Stop auto-assembly on render completion and expose production-review media
-- ---------------------------------------------------------------------------

ALTER TYPE run_status_enum ADD VALUE 'production_review' AFTER 'dispatched';
