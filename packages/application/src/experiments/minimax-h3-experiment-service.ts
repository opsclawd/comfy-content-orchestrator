import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import {
  DEFAULT_MINIMAX_H3_EXPERIMENT_TIMEOUTS,
  MinimaxH3ExperimentTimeoutsSchema,
  getMinimaxH3FrameDurationInfo,
  MinimaxH3ExperimentDescriptorSchema,
  MinimaxH3ExperimentResultSchema,
  MinimaxH3ExperimentDescriptorV2Schema,
  MinimaxH3ExperimentResultV2Schema,
  MinimaxH3AnyExperimentDescriptorSchema,
  MinimaxH3StopPolicySchema,
  MinimaxH3VisualReviewSidecarSchema,
  validateMinimaxH3ExperimentFrameCount,
  createEmptyMinimaxH3MeasurementTemplate,
  createEmptyMinimaxH3MeasurementTemplateV2,
  computeDescriptorDigest,
  computeComparisonKey,
  PINNED_H3_CHECKPOINTS,
  FASTH3_ISOLATED_CORE_REVISION,
  FASTH3_COMFYUI_SOURCE_HASHES,
  PINNED_COMFYUI_NODES_PY_SHA256,
  PINNED_COMFYUI_NODES_MINIMAX_H3_PY_SHA256,
  buildRequiredRuntimeManifestFromAttentionCatalog,
  type MinimaxH3ExperimentDescriptor,
  type MinimaxH3ExperimentDescriptorV2,
  type MinimaxH3AnyExperimentDescriptor,
  type MinimaxH3ExperimentIntent,
  type MinimaxH3ExperimentReceipt,
  type MinimaxH3ExperimentResult,
  type MinimaxH3ExperimentResultV2,
  type MinimaxH3AnyExperimentResult,
  type MinimaxH3ProcessRecord,
  type MinimaxH3ReferenceDescriptor,
  type MinimaxH3TerminalEvidence,
  type MinimaxH3PhaseAccountingEvent,
  type MinimaxH3FactorChange,
  type MinimaxH3InstrumentationReport,
  type MinimaxH3PhaseType,
  computeAttentionTopologyDigest,
  computeAttentionRuntimeLockDigest,
  computeAttentionConfigDigest,
  type MinimaxH3AttentionVariantName,
  type MinimaxH3AttentionCatalogEntry,
  type MinimaxH3AttentionObservation,
  type MinimaxH3AttentionTopology,
  type MinimaxH3RequiredRuntimeManifest,
  type MinimaxH3ObservedProvenance,
  type MinimaxH3SamplingRecipe,
  type MinimaxH3SamplingRecipeName,
  MinimaxH3ObservedProvenanceSchema,
  MinimaxH3CapabilityHandshakeSchema,
  type MinimaxH3CapabilityHandshake,
  STANDARD_MINIMAX_H3_HOOKS,
  MinimaxH3AttentionIdentityEnvelopeSchema,
  satisfiesDriverConstraint,
  TEACACHE_UPSTREAM_COMMIT,
  TEACACHE_ADAPTER_VERSION,
  TEACACHE_LOCAL_ADAPTER_FILE_HASHES,
  TEACACHE_LOCAL_ADAPTER_DIGEST,
  computeLocalTeaCacheAdapterDigest,
  validateTeaCacheParameters,
  computeTeaCacheConfigDigest,
  computeTeaCacheTopologyDigest,
  type MinimaxH3TeaCacheConfig,
  type MinimaxH3TeaCacheMode,
  type MinimaxH3TeaCacheCatalogEntry,
  type MinimaxH3TeaCacheObservation,
  type MinimaxH3TeaCachePatchNode
} from "@cco/contracts";
import { reducePhaseAccounting } from "./minimax-h3-timing-reducer.js";
import {
  deriveAttentionGraph,
  validateAttentionTopology
} from "./minimax-h3-attention-topology.js";
import { deriveTeaCacheGraph, validateTeaCacheTopology } from "./minimax-h3-teacache-topology.js";
import { getTeaCacheCatalogEntry } from "./minimax-h3-teacache-catalog.js";
import { reduceTeaCacheObservation } from "./minimax-h3-teacache-reducer.js";
import {
  parseAttentionEvidence,
  resolveAttentionEvidence,
  type MinimaxH3AttentionEvidence
} from "./minimax-h3-attention-evidence.js";
import { getAttentionCatalogEntry } from "./minimax-h3-attention-catalog.js";
import { reduceAttentionObservation } from "./minimax-h3-attention-reducer.js";
import {
  getSamplingRecipe,
  validateRecipeRouteCompatibility
} from "./minimax-h3-step-reduction-catalog.js";
import {
  applySamplingRecipeToGraph,
  validateSamplingRecipeTopology
} from "./minimax-h3-step-reduction-compiler.js";
import type {
  MinimaxH3ComfyUiTransportPort,
  MinimaxH3ExperimentStorePort,
  MinimaxH3OutputProberPort,
  MinimaxH3OwnedProcess,
  MinimaxH3ProcessRunnerPort,
  MinimaxH3TargetPreflightPort,
  MinimaxH3TelemetrySamplerPort,
  PrepareMinimaxH3ExperimentOptions
} from "../ports/minimax-h3-experiment-ports.js";
import {
  analyzeStartupDiagnostics,
  PINNED_COMFYUI_CORE_REVISION,
  PINNED_COMFYUI_SOURCE_HASHES,
  validateRunnerVariantAndArgv
} from "./minimax-h3-cli-parser-semantics.js";

function sortKeysRecursively(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysRecursively);
  }
  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const sortedObject: Record<string, unknown> = Object.create(null);
  for (const key of sortedKeys) {
    sortedObject[key] = sortKeysRecursively(record[key]);
  }
  return sortedObject;
}

export function canonicalizeJson(value: unknown): string {
  const sorted = sortKeysRecursively(value);
  return JSON.stringify(sorted);
}

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export { computeComparisonKey };

// Derives end-to-end execution latency from real recorded timestamps
// rather than carrying forward whatever the measurement template last
// held (which starts, and without this, permanently stays, null). Falls
// back to the previously stored value only when either timestamp is
// genuinely absent, so a run with no real terminatedAt yet doesn't get a
// fabricated latency measured against "now".
export function computeExecutionLatencyMs(
  startedAt: string | null,
  terminatedAt: string | null,
  previousLatencyMs: number | null
): number | null {
  if (!startedAt || !terminatedAt) {
    return previousLatencyMs;
  }
  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(terminatedAt).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return previousLatencyMs;
  }
  const latencyMs = endMs - startMs;
  if (!Number.isFinite(latencyMs) || latencyMs < 0) {
    return previousLatencyMs;
  }
  return Math.round(latencyMs);
}

export const SUPPORTED_RESOLUTION_VARIANTS: Record<string, { width: number; height: number }> = {
  "720p": { width: 1280, height: 720 },
  "576p": { width: 1024, height: 576 },
  "512p": { width: 896, height: 512 }
};

const FORBIDDEN_OUTPUT_PATH_SUBSTRINGS = ["certification/", "baseline/", "config/render-profiles/"];

export function assertSafeOutputPath(path: string, outputRoot: string): void {
  for (const forbidden of FORBIDDEN_OUTPUT_PATH_SUBSTRINGS) {
    if (path.includes(forbidden)) {
      throw new Error(
        `Path "${path}" violates governance rules: cannot write to forbidden directory "${forbidden}".`
      );
    }
  }
  if (!path.startsWith(outputRoot)) {
    throw new Error(
      `Path "${path}" escapes the designated experiment output root "${outputRoot}".`
    );
  }
}

export function findRepositoryRoot(startDir: string = process.cwd()): string {
  let curr = resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(curr, "pnpm-workspace.yaml"))) {
      return curr;
    }
    const parent = dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return resolve(startDir);
}

export function resolveProfilePath(baseProfileKey: string): string {
  const repoRoot = findRepositoryRoot();
  const searchRoots = [process.cwd()];
  if (process.env.INIT_CWD && !searchRoots.includes(process.env.INIT_CWD)) {
    searchRoots.push(process.env.INIT_CWD);
  }
  if (!searchRoots.includes(repoRoot)) {
    searchRoots.push(repoRoot);
  }
  for (const root of searchRoots) {
    let curr = root;
    for (let i = 0; i < 6; i++) {
      const candidate = resolve(curr, "config/render-profiles", `${baseProfileKey}.json`);
      if (existsSync(candidate)) {
        return candidate;
      }
      const parent = dirname(curr);
      if (parent === curr) break;
      curr = parent;
    }
  }
  return resolve(repoRoot, "config/render-profiles", `${baseProfileKey}.json`);
}

export function resolveTemplatesDir(configured?: string): string {
  if (configured && existsSync(configured) && existsSync(join(configured, "provenance.json"))) {
    return resolve(configured);
  }
  const repoRoot = findRepositoryRoot();
  const searchRoots = [process.cwd()];
  if (process.env.INIT_CWD && !searchRoots.includes(process.env.INIT_CWD)) {
    searchRoots.push(process.env.INIT_CWD);
  }
  if (!searchRoots.includes(repoRoot)) {
    searchRoots.push(repoRoot);
  }
  for (const root of searchRoots) {
    let curr = root;
    for (let i = 0; i < 6; i++) {
      const candidate = resolve(curr, configured ?? "templates");
      if (existsSync(candidate) && existsSync(join(candidate, "provenance.json"))) {
        return candidate;
      }
      const parent = dirname(curr);
      if (parent === curr) break;
      curr = parent;
    }
  }
  return resolve(repoRoot, configured ?? "templates");
}

