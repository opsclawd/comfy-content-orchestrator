import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ComponentLicenseRegistryLoadError,
  JsonFileLicenseRegistryPort,
  loadComponentLicenseRegistry
} from "./license-registry-loader.js";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../");
const SEED_REGISTRY_PATH = resolve(REPO_ROOT, "config/component-license-registry.json");

describe("license-registry-loader", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cco-license-registry-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads and validates the real committed config/component-license-registry.json seed file", async () => {
    const snapshot = await loadComponentLicenseRegistry(SEED_REGISTRY_PATH);
    expect(snapshot.registryRevision).toBe("2026-08-29.3");
    expect(snapshot.entries.length).toBeGreaterThanOrEqual(6);

    const ltxEntry = snapshot.entries.find((e) => e.componentId === "LTX_25_720P_5S_V1");
    expect(ltxEntry).toBeDefined();
    // No formal legal/commercial licensing audit has occurred; production
    // must remain review_required (fail-closed) until it does.
    expect(ltxEntry?.status).toBe("review_required");

    const fluxEntry = snapshot.entries.find((e) => e.componentId === "FLUX_SCHNELL_DRAFT_V1");
    expect(fluxEntry).toBeDefined();
    expect(fluxEntry?.status).toBe("approved");
    expect(fluxEntry?.licenseId).toBeUndefined();

    const fluxDevEntry = snapshot.entries.find((e) => e.componentId === "flux-1-dev");
    expect(fluxDevEntry).toBeDefined();
    expect(fluxDevEntry?.status).toBe("restricted");

    const minioEntry = snapshot.entries.find((e) => e.componentId === "minio");
    expect(minioEntry).toBeDefined();
    expect(minioEntry?.status).toBe("approved");

    const ffmpegEntry = snapshot.entries.find((e) => e.componentId === "ffmpeg");
    expect(ffmpegEntry).toBeDefined();
    // Approved under FSF GPL FAQ Mere Aggregation + PipeLinking clauses;
    // FFmpeg is invoked strictly as an external subprocess with no linking
    // into Node.js (issue #144 operator determination).
    expect(ffmpegEntry?.status).toBe("approved");
    expect(ffmpegEntry?.versionOrRevision).toBe("n8.0.1");

    const azureTtsEntry = snapshot.entries.find((e) => e.componentId === "azure-tts");
    expect(azureTtsEntry).toBeDefined();
    // review_required pending formal commercial review of Azure TTS terms.
    expect(azureTtsEntry?.status).toBe("review_required");
    expect(azureTtsEntry?.versionOrRevision).toBe("1");
  });

  it("throws ComponentLicenseRegistryLoadError when file does not exist", async () => {
    const nonExistentPath = join(tempDir, "missing-registry.json");
    await expect(loadComponentLicenseRegistry(nonExistentPath)).rejects.toThrow(
      ComponentLicenseRegistryLoadError
    );
  });

  it("throws ComponentLicenseRegistryLoadError when file contains invalid JSON", async () => {
    const invalidJsonPath = join(tempDir, "invalid.json");
    await writeFile(invalidJsonPath, "{ invalid json", "utf8");

    await expect(loadComponentLicenseRegistry(invalidJsonPath)).rejects.toThrow(
      ComponentLicenseRegistryLoadError
    );
  });

  it("throws ComponentLicenseRegistryLoadError when schema validation fails", async () => {
    const invalidSchemaPath = join(tempDir, "invalid-schema.json");
    await writeFile(
      invalidSchemaPath,
      JSON.stringify({
        registryRevision: "1",
        generatedAt: "not-a-datetime",
        entries: []
      }),
      "utf8"
    );

    await expect(loadComponentLicenseRegistry(invalidSchemaPath)).rejects.toThrow(
      ComponentLicenseRegistryLoadError
    );
  });

  it("throws ComponentLicenseRegistryLoadError when duplicate componentId + versionOrRevision entries exist (including across different component types)", async () => {
    const duplicatePath = join(tempDir, "duplicate-cross-type.json");
    await writeFile(
      duplicatePath,
      JSON.stringify({
        registryRevision: "1",
        generatedAt: "2026-08-29T12:00:00.000Z",
        entries: [
          {
            componentId: "model-a",
            componentType: "model",
            versionOrRevision: "v1",
            status: "approved",
            licenseSource: "internal",
            reviewedAt: "2026-08-29T12:00:00.000Z",
            policyRevision: "1"
          },
          {
            componentId: "model-a",
            componentType: "service",
            versionOrRevision: "v1",
            status: "restricted",
            licenseSource: "internal",
            reviewedAt: "2026-08-29T12:00:00.000Z",
            policyRevision: "1"
          }
        ]
      }),
      "utf8"
    );

    await expect(loadComponentLicenseRegistry(duplicatePath)).rejects.toThrow(
      /Duplicate component license entry found for "model-a"/
    );
  });

  it("JsonFileLicenseRegistryPort loads from file and returns synchronous snapshot", async () => {
    const port = await JsonFileLicenseRegistryPort.load(SEED_REGISTRY_PATH);
    const snapshot = port.getSnapshot();
    expect(snapshot.registryRevision).toBe("2026-08-29.3");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.entries)).toBe(true);
  });

  it("JsonFileLicenseRegistryPort.fromFile loads synchronously", () => {
    const port = JsonFileLicenseRegistryPort.fromFile(SEED_REGISTRY_PATH);
    const snapshot = port.getSnapshot();
    expect(snapshot.registryRevision).toBe("2026-08-29.3");
    expect(Object.isFrozen(snapshot)).toBe(true);
  });
});
