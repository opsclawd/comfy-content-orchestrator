import type { H3CandidateAuthorizationGrant, H3CandidateProfile } from "@cco/contracts";

export interface H3CandidateAuthorizationVerificationRequest {
  readonly grant: H3CandidateAuthorizationGrant;
  readonly candidateKey: string;
  readonly specificationDigest: string;
  readonly targetHostname: string;
  readonly targetGpuUuid: string;
  readonly purpose: "staging" | "production";
  readonly goldMasterWorkflowHash: string;
  readonly goldMasterModelHashesDigest: string;
}

export interface H3CandidateAuthorizationVerificationResult {
  readonly authorized: boolean;
  readonly scope?: "staging" | "production";
  readonly blocker?: string;
}

export interface H3CandidateAuthorizationPort {
  /**
   * Cryptographically verifies an operator authorization grant against the deployment trust store.
   *
   * Invariant:
   * Caller-supplied authorization claims or keys are never accepted.
   * The verifier must check detached signatures using operator-owned trust keys.
   */
  verifyCandidateAuthorization(
    request: H3CandidateAuthorizationVerificationRequest
  ): Promise<H3CandidateAuthorizationVerificationResult>;
}

export interface H3RuntimeObservationTarget {
  readonly hostname: string;
  readonly gpuUuid: string;
  readonly comfyUiEndpoint?: string;
  readonly comfyUiDir?: string;
  readonly pid?: number;
}

export interface H3ObservedRuntimeIdentity {
  readonly hostname: string;
  readonly gpuUuid: string;
  readonly pid: number;
  readonly processStartTimeTicks: number;
  readonly pythonExecutable: string;
  readonly comfyUiCoreRevision: string;
  readonly commandLineArgs: readonly string[];
  readonly customNodes: Readonly<Record<string, { revision: string; sourceHash: string }>>;
  readonly packageVersions: Readonly<Record<string, string>>;
  readonly observedAt: string;
}

export interface H3RuntimeObservationResult {
  readonly ok: boolean;
  readonly blocker?: string;
  readonly observation?: H3ObservedRuntimeIdentity;
}

export interface H3RuntimeObservationPort {
  /**
   * Observes the live runtime state of the execution host and target ComfyUI process.
   *
   * Invariant:
   * Must actually probe the live host and process (hostname, GPU UUID, PID, git revision, node hashes).
   * Missing tooling (e.g. nvidia-smi) or discrepancies fail closed.
   */
  observeCurrentRuntime(target: H3RuntimeObservationTarget): Promise<H3RuntimeObservationResult>;

  /**
   * Verifies that the process has not drifted, terminated, or restarted since observation began.
   */
  verifyProcessContinuity(
    pid: number,
    expectedStartTimeTicks: number
  ): Promise<{ readonly continuous: boolean; readonly blocker?: string }>;
}

export interface H3CandidateRegistryReader {
  getCandidateProfile(key: string | undefined): Readonly<H3CandidateProfile> | undefined;
  listCandidateProfiles(): readonly Readonly<H3CandidateProfile>[];
  isCandidateProfileKey?(key: string | undefined): boolean;
}
