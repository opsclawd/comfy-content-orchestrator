-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------

CREATE TYPE license_status_enum AS ENUM (
  'approved',
  'restricted',
  'blocked',
  'review_required'
);

CREATE TYPE campaign_status_enum AS ENUM (
  'drafting',
  'pending_director_review',
  'partially_approved',
  'queued',
  'rendering',
  'qa',
  'completed',
  'failed',
  'cancelled'
);

CREATE TYPE scene_status_enum AS ENUM (
  'draft_pending',
  'generating_candidates',
  'director_review',
  'approved',
  'queued',
  'rendering',
  'qa',
  'completed',
  'failed',
  'cancelled'
);

CREATE TYPE job_status_enum AS ENUM (
  'queued',
  'leased',
  'rendering',
  'completed',
  'failed',
  'cancelled'
);

CREATE TYPE review_action_enum AS ENUM (
  'approve',
  'reject',
  'reroll',
  'prompt_edit',
  'reference_change',
  'engine_change',
  'duration_change',
  'lora_tune',
  'reorder',
  'duplicate',
  'cancel'
);

-- ---------------------------------------------------------------------------
-- LICENSE REGISTRY
-- ---------------------------------------------------------------------------

CREATE TABLE license_registry (
  component_key VARCHAR(128) PRIMARY KEY,
  component_type VARCHAR(32) NOT NULL,
  license_name VARCHAR(255) NOT NULL,
  license_version VARCHAR(128),
  license_date DATE,
  source_url TEXT NOT NULL,
  territory_policy JSONB NOT NULL DEFAULT '{}',
  revenue_threshold_usd NUMERIC(16, 2),
  attribution_requirements TEXT,
  output_distribution_restrictions TEXT,
  reviewed_at TIMESTAMP WITH TIME ZONE NOT NULL,
  approved_by VARCHAR(128) NOT NULL,
  status license_status_enum NOT NULL DEFAULT 'review_required',
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- CLIENTS & GOVERNANCE
-- ---------------------------------------------------------------------------

CREATE TABLE clients (
  client_id UUID PRIMARY KEY DEFAULT uuidv7(),
  company_name VARCHAR(255) NOT NULL,
  brand_bible_json JSONB NOT NULL DEFAULT '{}',
  default_aspect_ratio VARCHAR(16) NOT NULL DEFAULT '9:16',
  external_processing_policy JSONB NOT NULL DEFAULT '{
    "allowCloudPlanning": true,
    "allowCloudVisualQA": true,
    "allowCloudVoice": true,
    "allowedProviders": ["Anthropic", "OpenAI", "Google", "ElevenLabs"],
    "sensitiveDataMasking": true
  }',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMP WITH TIME ZONE
);

-- ---------------------------------------------------------------------------
-- REFERENCE ASSETS
-- ---------------------------------------------------------------------------

CREATE TABLE reference_assets (
  asset_id UUID PRIMARY KEY DEFAULT uuidv7(),
  client_id UUID NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  asset_type VARCHAR(64) NOT NULL,
  storage_bucket VARCHAR(128) NOT NULL,
  storage_object_key TEXT NOT NULL,
  content_hash_sha256 VARCHAR(64) NOT NULL,
  controlnet_type VARCHAR(64) NOT NULL DEFAULT 'none',
  default_strength NUMERIC(3, 2) NOT NULL DEFAULT 0.85
    CHECK (default_strength >= 0 AND default_strength <= 1),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMP WITH TIME ZONE,
  UNIQUE (storage_bucket, storage_object_key)
);

CREATE INDEX idx_reference_assets_client
  ON reference_assets(client_id, asset_type)
  WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- CAMPAIGNS
-- ---------------------------------------------------------------------------

