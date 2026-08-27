CREATE TYPE job_kind_enum AS ENUM ('candidate', 'production');

ALTER TABLE render_jobs
  ADD COLUMN job_kind job_kind_enum NOT NULL DEFAULT 'production',
  ADD COLUMN lease_token UUID;

DROP INDEX idx_render_jobs_queue;
CREATE INDEX idx_render_jobs_queue
  ON render_jobs (status, lease_expires_at, created_at)
  WHERE status IN ('queued', 'leased', 'rendering');
