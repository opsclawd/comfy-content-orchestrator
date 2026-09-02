import type { PoolClient } from "pg";

export interface LicenseRecordInput {
  componentKey?: string;
  componentType?: string;
  licenseName?: string;
  licenseVersion?: string | null;
  licenseDate?: string | null;
  sourceUrl?: string;
  territoryPolicy?: Record<string, unknown>;
  revenueThresholdUsd?: number | null;
  attributionRequirements?: string | null;
  outputDistributionRestrictions?: string | null;
  reviewedAt?: Date | string;
  approvedBy?: string;
  status?: "approved" | "restricted" | "blocked" | "review_required";
}

export interface ClientRecordInput {
  companyName?: string;
  brandBibleJson?: Record<string, unknown>;
  defaultAspectRatio?: string;
  externalProcessingPolicy?: Record<string, unknown>;
}

export interface ReferenceAssetRecordInput {
  clientId: string;
  assetType?: string;
  storageBucket?: string;
  storageObjectKey?: string;
  contentHashSha256?: string;
  controlnetType?: string;
  defaultStrength?: number;
}

export interface CampaignRecordInput {
  clientId: string;
  title?: string;
  targetPlatform?: string;
  status?: string;
  totalScenes?: number;
  approvedScenes?: number;
}

export interface StoryboardSceneRecordInput {
  campaignId: string;
  sceneOrder?: number;
  durationSeconds?: number;
  shotType?: string;
  visualDescription?: string;
  voiceoverCopy?: string | null;
  audioFxPrompt?: string | null;
  engineAssigned?: string;
  status?: string;
  specRevision?: number;
  draftStorageBucket?: string | null;
  draftStorageObjectKey?: string | null;
  directorNotes?: string | null;
  selectedCandidateId?: string | null;
  selectedCandidateRevision?: number | null;
  loraConfigurationId?: string | null;
  approvedBy?: string | null;
  approvedAt?: Date | string | null;
  approvedRevision?: number | null;
  failedFrom?: string | null;
}

export interface SceneReferenceAssetRecordInput {
  sceneId: string;
  assetId: string;
  overrideStrength?: number | null;
}

