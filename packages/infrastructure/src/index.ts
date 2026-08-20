export const infrastructureName = "infrastructure";

export {
  runMigrations,
  type MigrationRunOptions,
  type AppliedMigration
} from "./postgres/migration-runner.js";

export {
  PostgresSceneRepository,
  type PostgresSceneRepositoryOptions
} from "./postgres/repositories/postgres-scene-repository.js";

export { PostgresStoryboardCandidateRepository } from "./postgres/repositories/postgres-storyboard-candidate-repository.js";

export { PostgresReviewEventStore } from "./postgres/repositories/postgres-review-event-store.js";

export { PostgresUnitOfWork } from "./postgres/uow/postgres-unit-of-work.js";

export { PostgresSceneReviewQueries } from "./postgres/queries/postgres-scene-review-queries.js";

export {
  ComfyUiRenderEngineAdapter,
  type ComfyUiRenderEngineAdapterOptions
} from "./comfyui/render-engine-adapter.js";

export {
  ComfyUiRenderEngineError,
  type ComfyUiFailureCode,
  type ComfyUiFailureContext
} from "./comfyui/comfyui-error.js";

export {
  ComfyUiClient,
  type ComfyUiWebSocket,
  type ComfyUiTransport,
  type ComfyUiHistoryEntry
} from "./comfyui/comfyui-client.js";

export {
  collectCertificationProvenance,
  type CertificationProvenanceReport,
  type RenderProfileProvenance,
  type ProvenanceProgress,
  type ProvenanceCollectorDependencies
} from "./comfyui/provenance/collector.js";

export {
  loadCertificationProfile,
  type CertificationProfile,
  type WorkflowNodeAssertion
} from "./comfyui/provenance/profile-manifest.js";

export {
  type ModelCategory,
  VALID_MODEL_CATEGORIES,
  type ModelFileSpec,
  type ModelFileHash,
  type ModelHashProgress,
  canonicalizeWorkflow,
  hashWorkflow,
  resolveModelFilePath,
  hashFileStream,
  hashModelFiles
} from "./comfyui/provenance/hasher.js";

export {
  BYTES_PER_GB,
  LTX_MIN_FREE_DISK_GB,
  type DiskPreflightResult,
  DiskPreflightError,
  evaluateFreeSpaceReservation,
  measureModelFootprint,
  runDiskPreflight
} from "./comfyui/provenance/preflight.js";

export {
  type CustomNodeGitRevision,
  type GitProvenance,
  readGitCommit,
  collectGitProvenance
} from "./comfyui/provenance/git-tracker.js";

export {
  parseCliArgs,
  runCli,
  type ProvenanceCliOptions,
  type ProvenanceCliDependencies
} from "./comfyui/provenance/cli.js";

export {
  NvidiaSmiTelemetryAdapter,
  parseNvidiaSmiMemoryCsv,
  NvidiaSmiTelemetryError,
  NVIDIA_SMI_COMMAND,
  NVIDIA_SMI_MEMORY_ARGS,
  type NvidiaSmiTelemetryAdapterOptions,
  type NvidiaSmiTelemetryErrorContext,
  type NvidiaSmiExecFileFn,
  type NvidiaSmiMemoryResult
} from "./telemetry/nvidia-smi-telemetry-adapter.js";

export {
  LinuxHostTelemetryAdapter,
  parseProcMeminfo,
  parseProcVmstat,
  parseProcPidStatus,
  parseProcPidStat,
  LinuxHostTelemetryError,
  type LinuxHostReadFileFn,
  type ProcMeminfoResult,
  type ProcVmstatResult,
  type ProcPidStatusResult,
  type ProcPidStatResult,
  type LinuxHostTelemetryAdapterOptions,
  type LinuxHostTelemetryErrorContext
} from "./telemetry/linux-host-telemetry-adapter.js";

export {
  collectRunnerEnvironment,
  type RunnerEnvironmentDependencies,
  type RunnerEnvironmentExecFileFn,
  type RunnerEnvironmentOptions,
  type RunnerEnvironmentOs,
  type RunnerEnvironmentReadFileFn
} from "./telemetry/runner-environment.js";

export {
  LocalFsGpuLeaseAdapter,
  type LocalFsGpuLeaseAdapterOptions
} from "./gpu/local-fs-gpu-lease-adapter.js";

export { S3ObjectStorage, type S3ObjectStorageOptions } from "./storage/s3-object-storage.js";

export {
  S3ReviewMediaDelivery,
  type S3ReviewMediaDeliveryOptions
} from "./storage/s3-review-media-delivery.js";

export {
  InMemoryStorageMetricsRegistry,
  WATERMARK_STATE_NUMERIC_VALUES
} from "./telemetry/in-memory-storage-metrics-registry.js";

export {
  HostFsStorageTelemetryAdapter,
  HostFsStorageTelemetryError,
  type HostFsStorageTelemetryAdapterOptions,
  type StatFsFn,
  type BucketUsageProvider
} from "./telemetry/storage-telemetry-adapter.js";

export {
  provisionBucket,
  provisionStorageBuckets,
  evaluateLifecycleEligibility,
  readBucketLifecycleConfiguration,
  type StorageProvisioningOptions,
  type BucketProvisionResult,
  type StorageProvisioningSummary,
  type LifecycleEligibilityResult
} from "./storage/provisioner.js";

export {
  parseProvisionCliArgs,
  runProvisionCli,
  type StorageProvisionCliOptions,
  type ProvisionCliDependencies
} from "./storage/provision.js";
