import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FastH3OmniFilesystemAdapter } from "@cco/infrastructure";
import { main as omniMain } from "./experiment-fasth3-omni.js";
import { runExperimentCli as legacyCli } from "./experiment-minimax-h3.js";

describe("experiment:fasth3-omni CLI", () => {
  let tempDir: string;
  let stdoutMessages: string[];
  let stderrMessages: string[];

  const mockStdout = (msg: string) => stdoutMessages.push(msg);
  const mockStderr = (msg: string) => stderrMessages.push(msg);

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "omni-cli-test-"));
    stdoutMessages = [];
    stderrMessages = [];
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const setupSourceAssets = async () => {
    const fsAdapter = new FastH3OmniFilesystemAdapter();
    const assetsDir = `${tempDir}/assets`;
    await fsAdapter.ensureDirectory(assetsDir);

    const asset1Path = `${assetsDir}/actor.png`;
    const asset1Bytes = "image-bytes-actor-png";
    const asset1Hash = createHash("sha256").update(asset1Bytes).digest("hex");
    await writeFile(asset1Path, asset1Bytes);

    const asset2Path = `${assetsDir}/wardrobe.png`;
    const asset2Bytes = "image-bytes-wardrobe-png";
    const asset2Hash = createHash("sha256").update(asset2Bytes).digest("hex");
    await writeFile(asset2Path, asset2Bytes);

    const asset3Path = `${assetsDir}/prop.png`;
    const asset3Bytes = "image-bytes-prop-png";
    const asset3Hash = createHash("sha256").update(asset3Bytes).digest("hex");
    await writeFile(asset3Path, asset3Bytes);

    const manifest = {
      campaignId: "11111111-1111-1111-1111-111111111111",
      sceneId: "22222222-2222-2222-2222-222222222222",
      specRevision: 1,
      referenceSetId: "33333333-3333-3333-3333-333333333333",
      exportDigest: "a".repeat(64),
      createdAt: "2026-10-29T10:00:00Z",
      orderedReferences: [
        {
          assetId: "44444444-4444-4444-4444-444444444444",
          contentHashSha256: asset1Hash,
          mimeType: "image/png" as const,
          width: 1024,
          height: 1024,
          semanticPurposes: ["subject_identity" as const],
          localPath: asset1Path
        },
        {
          assetId: "55555555-5555-5555-5555-555555555555",
          contentHashSha256: asset2Hash,
          mimeType: "image/png" as const,
          width: 1024,
          height: 1024,
          semanticPurposes: ["wardrobe" as const],
          localPath: asset2Path
        },
        {
          assetId: "66666666-6666-6666-6666-666666666666",
          contentHashSha256: asset3Hash,
          mimeType: "image/png" as const,
          width: 1024,
          height: 1024,
          semanticPurposes: ["product" as const],
          localPath: asset3Path
        }
      ]
    };

    const manifestPath = `${tempDir}/manifest.json`;
    await fsAdapter.writeJson(manifestPath, manifest);

    return { manifestPath, asset1Path, asset2Path, asset3Path };
  };

  it("prints help and exits with code 0 on --help", async () => {
    const code = await omniMain(["--help"], {
      stdout: mockStdout,
      stderr: mockStderr
    });

    expect(code).toBe(0);
    expect(stdoutMessages.some((m) => m.includes("FastH3-Omni"))).toBe(true);
  });

  it("rejects 'run' subcommand in Phase A with informative guidance", async () => {
    const code = await omniMain(["run", "--run-dir", "/some/dir"], {
      stdout: mockStdout,
      stderr: mockStderr
    });

    expect(code).toBe(1);
    expect(
      stderrMessages.some((m) => m.includes("Execution ('run') is forbidden in Phase A"))
    ).toBe(true);
  });

  it("rejects unknown subcommands with exit code 1", async () => {
    const code = await omniMain(["unknown-command"], {
      stdout: mockStdout,
      stderr: mockStderr
    });

    expect(code).toBe(1);
    expect(stderrMessages.some((m) => m.includes('Unknown subcommand "unknown-command"'))).toBe(
      true
    );
  });

  it("handles prepare and validate lifecycle successfully", async () => {
    const { manifestPath } = await setupSourceAssets();
    const outputRoot = `${tempDir}/runs`;

    // Prepare
    const prepCode = await omniMain(
      [
        "prepare",
        "--run-id",
        "omni-test-01",
        "--manifest",
        manifestPath,
        "--prompt",
        "A photo of <Picture 1> wearing <Picture 2> holding <Picture 3>",
        "--frames",
        "124",
        "--seed",
        "42",
        "--output-root",
        outputRoot
      ],
      {
        stdout: mockStdout,
        stderr: mockStderr
      }
    );

    expect(prepCode).toBe(0);
    expect(
      stdoutMessages.some((m) => m.includes("Successfully prepared FastH3-Omni experiment"))
    ).toBe(true);

    const runDir = `${outputRoot}/omni-test-01`;

    // Validate
    const validateCode = await omniMain(
      ["validate", "--run-dir", runDir, "--output-root", outputRoot],
      {
        stdout: mockStdout,
        stderr: mockStderr
      }
    );

    expect(validateCode).toBe(0);
    expect(stdoutMessages.some((m) => m.includes("Validation PASSED"))).toBe(true);
  });

  it("fails validation when staged file is tampered", async () => {
    const { manifestPath } = await setupSourceAssets();
    const outputRoot = `${tempDir}/runs`;

    await omniMain(
      [
        "prepare",
        "--run-id",
        "omni-tamper-01",
        "--manifest",
        manifestPath,
        "--prompt",
        "A photo of <Picture 1> wearing <Picture 2> holding <Picture 3>",
        "--frames",
        "124",
        "--seed",
        "42",
        "--output-root",
        outputRoot
      ],
      {
        stdout: mockStdout,
        stderr: mockStderr
      }
    );

    const runDir = `${outputRoot}/omni-tamper-01`;
    await writeFile(`${runDir}/inputs/ref_0_44444444.png`, "tampered-content");

    const validateCode = await omniMain(
      ["validate", "--run-dir", runDir, "--output-root", outputRoot],
      {
        stdout: mockStdout,
        stderr: mockStderr
      }
    );

    expect(validateCode).toBe(1);
    expect(stderrMessages.some((m) => m.includes("Staged asset hash mismatch"))).toBe(true);
  });

  it("fails validate when --strict-readiness is passed on non-executable offline run", async () => {
    const { manifestPath } = await setupSourceAssets();
    const outputRoot = `${tempDir}/runs`;

    await omniMain(
      [
        "prepare",
        "--run-id",
        "omni-strict-01",
        "--manifest",
        manifestPath,
        "--prompt",
        "A photo of <Picture 1> wearing <Picture 2> holding <Picture 3>",
        "--frames",
        "124",
        "--seed",
        "42",
        "--output-root",
        outputRoot
      ],
      {
        stdout: mockStdout,
        stderr: mockStderr
      }
    );

    const runDir = `${outputRoot}/omni-strict-01`;

    const validateCode = await omniMain(
      ["validate", "--run-dir", runDir, "--output-root", outputRoot, "--strict-readiness"],
      {
        stdout: mockStdout,
        stderr: mockStderr
      }
    );

    // Should exit with code 1 because Phase A run is not executable on hardware
    expect(validateCode).toBe(1);
    expect(
      stderrMessages.some((m) =>
        m.includes("Strict readiness check failed: run is not executable on target hardware")
      )
    ).toBe(true);
  });

  it("legacy experiment-minimax-h3 CLI rejects FastH3-Omni run directory (fail-closed protection)", async () => {
    const { manifestPath } = await setupSourceAssets();
    const outputRoot = `${tempDir}/runs`;

    await omniMain(
      [
        "prepare",
        "--run-id",
        "omni-legacy-test",
        "--manifest",
        manifestPath,
        "--prompt",
        "A photo of <Picture 1> wearing <Picture 2> holding <Picture 3>",
        "--frames",
        "124",
        "--seed",
        "42",
        "--output-root",
        outputRoot
      ],
      {
        stdout: mockStdout,
        stderr: mockStderr
      }
    );

    const runDir = `${outputRoot}/omni-legacy-test`;

    const legacyStdout: string[] = [];
    const legacyStderr: string[] = [];

    const legacyExitCode = await legacyCli(
      ["validate", "--run-dir", runDir, "--output-root", outputRoot],
      {
        stdout: (msg) => legacyStdout.push(msg),
        stderr: (msg) => legacyStderr.push(msg)
      }
    );

    expect(legacyExitCode).toBe(1);
    expect(legacyStderr.some((m) => m.includes("Descriptor validation failed"))).toBe(true);
  });
});
