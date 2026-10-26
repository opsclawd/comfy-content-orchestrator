import { existsSync, readFileSync, statSync } from "node:fs";
import { computeH3ReleaseKey } from "@cco/contracts";
import type {
  DeploymentEnablementSnapshot,
  DeploymentEnablementStatePort,
  ProductionReleaseCapabilityReader,
  ReleasedProductionProfile
} from "@cco/application";

export interface JsonProductionReleaseBundle {
  readonly releasedProfiles: readonly ReleasedProductionProfile[];
  readonly deploymentEnablement?: DeploymentEnablementSnapshot | undefined;
}

export class JsonFileProductionReleaseReader implements ProductionReleaseCapabilityReader {
  private lastMtimeMs = 0;
  private cachedBundle: JsonProductionReleaseBundle | null = null;

  constructor(
    private readonly filePath?: string | undefined,
    private readonly enablementStatePort?: DeploymentEnablementStatePort | undefined
  ) {}

  private async loadBundle(): Promise<JsonProductionReleaseBundle> {
    if (!this.filePath || !existsSync(this.filePath)) {
      return { releasedProfiles: [] };
    }

    try {
      const stats = statSync(this.filePath);
      if (this.cachedBundle && stats.mtimeMs === this.lastMtimeMs) {
        return this.cachedBundle;
      }

      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);

      let rawProfiles: unknown[] = [];
      let enablement: DeploymentEnablementSnapshot | undefined;

      if (Array.isArray(parsed)) {
        rawProfiles = parsed;
      } else if (parsed && typeof parsed === "object") {
        const parsedObj = parsed as Record<string, unknown>;
        if (Array.isArray(parsedObj.releasedProfiles)) {
          rawProfiles = parsedObj.releasedProfiles;
        }
        if (parsedObj.deploymentEnablement && typeof parsedObj.deploymentEnablement === "object") {
          enablement = parsedObj.deploymentEnablement as DeploymentEnablementSnapshot;
        }
      }

      if (enablement && this.enablementStatePort) {
        const current = await this.enablementStatePort.getCurrentState(enablement.deploymentId);
        if (current) {
          if (current.generation > enablement.generation) {
            throw new Error(
              `Deployment enablement rollback detected: recorded generation ${current.generation} > bundle generation ${enablement.generation}`
            );
          }
          if (
            current.generation === enablement.generation &&
            current.digest !== enablement.digest
          ) {
            throw new Error(
              `Deployment enablement conflict detected: recorded digest ${current.digest} !== bundle digest ${enablement.digest} at generation ${enablement.generation}`
            );
          }
          if (current.generation < enablement.generation) {
            await this.enablementStatePort.recordAcceptedState(
              enablement.deploymentId,
              enablement.generation,
              enablement.digest
            );
          }
        } else {
          await this.enablementStatePort.recordAcceptedState(
            enablement.deploymentId,
            enablement.generation,
            enablement.digest
          );
        }
      }

      // Filter and validate released profiles strictly
      const releasedProfiles: ReleasedProductionProfile[] = [];
      if (!enablement) {
        const result: JsonProductionReleaseBundle = {
          releasedProfiles: []
        };
        this.cachedBundle = result;
        this.lastMtimeMs = stats.mtimeMs;
        return result;
      }

      for (const rawItem of rawProfiles) {
        if (!rawItem || typeof rawItem !== "object") continue;
        const p = rawItem as ReleasedProductionProfile;
        if (!p.key || typeof p.key !== "string") continue;
        if (!p.specificationDigest || typeof p.specificationDigest !== "string") continue;
        if (!p.specification || typeof p.specification !== "object") continue;
        if (!p.topology || typeof p.topology !== "object") continue;
        if (!p.releaseId || typeof p.releaseId !== "string") continue;
        if (!p.signedReleaseDigest || typeof p.signedReleaseDigest !== "string") continue;
        if (!p.certificationRecordDigest || typeof p.certificationRecordDigest !== "string")
          continue;
        if (!p.deploymentEnablementDigest || typeof p.deploymentEnablementDigest !== "string")
          continue;

        // Check enablement.digest matches p.deploymentEnablementDigest
        if (p.deploymentEnablementDigest !== enablement.digest) {
          continue;
        }

        // Verify key format matches specificationDigest and version
        try {
          const expectedKey = computeH3ReleaseKey(p.specificationDigest, p.version ?? 1);
          if (p.key !== expectedKey) {
            continue;
          }
        } catch {
          continue;
        }

        // #445 speed decision must pass
        if (p.speedDecision?.overallVerdict !== "pass") {
          continue;
        }

        // #428 certification verdict must pass or released
        if (p.certificationVerdict !== "pass" && p.certificationVerdict !== "released") {
          continue;
        }

        // Deployment enablement checks
        if (enablement.disabledIdentities?.includes(p.key)) {
          continue;
        }
        const digests = enablement.enabledRecordDigests ?? [];
        const isEnabled =
          digests.includes(p.certificationRecordDigest) ||
          digests.includes(p.specificationDigest) ||
          digests.includes(p.signedReleaseDigest) ||
          digests.includes(p.key);
        if (!isEnabled) {
          continue;
        }

        releasedProfiles.push(p);
      }

      const result: JsonProductionReleaseBundle = {
        releasedProfiles,
        ...(enablement ? { deploymentEnablement: enablement } : {})
      };
      this.cachedBundle = result;
      this.lastMtimeMs = stats.mtimeMs;
      return result;
    } catch (err: unknown) {
      this.cachedBundle = null;
      this.lastMtimeMs = 0;
      throw err;
    }
  }

  async listReleasedProfiles(): Promise<readonly ReleasedProductionProfile[]> {
    const bundle = await this.loadBundle();
    return bundle.releasedProfiles;
  }

  async getReleasedProfile(profileKey: string): Promise<ReleasedProductionProfile | undefined> {
    const bundle = await this.loadBundle();
    return bundle.releasedProfiles.find((p) => p.key === profileKey);
  }

  async isReleasedProfileKey(key: string): Promise<boolean> {
    const profile = await this.getReleasedProfile(key);
    return profile !== undefined;
  }

  async getDeploymentEnablementState(): Promise<DeploymentEnablementSnapshot | undefined> {
    const bundle = await this.loadBundle();
    return bundle.deploymentEnablement;
  }
}
