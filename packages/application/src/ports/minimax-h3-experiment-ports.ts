import type {
  MinimaxH3ExperimentCandidateFrames,
  MinimaxH3ExperimentEvent,
  MinimaxH3ExperimentIntent,
  MinimaxH3ExperimentReceipt,
  MinimaxH3ProbeResult,
  MinimaxH3ProcessRecord,
  MinimaxH3TargetSpecification,
  MinimaxH3TelemetrySample,
  MinimaxH3TerminalEvidence,
  MinimaxH3AnyExperimentDescriptor,
  MinimaxH3AnyExperimentResult,
  MinimaxH3FactorChange,
  MinimaxH3PhaseAccountingEvent,
  MinimaxH3RequiredRuntimeManifest,
  MinimaxH3ObservedProvenance,
  MinimaxH3AttentionVariantName,
  MinimaxH3SamplingRecipeName
} from "@cco/contracts";

export interface MinimaxH3ExperimentStorePort {
  createRunDirectory(runDir: string): Promise<void>;
  // ComfyUI's own argparse requires --output-directory/--temp-directory/
  // --user-directory to already exist, and exits immediately with a
  // usage error otherwise (confirmed via live run against real
  // hardware: the harness never created these before spawning, and the
  // resulting near-instant child death went undiagnosed for the full
  // readiness-wait timeout -- see the process-runner's own liveness
  // check for the other half of that fix). Idempotent/recursive.
  ensureRunSubdirectories(runDir: string): Promise<void>;
  writeDescriptor(runDir: string, descriptor: MinimaxH3AnyExperimentDescriptor): Promise<void>;
  readDescriptor(runDir: string): Promise<MinimaxH3AnyExperimentDescriptor>;

  writeConfig(runDir: string, config: Record<string, unknown>): Promise<string>;
  readConfig(runDir: string): Promise<Record<string, unknown>>;

  writeInputManifest(runDir: string, manifest: unknown): Promise<void>;
  readInputManifest(runDir: string): Promise<unknown>;

  writeMeasurementTemplate(runDir: string, template: MinimaxH3AnyExperimentResult): Promise<void>;
  readMeasurementTemplate(runDir: string): Promise<MinimaxH3AnyExperimentResult | null>;

  writeIntent(runDir: string, intent: MinimaxH3ExperimentIntent): Promise<void>;
  readIntent(runDir: string): Promise<MinimaxH3ExperimentIntent | null>;

  writeReceipt(runDir: string, receipt: MinimaxH3ExperimentReceipt): Promise<void>;
  readReceipt(runDir: string): Promise<MinimaxH3ExperimentReceipt | null>;

  appendEvent(runDir: string, event: MinimaxH3ExperimentEvent): Promise<void>;
  readEvents(runDir: string): Promise<MinimaxH3ExperimentEvent[]>;

  appendPhaseEvent?(runDir: string, event: MinimaxH3PhaseAccountingEvent): Promise<void>;
  readPhaseEvents?(runDir: string): Promise<MinimaxH3PhaseAccountingEvent[]>;

  appendTelemetry(runDir: string, sample: MinimaxH3TelemetrySample): Promise<void>;
  readTelemetry(runDir: string): Promise<MinimaxH3TelemetrySample[]>;

  writeResult(runDir: string, result: MinimaxH3AnyExperimentResult): Promise<void>;
  readResult(runDir: string): Promise<MinimaxH3AnyExperimentResult | null>;

  writeProcessRecord(runDir: string, record: MinimaxH3ProcessRecord): Promise<void>;
  readProcessRecord(runDir: string): Promise<MinimaxH3ProcessRecord | null>;

  writeTerminalEvidence(runDir: string, evidence: MinimaxH3TerminalEvidence): Promise<void>;
  readTerminalEvidence(runDir: string): Promise<MinimaxH3TerminalEvidence | null>;

