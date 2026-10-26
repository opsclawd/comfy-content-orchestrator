import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  computeH3ReleaseKey,
  MINIMAX_H3_720P_5S_I2V_V1_INJECTION_TOPOLOGY,
  type H3CandidateExecutionSpecification
} from "@cco/contracts";
import type {
  DeploymentEnablementSnapshot,
  DeploymentEnablementStatePort,
  ReleasedProductionProfile
} from "@cco/application";
import { JsonFileProductionReleaseReader } from "./json-file-production-release-reader.js";

class InMemoryDeploymentEnablementStatePort implements DeploymentEnablementStatePort {
  readonly state = new Map<string, { generation: number; digest: string }>();

  async getCurrentState(
    deploymentId: string
  ): Promise<{ generation: number; digest: string } | undefined> {
    return this.state.get(deploymentId);
  }

  async recordAcceptedState(
    deploymentId: string,
    generation: number,
    digest: string
  ): Promise<void> {
    this.state.set(deploymentId, { generation, digest });
  }
}

describe("JsonFileProductionReleaseReader", () => {
  let tempDir: string;
  let bundlePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "release-reader-test-"));
    bundlePath = join(tempDir, "production-releases.json");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  const validSpecDigest = "a".repeat(64);
  const validKey = computeH3ReleaseKey(validSpecDigest, 1);
  const validEnablementDigest = "b".repeat(64);
  const validCertDigest = "c".repeat(64);
  const validSignedReleaseDigest = "d".repeat(64);

  function createValidSpec(
    overrides: Partial<H3CandidateExecutionSpecification> = {}
  ): H3CandidateExecutionSpecification {
    return {
      version: 1,
      route: "i2v",
      routingMode: "frame_anchored",
      width: 1344,
      height: 768,
      fps: 24,
      frames: 124,
      workflowHash: "e".repeat(64),
      modelHashes: {
        checkpoint: "f".repeat(64),
        clip: "1".repeat(64),
        audioVae: "2".repeat(64),
        videoVae: "3".repeat(64),
        turboLora: "none",
        additionalModels: {}
      },
      sampler: "euler",
      scheduler: "simple",
      steps: 20,
      cfg: 1.0,
      denoise: 1.0,
      attention: {
        backend: "sage_attn",
        customNodeRevision: "v1.0.0",
        customNodeSourceHash: "1".repeat(64),
        packageVersion: "0.2.1",
        sparsitySettings: {
          enabled: false,
          method: "none",
          threshold: 0
        }
      },
      runnerSettings: {
        runnerProfile: "dynamicvram-offload-v1",
        offloadPolicy: "dynamicvram",
        requiresModelOffloading: true,
        maxConcurrentGpuJobs: 1,
        minFreeDiskGb: 50
      },
      customNodes: [
        {
          name: "comfyui-sageattention",
          revision: "git-commit-abc123",
          sourceHash: "2".repeat(64)
        }
      ],
      packageVersions: {
        torch: "2.5.1+cu124",
        sageattention: "0.2.1"
      },
      ...overrides
    };
  }

  function createValidProfile(
    overrides: Partial<ReleasedProductionProfile> = {}
  ): ReleasedProductionProfile {
    const spec = createValidSpec();
    return {
      key: validKey,
      version: 1,
      specificationDigest: validSpecDigest,
      specification: spec,
      topology: MINIMAX_H3_720P_5S_I2V_V1_INJECTION_TOPOLOGY,
      releaseId: "rel-001",
      signedReleaseDigest: validSignedReleaseDigest,
      certificationRecordDigest: validCertDigest,
      deploymentEnablementDigest: validEnablementDigest,
      speedDecision: {
        specification: spec,
        specificationDigest: validSpecDigest,
        speedVerdict: "pass",
        qualityVerdict: "pass",
        overallVerdict: "pass",
        evidenceDigests: ["1".repeat(64)],
        operatorIdentity: "operator@example.com",
        decidedAt: "2026-09-01T00:00:00.000Z"
      },
      certificationVerdict: "pass",
      operatorIdentity: "operator@example.com",
      releasedAt: "2026-09-01T00:00:00.000Z",
      ...overrides
    };
  }

  function createValidEnablement(
    overrides: Partial<DeploymentEnablementSnapshot> = {}
  ): DeploymentEnablementSnapshot {
    return {
      deploymentId: "dep-prod-1",
      generation: 1,
      digest: validEnablementDigest,
      signedBy: "admin@example.com",
      signedAt: "2026-09-01T00:00:00.000Z",
      enabledRecordDigests: [validCertDigest],
      disabledIdentities: [],
      ...overrides
    };
  }

  it("returns empty list when file path is undefined or does not exist", async () => {
    const readerNoPath = new JsonFileProductionReleaseReader(undefined);
    expect(await readerNoPath.listReleasedProfiles()).toEqual([]);
    expect(await readerNoPath.getReleasedProfile("any")).toBeUndefined();
    expect(await readerNoPath.isReleasedProfileKey("any")).toBe(false);
    expect(await readerNoPath.getDeploymentEnablementState()).toBeUndefined();

    const readerMissingFile = new JsonFileProductionReleaseReader(
      join(tempDir, "nonexistent.json")
    );
    expect(await readerMissingFile.listReleasedProfiles()).toEqual([]);
  });

  it("returns empty profiles when bundle lacks deploymentEnablement snapshot", async () => {
    const rawData = {
      releasedProfiles: [createValidProfile()]
    };
    writeFileSync(bundlePath, JSON.stringify(rawData, null, 2), "utf-8");

    const reader = new JsonFileProductionReleaseReader(bundlePath);
    const profiles = await reader.listReleasedProfiles();
    expect(profiles).toEqual([]);
    expect(await reader.getDeploymentEnablementState()).toBeUndefined();
  });

  it("throws when rollback is detected (recorded generation > bundle generation)", async () => {
    const statePort = new InMemoryDeploymentEnablementStatePort();
    await statePort.recordAcceptedState("dep-prod-1", 5, "some-digest");

    const bundle = {
      deploymentEnablement: createValidEnablement({ generation: 4 }),
      releasedProfiles: [createValidProfile()]
    };
    writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), "utf-8");

    const reader = new JsonFileProductionReleaseReader(bundlePath, statePort);
    await expect(reader.listReleasedProfiles()).rejects.toThrow(
      /Deployment enablement rollback detected: recorded generation 5 > bundle generation 4/
    );
  });

  it("throws when conflict is detected (same generation but different digest)", async () => {
    const statePort = new InMemoryDeploymentEnablementStatePort();
    await statePort.recordAcceptedState("dep-prod-1", 2, "recorded-digest");

    const bundle = {
      deploymentEnablement: createValidEnablement({ generation: 2, digest: "different-digest" }),
      releasedProfiles: []
    };
    writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), "utf-8");

    const reader = new JsonFileProductionReleaseReader(bundlePath, statePort);
    await expect(reader.listReleasedProfiles()).rejects.toThrow(
      /Deployment enablement conflict detected: recorded digest recorded-digest !== bundle digest different-digest at generation 2/
    );
  });

  it("records accepted state when generation advances", async () => {
    const statePort = new InMemoryDeploymentEnablementStatePort();
    await statePort.recordAcceptedState("dep-prod-1", 1, "old-digest");

    const bundle = {
      deploymentEnablement: createValidEnablement({ generation: 2, digest: validEnablementDigest }),
      releasedProfiles: [createValidProfile()]
    };
    writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), "utf-8");

    const reader = new JsonFileProductionReleaseReader(bundlePath, statePort);
    const profiles = await reader.listReleasedProfiles();
    expect(profiles).toHaveLength(1);
    expect(statePort.state.get("dep-prod-1")).toEqual({
      generation: 2,
      digest: validEnablementDigest
    });
  });

  it("filters out profile when deploymentEnablementDigest does not match enablement.digest", async () => {
    const bundle = {
      deploymentEnablement: createValidEnablement(),
      releasedProfiles: [createValidProfile({ deploymentEnablementDigest: "mismatched-digest" })]
    };
    writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), "utf-8");

    const reader = new JsonFileProductionReleaseReader(bundlePath);
    expect(await reader.listReleasedProfiles()).toEqual([]);
  });

  it("filters out profile when key does not match computed specificationDigest release key", async () => {
    const bundle = {
      deploymentEnablement: createValidEnablement(),
      releasedProfiles: [
        createValidProfile({
          key: "H3_RELEASE_0000000000000000000000000000000000000000000000000000000000000000_V1"
        })
      ]
    };
    writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), "utf-8");

    const reader = new JsonFileProductionReleaseReader(bundlePath);
    expect(await reader.listReleasedProfiles()).toEqual([]);
  });

  it("filters out profile when speedDecision overallVerdict is not pass", async () => {
    const spec = createValidSpec();
    const bundle = {
      deploymentEnablement: createValidEnablement(),
      releasedProfiles: [
        createValidProfile({
          speedDecision: {
            specification: spec,
            specificationDigest: validSpecDigest,
            speedVerdict: "fail",
            qualityVerdict: "pass",
            overallVerdict: "fail",
            evidenceDigests: ["1".repeat(64)],
            operatorIdentity: "operator@example.com",
            decidedAt: "2026-09-01T00:00:00.000Z"
          }
        })
      ]
    };
    writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), "utf-8");

    const reader = new JsonFileProductionReleaseReader(bundlePath);
    expect(await reader.listReleasedProfiles()).toEqual([]);
  });

  it("filters out profile when certificationVerdict is neither pass nor released", async () => {
    const bundle = {
      deploymentEnablement: createValidEnablement(),
      releasedProfiles: [
        createValidProfile({ certificationVerdict: "rejected" as unknown as "pass" })
      ]
    };
    writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), "utf-8");

    const reader = new JsonFileProductionReleaseReader(bundlePath);
    expect(await reader.listReleasedProfiles()).toEqual([]);
  });

  it("filters out profile when profile key is listed in disabledIdentities", async () => {
    const bundle = {
      deploymentEnablement: createValidEnablement({ disabledIdentities: [validKey] }),
      releasedProfiles: [createValidProfile()]
    };
    writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), "utf-8");

    const reader = new JsonFileProductionReleaseReader(bundlePath);
    expect(await reader.listReleasedProfiles()).toEqual([]);
  });

  it("filters out profile when none of its digests are in enabledRecordDigests", async () => {
    const bundle = {
      deploymentEnablement: createValidEnablement({ enabledRecordDigests: ["unrelated-digest"] }),
      releasedProfiles: [createValidProfile()]
    };
    writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), "utf-8");

    const reader = new JsonFileProductionReleaseReader(bundlePath);
    expect(await reader.listReleasedProfiles()).toEqual([]);
  });

  it("successfully admits valid profile and provides lookup methods", async () => {
    const profile = createValidProfile();
    const bundle = {
      deploymentEnablement: createValidEnablement(),
      releasedProfiles: [profile]
    };
    writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), "utf-8");

    const reader = new JsonFileProductionReleaseReader(bundlePath);
    const profiles = await reader.listReleasedProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.key).toBe(validKey);

    expect(await reader.isReleasedProfileKey(validKey)).toBe(true);
    expect(await reader.isReleasedProfileKey("nonexistent")).toBe(false);

    const found = await reader.getReleasedProfile(validKey);
    expect(found).toBeDefined();
    expect(found!.releaseId).toBe("rel-001");

    const enablement = await reader.getDeploymentEnablementState();
    expect(enablement).toBeDefined();
    expect(enablement!.deploymentId).toBe("dep-prod-1");
  });

  it("caches parsed result if mtime has not changed, and reloads if file is modified", async () => {
    const profile = createValidProfile();
    const bundle = {
      deploymentEnablement: createValidEnablement(),
      releasedProfiles: [profile]
    };
    writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), "utf-8");

    const reader = new JsonFileProductionReleaseReader(bundlePath);
    const firstRead = await reader.listReleasedProfiles();
    expect(firstRead).toHaveLength(1);

    // Write updated content with newer mtime
    const updatedBundle = {
      deploymentEnablement: createValidEnablement({ enabledRecordDigests: [] }),
      releasedProfiles: [profile]
    };
    // Ensure mtime changes even on fast filesystems
    writeFileSync(bundlePath, JSON.stringify(updatedBundle, null, 2), "utf-8");
    const futureTime = Date.now() / 1000 + 10;
    utimesSync(bundlePath, futureTime, futureTime);

    const secondRead = await reader.listReleasedProfiles();
    expect(secondRead).toHaveLength(0); // enabledRecordDigests is empty, so profile filtered out
  });

  it("fails closed on corrupt file and resets cache", async () => {
    writeFileSync(bundlePath, "not valid json {", "utf-8");
    const reader = new JsonFileProductionReleaseReader(bundlePath);

    await expect(reader.listReleasedProfiles()).rejects.toThrow();
  });
});
