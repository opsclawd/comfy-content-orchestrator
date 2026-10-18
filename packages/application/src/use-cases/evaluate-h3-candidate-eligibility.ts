import {
  getH3CandidateProfile,
  listH3CandidateProfiles,
  computeModelHashesDigest,
  PINNED_COMFYUI_CORE_REVISION,
  type H3CandidateAuthorizationGrant
} from "@cco/contracts";
import type {
  H3CandidateAuthorizationPort,
  H3RuntimeObservationPort,
  H3CandidateRegistryReader
} from "../ports/h3-candidate-ports.js";

export interface H3CandidateEligibilityRequest {
  readonly candidateKey: string;
  readonly target: {
    readonly hostname: string;
    readonly gpuUuid: string;
    readonly comfyUiEndpoint?: string;
    readonly comfyUiDir?: string;
    readonly pid?: number;
  };
  readonly executionContext: {
    readonly route: "i2v" | "ref2v";
    readonly routingMode: "frame_anchored" | "reference_directed";
    readonly width: number;
    readonly height: number;
    readonly frames: number;
    readonly workflowHash: string;
    readonly modelHashes: Readonly<Record<string, string>>;
    readonly steps?: number | undefined;
    readonly sampler?: string | undefined;
    readonly scheduler?: string | undefined;
    readonly runnerProfile?: string | undefined;
    readonly cfg?: number | undefined;
    readonly denoise?: number | undefined;
  };
  readonly goldMasterProvenance: {
    readonly workflowHash: string;
    readonly modelHashes: Readonly<Record<string, string>>;
  };
  readonly authorizationGrant?: H3CandidateAuthorizationGrant | undefined;
  readonly purpose: "staging" | "production";
  /**
   * INVARIANT: Any caller-supplied authorization claim cannot substitute for the authorization port.
   */
  readonly callerSuppliedAuthorization?: unknown | undefined;
}

export type H3CandidateEligibilityBlockerCode =
  | "candidate_unrecognized"
  | "route_or_geometry_mismatch"
  | "off_grid_frames"
  | "frame_count_not_allowed"
  | "workflow_hash_mismatch"
  | "model_hash_invalid"
  | "model_hash_mismatch"
  | "gold_master_mismatch"
  | "runtime_observation_failed"
  | "host_identity_mismatch"
  | "gpu_uuid_mismatch"
  | "runtime_optimizer_mismatch"
  | "process_continuity_lost"
  | "missing_authorization_grant"
  | "authorization_denied"
  | "scope_insufficient_for_purpose";

export type H3CandidateEligibilityDecision =
  | {
      readonly eligible: true;
      readonly candidateKey: string;
      readonly scope: "staging" | "production";
      readonly specificationDigest: string;
    }
  | {
      readonly eligible: false;
      readonly candidateKey: string;
      readonly blockerCode: H3CandidateEligibilityBlockerCode;
      readonly message: string;
    };

export interface H3CandidateEligibilityServiceDependencies {
  readonly authorizationPort: H3CandidateAuthorizationPort;
  readonly runtimeObservationPort: H3RuntimeObservationPort;
  readonly registryReader?: H3CandidateRegistryReader | undefined;
}

const SHA256_REGEX = /^[0-9a-f]{64}$/;

export class H3CandidateEligibilityService {
  private readonly authorizationPort: H3CandidateAuthorizationPort;
  private readonly runtimeObservationPort: H3RuntimeObservationPort;
  private readonly registryReader: H3CandidateRegistryReader;

  constructor(dependencies: H3CandidateEligibilityServiceDependencies) {
    this.authorizationPort = dependencies.authorizationPort;
    this.runtimeObservationPort = dependencies.runtimeObservationPort;
    this.registryReader = dependencies.registryReader ?? {
      getCandidateProfile: getH3CandidateProfile,
      listCandidateProfiles: listH3CandidateProfiles
    };
  }

