import type {
  H3CandidateExecutionSpecification,
  H3CapabilityDecisionRow,
  ProfileInjectionTopology
} from "@cco/contracts";

export interface ReleasedProductionProfile {
  readonly key: string;
  readonly version: number;
  readonly specificationDigest: string;
  readonly specification: H3CandidateExecutionSpecification;
  readonly topology: ProfileInjectionTopology;
  readonly releaseId: string;
  readonly signedReleaseDigest: string;
  readonly certificationRecordDigest: string;
  readonly deploymentEnablementDigest: string;
  readonly speedDecision: H3CapabilityDecisionRow;
  readonly certificationVerdict: "pass" | "released";
  readonly operatorIdentity: string;
  readonly releasedAt: string;
}

export interface DeploymentEnablementSnapshot {
  readonly deploymentId: string;
  readonly generation: number;
  readonly digest: string;
  readonly signedBy: string;
  readonly signedAt: string;
  readonly enabledRecordDigests: readonly string[];
  readonly disabledIdentities: readonly string[];
}

export interface ProductionReleaseCapabilityReader {
  listReleasedProfiles(): Promise<readonly ReleasedProductionProfile[]>;
  getReleasedProfile(profileKey: string): Promise<ReleasedProductionProfile | undefined>;
  isReleasedProfileKey(key: string): Promise<boolean>;
  getDeploymentEnablementState(): Promise<DeploymentEnablementSnapshot | undefined>;
}

export interface DeploymentEnablementStatePort {
  getCurrentState(
    deploymentId: string
  ): Promise<{ generation: number; digest: string } | undefined>;
  recordAcceptedState(deploymentId: string, generation: number, digest: string): Promise<void>;
}
