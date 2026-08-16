import type { CertificationProfile, CertificationProvenanceReport } from "@cco/infrastructure";
import { PreflightError } from "./preflight.js";

export { PreflightError };

export interface VerifyTransitionGoldMastersOptions {
  readonly profiles:
    | {
        readonly flux?: CertificationProfile;
        readonly ltx?: CertificationProfile;
        readonly "flux-schnell-draft"?: CertificationProfile;
        readonly "ltx-25-720p-97f"?: CertificationProfile;
      }
    | readonly CertificationProfile[]
    | Record<string, CertificationProfile>;
  readonly approved:
    | {
        readonly flux?: unknown;
        readonly ltx?: unknown;
        readonly "flux-schnell-draft"?: unknown;
        readonly "ltx-25-720p-97f"?: unknown;
      }
    | readonly unknown[]
    | Record<string, unknown>;
  readonly live:
    | {
        readonly flux?: CertificationProvenanceReport;
        readonly ltx?: CertificationProvenanceReport;
        readonly "flux-schnell-draft"?: CertificationProvenanceReport;
        readonly "ltx-25-720p-97f"?: CertificationProvenanceReport;
      }
    | readonly CertificationProvenanceReport[]
    | Record<string, CertificationProvenanceReport>;
}

const REQUIRED_RUNNER_PROFILE = "dynamicvram-offload-v1";

const FLUX_PROFILE_ID = "flux-schnell-draft";
const FLUX_ENGINE = "flux_schnell";
const FLUX_WIDTH = 1024;
const FLUX_HEIGHT = 1024;
const FLUX_STEPS = 4;

const LTX_PROFILE_ID = "ltx-25-720p-97f";
const LTX_ENGINE = "ltx_25";
const LTX_WIDTH = 1280;
const LTX_HEIGHT = 720;
const LTX_FRAMES = 97;
const LTX_STEPS = 8;
const LTX_RENDER_PROFILE_KEY = "LTX_25_720P_5S_V1";
const LTX_RENDER_PROFILE_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolveProfile(
  container: unknown,
  profileId: string,
  alias: string
): CertificationProfile | undefined {
  if (Array.isArray(container)) {
    return container.find((item) => isRecord(item) && item.id === profileId) as
      CertificationProfile | undefined;
  }
  if (isRecord(container)) {
    if (profileId in container && container[profileId] !== undefined) {
      return container[profileId] as CertificationProfile;
    }
    if (alias in container && container[alias] !== undefined) {
      return container[alias] as CertificationProfile;
    }
    for (const val of Object.values(container)) {
      if (isRecord(val) && val.id === profileId) {
        return val as unknown as CertificationProfile;
      }
    }
  }
  return undefined;
}

function resolveReport(container: unknown, profileId: string, alias: string): unknown | undefined {
  if (Array.isArray(container)) {
    return container.find((item) => isRecord(item) && item.profileId === profileId);
  }
  if (isRecord(container)) {
    if (profileId in container && container[profileId] !== undefined) {
      return container[profileId];
    }
    if (alias in container && container[alias] !== undefined) {
      return container[alias];
    }
    for (const val of Object.values(container)) {
      if (isRecord(val) && val.profileId === profileId) {
        return val;
      }
    }
  }
  return undefined;
}

function verifySource(source: unknown, profileId: string): void {
  if (!isRecord(source)) {
    throw new PreflightError(`Profile "${profileId}" is missing source metadata`);
  }
  const { kind, revision, uri, license } = source;
  if (kind !== "validated_host_export") {
    throw new PreflightError(
      `Profile "${profileId}" source.kind must be "validated_host_export", got "${String(kind)}"`
    );
  }
  if (typeof revision !== "string" || revision.trim().length === 0 || revision === "unpinned") {
    throw new PreflightError(
      `Profile "${profileId}" must have an immutable pinned revision, got "${String(revision)}"`
    );
  }
  if (typeof uri !== "string" || uri.trim().length === 0) {
    throw new PreflightError(`Profile "${profileId}" source.uri must be non-empty`);
  }
  if (typeof license !== "string" || license.trim().length === 0) {
    throw new PreflightError(`Profile "${profileId}" source.license must be non-empty`);
  }
}