  verifyContainment(targetPath: string, rootDir: string): boolean;
  stageInputFile(sourcePath: string, destPath: string): Promise<void>;
  hashFile(filePath: string): Promise<{ sha256: string; sizeBytes: number }>;
  inspectAsset(filePath: string): Promise<{ width: number; height: number; mimeType: string }>;
  readJsonFile<T = unknown>(filePath: string): Promise<T>;
  readTextFile(filePath: string): Promise<string>;
  writeTextFile(filePath: string, content: string): Promise<void>;
  deleteRunFiles(runDir: string, removeOutputs?: boolean): Promise<void>;
  writeDurableJson(filePath: string, content: unknown): Promise<void>;
}

export interface MinimaxH3TargetPreflightPort {
  checkTargetHost(target: MinimaxH3TargetSpecification): Promise<{ ok: boolean; blocker?: string }>;
  acquireGpuLock(
    outputRoot: string,
    gpuUuid: string,
    pid: number,
    processStartTimeTicks?: number
  ): Promise<{
    acquired: boolean;
    release: () => Promise<void>;
    blocker?: string;
    lockToken?: string;
    processStartTimeTicks?: number | null;
  }>;
  checkPortAvailable(address: string, port: number): Promise<{ ok: boolean; blocker?: string }>;
  verifyCheckout(
    comfyUiDir: string,
    expectedRevision?: string
  ): Promise<{
    ok: boolean;
    revision: string;
    nodesPresent: boolean;
    cleanTree?: boolean;
    sourceHashes?: {
      cliArgsSha256: string;
      mainSha256: string;
      modelManagementSha256: string;
    };
    blocker?: string;
  }>;
  verifyModels(
    comfyUiDir: string,
    modelSpecs: Record<string, { expectedHash: string; sizeBytes?: number }>
  ): Promise<{
    ok: boolean;
    resolvedPaths: Record<
      string,
      { expectedHash: string; resolvedPath: string; sizeBytes: number }
    >;
    blocker?: string;
  }>;
  verifyDiskSpace(
    targetDir: string,
    minFreeGb: number
  ): Promise<{ ok: boolean; freeGb: number | null; blocker?: string }>;
  verifyEnvironmentTools?(
    pythonPath: string,
    ffmpegPath?: string
  ): Promise<{ ok: boolean; pythonVersion?: string; ffmpegVersion?: string; blocker?: string }>;
  releaseGpuLock?(
    gpuUuid: string,
    expectedPid?: number,
    expectedStartTimeTicks?: number,
    expectedLockToken?: string
  ): Promise<{ released: boolean; reason?: string }>;
  verifyExperimentRuntime?(options: {
    comfyUiDir: string;
    pythonPath: string;
    requiredRuntime: MinimaxH3RequiredRuntimeManifest;
    requiredRuntimeDigest: string;
    expectedCheckpointHash?: string;
  }): Promise<{
    ok: boolean;
    status: "verified" | "conflict" | "unknown";
    blocker?: string;
    observations?: MinimaxH3ObservedProvenance;
    adapterRegistered: boolean;
  }>;
}

export interface MinimaxH3OwnedProcess {
  readonly pid: number;
  readonly startTimeTicks: number;
  readonly address: string;
  readonly port: number;
  readonly gpuUuid: string;
  getStdout(): string;
  getStderr(): string;
  isRunning(): boolean;
  stop(timeoutMs?: number): Promise<void>;
  verifySocketOwnership(): Promise<{ ok: boolean; reason?: string }>;
  verifyChildEnvironment(): Promise<{ ok: boolean; reason?: string }>;
  readActualProcessInfo?(): Promise<{
    argv: string[];
    env: Record<string, string>;
    commandLine: string;
  }>;
}

export interface MinimaxH3ProcessRunnerPort {
  spawnChild(options: {
    pythonPath: string;
    comfyUiDir: string;
    address: string;
    port: number;
    dirs: {
      inputDir: string;
      outputDir: string;
      tempDir: string;
      userDir: string;
    };
    argv: readonly string[];
    env: Record<string, string>;
    gpuUuid: string;
    collectorPath?: string;
    runDir?: string;
    runId?: string;
    attemptToken?: string;
  }): Promise<MinimaxH3OwnedProcess>;
}

