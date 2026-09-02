CREATE TABLE delivery_assembly_jobs (
  job_id UUID PRIMARY KEY DEFAULT uuidv7(),
  campaign_id UUID NOT NULL REFERENCES campaigns(campaign_id) ON DELETE RESTRICT,
  assembly_spec JSONB NOT NULL,
  status job_status_enum NOT NULL DEFAULT 'queued',
  worker_id VARCHAR(128),
  lease_token UUID,
  lease_expires_at TIMESTAMP WITH TIME ZONE,
  retry_count INT NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  max_retries INT NOT NULL DEFAULT 3 CHECK (max_retries >= 0),
  error_trace TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (retry_count <= max_retries),
  CONSTRAINT check_delivery_assembly_campaign_match CHECK (assembly_spec->>'campaignId' = campaign_id::text)
);

CREATE INDEX idx_delivery_assembly_jobs_queue
  ON delivery_assembly_jobs (status, lease_expires_at, created_at)
  WHERE status IN ('queued', 'leased', 'rendering');

CREATE INDEX idx_delivery_assembly_jobs_campaign
  ON delivery_assembly_jobs (campaign_id, created_at DESC);

DO $$
DECLARE
  v_app_role text := nullif(trim(current_setting('orchestrator.app_role', true)), '');
  v_role_exists boolean;
BEGIN
  IF v_app_role IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname = v_app_role
    ) INTO v_role_exists;

    IF NOT v_role_exists THEN
      RAISE EXCEPTION 'Configured application role % does not exist in pg_roles', v_app_role;
    END IF;

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON delivery_assembly_jobs TO %I', v_app_role);
  END IF;
END;
$$;