function verifyFluxProfile(profile: CertificationProfile): void {
  if (!isRecord(profile)) {
    throw new PreflightError("FLUX certification profile must be a valid object");
  }

  if (profile.id !== FLUX_PROFILE_ID) {
    throw new PreflightError(
      `Invalid FLUX profile ID "${profile.id}": expected "${FLUX_PROFILE_ID}"`
    );
  }

  if (profile.engine !== FLUX_ENGINE) {
    throw new PreflightError(`Invalid FLUX engine "${profile.engine}": expected "${FLUX_ENGINE}"`);
  }

  if (profile.runnerProfile !== REQUIRED_RUNNER_PROFILE) {
    throw new PreflightError(
      `Profile "${profile.id}" must have runnerProfile "${REQUIRED_RUNNER_PROFILE}", got "${profile.runnerProfile}"`
    );
  }

  verifySource(profile.source, profile.id);

  if (!isRecord(profile.baseline)) {
    throw new PreflightError(`Profile "${profile.id}" baseline must be a valid object`);
  }

  if (profile.baseline.width !== FLUX_WIDTH) {
    throw new PreflightError(
      `Invalid FLUX baseline width ${String(profile.baseline.width)}: expected ${FLUX_WIDTH}`
    );
  }

  if (profile.baseline.height !== FLUX_HEIGHT) {
    throw new PreflightError(
      `Invalid FLUX baseline height ${String(profile.baseline.height)}: expected ${FLUX_HEIGHT}`
    );
  }

  if (profile.baseline.steps !== FLUX_STEPS) {
    throw new PreflightError(
      `Invalid FLUX baseline steps ${String(profile.baseline.steps)}: expected ${FLUX_STEPS}`
    );
  }

  if (profile.renderProfileIdentity !== null) {
    throw new PreflightError(
      `Profile "${profile.id}" must have renderProfileIdentity: null, got ${JSON.stringify(profile.renderProfileIdentity)}`
    );
  }

  const assertions = profile.assertions;
  if (!Array.isArray(assertions) || assertions.length === 0) {
    throw new PreflightError(`Profile "${profile.id}" must define workflow assertions`);
  }

  const stepsAssertion = assertions.find((a) => a.input === "steps" && a.equals === FLUX_STEPS);
  if (!stepsAssertion) {
    throw new PreflightError(
      `Profile "${profile.id}" is missing required workflow assertion for steps = ${FLUX_STEPS}`
    );
  }

  const widthAssertion = assertions.find((a) => a.input === "width" && a.equals === FLUX_WIDTH);
  if (!widthAssertion) {
    throw new PreflightError(
      `Profile "${profile.id}" is missing required workflow assertion for width = ${FLUX_WIDTH}`
    );
  }

  const heightAssertion = assertions.find((a) => a.input === "height" && a.equals === FLUX_HEIGHT);
  if (!heightAssertion) {
    throw new PreflightError(
      `Profile "${profile.id}" is missing required workflow assertion for height = ${FLUX_HEIGHT}`
    );
  }
}

