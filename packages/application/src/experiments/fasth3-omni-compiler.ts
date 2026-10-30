import {
  type FastH3OmniAuditSnapshot,
  type FastH3OmniBindingManifest,
  type FastH3OmniCapability,
  type FastH3OmniCommandSpec,
  type FastH3OmniModelIdentity,
  type FastH3OmniPreparationSpec,
  FastH3OmniPreparationSpecSchema,
  type FastH3OmniReadinessStatus,
  type FastH3OmniUpstreamRecipe,
  listFastH3OmniIdentityGaps,
  type FastH3OmniRuntimeIdentity,
  computeFastH3OmniCommandDigest,
  computeFastH3OmniDescriptorDigest
} from "@cco/contracts";

export interface CompileFastH3OmniOptions {
  readonly runId: string;
  readonly auditSnapshot: FastH3OmniAuditSnapshot;
  readonly capability: FastH3OmniCapability;
  readonly modelIdentity: FastH3OmniModelIdentity;
  readonly runtimeIdentity: FastH3OmniRuntimeIdentity;
  readonly bindingManifest: FastH3OmniBindingManifest;
  readonly renderParams: {
    readonly width: number;
    readonly height: number;
    readonly frames: number;
    readonly fps: number;
    readonly seed: number;
  };
  readonly executionContext?:
    | {
        readonly hostGpuVerified?: boolean | undefined;
        readonly licenseApproved?: boolean | undefined;
        readonly weightsVerifiedLocally?: boolean | undefined;
      }
    | undefined;
  readonly outputDir?: string | undefined;
  readonly stagedInputsDir?: string | undefined;
  readonly timeouts?:
    | {
        readonly startupTimeoutMs?: number | undefined;
        readonly renderTimeoutMs?: number | undefined;
        readonly probeTimeoutMs?: number | undefined;
        readonly shutdownTimeoutMs?: number | undefined;
        readonly maxVramMb?: number | undefined;
        readonly maxHostRamMb?: number | undefined;
        readonly maxSwapMb?: number | undefined;
      }
    | undefined;
  /** Captured upstream recipe; without it no command is compiled. */
  readonly upstreamRecipe?: FastH3OmniUpstreamRecipe | undefined;
}