export interface RenderJobRecordInput {
  sceneId: string;
  jobKind?: string;
  leaseToken?: string | null;
  workflowTemplate?: string;
  injectedPayload?: Record<string, unknown>;
  status?: string;
  workerId?: string | null;
  leaseExpiresAt?: Date | string | null;
  retryCount?: number;
  maxRetries?: number;
  errorTrace?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface DeliveryAssemblyJobRecordInput {
  campaignId: string;
  assemblySpec?: Record<string, unknown>;
  status?: string;
  workerId?: string | null;
  leaseToken?: string | null;
  leaseExpiresAt?: Date | string | null;
  retryCount?: number;
  maxRetries?: number;
  errorTrace?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface GenerationManifestRecordInput {
  jobId: string;
  promptIdComfy?: string;
  campaignId: string;
  sceneId: string;
  renderAttempt?: number;
  manifestPayload?: Record<string, unknown>;
}

export interface ReviewEventRecordInput {
  sceneId: string;
  reviewerName?: string;
  action?: string;
  directorNotes?: string | null;
  mutationPayload?: Record<string, unknown>;
  priorSceneStatus?: string | null;
  resultingSceneStatus?: string | null;
  expectedSpecRevision?: number | null;
  resultingSpecRevision?: number | null;
  requestHashSha256?: string | null;
}

export interface InsertedLicenseRecord {
  component_key: string;
  component_type: string;
  license_name: string;
  license_version: string | null;
  license_date: string | null;
  source_url: string;
  territory_policy: Record<string, unknown>;
  revenue_threshold_usd: string | null;
  attribution_requirements: string | null;
  output_distribution_restrictions: string | null;
  reviewed_at: Date;
  approved_by: string;
  status: string;
  updated_at: Date;
}

export interface InsertedClientRecord {
  client_id: string;
  company_name: string;
  brand_bible_json: Record<string, unknown>;
  default_aspect_ratio: string;
  external_processing_policy: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

export interface InsertedReferenceAssetRecord {
  asset_id: string;
  client_id: string;
  asset_type: string;
  storage_bucket: string;
  storage_object_key: string;
  content_hash_sha256: string;
  controlnet_type: string;
  default_strength: string;
  created_at: Date;
  archived_at: Date | null;
}

export interface InsertedCampaignRecord {
  campaign_id: string;
  client_id: string;
  title: string;
  target_platform: string;
  status: string;
  total_scenes: number;
  approved_scenes: number;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

export interface InsertedStoryboardSceneRecord {
  scene_id: string;
  campaign_id: string;
  scene_order: number;
  duration_seconds: string;
  shot_type: string;
  visual_description: string;
  voiceover_copy: string | null;
  audio_fx_prompt: string | null;
  engine_assigned: string;
  status: string;
  spec_revision: number;
  draft_storage_bucket: string | null;
  draft_storage_object_key: string | null;
  director_notes: string | null;
  selected_candidate_id: string | null;
  selected_candidate_revision: number | null;
  lora_configuration_id: string | null;
  approved_by: string | null;
  approved_at: Date | null;
  approved_revision: number | null;
  failed_from: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

export interface InsertedSceneReferenceAssetRecord {
  scene_id: string;
  asset_id: string;
  override_strength: string | null;
}

export interface InsertedRenderJobRecord {
  job_id: string;
  scene_id: string;
  job_kind: string;
  workflow_template: string;
  injected_payload: Record<string, unknown>;
  status: string;
  worker_id: string | null;
  lease_token: string | null;
  lease_expires_at: Date | null;
  retry_count: number;
  max_retries: number;
  error_trace: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface InsertedDeliveryAssemblyJobRecord {
  job_id: string;
  campaign_id: string;
  assembly_spec: Record<string, unknown>;
  status: string;
  worker_id: string | null;
  lease_token: string | null;
  lease_expires_at: Date | null;
  retry_count: number;
  max_retries: number;
  error_trace: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface InsertedGenerationManifestRecord {
  manifest_id: string;
  job_id: string;
  prompt_id_comfy: string;
  campaign_id: string;
  scene_id: string;
  render_attempt: number;
  manifest_payload: Record<string, unknown>;
  created_at: Date;
}

export interface InsertedReviewEventRecord {
  event_id: string;
  scene_id: string;
  reviewer_name: string;
  action: string;
  director_notes: string | null;
  mutation_payload: Record<string, unknown>;
  prior_scene_status: string | null;
  resulting_scene_status: string | null;
  expected_spec_revision: number | null;
  resulting_spec_revision: number | null;
  request_hash_sha256: string | null;
  created_at: Date;
}

export interface RepresentativeGraph {
  license: InsertedLicenseRecord;
  client: InsertedClientRecord;
  referenceAsset: InsertedReferenceAssetRecord;
  campaign: InsertedCampaignRecord;
  scene: InsertedStoryboardSceneRecord;
  sceneReferenceAsset: InsertedSceneReferenceAssetRecord;
  renderJob: InsertedRenderJobRecord;
  manifest: InsertedGenerationManifestRecord;
  storyboardCandidate: InsertedStoryboardCandidateRecord;
  reviewEvent: InsertedReviewEventRecord;
}

export async function insertLicenseRecord(
  client: PoolClient,
  input?: LicenseRecordInput
): Promise<InsertedLicenseRecord> {
  const componentKey = input?.componentKey ?? "ltx-2.5-distilled";
  const componentType = input?.componentType ?? "model";
  const licenseName = input?.licenseName ?? "LTX-2 Community License";
  const licenseVersion = input?.licenseVersion !== undefined ? input.licenseVersion : "2.0";
  const licenseDate = input?.licenseDate !== undefined ? input.licenseDate : "2026-01-05";
  const sourceUrl = input?.sourceUrl ?? "https://huggingface.co/Lightricks/LTX-Video";
  const territoryPolicy = input?.territoryPolicy ?? { allowGlobal: true };
  const revenueThresholdUsd =
    input?.revenueThresholdUsd !== undefined ? input.revenueThresholdUsd : null;
  const attributionRequirements =
    input?.attributionRequirements !== undefined
      ? input.attributionRequirements
      : "Attribution to Lightricks";
  const outputDistributionRestrictions =
    input?.outputDistributionRestrictions !== undefined
      ? input.outputDistributionRestrictions
      : null;
  const reviewedAt = input?.reviewedAt ?? new Date();
  const approvedBy = input?.approvedBy ?? "Thomas Cumberbatch";
  const status = input?.status ?? "approved";

  const res = await client.query<InsertedLicenseRecord>(
    `
    INSERT INTO license_registry (
      component_key,
      component_type,
      license_name,
      license_version,
      license_date,
      source_url,
      territory_policy,
      revenue_threshold_usd,
      attribution_requirements,
      output_distribution_restrictions,
      reviewed_at,
      approved_by,
      status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *
    `,
    [
      componentKey,
      componentType,
      licenseName,
      licenseVersion,
      licenseDate,
      sourceUrl,
      JSON.stringify(territoryPolicy),
      revenueThresholdUsd,
      attributionRequirements,
      outputDistributionRestrictions,
      reviewedAt,
      approvedBy,
      status
    ]
  );

  const row = res.rows[0];
  if (!row) {
    throw new Error("Failed to insert license record");
  }
  return row;
}

export async function insertClientRecord(
  client: PoolClient,
  input?: ClientRecordInput
): Promise<InsertedClientRecord> {
  const companyName = input?.companyName ?? "Godzspeed Communications Inc.";
  const brandBibleJson = input?.brandBibleJson ?? {
    palette: ["#FF5722", "#212121"],
    tagline: "Authentic Caribbean Creativity"
  };
  const defaultAspectRatio = input?.defaultAspectRatio ?? "9:16";
  const externalProcessingPolicy = input?.externalProcessingPolicy ?? {
    allowCloudPlanning: true,
    allowCloudVisualQA: true,
    allowCloudVoice: true,
    allowedProviders: ["Anthropic", "OpenAI", "Google", "ElevenLabs"],
    sensitiveDataMasking: true
  };

  const res = await client.query<InsertedClientRecord>(
    `
    INSERT INTO clients (
      company_name,
      brand_bible_json,
      default_aspect_ratio,
      external_processing_policy
    ) VALUES ($1, $2, $3, $4)
    RETURNING *
    `,
    [
      companyName,
      JSON.stringify(brandBibleJson),
      defaultAspectRatio,
      JSON.stringify(externalProcessingPolicy)
    ]
  );

  const row = res.rows[0];
  if (!row) {
    throw new Error("Failed to insert client record");
  }
  return row;
}

export async function insertReferenceAssetRecord(
  client: PoolClient,
  input: ReferenceAssetRecordInput
): Promise<InsertedReferenceAssetRecord> {
  const clientId = input.clientId;
  const assetType = input.assetType ?? "style_lora";
  const storageBucket = input.storageBucket ?? "godzspeed-reference";
  const storageObjectKey = input.storageObjectKey ?? `assets/${clientId}/reference_01.png`;
  const contentHashSha256 =
    input.contentHashSha256 ?? "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const controlnetType = input.controlnetType ?? "depth";
  const defaultStrength = input.defaultStrength ?? 0.85;

  const res = await client.query<InsertedReferenceAssetRecord>(
    `
    INSERT INTO reference_assets (
      client_id,
      asset_type,
      storage_bucket,
      storage_object_key,
      content_hash_sha256,
      controlnet_type,
      default_strength
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
    `,
    [
      clientId,
      assetType,
      storageBucket,
      storageObjectKey,
      contentHashSha256,
      controlnetType,
      defaultStrength
    ]
  );

  const row = res.rows[0];
  if (!row) {
    throw new Error("Failed to insert reference asset record");
  }
  return row;
}

export async function insertCampaignRecord(
  client: PoolClient,
  input: CampaignRecordInput
): Promise<InsertedCampaignRecord> {
  const clientId = input.clientId;
  const title = input.title ?? "Carnival Season 2026";
  const targetPlatform = input.targetPlatform ?? "instagram_reels";
  const status = input.status ?? "drafting";
  const totalScenes = input.totalScenes ?? 6;
  const approvedScenes = input.approvedScenes ?? 0;

  const res = await client.query<InsertedCampaignRecord>(
    `
    INSERT INTO campaigns (
      client_id,
      title,
      targetPlatform,
      status,
      total_scenes,
      approved_scenes
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
    `.replace("targetPlatform", "target_platform"),
    [clientId, title, targetPlatform, status, totalScenes, approvedScenes]
  );

  const row = res.rows[0];
  if (!row) {
    throw new Error("Failed to insert campaign record");
  }
  return row;
}

export async function insertStoryboardSceneRecord(
  client: PoolClient,
  input: StoryboardSceneRecordInput
): Promise<InsertedStoryboardSceneRecord> {
  const campaignId = input.campaignId;
  const sceneOrder = input.sceneOrder ?? 1;
  const durationSeconds = input.durationSeconds ?? 5.0;
  const shotType = input.shotType ?? "wide_establishing";
  const visualDescription =
    input.visualDescription ??
    "Vibrant Port of Spain street scene at dawn with steelpan players preparing instruments.";
  const voiceoverCopy =
    input.voiceoverCopy !== undefined ? input.voiceoverCopy : "The rhythm begins.";
  const audioFxPrompt =
    input.audioFxPrompt !== undefined
      ? input.audioFxPrompt
      : "Distant steelpan resonance, gentle breeze";
  const engineAssigned = input.engineAssigned ?? "ltx_25";
  const status = input.status ?? "draft_pending";
  const specRevision = input.specRevision !== undefined ? input.specRevision : 1;
  const draftStorageBucket =
    input.draftStorageBucket !== undefined ? input.draftStorageBucket : "godzspeed-temp";
  const draftStorageObjectKey =
    input.draftStorageObjectKey !== undefined
      ? input.draftStorageObjectKey
      : `drafts/${campaignId}/scene_01.webp`;
  const directorNotes =
    input.directorNotes !== undefined
      ? input.directorNotes
      : "Ensure sunrise warm highlights on the steelpan rim.";
  const selectedCandidateId =
    input.selectedCandidateId !== undefined ? input.selectedCandidateId : null;
  const selectedCandidateRevision =
    input.selectedCandidateRevision !== undefined ? input.selectedCandidateRevision : null;
  const loraConfigurationId =
    input.loraConfigurationId !== undefined ? input.loraConfigurationId : null;
  const approvedBy = input.approvedBy !== undefined ? input.approvedBy : null;
  const approvedAt = input.approvedAt !== undefined ? input.approvedAt : null;
  const approvedRevision = input.approvedRevision !== undefined ? input.approvedRevision : null;
  const failedFrom = input.failedFrom !== undefined ? input.failedFrom : null;

  const res = await client.query<InsertedStoryboardSceneRecord>(
    `
    INSERT INTO storyboard_scenes (
      campaign_id,
      scene_order,
      duration_seconds,
      shot_type,
      visual_description,
      voiceover_copy,
      audio_fx_prompt,
      engine_assigned,
      status,
      spec_revision,
      draft_storage_bucket,
      draft_storage_object_key,
      director_notes,
      selected_candidate_id,
      selected_candidate_revision,
      lora_configuration_id,
      approved_by,
      approved_at,
      approved_revision,
      failed_from
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
    RETURNING *
    `,
    [
      campaignId,
      sceneOrder,
      durationSeconds,
      shotType,
      visualDescription,
      voiceoverCopy,
      audioFxPrompt,
      engineAssigned,
      status,
      specRevision,
      draftStorageBucket,
      draftStorageObjectKey,
      directorNotes,
      selectedCandidateId,
      selectedCandidateRevision,
      loraConfigurationId,
      approvedBy,
      approvedAt,
      approvedRevision,
      failedFrom
    ]
  );

  const row = res.rows[0];
  if (!row) {
    throw new Error("Failed to insert storyboard scene record");
  }
  return row;
}

export async function insertSceneReferenceAssetRecord(
  client: PoolClient,
  input: SceneReferenceAssetRecordInput
): Promise<InsertedSceneReferenceAssetRecord> {
  const sceneId = input.sceneId;
  const assetId = input.assetId;
  const overrideStrength = input.overrideStrength !== undefined ? input.overrideStrength : null;

  const res = await client.query<InsertedSceneReferenceAssetRecord>(
    `
    INSERT INTO scene_reference_assets (
      scene_id,
      asset_id,
      override_strength
    ) VALUES ($1, $2, $3)
    RETURNING *
    `,
    [sceneId, assetId, overrideStrength]
  );

  const row = res.rows[0];
  if (!row) {
    throw new Error("Failed to insert scene reference asset record");
  }
  return row;
}

export async function insertRenderJobRecord(
  client: PoolClient,
  input: RenderJobRecordInput
): Promise<InsertedRenderJobRecord> {
  const sceneId = input.sceneId;
  const jobKind = input.jobKind ?? "production";
  const workflowTemplate = input.workflowTemplate ?? "ltx_25_720p_distilled_v1.json";
  const injectedPayload = input.injectedPayload ?? {
    seed: 42,
    steps: 8,
    cfg: 3.0,
    frames: 97
  };
  const status = input.status ?? "queued";
  const workerId = input.workerId !== undefined ? input.workerId : "render-worker-trinidad-01";
  const leaseToken = input.leaseToken !== undefined ? input.leaseToken : null;
  const leaseExpiresAt = input.leaseExpiresAt !== undefined ? input.leaseExpiresAt : null;
  const retryCount = input.retryCount ?? 0;
  const maxRetries = input.maxRetries ?? 3;
  const errorTrace = input.errorTrace !== undefined ? input.errorTrace : null;
  const createdAt = input.createdAt !== undefined ? input.createdAt : null;
  const updatedAt = input.updatedAt !== undefined ? input.updatedAt : null;

  const res = await client.query<InsertedRenderJobRecord>(
    `
    INSERT INTO render_jobs (
      scene_id,
      job_kind,
      workflow_template,
      injected_payload,
      status,
      worker_id,
      lease_token,
      lease_expires_at,
      retry_count,
      max_retries,
      error_trace,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, CURRENT_TIMESTAMP), COALESCE($13, CURRENT_TIMESTAMP))
    RETURNING *
    `,
    [
      sceneId,
      jobKind,
      workflowTemplate,
      JSON.stringify(injectedPayload),
      status,
      workerId,
      leaseToken,
      leaseExpiresAt,
      retryCount,
      maxRetries,
      errorTrace,
      createdAt,
      updatedAt
    ]
  );

  const row = res.rows[0];
  if (!row) {
    throw new Error("Failed to insert render job record");
  }
  return row;
}

export async function insertDeliveryAssemblyJobRecord(
  client: PoolClient,
  input: DeliveryAssemblyJobRecordInput
): Promise<InsertedDeliveryAssemblyJobRecord> {
  const campaignId = input.campaignId;
  const assemblySpec = input.assemblySpec ?? {
    campaignId,
    assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
    expectedTotalDurationMs: 5000,
    videoStems: [
      {
        order: 0,
        sceneId: "01950c46-9e90-7d3d-82d2-8f1d3c000001",
        generationManifestId: "01950c46-9e90-7d3d-82d2-8f1d3c000002",
        expectedDurationMs: 5000,
        media: {
          bucket: "godzspeed-delivery",
          key: `campaigns/${campaignId}/scenes/scene-1/output.mp4`,
          sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          contentType: "video/mp4"
        }
      }
    ]
  };
  const status = input.status ?? "queued";
  const workerId = input.workerId !== undefined ? input.workerId : "delivery-assembler-01";
  const leaseToken = input.leaseToken !== undefined ? input.leaseToken : null;
  const leaseExpiresAt = input.leaseExpiresAt !== undefined ? input.leaseExpiresAt : null;
  const retryCount = input.retryCount ?? 0;
  const maxRetries = input.maxRetries ?? 3;
  const errorTrace = input.errorTrace !== undefined ? input.errorTrace : null;
  const createdAt = input.createdAt !== undefined ? input.createdAt : null;
  const updatedAt = input.updatedAt !== undefined ? input.updatedAt : null;

  const res = await client.query<InsertedDeliveryAssemblyJobRecord>(
    `
    INSERT INTO delivery_assembly_jobs (
      campaign_id,
      assembly_spec,
      status,
      worker_id,
      lease_token,
      lease_expires_at,
      retry_count,
      max_retries,
      error_trace,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, CURRENT_TIMESTAMP), COALESCE($11, CURRENT_TIMESTAMP))
    RETURNING *
    `,
    [
      campaignId,
      JSON.stringify(assemblySpec),
      status,
      workerId,
      leaseToken,
      leaseExpiresAt,
      retryCount,
      maxRetries,
      errorTrace,
      createdAt,
      updatedAt
    ]
  );

  const row = res.rows[0];
  if (!row) {
    throw new Error("Failed to insert delivery assembly job record");
  }
  return row;
}

export async function insertGenerationManifestRecord(
  client: PoolClient,
  input: GenerationManifestRecordInput
): Promise<InsertedGenerationManifestRecord> {
  const jobId = input.jobId;
  const promptIdComfy = input.promptIdComfy ?? "comfy-prompt-f9b2c3d4-8899-44aa";
  const campaignId = input.campaignId;
  const sceneId = input.sceneId;
  const renderAttempt = input.renderAttempt ?? 1;
  const manifestPayload = input.manifestPayload ?? {
    renderedFrames: 97,
    resolution: "1280x720",
    outputBucket: "godzspeed-delivery",
    outputObjectKey: `campaigns/${campaignId}/scenes/${sceneId}/output.mp4`,
    peakVramMb: 24028,
    renderDurationMs: 46000
  };

  const res = await client.query<InsertedGenerationManifestRecord>(
    `
    INSERT INTO generation_manifests (
      job_id,
      prompt_id_comfy,
      campaign_id,
      scene_id,
      render_attempt,
      manifest_payload
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
    `,
    [jobId, promptIdComfy, campaignId, sceneId, renderAttempt, JSON.stringify(manifestPayload)]
  );

  const row = res.rows[0];
  if (!row) {
    throw new Error("Failed to insert generation manifest record");
  }
  return row;
}

export async function insertReviewEventRecord(
  client: PoolClient,
  input: ReviewEventRecordInput
): Promise<InsertedReviewEventRecord> {
  const sceneId = input.sceneId;
  const reviewerName = input.reviewerName ?? "Thomas Cumberbatch";
  const action = input.action ?? "approve";
  const directorNotes =
    input.directorNotes !== undefined
      ? input.directorNotes
      : "Approved storyboard composition for LTX rendering.";
  const mutationPayload = input.mutationPayload ?? { approvedRevision: 1 };
  const priorSceneStatus =
    input.priorSceneStatus !== undefined ? input.priorSceneStatus : "director_review";
  const resultingSceneStatus =
    input.resultingSceneStatus !== undefined ? input.resultingSceneStatus : "approved";
  const expectedSpecRevision =
    input.expectedSpecRevision !== undefined ? input.expectedSpecRevision : null;
  const resultingSpecRevision =
    input.resultingSpecRevision !== undefined ? input.resultingSpecRevision : null;
  const requestHashSha256 = input.requestHashSha256 !== undefined ? input.requestHashSha256 : null;

  const res = await client.query<InsertedReviewEventRecord>(
    `
    INSERT INTO review_events (
      scene_id,
      reviewer_name,
      action,
      director_notes,
      mutation_payload,
      prior_scene_status,
      resulting_scene_status,
      expected_spec_revision,
      resulting_spec_revision,
      request_hash_sha256
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
    `,
    [
      sceneId,
      reviewerName,
      action,
      directorNotes,
      JSON.stringify(mutationPayload),
      priorSceneStatus,
      resultingSceneStatus,
      expectedSpecRevision,
      resultingSpecRevision,
      requestHashSha256
    ]
  );

  const row = res.rows[0];
  if (!row) {
    throw new Error("Failed to insert review event record");
  }
  return row;
}

export async function insertRepresentativeGraph(client: PoolClient): Promise<RepresentativeGraph> {
  const license = await insertLicenseRecord(client);
  const clientRecord = await insertClientRecord(client);
  const referenceAsset = await insertReferenceAssetRecord(client, {
    clientId: clientRecord.client_id
  });
  const campaign = await insertCampaignRecord(client, {
    clientId: clientRecord.client_id
  });
  const scene = await insertStoryboardSceneRecord(client, {
    campaignId: campaign.campaign_id
  });
  const sceneReferenceAsset = await insertSceneReferenceAssetRecord(client, {
    sceneId: scene.scene_id,
    assetId: referenceAsset.asset_id,
    overrideStrength: 0.9
  });
  const renderJob = await insertRenderJobRecord(client, {
    sceneId: scene.scene_id
  });
  const manifest = await insertGenerationManifestRecord(client, {
    jobId: renderJob.job_id,
    campaignId: campaign.campaign_id,
    sceneId: scene.scene_id
  });
  const storyboardCandidate = await insertStoryboardCandidateRecord(client, {
    sceneId: scene.scene_id
  });
  const reviewEvent = await insertReviewEventRecord(client, {
    sceneId: scene.scene_id
  });

  return {
    license,
    client: clientRecord,
    referenceAsset,
    campaign,
    scene,
    sceneReferenceAsset,
    renderJob,
    manifest,
    storyboardCandidate,
    reviewEvent
  };
}

export interface StoryboardCandidateRecordInput {
  candidateId?: string;
  sceneId: string;
  sceneSpecRevision?: number;
  variantOrdinal?: number;
  storageBucket?: string;
  storageObjectKey?: string;
  contentHashSha256?: string;
  generationPayload?: Record<string, unknown>;
}

export interface InsertedStoryboardCandidateRecord {
  candidate_id: string;
  scene_id: string;
  scene_spec_revision: number;
  variant_ordinal: number;
  storage_bucket: string;
  storage_object_key: string;
  content_hash_sha256: string;
  generation_payload: Record<string, unknown>;
  created_at: Date;
}

export async function insertStoryboardCandidateRecord(
  client: PoolClient,
  input: StoryboardCandidateRecordInput
): Promise<InsertedStoryboardCandidateRecord> {
  const sceneId = input.sceneId;
  const sceneSpecRevision = input.sceneSpecRevision ?? 1;
  const variantOrdinal = input.variantOrdinal ?? 1;
  const storageBucket = input.storageBucket ?? "godzspeed-temp";
  const storageObjectKey =
    input.storageObjectKey ??
    `candidates/${sceneId}/rev_${sceneSpecRevision}_var_${variantOrdinal}.webp`;
  const contentHashSha256 =
    input.contentHashSha256 ?? "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const generationPayload = input.generationPayload ?? {};

  const query =
    input.candidateId !== undefined
      ? `
        INSERT INTO storyboard_candidates (
          candidate_id,
          scene_id,
          scene_spec_revision,
          variant_ordinal,
          storage_bucket,
          storage_object_key,
          content_hash_sha256,
          generation_payload
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
        `
      : `
        INSERT INTO storyboard_candidates (
          scene_id,
          scene_spec_revision,
          variant_ordinal,
          storage_bucket,
          storage_object_key,
          content_hash_sha256,
          generation_payload
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
        `;

  const params =
    input.candidateId !== undefined
      ? [
          input.candidateId,
          sceneId,
          sceneSpecRevision,
          variantOrdinal,
          storageBucket,
          storageObjectKey,
          contentHashSha256,
          JSON.stringify(generationPayload)
        ]
      : [
          sceneId,
          sceneSpecRevision,
          variantOrdinal,
          storageBucket,
          storageObjectKey,
          contentHashSha256,
          JSON.stringify(generationPayload)
        ];

  const res = await client.query<InsertedStoryboardCandidateRecord>(query, params);
  const row = res.rows[0];
  if (!row) {
    throw new Error("Failed to insert storyboard candidate record");
  }
  return row;
}
