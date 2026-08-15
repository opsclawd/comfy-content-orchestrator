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

  it("manifest loading rejects directory traversal and absolute paths in model relativePath", async () => {
    // Absolute path
    const absPathManifest = createValidManifest();
    absPathManifest.profiles[0]!.models[0]!.relativePath = "/opt/models/model.safetensors";
    await writeFile(manifestPath, JSON.stringify(absPathManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /absolute.*model|permitted/i
    );

    // Parent traversal
    const traversalManifest = createValidManifest();
    traversalManifest.profiles[0]!.models[0]!.relativePath = "../model.safetensors";
    await writeFile(manifestPath, JSON.stringify(traversalManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /parent traversal|permitted/i
    );

    // Subdirectory escape traversal
    const nestedTraversalManifest = createValidManifest();
    nestedTraversalManifest.profiles[0]!.models[0]!.relativePath = "sub/../../model.safetensors";
    await writeFile(manifestPath, JSON.stringify(nestedTraversalManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /parent traversal|permitted/i
    );

    // Empty model relativePath
    const emptyPathManifest = createValidManifest();
    emptyPathManifest.profiles[0]!.models[0]!.relativePath = "";
    await writeFile(manifestPath, JSON.stringify(emptyPathManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /relativePath must be a non-empty string/i
    );

    // Empty models array
    const emptyModelsManifest = createValidManifest();
    (emptyModelsManifest.profiles[0] as unknown as Record<string, unknown>).models = [];
    await writeFile(manifestPath, JSON.stringify(emptyModelsManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /models must be a non-empty array/i
    );

    // Non-object model entry
    const nonObjectModelManifest = createValidManifest();
    (nonObjectModelManifest.profiles[0] as unknown as Record<string, unknown>).models = ["invalid"];
    await writeFile(manifestPath, JSON.stringify(nonObjectModelManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /models\[0\] must be an object/i
    );
  });

  it("manifest loading rejects malformed baseline properties", async () => {
    // Non-object baseline
    const nonObjectBaselineManifest = createValidManifest();
    (nonObjectBaselineManifest.profiles[0] as unknown as Record<string, unknown>).baseline =
      "invalid";
    await writeFile(manifestPath, JSON.stringify(nonObjectBaselineManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /baseline must be an object/i
    );

    // Non-integer steps
    const floatStepsManifest = createValidManifest();
    floatStepsManifest.profiles[0]!.baseline.steps = 8.5;
    await writeFile(manifestPath, JSON.stringify(floatStepsManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /baseline\.steps must be a positive integer/i
    );

    // Negative steps
    const negativeStepsManifest = createValidManifest();
    negativeStepsManifest.profiles[0]!.baseline.steps = -1;
    await writeFile(manifestPath, JSON.stringify(negativeStepsManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /baseline\.steps must be a positive integer/i
    );

    // Zero steps
    const zeroStepsManifest = createValidManifest();
    zeroStepsManifest.profiles[0]!.baseline.steps = 0;
    await writeFile(manifestPath, JSON.stringify(zeroStepsManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /baseline\.steps must be a positive integer/i
    );

    // Non-integer width
    const floatWidthManifest = createValidManifest();
    floatWidthManifest.profiles[0]!.baseline.width = 1280.5;
    await writeFile(manifestPath, JSON.stringify(floatWidthManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /baseline\.width must be a positive integer/i
    );

    // Negative width
    const negWidthManifest = createValidManifest();
    negWidthManifest.profiles[0]!.baseline.width = -100;
    await writeFile(manifestPath, JSON.stringify(negWidthManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /baseline\.width must be a positive integer/i
    );

    // Non-integer height
    const floatHeightManifest = createValidManifest();
    floatHeightManifest.profiles[0]!.baseline.height = 720.5;
    await writeFile(manifestPath, JSON.stringify(floatHeightManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /baseline\.height must be a positive integer/i
    );

    // Negative height
    const negHeightManifest = createValidManifest();
    negHeightManifest.profiles[0]!.baseline.height = -720;
    await writeFile(manifestPath, JSON.stringify(negHeightManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /baseline\.height must be a positive integer/i
    );

    // Non-integer frames
    const floatFramesManifest = createValidManifest();
    floatFramesManifest.profiles[0]!.baseline.frames = 97.5;
    await writeFile(manifestPath, JSON.stringify(floatFramesManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /baseline\.frames must be a positive integer/i
    );

    // Negative frames
    const negFramesManifest = createValidManifest();
    negFramesManifest.profiles[0]!.baseline.frames = -10;
    await writeFile(manifestPath, JSON.stringify(negFramesManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /baseline\.frames must be a positive integer/i
    );

    // Negative approximateDurationSeconds
    const negDurationManifest = createValidManifest();
    negDurationManifest.profiles[0]!.baseline.approximateDurationSeconds = -5;
    await writeFile(manifestPath, JSON.stringify(negDurationManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /baseline\.approximateDurationSeconds must be a positive finite number/i
    );

    // Zero approximateDurationSeconds
    const zeroDurationManifest = createValidManifest();
    zeroDurationManifest.profiles[0]!.baseline.approximateDurationSeconds = 0;
    await writeFile(manifestPath, JSON.stringify(zeroDurationManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /baseline\.approximateDurationSeconds must be a positive finite number/i
    );

    // NaN / Infinity approximateDurationSeconds
    const nonFiniteDurationManifest = createValidManifest();
    (
      nonFiniteDurationManifest.profiles[0]!.baseline as unknown as Record<string, unknown>
    ).approximateDurationSeconds = "infinite";
    await writeFile(manifestPath, JSON.stringify(nonFiniteDurationManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /baseline\.approximateDurationSeconds must be a positive finite number/i
    );
  });

  it("manifest loading rejects malformed assertions", async () => {
    // Non-array assertions
    const nonArrayAssertionsManifest = createValidManifest();
    (nonArrayAssertionsManifest.profiles[0] as unknown as Record<string, unknown>).assertions =
      "invalid";
    await writeFile(manifestPath, JSON.stringify(nonArrayAssertionsManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /assertions must be a non-empty array/i
    );

    // Empty assertions array
    const emptyAssertionsManifest = createValidManifest();
    (emptyAssertionsManifest.profiles[0] as unknown as Record<string, unknown>).assertions = [];
    await writeFile(manifestPath, JSON.stringify(emptyAssertionsManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /assertions must be a non-empty array/i
    );

    // Non-object assertion entry
    const nonObjectEntryManifest = createValidManifest();
    (nonObjectEntryManifest.profiles[0] as unknown as Record<string, unknown>).assertions = [
      "invalid"
    ];
    await writeFile(manifestPath, JSON.stringify(nonObjectEntryManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /assertions\[0\] must be an object/i
    );

    // Empty nodeId
    const emptyNodeIdManifest = createValidManifest();
    emptyNodeIdManifest.profiles[0]!.assertions[0]!.nodeId = "   ";
    await writeFile(manifestPath, JSON.stringify(emptyNodeIdManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /assertions\[0\]\.nodeId must be a non-empty string/i
    );

    // Empty classType
    const emptyClassTypeManifest = createValidManifest();
    emptyClassTypeManifest.profiles[0]!.assertions[0]!.classType = "";
    await writeFile(manifestPath, JSON.stringify(emptyClassTypeManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /assertions\[0\]\.classType must be a non-empty string/i
    );

    // Empty input
    const emptyInputManifest = createValidManifest();
    emptyInputManifest.profiles[0]!.assertions[0]!.input = "";
    await writeFile(manifestPath, JSON.stringify(emptyInputManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /assertions\[0\]\.input must be a non-empty string/i
    );

    // Invalid equals type (e.g. object, null, undefined)
    const invalidEqualsManifest = createValidManifest();
    (
      invalidEqualsManifest.profiles[0]!.assertions[0] as unknown as Record<string, unknown>
    ).equals = { foo: "bar" };
    await writeFile(manifestPath, JSON.stringify(invalidEqualsManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /assertions\[0\]\.equals must be a string, finite number, or boolean/i
    );

    const nullEqualsManifest = createValidManifest();
    (nullEqualsManifest.profiles[0]!.assertions[0] as unknown as Record<string, unknown>).equals =
      null;
    await writeFile(manifestPath, JSON.stringify(nullEqualsManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /assertions\[0\]\.equals must be a string, finite number, or boolean/i
    );
  });

  it("manifest loading validates only the requested profile and ignores invalid fields in other profiles", async () => {
    const manifest = createValidManifest();
    // Corrupt the second profile with invalid fields (bad baseline, bad models, bad assertions)
    (manifest.profiles[1] as unknown as Record<string, unknown>).baseline = { steps: -999 };
    (manifest.profiles[1] as unknown as Record<string, unknown>).models = "invalid";
    (manifest.profiles[1] as unknown as Record<string, unknown>).assertions = [];
    (manifest.profiles[1] as unknown as Record<string, unknown>).expectedWorkflowHash =
      "invalid_hash";

    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    // Loading the valid profile (ltx_25_720p_97f) succeeds without errors
    const ltxProfile = await loadCertificationProfile(manifestPath, "ltx_25_720p_97f");
    expect(ltxProfile.id).toBe("ltx_25_720p_97f");
    expect(ltxProfile.baseline.steps).toBe(8);

    // Loading the corrupt profile fails on its validation
    await expect(loadCertificationProfile(manifestPath, "flux_schnell_draft")).rejects.toThrow(
      /expectedWorkflowHash/i
    );
  });

  it("manifest loading rejects invalid minFreeDiskGb, engine, or runnerProfile", async () => {
    // Negative minFreeDiskGb
    const negDiskManifest = createValidManifest();
    negDiskManifest.profiles[0]!.minFreeDiskGb = -10;
    await writeFile(manifestPath, JSON.stringify(negDiskManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /minFreeDiskGb/i
    );

    // Empty engine
    const emptyEngineManifest = createValidManifest();
    emptyEngineManifest.profiles[0]!.engine = "   ";
    await writeFile(manifestPath, JSON.stringify(emptyEngineManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /engine/i
    );

    // Empty runnerProfile
    const emptyRunnerManifest = createValidManifest();
    emptyRunnerManifest.profiles[0]!.runnerProfile = "";
    await writeFile(manifestPath, JSON.stringify(emptyRunnerManifest, null, 2));
    await expect(loadCertificationProfile(manifestPath, "ltx_25_720p_97f")).rejects.toThrow(
      /runnerProfile/i
    );
  });
});
