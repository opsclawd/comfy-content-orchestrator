import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCertificationProfile } from "./profile-manifest.js";

describe("Certification Profile Manifest", () => {
  let tempDir: string;
  let manifestPath: string;

  interface ManifestProfileFixture {
    id: string;
    engine: string;
    workflowRelativePath: string;
    expectedWorkflowHash: string;
    source: {
      kind: string;
      uri: string;
      revision: string;
      license: string;
    };
    baseline: {
      width?: number;
      height?: number;
      frames?: number;
      steps: number;
      approximateDurationSeconds?: number;
    };
    minFreeDiskGb: number;
    runnerProfile: string;
    models: Array<{
      category: string;
      relativePath: string;
    }>;
    assertions: Array<{
      nodeId: string;
      classType: string;
      input: string;
      equals: string | number | boolean;
    }>;
    renderProfileIdentity: {
      key: string;
      version: number;
    } | null;
  }

  interface ManifestFixture {
    version: number;
    profiles: ManifestProfileFixture[];
  }

  const createValidManifest = (): ManifestFixture => ({
    version: 1,
    profiles: [
      {
        id: "ltx_25_720p_97f",
        engine: "comfyui",
        workflowRelativePath: "ltx_25_720p_97f_api.json",
        expectedWorkflowHash: "a".repeat(64),
        source: {
          kind: "official_upstream",
          uri: "https://github.com/Comfy-Org/ComfyUI_examples/tree/master/ltx_video",
          revision: "main",
          license: "Apache-2.0"
        },
        baseline: {
          width: 1280,
          height: 720,
          frames: 97,
          steps: 8,
          approximateDurationSeconds: 5
        },
        minFreeDiskGb: 100,
        runnerProfile: "cuda_default",
        models: [
          {
            category: "diffusion_models",
            relativePath: "ltx-video-2b-v0.9.1.safetensors"
          }
        ],
        assertions: [
          {
            nodeId: "6",
            classType: "CLIPTextEncode",
            input: "text",
            equals: "prompt text"
          }
        ],
        renderProfileIdentity: {
          key: "LTX_25_720P_5S_V1",
          version: 1
        }
      },
      {
        id: "flux_schnell_draft",
        engine: "comfyui",
        workflowRelativePath: "flux_schnell_draft_api.json",
        expectedWorkflowHash: "b".repeat(64),
        source: {
          kind: "validated_host_export",
          uri: "file:///opt/comfyui/workflows/flux_schnell.json",
          revision: "host-export-v1",
          license: "Apache-2.0"
        },
        baseline: {
          steps: 4
        },
        minFreeDiskGb: 0,
        runnerProfile: "cuda_default",
        models: [
          {
            category: "checkpoints",
            relativePath: "flux1-schnell.safetensors"
          }
        ],
        assertions: [
          {
            nodeId: "1",
            classType: "KSampler",
            input: "steps",
            equals: 4
          }
        ],
        renderProfileIdentity: null
      }
    ]
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "profile-manifest-test-"));
    manifestPath = join(tempDir, "provenance.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("manifest loading returns the selected profile with a contained workflow path", async () => {
    const manifest = createValidManifest();
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    const ltxProfile = await loadCertificationProfile(manifestPath, "ltx_25_720p_97f");

    expect(ltxProfile.id).toBe("ltx_25_720p_97f");
    expect(ltxProfile.engine).toBe("comfyui");
    expect(ltxProfile.workflowRelativePath).toBe("ltx_25_720p_97f_api.json");
    expect(ltxProfile.workflowPath).toBe(join(tempDir, "ltx_25_720p_97f_api.json"));
    expect(ltxProfile.expectedWorkflowHash).toBe("a".repeat(64));
    expect(ltxProfile.source).toEqual({
      kind: "official_upstream",
      uri: "https://github.com/Comfy-Org/ComfyUI_examples/tree/master/ltx_video",
      revision: "main",
      license: "Apache-2.0"
    });
    expect(ltxProfile.baseline).toEqual({
      width: 1280,
      height: 720,
      frames: 97,
      steps: 8,
      approximateDurationSeconds: 5
    });
    expect(ltxProfile.minFreeDiskGb).toBe(100);
    expect(ltxProfile.runnerProfile).toBe("cuda_default");
    expect(ltxProfile.models).toEqual([
      {
        category: "diffusion_models",
        relativePath: "ltx-video-2b-v0.9.1.safetensors"
      }
    ]);
    expect(ltxProfile.assertions).toEqual([
      {
        nodeId: "6",
        classType: "CLIPTextEncode",
        input: "text",
        equals: "prompt text"
      }
    ]);
    expect(ltxProfile.renderProfileIdentity).toEqual({
      key: "LTX_25_720P_5S_V1",
      version: 1
    });

    // Deep freeze verification
    expect(Object.isFrozen(ltxProfile)).toBe(true);
    expect(Object.isFrozen(ltxProfile.source)).toBe(true);
    expect(Object.isFrozen(ltxProfile.baseline)).toBe(true);
    expect(Object.isFrozen(ltxProfile.models)).toBe(true);
    expect(Object.isFrozen(ltxProfile.models[0])).toBe(true);
    expect(Object.isFrozen(ltxProfile.assertions)).toBe(true);
    expect(Object.isFrozen(ltxProfile.assertions[0])).toBe(true);
    expect(Object.isFrozen(ltxProfile.renderProfileIdentity)).toBe(true);

    // FLUX profile with validated_host_export and null renderProfileIdentity
    const fluxProfile = await loadCertificationProfile(manifestPath, "flux_schnell_draft");
    expect(fluxProfile.id).toBe("flux_schnell_draft");
    expect(fluxProfile.workflowPath).toBe(join(tempDir, "flux_schnell_draft_api.json"));
    expect(fluxProfile.source.kind).toBe("validated_host_export");
    expect(fluxProfile.renderProfileIdentity).toBeNull();
    expect(fluxProfile.minFreeDiskGb).toBe(0);
    expect(Object.isFrozen(fluxProfile)).toBe(true);
  });

  it("manifest loading rejects duplicate profile and model identities", async () => {
    // Duplicate profile ID
    const duplicateProfileManifest = createValidManifest();
    const firstProfile = duplicateProfileManifest.profiles[0]!;
    duplicateProfileManifest.profiles.push({
      ...firstProfile
    });
    await writeFile(manifestPath, JSON.stringify(duplicateProfileManifest, null, 2));

    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /duplicate profile id/i
    );

    // Duplicate model in same profile
    const duplicateModelManifest = createValidManifest();
    duplicateModelManifest.profiles[0]!.models.push({
      category: "diffusion_models",
      relativePath: "ltx-video-2b-v0.9.1.safetensors"
    });
    await writeFile(manifestPath, JSON.stringify(duplicateModelManifest, null, 2));

    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /duplicate model/i
    );
  });

  it("manifest loading rejects malformed hashes and incomplete source provenance", async () => {
    // Uppercase hash
    const uppercaseHashManifest = createValidManifest();
    uppercaseHashManifest.profiles[0]!.expectedWorkflowHash = "A".repeat(64);
    await writeFile(manifestPath, JSON.stringify(uppercaseHashManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /expectedWorkflowHash/i
    );

    // Hash with invalid length
    const shortHashManifest = createValidManifest();
    shortHashManifest.profiles[0]!.expectedWorkflowHash = "abcd1234";
    await writeFile(manifestPath, JSON.stringify(shortHashManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /expectedWorkflowHash/i
    );

    // Missing / empty source URI
    const emptyUriManifest = createValidManifest();
    emptyUriManifest.profiles[0]!.source.uri = "   ";
    await writeFile(manifestPath, JSON.stringify(emptyUriManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /source\.uri/i
    );

    // Missing / empty source revision
    const emptyRevisionManifest = createValidManifest();
    emptyRevisionManifest.profiles[0]!.source.revision = "";
    await writeFile(manifestPath, JSON.stringify(emptyRevisionManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /source\.revision/i
    );

    // Missing / empty source license
    const emptyLicenseManifest = createValidManifest();
    emptyLicenseManifest.profiles[0]!.source.license = "";
    await writeFile(manifestPath, JSON.stringify(emptyLicenseManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /source\.license/i
    );

    // Invalid source kind
    const invalidKindManifest = createValidManifest();
    invalidKindManifest.profiles[0]!.source.kind = "unsupported_source_kind";
    await writeFile(manifestPath, JSON.stringify(invalidKindManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /source\.kind/i
    );
  });

  it("manifest loading rejects workflow paths outside the manifest directory", async () => {
    // Parent traversal
    const parentTraversalManifest = createValidManifest();
    parentTraversalManifest.profiles[0]!.workflowRelativePath = "../escape.json";
    await writeFile(manifestPath, JSON.stringify(parentTraversalManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /workflow.*escape|outside/i
    );

    // Absolute path
    const absolutePathManifest = createValidManifest();
    absolutePathManifest.profiles[0]!.workflowRelativePath = "/tmp/escape.json";
    await writeFile(manifestPath, JSON.stringify(absolutePathManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /absolute.*workflow|outside|escape/i
    );

    // Subfolder parent traversal escape
    const nestedEscapeManifest = createValidManifest();
    nestedEscapeManifest.profiles[0]!.workflowRelativePath = "sub/../../escape.json";
    await writeFile(manifestPath, JSON.stringify(nestedEscapeManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /workflow.*escape|outside|traversal/i
    );

    // Empty workflow relative path
    const emptyWorkflowManifest = createValidManifest();
    emptyWorkflowManifest.profiles[0]!.workflowRelativePath = "";
    await writeFile(manifestPath, JSON.stringify(emptyWorkflowManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /workflowRelativePath/i
    );
  });

  it("manifest loading rejects unknown model categories and invalid LTX identity literals", async () => {
    // Unknown model category
    const unknownCategoryManifest = createValidManifest();
    unknownCategoryManifest.profiles[0]!.models[0]!.category = "invalid_category";
    await writeFile(manifestPath, JSON.stringify(unknownCategoryManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /category/i
    );

    // Invalid renderProfileIdentity key
    const invalidRenderKeyManifest = createValidManifest();
    invalidRenderKeyManifest.profiles[0]!.renderProfileIdentity = {
      key: "UNKNOWN_PROFILE_KEY",
      version: 1
    };
    await writeFile(manifestPath, JSON.stringify(invalidRenderKeyManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /renderProfileIdentity/i
    );

    // Invalid renderProfileIdentity version
    const invalidRenderVersionManifest = createValidManifest();
    invalidRenderVersionManifest.profiles[0]!.renderProfileIdentity = {
      key: "LTX_25_720P_5S_V1",
      version: 2
    };
    await writeFile(manifestPath, JSON.stringify(invalidRenderVersionManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /renderProfileIdentity/i
    );
  });

  it("manifest loading reports an unknown profile id with available ids", async () => {
    const manifest = createValidManifest();
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    await expect(
      loadCertificationProfile(manifestPath, "non_existent_profile")
    ).rejects.toThrowError(/non_existent_profile.*ltx_25_720p_97f.*flux_schnell_draft/s);
  });
});
