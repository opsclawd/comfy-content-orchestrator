import type { CertificationEnvironment } from "@cco/contracts";
import type { CertificationProfile, CertificationProvenanceReport } from "@cco/infrastructure";

export class PreflightError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PreflightError";
  }
}

export interface VerifyGoldMasterProvenanceOptions {
  readonly approved: unknown;
  readonly live: CertificationProvenanceReport;
  readonly profile: CertificationProfile;
}

export type HardwareClassificationStatus = "ready" | "unsupported" | "refused";

export type HardwareClassificationResult =
  | {
      readonly status: "ready";
      readonly gpuName: "NVIDIA GeForce RTX 4090";
    }
  | {
      readonly status: "unsupported";
      readonly reason: string;
    }
  | {
      readonly status: "refused";
      readonly reason: string;
    };

export interface VerifyComfyUiMemoryModeOptions {
  readonly runnerMode: "dynamicvram" | "highvram";
  readonly comfyUiArgs: readonly string[];
}

const REQUIRED_GPU_NAME = "NVIDIA GeForce RTX 4090";

const EXPLICIT_VRAM_FLAGS = [
  "--highvram",
  "--gpu-only",
  "--lowvram",
  "--novram",
  "--normalvram",
  "--cpu"
] as const;

const HIGHVRAM_CONFLICT_FLAGS = [
  "--gpu-only",
  "--lowvram",
  "--novram",
  "--normalvram",
  "--cpu"
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function matchesFlag(arg: string, flag: string): boolean {
  return arg === flag || arg.startsWith(`${flag}=`);
}

function findMatchingFlags(args: readonly string[], flags: readonly string[]): string[] {
  const matched: string[] = [];
  for (const arg of args) {
    for (const flag of flags) {
      if (matchesFlag(arg, flag)) {
        matched.push(arg);
      }
    }
  }
  return matched;
}

/**
 * Validates the loaded profile and workflow assertions for the exact certified LTX 2.5 workload.
 */
function verifyProfileWorkload(profile: CertificationProfile): void {
  if (!isRecord(profile)) {
    throw new PreflightError("Certification profile must be a valid object");
  }

  if (profile.id === "ltx-25-720p-97f" && profile.engine !== "ltx_25") {
    throw new PreflightError(`Invalid profile engine "${profile.engine}": expected "ltx_25"`);
  }
  if (profile.id === "flux-schnell-draft" && profile.engine !== "flux_schnell") {
    throw new PreflightError(`Invalid profile engine "${profile.engine}": expected "flux_schnell"`);
  }

  if (profile.engine === "ltx_25") {
    if (profile.id !== "ltx-25-720p-97f") {
      throw new PreflightError(`Invalid profile ID "${profile.id}": expected "ltx-25-720p-97f"`);
    }
    if (profile.baseline.width !== 1280) {
      throw new PreflightError(
        `Invalid baseline width ${String(profile.baseline.width)}: expected 1280`
      );
    }
    if (profile.baseline.height !== 720) {
      throw new PreflightError(
        `Invalid baseline height ${String(profile.baseline.height)}: expected 720`
      );
    }
    if (profile.baseline.frames !== 97) {
      throw new PreflightError(
        `Invalid baseline frames ${String(profile.baseline.frames)}: expected 97`
      );
    }
    if (profile.baseline.steps !== 8) {
      throw new PreflightError(
        `Invalid baseline steps ${String(profile.baseline.steps)}: expected 8`
      );
    }
    if (
      profile.renderProfileIdentity === null ||
      profile.renderProfileIdentity.key !== "LTX_25_720P_5S_V1" ||
      profile.renderProfileIdentity.version !== 1
    ) {
      throw new PreflightError(
        `Invalid renderProfileIdentity: expected key "LTX_25_720P_5S_V1" version 1`
      );
    }
    const assertions = profile.assertions;
    if (!Array.isArray(assertions) || assertions.length === 0) {
      throw new PreflightError(`Profile "${profile.id}" must define workflow assertions`);
    }
    if (!assertions.find((a) => a.input === "steps" && a.equals === 8)) {
      throw new PreflightError(
        `Profile "${profile.id}" is missing required workflow assertion for steps = 8`
      );
    }
    if (!assertions.find((a) => a.input === "width" && a.equals === 1280)) {
      throw new PreflightError(
        `Profile "${profile.id}" is missing required workflow assertion for width = 1280`
      );
    }
    if (!assertions.find((a) => a.input === "height" && a.equals === 720)) {
      throw new PreflightError(
        `Profile "${profile.id}" is missing required workflow assertion for height = 720`
      );
    }
    if (
      !assertions.find((a) => (a.input === "length" || a.input === "frames") && a.equals === 97)
    ) {
      throw new PreflightError(
        `Profile "${profile.id}" is missing required workflow assertion for frames/length = 97`
      );
    }
  } else if (profile.engine === "flux_schnell") {
    if (profile.id !== "flux-schnell-draft") {
      throw new PreflightError(`Invalid profile ID "${profile.id}": expected "flux-schnell-draft"`);
    }
    if (profile.baseline.width !== 1024) {
      throw new PreflightError(
        `Invalid baseline width ${String(profile.baseline.width)}: expected 1024`
      );
    }
    if (profile.baseline.height !== 1024) {
      throw new PreflightError(
        `Invalid baseline height ${String(profile.baseline.height)}: expected 1024`
      );
    }
    if (profile.baseline.frames !== 1) {
      throw new PreflightError(
        `Invalid baseline frames ${String(profile.baseline.frames)}: expected 1`
      );
    }
    if (profile.baseline.steps !== 4) {
      throw new PreflightError(
        `Invalid baseline steps ${String(profile.baseline.steps)}: expected 4`
      );
    }
    if (
      profile.renderProfileIdentity === null ||
      profile.renderProfileIdentity.key !== "FLUX_SCHNELL_DRAFT_V1" ||
      profile.renderProfileIdentity.version !== 1
    ) {
      throw new PreflightError(
        `Invalid renderProfileIdentity: expected key "FLUX_SCHNELL_DRAFT_V1" version 1`
      );
    }
    const assertions = profile.assertions;
    if (!Array.isArray(assertions) || assertions.length === 0) {
      throw new PreflightError(`Profile "${profile.id}" must define workflow assertions`);
    }
    if (!assertions.find((a) => a.input === "steps" && a.equals === 4)) {
      throw new PreflightError(
        `Profile "${profile.id}" is missing required workflow assertion for steps = 4`
      );
    }
    if (!assertions.find((a) => a.input === "width" && a.equals === 1024)) {
      throw new PreflightError(
        `Profile "${profile.id}" is missing required workflow assertion for width = 1024`
      );
    }
    if (!assertions.find((a) => a.input === "height" && a.equals === 1024)) {
      throw new PreflightError(
        `Profile "${profile.id}" is missing required workflow assertion for height = 1024`
      );
    }
  }
}

/**
 * Validates the approved Gold Master provenance report.
 */
function validateApprovedReport(
  approved: unknown,
  profile: CertificationProfile
): CertificationProvenanceReport {
  if (!isRecord(approved)) {
    throw new PreflightError("Approved Gold Master provenance must be a valid JSON object");
  }

  if (approved.version !== 1) {
    throw new PreflightError(
      `Approved provenance has unsupported version: ${String(approved.version)}`
    );
  }

  if (approved.profileId !== profile.id) {
    throw new PreflightError(
      `Approved provenance profileId "${String(approved.profileId)}" does not match required "${profile.id}"`
    );
  }

  if (!isRecord(approved.workflow)) {
    throw new PreflightError("Approved provenance is missing workflow metadata object");
  }

  const { workflow } = approved;
  if (typeof workflow.sha256 !== "string" || workflow.sha256.trim().length === 0) {
    throw new PreflightError("Approved provenance workflow must contain a valid sha256 hash");
  }

  if (!isRecord(workflow.source)) {
    throw new PreflightError("Approved provenance workflow is missing source metadata");
  }

  const { kind, revision, uri, license } = workflow.source;

  if (kind !== "validated_host_export") {
    throw new PreflightError(
      `Approved provenance source.kind must be "validated_host_export", got "${String(kind)}"`
    );
  }

  if (typeof revision !== "string" || revision.trim().length === 0 || revision === "unpinned") {
    throw new PreflightError(
      `Approved provenance must have an immutable pinned revision, got: "${String(revision)}"`
    );
  }

  if (typeof uri !== "string" || uri.trim().length === 0) {
    throw new PreflightError("Approved provenance source.uri must be non-empty");
  }

  if (typeof license !== "string" || license.trim().length === 0) {
    throw new PreflightError("Approved provenance source.license must be non-empty");
  }

  if (!isRecord(approved.renderProfileProvenance)) {
    throw new PreflightError("Approved provenance is missing renderProfileProvenance");
  }

  const rpp = approved.renderProfileProvenance;
  if (
    (rpp.key !== "LTX_25_720P_5S_V1" && rpp.key !== "FLUX_SCHNELL_DRAFT_V1") ||
    rpp.version !== 1
  ) {
    throw new PreflightError(
      `Approved provenance renderProfileProvenance identity mismatch: ${JSON.stringify(rpp)}`
    );
  }

  if (!isRecord(rpp.modelHashes)) {
    throw new PreflightError(
      "Approved provenance renderProfileProvenance.modelHashes must be an object"
    );
  }

  return approved as unknown as CertificationProvenanceReport;
}

/**
 * Pure function to verify that approved Gold Master provenance matches live provenance and the certified profile.
 * Throws PreflightError on any drift, mismatch, or invalid workload specification.
 */
export function verifyGoldMasterProvenance(
  approvedOrOptions: unknown | VerifyGoldMasterProvenanceOptions,
  liveArg?: CertificationProvenanceReport,
  profileArg?: CertificationProfile
): void {
  let approved: unknown;
  let live: CertificationProvenanceReport;
  let profile: CertificationProfile;

  if (
    isRecord(approvedOrOptions) &&
    "approved" in approvedOrOptions &&
    "live" in approvedOrOptions &&
    "profile" in approvedOrOptions
  ) {
    const opts = approvedOrOptions as unknown as VerifyGoldMasterProvenanceOptions;
    approved = opts.approved;
    live = opts.live;
    profile = opts.profile;
  } else {
    approved = approvedOrOptions;
    live = liveArg!;
    profile = profileArg!;
  }

  // 1. Verify profile workload invariants
  verifyProfileWorkload(profile);

  // 2. Validate approved report structure and host-validated source
  const approvedReport = validateApprovedReport(approved, profile);

  // 3. Verify live report structure
  if (!isRecord(live)) {
    throw new PreflightError("Live provenance must be a valid object");
  }

  if (live.profileId !== profile.id) {
    throw new PreflightError(
      `Live provenance profileId "${live.profileId}" does not match profile ID "${profile.id}"`
    );
  }

  if (!isRecord(live.renderProfileProvenance)) {
    throw new PreflightError("Live provenance is missing renderProfileProvenance");
  }

  const liveRpp = live.renderProfileProvenance;
  const approvedRpp = approvedReport.renderProfileProvenance!;

  if (liveRpp.key !== approvedRpp.key) {
    throw new PreflightError(
      `Render profile key mismatch: approved "${approvedRpp.key}", live "${liveRpp.key}"`
    );
  }

  if (liveRpp.version !== approvedRpp.version) {
    throw new PreflightError(
      `Render profile version mismatch: approved ${approvedRpp.version}, live ${liveRpp.version}`
    );
  }

  if (liveRpp.engine !== approvedRpp.engine) {
    throw new PreflightError(
      `Render profile engine mismatch: approved "${approvedRpp.engine}", live "${liveRpp.engine}"`
    );
  }

  if (liveRpp.frames !== approvedRpp.frames) {
    throw new PreflightError(
      `Render profile frames mismatch: approved ${approvedRpp.frames}, live ${liveRpp.frames}`
    );
  }

  if (liveRpp.steps !== approvedRpp.steps) {
    throw new PreflightError(
      `Render profile steps mismatch: approved ${approvedRpp.steps}, live ${liveRpp.steps}`
    );
  }

  // 4. Verify workflow hash exact match
  if (live.workflow.sha256 !== approvedReport.workflow.sha256) {
    throw new PreflightError(
      `Workflow hash mismatch between approved (${approvedReport.workflow.sha256}) and live (${live.workflow.sha256})`
    );
  }

  if (live.workflow.sha256 !== profile.expectedWorkflowHash) {
    throw new PreflightError(
      `Workflow hash mismatch: live (${live.workflow.sha256}) does not match profile expected (${profile.expectedWorkflowHash})`
    );
  }

  if (liveRpp.workflowHash !== approvedRpp.workflowHash) {
    throw new PreflightError(
      `Render profile workflow hash mismatch: approved (${approvedRpp.workflowHash}), live (${liveRpp.workflowHash})`
    );
  }

  // 5. Verify complete keyed model hash set exact match
  const approvedModelHashes = approvedRpp.modelHashes;
  const liveModelHashes = liveRpp.modelHashes;

  const approvedKeys = Object.keys(approvedModelHashes).sort();
  const liveKeys = Object.keys(liveModelHashes).sort();

  if (approvedKeys.length === 0) {
    throw new PreflightError(
      "Approved provenance contains no model hashes in renderProfileProvenance"
    );
  }

  // Check for missing model keys in live
  for (const key of approvedKeys) {
    if (!(key in liveModelHashes)) {
      throw new PreflightError(`Live provenance is missing model hash for key: "${key}"`);
    }
  }

  // Check for extra model keys in live
  for (const key of liveKeys) {
    if (!(key in approvedModelHashes)) {
      throw new PreflightError(
        `Live provenance contains unexpected extra model hash for key: "${key}"`
      );
    }
  }

  // Exact hash comparison for every keyed model
  for (const key of approvedKeys) {
    const approvedHash = approvedModelHashes[key];
    const liveHash = liveModelHashes[key];

    if (approvedHash !== liveHash) {
      throw new PreflightError(
        `Model hash mismatch for key "${key}": approved "${approvedHash}", live "${liveHash}"`
      );
    }
  }
}

/**
 * Classifies whether the host environment and GPU hardware are certification-ready, unsupported, or refused.
 */
export function classifyCertificationHardware(
  environmentOrError?: unknown
): HardwareClassificationResult {
  if (environmentOrError === null || environmentOrError === undefined) {
    return {
      status: "unsupported",
      reason: "No hardware environment information was provided"
    };
  }

  if (environmentOrError instanceof Error) {
    const message = environmentOrError.message;
    const lower = message.toLowerCase();

    if (
      lower.includes("nvidia-smi") ||
      lower.includes("enoent") ||
      lower.includes("not found") ||
      lower.includes("unavailable") ||
      lower.includes("did not return gpu")
    ) {
      return {
        status: "unsupported",
        reason: `NVIDIA tooling or GPU query unavailable: ${message}`
      };
    }

    return {
      status: "refused",
      reason: `Configuration or environment inspection failed: ${message}`
    };
  }

  if (!isRecord(environmentOrError)) {
    return {
      status: "unsupported",
      reason: "Malformed environment data provided"
    };
  }

  const env = environmentOrError as Partial<CertificationEnvironment>;

  // Check platform
  if (env.platform !== undefined && env.platform !== "linux") {
    return {
      status: "unsupported",
      reason: `Certification host platform must be "linux", found: "${env.platform}"`
    };
  }

  // Check ComfyUI PID configuration validity
  if (env.comfyUiPid !== undefined && (!Number.isInteger(env.comfyUiPid) || env.comfyUiPid <= 0)) {
    return {
      status: "refused",
      reason: `Invalid ComfyUI PID: ${String(env.comfyUiPid)}`
    };
  }

  // Check GPU name
  const gpuName = env.gpuName;
  if (typeof gpuName !== "string" || gpuName.trim().length === 0) {
    return {
      status: "unsupported",
      reason: "GPU identity is missing or empty"
    };
  }

  if (gpuName !== REQUIRED_GPU_NAME) {
    return {
      status: "unsupported",
      reason: `Only "${REQUIRED_GPU_NAME}" is certification-capable; host has: "${gpuName}"`
    };
  }

  return {
    status: "ready",
    gpuName: REQUIRED_GPU_NAME
  };
}

/**
 * Verifies ComfyUI startup memory arguments for DynamicVRAM or HighVRAM mode.
 * Throws PreflightError if conflicting or missing flags are encountered.
 */
export function verifyComfyUiMemoryMode(
  modeOrOptions: "dynamicvram" | "highvram" | VerifyComfyUiMemoryModeModeOptions,
  comfyUiArgsArg?: readonly string[]
): void {
  let runnerMode: "dynamicvram" | "highvram";
  let comfyUiArgs: readonly string[];

  if (isRecord(modeOrOptions) && "runnerMode" in modeOrOptions) {
    runnerMode = modeOrOptions.runnerMode as "dynamicvram" | "highvram";
    comfyUiArgs = (modeOrOptions as VerifyComfyUiMemoryModeOptions).comfyUiArgs ?? [];
  } else {
    runnerMode = modeOrOptions as "dynamicvram" | "highvram";
    comfyUiArgs = comfyUiArgsArg ?? [];
  }

  if (runnerMode === "dynamicvram") {
    const conflicting = findMatchingFlags(comfyUiArgs, EXPLICIT_VRAM_FLAGS);
    if (conflicting.length > 0) {
      throw new PreflightError(
        `DynamicVRAM mode requires default ComfyUI memory management, but explicit VRAM flags were found: ${conflicting.join(", ")}`
      );
    }
  } else if (runnerMode === "highvram") {
    const hasHighVram = comfyUiArgs.some((arg) => matchesFlag(arg, "--highvram"));
    if (!hasHighVram) {
      throw new PreflightError(
        "HighVRAM comparator mode requires the --highvram flag in ComfyUI arguments"
      );
    }

    const conflicting = findMatchingFlags(comfyUiArgs, HIGHVRAM_CONFLICT_FLAGS);
    if (conflicting.length > 0) {
      throw new PreflightError(
        `HighVRAM comparator mode prohibits conflicting VRAM flags: ${conflicting.join(", ")}`
      );
    }
  } else {
    throw new PreflightError(`Unsupported runner mode: ${String(runnerMode)}`);
  }
}

type VerifyComfyUiMemoryModeModeOptions = VerifyComfyUiMemoryModeOptions;