export function compileFastH3OmniSpecification(
  options: CompileFastH3OmniOptions
): FastH3OmniPreparationSpec {
  const {
    runId,
    auditSnapshot,
    capability,
    modelIdentity,
    runtimeIdentity,
    bindingManifest,
    renderParams,
    executionContext,
    outputDir = `.ai-runs/fasth3-omni-experiments/${runId}`,
    timeouts = {},
    upstreamRecipe
  } = options;

  // 1. Route validation (ref2va / ref2v only)
  if (capability.route !== "ref2va" && capability.route !== "ref2v") {
    throw new Error(
      `FastH3-Omni compiler supports only "ref2va" or "ref2v" route; got "${capability.route}"`
    );
  }

  // 2. Frame count validation (strict discrete frames)
  if (!capability.supportedFrames.includes(renderParams.frames)) {
    throw new Error(
      `Requested frame count ${renderParams.frames} is not in supported discrete frame set [${capability.supportedFrames.join(
        ", "
      )}]`
    );
  }

  if (renderParams.fps !== capability.supportedFps) {
    throw new Error(
      `Requested FPS ${renderParams.fps} does not match supported FPS ${capability.supportedFps}`
    );
  }

  // 3. Resolution validation
  const resolutionSupported = capability.supportedResolutions.some(
    (res) => res.width === renderParams.width && res.height === renderParams.height
  );
  if (!resolutionSupported) {
    const supportedList = capability.supportedResolutions
      .map((r) => `${r.width}x${r.height}`)
      .join(", ");
    throw new Error(
      `Requested resolution ${renderParams.width}x${renderParams.height} is not supported. Supported: [${supportedList}]`
    );
  }

  // 4. Hardware and architecture fences (SM89 / RTX 4090)
  if (runtimeIdentity.computeCapability !== "8.9") {
    throw new Error(
      `Target compute capability "${runtimeIdentity.computeCapability}" is incompatible; FastH3-Omni isolated lane requires SM89 (8.9)`
    );
  }

  if ((modelIdentity.textEncoder.precision ?? "").toLowerCase().includes("nvfp4")) {
    throw new Error(
      "NVFP4 precision requires NVIDIA Blackwell hardware; SM89 requires BF16 text encoder"
    );
  }

  if (!runtimeIdentity.layerwiseStreaming) {
    throw new Error("Layerwise FP8 streaming is mandatory for RTX 4090 24GB VRAM capacity");
  }

  // 5. Execution blockers analysis
  const executionBlockers: string[] = [];

  if (auditSnapshot.upstreamReleaseStatus !== "released") {
    executionBlockers.push("Upstream model artifacts are not publicly released");
  }

  const hasLicenseReviewRequired = auditSnapshot.claims.some(
    (c) => c.status === "review_required" && c.claimId.includes("license")
  );
  if (!executionContext?.licenseApproved && hasLicenseReviewRequired) {
    executionBlockers.push("Commercial license review pending for base MiniMax-H3 community terms");
  }

  if (!executionContext?.weightsVerifiedLocally) {
    executionBlockers.push(
      "Model weights not downloaded and cryptographically verified on local host"
    );
  }

  if (!executionContext?.hostGpuVerified) {
    executionBlockers.push(
      "Target RTX 4090 hardware environment, CUDA drivers, and VSA kernel unverified"
    );
  }

  // Determine readiness status
  let readinessStatus: FastH3OmniReadinessStatus = "offline_validated";
  if (auditSnapshot.upstreamReleaseStatus !== "released") {
    readinessStatus = "blocked_pending_upstream_release";
  } else if (!executionContext?.licenseApproved && hasLicenseReviewRequired) {
    readinessStatus = "blocked_license_review";
  }
  // Missing local weights/GPU verification remain execution blockers, not offline blockers.

  // 6. Identity completeness: every component must be audit-sourced, otherwise blocked.
  const identityGaps = listFastH3OmniIdentityGaps(modelIdentity, runtimeIdentity);
  for (const gap of identityGaps) {
    executionBlockers.push(`Identity incomplete: ${gap}`);
  }

  const resolvedTimeouts = {
    startupTimeoutMs: timeouts.startupTimeoutMs ?? null,
    renderTimeoutMs: timeouts.renderTimeoutMs ?? null,
    probeTimeoutMs: timeouts.probeTimeoutMs ?? null,
    shutdownTimeoutMs: timeouts.shutdownTimeoutMs ?? null,
    maxVramMb: timeouts.maxVramMb ?? null,
    maxHostRamMb: timeouts.maxHostRamMb ?? null,
    maxSwapMb: timeouts.maxSwapMb ?? null
  };
  for (const [name, value] of Object.entries(resolvedTimeouts)) {
    if (value === null) {
      executionBlockers.push(`Operator-approved limit "${name}" not supplied`);
    }
  }

  if (!upstreamRecipe) {
    executionBlockers.push(
      "Upstream FastVideo recipe/launch command not captured; no argv or config is emitted"
    );
  }

  if (
    readinessStatus === "offline_validated" &&
    (identityGaps.length > 0 || !upstreamRecipe || Object.values(resolvedTimeouts).includes(null))
  ) {
    readinessStatus = "blocked_unverified_runtime";
  }

  // 7. Command specification only from a captured upstream recipe with complete identity.
  let commandSpec: FastH3OmniCommandSpec | null = null;
  if (readinessStatus === "offline_validated" && upstreamRecipe) {
    const configFilePath = `${outputDir}/config.yaml`;
    const rawCommand = {
      argv: [...upstreamRecipe.argv, configFilePath],
      environment: { ...upstreamRecipe.environment },
      configFilePath
    };
    commandSpec = { ...rawCommand, commandDigest: computeFastH3OmniCommandDigest(rawCommand) };
  }

  // 8. Assemble preparation specification
  const baseSpec = {
    schemaVersion: 1 as const,
    runId,
    readinessStatus,
    isExecutable: false, // Phase A is strictly non-executable offline preparation
    executionBlockers,
    auditSnapshot,
    capability,
    modelIdentity,
    runtimeIdentity,
    bindingManifest,
    renderParams: {
      width: renderParams.width,
      height: renderParams.height,
      frames: renderParams.frames,
      fps: renderParams.fps,
      seed: renderParams.seed
    },
    upstreamRecipe: readinessStatus === "offline_validated" ? (upstreamRecipe ?? null) : null,
    commandSpec,
    timeouts: resolvedTimeouts,
    privacyPolicy: {
      allowRemoteAssetUpload: false as const,
      containmentRoot: ".ai-runs/fasth3-omni-experiments"
    }
  };

  const descriptorDigest = computeFastH3OmniDescriptorDigest(baseSpec);

  const spec: FastH3OmniPreparationSpec = {
    ...baseSpec,
    descriptorDigest
  };

  return FastH3OmniPreparationSpecSchema.parse(spec);
}

/** Returns the verbatim upstream recipe copy, or null when the specification is blocked. */
export function generateFastVideoYamlConfig(spec: FastH3OmniPreparationSpec): string | null {
  return spec.commandSpec && spec.upstreamRecipe ? spec.upstreamRecipe.configText : null;
}
