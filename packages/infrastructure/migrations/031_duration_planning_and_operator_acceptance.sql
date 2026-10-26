-- 031_duration_planning_and_operator_acceptance.sql
-- Add campaign duration planning, bindings, deployment enablement state, and operator acceptance run lifecycle

-- 1. Campaigns columns for duration plan tracking
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS plan_revision INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS current_duration_plan_id UUID,
  ADD COLUMN IF NOT EXISTS selected_profile_key TEXT,
  ADD COLUMN IF NOT EXISTS allowed_duration_profile_keys JSONB;

-- 2. Campaign duration plans
CREATE TABLE IF NOT EXISTS campaign_duration_plans (
  plan_id UUID PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  predecessor_plan_id UUID,
  realm JSONB NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('production', 'staging')),
  requested_total_duration_ms INTEGER NOT NULL,
  scene_count_override INTEGER,
  selected_profile_key TEXT NOT NULL,
  allowed_duration_profile_keys JSONB NOT NULL,
  allocations JSONB NOT NULL,
  envelope JSONB NOT NULL,
  final_edit_policy TEXT NOT NULL DEFAULT 'preserve_generated_timeline',
  total_nominal_duration_ms INTEGER NOT NULL,
  exact_rational_total_duration_ms DOUBLE PRECISION NOT NULL,
  semantic_digest TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_campaign_plan_revision UNIQUE (campaign_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_campaign_duration_plans_campaign_id ON campaign_duration_plans(campaign_id);

-- 3. Scene duration bindings
CREATE TABLE IF NOT EXISTS scene_duration_bindings (
  binding_id UUID PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES campaign_duration_plans(plan_id) ON DELETE CASCADE,
  plan_revision INTEGER NOT NULL,
  allocation_id UUID NOT NULL,
  scene_id UUID NOT NULL,
  spec_revision INTEGER NOT NULL,
  ordinal INTEGER NOT NULL,
  binding_digest TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_scene_duration_bindings_plan_allocation UNIQUE (plan_id, allocation_id),
  CONSTRAINT uq_scene_duration_bindings_plan_scene UNIQUE (plan_id, scene_id),
  CONSTRAINT uq_scene_duration_bindings_plan_ordinal UNIQUE (plan_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_scene_duration_bindings_plan_id ON scene_duration_bindings(plan_id);
CREATE INDEX IF NOT EXISTS idx_scene_duration_bindings_scene_id ON scene_duration_bindings(scene_id);

-- 4. Deployment enablement state
CREATE TABLE IF NOT EXISTS deployment_enablement_state (
  deployment_id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL,
  digest TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Operator acceptance runs
CREATE TABLE IF NOT EXISTS operator_acceptance_runs (
  acceptance_run_id UUID PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  realm JSONB NOT NULL,
  evidence_origin TEXT NOT NULL,
  plan_id UUID NOT NULL,
  expected_total_duration_ms INTEGER NOT NULL,
  assembly_job_id TEXT,
  created_by TEXT NOT NULL,
  action_receipt_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operator_acceptance_runs_campaign_id ON operator_acceptance_runs(campaign_id);

-- 6. Acceptance run scenes
CREATE TABLE IF NOT EXISTS acceptance_run_scenes (
  acceptance_run_id UUID NOT NULL REFERENCES operator_acceptance_runs(acceptance_run_id) ON DELETE CASCADE,
  scene_id UUID NOT NULL,
  allocation_id UUID NOT NULL,
  spec_revision INTEGER NOT NULL,
  sequence_index INTEGER NOT NULL,
  profile_key TEXT NOT NULL,
  frames INTEGER NOT NULL,
  fps DOUBLE PRECISION NOT NULL,
  expected_duration_ms INTEGER NOT NULL,
  current_attempt_id UUID,
  current_attempt_ordinal INTEGER NOT NULL DEFAULT 1,
  accepted_attempt_id UUID,
  accepted_staging_job_id TEXT,
  accepted_attempt_ordinal INTEGER,
  PRIMARY KEY (acceptance_run_id, scene_id)
);

-- 7. Acceptance assembly jobs
CREATE TABLE IF NOT EXISTS acceptance_assembly_jobs (
  job_id UUID PRIMARY KEY,
  acceptance_run_id UUID NOT NULL REFERENCES operator_acceptance_runs(acceptance_run_id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  realm JSONB NOT NULL,
  evidence_origin TEXT NOT NULL,
  assembly_spec JSONB NOT NULL,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  worker_id TEXT,
  output_manifest_id UUID,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_acceptance_assembly_jobs_status ON acceptance_assembly_jobs(status);

-- 8. Acceptance assembly manifests
CREATE TABLE IF NOT EXISTS acceptance_assembly_manifests (
  manifest_id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES acceptance_assembly_jobs(job_id) ON DELETE CASCADE,
  acceptance_run_id UUID NOT NULL REFERENCES operator_acceptance_runs(acceptance_run_id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
  manifest JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_acceptance_assembly_manifests_job_id ON acceptance_assembly_manifests(job_id);
CREATE INDEX IF NOT EXISTS idx_acceptance_assembly_manifests_run_id ON acceptance_assembly_manifests(acceptance_run_id);

-- 9. Production attempts owner_kind and acceptance_run_id
ALTER TABLE production_attempts
  ADD COLUMN IF NOT EXISTS owner_kind TEXT,
  ADD COLUMN IF NOT EXISTS acceptance_run_id UUID;

-- 10. Replan action receipts for idempotency
CREATE TABLE IF NOT EXISTS replan_action_receipts (
  action_id TEXT NOT NULL,
  campaign_id UUID NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
  realm JSONB NOT NULL,
  request_hash TEXT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, action_id)
);

CREATE INDEX IF NOT EXISTS idx_replan_action_receipts_action_id ON replan_action_receipts(action_id);