  async evaluateEligibility(
    request: H3CandidateEligibilityRequest
  ): Promise<H3CandidateEligibilityDecision> {
    const candidateKey = request.candidateKey;

    // 1. Candidate recognition in accepted catalog
    const candidate = this.registryReader.getCandidateProfile(candidateKey);
    if (!candidate) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "candidate_unrecognized",
        message: `Candidate profile "${candidateKey}" is not recognized in the accepted candidate catalog`
      };
    }

    if (
      request.purpose === "production" &&
      (!candidate.measurements || candidate.measurements === null)
    ) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "scope_insufficient_for_purpose",
        message: `Candidate profile "${candidateKey}" lacks operator measurements required for production purpose`
      };
    }

    const spec = candidate.specification;
    const ctx = request.executionContext;

    // 2. Route and geometry verification
    if (
      ctx.route !== spec.route ||
      ctx.routingMode !== spec.routingMode ||
      ctx.width !== spec.width ||
      ctx.height !== spec.height
    ) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "route_or_geometry_mismatch",
        message: `Execution context route/geometry does not match candidate specification: expected route=${spec.route}, mode=${spec.routingMode}, ${spec.width}x${spec.height}; got route=${ctx.route}, mode=${ctx.routingMode}, ${ctx.width}x${ctx.height}`
      };
    }

    // 3. Frame validity (grid alignment and exact allowlist)
    if ((ctx.frames - 5) % 17 !== 0) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "off_grid_frames",
        message: `Execution frame count ${ctx.frames} does not satisfy MiniMax-H3 temporal grid: (frames - 5) % 17 === 0`
      };
    }

    if (ctx.frames !== spec.frames) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "frame_count_not_allowed",
        message: `Execution frame count ${ctx.frames} is not allowlisted for candidate "${candidateKey}" (expected ${spec.frames})`
      };
    }

    // 4. Workflow hash exact match
    if (ctx.workflowHash !== spec.workflowHash) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "workflow_hash_mismatch",
        message: `Workflow hash mismatch: expected "${spec.workflowHash}", got "${ctx.workflowHash}"`
      };
    }

    // 5. Complete keyed model hashes verification
    const expectedModelMap: Record<string, string> = {
      checkpoint: spec.modelHashes.checkpoint,
      clip: spec.modelHashes.clip,
      audioVae: spec.modelHashes.audioVae,
      videoVae: spec.modelHashes.videoVae
    };
    if (spec.modelHashes.turboLora !== "none") {
      expectedModelMap.turboLora = spec.modelHashes.turboLora;
    }
    if (spec.modelHashes.additionalModels) {
      for (const [k, v] of Object.entries(spec.modelHashes.additionalModels)) {
        if (k in expectedModelMap) {
          return {
            eligible: false,
            candidateKey,
            blockerCode: "model_hash_invalid",
            message: `additionalModels cannot overwrite required model key "${k}"`
          };
        }
        expectedModelMap[k] = v;
      }
    }

    // Exact key-set equality check for execution context
    for (const key of Object.keys(ctx.modelHashes)) {
      if (!(key in expectedModelMap)) {
        return {
          eligible: false,
          candidateKey,
          blockerCode: "model_hash_invalid",
          message: `Unexpected model hash key "${key}" in execution context`
        };
      }
    }
    for (const key of Object.keys(expectedModelMap)) {
      if (!(key in ctx.modelHashes)) {
        return {
          eligible: false,
          candidateKey,
          blockerCode: "model_hash_invalid",
          message: `Missing required model hash key "${key}" in execution context`
        };
      }
    }

    // Validate that execution model hashes are non-empty valid SHA-256 strings matching expected
    for (const [key, expectedHash] of Object.entries(expectedModelMap)) {
      const liveHash = ctx.modelHashes[key];
      if (
        typeof liveHash !== "string" ||
        liveHash.trim().length === 0 ||
        !SHA256_REGEX.test(liveHash)
      ) {
        return {
          eligible: false,
          candidateKey,
          blockerCode: "model_hash_invalid",
          message: `Model hash for "${key}" is missing or invalid: must be a non-empty lowercase 64-character hexadecimal SHA-256 hash`
        };
      }
      if (liveHash !== expectedHash) {
        return {
          eligible: false,
          candidateKey,
          blockerCode: "model_hash_mismatch",
          message: `Model hash mismatch for "${key}": expected "${expectedHash}", got "${liveHash}"`
        };
      }
    }

    // 6. Gold master provenance verification
    const gm = request.goldMasterProvenance;
    if (gm.workflowHash !== spec.workflowHash) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "gold_master_mismatch",
        message: `Gold master workflow hash mismatch: expected "${spec.workflowHash}", got "${gm.workflowHash}"`
      };
    }

    // Exact key-set equality check for gold master provenance
    for (const key of Object.keys(gm.modelHashes)) {
      if (!(key in expectedModelMap)) {
        return {
          eligible: false,
          candidateKey,
          blockerCode: "gold_master_mismatch",
          message: `Unexpected model hash key "${key}" in gold master provenance`
        };
      }
    }
    for (const key of Object.keys(expectedModelMap)) {
      if (!(key in gm.modelHashes)) {
        return {
          eligible: false,
          candidateKey,
          blockerCode: "gold_master_mismatch",
          message: `Missing required model hash key "${key}" in gold master provenance`
        };
      }
    }

    for (const [key, expectedHash] of Object.entries(expectedModelMap)) {
      const gmHash = gm.modelHashes[key];
      if (
        typeof gmHash !== "string" ||
        gmHash.trim().length === 0 ||
        !SHA256_REGEX.test(gmHash) ||
        gmHash !== expectedHash
      ) {
        return {
          eligible: false,
          candidateKey,
          blockerCode: "gold_master_mismatch",
          message: `Gold master model hash for "${key}" is invalid or does not match candidate specification`
        };
      }
    }

    // 7. Live runtime observation
    const obsResult = await this.runtimeObservationPort.observeCurrentRuntime(request.target);
    if (!obsResult.ok || !obsResult.observation) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "runtime_observation_failed",
        message: obsResult.blocker ?? "Live runtime observation failed"
      };
    }

    const obs = obsResult.observation;

    if (obs.hostname !== request.target.hostname) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "host_identity_mismatch",
        message: `Observed host "${obs.hostname}" does not match target hostname "${request.target.hostname}"`
      };
    }

    if (obs.gpuUuid !== request.target.gpuUuid) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "gpu_uuid_mismatch",
        message: `Observed GPU "${obs.gpuUuid}" does not match target GPU UUID "${request.target.gpuUuid}"`
      };
    }

    // ComfyUI Core revision verification
    const expectedCoreRev = spec.expectedCoreRevision ?? PINNED_COMFYUI_CORE_REVISION;
    if (obs.comfyUiCoreRevision !== expectedCoreRev) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "runtime_optimizer_mismatch",
        message: `Observed ComfyUI core revision "${obs.comfyUiCoreRevision}" does not match pinned core revision "${expectedCoreRev}"`
      };
    }

    // Python executable verification
    if (
      !obs.pythonExecutable ||
      obs.pythonExecutable.trim().length === 0 ||
      !obs.pythonExecutable.toLowerCase().includes("python")
    ) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "runtime_optimizer_mismatch",
        message: `Observed pythonExecutable "${obs.pythonExecutable ?? ""}" is missing or not a valid Python interpreter`
      };
    }
    if (spec.expectedPythonExecutable && obs.pythonExecutable !== spec.expectedPythonExecutable) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "runtime_optimizer_mismatch",
        message: `Observed pythonExecutable "${obs.pythonExecutable}" does not match expected "${spec.expectedPythonExecutable}"`
      };
    }

    // Runner settings vs commandLineArgs verification
    if (spec.runnerSettings.requiresModelOffloading) {
      if (
        obs.commandLineArgs.includes("--highvram") ||
        obs.commandLineArgs.includes("--gpu-only")
      ) {
        return {
          eligible: false,
          candidateKey,
          blockerCode: "runtime_optimizer_mismatch",
          message:
            'Candidate requires model offloading, but commandLineArgs specifies "--highvram" or "--gpu-only"'
        };
      }
    }
    if (spec.runnerSettings.offloadPolicy === "dynamicvram") {
      if (
        obs.commandLineArgs.includes("--highvram") ||
        obs.commandLineArgs.includes("--gpu-only")
      ) {
        return {
          eligible: false,
          candidateKey,
          blockerCode: "runtime_optimizer_mismatch",
          message:
            'Candidate specifies "dynamicvram" offload policy, but commandLineArgs specifies high VRAM mode'
        };
      }
    }
    if (spec.runnerSettings.offloadPolicy === "highvram") {
      if (
        obs.commandLineArgs.includes("--dynamicvram") ||
        obs.commandLineArgs.includes("--lowvram")
      ) {
        return {
          eligible: false,
          candidateKey,
          blockerCode: "runtime_optimizer_mismatch",
          message:
            'Candidate specifies "highvram" offload policy, but commandLineArgs specifies dynamic/low VRAM mode'
        };
      }
    }
    if (spec.runnerSettings.offloadPolicy === "cpu_offload") {
      if (
        obs.commandLineArgs.includes("--highvram") ||
        obs.commandLineArgs.includes("--gpu-only")
      ) {
        return {
          eligible: false,
          candidateKey,
          blockerCode: "runtime_optimizer_mismatch",
          message:
            'Candidate specifies "cpu_offload" policy, but commandLineArgs specifies high VRAM mode'
        };
      }
    }

    // Attention spec verification
    if (spec.attention.backend !== "sdpa") {
      if (spec.attention.packageVersion !== "none") {
        const pkgName =
          spec.attention.backend === "sage_attn"
            ? "sageattention"
            : spec.attention.backend === "flash_attn"
              ? "flash_attn"
              : spec.attention.backend;
        const observedPkgVer =
          obs.packageVersions[pkgName] ??
          (pkgName === "flash_attn" ? obs.packageVersions["flash-attn"] : undefined);
        if (!observedPkgVer || observedPkgVer !== spec.attention.packageVersion) {
          return {
            eligible: false,
            candidateKey,
            blockerCode: "runtime_optimizer_mismatch",
            message: `Attention package "${pkgName}" version mismatch: expected "${spec.attention.packageVersion}", observed "${observedPkgVer ?? "missing"}"`
          };
        }
      }
      if (spec.attention.customNodeRevision !== "none") {
        const matchingNode = Object.values(obs.customNodes).find(
          (n) => n.revision === spec.attention.customNodeRevision
        );
        if (!matchingNode) {
          return {
            eligible: false,
            candidateKey,
            blockerCode: "runtime_optimizer_mismatch",
            message: `Attention custom node with revision "${spec.attention.customNodeRevision}" not found in observed runtime custom nodes`
          };
        }
        if (
          spec.attention.customNodeSourceHash !== "none" &&
          matchingNode.sourceHash !== spec.attention.customNodeSourceHash
        ) {
          return {
            eligible: false,
            candidateKey,
            blockerCode: "runtime_optimizer_mismatch",
            message: `Attention custom node sourceHash mismatch: expected "${spec.attention.customNodeSourceHash}", observed "${matchingNode.sourceHash}"`
          };
        }
      }
    }

    // Attention sparsity verification
    if (spec.attention.sparsitySettings.enabled) {
      const method = spec.attention.sparsitySettings.method;
      const methodObserved =
        obs.commandLineArgs.some((arg) => arg.includes(method)) ||
        Object.keys(obs.customNodes).some((n) => n.includes(method)) ||
        Object.keys(obs.packageVersions).some((p) => p.includes(method));
      if (!methodObserved) {
        return {
          eligible: false,
          candidateKey,
          blockerCode: "runtime_optimizer_mismatch",
          message: `Required attention sparsity method "${method}" is not reflected in observed runtime`
        };
      }
    } else {
      if (
        obs.commandLineArgs.some((arg) => arg.includes("--sparse") || arg.includes("--sparsity"))
      ) {
        return {
          eligible: false,
          candidateKey,
          blockerCode: "runtime_optimizer_mismatch",
          message:
            "Candidate specifies sparsity disabled, but observed commandLineArgs contains sparsity flags"
        };
      }
    }

    // Verify custom nodes in observed runtime
    for (const node of spec.customNodes) {
      const observedNode = obs.customNodes[node.name];
      if (!observedNode) {
        return {
          eligible: false,
          candidateKey,
          blockerCode: "runtime_optimizer_mismatch",
          message: `Required custom node "${node.name}" is missing in observed runtime`
        };
      }
      if (observedNode.revision !== node.revision || observedNode.sourceHash !== node.sourceHash) {
        return {
          eligible: false,
          candidateKey,
          blockerCode: "runtime_optimizer_mismatch",
          message: `Custom node "${node.name}" revision/hash mismatch: expected rev=${node.revision}, hash=${node.sourceHash}; observed rev=${observedNode.revision}, hash=${observedNode.sourceHash}`
        };
      }
    }

    // Verify package versions in observed runtime
    for (const [pkg, expectedVer] of Object.entries(spec.packageVersions)) {
      const observedVer = obs.packageVersions[pkg];
      if (!observedVer || observedVer !== expectedVer) {
        return {
          eligible: false,
          candidateKey,
          blockerCode: "runtime_optimizer_mismatch",
          message: `Package "${pkg}" version mismatch: expected "${expectedVer}", observed "${observedVer ?? "missing"}"`
        };
      }
    }

    // Sampling and runner drift verification
    const execCtx = ctx;
    if (execCtx.steps !== undefined && execCtx.steps !== spec.steps) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "runtime_optimizer_mismatch",
        message: `Sampling steps mismatch: expected ${spec.steps}, got ${execCtx.steps}`
      };
    }
    if (execCtx.sampler !== undefined && execCtx.sampler !== spec.sampler) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "runtime_optimizer_mismatch",
        message: `Sampler mismatch: expected "${spec.sampler}", got "${execCtx.sampler}"`
      };
    }
    if (execCtx.scheduler !== undefined && execCtx.scheduler !== spec.scheduler) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "runtime_optimizer_mismatch",
        message: `Scheduler mismatch: expected "${spec.scheduler}", got "${execCtx.scheduler}"`
      };
    }
    if (
      execCtx.runnerProfile !== undefined &&
      execCtx.runnerProfile !== spec.runnerSettings.runnerProfile
    ) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "runtime_optimizer_mismatch",
        message: `Runner profile mismatch: expected "${spec.runnerSettings.runnerProfile}", got "${execCtx.runnerProfile}"`
      };
    }
    if (execCtx.cfg !== undefined && execCtx.cfg !== spec.cfg) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "runtime_optimizer_mismatch",
        message: `CFG mismatch: expected ${spec.cfg}, got ${execCtx.cfg}`
      };
    }
    if (execCtx.denoise !== undefined && execCtx.denoise !== spec.denoise) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "runtime_optimizer_mismatch",
        message: `Denoise mismatch: expected ${spec.denoise}, got ${execCtx.denoise}`
      };
    }

    // 8. Operator authorization grant verification
    // INVARIANT: Caller-supplied authorization claims cannot substitute for the authorization port.
    if (!request.authorizationGrant) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "missing_authorization_grant",
        message: "No operator authorization grant was provided"
      };
    }

    const grantPayload = request.authorizationGrant.payload;
    if (grantPayload.candidateKey !== candidate.key) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "candidate_unrecognized",
        message: `Grant candidateKey "${grantPayload.candidateKey}" does not match evaluated candidate "${candidate.key}"`
      };
    }

    if (grantPayload.specificationDigest !== candidate.specificationDigest) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "runtime_optimizer_mismatch",
        message: `Grant specificationDigest "${grantPayload.specificationDigest}" does not match candidate specification digest "${candidate.specificationDigest}"`
      };
    }

    if (grantPayload.targetHostname !== request.target.hostname) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "host_identity_mismatch",
        message: `Grant targetHostname "${grantPayload.targetHostname}" does not match target hostname "${request.target.hostname}"`
      };
    }

    if (grantPayload.targetGpuUuid !== request.target.gpuUuid) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "gpu_uuid_mismatch",
        message: `Grant targetGpuUuid "${grantPayload.targetGpuUuid}" does not match target GPU "${request.target.gpuUuid}"`
      };
    }

    if (grantPayload.purpose !== request.purpose) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "scope_insufficient_for_purpose",
        message: `Grant purpose "${grantPayload.purpose}" does not match requested purpose "${request.purpose}"`
      };
    }

    if (grantPayload.goldMasterWorkflowHash !== gm.workflowHash) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "gold_master_mismatch",
        message: `Grant goldMasterWorkflowHash "${grantPayload.goldMasterWorkflowHash}" does not match gold master workflow hash "${gm.workflowHash}"`
      };
    }

    const computedGmModelDigest = computeModelHashesDigest(gm.modelHashes);
    if (grantPayload.goldMasterModelHashesDigest !== computedGmModelDigest) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "gold_master_mismatch",
        message: `Grant goldMasterModelHashesDigest "${grantPayload.goldMasterModelHashesDigest}" does not match computed gold master model hashes digest "${computedGmModelDigest}"`
      };
    }

    const authResult = await this.authorizationPort.verifyCandidateAuthorization({
      grant: request.authorizationGrant,
      candidateKey: candidate.key,
      specificationDigest: candidate.specificationDigest,
      goldMasterWorkflowHash: gm.workflowHash,
      goldMasterModelHashesDigest: computeModelHashesDigest(gm.modelHashes),
      targetHostname: request.target.hostname,
      targetGpuUuid: request.target.gpuUuid,
      purpose: request.purpose
    });

    if (!authResult.authorized) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "authorization_denied",
        message: authResult.blocker ?? "Operator authorization port denied execution"
      };
    }

    if (request.purpose === "production" && authResult.scope !== "production") {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "scope_insufficient_for_purpose",
        message: 'A staging-scope grant cannot be used for "production" purpose'
      };
    }

    // 9. Post-authorization anti-drift check: verify process continuity
    try {
      const continuity = await this.runtimeObservationPort.verifyProcessContinuity(
        obs.pid,
        obs.processStartTimeTicks
      );
      if (!continuity.continuous) {
        return {
          eligible: false,
          candidateKey,
          blockerCode: "process_continuity_lost",
          message: continuity.blocker ?? "Target process drifted or restarted during verification"
        };
      }
    } catch (err) {
      return {
        eligible: false,
        candidateKey,
        blockerCode: "process_continuity_lost",
        message: `Failed to verify process continuity: ${err instanceof Error ? err.message : String(err)}`
      };
    }

    return {
      eligible: true,
      candidateKey: candidate.key,
      scope: authResult.scope ?? "staging",
      specificationDigest: candidate.specificationDigest
    };
  }
}

/**
 * Production factory for H3CandidateEligibilityService.
 * Closes over the immutable shared production catalog and trusted infrastructure adapters.
 * Does NOT permit caller replacement of the candidate registry.
 */
export function createProductionH3CandidateEligibilityService(dependencies: {
  authorizationPort: H3CandidateAuthorizationPort;
  runtimeObservationPort: H3RuntimeObservationPort;
}): H3CandidateEligibilityService {
  return new H3CandidateEligibilityService({
    authorizationPort: dependencies.authorizationPort,
    runtimeObservationPort: dependencies.runtimeObservationPort,
    registryReader: {
      getCandidateProfile: getH3CandidateProfile,
      listCandidateProfiles: listH3CandidateProfiles
    }
  });
}