function verifyLtxProfile(profile: CertificationProfile): void {
  if (!isRecord(profile)) {
    throw new PreflightError("LTX certification profile must be a valid object");
  }

  if (profile.id !== LTX_PROFILE_ID) {
    throw new PreflightError(
      `Invalid LTX profile ID "${profile.id}": expected "${LTX_PROFILE_ID}"`
    );
  }

  if (profile.engine !== LTX_ENGINE) {
    throw new PreflightError(`Invalid LTX engine "${profile.engine}": expected "${LTX_ENGINE}"`);
  }

  if (profile.runnerProfile !== REQUIRED_RUNNER_PROFILE) {
    throw new PreflightError(
      `Profile "${profile.id}" must have runnerProfile "${REQUIRED_RUNNER_PROFILE}", got "${profile.runnerProfile}"`
    );
  }

  verifySource(profile.source, profile.id);

  if (!isRecord(profile.baseline)) {
    throw new PreflightError(`Profile "${profile.id}" baseline must be a valid object`);
  }

  if (profile.baseline.width !== LTX_WIDTH) {
    throw new PreflightError(
      `Invalid LTX baseline width ${String(profile.baseline.width)}: expected ${LTX_WIDTH}`
    );
  }

  if (profile.baseline.height !== LTX_HEIGHT) {
    throw new PreflightError(
      `Invalid LTX baseline height ${String(profile.baseline.height)}: expected ${LTX_HEIGHT}`
    );
  }

  if (profile.baseline.frames !== LTX_FRAMES) {
    throw new PreflightError(
      `Invalid LTX baseline frames ${String(profile.baseline.frames)}: expected ${LTX_FRAMES}`
    );
  }

  if (profile.baseline.steps !== LTX_STEPS) {
    throw new PreflightError(
      `Invalid LTX baseline steps ${String(profile.baseline.steps)}: expected ${LTX_STEPS}`
    );
  }

  if (!isRecord(profile.renderProfileIdentity)) {
    throw new PreflightError(
      `Profile "${profile.id}" has invalid renderProfileIdentity; expected key "${LTX_RENDER_PROFILE_KEY}" version ${LTX_RENDER_PROFILE_VERSION}`
    );
  }

  if (
    profile.renderProfileIdentity.key !== LTX_RENDER_PROFILE_KEY ||
    profile.renderProfileIdentity.version !== LTX_RENDER_PROFILE_VERSION
  ) {
    throw new PreflightError(
      `Invalid LTX renderProfileIdentity: expected key "${LTX_RENDER_PROFILE_KEY}" version ${LTX_RENDER_PROFILE_VERSION}, got key "${String(profile.renderProfileIdentity.key)}" version ${String(profile.renderProfileIdentity.version)}`
    );
  }

  const assertions = profile.assertions;
  if (!Array.isArray(assertions) || assertions.length === 0) {
    throw new PreflightError(`Profile "${profile.id}" must define workflow assertions`);
  }

  const stepsAssertion = assertions.find((a) => a.input === "steps" && a.equals === LTX_STEPS);
  if (!stepsAssertion) {
    throw new PreflightError(
      `Profile "${profile.id}" is missing required workflow assertion for steps = ${LTX_STEPS}`
    );
  }

  const widthAssertion = assertions.find((a) => a.input === "width" && a.equals === LTX_WIDTH);
  if (!widthAssertion) {
    throw new PreflightError(
      `Profile "${profile.id}" is missing required workflow assertion for width = ${LTX_WIDTH}`
    );
  }

  const heightAssertion = assertions.find((a) => a.input === "height" && a.equals === LTX_HEIGHT);
  if (!heightAssertion) {
    throw new PreflightError(
      `Profile "${profile.id}" is missing required workflow assertion for height = ${LTX_HEIGHT}`
    );
  }

  const framesAssertion = assertions.find(
    (a) => (a.input === "length" || a.input === "frames") && a.equals === LTX_FRAMES
  );
  if (!framesAssertion) {
    throw new PreflightError(
      `Profile "${profile.id}" is missing required workflow assertion for frames/length = ${LTX_FRAMES}`
    );
  }
}

