import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AssembleDeliveryReel,
  AssemblySpecValidationError,
  EnforceLicenseRouting,
  LicenseRoutingError
} from "@cco/application";
import { AssemblyManifestSchema, type AssemblySpec, type VideoStemRef } from "@cco/contracts";
import { BUCKETS } from "@cco/shared";
import { FfmpegMediaAssemblerAdapter } from "./ffmpeg-media-assembler-adapter.js";
import { defaultSpawnRunner, type SpawnLikeFn } from "./ffmpeg-process-runner.js";
import {
  buildApprovedAcceptanceRegistrySnapshot,
  withComponentStatus
} from "./test-support/component-license-registry-fixtures.js";
import { InMemoryObjectStorage } from "./test-support/in-memory-object-storage.js";
import { generateSyntheticAudio } from "./test-support/synthetic-audio-fixtures.js";
import {
  generateSyntheticStems,
  type SyntheticStemResult
} from "./test-support/synthetic-stem-fixtures.js";
import { JsonFileLicenseRegistryPort } from "../governance/license-registry-loader.js";

describe("PRD §9.6 License Routing Gate & Assembly Invariants (integration)", () => {
  let fixtureDir: string;
  let workspaceRoot: string;
  let objectStorage: InMemoryObjectStorage;
  let syntheticMp4Stems: SyntheticStemResult[];
  let syntheticVo: Awaited<ReturnType<typeof generateSyntheticAudio>>;
  let syntheticSb: Awaited<ReturnType<typeof generateSyntheticAudio>>;
  let spawnCount: number;
  let countingSpawn: SpawnLikeFn;
  let adapter: FfmpegMediaAssemblerAdapter;
  let ffmpegVersion: string;

  beforeAll(async () => {
    fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "ffmpeg-license-fixtures-"));
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ffmpeg-license-workspaces-"));
    objectStorage = new InMemoryObjectStorage();

    // Probe live ffmpeg version once
    const versionRun = await defaultSpawnRunner("ffmpeg", ["-version"]);
    const firstLine = versionRun.stdout.split("\n")[0] || "";
    const versionMatch = firstLine.match(/ffmpeg\s+version\s+([^\s]+)/i);
    ffmpegVersion = versionMatch ? versionMatch[1]! : "n8.0.1";

    spawnCount = 0;
    countingSpawn = async (command, args, options) => {
      spawnCount++;
      return defaultSpawnRunner(command, args, options);
    };

    adapter = new FfmpegMediaAssemblerAdapter({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      workspaceRoot,
      objectStorage,
      spawnFn: countingSpawn
    });

    // Generate six synthetic 5s 1280x720 MP4 stems
    syntheticMp4Stems = await generateSyntheticStems({
      ffmpegPath: "ffmpeg",
      outputDir: path.join(fixtureDir, "mp4"),
      count: 6,
      durationSec: 5,
      width: 1280,
      height: 720,
      fps: 30,
      format: "mp4"
    });

    for (const stem of syntheticMp4Stems) {
      await objectStorage.putObject({
        bucket: BUCKETS.REVIEW,
        key: `scenes/scene-mp4-0${stem.index + 1}/candidate.mp4`,
        body: stem.bytes,
        contentType: "video/mp4",
        checksumSha256: stem.sha256
      });
    }

    // Generate voiceover fixture (15s @ 440Hz sine wave)
    syntheticVo = await generateSyntheticAudio({
      outputPath: path.join(fixtureDir, "audio", "vo.mp3"),
      durationSec: 15,
      frequency: 440,
      channels: 1,
      format: "mp3"
    });
    await objectStorage.putObject({
      bucket: BUCKETS.REVIEW,
      key: "audio/vo.mp3",
      body: syntheticVo.bytes,
      contentType: syntheticVo.contentType,
      checksumSha256: syntheticVo.sha256
    });

    // Generate stereo soundbed fixture (30s @ 220Hz sine wave)
    syntheticSb = await generateSyntheticAudio({
      outputPath: path.join(fixtureDir, "audio", "sb.mp3"),
      durationSec: 30,
      frequency: 220,
      channels: 2,
      format: "mp3"
    });
    await objectStorage.putObject({
      bucket: BUCKETS.REVIEW,
      key: "audio/sb.mp3",
      body: syntheticSb.bytes,
      contentType: syntheticSb.contentType,
      checksumSha256: syntheticSb.sha256
    });
  }, 300_000);

  afterAll(async () => {
    if (fixtureDir) {
      await fs.rm(fixtureDir, { recursive: true, force: true }).catch(() => {});
    }
    if (workspaceRoot) {
      await fs.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  beforeEach(() => {
    spawnCount = 0;
  });

  function buildValidAcceptanceSpec(campaignId: string): AssemblySpec {
    const videoStems: VideoStemRef[] = syntheticMp4Stems.map((stem) => ({
      sceneId: `scene-mp4-0${stem.index + 1}`,
      generationManifestId: `gen-man-mp4-0${stem.index + 1}`,
      order: stem.index,
      media: {
        bucket: BUCKETS.REVIEW,
        key: `scenes/scene-mp4-0${stem.index + 1}/candidate.mp4`,
        sha256: stem.sha256,
        contentType: "video/mp4"
      },
      expectedDurationMs: stem.durationMs
    }));

    return {
      campaignId,
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      },
      expectedTotalDurationMs: 30000,
      voiceover: {
        assetId: "vo-asset-001",
        kind: "voiceover",
        media: {
          bucket: BUCKETS.REVIEW,
          key: "audio/vo.mp3",
          sha256: syntheticVo.sha256,
          contentType: "audio/mpeg"
        },
        source: { kind: "provider", providerId: "azure-tts" },
        startMs: 2000,
        expectedDurationMs: 15000
      },
      soundbed: {
        assetId: "sb-asset-001",
        kind: "soundbed",
        media: {
          bucket: BUCKETS.REVIEW,
          key: "audio/sb.mp3",
          sha256: syntheticSb.sha256,
          contentType: "audio/mpeg"
        },
        source: { kind: "local" },
        startMs: 0,
        expectedDurationMs: 30000
      },
      subtitleCues: [
        { startMs: 2500, endMs: 7000, text: "First subtitle line with {safe} text" },
        { startMs: 8000, endMs: 14000, text: "Second subtitle dialogue line" }
      ],
      videoStems
    };
  }

  it("smoke test: approved registry snapshot allows assembly with real FFmpeg spawns and output writes", async () => {
    const campaignId = "campaign-license-approved-smoke";
    const spec = buildValidAcceptanceSpec(campaignId);

    const snapshot = buildApprovedAcceptanceRegistrySnapshot({ ffmpegVersion });
    const enforceLicenseRouting = new EnforceLicenseRouting({
      registry: { getSnapshot: () => snapshot }
    });

    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [
        { componentId: "ffmpeg", componentType: "runtime", versionOrRevision: ffmpegVersion }
      ],
      mediaAssembler: adapter,
      objectStorage,
      enforceLicenseRouting,
      generationManifestRepository: {
        getComponentIdentityById: async () => ({
          renderProfile: "LTX_25_720P_5S_V1",
          renderProfileVersion: 1
        })
      }
    });

    const { manifest, executionResult } = await useCase.assemble({ spec });

    expect(manifest).toBeDefined();
    expect(executionResult).toBeDefined();
    expect(spawnCount).toBeGreaterThan(0);

    const deliveryMedia = await objectStorage.getObject({
      bucket: BUCKETS.DELIVERY,
      key: `campaigns/${campaignId}/assemblies/${executionResult.assemblyId}/output.mp4`
    });
    expect(deliveryMedia).toBeDefined();

    const deliveryManifest = await objectStorage.getObject({
      bucket: BUCKETS.DELIVERY,
      key: `campaigns/${campaignId}/assemblies/${executionResult.assemblyId}/manifest.json`
    });
    expect(deliveryManifest).toBeDefined();
    const parsedManifest = AssemblyManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(deliveryManifest?.body))
    );
    expect(parsedManifest.assemblyId).toBe(executionResult.assemblyId);
  });

  const deniedStatuses = [
    { status: "restricted" as const, label: "restricted" },
    { status: "review_required" as const, label: "review_required" },
    { status: "blocked" as const, label: "blocked" },
    { status: "unregistered" as const, label: "unknown/unregistered" }
  ];

  for (const { status, label } of deniedStatuses) {
    it(`fails closed when component status is '${label}': zero FFmpeg spawns, zero storage writes, sanitized typed error`, async () => {
      const campaignId = `campaign-license-denied-${status}`;
      const spec = buildValidAcceptanceSpec(campaignId);

      const baseSnapshot = buildApprovedAcceptanceRegistrySnapshot({ ffmpegVersion });
      const mutatedSnapshot = withComponentStatus(baseSnapshot, "LTX_25_720P_5S_V1", status);

      const enforceLicenseRouting = new EnforceLicenseRouting({
        registry: { getSnapshot: () => mutatedSnapshot }
      });

      const useCase = new AssembleDeliveryReel({
        runtimeComponents: [
          { componentId: "ffmpeg", componentType: "runtime", versionOrRevision: ffmpegVersion }
        ],
        mediaAssembler: adapter,
        objectStorage,
        enforceLicenseRouting,
        generationManifestRepository: {
          getComponentIdentityById: async () => ({
            renderProfile: "LTX_25_720P_5S_V1",
            renderProfileVersion: 1
          })
        }
      });

      let thrownError: unknown;
      try {
        await useCase.assemble({ spec });
      } catch (err) {
        thrownError = err;
      }

      // 1. Typed policy failure
      expect(thrownError).toBeInstanceOf(LicenseRoutingError);
      const routingError = thrownError as LicenseRoutingError;
      expect(routingError.name).toBe("LicenseRoutingError");
      expect(routingError.registryRevision).toBe("2026-08-29.acceptance-1");
      expect(routingError.decisionId).toMatch(/^gov-dec-/);

      // 2. Contains component identity and revision
      expect(routingError.message).toContain("LTX_25_720P_5S_V1");
      expect(routingError.registryRevision).toBe("2026-08-29.acceptance-1");

      // 3. Sanitized: contains zero secrets, tokens, or credential-shaped strings
      const errorString = `${routingError.message} ${JSON.stringify(routingError.deniedReasons ?? [])}`;
      expect(errorString).not.toMatch(/s3:\/\/|minioadmin|bearer|secret|password|token/i);

      // 4. Zero FFmpeg process spawns
      expect(spawnCount).toBe(0);

      // 5. Zero final delivery object write and zero AssemblyManifest write
      const deliveryKeys = objectStorage
        .getAllKeys()
        .filter((k) => k.includes(`campaigns/${campaignId}/assemblies/`));
      expect(deliveryKeys).toEqual([]);
    });
  }

  it("fails closed on stale/unresolvable GenerationManifest identity: zero FFmpeg spawns, zero storage writes", async () => {
    const campaignId = "campaign-stale-generation-manifest";
    const spec = buildValidAcceptanceSpec(campaignId);

    const snapshot = buildApprovedAcceptanceRegistrySnapshot({ ffmpegVersion });
    const enforceLicenseRouting = new EnforceLicenseRouting({
      registry: { getSnapshot: () => snapshot }
    });

    // Repository returns undefined for stem 3, simulating a missing/stale generation manifest
    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [
        { componentId: "ffmpeg", componentType: "runtime", versionOrRevision: ffmpegVersion }
      ],
      mediaAssembler: adapter,
      objectStorage,
      enforceLicenseRouting,
      generationManifestRepository: {
        getComponentIdentityById: async (id: string) => {
          if (id === spec.videoStems[2]!.generationManifestId) {
            return undefined; // Stale / missing
          }
          return {
            renderProfile: "LTX_25_720P_5S_V1",
            renderProfileVersion: 1
          };
        }
      }
    });

    let thrownError: unknown;
    try {
      await useCase.assemble({ spec });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(LicenseRoutingError);
    const routingError = thrownError as LicenseRoutingError;
    expect(routingError.message).toContain(
      `unresolved-generation-manifest:${spec.videoStems[2]!.generationManifestId}`
    );
    expect(routingError.registryRevision).toBe("2026-08-29.acceptance-1");

    // Zero FFmpeg process spawns and zero storage writes
    expect(spawnCount).toBe(0);
    const deliveryKeys = objectStorage
      .getAllKeys()
      .filter((k) => k.includes(`campaigns/${campaignId}/assemblies/`));
    expect(deliveryKeys).toEqual([]);
  });

  it("fails validation before FFmpeg dispatch on malformed subtitle timeline: zero FFmpeg spawns, zero storage writes", async () => {
    const campaignId = "campaign-malformed-subtitles";
    const spec = buildValidAcceptanceSpec(campaignId);
    // Introduce inverted subtitle cue timeline (endMs < startMs)
    const malformedSpec: AssemblySpec = {
      ...spec,
      subtitleCues: [{ startMs: 5000, endMs: 2000, text: "Inverted subtitle timestamps" }]
    };

    const snapshot = buildApprovedAcceptanceRegistrySnapshot({ ffmpegVersion });
    const enforceLicenseRouting = new EnforceLicenseRouting({
      registry: { getSnapshot: () => snapshot }
    });

    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [
        { componentId: "ffmpeg", componentType: "runtime", versionOrRevision: ffmpegVersion }
      ],
      mediaAssembler: adapter,
      objectStorage,
      enforceLicenseRouting,
      generationManifestRepository: {
        getComponentIdentityById: async () => ({
          renderProfile: "LTX_25_720P_5S_V1",
          renderProfileVersion: 1
        })
      }
    });

    let thrownError: unknown;
    try {
      await useCase.assemble({ spec: malformedSpec });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(AssemblySpecValidationError);
    // Step 2 failed, so Step 3 mediaAssembler.assemble was never invoked
    expect(spawnCount).toBe(0);

    const deliveryKeys = objectStorage
      .getAllKeys()
      .filter((k) => k.includes(`campaigns/${campaignId}/assemblies/`));
    expect(deliveryKeys).toEqual([]);
  });

  it("fails closed on inconsistent GenerationManifest identity (stem hash mismatch): zero FFmpeg spawns, zero storage writes", async () => {
    const campaignId = "campaign-inconsistent-generation-manifest";
    const spec = buildValidAcceptanceSpec(campaignId);

    const snapshot = buildApprovedAcceptanceRegistrySnapshot({ ffmpegVersion });
    const enforceLicenseRouting = new EnforceLicenseRouting({
      registry: { getSnapshot: () => snapshot }
    });

    // Repository returns an identity with an output checksum that does NOT match stem 1's media sha256
    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [
        { componentId: "ffmpeg", componentType: "runtime", versionOrRevision: ffmpegVersion }
      ],
      mediaAssembler: adapter,
      objectStorage,
      enforceLicenseRouting,
      generationManifestRepository: {
        getComponentIdentityById: async (id: string) => {
          if (id === spec.videoStems[0]!.generationManifestId) {
            return {
              renderProfile: "LTX_25_720P_5S_V1",
              renderProfileVersion: 1,
              outputChecksumsSha256: ["9".repeat(64)] // Inconsistent with stem.media.sha256
            };
          }
          return {
            renderProfile: "LTX_25_720P_5S_V1",
            renderProfileVersion: 1
          };
        }
      }
    });

    let thrownError: unknown;
    try {
      await useCase.assemble({ spec });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(LicenseRoutingError);
    const routingError = thrownError as LicenseRoutingError;
    expect(routingError.message).toContain(
      `inconsistent-generation-manifest:${spec.videoStems[0]!.generationManifestId}`
    );
    expect(spawnCount).toBe(0);

    const deliveryKeys = objectStorage
      .getAllKeys()
      .filter((k) => k.includes(`campaigns/${campaignId}/assemblies/`));
    expect(deliveryKeys).toEqual([]);
  });

  it("fails closed under the real production config/component-license-registry.json: LTX (issue #143) and ffmpeg (issue #144) have operator determinations on record, but azure-tts still has no formal commercial review, so real production assembly must deny", async () => {
    // This deliberately does NOT assert a success path against the real
    // production registry. As of registry revision 2026-08-29.3, LTX
    // (#143) and ffmpeg (#144) carry operator determinations on record and
    // are `approved`, but `azure-tts` remains `review_required` pending
    // formal commercial review of the Azure TTS terms (sister issue #145).
    // Because buildValidAcceptanceSpec includes a voiceover sourced from
    // `providerId: "azure-tts"`, the assembly use case's requiredComponents
    // always includes azure-tts, and EnforceLicenseRouting must deny every
    // real production assembly until azure-tts is also approved. The
    // mechanism proof against a real "approved" state lives in the
    // deniedStatuses matrix above and the smoke test near the top of this
    // file, both of which use an explicitly-named separate acceptance-only
    // registry fixture (buildApprovedAcceptanceRegistrySnapshot) rather than
    // this repository's real governing config. A test that made real
    // production config appear to succeed would either require silently
    // switching the production registry to `approved` without genuine
    // license evidence (exactly what PRD §9.6 and the operator-only issues
    // forbid), or it would misrepresent this repository's actual,
    // correctly-blocked commercial-deployment state.
    const campaignId = "campaign-production-registry-fails-closed";
    const spec = buildValidAcceptanceSpec(campaignId);

    const productionRegistryPath = path.resolve(
      process.cwd(),
      "config/component-license-registry.json"
    );
    const productionRegistry = JsonFileLicenseRegistryPort.fromFile(productionRegistryPath);
    const enforceLicenseRouting = new EnforceLicenseRouting({
      registry: productionRegistry
    });

    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [
        { componentId: "ffmpeg", componentType: "runtime", versionOrRevision: ffmpegVersion }
      ],
      mediaAssembler: adapter,
      objectStorage,
      enforceLicenseRouting,
      generationManifestRepository: {
        getComponentIdentityById: async () => ({
          renderProfile: "LTX_25_720P_5S_V1",
          renderProfileVersion: 1
        })
      }
    });

    let thrownError: unknown;
    try {
      await useCase.assemble({ spec });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(LicenseRoutingError);
    const routingError = thrownError as LicenseRoutingError;
    // The denial must be driven by azure-tts, the remaining review_required
    // component in the production registry. In CI environments where the
    // probed ffmpeg build differs from the registry's pinned 7.0.2-static,
    // EnforceLicenseRouting may instead deny ffmpeg as an unknown_component
    // (version mismatch) — that is still a fail-closed outcome, but the
    // production-relevant assertion is that azure-tts, not ffmpeg or LTX,
    // is the gating component.
    expect(routingError.message).toContain("azure-tts");
    expect(spawnCount).toBe(0);

    const deliveryKeys = objectStorage
      .getAllKeys()
      .filter((k) => k.includes(`campaigns/${campaignId}/assemblies/`));
    expect(deliveryKeys).toEqual([]);
  });
});