export interface MinimaxH3ComfyUiTransportPort {
  waitForReadiness(
    baseUrl: string,
    timeoutMs: number,
    abortSignal?: AbortSignal
  ): Promise<{ ok: boolean; blocker?: string }>;
  submitPrompt(
    baseUrl: string,
    prompt: Record<string, unknown>,
    clientId: string,
    timeoutMs: number,
    abortSignal?: AbortSignal
  ): Promise<{ ok: boolean; promptId?: string; error?: string }>;
  pollPromptHistory(
    baseUrl: string,
    promptId: string,
    timeoutMs: number,
    pollIntervalMs: number,
    abortSignal?: AbortSignal
  ): Promise<{
    status: "completed" | "failed" | "timeout";
    outputFilename?: string | undefined;
    outputSubfolder?: string | undefined;
    outputType?: "output" | "temp" | undefined;
    rawHistory?: unknown;
    error?: string | undefined;
    // true when status "failed" means our own abort signal fired or
    // ComfyUI itself reported the execution as interrupted -- distinct
    // from a genuine engine-reported execution error (e.g. CUDA OOM).
    // Without this, a deliberate stop (operator cancel or a stop-policy
    // threshold trip) and a real engine failure are indistinguishable
    // to the caller, both just "failed".
    interrupted?: boolean | undefined;
  }>;
  getQueue(baseUrl: string): Promise<{ running: unknown[]; pending: unknown[] }>;
  findPromptByWorkflowDigestOrClient(
    baseUrl: string,
    clientId: string
  ): Promise<{
    promptId?: string;
    status?: "completed" | "failed" | "running" | "queued";
    outputFilename?: string;
    outputSubfolder?: string;
    outputType?: "output" | "temp";
  } | null>;
}

export interface MinimaxH3TelemetrySamplerPort {
  start(options: {
    targetGpuUuid: string;
    pid: number;
    processStartTimeTicks?: number;
    intervalMs: number;
    onSample: (sample: MinimaxH3TelemetrySample) => void | Promise<void>;
  }): {
    stop: () => Promise<void>;
    setPhase: (phase: "before" | "during" | "after") => void;
  };
}

export interface MinimaxH3OutputProberPort {
  probeOutput(
    filePath: string,
    timeoutMs: number,
    expectedContainingDir?: string
  ): Promise<MinimaxH3ProbeResult>;
}

export interface PrepareMinimaxH3ExperimentOptions {
  route: "i2v" | "ref2v";
  frames: MinimaxH3ExperimentCandidateFrames;
  seed: number;
  prompt: string;
  operatorLabel: string;
  runId: string;
  outputRoot: string;
  targetHost: string;
  gpuUuid: string;
  comfyUiDir: string;
  pythonPath: string;
  address?: string;
  port?: number;
  width?: number;
  height?: number;
  runnerVariant?: string;
  variantReason?: string | null;
  inputManifestPath: string;
  requestedDurationMs?: number;
  templatesDir?: string;
  pinFilesDir?: string;
  timeouts?: Partial<{
    startupTimeoutMs: number;
    submissionTimeoutMs: number;
    pollIntervalMs: number;
    totalRenderTimeoutMs: number;
    probeTimeoutMs: number;
    settlementTimeoutMs: number;
    shutdownTimeoutMs: number;
  }>;
  schemaVersion?: 1 | 2;
  stepOverride?: number;
  checkpointOverride?: "ref2va" | "fl2va";
  changedFactors?: MinimaxH3FactorChange[];
  variantPurpose?: "performance" | "prompt_conditioning" | "controlled_multifactor";
  attentionVariant?: MinimaxH3AttentionVariantName;
  coreRevision?: string;
  matchedVariant?: MinimaxH3AttentionVariantName;
  samplingRecipe?: MinimaxH3SamplingRecipeName;
}
