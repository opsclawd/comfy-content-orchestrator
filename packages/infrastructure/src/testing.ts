export {
  startPostgres18Container,
  Pool,
  Client,
  type PoolClient,
  type StartedPostgres18Container
} from "./postgres/test-support/postgres-18.js";

export {
  insertLicenseRecord,
  insertClientRecord,
  insertReferenceAssetRecord,
  insertCampaignRecord,
  insertStoryboardSceneRecord,
  insertSceneReferenceAssetRecord,
  insertRenderJobRecord,
  insertGenerationManifestRecord,
  insertReviewEventRecord,
  insertStoryboardCandidateRecord,
  insertRepresentativeGraph,
  type LicenseRecordInput,
  type ClientRecordInput,
  type ReferenceAssetRecordInput,
  type CampaignRecordInput,
  type StoryboardSceneRecordInput,
  type SceneReferenceAssetRecordInput,
  type RenderJobRecordInput,
  type GenerationManifestRecordInput,
  type ReviewEventRecordInput,
  type StoryboardCandidateRecordInput,
  type InsertedLicenseRecord,
  type InsertedClientRecord,
  type InsertedReferenceAssetRecord,
  type InsertedCampaignRecord,
  type InsertedStoryboardSceneRecord,
  type InsertedSceneReferenceAssetRecord,
  type InsertedRenderJobRecord,
  type InsertedGenerationManifestRecord,
  type InsertedReviewEventRecord,
  type InsertedStoryboardCandidateRecord,
  type RepresentativeGraph
} from "./postgres/test-support/records.js";

export const MIGRATIONS_DIRECTORY_URL = new URL("../migrations/", import.meta.url);