function validateProvenanceReport(
  report: unknown,
  profile: CertificationProfile,
  kind: "Approved" | "Live"
): CertificationProvenanceReport {
  if (!isRecord(report)) {
    throw new PreflightError(
      `${kind} Gold Master provenance for "${profile.id}" must be a valid JSON object`
    );
  }

  if (report.version !== 1) {
    throw new PreflightError(
      `${kind} provenance for "${profile.id}" has unsupported version: ${String(report.version)}`
    );
  }

  if (report.profileId !== profile.id) {
    throw new PreflightError(
      `${kind} provenance profileId "${String(report.profileId)}" does not match "${profile.id}"`
    );
  }

  if (!isRecord(report.workflow)) {
    throw new PreflightError(
      `${kind} provenance for "${profile.id}" is missing workflow metadata object`
    );
  }

  const { workflow } = report;
  if (typeof workflow.sha256 !== "string" || workflow.sha256.trim().length === 0) {
    throw new PreflightError(
      `${kind} provenance for "${profile.id}" workflow must contain a valid sha256 hash`
    );
  }

  if (workflow.sha256 !== profile.expectedWorkflowHash) {
    throw new PreflightError(
      `${kind} provenance workflow hash for "${profile.id}" (${workflow.sha256}) does not match expected (${profile.expectedWorkflowHash})`
    );
  }

  verifySource(workflow.source, profile.id);

  if (!Array.isArray(report.models) || report.models.length === 0) {
    throw new PreflightError(
      `${kind} provenance for "${profile.id}" must contain a non-empty models array`
    );
  }

  for (const m of report.models) {
    if (
      !isRecord(m) ||
      typeof m.key !== "string" ||
      m.key.trim().length === 0 ||
      typeof m.sha256 !== "string" ||
      m.sha256.trim().length === 0
    ) {
      throw new PreflightError(
        `${kind} provenance for "${profile.id}" contains an invalid model entry`
      );
    }
  }

  if (!isRecord(report.git)) {
    throw new PreflightError(`${kind} provenance for "${profile.id}" is missing git provenance`);
  }

  const { comfyUiCommit, customNodes } = report.git;
  if (
    typeof comfyUiCommit !== "string" ||
    comfyUiCommit.trim().length === 0 ||
    comfyUiCommit === "unpinned"
  ) {
    throw new PreflightError(
      `${kind} provenance for "${profile.id}" must have an immutable ComfyUI commit hash, got "${String(comfyUiCommit)}"`
    );
  }

  if (!Array.isArray(customNodes)) {
    throw new PreflightError(
      `${kind} provenance for "${profile.id}" git.customNodes must be an array`
    );
  }

  for (const node of customNodes) {
    if (!isRecord(node) || typeof node.name !== "string" || node.name.trim().length === 0) {
      throw new PreflightError(
        `${kind} provenance for "${profile.id}" contains an invalid custom node entry`
      );
    }
  }

  if (profile.id === FLUX_PROFILE_ID) {
    if (report.renderProfileProvenance !== null) {
      throw new PreflightError(
        `${kind} provenance for FLUX profile "${profile.id}" must have renderProfileProvenance: null`
      );
    }
  } else if (profile.id === LTX_PROFILE_ID) {
    if (!isRecord(report.renderProfileProvenance)) {
      throw new PreflightError(
        `${kind} provenance for LTX profile "${profile.id}" is missing renderProfileProvenance`
      );
    }

    const rpp = report.renderProfileProvenance;
    if (
      rpp.key !== LTX_RENDER_PROFILE_KEY ||
      rpp.version !== LTX_RENDER_PROFILE_VERSION ||
      rpp.engine !== LTX_ENGINE ||
      rpp.frames !== LTX_FRAMES ||
      rpp.steps !== LTX_STEPS ||
      rpp.workflowHash !== profile.expectedWorkflowHash ||
      rpp.runnerProfile !== REQUIRED_RUNNER_PROFILE
    ) {
      throw new PreflightError(
        `${kind} provenance renderProfileProvenance mismatch for "${profile.id}": ${JSON.stringify(rpp)}`
      );
    }

    if (!isRecord(rpp.modelHashes)) {
      throw new PreflightError(
        `${kind} provenance renderProfileProvenance.modelHashes for "${profile.id}" must be an object`
      );
    }
  }

  return report as unknown as CertificationProvenanceReport;
}