CREATE TABLE campaigns (
  campaign_id UUID PRIMARY KEY DEFAULT uuidv7(),
  client_id UUID NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  title VARCHAR(255) NOT NULL,
  target_platform VARCHAR(64) NOT NULL DEFAULT 'instagram_reels',
  status campaign_status_enum NOT NULL DEFAULT 'drafting',
  total_scenes INT NOT NULL DEFAULT 1 CHECK (total_scenes > 0),
  approved_scenes INT NOT NULL DEFAULT 0 CHECK (approved_scenes >= 0),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_campaigns_client_status
  ON campaigns(client_id, status)
  WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- STORYBOARD SCENES
-- ---------------------------------------------------------------------------

CREATE TABLE storyboard_scenes (
  scene_id UUID PRIMARY KEY DEFAULT uuidv7(),
  campaign_id UUID NOT NULL REFERENCES campaigns(campaign_id) ON DELETE RESTRICT,
  scene_order INT NOT NULL CHECK (scene_order > 0),
  duration_seconds NUMERIC(6, 2) NOT NULL DEFAULT 5.00 CHECK (duration_seconds > 0),
  shot_type VARCHAR(64) NOT NULL,
  visual_description TEXT NOT NULL,
  voiceover_copy TEXT,
  audio_fx_prompt TEXT,
  engine_assigned VARCHAR(64) NOT NULL DEFAULT 'ltx_25',
  status scene_status_enum NOT NULL DEFAULT 'draft_pending',
  draft_storage_bucket VARCHAR(128),
  draft_storage_object_key TEXT,
  director_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT unique_campaign_scene_order UNIQUE (campaign_id, scene_order)
);

CREATE INDEX idx_storyboard_scenes_campaign
  ON storyboard_scenes(campaign_id, status)
  WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- SCENE REFERENCE ASSOCIATIONS
-- ---------------------------------------------------------------------------

CREATE TABLE scene_reference_assets (
  scene_id UUID NOT NULL REFERENCES storyboard_scenes(scene_id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES reference_assets(asset_id) ON DELETE RESTRICT,
  override_strength NUMERIC(3, 2)
    CHECK (override_strength IS NULL OR (override_strength >= 0 AND override_strength <= 1)),
  PRIMARY KEY (scene_id, asset_id)
);

-- ---------------------------------------------------------------------------
-- DURABLE RENDER QUEUE
-- ---------------------------------------------------------------------------

CREATE TABLE render_jobs (
  job_id UUID PRIMARY KEY DEFAULT uuidv7(),
  scene_id UUID NOT NULL REFERENCES storyboard_scenes(scene_id) ON DELETE RESTRICT,
  workflow_template VARCHAR(128) NOT NULL,
  injected_payload JSONB NOT NULL,
  status job_status_enum NOT NULL DEFAULT 'queued',
  worker_id VARCHAR(128),
  lease_expires_at TIMESTAMP WITH TIME ZONE,
  retry_count INT NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  max_retries INT NOT NULL DEFAULT 3 CHECK (max_retries >= 0),
  error_trace TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (retry_count <= max_retries)
);

CREATE INDEX idx_render_jobs_queue
  ON render_jobs(status, lease_expires_at)
  WHERE status IN ('queued', 'leased');

CREATE INDEX idx_render_jobs_scene
  ON render_jobs(scene_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- IMMUTABLE GENERATION MANIFESTS
-- Exactly one final manifest per successful render job.
-- ---------------------------------------------------------------------------

CREATE TABLE generation_manifests (
  manifest_id UUID PRIMARY KEY DEFAULT uuidv7(),
  job_id UUID NOT NULL UNIQUE REFERENCES render_jobs(job_id) ON DELETE RESTRICT,
  prompt_id_comfy VARCHAR(128) NOT NULL,
  campaign_id UUID NOT NULL REFERENCES campaigns(campaign_id) ON DELETE RESTRICT,
  scene_id UUID NOT NULL REFERENCES storyboard_scenes(scene_id) ON DELETE RESTRICT,
  render_attempt INT NOT NULL DEFAULT 1 CHECK (render_attempt > 0),
  manifest_payload JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_manifests_scene_attempt
  ON generation_manifests(scene_id, render_attempt);

-- ---------------------------------------------------------------------------
-- APPEND-ONLY DIRECTOR REVIEW EVENTS
-- ---------------------------------------------------------------------------

CREATE TABLE review_events (
  event_id UUID PRIMARY KEY DEFAULT uuidv7(),
  scene_id UUID NOT NULL REFERENCES storyboard_scenes(scene_id) ON DELETE RESTRICT,
  reviewer_name VARCHAR(128) NOT NULL DEFAULT 'Thomas Cumberbatch',
  action review_action_enum NOT NULL,
  director_notes TEXT,
  mutation_payload JSONB NOT NULL DEFAULT '{}',
  prior_scene_status scene_status_enum,
  resulting_scene_status scene_status_enum,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_review_events_scene
  ON review_events(scene_id, created_at DESC);
