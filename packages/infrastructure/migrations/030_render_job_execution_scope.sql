ALTER TABLE render_jobs
  ADD COLUMN execution_scope VARCHAR(32) NOT NULL DEFAULT 'production',
  ADD COLUMN staging_operation_id VARCHAR(128);

ALTER TABLE render_jobs
  ADD CONSTRAINT render_jobs_execution_scope_check
  CHECK (execution_scope IN ('production', 'staging'));

CREATE UNIQUE INDEX idx_render_jobs_staging_op_id
  ON render_jobs (staging_operation_id)
  WHERE staging_operation_id IS NOT NULL;

CREATE INDEX idx_render_jobs_queue_scope
  ON render_jobs (status, execution_scope, lease_expires_at, created_at)
  WHERE status IN ('queued', 'leased', 'rendering');