function verifyFamilyPair(
  profile: CertificationProfile,
  approvedReport: CertificationProvenanceReport,
  liveReport: CertificationProvenanceReport
): void {
  // 1. Workflow hash matching across manifest, approved, live
  if (liveReport.workflow.sha256 !== approvedReport.workflow.sha256) {
    throw new PreflightError(
      `Workflow hash mismatch for "${profile.id}" between approved (${approvedReport.workflow.sha256}) and live (${liveReport.workflow.sha256})`
    );
  }

  if (liveReport.workflow.sha256 !== profile.expectedWorkflowHash) {
    throw new PreflightError(
      `Workflow hash mismatch for "${profile.id}": live (${liveReport.workflow.sha256}) does not match expected (${profile.expectedWorkflowHash})`
    );
  }

  // 2. RenderProfileProvenance verification
  if (profile.id === FLUX_PROFILE_ID) {
    if (liveReport.renderProfileProvenance !== null) {
      throw new PreflightError(
        `Live provenance for FLUX profile "${profile.id}" must have renderProfileProvenance: null`
      );
    }
  } else if (profile.id === LTX_PROFILE_ID) {
    if (!isRecord(liveReport.renderProfileProvenance)) {
      throw new PreflightError(
        `Live provenance for LTX profile "${profile.id}" is missing renderProfileProvenance`
      );
    }

    const liveRpp = liveReport.renderProfileProvenance;
    const approvedRpp = approvedReport.renderProfileProvenance!;

    if (liveRpp.key !== approvedRpp.key) {
      throw new PreflightError(
        `Render profile key mismatch for "${profile.id}": approved "${approvedRpp.key}", live "${liveRpp.key}"`
      );
    }

    if (liveRpp.version !== approvedRpp.version) {
      throw new PreflightError(
        `Render profile version mismatch for "${profile.id}": approved ${approvedRpp.version}, live ${liveRpp.version}`
      );
    }

    if (liveRpp.engine !== approvedRpp.engine) {
      throw new PreflightError(
        `Render profile engine mismatch for "${profile.id}": approved "${approvedRpp.engine}", live "${liveRpp.engine}"`
      );
    }

    if (liveRpp.frames !== approvedRpp.frames) {
      throw new PreflightError(
        `Render profile frames mismatch for "${profile.id}": approved ${approvedRpp.frames}, live ${liveRpp.frames}`
      );
    }

    if (liveRpp.steps !== approvedRpp.steps) {
      throw new PreflightError(
        `Render profile steps mismatch for "${profile.id}": approved ${approvedRpp.steps}, live ${liveRpp.steps}`
      );
    }

    if (liveRpp.runnerProfile !== REQUIRED_RUNNER_PROFILE) {
      throw new PreflightError(
        `Live render profile runnerProfile mismatch for "${profile.id}": expected "${REQUIRED_RUNNER_PROFILE}", got "${liveRpp.runnerProfile}"`
      );
    }

    if (liveRpp.workflowHash !== approvedRpp.workflowHash) {
      throw new PreflightError(
        `Render profile workflow hash mismatch for "${profile.id}": approved (${approvedRpp.workflowHash}), live (${liveRpp.workflowHash})`
      );
    }

    if (!isRecord(liveRpp.modelHashes)) {
      throw new PreflightError(
        `Live provenance renderProfileProvenance.modelHashes for "${profile.id}" must be an object`
      );
    }

    const approvedRppHashes = approvedRpp.modelHashes;
    const liveRppHashes = liveRpp.modelHashes;

    const approvedRppKeys = Object.keys(approvedRppHashes);
    const liveRppKeys = Object.keys(liveRppHashes);

    if (approvedRppKeys.length !== liveRppKeys.length) {
      throw new PreflightError(
        `Render profile model hash count mismatch for "${profile.id}": approved has ${approvedRppKeys.length}, live has ${liveRppKeys.length}`
      );
    }

    for (const key of approvedRppKeys) {
      if (!Object.prototype.hasOwnProperty.call(liveRppHashes, key)) {
        throw new PreflightError(`Live render profile missing model hash for key: "${key}"`);
      }
      if (approvedRppHashes[key] !== liveRppHashes[key]) {
        throw new PreflightError(
          `Render profile model hash mismatch for "${profile.id}" key "${key}": approved "${approvedRppHashes[key]}", live "${liveRppHashes[key]}"`
        );
      }
    }

    for (const key of liveRppKeys) {
      if (!Object.prototype.hasOwnProperty.call(approvedRppHashes, key)) {
        throw new PreflightError(
          `Live render profile contains unexpected extra model hash for key: "${key}"`
        );
      }
    }
  }

  // 3. Exact keyed model hash-set equality using report.models
  const approvedModelMap = new Map<string, string>();
  for (const m of approvedReport.models) {
    approvedModelMap.set(m.key, m.sha256);
  }

  const liveModelMap = new Map<string, string>();
  for (const m of liveReport.models) {
    liveModelMap.set(m.key, m.sha256);
  }

  if (approvedModelMap.size === 0) {
    throw new PreflightError(`Approved provenance for "${profile.id}" contains no model entries`);
  }

  // Check for missing models in live
  for (const key of approvedModelMap.keys()) {
    if (!liveModelMap.has(key)) {
      throw new PreflightError(
        `Live provenance for "${profile.id}" is missing model hash for key: "${key}"`
      );
    }
  }

  // Check for unexpected extra models in live
  for (const key of liveModelMap.keys()) {
    if (!approvedModelMap.has(key)) {
      throw new PreflightError(
        `Live provenance for "${profile.id}" contains unexpected extra model hash for key: "${key}"`
      );
    }
  }

  // Exact hash comparison
  for (const [key, approvedHash] of approvedModelMap.entries()) {
    const liveHash = liveModelMap.get(key);
    if (approvedHash !== liveHash) {
      throw new PreflightError(
        `Model hash mismatch for "${profile.id}" key "${key}": approved "${approvedHash}", live "${liveHash}"`
      );
    }
  }

  // 4. Git / ComfyUI / custom node revisions
  if (liveReport.git.comfyUiCommit !== approvedReport.git.comfyUiCommit) {
    throw new PreflightError(
      `ComfyUI commit revision drift for "${profile.id}": approved "${approvedReport.git.comfyUiCommit}", live "${liveReport.git.comfyUiCommit}"`
    );
  }

  const approvedNodes = approvedReport.git.customNodes ?? [];
  const liveNodes = liveReport.git.customNodes ?? [];

  if (approvedNodes.length !== liveNodes.length) {
    throw new PreflightError(
      `Custom node count mismatch for "${profile.id}": approved has ${approvedNodes.length}, live has ${liveNodes.length}`
    );
  }

  const liveNodeMap = new Map<string, { commit: string | null; status: string }>();
  for (const node of liveNodes) {
    liveNodeMap.set(node.name, { commit: node.commit, status: node.status });
  }

  for (const node of approvedNodes) {
    const liveNode = liveNodeMap.get(node.name);
    if (liveNode === undefined) {
      throw new PreflightError(
        `Live provenance for "${profile.id}" missing custom node: "${node.name}"`
      );
    }
    if (liveNode.commit !== node.commit || liveNode.status !== node.status) {
      throw new PreflightError(
        `Custom node "${node.name}" revision drift for "${profile.id}": approved "${String(node.commit)}", live "${String(liveNode.commit)}"`
      );
    }
  }
}

