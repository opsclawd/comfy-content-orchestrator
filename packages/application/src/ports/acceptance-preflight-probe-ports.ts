/**
 * Read-only, GPU-free preflight probe ports for the H3 operator acceptance campaign
 * (issue #373). Every probe in this file answers a static or connectivity question —
 * none of them invoke ComfyUI, acquire a GPU lease, or dispatch render work.
 */

export interface AcceptanceProfileIdentityFinding {
  readonly engine: string;
  readonly renderProfileKey: string;
  readonly renderProfileVersion: number;
  readonly profileId: string;
  readonly workflowRelativePath: string;
  readonly expectedWorkflowHash: string;
  readonly actualWorkflowHash: string;
  readonly matches: boolean;
}

export interface AcceptanceProfileIdentityProbeResult {
  readonly ok: boolean;
  readonly findings: readonly AcceptanceProfileIdentityFinding[];
  readonly errors: readonly string[];
}

/**
 * Verifies, statically, that the MiniMax-H3 render-profile manifest entries
 * (`templates/provenance.json`) the acceptance campaign depends on declare the expected
 * identity and that their workflow files hash to the manifest's `expectedWorkflowHash`.
 * Reads only `templates/*`; never touches ComfyUI, GPU, or `config/render-profiles/`.
 */
export interface AcceptanceProfileIdentityProbePort {
  readonly probe: () => Promise<AcceptanceProfileIdentityProbeResult>;
}

export interface AcceptanceEvidenceTemplateFinding {
  readonly templatePath: string;
  readonly exists: boolean;
  /** True when the template contains only empty/sentinel placeholder values. */
  readonly isEmptySentinel: boolean;
  readonly issues: readonly string[];
}

export interface AcceptanceEvidenceTemplateProbeResult {
  readonly ok: boolean;
  readonly findings: readonly AcceptanceEvidenceTemplateFinding[];
}

/**
 * Verifies the two operator evidence templates exist on disk and contain only empty
 * `TBD-OPERATOR` sentinel values — guarding against an agent (or anyone else) having
 * fabricated or pre-filled acceptance evidence.
 */
export interface AcceptanceEvidenceTemplateProbePort {
  readonly probe: () => Promise<AcceptanceEvidenceTemplateProbeResult>;
}

export interface AcceptanceReadinessProbeResult {
  readonly ok: boolean;
  readonly detail?: string | undefined;
}

/** Read-only `SELECT 1`-style database reachability probe. No schema writes. */
export interface AcceptanceDatabaseReadinessProbePort {
  readonly probe: () => Promise<AcceptanceReadinessProbeResult>;
}

/** Read-only object-storage reachability probe (e.g. HeadBucket). No object writes. */
export interface AcceptanceObjectStorageReadinessProbePort {
  readonly probe: () => Promise<AcceptanceReadinessProbeResult>;
}

export interface AcceptanceCampaignLedgerProbeResult {
  /** True when the fixture is either not-yet-installed, or installed with no defects found. */
  readonly ok: boolean;
  /** Whether the fixture campaign (looked up by its pinned idempotency key) exists at all. */
  readonly installed: boolean;
  readonly sceneCount: number;
  readonly expectedSceneCount: number;
  /**
   * True when zero rows exist across the production ledgers (ShotPlan, StoryboardCandidate,
   * review events, campaign production runs) for the fixture's scenes — i.e. preparation
   * tooling has fabricated no ProductionAttempt, GenerationManifest, or certification result.
   */
  readonly fabricationFree: boolean;
  readonly detail?: string | undefined;
}

/**
 * Read-only probe that answers two of #373's GPU-free preflight requirements at once:
 * "campaign/scenes can be created idempotently" (by confirming the installed scene count
 * matches the fixture's declared scene count exactly — catching duplication) and "no fake
 * ProductionAttempt, GenerationManifest, certification result, or accepted output is
 * created" (by confirming the production ledgers are empty for the fixture's scenes).
 * Never writes to any table.
 */
export interface AcceptanceCampaignLedgerProbePort {
  readonly probe: () => Promise<AcceptanceCampaignLedgerProbeResult>;
}
