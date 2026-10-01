import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type {
  AcceptanceProfileIdentityFinding,
  AcceptanceProfileIdentityProbePort,
  AcceptanceProfileIdentityProbeResult
} from "@cco/application";
import { hashWorkflow } from "../comfyui/provenance/hasher.js";
import { loadCertificationProfile } from "../comfyui/provenance/profile-manifest.js";

const DEFAULT_REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../");
const DEFAULT_MANIFEST_PATH = resolve(DEFAULT_REPO_ROOT, "templates/provenance.json");

/**
 * The two MiniMax-H3 profile IDs the acceptance campaign's representative scenes rely on
 * (`minimax-h3-720p-124f-ref2v` for reference_directed scenes, `minimax-h3-720p-124f-i2v`
 * for the single frame_anchored scene). Checked statically against `templates/provenance.json`
 * and the corresponding workflow JSON under `templates/` — no ComfyUI process is started.
 */
export const REQUIRED_ACCEPTANCE_PROFILE_IDS: readonly string[] = Object.freeze([
  "minimax-h3-720p-124f-ref2v",
  "minimax-h3-720p-124f-i2v"
]);

export interface FsProfileIdentityProbeOptions {
  readonly manifestPath?: string | undefined;
  readonly profileIds?: readonly string[] | undefined;
  readonly readWorkflowFile?: ((filePath: string) => Promise<string>) | undefined;
  readonly loadProfile?: typeof loadCertificationProfile | undefined;
}

/**
 * Read-only, GPU-free infrastructure adapter verifying that the MiniMax-H3 render
 * profiles the acceptance campaign depends on are present in `templates/provenance.json`
 * with the expected identity, and that their workflow JSON files hash to the manifest's
 * pinned `expectedWorkflowHash`. Reads only `templates/*`.
 */
export class FsProfileIdentityProbe implements AcceptanceProfileIdentityProbePort {
  private readonly manifestPath: string;
  private readonly profileIds: readonly string[];
  private readonly readWorkflowFile: (filePath: string) => Promise<string>;
  private readonly loadProfile: typeof loadCertificationProfile;

  constructor(options: FsProfileIdentityProbeOptions = {}) {
    this.manifestPath = options.manifestPath ?? DEFAULT_MANIFEST_PATH;
    this.profileIds = options.profileIds ?? REQUIRED_ACCEPTANCE_PROFILE_IDS;
    this.readWorkflowFile = options.readWorkflowFile ?? ((filePath) => readFile(filePath, "utf8"));
    this.loadProfile = options.loadProfile ?? loadCertificationProfile;
  }

  async probe(): Promise<AcceptanceProfileIdentityProbeResult> {
    const findings: AcceptanceProfileIdentityFinding[] = [];
    const errors: string[] = [];

    for (const profileId of this.profileIds) {
      try {
        const profile = await this.loadProfile(this.manifestPath, profileId);
        const workflowContent = await this.readWorkflowFile(profile.workflowPath);
        const actualWorkflowHash = hashWorkflow(workflowContent);
        const matches = actualWorkflowHash === profile.expectedWorkflowHash;

        findings.push({
          engine: profile.engine,
          renderProfileKey: profile.renderProfileIdentity?.key ?? "unknown",
          renderProfileVersion: profile.renderProfileIdentity?.version ?? 0,
          profileId: profile.id,
          workflowRelativePath: profile.workflowRelativePath,
          expectedWorkflowHash: profile.expectedWorkflowHash,
          actualWorkflowHash,
          matches
        });

        if (!matches) {
          errors.push(
            `Profile "${profileId}" workflow hash mismatch: expected ${profile.expectedWorkflowHash}, got ${actualWorkflowHash}`
          );
        }
      } catch (err) {
        errors.push(
          `Failed to verify profile "${profileId}": ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    return {
      ok: errors.length === 0 && findings.length === this.profileIds.length,
      findings,
      errors
    };
  }
}