/**
 * Pure function to verify that approved Gold Master provenance matches live provenance
 * and certified manifest profiles for both FLUX and LTX model families before transition soak dispatch.
 * Throws PreflightError on any drift, mismatch, absent profile, or invalid workload specification.
 */
export function verifyTransitionGoldMasters(options: VerifyTransitionGoldMastersOptions): void {
  if (!isRecord(options)) {
    throw new PreflightError("VerifyTransitionGoldMasters options must be a valid object");
  }

  const { profiles, approved, live } = options;

  if (!profiles || !approved || !live) {
    throw new PreflightError(
      "VerifyTransitionGoldMasters requires profiles, approved, and live provenance options"
    );
  }

  // 1. Resolve and verify FLUX Gold Master
  const fluxProfile = resolveProfile(profiles, FLUX_PROFILE_ID, "flux");
  if (fluxProfile === undefined) {
    throw new PreflightError(`Missing required FLUX profile "${FLUX_PROFILE_ID}"`);
  }
  verifyFluxProfile(fluxProfile);

  const fluxApproved = resolveReport(approved, FLUX_PROFILE_ID, "flux");
  if (fluxApproved === undefined) {
    throw new PreflightError(
      `Missing required approved provenance for FLUX profile "${FLUX_PROFILE_ID}"`
    );
  }
  const fluxApprovedReport = validateProvenanceReport(fluxApproved, fluxProfile, "Approved");

  const fluxLive = resolveReport(live, FLUX_PROFILE_ID, "flux");
  if (fluxLive === undefined) {
    throw new PreflightError(
      `Missing required live provenance for FLUX profile "${FLUX_PROFILE_ID}"`
    );
  }
  const fluxLiveReport = validateProvenanceReport(fluxLive, fluxProfile, "Live");

  // 2. Resolve and verify LTX Gold Master
  const ltxProfile = resolveProfile(profiles, LTX_PROFILE_ID, "ltx");
  if (ltxProfile === undefined) {
    throw new PreflightError(`Missing required LTX profile "${LTX_PROFILE_ID}"`);
  }
  verifyLtxProfile(ltxProfile);

  const ltxApproved = resolveReport(approved, LTX_PROFILE_ID, "ltx");
  if (ltxApproved === undefined) {
    throw new PreflightError(
      `Missing required approved provenance for LTX profile "${LTX_PROFILE_ID}"`
    );
  }
  const ltxApprovedReport = validateProvenanceReport(ltxApproved, ltxProfile, "Approved");

  const ltxLive = resolveReport(live, LTX_PROFILE_ID, "ltx");
  if (ltxLive === undefined) {
    throw new PreflightError(
      `Missing required live provenance for LTX profile "${LTX_PROFILE_ID}"`
    );
  }
  const ltxLiveReport = validateProvenanceReport(ltxLive, ltxProfile, "Live");

  // 3. Verify FLUX live vs approved
  verifyFamilyPair(fluxProfile, fluxApprovedReport, fluxLiveReport);

  // 4. Verify LTX live vs approved
  verifyFamilyPair(ltxProfile, ltxApprovedReport, ltxLiveReport);

  // 5. Cross-family host revision consistency
  if (fluxLiveReport.git.comfyUiCommit !== ltxLiveReport.git.comfyUiCommit) {
    throw new PreflightError(
      `Live ComfyUI commit mismatch across families: FLUX has "${fluxLiveReport.git.comfyUiCommit}", LTX has "${ltxLiveReport.git.comfyUiCommit}"`
    );
  }

  const fluxLiveNodes = fluxLiveReport.git.customNodes ?? [];
  const ltxLiveNodes = ltxLiveReport.git.customNodes ?? [];

  if (fluxLiveNodes.length !== ltxLiveNodes.length) {
    throw new PreflightError(
      `Live custom node count mismatch across families: FLUX has ${fluxLiveNodes.length}, LTX has ${ltxLiveNodes.length}`
    );
  }

  const fluxLiveNodeMap = new Map<string, { commit: string | null; status: string }>();
  for (const node of fluxLiveNodes) {
    fluxLiveNodeMap.set(node.name, { commit: node.commit, status: node.status });
  }

  const ltxLiveNodeMap = new Map<string, { commit: string | null; status: string }>();
  for (const node of ltxLiveNodes) {
    ltxLiveNodeMap.set(node.name, { commit: node.commit, status: node.status });
  }

  for (const node of fluxLiveNodes) {
    const ltxNode = ltxLiveNodeMap.get(node.name);
    if (ltxNode === undefined) {
      throw new PreflightError(
        `Live custom node mismatch across families: LTX missing custom node "${node.name}"`
      );
    }
    if (ltxNode.commit !== node.commit || ltxNode.status !== node.status) {
      throw new PreflightError(
        `Live custom node "${node.name}" revision drift across families: FLUX has commit "${String(node.commit)}" (status "${node.status}"), LTX has commit "${String(ltxNode.commit)}" (status "${ltxNode.status}")`
      );
    }
  }

  for (const node of ltxLiveNodes) {
    if (!fluxLiveNodeMap.has(node.name)) {
      throw new PreflightError(
        `Live custom node mismatch across families: FLUX missing custom node "${node.name}"`
      );
    }
  }
}
