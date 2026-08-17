import { readFile } from "node:fs/promises";
import type { RenderProfile } from "@cco/contracts";
import { hashModelFiles, hashWorkflow, type ModelFileHash } from "./hasher.js";
import { runDiskPreflight, type DiskPreflightResult } from "./preflight.js";
import { collectGitProvenance, type GitProvenance } from "./git-tracker.js";
import type { CertificationProfile } from "./profile-manifest.js";

export type RenderProfileProvenance = Pick<
  RenderProfile,
  | "key"
  | "version"
  | "engine"
  | "workflowHash"
  | "modelHashes"
  | "frames"
  | "steps"
  | "runnerProfile"
  | "measuredDiskFootprintGb"
  | "minFreeDiskGb"
>;

export type ProvenanceProgress = Readonly<{
  phase: "preflight" | "git" | "workflow_hash" | "model_hash";
  status: "started" | "completed";
  detail?: string;
}>;

export interface CertificationProvenanceReport {
  readonly version: 1;
  readonly profileId: string;
  readonly generatedAt: string;
  readonly workflow: Readonly<{
    relativePath: string;
    sha256: string;
    source: CertificationProfile["source"];
  }>;
  readonly models: readonly ModelFileHash[];
  readonly git: GitProvenance;
  readonly disk: DiskPreflightResult;
  readonly renderProfileProvenance: RenderProfileProvenance | null;
}

export interface ProvenanceCollectorDependencies {
  readonly runDiskPreflight?: typeof runDiskPreflight;
  readonly collectGitProvenance?: typeof collectGitProvenance;
  readonly readWorkflowFile?: (filePath: string) => Promise<string>;
  readonly hashWorkflow?: typeof hashWorkflow;
  readonly hashModelFiles?: typeof hashModelFiles;
}

export async function collectCertificationProvenance(
  input: Readonly<{
    comfyUiDir: string;
    profile: CertificationProfile;
    now?: () => Date;
    onProgress?: (event: ProvenanceProgress) => void;
  }>,
  dependencies?: ProvenanceCollectorDependencies
): Promise<CertificationProvenanceReport> {
  const { comfyUiDir, profile, now = () => new Date(), onProgress } = input;

  const runDiskPreflightFn = dependencies?.runDiskPreflight ?? runDiskPreflight;
  const collectGitProvenanceFn = dependencies?.collectGitProvenance ?? collectGitProvenance;
  const readWorkflowFileFn =
    dependencies?.readWorkflowFile ?? ((filePath: string) => readFile(filePath, "utf8"));
  const hashWorkflowFn = dependencies?.hashWorkflow ?? hashWorkflow;
  const hashModelFilesFn = dependencies?.hashModelFiles ?? hashModelFiles;

  // Phase 1: Preflight
  onProgress?.({ phase: "preflight", status: "started" });
  const disk = await runDiskPreflightFn(comfyUiDir, profile.models, profile.minFreeDiskGb);
  onProgress?.({ phase: "preflight", status: "completed" });

  // Phase 2: Git provenance
  onProgress?.({ phase: "git", status: "started" });
  const git = await collectGitProvenanceFn(comfyUiDir);
  onProgress?.({ phase: "git", status: "completed" });

  // Phase 3: Workflow hashing & drift rejection
  onProgress?.({ phase: "workflow_hash", status: "started" });
  const workflowContent = await readWorkflowFileFn(profile.workflowPath);
  const workflowSha256 = hashWorkflowFn(workflowContent);
  onProgress?.({ phase: "workflow_hash", status: "completed" });

  if (workflowSha256 !== profile.expectedWorkflowHash) {
    throw new Error(
      `Workflow hash mismatch for profile "${profile.id}": expected ${profile.expectedWorkflowHash}, got ${workflowSha256}`
    );
  }

  // Phase 4: Model hashing
  onProgress?.({ phase: "model_hash", status: "started" });
  const models = await hashModelFilesFn(comfyUiDir, profile.models, (event) => {
    onProgress?.({
      phase: "model_hash",
      status: event.status,
      detail: event.key
    });
  });
  onProgress?.({ phase: "model_hash", status: "completed" });

  // Assemble RenderProfileProvenance if identity is present
  let renderProfileProvenance: RenderProfileProvenance | null = null;

  if (profile.renderProfileIdentity !== null) {
    const frames = profile.baseline.frames ?? (profile.engine === "flux_schnell" ? 1 : undefined);
    if (frames === undefined) {
      throw new Error(
        `Profile "${profile.id}" specifies renderProfileIdentity "${profile.renderProfileIdentity.key}" but baseline.frames is missing`
      );
    }

    const modelHashes: Record<string, string> = Object.create(null);
    for (const model of models) {
      modelHashes[model.key] = model.sha256;
    }

    renderProfileProvenance = Object.freeze({
      key: profile.renderProfileIdentity.key,
      version: profile.renderProfileIdentity.version,
      engine: profile.engine,
      workflowHash: workflowSha256,
      modelHashes: Object.freeze(modelHashes),
      frames,
      steps: profile.baseline.steps,
      runnerProfile: profile.runnerProfile,
      measuredDiskFootprintGb: disk.modelFootprintGb,
      minFreeDiskGb: disk.minFreeDiskGb
    });
  }

  const report: CertificationProvenanceReport = Object.freeze({
    version: 1,
    profileId: profile.id,
    generatedAt: now().toISOString(),
    workflow: Object.freeze({
      relativePath: profile.workflowRelativePath,
      sha256: workflowSha256,
      source: profile.source
    }),
    models: Object.isFrozen(models) ? models : Object.freeze(models),
    git: Object.isFrozen(git) ? git : Object.freeze(git),
    disk: Object.isFrozen(disk) ? disk : Object.freeze(disk),
    renderProfileProvenance
  });

  return report;
}