export function resolveCollectorPath(): string | undefined {
  const repoRoot = findRepositoryRoot();
  const candidates = [
    resolve(repoRoot, "packages/infrastructure/src/experiments/minimax-h3-collector.py"),
    resolve(repoRoot, "packages/infrastructure/dist/experiments/minimax-h3-collector.py")
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function resolveAttentionFixturesDir(configured?: string): string {
  if (configured && existsSync(configured)) {
    return resolve(configured);
  }
  const repoRoot = findRepositoryRoot();
  const searchRoots = [process.cwd()];
  if (process.env.INIT_CWD && !searchRoots.includes(process.env.INIT_CWD)) {
    searchRoots.push(process.env.INIT_CWD);
  }
  if (!searchRoots.includes(repoRoot)) {
    searchRoots.push(repoRoot);
  }
  const subpath = "experiments/minimax-h3-attention/fixtures";
  for (const root of searchRoots) {
    let curr = root;
    for (let i = 0; i < 6; i++) {
      const candidate = resolve(curr, configured ?? subpath);
      if (existsSync(candidate)) {
        return candidate;
      }
      const parent = dirname(curr);
      if (parent === curr) break;
      curr = parent;
    }
  }
  return resolve(repoRoot, configured ?? subpath);
}

export function getAttentionFixturePath(
  variant: MinimaxH3AttentionVariantName,
  fixturesDir?: string
): string {
  const dir = resolveAttentionFixturesDir(fixturesDir);
  switch (variant) {
    case "dense":
    case "sage":
      return join(dir, "pinned-core-attention-api.json");
    case "native-sol-attn":
      return join(dir, "native-sol-attn-api.json");
    case "veda":
      return join(dir, "veda-sparse-attention-api.json");
  }
}

export function deriveExperimentGraph({
  baseWorkflow,
  route,
  runId,
  seed,
  frames,
  width,
  height,
  prompt,
  references,
  stepOverride,
  checkpointOverride
}: {
  baseWorkflow: Record<string, unknown>;
  route: "i2v" | "ref2v";
  runId: string;
  seed: number;
  frames: number;
  width: number;
  height: number;
  prompt: string;
  references: readonly MinimaxH3ReferenceDescriptor[];
  stepOverride?: number;
  checkpointOverride?: string;
}): Record<string, unknown> {
  interface ComfyNode {
    inputs?: Record<string, unknown>;
    [key: string]: unknown;
  }
  const derivedGraph: Record<string, ComfyNode> = JSON.parse(JSON.stringify(baseWorkflow));

  // 1. SaveVideo run-local prefix (node 92)
  const saveVideoNodeId = "92";
  if (derivedGraph[saveVideoNodeId]?.inputs) {
    derivedGraph[saveVideoNodeId].inputs.filename_prefix = `minimax_h3_${route}_${runId}`;
  }

  // 2. RandomNoise seed (node 15)
  const randomNoiseNodeId = "15";
  if (derivedGraph[randomNoiseNodeId]?.inputs) {
    derivedGraph[randomNoiseNodeId].inputs.noise_seed = seed;
  }

  // 3. Route-specific wiring
  if (route === "i2v") {
    const i2vNodeId = "104";
    if (derivedGraph[i2vNodeId]?.inputs) {
      derivedGraph[i2vNodeId].inputs.length = frames;
      derivedGraph[i2vNodeId].inputs.width = width;
      derivedGraph[i2vNodeId].inputs.height = height;
      derivedGraph[i2vNodeId].inputs.prompt = prompt;
    }
    const loadImageNodeId = "20";
    if (derivedGraph[loadImageNodeId]?.inputs && references[0]) {
      derivedGraph[loadImageNodeId].inputs.image = references[0].stagedFilename;
    }
  } else {
    const ref2vNodeId = "105";
    const N = references.length;
    if (derivedGraph[ref2vNodeId]?.inputs) {
      derivedGraph[ref2vNodeId].inputs.length = frames;
      derivedGraph[ref2vNodeId].inputs.width = width;
      derivedGraph[ref2vNodeId].inputs.height = height;
      derivedGraph[ref2vNodeId].inputs.prompt = prompt;
      derivedGraph[ref2vNodeId].inputs.ref_image_size = N > 0 ? "max" : "match";

      for (let i = 0; i < N; i++) {
        const loadNodeId = String(201 + i);
        if (derivedGraph[loadNodeId]?.inputs) {
          derivedGraph[loadNodeId].inputs.image = references[i]!.stagedFilename;
        }
        derivedGraph[ref2vNodeId].inputs[`ref_images.ref_image_${i}`] = [loadNodeId, 0];
      }

      for (let i = N; i < 9; i++) {
        const unusedLoadNodeId = String(201 + i);
        delete derivedGraph[unusedLoadNodeId];
        delete derivedGraph[ref2vNodeId].inputs[`ref_images.ref_image_${i}`];
      }
    }
  }

  // 4. Step override (node 9 - BasicScheduler)
  const schedulerNodeId = "9";
  if (stepOverride !== undefined && derivedGraph[schedulerNodeId]?.inputs) {
    derivedGraph[schedulerNodeId].inputs.steps = stepOverride;
  }

  // 5. Checkpoint override (node 6 - UNETLoader)
  const unetNodeId = "6";
  if (checkpointOverride !== undefined && derivedGraph[unetNodeId]?.inputs) {
    derivedGraph[unetNodeId].inputs.unet_name = checkpointOverride;
  }

  return derivedGraph;
}

function validateCapabilityHandshake(
  handshake: MinimaxH3CapabilityHandshake,
  options: {
    descV2: MinimaxH3ExperimentDescriptorV2;
    expectedPid?: number | undefined;
    expectedNonce?: string | undefined;
    attemptToken?: string | undefined;
    comfyUiDir?: string | undefined;
    requireBinding?: boolean | undefined;
  }
): string[] {
  const conflicts: string[] = [];
  const { descV2, expectedPid, expectedNonce, attemptToken } = options;

  if (options.requireBinding) {
    if (expectedPid === undefined || !expectedNonce || !attemptToken) {
      conflicts.push(
        "pre-submit handshake is not bound to an owned child PID, nonce, and attempt token"
      );
    }
  }

  if (!handshake.pid || typeof handshake.pid !== "number" || handshake.pid <= 0) {
    conflicts.push("capability handshake missing valid child PID");
  }
  if (!handshake.nonce || typeof handshake.nonce !== "string" || !handshake.nonce.trim()) {
    conflicts.push("capability handshake missing valid nonce");
  }
  if (
    !handshake.attemptToken ||
    typeof handshake.attemptToken !== "string" ||
    !handshake.attemptToken.trim()
  ) {
    conflicts.push("capability handshake missing valid attemptToken");
  }

  if (handshake.status === "failed") {
    conflicts.push(
      `capability handshake marked failed: ${handshake.failureReason ?? "unknown failure"}`
    );
  }
  if (handshake.status !== "ok") conflicts.push("capability handshake is not ready");

  if (handshake.protocol !== descV2.requiredRuntime.instrumentationProtocol) {
    conflicts.push(
      `protocol mismatch (expected ${descV2.requiredRuntime.instrumentationProtocol}, got ${handshake.protocol})`
    );
  }
  if (handshake.runId !== descV2.runId) {
    conflicts.push(`runId mismatch (expected ${descV2.runId}, got ${handshake.runId})`);
  }
  if (attemptToken && handshake.attemptToken !== attemptToken) {
    conflicts.push(
      `attemptToken mismatch (expected ${attemptToken}, got ${handshake.attemptToken})`
    );
  }
  if (expectedNonce && handshake.nonce !== expectedNonce) {
    conflicts.push(`nonce mismatch (expected ${expectedNonce}, got ${handshake.nonce})`);
  }
  if (expectedPid !== undefined && handshake.pid !== expectedPid) {
    conflicts.push(`pid mismatch (expected ${expectedPid}, got ${handshake.pid})`);
  }
  if (
    descV2.requiredRuntime.collectorDigest &&
    handshake.collectorDigest !== descV2.requiredRuntime.collectorDigest
  ) {
    conflicts.push(
      `collectorDigest mismatch: expected ${descV2.requiredRuntime.collectorDigest}, got ${handshake.collectorDigest}`
    );
  }
  if (
    descV2.requiredRuntime.hookManifestDigest &&
    handshake.hookManifestDigest !== descV2.requiredRuntime.hookManifestDigest
  ) {
    conflicts.push(
      `hookManifestDigest mismatch: expected ${descV2.requiredRuntime.hookManifestDigest}, got ${handshake.hookManifestDigest}`
    );
  }

  // Kernel callable check
  if (handshake.kernelCallableAvailable === false) {
    conflicts.push("requested kernel callable is unavailable");
  } else if (descV2.attentionRequest && handshake.kernelCallableAvailable !== true) {
    conflicts.push("requested kernel callable is unavailable");
  }

  // Verify registered nodes
  for (const reqNode of descV2.requiredRuntime.requiredNodes) {
    const regNode = handshake.registeredNodes[reqNode.name];
    if (!regNode) {
      conflicts.push(`required node "${reqNode.name}" is not registered in ComfyUI child process`);
      continue;
    }
    if (reqNode.revision) {
      if (!regNode.revision) {
        conflicts.push(`required node "${reqNode.name}" lacks revision in child process handshake`);
      } else if (regNode.revision !== reqNode.revision) {
        conflicts.push(
          `required node "${reqNode.name}" revision mismatch: expected ${reqNode.revision}, got ${regNode.revision}`
        );
      }
    }
    if (reqNode.moduleHash) {
      if (!regNode.moduleHash) {
        conflicts.push(
          `required node "${reqNode.name}" lacks moduleHash in child process handshake`
        );
      } else if (regNode.moduleHash !== reqNode.moduleHash) {
        conflicts.push(
          `required node "${reqNode.name}" moduleHash mismatch: expected ${reqNode.moduleHash}, got ${regNode.moduleHash}`
        );
      }
    }
    if (options.comfyUiDir && regNode.sourceFile) {
      const normSource = normalize(regNode.sourceFile);
      const normCheckout = normalize(options.comfyUiDir);
      // A plain startsWith admits sibling directories sharing the checkout's
      // name as a prefix (e.g. checkout "/x/comfy" would wrongly accept
      // "/x/comfy-evil/node.py"). Require the match to land exactly on the
      // checkout path or one path-separator boundary inside it (AC-3,
      // F-e35ea06e).
      const isContained = normSource === normCheckout || normSource.startsWith(normCheckout + sep);
      if (isAbsolute(normSource) && !isContained) {
        conflicts.push(
          `node "${reqNode.name}" source file "${normSource}" is outside the audited checkout "${normCheckout}"`
        );
      }
    }
  }

  // Verify hooks
  for (const reqHook of descV2.requiredRuntime.hooks) {
    const match = handshake.installedHooks.find(
      (h) =>
        h.name === reqHook.name &&
        h.modulePath === reqHook.modulePath &&
        h.callable === reqHook.callable &&
        h.phase === reqHook.phase
    );
    if (!match) {
      conflicts.push(`required hook "${reqHook.name}" is not present in child process`);
    } else if (!match.attached) {
      conflicts.push(`required hook "${reqHook.name}" is not attached in child process`);
    }
  }

  // Runtime versions & package/source identity checks
  const handshakeAny = handshake as Record<string, unknown>;
  const reqRuntime = descV2.requiredRuntime;
  const needsRuntimeVersions = Boolean(
    reqRuntime.pytorchBuild ||
    reqRuntime.cudaBuild ||
    reqRuntime.interpreter?.pythonVersion ||
    (reqRuntime.driverConstraints && reqRuntime.driverConstraints.length > 0)
  );

  if (needsRuntimeVersions && !handshake.runtimeVersions) {
    conflicts.push("child capability handshake is missing runtimeVersions");
  } else if (handshake.runtimeVersions) {
    if (reqRuntime.pytorchBuild) {
      if (!handshake.runtimeVersions.pytorchVersion) {
        conflicts.push("runtime pytorchVersion missing in child handshake");
      } else if (handshake.runtimeVersions.pytorchVersion !== reqRuntime.pytorchBuild) {
        conflicts.push(
          `runtime pytorchVersion mismatch: expected ${reqRuntime.pytorchBuild}, got ${handshake.runtimeVersions.pytorchVersion}`
        );
      }
    }
    if (reqRuntime.cudaBuild) {
      if (!handshake.runtimeVersions.cudaBuildVersion) {
        conflicts.push("runtime cudaBuildVersion missing in child handshake");
      } else if (handshake.runtimeVersions.cudaBuildVersion !== reqRuntime.cudaBuild) {
        conflicts.push(
          `runtime cudaBuildVersion mismatch: expected ${reqRuntime.cudaBuild}, got ${handshake.runtimeVersions.cudaBuildVersion}`
        );
      }
    }
    if (reqRuntime.interpreter?.pythonVersion) {
      if (!handshake.runtimeVersions.pythonVersion) {
        conflicts.push("runtime pythonVersion missing in child handshake");
      } else if (handshake.runtimeVersions.pythonVersion !== reqRuntime.interpreter.pythonVersion) {
        conflicts.push(
          `runtime pythonVersion mismatch: expected ${reqRuntime.interpreter.pythonVersion}, got ${handshake.runtimeVersions.pythonVersion}`
        );
      }
    }
    if (reqRuntime.driverConstraints && reqRuntime.driverConstraints.length > 0) {
      if (!handshake.runtimeVersions.driverVersion) {
        conflicts.push("runtime driverVersion missing in child handshake");
      } else {
        for (const constraint of reqRuntime.driverConstraints) {
          const check = satisfiesDriverConstraint(
            handshake.runtimeVersions.driverVersion,
            constraint
          );
          if (!check.satisfied) {
            conflicts.push(
              check.error ??
                `Driver version "${handshake.runtimeVersions.driverVersion}" does not satisfy constraint "${constraint}".`
            );
          }
        }
      }
    }
  }

  if (reqRuntime.pythonPackages && reqRuntime.pythonPackages.length > 0) {
    if (
      !Array.isArray(handshakeAny.packageIdentities) ||
      handshakeAny.packageIdentities.length === 0
    ) {
      conflicts.push("child capability handshake is missing packageIdentities");
    } else {
      const pkgIds = handshakeAny.packageIdentities as Array<{
        name: string;
        version: string;
        artifactHash?: string;
        artifactMethod?: string;
      }>;
      const pkgMap = new Map(pkgIds.map((p) => [p.name, p]));
      for (const reqPkg of reqRuntime.pythonPackages) {
        const livePkg = pkgMap.get(reqPkg.name);
        if (!livePkg) {
          conflicts.push(
            `required package "${reqPkg.name}" is missing from child capability handshake`
          );
        } else {
          // version/method were previously unchecked here: a manifest could
          // pin a specific package version and verification artifactMethod,
          // but the live handshake's own reported version/method were never
          // compared against them, so a different installed version or a
          // weaker hashing method could pass undetected as long as the
          // artifactHash happened to be supplied and matched (F-e35ea06e).
          if (reqPkg.version && livePkg.version && reqPkg.version !== livePkg.version) {
            conflicts.push(
              `package "${reqPkg.name}" version mismatch: expected ${reqPkg.version}, got ${livePkg.version}`
            );
          }
          if (
            reqPkg.artifactMethod &&
            livePkg.artifactMethod &&
            reqPkg.artifactMethod !== livePkg.artifactMethod
          ) {
            conflicts.push(
              `package "${reqPkg.name}" artifactMethod mismatch: expected ${reqPkg.artifactMethod}, got ${livePkg.artifactMethod}`
            );
          }
          if (reqPkg.artifactHash) {
            if (!livePkg.artifactHash) {
              conflicts.push(
                `package "${reqPkg.name}" lacks artifactHash in child capability handshake`
              );
            } else if (reqPkg.artifactHash !== livePkg.artifactHash) {
              conflicts.push(
                `package "${reqPkg.name}" artifactHash mismatch: expected ${reqPkg.artifactHash}, got ${livePkg.artifactHash}`
              );
            }
          }
        }
      }
    }
  }

  if (reqRuntime.sourceFileHashes && Object.keys(reqRuntime.sourceFileHashes).length > 0) {
    if (!handshakeAny.sourceIdentities || typeof handshakeAny.sourceIdentities !== "object") {
      conflicts.push("child capability handshake is missing sourceIdentities");
    } else {
      const srcIds = handshakeAny.sourceIdentities as Record<string, string>;
      for (const [file, expHash] of Object.entries(reqRuntime.sourceFileHashes)) {
        if (!srcIds[file]) {
          conflicts.push(
            `required source file "${file}" is missing from child capability handshake`
          );
        } else if (srcIds[file] !== expHash) {
          conflicts.push(
            `source identity hash mismatch for "${file}": expected ${expHash}, got ${srcIds[file]}`
          );
        }
      }
    }
  }

  return conflicts;
}

export class MinimaxH3ExperimentService {
  constructor(
    private readonly store: MinimaxH3ExperimentStorePort,
    private readonly preflight?: MinimaxH3TargetPreflightPort,
    private readonly runner?: MinimaxH3ProcessRunnerPort,
    private readonly transport?: MinimaxH3ComfyUiTransportPort,
    private readonly telemetry?: MinimaxH3TelemetrySamplerPort,
    private readonly prober?: MinimaxH3OutputProberPort
  ) {}

  async prepareExperiment(
    options: PrepareMinimaxH3ExperimentOptions
  ): Promise<{ descriptor: MinimaxH3AnyExperimentDescriptor; runDir: string }> {
    const {
      route,
      frames,
      seed,
      prompt,
      operatorLabel,
      runId,
      outputRoot,
      targetHost,
      gpuUuid,
      comfyUiDir,
      pythonPath,
      address = "127.0.0.1",
      port = 8199,
      width = 1344,
      height = 768,
      runnerVariant = "dynamicvram-offload-v1",
      variantReason = null,
      inputManifestPath,
      requestedDurationMs,
      timeouts: timeoutsOverride
    } = options;

    // MinimaxH3ExperimentTimeoutsSchema's bounds exist specifically to
    // allow operator tuning above the defaults (e.g. a longer render for
    // a higher frame count) -- parse+validate the merged result so an
    // override can't exceed the schema's own caps.
    const timeouts = MinimaxH3ExperimentTimeoutsSchema.parse({
      ...DEFAULT_MINIMAX_H3_EXPERIMENT_TIMEOUTS,
      ...timeoutsOverride
    });

    const validatedFrames = validateMinimaxH3ExperimentFrameCount(frames);
    const durationInfo = getMinimaxH3FrameDurationInfo(validatedFrames);

    const isNonDefaultGeometry = width !== 1344 || height !== 768;
    if (isNonDefaultGeometry) {
      const matchingVariant = Object.entries(SUPPORTED_RESOLUTION_VARIANTS).find(
        ([, dims]) => dims.width === width && dims.height === height
      );
      if (!matchingVariant) {
        throw new Error(
          `Non-default resolution (${width}x${height}) is not a supported named resolution variant. Supported variants: 720p (1280x720), 576p (1024x576), 512p (896x512).`
        );
      }
      if (!variantReason || variantReason.trim().length === 0) {
        throw new Error(
          `Non-default resolution variant "${matchingVariant[0]}" (${width}x${height}) requires an explicit operator --variant-reason.`
        );
      }
    }

    const { requestedPolicy, generatedArgv, predictedPolicy } = validateRunnerVariantAndArgv({
      variantName: runnerVariant,
      variantReason
    });

    const runDir = `${outputRoot}/${runId}`;
    assertSafeOutputPath(runDir, outputRoot);

    // Exclusive run directory creation (fails if runDir already exists)
    await this.store.createRunDirectory(runDir);

    // Read templates & base files
    const templatesDir = resolveTemplatesDir(options.templatesDir);
    const templateFileName =
      route === "i2v" ? "minimax_h3_720p_i2v_124f_api.json" : "minimax_h3_720p_ref2v_124f_api.json";
    const templateFilePath = `${templatesDir}/${templateFileName}`;
    const baseWorkflowRaw = await this.store.readTextFile(templateFilePath);
    const baseWorkflowParsed = JSON.parse(baseWorkflowRaw) as Record<string, unknown>;
    const baseCanonicalWorkflowDigest = sha256Hex(canonicalizeJson(baseWorkflowParsed));

    // Read provenance manifest
    const provenanceManifestPath = `${templatesDir}/provenance.json`;
    const provenanceRaw = await this.store.readTextFile(provenanceManifestPath);
    const provenanceDigest = sha256Hex(provenanceRaw);
    const provenanceSource =
      route === "i2v" ? ("authored_from_spec" as const) : ("validated_host_export" as const);

    const provenanceParsed = JSON.parse(provenanceRaw) as {
      profiles?: Array<{ workflowRelativePath?: string; expectedWorkflowHash?: string }>;
    };
    const matchingProfile = provenanceParsed.profiles?.find(
      (p) => p.workflowRelativePath === templateFileName
    );
    // Fail closed rather than silently skipping verification: a
    // --templates-dir supplying an empty or missing profile entry must not
    // be able to make an unverified template become the trusted base.
    if (!matchingProfile?.expectedWorkflowHash) {
      throw new Error(
        `provenance.json at "${provenanceManifestPath}" has no expectedWorkflowHash entry for "${templateFileName}"; cannot verify the base template against an independent pin.`
      );
    }
    if (baseCanonicalWorkflowDigest !== matchingProfile.expectedWorkflowHash) {
      throw new Error(
        `Base template ${templateFileName} canonical hash (${baseCanonicalWorkflowDigest}) does not match provenance expectedWorkflowHash (${matchingProfile.expectedWorkflowHash})`
      );
    }

    // Read input manifest
    const resolvedInputManifestPath = inputManifestPath;
    const inputManifest = (await this.store.readJsonFile(resolvedInputManifestPath)) as {
      referenceSetId?: string;
      references?: Array<{
        assetPath: string;
        stagedFilename: string;
        role?: string;
        tag?: string;
        order?: number;
        sha256?: string;
        sizeBytes?: number;
        width?: number;
        height?: number;
        sourceAssetPath?: string;
        derivation?: string;
      }>;
    };

    const referenceSetId = inputManifest.referenceSetId ?? "default-ref-set";
    const rawRefs = inputManifest.references ?? [];

    if (route === "i2v") {
      if (rawRefs.length !== 1) {
        throw new Error(
          `Route "i2v" requires exactly 1 input reference image, received ${rawRefs.length}.`
        );
      }
    } else {
      if (rawRefs.length > 9) {
        throw new Error(
          `Route "ref2v" accepts at most 9 reference images, received ${rawRefs.length}.`
        );
      }
      if (rawRefs.length === 0 && runnerVariant === "dynamicvram-offload-v1") {
        throw new Error(
          `Route "ref2v" with N=0 references is allowed only as an explicit variant with --variant-reason.`
        );
      }
    }

    // Validate staged filenames: unique, no directory traversal
    const stagedFilenames = new Set<string>();
    for (const ref of rawRefs) {
      const name = ref.stagedFilename;
      if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
        throw new Error(
          `Invalid staged filename "${name}". Must be a simple basename without path separators or traversal.`
        );
      }
      if (stagedFilenames.has(name)) {
        throw new Error(
          `Duplicate staged filename "${name}" detected in input manifest references.`
        );
      }
      stagedFilenames.add(name);
    }

    const manifestDir = dirname(resolvedInputManifestPath);
    const processedReferences: MinimaxH3ReferenceDescriptor[] = [];
    for (let i = 0; i < rawRefs.length; i++) {
      const ref = rawRefs[i]!;
      const expectedTag = `<Picture ${i + 1}>`;
      if (ref.tag && ref.tag !== expectedTag) {
        throw new Error(
          `Reference at index ${i} has invalid tag "${ref.tag}". Expected "${expectedTag}".`
        );
      }
      if (ref.order !== undefined && ref.order !== i) {
        throw new Error(`Reference at index ${i} has invalid order ${ref.order}. Expected ${i}.`);
      }
      const expectedRole = route === "i2v" ? "first_frame" : (ref.role ?? "reference");
      if (route === "i2v" && ref.role && ref.role !== "first_frame") {
        throw new Error(
          `Route "i2v" reference at index ${i} must have role "first_frame", got "${ref.role}".`
        );
      }
      const resolvedAsset = resolve(
        !ref.assetPath.startsWith("/") ? resolve(manifestDir, ref.assetPath) : ref.assetPath
      );
      const hashInfo = await this.store.hashFile(resolvedAsset);
      const assetInspection = await this.store.inspectAsset(resolvedAsset);
      if (ref.sha256 && ref.sha256 !== hashInfo.sha256) {
        throw new Error(
          `Input manifest reference at index ${i} SHA-256 mismatch: expected ${ref.sha256}, got ${hashInfo.sha256}`
        );
      }
      if (ref.sizeBytes && ref.sizeBytes !== hashInfo.sizeBytes) {
        throw new Error(
          `Input manifest reference at index ${i} size mismatch: expected ${ref.sizeBytes}, got ${hashInfo.sizeBytes}`
        );
      }
      if (ref.width && ref.width !== assetInspection.width) {
        throw new Error(
          `Input manifest reference at index ${i} width mismatch: expected ${ref.width}, got ${assetInspection.width}`
        );
      }
      if (ref.height && ref.height !== assetInspection.height) {
        throw new Error(
          `Input manifest reference at index ${i} height mismatch: expected ${ref.height}, got ${assetInspection.height}`
        );
      }
      processedReferences.push({
        slotIndex: i,
        role: ref.role ?? expectedRole,
        tag: ref.tag ?? expectedTag,
        order: ref.order ?? i,
        assetPath: resolvedAsset,
        stagedFilename: ref.stagedFilename,
        sha256: hashInfo.sha256,
        width: assetInspection.width,
        height: assetInspection.height,
        mimeType: assetInspection.mimeType
      });
    }

    // Aspect ratio check for I2V first frame based on actual inspected dimensions
    if (route === "i2v" && processedReferences.length === 1) {
      const firstRef = processedReferences[0]!;
      const canvasRatio = width / height;
      const refRatio = firstRef.width / firstRef.height;
      const deviation = Math.abs(refRatio - canvasRatio) / canvasRatio;
      if (deviation > 0.05) {
        throw new Error(
          `First-frame aspect ratio (${refRatio.toFixed(3)}) deviates by ${(deviation * 100).toFixed(1)}% from canvas aspect ratio (${canvasRatio.toFixed(3)}), exceeding 5% limit.`
        );
      }
    }

    // Ref2V tag check: prompt must not refer to absent slots
    if (route === "ref2v") {
      const tagMatches = prompt.match(/<Picture \d+>/g) || [];
      for (const t of tagMatches) {
        const slotNum = parseInt(t.replace(/<Picture |>/g, ""), 10);
        if (slotNum < 1 || slotNum > processedReferences.length) {
          throw new Error(
            `Prompt references tag "${t}" but only ${processedReferences.length} reference images were supplied.`
          );
        }
      }
    }

    const teacacheMode: MinimaxH3TeaCacheMode = options.teacache ?? "off";
    const isTeaCache = teacacheMode === "raw-l1-v1";
    const isTeaCacheMatchedControl = Boolean(options.teacacheMatchedControl);

    if (isTeaCache && isTeaCacheMatchedControl) {
      throw new Error(
        "Cannot combine --teacache and --teacache-matched-control; choose either candidate or matched control."
      );
    }

    const hasTeaCacheKnobs =
      options.teacacheThreshold !== undefined ||
      options.teacacheStartStep !== undefined ||
      options.teacacheEndStep !== undefined ||
      options.teacacheTotalSteps !== undefined;

    if (isTeaCache && isTeaCacheMatchedControl) {
      throw new Error(
        "Cannot combine teacache raw-l1-v1 with teacacheMatchedControl; select either candidate or matched control."
      );
    }

    if (!isTeaCache && hasTeaCacheKnobs) {
      throw new Error(
        "TeaCache parameter knobs (teacacheThreshold, teacacheStartStep, teacacheEndStep, teacacheTotalSteps) can only be specified when teacache is active (raw-l1-v1)."
      );
    }

    if (isTeaCache) {
      if (
        options.teacacheThreshold === undefined ||
        options.teacacheStartStep === undefined ||
        options.teacacheEndStep === undefined ||
        options.teacacheTotalSteps === undefined
      ) {
        throw new Error(
          "Active TeaCache experiment requires explicit knobs: teacacheThreshold, teacacheStartStep, teacacheEndStep, and teacacheTotalSteps must all be specified."
        );
      }
    }

    if (isTeaCache || isTeaCacheMatchedControl) {
      if (options.samplingRecipe !== undefined) {
        throw new Error(
          "Cannot specify teacache when using samplingRecipe; TeaCache experiments must use the base un-distilled model."
        );
      }
      if (options.checkpointOverride !== undefined) {
        throw new Error(
          "Cannot specify checkpointOverride when using teacache; TeaCache experiments require the default pinned checkpoint."
        );
      }
      if (options.attentionVariant !== undefined && options.attentionVariant !== "dense") {
        throw new Error(
          "Cannot combine TeaCache with non-dense attentionVariant; initial phase requires base dense attention."
        );
      }
      if (options.stepOverride !== undefined && options.stepOverride !== 20) {
        throw new Error(
          "Cannot override stepOverride when using teacache; TeaCache experiments require exactly 20 steps."
        );
      }
    }

    const isV2 =
      options.schemaVersion === 2 ||
      options.stepOverride !== undefined ||
      options.checkpointOverride !== undefined ||
      options.changedFactors !== undefined ||
      options.variantPurpose !== undefined ||
      options.attentionVariant !== undefined ||
      options.samplingRecipe !== undefined ||
      isTeaCache ||
      isTeaCacheMatchedControl;

    const samplingRecipeName: MinimaxH3SamplingRecipeName | undefined = options.samplingRecipe;
    const samplingRecipe: MinimaxH3SamplingRecipe | undefined = samplingRecipeName
      ? getSamplingRecipe(samplingRecipeName, route)
      : undefined;

    if (samplingRecipe) {
      if (options.attentionVariant !== undefined) {
        throw new Error(
          "Cannot specify attentionVariant when using samplingRecipe; the recipe defines its own attention configuration."
        );
      }
      if (options.stepOverride !== undefined) {
        throw new Error(
          `Cannot specify stepOverride when using samplingRecipe; recipe "${samplingRecipe.name}" specifies its exact expectedSteps (${samplingRecipe.expectedSteps}).`
        );
      }
      if (options.checkpointOverride !== undefined) {
        throw new Error(
          `Cannot specify checkpointOverride when using samplingRecipe; recipe "${samplingRecipe.name}" specifies its exact diffusionModel.`
        );
      }
      if (options.coreRevision !== undefined) {
        throw new Error(
          `Cannot specify coreRevision when using samplingRecipe; recipe "${samplingRecipe.name}" specifies its requiredRuntime.`
        );
      }
      if (options.matchedVariant !== undefined) {
        throw new Error(
          `Cannot specify matchedVariant when using samplingRecipe; recipe "${samplingRecipe.name}" defines its own configuration.`
        );
      }
      if (
        samplingRecipe.name === "fasth3-i2v-8" &&
        options.variantPurpose !== undefined &&
        options.variantPurpose !== "controlled_multifactor"
      ) {
        throw new Error(
          `FastH3 recipe changes multiple factors (models.diffusion, sampling.settings, sampling.sigmaShift, attention.configuration, runtime.manifest); variantPurpose must be "controlled_multifactor", received "${options.variantPurpose}".`
        );
      }
      validateRecipeRouteCompatibility(samplingRecipe.name, route);
    }

    const attentionVariant: MinimaxH3AttentionVariantName | undefined = options.attentionVariant;
    const attentionCatalogEntry = attentionVariant
      ? getAttentionCatalogEntry(attentionVariant, route, {
          coreRevision: options.coreRevision,
          matchedVariant: options.matchedVariant
        })
      : undefined;
    const effectiveArgv =
      attentionVariant === "sage" ? [...generatedArgv, "--use-sage-attention"] : [...generatedArgv];
    const effectiveEnv: Record<string, string> = {
      CUDA_VISIBLE_DEVICES: gpuUuid,
      ...(options.env ?? {})
    };

    const checkpointFilename = samplingRecipe
      ? samplingRecipe.diffusionModel.filename
      : options.checkpointOverride === "fl2va"
        ? PINNED_H3_CHECKPOINTS.fl2va.filename
        : PINNED_H3_CHECKPOINTS.ref2va.filename;
    const checkpointHash = samplingRecipe
      ? samplingRecipe.diffusionModel.sha256
      : options.checkpointOverride === "fl2va"
        ? PINNED_H3_CHECKPOINTS.fl2va.sha256
        : PINNED_H3_CHECKPOINTS.ref2va.sha256;

    // Derive deterministic workflow graph
    const baseDerivedGraph = deriveExperimentGraph({
      baseWorkflow: baseWorkflowParsed,
      route,
      runId,
      seed,
      frames: validatedFrames,
      width,
      height,
      prompt,
      references: processedReferences,
      ...(options.stepOverride !== undefined ? { stepOverride: options.stepOverride } : {}),
      ...(isV2 && options.checkpointOverride ? { checkpointOverride: checkpointFilename } : {})
    });

    let derivedGraph = baseDerivedGraph;
    let attentionTopology: MinimaxH3AttentionTopology | undefined;
    let teaCacheCatalogEntry: MinimaxH3TeaCacheCatalogEntry | undefined;
    let teaCacheTopologyDigest: string | undefined;
    let teaCachePatchNode: MinimaxH3TeaCachePatchNode | null = null;
    let teaCacheConfig: MinimaxH3TeaCacheConfig | undefined;
    let localAdapterDigest = TEACACHE_LOCAL_ADAPTER_DIGEST;

    if (isTeaCache || isTeaCacheMatchedControl) {
      const adapterDir = resolve(process.cwd(), "experiments/minimax-h3-teacache");
      const observedHashes: Record<string, string> = {};
      for (const [fName, expHash] of Object.entries(TEACACHE_LOCAL_ADAPTER_FILE_HASHES)) {
        const p = resolve(adapterDir, fName);
        if (!existsSync(p)) {
          throw new Error(`TeaCache local adapter file "${fName}" not found at ${p}`);
        }
        const buf = await readFile(p);
        const actual = createHash("sha256").update(buf).digest("hex");
        if (actual !== expHash) {
          throw new Error(
            `TeaCache local adapter file hash mismatch for "${fName}": expected ${expHash}, computed ${actual}`
          );
        }
        observedHashes[fName] = actual;
      }
      localAdapterDigest = computeLocalTeaCacheAdapterDigest(observedHashes);
    }

    if (samplingRecipe) {
      derivedGraph = applySamplingRecipeToGraph({
        baseWorkflow: baseDerivedGraph,
        recipe: samplingRecipe,
        route
      });
      const recipeValidation = validateSamplingRecipeTopology(derivedGraph, samplingRecipe, route);
      if (!recipeValidation.valid) {
        throw new Error(
          `Sampling recipe topology validation failed for recipe "${samplingRecipe.name}":\n${recipeValidation.errors.join("\n")}`
        );
      }
    } else if (isTeaCache) {
      const tcThreshold = options.teacacheThreshold!;
      const tcStartStep = options.teacacheStartStep!;
      const tcEndStep = options.teacacheEndStep!;
      const tcTotalSteps = options.teacacheTotalSteps!;

      const tcValidation = validateTeaCacheParameters({
        relL1Thresh: tcThreshold,
        startStep: tcStartStep,
        endStep: tcEndStep,
        totalSteps: tcTotalSteps
      });

      teaCacheCatalogEntry = getTeaCacheCatalogEntry("teacache-raw-l1", route);

      teaCacheConfig = {
        mode: "raw-l1-v1" as const,
        relL1Thresh: tcThreshold,
        startStep: tcStartStep,
        endStep: tcEndStep,
        totalSteps: 20 as const,
        normalizedStartStep: tcValidation.normalizedStartStep,
        normalizedEndStep: tcValidation.normalizedEndStep
      };

      const { graph: tcGraph, patchNode } = deriveTeaCacheGraph({
        baseWorkflow: baseDerivedGraph,
        route,
        config: teaCacheConfig
      });
      derivedGraph = tcGraph;
      teaCachePatchNode = patchNode;

      const tcTopoValidation = validateTeaCacheTopology(derivedGraph, {
        expectedMode: "raw-l1-v1",
        route,
        expectedConfig: teaCacheConfig
      });
      if (!tcTopoValidation.valid) {
        throw new Error(
          `TeaCache topology validation failed:\n${tcTopoValidation.errors.join("\n")}`
        );
      }
      teaCacheTopologyDigest = tcTopoValidation.topologyDigest;
    } else if (isTeaCacheMatchedControl) {
      teaCacheCatalogEntry = getTeaCacheCatalogEntry("matched-control", route);
      derivedGraph = baseDerivedGraph;
      const tcTopoValidation = validateTeaCacheTopology(derivedGraph, {
        expectedMode: "off",
        route,
        expectedConfig: null
      });
      if (!tcTopoValidation.valid) {
        throw new Error(
          `TeaCache matched control topology validation failed:\n${tcTopoValidation.errors.join("\n")}`
        );
      }
      teaCacheTopologyDigest = tcTopoValidation.topologyDigest;
    } else if (attentionVariant !== undefined && attentionCatalogEntry) {
      const fixturePath = getAttentionFixturePath(attentionVariant, options.fixturesDir);
      let fixtureRaw: unknown;
      try {
        fixtureRaw = await this.store.readJsonFile<unknown>(fixturePath);
      } catch (err) {
        throw new Error(
          `Attention fixture missing or unreadable at "${fixturePath}": ${(err as Error).message}`
        );
      }
      const evidence = parseAttentionEvidence(fixtureRaw);
      const targetCoreRevision = options.coreRevision ?? attentionCatalogEntry.comfyuiCoreRevision;
      const targetCustomNode = attentionCatalogEntry.customNode;
      const resolved = resolveAttentionEvidence({
        variant: attentionVariant,
        evidence,
        coreRevision: targetCoreRevision,
        customNode: targetCustomNode
      });
      if (!resolved.valid || !resolved.isResolved) {
        throw new Error(
          `Attention evidence resolution failed for variant "${attentionVariant}":\n${resolved.errors.join("\n")}`
        );
      }

      const { graph: attGraph, topology } = deriveAttentionGraph({
        graph: baseDerivedGraph,
        attentionVariant,
        route,
        evidence,
        coreRevision: targetCoreRevision,
        customNode: targetCustomNode
      });
      derivedGraph = attGraph;
      attentionTopology = topology;

      const topoValidation = validateAttentionTopology(derivedGraph, {
        expectedVariant: attentionVariant,
        route,
        argv: effectiveArgv,
        env: effectiveEnv,
        evidence,
        coreRevision: targetCoreRevision,
        customNode: targetCustomNode
      });
      if (!topoValidation.valid) {
        throw new Error(
          `Attention topology validation failed for variant "${attentionVariant}":\n${topoValidation.errors.join("\n")}`
        );
      }
    }

    const derivedWorkflowCanonical = canonicalizeJson(derivedGraph);
    const derivedWorkflowDigest = sha256Hex(derivedWorkflowCanonical);
    const configDigest =
      isV2 && isTeaCache && teaCacheConfig
        ? computeTeaCacheConfigDigest({
            workflowDigest: derivedWorkflowDigest,
            argv: effectiveArgv,
            teacacheConfig: teaCacheConfig
          })
        : isV2 && isTeaCacheMatchedControl
          ? computeTeaCacheConfigDigest({
              workflowDigest: derivedWorkflowDigest,
              argv: effectiveArgv,
              teacacheConfig: null
            })
          : isV2 && options.attentionVariant !== undefined
            ? computeAttentionConfigDigest({
                workflowDigest: derivedWorkflowDigest,
                argv: effectiveArgv,
                attentionVariant: options.attentionVariant
              })
            : derivedWorkflowDigest;

    const promptDigest = sha256Hex(prompt);
    const comparisonKey = computeComparisonKey({
      route,
      frames: validatedFrames,
      requestedDurationMs: requestedDurationMs ?? durationInfo.configuredDurationMs,
      width,
      height,
      promptDigest,
      seed,
      references: processedReferences.map((r) => ({
        slotIndex: r.slotIndex,
        role: r.role,
        tag: r.tag,
        order: r.order,
        sha256: r.sha256
      })),
      referenceHashes: processedReferences.map((r) => r.sha256),
      runnerVariant,
      memoryPolicy: requestedPolicy,
      // Matches requestedRunner.offloadSettings.modelOffload below
      // (currently always true -- there is no configurable path for
      // this yet). Keep this literal in sync if that ever changes.
      modelOffload: true,
      workflowDigest: derivedWorkflowDigest,
      comfyuiCoreRevision: samplingRecipe
        ? samplingRecipe.requiredRuntimeRevision
        : attentionCatalogEntry
          ? attentionCatalogEntry.comfyuiCoreRevision
          : PINNED_COMFYUI_CORE_REVISION,
      modelDigests: {
        [`diffusion_models/${checkpointFilename}`]: checkpointHash,
        ...(samplingRecipe?.lora
          ? { [`loras/${samplingRecipe.lora.filename}`]: samplingRecipe.lora.sha256 }
          : {}),
        "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors":
          "35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6",
        "vae/minimax_h3_video_vae_int8_convrot.safetensors":
          "52a2c8c73583c86e4f41cdcce3a6ad0ea562987bc0bf3d60a0cef5f5c8e60c0e",
        "vae/minimax_h3_audio_vae_fp32.safetensors":
          "8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48"
      },
      target: {
        hostname: targetHost,
        gpuUuid
      }
    });

    const baseProfileKey =
      route === "i2v"
        ? ("MINIMAX_H3_720P_5S_I2V_V1" as const)
        : ("MINIMAX_H3_720P_5S_REF2V_V1" as const);
    const profilePath = resolveProfilePath(baseProfileKey);
    if (!existsSync(profilePath)) {
      throw new Error(`Base profile file not found at ${profilePath}`);
    }
    let profileRaw: string;
    try {
      profileRaw = await this.store.readTextFile(profilePath);
    } catch {
      profileRaw = await readFile(profilePath, "utf8");
    }
    const baseProfileFileDigest = sha256Hex(profileRaw);

    let descriptor: MinimaxH3AnyExperimentDescriptor;
    if (isV2) {
      const declaredChanges: MinimaxH3FactorChange[] = [...(options.changedFactors ?? [])];
      if (
        options.stepOverride !== undefined &&
        !declaredChanges.some((c) => c.path === "sampling.settings")
      ) {
        declaredChanges.push({
          path: "sampling.settings",
          before: { sampler: "res_multistep", scheduler: "simple", steps: 20 },
          after: { sampler: "res_multistep", scheduler: "simple", steps: options.stepOverride },
          rationale: "Step count experimental variant"
        });
      }
      if (
        options.checkpointOverride !== undefined &&
        !declaredChanges.some((c) => c.path === "models.diffusion")
      ) {
        declaredChanges.push({
          path: "models.diffusion",
          before: {
            repository: "Comfy-Org/MiniMax-H3",
            revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1",
            filename: PINNED_H3_CHECKPOINTS.ref2va.filename,
            fileHash: PINNED_H3_CHECKPOINTS.ref2va.sha256,
            taskMode: "ref2va",
            licenseSourceRef: "https://huggingface.co/Comfy-Org/MiniMax-H3"
          },
          after: {
            repository: "Comfy-Org/MiniMax-H3",
            revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1",
            filename: checkpointFilename,
            fileHash: checkpointHash,
            taskMode: options.checkpointOverride === "fl2va" ? "fl2va" : "ref2va",
            licenseSourceRef: "https://huggingface.co/Comfy-Org/MiniMax-H3"
          },
          rationale: "Checkpoint experimental audit variant"
        });
      }

      if (samplingRecipe) {
        if (samplingRecipe.lora && !declaredChanges.some((c) => c.path === "models.auxiliary")) {
          declaredChanges.push({
            path: "models.auxiliary",
            before: [],
            after: [
              {
                name: samplingRecipe.lora.filename,
                hash: samplingRecipe.lora.sha256,
                strength: samplingRecipe.lora.strengthModel,
                role: "lora",
                order: 0
              }
            ],
            rationale: `Sampling recipe LoRA distillation: ${samplingRecipe.name}`
          });
        }
        if (
          samplingRecipe.expectedSteps !== 20 &&
          !declaredChanges.some((c) => c.path === "sampling.settings")
        ) {
          declaredChanges.push({
            path: "sampling.settings",
            before: { sampler: "res_multistep", scheduler: "simple", steps: 20 },
            after: {
              sampler: samplingRecipe.sampler,
              scheduler: samplingRecipe.scheduler,
              steps: samplingRecipe.expectedSteps
            },
            rationale: `Sampling recipe step schedule: ${samplingRecipe.name} (${samplingRecipe.expectedSteps} steps)`
          });
        }
        if (
          samplingRecipe.sigmaShift?.enabled &&
          !declaredChanges.some((c) => c.path === "sampling.sigmaShift")
        ) {
          declaredChanges.push({
            path: "sampling.sigmaShift",
            before: { enabled: false, videoShift: 12.0, audioShift: 3.0 },
            after: {
              enabled: true,
              videoShift: samplingRecipe.sigmaShift.videoShift,
              audioShift: samplingRecipe.sigmaShift.audioShift
            },
            rationale: `Sampling recipe sigma shift: ${samplingRecipe.name}`
          });
        }
        if (
          samplingRecipe.name !== "fl2va-turbo-8" &&
          samplingRecipe.diffusionModel.filename !== PINNED_H3_CHECKPOINTS.ref2va.filename &&
          !declaredChanges.some((c) => c.path === "models.diffusion")
        ) {
          const beforeCheckpoint =
            samplingRecipe.name === "fasth3-i2v-8"
              ? PINNED_H3_CHECKPOINTS.fl2va
              : PINNED_H3_CHECKPOINTS.ref2va;
          const beforeTaskMode = samplingRecipe.name === "fasth3-i2v-8" ? "fl2va" : "ref2va";
          declaredChanges.push({
            path: "models.diffusion",
            before: {
              repository: "Comfy-Org/MiniMax-H3",
              revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1",
              filename: beforeCheckpoint.filename,
              fileHash: beforeCheckpoint.sha256,
              taskMode: beforeTaskMode,
              licenseSourceRef: "https://huggingface.co/Comfy-Org/MiniMax-H3"
            },
            after: {
              repository: samplingRecipe.diffusionModel.repository,
              revision: samplingRecipe.diffusionModel.revision,
              filename: samplingRecipe.diffusionModel.filename,
              fileHash: samplingRecipe.diffusionModel.sha256,
              taskMode: samplingRecipe.taskFamily,
              licenseSourceRef: samplingRecipe.licensing.licenseSourceRef
            },
            rationale: `Sampling recipe checkpoint: ${samplingRecipe.name}`
          });
        }
      }

      if (isTeaCache && teaCacheConfig && teaCacheTopologyDigest) {
        if (!declaredChanges.some((c) => c.path === "caching.configuration")) {
          declaredChanges.push({
            path: "caching.configuration",
            before: {
              mode: "off",
              relL1Thresh: 0.15,
              startStep: 2,
              endStep: -2,
              totalSteps: 20,
              topologyDigest: computeTeaCacheTopologyDigest(null),
              adapterVersion: TEACACHE_ADAPTER_VERSION
            },
            after: {
              mode: "raw-l1-v1",
              relL1Thresh: teaCacheConfig.relL1Thresh,
              startStep: teaCacheConfig.startStep,
              endStep: teaCacheConfig.endStep,
              totalSteps: 20,
              topologyDigest: teaCacheTopologyDigest,
              adapterVersion: TEACACHE_ADAPTER_VERSION
            },
            rationale: `TeaCache timestep caching variant (threshold=${teaCacheConfig.relL1Thresh}, window=[${teaCacheConfig.normalizedStartStep}, ${teaCacheConfig.normalizedEndStep}])`
          });
        }
      }

      const collectorPath = resolveCollectorPath();
      if (!collectorPath || !existsSync(collectorPath)) {
        throw new Error(
          `Collector script not found at resolved path: ${collectorPath ?? "none"}. Cannot prepare experiment.`
        );
      }
      let genuineCollectorDigest: string;
      try {
        const rawCollector = await readFile(collectorPath);
        genuineCollectorDigest = createHash("sha256").update(rawCollector).digest("hex");
      } catch (err: unknown) {
        throw new Error(
          `Failed to read collector script at ${collectorPath}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      const standardHooks = [...STANDARD_MINIMAX_H3_HOOKS];
      const genuineHookManifestDigest = sha256Hex(
        canonicalizeJson([...standardHooks].sort((a, b) => a.name.localeCompare(b.name)))
      );

      const baseRequiredRuntime: MinimaxH3RequiredRuntimeManifest = {
        coreRevision: PINNED_COMFYUI_CORE_REVISION,
        sourceFileHashes: {
          "comfy/model_management.py": PINNED_COMFYUI_SOURCE_HASHES.modelManagementSha256,
          "main.py": PINNED_COMFYUI_SOURCE_HASHES.mainSha256,
          "comfy/cli_args.py": PINNED_COMFYUI_SOURCE_HASHES.cliArgsSha256
        },
        requiredNodes: [
          {
            name: route === "i2v" ? "MiniMaxH3ImageToVideo" : "MiniMaxH3ReferenceToVideo"
          }
        ],
        pythonPackages: [
          {
            name: "torch",
            version: "2.5.1+cu124",
            importModule: "torch"
          }
        ],
        pytorchBuild: "2.5.1+cu124",
        cudaBuild: "12.4",
        driverConstraints: [">=550.00.00"],
        attentionKernel: "torch_sdpa",
        instrumentationProtocol: "v2-jsonl",
        collectorDigest: genuineCollectorDigest,
        hookManifestDigest: genuineHookManifestDigest,
        hooks: standardHooks
      };

      let recipeRequiredRuntime: MinimaxH3RequiredRuntimeManifest | undefined;
      if (samplingRecipe) {
        if (samplingRecipe.name === "fasth3-i2v-8") {
          recipeRequiredRuntime = {
            coreRevision: FASTH3_ISOLATED_CORE_REVISION,
            sourceFileHashes: { ...FASTH3_COMFYUI_SOURCE_HASHES },
            requiredNodes: [
              { name: "MiniMaxH3ImageToVideo" },
              { name: "BlockSparseAttention" },
              { name: "MiniMaxH3SigmaShift" },
              { name: "ModelAttentionBackend" }
            ],
            pythonPackages: [
              {
                name: "torch",
                version: "2.5.1+cu124",
                importModule: "torch"
              },
              {
                name: "comfy-kitchen",
                version: "0.2.34",
                importModule: "comfy_kitchen"
              }
            ],
            pytorchBuild: "2.5.1+cu124",
            cudaBuild: "12.4",
            driverConstraints: [">=550.00.00"],
            attentionKernel: "block_sparse_triton",
            instrumentationProtocol: "v2-jsonl",
            collectorDigest: genuineCollectorDigest,
            hookManifestDigest: genuineHookManifestDigest,
            hooks: standardHooks
          };
        } else if (samplingRecipe.lora) {
          recipeRequiredRuntime = {
            coreRevision: PINNED_COMFYUI_CORE_REVISION,
            sourceFileHashes: {
              "comfy/model_management.py": PINNED_COMFYUI_SOURCE_HASHES.modelManagementSha256,
              "main.py": PINNED_COMFYUI_SOURCE_HASHES.mainSha256,
              "comfy/cli_args.py": PINNED_COMFYUI_SOURCE_HASHES.cliArgsSha256,
              "nodes.py": PINNED_COMFYUI_NODES_PY_SHA256,
              "comfy_extras/nodes_minimax_h3.py": PINNED_COMFYUI_NODES_MINIMAX_H3_PY_SHA256
            },
            requiredNodes: [
              {
                name: route === "i2v" ? "MiniMaxH3ImageToVideo" : "MiniMaxH3ReferenceToVideo"
              },
              {
                name: "LoraLoaderModelOnly"
              }
            ],
            pythonPackages: [
              {
                name: "torch",
                version: "2.5.1+cu124",
                importModule: "torch"
              }
            ],
            pytorchBuild: "2.5.1+cu124",
            cudaBuild: "12.4",
            driverConstraints: [">=550.00.00"],
            attentionKernel: "torch_sdpa",
            instrumentationProtocol: "v2-jsonl",
            collectorDigest: genuineCollectorDigest,
            hookManifestDigest: genuineHookManifestDigest,
            hooks: standardHooks
          };
        } else {
          recipeRequiredRuntime = baseRequiredRuntime;
        }
      }

      let envInspection:
        | Awaited<
            ReturnType<NonNullable<MinimaxH3TargetPreflightPort["inspectEnvironmentIdentity"]>>
          >
        | undefined;
      const targetCoreRevision =
        samplingRecipe?.requiredRuntimeRevision ??
        attentionCatalogEntry?.comfyuiCoreRevision ??
        PINNED_COMFYUI_CORE_REVISION;
      const requiredPackagesToInspect: Array<{
        name: string;
        version?: string;
        importModule?: string;
      }> = [{ name: "torch", version: "2.5.1+cu124", importModule: "torch" }];
      if (attentionCatalogEntry?.pythonPackages) {
        for (const p of attentionCatalogEntry.pythonPackages) {
          if (!requiredPackagesToInspect.some((rp) => rp.name === p.name)) {
            const pkgToInspect: { name: string; version?: string; importModule?: string } = {
              name: p.name
            };
            if (p.version) pkgToInspect.version = p.version;
            if (p.importModule) pkgToInspect.importModule = p.importModule;
            requiredPackagesToInspect.push(pkgToInspect);
          }
        }
      }
      if (samplingRecipe?.name === "fasth3-i2v-8") {
        if (!requiredPackagesToInspect.some((rp) => rp.name === "comfy-kitchen")) {
          requiredPackagesToInspect.push({
            name: "comfy-kitchen",
            version: "0.2.34",
            importModule: "comfy_kitchen"
          });
        }
      }
      if (this.preflight?.inspectEnvironmentIdentity) {
        try {
          envInspection = await this.preflight.inspectEnvironmentIdentity({
            comfyUiDir,
            pythonPath,
            coreRevision: targetCoreRevision,
            requiredPackages: requiredPackagesToInspect,
            timeoutMs:
              ((options as unknown as Record<string, unknown>).startupTimeoutMs as
                number | undefined) ?? 30000
          });
        } catch {
          // preflight inspection failure handled below
        }
      }

      if (envInspection?.ok) {
        if (envInspection.interpreter) {
          baseRequiredRuntime.interpreter = envInspection.interpreter;
          if (recipeRequiredRuntime) {
            recipeRequiredRuntime.interpreter = envInspection.interpreter;
          }
        }
        if (envInspection.pythonPackages && envInspection.pythonPackages.length > 0) {
          const basePkgMap = new Map(baseRequiredRuntime.pythonPackages.map((p) => [p.name, p]));
          for (const mp of envInspection.pythonPackages) {
            basePkgMap.set(mp.name, {
              ...basePkgMap.get(mp.name),
              ...mp
            });
          }
          baseRequiredRuntime.pythonPackages = Array.from(basePkgMap.values());
          if (recipeRequiredRuntime) {
            const recipePkgMap = new Map(
              recipeRequiredRuntime.pythonPackages.map((p) => [p.name, p])
            );
            for (const mp of envInspection.pythonPackages) {
              recipePkgMap.set(mp.name, {
                ...recipePkgMap.get(mp.name),
                ...mp
              });
            }
            recipeRequiredRuntime.pythonPackages = Array.from(recipePkgMap.values());
          }
        }
        if (
          envInspection.sourceFileHashes &&
          Object.keys(envInspection.sourceFileHashes).length > 0
        ) {
          baseRequiredRuntime.sourceFileHashes = {
            ...baseRequiredRuntime.sourceFileHashes,
            ...envInspection.sourceFileHashes
          };
          if (recipeRequiredRuntime) {
            recipeRequiredRuntime.sourceFileHashes = {
              ...envInspection.sourceFileHashes,
              ...recipeRequiredRuntime.sourceFileHashes
            };
          }
        }
        if (envInspection.pytorchBuild) {
          baseRequiredRuntime.pytorchBuild = envInspection.pytorchBuild;
          if (recipeRequiredRuntime) {
            recipeRequiredRuntime.pytorchBuild = envInspection.pytorchBuild;
          }
        }
        if (envInspection.cudaBuild) {
          baseRequiredRuntime.cudaBuild = envInspection.cudaBuild;
          if (recipeRequiredRuntime) {
            recipeRequiredRuntime.cudaBuild = envInspection.cudaBuild;
          }
        }
        if (envInspection.driverConstraints && envInspection.driverConstraints.length > 0) {
          baseRequiredRuntime.driverConstraints = envInspection.driverConstraints;
          if (recipeRequiredRuntime) {
            recipeRequiredRuntime.driverConstraints = envInspection.driverConstraints;
          }
        }
      }

      if (this.preflight && attentionCatalogEntry) {
        if (!envInspection || !envInspection.ok) {
          throw new Error(
            `Attention manifest for variant "${attentionCatalogEntry.variantName}" requires complete measured environment identity: ${envInspection?.blocker ?? "inspectEnvironmentIdentity failed or unavailable"}`
          );
        }
      }

      const upgradedRequiredRuntime: MinimaxH3RequiredRuntimeManifest = attentionCatalogEntry
        ? buildRequiredRuntimeManifestFromAttentionCatalog(attentionCatalogEntry, route, {
            collectorDigest: genuineCollectorDigest,
            hookManifestDigest: genuineHookManifestDigest,
            hooks: standardHooks,
            ...(envInspection?.sourceFileHashes
              ? { sourceFileHashes: envInspection.sourceFileHashes }
              : {}),
            ...(envInspection?.pytorchBuild ? { pytorchBuild: envInspection.pytorchBuild } : {}),
            ...(envInspection?.cudaBuild ? { cudaBuild: envInspection.cudaBuild } : {}),
            ...(envInspection?.driverConstraints
              ? { driverConstraints: envInspection.driverConstraints }
              : {}),
            ...(envInspection?.interpreter ? { interpreter: envInspection.interpreter } : {}),
            ...(envInspection?.pythonPackages
              ? { pythonPackages: envInspection.pythonPackages }
              : {})
          })
        : (recipeRequiredRuntime ?? baseRequiredRuntime);

      const teaCacheRequiredRuntime: MinimaxH3RequiredRuntimeManifest = {
        ...baseRequiredRuntime,
        requiredNodes: [...baseRequiredRuntime.requiredNodes, { name: "CCOMiniMaxH3TeaCache" }]
      };
      const teaCacheRuntimeManifestDigest = sha256Hex(canonicalizeJson(teaCacheRequiredRuntime));

      const baseRuntimeManifestDigest = sha256Hex(canonicalizeJson(baseRequiredRuntime));
      const upgradedRuntimeManifestDigest = sha256Hex(canonicalizeJson(upgradedRequiredRuntime));
      const recipeRuntimeManifestDigest = recipeRequiredRuntime
        ? sha256Hex(canonicalizeJson(recipeRequiredRuntime))
        : baseRuntimeManifestDigest;
      const baseHookManifestDigest = sha256Hex(canonicalizeJson(baseRequiredRuntime.hooks));
      const upgradedHookManifestDigest = sha256Hex(canonicalizeJson(upgradedRequiredRuntime.hooks));
      const recipeHookManifestDigest = recipeRequiredRuntime
        ? sha256Hex(canonicalizeJson(recipeRequiredRuntime.hooks))
        : baseHookManifestDigest;

      if (samplingRecipe) {
        if (
          samplingRecipe.attentionTopology &&
          !declaredChanges.some((c) => c.path === "attention.configuration")
        ) {
          declaredChanges.push({
            path: "attention.configuration",
            before: {
              backend: "torch_sdpa",
              topologyDigest: computeAttentionTopologyDigest([]),
              patches: []
            },
            after: {
              backend: samplingRecipe.attentionTopology.backend,
              topologyDigest: samplingRecipe.attentionTopology.topologyDigest,
              patches: samplingRecipe.attentionTopology.patches.map((p) => p.classType)
            },
            rationale: `Sampling recipe attention topology: ${samplingRecipe.name}`
          });
        }
        if (
          recipeRuntimeManifestDigest !== baseRuntimeManifestDigest &&
          !declaredChanges.some((c) => c.path === "runtime.manifest")
        ) {
          declaredChanges.push({
            path: "runtime.manifest",
            before: {
              runtimeManifestDigest: baseRuntimeManifestDigest,
              hookManifestDigest: baseHookManifestDigest
            },
            after: {
              runtimeManifestDigest: recipeRuntimeManifestDigest,
              hookManifestDigest: recipeHookManifestDigest
            },
            rationale: `Isolated runtime configuration required for sampling recipe: ${samplingRecipe.name}`
          });
        }
      }

      if (
        options.attentionVariant !== undefined &&
        options.attentionVariant !== "dense" &&
        attentionCatalogEntry &&
        attentionTopology
      ) {
        if (!declaredChanges.some((c) => c.path === "attention.configuration")) {
          declaredChanges.push({
            path: "attention.configuration",
            before: {
              backend: "torch_sdpa",
              topologyDigest: computeAttentionTopologyDigest([]),
              patches: []
            },
            after: {
              backend: attentionCatalogEntry.backend,
              topologyDigest: attentionTopology.topologyDigest,
              patches: attentionTopology.patches.map((p) => p.classType)
            },
            rationale: `Attention optimization variant: ${options.attentionVariant}`
          });
        }
        if (
          attentionCatalogEntry.comfyuiCoreRevision !== PINNED_COMFYUI_CORE_REVISION &&
          !declaredChanges.some((c) => c.path === "runtime.manifest")
        ) {
          declaredChanges.push({
            path: "runtime.manifest",
            before: {
              runtimeManifestDigest: baseRuntimeManifestDigest,
              hookManifestDigest: baseHookManifestDigest
            },
            after: {
              runtimeManifestDigest: upgradedRuntimeManifestDigest,
              hookManifestDigest: upgradedHookManifestDigest
            },
            rationale: `Isolated runtime upgrade required for attention backend: ${options.attentionVariant}`
          });
        }
      }

      const descriptorWithoutDigest = {
        schemaVersion: 2 as const,
        kind: "non-production-experiment" as const,
        runId,
        operatorLabel,
        route,
        configuredFrames: validatedFrames,
        fps: 24 as const,
        requestedDurationMs: requestedDurationMs ?? durationInfo.configuredDurationMs,
        requestedDurationSupplied: requestedDurationMs !== undefined,
        configuredDurationMs: durationInfo.configuredDurationMs,
        width,
        height,
        seed,
        prompt,
        promptDigest,
        baseProfileKey,
        baseProfileVersion: 1 as const,
        baseProfileFileDigest,
        provenanceManifestDigest: provenanceDigest,
        provenanceSource,
        baseCanonicalWorkflowDigest,
        derivedWorkflowDigest,
        pinFileIdentities: {
          comfyuiCoreRevision: samplingRecipe
            ? samplingRecipe.requiredRuntimeRevision
            : PINNED_COMFYUI_CORE_REVISION,
          minimaxH3Revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1",
          modelDigests: {
            [`diffusion_models/${checkpointFilename}`]: checkpointHash,
            ...(samplingRecipe?.lora
              ? { [`loras/${samplingRecipe.lora.filename}`]: samplingRecipe.lora.sha256 }
              : {}),
            "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors":
              "35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6",
            "vae/minimax_h3_video_vae_int8_convrot.safetensors":
              "52a2c8c73583c86e4f41cdcce3a6ad0ea562987bc0bf3d60a0cef5f5c8e60c0e",
            "vae/minimax_h3_audio_vae_fp32.safetensors":
              "8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48"
          }
        },
        resolvedModelPaths: {
          [`diffusion_models/${checkpointFilename}`]: {
            expectedHash: checkpointHash,
            resolvedPath: `${comfyUiDir}/models/diffusion_models/${checkpointFilename}`,
            sizeBytes: samplingRecipe?.diffusionModel.sizeBytes ?? 20970379616
          },
          ...(samplingRecipe?.lora
            ? {
                [`loras/${samplingRecipe.lora.filename}`]: {
                  expectedHash: samplingRecipe.lora.sha256,
                  resolvedPath: `${comfyUiDir}/models/loras/${samplingRecipe.lora.filename}`,
                  sizeBytes: samplingRecipe.lora.sizeBytes
                }
              }
            : {}),
          "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors": {
            expectedHash: "35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6",
            resolvedPath: `${comfyUiDir}/models/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`,
            sizeBytes: 15687142551
          },
          "vae/minimax_h3_video_vae_int8_convrot.safetensors": {
            expectedHash: "52a2c8c73583c86e4f41cdcce3a6ad0ea562987bc0bf3d60a0cef5f5c8e60c0e",
            resolvedPath: `${comfyUiDir}/models/vae/minimax_h3_video_vae_int8_convrot.safetensors`,
            sizeBytes: 2811065184
          },
          "vae/minimax_h3_audio_vae_fp32.safetensors": {
            expectedHash: "8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48",
            resolvedPath: `${comfyUiDir}/models/vae/minimax_h3_audio_vae_fp32.safetensors`,
            sizeBytes: 605254808
          }
        },
        referenceSetId,
        references: processedReferences,
        refImageSize:
          route === "ref2v"
            ? rawRefs.length > 0
              ? ("max" as const)
              : ("match" as const)
            : undefined,
        requestedRunner: {
          variantName: runnerVariant,
          variantReason,
          memoryPolicy: requestedPolicy,
          offloadSettings: {
            modelOffload: true
          }
        },
        configuredRunner: {
          argv: effectiveArgv as string[],
          env: effectiveEnv,
          predictedPolicy,
          pinnedSourceIdentities:
            samplingRecipe?.name === "fasth3-i2v-8"
              ? {
                  cliArgsSha256: FASTH3_COMFYUI_SOURCE_HASHES["comfy/cli_args.py"],
                  mainSha256: FASTH3_COMFYUI_SOURCE_HASHES["main.py"],
                  modelManagementSha256: FASTH3_COMFYUI_SOURCE_HASHES["comfy/model_management.py"]
                }
              : samplingRecipe?.lora
                ? {
                    ...PINNED_COMFYUI_SOURCE_HASHES,
                    nodesPySha256: PINNED_COMFYUI_NODES_PY_SHA256
                  }
                : PINNED_COMFYUI_SOURCE_HASHES
        },
        target: {
          hostname: targetHost,
          gpuUuid,
          comfyUiDir,
          pythonPath,
          address,
          port
        },
        collectionIntervalMs: 1000,
        timeouts,
        configDigest,
        comparisonKey,
        experimentVariant: {
          variantName: runnerVariant,
          variantReason: variantReason ?? "experimental variant",
          purpose:
            options.variantPurpose ??
            (samplingRecipe?.name === "fasth3-i2v-8"
              ? "controlled_multifactor"
              : options.stepOverride !== undefined
                ? "performance"
                : "performance"),
          changedFactors: declaredChanges
        },
        provenance: {
          canonicalTemplateHash: baseCanonicalWorkflowDigest,
          derivedWorkflowDigest,
          actualCheckpointHash: checkpointHash,
          loadedModelHashes: {
            diffusion: checkpointHash,
            [`diffusion_models/${checkpointFilename}`]: checkpointHash,
            ...(samplingRecipe?.lora
              ? {
                  lora: samplingRecipe.lora.sha256,
                  [`loras/${samplingRecipe.lora.filename}`]: samplingRecipe.lora.sha256
                }
              : {})
          },
          comfyuiCoreRevision: samplingRecipe
            ? samplingRecipe.requiredRuntimeRevision
            : attentionCatalogEntry
              ? attentionCatalogEntry.comfyuiCoreRevision
              : PINNED_COMFYUI_CORE_REVISION,
          sourceIdentities:
            samplingRecipe?.name === "fasth3-i2v-8"
              ? {
                  cliArgsSha256: FASTH3_COMFYUI_SOURCE_HASHES["comfy/cli_args.py"],
                  mainSha256: FASTH3_COMFYUI_SOURCE_HASHES["main.py"],
                  modelManagementSha256: FASTH3_COMFYUI_SOURCE_HASHES["comfy/model_management.py"],
                  nodesMinimaxH3Sha256:
                    FASTH3_COMFYUI_SOURCE_HASHES["comfy_extras/nodes_minimax_h3.py"]
                }
              : samplingRecipe?.lora
                ? {
                    ...PINNED_COMFYUI_SOURCE_HASHES,
                    nodesPySha256: PINNED_COMFYUI_NODES_PY_SHA256
                  }
                : PINNED_COMFYUI_SOURCE_HASHES,
          customNodeInventory: {
            status: "verified_empty" as const,
            nodes: []
          },
          runtimeVersions: {
            pythonVersion: "3.11.9",
            pytorchVersion: "2.4.1+cu124",
            cudaBuildVersion: "12.4",
            cudaRuntimeVersion: "12.4",
            driverVersion: "560.35.03"
          },
          requestedAttentionBackend: samplingRecipe?.attentionTopology
            ? samplingRecipe.attentionTopology.backend
            : options.attentionVariant !== undefined && attentionCatalogEntry
              ? attentionCatalogEntry.backend
              : "default",
          requestedMemoryPolicy: requestedPolicy,
          samplerSettings: {
            sampler: samplingRecipe?.sampler ?? "res_multistep",
            scheduler: samplingRecipe?.scheduler ?? "simple",
            steps: samplingRecipe?.expectedSteps ?? options.stepOverride ?? 20
          },
          sourceAssetDigests: processedReferences.map((r) => ({
            role: r.role,
            slotIndex: r.slotIndex,
            sha256: r.sha256
          })),
          promptDigest,
          instrumentationProtocol: "v2-jsonl",
          collectorDigest: genuineCollectorDigest,
          hookManifestDigest: samplingRecipe ? recipeHookManifestDigest : genuineHookManifestDigest
        },
        compatibility:
          isTeaCache && teaCacheCatalogEntry
            ? {
                state: teaCacheCatalogEntry.compatibilityState,
                relativeToRuntimeManifestDigest: teaCacheRuntimeManifestDigest,
                scope: teaCacheCatalogEntry.scope,
                reasons: teaCacheCatalogEntry.blockers,
                sources: teaCacheCatalogEntry.evidence
              }
            : isTeaCacheMatchedControl
              ? (() => {
                  const mcEntry = getTeaCacheCatalogEntry("matched-control", route);
                  return {
                    state: mcEntry.compatibilityState,
                    relativeToRuntimeManifestDigest: teaCacheRuntimeManifestDigest,
                    scope: mcEntry.scope,
                    reasons: mcEntry.blockers,
                    sources: mcEntry.evidence
                  };
                })()
              : samplingRecipe
                ? {
                    state:
                      samplingRecipe.requiredRuntimeRevision === PINNED_COMFYUI_CORE_REVISION
                        ? ("supported" as const)
                        : ("requires_isolated_upgrade" as const),
                    relativeToRuntimeManifestDigest: recipeRuntimeManifestDigest,
                    scope: `${route}-${samplingRecipe.name}`,
                    reasons: [
                      `Sampling recipe ${samplingRecipe.name} targeting revision ${samplingRecipe.requiredRuntimeRevision}`
                    ],
                    sources: samplingRecipe.sourceReferences
                  }
                : options.attentionVariant !== undefined && attentionCatalogEntry
                  ? {
                      state: attentionCatalogEntry.compatibilityState,
                      relativeToRuntimeManifestDigest:
                        attentionCatalogEntry.comfyuiCoreRevision === PINNED_COMFYUI_CORE_REVISION
                          ? baseRuntimeManifestDigest
                          : upgradedRuntimeManifestDigest,
                      scope: attentionCatalogEntry.scope,
                      reasons: attentionCatalogEntry.blockers,
                      sources: attentionCatalogEntry.evidence
                    }
                  : {
                      state: "supported" as const,
                      relativeToRuntimeManifestDigest: baseRuntimeManifestDigest,
                      scope: `${route}-${validatedFrames}f-${options.stepOverride ?? 20}steps`,
                      reasons: ["Verified on pinned ComfyUI core revision 55b6a9b1"],
                      sources: [
                        {
                          url: "https://github.com/comfyanonymous/ComfyUI/commit/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
                          assertion: "Current pinned production commit"
                        }
                      ]
                    },
        requiredRuntime: samplingRecipe
          ? recipeRequiredRuntime!
          : isTeaCache || isTeaCacheMatchedControl
            ? teaCacheRequiredRuntime
            : options.attentionVariant !== undefined
              ? upgradedRequiredRuntime
              : baseRequiredRuntime,
        conditioning: {
          positivePrompt: {
            text: prompt,
            digest: promptDigest
          },
          negativePrompt: {
            status: "not_supported" as const,
            text: null,
            digest: null
          },
          bindings: processedReferences.map((r) => ({
            role: r.role,
            slotIndex: r.slotIndex,
            kind: route === "i2v" ? ("first_frame" as const) : ("reference" as const),
            assetPath: r.assetPath,
            sha256: r.sha256,
            targetNodeId: route === "i2v" ? "20" : String(201 + r.slotIndex),
            targetInputName: "image"
          }))
        },
        stepOverride: options.stepOverride ?? null,
        checkpointOverride: options.checkpointOverride ?? null,
        ...(samplingRecipe ? { samplingRecipe } : {}),
        ...(options.attentionVariant !== undefined && attentionCatalogEntry && attentionTopology
          ? {
              attentionRequest: {
                attentionVariant: options.attentionVariant,
                catalogDigest: attentionCatalogEntry.catalogDigest,
                expectedBackend: attentionCatalogEntry.backend,
                expectedKernel: attentionCatalogEntry.kernel,
                topologyDigest: attentionTopology.topologyDigest,
                patches: attentionTopology.patches,
                runtimeLockDigest: computeAttentionRuntimeLockDigest({
                  comfyuiCoreRevision: upgradedRequiredRuntime.coreRevision,
                  customNodeRevision: attentionCatalogEntry.customNode?.revision,
                  sourceFileHashes: upgradedRequiredRuntime.sourceFileHashes,
                  interpreter: upgradedRequiredRuntime.interpreter,
                  pytorchBuild: upgradedRequiredRuntime.pytorchBuild,
                  cudaBuild: upgradedRequiredRuntime.cudaBuild,
                  driverConstraints: upgradedRequiredRuntime.driverConstraints,
                  pythonPackages: upgradedRequiredRuntime.pythonPackages,
                  cudaRequirement: attentionCatalogEntry.cudaRequirement,
                  computeCapability: attentionCatalogEntry.computeCapability,
                  instrumentationProtocol: upgradedRequiredRuntime.instrumentationProtocol,
                  collectorDigest: upgradedRequiredRuntime.collectorDigest,
                  hookManifestDigest: upgradedRequiredRuntime.hookManifestDigest,
                  hooks: upgradedRequiredRuntime.hooks
                }),
                candidateOnly: !attentionCatalogEntry.runnable,
                ...(attentionCatalogEntry.predictor
                  ? {
                      predictorIdentity: {
                        filename: attentionCatalogEntry.predictor.filename,
                        sha256: attentionCatalogEntry.predictor.sha256
                      }
                    }
                  : {}),
                denseRegionPolicy: attentionCatalogEntry.denseRegionPolicy
              }
            }
          : {}),
        ...(isTeaCache && teaCacheConfig && teaCacheCatalogEntry && teaCachePatchNode
          ? {
              teacacheRequest: {
                mode: "raw-l1-v1" as const,
                relL1Thresh: teaCacheConfig.relL1Thresh,
                startStep: teaCacheConfig.startStep,
                endStep: teaCacheConfig.endStep,
                totalSteps: 20 as const,
                normalizedStartStep: teaCacheConfig.normalizedStartStep,
                normalizedEndStep: teaCacheConfig.normalizedEndStep,
                upstreamCommit: TEACACHE_UPSTREAM_COMMIT,
                adapterVersion: TEACACHE_ADAPTER_VERSION,
                adapterDigest: localAdapterDigest,
                catalogDigest: teaCacheCatalogEntry.catalogDigest,
                topologyDigest: teaCacheTopologyDigest!,
                patchNode: teaCachePatchNode
              }
            }
          : isTeaCacheMatchedControl
            ? (() => {
                const mcEntry = getTeaCacheCatalogEntry("matched-control", route);
                return {
                  teacacheRequest: {
                    mode: "off" as const,
                    relL1Thresh: 0.15,
                    startStep: 2,
                    endStep: -2,
                    totalSteps: 20 as const,
                    normalizedStartStep: 2,
                    normalizedEndStep: 18,
                    upstreamCommit: TEACACHE_UPSTREAM_COMMIT,
                    adapterVersion: TEACACHE_ADAPTER_VERSION,
                    adapterDigest: localAdapterDigest,
                    catalogDigest: mcEntry.catalogDigest,
                    topologyDigest: teaCacheTopologyDigest ?? computeTeaCacheTopologyDigest(null),
                    patchNode: null
                  }
                };
              })()
            : {})
      };

      const descriptorDigest = computeDescriptorDigest(
        descriptorWithoutDigest as unknown as Record<string, unknown>
      );
      descriptor = {
        ...descriptorWithoutDigest,
        descriptorDigest
      } as MinimaxH3ExperimentDescriptorV2;

      MinimaxH3ExperimentDescriptorV2Schema.parse(descriptor);
      await this.store.writeDescriptor(runDir, descriptor);
      await this.store.writeConfig(runDir, derivedGraph);
      await this.store.writeInputManifest(runDir, inputManifest);
      const template = createEmptyMinimaxH3MeasurementTemplateV2(
        descriptor as MinimaxH3ExperimentDescriptorV2
      );
      await this.store.writeMeasurementTemplate(runDir, template);
    } else {
      const descriptorWithoutDigest = {
        schemaVersion: 1 as const,
        kind: "non-production-experiment" as const,
        runId,
        operatorLabel,
        route,
        configuredFrames: validatedFrames,
        fps: 24 as const,
        requestedDurationMs: requestedDurationMs ?? durationInfo.configuredDurationMs,
        requestedDurationSupplied: requestedDurationMs !== undefined,
        configuredDurationMs: durationInfo.configuredDurationMs,
        width,
        height,
        seed,
        prompt,
        promptDigest,
        baseProfileKey,
        baseProfileVersion: 1 as const,
        baseProfileFileDigest,
        provenanceManifestDigest: provenanceDigest,
        provenanceSource,
        baseCanonicalWorkflowDigest,
        derivedWorkflowDigest,
        pinFileIdentities: {
          comfyuiCoreRevision: PINNED_COMFYUI_CORE_REVISION,
          minimaxH3Revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1",
          modelDigests: {
            "diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors":
              "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
            "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors":
              "35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6",
            "vae/minimax_h3_video_vae_int8_convrot.safetensors":
              "52a2c8c73583c86e4f41cdcce3a6ad0ea562987bc0bf3d60a0cef5f5c8e60c0e",
            "vae/minimax_h3_audio_vae_fp32.safetensors":
              "8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48"
          }
        },
        resolvedModelPaths: {
          "diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors": {
            expectedHash: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
            resolvedPath: `${comfyUiDir}/models/diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors`,
            sizeBytes: 20970379616
          },
          "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors": {
            expectedHash: "35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6",
            resolvedPath: `${comfyUiDir}/models/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`,
            sizeBytes: 15687142551
          },
          "vae/minimax_h3_video_vae_int8_convrot.safetensors": {
            expectedHash: "52a2c8c73583c86e4f41cdcce3a6ad0ea562987bc0bf3d60a0cef5f5c8e60c0e",
            resolvedPath: `${comfyUiDir}/models/vae/minimax_h3_video_vae_int8_convrot.safetensors`,
            sizeBytes: 2811065184
          },
          "vae/minimax_h3_audio_vae_fp32.safetensors": {
            expectedHash: "8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48",
            resolvedPath: `${comfyUiDir}/models/vae/minimax_h3_audio_vae_fp32.safetensors`,
            sizeBytes: 605254808
          }
        },
        referenceSetId,
        references: processedReferences,
        refImageSize:
          route === "ref2v"
            ? rawRefs.length > 0
              ? ("max" as const)
              : ("match" as const)
            : undefined,
        requestedRunner: {
          variantName: runnerVariant,
          variantReason,
          memoryPolicy: requestedPolicy,
          offloadSettings: {
            modelOffload: true
          }
        },
        configuredRunner: {
          argv: generatedArgv as string[],
          env: effectiveEnv,
          predictedPolicy,
          pinnedSourceIdentities: PINNED_COMFYUI_SOURCE_HASHES
        },
        target: {
          hostname: targetHost,
          gpuUuid,
          comfyUiDir,
          pythonPath,
          address,
          port
        },
        collectionIntervalMs: 1000,
        timeouts,
        configDigest,
        comparisonKey
      };

      const descriptorDigest = computeDescriptorDigest(
        descriptorWithoutDigest as Record<string, unknown>
      );
      descriptor = {
        ...descriptorWithoutDigest,
        descriptorDigest
      };

      // Validate descriptor schema
      MinimaxH3ExperimentDescriptorSchema.parse(descriptor);

      // Persist records
      await this.store.writeDescriptor(runDir, descriptor);
      await this.store.writeConfig(runDir, derivedGraph);
      await this.store.writeInputManifest(runDir, inputManifest);
      const template = createEmptyMinimaxH3MeasurementTemplate(descriptor);
      await this.store.writeMeasurementTemplate(runDir, template);
    }

    // Stage inputs
    for (const ref of processedReferences) {
      await this.store.stageInputFile(ref.assetPath, `${runDir}/inputs/${ref.stagedFilename}`);
    }

    return { descriptor, runDir };
  }

  async validateExperiment(
    runDir: string,
    options?: { templatesDir?: string; outputRoot?: string; fixturesDir?: string }
  ): Promise<
    | {
        ok: true;
        descriptor: MinimaxH3AnyExperimentDescriptor;
        errors: string[];
        graphValid: boolean;
        executionBlocked: boolean;
        executionBlockers: string[];
        validatedGraph: Record<string, unknown>;
      }
    | {
        ok: false;
        descriptor?: MinimaxH3AnyExperimentDescriptor;
        errors: string[];
        graphValid?: boolean;
        executionBlocked?: boolean;
        executionBlockers?: string[];
        validatedGraph?: Record<string, unknown>;
      }
  > {
    const errors: string[] = [];
    const outputRoot = options?.outputRoot ?? ".ai-runs/minimax-h3-experiments";
    assertSafeOutputPath(runDir, outputRoot);

    let descriptor: MinimaxH3AnyExperimentDescriptor;
    try {
      descriptor = await this.store.readDescriptor(runDir);
      MinimaxH3AnyExperimentDescriptorSchema.parse(descriptor);
    } catch (err) {
      return {
        ok: false,
        errors: [`Descriptor validation failed: ${(err as Error).message}`]
      };
    }

    let config: Record<string, unknown>;
    try {
      config = await this.store.readConfig(runDir);
    } catch (err) {
      return {
        ok: false,
        descriptor,
        errors: [`Config read failed: ${(err as Error).message}`]
      };
    }

    // Verify config canonical digest matches descriptor
    const actualWorkflowDigest = sha256Hex(canonicalizeJson(config));
    if (actualWorkflowDigest !== descriptor.derivedWorkflowDigest) {
      errors.push(
        `Derived workflow digest mismatch: expected ${descriptor.derivedWorkflowDigest}, got ${actualWorkflowDigest}`
      );
    }

    if (descriptor.schemaVersion === 2) {
      const v2Desc = descriptor as MinimaxH3ExperimentDescriptorV2;
      if (v2Desc.teacacheRequest !== undefined) {
        const expectedConfigDigest = computeTeaCacheConfigDigest({
          workflowDigest: descriptor.derivedWorkflowDigest,
          argv: descriptor.configuredRunner.argv,
          teacacheConfig:
            v2Desc.teacacheRequest.mode === "off"
              ? null
              : {
                  mode: v2Desc.teacacheRequest.mode,
                  relL1Thresh: v2Desc.teacacheRequest.relL1Thresh,
                  startStep: v2Desc.teacacheRequest.startStep,
                  endStep: v2Desc.teacacheRequest.endStep,
                  totalSteps: 20,
                  normalizedStartStep: v2Desc.teacacheRequest.normalizedStartStep,
                  normalizedEndStep: v2Desc.teacacheRequest.normalizedEndStep
                }
        });
        if (descriptor.configDigest !== expectedConfigDigest) {
          errors.push(
            `Config digest mismatch: expected ${expectedConfigDigest}, got ${descriptor.configDigest}`
          );
        }
      } else if (v2Desc.attentionRequest !== undefined) {
        const expectedConfigDigest = computeAttentionConfigDigest({
          workflowDigest: descriptor.derivedWorkflowDigest,
          argv: descriptor.configuredRunner.argv,
          attentionVariant: v2Desc.attentionRequest.attentionVariant
        });
        if (descriptor.configDigest !== expectedConfigDigest) {
          errors.push(
            `Config digest mismatch: expected ${expectedConfigDigest}, got ${descriptor.configDigest}`
          );
        }
      } else {
        if (
          descriptor.configDigest !== descriptor.derivedWorkflowDigest &&
          descriptor.configDigest !== actualWorkflowDigest
        ) {
          errors.push(
            `Config digest mismatch: expected ${descriptor.derivedWorkflowDigest}, got ${descriptor.configDigest}`
          );
        }
      }
    } else {
      if (actualWorkflowDigest !== descriptor.configDigest) {
        errors.push(
          `Config digest mismatch: expected ${descriptor.configDigest}, got ${actualWorkflowDigest}`
        );
      }
    }

    // Verify SaveVideo prefix
    const saveVideoNode = config["92"] as { inputs?: { filename_prefix?: string } } | undefined;
    const expectedPrefix = `minimax_h3_${descriptor.route}_${descriptor.runId}`;
    if (saveVideoNode?.inputs?.filename_prefix !== expectedPrefix) {
      errors.push(
        `SaveVideo prefix tampered: expected "${expectedPrefix}", got "${String(saveVideoNode?.inputs?.filename_prefix)}"`
      );
    }

    // Reconstruct expected graph from base template and verify full equality
    const templatesDir = resolveTemplatesDir(options?.templatesDir);
    const templateFileName =
      descriptor.route === "i2v"
        ? "minimax_h3_720p_i2v_124f_api.json"
        : "minimax_h3_720p_ref2v_124f_api.json";
    const templateFilePath = `${templatesDir}/${templateFileName}`;

    let stepOverride: number | undefined;
    let checkpointOverride: string | undefined;
    if (descriptor.schemaVersion === 2) {
      const descV2 = descriptor as MinimaxH3ExperimentDescriptorV2;
      stepOverride = descV2.stepOverride ?? undefined;
      if (descV2.checkpointOverride) {
        checkpointOverride =
          descV2.checkpointOverride === "fl2va"
            ? PINNED_H3_CHECKPOINTS.fl2va.filename
            : PINNED_H3_CHECKPOINTS.ref2va.filename;
      }
    }

    let expectedGraph: Record<string, unknown> | undefined;
    let workflowValid = true;
    let evidenceValid = true;
    let topologyValid = true;
    let graphMatchValid = true;
    try {
      const baseWorkflowRaw = await this.store.readTextFile(templateFilePath);
      const baseWorkflowParsed = JSON.parse(baseWorkflowRaw) as Record<string, unknown>;
      const baseCanonical = sha256Hex(canonicalizeJson(baseWorkflowParsed));
      if (baseCanonical !== descriptor.baseCanonicalWorkflowDigest) {
        workflowValid = false;
        errors.push(
          `Base workflow digest mismatch: expected ${descriptor.baseCanonicalWorkflowDigest}, got ${baseCanonical}`
        );
      }

      const baseExpectedGraph = deriveExperimentGraph({
        baseWorkflow: baseWorkflowParsed,
        route: descriptor.route,
        runId: descriptor.runId,
        seed: descriptor.seed,
        frames: descriptor.configuredFrames,
        width: descriptor.width,
        height: descriptor.height,
        prompt: descriptor.prompt,
        references: descriptor.references,
        ...(stepOverride !== undefined ? { stepOverride } : {}),
        ...(checkpointOverride !== undefined ? { checkpointOverride } : {})
      });

      const descV2 =
        descriptor.schemaVersion === 2 ? (descriptor as MinimaxH3ExperimentDescriptorV2) : null;
      if (descV2?.samplingRecipe) {
        let canonicalRecipe: MinimaxH3SamplingRecipe;
        try {
          canonicalRecipe = getSamplingRecipe(descV2.samplingRecipe.name, descriptor.route);
          if (canonicalRecipe.recipeDigest !== descV2.samplingRecipe.recipeDigest) {
            errors.push(
              `Sampling recipe digest mismatch for "${descV2.samplingRecipe.name}": descriptor has ${descV2.samplingRecipe.recipeDigest}, authoritative catalog has ${canonicalRecipe.recipeDigest}`
            );
          }
          if (canonicalRecipe.recipeVersion !== descV2.samplingRecipe.recipeVersion) {
            errors.push(
              `Sampling recipe version mismatch: expected ${canonicalRecipe.recipeVersion}, got ${descV2.samplingRecipe.recipeVersion}`
            );
          }
          if (canonicalRecipe.compatibleRoute !== descV2.samplingRecipe.compatibleRoute) {
            errors.push(
              `Sampling recipe compatibleRoute mismatch: expected ${canonicalRecipe.compatibleRoute}, got ${descV2.samplingRecipe.compatibleRoute}`
            );
          }
          if (
            canonicalRecipe.diffusionModel.filename !==
              descV2.samplingRecipe.diffusionModel.filename ||
            canonicalRecipe.diffusionModel.sha256 !== descV2.samplingRecipe.diffusionModel.sha256
          ) {
            errors.push(
              `Sampling recipe diffusion model mismatch: expected ${canonicalRecipe.diffusionModel.filename} (${canonicalRecipe.diffusionModel.sha256}), got ${descV2.samplingRecipe.diffusionModel.filename} (${descV2.samplingRecipe.diffusionModel.sha256})`
            );
          }
          if (canonicalRecipe.expectedSteps !== descV2.samplingRecipe.expectedSteps) {
            errors.push(
              `Sampling recipe expectedSteps mismatch: expected ${canonicalRecipe.expectedSteps}, got ${descV2.samplingRecipe.expectedSteps}`
            );
          }
          if (
            canonicalRecipe.sampler !== descV2.samplingRecipe.sampler ||
            canonicalRecipe.scheduler !== descV2.samplingRecipe.scheduler ||
            canonicalRecipe.denoise !== descV2.samplingRecipe.denoise
          ) {
            errors.push(
              `Sampling recipe sampler/scheduler/denoise mismatch for "${descV2.samplingRecipe.name}"`
            );
          }
          if (canonicalRecipe.lora) {
            if (
              !descV2.samplingRecipe.lora ||
              descV2.samplingRecipe.lora.filename !== canonicalRecipe.lora.filename ||
              descV2.samplingRecipe.lora.sha256 !== canonicalRecipe.lora.sha256 ||
              descV2.samplingRecipe.lora.strengthModel !== canonicalRecipe.lora.strengthModel
            ) {
              errors.push(`Sampling recipe LoRA mismatch for "${descV2.samplingRecipe.name}"`);
            }
          } else if (descV2.samplingRecipe.lora) {
            errors.push(`Sampling recipe LoRA must be null for "${descV2.samplingRecipe.name}"`);
          }
          if (canonicalRecipe.sigmaShift) {
            if (
              !descV2.samplingRecipe.sigmaShift ||
              descV2.samplingRecipe.sigmaShift.enabled !== canonicalRecipe.sigmaShift.enabled ||
              descV2.samplingRecipe.sigmaShift.videoShift !==
                canonicalRecipe.sigmaShift.videoShift ||
              descV2.samplingRecipe.sigmaShift.audioShift !== canonicalRecipe.sigmaShift.audioShift
            ) {
              errors.push(
                `Sampling recipe sigmaShift mismatch for "${descV2.samplingRecipe.name}"`
              );
            }
          } else if (descV2.samplingRecipe.sigmaShift) {
            errors.push(
              `Sampling recipe sigmaShift must be null for "${descV2.samplingRecipe.name}"`
            );
          }
          if (canonicalRecipe.conditioningMode !== descV2.samplingRecipe.conditioningMode) {
            errors.push(
              `Sampling recipe conditioningMode mismatch: expected ${canonicalRecipe.conditioningMode}, got ${descV2.samplingRecipe.conditioningMode}`
            );
          }
          if (
            canonicalRecipe.requiredRuntimeRevision !==
            descV2.samplingRecipe.requiredRuntimeRevision
          ) {
            errors.push(
              `Sampling recipe requiredRuntimeRevision mismatch: expected ${canonicalRecipe.requiredRuntimeRevision}, got ${descV2.samplingRecipe.requiredRuntimeRevision}`
            );
          }

          // Validate descriptor-level provenance against authoritative recipe
          if (descV2.provenance?.samplerSettings) {
            if (descV2.provenance.samplerSettings.steps !== canonicalRecipe.expectedSteps) {
              errors.push(
                `Descriptor provenance sampler steps mismatch: expected ${canonicalRecipe.expectedSteps}, got ${descV2.provenance.samplerSettings.steps}`
              );
            }
            if (descV2.provenance.samplerSettings.sampler !== canonicalRecipe.sampler) {
              errors.push(
                `Descriptor provenance sampler mismatch: expected "${canonicalRecipe.sampler}", got "${descV2.provenance.samplerSettings.sampler}"`
              );
            }
            if (descV2.provenance.samplerSettings.scheduler !== canonicalRecipe.scheduler) {
              errors.push(
                `Descriptor provenance scheduler mismatch: expected "${canonicalRecipe.scheduler}", got "${descV2.provenance.samplerSettings.scheduler}"`
              );
            }
          }
          if (
            descV2.provenance?.actualCheckpointHash &&
            descV2.provenance.actualCheckpointHash !== canonicalRecipe.diffusionModel.sha256
          ) {
            errors.push(
              `Descriptor provenance actualCheckpointHash mismatch: expected ${canonicalRecipe.diffusionModel.sha256}, got ${descV2.provenance.actualCheckpointHash}`
            );
          }
          if (!descV2.requiredRuntime) {
            errors.push(
              `Sampling recipe "${descV2.samplingRecipe.name}" requires requiredRuntime to be specified`
            );
          } else {
            if (descV2.requiredRuntime.coreRevision !== canonicalRecipe.requiredRuntimeRevision) {
              errors.push(
                `Descriptor requiredRuntime coreRevision mismatch: expected ${canonicalRecipe.requiredRuntimeRevision}, got ${descV2.requiredRuntime.coreRevision}`
              );
            }
            if (canonicalRecipe.name === "fasth3-i2v-8") {
              if (descV2.requiredRuntime.attentionKernel !== "block_sparse_triton") {
                errors.push(
                  `FastH3 recipe requires attentionKernel "block_sparse_triton", got "${descV2.requiredRuntime.attentionKernel}"`
                );
              }
              for (const [filePath, expectedHash] of Object.entries(FASTH3_COMFYUI_SOURCE_HASHES)) {
                if (descV2.requiredRuntime.sourceFileHashes[filePath] !== expectedHash) {
                  errors.push(
                    `FastH3 recipe requires sourceFileHashes["${filePath}"] to match "${expectedHash}", got "${descV2.requiredRuntime.sourceFileHashes[filePath] ?? "missing"}"`
                  );
                }
              }
              const requiredNodeNames = [
                "BlockSparseAttention",
                "ModelAttentionBackend",
                "MiniMaxH3ImageToVideo",
                "MiniMaxH3SigmaShift"
              ];
              for (const nodeName of requiredNodeNames) {
                if (!descV2.requiredRuntime.requiredNodes.some((n) => n.name === nodeName)) {
                  errors.push(
                    `FastH3 recipe requires node "${nodeName}" in requiredRuntime.requiredNodes`
                  );
                }
              }
              if (
                !descV2.requiredRuntime.pythonPackages.some(
                  (p) => p.name === "comfy-kitchen" && p.version === "0.2.34"
                )
              ) {
                errors.push(
                  `FastH3 recipe requires pythonPackage "comfy-kitchen" version "0.2.34"`
                );
              }
              if (
                !descV2.requiredRuntime.pythonPackages.some(
                  (p) => p.name === "torch" && p.version === descV2.requiredRuntime!.pytorchBuild
                ) ||
                !descV2.requiredRuntime.pytorchBuild
              ) {
                errors.push(
                  `FastH3 recipe requires pythonPackage "torch" matching requiredRuntime.pytorchBuild`
                );
              }
            }
            if (canonicalRecipe.lora) {
              if (
                !descV2.requiredRuntime.requiredNodes.some((n) => n.name === "LoraLoaderModelOnly")
              ) {
                errors.push(
                  `Turbo recipe requires "LoraLoaderModelOnly" in requiredRuntime.requiredNodes`
                );
              }
              const expectedConditionerNode =
                descV2.route === "i2v" ? "MiniMaxH3ImageToVideo" : "MiniMaxH3ReferenceToVideo";
              if (
                !descV2.requiredRuntime.requiredNodes.some(
                  (n) => n.name === expectedConditionerNode
                )
              ) {
                errors.push(
                  `Turbo recipe requires conditioner node "${expectedConditionerNode}" in requiredRuntime.requiredNodes`
                );
              }
              if (
                descV2.requiredRuntime.sourceFileHashes["nodes.py"] !==
                PINNED_COMFYUI_NODES_PY_SHA256
              ) {
                errors.push(
                  `Turbo recipe requires nodes.py hash to match PINNED_COMFYUI_NODES_PY_SHA256`
                );
              }
              if (
                descV2.requiredRuntime.sourceFileHashes["comfy_extras/nodes_minimax_h3.py"] !==
                PINNED_COMFYUI_NODES_MINIMAX_H3_PY_SHA256
              ) {
                errors.push(
                  `Turbo recipe requires comfy_extras/nodes_minimax_h3.py hash to match PINNED_COMFYUI_NODES_MINIMAX_H3_PY_SHA256`
                );
              }
            }
          }
          if (canonicalRecipe.lora && descV2.pinFileIdentities?.modelDigests) {
            const loraKey = `loras/${canonicalRecipe.lora.filename}`;
            const recordedLoraHash = descV2.pinFileIdentities.modelDigests[loraKey];
            if (recordedLoraHash !== canonicalRecipe.lora.sha256) {
              errors.push(
                `Descriptor provenance LoRA digest mismatch for "${loraKey}": expected ${canonicalRecipe.lora.sha256}, got ${recordedLoraHash}`
              );
            }
          }
          if (descV2.stepOverride !== null && descV2.stepOverride !== undefined) {
            errors.push("Descriptor stepOverride must be null when samplingRecipe is specified");
          }
          if (descV2.checkpointOverride !== null && descV2.checkpointOverride !== undefined) {
            errors.push(
              "Descriptor checkpointOverride must be null when samplingRecipe is specified"
            );
          }
          if (!canonicalRecipe.attentionTopology && descV2.attentionRequest) {
            errors.push(
              "Descriptor attentionRequest must not be set when samplingRecipe has no attentionTopology"
            );
          }
        } catch (err: unknown) {
          errors.push(
            `Authoritative recipe lookup failed: ${err instanceof Error ? err.message : String(err)}`
          );
          return {
            ok: false,
            descriptor,
            errors
          };
        }

        expectedGraph = applySamplingRecipeToGraph({
          baseWorkflow: baseExpectedGraph,
          recipe: canonicalRecipe,
          route: descriptor.route
        });
        const recipeValidation = validateSamplingRecipeTopology(
          config,
          canonicalRecipe,
          descriptor.route
        );
        if (!recipeValidation.valid) {
          topologyValid = false;
          errors.push(...recipeValidation.errors);
        }
      } else if (descV2?.teacacheRequest) {
        const isControl = descV2.teacacheRequest.mode === "off";
        let expectedCatalogEntry: MinimaxH3TeaCacheCatalogEntry | undefined;
        try {
          expectedCatalogEntry = getTeaCacheCatalogEntry(
            isControl ? "matched-control" : "teacache-raw-l1",
            descriptor.route
          );
          if (descV2.teacacheRequest.catalogDigest !== expectedCatalogEntry.catalogDigest) {
            evidenceValid = false;
            errors.push(
              `TeaCache catalog digest mismatch: expected "${expectedCatalogEntry.catalogDigest}", got "${descV2.teacacheRequest.catalogDigest}".`
            );
          }
        } catch (err) {
          evidenceValid = false;
          errors.push(
            `Failed to resolve expected TeaCache catalog entry: ${(err as Error).message}`
          );
        }

        if (descV2.teacacheRequest.adapterDigest !== TEACACHE_LOCAL_ADAPTER_DIGEST) {
          errors.push(
            `TeaCache adapterDigest mismatch: expected ${TEACACHE_LOCAL_ADAPTER_DIGEST}, got ${descV2.teacacheRequest.adapterDigest}`
          );
        }

        const observedAdapterHashes: Record<string, string> = {};
        for (const [fName, expHash] of Object.entries(TEACACHE_LOCAL_ADAPTER_FILE_HASHES)) {
          const p = resolve(process.cwd(), "experiments/minimax-h3-teacache", fName);
          if (!existsSync(p)) {
            errors.push(`TeaCache local adapter file "${fName}" not found at ${p}`);
            continue;
          }
          const buf = await readFile(p);
          const actual = createHash("sha256").update(buf).digest("hex");
          if (actual !== expHash) {
            errors.push(
              `TeaCache local adapter file hash mismatch for "${fName}": expected ${expHash}, computed ${actual}`
            );
          }
          observedAdapterHashes[fName] = actual;
        }
        const computedAdapterDigest = computeLocalTeaCacheAdapterDigest(observedAdapterHashes);
        if (computedAdapterDigest !== descV2.teacacheRequest.adapterDigest) {
          errors.push(
            `TeaCache local adapter digest mismatch: expected ${descV2.teacacheRequest.adapterDigest}, computed ${computedAdapterDigest}`
          );
        }

        const tcConfig = isControl
          ? null
          : {
              mode: descV2.teacacheRequest.mode,
              relL1Thresh: descV2.teacacheRequest.relL1Thresh,
              startStep: descV2.teacacheRequest.startStep,
              endStep: descV2.teacacheRequest.endStep,
              totalSteps: 20 as const,
              normalizedStartStep: descV2.teacacheRequest.normalizedStartStep,
              normalizedEndStep: descV2.teacacheRequest.normalizedEndStep
            };

        if (isControl) {
          expectedGraph = baseExpectedGraph;
        } else {
          try {
            const { graph: tcExpectedGraph } = deriveTeaCacheGraph({
              baseWorkflow: baseExpectedGraph,
              route: descriptor.route,
              config: tcConfig!
            });
            expectedGraph = tcExpectedGraph;
          } catch (err) {
            topologyValid = false;
            errors.push(`Failed to derive expected TeaCache graph: ${(err as Error).message}`);
          }
        }

        const tcValidation = validateTeaCacheTopology(config, {
          expectedMode: descV2.teacacheRequest.mode,
          route: descriptor.route,
          expectedConfig: tcConfig
        });
        if (!tcValidation.valid) {
          topologyValid = false;
          errors.push(...tcValidation.errors);
        }
        if (tcValidation.topologyDigest !== descV2.teacacheRequest.topologyDigest) {
          topologyValid = false;
          errors.push(
            `TeaCache topology digest mismatch: expected "${descV2.teacacheRequest.topologyDigest}", got "${tcValidation.topologyDigest}".`
          );
        }

        if (descV2.requiredRuntime) {
          const expectedDigest = sha256Hex(canonicalizeJson(descV2.requiredRuntime));
          if (descV2.compatibility.relativeToRuntimeManifestDigest !== expectedDigest) {
            errors.push(
              `TeaCache relativeToRuntimeManifestDigest mismatch: expected ${expectedDigest}, got ${descV2.compatibility.relativeToRuntimeManifestDigest}`
            );
          }
          if (
            !descV2.requiredRuntime.requiredNodes.some((n) => n.name === "CCOMiniMaxH3TeaCache")
          ) {
            errors.push(
              'TeaCache experiment requires "CCOMiniMaxH3TeaCache" in requiredRuntime.requiredNodes'
            );
          }
        }
      } else if (descV2?.attentionRequest) {
        let expectedCatalogEntry: MinimaxH3AttentionCatalogEntry | undefined;
        try {
          expectedCatalogEntry = getAttentionCatalogEntry(
            descV2.attentionRequest.attentionVariant,
            descriptor.route,
            {
              catalogDigest: descV2.attentionRequest.catalogDigest,
              coreRevision: descV2.requiredRuntime?.coreRevision,
              scope: descV2.compatibility?.scope
            }
          );
          if (descV2.attentionRequest.catalogDigest !== expectedCatalogEntry.catalogDigest) {
            evidenceValid = false;
            errors.push(
              `Attention catalog digest mismatch: expected "${expectedCatalogEntry.catalogDigest}", got "${descV2.attentionRequest.catalogDigest}".`
            );
          }
        } catch (err) {
          evidenceValid = false;
          errors.push(
            `Failed to resolve expected attention catalog entry: ${(err as Error).message}`
          );
        }

        let evidence: MinimaxH3AttentionEvidence | undefined;
        try {
          const fixturePath = getAttentionFixturePath(
            descV2.attentionRequest.attentionVariant,
            options?.fixturesDir
          );
          const fixtureRaw = await this.store.readJsonFile<unknown>(fixturePath);
          evidence = parseAttentionEvidence(fixtureRaw);
          const resolved = resolveAttentionEvidence({
            variant: descV2.attentionRequest.attentionVariant,
            evidence,
            coreRevision: descV2.requiredRuntime?.coreRevision,
            customNode: expectedCatalogEntry?.customNode
          });
          if (!resolved.valid || !resolved.isResolved) {
            evidenceValid = false;
            errors.push(...resolved.errors);
          }
        } catch (err) {
          evidenceValid = false;
          errors.push(`Failed to load or parse attention evidence: ${(err as Error).message}`);
        }

        if (evidence && evidenceValid) {
          try {
            const { graph: attnExpectedGraph } = deriveAttentionGraph({
              graph: baseExpectedGraph,
              attentionVariant: descV2.attentionRequest.attentionVariant,
              route: descriptor.route,
              evidence,
              coreRevision: descV2.requiredRuntime?.coreRevision,
              customNode: expectedCatalogEntry?.customNode
            });
            expectedGraph = attnExpectedGraph;
          } catch (err) {
            topologyValid = false;
            errors.push(`Failed to derive expected attention graph: ${(err as Error).message}`);
          }
        }

        const topoValidation = validateAttentionTopology(config, {
          expectedVariant: descV2.attentionRequest.attentionVariant,
          route: descriptor.route,
          argv: descV2.configuredRunner?.argv,
          env: descV2.configuredRunner?.env,
          evidence,
          coreRevision: descV2.requiredRuntime?.coreRevision,
          customNode: expectedCatalogEntry?.customNode
        });
        if (!topoValidation.valid) {
          topologyValid = false;
          errors.push(...topoValidation.errors);
        }
        if (topoValidation.topology.topologyDigest !== descV2.attentionRequest.topologyDigest) {
          topologyValid = false;
          errors.push(
            `Attention topology digest mismatch: expected "${descV2.attentionRequest.topologyDigest}", got "${topoValidation.topology.topologyDigest}".`
          );
        }
      } else {
        expectedGraph = baseExpectedGraph;
      }

      if (expectedGraph) {
        const expectedCanonical = canonicalizeJson(expectedGraph);
        const actualCanonical = canonicalizeJson(config);
        if (expectedCanonical !== actualCanonical) {
          graphMatchValid = false;
          errors.push(
            "Config.json on disk does not match the reconstructed workflow graph derived from base template and descriptor."
          );
        }
      } else {
        graphMatchValid = false;
        errors.push("Expected workflow graph could not be reconstructed.");
      }
    } catch (err) {
      workflowValid = false;
      errors.push(
        `Failed to verify base workflow template or reconstruct graph: ${(err as Error).message}`
      );
    }

    // Verify staged input assets
    for (const ref of descriptor.references) {
      const stagedPath = `${runDir}/inputs/${ref.stagedFilename}`;
      try {
        const hashInfo = await this.store.hashFile(stagedPath);
        if (hashInfo.sha256 !== ref.sha256) {
          errors.push(
            `Staged asset hash mismatch for "${ref.stagedFilename}": expected ${ref.sha256}, got ${hashInfo.sha256}`
          );
        }
        const inspected = await this.store.inspectAsset(stagedPath);
        if (inspected.width !== ref.width || inspected.height !== ref.height) {
          errors.push(
            `Staged asset dimension mismatch for "${ref.stagedFilename}": expected ${ref.width}x${ref.height}, got ${inspected.width}x${inspected.height}`
          );
        }
        if (inspected.mimeType !== ref.mimeType) {
          errors.push(
            `Staged asset MIME mismatch for "${ref.stagedFilename}": expected "${ref.mimeType}", got "${inspected.mimeType}"`
          );
        }
      } catch (err) {
        errors.push(
          `Staged asset "${ref.stagedFilename}" missing or unreadable: ${(err as Error).message}`
        );
      }
    }

    // Cross-check input-manifest.json
    try {
      const inputManifest = (await this.store.readInputManifest(runDir)) as {
        referenceSetId?: string;
        references?: Array<{ assetPath: string; stagedFilename: string }>;
      };
      if (!inputManifest) {
        errors.push("input-manifest.json missing from run directory");
      } else {
        const refs = inputManifest.references ?? [];
        if (refs.length !== descriptor.references.length) {
          errors.push(
            `Input manifest reference count mismatch: expected ${descriptor.references.length}, got ${refs.length}`
          );
        }
        for (let i = 0; i < Math.min(refs.length, descriptor.references.length); i++) {
          if (refs[i]?.stagedFilename !== descriptor.references[i]?.stagedFilename) {
            errors.push(
              `Input manifest reference ${i} stagedFilename mismatch: expected "${descriptor.references[i]?.stagedFilename}", got "${refs[i]?.stagedFilename}"`
            );
          }
        }
      }
    } catch (err) {
      errors.push(`Failed to read input-manifest.json: ${(err as Error).message}`);
    }

    // Verify measurement template
    try {
      const measurementTemplate = await this.store.readMeasurementTemplate(runDir);
      if (!measurementTemplate) {
        errors.push("measurement-template.json missing from run directory");
      } else {
        if (descriptor.schemaVersion === 2) {
          MinimaxH3ExperimentResultV2Schema.parse(measurementTemplate);
          if (measurementTemplate.schemaVersion !== 2) {
            errors.push("measurement-template.json must have schemaVersion 2");
          }
          if (
            (measurementTemplate as MinimaxH3ExperimentResultV2).phaseAccounting.status !==
            "missing"
          ) {
            errors.push("measurement-template.json must have phaseAccounting status 'missing'");
          }
        } else {
          MinimaxH3ExperimentResultSchema.parse(measurementTemplate);
        }
        if (measurementTemplate.runId !== descriptor.runId) {
          errors.push(
            `Measurement template runId mismatch: expected "${descriptor.runId}", got "${measurementTemplate.runId}"`
          );
        }
        const expectedDescDigest =
          descriptor.descriptorDigest ??
          computeDescriptorDigest(descriptor as unknown as Record<string, unknown>);
        if (measurementTemplate.descriptorDigest !== expectedDescDigest) {
          errors.push(
            `Measurement template descriptorDigest mismatch: expected "${expectedDescDigest}", got "${measurementTemplate.descriptorDigest}"`
          );
        }
        if (measurementTemplate.execution.status !== "not_started") {
          errors.push("measurement-template.json must have execution status 'not_started'");
        }
        if (
          measurementTemplate.observedRunner.pid !== null ||
          measurementTemplate.observedRunner.effectiveMode.status !== "unknown" ||
          measurementTemplate.observedRunner.effectiveMode.value !== null ||
          measurementTemplate.collection.status !== "not_started" ||
          measurementTemplate.collection.sampleCount.attempted !== 0 ||
          // Every collection metric must be null, not only gpuPeakUsedVramMb
          // — a populated host/process/swap reading would mean a prior real
          // measurement leaked into what must be an unstarted dry-run
          // template.
          measurementTemplate.collection.metrics.gpuPeakUsedVramMb !== null ||
          measurementTemplate.collection.metrics.gpuAllocatableVramMb !== null ||
          measurementTemplate.collection.metrics.hostPeakRamUsedMb !== null ||
          measurementTemplate.collection.metrics.processPeakRssMb !== null ||
          measurementTemplate.collection.metrics.hostSwapUsedMb !== null ||
          measurementTemplate.collection.metrics.hostSwapDeltaMb !== null ||
          measurementTemplate.collection.errors.length !== 0 ||
          measurementTemplate.probe.status !== "not_started" ||
          measurementTemplate.probe.outputFile !== null ||
          measurementTemplate.probe.outputSha256 !== null ||
          measurementTemplate.outputConformance.status !== "unknown"
        ) {
          errors.push(
            "Measurement template must be blank and unpopulated (dry-run requires zero readings and unstarted probes)"
          );
        }
      }
    } catch (err) {
      errors.push(`Invalid measurement-template.json: ${(err as Error).message}`);
    }

    // Verify runner policy flags
    try {
      validateRunnerVariantAndArgv({
        variantName: descriptor.requestedRunner.variantName,
        variantReason: descriptor.requestedRunner.variantReason,
        customArgv: descriptor.configuredRunner.argv
      });
    } catch (err) {
      errors.push(`Runner configuration invalid: ${(err as Error).message}`);
    }

    // Verify provenance manifest and base template hash
    const provenanceManifestPath = `${templatesDir}/provenance.json`;
    try {
      const provenanceRaw = await this.store.readTextFile(provenanceManifestPath);
      const provenanceDigest = sha256Hex(provenanceRaw);
      if (provenanceDigest !== descriptor.provenanceManifestDigest) {
        errors.push(
          `Provenance manifest digest mismatch: expected ${descriptor.provenanceManifestDigest}, got ${provenanceDigest}`
        );
      }
      const provenanceParsed = JSON.parse(provenanceRaw) as {
        profiles?: Array<{ workflowRelativePath?: string; expectedWorkflowHash?: string }>;
      };
      const matchingProfile = provenanceParsed.profiles?.find(
        (p) => p.workflowRelativePath === templateFileName
      );
      // Fail closed rather than silently skipping verification: a
      // --templates-dir supplying an empty or missing profile entry must
      // not be able to make an unverified template pass validation.
      if (!matchingProfile?.expectedWorkflowHash) {
        errors.push(
          `provenance.json at "${provenanceManifestPath}" has no expectedWorkflowHash entry for "${templateFileName}"; cannot verify the base template against an independent pin.`
        );
      } else if (descriptor.baseCanonicalWorkflowDigest !== matchingProfile.expectedWorkflowHash) {
        errors.push(
          `Base canonical workflow digest in descriptor (${descriptor.baseCanonicalWorkflowDigest}) does not match provenance expectedWorkflowHash (${matchingProfile.expectedWorkflowHash})`
        );
      }
    } catch (err) {
      errors.push(`Failed to verify provenance.json: ${(err as Error).message}`);
    }

    // Verify slot references consistency and prompt-slot relationships
    for (let i = 0; i < descriptor.references.length; i++) {
      const ref = descriptor.references[i]!;
      if (ref.slotIndex !== i) {
        errors.push(
          `Reference slotIndex mismatch at index ${i}: expected ${i}, got ${ref.slotIndex}`
        );
      }
      if (ref.order !== i) {
        errors.push(`Reference order mismatch at index ${i}: expected ${i}, got ${ref.order}`);
      }
      const expectedTag = `<Picture ${i + 1}>`;
      if (ref.tag !== expectedTag) {
        errors.push(
          `Reference tag mismatch at index ${i}: expected "${expectedTag}", got "${ref.tag}"`
        );
      }
      if (descriptor.route === "i2v" && ref.role !== "first_frame") {
        errors.push(
          `Reference role mismatch at index ${i}: expected "first_frame", got "${ref.role}"`
        );
      }
    }

    if (descriptor.route === "ref2v") {
      const tagMatches = descriptor.prompt.match(/<Picture \d+>/g) || [];
      for (const t of tagMatches) {
        const slotNum = parseInt(t.replace(/<Picture |>/g, ""), 10);
        if (slotNum < 1 || slotNum > descriptor.references.length) {
          errors.push(
            `Prompt references tag "${t}" but only ${descriptor.references.length} reference images were supplied.`
          );
        }
      }
    }

    // Verify base profile file digest
    try {
      const profilePath = resolveProfilePath(descriptor.baseProfileKey);
      if (existsSync(profilePath)) {
        let profileRaw: string;
        try {
          profileRaw = await this.store.readTextFile(profilePath);
        } catch {
          profileRaw = await readFile(profilePath, "utf8");
        }
        const profileDigest = sha256Hex(profileRaw);
        if (profileDigest !== descriptor.baseProfileFileDigest) {
          errors.push(
            `Base profile file digest mismatch: expected ${descriptor.baseProfileFileDigest}, got ${profileDigest}`
          );
        }
      }
    } catch (err) {
      errors.push(`Failed to verify base profile file: ${(err as Error).message}`);
    }

    // Verify recomputed comparisonKey matches descriptor
    const recomputedComparisonKey = computeComparisonKey({
      route: descriptor.route,
      frames: descriptor.configuredFrames,
      requestedDurationMs: descriptor.requestedDurationMs,
      width: descriptor.width,
      height: descriptor.height,
      promptDigest: descriptor.promptDigest,
      seed: descriptor.seed,
      references: descriptor.references.map((r) => ({
        slotIndex: r.slotIndex,
        role: r.role,
        tag: r.tag,
        order: r.order,
        sha256: r.sha256
      })),
      referenceHashes: descriptor.references.map((r) => r.sha256),
      runnerVariant: descriptor.requestedRunner.variantName,
      memoryPolicy: descriptor.requestedRunner.memoryPolicy,
      modelOffload: descriptor.requestedRunner.offloadSettings.modelOffload,
      modelDigests: descriptor.pinFileIdentities.modelDigests,
      target: {
        hostname: descriptor.target.hostname,
        gpuUuid: descriptor.target.gpuUuid
      },
      workflowDigest: descriptor.derivedWorkflowDigest,
      comfyuiCoreRevision:
        descriptor.schemaVersion === 2
          ? (descriptor as MinimaxH3ExperimentDescriptorV2).provenance.comfyuiCoreRevision
          : descriptor.pinFileIdentities.comfyuiCoreRevision
    });
    if (descriptor.comparisonKey !== recomputedComparisonKey) {
      errors.push(
        `Comparison key mismatch: expected "${recomputedComparisonKey}", got "${descriptor.comparisonKey}"`
      );
    }

    if (descriptor.schemaVersion === 2) {
      const descV2 = descriptor as MinimaxH3ExperimentDescriptorV2;
      const expectedDescriptorDigest = computeDescriptorDigest(
        descV2 as unknown as Record<string, unknown>
      );
      if (descV2.descriptorDigest !== expectedDescriptorDigest) {
        errors.push(
          `Descriptor digest mismatch: expected "${expectedDescriptorDigest}", got "${descV2.descriptorDigest}"`
        );
      }
      const actualPromptDigest = sha256Hex(descV2.conditioning.positivePrompt.text);
      if (descV2.conditioning.positivePrompt.digest !== actualPromptDigest) {
        errors.push(
          `Prompt digest mismatch: expected "${actualPromptDigest}", got "${descV2.conditioning.positivePrompt.digest}"`
        );
      }
      if (descV2.provenance.promptDigest !== actualPromptDigest) {
        errors.push(
          `Provenance prompt digest mismatch: expected "${actualPromptDigest}", got "${descV2.provenance.promptDigest}"`
        );
      }
    } else {
      const expectedDescriptorDigest = computeDescriptorDigest(
        descriptor as unknown as Record<string, unknown>
      );
      if (descriptor.descriptorDigest && descriptor.descriptorDigest !== expectedDescriptorDigest) {
        errors.push(
          `Descriptor digest mismatch: expected "${expectedDescriptorDigest}", got "${descriptor.descriptorDigest}"`
        );
      }
    }

    const descV2 =
      descriptor.schemaVersion === 2 ? (descriptor as MinimaxH3ExperimentDescriptorV2) : null;
    let executionBlocked = false;
    const executionBlockers: string[] = [];

    if (descV2?.attentionRequest) {
      const entry = getAttentionCatalogEntry(
        descV2.attentionRequest.attentionVariant,
        descriptor.route,
        {
          catalogDigest: descV2.attentionRequest.catalogDigest,
          coreRevision: descV2.requiredRuntime?.coreRevision,
          scope: descV2.compatibility?.scope
        }
      );
      if (!entry.runnable) {
        executionBlocked = true;
        executionBlockers.push(
          `Attention variant "${descV2.attentionRequest.attentionVariant}" is candidate-only (runnable: false).`
        );
      }
      if (entry.compatibilityState === "unsupported") {
        executionBlocked = true;
        executionBlockers.push(
          `Attention variant "${descV2.attentionRequest.attentionVariant}" is unsupported.`
        );
      }
      if (entry.blockers && entry.blockers.length > 0) {
        executionBlocked = true;
        executionBlockers.push(...entry.blockers);
      }
      if (entry.licensing.securityReviewStatus === "pending") {
        executionBlocked = true;
        executionBlockers.push(
          `Attention variant "${descV2.attentionRequest.attentionVariant}" has pending security review.`
        );
      }
    }

    if (descV2?.teacacheRequest) {
      const entry = getTeaCacheCatalogEntry("teacache-raw-l1", descriptor.route);
      if (!entry.runnable) {
        executionBlocked = true;
        executionBlockers.push(
          `TeaCache variant "${entry.variantName}" is candidate-only (runnable: false).`
        );
      }
      if (entry.compatibilityState === "unsupported") {
        executionBlocked = true;
        executionBlockers.push(`TeaCache variant "${entry.variantName}" is unsupported.`);
      }
      if (entry.blockers && entry.blockers.length > 0) {
        executionBlocked = true;
        executionBlockers.push(...entry.blockers);
      }
      if (entry.licensing.securityReviewStatus === "pending") {
        executionBlocked = true;
        executionBlockers.push(
          `TeaCache variant "${entry.variantName}" has pending security review.`
        );
      }
    }

    const graphValid =
      Boolean(expectedGraph) && workflowValid && evidenceValid && topologyValid && graphMatchValid;

    const validatedGraph = graphValid ? expectedGraph : undefined;

    if (errors.length === 0 && validatedGraph) {
      return {
        ok: true,
        descriptor,
        errors,
        graphValid,
        executionBlocked,
        executionBlockers,
        validatedGraph
      };
    }

    return {
      ok: false,
      descriptor,
      errors,
      graphValid,
      executionBlocked,
      executionBlockers,
      ...(validatedGraph ? { validatedGraph } : {})
    };
  }

  async reconcileExperiment(
    runDir: string,
    options?: { outputRoot?: string }
  ): Promise<MinimaxH3AnyExperimentResult> {
    const outputRoot = options?.outputRoot ?? ".ai-runs/minimax-h3-experiments";
    assertSafeOutputPath(runDir, outputRoot);

    const descriptor = await this.store.readDescriptor(runDir);
    const existingResult = await this.store.readResult(runDir);
    const intent = await this.store.readIntent(runDir);
    const receipt = await this.store.readReceipt(runDir);
    const storedTerminalEvidence = await this.store.readTerminalEvidence(runDir);
    const storedProcessRecord = await this.store.readProcessRecord(runDir);
    const telemetrySamples = await this.store.readTelemetry(runDir);

    const baseResult =
      existingResult ??
      (descriptor.schemaVersion === 2
        ? createEmptyMinimaxH3MeasurementTemplateV2(descriptor as MinimaxH3ExperimentDescriptorV2)
        : createEmptyMinimaxH3MeasurementTemplate(descriptor as MinimaxH3ExperimentDescriptor));
    let promptId = receipt?.promptId ?? baseResult.execution.promptId;

    let isChildVerifiedLive = true;
    if (storedProcessRecord) {
      try {
        const statContent = await readFile(`/proc/${storedProcessRecord.pid}/stat`, "utf8");
        const lastParenIndex = statContent.lastIndexOf(")");
        if (lastParenIndex !== -1) {
          const fields = statContent
            .substring(lastParenIndex + 1)
            .trim()
            .split(/\s+/);
          const ticks = parseInt(fields[19] || "", 10);
          isChildVerifiedLive = ticks === storedProcessRecord.startTimeTicks;
        } else {
          isChildVerifiedLive = false;
        }
      } catch {
        isChildVerifiedLive = false;
      }
    }

    // If promptId missing, try to search queue/history if transport available and child is verified live
    if (!promptId && intent && this.transport && isChildVerifiedLive) {
      try {
        const found = await this.transport.findPromptByWorkflowDigestOrClient(
          `http://${descriptor.target.address}:${descriptor.target.port}`,
          intent.clientId
        );
        if (found?.promptId) {
          promptId = found.promptId;
        }
      } catch {
        // server may be offline
      }
    }

    // Determine execution status & terminal evidence
    let executionStatus = baseResult.execution.status;
    let terminalEvidence: MinimaxH3TerminalEvidence | null =
      storedTerminalEvidence ?? baseResult.execution.terminalEvidence;
    let engineError = baseResult.execution.engineError;
    let outputFilename: string | null = baseResult.probe.outputFile;

    if (promptId && this.transport && isChildVerifiedLive) {
      try {
        const historyRes = await this.transport.pollPromptHistory(
          `http://${descriptor.target.address}:${descriptor.target.port}`,
          promptId,
          5000,
          1000
        );
        if (historyRes.status === "completed") {
          executionStatus = "completed";
          terminalEvidence = {
            source: "history",
            status: "success",
            runId: descriptor.runId,
            promptId,
            serverAddress: descriptor.target.address,
            serverPort: descriptor.target.port,
            outputFilename: historyRes.outputFilename ?? outputFilename,
            subfolder: historyRes.outputSubfolder ?? null,
            outputType: historyRes.outputType ?? null,
            rawDetails: historyRes.rawHistory ?? { status: "completed" }
          };
          outputFilename = historyRes.outputFilename ?? outputFilename;
        } else if (historyRes.status === "failed") {
          executionStatus = "failed";
          terminalEvidence = {
            source: "history",
            status: "error",
            runId: descriptor.runId,
            promptId,
            serverAddress: descriptor.target.address,
            serverPort: descriptor.target.port,
            rawDetails: historyRes.rawHistory ?? { status: "failed", error: historyRes.error }
          };
          engineError = { message: historyRes.error ?? "ComfyUI engine reported failure" };
        }
      } catch {
        // history unavailable via network
      }
    }

    if (storedTerminalEvidence) {
      terminalEvidence = storedTerminalEvidence;
      const rawObj = storedTerminalEvidence.rawDetails as Record<string, unknown> | undefined;
      const entryObj =
        rawObj && typeof rawObj === "object"
          ? ((promptId && typeof rawObj[promptId] === "object" && rawObj[promptId] !== null
              ? (rawObj[promptId] as Record<string, unknown>)
              : rawObj) as Record<string, unknown>)
          : undefined;

      const statusObj =
        typeof entryObj?.status === "object" && entryObj.status !== null
          ? (entryObj.status as Record<string, unknown>)
          : undefined;
      const statusStr =
        typeof entryObj?.status === "string"
          ? entryObj.status
          : (statusObj?.status_str as string | undefined);
      const explicitStatus = storedTerminalEvidence.status ?? statusStr;

      let explicitError =
        storedTerminalEvidence.error?.message ??
        (typeof entryObj?.error === "string" ? entryObj.error : undefined);

      let hasExecutionError = false;
      let hasInterruption = false;

      if (Array.isArray(statusObj?.messages)) {
        for (const m of statusObj.messages) {
          if (Array.isArray(m)) {
            if (m[0] === "execution_error") {
              hasExecutionError = true;
              const errDetails = m[1] as Record<string, unknown> | undefined;
              if (!explicitError) {
                explicitError =
                  typeof errDetails?.exception_message === "string"
                    ? `${errDetails.exception_type || "ExecutionError"}: ${errDetails.exception_message} (node ${errDetails.node_id || "?"})`
                    : JSON.stringify(m[1] ?? m);
              }
            } else if (m[0] === "execution_interrupted") {
              hasInterruption = true;
              if (!explicitError) {
                explicitError = "ComfyUI execution interrupted";
              }
            }
          }
        }
      }

      if (
        storedTerminalEvidence.status === "error" ||
        explicitStatus === "failed" ||
        explicitStatus === "error" ||
        statusStr === "error" ||
        hasExecutionError
      ) {
        executionStatus = "failed";
        if (!engineError) {
          engineError = { message: explicitError ?? "ComfyUI reported execution error" };
        }
        outputFilename = null;
      } else if (storedTerminalEvidence.status === "timeout" || explicitStatus === "timeout") {
        executionStatus = "unknown";
        outputFilename = null;
      } else if (
        storedTerminalEvidence.status === "interrupted" ||
        statusStr === "interrupted" ||
        hasInterruption
      ) {
        executionStatus = "unknown";
        outputFilename = null;
      } else if (
        storedTerminalEvidence.status === "success" ||
        statusStr === "success" ||
        (typeof entryObj?.status === "string" && entryObj.status === "success")
      ) {
        executionStatus = "completed";
      } else {
        executionStatus = "unknown";
      }

      if (!outputFilename && executionStatus === "completed") {
        outputFilename = storedTerminalEvidence.outputFilename ?? null;
        const outputsObj =
          (entryObj?.outputs as Record<string, unknown> | undefined) ??
          (rawObj?.outputs as Record<string, unknown> | undefined);
        if (!outputFilename && outputsObj && typeof outputsObj === "object") {
          const n92 = outputsObj["92"] as
            | {
                images?: Array<{ filename?: string; subfolder?: string; type?: string }>;
                videos?: Array<{ filename?: string; subfolder?: string; type?: string }>;
              }
            | undefined;
          const mediaList = Array.isArray(n92?.images)
            ? n92.images
            : Array.isArray(n92?.videos)
              ? n92.videos
              : null;
          if (mediaList && mediaList.length === 1) {
            const item = mediaList[0];
            const rawFilename = item?.filename;
            const subfolder = item?.subfolder ?? "";
            const outputType = item?.type ?? "output";
            if (
              rawFilename &&
              !rawFilename.includes("..") &&
              !rawFilename.includes("/") &&
              !rawFilename.includes("\\") &&
              !subfolder.includes("..") &&
              (outputType === "output" || outputType === "temp")
            ) {
              outputFilename = rawFilename;
            }
          }
        }
      }

      // Reject path traversal on outputFilename
      if (outputFilename) {
        const cleanBase = basename(outputFilename);
        if (
          cleanBase !== outputFilename ||
          outputFilename.includes("..") ||
          outputFilename.includes("/") ||
          outputFilename.includes("\\")
        ) {
          outputFilename = null;
        }
      }
    }

    if (executionStatus === "not_started" && intent) {
      executionStatus = promptId ? "running" : "unknown";
    }

    // Compute collection metrics
    let collectionStatus = baseResult.collection.status;
    const errors: Array<{ timestamp: string; message: string; phase?: string | undefined }> = [
      ...baseResult.collection.errors
    ];
    let beforeCoverage = false;
    let duringCoverage = false;
    let afterCoverage = false;
    let peakVram: number | null = null;
    let allocatableVram: number | null = null;
    let peakHostRam: number | null = null;
    let peakRss: number | null = null;
    let peakSwap: number | null = null;
    let beforeSwap: number | null = null;
    let afterSwap: number | null = null;
    let sampleSuccesses = 0;
    let sampleFailures = 0;

    for (const sample of telemetrySamples) {
      if (sample.phase === "before") beforeCoverage = true;
      if (sample.phase === "during") duringCoverage = true;
      if (sample.phase === "after") afterCoverage = true;

      // Host samples are only identity-verified at the source (the host
      // telemetry adapter throws on PID-reuse mismatch, which surfaces as
      // sample.error, not a null host). That protection depends on every
      // caller wiring an expected start-time tick through; re-verify
      // independently here against the run's own stored process record
      // so a sample that slips through with the wrong process's data
      // (e.g. identity check not configured, or telemetry read back from
      // a differently-sourced run) can't silently count toward "success"
      // and get folded into peak metrics for this run.
      const hasIdentityMismatch =
        !!sample.host &&
        !!storedProcessRecord &&
        (sample.host.processPid !== storedProcessRecord.pid ||
          sample.host.processStartTimeTicks !== storedProcessRecord.startTimeTicks);

      const isSampleSuccess =
        !sample.error && sample.gpu !== null && sample.host !== null && !hasIdentityMismatch;

      if (!isSampleSuccess) {
        sampleFailures++;
        if (hasIdentityMismatch) {
          errors.push({
            timestamp: sample.timestamp,
            message: `Host sample identity mismatch: expected pid ${storedProcessRecord?.pid}/startTimeTicks ${storedProcessRecord?.startTimeTicks}, got pid ${sample.host?.processPid}/startTimeTicks ${sample.host?.processStartTimeTicks}`,
            phase: sample.phase
          });
        } else if (sample.error) {
          errors.push({ timestamp: sample.timestamp, message: sample.error, phase: sample.phase });
        } else {
          errors.push({
            timestamp: sample.timestamp,
            message: `Missing telemetry facts in sample (gpu: ${sample.gpu ? "ok" : "null"}, host: ${sample.host ? "ok" : "null"})`,
            phase: sample.phase
          });
        }
      } else {
        sampleSuccesses++;
      }

      if (sample.gpu) {
        if (peakVram === null || sample.gpu.usedVramMb > peakVram) {
          peakVram = sample.gpu.usedVramMb;
        }
        if (sample.gpu.allocatableVramMb > 0) {
          allocatableVram = sample.gpu.allocatableVramMb;
        }
      }
      if (sample.host && !hasIdentityMismatch) {
        if (peakHostRam === null || sample.host.usedRamMb > peakHostRam) {
          peakHostRam = sample.host.usedRamMb;
        }
        if (peakRss === null || sample.host.processRssMb > peakRss) {
          peakRss = sample.host.processRssMb;
        }
        if (peakSwap === null || sample.host.swapUsedMb > peakSwap) {
          peakSwap = sample.host.swapUsedMb;
        }
        if (sample.phase === "before") {
          beforeSwap = sample.host.swapUsedMb;
        } else if (sample.phase === "after") {
          afterSwap = sample.host.swapUsedMb;
        }
      }
    }

    const hostSwapDeltaMb =
      beforeSwap !== null && afterSwap !== null ? afterSwap - beforeSwap : null;

    // Deduplicate errors by timestamp and message
    const seenErrors = new Set<string>();
    const uniqueErrors: Array<{ timestamp: string; message: string; phase?: string | undefined }> =
      [];
    for (const err of errors) {
      const key = `${err.timestamp}|${err.message}`;
      if (!seenErrors.has(key)) {
        seenErrors.add(key);
        uniqueErrors.push(err);
      }
    }

    const totalSamples = sampleSuccesses + sampleFailures;
    if (totalSamples > 0) {
      const hasAllRequiredMetrics =
        peakVram !== null &&
        peakHostRam !== null &&
        peakRss !== null &&
        peakSwap !== null &&
        hostSwapDeltaMb !== null;
      if (
        beforeCoverage &&
        duringCoverage &&
        afterCoverage &&
        sampleFailures === 0 &&
        uniqueErrors.length === 0 &&
        hasAllRequiredMetrics
      ) {
        collectionStatus = "complete";
      } else if (sampleSuccesses > 0) {
        collectionStatus = "partial";
      } else {
        collectionStatus = "failed";
      }
    }

    // Probe output if file found and prober available. ComfyUI's type:
    // "temp" media is written to --temp-directory, not
    // --output-directory, and a non-empty subfolder nests under either —
    // assuming everything lives flat in outputs/ would silently probe the
    // wrong (or a nonexistent) path for either case.
    let probeResult = baseResult.probe;
    if (outputFilename && this.prober && probeResult.status === "not_started") {
      try {
        const outputBaseDir =
          terminalEvidence?.outputType === "temp" ? `${runDir}/temp` : `${runDir}/outputs`;
        const outputDir = terminalEvidence?.subfolder
          ? `${outputBaseDir}/${terminalEvidence.subfolder}`
          : outputBaseDir;
        const fullOutputPath = `${outputDir}/${outputFilename}`;
        probeResult = await this.prober.probeOutput(fullOutputPath, 60000, outputDir);
      } catch (err) {
        probeResult = {
          ...probeResult,
          status: "failed",
          errors: [{ message: (err as Error).message }]
        };
      }
    }

    // Output conformance checks
    const conformanceChecks = {
      frameCountMatches:
        probeResult.measuredFacts.measuredFrames !== null
          ? probeResult.measuredFacts.measuredFrames === descriptor.configuredFrames
          : null,
      geometryMatches:
        probeResult.measuredFacts.width !== null && probeResult.measuredFacts.height !== null
          ? probeResult.measuredFacts.width === descriptor.width &&
            probeResult.measuredFacts.height === descriptor.height
          : null,
      fpsMatches:
        probeResult.measuredFacts.fps !== null
          ? probeResult.measuredFacts.fps === descriptor.fps
          : null,
      timingWithinTolerance:
        probeResult.measuredFacts.measuredVideoDurationMs !== null
          ? Math.abs(
              probeResult.measuredFacts.measuredVideoDurationMs - descriptor.configuredDurationMs
            ) <= 200 &&
            (probeResult.measuredFacts.measuredContainerDurationMs === null ||
              Math.abs(
                probeResult.measuredFacts.measuredContainerDurationMs -
                  descriptor.configuredDurationMs
              ) <= 200)
          : null
    };

    let conformanceStatus: "unknown" | "conformant" | "nonconformant" = "unknown";
    const conformanceReasons: string[] = [];

    if (probeResult.status === "succeeded") {
      // An established mismatch (a check that is explicitly false, or a
      // reported discrepancy flag) must win over "unknown" even when
      // some unrelated fact also happens to be missing -- e.g. a frame
      // count that definitely doesn't match must not be masked as
      // "unknown" just because fps couldn't be measured. Evaluate
      // established mismatches first, independent of completeness.
      const establishedMismatchReasons: string[] = [];
      if (conformanceChecks.frameCountMatches === false) {
        establishedMismatchReasons.push("frame_count_mismatch");
      }
      if (conformanceChecks.geometryMatches === false) {
        establishedMismatchReasons.push("geometry_mismatch");
      }
      if (conformanceChecks.fpsMatches === false) {
        establishedMismatchReasons.push("fps_mismatch");
      }
      if (conformanceChecks.timingWithinTolerance === false) {
        establishedMismatchReasons.push("duration_mismatch");
      }
      for (const flag of probeResult.discrepancyFlags) {
        establishedMismatchReasons.push(`discrepancy_${flag}`);
      }

      if (establishedMismatchReasons.length > 0) {
        conformanceStatus = "nonconformant";
        conformanceReasons.push(...establishedMismatchReasons);
      } else {
        const hasAllRequiredFacts =
          probeResult.measuredFacts.measuredFrames !== null &&
          probeResult.measuredFacts.width !== null &&
          probeResult.measuredFacts.height !== null &&
          probeResult.measuredFacts.fps !== null &&
          probeResult.measuredFacts.measuredVideoDurationMs !== null;

        if (!hasAllRequiredFacts) {
          conformanceStatus = "unknown";
          conformanceReasons.push("missing_measured_facts");
        } else {
          conformanceStatus = "conformant";
        }
      }
    } else {
      conformanceStatus = "unknown";
      conformanceReasons.push("probe_not_succeeded");
    }

    // Lifecycle determination
    let lifecycle = baseResult.lifecycle;
    if (executionStatus === "completed") {
      lifecycle = "completed";
    } else if (
      terminalEvidence?.status === "interrupted" ||
      (terminalEvidence?.rawDetails &&
        typeof terminalEvidence.rawDetails === "object" &&
        (terminalEvidence.rawDetails as Record<string, unknown>).interrupted === true)
    ) {
      lifecycle = promptId ? "interrupted" : "submission_unknown";
    } else if (executionStatus === "failed") {
      lifecycle = "failed";
    } else if (!promptId && intent) {
      lifecycle = "submission_unknown";
    }

    // Stop recommendation
    // A read failure here used to be fully swallowed into an empty
    // array, indistinguishable from "no events were ever recorded" --
    // which could silently hide a genuine stop_threshold_crossed event
    // (a safety-relevant fact) behind what looks like a clean run. An
    // empty result is the correct outcome, but a read FAILURE (as
    // opposed to the file never existing) must be surfaced, not erased.
    // It's only recorded as a collection error when collection actually
    // started: the schema requires collection.errors to be empty for
    // status "not_started" (nothing was ever collected, so there's
    // nothing this failure could have hidden), and collectionStatus is
    // already finalized above by this point in the function.
    let events: Awaited<ReturnType<typeof this.store.readEvents>> = [];
    try {
      events = await this.store.readEvents(runDir);
    } catch (err) {
      if (collectionStatus !== "not_started") {
        uniqueErrors.push({
          timestamp: new Date().toISOString(),
          message: `Failed to read events.jsonl during reconciliation: ${(err as Error).message}`
        });
      } else {
        console.warn(
          `MinimaxH3ExperimentService: failed to read events.jsonl during reconciliation of "${runDir}": ${(err as Error).message}`
        );
      }
    }
    const stopReasons: string[] = [];
    for (const evt of events) {
      if (evt.event === "stop_threshold_crossed") {
        const details = evt.details as Record<string, unknown> | undefined;
        const metric = typeof details?.metric === "string" ? details.metric : "threshold";
        stopReasons.push(`stop_threshold_crossed_${metric}`);
      }
    }
    if (collectionStatus === "failed" || collectionStatus === "partial") {
      stopReasons.push(`incomplete_telemetry_${collectionStatus}`);
    }
    if (probeResult.status === "failed") {
      stopReasons.push("output_probe_failed");
    }
    if (conformanceStatus === "nonconformant") {
      stopReasons.push("output_nonconformant");
    }

    let baselineRunId: string | null | undefined = baseResult.baselineRunId ?? null;
    let baselineResultDigest: string | null | undefined = baseResult.baselineResultDigest ?? null;
    if (!baselineRunId) {
      try {
        const link = (await this.store.readJsonFile(`${runDir}/baseline-link.json`)) as {
          baselineRunId?: string;
          baselineResultDigest?: string;
        };
        baselineRunId = link.baselineRunId ?? null;
        baselineResultDigest = link.baselineResultDigest ?? null;
      } catch {
        // ignore
      }
    }

    let policyDigest: string | undefined = baseResult.policyDigest;
    if (!policyDigest) {
      try {
        const sp = await this.store.readJsonFile(`${runDir}/stop-policy.json`);
        policyDigest = sha256Hex(canonicalizeJson(sp));
      } catch {
        // ignore
      }
    }

    const reconstructedResult: MinimaxH3ExperimentResult = {
      schemaVersion: 1,
      runId: descriptor.runId,
      descriptorDigest:
        descriptor.descriptorDigest ??
        computeDescriptorDigest(descriptor as unknown as Record<string, unknown>),
      configDigest: descriptor.configDigest,
      comparisonKey: descriptor.comparisonKey,
      requestedMemoryPolicy: descriptor.requestedRunner.memoryPolicy,
      lifecycle,
      observedRunner: {
        ...baseResult.observedRunner,
        ...(storedProcessRecord
          ? {
              pid: storedProcessRecord.pid,
              processStartTimeTicks: storedProcessRecord.startTimeTicks,
              targetGpuUuid: storedProcessRecord.gpuUuid,
              effectiveMode:
                storedProcessRecord.effectiveMode ?? baseResult.observedRunner.effectiveMode,
              ...(storedProcessRecord.argv ? { argv: storedProcessRecord.argv } : {}),
              ...(storedProcessRecord.env ? { env: storedProcessRecord.env } : {})
            }
          : {})
      },
      ...(policyDigest ? { policyDigest } : {}),
      ...(baselineRunId !== undefined ? { baselineRunId } : {}),
      ...(baselineResultDigest !== undefined ? { baselineResultDigest } : {}),
      timestamps: {
        preparedAt: baseResult.timestamps.preparedAt,
        startedAt: baseResult.timestamps.startedAt ?? intent?.timestamp ?? null,
        submittedAt: intent?.timestamp ?? null,
        terminatedAt: baseResult.timestamps.terminatedAt ?? new Date().toISOString()
      },
      execution: {
        status: executionStatus,
        promptId,
        terminalEvidence,
        engineError,
        // latencyMs is always carried forward from the (initially blank)
        // measurement template unless we actually compute it here. Derive
        // it from the real recorded started/terminated timestamps -- not
        // the synthesized "now" fallback used above for display purposes
        // -- so a missing real terminatedAt doesn't produce a bogus
        // latency measured against the moment reconciliation happened to
        // run.
        latencyMs: computeExecutionLatencyMs(
          baseResult.timestamps.startedAt ?? intent?.timestamp ?? null,
          baseResult.timestamps.terminatedAt ?? null,
          baseResult.execution.latencyMs
        )
      },
      collection: {
        status: collectionStatus,
        phaseCoverage: {
          before: beforeCoverage,
          during: duringCoverage,
          after: afterCoverage
        },
        sampleCount: {
          attempted: totalSamples,
          succeeded: sampleSuccesses,
          failed: sampleFailures
        },
        metrics: {
          gpuPeakUsedVramMb: peakVram,
          gpuAllocatableVramMb: allocatableVram,
          hostPeakRamUsedMb: peakHostRam,
          processPeakRssMb: peakRss,
          hostSwapUsedMb: peakSwap,
          hostSwapDeltaMb
        },
        errors: uniqueErrors
      },
      probe: probeResult,
      outputConformance: {
        status: conformanceStatus,
        checks: conformanceChecks,
        reasons: conformanceReasons
      },
      visualReview: baseResult.visualReview,
      operatorDecision: baseResult.operatorDecision,
      stopRecommendation: {
        recommended: stopReasons.length > 0,
        reasons: Array.from(new Set(stopReasons))
      }
    };

    if (descriptor.schemaVersion === 2) {
      let attemptToken: string | undefined;
      let attemptReadError: string | null = null;
      try {
        const attemptMeta = await this.store.readJsonFile<{ attemptToken?: string }>(
          `${runDir}/attempt.json`
        );
        if (
          typeof attemptMeta?.attemptToken === "string" &&
          attemptMeta.attemptToken.trim().length > 0
        ) {
          attemptToken = attemptMeta.attemptToken.trim();
        } else {
          attemptReadError = "attempt.json is missing valid attemptToken";
        }
      } catch (err) {
        attemptReadError = `Failed to read attempt.json: ${(err as Error).message}`;
      }

      const rawPhaseEvents: MinimaxH3PhaseAccountingEvent[] = this.store.readPhaseEvents
        ? await this.store.readPhaseEvents(runDir)
        : [];
      const descV2 = descriptor as MinimaxH3ExperimentDescriptorV2;

      const handshakeConflicts: string[] = [];
      if (attemptReadError) {
        handshakeConflicts.push(`Attempt correlation failed closed: ${attemptReadError}`);
      }

      const phaseEvents = rawPhaseEvents.filter((e) => {
        if (!e.runId || e.runId !== descV2.runId) return false;
        // Attempt correlation: fail closed if attempt.json could not be read or attemptToken does not match
        if (attemptReadError || !attemptToken || e.attemptToken !== attemptToken) return false;
        // Prompt correlation: when promptId is known, reject null promptId for execution events
        if (promptId) {
          if (e.promptId === promptId) {
            return true;
          }
          if (e.promptId === null || e.promptId === undefined) {
            // Environment startup phase events precede prompt submission
            return e.phase === "environment_startup";
          }
          return false;
        }
        return true;
      });
      const foreignEvents = rawPhaseEvents.filter((e) => !phaseEvents.includes(e));
      if (foreignEvents.length > 0) {
        handshakeConflicts.push(
          `Foreign events detected in events.jsonl: ${foreignEvents.length} event(s) did not match runId=${descV2.runId}, attemptToken=${attemptToken ?? "any"}, promptId=${promptId ?? "any"}`
        );
      }

      let capabilityHandshake: MinimaxH3CapabilityHandshake | undefined;
      try {
        const rawHs = await this.store.readJsonFile<unknown>(`${runDir}/capability-handshake.json`);
        if (rawHs) {
          capabilityHandshake = MinimaxH3CapabilityHandshakeSchema.parse(rawHs);
        }
      } catch {
        // Do not fall back to existingResult for capabilityHandshake; require capability-handshake.json
      }

      // Validate capability handshake and intent before attention reduction
      if (!capabilityHandshake) {
        handshakeConflicts.push(
          "Missing pre-submission capability handshake evidence for V2 experiment"
        );
      } else {
        if (!intent) {
          handshakeConflicts.push("Missing execution intent for V2 experiment");
        }
        const hsConflicts = validateCapabilityHandshake(capabilityHandshake, {
          descV2,
          expectedPid: intent?.pid,
          expectedNonce: intent?.handshakeNonce,
          attemptToken: intent?.attemptToken ?? attemptToken,
          comfyUiDir: descV2.target?.comfyUiDir,
          requireBinding: true
        });
        handshakeConflicts.push(...hsConflicts);

        if (intent) {
          if (!intent.capabilityHandshakeDigest) {
            handshakeConflicts.push("Execution intent missing capabilityHandshakeDigest");
          } else {
            const observedHsDigest = sha256Hex(canonicalizeJson(capabilityHandshake));
            if (observedHsDigest !== intent.capabilityHandshakeDigest) {
              handshakeConflicts.push(
                `Capability handshake digest mismatch: intent=${intent.capabilityHandshakeDigest}, observed=${observedHsDigest}`
              );
            }
          }
        }
      }

      const startedAt = baseResult.timestamps.startedAt ?? intent?.timestamp ?? null;
      const terminatedAt = baseResult.timestamps.terminatedAt ?? new Date().toISOString();
      const startMs = startedAt ? new Date(startedAt).getTime() : 0;
      const endMs = terminatedAt ? new Date(terminatedAt).getTime() : startMs;
      const parentWallTimeMs = Math.max(0, endMs - startMs);
      const phaseAccounting = reducePhaseAccounting({
        events: phaseEvents as unknown as MinimaxH3PhaseAccountingEvent[],
        parentWallTimeMs,
        declaredSteps: descV2.provenance?.samplerSettings?.steps
      });

      if (executionStatus !== "completed") {
        phaseAccounting.samplingWallTimeMs = null;
      }

      const completeness = phaseAccounting.status;
      const spansRecorded = Object.values(phaseAccounting.phases).filter(
        (p) => p.status === "measured"
      ).length;
      const missingExpectedPhases = Object.entries(phaseAccounting.phases)
        .filter(([_, p]) => p.status !== "measured")
        .map(([k]) => k) as MinimaxH3PhaseType[];

      const instrumentationReport: MinimaxH3InstrumentationReport = {
        completeness,
        eventCount: phaseEvents.length,
        spansRecorded,
        missingExpectedPhases,
        clockGapsDetected: phaseAccounting.coverageGaps.length > 0,
        tamperingDetected: phaseAccounting.intervalInconsistencies.length > 0,
        reasons: [
          ...phaseAccounting.intervalInconsistencies,
          ...phaseAccounting.coverageGaps.map((g) => g.reason)
        ]
      };

      let effectiveAttentionRequest = descV2.attentionRequest;
      if (!effectiveAttentionRequest && descV2.samplingRecipe?.attentionTopology) {
        effectiveAttentionRequest = {
          attentionVariant: "sage" as MinimaxH3AttentionVariantName,
          catalogDigest: sha256Hex(canonicalizeJson(descV2.samplingRecipe.attentionTopology)),
          expectedBackend: descV2.samplingRecipe.attentionTopology.backend,
          expectedKernel: descV2.requiredRuntime.attentionKernel,
          topologyDigest: descV2.samplingRecipe.attentionTopology.topologyDigest,
          patches: descV2.samplingRecipe.attentionTopology.patches,
          runtimeLockDigest: sha256Hex(canonicalizeJson(descV2.requiredRuntime)),
          candidateOnly: false,
          denseRegionPolicy: {
            allowPlannedDense: true,
            description: "FastH3 VSA block-sparse attention"
          }
        };
      }

      const expectedCollectorDigest =
        descV2.requiredRuntime?.collectorDigest ??
        (capabilityHandshake?.collectorDigest && handshakeConflicts.length === 0
          ? capabilityHandshake.collectorDigest
          : undefined);
      const expectedHookManifestDigest =
        descV2.requiredRuntime?.hookManifestDigest ??
        (capabilityHandshake?.hookManifestDigest && handshakeConflicts.length === 0
          ? capabilityHandshake.hookManifestDigest
          : undefined);

      // Completeness must never be reported when the pre-submission capability handshake
      // (identity, attempt/intent binding, digest match) was invalid or missing -- a fully
      // covered event stream must not mask an unvalidated identity (AC-5, F-799002ee,
      // F-aa019999). This reflects handshakeConflicts as accumulated up to this point
      // (attempt correlation, foreign events, capability handshake presence/binding,
      // intent digest match); it is intentionally evaluated before the attention
      // reduction call rather than after, so completeness is gated on identity, not the
      // reverse.
      const identityValidatedForAttention = handshakeConflicts.length === 0;

      let attentionObservation: MinimaxH3AttentionObservation | undefined;
      if (effectiveAttentionRequest) {
        attentionObservation = reduceAttentionObservation({
          events: phaseEvents,
          attentionRequest: effectiveAttentionRequest,
          expectedRunId: descV2.runId,
          expectedAttemptToken: attemptToken,
          expectedPromptId: promptId,
          expectedSteps:
            descV2.samplingRecipe?.expectedSteps ?? descV2.provenance?.samplerSettings?.steps,
          expectedCollectorDigest,
          expectedHookManifestDigest,
          identityValidated: identityValidatedForAttention
        });
      }

      let teacacheObservation: MinimaxH3TeaCacheObservation | undefined;
      if (descV2.teacacheRequest) {
        teacacheObservation = reduceTeaCacheObservation({
          events: phaseEvents,
          teacacheRequest: descV2.teacacheRequest,
          expectedRunId: descV2.runId,
          expectedAttemptToken: attemptToken,
          identityValidated: identityValidatedForAttention
        });
      }

      let preflightObservations: MinimaxH3ObservedProvenance | undefined;
      try {
        preflightObservations = await this.store.readJsonFile<MinimaxH3ObservedProvenance>(
          `${runDir}/preflight-observations.json`
        );
      } catch {
        preflightObservations = (existingResult as Partial<MinimaxH3ExperimentResultV2>)
          ?.observedProvenance;
      }

      const effectiveStopReasons = [...stopReasons];
      let attentionFailed = false;
      let attentionFailureReason: string | undefined;

      if (effectiveAttentionRequest && attentionObservation) {
        if (attentionObservation.status === "fallback") {
          attentionFailed = true;
          attentionFailureReason = `Attention fallback detected: ${attentionObservation.failureReason ?? "fallback to dense attention"}`;
          effectiveStopReasons.push("attention_fallback_detected");
        } else if (attentionObservation.status === "failed") {
          attentionFailed = true;
          attentionFailureReason = `Attention failed: ${attentionObservation.failureReason ?? "unknown attention failure"}`;
          effectiveStopReasons.push(
            `attention_failed_${attentionObservation.failureReason ?? "unknown"}`
          );
        }
        if (attentionObservation.missingKernelFailure) {
          attentionFailed = true;
          attentionFailureReason = `Missing attention kernel: ${attentionObservation.missingKernelFailure}`;
          effectiveStopReasons.push("attention_missing_kernel");
        }
        if (!attentionObservation.measurementCoverage.complete) {
          attentionFailed = true;
          if (!attentionFailureReason) {
            attentionFailureReason = !identityValidatedForAttention
              ? "Attention measurement coverage incomplete: capability handshake was not independently validated"
              : "Attention measurement coverage incomplete";
          }
          effectiveStopReasons.push("attention_incomplete_coverage");
        }
      } else if (effectiveAttentionRequest && !attentionObservation) {
        attentionFailed = true;
        attentionFailureReason = "Missing attention observation for attention experiment";
        effectiveStopReasons.push("attention_observation_missing");
      }

      let teacacheFailed = false;
      let teacacheFailureReason: string | undefined;

      if (descV2.teacacheRequest && teacacheObservation) {
        if (teacacheObservation.status === "failed") {
          teacacheFailed = true;
          teacacheFailureReason = `TeaCache failed: ${teacacheObservation.failureReason ?? "unknown failure"}`;
          effectiveStopReasons.push(
            `teacache_failed_${teacacheObservation.failureReason ?? "unknown"}`
          );
        }
        if (!teacacheObservation.coverage.complete) {
          teacacheFailed = true;
          if (!teacacheFailureReason) {
            teacacheFailureReason = !identityValidatedForAttention
              ? "TeaCache measurement coverage incomplete: capability handshake was not independently validated"
              : "TeaCache measurement coverage incomplete";
          }
          effectiveStopReasons.push("teacache_incomplete_coverage");
        }
      } else if (descV2.teacacheRequest && !teacacheObservation) {
        teacacheFailed = true;
        teacacheFailureReason = "Missing TeaCache observation for TeaCache experiment";
        effectiveStopReasons.push("teacache_observation_missing");
      }

      const isExplicitAttentionFailure =
        effectiveAttentionRequest &&
        attentionObservation &&
        (attentionObservation.status === "fallback" ||
          attentionObservation.status === "failed" ||
          Boolean(attentionObservation.missingKernelFailure));

      const isExplicitTeaCacheFailure =
        descV2.teacacheRequest && teacacheObservation && teacacheObservation.status === "failed";

      if (attentionFailed || teacacheFailed) {
        if (lifecycle !== "interrupted" && lifecycle !== "submission_unknown") {
          if (
            executionStatus === "completed" ||
            isExplicitAttentionFailure ||
            isExplicitTeaCacheFailure
          ) {
            executionStatus = "failed";
            lifecycle = "failed";
          }
          if (!engineError && (attentionFailureReason || teacacheFailureReason)) {
            engineError = { message: attentionFailureReason ?? teacacheFailureReason! };
          }
        }
      }
      const reconstructedResultV2: MinimaxH3ExperimentResultV2 = {
        schemaVersion: 2,
        runId: descV2.runId,
        descriptorDigest:
          descV2.descriptorDigest ??
          computeDescriptorDigest(descV2 as unknown as Record<string, unknown>),
        configDigest: descV2.configDigest,
        comparisonKey: descV2.comparisonKey,
        lifecycle,
        observedRunner: {
          ...baseResult.observedRunner,
          ...(storedProcessRecord
            ? {
                pid: storedProcessRecord.pid,
                processStartTimeTicks: storedProcessRecord.startTimeTicks,
                targetGpuUuid: storedProcessRecord.gpuUuid,
                effectiveMode:
                  storedProcessRecord.effectiveMode ?? baseResult.observedRunner.effectiveMode,
                ...(storedProcessRecord.argv ? { argv: storedProcessRecord.argv } : {}),
                ...(storedProcessRecord.env ? { env: storedProcessRecord.env } : {})
              }
            : {})
        },
        ...(policyDigest ? { policyDigest } : {}),
        ...(baselineRunId !== undefined ? { baselineRunId } : {}),
        ...(baselineResultDigest !== undefined ? { baselineResultDigest } : {}),
        timestamps: {
          preparedAt: baseResult.timestamps.preparedAt,
          startedAt,
          submittedAt: intent?.timestamp ?? null,
          terminatedAt
        },
        execution: {
          status: executionStatus,
          promptId,
          terminalEvidence,
          engineError,
          latencyMs: computeExecutionLatencyMs(
            startedAt,
            baseResult.timestamps.terminatedAt ?? null,
            baseResult.execution.latencyMs
          )
        },
        collection: {
          status: collectionStatus,
          phaseCoverage: {
            before: beforeCoverage,
            during: duringCoverage,
            after: afterCoverage
          },
          sampleCount: {
            attempted: totalSamples,
            succeeded: sampleSuccesses,
            failed: sampleFailures
          },
          metrics: {
            gpuPeakUsedVramMb: peakVram,
            gpuAllocatableVramMb: allocatableVram,
            hostPeakRamUsedMb: peakHostRam,
            processPeakRssMb: peakRss,
            hostSwapUsedMb: peakSwap,
            hostSwapDeltaMb
          },
          errors: uniqueErrors
        },
        probe: probeResult,
        outputConformance: {
          status: conformanceStatus,
          checks: conformanceChecks,
          reasons: conformanceReasons
        },
        visualReview: baseResult.visualReview,
        operatorDecision: baseResult.operatorDecision,
        stopRecommendation: {
          recommended: effectiveStopReasons.length > 0,
          reasons: Array.from(new Set(effectiveStopReasons))
        },
        experimentVariant: descV2.experimentVariant,
        observedProvenance: {
          actualCheckpointHash: (() => {
            const expected = descV2.provenance.actualCheckpointHash;
            const modelEntries = Object.values(preflightObservations?.loadedModelHashes ?? {});
            const matchingModel = modelEntries.find(
              (m) => m.expected === expected || m.value === expected
            );
            if (
              executionStatus === "completed" &&
              matchingModel &&
              matchingModel.status === "verified" &&
              matchingModel.value &&
              matchingModel.value === expected
            ) {
              return {
                status: "verified" as const,
                value: matchingModel.value,
                expected
              };
            }
            if (matchingModel?.status === "conflict") {
              return {
                status: "conflict" as const,
                value: matchingModel.value ?? null,
                expected,
                unknownReason: "Model hash mismatch"
              };
            }
            if (
              preflightObservations?.actualCheckpointHash?.status === "verified" &&
              preflightObservations.actualCheckpointHash.value &&
              preflightObservations.actualCheckpointHash.value === expected
            ) {
              return preflightObservations.actualCheckpointHash;
            }
            return {
              status: "unknown" as const,
              value: null,
              expected,
              unknownReason:
                executionStatus === "completed"
                  ? "checkpoint_not_verified"
                  : "runtime_observation_unavailable"
            };
          })(),
          loadedModelHashes: preflightObservations?.loadedModelHashes ?? {},
          comfyuiCoreRevision: preflightObservations?.comfyuiCoreRevision ?? {
            status: "unknown",
            value: null,
            expected: descV2.provenance.comfyuiCoreRevision
          },
          sourceIdentities: preflightObservations?.sourceIdentities ?? {
            status: "unknown",
            values: {}
          },
          customNodeInventory: preflightObservations?.customNodeInventory ?? {
            status: "unknown",
            nodes: []
          },
          runtimeVersions: preflightObservations?.runtimeVersions ?? {
            status: "unknown",
            pythonVersion: null,
            pytorchVersion: null,
            cudaBuildVersion: null,
            cudaRuntimeVersion: null,
            driverVersion: null
          },
          observedAttentionBackend: attentionObservation
            ? {
                status:
                  attentionObservation.status === "fallback"
                    ? "fallback"
                    : attentionObservation.status === "verified"
                      ? "verified"
                      : "unknown",
                effectiveBackend: attentionObservation.actualBackend,
                dispatchImplementation: attentionObservation.dispatchImplementation,
                ...(attentionObservation.status !== "verified" && attentionObservation.failureReason
                  ? { unknownReason: attentionObservation.failureReason }
                  : {})
              }
            : (preflightObservations?.observedAttentionBackend ?? {
                status: "unknown",
                effectiveBackend: null,
                dispatchImplementation: null,
                unknownReason: "attention_observation_unavailable"
              }),
          bootstrapHandshake: (() => {
            const handshakeEvent = phaseEvents.find(
              (e) =>
                e.type === "point_event" &&
                (e.boundarySource === "child_bootstrap" || e.phase === "environment_startup") &&
                e.runId === descV2.runId &&
                (!attemptToken || e.attemptToken === attemptToken) &&
                ((e.metadata as Record<string, unknown> | undefined)?.handshake === "v2-jsonl" ||
                  (e.metadata as Record<string, unknown> | undefined)?.protocolVersion ===
                    "v2-jsonl")
            );
            if (!handshakeEvent) {
              const mismatchedEvent = phaseEvents.find(
                (e) =>
                  e.type === "point_event" &&
                  (e.boundarySource === "child_bootstrap" || e.phase === "environment_startup") &&
                  ((e.metadata as Record<string, unknown> | undefined)?.handshake === "v2-jsonl" ||
                    (e.metadata as Record<string, unknown> | undefined)?.protocolVersion ===
                      "v2-jsonl")
              );
              if (mismatchedEvent) {
                handshakeConflicts.push(
                  `Handshake event runId/attemptToken mismatch: expected runId=${descV2.runId}, attemptToken=${attemptToken ?? "none"}, observed runId=${mismatchedEvent.runId}, attemptToken=${mismatchedEvent.attemptToken ?? "none"}`
                );
              }
            }
            const handshakeMeta = handshakeEvent?.metadata as Record<string, unknown> | undefined;
            let handshakeStatus: "verified" | "missing" | "unsupported" = "missing";
            let observedProtocol: string | null = null;
            let observedCollectorDigest: string | null = null;
            let observedHookManifestDigest: string | null = null;

            if (handshakeEvent) {
              observedProtocol =
                typeof handshakeMeta?.protocolVersion === "string"
                  ? handshakeMeta.protocolVersion
                  : typeof handshakeMeta?.handshake === "string"
                    ? handshakeMeta.handshake
                    : (capabilityHandshake?.protocol ?? null);

              if (
                typeof handshakeMeta?.collectorDigest === "string" &&
                /^[a-f0-9]{64}$/.test(handshakeMeta.collectorDigest)
              ) {
                observedCollectorDigest = handshakeMeta.collectorDigest;
              } else if (capabilityHandshake?.collectorDigest) {
                observedCollectorDigest = capabilityHandshake.collectorDigest;
              }
              if (
                typeof handshakeMeta?.hookManifestDigest === "string" &&
                /^[a-f0-9]{64}$/.test(handshakeMeta.hookManifestDigest)
              ) {
                observedHookManifestDigest = handshakeMeta.hookManifestDigest;
              } else if (capabilityHandshake?.hookManifestDigest) {
                observedHookManifestDigest = capabilityHandshake.hookManifestDigest;
              }

              if (!observedCollectorDigest || !observedHookManifestDigest) {
                handshakeStatus = "missing";
                handshakeConflicts.push(
                  "Handshake event is missing valid collectorDigest or hookManifestDigest"
                );
              } else if (
                descV2.requiredRuntime?.collectorDigest &&
                observedCollectorDigest !== descV2.requiredRuntime.collectorDigest
              ) {
                handshakeStatus = "missing";
                handshakeConflicts.push(
                  `Collector digest mismatch: observed ${observedCollectorDigest} !== expected ${descV2.requiredRuntime.collectorDigest}`
                );
              } else if (
                descV2.requiredRuntime?.hookManifestDigest &&
                observedHookManifestDigest !== descV2.requiredRuntime.hookManifestDigest
              ) {
                handshakeStatus = "missing";
                handshakeConflicts.push(
                  `Hook manifest digest mismatch: observed ${observedHookManifestDigest} !== expected ${descV2.requiredRuntime.hookManifestDigest}`
                );
              } else if (!capabilityHandshake || handshakeConflicts.length > 0) {
                handshakeStatus = "missing";
              } else {
                handshakeStatus = "verified";
              }
            }

            return {
              status: handshakeStatus,
              protocol: observedProtocol,
              collectorDigest: observedCollectorDigest,
              hookManifestDigest: observedHookManifestDigest
            };
          })(),
          observedSampling: (() => {
            const expectedSteps =
              descV2.samplingRecipe?.expectedSteps ??
              descV2.provenance?.samplerSettings?.steps ??
              20;
            const expectedSampler =
              descV2.samplingRecipe?.sampler ??
              descV2.provenance?.samplerSettings?.sampler ??
              "res_multistep";
            const expectedScheduler =
              descV2.samplingRecipe?.scheduler ??
              descV2.provenance?.samplerSettings?.scheduler ??
              "simple";

            const samplingSpans = phaseEvents.filter((e) => e.phase === "sampling");
            const samplingStarts = samplingSpans.filter((e) => e.type === "span_start");
            const samplingEnds = samplingSpans.filter((e) => e.type === "span_end");

            const enclosingSampling = samplingEnds[0] ?? samplingStarts[0];
            const observedSamplerName =
              typeof enclosingSampling?.metadata?.samplerName === "string"
                ? enclosingSampling.metadata.samplerName
                : (descV2.samplingRecipe?.sampler ?? descV2.provenance?.samplerSettings?.sampler);
            const observedSchedulerName =
              typeof enclosingSampling?.metadata?.schedulerName === "string"
                ? enclosingSampling.metadata.schedulerName
                : (descV2.samplingRecipe?.scheduler ??
                  descV2.provenance?.samplerSettings?.scheduler);

            const reasons: string[] = [];
            if (samplingStarts.length > 1) {
              reasons.push(
                `Multiple enclosing sampler invocations detected (${samplingStarts.length} sampling start spans)`
              );
            }

            if (
              enclosingSampling?.metadata?.samplerName &&
              enclosingSampling.metadata.samplerName !== expectedSampler
            ) {
              reasons.push(
                `Sampler name mismatch in metadata: expected "${expectedSampler}", observed "${enclosingSampling.metadata.samplerName}"`
              );
            }
            if (
              enclosingSampling?.metadata?.schedulerName &&
              enclosingSampling.metadata.schedulerName !== expectedScheduler
            ) {
              reasons.push(
                `Scheduler name mismatch in metadata: expected "${expectedScheduler}", observed "${enclosingSampling.metadata.schedulerName}"`
              );
            }

            const stepSpans = phaseEvents.filter(
              (e) =>
                e.phase === "sampling_step" &&
                e.type === "span_end" &&
                e.outcome === "success" &&
                e.stepIndex !== undefined
            );
            const uniqueStepIndices = new Set<number>();
            let hasDuplicates = false;
            for (const span of stepSpans) {
              if (uniqueStepIndices.has(span.stepIndex!)) {
                hasDuplicates = true;
              }
              uniqueStepIndices.add(span.stepIndex!);
            }
            if (uniqueStepIndices.size === 0) {
              if (reasons.length > 0) {
                return {
                  status: "conflict" as const,
                  completedSteps: null,
                  expectedSteps,
                  samplerName: observedSamplerName ?? null,
                  schedulerName: observedSchedulerName ?? null,
                  unknownReason: reasons.join("; ")
                };
              }
              return {
                status: "unknown" as const,
                completedSteps: null,
                expectedSteps,
                samplerName: observedSamplerName ?? null,
                schedulerName: observedSchedulerName ?? null,
                unknownReason: "step_spans_not_recorded"
              };
            }
            const completedSteps = uniqueStepIndices.size;
            if (executionStatus !== "completed") {
              return {
                status: "unknown" as const,
                completedSteps: completedSteps > 0 ? completedSteps : null,
                expectedSteps,
                samplerName: observedSamplerName ?? null,
                schedulerName: observedSchedulerName ?? null,
                unknownReason: `execution_${executionStatus}`
              };
            }
            let hasGaps = false;
            for (let i = 0; i < expectedSteps; i++) {
              if (!uniqueStepIndices.has(i)) {
                hasGaps = true;
                break;
              }
            }
            const hasOutOfRange = Array.from(uniqueStepIndices).some(
              (idx) => idx < 0 || idx >= expectedSteps
            );
            if (hasDuplicates) reasons.push("Duplicate sampling step completions detected");
            if (hasGaps || hasOutOfRange)
              reasons.push(
                `Non-contiguous sampling step sequence (expected indices 0..${expectedSteps - 1})`
              );
            if (completedSteps !== expectedSteps)
              reasons.push(
                `Observed completed steps (${completedSteps}) does not match expected (${expectedSteps})`
              );

            if (reasons.length > 0) {
              return {
                status: "conflict" as const,
                completedSteps,
                expectedSteps,
                samplerName: observedSamplerName ?? null,
                schedulerName: observedSchedulerName ?? null,
                unknownReason: reasons.join("; ")
              };
            }
            return {
              status: "verified" as const,
              completedSteps,
              expectedSteps,
              samplerName: observedSamplerName ?? null,
              schedulerName: observedSchedulerName ?? null
            };
          })(),
          observedConditioning: (() => {
            const expectedClass =
              descV2.route === "i2v" ? "MiniMaxH3ImageToVideo" : "MiniMaxH3ReferenceToVideo";
            const condEvents = phaseEvents.filter((e) => e.phase === "conditioning");
            if (condEvents.length === 0) {
              return {
                status: "unknown" as const,
                nodeClass: null,
                taskMode: null,
                referenceCount: null,
                unknownReason: "conditioning_event_not_recorded"
              };
            }
            const condStarts = condEvents.filter((e) => e.type === "span_start");
            const condEnds = condEvents.filter((e) => e.type === "span_end");

            const reasons: string[] = [];
            for (const endEvt of condEnds) {
              if (endEvt.outcome !== "success") {
                reasons.push(`Conditioning span ended with outcome: ${endEvt.outcome}`);
              }
            }

            const primaryCond =
              condEnds.find((e) => e.classType === expectedClass) ??
              condStarts.find((e) => e.classType === expectedClass) ??
              condEnds[0] ??
              condStarts[0] ??
              condEvents[0];

            const observedClass = primaryCond?.classType ?? null;
            const observedTaskMode =
              typeof primaryCond?.metadata?.taskMode === "string"
                ? primaryCond.metadata.taskMode
                : null;
            const observedRefCount =
              typeof primaryCond?.metadata?.referenceCount === "number"
                ? primaryCond.metadata.referenceCount
                : null;

            if (observedClass !== expectedClass) {
              reasons.push(`nodeClass (${observedClass} vs ${expectedClass})`);
            }
            if (observedTaskMode && observedTaskMode !== descV2.route) {
              reasons.push(`taskMode (${observedTaskMode} vs ${descV2.route})`);
            }
            if (observedRefCount !== null && observedRefCount !== descV2.references.length) {
              reasons.push(`refCount (${observedRefCount} vs ${descV2.references.length})`);
            }
            if (condEnds.length === 0) {
              reasons.push("Conditioning span did not complete (missing span_end)");
            }

            for (const evt of condEvents) {
              if (evt.metadata?.taskMode && evt.metadata.taskMode !== descV2.route) {
                const r = `Conflicting taskMode in conditioning event: ${evt.metadata.taskMode} vs ${descV2.route}`;
                if (!reasons.includes(r)) reasons.push(r);
              }
              if (
                typeof evt.metadata?.referenceCount === "number" &&
                evt.metadata.referenceCount !== descV2.references.length
              ) {
                const r = `Conflicting referenceCount in conditioning event: ${evt.metadata.referenceCount} vs ${descV2.references.length}`;
                if (!reasons.includes(r)) reasons.push(r);
              }
            }

            const status = reasons.length > 0 ? ("conflict" as const) : ("verified" as const);
            return {
              status,
              nodeClass: observedClass,
              taskMode: observedTaskMode,
              referenceCount: observedRefCount,
              ...(status === "conflict" ? { unknownReason: reasons.join("; ") } : {})
            };
          })(),
          ...(capabilityHandshake ? { capabilityHandshake } : {}),
          ...(preflightObservations?.packageIdentities
            ? { packageIdentities: preflightObservations.packageIdentities }
            : {}),
          ...(() => {
            if (!capabilityHandshake) return {};
            try {
              if (
                !capabilityHandshake.runtimeVersions?.pytorchVersion ||
                !preflightObservations?.interpreter?.pythonVersion ||
                !preflightObservations?.sourceIdentities?.values ||
                Object.keys(preflightObservations.sourceIdentities.values).length === 0
              ) {
                return {};
              }
              const toolchain = {
                pytorchBuild: capabilityHandshake.runtimeVersions.pytorchVersion,
                cudaBuildVersion: capabilityHandshake.runtimeVersions.cudaBuildVersion ?? null,
                cudaRuntimeVersion: capabilityHandshake.runtimeVersions.cudaRuntimeVersion ?? null,
                driverVersion: capabilityHandshake.runtimeVersions.driverVersion ?? null
              };
              // The envelope's interpreter identity must describe the actual
              // CHILD process that ran the experiment, not the host-side
              // preflight inspection taken before the child even started —
              // otherwise two different child interpreters satisfying the
              // same preflight could be substituted undetected (AC-4,
              // F-e35ea06e). Prefer the live capability handshake's reported
              // executable hash/ABI/compiler when present, falling back to
              // preflight only for fields the handshake didn't report.
              const rawInterpreter = preflightObservations.interpreter;
              const handshakeRuntime = capabilityHandshake.runtimeVersions;
              const liveExecutableHash: string | undefined = handshakeRuntime?.pythonExecutableHash
                ? handshakeRuntime.pythonExecutableHash
                : undefined;
              const liveAbiTag: string | undefined = handshakeRuntime?.pythonAbiTag
                ? handshakeRuntime.pythonAbiTag
                : undefined;
              const liveCompiler: string | undefined = handshakeRuntime?.pythonCompiler
                ? handshakeRuntime.pythonCompiler
                : undefined;
              const preflightExecutableHash: string | undefined =
                rawInterpreter.pythonExecutableHash ?? undefined;
              const preflightAbi: string | undefined = rawInterpreter.pythonAbi ?? undefined;
              const preflightCompiler: string | undefined =
                rawInterpreter.pythonCompiler ?? undefined;
              const interpreter = {
                pythonVersion: rawInterpreter.pythonVersion ?? undefined,
                ...(liveExecutableHash || preflightExecutableHash
                  ? { pythonExecutableHash: liveExecutableHash ?? preflightExecutableHash }
                  : {}),
                ...(liveAbiTag || preflightAbi ? { pythonAbi: liveAbiTag ?? preflightAbi } : {}),
                ...(liveCompiler || preflightCompiler
                  ? { pythonCompiler: liveCompiler ?? preflightCompiler }
                  : {})
              };
              const sourceIdentities = preflightObservations.sourceIdentities.values as Record<
                string,
                string
              >;
              const preflightPkgs = (
                Array.isArray(preflightObservations?.packageIdentities)
                  ? preflightObservations.packageIdentities
                  : []
              ) as ReadonlyArray<{
                name: string;
                version: string;
                artifactHash?: string;
                artifactMethod?: string;
              }>;
              const rawPackages =
                capabilityHandshake.packageIdentities &&
                capabilityHandshake.packageIdentities.length > 0
                  ? capabilityHandshake.packageIdentities
                  : preflightPkgs;
              if (rawPackages.length === 0) return {};
              const packageArtifacts = rawPackages.map((p) => {
                const preflightMatch = preflightPkgs.find((pkg) => pkg.name === p.name);
                return {
                  name: p.name,
                  version: p.version,
                  artifactHash: p.artifactHash ?? preflightMatch?.artifactHash ?? "",
                  artifactMethod: p.artifactMethod ?? preflightMatch?.artifactMethod ?? ""
                };
              });
              if (
                packageArtifacts.length === 0 ||
                packageArtifacts.some(
                  (p) =>
                    !/^[a-f0-9]{64}$/.test(p.artifactHash) ||
                    p.artifactMethod !== "installed_record_sha256_v1"
                )
              ) {
                return {};
              }
              const substrateDigest = computeAttentionRuntimeLockDigest({
                comfyuiCoreRevision: descV2.requiredRuntime.coreRevision,
                customNodeRevision: descV2.requiredRuntime.customNodeRevision,
                sourceFileHashes: sourceIdentities,
                interpreter,
                pytorchBuild: toolchain.pytorchBuild,
                cudaBuild: toolchain.cudaBuildVersion ?? undefined,
                driverConstraints: descV2.requiredRuntime.driverConstraints,
                pythonPackages: packageArtifacts,
                cudaRequirement: descV2.requiredRuntime.cudaRequirement,
                computeCapability: descV2.requiredRuntime.computeCapability,
                instrumentationProtocol: descV2.requiredRuntime.instrumentationProtocol,
                collectorDigest: capabilityHandshake.collectorDigest,
                hookManifestDigest: capabilityHandshake.hookManifestDigest,
                hooks: descV2.requiredRuntime.hooks
              });
              const attentionIdentityCandidate = {
                identityVersion: 1 as const,
                substrateDigest,
                interpreter,
                toolchain,
                packageArtifacts,
                sourceIdentities,
                registeredNodes: capabilityHandshake.registeredNodes,
                handshake: capabilityHandshake
              };
              const parsed = MinimaxH3AttentionIdentityEnvelopeSchema.safeParse(
                attentionIdentityCandidate
              );
              if (parsed.success) {
                return { attentionIdentity: parsed.data };
              }
              return {};
            } catch {
              return {};
            }
          })(),
          conflicts: [
            ...(preflightObservations?.conflicts ?? []),
            ...handshakeConflicts,
            ...(() => {
              const expectedSteps =
                descV2.samplingRecipe?.expectedSteps ??
                descV2.provenance?.samplerSettings?.steps ??
                20;
              const stepSpans = phaseEvents.filter(
                (e) =>
                  e.phase === "sampling_step" &&
                  e.type === "span_end" &&
                  e.outcome === "success" &&
                  e.stepIndex !== undefined
              );
              const uniqueSteps = new Set<number>();
              let hasDups = false;
              for (const s of stepSpans) {
                if (uniqueSteps.has(s.stepIndex!)) hasDups = true;
                uniqueSteps.add(s.stepIndex!);
              }
              const errs: string[] = [];
              if (hasDups) {
                errs.push("Duplicate sampling step completions detected");
              }
              const completedSteps = uniqueSteps.size;
              if (completedSteps === 0) {
                if (
                  descV2.samplingRecipe &&
                  (phaseEvents.some((e) => e.phase === "sampling") ||
                    executionStatus === "completed")
                ) {
                  errs.push(
                    `No successful sampling step spans recorded during execution (expected ${expectedSteps} steps)`
                  );
                }
              } else if (executionStatus === "completed" && completedSteps !== expectedSteps) {
                errs.push(
                  `Observed sampling steps (${completedSteps}) does not match expected (${expectedSteps})`
                );
              }
              for (let i = 0; i < expectedSteps; i++) {
                if (completedSteps > 0 && !uniqueSteps.has(i)) {
                  errs.push(`Missing sampling step index ${i} in sequence 0..${expectedSteps - 1}`);
                  break;
                }
              }
              const hasOutOfRange = Array.from(uniqueSteps).some(
                (idx) => idx < 0 || idx >= expectedSteps
              );
              if (hasOutOfRange) {
                errs.push(`Sampling step indices out of range [0..${expectedSteps - 1}]`);
              }
              return errs;
            })(),
            ...(() => {
              const expectedClass =
                descV2.route === "i2v" ? "MiniMaxH3ImageToVideo" : "MiniMaxH3ReferenceToVideo";
              const condEvents = phaseEvents.filter((e) => e.phase === "conditioning");
              const condStart = condEvents.find((e) => e.type === "span_start");
              const condEnd = condEvents.find((e) => e.type === "span_end");
              const condEvent = condEnd ?? condStart ?? condEvents[0];
              if (condEvent) {
                const errs: string[] = [];
                if (!condEnd) {
                  errs.push("Conditioning span did not complete (missing span_end)");
                } else if (condEnd.outcome !== "success") {
                  errs.push(`Conditioning span outcome was "${condEnd.outcome}"`);
                }
                const observedClass = condEvent.classType;
                if (!observedClass || observedClass !== expectedClass) {
                  errs.push(
                    `Conditioning node class mismatch: expected ${expectedClass}, got ${observedClass ?? "none"}`
                  );
                }
                const observedTaskMode = condEvent.metadata?.taskMode;
                if (!observedTaskMode || observedTaskMode !== descV2.route) {
                  errs.push(
                    `Conditioning taskMode mismatch: expected ${descV2.route}, got ${observedTaskMode ?? "none"}`
                  );
                }
                const observedRefCount = condEvent.metadata?.referenceCount;
                if (
                  typeof observedRefCount !== "number" ||
                  observedRefCount !== descV2.references.length
                ) {
                  errs.push(
                    `Conditioning referenceCount mismatch: expected ${descV2.references.length}, got ${observedRefCount ?? "none"}`
                  );
                }
                return errs;
              }
              if (
                descV2.samplingRecipe &&
                (phaseEvents.some(
                  (e) =>
                    e.phase === "sampling" || e.phase === "conditioning" || e.type === "span_start"
                ) ||
                  executionStatus === "completed")
              ) {
                return ["Conditioning span was not recorded during execution"];
              }
              return [];
            })(),
            ...(() => {
              const attnErrs: string[] = [];
              if (effectiveAttentionRequest && !attentionObservation) {
                attnErrs.push(
                  "Attention observation evidence missing for recipe requiring block-sparse attention"
                );
                return attnErrs;
              }
              if (descV2.samplingRecipe?.attentionTopology) {
                if (attentionObservation?.status !== "verified") {
                  attnErrs.push(
                    `Recipe requires verified block-sparse attention, observed status was "${attentionObservation?.status}" (${attentionObservation?.failureReason ?? "unverified"})`
                  );
                }
              }
              if (attentionObservation) {
                if (attentionObservation.status === "fallback") {
                  attnErrs.push(
                    `Attention fallback: ${attentionObservation.failureReason ?? "fallback detected"}`
                  );
                } else if (attentionObservation.status === "failed") {
                  attnErrs.push(
                    `Attention failed: ${attentionObservation.failureReason ?? "unknown failure"}`
                  );
                }
                if (attentionObservation.missingKernelFailure) {
                  attnErrs.push(
                    `Missing attention kernel: ${attentionObservation.missingKernelFailure}`
                  );
                }
                if (
                  effectiveAttentionRequest &&
                  !attentionObservation.measurementCoverage.complete
                ) {
                  attnErrs.push(
                    `Attention measurement coverage incomplete: observed ${attentionObservation.measurementCoverage.samplingCallsRecorded} sampling calls, ${attentionObservation.measurementCoverage.attentionCallsRecorded} attention calls`
                  );
                }
              }
              return attnErrs;
            })(),
            ...(() => {
              const tcErrs: string[] = [];
              if (descV2.teacacheRequest && !teacacheObservation) {
                tcErrs.push(
                  "TeaCache observation evidence missing for experiment with teacacheRequest"
                );
                return tcErrs;
              }
              if (teacacheObservation) {
                if (teacacheObservation.status === "failed") {
                  tcErrs.push(
                    `TeaCache failed: ${teacacheObservation.failureReason ?? "unknown failure"}`
                  );
                }
                if (!teacacheObservation.coverage.complete) {
                  tcErrs.push(
                    `TeaCache measurement coverage incomplete: observed ${teacacheObservation.coverage.samplingCallsRecorded} sampling calls, ${teacacheObservation.coverage.modelForwardsRecorded} model forwards`
                  );
                }
              }
              return tcErrs;
            })()
          ]
        },
        compatibility: descV2.compatibility,
        phaseAccounting,
        instrumentationReport,
        ...(attentionObservation ? { attentionObservation } : {}),
        ...(teacacheObservation ? { teacacheObservation } : {})
      };

      MinimaxH3ExperimentResultV2Schema.parse(reconstructedResultV2);
      await this.store.writeResult(runDir, reconstructedResultV2);
      return reconstructedResultV2;
    }

    // Validate result against strict schema
    MinimaxH3ExperimentResultSchema.parse(reconstructedResult);

    // Durably write reconstructed result
    await this.store.writeResult(runDir, reconstructedResult);
    return reconstructedResult;
  }

  async executeExperiment(
    runDir: string,
    options?: {
      stopPolicyPath?: string;
      baselineRunDir?: string;
      outputRoot?: string;
      abortSignal?: AbortSignal;
      templatesDir?: string;
      fixturesDir?: string;
    }
  ): Promise<MinimaxH3AnyExperimentResult> {
    const outputRoot = options?.outputRoot ?? ".ai-runs/minimax-h3-experiments";
    assertSafeOutputPath(runDir, outputRoot);

    if (options?.abortSignal?.aborted) {
      throw new Error("Experiment execution cancelled by operator signal before launch");
    }

    // Guard against re-run: if intent.json exists, reject live execution and direct operator to reconcile
    const existingIntent = await this.store.readIntent(runDir);
    if (existingIntent) {
      throw new Error(
        `Run directory "${runDir}" has already been submitted (intent.json exists). Refusing to re-submit. To inspect or reconstruct facts, use the reconcile command.`
      );
    }

    // 1. Dry offline validation first
    const validation = await this.validateExperiment(runDir, options);
    if (!validation.ok || !validation.validatedGraph) {
      throw new Error(`Experiment validation failed:\n${validation.errors.join("\n")}`);
    }
    if (validation.executionBlocked) {
      throw new Error(
        `Experiment execution is blocked:\n${validation.executionBlockers.join("\n")}`
      );
    }
    const descriptor = validation.descriptor;
    const validatedGraph = validation.validatedGraph;

    if (descriptor.schemaVersion === 2) {
      const descV2 = descriptor as MinimaxH3ExperimentDescriptorV2;
      const isAttentionExperiment =
        descV2.compatibility.scope.includes("attention") ||
        descV2.experimentVariant.changedFactors.some((f) => f.path === "attention.configuration") ||
        descV2.provenance.requestedAttentionBackend !== "default";
      const hasModernAttentionContract =
        Boolean(descV2.attentionRequest) || Boolean(descV2.samplingRecipe?.attentionTopology);
      if (isAttentionExperiment && !hasModernAttentionContract) {
        throw new Error(
          "Execution rejected: attention experiment descriptor lacks required modern attentionRequest"
        );
      }
      const isTeaCacheExperiment =
        descV2.compatibility.scope.includes("teacache") ||
        descV2.experimentVariant.changedFactors.some((f) => f.path === "caching.configuration");
      const isTeaCacheMatchedControl = descV2.compatibility.scope.includes("matched-control");
      if (isTeaCacheExperiment && !isTeaCacheMatchedControl && !descV2.teacacheRequest) {
        throw new Error(
          "Execution rejected: TeaCache experiment descriptor lacks required modern teacacheRequest"
        );
      }
    }

    // 2. Validate stop policy if provided
    if (!options?.stopPolicyPath) {
      throw new Error("Execution requires an operator-authored, versioned --stop-policy file.");
    }
    const rawPolicy = await this.store.readJsonFile(options.stopPolicyPath);
    const stopPolicy = MinimaxH3StopPolicySchema.parse(rawPolicy);
    await this.store.writeDurableJson(`${runDir}/stop-policy.json`, stopPolicy);

    // 3. Staged escalation rule: candidate frame counts > 124 require a verified baseline run
    if (descriptor.configuredFrames > 124) {
      if (!options?.baselineRunDir) {
        throw new Error(
          `Candidate frame count ${descriptor.configuredFrames} > 124 requires a successful 124-frame baseline run via --baseline-run-dir before escalating.`
        );
      }
      const baselineDescriptor = await this.store.readDescriptor(options.baselineRunDir);
      if (baselineDescriptor.configuredFrames !== 124) {
        throw new Error(
          `Baseline run must have configuredFrames = 124, got ${baselineDescriptor.configuredFrames}`
        );
      }
      if (baselineDescriptor.route !== descriptor.route) {
        throw new Error(
          `Baseline route mismatch: expected "${descriptor.route}", got "${baselineDescriptor.route}"`
        );
      }
      if (
        baselineDescriptor.width !== descriptor.width ||
        baselineDescriptor.height !== descriptor.height
      ) {
        throw new Error(
          `Baseline geometry mismatch: expected ${descriptor.width}x${descriptor.height}, got ${baselineDescriptor.width}x${baselineDescriptor.height}`
        );
      }
      if (baselineDescriptor.seed !== descriptor.seed) {
        throw new Error(
          `Baseline seed mismatch: expected ${descriptor.seed}, got ${baselineDescriptor.seed}`
        );
      }
      if (
        baselineDescriptor.requestedRunner.variantName !== descriptor.requestedRunner.variantName
      ) {
        throw new Error(
          `Baseline runner variant mismatch: expected "${descriptor.requestedRunner.variantName}", got "${baselineDescriptor.requestedRunner.variantName}"`
        );
      }
      if (baselineDescriptor.prompt !== descriptor.prompt) {
        throw new Error(
          `Baseline prompt mismatch: expected "${descriptor.prompt}", got "${baselineDescriptor.prompt}"`
        );
      }
      if (baselineDescriptor.references.length !== descriptor.references.length) {
        throw new Error(
          `Baseline references count mismatch: expected ${descriptor.references.length}, got ${baselineDescriptor.references.length}`
        );
      }
      for (let i = 0; i < descriptor.references.length; i++) {
        if (baselineDescriptor.references[i]?.sha256 !== descriptor.references[i]?.sha256) {
          throw new Error(
            `Baseline reference ${i} sha256 mismatch: expected ${descriptor.references[i]?.sha256}, got ${baselineDescriptor.references[i]?.sha256}`
          );
        }
        if (baselineDescriptor.references[i]?.role !== descriptor.references[i]?.role) {
          throw new Error(
            `Baseline reference ${i} role mismatch: expected "${descriptor.references[i]?.role}", got "${baselineDescriptor.references[i]?.role}"`
          );
        }
        if (baselineDescriptor.references[i]?.tag !== descriptor.references[i]?.tag) {
          throw new Error(
            `Baseline reference ${i} tag mismatch: expected "${descriptor.references[i]?.tag}", got "${baselineDescriptor.references[i]?.tag}"`
          );
        }
      }
      const baselineResult = await this.store.readResult(options.baselineRunDir);
      if (!baselineResult || baselineResult.execution.status !== "completed") {
        throw new Error(
          `Baseline run at ${options.baselineRunDir} has not completed successfully; cannot escalate candidate run.`
        );
      }
      if (baselineResult.observedRunner.effectiveMode.status !== "verified") {
        throw new Error(
          `Baseline run effective mode is not "verified" (status: ${baselineResult.observedRunner.effectiveMode.status}).`
        );
      }
      if (
        baselineResult.observedRunner.effectiveMode.value !==
        descriptor.requestedRunner.memoryPolicy
      ) {
        throw new Error(
          `Baseline run effective mode value "${baselineResult.observedRunner.effectiveMode.value}" does not match requested memory policy "${descriptor.requestedRunner.memoryPolicy}".`
        );
      }
      // The baseline and candidate must have been run under the exact
      // same stop-policy thresholds -- otherwise a candidate escalated
      // under a looser policy (e.g. a much higher maxPeakVramMb) isn't
      // actually comparable to the baseline it's claiming to extend.
      // Both digests are already computed by this point (stopPolicy was
      // read in step 2 above; baselineResult.policyDigest was computed
      // the same way when the baseline itself was reconciled).
      const candidatePolicyDigest = sha256Hex(canonicalizeJson(stopPolicy));
      if (!baselineResult.policyDigest) {
        throw new Error(
          `Baseline run at ${options.baselineRunDir} has no recorded policyDigest; cannot verify it used the same stop policy as this candidate.`
        );
      }
      if (baselineResult.policyDigest !== candidatePolicyDigest) {
        throw new Error(
          `Baseline run stop-policy digest "${baselineResult.policyDigest}" does not match this candidate's stop-policy digest "${candidatePolicyDigest}": they must use the exact same stop-policy thresholds to be comparable.`
        );
      }
      if (baselineResult.collection.status !== "complete") {
        throw new Error(
          `Baseline run collection status is "${baselineResult.collection.status}", must be "complete".`
        );
      }
      if (baselineResult.outputConformance.status !== "conformant") {
        throw new Error(
          `Baseline run output conformance is "${baselineResult.outputConformance.status}", must be "conformant".`
        );
      }
      let baselineVisualStatus = baselineResult.visualReview.status;
      if (baselineVisualStatus !== "reviewed") {
        const sidecarPath = `${options.baselineRunDir}/visual-review.json`;
        try {
          const sidecar = await this.store.readJsonFile(sidecarPath);
          const parsed = MinimaxH3VisualReviewSidecarSchema.parse(sidecar);
          // The sidecar schema carries outputSha256/configuredFrames/route
          // specifically so a review can be bound to the exact bytes it
          // was reviewing. Checking only runId/status accepts a sidecar
          // for the right run ID that reviewed a different output
          // entirely (e.g. from a re-run that overwrote the probed
          // output after the sidecar was written, or a copy-pasted
          // sidecar from another run with the same ID reused across a
          // rerun). Bind it to what was actually probed for this
          // baseline before trusting "reviewed".
          if (
            parsed.runId === baselineDescriptor.runId &&
            parsed.status === "reviewed" &&
            parsed.route === baselineDescriptor.route &&
            parsed.configuredFrames === baselineDescriptor.configuredFrames &&
            baselineResult.probe.outputSha256 !== null &&
            parsed.outputSha256 === baselineResult.probe.outputSha256
          ) {
            baselineVisualStatus = "reviewed";
          }
        } catch {
          // ignore missing or invalid sidecar
        }
      }
      if (baselineVisualStatus !== "reviewed") {
        throw new Error(
          `Baseline run visual review status is "${baselineVisualStatus}", must be "reviewed".`
        );
      }

      await this.store.writeDurableJson(`${runDir}/baseline-link.json`, {
        baselineRunId: baselineDescriptor.runId,
        baselineResultDigest: sha256Hex(canonicalizeJson(baselineResult))
      });
    }

    if (!this.preflight || !this.runner || !this.transport || !this.telemetry) {
      throw new Error("Live execution requires preflight, runner, transport, and telemetry ports.");
    }

    const writePreflightBlocker = async (blockerMessage: string | undefined, phase: string) => {
      const msg = blockerMessage ?? `${phase} failed`;
      try {
        await this.store.appendEvent(runDir, {
          timestamp: new Date().toISOString(),
          event: "preflight_failure",
          details: { phase, blocker: msg }
        });
        await this.store.writeTerminalEvidence(runDir, {
          source: "process",
          status: "error",
          runId: descriptor.runId,
          serverAddress: descriptor.target.address,
          serverPort: descriptor.target.port,
          error: { message: msg },
          rawDetails: { phase, preflightFailure: true, blocker: msg }
        });
      } catch {
        // ignore secondary failure
      }
    };

    // 4. Preflight checks
    const hostCheck = await this.preflight.checkTargetHost(descriptor.target);
    if (!hostCheck.ok) {
      await writePreflightBlocker(hostCheck.blocker, "checkTargetHost");
      throw new Error(`Preflight target host check failed: ${hostCheck.blocker}`);
    }

    const portCheck = await this.preflight.checkPortAvailable(
      descriptor.target.address,
      descriptor.target.port
    );
    if (!portCheck.ok) {
      await writePreflightBlocker(portCheck.blocker, "checkPortAvailable");
      throw new Error(`Preflight port check failed: ${portCheck.blocker}`);
    }

    const expectedCoreRevision =
      descriptor.schemaVersion === 2
        ? descriptor.requiredRuntime.coreRevision
        : descriptor.pinFileIdentities.comfyuiCoreRevision;
    const checkoutCheck = await this.preflight.verifyCheckout(
      descriptor.target.comfyUiDir,
      expectedCoreRevision
    );
    if (!checkoutCheck.ok) {
      await writePreflightBlocker(checkoutCheck.blocker, "verifyCheckout");
      throw new Error(`Preflight checkout check failed: ${checkoutCheck.blocker}`);
    }

    if (this.preflight.verifyEnvironmentTools) {
      const toolsCheck = await this.preflight.verifyEnvironmentTools(descriptor.target.pythonPath);
      if (!toolsCheck.ok) {
        await writePreflightBlocker(toolsCheck.blocker, "verifyEnvironmentTools");
        throw new Error(`Environment tools verification failed: ${toolsCheck.blocker}`);
      }
    }

    const modelsCheck = await this.preflight.verifyModels(
      descriptor.target.comfyUiDir,
      descriptor.resolvedModelPaths
    );
    if (!modelsCheck.ok) {
      await writePreflightBlocker(modelsCheck.blocker, "verifyModels");
      throw new Error(`Preflight model verification failed: ${modelsCheck.blocker}`);
    }

    const diskCheck = await this.preflight.verifyDiskSpace(runDir, 50);
    if (!diskCheck.ok) {
      await writePreflightBlocker(diskCheck.blocker, "verifyDiskSpace");
      throw new Error(`Preflight disk space check failed: ${diskCheck.blocker}`);
    }

    if (descriptor.schemaVersion === 2) {
      const descV2 = descriptor as MinimaxH3ExperimentDescriptorV2;
      if (descV2.attentionRequest) {
        if (descV2.attentionRequest.candidateOnly) {
          await writePreflightBlocker(
            `Attention variant "${descV2.attentionRequest.attentionVariant}" is candidate-only and cannot be executed`,
            "candidateOnlyGuard"
          );
          throw new Error(
            `Execution rejected: attention variant "${descV2.attentionRequest.attentionVariant}" is candidate-only`
          );
        }
        const entry = getAttentionCatalogEntry(
          descV2.attentionRequest.attentionVariant,
          descV2.route,
          {
            catalogDigest: descV2.attentionRequest.catalogDigest,
            coreRevision: descV2.requiredRuntime.coreRevision,
            scope: descV2.compatibility?.scope
          }
        );
        if (entry && !entry.runnable) {
          await writePreflightBlocker(
            `Attention variant "${descV2.attentionRequest.attentionVariant}" is non-runnable in catalog: ${entry.blockers.join("; ")}`,
            "nonRunnableCatalogGuard"
          );
          throw new Error(
            `Execution rejected: attention variant "${descV2.attentionRequest.attentionVariant}" is marked non-runnable`
          );
        }
      }

      if (descV2.teacacheRequest) {
        const entry = getTeaCacheCatalogEntry("teacache-raw-l1", descV2.route);
        if (entry && !entry.runnable) {
          await writePreflightBlocker(
            `TeaCache variant "${entry.variantName}" is non-runnable in catalog: ${entry.blockers.join("; ")}`,
            "nonRunnableCatalogGuard"
          );
          throw new Error(
            `Execution rejected: TeaCache variant "${entry.variantName}" is marked non-runnable`
          );
        }
      }

      if (!this.preflight.verifyExperimentRuntime) {
        await writePreflightBlocker(
          "V2 runtime verifier is unavailable",
          "verifyExperimentRuntime"
        );
        throw new Error("Preflight experiment runtime verification failed: verifier unavailable");
      }
      const runtimeCheck = await this.preflight.verifyExperimentRuntime({
        comfyUiDir: descriptor.target.comfyUiDir,
        pythonPath: descriptor.target.pythonPath,
        requiredRuntime: descriptor.requiredRuntime,
        requiredRuntimeDigest: sha256Hex(canonicalizeJson(descriptor.requiredRuntime)),
        expectedCheckpointHash: descV2.provenance.actualCheckpointHash,
        timeoutMs: descriptor.timeouts.startupTimeoutMs ?? 60000,
        signal: options?.abortSignal
      });
      if (!runtimeCheck.ok) {
        await writePreflightBlocker(runtimeCheck.blocker, "verifyExperimentRuntime");
        throw new Error(
          `Preflight experiment runtime verification failed: ${runtimeCheck.blocker ?? runtimeCheck.status}`
        );
      }
      if (runtimeCheck.observations) {
        const mergedObservations: MinimaxH3ObservedProvenance = {
          ...runtimeCheck.observations
        };
        if (modelsCheck.resolvedPaths) {
          const resolvedComfyDir = resolve(descriptor.target.comfyUiDir);
          const modelHashes: Record<
            string,
            {
              status: "verified" | "unknown" | "conflict";
              value: string | null;
              expected: string;
              resolvedPath: string;
            }
          > = { ...mergedObservations.loadedModelHashes };
          for (const [role, info] of Object.entries(modelsCheck.resolvedPaths)) {
            const resolvedModelPath = resolve(info.resolvedPath);
            // A plain startsWith admits a sibling directory sharing the
            // comfy dir's name as a prefix (e.g. "/x/comfy-evil/model.safetensors"
            // against comfy dir "/x/comfy") — require an exact match or a
            // path-separator boundary (F-69c0b5da).
            const isBoundToComfyDir =
              resolvedModelPath === resolvedComfyDir ||
              resolvedModelPath.startsWith(resolvedComfyDir + sep);
            const isMatch = isBoundToComfyDir && info.actualHash === info.expectedHash;
            modelHashes[role] = {
              status: isMatch ? "verified" : isBoundToComfyDir ? "conflict" : "unknown",
              value: info.actualHash ?? null,
              expected: info.expectedHash,
              resolvedPath: info.resolvedPath
            };
            // Preflight observations keep actualCheckpointHash as "unknown" (preflight_not_loaded)
            // until runtime execution / reconciliation.
            mergedObservations.actualCheckpointHash = {
              status: "unknown",
              value: null,
              expected: mergedObservations.actualCheckpointHash.expected,
              unknownReason: "preflight_not_loaded"
            };
          }
          for (const [expectedRole, expectedSpec] of Object.entries(
            descriptor.resolvedModelPaths
          )) {
            if (!modelHashes[expectedRole]) {
              const specObj =
                typeof expectedSpec === "object" && expectedSpec !== null
                  ? (expectedSpec as {
                      expectedHash?: string;
                      resolvedPath?: string;
                      path?: string;
                    })
                  : undefined;
              const expectedHash =
                specObj?.expectedHash ??
                (typeof expectedSpec === "string" ? expectedSpec : "0".repeat(64));
              const resolvedPath =
                specObj?.resolvedPath ??
                specObj?.path ??
                `${descriptor.target.comfyUiDir}/models/${expectedRole}`;
              modelHashes[expectedRole] = {
                status: "unknown",
                value: null,
                expected: expectedHash,
                resolvedPath
              };
            }
          }
          mergedObservations.loadedModelHashes = modelHashes;
        }
        MinimaxH3ObservedProvenanceSchema.parse(mergedObservations);
        await this.store.writeDurableJson(
          `${runDir}/preflight-observations.json`,
          mergedObservations
        );
      }
    }

    const lock = await this.preflight.acquireGpuLock(
      outputRoot,
      descriptor.target.gpuUuid,
      process.pid
    );
    if (!lock.acquired) {
      await writePreflightBlocker(lock.blocker, "acquireGpuLock");
      throw new Error(`Preflight GPU lock acquisition failed: ${lock.blocker}`);
    }

    let ownedChild: MinimaxH3OwnedProcess | null = null;
    let telemetryControl: {
      stop: () => Promise<void>;
      setPhase: (phase: "before" | "during" | "after") => void;
    } | null = null;
    let executeError: Error | null = null;
    // Hoisted out of the try block below (where they used to be declared)
    // so the catch block can see them: a stop-policy threshold trip
    // aborts execution the same way an operator cancellation does, and
    // the catch block needs to tell them apart from a genuine engine
    // error rather than persisting a deliberate, policy-triggered stop
    // as execution.status "error".
    let stopTriggered = false;
    const stopAbortController = new AbortController();

    try {
      // 5. Spawn owned child with absolute paths and clean environment.
      // ComfyUI's argparse requires --output-directory/--temp-directory/
      // --user-directory to already exist (it exits immediately with a
      // usage error otherwise, confirmed via a live run) -- create them
      // first rather than assuming the run directory already has them.
      await this.store.ensureRunSubdirectories(runDir);
      const collectorPath = descriptor.schemaVersion === 2 ? resolveCollectorPath() : undefined;
      if (descriptor.schemaVersion === 2 && !collectorPath) {
        throw new Error(
          "V2 instrumentation collector is unavailable; refusing an uninstrumented run"
        );
      }
      const attemptToken = `${descriptor.runId}-${Date.now()}`;
      try {
        await this.store.writeDurableJson(`${runDir}/attempt.json`, {
          attemptToken,
          runId: descriptor.runId
        });
      } catch {
        // ignore secondary failure
      }
      const childEnv: Record<string, string> = { ...descriptor.configuredRunner.env };
      childEnv.CCO_EXPERIMENT_RUN_DIR = runDir;
      childEnv.CCO_EXPERIMENT_RUN_ID = descriptor.runId;
      childEnv.CCO_EXPERIMENT_ATTEMPT_TOKEN = attemptToken;
      childEnv.CCO_EXPERIMENT_EVENT_LOG = `${runDir}/phase-events.jsonl`;
      if (descriptor.schemaVersion === 2) {
        const descV2 = descriptor as MinimaxH3ExperimentDescriptorV2;
        if (descV2.requiredRuntime?.collectorDigest) {
          childEnv.CCO_EXPERIMENT_COLLECTOR_DIGEST = descV2.requiredRuntime.collectorDigest;
        }
        if (descV2.requiredRuntime?.hookManifestDigest) {
          childEnv.CCO_EXPERIMENT_HOOK_MANIFEST_DIGEST = descV2.requiredRuntime.hookManifestDigest;
        }
        if (descV2.attentionRequest) {
          childEnv.CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND =
            descV2.attentionRequest.expectedBackend;
          childEnv.CCO_EXPERIMENT_ALLOW_PLANNED_DENSE = descV2.attentionRequest.denseRegionPolicy
            .allowPlannedDense
            ? "true"
            : "false";
        } else if (descV2.samplingRecipe?.attentionTopology) {
          childEnv.CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND =
            descV2.samplingRecipe.attentionTopology.backend;
          childEnv.CCO_EXPERIMENT_ALLOW_PLANNED_DENSE = "true";
        }
        if (descV2.teacacheRequest) {
          childEnv.CCO_EXPERIMENT_TEACACHE_MODE = descV2.teacacheRequest.mode;
          childEnv.CCO_EXPERIMENT_TEACACHE_THRESH = String(descV2.teacacheRequest.relL1Thresh);
          childEnv.CCO_EXPERIMENT_TEACACHE_START_STEP = String(descV2.teacacheRequest.startStep);
          childEnv.CCO_EXPERIMENT_TEACACHE_END_STEP = String(descV2.teacacheRequest.endStep);
          childEnv.CCO_EXPERIMENT_TEACACHE_TOTAL_STEPS = String(descV2.teacacheRequest.totalSteps);
        }
        if (descV2.requiredRuntime?.pythonPackages) {
          childEnv.CCO_EXPERIMENT_REQUIRED_PACKAGES = descV2.requiredRuntime.pythonPackages
            .map((p) => p.name)
            .join(",");
        }
      }
      ownedChild = await this.runner.spawnChild({
        pythonPath: descriptor.target.pythonPath,
        comfyUiDir: descriptor.target.comfyUiDir,
        address: descriptor.target.address,
        port: descriptor.target.port,
        dirs: {
          inputDir: `${runDir}/inputs`,
          outputDir: `${runDir}/outputs`,
          tempDir: `${runDir}/temp`,
          userDir: `${runDir}/user`
        },
        argv: descriptor.configuredRunner.argv,
        env: childEnv,
        gpuUuid: descriptor.target.gpuUuid,
        ...(collectorPath !== undefined ? { collectorPath } : {}),
        runDir,
        runId: descriptor.runId,
        attemptToken
      });

      // actualArgv/actualEnv start undefined (not the requested config) so
      // that, unless readActualProcessInfo below genuinely observes the
      // live process, the persisted record has no argv/env at all rather
      // than silently echoing back the request as if it were an
      // observation. actualCommandLine has no optional counterpart in the
      // schema, so it still falls back to a best-effort reconstruction,
      // but actualProcessInfoVerified records whether it is a real
      // observation or that reconstruction.
      let actualArgv: readonly string[] | undefined;
      let actualEnv: Record<string, string> | undefined;
      let actualCommandLine = [
        descriptor.target.pythonPath,
        "main.py",
        ...descriptor.configuredRunner.argv
      ].join(" ");
      let actualProcessInfoVerified = false;

      if (typeof ownedChild.readActualProcessInfo === "function") {
        try {
          const procInfo = await ownedChild.readActualProcessInfo();
          if (procInfo.argv && procInfo.argv.length > 0) {
            actualArgv = procInfo.argv;
          }
          if (procInfo.env && Object.keys(procInfo.env).length > 0) {
            actualEnv = procInfo.env;
          }
          if (procInfo.commandLine) {
            actualCommandLine = procInfo.commandLine;
          }
          actualProcessInfoVerified = Boolean(
            procInfo.argv?.length && procInfo.env && Object.keys(procInfo.env).length > 0
          );
        } catch {
          // Verification failed — actualArgv/actualEnv stay undefined and
          // actualProcessInfoVerified stays false, rather than silently
          // substituting the requested configuration.
        }
      }

      // Write process record immediately. launcherPid/launcherStartTimeTicks/
      // gpuLockToken identify the lock holder (this harness process), which
      // is distinct from the spawned ComfyUI child (pid/startTimeTicks
      // above) — a later, separate `cleanup` CLI invocation needs the
      // launcher's identity, not the child's, to release this GPU lock.
      const processRecord: MinimaxH3ProcessRecord = {
        pid: ownedChild.pid,
        startTimeTicks: ownedChild.startTimeTicks,
        address: descriptor.target.address,
        port: descriptor.target.port,
        gpuUuid: descriptor.target.gpuUuid,
        commandLine: actualCommandLine,
        startedAt: new Date().toISOString(),
        ...(actualArgv !== undefined ? { argv: [...actualArgv] } : {}),
        ...(actualEnv !== undefined ? { env: { ...actualEnv } } : {}),
        actualProcessInfoVerified,
        ...(lock.lockToken !== undefined ? { gpuLockToken: lock.lockToken } : {}),
        launcherPid: process.pid,
        launcherStartTimeTicks: lock.processStartTimeTicks ?? null
      };
      await this.store.writeProcessRecord(runDir, processRecord);

      const baseUrl = `http://${descriptor.target.address}:${descriptor.target.port}`;

      // 6. Wait for readiness. waitForReadiness only knows about the
      // HTTP endpoint, not the child process -- a child that exits
      // immediately (e.g. a bad CLI argument) would otherwise still be
      // polled for the full startupTimeoutMs before failing, with no
      // indication the process had already died. Race it against a
      // liveness poll on the owned child so a dead child fails fast
      // with a clear reason instead of a generic readiness timeout.
      const readinessStartedAt = Date.now();
      const overallStartupDeadline = readinessStartedAt + descriptor.timeouts.startupTimeoutMs;
      const readinessAbortController = new AbortController();
      if (options?.abortSignal) {
        if (options.abortSignal.aborted) {
          readinessAbortController.abort();
        } else {
          options.abortSignal.addEventListener("abort", () => readinessAbortController.abort(), {
            once: true
          });
        }
      }
      let childDiedDuringReadinessWait = false;
      const livenessPollHandle = setInterval(() => {
        if (!ownedChild!.isRunning()) {
          childDiedDuringReadinessWait = true;
          readinessAbortController.abort();
        }
      }, 250);
      let readyCheck: { ok: boolean; blocker?: string };
      try {
        readyCheck = await this.transport.waitForReadiness(
          baseUrl,
          descriptor.timeouts.startupTimeoutMs,
          readinessAbortController.signal
        );
      } finally {
        clearInterval(livenessPollHandle);
      }
      if (!readyCheck.ok) {
        if (childDiedDuringReadinessWait) {
          const exitStderr = ownedChild.getStderr();
          throw new Error(
            `ComfyUI child process exited before becoming ready${exitStderr ? `: ${exitStderr.trim().slice(-2000)}` : " (no stderr captured)"}`
          );
        }
        throw new Error(`ComfyUI child failed to become ready: ${readyCheck.blocker}`);
      }

      // 7. Verify socket ownership and environment
      const socketOwnership = await ownedChild.verifySocketOwnership();
      if (!socketOwnership.ok) {
        throw new Error(`Socket ownership verification failed: ${socketOwnership.reason}`);
      }

      const envVerification = await ownedChild.verifyChildEnvironment();
      if (!envVerification.ok) {
        throw new Error(`Child environment verification failed: ${envVerification.reason}`);
      }

      // 7b. Capability handshake verification (live child probe prior to queue/intent/submission)
      let capabilityHandshake: MinimaxH3CapabilityHandshake | undefined;
      let handshakeNonce: string | undefined;
      if (descriptor.schemaVersion === 2) {
        const descV2 = descriptor as MinimaxH3ExperimentDescriptorV2;
        if (!this.transport.getCapabilityHandshake) {
          throw new Error(
            "Capability handshake failed: transport does not support capability handshake"
          );
        }
        handshakeNonce = `hs-${descriptor.runId}-${Date.now()}`;
        const timeoutMs = descriptor.timeouts.submissionTimeoutMs ?? 30000;
        // Capability probing previously started a fresh, independent
        // submissionTimeoutMs deadline here regardless of how much of the
        // overall startupTimeoutMs budget readiness had actually consumed,
        // so a child that became ready quickly could still have its
        // capability handshake rejected on a short submission timeout even
        // though most of the longer startup budget remained unused
        // (F-de60ebdc). Use whichever deadline is later: the configured
        // submission timeout from now, or the remaining unused portion of
        // the overall startup budget.
        const handshakeDeadline = Math.max(Date.now() + timeoutMs, overallStartupDeadline);
        while (true) {
          if (options?.abortSignal?.aborted) {
            throw new Error("Capability handshake aborted by caller");
          }
          if (!ownedChild.isRunning()) {
            const exitStderr = ownedChild.getStderr();
            throw new Error(
              `Capability handshake failed: child process died during capability handshake${exitStderr ? `: ${exitStderr.trim().slice(-2000)}` : ""}`
            );
          }
          const remainingMs = Math.max(500, handshakeDeadline - Date.now());
          const handshakeRes = await this.transport.getCapabilityHandshake(
            baseUrl,
            handshakeNonce,
            Math.min(remainingMs, 5000),
            options?.abortSignal
          );
          if (!handshakeRes.ok || !handshakeRes.handshake) {
            throw new Error(
              `Capability handshake failed: ${handshakeRes.error ?? "Failed to acquire capability handshake from child process"}`
            );
          }
          if (handshakeRes.handshake.status === "pending") {
            if (Date.now() >= handshakeDeadline) {
              throw new Error(
                "Capability handshake failed: capability handshake timed out while pending attachment/readiness"
              );
            }
            await new Promise((r) => setTimeout(r, 200));
            continue;
          }
          capabilityHandshake = handshakeRes.handshake;
          break;
        }

        const hsConflicts = validateCapabilityHandshake(capabilityHandshake, {
          descV2,
          expectedPid: ownedChild.pid,
          expectedNonce: handshakeNonce,
          attemptToken,
          comfyUiDir: descriptor.target.comfyUiDir,
          requireBinding: true
        });
        if (hsConflicts.length > 0) {
          throw new Error(`Capability handshake failed: ${hsConflicts[0]}`);
        }

        await this.store.writeDurableJson(
          `${runDir}/capability-handshake.json`,
          capabilityHandshake
        );

        if (this.preflight?.verifyModels) {
          const preSubmitModelsCheck = await this.preflight.verifyModels(
            descriptor.target.comfyUiDir,
            descriptor.resolvedModelPaths
          );
          if (!preSubmitModelsCheck.ok) {
            throw new Error(
              `Pre-submission model verification failed: ${preSubmitModelsCheck.blocker ?? "Model check failed"}`
            );
          }
        }
      }

      // Verify queue is idle
      const initialQueue = await this.transport.getQueue(baseUrl);
      if (initialQueue.running.length > 0 || initialQueue.pending.length > 0) {
        throw new Error(
          `ComfyUI queue is not idle before prompt submission: ${initialQueue.running.length} running, ${initialQueue.pending.length} pending.`
        );
      }

      // 8. Analyze startup diagnostics
      const startupLogs = ownedChild.getStdout() + "\n" + ownedChild.getStderr();
      const effectiveMode = analyzeStartupDiagnostics(
        startupLogs,
        descriptor.requestedRunner.memoryPolicy
      );
      if (effectiveMode.status !== "verified") {
        throw new Error(
          `Memory policy verification failed before POST: ${effectiveMode.unknownReason}`
        );
      }

      // Update process record with verified effective mode
      const updatedProcessRecord: MinimaxH3ProcessRecord = {
        ...processRecord,
        effectiveMode
      };
      await this.store.writeProcessRecord(runDir, updatedProcessRecord);

      // 9. Start telemetry sampler
      let initialSampleSwap: number | null = null;

      telemetryControl = this.telemetry.start({
        targetGpuUuid: descriptor.target.gpuUuid,
        pid: ownedChild.pid,
        processStartTimeTicks: ownedChild.startTimeTicks,
        intervalMs: descriptor.collectionIntervalMs,
        onSample: async (sample) => {
          await this.store.appendTelemetry(runDir, sample);

          // Evaluate stop policy thresholds
          if (sample.host && initialSampleSwap === null) {
            initialSampleSwap = sample.host.swapUsedMb;
          }
          if (sample.gpu && sample.gpu.usedVramMb > stopPolicy.maxPeakVramMb) {
            stopTriggered = true;
            stopAbortController.abort();
            await this.store.appendEvent(runDir, {
              timestamp: new Date().toISOString(),
              event: "stop_threshold_crossed",
              details: {
                metric: "gpuPeakUsedVramMb",
                value: sample.gpu.usedVramMb,
                threshold: stopPolicy.maxPeakVramMb
              }
            });
          }
          if (sample.host && sample.host.usedRamMb > stopPolicy.maxHostRamMb) {
            stopTriggered = true;
            stopAbortController.abort();
            await this.store.appendEvent(runDir, {
              timestamp: new Date().toISOString(),
              event: "stop_threshold_crossed",
              details: {
                metric: "hostPeakRamUsedMb",
                value: sample.host.usedRamMb,
                threshold: stopPolicy.maxHostRamMb
              }
            });
          }
          if (sample.host && sample.host.swapUsedMb > stopPolicy.maxSwapUsedMb) {
            stopTriggered = true;
            stopAbortController.abort();
            await this.store.appendEvent(runDir, {
              timestamp: new Date().toISOString(),
              event: "stop_threshold_crossed",
              details: {
                metric: "hostSwapUsedMb",
                value: sample.host.swapUsedMb,
                threshold: stopPolicy.maxSwapUsedMb
              }
            });
          }
          if (
            sample.host &&
            initialSampleSwap !== null &&
            sample.host.swapUsedMb - initialSampleSwap > stopPolicy.maxSwapDeltaMb
          ) {
            stopTriggered = true;
            stopAbortController.abort();
            await this.store.appendEvent(runDir, {
              timestamp: new Date().toISOString(),
              event: "stop_threshold_crossed",
              details: {
                metric: "hostSwapDeltaMb",
                value: sample.host.swapUsedMb - initialSampleSwap,
                threshold: stopPolicy.maxSwapDeltaMb
              }
            });
          }
        }
      });
      telemetryControl.setPhase("before");
      await new Promise((r) => setTimeout(r, 1000));

      if (options?.abortSignal?.aborted || stopAbortController.signal.aborted) {
        throw new Error("Experiment execution cancelled by operator signal before POST");
      }

      // Re-verify child socket, environment, staged assets, and config.json before POST
      const prePostSocket = await ownedChild.verifySocketOwnership();
      if (!prePostSocket.ok) {
        throw new Error(`Socket ownership check before POST failed: ${prePostSocket.reason}`);
      }
      const prePostEnv = await ownedChild.verifyChildEnvironment();
      if (!prePostEnv.ok) {
        throw new Error(`Child environment check before POST failed: ${prePostEnv.reason}`);
      }
      for (const ref of descriptor.references) {
        const stagedPath = `${runDir}/inputs/${ref.stagedFilename}`;
        const hashInfo = await this.store.hashFile(stagedPath);
        if (hashInfo.sha256 !== ref.sha256) {
          throw new Error(`Staged input asset tampered before POST: ${ref.stagedFilename}`);
        }
      }
      const onDiskConfig = await this.store.readConfig(runDir);
      const onDiskCanonical = canonicalizeJson(onDiskConfig);
      const validatedCanonical = canonicalizeJson(validatedGraph);
      if (onDiskCanonical !== validatedCanonical) {
        throw new Error("config.json on disk was modified or tampered before POST");
      }

      // Re-verify resolved models have not been modified or removed before POST
      if (modelsCheck.resolvedPaths) {
        for (const [role, info] of Object.entries(modelsCheck.resolvedPaths)) {
          if (!existsSync(info.resolvedPath)) {
            throw new Error(
              `Resolved model "${role}" at "${info.resolvedPath}" missing before POST`
            );
          }
          if (descriptor.target.comfyUiDir) {
            let realResolved: string;
            try {
              realResolved = realpathSync(info.resolvedPath);
            } catch {
              realResolved = resolve(info.resolvedPath);
            }
            const modelsDir = resolve(descriptor.target.comfyUiDir, "models");
            let realModelsDir: string;
            try {
              realModelsDir = realpathSync(modelsDir);
            } catch {
              realModelsDir = modelsDir;
            }
            if (realResolved !== realModelsDir && !realResolved.startsWith(realModelsDir + sep)) {
              throw new Error(
                `Resolved model "${role}" at "${info.resolvedPath}" is outside ComfyUI models directory "${realModelsDir}"`
              );
            }
          }
          const hashInfo = await this.store.hashFile(info.resolvedPath);
          if (hashInfo.sha256 !== info.expectedHash) {
            throw new Error(
              `Resolved model "${role}" at "${info.resolvedPath}" was modified or tampered before POST: expected ${info.expectedHash}, observed ${hashInfo.sha256}`
            );
          }
        }
      }

      // 10. Write intent
      const clientId = `client-${descriptor.runId}`;
      const intent: MinimaxH3ExperimentIntent = {
        runId: descriptor.runId,
        clientId,
        workflowDigest: descriptor.derivedWorkflowDigest,
        // requestFingerprint must identify the exact payload actually
        // submitted, not just restate the runId/workflowDigest pairing
        // (which is already recorded separately and doesn't prove what
        // was POSTed). Hash the canonical form of validatedGraph -- the
        // same in-memory graph passed to submitPrompt below -- so this
        // is a true fingerprint of the request, usable to independently
        // verify what was actually sent.
        requestFingerprint: sha256Hex(canonicalizeJson(validatedGraph)),
        timestamp: new Date().toISOString(),
        ...(attemptToken ? { attemptToken } : {}),
        ...(ownedChild?.pid !== undefined ? { pid: ownedChild.pid } : {}),
        ...(handshakeNonce ? { handshakeNonce } : {}),
        ...(capabilityHandshake
          ? { capabilityHandshakeDigest: sha256Hex(canonicalizeJson(capabilityHandshake)) }
          : {})
      };
      await this.store.writeIntent(runDir, intent);

      if (options?.abortSignal?.aborted || stopAbortController.signal.aborted) {
        throw new Error("Experiment execution cancelled by operator signal after intent");
      }

      // 11. Submit prompt using validated in-memory graph (never unverified disk file)
      telemetryControl.setPhase("during");
      let submitRes;
      try {
        submitRes = await this.transport.submitPrompt(
          baseUrl,
          validatedGraph,
          clientId,
          descriptor.timeouts.submissionTimeoutMs,
          options?.abortSignal
        );
      } catch (submitErr) {
        await this.store.writeTerminalEvidence(runDir, {
          source: "process",
          status: "unknown",
          runId: descriptor.runId,
          serverAddress: descriptor.target.address,
          serverPort: descriptor.target.port,
          error: { message: (submitErr as Error).message },
          rawDetails: {
            ambiguousSubmission: true,
            error: (submitErr as Error).message,
            phase: "prompt_submission"
          }
        });
        throw submitErr;
      }

      if (!submitRes.ok || !submitRes.promptId) {
        // A rejection caused by our own abort signal (operator
        // cancellation or a stop-policy threshold trip) is a deliberate
        // stop, not an engine failure -- submitPrompt's pre-POST abort
        // check returns the same ok:false shape either way, so this is
        // the only place that can still tell them apart. Writing status
        // "error" unconditionally here means the catch block's own
        // (correctly abort-aware) terminal evidence write never takes
        // effect, since it only writes when none exists yet.
        const isAbortedRejection =
          (options?.abortSignal?.aborted ?? false) ||
          stopAbortController.signal.aborted ||
          stopTriggered;
        await this.store.writeTerminalEvidence(runDir, {
          source: "process",
          status: isAbortedRejection ? "interrupted" : "error",
          runId: descriptor.runId,
          serverAddress: descriptor.target.address,
          serverPort: descriptor.target.port,
          error: { message: submitRes.error ?? "Prompt submission rejected" },
          rawDetails: {
            ambiguousSubmission: false,
            error: submitRes.error,
            phase: "prompt_submission",
            interrupted: isAbortedRejection
          }
        });
        throw new Error(`ComfyUI prompt submission failed: ${submitRes.error}`);
      }

      // 12. Write receipt
      const receipt: MinimaxH3ExperimentReceipt = {
        runId: descriptor.runId,
        promptId: submitRes.promptId,
        acceptedAt: new Date().toISOString()
      };
      await this.store.writeReceipt(runDir, receipt);

      // 13. Poll execution with stop policy checking
      const effectiveRenderTimeoutMs = Math.min(
        descriptor.timeouts.totalRenderTimeoutMs,
        stopPolicy.maxExecutionDurationMs
      );

      const combinedAbortController = new AbortController();
      if (options?.abortSignal) {
        if (options.abortSignal.aborted) {
          combinedAbortController.abort();
        } else {
          options.abortSignal.addEventListener("abort", () => combinedAbortController.abort(), {
            once: true
          });
        }
      }
      // A stop-policy threshold can cross during the submitPrompt/
      // writeReceipt window above, before this listener is attached.
      // AbortSignal's "abort" event fires exactly once, at the moment
      // .abort() is called -- a listener added after that point never
      // fires, so an already-aborted stopAbortController would
      // otherwise be silently missed for the entire poll, unlike the
      // options?.abortSignal branch above which already guards against
      // this.
      if (stopAbortController.signal.aborted) {
        combinedAbortController.abort();
      } else {
        stopAbortController.signal.addEventListener(
          "abort",
          () => combinedAbortController.abort(),
          { once: true }
        );
      }

      const pollRes = await this.transport.pollPromptHistory(
        baseUrl,
        receipt.promptId,
        effectiveRenderTimeoutMs,
        descriptor.timeouts.pollIntervalMs,
        combinedAbortController.signal
      );

      // Persist terminal evidence BEFORE process teardown!
      // pollRes.status "failed" is returned for three distinct reasons:
      // our own abort signal fired, ComfyUI itself reported the
      // execution as interrupted, or ComfyUI reported a genuine
      // execution error (e.g. CUDA OOM). Collapsing all three into
      // "error" made a deliberate stop (operator cancel, or a
      // stop-policy threshold trip) indistinguishable from an actual
      // engine failure. pollRes.interrupted (set only for the first two
      // cases) is what pollPromptHistory provides specifically so this
      // distinction survives.
      const terminalStatus =
        pollRes.status === "completed"
          ? "success"
          : pollRes.status === "failed"
            ? pollRes.interrupted
              ? "interrupted"
              : "error"
            : pollRes.status === "timeout"
              ? "timeout"
              : "error";

      const terminalEvidence: MinimaxH3TerminalEvidence = {
        source: "history",
        status: terminalStatus,
        runId: descriptor.runId,
        promptId: receipt.promptId,
        serverAddress: descriptor.target.address,
        serverPort: descriptor.target.port,
        outputFilename: pollRes.outputFilename,
        subfolder: pollRes.outputSubfolder ?? null,
        outputType: pollRes.outputType ?? null,
        error: pollRes.error ? { message: pollRes.error } : null,
        rawDetails: pollRes.rawHistory ?? {
          status: pollRes.status,
          error: pollRes.error,
          stopTriggered
        }
      };
      await this.store.writeTerminalEvidence(runDir, terminalEvidence);

      telemetryControl.setPhase("after");
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      executeError = err as Error;
      // Record terminal evidence for the exception if not already recorded
      try {
        const existingEvidence = await this.store.readTerminalEvidence(runDir);
        if (!existingEvidence) {
          // A stop-policy threshold trip (stopTriggered/stopAbortController)
          // cancels execution the same way an external operator abort
          // does -- both are deliberate, expected stops, not an
          // unexpected engine failure, and must not be persisted as
          // status "error".
          const isInterrupted =
            (options?.abortSignal?.aborted ?? false) ||
            stopAbortController.signal.aborted ||
            stopTriggered;
          await this.store.writeTerminalEvidence(runDir, {
            source: "process",
            status: isInterrupted ? "interrupted" : "error",
            runId: descriptor.runId,
            serverAddress: descriptor.target.address,
            serverPort: descriptor.target.port,
            error: { message: (err as Error).message },
            rawDetails: { exception: (err as Error).message, interrupted: isInterrupted }
          });
        }
      } catch {
        // ignore secondary write error
      }
    } finally {
      if (telemetryControl) {
        try {
          await telemetryControl.stop();
        } catch {
          // ignore
        }
      }
      if (ownedChild) {
        try {
          const stdoutLogs = ownedChild.getStdout();
          const stderrLogs = ownedChild.getStderr();
          if (stdoutLogs) {
            await this.store.writeTextFile(`${runDir}/comfyui.stdout.log`, stdoutLogs);
          }
          if (stderrLogs) {
            await this.store.writeTextFile(`${runDir}/comfyui.stderr.log`, stderrLogs);
          }
        } catch {
          // ignore log write failure
        }
        try {
          await ownedChild.stop(descriptor.timeouts.shutdownTimeoutMs);
        } catch (stopErr) {
          executeError = executeError ?? (stopErr as Error);
        }
      }
      if (lock) {
        try {
          const isRunning = ownedChild ? ownedChild.isRunning() : false;
          if (!isRunning) {
            await lock.release();
          }
        } catch {
          // ignore
        }
      }
    }

    // 14. Always reconcile final facts and write result.json
    const reconciledResult = await this.reconcileExperiment(runDir, options);
    if (executeError) {
      throw executeError;
    }
    return reconciledResult;
  }
}
